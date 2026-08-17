# 55 — COLORS schemes, engine-driven crossfade, fullscreen + performance overlay

**Design contract for the next Deck COLORS / workspace wave** (report `_216`).
Builds on `docs/53_deck_workspace_windows.md` (workspace + COLORS window
architecture, incl. §8 AS BUILT), `docs/54_deck_ui_restyle.md` (visual canon:
theme tokens wearing Live Touch grammar), and report
`.agent/reports/202608/20260814_211_colors_window_impl.md` (the shipped COLORS
window). The scheme-generator source of truth is
`docs/ui/touch_control.html` (PALETTE GENERATORS block, lines ~3221–3330) —
the old TS module was deleted; the HTML is canonical.

The five operator intents, verbatim:

1. "duplicate the contrast, and complementary and other shit in the color
   selection from the live touch tab"
2. "the crossfade should update the palette too"
3. "the 5 sampled colors from the contrast or hue or other shit should be
   selected, the color fade moves one to the other"
4. "when all colors and params and auto pilot panels are hidden make sure the
   pattern is always full screen"
5. "in performance mode, hide the params and auto pilot settings from the deck
   and show them again when going back to edit mode"

Hard rails carried forward, non-negotiable:

- **Rotation/fading runs ENGINE-side.** A tab timer driving the rig is the
  Live Touch deadman-gap failure class (docs/53 §5.2) and is forbidden.
  Finger-driven throttled writes during an active drag are fine (that is the
  wheel's existing recipe); autonomous tab clocks writing the rig are not.
- **Single writer.** While the colour-autopilot daemon is active it owns
  `colorPalette1/2`. Every refused manual touch carries a visible sentence
  (`manualWriteGate`, docs/53 §4.4). **Never silent auto-pause** (_211 §D).
- **Layout overlay is DERIVED, never persisted.** `layoutReducer` throws on
  unknown actions on purpose, and every reducer transition persists to
  `deck_workspace_layout_v1`. The performance overlay must live entirely
  outside the reducer and outside AsyncStorage.
- **No fallback behaviors, fail loudly** (codex P0). No new WS message types.
  StateManager atomic writes for any new persisted state (none is needed —
  this wave adds zero new stores and zero new endpoints).

---

## 1. The three big calls

### D1 — Hue interpolation: the ENGINE gets shortest-arc, scoped to colour leaves

`lerpParams` (`marsin_engine/lib/color_autopilot.js:505`) is plain linear
per-leaf: a fade `h 0.9 → 0.1` sweeps the LONG way through 0.5 (cyan), while
the Deck's preview maths (`mixHsv`, OKLCH shortest-arc,
`CaptainPad/components/deck/colors_window_logic.ts:202`) takes the short way.
One of them had to move.

**Decision: fix the engine.** Add an exported `lerpHue(a, b, t)` (shortest
arc, modulo 1) and make `lerpParams` use it for the `h` channel when BOTH
endpoints of a one-level sub-object are colour-shaped (numeric `h`, `s`, `v`).
Everything else stays linear. Rationale:

- The engine already owns a shortest-arc interpolator for MANUAL palette
  writes (`lib/color_transition.js`, OKLCH) — the autopilot fade is currently
  the one colour path in the engine that sweeps the long way. This makes the
  daemon consistent with the engine's own slew, not with a tab.
- The wrap pair of any TURNS ring is otherwise visibly wrong: a ring
  `… → h=0.88 → h=0.10` fades backwards through ~78 % of the wheel instead of
  the 22 % the operator picked. Four tight fades and one full-wheel sweep is
  an operator-visible defect, and modelling that defect in the preview
  (the alternative) would enshrine it.
- Blast radius is small and strictly an improvement: `transitionMs` defaults
  to 0 (hard cut — untouched), and existing fading rotations only change
  where the hue wrap-distance exceeds 0.5, which is exactly the case that
  looked wrong. No operator has tuned a look around a long-way sweep.
- Exact-half ties (`d = 0.5`) resolve FORWARD (`+0.5`), deterministically —
  pinned by test, stated here so nobody relitigates the tie.

Reference table (engine `lerpHue` and the client mirror must both pin it):

| a | b | t | result |
|---|---|---|---|
| 0.9 | 0.1 | 0.5 | 0.0 |
| 0.1 | 0.9 | 0.5 | 0.0 |
| 0.2 | 0.6 | 0.5 | 0.4 |
| 0.0 | 0.5 | 0.5 | 0.25 (tie → forward) |
| x | x | any | x |
| any pair | | 0 / 1 | exact endpoints |

### D2 — MASTER/HUE expressibility: widen inline pairs to FULL HSV (backward-compatible)

The Live Touch generators produce five full HSV colours. MASTER is five
identical colours; HUE is one hue at five brightnesses
(`MONO_STEPS = [1.0, .78, .58, .40, .25]`, floor `v ≥ 0.1`). The current
inline-pair wire is hue-only (`{c1, c2}` numbers → `s:1, v:1` at
`api_server.js:5654-5655`), so neither is expressible today.

**Decision: widen the inline-pair schema so `c1`/`c2` are EITHER a number
(hue; resolves `s:1, v:1` — the existing wire, byte-unchanged) OR an
`{h, s, v}` object (each channel finite in [0,1]).** Rationale:

- The CPC params `colorPalette1/2` are already full `{h,s,v}` objects — the
  hue-only pin is a resolver policy, not an engine limitation. This is the
  same widening move as E1 itself (docs/53 §5.3): the validator and the
  resolver grow one branch each; hard cut, tween, seeding and the timeline
  path are untouched because the resolved shape is identical.
