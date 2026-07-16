# HIL (Hardware-in-the-Loop) Tests

End-to-end tests that exercise the **live MarsinEngine** through its REST + WebSocket
API — real WASM compilation, actual blend scripts, live pixel output, no mocks.

HIL harnesses are named `hil_*_test.mjs`. They are **not** part of the default
`npm test` unit suite (that glob matches `*.test.{js,mjs}` and excludes the
`_test.mjs` suffix). Run them with the dispatcher below.

## Infra files (not harnesses)

| File | Role |
|------|------|
| `run_hil.mjs` | Dispatcher: `list` / `run <name>` / `run-all` against a booted engine. Nonzero on first fail. |
| `hil_guard.mjs` | Safety gate: `assertDisposableEngine()` refuses any non-`test_bench` target (exit 2). Also makes harnesses **inert under `node --test`** (prints a skip line + `exit 0` when `NODE_TEST_CONTEXT` is set) so a stray sweep can't hang on a live engine. |
| `hil_client.mjs` | Shared HTTP helpers: `parseHilPort()`, `engineBase()`, `settle()`, canonical `httpJson()` → `{ status, data }`, `makeHttpJson(base)`. Used by the dispatcher; the canonical home for new/migrated harnesses. |

> Note: the harnesses still carry their own drifted `httpJson` copies (two
> incompatible return contracts: 36 resolve `{ status, data }`, 7 resolve the
> parsed body directly). Migrating them onto `hil_client.mjs` must be done
> per-harness and verified against a disposable engine — it is not a blind swap.

## ⚠️ The `test_bench` prerequisite is MANDATORY, and enforced

Most HIL tests **MUTATE** engine state (create playlists, add/patch/delete mixer
channels, write deck overlays + slots, save snapshots, drive the param center).
They connect to whatever engine answers on their port and do **not** spawn an
isolated engine, so they cannot redirect writes via `MARSIN_STATE_DIR`. Point one
at a real scene (e.g. a live `studiodj` on `:6968`) and its writes leak into the
tracked `states/` + `simulation/scenes/` trees — this happened once (a spurious
`hil_autocycle_test` playlist landed in `simulation/scenes/studiodj/playlists/`).

`hil_guard.mjs → assertDisposableEngine(engineBase)` runs as a pre-flight
(`GET /status`) and aborts with a loud `FATAL` + `exit 2` unless
`activeModel === 'test_bench'`. No fallback (codex P0). The only genuinely
read-only harness, `hil_audio_realtime_test.mjs`, does not carry the guard.

## Running

1. Boot a **disposable `test_bench`** engine on a spare port (never a live scene):
   ```bash
   cd marsin_engine
   node engine.js --pattern test_const --model test_bench --port 7180
   ```
2. Drive the harnesses:
   ```bash
   node tests/hil/run_hil.mjs list                    # inventory, no engine needed
   node tests/hil/run_hil.mjs run hil_tap_tempo_test --port 7180
   node tests/hil/run_hil.mjs run-all --port 7180
   npm run test:hil                                   # run-all on the default 6968
   ```
   Port resolves `--port N` → `ENGINE_PORT` → `6968`. Each harness exits `0` on
   pass, `1` on failure; `run-all` stops on the first failure with that code.

Some transition harnesses need the mixer to already hold **≥ 2 overlay channels**
(they use existing overlays and restore their state on exit); start from a mixer
that has them, or run `hil_mixer_overlays_test` first.

## Inventory (all 43 harnesses)

**Class**: `reg` = deterministic regression (headless, reliable against
`test_bench`); `bring-up` = environment-sensitive (needs the audio device,
realtime/latency observation, or manual smoothness judgement).

