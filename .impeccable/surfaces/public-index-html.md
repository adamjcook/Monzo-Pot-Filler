---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: ["public/app.js","public/styles.css"]
---

# Pot Filler: main screen (sign-in, approve, pots, fill, results)

Mode: Operate. One owner, one-handed on Android, monthly payday. Job: top every bill pot to exactly its goal, personal then joint, and leave certain nothing went wrong. Constraints: sibling of MC Bank, must match its look (FinPair `src/style.css`); dark default, light opt-in per phone; warm British voice. Must keep: confirm dialog, re-check before deposit, dedupe, move-to-joint card, Copy amount.

## Direction contract

THESIS: Payday as one calm, exact ledger: each account's shortfall is the headline, pots are a grouped list, and the screen always says what happened. Refuses the generic fintech card-and-teal look and a "Dry run: off" double negative.

OWN-WORLD: MC Bank: graphite surfaces with a faint green lean, Figtree Variable, deep icon-green #346a51/#2f5e48 owns actions and switches, and marks the Live mode when selected because real money moves (Practice selects in MC Bank's graphite segment); amber for what pots are owed, teal for filled/progress. Grouped lists with small grey labels and right totals, 20px card radius, pill small buttons, drawn stroke icons.

STORY: The owner sees how much each account's pots need, chooses Practice or Live, fills personal, moves the stated amount to joint, fills joint, and ends on a plain, warm "all full" or a named problem with its fix.

FIRST VIEWPORT: Header (icon + Pot Filler, Refresh, Sign out); Practice | Live segmented with one-line meaning; Personal label with available balance; summary card with amber shortfall figure, pot count, switched-off line, full-width green fill button in thumb reach.

FORM: inherited MC Bank grouped-list app screen; seed: none (pinned) "I'd like it to be styled the same way as the MC Bank (FinPair) app", with the confirmed scope "Restyle + P0/P1": an existing screen restyled in MC Bank's world plus the critique's failure-aware end state, Practice | Live naming and visible switched-off pots.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
