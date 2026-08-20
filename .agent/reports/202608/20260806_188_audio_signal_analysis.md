# _188 — Audio signal deep analysis: census, stabilization, dataset tuning, THE PLAN

**Date:** 2026-08-06 · **Agent:** _188 (Fable, analysis, READ-ONLY)
**Branch:** `feat/bm_readiness` · **No source edits, no git ops, no live processes.**
**Inputs trusted:** `_183` (recon) + `_184` (FLUX fix) reports, re-verified against
current working-tree file contents. FLUX is confirmed working live by the operator.

Mission: audit EVERY audio signal for modulator-readiness, propose concrete
stabilization, evaluate offline datasets for tuning, and deliver a staged plan.

---

## 0 · Executive summary

The signal FAMILY is architecturally excellent — a single authoritative registry
(`marsin_engine/audio/postproc/audio_signals.js`), one analyzer (the Companion,
sole-analyzer contract 2026-06-21), corpus-tuned detectors with honest
confidence gating, and offline eval harnesses most shows never build. But the
operator's complaint is correct on three concrete axes:

1. **Four more signals are DEAD by the exact micFlux bug class** — present in
   the CaptainPad picker, emitted over OSC, permanently zero:
   `micOnsetLow`, `micOnsetMid`, `micOnsetHigh`, `audioChestHit`. Root cause
   found (§2.1); it is the same "producer never publishes the input" shape
   `_183` found for FLUX, one directory over. Three more RAW chroma inputs are
   silently zero, degrading the genre classifier (§2.2). `audioVocalsHot` is
   permanently dead (stems retired) and should be retired (§2.3).
2. **One-hop EVENT signals are unreliable on the wire**: the Companion's OSC
   rate gate (~60 Hz sends vs ~86 Hz analyzer hops) silently DROPS ~30 % of
   `audioDownbeat` / `audioPhraseBoundary` / `audioTrackChange` /
   `audioSwitchPattern` / `audioSwitchColor` pulses, and the survivors are
   16–33 ms wide — 0–1 render frames of effect (§2.4).
3. **The picker is an uncurated 44-signal wall** with registry-tail labels
   ("VOCALS HOT", "BUILD ETA", "DOM FREQ 1", "BPM CONF"), categorical indices
   presented as continuous sources, and at least two scaling problems that
   make a signal near-useless as a modulator (§1.3, §3). Saved playlists tell
   the story: of ~90 saved modulations, ALL but four bind the 5 mic bands —
   the rich derived family is effectively unused because it is not
   operator-legible.

Verdict counts over the 44 picker-visible signals:
**26 READY · 8 NEEDS-CONDITIONING · 6 MISLABELED/curate-as-readout ·
4 DEAD-OR-BROKEN · 2 RETIRE** (details §1.2).

---

## 1 · PART 1 — Signal census & modulator-readiness audit

### 1.1 Pipeline recap (where each number is made)

```
mic → AudioAnalyzer (companion process, hop ≈ 86 Hz, FFT 2048)
        bands/kick/flux/dom/onset/sub/chroma           audio/analyzer/audio_analyzer.js
   → designed-signal chains (LPF + osc_out)            processDesignedSignals, companion_server.js:1325
   → publishRawMirrors → Companion's OWN ParamCenter   companion_server.js:1312-1324   ← §2.1 bug site
   → AudioStructureDetector.tick (enabled:true)        companion_server.js:1137-1141
   → DerivedSignals.tick (13 sub-modules)              audio/signals/derived_signals.js
   → emitAllDerived over OSC (rate-gated ~60 Hz)       companion_server.js:406-411, sendOsc:290   ← §2.4 bug site
→ engine OscListener → engine CPC (post chains for mic bands only)
→ modulation engine (builtin ranges normalized to [0,1]) lib/modulation_engine.js:188-216
→ CaptainPad picker = every live audio-family key       CaptainPad/hooks/useEngineState.ts:1390-1436
```

Labels in the picker are the registry label's tail after "·", upper-cased
(`_shortAudioLabel`, `useEngineState.ts:1351`). So every operator-facing name
traces to ONE line in `audio_signals.js` — labels are a one-line-per-signal fix.

### 1.2 The census

Columns: what it computes (file), value shape / rate, picker label, verdict.
"Norm" = how `resolveModulationSources` presents it to a modulation (builtin
ranges wider than [0,1] are linearly normalized — `modulation_engine.js:205-214`).

#### Mic bands (chain-processed; the 5 signals patterns/playlists actually use)

