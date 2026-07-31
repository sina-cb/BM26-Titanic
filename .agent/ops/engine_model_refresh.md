# Engine model refresh — applying a re-exported scene model to the RUNNING engine

**Who this is for:** the operator, and the **curator** agent
(`.agent/roles/curator.md` — engine-drive rights: may drive and restart the
ONE engine on `:6968`, may never launch a second one or free a show port).

**What it covers:** a scene's model was re-exported (`marsin_engine/models/
<scene>.js`) and the running engine must pick it up — without tearing the
stack down, without a second engine, and without an out-of-band kill.

Background + design: report `_33` §5 and `_36`.

---

## The two cases (know which one you are in BEFORE touching anything)

The engine watches its model file on disk. What happens on a re-export
depends on **whether the pixel count changed**:

| Case | What the engine does | What you do |
|---|---|---|
| **Same `pixelCount`** (addresses, universes, sections, views changed) | **Hot-reloads in place, automatically.** Rebuilds masks/sections/views and registers new universes on the fly. | Nothing. Verify only. |
| **`pixelCount` CHANGED** (fixtures/strands added or removed) | **REFUSES the reload** and keeps rendering the OLD model. Sets `modelSync.stale` → `GET /status.modelStale: true`. | `POST /scene/reload` (below). |

The render loop and the WASM buffers are sized once at boot, so a pixel-count
change genuinely cannot be swapped in-process. That refusal is correct
behaviour, not a bug — it is why a deliberate restart exists.

> Stale note corrected (2026-07-28): "restart after any Save that changes
> universes" is **wrong**. Universe changes hot-reload fine (G10 fix,
> `output_dispatch.js` create-sender-on-demand). The real restart trigger is a
> **pixel-count change**.

---

## Step 0 — check the model actually needs applying

```bash
curl -s http://127.0.0.1:6968/status | jq '{activeModel, modelStale, modelStaleMessage}'
```

- `modelStale: false` → the running engine is already on the current model.
  **Stop. Do not restart anything.**
- `modelStale: true` → the engine refused a re-export; `modelStaleMessage`
  says why. Continue.

## Step 1 — gate: validate the scene against the model

Run the scene↔model parity validator before applying anything (it is the
acceptance gate — a red validator means the model on disk is wrong, and
restarting would only make the engine render the wrong thing faster):

```bash
node simulation/tools/scene_model_parity.cjs <scene>
```

Red = STOP, fix the scene, re-save/re-export, validate again. Nothing has
touched the engine at this point.

> The validator is delivered by the parity-validator slice (`_33` §4). Until
> it lands, treat this step as "the person who re-exported confirms the export
> completed without errors" and say so in your log — do not skip it silently.

## Step 2 — apply: the same-scene reload

```bash
curl -s -X POST http://127.0.0.1:6968/scene/reload \
  -H 'Content-Type: application/json' \
  -d '{"scene":"titanic"}'
```

`scene` is **required** and must equal the engine's `activeModel`. Naming it
is the whole point: the reload is deliberate, never implicit.

Success (HTTP 200):

```json
{ "status": "ok", "scene": "titanic", "restarting": true,
  "activeModel": "titanic", "supervised": true,
  "mode": "supervised-handoff", "modelStale": true, "modelStaleMessage": "…" }
