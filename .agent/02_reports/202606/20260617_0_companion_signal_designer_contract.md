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

## Companion polish queue (apply right after the running companion agent)
- **Add-signal = themed modal, not `prompt()`.** Replace the browser alert/prompt
  used by the sidebar [+] with an in-app themed panel (source dropdown + type),
  styled like the rest of the Companion (matches the export/browse modals). No
  native dialogs anywhere in the designer.

## CaptainPad audio-tab strip-down + BPM (2026-06-17)
CaptainPad-side (running now, disjoint from the engine config-sync agent):
1. REMOVE the "SIGNALS · CHAINS" card from the audio config tab — chain design is a
   Companion-only concern now.
2. REMOVE the "STRUCTURE DETECTOR" section (the under-development THIN/VOCALS preview).
3. SOURCE selector: test + file can be DISABLED from CaptainPad (keep a clean deck —
   default/lock to mic; test/file hideable).
4. BPM → SPEED SYNC reads the COMPANION's BPM (audioBpm CPC key), not /lx/tempo/bpm.

Engine/Companion-side (QUEUED — apply after the config-sync agent to avoid
companion_server.js conflicts):
5. Companion EMITS audioBpm over OSC (so the curated /marsin/audio/bpm key is populated
   in CPC) — BPM as a first-class companion output.
6. Engine bpmSpeedSync uses audioBpm as its tempo source (instead of tempoBpm /
   /lx/tempo/bpm), so "BPM → SPEED" syncs to the Companion's analysis.

## Dom signal = freq + energy (2026-06-17, queued — after the running Companion UI agent)
- A dom source (rawDom1/rawDom2) produces BOTH a frequency (Hz) and an energy [0,1].
  The Companion tab for a dom signal must SHOW both, and route both to the engine:
  freq → micDomFreq1/2 (/marsin/dom/freq1·2), energy → micDomEnergy1/2
  (/marsin/dom/energy1·2). So picking a dom source yields two outputs (freq + energy),
  both visualized in its tab and both landing in CPC / CaptainPad.

## DERIVED panel frozen (2026-06-17) — verify/extend after the Companion UI agent
- BUG: the Companion DERIVED panel is FROZEN — BPM "--", NOTE stuck on C, mood stuck
  "calm". Root cause = same as the BPM bug: the broadcast frame isn't carrying the
  LIVE derived data (DerivedSignals.tick writes audioBpm/audioNote/audioParty into the
  paramCenter each hop, but the frame/UI shows stale defaults; note pitchClass 0 → "C",
  party 0 → "calm").
- FIX must cover ALL of BPM + NOTE + PARTY (not just BPM): the frame carries the live
  derived values (read from paramCenter: audioBpm, audioNote/NoteHue, audioParty), and
  companion_app.js renders them (note pitchClass -1/no-note → "--" not "C"; party 0 →
  calm only when truly calm). Engine-side note hold-fix is already committed in
  derived_signals.js — this is the Companion frame/display half.
