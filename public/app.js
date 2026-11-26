// @ts-check
import {
  ApiError,
  describeError,
  fillPots,
  formatGBP,
  isAuthError,
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
const THEME_KEY = "pf.theme";

/** @returns {Set<string>} */
function loadExcluded() {
  try {
    const v = JSON.parse(local.get(EXCLUDED_KEY) || "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveExcluded() {
  local.set(EXCLUDED_KEY, JSON.stringify([...S.excluded]));
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
  /** Practice (dry run) is on until the first real fill on this phone (live only). */
  dryRun: MOCK ? false : local.get(LIVE_FILL_DONE_KEY) !== "1",
  excluded: loadExcluded(),
  /** @type {Record<Kind, Group | null>} */
  groups: { personal: null, joint: null },
  /** @type {Record<Kind, Run | null>} */
  runs: { personal: null, joint: null },
  refreshing: false,
  /** When balances were last read from Monzo (ms). */
  loadedAt: 0,
  /** Full pots are tucked away unless opened. @type {Record<Kind, boolean>} */
  showFull: { personal: false, joint: false },
  /** Real deposits made this session, for the "Payday done" close. */
  filledThisSession: { amount: 0, pots: 0 },
  copied: false,
  light: document.documentElement.getAttribute("data-theme") === "light",
};

const busy = () => Boolean(S.runs.personal?.running || S.runs.joint?.running);

/** Announce to screen readers through one small status region, not the whole page. @param {string} text */
function announce(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

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
    S.loadedAt = Date.now();
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
  signOutLocal("Signed out. Monzo has cancelled this app's access until you connect again.");
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
    const ok = await confirmFill(kind, toFill.map((r) => ({ name: r.pot.name, amount: r.shortfall })), total, switchedOff(group));
    if (!ok) return;
  }

  /** @type {Run} */
  const run = { results: [], dryRun, running: true, stopped: "" };
  S.runs[kind] = run;
  announce(dryRun ? "Checking pots…" : "Filling pots…");
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
  const head = resultsHeadline(run);
  announce([head.text, head.problem].filter(Boolean).join(" "));

  if (!dryRun && results.some((r) => r.outcome === "filled")) local.set(LIVE_FILL_DONE_KEY, "1");
  if (isAuthError(stoppedBy)) {
    signOutLocal("Your Monzo session ended during the fill. Connect again and run it again: it only fills what's still short.");
    render();
    return;
  }
  render();
  if (!dryRun) {
    for (const r of results) {
      if (r.outcome === "filled") {
        S.filledThisSession.amount += r.amount;
        S.filledThisSession.pots += 1;
      }
    }
    await load();
    // Personal done and joint still short: bring the next step into view.
    const joint = S.groups.joint;
    if (kind === "personal" && !stoppedBy && joint && summarise(joint.pots, S.excluded).total > 0) {
      document.getElementById("joint")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  }
}

/** Pots switched off that would otherwise need money. @param {Group} group */
function switchedOff(group) {
  return summarise(group.pots, S.excluded).rows.filter((r) => r.excluded && r.shortfall > 0).map((r) => r.pot);
}

/** @param {boolean} light */
function setTheme(light) {
  S.light = light;
  local.set(THEME_KEY, light ? "light" : "dark");
  if (light) document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f0f4f2" : "#0b0e0c");
  render();
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

// Drawn stroke icons (24px grid, 2px stroke, round caps), one family throughout.
const ICONS = {
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5v.01"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  dash: '<path d="M7 12h10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  shield: '<path d="M12 3.5l7 3v5.5c0 4.2-3 7.6-7 8.5-4-.9-7-4.3-7-8.5V6.5z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  transfer: '<path d="M4 8h14"/><path d="M14 4l4 4-4 4"/><path d="M20 16H6"/><path d="M10 12l-4 4 4 4"/>',
};

/** @param {keyof typeof ICONS} name @param {string} [cls] */
function icon(name, cls = "icon") {
  const span = document.createElement("span");
  span.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return /** @type {Element} */ (span.firstElementChild);
}

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
  root.replaceChildren(...view.flat(Infinity).filter(Boolean));
  if (focusKey) /** @type {HTMLElement | null} */ (root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`))?.focus();
}

function header() {
  return h("header", { class: "app-header" },
    h("img", { class: "logo", src: "/icon.svg", alt: "" }),
    h("span", { class: "wordmark" }, "Pot Filler"),
    S.screen === "main" &&
      h("button", {
        class: "btn-icon btn-quiet",
        "aria-label": S.refreshing ? "Refreshing" : "Refresh balances",
        "data-key": "refresh-all",
        disabled: busy() || S.refreshing,
        onclick: load,
      }, icon("refresh")),
    !MOCK && (S.screen === "main" || S.screen === "approve") &&
      h("button", { class: "btn-sm btn-quiet", onclick: signOut, disabled: busy() }, "Sign out"),
  );
}

function appearance() {
  return h("section", { class: "appearance", "aria-label": "Appearance" },
    h("div", { class: "group-label" }, h("span", null, "Appearance")),
    h("div", { class: "card appearance-card" },
      h("div", { class: "segmented" },
        h("button", { "aria-pressed": String(!S.light), "data-key": "theme-dark", onclick: () => setTheme(false) }, "Dark"),
        h("button", { "aria-pressed": String(S.light), "data-key": "theme-light", onclick: () => setTheme(true) }, "Light"),
      ),
    ),
    h("p", { class: "group-footer" }, "Just for this phone."),
  );
}

function viewSignIn() {
  return [
    h("section", { class: "welcome" },
      h("img", { class: "logo", src: "/icon.svg", alt: "" }),
      h("h1", null, "Pot Filler"),
      h("p", null, "Tops every bill pot up to its goal on payday, for your account and the joint one. It only ever adds money to pots."),
    ),
    S.notice && h("p", { class: "card note small", style: { marginBottom: "14px" } }, S.notice),
    h("div", { class: "stack" },
      h("a", { class: "btn btn-primary btn-big", href: "/login" }, "Connect Monzo"),
      h("p", { class: "group-footer" },
        "You'll sign in with Monzo, then approve the connection in the Monzo app. The access is kept only in this tab and is gone when you close it."),
      h("a", { class: "btn btn-quiet", href: "/?mock=1" }, "Try it with mock data"),
    ),
    appearance(),
  ];
}

function viewApprove() {
  return [
    header(),
    h("h1", { class: "page-title" }, "Approve in the Monzo app"),
    h("div", { class: "card stack" },
      h("ol", { class: "steps" },
        h("li", null, "Open the notification from Monzo on this phone."),
        h("li", null, "Approve access for Pot Filler with your PIN or fingerprint."),
        h("li", null, "Come back here and tap Continue."),
      ),
      S.notice && h("p", { class: "note warn" }, icon("alert"), h("span", null, S.notice)),
      h("button", {
        class: "btn-primary btn-big",
        "data-key": "continue",
        disabled: S.checking,
        onclick: () => { S.checking = true; S.notice = ""; load(); },
      }, S.checking ? "Checking…" : "Continue"),
    ),
  ];
}

function viewError() {
  return [
    header(),
    h("h1", { class: "page-title" }, "Couldn't load your pots"),
    h("div", { class: "card stack" },
      h("p", { class: "muted" }, S.error),
      h("button", { class: "btn-primary btn-big", onclick: load }, "Try again"),
    ),
  ];
}

function viewLoading() {
  return [header(), h("div", { class: "skeleton" }), h("div", { class: "skeleton tall" }), h("div", { class: "skeleton tall" })];
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

  const allFull = (ps?.total ?? 0) === 0 && (js?.total ?? 0) === 0;
  return [
    header(),
    allFull && S.filledThisSession.pots > 0 ? paydayDone() : modeControl(),
    S.error && h("p", { class: "card note bad", style: { marginBottom: "18px" } }, icon("alert"), h("span", null, S.error)),
    p ? groupView("personal", p) : h("p", { class: "card muted" }, "No personal account found."),
    j ? groupView("joint", j, plan) : h("p", { class: "card muted", style: { marginTop: "30px" } }, "No joint account found."),
    appearance(),
  ];
}

/** @param {number} at */
function freshness(at) {
  const mins = Math.floor((Date.now() - at) / 60_000);
  const time = new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const ago = mins < 1 ? "just now" : mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  const stale = mins >= 10;
  return h("p", { class: `freshness${stale ? " stale" : ""}` },
    icon(stale ? "clock" : "check", "icon icon-sm"),
    h("span", null, `Balances from ${time} · ${ago}`, stale ? ". Refresh before filling." : ""),
  );
}

function paydayDone() {
  const { amount, pots } = S.filledThisSession;
  const off = (["personal", "joint"]).flatMap((k) => { const g = S.groups[/** @type {Kind} */ (k)]; return g ? switchedOff(g) : []; });
  return h("section", { class: "card payday-done", "aria-label": "Payday done" },
    h("span", { class: "tick" }, icon("check")),
    h("h1", null, "Payday done"),
    h("p", null, h("span", { class: "num positive" }, formatGBP(amount)), ` into ${pots} pot${pots === 1 ? "" : "s"}. `,
      off.length
        ? `Every pot you selected is at its goal. Still switched off: ${off.map((p) => p.name).join(", ")}.`
        : "Every bill pot is at its goal, so the bills are covered for the month."),
    S.loadedAt > 0 && freshness(S.loadedAt),
  );
}

function modeControl() {
  /** @param {boolean} dry */
  const set = (dry) => { S.dryRun = dry; render(); };
  return h("section", { class: "mode", "aria-label": "Mode" },
    h("div", { class: "segmented", role: "group", "aria-label": "Practice or live" },
      h("button", { "aria-pressed": String(S.dryRun), "data-key": "mode-practice", disabled: busy(), onclick: () => set(true) }, "Practice"),
      h("button", { class: "seg-live", "aria-pressed": String(!S.dryRun), "data-key": "mode-live", disabled: busy(), onclick: () => set(false) }, "Live"),
    ),
    S.dryRun
      ? h("p", { class: "mode-note" }, "Practice shows exactly what would go into each pot. Nothing moves.")
      : h("p", { class: "mode-note live" }, icon("shield", "icon icon-sm"),
          MOCK ? "Live: fills move mock money between made-up pots." : "Live: fills move real money. You'll confirm first."),
    S.loadedAt > 0 && freshness(S.loadedAt),
  );
}

/**
 * The last finished live run left pots it couldn't fill, and those are all that's still short.
 * @param {Run | null} run @param {{ pot: Pot }[]} toFill
 */
function stuckPots(run, toFill) {
  if (!run || run.running || run.dryRun) return [];
  const failed = run.results.filter((r) => r.outcome === "failed");
  if (!failed.length || !toFill.length) return [];
  const ids = new Set(failed.map((r) => r.potId));
  return toFill.every((r) => ids.has(r.pot.id)) ? failed : [];
}

/** @param {Result} r */
function fixFor(r) {
  if (r.code && /locked/.test(r.code)) return "Unlock it in the Monzo app, then tap Refresh.";
  return "Check it in the Monzo app, then try again.";
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
  const blocked = Boolean(kind === "joint" && plan && !plan.jointCovered);
  const stuck = stuckPots(run, toFill);
  const off = switchedOff(group);
  const justFilled = run && !run.dryRun && !run.running && run.results.some((r) => r.outcome === "filled");

  /** @type {any[]} */
  const body = [];

  if (total === 0) {
    body.push(h("div", { class: "all-full" },
      h("span", { class: "tick" }, icon("check")),
      h("span", null,
        rows.length === 0 ? `No ${kind} pots have a goal yet.`
        : justFilled ? `All ${kind} pots are full. Nicely done.`
        : `All ${kind} pots are full.`),
    ));
    const jointShort = kind === "personal" && S.groups.joint ? summarise(S.groups.joint.pots, S.excluded).total : 0;
    if (jointShort > 0) {
      body.push(h("button", {
        class: "btn-sm next-step",
        "data-key": "next-joint",
        onclick: () => document.getElementById("joint")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      }, "Next: joint pots (", money(jointShort), ")", icon("arrow", "icon icon-sm")));
    }
  } else if (stuck.length) {
    body.push(
      h("div", null,
        h("div", { class: "big-number owed" }, formatGBP(total)),
        h("div", { class: "figure-caption" }, `couldn't be added to ${stuck.length === 1 ? "1 pot" : `${stuck.length} pots`}`),
      ),
      h("div", { class: "problem" },
        stuck.map((r) => h("div", { class: "problem-item" },
          h("h3", null, icon("alert", "icon icon-sm"), r.name),
          h("p", null, r.message, ". ", fixFor(r)),
        )),
      ),
    );
  } else {
    body.push(h("div", null,
      h("div", { class: "big-number owed" }, formatGBP(total)),
      h("div", { class: "figure-caption" }, `to fill across ${toFill.length} pot${toFill.length === 1 ? "" : "s"}`),
    ));
  }

  if (off.length) {
    body.push(h("p", { class: "switched-off" },
      h("span", null, `${off.length === 1 ? "1 pot" : `${off.length} pots`} switched off: ${off.map((p) => p.name).join(", ")}.`),
      h("button", {
        class: "btn-link",
        "data-key": `on-${kind}`,
        disabled: busy(),
        onclick: () => { for (const p of off) S.excluded.delete(p.id); saveExcluded(); render(); },
      }, off.length === 1 ? "Turn it back on" : "Turn them back on"),
    ));
  }

  const move = kind === "joint" && plan && total > 0 && !stuck.length ? moveCard(plan, group.balance, total) : null;

  if (total > 0) {
    const label = S.dryRun ? "Practise filling" : "Fill";
    // A pot that needs changing in Monzo first gets a fresh read before the retry.
    const needsMonzo = stuck.some((r) => r.code && /locked/.test(r.code));
    body.push(h("button", {
      class: stuck.length ? "btn-big" : "btn-primary btn-big",
      "data-key": `fill-${kind}`,
      disabled: busy() || S.refreshing || blocked,
      onclick: async () => {
        if (needsMonzo) await load();
        runFill(kind);
      },
    }, run?.running
      ? h("span", null, progressText(run))
      : stuck.length
        ? h("span", null, needsMonzo ? "Refresh and try again (" : "Try again (", money(total), ")")
        : h("span", null, `${label} ${kind} pots (`, money(total), ")")));
  }

  if (run) body.push(resultsView(kind, run, stuck.length > 0));

  return h("section", { class: "group", id: kind, "aria-labelledby": `h-${kind}` },
    h("div", { class: "group-label" },
      h("h2", { id: `h-${kind}` }, title),
      h("span", null, h("b", null, money(group.balance)), " available"),
    ),
    move,
    h("div", { class: "card summary" }, body),
    potList(kind, title, rows),
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
    h("p", { class: "note warn" }, icon("alert"),
      h("span", null,
        "Your account has ", money(personalBalance), ", which isn't enough for your pots (", money(personalTotal),
        ") and this transfer. It's ", money(plan.personalShortBy), " short."));

  if (plan.jointCovered) {
    return h("div", { class: "card notice" },
      warning,
      h("p", { class: "note ok" }, icon("check"), h("span", null, "There's enough in joint to fill these pots.")));
  }
  return h("div", { class: "card notice" },
    h("h3", null, "Move ", h("span", { class: "owed" }, money(plan.moveToJoint)), " to joint first"),
    h("p", null,
      "Joint has ", h("b", null, money(jointBalance)), " and its pots need ", h("b", null, money(jointTotal)),
      ". Transfer the difference from your account to joint in the Monzo app, then tap Refresh."),
    warning && h("div", { style: { marginTop: "10px" } }, warning),
    h("div", { class: "btn-row" },
      h("button", {
        class: "btn-sm",
        "data-key": "copy",
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(plainAmount(plan.moveToJoint));
            S.copied = true;
            announce("Amount copied");
            render();
            setTimeout(() => { S.copied = false; render(); }, 1500);
          } catch { /* clipboard blocked */ }
        },
      }, icon(S.copied ? "check" : "copy", "icon icon-sm"), S.copied ? "Copied" : "Copy amount"),
      h("button", { class: "btn-sm", "data-key": "refresh-joint", disabled: S.refreshing || busy(), onclick: load },
        icon("refresh", "icon icon-sm"), S.refreshing ? "Refreshing…" : "Refresh"),
      mock && h("button", {
        class: "btn-sm",
        "data-key": "simulate",
        disabled: S.refreshing || busy(),
        onclick: () => { mock.simulateTransferToJoint(plan.moveToJoint); load(); },
      }, icon("transfer", "icon icon-sm"), "Mock: make transfer"),
    ),
  );
}