| Key | Computed | Shape | Label | Verdict |
|---|---|---|---|---|
| `micLow/Mid/High` | band magnitude sum → softCompress → per-band gate → 8/180 ms attack/release env (`audio_analyzer.js:721-732`), + companion LPF 5.5/8/14 Hz + engine gain chain | [0,1] cont. 15 Hz | LOW / MID / HIGH | **READY** — the workhorses, well conditioned |
| `micKick` | adaptive-EMA prominence detector w/ asym. attack + ceiling clamp + refractory 220 ms → snap-1 decay 70 ms (`audio_analyzer.js:753-798`); engine kickTrigger chain | [0,1] pulse 30 Hz | KICK | **READY** — model event signal: fires, holds, decays |
| `micFlux` | SuperFlux-lite half-wave-rectified spectral flux, bands' scale (`audio_analyzer.js:587-645`); Companion signal added by `_184`, LPF 22 Hz | [0,1] cont. 15 Hz | FLUX | **READY** (live-confirmed). Label is jargon — keep key, add registry note "transient density / busy-ness"; 22 Hz LPF still wants an ear (open `_184` item) |

#### Dominant frequency (4)

| Key | Computed | Shape | Label | Verdict |
|---|---|---|---|---|
| `micDomFreq1/2` | Kalman-tracked strongest partials (`dominant_freq_tracker.js`, mean err 0.66 Hz) | Hz [0,22050] 15 Hz | DOM FREQ 1/2 | **NEEDS-CONDITIONING** as modulator: linear /22050 norm puts a 60–250 Hz bass root at 0.003–0.011 — the mapping never leaves the bottom 1 %. One playlist binds it today and cannot be getting musical results. Fix: log2 normalization over the tracker's real 30–8000 Hz span (§3.4), or steer operators to NOTE HUE |
| `micDomEnergy1/2` | cluster energy, bands' scale | [0,1] 15 Hz | DOM ENERGY 1/2 | **READY** (3 playlist bindings exist) |

#### Structure detector (6 — companion runs it `enabled:true`, `companion_server.js:1140`)

| Key | Computed | Shape | Label | Verdict |
|---|---|---|---|---|
| `audioStructure` | THIN/BUILD/SUSTAIN state machine | {0,1,2} 10 Hz | STRUCTURE | **MISLABELED** as a modulator (a class index; norm /2 gives a 3-step staircase). Keep as readout; curate out of the picker's default tier |
| `audioBuildScore` | 2 s EMA of flux×4 (`audio_structure_detector.js:511-515`) | [0,1] 10 Hz | BUILD SCORE | **READY** — good slow "energy is building" meter |
| `audioEnergyRatio` | log1p(short 0.2 s / long 10 s env) | [0,1] 10 Hz | ENERGY RATIO | **READY** — "louder than the recent baseline"; label could say so |
| `audioVocalsHot` | `stemsFresh && stemsVocals>0.4` (`:609`) — stems family REMOVED 2026-06-17, `stemsFresh` can never be true | const 0 | VOCALS HOT | **DEAD → RETIRE** (§2.3) |
| `audioDropPulse` | windowed rate-of-change edge + build-memory + novelty gates, 600 ms decay; tuned to 0.117 phantom/min on real corpus (precision over recall, per operator directive) | [0,1] pulse 15 Hz | DROP PULSE | **READY** as event — but document that it is DELIBERATELY rare; a missed drop is by design |
| `audioSlowZone` | smooth-knee on activity=max(micLow, flux−floor), 1.5 s EMA | [0,1] cont. 10 Hz | SLOW ZONE | **READY** — the best "calm/breakdown" modulator. Positive logic (1 = calm) needs saying in the label/note |

#### BPM / beat family (BpmTracker v2, `bpm_tracker.js`)

| Key | Computed | Shape | Label | Verdict |
|---|---|---|---|---|
| `audioBpm` | 2-state lock (histogram → stiff Kalman) + octave disambiguation, + Companion 250 ms LPF | [0,300] 5 Hz | (excluded from picker — headline tile) | **READY** as display |
| `audioBeat` | phase-accumulator PLL pulse, width 0.18 beat | [0,1] pulse 30 Hz | BEAT | **READY** event — pulse spans multiple hops so it survives the OSC gate |
| `audioBeatInBar` | beat counter | {1..4} → norm 0.25–1.0, never 0 | BEAT IN BAR | **MISLABELED** as modulator (staircase that never visits 0); readout only |
| `audioBarPhase` | 0→1 ramp per bar, 0 at downbeat | [0,1] ramp 30 Hz | BAR PHASE | **READY** — lovely tempo-locked sawtooth |
| `audioDownbeat` | true ONE hop per bar (`downbeat` flag) | 1-hop pulse 30 Hz | DOWNBEAT | **NEEDS-CONDITIONING** — ~30 % of pulses never reach the wire (§2.4); survivors sub-frame. Envelope it |
| `audioBpmLocked` | lock state | 0/1 5 Hz | BPM LOCKED | **READY** binary |
| `audioBpmConf` | tracker confidence | [0,1] 5 Hz | BPM CONF | **READY** (advanced tier); label → "BPM CONFIDENCE" |
| `tempoBpm` | inbound `/lx/tempo/bpm` (LX Studio legacy) — nothing sends it on this rig | const 0 | (excluded) | **RETIRE-CANDIDATE** (keep only if LX compat is ever wanted) |

