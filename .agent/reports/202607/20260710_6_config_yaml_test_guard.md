# 2026-07-10 — Stop engine tests clobbering marsin_engine/config.yaml

Branch: `feat/led_integration`. No git operations performed (config.yaml
restored via `git show HEAD:… > file`, a read-only export, then re-edited).

## Problem

`lib/color_autopilot.js` and `lib/autopilot.js` (deck) both persist runtime
state with `fs.writeFileSync(CONFIG_FILE, yaml.dump(this.config))` — dumping the
ENTIRE parsed `config.yaml`, which strips every comment and appends the
autopilot state. Any test that spawns the real engine (`node engine.js`) and
activates autopilot rewrote the tracked, comment-bearing `config.yaml` (wiping
the documented `controllers:`/`alsoFlat` routing examples, appending
`colorAutopilot:`). The file was found already clobbered this session.

Note: `color_autopilot.test.js` was NOT the culprit — it already injects a
`tmpCfg()` path. The clobber comes from **spawned-engine** tests hitting the
production wiring `api_server.js:3420` (`new ColorAutopilot(fn, undefined, …)` →
defaults to the real `config.yaml`) and the deck `autopilot.js` (hardcoded
path).

## Fix (one lever, inherited by spawned engines)

- `lib/color_autopilot.js` + `lib/autopilot.js`: resolve the persistence path
  from `process.env.MARSIN_CONFIG_FILE`, falling back to the real `config.yaml`
  when unset (production unchanged).
- `tests/setup_config_guard.mjs` (new): on load, if `MARSIN_CONFIG_FILE` is
  unset, copy `config.yaml` → `os.tmpdir()/bm26_engine_config_test_<pid>.yaml`
  and point the env var at it (best-effort cleanup on exit).
- `package.json` `test`: `node --import ./tests/setup_config_guard.mjs --test
  tests/*.test.js`. The guard runs before any test module; spawned engines
  inherit the env var (spawns use `{ ...process.env }` or default inherit), so
  every autopilot save in the suite lands on the scratch copy.

## Verification

- `tests/config_persistence_guard.test.js` (new, 3 tests, all pass): the guard
  sets a scratch path ≠ config.yaml; a `ColorAutopilot(fn, undefined)` (the
  production wiring) resolves to the scratch path and a `setState` leaves
  `config.yaml` byte-identical; the deck `Autopilot` likewise.
- End-to-end: `node --import ./tests/setup_config_guard.mjs --test
  tests/playlist_api.test.js` (spawns real engines) → 18/18 pass, `config.yaml`
  md5 identical before/after.
- `git diff -- marsin_engine/config.yaml` now shows ONLY the intended `alsoFlat`
  documentation additions — comments preserved, no `colorAutopilot:`.

## Follow-up (out of scope here)

- HIL tests (`tests/hil/*.mjs`, run individually, not via `npm test`) also spawn
  engines; running them clobbers unless `MARSIN_CONFIG_FILE` is set. Either run
  them with the `--import` guard or export `MARSIN_CONFIG_FILE` first. Worth a
  shared HIL harness that sets it.
- Deeper fix (optional): make `saveConfig` persist only its own state to a
  sidecar file so activating autopilot in PRODUCTION also stops stripping the
  operator's config.yaml comments.
