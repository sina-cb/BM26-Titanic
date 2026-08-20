# 2026-07-25_9 — CaptainPad live-UI quirks: implementation plan (5 operator items + audio focus fix)

**Role:** planner (read-only investigation → implementation brief).
**Trigger:** operator (Sina), live on the iPad, reported 5 UI quirks during show
testing; item 6 carried over from `20260725_8_audio_tab_native_fix.md` §5.
**Constraint honored:** NO CaptainPad file was touched — Metro on :6967 is
hot-reloading the operator's live iPad. This report is the only artifact.
**Executor:** an Opus implementation agent, after operator approval. Every item
below states behavior in all four combos: {vertical, horizontal} × {live, edit}.
"Live" = performance mode engaged (`usePerfLock()` true → structural edits
409-gated, playlist rows boosted); "edit" = normal mode. The soft PLAN lock
(`planGate`) is orthogonal and untouched by every item here.

**Ops rule for the implementer:** do not let Metro on :6967 pick up unverified
edits. Work on a branch, verify with `npx tsc --noEmit` + `npm test` +
`npm run web:build` + a local static serve on a DIFFERENT port (never :6967),
screenshot portrait+landscape, then hand to the operator for a deliberate reload.

---

## Item 1 — remove the SIZE global from the GLOBALS bar

**Current code / root cause:** the global parameter bar is `CPCControls`
(`CaptainPad/components/CPCControls.tsx`), rendered by both tabs
(deck `app/(tabs)/index.tsx:863`, mixer `app/(tabs)/mixer.tsx:2629`). SIZE
appears in three places:
- expanded row fader: `CPCControls.tsx:363-365` (`<MiniFader label="SIZE" …>`),
- collapsed summary readout: `CPCControls.tsx:1122` (+ `size` prop at
  `:322`, `:1111-1114`),
- subscription default: `defaultParams.size` at `:89`.

**Proposed change (UI-only — the engine `size` CPC param stays):**
1. Delete the SIZE `<View>`+`<MiniFader>` block at `:363-365`.
2. Delete the `CollapsedReadout label="SIZE"` line at `:1122`, the `size` prop
   at `:322`, and `size: number` from `CollapsedGlobalsSummary` props
   (`:1111-1114`).
3. Remove `size: 0.5` from `defaultParams` (`:89`) — it becomes dead weight.

Do NOT touch: the engine CPC schema, `GlobalParams` "MATCHED · SIZE" badges
(`components/GlobalParams.tsx:223-231` — they read `cpcOwned` from the engine
and stay correct), the MIDI profile (`mft.yaml` can still drive `size` via
`paramCenterRelative`), or `knob_page.ts` (SIZE was never a row-0 knob —
verified: only `speed`/`hue` are assigned, `utils/midi/knob_page.ts:44-49`).

**Behavior per combo:** identical removal in portrait and landscape (both
render the same row; landscape just uncaps fader widths). Live×edit: the
fader was gated only by `disabled` (plan lock); removing it changes nothing
about lock semantics. Side effect (deliberate, flag to operator): after this,
global `size` is only changeable via MIDI/scripts/engine default — if a stale
non-0.5 value is lit, the operator has no touch control to fix it. If that is
a concern, ship with a one-time manual reset; recommend: leave engine state
as-is (a reset write is a behavior change, not a removal).

**Risk:** trivial. Frees ~98pt of portrait row width (feeds item 5).

---

## Item 2 — deck HORIZONTAL: pattern list −50% width, params+autopilot stacked

**Current code:** `app/(tabs)/index.tsx`. Wide (landscape ≥900pt,
`isWide` at `:183`) renders a 3-column row pinned to 40/30/30:
- col 1 PATTERNS `flex: 4` (`:999-1000`),
- col 2 PARAMETERS `flex: 3` (`:1075`),
- col 3 AUTOPILOT & SETTINGS `flex: 3` (`:1223`),
with `ColumnsScrollRest` (`:126-137`) a Fragment in wide mode (cols 2+3 are
independent `ScrollView`s via `SectionHost`, `:193-196`) and a page-scroll
wrapper in the narrow stack.

