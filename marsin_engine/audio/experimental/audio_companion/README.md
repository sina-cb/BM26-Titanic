# Audio Companion (experimental)

A standalone, offline live visualiser for the **marsin audio engine** — a
companion dashboard to watch the analyser output (LOW / MID / HIGH / KICK /
FLUX) in real time while tuning, independent of the CaptainPad iPad app.

> **Experimental.** Lives under `marsin_engine/audio/experimental/`. Vanilla
> HTML/CSS/JS, no build step, no CDN (playa-offline friendly). Observe-only.

## Run it

1. Start the engine (it serves the WebSocket the companion reads):
   ```bash
   cd marsin_engine && node engine.js --model test_bench
   ```
2. Open `index.html` in a browser (double-click, or `file://…/index.html`).
3. It auto-connects to `ws://localhost:6968/ws/signals`. Change **host/port**
   in the top bar if the engine runs elsewhere, then **Connect**.

## What it shows

- One card per signal: the live **POST** value (chain output — what the
  lights react to) as a number + bar, and a rolling trail with **POST** solid
  and **RAW** (pre-chain analyser mirror) as a faint ghost behind it.
- It reads the engine's coalesced `liveParams` frame off the dedicated
  `/ws/signals` socket — the exact data CaptainPad's meters use, so it's a
  zero-cost extra subscriber that can't disturb other clients.

## Notes

- **Weak signal?** Boost `audio.bands.inputGain` (the iPad AUDIO strip's INPUT
  GAIN slider, or `PATCH /audio/config {bands:{inputGain}}`) — it lifts
  LOW/MID/HIGH/KICK so they're readable here too.
- This is a read-only visualiser; it sends nothing to the engine. Controls
  (gain, mic pick) live in CaptainPad.
- It connects directly to the engine WS from `file://`; no static server is
  required. If you serve it over HTTP later, the same code works unchanged.
