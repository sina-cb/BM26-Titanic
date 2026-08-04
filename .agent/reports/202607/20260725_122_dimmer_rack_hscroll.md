# 20260725_122 — Dimmer Rack: horizontally scrolling fader row

**Agent:** developer (CaptainPad) · **Branch:** feat/bm_readiness · **Status:** done, not committed (no git ops per brief)

## What was wrong

The Dimmer Rack's fader row was a `flexWrap: 'wrap'` flex row inside the
fixed-height card. The titanic scene now exposes **24 dimmer groups**
(engine `GET /dimmer-groups`); at ~112px per fader column that is ~2700px
of row against an iPad's ~950px card width. The row wrapped into multiple
lines and the card clipped everything past the first, so faders below the
fold were unreachable/out of bounds.

## What changed

One file: `CaptainPad/app/(tabs)/dimmer_rack.tsx` (+29/-2).

- **dimmer_rack.tsx:231** — new `faderDragging` state, flipped by the
  faders' existing `onDragStart`/`onDragEnd` props (wired at :481-482).
- **dimmer_rack.tsx:447-455** — the `flexWrap` View is now a horizontal
  `ScrollView` with `scrollEnabled={!faderDragging}` and
  `contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-around',
  alignItems: 'center', gap: 32 }}`. When the row fits, `flexGrow` +
  `space-around` spread the faders exactly as before; when it overflows it
  left-aligns and scrolls. No new chrome: the partially visible fader at
  the card edge is the "more off-screen" affordance (scroll indicator
  hidden, matching the FIXED COLORS chip strip above it).

No knob shrinking, no wrap — `NauticalFader` keeps its fixed 80px column
and 160px track at every group count.

## Gesture-conflict handling

Two layers, matching the mixer's channel-strip precedent (mixer.tsx:2733):

1. `NauticalFader` already **capture-claims** its PanResponder
   (`onStartShouldSetPanResponderCapture` + `onShouldBlockNativeResponder`),
   so a drag that starts on a knob belongs to the knob.
2. Belt-and-braces for iOS, where the native scroll view ignores
   `onShouldBlockNativeResponder`: `faderDragging` hard-disables the
   ScrollView (`scrollEnabled={!faderDragging}`) for the exact duration of
   any knob drag via the fader's `onDragStart`/`onDragEnd` callbacks.

Horizontal pans that start **between** knobs scroll; drags that start
**on** a knob (vertical or diagonal) only move the value.

## Verification

Fresh dist (`npm run web:build`, exit 0) served on **:7167** (operator's
:6967 untouched), against the live titanic engine on :6968 (read-mostly —
see restore note). Puppeteer, single tab, iPad Pro 11" viewport
(1194x834, touch), console muted via `evaluateOnNewDocument` per the
memory technique. Script: scratchpad `dimmer_rack_hscroll_verify.cjs`.

Measured results (all pass):

| Check | Result |
|---|---|
| Row overflows + scrolls | scrollWidth 2680 vs clientWidth 952; programmatic scroll reaches 1728 (full right end) |
| Mouse diagonal drag on knob (up 40px + 20px drift) | value 0.21 → 0.57, `scrollLeft` stayed 0 |
| Touch swipe in the gap between knobs | `scrollLeft` 0 → 340 |
| Touch diagonal drag on knob (up 35px + 25px drift) | value 0.57 → 0.88, `scrollLeft` stayed 0 |
| Horizontal-only touch swipe ON a knob | captured by knob: no scroll, no value change (debug probe) |
| Mouse wheel over the row | scrolls (desktop affordance, debug probe) |

Screenshots (visually inspected — knobs full-size at both ends, partial
fader peeking at the card edge):

- `.agent_renders/dimmer_rack_scroll_left.png` — left end (TE SIGN … RIGHT BACK WALL, 9th peeking)
- `.agent_renders/dimmer_rack_scroll_right.png` — right end (… RIGHT_FRONT_LEFT, partial fader peeking left)
- `.agent_renders/dimmer_rack_knob_dragged.png` — after the mouse knob drag

Note on instrumentation: CDP `Input.synthesizeScrollGesture` does not
scroll anything in this headless env (control test on the pre-existing
FIXED COLORS chip strip also failed) — raw `Input.dispatchTouchEvent`
swipes are the valid touch probe and are what the table above uses.

**Engine restore:** the two knob drags wrote section 3 (TE Sign)
brightness to the live engine; the script diffed `/dimmers` before/after
and POSTed the exact original values back — final diff empty
(`fullyRestored: true`).

## Quality gates

