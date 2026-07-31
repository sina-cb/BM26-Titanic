# 20260725_36 — Same-scene model reload (`POST /scene/reload`) + curator refresh runbook

**Author:** developer (Opus, Phase A slice 3) · **Branch:** `feat/bm_readiness`
**Date:** 2026-07-28 · **Plan:** `_33` §5 step 4 / §6 Phase A step 3
(`dev/engine_same_scene_reload`)

Implements the deliberate same-scene engine refresh path the titanic mapping
campaign needs, plus the ops runbook that hands it to the **curator** agent
safely. Parallel wave: three sibling slices (sId/fId union fix, parity
validator, bench-section sync) — no file of theirs was touched.

---

## 0. TL;DR

`POST /scene/reload {"scene":"<active>"}` restarts the running engine on its
**current** scene through the existing exit-75 `requestSceneSwitch` machinery
— same ports, same argv, one engine. It exists because the on-disk hot
reloader **refuses a pixel-count change** (goes `modelStale`, keeps rendering
the old model), and `POST /scene` with the active scene is a documented no-op.
The old workaround — bouncing to another scene and back (two restarts) — is
retired.

Every guard is a loud refusal with a machine-readable `code`; performance mode
blocks it outright. 18 new tests (11 pure + 7 against a REAL engine on an
OS-assigned free port). Runbook: `.agent/ops/engine_model_refresh.md`.

---

## 1. The contract

**Endpoint:** `POST /scene/reload` · body `{"scene": "<name>"}` (**required**)

**Accepts** only when the named scene **is** the active model, its model file
exists, the switch hook is wired, and performance mode is off:

```json
{ "status": "ok", "scene": "titanic", "restarting": true,
  "activeModel": "titanic", "supervised": true,
  "mode": "supervised-handoff", "modelStale": true, "modelStaleMessage": "…" }
```

The engine acks FIRST (so the caller never sees a dropped connection), then
after 50 ms calls `engineCore.requestSceneSwitch(activeScene)` — unchanged
machinery: graceful shutdown (black frame out, WASM down) → supervisor handoff
file + **exit 75** (`BM26_SUPERVISED=1`, the show config) or detached
self-respawn + exit 75 (standalone). `mode` tells the caller which will
happen, so a runbook knows whether to expect the launcher to bring it back.

**Refuses** (nothing restarts, no state changes):

| Situation | Status | `code` |
|---|---|---|
| performance mode active | 409 | `PERFORMANCE_MODE` |
| `scene` ≠ active model | 409 | `SCENE_MISMATCH` |
| `scene` missing/blank/non-string | 400 | `SCENE_REQUIRED` |
| `scene` contains a path (`../x`, `a/b`) | 400 | `INVALID_SCENE` |
| `models/<scene>.js` missing | 404 | `MODEL_NOT_FOUND` |
| engine has no active model name | 500 | `NO_ACTIVE_MODEL` |
| `requestSceneSwitch` hook absent | 500 | `NO_RELOAD_HOOK` |

Guard **order** is itself pinned by a test: identity (`SCENE_MISMATCH`) is
checked before disk and before the hook, so a caller with the wrong scene
learns the real problem instead of a downstream symptom.

**Why "name the scene" instead of a bare `POST /scene/reload`:** a reload is a
full engine restart. Requiring the caller to state which scene they believe is
live makes the restart deliberate and makes a stale assumption (curator thinks
titanic is up, operator switched to test_bench) a 409 instead of an
unannounced show interruption. There is no "reload whatever is live" form.

**Design choice — one mechanism, not two.** `_33` §5 offered
`{"scene":"x","force":true}` on `/scene` **or** a `/scene/reload` route. I
implemented only the dedicated route: `force` on `/scene` would make one
endpoint mean both "switch" and "restart" and would make an accidental
`force:true` on a mismatched scene ambiguous. `POST /scene` with the active
scene keeps its `restarting:false` no-op and now returns a `hint` naming
`/scene/reload` (discoverability, not a fallback — it still does nothing).

---

## 2. What changed

