# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(A mobile web page added to the Android home screen from Chrome, used one-handed on a phone. Not native.)

## Users

One person: the owner. Only they sign in and run it, with their own Monzo login. Their partner never opens it, but about half the bill pots belong to the couple's joint account, so the joint side is shared money handled by one person. UK banking, pounds, a monthly payday, roughly 20 bill pots across a personal and a joint account.

## Product Purpose

Monzo has no "fill to goal" button. Each bill pot's goal is the amount that bill needs each month, and the goal is the only place that amount is recorded. Pot Filler tops every bill pot up to exactly its goal, for the personal and joint accounts, in one short session on payday. Success means every selected pot ends at exactly its goal, running it again does nothing, and the owner is certain nothing went wrong.

## Positioning

It reads each pot's goal live from Monzo, so it never drifts from bill prices the way Salary Sorter, scheduled pot payments or a standing order would. It works around the API's limit honestly. Money can't be moved from personal to joint by the API, so the app says exactly how much to move ("Move £Y to joint first"). The owner makes that transfer in the Monzo app, and the app then fills the joint pots from the joint balance.

## Operating Context

- **The payday ritual, monthly:**
  1. Open from the home screen.
  2. Connect with Monzo and approve in the Monzo app (Strong Customer Authentication). This happens every time, because the token isn't kept between paydays.
  3. Check the shortfalls and fill the personal pots.
  4. Move the stated amount to joint in the Monzo app, come back, tap Refresh, and fill the joint pots.
  5. Check the results.
- The session is short and one-handed. It hops between this app and the Monzo app once, for the joint transfer.
- The first live use is a dry run, which shows the exact deposits without making them.

## Capabilities and Constraints

- Shows pots with a goal, grouped into **Personal** and **Joint**. For each pot it shows the balance, the goal and the shortfall (goal − balance, never below 0). Each group shows its total shortfall and the account's available balance.
- Pots without a goal, and deleted pots, are left out.
- Full pots are never touched. **The app never withdraws money.**
- A switch on each pot excludes it. The choice is remembered on the device (localStorage).
- Every fill is confirmed first, showing the total and each pot's amount.
- Deposits run one at a time:
  - Each pot is re-read just before its deposit, and the deposit is exactly the fresh shortfall.
  - A `dedupe_id` is made from the pot, the balance, the amount and the date, so a retry from the same state can't fill a pot twice.
  - The run stops on errors that aren't specific to one pot: auth, rate limit, server, network, or not enough money.
- Results show each pot as filled, would fill (dry run), skipped, failed or not tried. Running again only fills what's still short.
- Dry run is on until the first real fill on each device. Mock mode (`?mock=1`) uses made-up accounts, including a locked pot whose deposit fails.
- Security and storage:
  - The Cloudflare Worker holds the Monzo client secret and does the OAuth exchange.
  - The Worker proxies only an allowlist: whoami, accounts, balance, pots, pot deposit and logout. It doesn't proxy withdrawals.
  - There's a per-deposit cap of £2,000 by default.
  - The token lives only in the tab's sessionStorage. There's no refresh token, no database and no KV.
- The Monzo personal developer API is for the owner's own use only.
- Live at `monzo-pot-filler.mail-ajcook.workers.dev`, deployed by Cloudflare Workers Builds from the `main` branch.
- Stack: a Cloudflare Worker (TypeScript) plus static assets. The UI is plain DOM in ES modules type-checked with JSDoc, with no build step beyond Wrangler. Tests use `node:test`.
- A separate project from FinPair (MC Bank). No data link and no shared code with it.
- Out of scope: transfers between accounts (the API can't do them). A later idea is to flag a pot whose last direct debit differs from its goal; that needs transaction access.

## Brand Commitments

- A **sibling app in the MC Bank family**. It is styled the same way as MC Bank (the FinPair project, whose look is defined in that repo's `src/style.css`) and has its own name, Pot Filler, inside that family. Binding: match MC Bank's look rather than inventing a separate one.
- Voice: **MC Bank's warm voice**. Plain British English, personal and encouraging. It celebrates "all pots full", and it never preaches or shames about money.
- Icon: the current icon is a placeholder pot with a down arrow. A family icon, related to MC Bank's MC monogram, is still to be decided.

## Evidence on Hand

- Real usage only: the owner's own Monzo account. No testimonials or marketing material exist, and none should be invented.
- Mock data: `public/mock.js`.
- The original plan and the Monzo API findings are in `README.md`.

## Product Principles

1. **Certainty over speed.** It moves real money. Every amount is exact, every run can be repeated safely, and the end state must say plainly what happened and what, if anything, is left.
2. **Only ever adds.** It never withdraws or touches a full pot, and makes that visible.
3. **Payday in a couple of minutes.** It's one short ritual from opening to "all pots full", including the one hop to the Monzo app for the joint transfer.
4. **Nothing kept that can move money.** No stored tokens between paydays; signing in once a month is the accepted cost.
5. **Goals are the source of truth.** The app follows Monzo's pot goals and never keeps its own copy of bill amounts.

## Accessibility & Inclusion

No specific requirements have been set.