- The operator explicitly named "hue" in intent 3. Dropping HUE, or bending
  it into something it isn't, lies about the Live Touch feature we were told
  to duplicate. With full-HSV pairs all four generators port VERBATIM,
  including `BASE.s = 0.95` — the Deck's scheme swatches become byte-identical
  to Live Touch's (the recon's "won't be byte-identical" concern dissolves).
- Docs/36's S=V=1 pin stays TRUE where it lives: the two-colour A/B surface
  and its wheel remain hue-only. Full HSV rides only in rotation rings; the
  wheel positions handles by hue and paints handle FILLS from the true
  broadcast `{h,s,v}` so the glass never claims a brightness the rig doesn't
  have.
- Wire minimization rule: the client emits a plain number whenever
  `s = 1 ∧ v = 1` (ε 1e-6), an object otherwise. Every existing config stays
  valid; every hue-only ring keeps its exact current wire.

Honest caveat for the operator (non-blocking, listed in §8): the HUE scheme's
darkest turn runs the palette at `v = 0.25`. That is what HUE means and it is
his look to choose; the mission's night-visibility bar is why it is called
out rather than silently shipped.

### D3 — Rail chips in performance mode: SUPPRESSED, with one static caption

While performance mode is active, PARAMETERS and AUTOPILOT are hidden from
the deck (intent 5). What do their workspace-bar chips do?

**Decision: the two chips are not rendered at all during performance mode —
neither as open chips nor on the HIDDEN rail — and the bar shows one static
caption in their place: `PERFORMANCE — PARAMS & AUTOPILOT HIDDEN` (microCaps,
`C.icon`, same recipe as the HIDDEN caption).** Rationale:

- A chip that cannot restore its window is exactly docs/53 §3.1's "an
  affordance that always refuses should not exist" — the silently-dead chip
  is the named failure mode, and a tap-to-temporarily-reveal variant
  contradicts the operator's instruction (the panels are hidden BECAUSE it is
  a show).
- Docs/53's rule 2 ("a window with no chip is unreachable, which is worse")
  does not apply: in performance mode the windows are DELIBERATELY
  unreachable, and the reach path is one clearly labelled control — exit
  performance mode — not a chip. The caption exists so "where did my windows
  go" has an answer on the same row the chips vanished from.
- The COLORS chip stays fully live ("COLORS stays as the user left it"):
  opening/closing COLORS during a show is genuine user intent and persists
  normally. The overlay constraint is that the OVERLAY never writes layout —
  a user's own tap always may.
- The overlay reads `usePerformanceMode().active` RAW — not `usePerfLock()`.
  The lock's captain-session bypass is about edit rights, not screen
  composition; "performance mode hides the panels" should mean the mode, for
  every session, symmetric on exit. Not-ready state defaults to inactive
  (everything shown) — hiding on unknown state would be a fallback behavior.

---

## 2. UX spec — the COLORS window

### 2.1 SCHEMES row (intent 1)

**What:** four generator buttons — `MASTER · HUE · COMPLEMENT · CONTRAST` —
in one horizontal row directly BELOW the wheel and ABOVE the slots row,
visible in both `two` and `turns` modes (they paint the same five colours
either way). NOTE (the audio-follow modifier) is out of scope: it is a
latching modifier over a live audio feed the Deck does not consume, not a
scheme; porting it is its own slice if the operator asks.

**Algorithms — Live Touch verbatim** (`touch_control.html:3249-3251, 3297-3302`):

```
BASE_S       = 0.95              (base saturation; the wheel supplies only h)
MONO_STEPS   = [1.0, .78, .58, .40, .25]
COMP_OFFSETS = [0, +60, +30, -30, -60] degrees
master(h)     → 5 × {h, s:.95, v:1}
hue(h)        → MONO_STEPS.map(k → {h, s:.95, v:max(0.1, k)})
complement(h) → COMP_OFFSETS.map(d → {h rotated by d, s:.95, v:1})
contrast(h)   → i∈0..4 → {h rotated by 72·i, s:.95, v:1}
```

The base hue is the **armed slot's hue** (the same hue the wheel is editing).
Live Touch's `BASE.h = 0.72` is only its boot default and does not port.

**Grammar (Live Touch, with one stated deviation):**

- A scheme tap is **momentary**: paints its five colours, flashes the button
  ~260 ms, latches `lastGen`.
- **Deviation from Live Touch:** the latched scheme wears the quiet
  `accentWash` on-state instead of being invisible. On the Deck the latch has
  visible consequences (a wheel drag re-themes five slots and the rig), and
  an invisible mode that repaints things is a trap. Docs/54 canon: tokens may
  differ, grammar may not — this is a grammar-preserving visibility fix,
  recorded here so it is deliberate.
- **applyWheel re-theming:** while a scheme is latched, dragging the wheel
  re-runs the scheme from the new base hue — the whole staged ring re-themes,
  and (when the gate allows) A/B follow (below). Exactly Live Touch's
  `applyWheel → groupSchemeSync` behaviour. **AS BUILT (`_242`, §10):** the
  wheel is a relative DIAL, so a latched drag TURNS the base rather than
  placing it — the dial anchors on `latched.base` through `HueWheel`'s new
  `dialValue` prop, and a tap re-themes nothing at all.
- **Latch clears** when the operator loads any non-scheme selection (Live
  Touch swatch, saved pair, show-palette entry) or hand-edits an individual
  TURNS slot — the ring is then no longer the scheme, and keeping the latch
  would re-theme a ring the operator just personalised.

**What a scheme tap DOES (one rule, both modes):**

