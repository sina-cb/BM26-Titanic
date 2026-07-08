# now.md — State of Play

> Updated by any agent, any time state changes. Keep it under a screen.
> Absolute dates only.

_Last touched: 2026-07-07_

## Active branches

- **`main`** — integration branch. Push/merge is operator-gated.
- **`feat/party_integration_20260711`** — party merge wave: studio model +
  LED fixtures + CaptainPad MIDI + autopilot deck, all merged, conflicts
  resolved, awaiting full-stack smoke then operator merge to `main`. See
  report `reports/202607/20260707_1_party_merge_wave.md`.

## Active projects

- **party_20260711** — party on Saturday 2026-07-11. Plan/tracker lives in
  the private repo: `BM26-Firmware-Deployment/PARTY_PLAN_20260711.md`
  (tracks: MarsinLED/Angio4 hardware, MIDI tests, pattern tuning, party +
  ambient playlists, party-detection cue).
- **agent_os_rework** — reworking `.agent/` into the Agent OS. See
  [`../projects/agent_os_rework.md`](../projects/agent_os_rework.md).

## Hot notes

- **gitleaks v8.28.0** on `PATH` confirmed working (gate passed 2026-07-07).
- **marsin_engine tests on the Windows box**: `audio_capture` (no audio
  device configured), `osc_listener` (EACCES instead of EADDRINUSE), and
  `led_dmx_parity` fail identically on `main` — environmental/pre-existing,
  not regressions. Same set fails on the party integration branch.
