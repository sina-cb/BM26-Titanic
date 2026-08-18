# `_302` — Live Touch fix wave: ARM, spatial stroke ids, EFFECTS tiles, COLOR clipping

**Date:** 2026-08-17 · **Lead:** Opus (managed Sonnet implementation) ·
**Phase:** implementation + offline validation · **Live rig:** untouched
(no writes, no ARM mutation, no port bound, no restart) · **Git:** none.

Foundation: `_301` (Fable root-cause) and its §5 fix contract + §6 regression
spec. Four fixes were commissioned as W1-W4.

---

## 0. REPORT-NUMBER COLLISION — read this first

`_302` is reserved to THIS wave in the thread tracker
(`.agent/memory/bm_readiness_thread_tracker.md`: "`_302` — Live Touch native
ARM fix: Opus-managed Sonnet implementation + regression").

A concurrent editor (the "paused" Codex Live Touch task — the same one `_301`
§10 caught mid-session) **also wrote a report at `_302`**:
`20260817_302_live_touch_native_arm_hidden_spatial_fix.md`, covering its own
W1 implementation. Two files now share the number. Nothing was deleted or
renamed — that is an operator call. Suggested resolution: renumber the Codex
file (its content is sound and is credited in §2 below), since the tracker
reservation and the commissioning brief both point at this file.

## 1. Concurrent-editor baseline (verified, not assumed)

Snapshot taken at session start (13:58 PDT), before any write:

| File | sha256 (first 16) | mtime at baseline |
|---|---|---|
| `docs/ui/touch_control_wire.js` | `63c8adf0cbb1e338` | 13:39:51 |
| `docs/ui/touch_control.html` | `04f6c016b9e851c2` | 13:39:40 |
| `docs/ui/touch_control_pixel_views.js` | `2049e901378492ea` | 13:39:24 |
| `docs/ui/touch_control_theme.js` | `7735ae8d11acf831` | 13:11:58 |

The concurrent editor **stopped at 13:39 and stayed stopped**:
`touch_control_pixel_views.js` and `touch_control_theme.js` were still
byte-identical to this baseline at the end of the wave. Every sub-agent
re-checked its file's hash against this table before its first edit, and both
matched. All later changes to `wire.js` / `touch_control.html` are this
wave's, and are attributed per-W below.

`_301`'s file:line references were re-baselined against the inherited tree
before implementing; where they had moved, the current lines are cited.

## 2. W1 — ARM canvas-independence: ALREADY LANDED by the concurrent editor, verified and topped up

**What the concurrent editor had already landed** (credited, kept, built on —
not undone):

- `touch_control_pixel_views.js`
  - Guard split, exactly as `_301` §5.A.1 required. `padWorldPerPx` (`:740`)
    now throws `'pixel view is not verified'` **only** for `!staticVerified`,
    and a distinct `'pixel view has no rendered display projection'` (`:742`)
    for the empty-`screenGlyphs` case. `padPxToWorld` (`:673`) and
    `worldToPad` (`:697`) keep the original string for `!staticVerified` only.
  - Shared extent math extracted to `worldPerPxForGlyphs(sourceGlyphs, view,
    target)` (`:709`) — used by BOTH paths, so no duplication (the H7 hoist
    lesson `_301` flagged).
  - `worldBrushRadii(fraction, target)` (`:752`): refuses separately on
    `!staticVerified` (`'pixel-view source artifact is not verified'`) and
    `!engineVerified` (`'pixel-view engine topology is not verified'`) — the
    same two booleans that gate `canArm()` (`:1218`). Reprojects into the
    canonical design viewport (`reprojectView(state.view, design,
    design.width, design.height, 0, 0, 1)`), clamps to x∈[0.01,1], y∈[0.01,2].
- `touch_control.html` — `window.padBrushWorldCanonical` (`:4371`), throwing
  when the runtime cannot supply verified geometry (no fallback to the screen
  path).
- `touch_control_wire.js` — `initialSpatialPrepareBody` (`:1096`) requires
  `padBrushWorldCanonical` (`:1100`, throws if absent), reads it at `:1119`,
  validates the result (`:1120`), and maps to `{radius, radiusY}` (`:1136`).
  `brushPatch()` remains ONLY on the live stroke path (`:2102`, `:2281`).

**Verdict against the `_301` §5 contract: compliant.** Verification is never
weakened or faked, there is no fallback, Spatial is never auto-opened, and
the stroke path is untouched.

### 2.1 What THIS wave added to W1

`_301` §6 items 2-6 were specified for the Node-level suite and were **not
implemented** — the concurrent editor's regression lives in the puppeteer
lifecycle test (`simulation/tests/live_touch_ui_layout.test.js:919`) and
covers items 1, 7, 8, 9, 10 plus one of the two refusal messages. Missing:
both-gate refusals, the real-mismatch refusal, determinism across viewports,
and the parity check.

**Added:** `simulation/tests/touch_control_arm_brush_geometry.test.js` (new
file, 7 tests, all passing). It mounts the real runtime singleton against the
real artifact and the real 964-pixel `marsin_engine/models/titanic.js`
topology, with the canvas at 0×0 throughout. It lives apart from
`touch_control_pixel_views.test.js` deliberately: that suite exercises the
pure projection helpers and must not inherit mounted singleton state.

It proves: static verification with `staticRenderCount === 0`; each gate
refusing with its OWN message; ARM staging finite positive radii while
hidden; radii identical across four viewport sizes and across
hidden→visible→hidden; a wrong pixel count AND a single perturbed `nx`
each refusing loudly with `canArm()` false and `worldBrushRadii` still
refusing; and non-finite / non-positive fractions refused rather than
clamped.

### 2.2 FINDING — `_301` §6.6's parity expectation was wrong, and the divergence is real

`_301` §5 predicted the canonical radius would "reproduce today's visible-pad
numbers … to within float noise". **Measured, it does not.** At the
operator's pad aspect the canonical radius is **~4.9% smaller** than the
screen-derived one, consistently on both axes and at every viewport size:

```
viewport    screen radii              canonical radii           delta
1024x520    [0.145607, 0.277477]      [0.138415, 0.263771]      -4.94%
1194x606    [0.145686, 0.277627]      [0.138415, 0.263771]      -4.99%
 834x424    [0.145441, 0.277160]      [0.138415, 0.263771]      -4.83%
1440x731    [0.145657, 0.277572]      [0.138415, 0.263771]      -4.97%
```

**Mechanism (diagnosed, not guessed).** `design` is `900x520` (aspect
1.7308). The screen radius is `fraction × padWidth × per.x`; the canonical is
`fraction × designWidth × per.x`. That product is scale-invariant only while
the fit is width-limited. Once the pad is WIDER than the design aspect (the
iPad pad is ~1.97), the projection becomes height-limited: the drawn content
stops growing with pad width while `fraction × padWidth` keeps growing. So
the two answers necessarily diverge off the design aspect.

**Exact parity IS achievable, and holds, at the design viewport** — measured
ratio `1.000000` on both axes at 900×520. That is the strongest form the
contract can take, and it is the one that actually guards the shared extent
helper against drift, so that is what is pinned.

**This is not a defect to chase.** Exact parity at arbitrary pad aspects
would require reading the pad's box — reintroducing the canvas dependence the
fix exists to remove. The divergence is deterministic, bounded, and
one-directional (canonical ≤ pad-derived, so ARM can never stage a brush
WIDER than the operator would have drawn), and the first stroke re-asserts
the screen-true radius (`wire.js:2281`). `_301` §5 already accepted the
semantic change; only its numeric prediction was mistaken.

**Operator-visible consequence:** the initial staged brush, before the first
stroke, is ~5% smaller than pre-fix. Pinned by
`'canonical and screen brush geometry share one extent helper'`.

## 3. W2 — Spatial paint stroke-id 400 (FIXED, client-side only)

**Root cause confirmed as briefed.** `spatialPayload()` put the raw DOM
`pointerId` on the wire as `strokes[].id`. iPad WKWebView derives pointer ids
from iOS touch identifiers, which exceed the engine's cap — so
`marsin_engine/lib/global_effects_controller.js:2135` correctly rejected them
with `strokes[0].id must be a non-negative integer`. **The engine validation
was not touched; it is right.**

**Fix** (`docs/ui/touch_control_wire.js`, ~30 lines): a ten-entry slot pool
(`spatialSlotUsed`, `:2161`) with `allocateSpatialSlot()` (`:2162`, smallest
free integer 0..9) and `releaseSpatialSlot()` (`:2171`). Each
`spatialPointers` entry gains `slot`; `spatialPayload()` now sends
`id: pointer.slot` (`:2217`).

`pointer.id` deliberately REMAINS the raw pointerId, because it is also the
`spatialPointers` Map key and `commitSpatialPayload`'s identity check
(`:2252`) — keeping it untouched made the diff minimal and avoided re-keying
the Map. Allocation happens at both creation sites (`xyPad` pointerdown
`:2486`, TAKE playback `:2457`); release happens at **every** removal site,
audited: the retire sweep in `queueSpatialTouches` (`:2263`), the
pointer-capture failure path (`:2496`), and `clearTransientSpatialContacts`
(`:2177`). Exhaustion throws (`:2169`) rather than falling back to the raw id;
the existing `spatialPointers.size >= 10` gate remains the primary guard.

**Regression** — `simulation/tests/touch_control_spatial_stroke_ids.test.js`
(new, 4 tests, puppeteer against the real page): huge and fractional ids never
reach the wire and every emitted id satisfies the exact engine predicate; the
slot is stable across `pointermove`; it is released on `pointerup` AND
`pointercancel` and is then reused; ten concurrent touches yield ten distinct
ids in 0..9. Plus a source pin in
`marsin_engine/tests/effects/touch_control_wire_layers_contract.test.js:136`
forbidding a regression to `id: pointer.id`.

Worth recording: Chromium's native `PointerEvent` constructor types
`pointerId` as WebIDL `long` and SILENTLY WRAPS the pathological values
(`0x80000001 → -2147483647`, `4294967296.5 → 0`), which would have made a
naive test vacuous. The suite therefore dispatches plain `Event` objects with
`.pointerId` assigned directly — the only way to deliver real WKWebView-scale
ids to the handlers under Chromium.

### 3.1 Separate latent bug found, deliberately NOT fixed here

`pushXY()` resolves its `spatialPointers` entry via
`Number.isInteger(e.pointerId) ? e.pointerId : TAKE_POINTER_ID`. A real
pointer with a genuinely non-integer id would therefore alias the
TAKE/playback entry, so `pointer.current` is never set and **that touch is
silently dropped** from `strokes[]` — a fallback, which the P0 rules forbid.

It is **latent, not active, and not the reported defect**: the operator's iPad
produced a 400 naming a bad id, which proves their pointer ids were INTEGERS
merely exceeding the cap — a non-integer id would have produced a silent drop
and no 400 at all. Fixing it requires deciding what a non-integer pointer id
should mean (the sentinel exists so synthetic playback events can reach the
playback entry), which is a design call beyond this wave's scope. Filed as a
follow-up task; documented in the new suite's header.

## 4. W3 — EFFECTS tiles: NOT an independent defect

**Root cause: the tiles were inert because ARM never completed — i.e. W3 was
a downstream symptom of W1.** No tile-wiring bug exists. Evidence:

1. **The tiles ARE driven by real provisioned slot definitions**, exactly as
   the brief's preferred remedy requires. Each `.fx-cell` owns a fixed
   `data-slot` (`FX_SLOTS = [9…24]`, `touch_control.html:6339`) and is
   provisioned to its `data-fxkey|data-preset` by `provisionCell()`
   (`wire.js:3109`) via `PATCH /global-effect-slots/:id`.
2. **Provisioning runs ONLY inside the ARM chain.** `assertLiveSurfaceState`
   calls `collectEffectSlotBuildOperations` (`wire.js:1176`), which walks
   every rendered cell; `verifyPreparedSlots` (`wire.js:1141`) then re-reads
   the slots and THROWS on any binding mismatch. Outside ARM every path is
   gated by `liveStateCanWrite` (`:3110`, `:3287`, `:3367`) — by design,
   because slots 1-8 belong to the Deck and the VSN1 and the panel owns the
   rig only while armed.
3. **The live engine's state is exactly what an ARM that never ran predicts.**
   `GET /global-effect-slots` on the live engine returns slots 9-13 as
   `Invert / UV Blast / Fogger / Long Trails / Cosmic Trails` — a PREVIOUS
   layout — and 14-24 unbound, while the grid renders the current
   `FX_DEFAULT` set (PULSE long fade, 2 COLOUR walk, 5 COLOUR double, STROBE
   4 Hz, TRAILS ghost, SWEEP shadow, FREEZE hold …). `markCells()`
   (`wire.js:3228`) therefore marks every cell `fx-unwired` and
   `reconcileEffects` early-returns without a lease: taps do nothing, count 0.
4. **The tile catalog is sound.** All 16 `FX_DEFAULT` pairs exist in the LIVE
   engine's library (verified by read-only `GET /global-effect-library`: 51
   pairs available, 0 missing). This was already contract-pinned by
   `marsin_engine/tests/effects/touch_control_catalog_contract.test.js`
   ("every touch-panel default exists in the engine registry").

