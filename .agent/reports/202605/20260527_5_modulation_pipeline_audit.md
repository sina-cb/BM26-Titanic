# Modulation Pipeline Audit (2026-05-27)

Scope: read-only trace of the engine's playlist-modulation pipeline from
a CPC source (e.g. `micLow`) through to a per-frame slider write on the
running pattern. Sibling Agent F is rewriting playlist YAMLs in parallel
— this audit does not touch any source/playlist/test file.

## Verdict

**PIPELINE WORKS WITH CAVEATS.** The math, schema validation, source
resolution, and write path are correct and Codex-P0 clean (no silent
fallbacks). All caveats are *operator-surface* gotchas (range semantics,
post-processing latency on `micKick`, default chain on stems being
gain-only, hard pattern-only target scope) — not bugs in the engine.

## Data path (frame-by-frame trace)

Concrete trace for `micLow → sliderLocalSpeed` on the active deck
channel, starting from the moment a kick lands in the mic:

1. **Browser-side capture → engine ring buffer.** `AudioCapture`
   (CoreAudio/WebAudio path) lands PCM samples into the analyzer's hop
   queue. Not in this audit's scope.

2. **Spectral analysis.** `marsin_engine/lib/audio_analyzer.js` runs
   per-hop FFT, computes per-band magnitudes via `_bandEnergy`
   (`audio_analyzer.js:506-515`, sum-of-magnitudes), and asymmetric
   envelope follow per band (rising α = attack, falling α = release).
   Kick path also runs an EMA + Schmitt + refractory + exp decay
   (`audio_analyzer.js:438-461`). The pre-clamped band values `low`,
   `mid`, `high`, `kick` are emitted to the `onAnalysis` callback
   (`audio_analyzer.js:481-491`).

3. **Per-signal chain post-processing.** `engine.js:1041-1062` runs each
   raw band through `signalPostProcessor.process(signalKey, raw, dt)`
   (`signal_post_processor.js:671-701`). Default chain per signal is in
   `DEFAULT_CHAINS` (`signal_post_processor.js:69-94`):
   - `micLow/Mid/High`: single Gain op (`paramKey: 'mic<Band>Gain'`).
   - `micKick`: Gain → Envelope(attack 8 ms / release 180 ms) →
     Schmitt(tHigh 0.5 / tLow 0.3 / refractory 200 ms) → Hold(timeout
     120 ms / decay 120 ms).
   - `stemsBass/Drums/Vocals`: single Gain op.

4. **Write to CPC.** `engine.js:1054-1063` calls
   `paramCenter.setMany([...])` atomically with all four mic keys (and
   the four `*Raw` mirrors for diagnostics).
   `paramCenter._setNoFire` (`param_center.js:444-462`) clamps to the
   registry range (`[0, 1]` for `mic*`), bumps `_revision`, sets the
   slot's `dirty` flag, and `_fireOnChange` runs subscribers
   (broadcast / persist throttling).

5. **Render loop flush.** Each engine tick (`engine.js:382-407`):
   1. accumulates `patternClockSeconds`,
   2. `paramCenter.flushDirty(wasmHost)` pushes CPC-owned values to
      pattern instances (`param_center.js:795-822`),
   3. **`beforeFrame` hook fires** →
      `modulationController.applyFrame(now)`
      (`engine.js:886`, `modulation_controller.js:79-165`),
   4. then `mixer.beginFrame(elapsed)` and per-pixel render.

