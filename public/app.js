// @ts-check
import {
  ApiError,
  describeError,
  fillPots,
  formatGBP,
  isAuthError,
  jointPlan,
  plainAmount,
  suggestCut,
  summarise,
  today,
  visiblePots,
} from "./logic.js";
import { liveApi } from "./api.js";
import { mockApi } from "./mock.js";

/** @typedef {import("./logic.js").Pot} Pot */
/** @typedef {import("./logic.js").Account} Account */
/** @typedef {import("./logic.js").Result} Result */
/** @typedef {"personal" | "joint"} Kind */
/** @typedef {{ account: Account, balance: number, pots: Pot[] }} Group */
/** @typedef {{ results: Result[], dryRun: boolean, running: boolean, stopped: string, pending?: number }} Run */

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
const systemLight = matchMedia("(prefers-color-scheme: light)");

/** @returns {"dark" | "light" | "system"} */
function themeChoice() {
  const v = local.get(THEME_KEY);
  return v === "light" || v === "system" ? v : "dark";
}

/** @returns {Set<string>} */
function loadExcluded() {
  try {
    const v = JSON.parse(local.get(EXCLUDED_KEY) || "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

const LEFT_KEY = "pf.left.v1";
const thisMonth = () => today().slice(0, 7);

/** Pots left out for this month only; forgotten when the month changes. @returns {Set<string>} */
function loadLeft() {
  try {
    const v = JSON.parse(local.get(LEFT_KEY) || "null");
    if (v && v.month === thisMonth() && Array.isArray(v.ids)) return new Set(v.ids.filter((/** @type {unknown} */ x) => typeof x === "string"));
  } catch { /* fall through */ }
  return new Set();
}

/** Saves both kinds and rebuilds the combined set every view reads. */
function saveExcluded() {
  local.set(EXCLUDED_KEY, JSON.stringify([...S.off]));
  local.set(LEFT_KEY, JSON.stringify({ month: thisMonth(), ids: [...S.left] }));
  S.excluded = new Set([...S.off, ...S.left]);
}

/** @param {Iterable<string>} ids */
function leaveForMonth(ids) {
  for (const id of ids) S.left.add(id);
  saveExcluded();
}

/** @param {Iterable<string>} ids */
function turnBackOn(ids) {
  for (const id of ids) { S.off.delete(id); S.left.delete(id); }
  saveExcluded();
}

const RUNS_KEY = "pf.runs.v1";

/** This tab's fill record: what went in this payday, and the last live run per account. */
function loadRecord() {
  try {
    const v = JSON.parse(session.get(RUNS_KEY) || "null");
    if (v && typeof v.amount === "number" && typeof v.pots === "number") return v;
  } catch { /* fall through */ }
  return null;
}

function saveRecord() {
  if (MOCK) return;
  const live = (/** @type {Run | null} */ r) => (r && !r.dryRun && !r.running ? r : null);
  session.set(RUNS_KEY, JSON.stringify({
    amount: S.filledThisSession.amount,
    pots: S.filledThisSession.pots,
    runs: { personal: live(S.runs.personal), joint: live(S.runs.joint) },
  }));
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
const mock = MOCK ? mockApi({ short: params.get("mock") === "short" }) : null;
const api = mock ?? liveApi(() => loadSession()?.token ?? null);

const S = {
  /** @type {"signin" | "approve" | "loading" | "main" | "error"} */
  screen: "loading",
  notice: "",
  error: "",
  checking: false,
  /** Practice (dry run) is on until the first real fill on this phone (live only). */
  dryRun: MOCK ? false : local.get(LIVE_FILL_DONE_KEY) !== "1",
  /** Switched off until turned back on. */
  off: loadExcluded(),
  /** Left out for this month only. */
  left: loadLeft(),
  /** Everything not being filled now: off ∪ left (rebuilt by saveExcluded). @type {Set<string>} */
  excluded: new Set(),
  /** @type {Record<Kind, Group | null>} */
  groups: { personal: null, joint: null },
  /** @type {Record<Kind, Run | null>} */
  runs: { personal: null, joint: null },
  /** After a retry's refresh, the stuck pots that are still locked. @type {Record<Kind, string[]>} */
  stillLocked: { personal: [], joint: [] },
  /** @type {Record<Kind, boolean>} */
  retrying: { personal: false, joint: false },
  copyFailed: false,
  refreshing: false,
  /** When balances were last read from Monzo (ms). */
  loadedAt: 0,
  /** Full pots are tucked away unless opened. @type {Record<Kind, boolean>} */
  showFull: { personal: false, joint: false },
  /** Real deposits made this session, for the "Bills paid" close. */
  filledThisSession: { amount: 0, pots: 0 },
  /** Successful result rows are folded behind "Show N". @type {Record<Kind, boolean>} */
  showResults: { personal: false, joint: false },
  /** "Bills paid" has been brought into view once. */
  paydayShown: false,
  /** The full-screen "Bills paid" was closed with "Go back" (until something else goes in). */
  paydayDismissed: false,
  copied: false,
  /** @type {"dark" | "light" | "system"} */
  theme: themeChoice(),
};

S.excluded = new Set([...S.off, ...S.left]);

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
    // Fresh balances now include what went in, so the figures stop subtracting it themselves.
    for (const k of /** @type {Kind[]} */ (["personal", "joint"])) { const r = S.runs[k]; if (r) r.pending = 0; }
    for (const k of /** @type {Kind[]} */ (["personal", "joint"])) {
      if (S.runs[k]?.dryRun && !S.runs[k]?.running) S.runs[k] = null;
    }
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

  // A live retry keeps what earlier runs this payday already put in.
  const earlier = !dryRun && S.runs[kind] && !S.runs[kind]?.dryRun
    ? /** @type {Run} */ (S.runs[kind]).results.filter((r) => r.outcome === "filled" && !toFill.some((t) => t.pot.id === r.potId))
    : [];
  /** @type {Run} */
  const run = { results: [], dryRun, running: true, stopped: "" };
  S.runs[kind] = run;
  S.stillLocked[kind] = [];
  S.showResults[kind] = false;
  announce(dryRun ? "Checking pots…" : "Filling pots…");
  render();
  const { results, stoppedBy } = await fillPots({
    api,
    accountId: group.account.id,
    pots: toFill.map((r) => ({ id: r.pot.id, name: r.pot.name })),
    dryRun,
    onProgress(partial) {
      run.results = partial;
      run.pending = dryRun ? 0 : partial.reduce((n, r) => n + (r.outcome === "filled" ? r.amount : 0), 0);
      render();
    },
  });
  run.results = [...earlier, ...results];
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
        S.paydayDismissed = false;
      }
    }
    saveRecord();
    await load();
  }
}

