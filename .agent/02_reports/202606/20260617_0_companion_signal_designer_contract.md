# 2026-06-17 — Companion signal-designer rehaul: shared contract

This is the coordination contract for the Companion → OSC → CPC → CaptainPad
rehaul. Two build agents read this so the OSC/CPC surface lines up.

Architecture (operator-confirmed): the **Audio Companion is the sole audio
analyzer** (engine-supervised subprocess, docs/37 §8). The operator DESIGNS
signals in the Companion (pick a raw source → chain of ops → an "OSC out" op),
the Companion sends the chosen signals over OSC to the **engine's OSC port**
(host/port from config), the engine writes them into the CPC, and CaptainPad
shows them **dynamically** in the deck, mixer, and audio tab.

## Signal types + type-aware op palette
- `intensity` signals (sources: `rawLow rawMid rawHigh rawKick rawFlux`, value [0,1]).
  Op palette: gain, bias, clamp, lpf, biquad, envelope, slew, curve, compressor,
  slope, normalizer, schmitt, hold, **osc_out**.
- `frequency` signals (sources: `rawDom1 rawDom2`, value Hz; energy companion [0,1]).
  Op palette (Hz-valid only): smooth/lpf (on Hz), clamp (Hz bounds), slew,
  kalman (if available), **osc_out**. NOT schmitt/normalizer/compressor (intensity-only).
- The op palette offered in the UI MUST be filtered by the selected signal's type.

## The `osc_out` op (the output)
- A terminal op. params: `{ address: '/marsin/...'  }` (the engine OSC address) and
  an optional `cpcKey` label. A signal whose chain contains `osc_out` is an OUTPUT.
- Each analyzer hop, the Companion sends the signal's POST value to the engine via
  UDP OSC at `config.osc.host:config.osc.port` (default `127.0.0.1:10000`, the
  engine's `osc.port`). Float payload (events as 1.0/0.0 — NOT bang; the engine
  OscListener requires a scalar arg, docs/24).
- "Point at the visual marsin_engine based on the configs": the OSC target is read
  from a config (engine osc host/port), not hardcoded.

## Output config (persisted, like other configs)
- The full design — the list of signals, each with `{ id, label, source, type,
  chain:[ops...], output:bool }` — persists to a Companion config file
  (`audio/companion/companion_config.yaml`, mirroring how audio_state.yaml is
  shaped). Loaded on boot; "Export config" writes it.

## CPC keys the Companion emits (the curated default set)
| Label  | OSC address          | CPC key (engine)   | type |
|--------|----------------------|--------------------|------|
| LOW    | /marsin/mic/low      | micLow             | intensity |
| MID    | /marsin/mic/mid      | micMid             | intensity |
| HIGH   | /marsin/mic/high     | micHigh            | intensity |
| KICK   | /marsin/mic/kick     | micKick            | intensity |
| DOM1   | /marsin/dom/freq1    | micDomFreq1        | frequency |
| DOM2   | /marsin/dom/freq2    | micDomFreq2        | frequency |
| BPM    | /marsin/audio/bpm    | audioBpm           | bpm |
| ENERGY | /marsin/audio/energy | audioEnergyRatio   | intensity |
| SLOW   | /marsin/audio/slow   | audioSlowZone      | intensity |
| BUILD  | /marsin/audio/build  | audioBuildScore    | intensity |
| PARTY  | /marsin/audio/party  | audioParty         | intensity |
- The engine OscListener must bind these inbound addresses → CPC keys.
- CaptainPad renders whatever audio CPC keys are present (dynamic), in deck +
  mixer + audio tab. Remove the stems UI.

## Mic selection (unified)
- Device selection in CaptainPad/engine sets the capture device; the Companion
  (engine-supervised) uses the same device. The Companion's own device picker
  also works. One device config, both honor it.

## Follow-up CaptainPad requirements (2026-06-17, queued)
Apply in the next CaptainPad pass (after the running audio-viz agent, to avoid
file conflicts):
1. **Deck + mixer: curate, don't dump.** Show only a best-practice SUBSET of audio
   signals (the most useful — e.g. low/mid/high/kick + a beat/bpm cue), not the full
   set. Keep it uncluttered; the full set lives in the audio tab.
2. **Modulation pop-up = the rich view.** When configuring a modulation, the popup
   (Modulation.tsx / AllModulationsPanel / source picker) must show each candidate
   signal's **live trail plot**, and a **visualization of the modulation being
   applied** — i.e. the mapping (depth/curve/range) and its effect on the target
   param, with the source signal's trail. Make the popup more professional/polished.