6. **`applyFrame` per-tick work** (`modulation_controller.js:79-165`):
   1. Grab the deck channel + its WASM handle. Bail (and clear baseline
      bookkeeping) if no channel yet.
   2. Pull every export with `kind === 1` (slider) via
      `wasmHost.getExports(handle)`.
   3. Build `baseParams[name] = channel.localControls[id].v0 ?? exp.v0
      ?? 0` — i.e. the operator's current *unmodulated* slider value
      (or the pattern-declared `v0` default).
   4. Snapshot CPC (`paramCenter.getAll()`) and call
      `resolveModulationSources({ paramCenterSnapshot })`
      (`modulation_engine.js:162-173`). Missing keys default to `0`
      (documented: no-op when source pipeline is dark).
   5. Call `applyModulations(...)` (`modulation_engine.js:191-237`).
      For each enabled, continuous mapping whose target exists in the
      slider-export set, compute `modulated = applyContinuousModulation(
      baseNorm, sourceNorm, mode, polarity, range, curve)`. First mapping
      per target wins; duplicates warn and are dropped
      (`modulation_engine.js:211-216`).
   6. Write the modulated value back to WASM via
      `wasmHost.setControl(handle, exp.id, modulated, 0, 0)`
      (`modulation_controller.js:114`). Note this writes directly through
      `wasm_host`, bypassing the `ChannelParamRouter`'s
      `shared_ownership` / `blocked_by_shared` gates — by design, since
      the modulation pipeline does not target CPC-owned sliders.
   7. Baseline restoration: any name in `_lastWrittenTargets` that
      isn't in this frame's `newlyWritten` set gets `baseParams[name]`
      written back exactly once (`modulation_controller.js:122-131`).
      This is the "operator turned the modulation off → slider
      snaps back to my last value" guarantee.
   8. Throttled broadcast of `{ type: 'modulationState', deckId,
      pattern, parameters }` on `/ws/params` at 20 Hz default
      (`modulation_controller.js:26-30, 159-164`), with a one-shot
      "empty frame" emission on the >0 → 0 transition so the iPad
      ghost overlay clears (`modulation_controller.js:46-51, 154`).

7. **Pattern reads value.** Next `beginFrame` → `render3D` per pixel.
   The pattern's `sliderLocalSpeed(v)` setter (e.g.
   `04_beat_folded_helix.js:17`) has already received the modulated
   value via `wasmHost.setControl` and stored it in the pattern-local
   `var localSpeed`. The pattern's own `beforeRender` uses that value
   to drive `dSpeed`.

## Schema enforcement

`validateModulationMapping` (`modulation_engine.js:247-299`) is the
single gate used by both `playlist_manager.load`
(`playlist_manager.js:174-181`) and the load-time coercion
(`playlist_manager.js:225-251`). Coercion is *lenient at load*: an
invalid mapping is dropped with a warning so one bad entry can't take
down a whole playlist. CRUD `PUT/PATCH` paths in `api_server.js` use the
same validator (search confirmed `validateModulationMapping` is the only
import from `modulation_engine.js` in `playlist_manager.js:5`).

Per-field rules:

- **id** — non-empty string (`modulation_engine.js:252-254`).
- **type** — exactly `'continuous'` (`modulation_engine.js:255-257`).
  `'trigger'` is reserved (typedef line 41-43) but rejected.
- **enabled** — boolean (`modulation_engine.js:258-260`).
- **source.scope** — exactly `'cpc'` (`modulation_engine.js:265-267`).
- **source.key** — one of: `micLow`, `micMid`, `micHigh`, `micKick`,
  `stemsBass`, `stemsDrums`, `stemsVocals` (`modulation_engine.js:80-83`,
  enforced 268-270).
- **target.scope** — exactly `'pattern'` (`modulation_engine.js:275-277`).
- **target.parameter** — non-empty string
  (`modulation_engine.js:278-280`). Existence on the active pattern is
  **NOT** validated at this layer — see "Slider target resolution"
  below.
- **mode** — `'offset' | 'scale'` (`modulation_engine.js:87, 281-283`).
- **polarity** — `'unipolar' | 'bipolar'`
  (`modulation_engine.js:88, 284-286`).
- **curve** — `'linear' | 'easeIn' | 'easeOut' | 'exp'`
  (`modulation_engine.js:89, 287-289`).
- **range** — `[lo, hi]`, both finite, both within `[-1, 1]`
  (`modulation_engine.js:290-297`). Note: the validator does NOT
  enforce `hi >= lo`; a swapped pair (e.g. `[0.5, 0.0]`) passes
  validation and is then handled as the reverse linear ramp by
  `applyContinuousModulation`. See gotcha #6.

## Slider target resolution

`target.parameter` lookup is a `Map` of WASM export names built in
`modulation_controller.js:88-89` from `wasmHost.getExports(handle)`,
filtered to `exp.kind === 1` (slider) in
`modulation_controller.js:93, 103`. The mapping resolves on every frame
— there is no AOT caching, so a freshly compiled pattern picks up the
new export set automatically.

The write itself is **`wasmHost.setControl(handle, exp.id, modulated,
0, 0)`** (`modulation_controller.js:114`) — i.e. it calls into the
WASM VM directly. The pattern's exported `slider<Foo>(v)` function
receives the modulated `v` and stores it in its local `var foo`
(see `04_beat_folded_helix.js:17`).

Edge cases:

