import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, dedupeId, fillPots, formatGBP, jointPlan, plainAmount, shortfall, summarise, visiblePots,
} from "../public/logic.js";
import { mockApi } from "../public/mock.js";

test("formatGBP uses two decimals, commas and integer pence", () => {
  assert.equal(formatGBP(0), "£0.00");
  assert.equal(formatGBP(5), "£0.05");
  assert.equal(formatGBP(123456789), "£1,234,567.89");
  assert.equal(formatGBP(-250), "−£2.50");
  assert.throws(() => formatGBP(1.5));
  assert.equal(plainAmount(164778), "1647.78");
});

test("shortfall never goes below 0 and ignores pots without a goal", () => {
  assert.equal(shortfall({ id: "a", name: "a", balance: 100, goal_amount: 250 }), 150);
  assert.equal(shortfall({ id: "a", name: "a", balance: 300, goal_amount: 250 }), 0);
  assert.equal(shortfall({ id: "a", name: "a", balance: 0 }), 0);
  assert.equal(shortfall({ id: "a", name: "a", balance: 0, goal_amount: null }), 0);
});

test("visiblePots drops deleted and goal-less pots", () => {
  const v = visiblePots([
    { id: "1", name: "b", balance: 0, goal_amount: 10 },
    { id: "2", name: "a", balance: 0, goal_amount: 10, deleted: true },
    { id: "3", name: "c", balance: 0 },
    { id: "4", name: "A", balance: 0, goal_amount: 0 },
  ]);
  assert.deepEqual(v.map((p) => p.id), ["1"]);
});

test("summarise totals only included, short pots", () => {
  const pots = [
    { id: "1", name: "a", balance: 0, goal_amount: 1000 },
    { id: "2", name: "b", balance: 500, goal_amount: 1000 },
    { id: "3", name: "c", balance: 2000, goal_amount: 1000 },
  ];
  const s = summarise(pots, new Set(["1"]));
  assert.equal(s.total, 500);
  assert.deepEqual(s.toFill.map((r) => r.pot.id), ["2"]);
});

test("jointPlan: move amount and personal warning", () => {
  assert.deepEqual(
    jointPlan({ personalTotal: 1000, personalBalance: 5000, jointTotal: 3000, jointBalance: 1000 }),
    { moveToJoint: 2000, jointCovered: false, personalNeeds: 3000, personalShortBy: 0 },
  );
  const p = jointPlan({ personalTotal: 4000, personalBalance: 5000, jointTotal: 3000, jointBalance: 1000 });
  assert.equal(p.personalShortBy, 1000);
  assert.equal(jointPlan({ personalTotal: 0, personalBalance: 0, jointTotal: 100, jointBalance: 100 }).jointCovered, true);
});

test("dedupeId is stable for the same state and changes with any input", async () => {
  const a = await dedupeId("pot_1", 100, 50, "2026-11-26");
  assert.equal(a, await dedupeId("pot_1", 100, 50, "2026-11-26"));
  assert.match(a, /^pf_[0-9a-f]{48}$/);
  for (const other of [
    await dedupeId("pot_2", 100, 50, "2026-11-26"),
    await dedupeId("pot_1", 101, 50, "2026-11-26"),
    await dedupeId("pot_1", 100, 51, "2026-11-26"),
    await dedupeId("pot_1", 100, 50, "2026-12-26"),
  ]) assert.notEqual(a, other);
});

async function shortPots(api, acc) {
  return summarise(visiblePots(await api.pots(acc)), new Set()).toFill.map((r) => ({ id: r.pot.id, name: r.pot.name }));
}