#### Party / loudness family

| Key | Computed | Shape | Label | Verdict |
|---|---|---|---|---|
| `audioParty` | loudness Schmitt + hold (`party_mode.js`) — KNOWN false-positive on room noise (the reason PartyModeStrong exists) | 0/1 5 Hz | PARTY | **READY-with-caveat**: keep (gates genre/phrase), but label should distinguish it from the strong gate, e.g. "PARTY (LOOSE)" |
| `audioPartyStrong` | 4-term gate: calibrated level ∧ kick-train evidence ∧ spectral shape ∧ not-silent; 20 s on / 30 s off debounce (`party_mode_strong.js`) | 0/1 5 Hz | PARTY (STRONG) | **READY** — the show-director key. `ambientFloor: 0.09` still marked "CALIBRATE ON PLAYA" (capture flow exists in the Companion PARTY tab) |
| `audioLoudness` | 1.5 s EMA of weighted bands | [0,1] 10 Hz | LOUDNESS | **READY** — the best slow master-energy modulator in the family |
| `audioKickRate` | 1000/mean(interval ring) (`party_mode_strong.js:_updateKick`) | [0,8] kicks/s 5 Hz | KICK RATE | **NEEDS-CONDITIONING** — range [0,8] normalizes real dance music (1.2–3.2 k/s) to 0.15–0.40: the modulator never exceeds ~40 %. Halve the range or add a musical normalization (§3.4) |
| `audioKickReg` | 1 − CV of kick-interval ring; idle-collapse to 0 | [0,1] 5 Hz | KICK REGULARITY | **READY** (noisy under 3 kicks by design; collapses honestly on idle) |

#### Note / colour / genre

| Key | Computed | Shape | Label | Verdict |
|---|---|---|---|---|
| `audioNote` | mode-filtered, Kalman-smoothed, hysteresis pitch class; held on silence | {0..11} 10 Hz | NOTE | **MISLABELED** as modulator (chromatic staircase /11); readout only |
| `audioNoteHue` | pitchClass/12 | [0,1] 10 Hz | NOTE HUE | **READY** — designed for hue binding |
| `audioGenre` / `audioGenreConf` | profile-scored classifier + dwell (`genre_classifier.js`) | {0..6} / [0,1] 5 Hz | GENRE / GENRE CONF | **MISLABELED** as modulators (class index); ALSO **DEGRADED** — its three chroma inputs read 0 (§2.2) |

#### New derived (riser / track / climax / phrase / countdown)

| Key | Computed | Shape | Label | Verdict |
|---|---|---|---|---|
| `audioRiserScore` | dual-EMA slope product of flux∧high∧loudness, smoothed (`build_anticipation.js`) | [0,1] 15 Hz | RISER SCORE | **READY** — already used in a saved playlist; the "charge-up" modulator |
| `audioBuildEta` | bars-to-boundary seconds, honesty-gated (conf ≥ 0.55, else 0) | [0,60] s 10 Hz | BUILD ETA | **MISLABELED** for modulation: 0 means BOTH "no estimate" and "imminent"; direction inverted (big = far). Keep for automation; curate out of the picker (or publish a derived `dropProximity` later) |
| `audioRiserConf` | slope agreement × lock × detector corroboration | [0,1] 10 Hz | RISER CONF | **READY** (advanced tier) |
| `audioSilence` | Schmitt loudness latch, 450 ms confirm (`track_change.js`) | 0/1 5 Hz | SILENCE | **READY** binary — note in metadata: usually wants INVERTED polarity when bound to brightness |
| `audioTrackChange` | gap-reonset ∨ tempo-relock cue | 1-hop pulse 15 Hz | TRACK CHANGE | **NEEDS-CONDITIONING** — one-hop edge, wire-loss class (§2.4) |
| `audioClimax` | long-history top-decile ceiling + rise-into-plateau + full-spectrum slam, 0.5 s attack / 0.8 s release (`climax.js`) | [0,1] cont. 10 Hz | CLIMAX | **READY** — well designed, corpus-validated; best "sit on the biggest look" modulator |
| `audioPhrasePhase` | (bars + barPhase)/8, drop-re-anchored, honest-gated on lock ∧ party (`phrase_tracker.js`) | [0,1] ramp 15 Hz | PHRASE PHASE | **READY** — 8-bar sawtooth when locked, honest 0 otherwise |
| `audioPhraseBoundary` | 1-hop edge on phrase wrap / drop re-anchor | pulse 15 Hz | PHRASE BOUNDARY | **NEEDS-CONDITIONING** — wire-loss class (§2.4) |
| `audioDropCountdown` | beat-synced pulse train, armed only by a monotonic-climb bounded riser peak + lock (`drop_countdown.js`) | pulse train 30 Hz | DROP COUNTDOWN | **READY-as-event** — deliberately very rare; per-pulse decay 80 ms survives the gate. Document rarity |
| `audioSwitchPattern` / `audioSwitchColor` | structural-moment cues w/ dwell + beat quantize (`switch_signals.js`) | 1-hop pulses 15 Hz | SWITCH PATTERN / COLOR | **NEEDS-CONDITIONING** (wire-loss class) AND arguably automation cues, not modulators — curate to advanced tier |

