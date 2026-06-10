# Group Fixed Colors — implementation finish + full-stack verification

- **Date:** 2026-06-10
- **Branch:** `feature/group-fixed-colors` (worktree
  `.claude/worktrees/agent-a07d38529bc885992`, based on origin/main @ e1db156)
- **Design doc:** `docs/32_group_fixed_colors.md`
- **Operator request:** productionize the summer-camp `djLights` hack
  (branch `summer_camp_after/logsville`) into a real feature: lock arbitrary
  fixture groups to operator-chosen fixed colors + brightness from the
  CaptainPad Dimmer Rack, applied at ONE clean point in the engine pipeline.

## What landed

A previous session left the engine side complete and the CaptainPad side
half-done (editor modal written but never rendered, no chip strip). This
session finished and verified it:

- **Engine (previous session, reviewed + verified here):**
  - `marsin_engine/effects/group_fixed_color.js` — stateless O(pixels)
    repaint helper (state lives in `GlobalEffectsController.groupFixedColors`,
    mirroring the colorWash/feedbackTrails split).
  - Single pipeline call site in `engine.js::createRenderLoop()`: after
    `applyMacros()` (a locked group cannot be repainted by wash/trails/
    strobe), before `IntensityController.apply()` (section dimmers and
    GLOBAL BLACKOUT keep the final say — fixes the hack's post-intensity
    safety bug). The hack's duplicated apply site does not exist here.
  - REST: `GET /group-fixed-colors`, `PUT/DELETE /group-fixed-colors/:group`
    (URL-encoded names). Unknown group / bad color / bad brightness → 400
    with a human-readable message (codex P0, no silent no-ops). Mutations
    broadcast `{type:'groupFixedColors'}` on `/ws/control` and persist to
    `states/<model>/globals_state.yaml` next to the dimmers; boot restore
    goes through the validating setter.
  - No GEM slot, not cleared by `panicStop()` — rig state like the dimmers.
- **CaptainPad (finished this session):**
  - `app/(tabs)/dimmer_rack.tsx`: FIXED COLORS chip strip between the bypass
    checkboxes and the fader card — one chip per model group, active chips
    show a swatch dot in the locked color; tap opens the (pre-existing)
    editor modal; live updates via the `groupFixedColors` WS event plus a
    refetch on modal close (engine truth both ways, no optimistic state).
  - Removed the now-unused `setGlobalBlackout` import (the only lint
    warning in touched files).

## Test evidence

All on this worktree, default stack ports (all were free; multi-agent slot
ports not needed).

| Check | Result |
| --- | --- |
| `node --test tests/group_fixed_colors.test.js` (13 tests: validation, defensive copies, pixel math, macro-vs-lock ordering, blackout-wins, dimmer trim, panicStop survival, getStatus clone, persistence restore, WS routing) | PASS 13/13 |
| Full engine suite `node --test 'tests/*.test.js'` | 505/506 pass — the 1 failure (`audio_config.test.js` "AUDIO_LIVE_FIELDS is the contract surface", missing `kickEma`) is **pre-existing on origin/main**, untouched by this branch (task 009) |
| Engine auto-checks (`.agent/00_gol/05`): `git diff --check`, `node --check` on all changed files, `node engine.js --list`, `node engine.js --pattern test_const --model test_bench --dry-run` | PASS (dry run exit 0, no missing-blend warnings) |
| CaptainPad auto-checks (`.agent/00_gol/03`): `npx tsc --noEmit` | 2 pre-existing errors in `components/Modulation.tsx` (`transitionDuration` not in ViewStyle), **present on origin/main**, file untouched here (task 008). Zero errors in branch-touched files |
| CaptainPad `npm run lint` | exit 0; 15 pre-existing warnings repo-wide, none in touched files |
| CaptainPad `npm run web:build` | PASS (`Exported: dist`) |

### Full-stack smoke (skill 05) — test_bench scene/model

Startup order sim → engine for the first pass; see "sACN UDP contention"
below for why the passing run used engine → sim. CLI:
`node engine.js --model test_bench --pattern 01_cylon_sweep`.