| File | Change |
|---|---|
| `marsin_engine/lib/api_server.js` | New exported pure seam `sceneReloadDecision({requestedScene, activeScene, modelExists, hasSwitchHook, supervised})` → `{status, body, restart}` (placed with the other decision helpers, e.g. `bootPatternPinDecision`). New `POST /scene/reload` route: `rejectIfPerformanceMode` gate → facts → verdict → ack → deferred `requestSceneSwitch`. `POST /scene` same-scene no-op gained `modelStale` + `hint`. |
| `marsin_engine/engine.js` | Comment only — `requestSceneSwitch` now documents its two callers (cross-scene switch, same-scene reload). No behaviour change. |
| `marsin_engine/tests/state/scene_reload_decision.test.js` | NEW — 11 pure tests: the full guard matrix, guard ordering, both restart modes, "no refusal ever reports `restart:true`". |
| `marsin_engine/tests/state/scene_reload_api.test.js` | NEW — 7 tests against a real spawned engine. |
| `marsin_engine/tests/helpers/spawn_engine.mjs` | Added optional `extraArgs` (additive, defaults `[]`, type-checked) so a suite can pass extra CLI flags — used here for `--dest 127.0.0.9`. |
| `.agent/ops/engine_model_refresh.md` | NEW — the curator/operator runbook. |
| `.agent/context/now.md` | Corrected the stale "restart the launcher after any Save that changes universes" note. |
| `.agent/projects/bm26_show_readiness.md` | R8 row note + Log entry. |

Performance mode uses the **shared** `rejectIfPerformanceMode` gate (identical
409 shape + mixer snap-back as `POST /scene`) rather than being re-modelled
inside the pure function — one implementation of that rule, not two.

---

## 3. Test evidence

**New suites — all green:**

```
node --test tests/state/scene_reload_decision.test.js   → 11/11 pass
node --test tests/state/scene_reload_api.test.js        →  7/7  pass
```

The live suite spawned a real engine, which logged:

```
🌐 Output Server listening on HTTP/WS port 52715
⛔ /scene/reload refused (SCENE_MISMATCH): engine is rendering 'summer_camp_dome' …
⛔ /scene/reload refused (SCENE_REQUIRED): scene (string) required …
⛔ /scene/reload refused (INVALID_SCENE): invalid scene name '../evil'
♻️  Same-scene model reload requested via /scene/reload: 'summer_camp_dome'
   (supervised-handoff, modelStale=false). Restarting engine…
⏹ Stopping…  ✅ Shutdown complete (8 frames rendered)
🔁 Scene switch to 'summer_camp_dome' — handing restart to supervisor (exit 75).
```

Asserted: 200 ack shape, process exit code **75**, handoff file contents
`{"scene":"summer_camp_dome"}`, and — after every refusal — the engine still
answering `/status` on the same model.

