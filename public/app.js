// @ts-check
import {
  ApiError,
  describeError,
  isAuthError,
  fillPots,
  formatGBP,
  jointPlan,
  plainAmount,
  summarise,
  visiblePots,
} from "./logic.js";
import { liveApi } from "./api.js";
import { mockApi } from "./mock.js";

/** @typedef {import("./logic.js").Pot} Pot */
/** @typedef {import("./logic.js").Account} Account */
/** @typedef {import("./logic.js").Result} Result */
/** @typedef {"personal" | "joint"} Kind */
/** @typedef {{ account: Account, balance: number, pots: Pot[] }} Group */
/** @typedef {{ results: Result[], dryRun: boolean, running: boolean, stopped: string }} Run */

// ---------------------------------------------------------------- storage (all optional)

const local = {
  /** @param {string} k */
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  /** @param {string} k @param {string} v */
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const session = {
  /** @param {string} k */
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  /** @param {string} k @param {string} v */
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  /** @param {string} k */
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

const EXCLUDED_KEY = "pf.excluded.v1";
const LIVE_FILL_DONE_KEY = "pf.liveFillDone";

/** @returns {Set<string>} */
function loadExcluded() {
  try {
    const v = JSON.parse(local.get(EXCLUDED_KEY) || "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** @returns {{ token: string, expiresAt: number } | null} */
function loadSession() {
  try {
    const s = JSON.parse(session.get("pf.session") || "null");
    if (!s || typeof s.token !== "string") return null;
    if (typeof s.expiresAt === "number" && s.expiresAt < Date.now() + 60_000) {
      session.del("pf.session");
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- state

const params = new URLSearchParams(location.search);
const MOCK = params.has("mock") && params.get("mock") !== "0";
const mock = MOCK ? mockApi() : null;
const api = mock ?? liveApi(() => loadSession()?.token ?? null);

const S = {
  /** @type {"signin" | "approve" | "loading" | "main" | "error"} */
  screen: "loading",
  notice: "",
  error: "",
  checking: false,
  /** Dry run is on until the first real fill on this device (live only). */
  dryRun: MOCK ? false : local.get(LIVE_FILL_DONE_KEY) !== "1",
  excluded: loadExcluded(),
  /** @type {Record<Kind, Group | null>} */
  groups: { personal: null, joint: null },
  /** @type {Record<Kind, Run | null>} */
  runs: { personal: null, joint: null },
  refreshing: false,
  copied: false,
};

const busy = () => Boolean(S.runs.personal?.running || S.runs.joint?.running);

// ---------------------------------------------------------------- data

/** @param {Kind} kind */
async function loadGroup(kind) {
  const accounts = await api.accounts(kind === "personal" ? "uk_retail" : "uk_retail_joint");
  const account = accounts[0];
  if (!account) return null;
  const [bal, pots] = await Promise.all([api.balance(account.id), api.pots(account.id)]);
  return { account, balance: bal.balance, pots: visiblePots(pots) };
}

async function load() {
  if (S.screen !== "approve" && !S.groups.personal && !S.groups.joint) S.screen = "loading";
  S.refreshing = true;
  render();
  try {
    const personal = await loadGroup("personal");
    const joint = await loadGroup("joint");
    S.groups = { personal, joint };
    session.set("pf.approved", "1");
    S.screen = "main";
    S.error = "";
  } catch (err) {
    handleLoadError(err);
  } finally {
    S.refreshing = false;
    S.checking = false;
    render();
  }
}

/** @param {unknown} err */
function handleLoadError(err) {
  if (isAuthError(err)) {
    signOutLocal("Your Monzo session has ended. Connect again to carry on.");
  } else if (err instanceof ApiError && err.status === 403 && !err.code.startsWith("proxy.")) {
    if (S.checking) S.notice = "Not approved yet. Check the Monzo app, then tap Continue.";
    S.screen = "approve";
  } else {
    S.error = describeError(err);
    S.screen = S.groups.personal || S.groups.joint ? "main" : "error";
  }
}

/** @param {string} [notice] */
function signOutLocal(notice = "") {
  session.del("pf.session");
  session.del("pf.approved");
  S.groups = { personal: null, joint: null };
  S.runs = { personal: null, joint: null };
  S.notice = notice;
  S.screen = "signin";
}

async function signOut() {
  if (!MOCK) await api.logout().catch(() => {});
  signOutLocal("Signed out. The access token has been revoked.");
  render();
}

/** @param {Kind} kind */
async function runFill(kind) {
  const group = S.groups[kind];
  if (!group || busy()) return;
  const { toFill, total } = summarise(group.pots, S.excluded);
  if (!toFill.length) return;
  const dryRun = S.dryRun;
  if (!dryRun) {
    const ok = await confirmFill(kind, toFill.map((r) => ({ name: r.pot.name, amount: r.shortfall })), total);
    if (!ok) return;
  }

  /** @type {Run} */
  const run = { results: [], dryRun, running: true, stopped: "" };
  S.runs[kind] = run;
  render();
  const { results, stoppedBy } = await fillPots({
    api,
    accountId: group.account.id,
    pots: toFill.map((r) => ({ id: r.pot.id, name: r.pot.name })),
    dryRun,
    onProgress(partial) {
      run.results = partial;
      render();
    },
  });
  run.results = results;
  run.running = false;
  run.stopped = stoppedBy ? describeError(stoppedBy) : "";

  if (!dryRun && results.some((r) => r.outcome === "filled")) local.set(LIVE_FILL_DONE_KEY, "1");
  if (isAuthError(stoppedBy)) {
    signOutLocal("Your Monzo session ended during the fill. Connect again and run it again: it only fills what's still short.");
    render();
    return;
  }
  render();
  if (!dryRun) await load();
}

// ---------------------------------------------------------------- tiny DOM helper

/**
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") Object.assign(el.style, v);
    else if (k in el && k !== "role") /** @type {any} */ (el)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const money = (/** @type {number} */ p) => h("span", { class: "num" }, formatGBP(p));

// ---------------------------------------------------------------- views

function render() {
  const root = /** @type {HTMLElement} */ (document.getElementById("app"));
  const focusKey = /** @type {HTMLElement | null} */ (document.activeElement)?.dataset?.key;
  const view =
    S.screen === "signin" ? viewSignIn()
    : S.screen === "approve" ? viewApprove()
    : S.screen === "error" ? viewError()
    : S.screen === "loading" ? viewLoading()
    : viewMain();
  root.replaceChildren(...view);
  if (focusKey) /** @type {HTMLElement | null} */ (root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`))?.focus();
}

function topbar() {
  return h(
    "header",
    { class: "topbar" },
    h("h1", null, "Pot Filler"),
    MOCK && h("span", { class: "tag mock" }, "Mock data"),
    S.screen === "main" &&
      h("button", { class: "ghost", onclick: load, disabled: busy() || S.refreshing, "data-key": "refresh-all" },
        S.refreshing ? "Refreshing…" : "Refresh"),
    !MOCK && (S.screen === "main" || S.screen === "approve") &&
      h("button", { class: "ghost", onclick: signOut, disabled: busy() }, "Sign out"),
  );
}

function viewSignIn() {
  return [
    h("section", { class: "hero" },
      h("h1", null, "Pot Filler"),
      h("p", null, "Tops every bill pot up to its goal, for your personal and joint accounts. It only ever adds money to pots."),
    ),
    S.notice && h("p", { class: "card notice muted" }, S.notice),
    h("div", { class: "card stack" },
      h("a", { class: "button primary", href: "/login" }, "Connect Monzo"),
      h("p", { class: "fine" },
        "You'll sign in with Monzo, then approve the connection in the Monzo app. The access token is kept only in this tab and is gone when you close it."),
    ),
    h("p", { class: "fine", style: { textAlign: "center", marginTop: "20px" } },
      h("a", { href: "/?mock=1" }, "Try it with mock data")),
  ];
}

function viewApprove() {
  return [
    topbar(),
    h("div", { class: "card stack" },
      h("h2", null, "Approve in your Monzo app"),
      h("ol", { class: "steps" },
        h("li", null, "Open the notification from Monzo on your phone."),
        h("li", null, "Approve access for Pot Filler with your PIN or fingerprint."),
        h("li", null, "Come back here and tap Continue."),
      ),
      S.notice && h("p", { class: "warning" }, S.notice),
      h("button", {
        class: "primary",
        "data-key": "continue",
        disabled: S.checking,
        onclick: () => { S.checking = true; S.notice = ""; load(); },
      }, S.checking ? "Checking…" : "Continue"),
    ),
  ];
}

function viewError() {
  return [
    topbar(),
    h("div", { class: "card stack" },
      h("h2", null, "Couldn't load your pots"),
      h("p", { class: "muted" }, S.error),
      h("button", { class: "primary", onclick: load }, "Try again"),
    ),
  ];
}

function viewLoading() {
  return [topbar(), h("div", { class: "skeleton" }), h("div", { class: "skeleton" }), h("div", { class: "skeleton" })];
}

function viewMain() {
  const p = S.groups.personal;
  const j = S.groups.joint;
  const ps = p ? summarise(p.pots, S.excluded) : null;
  const js = j ? summarise(j.pots, S.excluded) : null;
  const plan = jointPlan({
    personalTotal: ps?.total ?? 0,
    personalBalance: p?.balance ?? 0,
    jointTotal: js?.total ?? 0,
    jointBalance: j?.balance ?? 0,
  });

  return [
    topbar(),
    modeBar(),
    S.error && h("p", { class: "warning notice" }, S.error),
    p ? groupView("personal", p) : h("p", { class: "card muted notice" }, "No personal account found."),
    j ? groupView("joint", j, plan) : h("p", { class: "card muted notice" }, "No joint account found."),
  ];
}

function modeBar() {
  return h("div", { class: `modebar ${S.dryRun ? "dry" : "live"}` },
    h("div", { class: "text" },
      h("strong", null, S.dryRun ? "Dry run: on" : "Dry run: off"),
      h("span", null, S.dryRun
        ? "Shows exactly what would be deposited. Nothing moves."
        : MOCK ? "Fills move mock money between made-up pots." : "Filling moves real money into your pots."),
    ),
    toggle({
      checked: S.dryRun,
      label: "Dry run",
      key: "dryrun",
      disabled: busy(),
      onchange: (/** @type {boolean} */ on) => { S.dryRun = on; render(); },
    }),
  );
}

/**
 * @param {{ checked: boolean, label: string, key: string, disabled?: boolean, onchange: (on: boolean) => void }} o
 */
function toggle(o) {
  return h("label", { class: "switch" },
    h("input", {
      type: "checkbox",
      role: "switch",
      checked: o.checked,
      disabled: o.disabled,
      "aria-label": o.label,
      "data-key": o.key,
      onchange: (/** @type {Event} */ e) => o.onchange(/** @type {HTMLInputElement} */ (e.target).checked),
    }),
    h("span", { class: "track", "aria-hidden": "true" }),
  );
}

/**
 * @param {Kind} kind
 * @param {Group} group
 * @param {ReturnType<typeof jointPlan>} [plan]
 */
function groupView(kind, group, plan) {
  const { rows, toFill, total } = summarise(group.pots, S.excluded);
  const title = kind === "personal" ? "Personal" : "Joint";
  const run = S.runs[kind];
  const blocked = kind === "joint" && plan && !plan.jointCovered;
  const verb = S.dryRun ? "Dry run" : "Fill";

  const action = total === 0
    ? h("p", { class: "ok-note" }, rows.length ? `All selected ${kind} pots are full.` : `No ${kind} pots have a goal.`)
    : h("button", {
        class: "primary",
        "data-key": `fill-${kind}`,
        disabled: busy() || S.refreshing || blocked,
        onclick: () => runFill(kind),
      },
      run?.running ? "Working…" : h("span", null, `${verb} ${kind} pots (`, money(total), ")"));

  return h("section", { class: "group", "aria-labelledby": `h-${kind}` },
    h("div", { class: "group-head" },
      h("h2", { id: `h-${kind}` }, title),
      h("span", { class: "avail" }, "Available ", h("b", null, money(group.balance))),
    ),
    h("div", { class: "card summary" },
      h("div", null,
        h("div", { class: "figure num" }, formatGBP(total)),
        h("div", { class: "caption" },
          total === 0 ? "Nothing to fill" : `short across ${toFill.length} pot${toFill.length === 1 ? "" : "s"}`),
      ),
      kind === "joint" && plan && total > 0 && moveCard(plan, group.balance, total),
      action,
      run && resultsView(kind, run),
    ),
    rows.length > 0 && h("ul", { class: "pots", "aria-label": `${title} pots` }, rows.map((r) => potRow(r))),
  );
}

/**
 * @param {ReturnType<typeof jointPlan>} plan
 * @param {number} jointBalance
 * @param {number} jointTotal
 */
function moveCard(plan, jointBalance, jointTotal) {
  const personalBalance = S.groups.personal?.balance ?? 0;
  const personalTotal = S.groups.personal ? summarise(S.groups.personal.pots, S.excluded).total : 0;
  const warning = plan.personalShortBy > 0 &&
    h("p", { class: "warning" },
      "Your personal balance (", money(personalBalance), ") can't cover both the personal pots (",
      money(personalTotal), ") and this transfer. You're ", money(plan.personalShortBy), " short.");

  if (plan.jointCovered) {
    return [warning, h("p", { class: "ok-note" }, "The joint balance covers the joint pots.")];
  }
  return h("div", { class: "move" },
    h("h3", null, "Move ", money(plan.moveToJoint), " to joint first"),
    h("p", null,
      "Joint has ", money(jointBalance), " and the selected joint pots need ", money(jointTotal),
      ". Transfer ", money(plan.moveToJoint), " from Personal to Joint in the Monzo app, then tap Refresh."),
    warning && h("div", { style: { marginTop: "10px" } }, warning),
    h("div", { class: "row-buttons" },
      h("button", {
        class: "secondary small",
        "data-key": "copy",
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(plainAmount(plan.moveToJoint));
            S.copied = true;
            render();
            setTimeout(() => { S.copied = false; render(); }, 1500);
          } catch { /* clipboard blocked */ }
        },
      }, S.copied ? "Copied" : "Copy amount"),
      h("button", { class: "secondary small", "data-key": "refresh-joint", disabled: S.refreshing || busy(), onclick: load },
        S.refreshing ? "Refreshing…" : "Refresh"),
      mock && h("button", {
        class: "secondary small",
        "data-key": "simulate",
        disabled: S.refreshing || busy(),
        onclick: () => { mock.simulateTransferToJoint(plan.moveToJoint); load(); },
      }, "Mock: make transfer"),
    ),
  );
}

/** @param {{ pot: Pot, shortfall: number, excluded: boolean }} r */
function potRow({ pot, shortfall, excluded }) {
  const goal = /** @type {number} */ (pot.goal_amount);
  const pct = Math.max(0, Math.min(100, (pot.balance / goal) * 100));
  const full = shortfall === 0;
  return h("li", { class: `pot${full ? " full" : ""}${excluded ? " excluded" : ""}` },
    h("div", null,
      h("div", { class: "pot-name" }, pot.name, pot.locked && h("span", { class: "lock" }, "Locked")),
      h("div", { class: "pot-meta num" }, `${formatGBP(pot.balance)} of ${formatGBP(goal)}`),
      h("div", { class: "bar", "aria-hidden": "true" }, h("span", { style: { width: `${pct}%` } })),
    ),
    h("div", { class: "pot-short num" },
      full ? ["Full", h("small", null, "no top-up")] : [formatGBP(shortfall), h("small", null, excluded ? "skipped" : "short")]),
    toggle({
      checked: !excluded,
      label: `Include ${pot.name}`,
      key: `pot-${pot.id}`,
      disabled: busy(),
      onchange: (on) => {
        if (on) S.excluded.delete(pot.id); else S.excluded.add(pot.id);
        local.set(EXCLUDED_KEY, JSON.stringify([...S.excluded]));
        render();
      },
    }),
  );
}

/** @param {Kind} kind @param {Run} run */
function resultsView(kind, run) {
  const done = run.results.filter((r) => r.outcome !== "not_attempted" || r.message);
  const filled = run.results.filter((r) => r.outcome === "filled" || r.outcome === "would_fill");
  const sum = filled.reduce((s, r) => s + r.amount, 0);
  const failed = run.results.filter((r) => r.outcome === "failed").length;

  let headline;
  if (run.running) headline = `${run.dryRun ? "Checking" : "Filling"} ${Math.min(done.length + 1, run.results.length)} of ${run.results.length}…`;
  else if (run.dryRun) headline = `Dry run: would fill ${filled.length} pot${filled.length === 1 ? "" : "s"}, ${formatGBP(sum)}`;
  else headline = `Filled ${filled.length} pot${filled.length === 1 ? "" : "s"}, ${formatGBP(sum)}${failed ? `. ${failed} failed` : ""}`;

  return h("div", { class: "results" },
    h("div", { class: "results-head" },
      h("h3", null, headline),
      !run.running && h("button", { class: "ghost", onclick: () => { S.runs[kind] = null; render(); } }, "Clear"),
    ),
    run.stopped && h("p", { class: "warning", style: { marginBottom: "8px" } }, `Stopped: ${run.stopped}`),
    h("ul", null, run.results.map(resultRow)),
  );
}

/** @param {Result} r */
function resultRow(r) {
  const icon = { filled: "✓", would_fill: "→", skipped: "–", failed: "!", not_attempted: "·" }[r.outcome];
  const label = {
    filled: "Filled",
    would_fill: "Would fill",
    skipped: "Skipped",
    failed: "Failed",
    not_attempted: r.message ? "Not tried" : "Waiting",
  }[r.outcome];
  const showAmount = r.outcome === "filled" || r.outcome === "would_fill";
  return h("li", { class: `result ${r.outcome}` },
    h("span", { class: "icon", "aria-hidden": "true" }, icon),
    h("span", null, r.name, h("span", { class: "msg" }, label, r.message && ` · ${r.message}`)),
    h("span", { class: "amt num" }, showAmount ? formatGBP(r.amount) : ""),
  );
}

// ---------------------------------------------------------------- confirm dialog

/**
 * @param {Kind} kind
 * @param {{ name: string, amount: number }[]} items
 * @param {number} total
 * @returns {Promise<boolean>}
 */
function confirmFill(kind, items, total) {
  return new Promise((resolve) => {
    const from = kind === "personal" ? "your personal account" : "the joint account";
    /** @param {boolean} v */
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    const dlg = /** @type {HTMLDialogElement} */ (h("dialog", { "aria-labelledby": "dlg-title" },
      h("div", { class: "dialog-body" },
        h("h2", { id: "dlg-title" }, "Fill ", items.length, ` ${kind} pot${items.length === 1 ? "" : "s"}?`),
        h("p", { class: "muted" }, "This moves ", money(total), ` from ${from} into these pots. Each pot is re-checked just before its deposit.`),
        h("ul", { class: "dialog-list" },
          items.map((i) => h("li", null, h("span", null, i.name), money(i.amount)))),
        h("div", { class: "dialog-total" }, h("span", null, "Total"), money(total)),
        h("div", { class: "row-buttons" },
          h("button", { class: "secondary", onclick: () => close(false) }, "Cancel"),
          h("button", { class: "primary", style: { flex: "2 1 auto" }, onclick: () => close(true) },
            h("span", null, "Fill ", money(total))),
        ),
      ),
    ));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(false); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

// ---------------------------------------------------------------- boot

if (MOCK) {
  load();
} else if (loadSession()) {
  S.screen = session.get("pf.approved") ? "loading" : "approve";
  load();
} else {
  signOutLocal();
  render();
}
