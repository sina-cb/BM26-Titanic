# 2026-06-12 — One-command stack launcher with profiles (PR #13)

**Branch:** `claude/launcher-command-profiles-h255l5` · **PR:** #13
**Author:** agent session for Sina

## What shipped

`launcher.js` at the repo root — a zero-dependency (Node built-ins only)
one-command launcher that coordinates the stack in the order proven by
`.agent/01_skills/05_full_stack_smoke.md` (sim → engine → CaptainPad):

```bash
node launcher.js <prod|dev|dev-lite> [--scene <name>] [--pattern <name>] [--no-kill]
node launcher.js status
node launcher.js stop
```

| Profile | Processes | Sim settings (via URL params) |
|---|---|---|
| `prod` | sim + engine | `profile=pixel_mapping&spotlights=0` — lightest |
| `dev` | sim + engine + CaptainPad Expo | `profile=full&spotlights=60` |
| `dev-lite` | sim + engine + CaptainPad Expo | `profile=emissive&spotlights=0` |

All profiles force `lighting_mode=sacn_in` (new sim URL override added in
`gui_builder.js`, same mechanism as the existing `profile`/`renderer`
overrides) so a launched sim always listens to marsin_engine instead of
booting its in-browser Pixelblaze engine.

Lifecycle (hardened after a fresh-eyes review pass): single-instance lock
file at `~/tmp/bm26_titanic_launcher.lock.json` (double-launch refuses;
`status`/`stop` read it); identity-checked port cleanup (only kills
processes matching known stack entrypoints, refuses loudly otherwise — no
`npx kill-port`, offline-safe); per-component readiness probes with 5s
heartbeats and per-component `✅ … is ready.` lines; verified teardown
(SIGTERM group → await exit → SIGKILL escalation) wired to SIGINT/SIGTERM/
SIGHUP/uncaught exceptions/failed spawns; the final banner prints the
Simulation and CaptainPad URLs to open. The launcher re-asserts the
requested `--pattern` via `POST /pattern` after engine boot because the
engine's persisted deck state otherwise silently overrides the CLI flag.

## Stack bugs found and fixed along the way

- **"sACN senders bind UDP :5568" (Notion card, RESOLVED on this
  branch — was repo task 010):** all sACN Senders bound UDP
  `*:5568` via `reuseAddr: true`, so the last binder stole inbound
  datagrams from the sim bridge Receiver — engine→sim showed `Connected`
  but `FRAMES 0` forever with the launcher's fixed start order. Removed
  `reuseAddr` from the three Sender sites (`marsin_engine/lib/
  sacn_output.js`, `simulation/server/sacn_bridge.js`,
  `simulation/server/sacn_output_bridge.js`); senders now use ephemeral
  source ports. Verified: bridge WS relays 634 binary frames / 8s
  (2 universes × 40 fps) in the previously-failing order.

## Verification (sub-agent single-shot runs)

- **prod** (titanic): up in ~5s, correct processes/params, clean teardown.
- **dev** (test_bench): up in ~48s incl. Expo; lock refusal, `status`,
  sub-second `stop` all correct; sim `params` = `full`/`sacn_in`;
  CaptainPad `● CONNECTED` with live BPM/audio data and pattern switch
  reflected live.
- **dev-lite** (test_bench): `emissive`/`sacn_in`, SIGTERM teardown clean.
- Post-fix regression (this session, prod/test_bench/07_shimmer):
  pattern re-assert works, sACN frames flow (634/8s).
- Screenshots in `.agent_renders/launcher_dev_*.png`,
  `launcher_devlite.png`, `launcher_prod.png`.

## Open follow-ups (Notion task tracker)

Task tracking moved to the Notion board "Titanic Lighting - Task
Tracker" mid-stream (`.agent/00_gol/14_task_tracking.md`); these were
filed there:

- **"Sim http-server runs via npx but is not a declared dependency"**:
  `simulation/start.js` serves via `npx http-server` but `http-server`
  is not in `simulation/package.json` — offline/playa risk.
- **"Titanic engine model has no DMX patches — engine runs
  render-only"**: `marsin_engine/models/titanic.js` has 0/976 pixels
  patched → engine runs render-only on the default scene; the prod stack
  drives no DMX until the titanic model is re-exported with patches.
  Also: titanic scene default `lightingMode` was `pixelblaze` (now
  overridden by the launcher URL, but the saved default may deserve a
  flip to `sacn_in`).
- An operator-reported Windows crash (all four sim servers killed
  simultaneously, each code 1) remains undiagnosed; signature matches an
  external `kill-port 6969-6972` (e.g. a concurrent `npm start` in
  simulation/) rather than a launcher fault. Launcher now absorbs Windows
  Ctrl+C races (2s window) and the single-instance lock prevents
  launcher-vs-launcher collisions.

## Working-tree residue (deliberately not committed)

Engine runtime writes from the test runs, per
`.agent/00_gol/01_git.md` / smoke skill: `marsin_engine/states/**/*.yaml`,
hot-regenerated `marsin_engine/models/test_bench*.js` (timestamp line),
`marsin_engine/config.yaml` (`playlist.active` flip persisted by the
engine when a pattern is set explicitly), and generated
`simulation/scenes/titanic/playlists/`. Operator to decide.
