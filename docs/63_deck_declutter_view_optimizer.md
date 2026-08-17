# 63 — Deck declutter: bars join the workspace, the view optimizer moves under GLOBALS

Operator orders (verbatim intent, from live iPad testing of the native app):

1. "when the 2d pixels are enabled, hide the old classic 1D vis we have in
   the UI, extra shit not needed."
2. "in horizontal layout on iPad, the playlist view is too short and only
   shows 1 pattern — optimize the pattern selector UI to show more, and
   hopefully when the vis is hidden there's more room freed up."
3. "make the audio signals also hideable and controlled with the same
   mechanism as the 2d pixels and params and shit" — i.e. the Deck window
   workspace (docs/53) chip system.
4. "under the globals, have that view optimizer, and then keeping the layout
   of the audio and live 1D vis bars, make them hideable to completely
   simplify the screen as we want and free up room for other UI elems."

Design status: contract for 2–3 Sonnet implementers + an Opus validation
walk. Predecessors this composes with, and must not damage: docs/53 (window
workspace), docs/54 (restyle), docs/55 §2.4–2.5 (fullscreen + performance
overlay, report `_217`), report `_225` (PIXELS window + the `known`-set
upgrade discipline), docs/61 (COLORS interaction model — its wave is landing
concurrently; see §8 sequencing).

---

## 1. The surfaces, as built today

Deck screen top-to-bottom (`CaptainPad/app/(tabs)/index.tsx`):

| # | Surface | Where it lives | Hideable today? |
|---|---|---|---|
| 1 | `PlanLockBanner` | index.tsx | no (safety) |
| 2 | `DeckTopBar` — title, connection, MASTER fader | own component | no |
| 3 | **GLOBALS row** (SPEED·COLORS·QUEUE·TAP·BPM·OSC) | `CPCControls.tsx` row 1 | collapse-only (chevron, own state) |
| 4 | **AUDIO SIGNALS row** (dynamic live meters + plot picker) | `CPCControls.tsx` row 2 | **no** |
| 5 | **LIVE OUTPUT header row** — `DECK MAIN · LIVE OUTPUT` caption + PLAN LIVE / TOOK OVER chips + `PlanIndicatorPill` | index.tsx ~1176–1243 | no |
| 6 | **1D vis strip** — `<PixelStrip>` of the engine `preDimmer` composite | index.tsx ~1254 | **no** |
| 7 | `DeckWorkspaceBar` — the window chips ("the view optimizer") | index.tsx ~1263 | n/a (it IS the control) |
| 8 | The five windows (PATTERNS floor · PARAMETERS · AUTOPILOT · COLORS · PIXELS) | workspace tracks | yes — docs/53 chips |
| 9 | Bottom `globalRigBar` (PANIC + GEM strip) | index.tsx | no (safety) |

Rows 4 and 6 are the operator's "audio and live 1D vis bars". Row 7 is "that
view optimizer". The orders ask for: the optimizer directly under GLOBALS
(between rows 3 and 4), rows 4 and 6 hideable **through the same chip
mechanism as the windows**, and row 6 auto-suppressed while PIXELS is open.

The `CPCControls` block is SHARED with the mixer tab (`screen='mixer'`,
`trailing` = GROUPS). Everything here is deck-only; the mixer must render
byte-identical after this wave.

## 2. The model — SURFACE TIERS in one reducer

One mechanism, as ordered. The workspace layout grows a second **tier** of
elements — **bars** — inside the SAME pure reducer, the SAME closed-set
store, and the SAME chip row. No second show/hide system exists anywhere.

### 2.1 Types (`deck_workspace_layout.ts`)

```ts
export type DeckWindowId = 'patterns' | 'parameters' | 'autopilot' | 'colors' | 'pixels'; // unchanged
export type DeckBarId    = 'audioBar' | 'outputBar';
export type DeckSurfaceId = DeckWindowId | DeckBarId;

export const DECK_BAR_IDS: readonly DeckBarId[] = ['audioBar', 'outputBar'];
export const DECK_SURFACE_IDS: readonly DeckSurfaceId[] = [...DECK_WINDOW_IDS, ...DECK_BAR_IDS];

export const DECK_BAR_TITLES = { audioBar: 'AUDIO', outputBar: 'OUTPUT' };
```

