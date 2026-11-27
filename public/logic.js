// @ts-check
// Pure logic: money formatting, shortfalls, the joint plan and the fill engine.
// All amounts are integer pence. Nothing here touches the DOM.

/**
 * @typedef {{ id: string, name: string, balance: number, goal_amount?: number | null,
 *   deleted?: boolean, locked?: boolean }} Pot
 * @typedef {{ id: string, description?: string, type?: string, closed?: boolean }} Account
 * @typedef {{ balance: number, total_balance?: number, currency?: string }} Balance
 * @typedef {{
 *   accounts(type: "uk_retail" | "uk_retail_joint"): Promise<Account[]>,
 *   balance(accountId: string): Promise<Balance>,
 *   pots(accountId: string): Promise<Pot[]>,
 *   deposit(potId: string, sourceAccountId: string, amount: number, dedupeId: string): Promise<Pot>,
 *   whoami(): Promise<unknown>,
 *   logout(): Promise<unknown>,
 * }} Api
 * @typedef {"filled" | "would_fill" | "skipped" | "failed" | "not_attempted"} Outcome
 * @typedef {{ potId: string, name: string, outcome: Outcome, amount: number,
 *   before?: number, after?: number, message: string, code?: string }} Result
 */

export class ApiError extends Error {
  /** @param {number} status @param {string} code @param {string} [message] */
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

/** @param {number} pence */
export function formatGBP(pence) {
  if (!Number.isInteger(pence)) throw new TypeError(`Not whole pence: ${pence}`);
  const sign = pence < 0 ? "−" : "";
  const abs = Math.abs(pence);
  const pounds = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}£${pounds}.${String(abs % 100).padStart(2, "0")}`;
}

/** Plain decimal string for pasting into a transfer amount field, e.g. "12.30". @param {number} pence */
export function plainAmount(pence) {
  return `${Math.floor(pence / 100)}.${String(pence % 100).padStart(2, "0")}`;
}

/** @param {Pot} pot */
export function hasGoal(pot) {
  return typeof pot.goal_amount === "number" && Number.isInteger(pot.goal_amount) && pot.goal_amount > 0;
}

/** Goal − balance, never below 0. @param {Pot} pot */
export function shortfall(pot) {
  if (!hasGoal(pot)) return 0;
  return Math.max(0, /** @type {number} */ (pot.goal_amount) - pot.balance);
}

/** Pots the tool shows: not deleted, with a goal. Sorted by name. @param {Pot[]} pots */
export function visiblePots(pots) {
  return pots
    .filter((p) => !p.deleted && hasGoal(p))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
}

/**
 * @param {Pot[]} pots visible pots
 * @param {Set<string>} excluded
 */
export function summarise(pots, excluded) {
  const rows = pots.map((pot) => ({ pot, shortfall: shortfall(pot), excluded: excluded.has(pot.id) }));
  const toFill = rows.filter((r) => !r.excluded && r.shortfall > 0);
  return {
    rows,
    toFill,
    total: toFill.reduce((sum, r) => sum + r.shortfall, 0),
  };
}

/**
 * What has to happen on the joint side.
 * @param {{ personalTotal: number, personalBalance: number, jointTotal: number, jointBalance: number }} n
 */
export function jointPlan({ personalTotal, personalBalance, jointTotal, jointBalance }) {
  // Pence are already whole, so "rounded up to the next penny" is exact here.
  const moveToJoint = Math.max(0, jointTotal - jointBalance);
  const personalNeeds = personalTotal + moveToJoint;
  return {
    moveToJoint,
    jointCovered: moveToJoint === 0,
    personalNeeds,
    personalShortBy: Math.max(0, personalNeeds - personalBalance),
  };
}

/**
 * dedupe_id = SHA-256 of (pot id, balance just read, amount, day). A retry from the same
 * state on the same day sends the same id, so Monzo can't fill the pot twice. The day is
 * included so that next month, when a pot has drained back to the same balance, the
 * deposit isn't mistaken for a repeat of this month's.
 * @param {string} potId @param {number} balance @param {number} amount @param {string} day YYYY-MM-DD
 */
export async function dedupeId(potId, balance, amount, day) {
  const data = new TextEncoder().encode(`potfiller:v1:${potId}:${balance}:${amount}:${day}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return "pf_" + Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

/** @param {Date} [d] */
export function today(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The token is missing, expired or revoked. Monzo has been seen to answer a bad token
 * with 400 bad_request.invalid_token rather than 401, so check the code too.
 * @param {unknown} err
 */
export function isAuthError(err) {
  return err instanceof ApiError && (err.status === 401 || /(^|\.)(invalid_token|bad_access_token|unauthorized)/.test(err.code));
}

/**
 * Errors that mean "stop everything" rather than "this one pot failed".
 * @param {unknown} err
 */
export function isFatal(err) {
  if (!(err instanceof ApiError)) return true; // network failure, bad JSON, bug
  if (err.code === "insufficient_funds" || isAuthError(err)) return true;
  return err.status === 401 || err.status === 403 || err.status === 429 || err.status >= 500;
}

/** @param {unknown} err */
export function describeError(err) {
  if (err instanceof ApiError) {
    if (err.code === "insufficient_funds") return "Not enough money left in the account";
    if (isAuthError(err)) return "Signed out (token expired). Sign in again.";
    if (err.status === 403) return "Monzo refused (403). Is the connection approved in the Monzo app?";
    if (err.status === 429) return "Monzo rate limit hit. Wait a minute and run again.";
    if (err.status >= 500) return `Monzo is having trouble right now (error ${err.status}). Try again in a few minutes.`;
    if (/locked/.test(err.code)) return "This pot is locked in Monzo, so it won't take deposits from here";
    if (/not_found|pot_not_in_account/.test(err.code)) return "Monzo couldn't find this pot any more";
    if (err.code.startsWith("proxy.amount_over_cap")) return "More than this app is allowed to move into one pot";
    return `Monzo didn't accept this deposit${err.code ? ` (${err.code})` : ""}`;
  }
  return "Couldn't reach Monzo. Check your signal and try again.";
}

/**
 * Fill pots one at a time. For each pot it re-reads the pot list, recalculates the
 * shortfall from the fresh balance and deposits exactly that (if above 0). Stops on the
 * first error that isn't specific to one pot. Never withdraws.
 *
 * @param {{
 *   api: Api,
 *   accountId: string,
 *   pots: { id: string, name: string }[],
 *   dryRun: boolean,
 *   day?: string,
 *   onProgress?: (results: Result[]) => void,
 * }} opts
 * @returns {Promise<{ results: Result[], stoppedBy: unknown }>}
 */
export async function fillPots({ api, accountId, pots, dryRun, day = today(), onProgress }) {
  /** @type {Result[]} */
  const results = pots.map((p) => ({ potId: p.id, name: p.name, outcome: "not_attempted", amount: 0, message: "" }));
  /** @type {unknown} */
  let stoppedBy = null;

  /** @type {number} */
  let available;
  try {
    available = (await api.balance(accountId)).balance;
  } catch (err) {
    for (const r of results) r.message = describeError(err);
    return { results, stoppedBy: err };
  }

  for (const r of results) {
    if (stoppedBy) {
      r.message = "Not tried: stopped after an earlier error";
      continue;
    }
    try {
      const fresh = (await api.pots(accountId)).find((p) => p.id === r.potId);
      if (!fresh || fresh.deleted) {
        Object.assign(r, { outcome: "skipped", message: "Pot no longer exists" });
        continue;
      }
      r.name = fresh.name;
      r.before = fresh.balance;
      if (!hasGoal(fresh)) {
        Object.assign(r, { outcome: "skipped", message: "Pot no longer has a goal" });
        continue;
      }
      const amount = shortfall(fresh);
      if (amount <= 0) {
        Object.assign(r, { outcome: "skipped", message: "Already full", after: fresh.balance });
        continue;
      }
      r.amount = amount;
      if (dryRun) {
        // Practice never stops for money: it shows the whole plan and marks what can't be covered yet.
        const covered = amount <= available;
        const message = fresh.locked
          ? "Locked in Monzo: may be refused"
          : covered ? "" : "Needs money moved in first";
        Object.assign(r, { outcome: "would_fill", after: fresh.balance + amount, message, code: fresh.locked ? "locked" : undefined });
        available -= amount;
        continue;
      }
      if (amount > available) {
        throw new ApiError(0, "insufficient_funds");
      }
      const id = await dedupeId(fresh.id, fresh.balance, amount, day);
      const updated = await api.deposit(fresh.id, accountId, amount, id);
      available -= amount;
      const after = updated && typeof updated.balance === "number" ? updated.balance : fresh.balance + amount;
      Object.assign(r, { outcome: "filled", after, message: "" });
    } catch (err) {
      r.outcome = "failed";
      r.message = describeError(err);
      if (err instanceof ApiError) r.code = err.code;
      if (isFatal(err)) stoppedBy = err;
    } finally {
      onProgress?.(results.map((x) => ({ ...x })));
    }
  }
  return { results, stoppedBy };
}