**Isolation (operator's live stack never touched):**

- API port is **OS-assigned** (bind `:0`, read it, release it; the run above
  got 52715). The test asserts the assigned port is not one of
  5568/6966-6972 before spawning.
- `--dest 127.0.0.9` black-holes sACN, so no frame can reach the live sim
  bridge on `127.0.0.1:5568`. Scene `summer_camp_dome` patches U2-6 + U20 —
  none of them the U10/U12 pair `config.yaml` routes to the LED controller —
  so no hardware is addressable either.
- `MARSIN_STATE_DIR` / `MARSIN_PLAYLISTS_DIR` into temp dirs; a final test
  asserts no file in the tracked `states/summer_camp_dome/` tree was modified.
- **Orphan-free by construction:** the test engine runs SUPERVISED, so the
  accepted reload writes the handoff and exits 75 **without** self-spawning
  (no launcher present ⇒ nothing respawns). `after()` asserts nothing is
  listening on the test port and fails loudly if anything is.

**Full engine suite:** run before/after — see §6 for the recorded numbers
against the known-8 baseline (`_31`: 2347 tests / 8 fail).

**Not exercised live (stated plainly):** the **standalone** (unsupervised)
self-respawn branch. Exercising it would leave a detached engine holding the
test port, and `/status` exposes no pid to kill it reliably — I judged a
possible orphaned engine on the operator's box a worse outcome than the gap.
That branch is pre-existing `POST /scene` behaviour, entirely unchanged by
this slice; the reload's own decision for it (`restart:true`, `mode:
'standalone-respawn'`) is unit-tested.

---

## 4. Runbook (deliverable 2 of the slice)

`.agent/ops/engine_model_refresh.md` — written for the operator **and** the
curator. Contents: which of the two cases you are in (same pixelCount =
automatic hot reload, do nothing; changed pixelCount = `modelStale`, reload);
step 0 check `/status.modelStale`; step 1 the parity validator gate (sibling
slice — flagged as such, with an explicit "say so in your log" instruction
instead of a silent skip); step 2 the reload call + how to read `mode`; step 3
poll until it is back, and **stop and report** if it is not; step 4 the
first-mapping-save sim-bridge restart is an **operator** action.

Curator hard limits section (mirrors `.agent/roles/curator.md` engine rights):
never a second engine, never free/steal 6966-6972 or 5568, never kill an
engine process directly, never restart during performance mode or work around
the 409, never scene-bounce as a reload substitute, never improvise recovery.
Plus the honest cost note: a reload IS a full restart (output drops for the
shutdown+boot window, deck reboots from saved state) — batch changes, reload
once, never poll-reload.

---

## 5. Cross-slice notes (no files of theirs touched)

- **Parity validator slice (`_33` §4):** the runbook's step 1 calls
  `node simulation/tools/scene_model_parity.cjs <scene>`. If that path or
  invocation differs when it lands, update that one line in
  `.agent/ops/engine_model_refresh.md`.
- **Bench-section sync slice (`_33` §3B):** adding the `TB ` block to titanic
  is a **pixel-count change** (~981 → ~1,147) ⇒ it is exactly the case that
  needs this endpoint. Phase B step 6 should call `/scene/reload` after the
  validator is green.
- **sId/fId union fix slice:** no interaction; reload rebuilds sections from
  whatever the model says.
- **CaptainPad / sim:** neither calls `/scene/reload` yet. Wiring a "reload
  model" affordance into the sim's Save flow was deliberately NOT done — the
  plan wants the refresh deliberate and operator/curator-initiated, and
  auto-reloading on every autosave would restart the engine repeatedly.
  Worth a Notion backlog card if the operator wants a button.

**Suggested follow-up (not in this slice):** `tests/mixer/performance_mode.test.js`
spawns its engine with `portBase: 6960, portSpan: 30` — a range that overlaps
the show ports 6966-6972, so an unlucky roll can collide with the operator's
live stack. My suite uses an OS-assigned port instead; that older suite should
be moved to the same approach.

---

## 6. Suite numbers

| Suite | Result |
|---|---|
| `tests/state/scene_reload_decision.test.js` | 11 tests, **11 pass** |
| `tests/state/scene_reload_api.test.js` | 7 tests, **7 pass** |
| `marsin_engine` `npm test` (full) | **2373 tests, 2365 pass, 8 fail** — the known-8 baseline, unchanged (`_31`: 8 fail) |

The 8 failures are the documented environment/known set, **none in files this
slice touches**: 5 in `audio/audio_capture` (service-runner framing/lifecycle
— no audio device), `io/osc_listener` `EADDRINUSE`,
`effects/effects_v2_mode_page_layout`, and the playlist
"both scenes carry byte-identical copies" parity assertion. Both new suites
ran green inside the aggregate run (verified by name in the output, not just
in isolation).

---

## 7. Honesty notes

- I did not run the sim, did not touch the operator's live stack, ran no git
  command, and started no engine on a show port.
- The standalone self-respawn branch is untested live (§3).
- `POST /scene/reload` does not itself validate the model against the scene —
  the validator is the sibling slice's deliverable and the runbook's step 1.
  The endpoint deliberately refuses a **missing** model but will happily
  restart onto a model that is present and wrong; that gate is procedural
  until the validator lands and is wired into the ops auto-checks.
- **State residue is not mine.** `marsin_engine/states/test_bench/*` shows
  writes timestamped before any engine I started, while a concurrent
  `tools/param_truth/sweep_all.mjs --workers 12 --cross-model test_bench` (a
  parallel agent) was running. My spawned engine used `summer_camp_dome` with
  `MARSIN_STATE_DIR`/`MARSIN_PLAYLISTS_DIR` redirected to temp dirs, and a
  test asserts its tracked state dir was not modified. Nothing was reverted
  (AGENTS.md: report residue, never silently revert).
- The engine's own `requestSceneSwitch` still returns silently (after a
  `console.error`) when the model file vanishes between the API check and the
  restart. Pre-existing, and the API's 404 covers the realistic case; I left
  it alone to keep the diff to the slice.