| Harness | Class | Validates |
|---------|-------|-----------|
| `hil_add_3_channels_test` | reg | Engine never strands a half-added channel; bulk add integrity. |
| `hil_add_button_latency_test` | bring-up | iPad "ADDING…" button latency / responsiveness under load. |
| `hil_audio_reactive_profile_test` | bring-up | `audio_reactive` profile seam end-to-end. |
| `hil_audio_realtime_test` | bring-up | Operator-run realtime / smoothness (read-only; spawns the Audio Companion). |
| `hil_autopilot_profile_test` | reg | Autopilot profile seam (E1). |
| `hil_blackout_estop_test` | reg | Unified GEM blackout / E-stop behavior. |
| `hil_channel_add_default_playlist_test` | reg | iPad "+ default" channel-add path + default playlist wiring. |
| `hil_channel_features_test` | reg | Channel-features wave surface. |
| `hil_channel_isolation_test` | reg | Per-channel parameter isolation (no cross-bleed). |
| `hil_channel_ops_test` | reg | CHANNEL OPS cluster (add/patch/delete/reorder). |
| `hil_concurrent_entry_test` | reg | Concurrency / state-integrity under overlapping entry switches. |
| `hil_deck_overlays_test` | reg | Deck dynamic view overrides / overlays. |
| `hil_deck_playlist_load_test` | reg | Deck PlaylistPanel load path. |
| `hil_deck_playlist_slots_test` | reg | Deck split-playlist slots. |
| `hil_deck_swap_test` | reg | Deck pattern soft-swap (shadow-channel crossfade, EBUSY, autopilot). |
| `hil_deck_swap_warmth_test` | reg | Deck ping-pong handle warmth on repeated swaps. |
| `hil_deck_transition_smoothness_test` | bring-up | Deck transition smoothness (progress monotonicity / brightness). |
| `hil_fader_lock_test` | reg | Slot 5 / fader-lock. |
| `hil_flash_bump_test` | reg | FLASH / BUMP momentary actions (round-2 #5). |
| `hil_follow_link_test` | reg | Channel FOLLOW / LINK (round-2 #6). |
| `hil_gem_swap_remove_bulletproof_test` | reg | Global Effect Macros swap / remove / re-bind bulletproofing. |
| `hil_global_invert_test` | reg | Global color Invert. |
| `hil_groups_solo_test` | reg | Channel groups / gang-faders + solo (wave 15). |
| `hil_hue_shift_test` | reg | Hue Shifter (docs/39 §F-hue). |
| `hil_liveparams_split_test` | reg | sharedParams / liveParams split. |
| `hil_mixer_autocycle_test` | reg | Mixer AUTO-CYCLE (round-2 #2). |
| `hil_mixer_overlays_test` | reg | Mixer overlay channels (adds its own channels first). |
| `hil_mixer_undo_test` | reg | MIXER UNDO (round-2 #10, docs/39 §F-undo). |
| `hil_modulation_test` | bring-up | Dynamic audio modulation end-to-end. |
| `hil_param_preset_test` | reg | Named per-channel param presets (round-2 #9). |
| `hil_playlist_robustness_test` | reg | Playlist load reliability / robustness. |
| `hil_scheduled_tasks_test` | reg | Engine-owned scheduled tasks. |
| `hil_snapshot_morph_test` | reg | Snapshot morph (round-2 #1). |
| `hil_tap_tempo_test` | reg | Per-channel phase-clock TAP-TEMPO. |
| `hil_tempo_arbitration_test` | reg | Tempo arbitration across sources. |
| `hil_transition_pixel_perfect_test` | reg | Every transition type is pixel-perfect through the pipeline. |
| `hil_transition_smoothness_test` | reg | Server-side smoothstep transitions (monotonic, no brightness pump). |
| `hil_transition_test` | reg | Transition symmetry (CH1→CH2 vs CH2→CH1), blend_screen/over, brightness dip. |
| `hil_transition_type_test` | reg | `transitionMode` wiring (crossfade/flash/dissolve/wipe) forwarded + restored. |
| `hil_transition_visual_test` | reg | Pixel-level transition signatures (flash=white, dissolve=binary, wipe=gradient). |
| `hil_view_selection_test` | reg | Mixer view-selection masking. |
| `hil_ws_audio_settle_test` | bring-up | Audio-config settle time over WS. |
| `hil_ws_topic_split_test` | reg | WebSocket topic split routing. |

## Adding a new harness

1. Create `hil_<name>_test.mjs` in this directory.
2. `import { assertDisposableEngine } from './hil_guard.mjs';` and call it after
   the reachability check, before the first mutation. Prefer the shared
   `hil_client.mjs` helpers for HTTP + port parsing + settle.
3. Add a doc header (prerequisites, what it validates) and a row above.
4. It is picked up automatically by `run_hil.mjs` (any `*_test.mjs` here).