1. Stages the five colours into the TURNS draft (`T1–T5`) — a local draft,
   zero wire traffic.
2. If the manual-write gate allows, writes A/B = the scheme's first two
   colours **as pinned hues** (one atomic throttled `/param-center` POST, the
   existing recipe). This mirrors Live Touch, where slots 1–2 are the
   ENGINE-backed pair — and why COMPLEMENT puts the far edge (+60°) in slot 2.
   The A/B surface keeps its docs/36 pin (S=V=1) — full HSV lives only in the
   ring; the stated-on-the-face pin caption stays true.
3. If a rotation is active, see the interaction table (§2.5).

### 2.2 CROSSFADE — drives the rig (intent 2)

The `_211` local preview transport (docs/53 §8 AS BUILT item 1) is
**retired**: its ~24 fps local loop, its `phase` state and its
`PREVIEW · DOES NOT WRITE THE RIG` label all go. The card becomes
**`CROSSFADE · DRIVES THE RIG`**, and the mechanism is the EXISTING
engine-side colour-autopilot daemon — no new daemon, no new endpoint, no new
WS type:

- **RUN** posts ONE colour-autopilot config through the deck's existing
  `handleColorAutopilotChange` (optimistic + rollback + broadcast reconcile):

  ```
  { active: true, shuffle: false,
    delay_s: <HOLD>,               // 0 = continuous (new, §3.1)
    transitionMs: <FADE> · 1000,
    palettes: [ {c1: hA, c2: hB}, {c1: hB, c2: hA} ] }
  ```

  A 2-entry chained ring IS the honest two-slot rendering of "crossfade A↔B":
  each turn the two slots trade places, fading over `transitionMs` (with D1,
  along the short arc). The crossfade and TURNS are thereby the SAME
  mechanism at ring lengths 2 and 5 — which is precisely intent 3's "the
  color fade moves one to the other".
- **Controls:** the existing FADE pills (0.4 / 0.8 / 1.5 / 3 s, reused as
  `transitionMs`) plus a new HOLD pill row `CONT · 1 · 2 · 5 · 10 s`
  (`delay_s` 0 / 1 / 2 / 5 / 10). Default **CONT** — the continuous triangle
  the operator approved in the prototype, now engine-side and
  sleep-surviving. (Engine change §3.1 makes `delay_s: 0` legal.)
- **STOP** posts `{ active: false }` → engine `deactivate()` →
  **freeze-in-place is native** (`_cancelTween` abandons without writing;
  the next write ramps from wherever it froze). The prototype's
  stop-freezes-in-place grammar survives with the RIG as the surface.
- **The card animates from TRUTH.** While the rotation runs, the wash/blend
  indicator derives from the BROADCAST `colorPalette1/2` (the tween frames
  arrive via the throttled sharedParams broadcast) — there is **no local
  animation clock at all**. The glass shows the ship; the preview/engine
  divergence question dissolves.
- **Scrubber:** the BLEND POSITION scrubber remains, endpoints = the active
  crossfade config's pair 0 when one exists (even inactive — the stopped
  config stays in the broadcast state), else the live A/B slots. Its position
  is DERIVED from the broadcast slots (where on the A→B short arc the rig
  currently sits); dragging it performs gated, finger-driven, 33 ms-throttled
  atomic manual writes `cp1 = lerpHue(hA, hB, t)`, `cp2 = lerpHue(hB, hA, t)`
  — the deadman rule is satisfied because nothing writes when the finger
  stops. While the daemon is active a drag is REFUSED with the standard
  sentence; STOP first (the two-step is explicit, never a silent pause).
  Because the scrub write uses the SAME `lerpHue` as the engine tween (D1),
  a frozen fade position round-trips exactly to the scrub value.
- **Mutual exclusivity on the face:** starting the crossfade replaces a
  running TURNS/palette-set rotation and vice versa (one daemon, one config).
  The card states it, same as the TURNS card's existing "Starting TURNS
  replaces it" note.

### 2.3 Scheme → TURNS (intent 3)

Unchanged plumbing, richer colours: the TURNS draft (now five full HSV
colours), staged by a scheme tap or by hand, feeds the existing
`turnsPairs → turnsAutopilotPatch → handleColorAutopilotChange` path.
START TURNS posts the five adjacent pairs; the engine rotation carries each
scheme colour to the rig in turn, fading one to the next (short-arc per D1,
brightness/saturation lerped linearly — so HUE's ramp breathes through its
five brightnesses).

- TURNS slot swatches render the TRUE staged HSV (`hsvCss`), so HUE visibly
  shows its brightness ramp on the glass before it ever hits the rig.
- `TURN EVERY` (5…180 s) and the derived fade (25 % clamped 0.5–3 s) are
  unchanged. `delay_s: 0` is reachable only from the crossfade card's CONT —
  TURNS keeps its cadence floor.
- Ring adoption, `litPairIndex` highlighting and the CUSTOM chips in
  ColorAutopilotPanel all widen mechanically to full-HSV entries (§4).

### 2.4 PATTERNS fullscreen (intent 4)

The bug is **narrow-mode only**: wide mode's flex weights already renormalize
(a lone PATTERNS track takes the whole row). In the narrow stack, PATTERNS is
pinned at `max(400|500, 38.5 % × winHeight)` via
flexBasis/height (`app/(tabs)/index.tsx:1147-1152`) and `ColumnsScrollRest`
(`index.tsx:146-162`, `flex: 1`) owns the rest — so with every other window
hidden, the deck shows PATTERNS over a dead scroll region.

