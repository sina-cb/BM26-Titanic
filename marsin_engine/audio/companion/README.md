# Audio Companion

A standalone app for **designing audio signal processing** for the marsin
audio engine: pick a signal, build its op chain (the engine's real ops), tweak
params + a test source, watch the **RAW → POST** trace update live, and
**export** the chain config the engine loads. TouchDesigner-flavoured, fast,
fluid — for fine-tuning signals without hand-editing YAML.

## ░ HARD, UNBREAKABLE RULE ░

> **The Audio Companion runs the engine's REAL audio DSP.** It imports
> `AudioAnalyzer` and `SignalPostProcessor` (+ the op catalog / chain
> validator) directly from `marsin_engine/audio/…` and processes signals
> THROUGH THEM. It MUST NEVER reimplement, fork, or shadow any audio-
> processing logic in its own code path. One source of truth — what previews
> here is byte-for-byte what the engine runs. Any new audio behaviour goes in
> `audio/…` first; the Companion only renders it.

This is enforced by construction: `companion_server.js` has **no DSP of its
own** — it generates a test PCM signal, feeds it to the engine's
`AudioAnalyzer`, runs the engine's `SignalPostProcessor` on the result, and
streams the numbers to the browser. The UI (`ui/`) only draws + sends edits.

## Run

```bash
cd marsin_engine
node audio/companion/companion_server.js          # → http://localhost:6970
# (optional) --port 6971
```
Open `http://localhost:6970` in a browser. No engine instance, no mic, no
build step required — the Companion runs the analyzer + chains itself.

## Use

- **SIGNALS** (left): pick LOW / MID / HIGH / KICK / FLUX.
- **TEST SOURCE**: shape the synthetic input (sub/mid/high level, kick rate,
  noise, input gain) so you can design against a known signal.
- **chain** (the op pipeline): add ops from the engine's catalog
  (gain/lpf/envelope/schmitt/hold/slew/compressor/biquad/normalizer/…),
  reorder ◀▶, remove ✕, tweak each param. Edits are validated by the engine's
  `validateChain` and applied to the real `SignalPostProcessor` instantly.
- **trace**: RAW (ghost) vs POST (solid) over time — design for the feel you
  want (smooth bands, sudden kick).
- **Export config**: emits the `chains:` YAML — paste it under `chains:` in a
  scene's `states/<model>/audio_state.yaml`, or wire it via `PATCH /audio/config`.

## Layout
```
audio/companion/
  companion_server.js   Node backend — runs the engine's real DSP, serves the UI
  ui/
    index.html
    companion_app.js    frontend (render + edits only; no DSP)
    companion_app.css
  README.md
```
