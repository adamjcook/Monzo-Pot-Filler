import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.ts";

const env = {
  MONZO_CLIENT_ID: "oauth2client_test",
  MONZO_CLIENT_SECRET: "s3cret",
  MAX_DEPOSIT_PENCE: "200000",
  ASSETS: { fetch: async () => new Response("asset") },
};
const ORIGIN = "https://pots.example.workers.dev";
const TOKEN = "Bearer abcdefghijklmnop.qrstu";
let calls;
let upstream;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  upstream = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? String(init.body) : "" });
    return upstream(String(url), init);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const req = (path, init = {}) => worker.fetch(new Request(ORIGIN + path, init), env);
const api = (path, init = {}) => req(path, { ...init, headers: { Authorization: TOKEN, ...(init.headers || {}) } });

test("/login redirects to Monzo with state and sets a matching cookie", async () => {
  const res = await req("/login");
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get("Location"));
  assert.equal(loc.origin + loc.pathname, "https://auth.monzo.com/");
  assert.equal(loc.searchParams.get("client_id"), "oauth2client_test");
  assert.equal(loc.searchParams.get("redirect_uri"), ORIGIN + "/callback");
  assert.equal(loc.searchParams.get("response_type"), "code");
  const state = loc.searchParams.get("state");
  assert.ok(state.length >= 40);
  const cookie = res.headers.get("Set-Cookie");
  assert.ok(cookie.startsWith(`__Host-pf_state=${state};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
});

test("/callback rejects a missing or mismatched state without calling Monzo", async () => {
  for (const cookie of [null, "__Host-pf_state=other"]) {
    const res = await req("/callback?code=abc&state=expected", cookie ? { headers: { Cookie: cookie } } : {});
    assert.equal(res.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("/callback exchanges the code and hands only the access token to the page", async () => {
  upstream = () => Response.json({ access_token: "tok_live_123", refresh_token: "SHOULD_NOT_LEAK", expires_in: 21600, user_id: "user_1" });
  const res = await req("/callback?code=the_code&state=st8", { headers: { Cookie: "__Host-pf_state=st8" } });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.monzo.com/oauth2/token");
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("client_secret"), "s3cret");
  assert.equal(form.get("redirect_uri"), ORIGIN + "/callback");
  assert.equal(form.get("code"), "the_code");
  const html = await res.text();
  assert.match(html, /tok_live_123/);
  assert.doesNotMatch(html, /SHOULD_NOT_LEAK/);
  assert.doesNotMatch(html, /s3cret/);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.match(res.headers.get("Content-Security-Policy"), /script-src 'nonce-/);
  assert.match(res.headers.get("Set-Cookie"), /Max-Age=0/);
});

test("/callback refuses other Monzo users when ALLOWED_USER_ID is set", async () => {
  upstream = () => Response.json({ access_token: "tok", user_id: "user_someone_else" });
  const res = await worker.fetch(
    new Request(ORIGIN + "/callback?code=c&state=s", { headers: { Cookie: "__Host-pf_state=s" } }),
    { ...env, ALLOWED_USER_ID: "user_me" },
  );
  assert.equal(res.status, 403);
  assert.doesNotMatch(await res.text(), /tok/);
  assert.equal(calls.at(-1).url, "https://api.monzo.com/oauth2/logout");
});

test("proxy forwards allowlisted reads with the bearer token only", async () => {
  for (const [path, up] of [
    ["/api/ping/whoami", "/ping/whoami"],
    ["/api/accounts?account_type=uk_retail_joint", "/accounts?account_type=uk_retail_joint"],
    ["/api/balance?account_id=acc_123", "/balance?account_id=acc_123"],
    ["/api/pots?current_account_id=acc_123", "/pots?current_account_id=acc_123"],
  ]) {
    calls = [];
    const res = await api(path, { headers: { Cookie: "x=y", "X-Other": "1" } });
    assert.equal(res.status, 200, path);
    assert.equal(calls[0].url, "https://api.monzo.com" + up);
    assert.deepEqual(Object.keys(calls[0].init.headers), ["Authorization"]);
    assert.equal(calls[0].init.headers.Authorization, TOKEN);
  }
});

test("proxy forwards a valid deposit and rebuilds the body", async () => {
  const body = "source_account_id=acc_1&amount=2499&dedupe_id=pf_0123456789abcdef";
  const res = await api("/api/pots/pot_1/deposit", { method: "PUT", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, "https://api.monzo.com/pots/pot_1/deposit");
  assert.equal(calls[0].init.method, "PUT");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].body)), {
    source_account_id: "acc_1", amount: "2499", dedupe_id: "pf_0123456789abcdef",
  });
});

test("proxy rejects everything outside the allowlist", async () => {
  const good = "source_account_id=acc_1&amount=100&dedupe_id=pf_0123456789abcdef";
  const cases = [
    ["/api/pots/pot_1/withdraw", { method: "PUT", body: "destination_account_id=acc_1&amount=1&dedupe_id=pf_0123456789" }],
    ["/api/transactions?account_id=acc_1", {}],
    ["/api/accounts?account_type=uk_prepaid", {}],
    ["/api/accounts?account_type=uk_retail&x=1", {}],
    ["/api/balance?account_id=../oauth2", {}],
    ["/api/balance", {}],
    ["/api/pots", { method: "DELETE" }],
    ["/api/pots/pot_1/deposit", { method: "POST", body: good }],
    ["/api/pots/..%2Fwithdraw/deposit", { method: "PUT", body: good }],
    ["/api/pots/pot_1/deposit", { method: "PUT", body: good + "&extra=1" }],
    ["/api/pots/pot_1/deposit", { method: "PUT", body: "source_account_id=acc_1&amount=0&dedupe_id=pf_0123456789abcdef" }],
    ["/api/pots/pot_1/deposit", { method: "PUT", body: "source_account_id=acc_1&amount=-5&dedupe_id=pf_0123456789abcdef" }],
    ["/api/pots/pot_1/deposit", { method: "PUT", body: "source_account_id=acc_1&amount=12.5&dedupe_id=pf_0123456789abcdef" }],
    ["/api/pots/pot_1/deposit", { method: "PUT", body: "source_account_id=acc_1&amount=200001&dedupe_id=pf_0123456789abcdef" }],
    ["/api/oauth2/token", { method: "POST" }],
  ];
  for (const [path, init] of cases) {
    const res = await api(path, init);
    assert.ok(res.status >= 400 && res.status < 500, `${init.method || "GET"} ${path} -> ${res.status}`);
  }
  assert.equal(calls.length, 0, "nothing reached Monzo");
});

test("proxy requires a bearer token and refuses cross-site browser requests", async () => {
  assert.equal((await req("/api/ping/whoami")).status, 401);
  assert.equal((await req("/api/ping/whoami", { headers: { Authorization: "Basic abc" } })).status, 401);
  assert.equal((await api("/api/ping/whoami", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal(calls.length, 0);
});

test("proxy passes Monzo errors through and never caches", async () => {
  upstream = () => Response.json({ code: "forbidden.insufficient_permissions" }, { status: 403 });
  const res = await api("/api/accounts?account_type=uk_retail");
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "forbidden.insufficient_permissions");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("other paths are served from static assets", async () => {
  const res = await req("/");
  assert.equal(await res.text(), "asset");
});