```

What happens next depends on `mode`:

- `supervised-handoff` (`BM26_SUPERVISED=1`, the show configuration): the
  engine shuts down gracefully, writes the target scene to its handoff file,
  and exits **75** (`EX_TEMPFAIL` = intentional restart). **The launcher
  respawns it** on the same ports with the same argv.
- `standalone-respawn` (engine started by hand): the engine spawns its own
  detached replacement on the same ports, then exits 75.

Either way: **same ports, same argv, one engine.** No port is freed by any
other means, and no second engine is ever started.

## Step 3 — confirm it came back

Poll `/status` until it answers again (the launcher allows up to 120 s;
in practice it is a few seconds):

```bash
until curl -sf http://127.0.0.1:6968/status > /dev/null; do sleep 1; done
curl -s http://127.0.0.1:6968/status | jq '{activeModel, modelStale, activePattern}'
```

Expected: `activeModel` = your scene, `modelStale: false`.

Also worth confirming after a mapping change:
`GET /model/view-selection-options` lists the fresh groups/views.

**If the engine does not come back:** STOP and report to the operator. Do not
improvise recovery, do not start a replacement engine by hand.

## Step 4 — sim bridge, first mapping save only

The sim's sACN-**in** bridge builds its universe subscription set **at boot**.
The first time a scene gains brand-new universes, the bridge drops frames on
them until the sim stack is restarted once. That is the **operator's** live
stack — ask him; never restart it yourself.

---

## What `/scene/reload` REFUSES (every refusal is loud, with a `code`)

| Situation | Status | `code` | Meaning |
|---|---|---|---|
| Performance mode is active | 409 | `PERFORMANCE_MODE` | A live show is never restarted. Exit performance mode first — deliberately, with the operator. |
| `scene` names something other than the active model | 409 | `SCENE_MISMATCH` | This endpoint only restarts the ACTIVE scene. Switching scenes is `POST /scene`. |
| `scene` missing / blank / not a string | 400 | `SCENE_REQUIRED` | You must name what you intend to reload. There is no "reload whatever is live". |
| `scene` contains a path (`../x`, `a/b`) | 400 | `INVALID_SCENE` | Model files are flat under `marsin_engine/models/`. |
| `models/<scene>.js` is missing | 404 | `MODEL_NOT_FOUND` | Export the model from the sim first. |
| Engine has no active model name | 500 | `NO_ACTIVE_MODEL` | Broken boot — report it. |
| `requestSceneSwitch` hook not wired | 500 | `NO_RELOAD_HOOK` | Broken build — report it. |

A refusal never restarts the engine, never changes a byte of state, and never
falls back to "something close enough" (codex P0).

`POST /scene` with the **active** scene remains a no-op (`restarting: false`)
and now returns a `hint` pointing here — it will not silently restart the
engine for you.

---

## Curator rules for this runbook (hard limits)

**You MAY:**

- Run steps 0-3 against the ONE engine on `:6968`, when your workflow needs
  the re-exported model applied.
- Log what you did (endpoint, response, `/status` after) in
  `~/tmp/codex_patterns_log.md`.

**You MUST NEVER:**

- Start a second engine, on any port, for any reason — including "just to test
  the reload".
- Free, steal, or re-bind ports 6966-6972 or 5568, or kill an engine process
  directly (`taskkill`, `kill`, Ctrl-C on the operator's window). The ONLY
  sanctioned restart is `POST /scene/reload` / `POST /scene`.
- Restart while performance mode is active, or work around the 409 by exiting
  performance mode yourself — that is an operator decision during a show.
- Restart the sim stack, the companion, or the operator's Metro instance
  (step 4 is an operator action).
- Use `POST /scene` to bounce scenes (switch away and back) as a substitute
  for `/scene/reload` — that is two restarts and drops the show twice. The
  bounce workaround is retired.
- Improvise recovery if the engine does not return. STOP and report.

**Reload is cheap but not free:** it is a full engine restart — output drops
for the shutdown+boot window and the deck reboots from saved state. Batch your
model changes and reload once; never poll-reload in a loop.

---

## Tests that pin this contract

- `marsin_engine/tests/state/scene_reload_decision.test.js` — the pure guard
  matrix (every refusal, every code, guard ordering).
- `marsin_engine/tests/state/scene_reload_api.test.js` — a real engine on an
  OS-assigned free port: refusals leave it running, performance mode blocks
  it, an accepted reload acks then exits 75 with the same-scene handoff.

Both run in the default engine suite (`cd marsin_engine && npm test`).