#### Onsets / chest hit — the new micFlux class (§2.1)

| Key | Should be | Actually | Label | Verdict |
|---|---|---|---|---|
| `micOnsetLow/Mid/High` | per-band SuperFlux → adaptive-threshold pulse shaper (`band_onsets.js`) | **flat 0, emitted at 0 over OSC** | ONSET LOW/MID/HIGH | **DEAD-OR-BROKEN** |
| `audioChestHit` | 30–60 Hz sub transient → schmitt+hold pulse (`sub_bass.js`) | **flat 0** (doubly broken) | CHEST HIT | **DEAD-OR-BROKEN** |

### 1.3 Cross-cutting observations

- **Present-at-zero is the failure mode that hurts.** `applyModulations` skips a
  mapping only when the key is ABSENT; every dead-but-registered key applies at
  0 each frame — in `override` mode that pins the target at `range[0]`
  (pinned as behaviour by `_184`'s test #12). All four dead onset keys are in
  this state right now for anyone who binds them.
- **Saved usage concentrates on 5 keys.** Playlist census: micLow 33, micKick
  25, micHigh 16, micFlux 8, micMid 3, micDomEnergy1 3, micDomFreq1 1,
  audioRiserScore 1. The derived family (climax, loudness, slow zone, phrase,
  bar phase…) is READY and nearly unused — a legibility problem, not a DSP one.
- **Pattern headers can only suggest the 5 mic signals** — `VALID_SIGNALS`
  derives from `processedSignalKeys()` (by design). If we want headers to
  suggest CLIMAX / LOUDNESS / SLOW ZONE, that derivation needs a deliberate
  widening (a separate decision; the modulation engine already accepts any key).
- **CaptainPad already distinguishes pulses in the AUDIO tab**
  (`PULSE_KEY_TOKENS`, `audioSignals.ts:117-129` — flash-dot rendering), but the
  MODULATION picker treats all 44 keys identically. The knowledge exists
  client-side; it belongs in the registry as metadata (§3.3).

---

## 2 · PART 2 — What is broken, and HOW to fix / stabilize

### 2.1 P0 — resurrect the onset family (exact micFlux recipe, one directory over)

**Root cause, two independent breaks:**

1. `publishRawMirrors` (`companion_server.js:1312-1324`) publishes only 9 keys:
   the 5 mic raws + 4 dom keys. It NEVER publishes `micOnsetLowRaw`,
   `micOnsetMidRaw`, `micOnsetHighRaw`, `micSubRaw`, `micTonalStabilityRaw`,
   `micChromaFluxRaw`, `micChromaTiltRaw` — all seven of which the analyzer
   emits every hop (`audio_analyzer.js:819-858`: `onsetLow/Mid/High`, `micSub`,
   `tonalStability`, `chromaFlux`, `chromaTilt`) and all seven of which
   `DerivedSignals.tick` reads back from the CPC
   (`derived_signals.js:300-314`). Registered keys default to 0 → the
   `BandOnsetBank` and `SubBass` shapers see eternal silence → the pulses never
   fire → `emitAllDerived` faithfully emits 0 forever.
2. The Companion's analyzer is constructed WITHOUT a `sub:` window
   (`companion_server.js:1355-1359` — `bands` + `kick` only), so `r.micSub` is
   0 even before the mirror gap: the sub-bass feature is "off" per the
   analyzer's opt-in contract (`audio_analyzer.js:156-159`). The engine's old
   boot path passed `sub: {minHz:30, maxHz:60}` from config; the sole-analyzer
   migration dropped it.

**Fix (mirrors `_184` exactly, 3 edits + guard):**
- Add the seven missing writes to `publishRawMirrors` (analyzer field → raw
  key, same shape as the existing nine).
- Add `sub: { minHz: 30, maxHz: 60 }` to the Companion's `AudioAnalyzer`
  options (both `analyzer` and — unnecessary but consistent — not the
  spectrum-only `specAnalyzer`).
- **The invariant whose violation hid this** (the `_184` lesson — make the
  divergence inexpressible): a test/import-time guard asserting that every CPC
  key `DerivedSignals` reads via `g('…Raw')` is either written by
  `publishRawMirrors` or written by a prior tick stage. Cheapest honest form: a
  companion test that streams one synth hop (`audio/synth/test_synths.js`
  `kick_4floor` / `hats`) through the real analyzer + mirrors + derived chain
  and asserts `micOnsetLow`, `micOnsetHigh`, `audioChestHit` leave 0. The
  existing offline harness pattern in `tools/genre_eval.mjs` (analyzer →
  ParamCenter → detector → derived) is the template.
- Same operator caveat as FLUX: on restart, four dead keys come alive at once —
  nothing in tracked playlists binds them (census above), so blast radius is
  picker-only. Zero saved-work migration needed.

**Show value: highest of any single fix.** The onset trio is the designed
input for the spatial drum chase (kick→hull zone A, snare→B, hats→C), and
CHEST HIT is the full-hull visceral thump — both currently advertised in the
picker and silently dead.

### 2.2 P1 — genre classifier's harmonic axis (same fix, same edit)

`GenreClassifier.update` receives `tonalStability/chromaFlux/chromaTilt` from
the same never-published raw mirrors (`derived_signals.js:310-313`), so the
harmonic features that separate techno (static loop) from melodic house
(chord movement) are dead — the classifier runs on the 8 legacy features only.
The §2.1 `publishRawMirrors` edit fixes this for free; validate with the
existing `tools/genre_eval.mjs` confusion matrix before/after.

### 2.3 P1 — retire `audioVocalsHot`

Stems were removed 2026-06-17; `stemsFresh` requires a write to
`stemsBassRaw/DrumsRaw/VocalsRaw` (`audio_structure_detector.js:320-329`) that
no longer exists anywhere, so `vocalsHot` is a constant-false. Remove the
descriptor from `DETECTORS` (`audio_signals.js:105`), the emit row
(`companion_server.js` list), and let the schema shrink; CaptainPad's
retired-source handling (`Modulation.tsx` "· retired" path) already covers any
stale saved mapping. Do NOT leave it: a permanently-0 key in the picker is
exactly the "random names" erosion of trust the operator is reporting.

### 2.4 P1 — event pulses must survive the wire

**Root cause:** `sendOsc` drops the packet entirely on non-send hops
(`companion_server.js:290-311`, gate computed per hop at `:1367-1370`). Hop
rate ≈ 86.13 Hz, default `oscRateHz` 60 → ~30 % of hops are silent. A ONE-HOP
event (`audioDownbeat`, `audioPhraseBoundary`, `audioTrackChange`,
`audioSwitchPattern`, `audioSwitchColor` — all published as 1.0 for a single
~11.6 ms hop then 0) that lands on a silent hop **never reaches the engine at
all**; one that lands on a send hop is 1 on the engine CPC for only one OSC
frame (~17 ms) — 0–1 frames at the 40 fps render, and usually invisible to
CaptainPad's ~20 Hz poll. Decaying pulses (kick 70 ms, onsets 70–90 ms,
countdown 80 ms, beat 0.18-beat width) are safe — they span many hops.

