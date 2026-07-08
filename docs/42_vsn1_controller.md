# 42 — Intech Studio VSN1 (third MIDI controller)

Sina's third control surface (confirmed 2026-07-08), joining the Midi
Fighter Twister and APC mini mk2. Product page:
<https://intech.studio/shop/vsn1>

## Technical specifications (from Intech)

- **320 × 240 pixel LCD screen** with great viewing angles
- **High-precision, endless jog-wheel**
- **Gateron Hall-effect key switches** with MX-style shaft
- Small, assignable tactile buttons
- Innovative **magnetic interface** for modular connection in any direction
  with other Grid controllers
- High-speed USB-C connection
- 250 mA power draw
- **RGB LED indicator for each control element**
- **Side button for page changes**

## System integration notes

- Enumerates on Windows as **"Intech Grid MIDI device"** with two MIDI ports
  ([0] and [1]).
- **Not yet profiled in CaptainPad** — the MIDI layer ignores unprofiled
  devices. Discovery workflow: run
  `node marsin_engine/tools/midi_discovery/serve.cjs` → <http://127.0.0.1:6979>,
  do a labeled capture pass over every element/gesture, export; the capture
  JSON in `marsin_engine/tools/midi_discovery/captures/` is the input for
  authoring the CaptainPad profile (`CaptainPad/midi_profiles/`).
- **Screen is pixel-programmable** via the Grid Lua API in Intech's **Grid
  Editor** app (LCD Draw event; text/rects/values/procedural graphics;
  widget library). Configs persist on the module's flash.
- **Runtime status-display path:** Grid Lua can react to incoming MIDI — so
  CaptainPad/engine can push values (BPM, focused channel, pattern name,
  sync state…) as MIDI and the VSN1's own Lua renders them on screen. The
  LED-feedback pipeline in CaptainPad's MIDI layer is the natural sender.
- Configuration app: **Grid Editor** (free, Windows/macOS/Linux) —
  <https://intech.studio/products/editor>. Docs: <https://docs.intech.studio/>.