**Proposed change (wide mode only — the narrow/portrait stack is already
"patterns pinned, params+autopilot stacked and scrolling together" and is NOT
touched):**
1. Col 1: `{ flex: 4 }` → `{ flex: 2, minWidth: 0 }` at `:1000`
   (40% → 20% of the row = the requested ~50% width cut).
2. Make cols 2+3 ONE stacked scroll column: change `ColumnsScrollRest`'s wide
   branch from a Fragment to
   `<ScrollView style={{ flex: 8, minWidth: 0 }} contentContainerStyle={{ padding: 16, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>{children}</ScrollView>`.
3. With the shared scroll host in place, `SectionHost` must become a plain
   `View` in wide mode too (a nested same-axis ScrollView inside a ScrollView
   is the exact zero-height/party-bug class this file already documents at
   `:189-196`). Concretely: collapse `SectionHost` to always-`View`,
   `sectionHostProps` → `{ style: { paddingBottom: 16 } }` in wide mode
   (keep the current narrow props), and drop the per-column `flex:3` wrappers
   (`:1070-1076`, `:1217-1224`) — the two sections become content-height
   children stacked vertically (PARAMETERS card first, then AUTOPILOT /
   COLOR AUTOPILOT / OVERLAYS), which is exactly "params and autopilot
   stacked on top of each other".
4. Update the column-weight comment block (`:931-945`): 20/80.

**Behavior per combo:** Horizontal: 2-region layout (narrow patterns list |
wide stacked params+autopilot, one scroll). Vertical: byte-identical to today
(pinned patterns panel at `:1001-1004` + `ColumnsScrollRest` narrow branch
unchanged). Live: perf mode only changes row sizing inside PlaylistPanel —
unaffected. Edit: same. Plan lock: the `PlanLockScrim` blankets the same
region wrapper (`:861`, `:1359`) — unaffected.

**Ambiguity for the operator:** exact split — plan says `flex 2 / 8` (20/80).
If pattern names truncate too hard at 20%, the single knob is col 1's flex
(2 → 2.5 = 25/75). Pick one, or accept 20/80 + live nudge.

**Risk:** medium-low. The one structural hazard (nested vertical ScrollViews)
is designed out in step 3. Verify pattern-name truncation at 20% via web-build
screenshots before handoff.

---

## Item 3 — pattern rows: taps don't always register

**Root cause (found — a real dead-zone bug, not flake):** in
`components/PlaylistPanel.tsx` the row *looks* like one button (bordered,
tinted container `:1493-1527`) but the ONLY tap target that selects the
pattern is the name `TouchableOpacity` at `:1570-1574` (`style={{ flex: 1 }}`),
which spans just line 1's leftover width. Dead (non-tappable) regions of the
visual button:
- the `02` index badge (`:1530-1539`) and the MIDI pad chip (`:1546-1568`),
- the row's own padding (`rowPadX/rowPadY`) and the 2pt gap,
- ALL of line 2 (the reorder/remove sub-row, `:1629-1706`) in edit mode,
- **live mode is worse:** performance mode hides line 2 and boosts the row via
  `playlistRowSizing` (`:1203`, `components/playlist_row_sizing.ts`) with
  `rowMinHeight` + `justifyContent:'center'` (`:1510-1511`) — the row grows
  ~70% taller "for touch", but the added height is dead space around the
  content-height line 1. The comment at `:1160-1166` claiming "the entry's
  TouchableOpacity spans the full row" has been stale since the 2-line layout
  (2026-06-20).
- The "weirdness": in edit mode the remove button's `hitSlop 12` (`:1691`) and
  the chevrons' `hitSlop 8` (`:1641`, `:1661`) silently annex the dead zone
  around them, so a near-miss "select" tap can fire move/remove instead.
  Additionally `disabled={missing || disabled}` (`:1572`) swallows taps during
  a deck soft-swap (`deckSwapInFlight`, `index.tsx:1043`) with only a 0.55 dim
  (`:1463`) as feedback — reads as "tap didn't register".