**Fix, two complementary parts (pick both):**
1. **Edge force-send:** in `emitAllDerived`, maintain a prev-value per event
   key and bypass the `_oscEmitThisHop` gate on a rising edge (events are
   sparse — a few extra packets per bar, no bandwidth story). This guarantees
   delivery.
2. **Envelope the events at the SOURCE** so the delivered shape is
   modulator-friendly: give the five one-hop booleans the same snap-1 /
   exponential-decay treatment the kick and band-onset shapers already have
   (`band_onsets.js` decay pattern, ~120–180 ms for downbeat/boundary). Then a
   pulse spans 10–15 hops, survives any gate, reads on CaptainPad, and drives a
   visible flash when bound. This is a change in `derived_signals.js`'s publish
   step (wrap the booleans in tiny decay envelopes), not in the trackers.
3. Pin it offline: a test that runs N bars of the `full_track` synth through
   the companion chain with the rate gate simulated at 60 Hz and asserts
   delivered-downbeat count == generated-downbeat count.

### 2.5 P2 — scaling / normalization corrections (registry-only edits)

- `audioKickRate` range `[0,8]` → `[0,4]` (`audio_signals.js:147`). Real dance
  material spans 1.2–3.2 kicks/s; at /8 the modulator lives in the bottom 40 %.
  (The party gate reads the raw value, not the normalized one — the range field
  only affects modulation normalization + meters, so this is safe; confirm the
  Companion PARTY tab meter uses the same range and likes the change.)
