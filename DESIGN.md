---
name: Pot Filler
description: A sibling app in the MC Bank family that tops every Monzo bill pot up to its goal on payday.
colors:
  icon-green: "#346a51"
  icon-green-light: "#2f5e48"
  green-ink: "#68b08d"
  on-green: "#ffffff"
  owed-amber: "#f2a65a"
  owed-amber-light: "#b85c0a"
  filled-teal: "#4dd7c6"
  filled-teal-light: "#00756a"
  danger-red: "#ff6b6b"
  danger-red-light: "#d92d20"
  graphite: "#0b0e0c"
  graphite-surface: "#151917"
  graphite-raised: "#1e2321"
  graphite-high: "#2b302d"
  graphite-separator: "rgb(255 255 255 / 0.07)"
  mist-text: "#f3f6f4"
  mist-text-2: "#a3a9a6"
  mist-text-3: "#858b88"
  pale-sage: "#f0f4f2"
  paper: "#ffffff"
  paper-raised: "#eff2f0"
  paper-high: "#e3e7e5"
  paper-separator: "rgb(15 30 20 / 0.08)"
  ink: "#0f1210"
  ink-2: "#5e6360"
  ink-3: "#676d6a"
  mock-yellow: "#e0b400"
  mock-ink: "#1b1400"
typography:
  display:
    fontFamily: "Figtree Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "44px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Figtree Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  title:
    fontFamily: "Figtree Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Figtree Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 450
    lineHeight: 1.45
  control:
    fontFamily: "Figtree Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "-0.006em"
  subhead:
    fontFamily: "Figtree Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 450
    lineHeight: 1.4
  label:
    fontFamily: "Figtree Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.45
  micro:
    fontFamily: "Figtree Variable, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.01em"
rounded:
  bar: "2px"
  chip: "6px"
  segment: "9px"
  sm: "10px"
  segmented: "12px"
  md: "14px"
  big-button: "16px"
  lg: "20px"
  sheet: "24px"
  pill: "999px"
spacing:
  inline: "8px"
  stack: "12px"
  row-y: "12px"
  row-x: "16px"
  card: "18px"
  gutter: "20px"
  group: "30px"
components:
  button-primary:
    backgroundColor: "{colors.icon-green}"
    textColor: "{colors.on-green}"
    typography: "{typography.body}"
    rounded: "{rounded.big-button}"
    height: "54px"
    width: "100%"
  button-primary-disabled:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.mist-text-3}"
    rounded: "{rounded.big-button}"
    height: "54px"
  button-secondary:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.mist-text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.mist-text-2}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "44px"
  button-small:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.mist-text}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.green-ink}"
    padding: "0 4px"
    height: "32px"
  segmented:
    backgroundColor: "{colors.graphite-raised}"
    rounded: "{rounded.segmented}"
    padding: "3px"
  segmented-option:
    backgroundColor: "transparent"
    textColor: "{colors.mist-text-2}"
    rounded: "{rounded.segment}"
    height: "40px"
  segmented-option-selected:
    backgroundColor: "{colors.graphite-high}"
    textColor: "{colors.mist-text}"
    rounded: "{rounded.segment}"
  segmented-option-live-selected:
    backgroundColor: "{colors.icon-green}"
    textColor: "{colors.on-green}"
    rounded: "{rounded.segment}"
  card:
    backgroundColor: "{colors.graphite-surface}"
    textColor: "{colors.mist-text}"
    rounded: "{rounded.lg}"
    padding: "{spacing.card}"
  pot-row:
    backgroundColor: "{colors.graphite-surface}"
    padding: "12px 16px"
    height: "64px"
  progress-bar:
    backgroundColor: "{colors.graphite-high}"
    rounded: "{rounded.bar}"
    height: "4px"
  progress-bar-fill:
    backgroundColor: "{colors.filled-teal}"
    rounded: "{rounded.bar}"
  chip:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.mist-text-2}"
    typography: "{typography.micro}"
    rounded: "{rounded.chip}"
    padding: "2px 7px"
  chip-warn:
    backgroundColor: "color-mix(in srgb, #f2a65a 16%, transparent)"
    textColor: "{colors.owed-amber}"
    typography: "{typography.micro}"
    rounded: "{rounded.chip}"
    padding: "2px 7px"
  switch-off:
    backgroundColor: "{colors.graphite-high}"
    rounded: "{rounded.pill}"
    width: "51px"
    height: "31px"
  switch-on:
    backgroundColor: "{colors.icon-green}"
    rounded: "{rounded.pill}"
    width: "51px"
    height: "31px"
  confirm-sheet:
    backgroundColor: "{colors.graphite-raised}"
    textColor: "{colors.mist-text}"
    rounded: "{rounded.sheet}"
    padding: "10px 20px 18px"
  mock-banner:
    backgroundColor: "{colors.mock-yellow}"
    textColor: "{colors.mock-ink}"
    typography: "{typography.micro}"
    padding: "4px 10px"