**Fix, strictly conditional:** when the EFFECTIVE open set is exactly
`{patterns}` (layout closures AND the performance overlay both count — a show
with COLORS closed goes fullscreen the moment performance mode starts):

- the PATTERNS track takes `{ flexGrow: 1, flexShrink: 1, flexBasis: 0,
  minHeight: 0 }` instead of the fixed pin;
- `ColumnsScrollRest` collapses (`flexGrow: 0, flexBasis: 0`) but **stays
  mounted** with its children (`display:'none'` windows keep state — the
  no-remount contract is untouched).

In every other composition the party-2026-07-11 PATTERNS-pin contract is
byte-identical: the pin, the 400/500 floors, the 38.5 % scale, and
`narrowScrollOwner` are all untouched whenever ANY second window is open.
The predicate is one pure function (§4.3) so the condition is unit-testable,
not an inline guess.

### 2.5 Performance overlay (intent 5)

A **derived view** over the layout, at the `isOpen` / `flexFor` /
rail boundary — never through the reducer, never through AsyncStorage:

- `useDeckWorkspace()` (in `components/deck/deck_workspace.tsx`) subscribes
  `usePerformanceMode()` and computes the EFFECTIVE open set:
  `perfActive ? open − {parameters, autopilot} : open`. `isOpen`, `open`,
  `flexFor` and the bar's chip lists all answer from the effective set, so
  `app/(tabs)/index.tsx` keeps calling `workspace.isOpen(id)` unchanged and
  the windows hide/show automatically.
- Hidden-by-overlay windows are `display:'none'`, never unmounted — same as
  a rail hide, so scroll offsets, drafts and WS reconciles survive the show
  and everything reappears EXACTLY as left when the operator returns to edit
  mode.
- The persisted layout is never touched by the overlay in either direction:
  entering and leaving performance mode writes nothing; the user's own COLORS
  chip taps during a show persist normally (D3).
- Bar behaviour per D3: PARAMETERS/AUTOPILOT chips unrendered, one static
  caption, COLORS chip live.

### 2.6 Interaction table — what each control does while a rotation is active

`rotationKind(active, palettes)` (new pure fn): `none` · `crossfade`
(all-inline chained ring, length 2) · `turns` (all-inline chained ring,
length ≥ 3) · `palette-set` (anything else — library ids, unchained pairs).

