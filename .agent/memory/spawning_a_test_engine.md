# Spawning a test engine: `--dest` is NOT a black hole

**Learned 2026-07-31** (`_97` §4.4 incident, seam closed in `_100`).

## The trap

`node engine.js --dest <host>` overrides **`sacn.destinations` only**.

Historically the config could also carry a `controllers:` block that unicast
declared universes **straight to hardware**, ignoring `--dest` entirely — which
put ~30 seconds of live output on the real Titanic rig. **That mechanism is
REMOVED** (operator ruling 2026-08-05): the engine has exactly one output path,
sACN to `sacn.destinations`, and the sim's input bridge is the single router to
every controller. A config that still declares `controllers:` (or a stray
`alsoFlat:` / `protocol:`) makes the engine **refuse to boot** by name —
`marsin_engine/lib/output_config_guard.js`. Never reintroduce it; direct
engine→hardware routes are what made one-writer-per-(universe, controller)
unprovable.

The remaining trap is smaller but still real: `config.sacn.destinations`
defaults to `127.0.0.1` — which is the operator's own sim bridge on UDP 5568,
and the bridge relays onward to the rig. "Loopback" is not "nowhere".

## The black hole must NOT be a loopback address (corrected `_219`)

The repo used to point test engines at `127.0.0.9` and call it black-holed. It
is not. The simulation's sACN receiver binds **`0.0.0.0`**, so it accepts
datagrams addressed to **any** local address — and every address in
`127.0.0.0/8` is local. A frame sent to `127.0.0.9:5568` is received by the
operator's bridge and relayed to the rig exactly like one sent to `127.0.0.1`.
(Same measurement that forced the TEST-NET-1 `BLACK_HOLE_HOST` in
`tests/helpers/companion_isolation.mjs`, report `_173`.)

**Use TEST-NET-1 — the `192.0.2.x` block** (RFC 5737, reserved for
documentation, never routed; the suites all use host `.9`) as the sACN
`--dest` / `sacn.destinations` in every test and harness. A UDP datagram to it
can only be dropped. Every site under
`marsin_engine/tests/` was converted in `_219`; keep new ones on TEST-NET-1 —
never on a `127.x` address.

## What actually works

**`MARSIN_CONFIG_FILE`** is the one seam. Since `_100` it governs the engine's
**boot read** as well as the autopilot write-back, so a harness writes a
black-holed copy of `config.yaml` and points the env var at it:

- `controllers: []`
- `sacn.destinations: [<TEST-NET-1 host — `192.0.2.x`, the suites use `.9`>]`
  — never a `127.x` address
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
