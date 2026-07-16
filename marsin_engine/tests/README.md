# marsin_engine tests

Unit suites are grouped into **domain subdirectories**. Run everything with
`npm test` (from `marsin_engine/`).

## Naming rules (these drive the runner globs — keep them exact)

| Pattern | What it is | How it runs |
|---------|-----------|-------------|
| `*.test.js`, `*.test.mjs` | **Unit / integration suites** (node:test). | Default suite: `npm test`. |
| `*.eval.mjs` | **Eval suites** — slow (>30s), corpus-driven. | `npm run test:eval` only (kept out of the default suite). |
| `hil/*_test.mjs` | **HIL harnesses** — talk to a LIVE engine, mutate state. | `npm run test:hil` (→ `tests/hil/run_hil.mjs`), never the default suite. |
| `helpers/*.mjs` | **Shared test infra** (no `.test.`/`_test` in the name). | Imported by suites; never collected by any runner. |

The default suite runs the safe explicit glob
`node --test "tests/**/*.test.js" "tests/**/*.test.mjs"`. It deliberately matches
only the `.test.{js,mjs}` suffix, so it **includes** the domain subdirs +
`integration/`, and **excludes** the HIL `*_test.mjs` harnesses (which would hang
on / mutate a live engine) and the `*.eval.mjs` suites. Never fall back to bare
directory mode (`node --test tests/`) — on Node v24 that sweeps the HIL
`*_test.mjs` files into the run and hangs.

As a second line of defence, `hil/hil_guard.mjs` (imported by nearly every
harness) makes a harness **inert under `node --test`**: if `NODE_TEST_CONTEXT` is
set it prints a skip line and `exit 0` instead of running.

## Layout

```
tests/
  audio/       audio DSP, tempo/pitch, signals, detection, mic (+ genre eval harness)
  companion/   audio companion app (server, OSC, signal designer)
  timeline/    timeline arbiter, triggers, festival/sun, scheduled tasks
  mixer/       mixer, decks, channels, views, faders, groups, blend, snapshots, params
  effects/     effects_v2, global-effect macros/banks, colour effects, transitions
  state/       persistence, config, settings, boot, atomicity, registries
  playlist/    playlists, autopilot profiles, dance maker
  io/          sACN/ArtNet/DMX output, OSC/WS, MIDI, engine CLI, fixtures
  integration/ corpus-driven analysis validation (node:test, *.test.mjs)
  hil/         HIL harnesses + run_hil.mjs + hil_guard.mjs + hil_client.mjs
  helpers/     spawn_engine.mjs (spawn-engine harness), setup_config_guard.mjs
  *.eval.mjs   slow eval suites (detector_eval) — `npm run test:eval`
```

## Known-environment failures (not code regressions)

On a box with no audio device / a busy loopback, these fail regardless of the
change under test: `audio/audio_capture` (service-runner framing/lifecycle),
`io/osc_listener` (EADDRINUSE/EACCES), `io/led_dmx_parity`. The Node v24 test
runner can also intermittently crash a single file with "Unable to deserialize
cloned data" under the parallel/aggregate runner — that file passes in isolation
(`node --test tests/<dir>/<file>.test.js`); it is a runner IPC bug, not a
failure of the suite.
