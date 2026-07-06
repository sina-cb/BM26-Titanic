---
description: Feed synthetic audio signals over OSC to the engine (no mic/Companion) to test CaptainPad audio meters, modulations, BPM, and the live ghost slider
---

# 🎛️ OSC Synth — fake audio signals for testing

`CaptainPad/scripts/osc_synth.mjs` sends a moving float over OSC to the engine's
OSC listener (`:10000`) — the **same path the Audio Companion uses**. The engine
writes it into the CPC key bound to that address, so you can drive e.g. `micLow`
and watch the LOW meter, any modulation sourced from it, the ghost slider, or BPM
react live — **with no mic and no Companion running**.

Dependency-free (built-in `dgram` + a tiny OSC encoder) — runs offline with plain
`node`, no install.

## When to use
- Testing the CaptainPad audio UI (signal meters, modulation band + live ghost, BPM readout).
- Exercising a **modulation mapping** without audio: a pattern is modulators-only,
  so it never reads audio directly — a modulation maps a CPC audio key (e.g.
  `micLow`) onto a slider. Drive that key here to see the pattern react.
- Reproducing a signal shape deterministically (a clean sweep) instead of waving at a mic.

## Prerequisite
The engine must be running (it opens the OSC listener on `:10000`):
```bash
cd marsin_engine && node engine.js --model test_bench --pattern 27_swipe
```
(Or the full stack via `node launcher.js dev --scene test_bench`.)

## Run it
```bash
cd CaptainPad
node scripts/osc_synth.mjs --address /marsin/mic/low --shape sine
```
Ctrl-C to stop. It prints a live `t=… value=…` readout.

### Common addresses (each bound to a CPC key)
| Address | CPC key | Range to use |
|---|---|---|
| `/marsin/mic/low|mid|high|kick|flux` | `micLow…micFlux` | `0..1` (default) |
| `/marsin/dom/energy1|energy2` | `micDomEnergy1/2` | `0..1` |
| `/marsin/dom/freq1|freq2` | `micDomFreq1/2` | Hz → `--max 8000` |
| `/marsin/audio/bpm` | `audioBpm` | `--min 60 --max 180` |

### Flags
| Flag | Meaning (default) |
|---|---|
| `--address` | OSC path → CPC key (`/marsin/mic/low`) |
| `--shape` | `sine` \| `triangle` \| `square` \| `ramp` \| `random` \| `hold` (`sine`) |
| `--freq` | cycles/sec of the shape (`0.25` = one sweep / 4 s) |
| `--min` `--max` | output value range (`0`..`1`) |
| `--rate` | sends/sec (`30`, matches the analyser cadence) |
| `--value` | with `--shape hold`, the constant value to hold (`0.75`) |
| `--host` `--port` | engine OSC endpoint (`127.0.0.1:10000`) |
| `--duration` | seconds to run, `0` = forever (`0`) |

## Examples
```bash
# slow sine on the LOW band — watch the LOW meter breathe
node scripts/osc_synth.mjs --address /marsin/mic/low --shape sine

# sweep dominant freq across the spectrum (Hz needs a big --max)
node scripts/osc_synth.mjs --address /marsin/dom/freq1 --max 8000 --shape ramp

# punchy random kick at 20/s
node scripts/osc_synth.mjs --address /marsin/mic/kick --shape random --rate 20

# pin a steady value (e.g. to set a slider via its modulation source)
node scripts/osc_synth.mjs --address /marsin/mic/mid --shape hold --value 0.6
```

## Notes
- Dev/test tool — not part of the deployed playa stack.
- To see a swipe/dancer react, attach a modulation on the playlist entry
  (`source: cpc <key>` → `target: slider…`) and drive `<key>` here. See
  `docs/MARSIN_ENGINE_PATTERNS.md` §8 (modulators-only) and the audio system
  overview in `.agent/02_reports/202606/20260618_0_bar_swipe_handoff.md`.
- For accurate end-to-end audio (real DSP), use the Companion instead; this is the
  fast, mic-free shortcut for UI/modulation testing.