/** Pots switched off that would otherwise need money. @param {Group} group */
function switchedOff(group) {
  return summarise(group.pots, S.excluded).rows.filter((r) => r.excluded && r.shortfall > 0).map((r) => r.pot);
}

/** @param {"dark" | "light" | "system"} choice */
function setTheme(choice) {
  S.theme = choice;
  local.set(THEME_KEY, choice);
  applyTheme();
  render();
}

/** Shows the chosen theme; "system" resolves to the phone's own setting. */
function applyTheme() {
  const light = S.theme === "light" || (S.theme === "system" && systemLight.matches);
  if (light) document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f0f4f2" : "#0b0e0c");
}

// Follow the phone live (e.g. its automatic dark mode at sunset) while on "system".
systemLight.addEventListener("change", () => { if (S.theme === "system") applyTheme(); });

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
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" pathLength="1"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5v.01"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  dash: '<path d="M7 12h10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  shield: '<path d="M12 3.5l7 3v5.5c0 4.2-3 7.6-7 8.5-4-.9-7-4.3-7-8.5V6.5z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  transfer: '<path d="M4 8h14"/><path d="M14 4l4 4-4 4"/><path d="M20 16H6"/><path d="M10 12l-4 4 4 4"/>',
};

/** @param {keyof typeof ICONS} name @param {string} [cls] */
function icon(name, cls = "icon") {
  const span = document.createElement("span");
  span.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return /** @type {Element} */ (span.firstElementChild);
}

// ---------------------------------------------------------------- motion

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** @type {Map<string, unknown>} */
const seen = new Map();
/**
 * True when a value differs from what the last render saw under this key
 * (never on first sight), so motion marks real changes, not every rebuild.
 * @param {string} key @param {unknown} value
 */
function changed(key, value) {
  const had = seen.has(key);
  const was = seen.get(key);
  seen.set(key, value);
  return had && was !== value;
}

/** @type {Map<string, { shown: number, from: number, target: number, t0: number, dur: number }>} */
const counters = new Map();
let countFrame = 0;

/**
 * A money figure that counts to its new value instead of jumping. The tween lives here,
 * not in the element, so it carries on across re-renders.
 * @param {string} key @param {number} value
 * @param {{ from?: number, dur?: number, delay?: number }} [opt]
 */
function countSpan(key, value, opt = {}) {
  let c = counters.get(key);
  if (!c) {
    const start = opt.from ?? value;
    c = { shown: start, from: start, target: start, t0: 0, dur: 0 };
    counters.set(key, c);
  }
  if (c.target !== value) {
    if (reduceMotion()) c.shown = c.from = c.target = value;
    else {
      Object.assign(c, { from: c.shown, target: value, t0: performance.now() + (opt.delay ?? 0), dur: opt.dur ?? 450 });
      if (!countFrame) countFrame = requestAnimationFrame(tickCounts);
    }
  }
  return h("span", { "data-count": key }, formatGBP(c.shown));
}

/** @param {number} now */
function tickCounts(now) {
  countFrame = 0;
  let more = false;
  for (const [key, c] of counters) {
    if (c.shown === c.target) continue;
    const t = Math.min(1, Math.max(0, (now - c.t0) / c.dur));
    const eased = 1 - Math.pow(1 - t, 3);
    c.shown = t >= 1 ? c.target : Math.round(c.from + (c.target - c.from) * eased);
    for (const el of document.querySelectorAll(`[data-count="${key}"]`)) el.textContent = formatGBP(c.shown);
    if (c.shown !== c.target) more = true;
  }
  if (more) countFrame = requestAnimationFrame(tickCounts);
}

/**
 * Scroll to an account and briefly ring its first card, so the eye lands on the next job.
 * @param {Kind} kind @param {boolean} [ring] false when something inside already marks the spot
 */
function goTo(kind, ring = true) {
  const section = document.getElementById(kind);
  if (!section) return;
  section.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  const card = ring && section.querySelector(".card");
  if (!card) return;
  card.classList.remove("land");
  void (/** @type {HTMLElement} */ (card)).offsetWidth;
  card.classList.add("land");
}

