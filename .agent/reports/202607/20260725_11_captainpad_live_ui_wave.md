# 2026-07-25_11 — CaptainPad live-performance UI wave (plan _9 implemented)

**Role:** developer (implementation of the approved plan
`.agent/reports/202607/20260725_9_captainpad_live_ui_plan.md`).
**Branch:** `feat/bm_readiness` (working tree — no git operation run; commits
are operator-gated).
**Order shipped:** 6 → 1 → 3 → 5 → 2 → 4, exactly as the plan's table
prescribes.

**Environment rules honored**
- Metro `:6967` (operator-owned, hot-reloading his live iPad) was never
  launched, killed, or reconfigured. Every item was left compile-clean:
  `npx tsc --noEmit` ran green after each one before starting the next.
- Verification ran against a **fresh `npx expo export --platform web` dist
  served on `:7167`** — never Metro (this box serves stale bundles; see
  memory `metro-stale-watcher`).
- Live data came from the show-machine engine `http://10.x.x.151:6968`
  (read-only use: the app subscribed and rendered; no destructive POSTs).
- No sub-agent was spawned into `CaptainPad/**`.

**Test totals:** baseline 790 passing / 6 skipped (37 files) → **797 passing
/ 6 skipped (37 files)** after adding the 7 `chunkStripPages` cases.
`npx tsc --noEmit` clean at the end.

---

## Item 6 — AUDIO tab: reload on focus (latched-failure fix)

**Files:** `CaptainPad/app/(tabs)/audio.tsx` (~:1158-1180).

**Diff summary:** `reload()` gained an `inFlightRef` guard (`if
(inFlightRef.current) return;` … `finally { inFlightRef.current = false; }`),
and a `useFocusEffect(useCallback(() => { if (!cfg) void reload(); }, [cfg,
reload]))` was added beside the existing mount effect. `useFocusEffect` and
`useRef` were already imported. Exactly the _8 report's recommendation, no
deviation.

**Behavior:** a failed `GET /audio/config` no longer latches "AUDIO CONFIG
UNAVAILABLE" until an app reload — leaving and re-entering the tab retries.
The gate is `!cfg`, so it also recovers from the stuck-spinner state. This is
a **retry, not a fallback** (codex P0): a failing refetch re-renders the same
loud error. The RETRY button still works and is now mash-safe.

**Verification:** `tsc --noEmit` clean; full vitest suite unchanged (790 at
that point).

---

## Item 1 — remove the SIZE global from the GLOBALS bar

**Files:** `CaptainPad/components/CPCControls.tsx`.

**Diff summary (UI-only, all four plan points):**
1. Deleted the SIZE `<View>` + `<MiniFader label="SIZE" …>` block (was
   `:363-365`).
2. Deleted the `size` prop passed to `CollapsedGlobalsSummary` (was `:322`),
   the `size` entry in its destructuring + prop type (was `:1111-1114`), and
   the `<CollapsedReadout label="SIZE" …>` line (was `:1122`).
3. Removed `size: 0.5` from `defaultParams` (was `:89`), replaced by a note
   recording why it is absent.
4. Refreshed six stale comments that still described a SPEED/SIZE pair.

**Not touched** (as the plan requires): the engine `size` CPC param, the
`GlobalParams` "MATCHED · SIZE" badges, `mft.yaml`, `knob_page.ts`.

**Acknowledged side effect:** global `size` is now MIDI/script/engine-default
only — there is no touch control to fix a stale non-0.5 value. Per the plan we
did **not** write a reset (that would be a behavior change, not a removal).

**Verification:** `tsc --noEmit` clean. Frees ~98pt of portrait row width,
which item 5 then spends.

---

## Item 3 — pattern rows: whole row is the tap target

**Files:** `CaptainPad/components/PlaylistPanel.tsx`.

**Diff summary (all five plan points):**
1. The entry-row container `View` (was `:1493`) is now a `Pressable` with
   `onPress={() => handleEntryTap(e.id)}`, `disabled={missing || disabled}`,
   `accessibilityRole="button"`, an accessibility label naming the pattern,
   and `accessibilityState={{ disabled, selected: isActive }}`. Every existing
   style is preserved; the style became a `({ pressed }) => ({ … })` function.