**So no code change was required, and none was made.** Forcing tiles to
render from `/global-effect-slots`, or provisioning the set through a scene
state file, would both have been wrong: the former inverts the ownership
(the panel authors its bank; the engine stores it), and the latter would
write engine state to paper over a client bug that W1 already fixes.

**No engine state or config was changed. No engine restart is needed for W3.**

**Added pins** (in `touch_control_catalog_contract.test.js`, 3 new tests) so a
tile can never silently become a no-op again:

- every rendered tile owns a distinct slot inside the panel-owned 9..32 range
  (count matches `FX_DEFAULT`; duplicates would silently overwrite at ARM);
- ARM provisions every RENDERED tile (`collectEffectSlotBuildOperations` in
  the `assertLiveSurfaceState` chain, driven by `querySelectorAll('.fx-cell')`)
  and proves each binding by readback, throwing on mismatch;
- `provisionCell` refuses a tile with no authoritative behavior rather than
  defaulting one, and `markCells` renders an unbound tile `fx-unwired`.

### 4.1 Leftover scope for `_291` (docs/70 §10, unchanged by this wave)

The §10 PLAY/EDIT grammar is **partially present already** —
`#fxEditToggle`, `is-editing`, `is-performance-locked`, and
`projectFxPerformanceMode()` exist (`touch_control.html:6352-6388`). Still
outstanding for `_291`: the FX_SHORT face two-liner as the PLAY identity at
AA contrast in both arm states (the wash-out fix) with the ≤8-char enforcing
test; hiding `.fx-pick`/`.aud-row` in PLAY; the corner family tag + read-only
amount bar; deleting the legend row in favour of transient eviction narration
plus the ⓘ help overlay; the EDIT-posture ≥44pt selects, `.aud-row`, and the
new base-level fader on the existing `paramsOverride` MERGE writer; and
EDIT-only panel scrolling. None of it is required for the tiles to function.