Why a tier and not five-becomes-seven windows: bars are horizontal strips
above the workspace, not columns in it. They must never receive a track, a
wide flex weight, a `SectionHost`, or a vote in `patternsFillsNarrow`. Typing
them separately makes every window-only selector (`openWindows`,
`wideFlexFor`, `patternsFillsNarrow`, `effectiveOpenWindows`,
`narrowScrollOwner`) *total over windows and closed to bars by construction*
rather than by runtime filtering discipline.

### 2.2 State, reducer, actions

`DeckWorkspaceLayout.closed` widens to `DeckSurfaceId[]`. The reducer's
three actions (`close` / `open` / `reset`) operate on the union unchanged;
`PROTECTED_WINDOW` (patterns) remains the only refusal. `isDeckWindowId`
stays window-only; a new `isDeckSurfaceId` guards untrusted input.

Selectors, all pure:

```ts
openWindows(state): DeckWindowId[]        // filters closed AGAINST DECK_WINDOW_IDS — signature unchanged
shownBars(state): DeckBarId[]             // DECK_BAR_IDS minus closed, canonical order
railSurfaces(state): DeckSurfaceId[]      // closed, in close order (windows + bars interleaved as closed)
isShown(state, id: DeckSurfaceId): boolean
```

### 2.3 Persistence + the `_225` upgrade discipline, generalized

Key stays **`deck_workspace_layout_v1`** — this is a backwards-compatible
ADDITION, exactly like `_225`. `serializeLayout` writes
`known: [...DECK_SURFACE_IDS]` (all seven ids).

The normalizer's unknown-id rule generalizes from "unknown → closed" to
**"unknown → its SHIPPED DEFAULT membership"**:

- A **window** outside `known` is appended to `closed` (the `_225` rule,
  unchanged — and it stays a stated invariant that every future window MUST
  default closed, because only the closed set is persisted and a
  default-open window would spring open on every stored layout).
- A **bar** outside `known` is left OPEN — because the bars' shipped default
  is open. They pre-exist as always-visible chrome: every store written
  before this wave (legacy 4-window `known`, `_225`-era 5-window `known`)
  hydrates to a deck whose bars are exactly where they are today,
  **byte-identical**, and the two new chips appear as OPEN chips. Nothing
  springs shut, nothing springs open.

`DEFAULT_LAYOUT` stays `{ closed: ['colors', 'pixels'] }` — bars open by
default, so a fresh install is also today's screen plus two chips.

The rule the two cases share, stated once in the code comment: *a store may
only be silent about an element that did not exist when it was written, and
silence must reproduce the screen that store's author was looking at.*

### 2.4 The PIXELS → OUTPUT suppression (order 1) — DERIVED, never persisted

Same pattern as the `_217` performance overlay: a pure function OVER the
layout, no reducer action, no storage write.

```ts
export const PIXELS_SUPPRESSES: readonly DeckBarId[] = ['outputBar'];
export function effectiveShownBars(state, pixelsShown: boolean): DeckBarId[] {
  const bars = shownBars(state);
  return pixelsShown ? bars.filter((b) => !PIXELS_SUPPRESSES.includes(b)) : bars;
}
export const PIXELS_BAR_CAPTION = '1D OUTPUT — SHOWN WHEN PIXELS IS HIDDEN';
```

`pixelsShown` is the **effective** pixels visibility
(`effectiveOpenWindows(layout, perfActive).includes('pixels')`), so the
composition has exactly one derivation order: persisted layout → perf
overlay (windows) → pixels suppression (bars).

Why derived and not "outputBar just defaults hidden":

- The order is conditional ("**when** the 2d pixels are enabled") — a
  persistent flag cannot express *comes back when PIXELS closes* without
  auto-writing the operator's stored preference on every PIXELS toggle,
  which is precisely the sin the perf-overlay contract exists to prevent
  (docs/55: entering/leaving a mode must write nothing).
- No surprise disappearance: the vanishing is caused by the operator's own
  PIXELS chip tap, the 2D map visibly REPLACES the 1D strip (it renders the
  same composite, better), and the bar chip row narrates it (below).