2. The name `TouchableOpacity` (was `:1570`) is demoted to a plain
   `<View style={{ flex: 1 }}>` — its `onPress`/`disabled` moved to the row.
3. hitSlops trimmed now that the row itself selects: remove `−` 12 → 6,
   both reorder chevrons 8 → 6 (they keep comfortable targets via their own
   `sz.btnH` boxes plus the row min-height).
4. Pressed feedback: `opacity: missing ? 0.4 : (pressed ? 0.6 : 1)`, so a
   registered tap is visible even while the deck soft-swap POST is in flight.
5. The stale "the entry's TouchableOpacity spans the full row" comment (was
   `:1160-1166`) rewritten to describe the Pressable row.

**Behavior:** the index badge, the MIDI pad chip, the row padding, the gaps
around the line-2 controls, and — the operator's actual complaint — the extra
height performance mode adds "for touch" are all live tap area now. Nested
`TouchableOpacity`s (chevrons, `−`) still win the responder, so reorder/remove
are unaffected. `Pressable` cancels on move, so a drag that starts on a row
still scrolls the list. Shared by deck panes, mixer strips and overlays — one
change fixes all of them.

**Verification:** `tsc --noEmit` clean; rows render and select in the deck and
mixer captures below. No unit-test change needed (the plan said none).

---

## Item 5 — mixer GLOBALS, portrait: two rows (operator picked the two-row option)

**Files:** `CaptainPad/components/CPCControls.tsx`.

**Diff summary:**
- The six globals tiles are now built **once** as nodes before the return —
  `speedCluster`, `colorsTile`, `queueTile`, `tapTile`, `bpmTile`, `oscTile` —
  so portrait and landscape stack the same controls with zero duplicated JSX
  (a tile can't drift between orientations).
- Expanded body branches three ways (`:421`): collapsed summary → **portrait
  two rows** (`:432`) → **landscape single row** (`:460`).
  - Row A: SPEED+SYNC · COLORS · QUEUE · GROUPS.
  - Row B: TAP · BPM · OSC, with a trailing `flex: 1` spacer so the tempo
    tiles stay left-aligned under row A instead of stretching.
- `faderMaxWidth` (portrait 90) deleted; the SPEED cluster carries
  `minWidth: 120` in portrait and is uncapped in both orientations.
- The mixer-only `trailing` GROUPS node moves **into the end of row A** in
  expanded portrait; the outside slot is now guarded with
  `trailing && (!isPortrait || globalsCollapsed)` so it can never render
  twice. Collapsed portrait and all landscape keep GROUPS outside, as before.
- Landscape's single row is otherwise byte-identical (same gap, same order,
  OSC last).

**Verification:** `mixer_portrait.png` shows the two clean rows with GROUPS
seated at the end of row A and no right-edge clipping;
`mixer_landscape.png` shows the unchanged single row with GROUPS outside at
the far right. Deck portrait inherits the same two-row layout without GROUPS
(`deck_portrait.png`). `tsc --noEmit` clean.

---

## Item 2 — deck horizontal: pattern column halved — **PLAN DEVIATION (operator reversal)**

**Files:** `CaptainPad/app/(tabs)/index.tsx`.

**What the plan said:** cut PATTERNS to `flex: 2` **and** merge PARAMETERS +
AUTOPILOT into one `flex: 8` ScrollView so they stack vertically, collapsing
`SectionHost` to an always-`View`.

**What shipped:** the `flex: 2` pattern column only. **The operator tested the
stacked variant on his iPad mid-wave and reversed it** — he wants PARAMETERS
and AUTOPILOT side by side. The stacked structure was fully reverted:
`ColumnsScrollRest`'s wide branch is a Fragment again, `SectionHost` is
`ScrollView`-in-wide / `View`-in-narrow again, and both column wrappers are
back. Only the weights differ from origin:

| Column | Was | Now |
|---|---|---|
| PATTERNS | `flex: 4` (40%) | **`flex: 2` (20%)** |
| PARAMETERS | `flex: 3` (30%) | **`flex: 4` (40%)** |
| AUTOPILOT & SETTINGS | `flex: 3` (30%) | **`flex: 4` (40%)** |

