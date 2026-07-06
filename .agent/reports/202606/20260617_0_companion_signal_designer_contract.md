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

## Source-mode sync CaptainPad↔Companion (2026-06-17, queued — after Companion UI agent)
GAP found: gain/smooth/mic-device(in mic mode) sync works, but SOURCE MODE doesn't.
- CaptainPad switches source by PATCHing capture.device = 'test' | 'file:<path>' | device-id.
- Companion applyEngineSharedTuning only does `if (mode==='mic') setMode('mic',{device})` —
  it does NOT interpret 'test'/'file:' to switch the Companion's mode. So TEST/FILE/mic-switch
  from CaptainPad don't change what the Companion analyzes.
FIX (companion_server.js):
1. applyEngineSharedTuning maps capture.device → mode: 'test'→setMode('test');
   'file:<path>'→setMode('file',{file:path}); a real device → setMode('mic',{device}).
   Only switch when it actually changed (avoid disruptive restarts).
2. The Companion writes-through ALL its own mode switches (test/mic/file) to the engine as
   capture.device (today only mic+device write-through), so switching source in the Companion
   also reflects in CaptainPad. Net: source is fully two-way configurable from CaptainPad.

## CaptainPad audio tab — scrollable signal grid (2026-06-17, queued/after audit agent)
- The 3-column audio-signals grid runs tall (3×N) and can overflow the screen — make
  the signals area SCROLLABLE (vertical scroll) so the operator can see all of them
  (esp. the lower rows: dom/energy/note/switch/bar-phase/downbeat). Keep the 3-col grid;
  just ensure it lives in a scroll container that fits the iPad viewport.

## Companion custom VIEWS — mix/share signals (2026-06-17, queued — after current Companion agent)
- Today the VISUALIZERS section is fixed (DOM DANCE + per-signal traces). Add the ability
  to CREATE new VIEWS that combine/overlay a chosen SUBSET of the signals list:
  - "+ add view" in the VISUALIZERS section → name it → pick which signals to include
    (multi-select from the signals list) → renders a single MIXED plot overlaying those
    signals' traces (color-per-signal, shared axis; sensible for same-type signals,
    and handle mixed intensity/frequency gracefully — e.g. normalized overlay or
    grouped).
  - A view is a saved object { id, label, signals:[signalId...], (opts) }; persists to
    companion_config.yaml alongside signals; add/remove like signals; selecting a view
    in the sidebar shows its mixed plot in the main stage.
  - "share certain signals": the view is the share/compare surface (see several signals
    together); include it in Export so the view set travels with the design.
  - Keep it clean + themed (matches the designer). No native dialogs (use the themed
    modal pattern). Reuse the existing trace renderer.

### Refinement: views have a VISUALIZER TYPE (dancing-balls is one)
- A view picks a viz TYPE + the signals fed into it:
  - **dancing-balls** (the current DOM DANCE orbs / DanceMaker spring): fed freq-type
    signals (e.g. dom1 + dom2) → gliding orbs. The existing DOM DANCE becomes an
    instance of this type fed both dom signals — not a hardcoded one-off.
  - **trace-overlay**: fed any signals → overlaid color-per-signal traces (the mix/compare view).
  - (extensible: spectrum, etc.)
- So "+ add view" → choose type → multi-select signals (filtered to the type's accepted
  signal type, e.g. dancing-balls wants frequency signals). view = { id, label, type,
  signals:[...] }, persisted in companion_config.yaml, shown in the sidebar VISUALIZERS list.
- Reuse the existing dance renderer (DanceMaker/dom-dance) for the dancing-balls type and
  the AudioTrace renderer for overlays — no new viz engines.

## BUG: freq-domain clamp/slew use intensity defaults/ranges (2026-06-17, queued)
ROOT CAUSE (debugged): the DSP + validation are correct (frequency mode skips the [0,1]
clamp, allows Hz up to Nyquist). But clamp/slew get INTENSITY defaults + sliders on a
FREQUENCY signal:
- clamp default min:0/max:1 → squashes dom Hz into [0,1] (kills it); UI slider 0–1.
- slew default maxStepPerSec:4 → 4 Hz/sec → freezes the dom freq; UI slider 0–20.
FIX (companion_app.js UI_RANGE/sliderRange + the add-op default in companion_server.js/
companion_app.js): TYPE-AWARE. When clamp/slew (or any Hz-domain op) is added to a
FREQUENCY signal, default to Hz-sane params (clamp ~20–8000 Hz, slew ~2000 Hz/s) and use
Hz slider ranges (clamp 0–8000, slew 0–5000/s, step suitable). Typed input stays unbounded.
Keep intensity-signal defaults/ranges unchanged.