- **Slider not on active pattern** — *silent skip, no warning, no
  error.* `modulation_controller.js:104` gate
  (`!targetMap.has(targetParam)`) and `:110-111` gate
  (`v.mappingId === undefined`) both drop. Operator-visible symptom:
  no ghost dot appears in the iPad's modulation overlay because the
  per-frame broadcast also skips. (Note: the schema validator already
  ran at load time, but it can't catch a mismatch because pattern
  exports are runtime-discoverable.)
- **Multiple modulations targeting the same slider** — *first
  enabled wins; subsequent duplicates warn via `console.warn` and
  are dropped* (`modulation_engine.js:211-216`).
  `playlist_manager._coerceModulations` *also* drops duplicates at
  load time (`playlist_manager.js:236-241`), so the runtime safety net
  is for cases where validation order differs (CRUD path) or future
  in-memory mutation. Net behavior: never additive, never last-wins.
- **CPC-owned target (e.g. `sliderSpeed` when CPC owns `speed`)** —
  the modulation write bypasses `ChannelParamRouter` and goes straight
  to `wasmHost.setControl`. **The CPC-block guard in
  `channel_param_router.js:11-17` is NOT enforced on the modulation
  path.** In practice it doesn't matter because: (a) `speed` and
  `size` are `engineOwned: true` and never injected into the pattern
  at all (`param_center.js:651-660`), and (b) the CPC-owned `slider*`
  exports are exotic. But see gotcha #5.
- **Disabled mapping** — `applyModulations` skips
  (`modulation_engine.js:208`); baseline restoration writes the
  unmodulated value back exactly once
  (`modulation_controller.js:122-131`).

## CPC source resolution

**Canonical key list** lives in two places that *must* agree:
1. The CPC param registry (`param_center.js`):
   - `micLow` (`:162-167`), `micMid` (`:168-173`), `micHigh`
     (`:174-179`), `micKick` (`:180-185`).
   - `stemsBass` (`:108-113`), `stemsDrums` (`:114-119`),
     `stemsVocals` (`:103-107`).
   - All live, non-persistent, range `[0, 1]`, clamped on write.
   - Raw mirrors (`*Raw`) exist but are NOT valid modulation source
     keys.
2. `modulation_engine.VALID_SOURCE_KEYS`
   (`modulation_engine.js:80-83`) — and the same set is re-used in
   `signal_post_processor.KNOWN_SIGNALS` (`signal_post_processor.js:55-58`).

`resolveModulationSources` (`modulation_engine.js:162-173`) reads the
seven keys from a `paramCenter.getAll()` snapshot. **Missing or
non-finite values default to `0`** — by-design no-op behavior so a
modulation referencing a stems key never crashes when the OSC source
is dark (`modulation_engine.js:76-79, 168-171`).

**Post-processing per signal** (`signal_post_processor.js`):

| Signal       | Default chain (in order)                                   |
|--------------|------------------------------------------------------------|
| `micLow`     | Gain(`paramKey:'micLowGain'`)                              |
| `micMid`     | Gain(`paramKey:'micMidGain'`)                              |
| `micHigh`    | Gain(`paramKey:'micHighGain'`)                             |
| `micKick`    | Gain(`micKickGain`) → Envelope(8/180 ms) → Schmitt(0.5/0.3/200 ms) → Hold(120/120 ms) |
| `stemsBass`  | Gain(`paramKey:'stemsBassGain'`)                           |
| `stemsDrums` | Gain(`paramKey:'stemsDrumsGain'`)                          |
| `stemsVocals`| Gain(`paramKey:'stemsVocalsGain'`)                         |

Per-op math citations in `signal_post_processor.js:752-1002`. The chain
result is `clamp01`'d before write (`signal_post_processor.js:700`),
and the CPC entry's own clamp re-asserts `[0, 1]` on `set`
(`param_center.js:303-330`).

**Effective range at the modulator's input:** `[0, 1]` (CPC clamp +
chain output clamp). Note this means **post-gain values saturate at
1.0 — if `*Gain > 1.0` (max 2.0), the chain may clip and the
modulator sees a long plateau at 1.0.** Operator-visible symptom: with
gains cranked, modulation amplitude appears stuck at `range[1]`.

## Polarity / mode / curve semantics

All math in `applyContinuousModulation` (`modulation_engine.js:117-153`).

- **`mode: offset`** —
  `modulated = clamp01(base + delta)`.
  Symmetric, easy to reason about. Linear addition.

- **`mode: scale`** —
  `modulated = clamp01(base * (1.0 + delta))`.
  `delta=0 → no change`, `delta=+0.5 → 1.5×`, `delta=-1.0 → 0`.
  When `base=0`, `scale` mode produces 0 regardless of `delta`.

