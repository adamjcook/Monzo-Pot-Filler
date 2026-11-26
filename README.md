# Monzo Pot Filler

A small personal tool that tops every Monzo bill pot up to its goal, for a personal and a joint account. It's built for a phone on payday.

- Shows each pot's balance, goal and shortfall, grouped into **Personal** and **Joint**.
- **Fill personal pots** deposits each pot's shortfall from the personal account, after you confirm the total.
- **Joint:** if the joint balance doesn't cover the joint shortfall, it tells you exactly how much to move to joint first. The API can't move money between accounts, so you do that in the Monzo app and then tap Refresh. After that it fills the joint pots from the joint balance.
- It never withdraws. Pots at or above their goal, pots without a goal and deleted pots are never touched. Running it again only fills what's still short.

## Stack

- A Cloudflare Worker (`src/worker.ts`) with static assets (`public/`). There's no database, no KV and no build step beyond what Wrangler does for the Worker.
- The UI is plain DOM in ES modules (`public/*.js`), type-checked with TypeScript through JSDoc (`// @ts-check`). Pure logic lives in `public/logic.js`, which the tests import directly.

## How the security works

- **OAuth:** `/login` sets a random `state` in an HttpOnly cookie and redirects to `auth.monzo.com`. `/callback` checks the state, then exchanges the code using the client secret, which only the Worker holds.
- **Token:** the access token goes only to the page's `sessionStorage`, so it's gone when the tab closes. The client is non-confidential, so Monzo issues no refresh token, and if one ever appeared the Worker would drop it. Tokens last about 6 hours. **Sign out** revokes the token.
- **Proxy:** `/api/*` forwards only `GET /ping/whoami`, `GET /accounts`, `GET /balance`, `GET /pots`, `PUT /pots/{id}/deposit` and `POST /oauth2/logout`.
  - Every parameter and body field is validated.
  - A deposit's amount must be a positive whole number of pence, up to `MAX_DEPOSIT_PENCE` (default £2,000).
  - Withdrawals, transactions and everything else are refused.
  - The bearer token is passed through and never stored or logged, and Worker observability is off.
- **Optional lock:** set `ALLOWED_USER_ID` to your Monzo `user_...` ID and sign-ins from anyone else are rejected and their token revoked.

## How deposits work (`fillPots` in `public/logic.js`)

- Pots are filled one at a time, not in parallel.
- Before each deposit, the tool re-reads the pots and recalculates that pot's shortfall from the fresh balance. It deposits exactly that amount, and only if it's above 0.
- `dedupe_id` is a SHA-256 hash of the pot ID, the balance just read, the amount and the date.
  - A retry from the same state on the same day reuses the ID, so Monzo can't fill a pot twice.
  - The date is included so that next month, when a pot has drained back to the same balance, its deposit isn't treated as a repeat.
- Any error that isn't specific to one pot stops the run, and later pots are marked "not tried". That covers 401, 403, 429, 5xx, network failures, invalid tokens and an empty account.
- **Dry run** is on until the first real fill on each device. Turning it off is one switch.

## Develop

```sh
npm install
npm run dev          # wrangler dev on http://localhost:8787
open http://localhost:8787/?mock=1
npm run check        # typecheck + tests
```

`?mock=1` uses made-up accounts and pots: some full, some short, some without goals, one deleted and one locked pot whose deposits fail. That lets you try the whole flow without Monzo, including **Mock: make transfer** for the joint step.

## Set up for real

1. At https://developers.monzo.com create an OAuth client:
   - name **Pot Filler**
   - redirect URL `https://<worker-host>/callback`
   - **Confidentiality: not confidential**
2. Put the client ID in `wrangler.jsonc` → `vars.MONZO_CLIENT_ID`. Optionally set `ALLOWED_USER_ID`.
3. `npx wrangler secret put MONZO_CLIENT_SECRET`
4. `npm run deploy`, then open the URL on the phone and choose **Add to Home screen**.
5. The first time, sign in, approve the connection in the Monzo app, tap **Continue**, and check the dry run.

## Things the Monzo docs don't cover (check on the first live run)

The current docs at docs.monzo.com confirm the OAuth flow, `/balance`, `/pots?current_account_id=`, the deposit fields and the `account_type` filter on `/accounts`. They **don't** document these, so the code is defensive about each:

- **`goal_amount` on pots.** Pots without it are treated as having no goal. If the dry run shows no pots at all, this field is the first suspect.
- **`closed` and `type` on accounts.** Accounts are filtered by them when present.
- **`locked` pots.** These are shown with a "Locked" tag and attempted normally. If Monzo refuses, that pot is shown as failed and the run carries on.
- **What a token returns before you approve it in the app.** A 403 shows the "Approve in your Monzo app" screen. A bad token has been seen to come back as `400 bad_request.invalid_token`, which is treated as signed out.
- **Rate limits.** A run makes one pot-list read and one deposit per pot, so about 40 calls for 20 pots. A 429 stops the run, and running again picks up where it stopped.
- **Depositing into joint pots** with your own login.
