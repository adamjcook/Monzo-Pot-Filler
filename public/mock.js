// @ts-check
// Made-up personal and joint accounts for trying the whole flow without Monzo.
import { ApiError } from "./logic.js";

/** @typedef {import("./logic.js").Pot} Pot */
/** @typedef {import("./logic.js").Api} Api */

/** @param {string} id @param {string} name @param {number} balance @param {number | null} goal @param {Partial<Pot>} [extra] */
const pot = (id, name, balance, goal, extra = {}) => ({
  id: `pot_mock_${id}`,
  name,
  balance,
  ...(goal === null ? {} : { goal_amount: goal }),
  deleted: false,
  locked: false,
  ...extra,
});

/** @param {number} personalBalance */
function seed(personalBalance) {
  return {
    accounts: {
      uk_retail: [{ id: "acc_mock_personal", description: "Personal", type: "uk_retail", closed: false }],
      uk_retail_joint: [{ id: "acc_mock_joint", description: "Joint", type: "uk_retail_joint", closed: false }],
    },
    balances: /** @type {Record<string, number>} */ ({ acc_mock_personal: personalBalance, acc_mock_joint: 12_550 }),
    pots: /** @type {Record<string, Pot[]>} */ ({
      acc_mock_personal: [
        pot("phone", "Phone contract", 0, 2_400),
        pot("gym", "Gym", 1_000, 3_499),
        pot("spotify", "Spotify", 1_199, 1_199),
        pot("car_ins", "Car insurance", 2_150, 4_812),
        pot("fuel", "Fuel", 4_000, 12_000),
        pot("icloud", "iCloud", 300, 299),
        pot("haircut", "Haircut", 0, 2_200),
        pot("lunches", "Work lunches", 1_870, 8_000),
        pot("holiday", "Holiday", 84_000, null),
        pot("gifts", "Birthdays & gifts", 2_500, 5_000),
        pot("old", "Old laptop fund", 0, 50_000, { deleted: true }),
      ],
      acc_mock_joint: [
        pot("mortgage", "Mortgage", 0, 98_765),
        pot("council", "Council tax", 3_000, 18_900),
        pot("energy", "Gas & electric", 2_200, 14_300),
        pot("water", "Water", 3_890, 3_890),
        pot("broadband", "Broadband", 0, 2_900),
        pot("tv", "TV licence", 1_000, 1_475),
        pot("home_ins", "Home insurance", 0, 2_288),
        pot("groceries", "Groceries", 6_100, 45_000),
        pot("streaming", "Streaming", 1_598, 1_598),
        pot("cleaner", "Cleaner", 0, 6_000, { locked: true }),
        pot("rainy", "Rainy day", 120_000, null),
      ],
    }),
  };
}

/**
 * @param {{ short?: boolean }} [opts] short: the personal account can't cover its pots and the joint transfer
 * @returns {Api & { simulateTransferToJoint(amount: number): void }}
 */
export function mockApi(opts = {}) {
  const db = seed(opts.short ? 150_000 : 245_000);
  /** @type {Map<string, Pot>} */
  const seen = new Map(); // dedupe_id -> resulting pot, like Monzo's de-duplication
  const wait = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 120));
  const clone = (/** @type {any} */ x) => JSON.parse(JSON.stringify(x));

  return {
    async whoami() {
      await wait();
      return { authenticated: true, client_id: "mock", user_id: "user_mock" };
    },
    async accounts(type) {
      await wait();
      return clone(db.accounts[type]);
    },
    async balance(id) {
      await wait();
      if (!(id in db.balances)) throw new ApiError(404, "not_found");
      return { balance: db.balances[id], currency: "GBP" };
    },
    async pots(id) {
      await wait();
      return clone(db.pots[id] ?? []);
    },
    async deposit(potId, source, amount, dedupe) {
      await wait();
      const prior = seen.get(dedupe);
      if (prior) return clone(prior);
      const p = (db.pots[source] ?? []).find((x) => x.id === potId);
      if (!p) throw new ApiError(400, "bad_request.pot_not_in_account");
      if (p.locked) throw new ApiError(400, "bad_request.pot_locked", "Mock: deposits into this locked pot fail");
      if (db.balances[source] < amount) throw new ApiError(400, "insufficient_funds");
      db.balances[source] -= amount;
      p.balance += amount;
      seen.set(dedupe, clone(p));
      return clone(p);
    },
    async logout() {
      return {};
    },
    simulateTransferToJoint(amount) {
      db.balances.acc_mock_personal -= amount;
      db.balances.acc_mock_joint += amount;
    },
  };
}