## 5. W4 — COLOR HUB card clipping (FIXED, CSS only)

**Root cause.** `#colorHubPanel` shares `.prow.prow-top` with SPATIAL at
landscape 11". That row caps its `.panel-body` at **367px** real height at
1194×834. The existing `@media (min-width:1121px) and (max-width:1250px)`
block already retunes SPATIAL/legacy-colour chrome for that budget, but
`_289` landed every `.ch-*` row's spacing **unconditionally** — sized for the
roomier stacked-portrait layout and never re-checked against this row's
tighter landscape share. Measured: the TWO COLOUR / PALETTE TURNS card needs
**375px** against 367 — an 8px overrun before any device variance. With the
docs/61 §4.1 DRIVING strip shown (a normal state, whenever a family runs from
the other card) the stack reaches **437px** — a 70px overrun.

`.panel { overflow: hidden }` is this file's universal panel-clip contract, so
the overrun is not a scrollbar but silent unreachable clipping — exactly the
operator's "HOLD row half-cut, nothing below it reachable".

**Fit, not scroll** — correctly chosen. This file scrolls exactly two things
on purpose (the whole page below 900px via `.content-grid`, and the Groups
bank's own `.bank-scroll-area`), and `docs/70` §10.2 sanctions scrolling only
for the EFFECTS panel's EDIT posture ("PLAY never scrolls… EDIT may scroll") —
a different, explicitly-scoped exception, not a general precedent.

**Fix**: one landscape-11"-scoped block appended inside the media query that
already exists for this purpose (`touch_control.html:2927-2965`), trimming
margins/padding and box heights on `.ch-strip`, `.ch-tabs`, `.ch-hue-strip`,
`.ch-hue-handle`, `.ch-ring`, `.ch-swatch-btn`, `.ch-actions`, `.ch-ab-row`,
`.ch-ab`, `.ch-timing-row`, `.ch-chip`, `.ch-run`. Recovers 76px.

Crucially it uses this file's own hit-region recipe (docs/66 §2.1): every
shrunk PAINTED box grows its `::after` inset by the same amount, so the real
tap target never drops below 44×44pt. Verified arithmetic: `.ch-chip` 24 +
2×10 = 44; `.ch-ab` 28 + 2×8 = 44; `.ch-hue-strip` 20 + 2×12 = 44. Controls
with a HARD real-box requirement (`.ch-actions`' 44px row, `.ch-run`'s 44pt
primary action, `.ch-tabs.mode-toggle`'s 44pt tab row) were not moved.
Portrait (834×1194) is below this breakpoint and untouched — it already had
25-119px of clearance.

**Regression**: `simulation/tests/live_touch_ui_layout.test.js:1094` — real
puppeteer, real `getBoundingClientRect()`, asserting every row of `#chTabs`,
the active `[data-color-card]`, and `#chStrip` lies inside `#colorHubPanel`'s
actual clipping box, across 2 orientations × 3 cards × 2 driving-strip states.

**Independently re-verified by the lead** (`~/tmp/w302/colorhub_headroom.mjs`)
to prove the pin is not vacuous: all 10 rows render with nonzero boxes; with
the fix the lowest row (`chRunTwo`) sits at 586.0 against a panel bottom of
596.1 — **10.1px inside**; with `_289`'s spacing re-injected the same row
lands at 684.0 — **87.9px outside**, RUN clipped entirely.

## 6. Validation

All offline. No live port bound, no live write, no ARM mutation, no restart,
no git command.

| Gate | Result |
|---|---|
| `simulation` Live Touch suites (6 files, incl. both new) | **63 pass, 0 fail** |
| `marsin_engine` Live Touch contract suites (6 files) | **52 pass, 0 fail** |
| CaptainPad focused (`live_touch_bridge`, `live_touch_ui_authority`, `live_touch_handoff_curtain`) | **28 pass, 0 fail** |
| `npx tsc --noEmit` (CaptainPad) | **0 errors** |
| `node --check` on both hot-served JS files | PASS (after every edit) |
| `python scripts/security_check.py --all` | 6 findings, **all pre-existing**, all in gitignored `simulation/.scene_backups/studiodj/**/controllers.yaml` (MAC addresses in untouched backup residue). **Zero findings in any file this wave touched.** |

Baseline before this wave: simulation 51, engine contract 34 (2-file combo),
CaptainPad 28. Net new tests: **+12** (W1 7, W2 4+1 pin, W3 3, W4 1 — the
engine table counts four suites the earlier baseline did not include).

**Transport pins from `_288`/`_289` HOLD, unmoved:** `docs/ui/touch_control_theme.js`
still has `captainpad_embed` (`EMBED_PARAM`, `:16`), `buildTransport` (`:96`),
`__captainpadDeliver` (`:354`) — and the file is **byte-identical** to the
session baseline (`7735ae8d…`), as is `touch_control_pixel_views.js`
(`2049e901…`).

**ENGINE RESTART: NOT REQUIRED.** No engine source, state, config, or scene
file was changed by this wave. W3's remedy turned out to need no engine-side
provisioning at all (§4). Everything landed is in `docs/ui/` (hot-served) plus
test files.

**No CaptainPad rebuild required** — no CaptainPad product source changed.

## 7. Physical-iPad retest sequence for Sina

Everything is in `docs/ui/`, served live to the WebView, so only a fresh
document load is needed.

1. While **DISARMED**, tap the Live Touch header **RELOAD** so the WebView
   pulls the changed assets.
2. Leave **SPATIAL in the HIDDEN rail** — the photographed state. Tap **ARM**.
   Expect ARMING → ARMED with no red pill. A
   `LIVE TOUCH PIXEL VERIFICATION WAITING/CHECKING` banner may flash and must
   clear itself. Confirm SPATIAL is **still hidden** — ARM must not have
   opened it.
3. **EFFECTS tiles (W3 — the real test).** Still armed, check the grid: every
   tile should now be full-opacity (not the dimmed `fx-unwired` look). Tap
   one — it should light and `#fxCount` should go to 1. Tap it again to turn
   it off. This is the step that proves the tiles were only ever inert because
   ARM never completed. If any tile stays dimmed, ARM aborted during slot
   provisioning — capture the error, do not retry around it.
4. **COLOR panel (W4).** Open the COLOR HUB in **landscape**. Every row of
   each of the three cards must be fully visible, including the **HOLD/FADE
   duration rows and the RUN button at the bottom**. Switch between TWO
   COLOUR / PALETTE TURNS / FOLLOW NOTE. Then start something so the DRIVING
   strip appears at the top and re-check the bottom of the card — that was the
   worst case (87.9px of clipping before the fix). Repeat in portrait.
5. **SPATIAL painting (W2 — writes to the rig, your call when).** Open SPATIAL
   from the HIDDEN rail; the pixel map should draw. Make one short stroke and
   confirm lights respond with **no red 400 pill**. Then try **two and three
   fingers at once** — that is the multitouch case the raw pointer ids broke.
   Lift and re-touch several times to exercise slot release and reuse.
6. Dock SPATIAL again → **DISARM** → **ARM** (the visible→hidden→ARM path).
7. Header **RELOAD** while disarmed with SPATIAL hidden → **ARM** once more
   (fresh document identity).

Capture any failure with BOTH the CaptainPad host diagnostic and the embedded
bottom error visible. Do not retry around a refusal or bypass verification.

## 8. Follow-ups

- **`pushXY()` non-integer pointerId silently aliases the TAKE slot** (§3.1) —
  a latent fallback that drops a touch without a word. Filed as a task.
- **`_291`** still owns the remaining docs/70 §10 PLAY/EDIT grammar (§4.1).
  None of it is needed for the tiles to work.
- **`padBox()`'s `|| 1` zero-size fallback** (`touch_control.html:4353`) —
  `_301` §9's Backlog candidate. After the ARM decoupling it feeds only the
  visible-stroke path, so it can no longer reach ARM, but it is still a
  fallback smell.
- **Report-number collision at `_302`** (§0) — operator call.
- Six pre-existing MAC-address findings in gitignored
  `simulation/.scene_backups/studiodj/` predate this wave and remain.
