# Effects v2 — engine track (Track E) implementation

- **Project:** `.agent/projects/effects_v2_midi_layout.md`
- **Branch:** `feat/party_integration_20260711` (in place, no git ops)
- **Zone:** `marsin_engine/lib/*`, `marsin_engine/effects/*`, `marsin_engine/tests/*`
  (+ `lib/vsn1_layout_deploy.js` new, `lib/ws_topic_routing.js` +2 types).
- **Date:** 2026-07-09

## Five-line summary

1. **W2a finished + verified** — the 7 party effects were already wired into
   `GLOBAL_EFFECT_LIBRARY` with full controller state/dispatch/panicStop and a
   complete `party_effects_gem.test.js` (77 tests). Reviewed all four Builder-B
   modules against the wiring spec (`20260708_3`): channels, anchors, panic
   policy, params all match — nothing was off, no fixes needed.
2. **32 slots + engine-owned `effectsPage`** — `MAX_SLOTS` 16→32 (IDs 1–32),
   4 pages × 8; page is a pure VIEW (`8p+1..8p+8`), lives in the slot manager,
   served + written via `GET/PATCH /global-effects/page`, carried in status +
   WS broadcasts, and persisted in `global_effect_slots.yaml`.
3. **`primaryMode` registry** — mirrors `primaryIntensity` exactly: each effect
   module declares `{label,param,values,default}` or explicit `null`; a missing
   declaration is a loud boot error. Slots gain a persisted `mode`; endpoints
   `POST …/mode/cycle` + `POST …/mode {value}`; applies LIVE to a running
   effect; surfaced in status (`mode/modeValues/modeLabel/modeIndex`).
4. **Layout model + deploy hook** — the 32-slot assignment (effect id + name +
   color + page) is engine-owned + serializable (`getLayout()`, `GET
   /global-effects/layout`). A layout change emits a `layout-changed` event and
   invokes a **config-gated, mockable** child-process deploy (`node
   tools/vsn1_config/deploy_layout.cjs --layout <file> --live`) — OFF by default
   so the suite never spawns it; value/mode/active changes are NOT layout
   changes (no deploy).
5. **Tests + full suite green** — 30 new unit tests + 11 new API/sync tests;
   full `node --test tests/*.test.js` = **1853 pass / 6 fail**, the 6 being the
   known env fails (`audio_capture` device/ffmpeg, `osc_listener` EADDRINUSE).
   Engine dry-run boots clean (registry validates at load). Security check
   PASS.

## Endpoint / contract table

| Method + route | Purpose | Broadcast |
|---|---|---|
| `GET /global-effects/page` | read engine-owned page VIEW (0–3) | — |
| `PATCH /global-effects/page` `{effectsPage}` | set page; persists; 400 out-of-range | `effectsPage` |
| `POST /global-effect-slots/:id/mode/cycle` | step mode to next value (wraps); live | `globalEffectMacroStatus` |
| `POST /global-effect-slots/:id/mode` `{value}` | set explicit mode; 400 on stranger/no-mode; live | `globalEffectMacroStatus` |
| `GET /global-effects/layout` | serialized 32-slot layout + deploy status | — |
| `GET /global-effect-slots/status` (extended) | now carries `effectsPage` + per-slot `mode/modeValues/modeLabel/modeIndex`/`page`/`color` | — |

Contract pins honoured: slot IDs 1–32; page via `GET/PATCH
/global-effects/page` + WS; mode via `POST …/mode/cycle`; deploy invoked as
`node tools/vsn1_config/deploy_layout.cjs --layout <file> --live` (coded to the
CLI contract only — the real tool is Track T's; deploy is mockable + config-
gated, never spawned in tests).

### New library API (`lib/global_effect_library.js`)
`PRIMARY_MODE_REGISTRY`, `getPrimaryMode`, `modeIndexOf`, `nextModeValue`,
`normalizeModeDescriptor` — parallel to the intensity registry.