- The operator's independent choice survives: if he hides OUTPUT manually
  while PIXELS is closed, it stays hidden after PIXELS opens and closes.

Chip behavior while suppressed (docs/53 §3.1 — no affordance that always
refuses): the OUTPUT chip leaves both the open row and the rail, and ONE
static micro-caption (`PIXELS_BAR_CAPTION`, same recipe as
`PERF_BAR_CAPTION`) appears after a divider. Closing PIXELS restores chip
and bar to the persisted truth.

### 2.5 Performance overlay interaction

Untouched and pinned: `PERF_HIDDEN_WINDOWS` stays exactly
`['parameters','autopilot']`; the perf overlay filters **windows only**.
Bars are performance surfaces (the audio meters and the output strip are
what a show wants on screen), so perf mode neither hides nor resurrects
them: a bar the operator closed **stays closed** through an enter/exit
round trip, and the round trip writes nothing (the `_217` measured-identity
test extends to the 7-element store).

### 2.6 Mounting: windows keep no-remount; bars may unmount

The docs/53 §3.4 no-remount contract exists to preserve *state* — scroll
offsets, in-progress edits, live WS reconciles. The two bars have none:

- AUDIO row: read-only meters over the live-params doc; its only state (the
  plot selection) lives in AsyncStorage `@CaptainPad:audioPlots:deck` and is
  untouched by hiding.
- OUTPUT strip: a stateless `<PixelStrip>` over `visDataRef`.

So a hidden bar MAY be unmounted (plain conditional render), and SHOULD be:
`DynamicAudioRow` subscribes to the whole live doc at ~5 Hz — keeping it
mounted-but-hidden buys nothing and costs re-renders. This is a deliberate,
documented asymmetry, not an erosion of the window contract.

**Bonus (same reasoning):** the deck screen's `onViz` handler bumps
`setVisVersion` every 200 ms solely to repaint the 1D strip
(`PixelViewWindow` paints imperatively off its own scheduler and does not
read `visDataRef`). Gate the bump on the OUTPUT bar being effectively shown
— hidden bar ⇒ zero vis-driven re-renders of the whole deck screen.

## 3. The screen, reordered (orders 2 + 4)

New deck order:

```
DeckTopBar
CPCControls
  ├─ row 1  GLOBALS  (unchanged, incl. its own collapse chevron)
  ├─ [optimizerSlot] ← DeckWorkspaceBar renders HERE   ("under the globals")
  └─ row 2  AUDIO SIGNALS  — rendered only when audioBar effectively shown
LIVE OUTPUT strip block — rendered only when outputBar effectively shown
  └─ caption row (label only) + PixelStrip
windows host (unchanged)
globalRigBar (unchanged)
```

### 3.1 `CPCControls` grows two deck-only props

```ts
optimizerSlot?: React.ReactNode;  // rendered between row 1 and row 2
hideAudioRow?: boolean;           // row 2 (meters + picker button + modal) not rendered
```

The mixer passes neither → **byte-identical mixer**, provable by screenshot
diff. The audio plot picker modal and its AsyncStorage selection are
untouched; they simply don't mount while hidden. The GLOBALS collapse
chevron keeps its own local state — it is a *density* control for row 1 and
is orthogonal to (and unifiable with, later — see D5) the workspace.

### 3.2 The plan-status cluster is hoisted, because it must never hide

Today's LIVE OUTPUT header row carries three safety-relevant indicators:
the `PLAN LIVE · CONTROLS LOCKED` chip, the `TOOK OVER · RESUMES M:SS` chip,
and the `PlanIndicatorPill`. **These are not part of the OUTPUT bar and are
never hideable.** They move to the RIGHT END of the `DeckWorkspaceBar` row —
outside its horizontal chip ScrollView, so they cannot scroll away:

```
[ chips… (scrolls) ]  [PLAN LIVE·LOCKED / TOOK OVER·RESUME]  [PlanIndicatorPill]
```

The bar is always rendered (it is the one surface that restores everything
else), sits inside the plan-lock scrim region as before, and is never an
overlay. What remains of the old header row is just the
`DECK MAIN · LIVE OUTPUT` micro-caption, which lives and dies with the
strip as one block.