| Operator action | none | crossfade active | turns active | palette-set active |
|---|---|---|---|---|
| Wheel drag / swatch / saved pair (manual CPC write) | writes (gated only by offline/plan) | REFUSED + sentence (existing gate) | REFUSED + sentence (existing) | REFUSED + sentence (existing) |
| Scheme tap | stages T1–T5 + writes A/B (pinned hues) | stages T1–T5 only; message: "Crossfade is driving A/B — STOP it or START TURNS to run the scheme." | **one-tap RESTAGE**: one config POST swaps the ring in place (cadence + fade kept, `setState` cleanly re-cycles, next fade ramps from wherever the rig is); message: "Rotation restaged to CONTRAST." | stages T1–T5 only; message: "AUTOPILOT palette set is driving — START TURNS to take over." |
| BLEND scrub | manual gated writes (finger-driven) | REFUSED + sentence | REFUSED + sentence | REFUSED + sentence |
| CROSSFADE RUN | starts (config POST) | reconfig in place | replaces (stated on face) | replaces (stated on face) |
| START TURNS | starts | replaces (stated on face) | reconfig in place | replaces (existing face note) |
| STOP (either card) | — | freeze-in-place | freeze-in-place | (AUTOPILOT window's own control) |

Why the TURNS restage is one-tap and not two-step: it is a CONFIG write
through the daemon's own front door, not a manual CPC write — the daemon
remains the single palette writer throughout, the effect is immediate and
visible on the rig and on the card, and the message line narrates it. The
two conservative cases (crossfade / palette-set active) stage-without-firing
because a restage there would silently change the rotation KIND or destroy a
config another surface owns — those takeovers stay behind the explicit
START TURNS / RUN buttons. Nothing anywhere auto-pauses.

---

## 3. Engine changes (all in existing files; no new endpoints, no new WS types)

### 3.1 `marsin_engine/lib/color_autopilot.js`

1. **`validate` — `delay_s: 0` is legal, with a loud guard** (today
   `delay_s <= 0` throws, line ~238): allow `delay_s >= 0`; when
   `delay_s === 0` REQUIRE `transitionMs >= 100`, else throw
   `"colorAutopilot.delay_s 0 (continuous) requires transitionMs >= 100"`.
   Zero hold + zero fade would be a hard-cut spin loop flooding the CPC —
   that config must be unrepresentable, not clamped.
2. **`_scheduleNext` honors 0** (line ~314): the current
   `Number(st.delay_s) > 0 ? … : DEFAULT_DELAY_S` would silently turn CONT
   into a 30 s hold — exactly a hidden fallback. Change to accept any finite
   `>= 0` value and fall back only for the truly-absent case. With
   `delay_s: 0` the cycle is back-to-back awaited fades: tick → fade
   (`transitionMs`) → reschedule(0) → tick — the additive-scheduling model is
   unchanged, the hold is simply zero.
3. **`validate` — full-HSV pair entries** (lines ~218-237): for an object
   entry, each of `c1`/`c2` is EITHER a number (existing hue check) OR an
   object with numeric finite `h`, `s`, `v` all in [0,1] (each channel
   checked, loud throw naming the index + channel). Deep-copy on accept
   (the existing no-aliasing rule).
4. **`lerpHue` + colour-aware `lerpParams`** (line ~505): export
   `lerpHue(a, b, t)` (shortest arc mod 1, D1 table); in `lerpParams`'
   one-level object recursion, when BOTH sub-objects are colour-shaped
   (numeric `h`/`s`/`v`), interpolate `h` via `lerpHue`, `s`/`v` linearly.
   Non-colour objects and all other leaves are byte-identical to today.

### 3.2 `marsin_engine/lib/api_server.js`

5. **Resolver full-HSV branch** (`resolveColorPaletteParams`, line ~5645):
   number → `{h, s: 1, v: 1}` (unchanged); object channel → copied
   `{h, s, v}`. Same loud per-channel validation as the daemon's validate
   (this resolver is also reached by timeline/look paths).
6. **Seed on REST activation** (`setColorAutopilot`, line ~5733): when the
   validated wire is `active: true` and `paramCenter` exists, call
   `colorAutopilot.seedCurrentParams({colorPalette1, colorPalette2})` from
   the live CPC — the exact four lines the timeline path already runs
   (5752-5755), WITHOUT `triggerNext()` (the manual wait-then-cycle cadence
   ruling stands). Effect: the FIRST transition of any deck-started rotation
   fades from what is actually on the rig instead of hard-cutting. For the
   crossfade card this is belt-and-braces (its pair 0 equals the live slots
   by construction), for a scheme TURNS start it is the visible fix.

Nothing else engine-side. `/color-autopilot` REST, the WS `colorAutopilot`
broadcast, `/color-pairs`, the runtime-file persistence split and the
timeline path are all untouched (full-HSV entries persist verbatim through
the runtime YAML exactly as hue pairs do today).

---

## 4. Client changes

### 4.1 `CaptainPad/components/deck/colors_window_logic.ts` (pure)

- `SCHEME_IDS`, `generateScheme(scheme, baseH): Hsv[]` — §2.1 verbatim
  constants; plus `SCHEME_BASE_S = 0.95`.
- `lerpHue(a, b, t)` — the exact engine formula (D1 table pinned in BOTH
  suites so the two can never drift).
- Pair type widening: `type ColorChannel = number | Hsv`;
  `ColorPair = { c1: ColorChannel; c2: ColorChannel }`; helpers
  `hueOf(c)`, `asHsv(c)`, `channelForWire(c: Hsv): ColorChannel` (emits a
  plain number when `s = 1 ∧ v = 1`, ε 1e-6 — the wire-minimization rule).
- `turnsPairs` / `turnsAutopilotPatch` accept `Hsv[]` (draft is now colours,
  not hues); `isTurnsConfig` chains on full-colour equality;
  `turnsColors(palettes): Hsv[]` (supersedes `turnsHues`); `litPairIndex`
  compares broadcast `{h,s,v}` per channel (ε 1e-4).
- `rotationKind(active, palettes)` — §2.6.
- `crossfadeAutopilotPatch(hA, hB, holdS, fadeS)` — the exact §2.2 payload in
  one place, mirroring `turnsAutopilotPatch`; throws on `holdS 0` with
  `fadeS < 0.1` (the client refuses what the engine would refuse, with the
  same sentence style).
- `blendFromBroadcast(hA, hB, hLive): number | null` — where on the A→B short
  arc the live slot sits (null when off-segment → the card shows "—").
- The retired preview leaves: `advancePhase` / `seekPhase` / `blendAt` /
  `triangle` go (and their tests), `mixHsv` STAYS (scrubber-track gradient
  display).

### 4.2 `CaptainPad/components/deck/colors_window.tsx`

- SCHEMES row (§2.1) between wheel and slots (render section anchors: wheel
  ~line 425, slots ~447). Latch state + 260 ms flash + `accentWash` on-state;
  base hue = armed slot; wheel-drag re-theme while latched; latch-clear rules.
- CROSSFADE card rewrite (§2.2) in the mode-transport section (~line 476):
  delete the local loop (`PREVIEW_FRAME_MS`, `running/phase` state, lines
  ~75, 240-296), add HOLD pills, RUN/STOP via `onColorAutopilotChange`,
  broadcast-derived wash + blend indicator, gated scrubber writes.
- TURNS draft `number[]` → `Hsv[]` (~line 206); slot swatches via `hsvCss`;
  restage flow per §2.6; message-line narration for every refusal/restage.
- Gestures: the scheme row and HOLD pills are horizontal `TimerPillBar`-class
  rows (sanctioned axis); no new vertical scroll surfaces inside the window;
  the wheel's capture-phase responder is untouched.

### 4.3 Workspace: `deck_workspace_layout.ts`, `deck_workspace.tsx`, `index.tsx`

- `deck_workspace_layout.ts` (pure): `PERF_HIDDEN_WINDOWS =
  ['parameters','autopilot']`; `effectiveOpenWindows(layout, perfActive)`;
  `effectiveRailWindows(layout, perfActive)`;
  `patternsFillsNarrow(open): boolean` (true iff open is exactly
  `['patterns']`). The reducer, normalizer, persistence key and
  `narrowScrollOwner` are NOT touched.
- `deck_workspace.tsx`: `useDeckWorkspace()` subscribes
  `usePerformanceMode()`; `open`/`isOpen`/`flexFor` answer from the effective
  set; controller gains `perfActive: boolean`. `DeckWorkspaceBar` takes
  `perfActive`, renders effective chip lists + the D3 caption.
- `app/(tabs)/index.tsx`: narrow PATTERNS style branch (lines 1147-1152)
  gains the `patternsFillsNarrow` fill case (§2.4); `ColumnsScrollRest`
  (lines 146-162) gains a `collapsed` prop (`flexGrow:0, flexBasis:0`,
  children stay mounted); `<DeckWorkspaceBar … perfActive={…} />` (~line
  1059).
- `CaptainPad/utils/api.ts` + `utils/timelineApi.ts`: palette-entry types
  widen to the full-HSV channel union (same one-line move as _211 §3.4 —
  a cue that captures a live config can capture a full-HSV ring).
- `ColorAutopilotPanel.tsx`: CUSTOM `DualSwatch` chips read `hueOf`-style
  channels so a full-HSV ring renders (today's code assumes numeric `c1`);
  countdown/TURN EVERY renders `delay_s: 0` as `CONTINUOUS` instead of a
  blank pill (acceptance: no crash, no lying label).

### 4.4 Data flow (one picture)

```
SCHEME tap ──stage──► TURNS draft (5 × Hsv, local)
     │                      │ START TURNS / RESTAGE
     └─(gate ok)─► /param-center A/B write        ▼
                                    handleColorAutopilotChange
CROSSFADE RUN ──────────────────────────────► POST /color-autopilot
                                                    │ validate (full-HSV, delay_s ≥ 0)
                                                    ▼
                                          ColorAutopilot daemon (ENGINE)
                                          hold → fade (lerpHue arc) → …
                                                    │ paramCenter.set per frame
                                                    ▼
                        sharedParams broadcast ◄── CPC ──► sACN → rig
                                    │
        COLORS card wash / blend indicator / handle fills (DERIVED, no clock)
```

---

## 5. Implementation contract (ordered work items)

Each item lands with its tests; the order keeps every intermediate state
shippable. Baselines that must stay green throughout: CaptainPad
`npx vitest run` **1328 pass / 6 skip / 0 fail** (72 files, plus this wave's
new cases), `npx tsc --noEmit`, eslint on touched files,
`npm run web:build`; engine `tests/effects/color_autopilot.test.js` (29) +
`color_window_engine_api.test.js` (8) + the full engine suite; companion
suite untouched (no companion files in scope).

| # | Item | Files | Acceptance |
|---|---|---|---|
| 1 | `lerpHue` + colour-aware `lerpParams` | `color_autopilot.js` | D1 table pinned; non-colour objects byte-identical (existing lerp tests unchanged); tie-forward case pinned |
| 2 | `delay_s: 0` (validate + `_scheduleNext`) | `color_autopilot.js` | 0+fade≥100 accepted; 0+fade<100 throws; fake-clock test proves back-to-back fades with NO 30 s fallback hold; existing delay>0 behavior unchanged |
| 3 | Full-HSV pair entries (validate + resolver) | `color_autopilot.js`, `api_server.js` | number channels byte-unchanged; object channels resolve verbatim; junk channels throw naming index+channel; round-trips runtime YAML + HTTP GET/POST |
| 4 | Seed on REST activation | `api_server.js` | HTTP test: activate with live CPC set → first tick FADES from live palette (no snap); inactive POST does not seed; cadence unchanged (no immediate apply) |
| 5 | Logic module: schemes, `rotationKind`, pair widening, `crossfadeAutopilotPatch`, `blendFromBroadcast`, preview-math removal | `colors_window_logic.ts` (+tests) | generator tables exact vs the HTML constants; wire-minimization rule; D1 table mirrored; `turnsPairs`/`isTurnsConfig`/`litPairIndex` green on both channel forms |
| 6 | SCHEMES row UI + latch/re-theme + restage flow | `colors_window.tsx` | §2.1 grammar incl. deviation note; §2.6 table row-by-row — every refusal shows its sentence on the message line |
| 7 | CROSSFADE card rewrite | `colors_window.tsx` | local loop deleted (no `setInterval`/rAF driving state while idle); RUN posts the exact §2.2 payload; STOP freezes; wash/indicator derived from broadcast only; scrubber gated + `lerpHue` writes |
| 8 | Types + ColorAutopilotPanel widening | `api.ts`, `timelineApi.ts`, `ColorAutopilotPanel.tsx` | tsc clean; full-HSV ring renders CUSTOM chips; `delay_s: 0` renders CONTINUOUS |
| 9 | Perf overlay (pure fns + hook + bar) | `deck_workspace_layout.ts`, `deck_workspace.tsx`, `index.tsx` | overlay never dispatches/persists (assert AsyncStorage key byte-identical across enter/exit); chips suppressed + caption; COLORS chip live; windows reappear with state intact |
| 10 | Narrow fullscreen | `deck_workspace_layout.ts`, `index.tsx` | `patternsFillsNarrow` table; pin contract byte-identical whenever a second window is open; fill engages via layout AND via overlay |
| 11 | docs/53 §8 AS BUILT update (crossfade item superseded → this doc) + `_211` §7 try-steps amendment | `docs/53` | doc states the preview is retired and why |

**Test-engine hygiene (mandatory):** spawned engines must NOT bleed sACN onto
the operator's rig — the loopback pseudo-blackhole the shared harness
documents is NOT isolation (the sim's receiver binds all interfaces; see
`.agent/memory/spawning_a_test_engine.md`). Use `--dest` on a TEST-NET-1
(RFC 5737) address or a no-sACN configuration, high ports only, and never
touch the operator's `:6967`/`:6968` stack.

### Screenshot verification matrix

Fresh dist on **:7167** (`npm run web:build` + serve — NEVER the operator's
:6967, which he manages himself), console-mute via `evaluateOnNewDocument`
BEFORE boot (memory: captainpad-screenshot-technique), one tab, iPad-wide
(landscape ≥ 900 px) AND narrow (portrait) at each row. Engine proof = the
isolated engine's `/param-center` + `/color-autopilot` reads captured
alongside the UI shot.

| # | Scenario | Shots | Proof of truth |
|---|---|---|---|
| S1 | SCHEMES row: before (no row) / after; CONTRAST tapped (flash + 5 slots painted + A/B moved); HUE tapped (visible brightness ramp in slots) | wide + narrow | `/param-center` shows A/B = scheme[0..1] hues |
| S2 | Crossfade drives the rig: card RUNNING (CONT + 1.5 s fade) | wide | `/color-autopilot` = active 2-pair ring, `delay_s 0`; two `/param-center` reads ≥ 1 s apart with MOVING slot hues; STOP → third read frozen between endpoints |
| S3 | TURNS from a scheme: CONTRAST → START TURNS | wide + narrow | `/color-autopilot` = 5 chained pairs; for a HUE ring the read shows full-HSV entries (`v` ramp) on the wire |
| S4 | Rotation-active grammar: wheel drag refused (sentence visible); scheme tap during TURNS = restage (config palettes changed, `active` stayed true, cadence unchanged) | wide | before/after `/color-autopilot` reads |
| S5 | All-hidden fullscreen: narrow, PARAMETERS+AUTOPILOT+COLORS closed — before (dead region) / after (PATTERNS fills); reopen one window → pin restored byte-identical | narrow | — |
| S6 | Perf overlay: edit mode (all chips) / performance mode (2 windows gone, chips gone, caption present, COLORS untouched) / back to edit (everything restored) | wide + narrow | engine `/performance-mode` reads; AsyncStorage `deck_workspace_layout_v1` value identical across the round trip |

Visually inspect every PNG before claiming success; screenshots +
engine-read transcripts under `~/tmp/fix_<report>/`.

---

## 6. What this wave deliberately does NOT do

- No NOTE / audio-follow modifier on the Deck (own slice if asked).
- No full-HSV editing on the two-colour wheel — A/B stay pinned hue-only
  (docs/36); full HSV exists only inside rotation rings.
- No new endpoints, WS types, daemons or stores; no saved-pair schema change
  (the "pair carries its fade time" open question from `_211` stays open).
- No change to TURNS cadence floors, the derived-fade rule, the pair store,
  or the plan-lock/scrim behavior.

## 7. Supersessions

- docs/53 §8 AS BUILT item 1 ("the crossfade is a PREVIEW") is superseded by
  §2.2 here: the preview existed because a tab-side driver was forbidden and
  no engine mechanism existed; `delay_s: 0` + the 2-pair ring IS that
  mechanism, engine-side.
- `turnsHues` semantics (hue-only ring) superseded by `turnsColors`
  (full-HSV ring); wire compatibility preserved by the number/object channel
  union.

## 8. Open questions for the operator (non-blocking — defaults chosen)

1. **HUE at night:** the darkest HUE turn runs `v = 0.25`. Default: shipped
   as designed (it is the Live Touch algorithm, verbatim). Say the word and
   the floor rises.
2. **Crossfade HOLD default:** CONT (continuous triangle, prototype feel).
   Alternative: a short hold (1–2 s) reads calmer on some patterns.
3. **Perf caption wording:** `PERFORMANCE — PARAMS & AUTOPILOT HIDDEN`.

---

## 9. Amendment — `_224` (operator orders after the `_217` build)

Four further operator orders landed on the COLORS window in report
`.agent/reports/202608/20260815_224_turns_rotation_polish.md`. Two of them
SUPERSEDE rules stated above; both are recorded here so nobody implements this
document's earlier wording by mistake.

**A9.1 — §2.3's TURNS timing is superseded. One transport drives both rings.**
Operator: *"the turning is smooth and needs to happen on the same timescale as
the two color crossfader"* / *"use the same fade time out and interval as the
two color"*.

- `TURN EVERY` (5…180 s) and the **derived fade** (25 % of the turn, clamped
  0.5–3 s) are GONE. `derivedTransitionMs` is deleted, not deprecated.
- TURNS renders the crossfade card's own FADE and HOLD pill rows — the same
  component, the same two values — and both cards build their config through one
  `rotationAutopilotPatch(colours, holdS, fadeS)`. §2.2's claim that the
  crossfade and TURNS are "the SAME mechanism at ring lengths 2 and 5" is now
  enforced by them being the same *function* rather than two kept in step.
- **"TURNS keeps its cadence floor" no longer holds.** `delay_s: 0` is reachable
  from TURNS: in CONT a five-colour ring slides its window continuously. §3.1's
  zero-hold-plus-zero-fade guard is untouched and unchanged — the spin loop stays
  unrepresentable — and the client now mirrors that same refusal so the operator
  reads a sentence instead of collecting a 400.
- The shared HOLD row is a SUPERSET of §2.2's: `CONT · 1 · 2 · 5 · 10 · 30 · 60 s`.
  The 120 s and 180 s cadences do not survive "the same interval as the two
  color". The shared default is CONT (§8.2's answer), so TURNS no longer defaults
  to a 30 s cadence.

**A9.2 — §2.3's `litPairIndex` highlighting is insufficient; the window is now
derived mid-fade.** Operator: the rotation is a sliding adjacent-pair window over
the five slots, wrapping, and the UI must show which pair is live and animate the
highlight in step with the engine broadcast.

`litPairIndex` only recognises the rig when it sits EXACTLY on a pair — i.e.
during the hold — so under A9.1's CONT the highlight would never light at all.
`rotationCursor(palettes, c1, c2)` inverts the daemon's own tween
(`lerpParams`: `h` short-arc per D1, `s`/`v` linear) as a least-squares
projection of the live palette onto the from→to segment, with a residual check
that returns `null` rather than mapping a foreign palette onto a plausible
progress. It yields the window being ARRIVED AT and how far through.

The deadman rule of the Hard rails above is UNCHANGED and still satisfied: this
is derived from the broadcast, never clocked. It advances only as engine tween
frames arrive and stops dead when the rig does — there is still no
`setInterval`/rAF in `colors_window.tsx`.

**A9.3 — §2.1's scheme→A/B rule gains a selection.** §2.1 item 2 wrote A/B from
"the scheme's first two colours". The operator asked for the ACTIVE TWO to be
pickable: slots 1+2 remain the default, and any other slot can be assigned to A
or B through the window's existing arm-then-tap grammar. The selection is stored
as RING INDICES so §2.1's `applyWheel` re-theme carries it forward. Assigning
both channels to one slot is refused by name. **Consequence for §2.1's latch:**
the latch now carries its BASE HUE (`{ scheme, base }`) instead of the base being
re-derived from the armed slot — that read is circular once A and B are
themselves scheme slots, and it made A and B collapse onto one hue. Only a wheel
drag re-bases a latched scheme.

**A9.4 — the scheme row grows to nine generators.** Operator: *"also similar to
complimentary and other contrasting, add a few more technique to sample nice
looking color duos or 5 samples."* ANALOGOUS, TRIADIC, SPLIT, TETRAD and GOLDEN
join the four Live Touch ports, which keep their original places at the head of
the row. Their step tables live beside the ports in `colors_window_logic.ts` and
obey two rules the ports did not have to state: every ADJACENT pair (including
the T5→T1 wrap) must be a duo worth putting on the rig, and a construction that
repeats its base dims the repeat so no turn is a dead beat. They clamp at
`v ≥ 0.25` — §8.1's HUE precedent — while the four ports keep their own verbatim
`SCHEME_MIN_V = 0.1`, because re-flooring a PORT would make the Deck and Live
Touch disagree about what MASTER and HUE mean.

**Unchanged by `_224`:** every engine contract in §3 (no engine source file was
touched), the D1/D2/D3 decisions, §2.4 fullscreen, §2.5 the performance overlay,
§2.6's interaction table, and §6's list of what the wave deliberately does not do.

---

## 10. Amendment — `_242` AS BUILT: the wheel is a DIAL

Report `.agent/reports/202608/20260815_242_hue_dial_palette_presets.md` replaced
the wheel's touch model. Everywhere this document says "dragging the wheel" the
mechanism is now a **relative rotation**, not an absolute placement. Operator:
*"the color wheel, when i click, it has an unpleasant jump. can you make it a
dial of some sort that I can consistently control by touch"*. The contract, and
docs/53 §4.2's AS BUILT note, in short:

- **Touch-down ANCHORS; it does not paint.** `onPanResponderGrant` no longer
  calls `hueFromPoint → onPick`. It records the value and the finger's angle
  (`beginDial`), and the hue then follows the **accumulated angular delta**
  around the centre, geared by `DIAL_GAIN = 0.5` — one physical revolution is
  half a hue revolution.
- **A plain tap changes nothing, by construction** (zero delta is zero change),
  and `onDragStart`/`onDragEnd` fire only for a drag that actually MOVED, so a
  tap does not reach the parent's flush and writes nothing to the rig. The
  §2.1 scheme latch is likewise untouched by a tap.
- **The grab point is irrelevant.** Ring, rim, hub or the overshoot area all
  steer identically; grabbing a handle (`GRAB_PX = 26`) only **ARMS** it.
- **The 0°/360° seam is an ordinary step** — every sample is a short-arc
  `turnDelta` from the PREVIOUS sample, so multi-lap drags accumulate.
- **The hub has no angle.** Inside `DIAL_DEAD_RADIUS_PX = 14` a sample carries
  none: `lastAngle` goes `null` and a value change needs two consecutive
  samples with real angles, so a swipe through the centre freezes the dial.
- **`dialValue` (new `HueWheel` prop) is what A9.3 needed.** A9.3 put the base
  hue in the latch (`{scheme, base}`); the dial must anchor on **that base**
  while a scheme is latched — `colors_window` passes
  `latched ? latched.base : undefined` — because anchoring on `hues[armed]`
  would re-introduce the jump exactly where A/B point at a ring slot other than
  T1. The pointer and centre readout follow `dialValue` too.
- **Chrome per docs/54:** a knurled hub, a 36-mark tick ring (`dialTicks`,
  majors every 3rd) and a pointer at the steered value; hub rim + pointer lit
  in `armedStroke` while gripped.

**Unchanged by `_242`:** the `_211` gesture armor §4.2 calls untouched (capture
-phase responder on start and move, refused termination request, web
`touchAction:'none'`), the docs/36 S=V=1 pin on the A/B surface (§6's "no
full-HSV editing on the two-colour wheel" stands), the throttled atomic
`/param-center` write, §2.6's interaction table (a manual turn is still REFUSED
with the standard sentence under any active rotation — and a tap now writes
nothing to refuse), and every engine contract in §3. The dial changed how a
touch is READ, not what the ring MEANS: angle↔hue still maps exactly as before,
which is what keeps each handle sitting on its own colour.

**Also landed in `_242`, outside this document's scope but adjacent to §2.1's
"saved pair" wording:** the SAVE PAIR button is now **SAVE PALETTE** and
`/color-pairs` is `schemaVersion: 2` — `c1`/`c2` still required and unchanged,
with optional `name`, `ring` + `sel` and `scheme` + `base` alongside, so a
recall can restore a whole staged ring plus its latch. Contract in docs/53 §8.
