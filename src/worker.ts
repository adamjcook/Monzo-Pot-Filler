/**
 * Monzo Pot Filler Worker.
 *
 *  GET  /login            start Monzo OAuth (sets a CSRF state cookie, redirects to auth.monzo.com)
 *  GET  /callback         check state, exchange the code for a token, hand the token to the page
 *  *    /api/...          strict allowlist proxy to api.monzo.com (bearer token passed through)
 *  everything else        static assets from ./public
 *
 * The Worker keeps no state. It never stores or logs access tokens, and it has no
 * route that can withdraw money or move it between accounts.
 */

export interface Env {
  ASSETS: Fetcher;
  MONZO_CLIENT_ID: string;
  MONZO_CLIENT_SECRET: string;
  /** Optional: if set, sign-ins from any other Monzo user ID are rejected. */
  ALLOWED_USER_ID?: string;
  /** Optional cap on a single pot deposit, in pence. Default £2,000. */
  MAX_DEPOSIT_PENCE?: string;
}

const MONZO_API = "https://api.monzo.com";
const MONZO_AUTH = "https://auth.monzo.com/";
const STATE_COOKIE = "__Host-pf_state";
const DEFAULT_MAX_DEPOSIT = 200_000;

const ID_RE = /^[A-Za-z0-9_]{1,80}$/;
const DEDUPE_RE = /^[A-Za-z0-9_-]{8,128}$/;
const AMOUNT_RE = /^[1-9][0-9]{0,9}$/;
const BEARER_RE = /^Bearer [A-Za-z0-9._~+/=-]{10,4096}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/login") return login(req, url, env);
      if (url.pathname === "/callback") return await callback(req, url, env);
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return await proxy(req, url, env);
      return env.ASSETS.fetch(req);
    } catch {
      // Deliberately no logging: a request may carry a token.
      return json(502, { error: "worker_error", message: "Something went wrong talking to Monzo." });
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------- OAuth

function login(req: Request, url: URL, env: Env): Response {
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
  if (!env.MONZO_CLIENT_ID) return page(500, "Not configured", "<p>MONZO_CLIENT_ID is not set on the Worker.</p>");

  const state = randomToken(32);
  const auth = new URL(MONZO_AUTH);
  auth.searchParams.set("client_id", env.MONZO_CLIENT_ID);
  auth.searchParams.set("redirect_uri", `${url.origin}/callback`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function callback(req: Request, url: URL, env: Env): Promise<Response> {
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
  const clear = `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  const fail = (title: string, msg: string, status = 400) => {
    const res = page(status, title, `<p>${escapeHtml(msg)}</p><p><a href="/">Back to Pot Filler</a></p>`);
    res.headers.append("Set-Cookie", clear);
    return res;
  };

  const error = url.searchParams.get("error");
  if (error) return fail("Sign-in cancelled", `Monzo returned: ${error}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(req, STATE_COOKIE);
  if (!code || !state || !expected || !safeEqual(state, expected)) {
    return fail("Sign-in check failed", "The sign-in link didn't match this browser. Start again from the app.");
  }
  if (!env.MONZO_CLIENT_ID || !env.MONZO_CLIENT_SECRET) {
    return fail("Not configured", "MONZO_CLIENT_ID or MONZO_CLIENT_SECRET is not set on the Worker.", 500);
  }

  const tokenRes = await fetch(`${MONZO_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.MONZO_CLIENT_ID,
      client_secret: env.MONZO_CLIENT_SECRET,
      redirect_uri: `${url.origin}/callback`,
      code,
    }),
  });
  if (!tokenRes.ok) return fail("Sign-in failed", `Monzo refused the token exchange (HTTP ${tokenRes.status}).`, 502);

  const tok = (await tokenRes.json()) as { access_token?: string; expires_in?: number; user_id?: string };
  if (!tok.access_token) return fail("Sign-in failed", "Monzo didn't return an access token.", 502);
  // Any refresh_token in the response is dropped here on purpose: nothing long-lived leaves the Worker.

  if (env.ALLOWED_USER_ID && tok.user_id !== env.ALLOWED_USER_ID) {
    await fetch(`${MONZO_API}/oauth2/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok.access_token}` },
    }).catch(() => {});
    return fail("Not allowed", "This Pot Filler only works with its owner's Monzo account.", 403);
  }

  const session = {
    token: tok.access_token,
    userId: tok.user_id ?? null,
    expiresIn: typeof tok.expires_in === "number" ? tok.expires_in : 21600,
  };
  const nonce = randomToken(16);
  // JSON inside <script>: escape "<" so the payload can never close the tag.
  const payload = JSON.stringify(session).replace(/</g, "\\u003c");
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Signing in…</title><body style="font-family:system-ui;padding:24px">Signing in…
<script nonce="${nonce}">
(function(){var s=${payload};s.expiresAt=Date.now()+s.expiresIn*1000;delete s.expiresIn;
try{sessionStorage.setItem("pf.session",JSON.stringify(s));sessionStorage.removeItem("pf.approved");}catch(e){}
location.replace("/");})();
</script></body>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": clear,
    },
  });
}

// ---------------------------------------------------------------- API proxy

type Route = { method: "GET" | "PUT" | "POST"; upstream: string; body?: URLSearchParams };

async function proxy(req: Request, url: URL, env: Env): Promise<Response> {
  // Browsers send Sec-Fetch-Site; refuse anything not coming from our own page.
  const site = req.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") return json(403, { error: "proxy.cross_site" });

  const auth = req.headers.get("Authorization") ?? "";
  if (!BEARER_RE.test(auth)) return json(401, { error: "proxy.missing_token" });

  const route = await matchRoute(req, url, env);
  if ("error" in route) return json(route.status, { error: route.error });

  const headers: Record<string, string> = { Authorization: auth };
  if (route.body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const upstream = await fetch(`${MONZO_API}${route.upstream}`, {
    method: route.method,
    headers,
    body: route.body,
    redirect: "manual",
  });

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function matchRoute(
  req: Request,
  url: URL,
  env: Env,
): Promise<Route | { error: string; status: number }> {
  const path = url.pathname.slice("/api".length);
  const q = url.searchParams;
  const deny = (error = "proxy.not_allowed", status = 403) => ({ error, status });
  const onlyParams = (...names: string[]) => [...q.keys()].every((k) => names.includes(k));

  if (req.method === "GET" && path === "/ping/whoami") {
    if (!onlyParams()) return deny("proxy.bad_params", 400);
    return { method: "GET", upstream: "/ping/whoami" };
  }

  if (req.method === "GET" && path === "/accounts") {
    const type = q.get("account_type");
    if (!onlyParams("account_type")) return deny("proxy.bad_params", 400);
    if (type !== null && type !== "uk_retail" && type !== "uk_retail_joint") return deny("proxy.bad_params", 400);
    return { method: "GET", upstream: type ? `/accounts?account_type=${type}` : "/accounts" };
  }

  if (req.method === "GET" && path === "/balance") {
    const id = q.get("account_id");
    if (!onlyParams("account_id") || !id || !ID_RE.test(id)) return deny("proxy.bad_params", 400);
    return { method: "GET", upstream: `/balance?account_id=${id}` };
  }

  if (req.method === "GET" && path === "/pots") {
    const id = q.get("current_account_id");
    if (!onlyParams("current_account_id") || !id || !ID_RE.test(id)) return deny("proxy.bad_params", 400);
    return { method: "GET", upstream: `/pots?current_account_id=${id}` };
  }

  const deposit = /^\/pots\/([^/]+)\/deposit$/.exec(path);
  if (req.method === "PUT" && deposit) {
    const potId = deposit[1];
    if (!ID_RE.test(potId) || [...q.keys()].length) return deny("proxy.bad_params", 400);
    const len = Number(req.headers.get("Content-Length") ?? "0");
    if (len > 2048) return deny("proxy.too_large", 413);
    const text = await req.text();
    if (text.length > 2048) return deny("proxy.too_large", 413);
    const form = new URLSearchParams(text);
    const keys = [...form.keys()].sort().join(",");
    if (keys !== "amount,dedupe_id,source_account_id") return deny("proxy.bad_body", 400);
    const src = form.get("source_account_id")!;
    const amount = form.get("amount")!;
    const dedupe = form.get("dedupe_id")!;
    if (!ID_RE.test(src) || !AMOUNT_RE.test(amount) || !DEDUPE_RE.test(dedupe)) return deny("proxy.bad_body", 400);
    const max = Number(env.MAX_DEPOSIT_PENCE) > 0 ? Number(env.MAX_DEPOSIT_PENCE) : DEFAULT_MAX_DEPOSIT;
    if (Number(amount) > max) return deny("proxy.amount_over_cap", 400);
    return {
      method: "PUT",
      upstream: `/pots/${potId}/deposit`,
      body: new URLSearchParams({ source_account_id: src, amount, dedupe_id: dedupe }),
    };
  }

  if (req.method === "POST" && path === "/logout") {
    if (!onlyParams()) return deny("proxy.bad_params", 400);
    return { method: "POST", upstream: "/oauth2/logout" };
  }

  return deny();
}

// ---------------------------------------------------------------- helpers

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function page(status: number, title: string, bodyHtml: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(title)}</title>
<body style="font-family:system-ui;padding:24px;max-width:32rem;line-height:1.5">
<h1 style="font-size:1.25rem">${escapeHtml(title)}</h1>${bodyHtml}</body>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function randomToken(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