- `npx tsc --noEmit`: pass (exit 0)
- `npx vitest run`: **914 passed / 6 skipped** — exactly baseline, no new failures
- `npm run lint`: dimmer_rack.tsx **clean** (per-file eslint pass). Suite-wide
  there are 4 pre-existing errors in `components/GlobalEffectMacros.tsx`
  (conditional hooks, lines 1263-1281) + 18 warnings — all pre-existing on
  the branch, file untouched by this change.
- `git diff --check -- CaptainPad`: clean
- `npm run web:build`: pass (dimmer_rack route exported)
- No new test added: the CaptainPad test pattern is pure-logic extraction
  (`*_logic.test.ts`); this change is JSX layout + a one-line boolean gate
  with no extractable logic.

## Deferred / flagged

- `GlobalEffectMacros.tsx` conditional-hooks lint errors (pre-existing,
  out of scope) — real `rules-of-hooks` violations worth a follow-up.
- Long group labels (e.g. RIGHT_FRONT_RIGHT) slightly overlap adjacent
  columns at the right end — pre-existing label styling, unchanged by the
  scroll fix.

---

## Addendum (2026-08-03, same day): orientation-responsive 2-row portrait grid

Operator follow-up: *"have the dimmer rack have more than 1 row … on ipad
1 row in horizontal and 2 rows in the vertical looks good"*.

### What changed (same file, `dimmer_rack.tsx`)

- **:207-208** — `useWindowDimensions()` + `isPortrait = width < height`,
  the exact idiom CPCControls (:85-86) and the mixer already use.
- **:311-319** — `faderColumns`: group entries chunked column-wise,
  `perColumn = isPortrait ? 2 : 1`. Landscape stays 1 fader per column
  (renders identically to the original single row); portrait stacks 2 per
  column, halving the scroll distance.
- **:471-478** — the ScrollView children are now these columns (inner
  `View` per column, `flexDirection: 'column'`, gap 24); each fader cell
  is byte-identical JSX to before. Still ONE horizontal ScrollView — all
  _122 guarantees (capture-claim + `faderDragging` scroll gate, peek
  affordance, `scrollEnabled={!faderDragging}`) apply unchanged to both
  layouts since none of that moved.

### Verification (fresh dist on :7167, operator's :6967 untouched)

Script: scratchpad `dimmer_rack_orientation_verify.cjs` (same console-mute
+ single-tab technique; pages opened sequentially, one at a time).

| Check | Landscape 1180x820 | Portrait 820x1180 |
|---|---|---|
| Rows of fader tracks | **1** | **2** (visual; measured tops 569 / 824-840) |
| Overflow / full scroll | 2680 vs 938 → 1742 | **1340** vs 578 → 762 (scroll distance halved) |
| Vertical scroll leak | none | none (scrollHeight 749 == clientHeight 749) |
| Mouse diagonal knob drag | — (covered in _122) | value 0.21 → 0.57, scrollLeft frozen at 0 |
| Touch swipe in gap | — | scrollLeft 0 → 344 |
| Touch diagonal knob drag | — | value 0.57 → 0.88, scrollLeft frozen at 0 |
| Engine restore | section 3 restored to exact original, `fullyRestored: true` | (same run) |

Screenshots (visually inspected — full-size knobs, both ends, peek
affordance intact): `.agent_renders/dimmer_rack_landscape_{left,right}.png`,
`.agent_renders/dimmer_rack_portrait_{left,right}.png`.

The 824 vs 840 row-top split within portrait row 2 is per-fader center
alignment with 1-line vs 2-line labels — the same ±16px raggedness the
landscape row has always had (visible in the _122 screenshots), not a
third row and not a regression.

### Gates (re-run after the addendum change)

- `npx tsc --noEmit`: pass · `dimmer_rack.tsx` eslint: clean ·
  `npm run web:build`: pass
- `npx vitest run`: **914 passed / 6 skipped** — baseline held.

### Live-stack observation (not a UI bug — flagged for the operator)

During portrait verification most section faders displayed the `?? 1.0`
default. Traced, not assumed: the live engine's `/dimmer-groups` now maps
the wall/stack/rail groups to section ids **500+** (operator loaded a
newer titanic model since the morning run), while `/dimmers` still holds
persisted brightness only for the OLD ids 486-498. Sections without
stored state correctly default to 1.0 (sections 3 and 18, which do have
state, display 0.21 / 0.11). The repo's checked-in `titanic.js` still
produces 486-499 — the running engine's model is newer than the tree.
Stale `/dimmers` keys for remapped sections may deserve an engine-side
migration/cleanup pass.