- **`polarity: unipolar`** —
  `sCurved = applyCurve(s)`; `delta = minDelta + sCurved * (maxDelta − minDelta)`.
  Source `0.0 → delta = minDelta`; source `1.0 → delta = maxDelta`.
  No-move point depends on `range`: only true "no-move" when
  `minDelta = 0` AND source = 0.

- **`polarity: bipolar`** —
  Source is re-centered: `bipolarS = (s − 0.5) * 2`; magnitude is
  curved; sign is preserved; scale factor is
  `max(|min|, |max|)`. **Crucial detail
  (`modulation_engine.js:130-143`): the no-move point is `source =
  0.5`, NOT `source = 0`.** Audio sources (mic / stems) sit near 0
  most of the time and only rarely cross 0.5, so a bipolar modulation
  on an audio source spends almost all its time pushing `delta`
  *negative* (down from baseline) — almost certainly not what an
  operator authoring a "react to music" mapping wants.
  Bipolar is the right tool for an LFO (future), not for a mic band.

- **`curve` enum (`linear|easeIn|easeOut|exp`)** —
  `applyCurve` (`modulation_engine.js:98-103`):
  - `linear`: identity.
  - `easeIn`: `x²`. Slow response, then snaps up — *quiet sounds barely
    register; loud sounds dominate*.
  - `easeOut`: `1 − (1−x)²`. Fast response then flattens — *every
    little signal moves the slider quickly; loud signals don't add
    much more*. (Same shape as the default for mic bands in every
    playlist entry we see, including `summer_camp_dome/audio_dome.yaml`
    pre-deletion, and `test_bench/default.yaml:25,50,75,...`.)
  - `exp`: `x³`. Even more aggressive than `easeIn`.

- **`range: [a, b]` — output scaling, not source clamping.**
  The source is `clamp01`'d FIRST (`modulation_engine.js:126`), then
  the curve shapes it, then `[a, b]` is the *delta* range mapped onto
  the curved source. So `range: [0, 0.2]` means "between 0 and +0.2
  added to the base value", NOT "consider source only in [0, 0.2]".
  Both endpoints can be negative for a "this signal pulls the slider
  DOWN" effect, and both endpoints must satisfy `|v| ≤ 1`
  (`modulation_engine.js:294-297`).

## Gotchas

1. **`mode: scale` × `base = 0` = no effect.** A modulation on a slider
   the operator set to 0 will never move the slider, no matter how
   loud the source. If the operator wants "audio re-injects motion
   into a parked slider", they must use `mode: offset`.

2. **`polarity: bipolar` with mic/stems source spends most of its time
   negative.** Audio levels sit near 0; `s < 0.5` → `delta < 0`. Use
   `unipolar` for audio reactivity; reserve `bipolar` for future LFOs
   centered at 0.5. (`modulation_engine.js:130-143`.)

3. **`micKick` is a *gated, held, decaying* signal — NOT an instant
   peak follower.** The default chain (Envelope 8/180 ms → Schmitt
   0.5/0.3 → Hold 120/120 ms; `signal_post_processor.js:79-84`)
   produces a flat-top pulse: it stays at 1.0 for 120 ms after a kick,
   then decays exponentially over 120 ms. A modulation on
   `sliderLocalSpeed` driven by `micKick` will pulse the slider
   chunky on each detected kick, not produce a smooth follower. For
   smooth speed mod use `micLow` (envelope-followed, no Schmitt). The
   Schmitt `tHigh=0.5` also means **soft kicks below the envelope-
   relative threshold never fire at all** — if the mic gain is low,
   `micKick` reads zero forever.

4. **Operator gain > 1.0 saturates the chain.** `mic*Gain` and
   `stems*Gain` ranges are `[0, 2]` (`param_center.js:88-101, 222-241`).
   The Gain op multiplies, then the post-process clamps at 1.0
   (`signal_post_processor.js:764-765, 700`). With gains cranked, a
   modulation looks pinned to `range[1]` for long stretches. Surface
   to operators: the right knob to turn for "more reaction" is
   `range[1]`, not the band gain (above 1×).

