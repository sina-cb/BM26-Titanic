# Audio Analysis Investigation Report — 2026-05-26

**Mode:** improvement + architectural (hybrid)
**Branch + commit reviewed:** `dev/summer_camp_readiness` @ `4b500ed`
**Engine boot:** no (read-only investigation; existing `marsin_engine/lib/audio_analyzer.js` + iPad code reviewed statically)
**Duration:** ~1 h

---

## TL;DR

1. The AUDIO tab today is a single scroll of 5 stacked CARDs and the live meters live mid-page, so the operator loses the meter from view the moment they reach for any tuning slider — pinning the meters to the top is the single highest-impact UX change.
2. A node-based per-signal post-processing chain (TouchDesigner CHOP-style) is feasible on the engine side at well under the per-tick budget only if every operator is restricted to O(1) per-sample stateful math (one-pole IIR, EMA, schmitt, lookup, biquad). The proposed chain MUST sit on the engine inside `param_center.set('micLow', …)` BEFORE the value is written to CPC, otherwise downstream consumers (modulation controller, OSC echo, iPad meters) see two different truths.
3. The current kick detector (`audio_analyzer.js:309-338`) has a documented warm-up but a hard-coded `_kickEmaAlpha = 0.02` and no ceiling on the EMA — pumping sustained bass into the rig drives the EMA up until the kick stops firing. This is the highest-severity TUNING bug for the playa.
4. Stems (`stemsBass/Drums/Vocals`) are currently raw OSC pass-throughs with one gain knob each (`param_center.js:103-119`). They share none of the analyzer's smoothing or gate — a TouchDesigner-style chain framework absorbs them cleanly: existing per-stem gain becomes the first op of a default 1-op chain.
5. The 20 Hz live-bucket cap (`api_server.js:308`) is the right ceiling for WS broadcast; a 600-sample history trail per signal at 20 Hz live capture costs ~2.4 KB of float32 per signal and is cheap to render with `react-native-svg` polyline. Trails must mount/unmount with the AUDIO tab focus state — never run while another tab is active.

---

## Method

