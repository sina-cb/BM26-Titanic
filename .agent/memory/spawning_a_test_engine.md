# Spawning a test engine: `--dest` is NOT a black hole

**Learned 2026-07-31** (`_97` §4.4 incident, seam closed in `_100`).

## The trap

`node engine.js --dest 127.0.0.9` overrides **`sacn.destinations` only**. A
`controllers:` entry in the config carries its **own host** and wins for every
universe it claims (`lib/output_dispatch.js` partitions universes by
declaration before any destination is consulted). An engine spawned with
`--dest` therefore still streams sACN to the declared hardware. This put
~30 seconds of live output on the real Titanic rig.

`config.sacn.destinations` also defaults to `127.0.0.1` — which is the
operator's own sim bridge on UDP 5568. "Loopback" is not "nowhere".

## What actually works

**`MARSIN_CONFIG_FILE`** is the one seam. Since `_100` it governs the engine's
**boot read** as well as the autopilot write-back, so a harness writes a
black-holed copy of `config.yaml` and points the env var at it:

- `controllers: []`
- `sacn.destinations: ['127.0.0.9']`
- `osc.enabled: false`, `web_client.enabled: false`, `audio.enabled: false`,
  `vsn1.deployLayout/deployOnBoot: false`

A set-but-missing/relative value **throws at boot** — no silent fallback to the
real config.

## Assert it, never assume it

Three checks, all cheap, all in
`marsin_engine/tests/e2e/timeline_e2e_harness.mjs` (`assertBlackHoled`) — copy
them into any new engine-spawning harness:

1. every `[sACN Out] Sender started …` line names only the black hole;
2. **no** `[Art-Net Out] Sender started` line exists;
3. `GET /status.outputRouting.controllers` is `[]`.

## Also isolate state

`MARSIN_STATE_DIR` (runtime state), `MARSIN_PLAYLISTS_DIR` (playlists) and
**`MARSIN_TIMELINE_DIR`** (show-plan library, added `_100`) all redirect into
temp dirs. Without the last one, `POST /timeline/plans` / `plan/activate` write
into the operator's tracked `simulation/scenes/**`.

Every suite that spawns an engine must also
`import '../helpers/setup_config_guard.mjs'` — otherwise the deck autopilot
persists into the tracked `marsin_engine/config.yaml`. This has bitten three
threads.

Ports: stay clear of the pinned band 6967-6972 + 5568. The timeline e2e suite
uses random 7700-7899.