**Proposed change:**
1. Make the WHOLE row the tap target: convert the row container `View`
   (`:1493`) to a `Pressable` with `onPress={() => handleEntryTap(e.id)}`,
   `disabled={missing || disabled}`, keeping every existing style. Nested
   `TouchableOpacity`s (chevrons, −) win the responder over the outer
   Pressable — standard RN precedence — so line-2 controls keep working.
2. Demote the name `TouchableOpacity` (`:1570`) to a plain
   `View style={{ flex: 1 }}` (its onPress/disabled move to the row).
3. Trim the annexing hitSlops now that the row itself selects:
   remove-button `hitSlop` 12 → 6 (`:1691`), chevrons 8 → 6. The controls keep
   ≥44pt effective targets via their own boxes + the row min height.
4. Pressed feedback:
   `style={({ pressed }) => [rowStyle, pressed && { opacity: 0.6 }]}`
   so a registered tap is visible even while the swap POST is in flight.
5. Fix the stale comment at `:1160-1166`.

**Behavior per combo:** this component is shared by deck panes (both split
panes), mixer strips, and overlays — the fix applies everywhere. Vertical &
horizontal: identical (row layout doesn't branch on orientation). Live: the
boosted full-height row becomes fully tappable — the primary complaint.
Edit: line 1 + padding + the gaps around line-2 controls select; the
chevron/− glyphs still do their own thing. Swap-in-flight / plan-lock gating
unchanged, but pressed feedback no longer lies.

**Risk:** medium-low. One on-device check: a touch that starts on the row and
drags must scroll the list without firing onPress (Pressable cancels on move
by default — expected OK). No unit-test changes needed.

---

## Item 4 — effects bar: stable 1 line; portrait = 4 slots + pager arrows

**Current code:** the strip variant of `components/GlobalEffectMacros.tsx`
(both tabs render it: deck `index.tsx:1398`, mixer `mixer.tsx:2917`, via
`RigGlobals variant="mixer"`).
- Portrait (`:850-895`): a horizontal `ScrollView` of 8 chips at fixed
  `SLOT_MIN_WIDTH = 96` (`:817`) + pinned divider/BLACKOUT. 96pt forces every
  2-word label to wrap to two lines (`SlotButton` `numberOfLines={2}`,
  `:1381-1395`), chips are 60pt tall (`:661-663`), and the "Global\nEffects"
  in-row label is itself 2-line (`:824-836`) — the "weird 2-line layout", plus
  a scroll the operator doesn't want.
- Landscape (`:897-911`): one flat row of 8 `flex:1` chips (48pt) — right
  shape, but labels still wrap to 2 lines when squeezed.

**Proposed change (all inside the `if (isStrip)` branch + `SlotButton`):**
1. **Single-line labels in the strip:** `SlotButton` label
   `numberOfLines={2}` → `{1}` (keep `ellipsizeMode="tail"`), and replace the
   2-line `'Global\nEffects'` strip label with one-line `'FX'` (or drop it —
   operator choice below). With 1-line labels the chip no longer needs the
   2-line band: portrait chip height 60 → 48 (`:662`).
2. **Portrait pager (client-side view state only — NOT the engine's
   `effectsPage`; `SHOW_EFFECT_PAGES` stays `false`,
   `global_effect_macros_logic.ts:55`):**
   - Add `const [stripHalf, setStripHalf] = useState<0 | 1>(0)` in
     `GlobalEffectMacros` + a pure helper `chunkStripPages(slots, 4)` in
     `components/global_effect_macros_logic.ts` (VISIBLE_SLOT_COUNT=8 →
     exactly 2 groups of 4; unit-testable).
   - Replace the portrait `ScrollView` block (`:869-888`, incl. the fade peek)
     with: `‹` arrow (≈40×48 chip-style button, dimmed/disabled at half 0) —
     the 4 chips of the current half rendered `flex:1` (drop `SLOT_MIN_WIDTH`)
     — `›` arrow (dimmed/disabled at half 1). Divider + BLACKOUT stay pinned
     outside, unchanged (preserves the QA round10 "e-stop never scrolls off"
     invariant — now trivially true, nothing scrolls).
   - Arrows always rendered on BOTH sides (stable geometry, per the operator's
     ask), `hitSlop 8`, accessibility labels "Show effects 5–8" / "1–4".
     Page state is ephemeral (resets to half 0 on remount).
3. **Landscape:** keep the existing flat 8×`flex:1` row (`:898-911`) — with
   1-line labels it is the requested stable single line. No pager.
4. Add `chunkStripPages` cases to `global_effect_macros_logic.test.ts`.

**Behavior per combo:** Vertical: 4 wide chips + arrows, no scroll, BLACKOUT
always visible. Horizontal: all 8 on one line. Live: paging is display-only
and stays allowed under perf lock (same class as the CPC collapse chevron);
slot FIRE / intensity / mode stay live; ⋯ swap stays perf-locked — unchanged.
Edit: identical plus ⋯ enabled. Deck and mixer bottom bars both get it (same
component, one change).

**Ambiguities for the operator:**
- Long names on one line will tail-ellipsize ("Vintage Wh…"). Accept, or
  auto-shorten to first word ("Vintage") like `audioMeterLabel` does in
  CPCControls?
- Keep a tiny "FX" strip label, or drop the label entirely (chips gain ~40pt)?

**Risk:** medium. The strip hosts the e-stop and renders on both tabs — the
implementer must screenshot all 4 combos before the operator reloads. Logic is
localized to the two `isStrip` return blocks + SlotButton label props.

---

## Item 5 — mixer GLOBALS section, vertical: broken layout

**Diagnosis (code-derived; NOT reproduced on-device — read-only session, and
the standing rule forbids test servers near the operator's Metro):** the
GLOBALS row is `CPCControls` row 1 (`CPCControls.tsx:302-427`) — a single
`flexWrap:'nowrap'` line of mostly FIXED-width tiles. Portrait budget on the
mixer: label cell 60+8 (`:235-236`) + SPEED cluster capped at 90 incl. the
34pt SYNC button (`:230`, `:331-361` — the fader itself gets ~50pt, so the
KNOB pill + "SPEED" + BPM badge + value in `MiniFader.tsx:29-39` collide/clip)
+ SIZE ≤90 + COLORS 60 + QUEUE 60 + TAP 60 + BPM 90 (`:1028-1029`) + OSC 60 +
6×8pt gaps + **mixer-only trailing GROUPS button ~80pt** (`mixer.tsx:2632-2649`,
rendered outside the collapsible body at `CPCControls.tsx:422-426`). Total
≈700pt — on 768/810pt-wide iPads in portrait that crushes the two flex faders
to slivers, and any extra tile state (BPM badge, "NO BPM" tint) pushes the
nowrap row into right-edge clipping. The deck shows the same row WITHOUT
GROUPS, which is why only the mixer reads as broken.

**Proposed fix — Option B (recommended): explicit two-row portrait layout.**
Inside the expanded branch (`:329-415`), when `isPortrait`:
- Row A (controls): SPEED+SYNC (uncap: `faderMaxWidth` portrait 90 →
  `undefined`, add `minWidth: 120` on the SPEED cluster) · COLORS · QUEUE ·
  [the `trailing` GROUPS node moves to the end of row A in portrait, instead
  of hanging outside the body].
- Row B (tempo/status): TAP · BPM+source selector · OSC pill.
- Landscape: today's single row stays byte-identical (`faderMaxWidth` is
  already uncapped there and the row has slack).
- The collapsed summary (`CollapsedGlobalsSummary`, `:1110-1143`) is one line
  of text + pill, fine in both orientations — untouched (minus item 1's SIZE
  readout).

**Option A (lighter, contingent on item 1):** removing SIZE (~98pt) plus
uncapping `faderMaxWidth` to 140 may make the single portrait row fit
(≈660pt + GROUPS). One row is nicer IF it genuinely fits the operator's iPad;
it is fragile on 768pt devices and the SPEED fader stays smallish.

**Operator must choose:** A (one denser row) vs B (two clean rows — my
recommendation; it also gives the deck's portrait globals breathing room).
Because the diagnosis is code-derived, a quick screenshot of the broken state
before implementation would pin it exactly; if the on-iPad breakage is
something other than crushed faders / right-edge clipping, re-diagnose before
coding.

**Behavior per combo:** Vertical: two rows (B) — every tile at full designed
width; GROUPS reachable at the end of row A. Horizontal: unchanged single
row. Live/edit: each control keeps its own `disabled={planGate}` wiring —
layout only. Deck vertical inherits the same two-row layout (no GROUPS) —
strictly more room; deck horizontal unchanged.

**Risk:** medium-low. Pure layout branch inside one component; both tabs
consume it, so screenshot deck+mixer × portrait+landscape.

---

## Item 6 — AUDIO tab: reload on focus (latched-failure fix)

Per `20260725_8_audio_tab_native_fix.md` §4-5. **Current code:**
`app/(tabs)/audio.tsx:1158-1165` — `reload()` fires once per mount; the
expo-router tab screen never remounts, so one failed `GET /audio/config`
latches "AUDIO CONFIG UNAVAILABLE" (`:1167-1181`) until the RETRY button or an
app reload.

**Proposed change (exactly the _8 report's recommendation):**

```tsx
// app/(tabs)/audio.tsx — inside AudioAnalysisScreen (:1150)
const inFlightRef = useRef(false);
const reload = useCallback(async () => {
  if (inFlightRef.current) return;   // mount + first focus don't double-fetch
  inFlightRef.current = true;
  try {
    await getApiBaseAsync();
    const r = await fetchAudioConfig();
    if (r.ok) { setCfg(r.data as AudioConfig); setLoadError(null); }
    else { setLoadError(r.error || 'unknown error'); }
  } finally { inFlightRef.current = false; }
}, []);
useEffect(() => { reload(); }, [reload]);
useFocusEffect(useCallback(() => { if (!cfg) void reload(); }, [cfg, reload]));
```

`useFocusEffect` is already imported (`:42`). This is a retry, not a fallback
(codex P0): a failed refetch re-renders the same loud error. The RETRY button
(`:1175`) keeps working and becomes mash-safe via the in-flight ref. The gate
is `!cfg`, so it also retries out of the stuck-spinner state, not just the
error state — strictly better.

**Behavior per combo:** orientation-independent; no live/edit interaction
(config load only). **Risk:** minimal. Ship first.

---

## Suggested implementation order

| # | Item | Why this slot |
|---|------|---------------|
| 1 | **6** audio focus reload | Smallest, isolated, playa-critical latch. |
| 2 | **1** remove SIZE | Trivial deletion; frees the width item 5 leans on. |
| 3 | **3** whole-row pattern taps | Highest live-show value; shared component, no layout coupling. |
| 4 | **5** GLOBALS two-row portrait | After 1 (freed width); needs the A/B operator pick. |
| 5 | **2** deck wide 20/80 stack | Deck-only structural change; verify truncation via screenshots. |
| 6 | **4** effects strip pager | Largest visual change + e-stop adjacency — last, with all-combo screenshots. |

Items are independent except 5-after-1. All six fit one branch / one wave:
run `npx tsc --noEmit` + `npm test` (extend
`global_effect_macros_logic.test.ts` with `chunkStripPages`) + web-build
screenshots of deck & mixer in portrait+landscape, live & edit, before the
operator reloads the iPad.

## Open operator choices

1. Item 2: pattern column 20% (default) or 25%.
2. Item 4: 1-line label policy — tail-ellipsis vs first-word; keep an "FX"
   strip label or drop it.
3. Item 5 **(blocker)**: Option A (one dense row) vs Option B (two rows,
   recommended); optional screenshot to confirm the diagnosis.
4. Item 1: acknowledge global `size` becomes MIDI/script-only after removal.

## Honesty notes

- No CaptainPad file was modified; no server started; no git operation run.
- Items 1-4 and 6: root causes are read directly from the cited code —
  high confidence. Item 5 is a width-budget diagnosis from the same code
  paths, not reproduced on hardware — hence the screenshot ask.
- Line numbers are against the working tree as of 2026-07-27.