Rationale for the bar (and not `DeckTopBar`): the top bar is the docs/61
wave's likely "shared header integration point" (their W4 chip) — landing
there invites a collision; the workspace bar is ours this wave.

### 3.3 Chips for the bars

Rendered by the same `WindowChip` recipe, same grounds, same ▾/▸ glyphs,
same 44 pt hit targets, in the same row: open windows (canonical) → open
bars (canonical) → `HIDDEN` divider → rail (close order, windows and bars
interleaved). Titles `AUDIO`, `OUTPUT`. Identity dots (docs/54 §3, all
subject to the `restyle_contrast.test.ts` 3:1 gate on both chip grounds on
all five themes):

- `audioBar` → the auto-driven green family (`ACCENT_AUTO` `#1b9e77` — the
  app-wide "audio/tempo is driving" color; if it fails the contrast gate on
  a ground, use `C.tertiary` and record the measurement).
- `outputBar` → `C.icon` (neutral — like PIXELS' `secondary`, this element's
  content IS the rig's own color; second neutral must not collide with the
  PIXELS dot, the test pins both).

## 4. The landscape playlist budget (order 2)

### 4.1 Where the height goes — investigate FIRST, with numbers

The "only shows 1 pattern" report is worse than the static budget predicts
(~460 pt of window height on an 11" iPad should seat ≥5 rows), so W0 must
reproduce and decompose it before anyone tunes blindly. Prime suspects, in
order:

1. **DECK B bound in wide mode**: `SplitPlaylistPanes` stacks the panes
   vertically (wide keeps DECK B *under* DECK A, `_225`); at ratio 0.5 each
   pane's header + assignment row + LOAD bar eat most of ~200 pt → 1–2 rows
   per pane.
2. **Performance-mode row boost**: `playlistRowSizing({ perfActive })`
   inflates row heights; compounded with (1).
3. The fixed chrome above the windows (~130–150 pt of it is rows 4–6, which
   this wave makes reclaimable).

W0's deliverable: a measured table (surface → pt) at 1194×834, default
layout, for {DECK B unbound, bound} × {perf off, on}, plus screenshots.

### 4.2 What this wave does about it

- Hiding AUDIO + OUTPUT reclaims their full height for the windows host
  (it is `flex:1` — no plumbing needed, the reflow is automatic).
- Moving the workspace bar into the CPC block removes one inter-block
  padding seam (~6–10 pt).
- **Acceptance floors** (11" iPad landscape 1194×834, DECK A single pane,
  perf off): **≥4 fully visible pattern rows** with everything shown
  (default layout), **≥6** with AUDIO + OUTPUT hidden. With DECK B bound:
  **≥2 rows per pane** default, **≥3** simplified. `>1` is the operator's
  stated broken threshold; these floors are the design targets the Opus
  walk counts on screenshots.
- If a floor is missed after the bars land, the sanctioned lever is
  **padding-only trim** in the non-compact `PlaylistPanel` sizing
  (`rowPadY 5→4`, `panelGap 6→4`, `rowGap 2→1`) — NOT structural row
  changes; the 2-line entry row layout and the ≥44 pt tap contract are
  pinned. Anything structural is D4, the operator's call on the iPad.

## 5. Must-not-change pins

1. **PATTERNS floor**: protected window, no close affordance, reducer
   refusal, `patternsFillsNarrow` stays a *window-only* predicate — bars
   shown or hidden have NO effect on it (bars live outside the stack the
   fill reasons about).
2. **`_217` derived perf overlay**: no reducer action, zero persistence
   writes on enter/exit, `PERF_HIDDEN_WINDOWS` exactly two, chips
   suppressed with the static caption, reads RAW
   `usePerformanceMode().active`.
3. **`_225` known-set discipline**: key stays `_v1`; every pre-existing
   stored layout hydrates to a visually identical deck; future WINDOWS
   default closed (invariant comment survives).
4. **No-remount contract for windows** (docs/53 §3.4) byte-identical; the
   bar exemption is §2.6's documented asymmetry, windows are untouched.
5. **docs/61 COLORS yield rule**: `handleWorkspaceClose('colors')` keeps
   running `runYieldGesture` before closing; closing/opening a BAR runs no
   yield, posts nothing.
6. **Plan-lock surfaces**: the PLAN LIVE / TOOK OVER chips and
   `PlanIndicatorPill` are rendered unconditionally (§3.2); `PlanLockBanner`,
   scrim, and the bottom PANIC/GEM bar untouched.
7. **Layout ops emit zero engine traffic** — bar chips included.
8. **Mixer parity**: `mixer.tsx` is not edited; `CPCControls` with no new
   props renders byte-identical (screenshot diff in the walk).
9. **Party 2026-07-11 contracts**: PATTERNS pin (38.5 %, 400/500 floors,
   `narrowScrollOwner`), single narrow scroll region, 40/30/30 weights.
10. **MIDI/knob mapping** (`knob_page.ts` badges on the GLOBALS row):
    untouched; the SPEED fader keeps its `KnobPill`.

## 6. Operator decision points (defaults chosen; overrides welcome)

- **D1 — PIXELS↔OUTPUT rule.** Default: derived suppression with the
  micro-caption (§2.4). Alternative: no coupling, OUTPUT is only ever
  manually hidden (rejects order 1's "when", so not recommended).
- **D2 — chip titles + dots.** Default: `AUDIO` / `OUTPUT`,
  green/neutral dots (§3.3). Alternatives: `SIGNALS` / `1D VIS` if OUTPUT
  reads ambiguous next to the PIXELS chip on the real iPad.
- **D3 — one-tap SIMPLIFY preset.** Default: **defer.** The chips plus the
  PIXELS auto-suppression already reach the "completely simplified" screen
  in ≤3 taps, and a preset is a second authority that has to answer "what
  does un-simplify restore?". If wanted later: a `simplify` action that
  closes every non-protected surface, persisted like any chip tap — cheap,
  additive, no migration.
- **D4 — playlist densification beyond padding trim** (single-line rows, a
  wide-mode `dense` variant). Default: not in this wave; only if the §4.2
  floors fail on the real device, and only with the operator's eyes on it.
- **D5 — GLOBALS collapse chevron.** It is now a second, older hide
  mechanism one row above the optimizer. Default: leave it (it hides row 1,
  which is deliberately NOT a workspace citizen — SPEED/TAP/PANIC-adjacent
  controls should not be hideable-by-chip). Alternative worth a future
  thought: fold it into the bar as a `GLOBALS` chip. Not this wave.

## 7. W-items

**W0 — landscape budget investigation (Opus lead or Sonnet C, before/with W3).**
Reproduce "1 visible pattern" at 1194×834 on the web dist; produce the §4.1
measurement table for the four states; identify the dominant term. No
product code. Output: numbers in the landing report.

**W1 — pure layout logic (Sonnet A). Files: `components/deck/deck_workspace_layout.ts`, `deck_workspace_layout.test.ts` only.**
- Types/constants of §2.1; `closed` widens to `DeckSurfaceId[]`;
  `isDeckSurfaceId`; reducer over the union (patterns still refuses).
- Normalizer: §2.3 generalized unknown-id rule; `serializeLayout` writes the
  7-id `known`.
- Selectors of §2.2 + `effectiveShownBars` + `PIXELS_SUPPRESSES` +
  `PIXELS_BAR_CAPTION` (§2.4). Window-only selectors keep their signatures.
- Tests (extend the existing suite; keep every current case green):
  upgrade matrix — no-`known` legacy store, 4-id `known`, 5-id `known`
  (current builds), 7-id `known`, corrupt, `{closed:[]}` — each asserting
  bars-open-unless-named; reducer close/open/reset over bars; suppression
  derivation (incl. pixels open + outputBar already closed);
  `patternsFillsNarrow` unaffected by bar state; perf overlay ignores bars;
  serialize→normalize round trip is the identity for all 2^6 reachable
  closed sets.

**W2 — workspace controller + bar chrome (Sonnet B). Files: `components/deck/deck_workspace.tsx`, `components/restyle_contrast.test.ts` (extend).**
- `useDeckWorkspace` exposes `barsShown: DeckBarId[]` (post-suppression,
  derived from its own effective open windows) and `isBarShown(id)`;
  open/close reuse the existing dispatcher (they already take the union
  after W1).
- `DeckWorkspaceBar`: bar chips per §3.3; suppression caption per §2.4;
  new `trailing?: ReactNode` prop rendered outside the chip ScrollView,
  right-aligned, never scrolled away (§3.2).
- Contrast tests for both new dots on both grounds, five themes.

**W3 — deck screen + CPC wiring (Sonnet C). Files: `app/(tabs)/index.tsx`, `components/CPCControls.tsx` only.**
- CPC props `optimizerSlot` / `hideAudioRow` (§3.1); row 2 and its picker
  modal not rendered when hidden; mixer call sites untouched.
- index.tsx: `DeckWorkspaceBar` moves into the slot (with the plan cluster
  as `trailing`, deleted from the old header row); the LIVE OUTPUT
  caption + `PixelStrip` become one conditional block on
  `isBarShown('outputBar')`; old bar mount point removed; `setVisVersion`
  bump gated on the OUTPUT bar being shown (§2.6).
- Nothing else in index.tsx moves — especially not the docs/61 yield wiring
  (`runYieldGesture` call sites, refs, `subscribeDeckWindowRequests`).

**W4 — validation walk (Opus). No product files.**
- Vitest suite green; the W1 matrix reviewed against §2.3's invariant.
- Persistence round trips on the running app (web dist, per the operator's
  Metro rules): fresh install; seeded legacy store (`{closed:['colors']}`
  no `known`); seeded 5-id store with pixels open — each must hydrate to
  the §2.3 predicted screen, then chip taps persist and survive reload.
- Perf-mode enter/exit with both bars hidden: storage byte-identical
  before/during/after, bars stay hidden, caption correct.
- PIXELS toggle: OUTPUT bar + chip vanish/return; manual OUTPUT hide
  survives a PIXELS open/close cycle.
- Screenshot matrix: iPad landscape 1194×834 and portrait 834×1194 ×
  {default, AUDIO hidden, both hidden, PIXELS open, perf mode} + mixer
  before/after parity pair. Count pattern rows against the §4.2 floors.
- Plan-lock states: chips visible with bars hidden; scrim still blankets
  the relocated bar.

Sizing: W1 ≈ half a day, W2/W3 ≈ a day each, parallel after W1 merges
(W2/W3 touch disjoint files). W0 any time; W4 last.

## 8. Sequencing vs the docs/61 wave (file-ownership overlaps)

The docs/61 COLORS wave (driving strip, app-wide chip, yield triggers) is
in flight and owns, per its §8: `colors_window_logic.*` (W1),
`colors_window.tsx` + `driving_strip.tsx` (W2), **`index.tsx` +
`deck_workspace.tsx`** (W3), `useEngineState.ts` + `color_mode_chip.tsx` +
the shared header (W4).

Overlaps with this wave: **`index.tsx`** (both W3s) and
**`deck_workspace.tsx`** (their W3 "minimal glue" vs our W2). Rules for the
Opus lead:

- This wave's W2/W3 start only AFTER the docs/61 wave lands on the branch.
  Our W1 (`deck_workspace_layout.ts` — not in their ownership table) can
  start immediately.
- Our W3 rebases over their landed `index.tsx`; §5 pin 5 is the contract
  that their yield wiring comes through untouched.
- Their W4 header chip: if it landed in `DeckTopBar` or a shared header,
  our plan-cluster hoist (§3.2) targets the workspace bar precisely so the
  two waves never edit the same row; if their chip instead landed in the
  vis header row we are dismantling, our W3 relocates it to the workspace
  bar `trailing` cluster alongside the plan chips and says so in the
  landing report.

## 9. Test-plan summary

W1 table-driven vitest (upgrade matrix, suppression, perf/bar orthogonality,
round-trip identity) · W2 contrast + chip-rail rendering tests · W3
compile-level prop parity (mixer passes no new props) + the vis-version
gating unit · W4 storage-byte-identity probes, screenshot matrix with
pattern-row counts against the §4.2 floors, mixer parity diff.