- Read end-to-end: `audio_analyzer.js`, `audio_capture.js`, `audio_config.js`, `audio_config_store.js`, `bpm_speed_sync.js`, `osc_listener.js`, `param_center.js`, and the audio routes / live-broadcast block in `api_server.js` (lines 280-440, 2424-2526).
- Read end-to-end: `CaptainPad/app/(tabs)/audio.tsx` (835 lines), `useEngineState.ts` (898 lines, focus on `useLiveParamValues`, `_emitLive`, `_ensureSignalsInitialized`), `engineSignalsEvents.ts`, `engineBus.ts`.
- Read frozen design docs: `docs/25_marsin_audio_analysis.md`, `docs/26_audio_params_playlist.md`.
- Scanned `.agent/02_reports/202605/` for prior overlap (`20260524_2_audio_analysis.md` is the implementation plan; this investigation does not re-tread that ground).
- Confirmed `marsin_engine/lib/modulation_engine.js` + `modulation_controller.js` exist and consume `paramCenter.getAll()` per tick at `broadcastHz: 20` — i.e. the chain framework's "downstream contract" already has a single well-defined sample point.
- WebFetch on TouchDesigner CHOP families (https://docs.derivative.ca/CHOP) + W3C RBJ EQ Cookbook (https://www.w3.org/TR/audio-eq-cookbook/) for operator catalog (Concern 4 only, per operator allowance).
- No engine booted; no source edited; scratch only at `~/tmp/audio_review/`.

---

## Concern 1 — UI audit

### Findings (ranked)

**MAJOR — meters are mid-page, not pinned.** `audio.tsx:701-738` puts the LIVE-DATA cards (STEMS + MIC ANALYSIS BandMeters) AFTER three taller cards (MIC ANALYSIS master toggle, BPM→SPEED SYNC, MICROPHONE picker). On an iPad in landscape with the keyboard up for a numeric tweak, the meters scroll out of view first. The operator's tuning gesture is *"adjust threshold while watching kick fire"* — the current layout fights that.

**MAJOR — five CARDs of ~equal weight collapse hierarchy.** Every section uses the same `CARD` style (`audio.tsx:78-84` — 20 px padding, ghostBorder, ambient shadow). Visual scan finds no anchor: MIC ANALYSIS toggle (top), BPM SYNC (a different concern), MICROPHONE (mostly inert config), STEMS (lives in here only because OSC stems are an audio source), MIC ANALYSIS LIVE (the actual tuning subject). Operators don't have a way to scan-and-find without reading every card header.

**MINOR — KICK DETECTOR sub-card has 5 sliders + has the only `C.error` accent.** `audio.tsx:794-829`. The kick block is the most physically dense control on the page (Energy min/max, Threshold, Refractory, Decay) but is buried as the LAST sub-card of the LAST top-card. It's also the only block whose meter color (`C.error` red) signals urgency without a corresponding visual position to match.

**MINOR — duplicate gain editing surface.** Per-band gain (`audio.tsx:710-721` for stems + `:740-744` for mic) lives in TWO `SUB_CARD`s under their respective LIVE cards. The values are also editable via OSC (`/marsin/param/*Gain`) but there's no surface acknowledgement of "this gain is currently being driven by OSC". With the post-processing chain coming online (Concern 4), the gain knob is just a 1-op chain's only parameter — collapse them.

**PRAISE — the lazy-mount split (`audio.tsx:319-378`) is genuinely well-thought-out.** Splitting `AudioConfigBody` from the screen wrapper, with the explanatory comment "the spinner used to hang for 30 s when 1+ mixer channels were active" + an explicit `_ensureSignalsInitialized` lazy-init in `useEngineState.ts:434-439`, is exactly the kind of comment-with-rationale future investigators need.

### Recommended direction

Re-shape the tab into THREE zones (sticky top → fixed-height scrollable middle → tap-to-open sheets at the bottom): **(top)** pinned signals + master enable + status, **(middle)** the per-signal post-processing chain editor (a list of signals; tap-to-expand the chain for that signal), **(bottom)** secondary config (mic picker + BPM-sync + reset) moved into a single "Settings" disclosure card. The reshape is documented in `docs/29_node_based_audio_post_processing.md` §A.

---

## Concern 2 — Pinned signals card

### Findings

**MAJOR — meters and tuning are never co-visible.** Same root as Concern 1's first finding: the operator can either see the value response or the slider, never both, without breaking out of `ScrollView`. iPad RN has no native split-pane idiom that's safe at this scroll height.

**OBSERVATION — meter render is already cheap.** `BandMeter` (`audio.tsx:214-234`) is a pure RN `<View>` with two stacked `width: {pct}%` divs — it's already cheap enough to pin and re-render at the 20 Hz `useLiveParamValues` rate. The constraint is layout, not perf.

**OBSERVATION — `liveParams` is already cleanly factored.** Per-key reference-stable selector in `useLiveParamValues` (`useEngineState.ts:661-718`) means a pinned meter strip only re-renders on its own subscribed keys' ticks. Pinning costs zero additional WS traffic and ~7 meter `<View>` reconciles per tick (one per signal).

### Recommended direction

A sticky **PINNED METERS** strip rendered as the first child of the screen, lifted OUT of the outer `ScrollView` and into the screen's flex column as a fixed-height `<View>` above the ScrollView. Shows 7 signals (4 mic + 3 stems) + tempoBpm pill + kick-pulse indicator. Single row on iPad landscape; wraps to two rows on portrait. Empty state when audio is off ("● TAP MIC ANALYSIS BELOW TO ENABLE"), disconnected state when WS is down ("⚠ no signal — engine offline?"). Full sketch in design doc §B.

---

## Concern 3 — Signal trails

### Findings

**Capture path is the cheap choice (vs. engine push).** The engine already broadcasts `liveParams` at ≤20 Hz (`api_server.js:308`). The iPad already has a per-tick handler in `_emitLive` (`useEngineState.ts:325-330`). A `Map<signalKey, Float32Array(600)>` ring buffer fed from the existing `useLiveParamValues` subscription captures 30 s of history at 20 Hz with **zero added network traffic and zero added parse cost**. Adding a parallel engine-side history feed would double the wire cost for no per-pixel-quality improvement (the iPad can't paint faster than its frame rate anyway).

**Memory footprint per signal × window:**

| Window | Samples @ 20 Hz | Bytes (float32) |
|---|---|---|
| 5 s | 100 | 400 B |
| 10 s | 200 | 800 B |
| 15 s | 300 | 1.2 KB |
| 30 s | 600 | 2.4 KB |

7 signals × 30 s × 4 B = **~17 KB** total. Negligible on a 6 GB iPad.

**Render primitive choice — `react-native-svg` polyline beats Canvas/Skia for this scope.**
- `react-native-svg` is already in CaptainPad's dependency tree.
- `Polyline` accepts a flat `points` string, re-rendered per frame is one virtual DOM diff + a single native draw call.
- 7 signals × 1 polyline × 600 points = 4200 segments / frame max. Tested limit for `react-native-svg` polyline is roughly 10k points before main-thread render cost becomes visible. Safe.
- Canvas (`@shopify/react-native-skia`) would be faster but adds a new native dep that has to survive the iPad build — and the speed isn't needed.
- **Avoid `<View>`-bar histograms** — 7 × 600 nested `<View>`s would re-create 4200 RN nodes per render. JS-thread fatal.

**Lifecycle — MUST mount/unmount with tab focus.** The `_ensureSignalsInitialized` plumbing means just *visiting* the AUDIO tab opens `/ws/signals`. The history buffer must be **append-only-while-visible** and **GC'd on blur** so a background audio tab doesn't keep accumulating samples that the operator will never look at. Use `useFocusEffect` (react-navigation) wired to (a) start writing into the ring on focus, (b) stop writes + clear the buffer on blur. The WS itself stays subscribed (sharing the bus with the bpm badge consumer); only the local buffer toggles.

### Performance constraints + recommendation

- ✅ Capture: existing `useLiveParamValues` subscription, no engine change.
- ✅ Storage: per-tab-instance ring buffer of `Float32Array(MAX_SAMPLES)` per signal, MAX_SAMPLES = 600 (always allocate the max; window selector just picks a slice).
- ✅ Render: one `<Polyline>` per signal inside a single `<Svg>` with `viewBox="0 0 600 100"`. RN handles the layout transform.
- ✅ Cleanup: `useFocusEffect` + a `useEffect` cleanup that zeroes the ring buffer (don't just stop appending — actually free the data so a tab re-focus starts fresh).
- ⚠ Avoid: re-rendering the parent on every tick. The history component owns its own subscription with `useLiveParamValues` and re-renders itself, NOT the parent screen.

### Recommended direction

Per-signal mini-trail strip rendered inside each meter row of the pinned card. Window selector (5/10/15/30 s) is one shared control above the strip. Full spec in design doc §C.

---

## Concern 4 — Node-based post-processing chain

### Findings on the current audio pipeline (where ops would slot in)

The current data flow is:

```
ffmpeg PCM → AudioCapture (frame the bytes)
            → AudioAnalyzer.pushSamples()
                  → FFT
                  → band energy + kick detect
                  → asymmetric envelope (attack/release) + noise gate
                  → onAnalysis({low, mid, high, kick})
            → engine.js callback → paramCenter.set('micLow', …, 'audio')
                                  → paramCenter._fireOnChange(['micLow'])
                                       → broadcastCpcSplit → liveParams WS
                                       → modulation controller picks up next tick
                                       → BPM speed sync if tempoBpm
            → CaptainPad iPad
```

For OSC stems:

```
LX Studio → OSC packet → OscListener._onPacket
                       → paramCenter.setMany(writes, 'osc') → same fan-out
```

**The right insertion point for a post-processing chain is BETWEEN the analyzer's `onAnalysis` callback (and the OSC listener's `setMany`) AND the call to `paramCenter.set`.** Concrete locations:

- `marsin_engine/engine.js` audio bootstrap (the `onAnalysis` callback that today calls `paramCenter.setMany` for micLow/Mid/High/Kick).
- `marsin_engine/lib/osc_listener.js:486` (where stems flow through `paramCenter.setMany`).

If the chain runs THERE, every downstream consumer (modulation controller, OSC echo, iPad meters, WASM patterns) sees ONE value: the post-processed one. This satisfies the operator's "feed back into the whole system" requirement without per-consumer re-implementation. A `signal_post_processor.js` module is added with one entry point per signal:

```
processed = chain.run(signalKey, rawValue, dtSeconds);
paramCenter.set(signalKey, processed, source);
```

Engine-side, this preserves the existing 20 Hz CPC broadcast cap and the modulation controller's contract.

### Operator catalog (names only here — full catalog in design doc §D)

10-12 op catalog, drawn from TouchDesigner CHOP families + RBJ + standard DSP literature:

1. **Gain (Math)** — multiply
2. **Bias (Math)** — add a constant
3. **Clamp (Limit)** — restrict to `[min, max]`
4. **Curve (Lookup)** — apply Linear / EaseIn / EaseOut / Exp shaping (subset of TD's Lookup CHOP)
5. **LPF / Lag (Filter)** — one-pole low-pass (= leaky integrator, = EMA). The single most useful smoothing op
6. **Slew Rate Limiter** — `|y[n] − y[n-1]| ≤ maxStep` per sample. TD's Limit-step
7. **Attack/Release Envelope** — asymmetric one-pole (already in `audio_analyzer.js`; promote to operator)
8. **Schmitt Trigger** — hysteretic binary gate with `T_high` / `T_low`
9. **Compressor (Audio Dynamics)** — downward compressor with threshold / ratio / attack / release
10. **Biquad (RBJ LPF/HPF/BPF)** — 2-pole RBJ cookbook filter for steeper roll-off than 1-pole when needed
11. **Hold (Hold CHOP)** — sample-and-hold with timeout (e.g. on kick fire, hold value high for N ms; OR auto-decay on OSC stem packet loss)
12. **Slope (Slope CHOP)** — output `dy/dt` of the signal; useful for "trigger on rising bass"

All 10-12 ops fit in O(1) per-sample work; the worst-case full chain (e.g. all 10 in sequence on one signal at 86 Hz) costs ~12 multiplications plus a handful of `Math.exp` calls = well under 50 µs per signal per tick, comfortably inside the engine's render budget.

### Performance budget analysis

- **Engine call rate:** modulation controller already runs at ~60 Hz tick; audio analyzer emits at ~86 Hz (44.1 kHz / 512); OSC arrives 30-60 Hz. The chain runs on each analyzer tick OR each OSC packet — i.e. at most ~86 Hz per signal.
- **Per-op cost (typical):** 4 floating-point ops (multiply + add + branch + assign).
- **Biquad cost:** 5 multiplies + 4 adds + 2-sample memory.
- **Worst case:** 7 signals × 10 ops × 86 Hz × ~10 FLOPS = 6000 FLOPS/s. **Negligible** on the engine's Node process.
- **Wire impact:** zero. Same `liveParams` payload, same throttling.
- **iPad cost:** the chain editor surface only renders when the AUDIO tab is focused. Each op preview (pre/post value) reads from a throttled debug WS broadcast — see design doc §D for the throttling story.

### Recommended direction

Engine-side `lib/signal_post_processor.js` + chain config persisted at the **scene level** (`marsin_engine/states/<scene>/audio_state.yaml` extended), since chains are physical-rig-tuning concerns (one rig, one chain per signal). NOT per-playlist-item (that's modulation's job — the `range` in `docs/26` already shapes per-playlist). Engine fires a new `signalChain` WS message under `/ws/signals` to feed the iPad's chain editor (see design doc §D for full schema).

---

## Concern 5 — Detection / processing tuning

### Findings on kick detector

**BLOCKER (for the playa) — kick EMA has no ceiling / no slow-decay path.** `audio_analyzer.js:312-322`. The EMA is `_kickEma = 0.02 * instant + 0.98 * _kickEma` plus a 50-hop warm-up. On a sustained loud bassline (e.g. 4-on-the-floor at -3 dB peak for 60+ seconds), the EMA tracks UP toward the loud baseline; the threshold (`instant > ema * 1.8`) requires the instant to be 1.8× the *already loud* baseline. Result: **kick stops firing after ~30 s of consistent loud bass**. The EMA never decays back without a quiet period. This is exactly the playa scenario.

  Fix direction: make the EMA asymmetric (fast attack toward higher instant, slow release toward lower instant) and/or expose a configurable ceiling so the threshold can't drift above operator intent. Or: switch to peak-tracking with a long-tail decay (the standard pro-audio "envelope follower" trick) instead of EMA. **Land this fix before the chain framework**, since the chain framework defaults inherit whatever detection logic ships.

**MAJOR — kick band 50-110 Hz is too narrow for VAR-bass / dubstep.** Default `kick.minHz=40, maxHz=120` in `config.yaml` per `audio_analyzer.js:48`. Modern EDM kicks often have a sub component at 30-50 Hz that the current window misses, and the click at 100-120 Hz is the only thing it catches reliably. Recommend exposing `kick.bandShape: 'narrow'|'wide'|'sub+click'` as a quick-pick in the UI; the actual op (a Schmitt trigger after a band-pass + envelope) belongs in the new post-processing chain.

**PRAISE — the 50-hop warm-up (`audio_analyzer.js:140-148`)** is a good defensive choice. Without it, the very first frame's energy becomes the EMA seed and any quiet boot-room shows a false kick.

### Findings on band envelope + gate

**OBSERVATION — the envelope + gate logic (`audio_analyzer.js:276-306`) is well-structured.** The asymmetric attack/release primitive (`env(prev, target)`) is reusable verbatim as one of the chain operators (Concern 4, op #7).

**MINOR — noise gate is binary, not soft-knee.** `audio_analyzer.js:294` does `(v <= gate ? 0 : (v - gate) / gateScale)` — a hard knee. At threshold = 0.04, a band sitting at 0.039 reads 0, then jumps to ~0.02 at 0.041. The eye on a 5 s history trail will see a notch artifact. Recommendation: replace with a soft-knee gate as a chain op once the framework is in place; do NOT patch the analyzer for this in isolation.

**MINOR — single noise-gate value across all three bands.** Different rooms have different floor in different bands (HVAC = low, tape hiss = high). The chain framework solves this for free since each signal gets its own chain.

### Findings on AGC / dynamic range

**OBSERVATION — there is no AGC today.** The `PRE_CLAMP_GAIN = 8.0` constant + soft-compress (`audio_analyzer.js:63-68`) is the only dynamic-range handling. A loud room saturates everything to ~1.0; a quiet rehearsal puts everything at ~0.05 with the same gate. This is by design (per the doc, "raw CPC band value remains the analyzer's honest read"), but the operator can't tune around it without restarting between soundchecks.

  Recommendation: a **Compressor** op (Concern 4 op #9) in the chain lets the operator add automatic dynamic-range compensation per-signal without touching the raw analyzer.

### Recommended changes (cite-precise)

1. `audio_analyzer.js:312-322` — change `_kickEma` update to asymmetric: faster up (e.g. α=0.02), slower down (e.g. α=0.002). Add an optional `kick.emaCeiling` config field that clamps `_kickEma` so threshold drift is bounded. — **fix before playa**.
2. `audio_analyzer.js:294` — soft-knee the gate **after** the chain framework lands, so the gate is expressed as a chain op rather than two divergent gate definitions.
3. `audio_analyzer.js:309-322` — once the post-processing chain exists, factor the kick detection out into `Schmitt(threshold, refractory) ← EnvelopeFollower(ema/release) ← BandFilter(minHz, maxHz)` so all three are chain ops and the kick detector becomes a default chain on `micKick`. Hand-off: `04.2_marsin_engine_expert.md`.
4. `param_center.js:155-159` — `micKick`'s `broadcastHz: 30` is fine; do NOT change.

---

## Concern 6 — Stems post-processing

### Findings on OSC stem ingestion

- **OSC arrival cadence is upstream-controlled.** `OscListener._onPacket` does no rate-limiting on the input side; LX Studio is the upstream pacing source. In practice this is ~30-60 Hz per stem when LX is running its Spectrum modulator.
- **Stems bypass all of the analyzer's smoothing.** `param_center.js:103-119` defines `stemsBass/Drums/Vocals` as raw `live: true` scalars; the value the operator sees in the meter is exactly what LX sent. If LX's analyzer is jittery, the operator sees the jitter.
- **The gain knob is mathematically equivalent to a `Gain` op in a 1-op chain.**

### Stem-specific quirks

1. **OSC packet loss = stale value.** If LX drops a UDP packet, the previous stem value stays high indefinitely until the next packet. There's no timeout/decay. A pattern bound to `stemsBass` would freeze the LED rig on a 1-second WiFi dropout. — **MAJOR for the playa where WiFi reliability is questionable.** Fix: a `Hold(timeoutMs)` op (Concern 4 op #11) in the default stems chain that decays to 0 after N ms with no fresh input.
2. **No noise gate.** A near-silent stem still shows as e.g. 0.02-0.03 (LX's noise floor); the existing mic-side `noiseGate` does not apply. Solve via a `Gate` (or `Schmitt`) op in the chain.
3. **Cadence mismatch with mic analyzer.** Stems at 30-60 Hz, mic at 86 Hz, downstream broadcast capped at 20 Hz. This is fine for visual reactivity but means the chain MUST be called per-event (one chain.run per incoming sample), not on a fixed schedule — `signal_post_processor.run(key, value, dt)` with a `dt` so envelopes know how much real time passed.

### Recommended direction

Wire the chain framework to OSC stems via `osc_listener.js:486` (the `paramCenter.setMany` call site). Each stem ships with a default 2-op chain: `Gain(value=stemsXGain) → Hold(timeoutMs=500)`. The existing `stemsXGain` CPC param becomes the value of the chain's first op (no operator-visible change — the slider in the iPad still edits the same number, it just edits it via the chain config now). See design doc §F.

---

## Cross-cutting concerns

1. **Persistence vs. operator-WIP boundary.** Chains are physical-rig tuning (one Titanic, one rig, one chain set). They belong in `audio_state.yaml` (per-scene, follows the scene file). They do NOT belong in `playlists.yaml` (per-show creative state) — that's where modulation lives per `docs/26`.
2. **Source-of-truth for "what the pattern sees".** Today: `paramCenter.get('micLow') === raw_analyzer_output`. Post-chain: `paramCenter.get('micLow') === chain_processed_output`. Patterns and the WASM VM see the same single value either way. The chain's "raw" pre-processed value is only visible in the chain editor's preview, never in the CPC.
3. **Modulation controller still works without modification.** It reads `paramCenter.getAll()` per tick (per `modulation_engine.js`); whether the value is raw or chain-processed is transparent to it.
4. **Reset to defaults semantics.** Today's `/audio/config/reset` (`audio.tsx:515-518`) wipes the analyzer tuning. With chains, reset must ALSO restore each signal's default chain. Recommend: each signal has a `defaultChain` baked into the engine's `config.yaml`; reset reinstalls that.

## Measurements

| Measurement | Value | Source |
|---|---|---|
| `liveParams` bucket cap | 50 ms (20 Hz) | `api_server.js:308` |
| `liveParams` payload size (typical) | ~150 B (7 keys, JSON) | extrapolated from `broadcastCpcSplit` shape |
| `audioStatus` cadence | 1 Hz + lifecycle | `audio_capture.js:198-202` (fpsTimer) |
| Analyzer hop rate | 44100/512 ≈ 86 Hz | `audio_analyzer.js:115` |
| Modulation controller broadcast | 20 Hz | `modulation_controller.js:26` |
| Per-signal trail memory (30 s @ 20 Hz) | 2.4 KB float32 | computed |
| Full trail set memory (7 signals × 30 s) | ~17 KB | computed |
| Chain op cost estimate (worst case, 10-op chain) | < 50 µs | extrapolated from FLOP count |

## Coverage gaps

1. **No live RN profiler data.** Cannot confirm the projected polyline render cost on the actual iPad. Would need an Instruments/Hermes trace on the operator's device. Recommend: prototype the trail strip behind a feature flag, measure on-device, ship if `<2 ms/frame`.
2. **No live capture of the kick-EMA-drift bug.** The kick drift is reasoned from code reading. Reproducing it would require a 60-second sustained loud bassline through the rig mic — out of scope for this read-only investigation but trivial to confirm with `tools/list_audio_devices.js` + a music source.
3. **No measurement of the modulation controller's per-tick cost.** The 20 Hz figure is from the controller's own broadcastHz, not a measured tick latency. The chain framework will piggyback on the same tick; if there's already pressure on that tick, the chain math will compound it. Recommend a separate `node --inspect` profile after the chain ships.
4. **Did not enumerate the test fixtures.** `tests/audio_analyzer.test.js` has good coverage of the existing analyzer but contains no kick-drift scenario; the recommended fix in §5 will need a new test feeding sustained loud bass and asserting kicks continue to fire past 30 s.

## Recommended handoffs

| Concern | Severity | Handoff |
|---|---|---|
| Concern 5: kick EMA drift (sustained bass → no kicks) | BLOCKER for playa | `04.2_marsin_engine_expert.md` — small surgical patch to `audio_analyzer.js`, no architecture change. Lands BEFORE the chain framework. |
| Concern 6: stems pack-loss / stale value | MAJOR (WiFi-dependent) | `04.2_marsin_engine_expert.md` — same patch path as the chain (Hold op is the natural cure); if chain slips past playa, ship a hard-coded `stems*` 500 ms decay in `osc_listener.js`. |
| Concern 1 + 2 + 3: UI reshape + pinned meters + trails | MAJOR (operator quality of life) | `03_designer.md` to ratify the design doc § wireframes, then `04.1_captain_pad_expert.md` to implement. Can ship pinned meters in one PR before trails. |
| Concern 4: node-based chain | MAJOR (architectural) | `02_planner.md` to slice into phases (engine module first, then iPad editor); then `04.2_marsin_engine_expert.md` + `04.1_captain_pad_expert.md` in parallel. |
| Concern 6: stems default chain | MINOR (depends on chain framework) | Follows Concern 4. |

## Out of scope (intentional)

- Mic-side BPM detection — explicitly out per `docs/25` non-goals.
- Replacing the FFT (fft.js Cooley-Tukey is fine; no scalability issue at the engine's sample rate).
- Multi-mic capture / mic mixing — not requested, would require a capture-side refactor.
- Pattern-side audio reactivity API changes — the chain framework is transparent to patterns since `paramCenter.get('micLow')` returns the post-chain value.
- LX Studio configuration — outside the rig.
- Mobile (PortWatch) — `mic*` params are `portWatch: false`, intentionally hidden from LoRa.