test("personal fill tops every pot to exactly its goal; running again does nothing", async () => {
  const api = mockApi();
  const acc = "acc_mock_personal";
  const before = (await api.balance(acc)).balance;
  const targets = await shortPots(api, acc);
  const expected = summarise(visiblePots(await api.pots(acc)), new Set()).total;

  const { results, stoppedBy } = await fillPots({ api, accountId: acc, pots: targets, dryRun: false });
  assert.equal(stoppedBy, null);
  assert.ok(results.every((r) => r.outcome === "filled"));
  for (const p of visiblePots(await api.pots(acc))) assert.ok(p.balance >= p.goal_amount, p.name);
  for (const r of results) {
    const p = (await api.pots(acc)).find((x) => x.id === r.potId);
    assert.equal(p.balance, p.goal_amount, `${p.name} filled to exactly its goal`);
  }
  assert.equal((await api.balance(acc)).balance, before - expected);

  const again = await fillPots({ api, accountId: acc, pots: targets, dryRun: false });
  assert.ok(again.results.every((r) => r.outcome === "skipped" && r.message === "Already full"));
  assert.equal((await api.balance(acc)).balance, before - expected);
});

test("pots already over their goal are never touched (no withdrawals)", async () => {
  const api = mockApi();
  const acc = "acc_mock_personal";
  const icloud = (await api.pots(acc)).find((p) => p.name === "iCloud"); // 300 vs goal 299
  const { results } = await fillPots({ api, accountId: acc, pots: [{ id: icloud.id, name: "iCloud" }], dryRun: false });
  assert.equal(results[0].outcome, "skipped");
  assert.equal((await api.pots(acc)).find((p) => p.id === icloud.id).balance, 300);
});

test("dry run reports deposits but moves nothing", async () => {
  const api = mockApi();
  const acc = "acc_mock_personal";
  let deposits = 0;
  const spy = { ...api, deposit: async (...a) => { deposits++; return api.deposit(...a); } };
  const before = JSON.stringify(await api.pots(acc));
  const { results } = await fillPots({ api: spy, accountId: acc, pots: await shortPots(api, acc), dryRun: true });
  assert.equal(deposits, 0);
  assert.ok(results.every((r) => r.outcome === "would_fill" && r.amount > 0));
  assert.equal(JSON.stringify(await api.pots(acc)), before);
});

test("shortfall is recalculated from a fresh read just before each deposit", async () => {
  const api = mockApi();
  const acc = "acc_mock_personal";
  const targets = await shortPots(api, acc);
  const gym = targets.find((t) => t.name === "Gym");
  const amounts = [];
  let topped = false;
  const sneaky = {
    ...api,
    async pots(id) {
      const list = await api.pots(id);
      if (!topped) { // someone tops up the Gym pot by hand after the list was shown
        topped = true;
        const g = list.find((p) => p.id === gym.id);
        await api.deposit(gym.id, acc, 1000, "pf_manual_topup_1");
        g.balance += 1000;
      }
      return list;
    },
    deposit: async (potId, src, amount, d) => { amounts.push([potId, amount]); return api.deposit(potId, src, amount, d); },
  };
  await fillPots({ api: sneaky, accountId: acc, pots: [gym], dryRun: false });
  assert.deepEqual(amounts, [[gym.id, 3499 - 2000]]);
});

test("a pot-specific failure is recorded and the run carries on", async () => {
  const api = mockApi();
  const acc = "acc_mock_joint";
  api.simulateTransferToJoint(200_000);
  const { results, stoppedBy } = await fillPots({ api, accountId: acc, pots: await shortPots(api, acc), dryRun: false });
  assert.equal(stoppedBy, null);
  const cleaner = results.find((r) => r.name === "Cleaner");
  assert.equal(cleaner.outcome, "failed");
  assert.ok(results.filter((r) => r.name !== "Cleaner").every((r) => r.outcome === "filled"));
});

test("401/403/429/5xx stop the run; later pots are not attempted", async () => {
  for (const status of [401, 403, 429, 500]) {
    const api = mockApi();
    const acc = "acc_mock_personal";
    let n = 0;
    const flaky = { ...api, deposit: async (...a) => { if (++n === 2) throw new ApiError(status, "x"); return api.deposit(...a); } };
    const targets = await shortPots(api, acc);
    const { results, stoppedBy } = await fillPots({ api: flaky, accountId: acc, pots: targets, dryRun: false });
    assert.equal(stoppedBy.status, status);
    assert.equal(results[0].outcome, "filled");
    assert.equal(results[1].outcome, "failed");
    assert.ok(results.slice(2).every((r) => r.outcome === "not_attempted"), `status ${status}`);
    assert.equal(n, 2, "no deposits after the fatal error");
  }
});