Both non-pattern columns therefore *gained* 10 points of width from the cut.
The column-weight comment block and the stacked-layout note were rewritten to
describe 20/40/40 and to record the reversal so the next reader doesn't
re-attempt the stack. The narrow/portrait path is **literally identical to
origin** — `git diff` on this file is six hunks: five comments plus the three
flex numbers.

**Reported portrait regression — investigated, not reproducible.** While the
stacked variant was briefly on disk the operator reported that the deck
portrait pattern list had vanished. On the fresh dist at iPad-10" portrait
(820×1180) the list renders normally (`deck_portrait.png`, four entries
visible). The stacked variant changed the **identity of two component-typed
values** across a Fast Refresh (`SectionHost` ScrollView→View,
`ColumnsScrollRest` Fragment→ScrollView); RN-web Fast Refresh can leave a
stale/blank subtree after that, which fits the symptom and clears on a hard
reload. It is moot either way — the structure is reverted. Recommend the
operator do one **hard** reload (not just a refresh) on the iPad.

**Truncation note (the plan's open question):** at 20% the pattern names
tail-ellipsize in landscape ("00_golden_hour_w…"). Visible in
`deck_landscape.png`. The single knob is the PATTERNS flex (2 → 2.5 = 25/75),
documented in-file.

**Verification:** `tsc --noEmit` clean; `deck_landscape.png` +
`deck_portrait.png`.

---

## Item 4 — effects strip: stable single line; portrait pager

**Files:** `CaptainPad/components/GlobalEffectMacros.tsx`,
`CaptainPad/components/global_effect_macros_logic.ts`,
`CaptainPad/components/global_effect_macros_logic.test.ts`.

**Diff summary:**
1. **Single-line labels in the strip.** `SlotButton` gained a
   `labelLines?: number` prop (default 2) driving `numberOfLines`;
   `GlobalEffectMacros` passes `labelLines = isStrip ? 1 : 2`, so the deck
   grid keeps its 2-line wrapping and the strip is one line with
   `ellipsizeMode="tail"`. The 2-line `'Global\nEffects'` in-row label became
   one-line `'FX'` (the plan's first option — kept rather than dropped so the
   bar stays identified). Strip chip height 60 → 48 in portrait (it now
   matches landscape); the bottom bar gets 12pt back.
2. **Portrait pager, client-side view state only.** New
   `const [stripHalf, setStripHalf] = useState(0)` in `GlobalEffectMacros`
   plus a pure `chunkStripPages(slots, size)` in
   `global_effect_macros_logic.ts`. The engine's `effectsPage` is untouched
   and `SHOW_EFFECT_PAGES` stays `false` — this only decides which 4 of the 8
   visible slots are on screen.
   - The portrait `ScrollView` + fade peek is **gone**. The row is now:
     `FX` · badges · `‹` · four `flex: 1` chips · `›` · divider · BLACKOUT.
   - Arrows render on **both** sides always (stable geometry), 32×`btnHeight`
     chip-styled, `hitSlop 8`, dimmed to 0.3 + `disabled` at the ends,
     `accessibilityLabel` "Show effects 1–4" / "Show effects 5–8".
   - `half` is clamped against the real page count, so an engine-driven slot
     change can't strand the view on a dead page. `chunkStripPages` throws on
     a non-positive size rather than silently correcting it (no fallbacks).
   - Divider + BLACKOUT stay pinned outside the pager, so the QA-round10
     "e-stop never scrolls off" invariant is now trivially true — nothing
     scrolls at all.
3. **Landscape** keeps the flat 8×`flex: 1` row; with single-line labels it is
   the requested stable single line. No pager.
4. **Tests:** 7 new `chunkStripPages` cases (exact 4+4 split of the 8 visible
   slots, page count, no padding of a short last group, empty input → no
   pages, size ≥ length, no input aliasing, throws on size ≤ 0).

**Verification:** `effects_strip_portrait.png` (slots 1-4, `‹` dimmed, `›`
live), `effects_strip_portrait_page2.png` (after clicking `›`: slots 5-8, `‹`
live, `›` dimmed, BLACKOUT and the FX label in exactly the same pixels),
`effects_strip_landscape.png` (all 8 on one line + BLACKOUT). Long names
tail-ellipsize in landscape ("Iceberg Fla…", "Cosmic Tra…") — the accepted
tradeoff from the plan's ambiguity list; portrait's 4-up chips show them in
full.

---

## Verification evidence

Fresh `expo export` dist served on `:7167`, captured with puppeteer at
**iPad 10-inch** viewports (820×1180 portrait, 1180×820 landscape), engine
`http://10.x.x.151:6968` supplying live data. Console was muted before boot
(memory `captainpad-screenshot-technique`) or captures time out. Every PNG was
visually inspected before this report was written.

| File | Shows |
|---|---|
| `~/tmp/captainpad_ui_wave/deck_portrait.png` | Deck portrait — pattern list visible (regression proof), two-row GLOBALS, no SIZE fader |
| `~/tmp/captainpad_ui_wave/deck_landscape.png` | Deck landscape — 20% PATTERNS, PARAMETERS + AUTOPILOT side by side |
| `~/tmp/captainpad_ui_wave/mixer_portrait.png` | Mixer portrait — two-row GLOBALS with GROUPS at the end of row A |
| `~/tmp/captainpad_ui_wave/mixer_landscape.png` | Mixer landscape — unchanged single-row GLOBALS, GROUPS at the far right |
| `~/tmp/captainpad_ui_wave/effects_strip_portrait.png` | Strip portrait, half 1 — 4 chips + `‹`(dim) `›`(live) + pinned BLACKOUT |
| `~/tmp/captainpad_ui_wave/effects_strip_portrait_page2.png` | Strip portrait, half 2 — slots 5-8, arrow states flipped, geometry identical |
| `~/tmp/captainpad_ui_wave/effects_strip_landscape.png` | Strip landscape — 8-up single line + BLACKOUT |

Capture script (outside the source tree, per the temp-files rule):
`~/tmp/captainpad_ui_wave/capture.cjs`.

**Not verified by screenshot:** the live×edit distinction. Perf lock ("live")
only changes row sizing inside `PlaylistPanel` and dims the `⋯` swap
affordance — both captures above were taken with PERF engaged on the
engine, and neither item changes lock semantics: every control kept its own
`disabled` wiring, and the new pager is display-only state of the same class
as the CPC collapse chevron.

## Honesty notes

- No git operation was run. `marsin_engine/states/**` residue in the working
  tree is pre-existing engine runtime state, not from this wave.
- The only deviation from plan _9 is item 2's stacked layout, reversed by the
  operator mid-wave (documented above with the shipped weights).
- Two operator-choice ambiguities in item 4 were resolved as: keep a one-line
  `FX` strip label (rather than dropping it), and accept tail-ellipsis on long
  landscape names (rather than auto-shortening to the first word).
- The `:7167` static server was still running when this report was written; it
  is a separate process on a non-conflicting port and never touched `:6967`.

---

# ROUND 2 — operator live-testing follow-ups (same session, 2026-07-27)

Same process and constraints as round 1: Metro `:6967` untouched, every item
`npx tsc --noEmit` clean before the next one started, verification on a fresh
`expo export` dist served on `:7167` at iPad-10 viewports (820x1180 /
1180x820) against the show engine `http://10.x.x.151:6968`, no git operations.

**Test totals:** 790 (session baseline) → **798 passing / 6 skipped (37
files)**: +7 `chunkStripPages` (round 1) and +1 pinning the round-2 perf-sizing
ruling. `tsc --noEmit` clean at the end.

## Deck column weights — final answer: the ORIGINAL 40/30/30

`app/(tabs)/index.tsx`. The operator iterated live: halve PATTERNS (flex 4→2)
→ also stack PARAMETERS over AUTOPILOT → reverse the stack → reverse the cut
(20% truncated pattern names too hard). **Net effect of item 2 on shipped
layout: none** — PATTERNS 4 / PARAMETERS 3 / AUTOPILOT 3, side by side,
portrait untouched. The full journey is recorded in the column-weights comment
(`:942`) and at the PATTERNS style so nobody re-litigates it. Re-captured
`deck_landscape.png`.

## R2-1 — deck landscape: MASTER slider missing

**Not caused by the item-5 refactor.** `components/DeckTopBar.tsx` had *zero*
diff from HEAD, and the master fader never lived in `CPCControls` — the node
refactor could not have dropped it. Measured root cause on the dist: the
header is two clusters in a `space-between` row with **no shrink anywhere**, so
at 1180pt the right cluster ran from x=622 to **x=1327** — the fader and its
`92` readout sat 147pt past the right edge.

**Fix:** the left cluster (brand / CONNECTED / MODEL / MIDI / health) becomes
the yielding side — `flex: 1, minWidth: 0, overflow: 'hidden'` — and the right
cluster gets `flexShrink: 0` so MASTER can never be what clips. Within the left
cluster the shrink is *routed*: brand and the connection badge are pinned
`flexShrink: 0` (a wrapping brand made the whole header two lines tall), and
the MODEL chip absorbs it via `flexShrink: 1` since it already tail-truncates.

**Verified:** MASTER now at x=862-908 with fader + readout fully on screen;
`deck_landscape.png` re-captured and inspected.

## R2-2 — mixer title bar: one row in landscape

`app/(tabs)/mixer.tsx`, plus a `compact` prop on two shared components.
Measured first: the two clusters wanted **~1620pt inside ~1014pt** of usable
width, which is why the right cluster carried `flexWrap: 'wrap'` (a deliberate
QA-round1 fix). Nothing was dropped; every element was compressed:

| Lever | Before | After |
|---|---|---|
| right cluster wrap | `wrap` | `nowrap` + `flexShrink: 0` (landscape only) |
| left cluster | rigid | `flex:1, minWidth:0, overflow:hidden` (landscape only) |
| `MasterFadeGroup` | 5 duration pills (334pt) | new `compact` prop → the existing cycler (207pt); every duration still reachable by tapping through |
| `PerformanceModeControl` | "PERFORMANCE" | its existing compact "PERF" chip |
| `SnapshotBar` | "LOOKS" + RECALL + "+ CAPTURE" | new `compact` prop: caption dropped, "+ SAVE"; **both buttons kept** |
| connection label | "CONNECTED" | "LIVE" in landscape — **"OFFLINE" keeps its full word in both orientations** (QA round-10 fix #1 preserved) |
| MODEL chip | "MODEL" + name | name only, `maxWidth 110`, truncates last |
| master fader | 160pt | 110pt |
| "+ FROM PLAYLIST…" | full | "+ PLAYLIST" (same action) |
| brand / gaps | 20pt / 12-16 | 14pt / 6-8 |

**Result (measured):** header height **80 → 48pt**, one row, left cluster
136→528 with its children ending at 519 (no clipping — LOOKS fully visible,
"test_bench" fully readable), right cluster ending at 1156 < 1180.

**Portrait regression caught and fixed mid-item:** the first pass applied the
shrink + `overflow:hidden` in *both* orientations. Portrait's right cluster then
stopped wrapping, squeezed the left cluster, and `overflow:hidden` **hid the
connection badge and model chip**. Every R2-2 change is now landscape-gated;
portrait keeps its two-row header with all elements
(`mixer_titlebar_portrait.png`).

## R2-3 — performance mode: pattern rows 30% smaller

`components/playlist_row_sizing.ts` (+ its test). Perf-mode tokens cut to ×0.7:
`rowMinHeight` 78/88 → **55/62** (−29% / −30%), `rowPadY` 12/14 → 8/10,
`rowPadX` 10/12 → 7/8, `rowGap` 5/6 → 4.

**One deliberate clamp:** a straight ×0.7 drove the *text* below the
**edit-mode** values (compact name 16→11 vs edit 13; sub 12→8 vs edit 9), i.e.
the live show would render smaller type than the editing surface. Fonts and the
index column are therefore **floored at the edit-mode values** (name 13,
sub 8/9, index 16/20) while the row *box* takes the full 30% cut — which is
what "buttons/rows 30% smaller" asks for. Edit mode is byte-for-byte untouched.
This cut is safe specifically because round-1 item 3 made the **whole row** the
tap target, so a smaller box is still an easy hit.

Tests: the "≥1.7× taller" contract became "≥1.2×", and a new case pins the
exact token values so a future tweak can't silently re-inflate live rows.

**Verification limit (honest):** the smaller live rows were verified by unit
test and code path, **not** by screenshot — the engine was not in performance
mode during capture, and forcing perf mode on the operator's live rig is a
structural state change I will not make. The same applies to R2-5's toast.

## R2-5 — FX bar: locked warning off the layout, onto a toast

`components/GlobalEffectMacros.tsx`. The inline `<ModeBadge>` ("LOCKED —
performance mode") was a permanent ~150pt pill inside the strip row, stealing
width from the effect chips for a whole show.

- The **strip** no longer renders it (`modeBadge && !isStrip`). The deck-grid
  variant keeps it — it has its own header line and no width pressure.
- New transient toast: `position: absolute`, `bottom: '100%'`, `pointerEvents:
  'none'`, `zIndex 40` — **zero layout cost**, anchored left so it never covers
  the pinned BLACKOUT e-stop, auto-dismissing after 2.2s (timer cleared on
  unmount).
- It fires **on the tap**, which required un-`disabled`ing the two locked
  affordances: `⋯` (swap) and the "+" empty socket now call `onLockedTap`
  instead of being inert. They stay dimmed and `accessibilityState.disabled`,
  and the mutating path is still never reached — the tap only flashes the
  message. This is the point: a `disabled` button swallows the tap silently,
  which *is* the "why did nothing happen?" the banner used to answer.
- Wording keeps the badge's text plus the reason: "LOCKED — performance mode —
  effect swaps are disabled during a show". `modeBadge()` remains the single
  source of the wording.

**Other inline-warnings-that-cost-layout found (as asked), left alone:**
1. `components/CPCControls.tsx:276-288` — "⚠ BPM SYNC ON · NO TEMPO", a
   full-width banner row above the globals row. **This is my prime suspect for
   R2-4** (see below).
2. `GlobalEffectMacros.tsx` `DeployErrorBanner` — dismissible VSN1 deploy
   failure strip. Kept: a real failure needing acknowledgement, not a mode
   indicator.
3. `components/PlanLockBanner.tsx` — already a floating overlay with zero row
   width; it is the precedent this toast follows.

## R2-4 — portrait globals "extra row": CANNOT REPRODUCE

Measured DOM boxes, mixer portrait, at **820x1180 and 768x1024**:

| | row A | row B | audio row |
|---|---|---|---|
| box | t78 → b118 (40pt) | t124 → b164 (40pt) | t170 → b199 (29pt) |
| right edge @820 | 810 (container 814) | 810 | — |
| right edge @768 | 758 (container 762) | 758 | — |

Exactly the approved two rows, no overflow, and **wrapping is structurally
impossible** — both rows are `flexWrap: 'nowrap'`. The `minWidth: 120` on the
SPEED cluster is nowhere near binding (it gets ~340pt). So no tile is "too
wide".

Two candidates for the third row he is counting, neither guessed at blind:
**(a)** the AUDIO signal-meter row — a separate, pre-existing 29pt row of the
same bar, unrelated to this wave; **(b)** the `bpmSyncStale` warning banner
above row 1, which appears only when SYNC is armed with no tempo — exactly the
"inline warning eating a row" class he is objecting to in R2-5, and absent from
every capture because SYNC was off. I did not toggle SYNC on the live engine to
force it. **Awaiting his answer before changing anything here.**

## Round 2 verification artifacts

Re-captured into `~/tmp/captainpad_ui_wave/` (all visually inspected):
`deck_landscape.png` (MASTER visible + 40/30/30), `deck_portrait.png`,
`mixer_landscape.png`, `mixer_portrait.png`,
`mixer_titlebar_landscape.png` (one row, nothing clipped),
`mixer_titlebar_portrait.png` (two rows, all elements present),
`effects_strip_portrait.png`, `effects_strip_landscape.png`.
Diagnostic scripts: `measure.cjs`, `probe_globals.cjs`, `probe_header.cjs`.