/** Set by a view when joint has just become fillable; render then brings it into view. */
let jointJustReady = false;

// ---------------------------------------------------------------- views

/**
 * Rebuilds the screen. The control the user just used (anchorKey, else the focused
 * one) stays at the same spot on screen, so content appearing above it never shoves
 * the list under their thumb.
 * @param {string} [anchorKey]
 */
function render(anchorKey) {
  const root = /** @type {HTMLElement} */ (document.getElementById("app"));
  const focusKey = /** @type {HTMLElement | null} */ (document.activeElement)?.dataset?.key;
  const key = anchorKey ?? focusKey;
  const before = key ? root.querySelector(`[data-key="${CSS.escape(key)}"]`) : null;
  const anchorTop = before ? before.getBoundingClientRect().top : null;
  const view =
    S.screen === "signin" ? viewSignIn()
    : S.screen === "approve" ? viewApprove()
    : S.screen === "error" ? viewError()
    : S.screen === "loading" ? viewLoading()
    : paydayActive() && !S.paydayDismissed ? viewPaydayDone()
    : viewMain();
  root.replaceChildren(...view.flat(Infinity).filter(Boolean));
  const after = key ? /** @type {HTMLElement | null} */ (root.querySelector(`[data-key="${CSS.escape(key)}"]`)) : null;
  if (after && anchorTop != null) {
    const shift = after.getBoundingClientRect().top - anchorTop;
    if (shift) window.scrollBy(0, shift);
  }
  if (focusKey) /** @type {HTMLElement | null} */ (root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`))?.focus({ preventScroll: true });

  // The session's close, shown once: bring it into view and say it out loud.
  const done = root.querySelector(".payday-done");
  if (done && !S.paydayShown) {
    S.paydayShown = true;
    window.scrollTo({ top: 0, behavior: "auto" });
    /** @type {HTMLElement} */ (done).focus({ preventScroll: true });
    // Said from plain text: the on-screen total is mid-count at this point.
    announce(/** @type {HTMLElement} */ (done).dataset.say || "Bills paid");
    // A small double tap in the hand as the tick lands (Android Chrome; ignored elsewhere).
    if (done.classList.contains("payday-screen") && !reduceMotion()) setTimeout(() => navigator.vibrate?.([14, 70, 26]), 860);
  }

  // Back from the Monzo app with the transfer in: joint's fill is the next job.
  if (jointJustReady) {
    jointJustReady = false;
    goTo("joint", false); // the fill button's own ring marks it
  }
}

function header() {
  return h("header", { class: "app-header" },
    h("img", { class: "logo", src: "/icon.svg", alt: "" }),
    h("h1", { class: "wordmark" }, "Pot Filler"),
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
        h("button", { "aria-pressed": String(S.theme === "dark"), "data-key": "theme-dark", onclick: () => setTheme("dark") }, "Dark"),
        h("button", { "aria-pressed": String(S.theme === "light"), "data-key": "theme-light", onclick: () => setTheme("light") }, "Light"),
        h("button", { "aria-pressed": String(S.theme === "system"), "data-key": "theme-system", onclick: () => setTheme("system") }, "System"),
      ),
    ),
    h("p", { class: "group-footer" }, "System follows your phone's light or dark setting. Just for this phone."),
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
    p ? groupView("personal", p, plan) : h("p", { class: "card muted" }, "No personal account found."),
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

/**
 * Opens the Monzo app from Chrome on Android through its monzo:// scheme (falls back to
 * monzo.com if the app isn't installed). Chrome only hands a page's links to apps that
 * accept browser links, so a plain "launch this app" intent can't work: it always fell back.
 */
const MONZO_APP_URL = "intent://home#Intent;scheme=monzo;package=co.uk.getmondo;"
  + "S.browser_fallback_url=https%3A%2F%2Fmonzo.com;end";
const IS_ANDROID = /Android/i.test(navigator.userAgent);

/** Every selected pot is full: the whole screen becomes the session's close. */
function viewPaydayDone() {
  const { amount, pots } = S.filledThisSession;
  const off = (["personal", "joint"]).flatMap((k) => { const g = S.groups[/** @type {Kind} */ (k)]; return g ? switchedOff(g) : []; });
  const jointOff = S.groups.joint ? switchedOff(S.groups.joint) : [];
  const jointLeft = S.groups.joint?.balance ?? 0;
  const back = () => { S.paydayDismissed = true; render(); window.scrollTo({ top: 0, behavior: "auto" }); };
  return [
    // Played once: the 30s refresh and other re-renders show it settled, not again.
    h("section", { class: `payday-done payday-screen${S.paydayShown ? " played" : ""}`, "aria-label": "Bills paid", tabindex: "-1", "data-say": paydaySay() },
      h("div", { class: "payday-hero" },
        // A pot filling to its goal, then the tick: the month's one celebration.
        h("span", { class: "tick" }, h("span", { class: "tick-fill", "aria-hidden": "true" }), icon("check")),
        h("h1", null, "Bills paid"),
        h("p", { class: "payday-amount num positive" },
          h("span", { "aria-hidden": "true" }, countSpan("payday", amount, { from: 0, dur: 1100, delay: 420 })),
          h("span", { class: "sr-only" }, formatGBP(amount))),
        h("p", null, `into ${pots} pot${pots === 1 ? "" : "s"}. `,
          off.length
            ? `Every pot you selected is at its goal. Not filling: ${off.map((p) => p.name).join(", ")}.`
            : "Every bill pot is at its goal, so the bills are covered for the month. Nicely done."),
        jointOff.length > 0 && jointLeft > 0 &&
          h("p", null, h("span", { class: "num" }, formatGBP(jointLeft)), ` is still in joint for ${jointOff.map((p) => p.name).join(", ")}.`),
      ),
      h("div", { class: "payday-actions" },
        IS_ANDROID
          ? h("button", { class: "btn-primary btn-big", "data-key": "finish", onclick: () => finish(true) }, "Sign out and open Monzo")
          : h("button", { class: "btn-primary btn-big", "data-key": "finish", onclick: () => finish() }, "Sign out"),
        h("button", { class: "btn-link", "data-key": "payday-back", onclick: back }, "Go back to my pots"),
      ),
    ),
  ];
}

function paydayDone() {
  const { amount, pots } = S.filledThisSession;
  const off = (["personal", "joint"]).flatMap((k) => { const g = S.groups[/** @type {Kind} */ (k)]; return g ? switchedOff(g) : []; });
  const jointOff = S.groups.joint ? switchedOff(S.groups.joint) : [];
  const jointLeft = S.groups.joint?.balance ?? 0;
  return h("section", { class: `card payday-done${S.paydayShown ? " played" : ""}`, "aria-label": "Bills paid", tabindex: "-1", "data-say": paydaySay() },
    h("span", { class: "tick" }, icon("check")),
    h("h2", null, "Bills paid"),
    h("p", null, h("span", { class: "num positive" }, formatGBP(amount)), ` into ${pots} pot${pots === 1 ? "" : "s"}. `,
      off.length
        ? `Every pot you selected is at its goal. Not filling: ${off.map((p) => p.name).join(", ")}.`
        : "Every bill pot is at its goal, so the bills are covered for the month."),
    jointOff.length > 0 && jointLeft > 0 &&
      h("p", null, h("span", { class: "num" }, formatGBP(jointLeft)), ` is still in joint for ${jointOff.map((p) => p.name).join(", ")}.`),
    S.loadedAt > 0 && freshness(S.loadedAt),
    MOCK
      ? h("a", { class: "btn btn-big", href: location.href }, "Start the mock again")
      : h("button", { class: "btn-big", "data-key": "finish", onclick: () => finish() }, "Sign out and finish"),
  );
}

/** The close in words, for the status region. */
function paydaySay() {
  const { amount, pots } = S.filledThisSession;
  const off = (["personal", "joint"]).flatMap((k) => { const g = S.groups[/** @type {Kind} */ (k)]; return g ? switchedOff(g) : []; });
  return `Bills paid. ${formatGBP(amount)} into ${pots} pot${pots === 1 ? "" : "s"}.`
    + (off.length ? ` Not filling: ${off.map((p) => p.name).join(", ")}.` : " Every bill pot is at its goal.");
}

/** Every selected pot in both accounts is full and something went in this session. */
function paydayActive() {
  const t = (/** @type {Group | null} */ g) => (g ? summarise(g.pots, S.excluded).total : 0);
  return S.filledThisSession.pots > 0 && t(S.groups.personal) === 0 && t(S.groups.joint) === 0;
}

/**
 * Ends payday: revokes this app's Monzo access now and clears this tab's record.
 * @param {boolean} [openMonzo] then hand over to the Monzo app
 */
async function finish(openMonzo = false) {
  session.del(RUNS_KEY);
  S.filledThisSession = { amount: 0, pots: 0 };
  S.paydayShown = false;
  S.paydayDismissed = false;
  counters.delete("payday");
  await signOut();
  if (openMonzo) location.href = MONZO_APP_URL;
}

function modeControl() {
  /** @param {boolean} dry */
  const set = (dry) => {
    S.dryRun = dry;
    if (!dry) {
      for (const k of /** @type {Kind[]} */ (["personal", "joint"])) if (S.runs[k]?.dryRun) S.runs[k] = null;
    }
    render(dry ? "mode-practice" : "mode-live");
  };
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
  if (r.code && /locked/.test(r.code)) return "Unlock it in the Monzo app and try again, or leave it for this month.";
  return "Check it in the Monzo app and try again, or leave it for this month.";
}

/**
 * Refresh first; if every stuck pot is still locked, say so rather than offering
 * a deposit that will be refused again.
 * @param {Kind} kind @param {Result[]} stuck
 */
async function retryStuck(kind, stuck) {
  S.retrying[kind] = true;
  render(`fill-${kind}`);
  await load();
  S.retrying[kind] = false;
  const pots = S.groups[kind]?.pots ?? [];
  const still = stuck.filter((r) => pots.find((p) => p.id === r.potId)?.locked).map((r) => r.potId);
  if (still.length === stuck.length) {
    S.stillLocked[kind] = still;
    announce("Still locked in Monzo.");
    render(`fill-${kind}`);
    return;
  }
  S.stillLocked[kind] = [];
  runFill(kind);
}

/** @param {Kind} kind @param {Result[]} stuck */
function leaveForNow(kind, stuck) {
  leaveForMonth(stuck.map((r) => r.potId));
  S.stillLocked[kind] = [];
  render();
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

  // Set once, the moment this account's last pot fills: the tick and the way on arrive together.
  const arrived = changed(`full-${kind}`, total === 0) && total === 0;
  if (total === 0) {
    body.push(h("div", { class: `all-full${arrived ? " arrive" : ""}` },
      h("span", { class: "tick" }, icon("check")),
      h("span", null,
        rows.length === 0 ? `No ${kind} pots have a goal yet.`
        : off.length ? `Every selected ${kind} pot is full.`
        : justFilled && !paydayActive() ? `All ${kind} pots are full. Nicely done.`
        : `All ${kind} pots are full.`),
    ));
    const js = kind === "personal" && S.groups.joint ? summarise(S.groups.joint.pots, S.excluded) : null;
    const jointShort = js?.total ?? 0;
    // Once joint's own section is showing a stuck pot, don't send the owner there as "next".
    const jointStuck = js ? stuckPots(S.runs.joint, js.toFill).length > 0 : false;
    if (jointShort > 0 && !jointStuck) {
      const toMove = Math.max(0, jointShort - (S.groups.joint?.balance ?? 0));
      const gap = plan ? shortfall(plan).jointGap : 0;
      body.push(h("button", {
        class: `btn-sm next-step${arrived ? " arrive" : ""}`,
        "data-key": "next-joint",
        onclick: () => goTo("joint"),
      }, gap > 0
        ? h("span", null, "Next: joint (", money(gap), " short)")
        : toMove > 0
        ? h("span", null, "Next: move ", money(toMove), " to joint")
        : h("span", null, "Next: joint pots (", money(jointShort), ")"),
      icon("arrow", "icon icon-sm")));
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
          S.stillLocked[kind].includes(r.potId)
            ? h("p", null, `Still locked in Monzo at ${new Date(S.loadedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Unlock it there and try again, or leave it for this month.`)
            : h("p", null, r.message, ". ", fixFor(r)),
        )),
        h("button", {
          class: S.stillLocked[kind].length ? "btn-big" : "btn-sm",
          "data-key": `leave-${kind}`,
          disabled: busy(),
          onclick: () => leaveForNow(kind, stuck),
        }, stuck.length === 1 ? `Leave ${stuck[0].name} for this month` : "Leave these for this month"),
      ),
    );
  } else {
    // Amber is for a real shortfall only: money this account can't cover.
    const sf = plan ? shortfall(plan) : null;
    // Joint's own figure stays plain: its shortfall shows on the transfer it can't get.
    const amber = kind === "personal" && (sf?.ownGap ?? 0) > 0;
    // While the transfer card above is the job, joint's own figure steps back a size.
    const waiting = blocked && !S.dryRun;
    // During a live run the figure drains as each pot's money goes in.
    const left = Math.max(0, total - (run && !run.dryRun ? run.pending ?? 0 : 0));
    body.push(h("div", null,
      h("div", { class: `big-number${amber ? " owed" : ""}${waiting ? " waiting" : ""}` }, countSpan(`big-${kind}`, left, { dur: 520 })),
      h("div", { class: "figure-caption" }, `to fill across ${toFill.length} pot${toFill.length === 1 ? "" : "s"}`),
    ));
    if (kind === "personal" && sf && sf.ownGap > 0) body.push(ownShortNote(group.balance, total, sf.ownGap));
    else if (kind === "personal" && sf && sf.jointGap > 0) {
      body.push(h("p", { class: "note warn" }, icon("alert"),
        h("span", null, "Your pots are covered. Joint will be ", money(sf.jointGap), " short; there's a suggestion under Joint.")));
    }
  }

  if (off.length) {
    body.push(h("p", { class: "switched-off" },
      h("span", null, `Not filling: ${off.map((p) => S.left.has(p.id) && !S.off.has(p.id)
        ? `${p.name} (this month only)`
        : `${p.name} (${formatGBP(Math.max(0, (p.goal_amount ?? 0) - p.balance))} to go)`).join(", ")}.`),
      h("button", {
        class: "btn-link",
        "data-key": `on-${kind}`,
        disabled: busy(),
        onclick: () => { turnBackOn(off.map((p) => p.id)); render(`fill-${kind}`); },
      }, off.length === 1 ? "Turn it back on" : "Turn them back on"),
    ));
  }

  const move = kind === "joint" && plan && total > 0 && !stuck.length ? moveCard(plan, group.balance, total) : null;
  const ready = kind === "joint" && changed("joint-ready", !blocked) && !blocked && total > 0 && !S.dryRun && !stuck.length;
  if (ready) jointJustReady = true;

  if (kind === "joint" && plan?.jointCovered && total > 0 && !stuck.length) {
    body.push(h("p", { class: "note ok" }, icon("check"), h("span", null, "There's enough in joint for these pots.")));
  }

  if (total > 0) {
    // A pot that needs changing in Monzo first gets a fresh read before the retry.
    const needsMonzo = stuck.some((r) => r.code && /locked/.test(r.code));
    const quietRetry = stuck.length > 0 && S.stillLocked[kind].length > 0;
    body.push(h("button", {
      class: (quietRetry ? "btn-sm btn-quiet retry-quiet" : stuck.length ? "btn-big" : "btn-primary btn-big") + (ready ? " ready" : ""),
      "data-key": `fill-${kind}`,
      disabled: busy() || S.refreshing || (blocked && !S.dryRun),
      onclick: () => (stuck.length && needsMonzo ? retryStuck(kind, stuck) : runFill(kind)),
    }, run?.running
      ? h("span", null, progressText(run))
      : S.retrying[kind]
        ? h("span", null, "Refreshing…")
      : stuck.length
        ? quietRetry
          ? h("span", null, "Refresh and try again")
          : h("span", null, needsMonzo ? "Refresh and try again (" : "Try again (", money(total), ")")
        : S.dryRun
          ? h("span", null, "Practise filling (", money(total), ")")
          : h("span", null, `Fill ${kind} pots (`, money(total), ")")));
  }

  if (total > 0 && blocked && !S.dryRun && !stuck.length && plan) {
    body.push(h("p", { class: "button-reason" },
      shortfall(plan).jointGap > 0
        ? "Joint can't be filled until it has enough: leave some pots for this month, or move more money in."
        : "Ready once the transfer above reaches joint."));
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
  const sf = shortfall(plan);
  const warning = sf.jointGap > 0 && h("div", { class: "short" },
    h("p", { class: "note warn" }, icon("alert"),
      h("span", null,
        sf.pTot > 0 ? ["After your own pots you'll have ", money(sf.spare)] : ["You have ", money(sf.pBal)],
        ", ", money(sf.jointGap), " short of this transfer.")),
    cutSuggestion("joint", sf.jointGap));

  if (plan.jointCovered) {
    const locked = lockedNote(S.groups.joint, true);
    if (!warning && !locked) return null;
    return h("div", { class: "card notice" }, warning, locked);
  }
  return h("div", { class: "card notice" },
    h("h3", null, "Move ", h("span", { class: sf.jointGap > 0 ? "owed" : "" }, money(plan.moveToJoint)), " to joint in the Monzo app"),
    h("p", null,
      "Joint has ", h("b", null, money(jointBalance)), " and its pots need ", h("b", null, money(jointTotal)),
      ". Pot Filler can't move money between accounts, so make this transfer yourself. Balances refresh when you come back."),
    lockedNote(S.groups.joint, true),
    warning,
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
            // The return trip is handled by the visibilitychange reload below.
            if (IS_ANDROID && !MOCK) location.href = MONZO_APP_URL;
            setTimeout(() => { S.copied = false; render(); }, 1500);
          } catch {
            S.copyFailed = true;
            announce("Couldn't copy the amount");
            render();
            setTimeout(() => { S.copyFailed = false; render(); }, 2500);
          }
        },
      }, icon(S.copied ? "check" : "copy", "icon icon-sm"),
      S.copied ? "Copied" : S.copyFailed ? `Couldn't copy: ${plainAmount(plan.moveToJoint)}` : IS_ANDROID && !MOCK ? "Copy and open Monzo" : "Copy amount"),
      h("button", { class: "btn-sm", "data-key": "refresh-joint", disabled: S.refreshing || busy(), onclick: load },
        icon("refresh", "icon icon-sm"), S.refreshing ? "Refreshing…" : "Refresh"),
      mock && h("button", {
        class: "btn-sm",
        "data-key": "simulate",
        disabled: S.refreshing || busy(),
        onclick: () => { mock.simulateTransferToJoint(Math.min(plan.moveToJoint, S.groups.personal?.balance ?? 0)); load(); },
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
  // Biggest shortfalls first, so the pots that matter most sit at the top.
  const open = rows.filter((r) => r.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall);
  const full = rows.filter((r) => r.shortfall === 0);
  const showFull = S.showFull[kind];
  const toggle = full.length > 0 && h("li", { class: "full-toggle" },
    h("button", {
      class: "full-toggle-btn",
      "aria-expanded": String(showFull),
      "data-key": `full-${kind}`,
      onclick: () => { S.showFull[kind] = !showFull; render(`full-${kind}`); },
    },
      h("span", { class: "tick" }, icon("check", "icon icon-sm")),
      h("span", { class: "grow" }, `${full.length} pot${full.length === 1 ? "" : "s"} already full`),
      h("span", { class: `chevron${showFull ? " open" : ""}` }, icon("chevron", "icon icon-sm")),
    ));
  return h("ul", { class: "list", "aria-label": `${title} pots` },
    open.map((r) => potRow(r)),
    toggle,
    showFull && full.map((r) => potRow(r)),
  );
}

/**
 * Where money is genuinely short, and by how much. Personal pots are paid first;
 * joint gets what is left of the personal balance plus what joint already has.
 * @param {ReturnType<typeof jointPlan>} plan
 */
function shortfall(plan) {
  const pBal = S.groups.personal?.balance ?? 0;
  const pTot = S.groups.personal ? summarise(S.groups.personal.pots, S.excluded).total : 0;
  const ownGap = Math.max(0, pTot - pBal);
  const spare = Math.max(0, pBal - pTot);
  const jointGap = Math.max(0, plan.moveToJoint - spare);
  return { pBal, pTot, ownGap, spare, jointGap };
}

/**
 * A suggested cut with a one-tap way to apply it, for this month only.
 * @param {Kind} kind @param {number} gap
 */
function cutSuggestion(kind, gap) {
  const group = S.groups[kind];
  if (!group || gap <= 0) return null;
  const cut = suggestCut(summarise(group.pots, S.excluded).toFill, gap);
  if (!cut.pots.length) return null;
  const names = cut.pots.map((p) => p.name).join(" and ");
  return [
    h("p", null, "To make it fit, leave ", h("b", null, names), " (", money(cut.total), ") for this month. You can pick different pots with the switches below."),
    h("div", { class: "btn-row" },
      h("button", {
        class: "btn-sm",
        "data-key": `cut-${kind}`,
        disabled: busy(),
        onclick: () => { leaveForMonth(cut.pots.map((p) => p.id)); render(`fill-${kind}`); },
      }, `Leave ${cut.pots.length === 1 ? cut.pots[0].name : `these ${cut.pots.length}`} for this month`),
    ),
  ];
}

/**
 * Personal can't cover even its own pots.
 * @param {number} balance @param {number} total @param {number} gap
 */
function ownShortNote(balance, total, gap) {
  return h("div", { class: "short" },
    h("p", { class: "note warn" }, icon("alert"),
      h("span", null, "Not enough for all your pots: ", money(gap), " short. You have ", money(balance), " and they need ", money(total), ".")),
    cutSuggestion("personal", gap));
}

/** Selected, short pots that Monzo shows as locked. @param {Group | null} group */
function lockedShort(group) {
  return group ? summarise(group.pots, S.excluded).toFill.filter((r) => r.pot.locked) : [];
}

/**
 * @param {Group | null} group
 * @param {boolean} [withAction] offer the one-tap "leave it" right here
 */
function lockedNote(group, withAction = false) {
  const locked = lockedShort(group);
  if (!locked.length) return null;
  const sum = locked.reduce((n, r) => n + r.shortfall, 0);
  const one = locked.length === 1;
  const note = h("p", { class: "note warn" }, icon("lock"),
    h("span", null,
      `Includes ${formatGBP(sum)} for ${locked.map((r) => r.pot.name).join(", ")}, locked in Monzo, which may refuse ${one ? "it" : "them"}. Unlock ${one ? "it" : "them"} in Monzo first, or leave ${one ? "it" : "them"} out for this month.`));
  if (!withAction) return note;
  return [note, h("div", { class: "btn-row" },
    h("button", {
      class: "btn-sm",
      "data-key": "leave-locked",
      disabled: busy(),
      onclick: () => { leaveForMonth(locked.map((r) => r.pot.id)); render("fill-joint"); },
    }, one ? `Leave ${locked[0].pot.name} for this month` : `Leave these ${locked.length} for this month`))];
}

/** @param {{ pot: Pot, shortfall: number, excluded: boolean }} r */
function potRow({ pot, shortfall, excluded }) {
  const goal = /** @type {number} */ (pot.goal_amount);
  const pct = Math.max(0, Math.min(100, (pot.balance / goal) * 100));
  const full = shortfall === 0;
  return h("li", { class: `pot${excluded ? " off" : ""}` },
    h("div", null,
      h("div", { class: "row-title" },
        h("span", { class: "pot-name" }, pot.name),
        pot.locked && h("span", { class: "chip chip-warn" }, icon("lock", "icon"), "Locked"),
      ),
      h("div", { class: "row-sub num" }, `${formatGBP(pot.balance)} of ${formatGBP(goal)}`),
      h("div", { class: "bar", "aria-hidden": "true" }, h("span", { style: { width: `${pct}%` } })),
    ),
    full
      ? h("div", { class: "pot-amount full" }, icon("check", "icon icon-sm"), "Full")
      : h("div", { class: "pot-amount num" },
          formatGBP(shortfall), h("small", null, excluded ? "off" : "to go")),
    full ? h("span", { "aria-hidden": "true" }) : h("button", {
      class: "switch",
      role: "switch",
      "aria-checked": String(!excluded),
      "aria-label": `Include ${pot.name}`,
      "data-key": `pot-${pot.id}`,
      disabled: busy(),
      onclick: (/** @type {MouseEvent} */ e) => {
        const btn = /** @type {HTMLElement} */ (e.currentTarget);
        if (btn.dataset.pending) return;
        btn.dataset.pending = "1";
        // Let the knob slide on the element the user touched, then rebuild around it.
        btn.setAttribute("aria-checked", String(excluded));
        if (excluded) turnBackOn([pot.id]);
        else { S.off.add(pot.id); saveExcluded(); }
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        setTimeout(() => render(`pot-${pot.id}`), reduce ? 0 : 170);
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
  const failed = run.results.filter((r) => r.outcome === "failed" && !S.excluded.has(r.potId)).length;
  const pots = (/** @type {number} */ n) => `${n} pot${n === 1 ? "" : "s"}`;
  if (run.running) {
    return { text: run.dryRun ? `${formatGBP(sum)} would go in so far` : `${formatGBP(sum)} in so far`, tone: "" };
  }
  if (run.dryRun) {
    const locked = filled.filter((r) => r.code === "locked").length;
    const waiting = filled.filter((r) => r.message && r.code !== "locked").length;
    return {
      text: `Practice: would put ${formatGBP(sum)} into ${pots(filled.length)}${waiting ? ", once the money is moved in" : ""}.`,
      tone: failed ? "bad" : "",
      problem: locked ? `${locked} locked in Monzo may be refused.` : undefined,
    };
  }
  const done = filled.length ? `Filled ${pots(filled.length)}, ${formatGBP(sum)}.` : "Nothing new went in.";
  const left = run.results.filter((r) => r.outcome === "failed" && S.excluded.has(r.potId));
  if (failed || run.stopped) {
    return { text: done, tone: filled.length ? "ok" : "bad", problem: failed ? `${failed} didn't go through.` : "Stopped early." };
  }
  return {
    text: left.length ? `${done} ${left.map((r) => r.name).join(", ")} left for this month.` : done,
    tone: filled.length ? "ok" : "",
  };
}

/** @param {Kind} kind @param {Run} run @param {boolean} failuresShownAbove */
function resultsView(kind, run, failuresShownAbove) {
  const head = resultsHeadline(run);
  // Problems first once the run is over; while it runs, keep the running order.
  // When the summary above already names the failed pots, don't repeat them here.
  const order = { failed: 0, not_attempted: 1, filled: 2, would_fill: 2, skipped: 3 };
  /** A failure the owner has since dealt with by switching the pot off. @param {Result} r */
  const settled = (r) => r.outcome === "failed" && S.excluded.has(r.potId);
  const shown = run.running
    ? run.results
    : run.results
        .map((r) => (settled(r) ? { ...r, outcome: /** @type {const} */ ("skipped"), message: "Switched off after this run" } : r))
        .filter((r) => !(failuresShownAbove && r.outcome === "failed"))
        .sort((a, b) => order[a.outcome] - order[b.outcome]);
  // Problems stay open; the routine rows fold behind one line once the run is over.
  // Practice exists to show what each pot would get, so its rows never fold.
  const routine = (/** @type {Result} */ r) => r.outcome === "filled" || r.outcome === "skipped" || (r.outcome === "would_fill" && !run.dryRun);
  const open = S.showResults[kind];
  const foldable = run.running ? [] : shown.filter(routine);
  const rows = run.running ? shown : shown.filter((r) => !routine(r) || open);
  return h("div", { class: "results" },
    h("div", { class: `results-head ${head.tone}` },
      h("h3", null,
        head.tone === "ok" && icon("check", "icon icon-sm"),
        head.tone === "bad" && icon("alert", "icon icon-sm"),
        h("span", null, head.text, head.problem && [" ", h("span", { class: `head-problem${run.dryRun ? " warn" : ""}` }, head.problem)]),
      ),
      !run.running && run.dryRun && h("button", {
        class: "btn-sm btn-quiet",
        "data-key": `clear-${kind}`,
        onclick: () => { S.runs[kind] = null; render(`fill-${kind}`); },
      }, "Clear"),
    ),
    run.stopped && h("p", { class: "note bad", style: { margin: "4px 0 8px" } }, h("span", null, `Stopped: ${run.stopped}.`, run.dryRun ? "" : " Running it again only fills what's still short.")),
    rows.length > 0 && h("ul", null, rows.map((r) => resultRow(r, kind))),
    foldable.length > 0 && h("button", {
      class: "btn-link results-toggle",
      "aria-expanded": String(open),
      "data-key": `results-${kind}`,
      onclick: () => { S.showResults[kind] = !open; render(`results-${kind}`); },
    }, h("span", null, open ? "Hide details" : `Show all ${foldable.length} pot${foldable.length === 1 ? "" : "s"}`),
    h("span", { class: `chevron${open ? " open" : ""}` }, icon("chevron", "icon icon-sm"))),
  );
}

/** @type {Record<Result["outcome"], keyof typeof ICONS>} */
const RESULT_ICON = { filled: "check", would_fill: "arrow", skipped: "dash", failed: "alert", not_attempted: "clock" };

/** @param {Result} r @param {Kind} kind */
function resultRow(r, kind) {
  // A row that has just settled (Waiting → filled, failed…) gets a small arrival.
  const settled = changed(`res-${kind}-${r.potId}`, r.outcome) && r.outcome !== "not_attempted";
  const label = {
    filled: "",
    would_fill: r.message,
    skipped: r.message,
    failed: r.message,
    not_attempted: r.message ? "Not tried: stopped after an earlier problem" : "Waiting",
  }[r.outcome];
  const showAmount = r.outcome === "filled" || r.outcome === "would_fill";
  return h("li", { class: `result ${r.outcome}${settled ? " arrive" : ""}` },
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
        h("h1", { id: "sheet-title" }, `Fill ${items.length} ${kind} pot${items.length === 1 ? "" : "s"}?`),
        h("p", { class: "lede" }, "This moves ", money(total), ` of ${MOCK ? "mock" : "real"} money from ${from}. Each pot is checked again just before its money goes in.`),
        h("ul", { class: "sheet-list" },
          items.map((i) => h("li", null, h("span", null, i.name), money(i.amount)))),
        h("div", { class: "sheet-total" }, h("span", null, "Total"), money(total)),
        lockedNote(S.groups[kind]),
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
    const list = dlg.querySelector(".sheet-list");
    if (list && list.scrollHeight > list.clientHeight + 1) {
      const atEnd = () => list.classList.toggle("at-end", list.scrollTop + list.clientHeight >= list.scrollHeight - 2);
      list.classList.add("scrolls");
      list.addEventListener("scroll", atEnd, { passive: true });
      atEnd();
    }
  });
}

// ---------------------------------------------------------------- boot

setInterval(() => { if (S.screen === "main" && !busy() && !document.querySelector("dialog[open]")) render(); }, 30_000);

if (!MOCK) {
  const saved = loadRecord();
  if (saved) {
    S.filledThisSession = { amount: saved.amount, pots: saved.pots };
    S.runs = { personal: saved.runs?.personal ?? null, joint: saved.runs?.joint ?? null };
  }
}

// Coming back from the Monzo app (after the joint transfer): read fresh balances.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || S.screen !== "main" || busy() || S.refreshing) return;
  if (document.querySelector("dialog[open]")) return;
  if (Date.now() - S.loadedAt > 5_000) load();
});

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