/**
 * Pots still short (and switched-off ones) are listed; full pots fold into one row.
 * @param {Kind} kind @param {string} title @param {{ pot: Pot, shortfall: number, excluded: boolean }[]} rows
 */
function potList(kind, title, rows) {
  if (!rows.length) return null;
  const open = rows.filter((r) => r.shortfall > 0);
  const full = rows.filter((r) => r.shortfall === 0);
  const showFull = S.showFull[kind];
  const toggle = full.length > 0 && h("li", { class: "full-toggle" },
    h("button", {
      class: "full-toggle-btn",
      "aria-expanded": String(showFull),
      "data-key": `full-${kind}`,
      onclick: () => { S.showFull[kind] = !showFull; render(); },
    },
      h("span", { class: "tick" }, icon("check", "icon icon-sm")),
      h("span", { class: "grow" }, `${full.length} pot${full.length === 1 ? "" : "s"} already full`),
      h("span", { class: `chevron${showFull ? " open" : ""}` }, icon("arrow", "icon icon-sm")),
    ));
  return h("ul", { class: "list", "aria-label": `${title} pots` },
    open.map((r) => potRow(r)),
    toggle,
    showFull && full.map((r) => potRow(r)),
  );
}

/** @param {{ pot: Pot, shortfall: number, excluded: boolean }} r */
function potRow({ pot, shortfall, excluded }) {
  const goal = /** @type {number} */ (pot.goal_amount);
  const pct = Math.max(0, Math.min(100, (pot.balance / goal) * 100));
  const full = shortfall === 0;
  return h("li", { class: `pot${excluded ? " off" : ""}` },
    h("div", null,
      h("div", { class: "row-title" },
        h("span", null, pot.name),
        pot.locked && h("span", { class: "chip chip-warn" }, icon("lock", "icon"), "Locked"),
      ),
      h("div", { class: "row-sub num" }, `${formatGBP(pot.balance)} of ${formatGBP(goal)}`),
      h("div", { class: "bar", "aria-hidden": "true" }, h("span", { style: { width: `${pct}%` } })),
    ),
    full
      ? h("div", { class: "pot-amount full" }, icon("check", "icon icon-sm"), "Full")
      : h("div", { class: `pot-amount num${excluded ? "" : " owed"}` },
          formatGBP(shortfall), h("small", null, excluded ? "off" : "to go")),
    full ? h("span", { "aria-hidden": "true" }) : h("button", {
      class: "switch",
      role: "switch",
      "aria-checked": String(!excluded),
      "aria-label": `Include ${pot.name}`,
      "data-key": `pot-${pot.id}`,
      disabled: busy(),
      onclick: () => {
        if (excluded) S.excluded.delete(pot.id); else S.excluded.add(pot.id);
        saveExcluded();
        render();
      },
    }),
  );
}