- `micDomFreq1/2`: as modulation sources, replace linear /22050 with a
  perceptual mapping. Cleanest respecting "no special cases in the modulation
  engine": normalize via descriptor range — but Hz is log-perceived, so instead
  add a registry-level flag consumed by `resolveModulationSources`
  (`norm: 'log2'` with `[30, 8000]` bounds, the tracker's actual span). One
  flag + a 3-line branch, and the descriptor registry remains the single truth.
  Alternative zero-code path: curate DOM FREQ out of the default picker tier
  and let NOTE HUE carry the "pitch as colour" use case.
- `audioBuildEta`: leave the key (automation consumers), curate out of the
  picker default tier; if operators want a bindable "drop is coming" ramp, the
  honest one is `audioRiserScore` (already READY).

### 2.6 P2 — labels & curation metadata (the "random names" fix proper)

Every picker label comes from `audio_signals.js` descriptor `label` tails.
Proposed operator-facing renames (one line each; keys NEVER change, so zero
saved-work migration):

| Key | Now | Proposed tail |
|---|---|---|
| `micFlux` | FLUX | FLUX (keep — now live and known) + registry `note: 'transient density / busy-ness'` |
| `audioSlowZone` | SLOW ZONE | CALM (BREAKDOWN) |
| `audioEnergyRatio` | ENERGY RATIO | ENERGY VS BASELINE |
| `audioPartyStrong` | PARTY (STRONG) | PARTY GATE |
| `audioParty` | PARTY | PARTY (LOOSE) |
| `audioBpmConf` | BPM CONF | BPM CONFIDENCE |
| `audioKickReg` | KICK REGULARITY | KICK STEADINESS |
| `micDomFreq1/2` | DOM FREQ 1/2 | PITCH 1 / PITCH 2 (Hz) |
| `audioChestHit` | CHEST HIT | CHEST HIT (fine — once it works) |

More important than renames: add TWO metadata fields to each descriptor —
`signalKind: 'level' | 'ramp' | 'pulse' | 'gate' | 'class'` and
`modulatorTier: 'primary' | 'advanced' | 'readout'` — and have the CaptainPad
picker group by tier and badge by kind (the pulse knowledge currently
hand-mirrored in `PULSE_KEY_TOKENS` then derives from the schema instead;
that client list is exactly the drift class `audio_signals.js` exists to kill).
Proposed primary tier (12): LOW, MID, HIGH, KICK, FLUX, LOUDNESS, CLIMAX,
CALM, RISER SCORE, BAR PHASE, PHRASE PHASE, NOTE HUE (+ ONSET LOW/MID/HIGH,
CHEST HIT once §2.1 lands = 16). Everything else advanced/readout, still
reachable.

### 2.7 Playa-robustness posture (already strong — keep, don't rebuild)

Wind gusts, generator hum, neighbor bleed, and between-songs behaviour are
already engineered for: per-band noise gates + noise-floor auto-cal
(`noiseCal`, companion), source-stage LP, `slowFluxFloor` mic-floor discount,
kick EMA ceiling clamp, idle-collapse on kick ring, silence latching, phrase
honesty gating, party ambient-floor calibration flow, and a dedicated
`playa` mic-model tier with wind + neighbor-bleed in
`tests/integration/mic_model.mjs` scored by `tools/playa_noise_eval.mjs`.
The remaining playa work is CALIBRATION (ambientFloor, band gates) — an
on-site 10-minute flow that already exists in the Companion UI — plus the §4
golden-recording validation. Do not add new robustness machinery on spec.

---

## 3 · PART 3 — Dataset-driven tuning (dev-time only; the playa is offline)

### 3.1 What the repo already has (build on this, not beside it)

- **Full-chain offline replay**: `tools/genre_eval.mjs` runs WAVs through the
  EXACT chain (AudioAnalyzer → raw mirrors → SPP → detector → DerivedSignals);
  `readWavMono` in `tests/integration/wav_io.mjs`; deterministic clocking.
- **Degradation model**: `tests/integration/mic_model.mjs` — clean / moderate /
  heavy / playa (wind + neighbor bleed) tiers, seeded.
- **Scoring harnesses**: `detection_eval.mjs` (drop P/R/F1 + latency, build
  correlation, slow-zone separation vs labeled synthetic scenarios),
  `bpm_tune_eval.mjs` (steady accuracy, tempo-step settling, `--corpus`
  real-track stability), `playa_noise_eval.mjs` (false-fires/min on real audio
  through the playa mic), `genre_eval.mjs` (confusion matrix vs a labeled
  folder corpus).
- **Corpus convention**: real audio in `~/tmp` (never committed), fetchers like
  `~/tmp/corpus_fetch/build_corpus.mjs`; the "FMA EDM corpus" (60 tracks) is
  referenced throughout the tuning reports.
- **Synth bank**: `audio/synth/test_synths.js` (kick_4floor, hats, riser,
  edm_drop, full_track, silence …) — CI-safe ground truth for event logic.

**The gap**: no harness scores BEAT/DOWNBEAT/PHRASE against human annotations,
and no per-signal "modulator health" metrics (range utilization, event
delivery rate, silence behaviour) across a corpus.

### 3.2 Dataset shortlist (availability/licenses checked 2026-08)

| Dataset | Ground truth | Size / license | Maps onto OUR signals | Notes |
|---|---|---|---|---|
| **GiantSteps Tempo** (GitHub `GiantSteps/giantsteps-tempo-dataset`) | tempo (EDM, from Beatport user corrections) | 664 two-min Beatport previews; annotations CC, audio via repo download scripts | `audioBpm` accuracy1/accuracy2, `audioBpmLocked/Conf` calibration, octave-error rate | THE tempo set for our genre. `bpm_tune_eval --corpus` already eats a folder of WAVs — just point it here |
| **GiantSteps Key / GiantSteps+ EDM Key** (GitHub + Zenodo 1095691) | key (600–604 EDM excerpts), CC BY-SA 4.0 | same preview mechanism | `audioNote`/`audioNoteHue` sanity (root pitch-class vs our dominant pitch class — approximate but directionally scoreable) | secondary |
| **Harmonix Set** (GitHub `urinieto/harmonixset`) | **beats, downbeats, functional segments** for 912 pop/dance tracks; annotations CC BY 4.0; audio NOT distributed (mel-specs + metadata; source audio must be obtained separately) | ~912 tracks | `audioBeat`/`audioDownbeat` F-measure, `audioPhrasePhase/Boundary` vs segment boundaries, `audioClimax` vs chorus/drop segments | The ONLY public downbeat+segment source with dance content. Audio re-acquisition is the friction; filter to the dance/electronic subset (~a third) |
| **FMA** (`mdeff/fma`) | genre taxonomy only (no beat labels); CC-family audio, fully downloadable | 106k tracks; `electronic` subtree | unlabeled STABILITY metrics: false-fires/min, party-gate dwell, BPM movement, range-utilization histograms | Already our house corpus; grow the electronic subset for soak tests |
| **MTG-Jamendo** | genre/mood/instrument tags; CC audio, downloadable | 18k+ full tracks | genre classifier eval widening; party-gate NEGATIVES (ambient/folk = must-not-fire material) | good negative-evidence pool |
| **Ballroom** (mirdata `ballroom`; CPJKU BallroomAnnotations) | beats, bars, tempo | 685 × 30 s, freely downloadable | BPM/downbeat sanity outside EDM (70–210 BPM spread stresses octave logic) | cheap add-on to the BPM eval |
| **CPJKU onset_db / Böck onset set** | onset instants | annotations public; AUDIO by request only | `micOnset*` shaper thresholds | LOW priority: audio friction is high, and beats from Harmonix + the synth bank cover the onset shapers well enough |
| **EDM drop/build annotations** (Yadati ISMIR-2014 SoundCloud drops; `mixerzeyu/edm-segmentation`) | drop timestamps | audio links rotted / not redistributable; tiny | `audioDropPulse`, `audioRiserScore`, `audioDropCountdown` | **No usable public set — self-label instead**: ~25 tracks × ~4 drops each is 2–3 h with a waveform editor, and the detector already has the labeled-scenario format (`tests/integration/detector_scenarios.mjs`) to slot into |

MIREX onset/beat evaluation sets are not publicly distributable — skip.

### 3.3 The tuning harness (one new tool, everything else exists)

`tools/signal_eval.mjs` — clone the `genre_eval.mjs` chassis:
WAV (+ optional annotation file) → mic-model tier → full chain → per-hop key
log → metrics:

- **Beat/downbeat**: F-measure @ ±70 ms vs Harmonix/Ballroom annotations;
  downbeat additionally scored bar-rotation-tolerant (the tracker's "1" is an
  anchored guess — score both strict and rotation-free).
- **Tempo**: accuracy1/accuracy2 vs GiantSteps; lock latency; unlock-relock
  behaviour on concatenated track pairs (DJ-swap simulation — concatenate two
  corpus tracks, measure `audioTrackChange` + relock time).
- **Phrase**: boundary hit-rate within ±1 bar of Harmonix segment starts
  (relative grid honesty, per the tracker's own caveat).
- **Modulator health, every published key, any corpus (no labels needed)**:
  p5/p50/p95/max (does it ever reach 0.8+? does it slam?), % time at exactly
  0, event rate/min, event delivery ratio through a simulated 60 Hz gate,
  silence-segment behaviour (all keys must decay/collapse within N s of
  silence). This single unlabeled report card is what keeps the picker honest
  forever — run it in CI on the synth bank, run it pre-playa on real corpora.

Corpora live under `~/tmp/audio_corpora/<set>/`, fetch scripts under
`~/tmp/corpus_fetch/` (existing convention), never committed, never a runtime
dependency — the playa build must not know these exist.

---

## 4 · PART 4 — THE PLAN

Ranked by show-value per unit work. Stages 0–2 are pure repo work (no
datasets); Stage 3 is the dataset campaign; Stage 4 is on-site.

### Stage 0 — Quick wins: labels, curation, retire (effort: ~half a day, one Opus implementer; risk: LOW)
1. Registry label pass (§2.6 table) + `signalKind`/`modulatorTier` descriptor
   metadata; CaptainPad picker groups by tier, badges pulses/gates/classes
   (derive from schema; delete the client-side `PULSE_KEY_TOKENS` mirror or
   derive it).
2. Retire `audioVocalsHot`; decide `tempoBpm`.
3. `audioKickRate` range [0,8] → [0,4].
4. Registry `note` strings for every signal (one operator sentence each) —
   ride the `_184` metadata machinery so CaptainPad can tooltip them.
   **Operator gains:** a picker that reads like a menu, not a symptom list.

### Stage 1 — Resurrect the dead signals (effort: ~1 day, Opus implementer; risk: LOW-MED — new signals start moving)
1. §2.1 `publishRawMirrors` completion + `sub:` window + the parity guard test.
2. §2.2 genre chroma comes alive free; run `genre_eval` before/after.
3. Companion restart on the show machine; verify ONSET LOW/MID/HIGH + CHEST
   HIT move on the AUDIO tab. No saved playlists bind them → no migration.
   **Operator gains:** the spatial drum-chase trio + the chest-hit thump —
   the biggest NEW show capability available for one day of work.

### Stage 2 — Event-signal wire hardening (effort: ~1 day, Opus implementer; risk: LOW)
1. §2.4 rising-edge force-send + source-side decay envelopes for
   downbeat / phraseBoundary / trackChange / switchPattern / switchColor.
2. Offline delivery test (generated == delivered at 60 Hz gate).
   **Operator gains:** downbeat- and phrase-locked looks that never skip a bar.

### Stage 3 — Dataset harness campaign (effort: 2–4 days, can PARALLELIZE: one agent on harness, one on corpus fetchers; risk: LOW — offline only)
1. Fetchers: GiantSteps tempo (+Ballroom), Harmonix dance subset, FMA
   electronic expansion → `~/tmp` (dev machine only).
2. `tools/signal_eval.mjs` (§3.3) + the unlabeled modulator-health report card.
3. Tune in this order (value first): BPM octave/lock on GiantSteps →
   downbeat anchoring (`downbeatTau`/`anchorMargin`) on Harmonix →
   phrase boundary hit-rate → onset shaper thresholds → dom-freq log-norm
   validation → optional micro-labeled drop set (~25 self-annotated tracks).
4. Every accepted retune lands with its eval number in the commit message and
   a regression pin (the `detection_eval` / `bpm_tune_eval` precedent).
   **Operator gains:** measured, not vibed, accuracy for BPM/downbeat/phrase —
   the signals the whole tempo-locked look family stands on.

### Stage 4 — Golden playa validation (effort: operator ~1 h recording + agent ~half a day; risk: none)
1. **Operator action:** record 10–20 min of real playa-style sets through the
   REAL mic chain (the Companion's file/capture path can replay WAVs — record
   at the bench with the show mic + speaker at show-ish SPL, and again on
   playa night one with the generator running). 3–4 clips: loud set, ambient
   night, conversation-only, wind-heavy.
2. Run `signal_eval` + `playa_noise_eval` on the goldens; calibrate
   `ambientFloor` (PARTY-tab capture flow) and per-band gates (`noiseCal`).
3. Verdict pass on the census: every READY signal must move correctly on the
   goldens; anything that doesn't goes back to Stage 2/3 with a recording that
   reproduces it.
   **Operator gains:** a reference set that makes every future audio bug
   reproducible offline — the audio equivalent of the sim screenshot loop.

### Signal-value ranking (most show value per unit work)
1. **micOnsetLow/Mid/High + audioChestHit** (Stage 1) — new capability, known recipe.
2. **Picker curation + labels** (Stage 0) — hours, converts 20 unused READY signals into usable ones.
3. **audioDownbeat / audioPhraseBoundary hardening** (Stage 2) — makes the tempo-locked family trustworthy.
4. **audioBpm/downbeat dataset tuning** (Stage 3) — compounding: phrase, countdown, switch cues all inherit it.
5. **Genre/chroma + dom-freq norm** — nice-to-have polish.

---

## 5 · Method note

Read-only. All evidence is file:line-cited from the current working tree
(shared with another AI session — current contents treated as truth). No
process started, no port bound, no mic opened, no repo code sent anywhere.
Web research (Part 3 only): dataset availability/licenses verified via search —
GiantSteps tempo/key (GitHub + Zenodo, CC annotations), Harmonix Set
(`urinieto/harmonixset`, CC BY 4.0 annotations, audio not distributed), FMA
(`mdeff/fma`, CC-family audio), MTG-Jamendo (CC), Ballroom/CPJKU annotations,
CPJKU `onset_db` (audio by request), Yadati ISMIR-2014 drop set (not usably
available). Playlist usage census via grep over `simulation/scenes/*/playlists/`.