---

# Design System: Pot Filler

## Overview

**Creative North Star: "The Calm Payday Ledger"**

Pot Filler does not have a world of its own. It is a sibling app in the MC Bank family and inherits MC Bank's visual world wholesale: graphite surfaces with a faint lean towards the icon's green, Figtree Variable throughout, a deep icon-green that owns every action, amber for money still owed, teal for money in and "full", and grouped lists under small grey labels with totals on the right. The source of that world is MC Bank (the FinPair project's `src/style.css`); this file records how it landed in Pot Filler's own build. **Keep it in step with MC Bank.** When the family's look changes, change it there first and follow it here; never let the two drift into separate identities.

The screen reads as one exact ledger. Each account's shortfall is the headline figure, the pots sit beneath it as a grouped list, and after a run the screen always says what happened in plain words with drawn icons. Density is comfortable, not sparse: rows are 64px tall in a single column no wider than 560px, built for one thumb on an Android phone.

Dark is the default; light is an opt-in per phone (set by `data-theme="light"` on the root before first paint). Both themes are first-class and share every role; only the values move.

**Key Characteristics:**
- Inherited from MC Bank: same palette roles, typeface, radii and list grammar.
- Dark by default, light opt-in per phone; every role defined for both.
- Colour is semantic, never decorative: green acts, amber is owed, teal is in, red has failed.
- Flat tonal layering in dark; a hairline ambient shadow in light.
- One typeface, hierarchy by size and weight, tabular numerals on every money figure.
- Drawn stroke icons on a 24px grid, one family throughout.

## Colors

A graphite (or pale sage) ground with four semantic hues, each owning exactly one meaning.

### Primary
- **Deep Icon Green** (`icon-green`, light theme `icon-green-light`): the colour of the app icon and of action. Fills the main full-width buttons, switches that are on, and the selected **Live** segment, because Live is the one mode in which real money moves. Text on it is always white (`on-green`).
- **Green Ink** (`green-ink`; in light theme it collapses to `icon-green-light`): the readable, lighter green for green *text and lines* on dark: text links, the Live note's shield icon, the "would fill" result icon, the numbered approval steps, the focus ring (at 70% via colour-mix), text selection (32%) and the caret.

### Secondary
- **Owed Amber** (`owed-amber`, light `owed-amber-light`): what pots are still owed. The account's big shortfall figure, each pot's "to go" amount, the "Move £Y to joint first" sum, warning notes, and the Locked chip (amber text on a 16% amber tint).

### Tertiary
- **Filled Teal** (`filled-teal`, light `filled-teal-light`): money in, progress and full. Pot progress bars, the "Full" mark, filled results and their amounts, the "all pots full" tick on a 16% teal tint, success notes.

### Neutral
- **Graphite** (`graphite`): the dark page ground; also the browser theme colour.
- **Graphite Surface** (`graphite-surface`): cards and the pot list.
- **Graphite Raised** (`graphite-raised`): secondary buttons, the segmented track, chips, the confirm sheet in dark.
- **Graphite High** (`graphite-high`): selected segment in dark, switch off, empty progress track, sheet grabber, pressed state.
- **Graphite Separator** (`graphite-separator`): hairlines between rows and above problem and results sections.
- **Mist Text / Mist Text 2 / Mist Text 3** (`mist-text`, `mist-text-2`, `mist-text-3`): primary text, secondary text and labels, and faint text (footers, switched-off pots). Faint text holds at least 4.5:1 on the page, surface and raised surfaces.
- **Light theme** swaps the neutrals one for one: `pale-sage` ground, `paper` surfaces, `paper-raised` and `paper-high` steps, `paper-separator`, and `ink` / `ink-2` / `ink-3` text.
- **Mock Yellow on Mock Ink** (`mock-yellow`, `mock-ink`): reserved for the family's mock/dev banner and nothing else.

### Named Rules
**The Green Means Go Rule.** Icon green marks what you can act on and where real money moves: primary buttons, switches that are on, the selected Live segment, focus. It never decorates, and Practice never wears it (Practice selects in neutral graphite, as MC Bank's segments do).

**The One Meaning Per Hue Rule.** Amber is only money still owed, teal is only money in or full, red is only failure. A pot that is owed reads amber; the same pot once filled reads teal. Never swap them for visual variety.

**The In Step With MC Bank Rule.** These values are MC Bank's. A palette change starts in the family's source and is copied here, never invented here.

## Typography

**Display Font:** Figtree Variable (self-hosted, OFL, weights 300 to 900; fallback system-ui, -apple-system, Segoe UI, Roboto, sans-serif)
**Body Font:** Figtree Variable
**Label/Mono Font:** none distinct; labels are Figtree at a lighter colour and mid weight.

**Character:** One friendly geometric sans carries everything, the same face as MC Bank. Hierarchy comes from size and weight, with tight negative tracking on the large figures and a slightly heavier body weight in dark (450) than in light (400) so text doesn't thin out on graphite.

### Hierarchy
- **Display** (700, 44px, 1.05, -0.035em): the app name on the sign-in screen only.
- **Headline** (700, 30px, 1.15, -0.03em, tabular numerals): the account's shortfall figure in the summary card, and page titles (-0.025em) on the approve and error screens.
- **Title** (600, 17px, -0.012em): notice and problem headings, the "all pots full" line, the confirm sheet total (700), and the header wordmark (700).
- **Body** (450 dark / 400 light, 16px, 1.45): default text and the big buttons.
- **Control** (600, 15px, -0.006em): buttons, results heading, sheet list rows, approval steps.
- **Subhead** (14px): notice and problem body text, notes, segment labels (550), small pill buttons.
- **Label** (550, 13px): group labels ("Personal", "Joint", "Appearance") in grey sentence case with the total right-aligned; also the 13px footnote size for row subtitles, captions and footers.
- **Micro** (600, 11px, +0.01em): chips only, plus the mock banner. Never for body copy.

### Named Rules
**The Tabular Money Rule.** Every money figure uses tabular numerals so amounts align down the list and don't jitter while a run updates them.

**The Shortfall Is The Headline Rule.** On the main screen the largest type is the account's amount owed (headline, amber). Nothing else in the account section is set larger.

## Layout

A single centred column, max 560px wide, with a 20px side gutter and safe-area padding top and bottom. There are no breakpoints: on desktop the same phone column sits centred on the ground. The vertical order is header, Practice | Live control with its one-line meaning, then one group per account (Personal, then Joint), then the Appearance group at the foot.

Rhythm: groups are 30px apart; a grey group label sits 8px above its card; cards pad 18px; pot rows pad 12px by 16px with a 64px minimum; inline gaps are 8px and stacked gaps 12 to 14px. The pot row is a three-column grid (name, subtitle and bar; a fixed 5.75rem amount column; the 51px switch) so amounts and switches align down the list.

**The Thumb Reach Rule.** The account's one action is a full-width 54px button inside its summary card, directly under the figure it acts on, not at the top of the screen.

## Elevation & Depth

Flat by default. In dark, depth is tonal: page, surface, raised and high are four graphite steps and cards carry no shadow. In light, cards take a barely-there ambient shadow so white cards lift off the pale sage ground. The only real elevation is the confirm sheet, which rises from the bottom over a 55% black backdrop. The selected segment in light and the switch knob carry small functional shadows.

### Shadow Vocabulary
- **Card, light only** (`box-shadow: 0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)`): cards and the pot list in light. None in dark.
- **Overlay** (`box-shadow: 0 12px 32px rgb(0 0 0 / 0.5)`; light `rgb(16 24 40 / 0.16)`): the confirm sheet only.
- **Selected segment, light** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.12), 0 0 0 0.5px rgb(0 0 0 / 0.04)`).
- **Switch knob** (`box-shadow: 0 2px 4px rgb(0 0 0 / 0.25)`).

### Named Rules
**The Flat Dark Rule.** In dark, separate surfaces by graphite step, never by shadow or border. Shadows exist for the sheet and small controls only.

## Shapes

Soft, generous corners in a clear ladder: 20px cards and lists, 16px big buttons, 14px standard buttons, 12px segmented track with 9px segments, 6px chips, 2px progress bars, a 24px top-only radius on the bottom sheet, and full pills for small buttons, icon buttons and switches. Borders are not used for containment; the only lines are 1px hairline separators between rows (inset 16px from the left in the pot list) and above problem and results sections.

**The Pill For Small Rule.** Small buttons (36px), icon buttons (44px) and switches are full pills; full-width actions are rounded rectangles. Don't make a big button a pill or a small one a rectangle.

## Components

Every component is MC Bank's form, used for Pot Filler's job.

### Buttons
- **Shape:** standard 14px, big 16px, small and icon buttons full pill.
- **Primary:** icon green, white text, full width, 54px, body size at 600. One per account section.
- **Primary, unavailable:** keeps a readable label: raised graphite with faint text at full opacity, never a 40%-opacity green.
- **Secondary:** raised graphite, 44px. Used, for example, for "Refresh and try again" after a failure, when filling again would just repeat it.
- **Quiet:** transparent with secondary text (Refresh icon button, Sign out, Cancel, Clear).
- **Link:** green-ink text, no fill (Turn it back on).
- **Press / Focus:** press scales to 0.98 and steps the fill up one graphite level in 120ms; primary fades to 85%. Focus is a 2px green-ink ring at 70%, offset 2px. Disabled non-primary buttons drop to 40% opacity.

### Practice | Live segmented control
A raised graphite track (3px inset, 12px) holding two 40px segments. Practice selected reads neutral (graphite high in dark, white with a small shadow in light); **Live selected wears icon green with white text**. Under it, a one-line meaning in footnote grey; in Live it turns to primary text at 550 with a green shield icon. The same control, without the Live variant, is the Dark | Light choice in the appearance card.

### Group label
Small grey label (13px, 550) on the left, the account's available balance or total on the right, 4px inset to align with card content. A `group-footer` line in faint 13px text may follow the card.

### Summary card (with big number)
The account's card: the amber shortfall in headline type, a grey caption ("to fill across 7 pots"), any switched-off line ("1 pot switched off: Gym." with a "Turn it back on" link), then the full-width primary button. When nothing is owed it becomes the "all pots full" line: a teal tick in a 32px tinted circle and a warm 17px sentence.

### Notice card
MC Bank's alert-card form for the joint transfer: a card with a title-size heading carrying the amber sum ("Move £Y to joint first"), a grey 14px explanation, and a row of small raised-graphite pill buttons with 16px icons (Copy amount, Refresh).

### Problem section
Not a box: a hairline-topped section inside the summary card. Red title-size heading with the drawn alert icon, the pot name, a plain-English 14px fix, then the secondary button for the next step.

### Pot list row
A 64px row in a 20px-radius list: name (550) with an optional chip, a grey "£X of £Y" subtitle, a 4px teal progress bar; the right-aligned amount column shows the amber "to go" figure with a grey caption, or a teal check and "Full"; then the switch. A switched-off row turns name, subtitle, amount and bar to faint text.

### Chips
- **Chip:** 11px 600 text on raised graphite, 6px radius, 2px 7px padding, optional 11px icon.
- **Chip-warn:** amber text on a 16% amber tint, used for Locked.

### Switch
51 by 31px pill, raised-high graphite off, icon green on, a white 27px knob that slides 20px in 160ms. Exposed as `role="switch"`.

### Results list
Under a hairline, a heading in control type (teal when everything filled, with a red clause for what didn't go through) and a Clear quiet button; rows of an 18px drawn icon, the pot name (550) with an optional grey or red message, and the amount. Filled is teal, would-fill (Practice) is green-ink, failed is red, skipped and not-tried are faint.

### Drawn stroke icons
One family: 24px grid, 2px stroke, round caps and joins, `currentColor`: refresh, check, alert, arrow, dash, clock, copy, lock, shield, transfer. 20px default, 16px small, 18px in results, 11px in chips.

### Confirm sheet
A bottom sheet (native dialog) up to 560px wide with a 24px top radius, raised graphite in dark and white in light, the overlay shadow and a 55% black backdrop. It rises 24px with a fade in 260ms on `cubic-bezier(0.16, 1, 0.3, 1)`. Contents: a 36 by 5px grabber, a 22px 700 title, a grey lede, a scrolling itemised list between hairlines, a bold total row, then the green "Fill £X" big button over a quiet Cancel.

### Appearance card
At the foot of every screen: an "Appearance" group label, a card with 8px padding holding the Dark | Light segmented control, and the footer "Just for this phone."

### Mock banner
The family's dev/mock marker: a sticky full-width strip in mock yellow with dark ink, 11px 700 uppercase with 0.04em tracking ("Mock data · nothing is real"). It appears only in mock mode and is the one uppercase element in the system.

## Do's and Don'ts

### Do:
- **Do** take every palette, type and radius decision from MC Bank and keep Pot Filler in step with it.
- **Do** define every colour role for both themes; dark is the default and light is opt-in per phone.
- **Do** reserve icon green for actions, switches that are on, focus and the selected Live segment.
- **Do** show money owed in amber, money in and full in teal, and failures in red, nothing else.
- **Do** set every money figure in tabular numerals, with the account's shortfall as the largest figure (30px, 700).
- **Do** use the drawn 24px, 2px-stroke icon family for every icon.
- **Do** separate surfaces by graphite step in dark and by a hairline ambient shadow in light.
- **Do** keep a disabled primary button's label readable (faint text on raised graphite at full opacity).

### Don't:
- **Don't** invent a separate Pot Filler palette, typeface or icon style; it is an MC Bank sibling.
- **Don't** use teal or amber for buttons or selection; green acts.
- **Don't** colour Practice green; only Live wears it.
- **Don't** add a second typeface or fall back to a system display face for headings.
- **Don't** add card shadows or borders in dark mode.
- **Don't** put a failure in a red-filled box; a problem is a hairline section with a red heading and a plain fix.
- **Don't** set section labels in uppercase with tracking; group labels are small grey sentence case. The mock banner's caps are the family's dev marker, not a label style.
- **Don't** use text glyphs or emoji as icons.