/** @param {Run} run */
function progressText(run) {
  const done = run.results.filter((r) => r.outcome !== "not_attempted").length;
  return `${run.dryRun ? "Checking" : "Filling"} ${Math.min(done + 1, run.results.length)} of ${run.results.length}…`;
}

/** @param {Run} run @returns {{ text: string, tone: "" | "ok" | "bad", problem?: string }} */
function resultsHeadline(run) {
  const filled = run.results.filter((r) => r.outcome === "filled" || r.outcome === "would_fill");
  const sum = filled.reduce((s, r) => s + r.amount, 0);
  const failed = run.results.filter((r) => r.outcome === "failed").length;
  const pots = (/** @type {number} */ n) => `${n} pot${n === 1 ? "" : "s"}`;
  if (run.running) return { text: progressText(run), tone: "" };
  if (run.dryRun) {
    return { text: `Practice: would put ${formatGBP(sum)} into ${pots(filled.length)}${failed ? `, ${failed} couldn't` : ""}`, tone: failed ? "bad" : "" };
  }
  if (failed || run.stopped) {
    return {
      text: `Filled ${pots(filled.length)}, ${formatGBP(sum)}.`,
      tone: filled.length ? "ok" : "bad",
      problem: failed ? `${failed} didn't go through.` : "Stopped early.",
    };
  }
  return { text: `Filled ${pots(filled.length)}, ${formatGBP(sum)}`, tone: "ok" };
}

/** @param {Kind} kind @param {Run} run @param {boolean} failuresShownAbove */
function resultsView(kind, run, failuresShownAbove) {
  const head = resultsHeadline(run);
  // Problems first once the run is over; while it runs, keep the running order.
  // When the summary above already names the failed pots, don't repeat them here.
  const order = { failed: 0, filled: 1, would_fill: 1, skipped: 2, not_attempted: 3 };
  const rows = run.running
    ? run.results
    : [...run.results]
        .filter((r) => !(failuresShownAbove && r.outcome === "failed"))
        .sort((a, b) => order[a.outcome] - order[b.outcome]);
  return h("div", { class: "results" },
    h("div", { class: `results-head ${head.tone}` },
      h("h3", null,
        head.tone === "ok" && icon("check", "icon icon-sm"),
        head.tone === "bad" && icon("alert", "icon icon-sm"),
        h("span", null, head.text, head.problem && [" ", h("span", { class: "head-problem" }, head.problem)]),
      ),
      !run.running && h("button", {
        class: "btn-sm btn-quiet",
        "data-key": `clear-${kind}`,
        onclick: () => { S.runs[kind] = null; render(); },
      }, "Clear"),
    ),
    run.stopped && h("p", { class: "note bad", style: { margin: "4px 0 8px" } }, h("span", null, `Stopped: ${run.stopped}`)),
    h("ul", null, rows.map(resultRow)),
  );
}

/** @type {Record<Result["outcome"], keyof typeof ICONS>} */
const RESULT_ICON = { filled: "check", would_fill: "arrow", skipped: "dash", failed: "alert", not_attempted: "clock" };

/** @param {Result} r */
function resultRow(r) {
  const label = {
    filled: "",
    would_fill: "",
    skipped: r.message,
    failed: r.message,
    not_attempted: r.message ? "Not tried: stopped after an earlier problem" : "Waiting",
  }[r.outcome];
  const showAmount = r.outcome === "filled" || r.outcome === "would_fill";
  return h("li", { class: `result ${r.outcome}` },
    icon(RESULT_ICON[r.outcome]),
    h("span", null, h("span", { class: "name" }, r.name), label && h("span", { class: "msg" }, label)),
    h("span", { class: "amt num" }, showAmount ? formatGBP(r.amount) : ""),
  );
}

// ---------------------------------------------------------------- confirm sheet

/**
 * @param {Kind} kind
 * @param {{ name: string, amount: number }[]} items
 * @param {number} total
 * @param {Pot[]} off pots switched off that are still short
 * @returns {Promise<boolean>}
 */
function confirmFill(kind, items, total, off) {
  return new Promise((resolve) => {
    const from = kind === "personal" ? "your account" : "the joint account";
    /** @param {boolean} v */
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    const dlg = /** @type {HTMLDialogElement} */ (h("dialog", { "aria-labelledby": "sheet-title" },
      h("div", { class: "sheet" },
        h("div", { class: "grabber", "aria-hidden": "true" }),
        h("h2", { id: "sheet-title" }, `Fill ${items.length} ${kind} pot${items.length === 1 ? "" : "s"}?`),
        h("p", { class: "lede" }, "This moves ", money(total), ` from ${from}. Each pot is checked again just before its money goes in.`),
        h("ul", { class: "sheet-list" },
          items.map((i) => h("li", null, h("span", null, i.name), money(i.amount)))),
        h("div", { class: "sheet-total" }, h("span", null, "Total"), money(total)),
        off.length > 0 && h("p", { class: "note warn" }, icon("alert"),
          h("span", null, `Not filling ${off.map((p) => p.name).join(", ")}: switched off.`)),
        h("div", { class: "sheet-actions" },
          h("button", { class: "btn-primary btn-big", onclick: () => close(true) }, h("span", null, "Fill ", money(total))),
          h("button", { class: "btn-quiet", onclick: () => close(false) }, "Cancel"),
        ),
      ),
    ));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(false); });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) close(false); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

// ---------------------------------------------------------------- boot

setInterval(() => { if (S.screen === "main" && !busy() && !document.querySelector("dialog[open]")) render(); }, 30_000);

if (MOCK) {
  document.getElementById("app")?.before(h("div", { class: "mock-banner" }, "Mock data · nothing is real"));
  load();
} else if (loadSession()) {
  S.screen = session.get("pf.approved") ? "loading" : "approve";
  load();
} else {
  signOutLocal();
  render();
}