5. **The modulation write bypasses `ChannelParamRouter`'s CPC-block
   gate** (`modulation_controller.js:114` calls `wasmHost.setControl`
   directly, not `channelParamRouter.setChannelControl`). For
   intentional patterns (a CPC-owned `slider<Foo>` export aliasing a
   shared key) the route never gets the
   `blocked_by_shared` veto. In practice this is masked because (a)
   engine-owned globals like `speed`/`size` are never injected
   (`param_center.js:651-660`), and (b) the playlist schema doesn't
   stop operators from authoring a mapping targeting a shared name —
   it would just resolve via the pattern's local export if one
   exists. **Not a current production bug, but a sharp edge if the
   modulation system ever extends to `scope: global`.**

6. **`range: [hi, lo]` (swapped) passes validation.** The validator
   only checks finite + `|v| ≤ 1`, not ordering
   (`modulation_engine.js:290-297`). A swapped pair just produces the
   reverse linear ramp inside `applyContinuousModulation`. No crash, no
   warning. Probably operator-friendly (intentional reverse mapping),
   but worth noting.

7. **Stems are 0 until OSC packets land.** `stemsBass/Drums/Vocals`
   default to 0 (`param_center.js:103-119`) and are only updated by
   `osc_listener` on `/marsin/stems/*`. A modulation referencing them
   evaluates as no-op silently until a stem source is wired. No
   diagnostic surfaces this beyond "the ghost dot on the iPad never
   moves".

8. **Baseline restore is one-shot, then the operator owns it.** When a
   mapping is removed/disabled, `modulation_controller.js:122-131`
   writes the stored `baseParams[name]` back once. From the next frame
   on, `ChannelParamRouter` writes (operator dragging the slider) are
   re-authoritative. Correct behavior — but note that the `baseParams`
   comes from `localControls[id].v0`, so if the operator never touched
   the slider, the "base" is the pattern's declared `v0` (or 0), not
   any defaults from the playlist entry's `defaults:` block. The
   playlist-defaults application is upstream of this controller and
   already populates `localControls` before the first modulation
   frame, so in practice the restore lands on the right value — but
   it's a subtle invariant worth noting if anyone refactors the
   playlist-defaults injection.

9. **No P0 violations found** in the modulation pipeline itself. The
   only "fallback" is `resolveModulationSources` defaulting absent
   source keys to 0, which is explicitly documented as operator-
   requested behavior, not a silent failure (`modulation_engine.js:76-79`).

## Confidence

| Field                | Confidence | Reason |
|----------------------|------------|--------|
| `type: 'continuous'` | HIGH       | Single enum, validated + filtered in two places (`modulation_engine.js:208, 255-257`). |
| `enabled`            | HIGH       | Boolean validated; filtered in `applyModulations` (`modulation_engine.js:208`); baseline restore on transition tested in `modulation_controller.test.js`. |
| `source.scope: cpc`  | HIGH       | Single enum, no other source class implemented. |
| `source.key`         | HIGH       | Enum-validated; resolver defaults absent keys to 0 by design. |
| `target.scope: pattern` | HIGH    | Single enum; no other target scope wired. |
| `target.parameter`   | MEDIUM     | Resolution is correct, but a typo in the slider name silently no-ops with no warning at any layer (validator can't know pattern exports). |
| `mode: offset`       | HIGH       | Pure addition; commutative; trivially correct. |
| `mode: scale`        | MEDIUM     | Correct math, but `base=0` collapses the modulation to 0 — easy operator footgun. |
| `polarity: unipolar` | HIGH       | Trivially correct linear remap with curve pre-shaping. |
| `polarity: bipolar`  | LOW        | Math is correct *for an LFO source*. Audio sources spend ~all their time below 0.5, so a bipolar mic-driven mapping is almost certainly authored by mistake. No engine fix needed; documentation / UI guard needed. |
| `range: [a, b]`      | HIGH       | Output-delta scaling, correctly applied; bounds clamped at write. |
| `curve` enum         | HIGH       | All four shapes implemented; bipolar applies curve to magnitude only (preserves no-move at 0.5). |
| Slider write reaches WASM | HIGH  | Direct `wasmHost.setControl` from `modulation_controller.js:114`; covered by `modulation_controller.test.js`. |
| Throttled WS broadcast | HIGH     | 20 Hz default + one-shot clear; covered by `modulation_controller.test.js:63-126`. |
| Per-signal chain post-processing | HIGH | Per-op math cited inline; clamp at each Gain stage and at the end; defaults match operator brief. |
| `micKick` ergonomics | MEDIUM     | Chain is correct and well-cited, but the trigger-shaper default makes `micKick` behave very differently from `micLow/Mid/High` — easy to assume "instant level" and get "pulsed-and-held" instead. |