| Link | Evidence |
| --- | --- |
| Sim up | HTTP 200 on :6969 |
| Engine up | `/status` 200, `Reachable on :6968` |
| Engine → sim sACN | `.agent_renders/1781110099_current.png` — sACN IN monitor **Connected, FPS 80, FRAMES 1,294 growing, universes [1,2], priority 100** |
| API behaves per docs/32 §2.4 | unknown group → 400; brightness 1.5 → 400; 3-element color → 400; valid PUT → 200 + override echoed; persisted into `states/test_bench/globals_state.yaml` |
| Lock vs pattern (numeric, strongest) | 50 consecutive `/ws/viz` rig frames (~10 s): ParLights 28 / VintageLights 40 distinct frame signatures (**animating**), BarLights **1** signature, byte-constant `[255,0,102]` = hot pink × brightness 1 |
| Blackout wins end-to-end | `POST /global-blackout {state:true}` → rig BarLights `[0,0,0]`; restored after |
| Dimmer trim end-to-end | persisted section dimmers ~0.098 scaled the lock to `[25,0,10]`; raising section 3 to 1.0 gave `[255,0,102]` — rack fader is the master trim on the lock's artistic level, as designed |
| Lock vs pattern (visual) | `1781110841_current.png` vs `1781110953_current.png` — wash/bulbs change (teal → green phases of the cylon sweep), bar strip + ground pool hot pink in both |
| CaptainPad built + connected | `captainpad_home.png` — header `● CONNECTED`, BPM 128, playlist on `01_cylon_sweep`, live deck strip |
| Dimmer Rack UI | `captainpad_dimmer_rack.png` — FIXED COLORS strip, BAR LIGHTS chip active (pink dot + pink border), PAR/VINTAGE ghosted |
| Editor modal through real UI | `captainpad_modal_green.png` — modal open, hue slider dragged to 119° (green), live preview swatch; `captainpad_after_apply.png` — after APPLY the chip dot is green via the engine's WS broadcast |
| UI → engine → sACN → sim | engine table shows `BarLights {color:[0.02,1,0,…], brightness:1}`; `test_bench_green_lock_clean.png` — bar strip + ground pool green in the sim |

All PNGs are in `.agent_renders/` (gitignored) and were visually inspected.

## Environment finding: sACN UDP :5568 contention on localhost smokes

The first smoke pass showed the sACN IN monitor `Connected` but FPS/FRAMES
stuck at 0. Root cause: **three parties bind UDP `*:5568` with
`reuseAddr`** — the sim bridge's Receiver, the sim bridge's *outbound relay*
Senders (created per `patches.yaml` `controllerIp` route), and the engine's
own Senders (`sacn` npm package binds the send socket when
`reuseAddr: true`). On Linux, inbound unicast to 127.0.0.1:5568 is delivered
to only one of them — whichever bound last — so the relay senders (recreated
on every browser `setScene`) silently starve the receiver.

Smoke workaround used here (both reverted afterwards, dirty-tree clean):
start engine before sim so the receiver binds last, and temporarily point
`simulation/scenes/test_bench/patches.yaml` `controllerIp` at `127.0.0.1`
(the bridge explicitly skips relay routes for localhost). Also temporarily
flipped `agent_render.cjs` `SIM_URL` to `scene=test_bench` for the captures
(skill 00 documents this); restored by hand. Filed as task 010 — this will
bite every local full-stack validation until the relay senders stop binding
:5568.

## Working-tree residue (NOT committed, NOT reverted — operator decides)

Engine runtime residue from the smoke, per skill 05 §7:

- `marsin_engine/models/test_bench.{js,effects.js}` — hot-regenerated by the
  engine when sim browser sessions saved the scene.
- `marsin_engine/states/test_bench/{deck_state,globals_state}.yaml` —
  includes the smoke's own feature state (BarLights green lock, dimmers
  raised to 1.0) and deck cursor movement.
- `marsin_engine/states/summer_camp_dome/{deck,mixer}_state.yaml` and
  `simulation/scenes/summer_camp_dome/playlists/*` (3 files deleted,
  1 modified) — written by `node engine.js --list` / `--dry-run` booting the
  default model during the engine auto-checks. The playlist deletions look
  more destructive than usual residue; flagging them explicitly.
- `marsin_engine/states/titanic/audio_state.yaml` and untracked
  `simulation/scenes/titanic/playlists/` — from the brief titanic engine run
  before switching to test_bench.

## Known gaps / follow-ups (filed in `.agent/04_task_tracker/`)

- **008 (important):** pre-existing `tsc` errors in
  `CaptainPad/components/Modulation.tsx` block the "tsc exit 0" merge gate
  repo-wide.
- **009 (normal):** pre-existing engine unit-test failure
  `audio_config.test.js` (AUDIO_LIVE_FIELDS missing `kickEma`).
- **010 (important):** sACN :5568 bind contention breaks localhost
  engine→sim smokes (details above).
- The Dimmer Rack hue picker is hue-only (house picker policy); W/A/U
  channels are reachable via the API but not the UI — intentional per
  docs/32 §2.6.

## Operator action requested

Ready for review and merge of `feature/group-fixed-colors` (pushed). Please
also decide what to do with the runtime residue listed above.
