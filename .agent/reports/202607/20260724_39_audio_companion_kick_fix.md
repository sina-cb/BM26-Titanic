# 20260724_39 — Audio Companion: kick always-off + distortion on the random/test source

**Operator report (live, urgent):** in the Audio Companion, "kick value is
currently always off!!! … actually it's all distorted" — observed on the
**random (synthetic / test) data source**, not real capture. (The engine's
"audio listener disabled at boot — no pinned device" warning is expected and is
NOT this bug.)

**Verdict:** two independent, real bugs, both on the synthetic test source. Both
fixed and proven live. Engine + sim never touched; only the Companion process
was restarted to pick up the hot code changes.

---

## Where the chain broke

The Companion runs the engine's real DSP: `genFrame` (test synth) →
`AudioAnalyzer.pushSamples` (source-stage gain + FFT + band/kick detection) →
designed signal chains → OSC out → engine. Two separate points failed.

### Bug A — kick ALWAYS OFF (gain-independent, long-standing)

The default test synth is `tone` ("Tones + kick"). Its steady **55 Hz sub tone
sits INSIDE the analyzer's 50–110 Hz kick window**. The kick detector is a ratio
detector (`instant > ema × 2.4`): the constant in-band tone pinned the adaptive
EMA near the per-hop kick-band energy, so the brief 80 Hz kick transient (12 %
duty, 30 ms decay, level 0.8) could never clear 2.4×. Result: `micKick` read
**0 for every hop, at every input gain, at FFT 1024 and 2048** — proven with a
deterministic harness driving the exact analyzer config the Companion uses:

```
tone   gain=1     kickOnsets=0   (max kick value 0.000)
tone   gain=8.83  kickOnsets=0
kick_4floor / full_track / white_noise: fire normally (16 / 13 / 16 onsets) — gain cancels in the ratio, as designed.
```

The synth's own name/description promise a kick; the detector never saw one. The
existing test suite asserted `kick_4floor` fires but had **no assertion that
`tone` fires**, so it slipped through.

### Bug B — "all distorted" (regression trigger: drifted mic gain)

`inputGain` is the **mic preamp**, synced from the engine over
`ws://127.0.0.1:6968/ws/control`. The engine's live `audio` config carried
`inputGain: 8.83` (working-tree `states/test_bench/audio_state.yaml` shows the
same drift — previously committed at `12.7`, then `1`; a stale
calibration-on-near-silence value). The Companion applied that mic preamp to the
**full-scale synthetic test source** (already ±1.0), which is a category error:

```
tone gain=8.83:  conditioned-PCM peak 8.83, 81.9% of samples CLIPPED,
                 bands pinned low/mid/high ≈ 0.95 (saturated)  → "all distorted"
tone gain=1:     0% clipped, bands ≈ 0.62–0.70               → sane
```

The oscilloscope became a clipped square wave and every band pinned near 1 — the
operator's "it's all distorted". Confirmed live: at hello the Companion had
`inputGain 8.83` synced from the engine.

`config.yaml` audio keys were NOT clobbered (its working-tree diff is
playlist/colorAutopilot only). The corruption is in the engine's runtime
`audio_state` tuning, synced live into the Companion.

---

## Root cause

- **A:** `tone` synth's steady sub tone lives in the kick detection band and
  masks the transient → kick never fires.
- **B:** the mic preamp is applied to the synthetic test source, so a
  mic-tuned/drifted gain (8.83) clips a full-scale generator to death.

---

## Fix (three edits + one test)

1. **`audio/synth/test_synths.js`** — retune `tone` so its kick clears the
   threshold: steady sub level `0.5 → 0.28` (stop masking the transient), kick
   `0.8 → 1.0`, burst `12 % → 18 %` duty, decay `30 → 60 ms`. Now fires ~10
   kicks / 6 s at **both** FFT 1024 and 2048, with low/mid/high all ≈ 0.6.

2. **`audio/companion/companion_server.js`** —
   - The live-editable `source` param seed now comes from `SYNTHS.tone.defaults`
     (one source of truth) instead of a hand-copied literal. This mattered:
     `genFrame` passes `source` as the params object, which **overrides** the
     synth defaults in `fillFrame` — a stale copy silently defeated the fix (the
     first restart still ran subLevel 0.5 / kickLevel 0.8 → 0 fires).
   - **Test source renders at UNITY gain** (`effectiveInputGain()` = 1 in
     `mode==='test'`, real preamp for mic/file), re-applied on every source
     switch. A synthetic full-scale generator must not receive a mic preamp; the
     designer's reference now looks clean **regardless of what mic gain is
     persisted/synced**. This is the durable guard against Bug B, not just a
     one-time value repair. (Not a codex-P0 fallback: it's correct source-stage
     semantics, not error-masking.)
   - `applyInputGain` now **fails loud** on a non-finite / out-of-[0,64] value
     (warn + keep last good) instead of silently clamping.

3. **`tests/companion/companion_test_synths.test.js`** — new regression test:
   `tone` must fire the kick (≥ 2) and keep all three bands active.

The engine's persisted `8.83` was **not** hand-edited — it is engine-owned
runtime state (the engine re-dumps it; per AGENTS.md, report it, don't revert).
The decoupling makes the test source immune to it either way.

---

## Proof (before → after, live Companion on the test source)

| Metric (test source) | Before | After |
|---|---|---|
| Kick rising edges (~9 s) | **0** | **18** (raw kick max 1.0, mean 0.15) |
| Designed `micKick` post | 0 always | toggles, max 0.816 |
| Band low mean | ~0.95 (saturated @8.83) | 0.62 |
| Waveform |abs| max (clip check) | ~1.0 pinned, 81.9 % clipped | mean 0.63–0.79, no gross clip |

- At `inputGain 8.83` synced live, the test-source bands were already sane
  (low 0.68, waveAbsMax mean 0.79) — the decoupling works even with the drifted
  gain present.
- **OSC out → engine:** `/marsin/mic/kick` emits at ~55 Hz with the value
  spiking to 0.816 on a fire then decaying (0.396 → 0.146 → 0.054 …) — a real
  kick envelope on the wire. Address maps to the engine's `micKick` CPC
  (`audio/postproc/audio_signals.js`, `osc:'kick'`); engine OSC listener enabled
  on 127.0.0.1:10000.

**Tests:** `npm test` → 2133 tests, 2126 pass, **7 fail — all pre-existing env
failures** (`audio_capture` Windows pinned-device, `effects_v2_mode_page_layout`
worker-deserialize, `osc_listener` port-bind). Zero new failures; the new `tone`
test passes.

---

## How the operator should re-test

1. The Companion was restarted (`node audio/companion/companion_server.js
   --port 6966`, now pid on :6966) and left on the **mic** source (config
   default). Reload the browser tab at <http://localhost:6966> to pick up the
   restarted server.
2. Switch the source to **test** (synth `tone`, "Tones + kick"). You should now
   see: a **clean, unclipped** oscilloscope, bands sitting mid-range (not pinned
   at the top), and **`micKick` pulsing ~2×/s** with the kick envelope.
3. Because the test source now ignores the mic preamp, it stays clean even if the
   mic `inputGain` is high. If the **mic** path itself also looks hot, reset the
   mic gain in the MIC TUNE page — the engine's runtime `inputGain` had drifted
   to 8.83 (currently reading 1 again); worth confirming it's where you want it
   for real capture.
