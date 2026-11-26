// @ts-check
import { ApiError } from "./logic.js";

/** @typedef {import("./logic.js").Api} Api */
/** @typedef {import("./logic.js").Account} Account */

/**
 * Talks to Monzo through the Worker's /api proxy.
 * @param {() => string | null} getToken
 * @returns {Api}
 */
export function liveApi(getToken) {
  /** @param {string} method @param {string} path @param {URLSearchParams} [body] */
  async function call(method, path, body) {
    const token = getToken();
    if (!token) throw new ApiError(401, "no_token");
    /** @type {Record<string, string>} */
    const headers = { Authorization: `Bearer ${token}` };
    if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const res = await fetch(`/api${path}`, { method, headers, body, cache: "no-store" });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty or non-JSON body */
    }
    if (!res.ok) throw new ApiError(res.status, data?.code || data?.error || "", data?.message);
    return data;
  }
  const enc = encodeURIComponent;

  return {
    whoami: () => call("GET", "/ping/whoami"),
    async accounts(type) {
      const data = await call("GET", `/accounts?account_type=${type}`);
      /** @type {Account[]} */
      const list = data?.accounts ?? [];
      // Belt and braces: drop closed accounts and anything of another type, if the fields are present.
      return list.filter((a) => !a.closed && (!a.type || a.type === type));
    },
    balance: (id) => call("GET", `/balance?account_id=${enc(id)}`),
    async pots(id) {
      const data = await call("GET", `/pots?current_account_id=${enc(id)}`);
      return data?.pots ?? [];
    },
    deposit: (potId, source, amount, dedupe) =>
      call(
        "PUT",
        `/pots/${enc(potId)}/deposit`,
        new URLSearchParams({ source_account_id: source, amount: String(amount), dedupe_id: dedupe }),
      ),
    logout: () => call("POST", "/logout"),
  };
}