### New slot-manager API (`lib/global_effect_slot_manager.js`)
`getEffectsPage`/`setEffectsPage`/`currentPageRange`, `pageSlotRange`/
`pageOfSlot`, `SLOTS_PER_PAGE`/`PAGE_COUNT`/`MIN_PAGE`/`MAX_PAGE`;
`setSlotMode`/`cycleSlotMode`; `getLayout`/`setLayoutChangedHook`;
`setSlots(cfg, {emitLayout})`.

### New deploy module (`lib/vsn1_layout_deploy.js`)
`createLayoutDeployHook({stateDir, engineConfig, spawnFn, broadcast})` →
`{hook, status}`; `isLayoutDeployEnabled(cfg)`. Gate: env
`MARSIN_VSN1_DEPLOY=1` or config `vsn1.deployLayout:true`. Fails LOUD on
non-zero CLI exit (no silent retry). WS type `vsn1LayoutDeploy`.

## Per-effect `primaryMode` map

| Effect | label | param | values | default |
|---|---|---|---|---|
| beatPump | Tempo | `rate` | 0.5, 1, 2 | 1 |
| waterlineSweep | Sync | `sync` | free, beat, bar | free |
| kickPunch | Source | `source` | auto, dropPulse, kick | auto |
| freeze | Hold | `holdFadeMs` | 0, 2000, 5000 | 0 |
| crush | Levels | `levels` | 2, 3, 4, 6, 8 | 4 |
| breath | Period | `periodMs` | 8000, 14000, 20000 | 8000 |
| sparkle | Audio | `audioDensity` | false, true | false |
| colorWash | Blend | `mode` | tint, replace, multiply, max | tint |
| dropHit | Blend | `blendMode` | add, replace, max | add |
| feedbackTrails | Blend | `blendMode` | add, replace, max | add |
| strobe / invert / vintageWhite / blastWhite / uvBlast / fogger | — | — | — | `null` (explicit no-mode) |

## Test tally

| Suite | Tests |
|---|---|
| `effects_v2_mode_page_layout.test.js` (new — registry/page/mode/layout/deploy) | 30 |
| `effects_v2_api.test.js` (new — spawned-engine API + sync surface + WS + persistence) | 11 |
| `party_effects_gem.test.js` (verified) | 77 |
| `global_effect_intensity.test.js` (verified) | 34 |
| `global_effect_macros.test.js` (2 boundary asserts made MAX_SLOTS-relative) | 40 |
| `global_effect_blackout.test.js` (verified) | 10 |
| Effects/GEM focused run total | **217 pass / 0 fail** |
| **Full `tests/*.test.js`** | **1853 pass / 6 fail** (6 = known env: audio device/ffmpeg + OSC EADDRINUSE) |

## Safety

- Live stack untouched: every test uses a random high port + isolated
  `MARSIN_STATE_DIR`/`MARSIN_PLAYLISTS_DIR`. Never bound/killed :6968; no
  restarts (coordinator owns those).
- Deploy hook default OFF → no VSN1 child process ever spawns in the suite.
- No fallbacks: missing `primaryMode` = loud boot error; bad page / stranger
  mode value = 400; deploy failure = loud reject + status flag.

## Notes / handoffs

- The deploy CLI (`tools/vsn1_config/deploy_layout.cjs`) does not exist yet —
  Track T is building it. Track E codes only to the pinned CLI contract; the
  hook writes `vsn1_layout.json` into the scene state dir on every layout
  change so Track T's tool (and the operator) can inspect the current layout.
- `ws_topic_routing.js` gained two CONTROL types (`effectsPage`,
  `vsn1LayoutDeploy`); the routing unit test + HIL split test still pass.
- `state_manager.saveGlobalEffectSlots(slots, effectsPage=0)` is backward
  compatible (page defaults 0 when absent from an old file).