test("a 400 invalid_token counts as signed out and stops the run", async () => {
  const api = mockApi();
  const acc = "acc_mock_personal";
  const expired = { ...api, deposit: async () => { throw new ApiError(400, "bad_request.invalid_token"); } };
  const { results, stoppedBy } = await fillPots({ api: expired, accountId: acc, pots: await shortPots(api, acc), dryRun: false });
  assert.equal(stoppedBy.code, "bad_request.invalid_token");
  assert.match(results[0].message, /Signed out/);
  assert.ok(results.slice(1).every((r) => r.outcome === "not_attempted"));
});

test("network errors stop the run too", async () => {
  const api = mockApi();
  const acc = "acc_mock_personal";
  const broken = { ...api, deposit: async () => { throw new TypeError("Failed to fetch"); } };
  const { results, stoppedBy } = await fillPots({ api: broken, accountId: acc, pots: await shortPots(api, acc), dryRun: false });
  assert.ok(stoppedBy instanceof TypeError);
  assert.ok(results.slice(1).every((r) => r.outcome === "not_attempted"));
});

test("stops before overdrawing the source account", async () => {
  const api = mockApi();
  const acc = "acc_mock_joint"; // £125.50 against ~£1,773 of shortfall
  let deposits = 0;
  const spy = { ...api, deposit: async (...a) => { deposits++; return api.deposit(...a); } };
  const { results, stoppedBy } = await fillPots({ api: spy, accountId: acc, pots: await shortPots(api, acc), dryRun: false });
  assert.equal(stoppedBy.code, "insufficient_funds");
  const failedAt = results.findIndex((r) => r.message === "Not enough money left in the account");
  assert.ok(failedAt >= 0);
  // Every pot before the stop was attempted (filled, or failed on its own); none after it.
  assert.equal(deposits, results.slice(0, failedAt).filter((r) => r.outcome !== "skipped").length);
  assert.ok(results.slice(failedAt + 1).every((r) => r.outcome === "not_attempted"));
  assert.ok((await api.balance(acc)).balance >= 0);
});

test("a retry from the same state reuses the dedupe id (Monzo can't double-fill)", async () => {
  const api = mockApi();
  const acc = "acc_mock_personal";
  const ids = [];
  // First attempt: the deposit lands at Monzo but the response is lost.
  let lose = true;
  const lossy = {
    ...api,
    deposit: async (p, s, a, d) => { ids.push(d); const r = await api.deposit(p, s, a, d); if (lose) { lose = false; throw new TypeError("lost"); } return r; },
  };
  const [phone] = (await shortPots(api, acc)).filter((t) => t.name === "Phone contract");
  await fillPots({ api: lossy, accountId: acc, pots: [phone], dryRun: false, day: "2026-11-26" });
  const again = await fillPots({ api: lossy, accountId: acc, pots: [phone], dryRun: false, day: "2026-11-26" });
  assert.equal(again.results[0].outcome, "skipped"); // fresh read sees it full
  assert.equal((await api.pots(acc)).find((p) => p.id === phone.id).balance, 2400);
});

test("practice shows the whole plan even when the account can't cover it yet", async () => {
  const api = mockApi();
  const acc = "acc_mock_joint"; // £125.50 against ~£1,773 of shortfall
  const targets = await shortPots(api, acc);
  const { results, stoppedBy } = await fillPots({ api, accountId: acc, pots: targets, dryRun: true });
  assert.equal(stoppedBy, null);
  assert.ok(results.every((r) => r.outcome === "would_fill"));
  assert.ok(results.some((r) => r.message === "Needs money moved in first"));
  assert.ok(results.some((r) => r.message === ""));
});
