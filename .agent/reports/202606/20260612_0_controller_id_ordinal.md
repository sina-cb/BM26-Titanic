# Slot 0 — controller_id_ordinal

- **Branch:** dev/claude/controller_id_ordinal
- **Parent branch:** claude/nice-cerf-bl2jnk
- **Worktree:** /home/user/BM26-Titanic-worktrees/controller_id_ordinal
- **Slot ports:** sim HTTP 31069, save 31070, sACN bridge 31071, sACN out 31072
  (engine/Metro not used)

## Scope

Operator report 2026-06-12: the projected `controllerId` on fixture cards /
`patches.yaml` / the exported engine model was the registry's internal stable
id (monotonic, never reused), so after add/delete churn the operator saw
"arbitrary" ids like 3, 5, 7. Per docs/33 **decision 20** (added by this
slice), the projected `controllerId` is now the controller's **1-based
ordinal position in the Controller Mapping panel list**
(`registry.controllers` array order); unmapped fixtures stay `0`; effects
pins carry the ordinal of their cabled controller. Deleting or reordering
controllers renumbers projected ids on the next projection — explicitly the
operator's intent. The stable internal `controller.id` is untouched and keeps
keying `portLayouts`, violations, `universeMaps` claims, panel collapse
state, and chain ownership.

Implementation: `computeProjection()` builds an ordinal map
(`Map<controller, index+1>` over `registry.controllers`) and both
`fields.set(...)` sites (normal pinned entries, effects pins) write the
ordinal instead of `controller.id`. The hard-unpatched state (`''/0/0`,
`controllerId: 0`) is unchanged. No downstream change was needed: `main.js`
(`__globalPatchTree` sync), `save-server.js` (`patches.yaml`),
`gui_builder.js` (metadata panels + `refreshMetadataPanels`), and
`pixelblaze_model_exporter.js` (`cId`) all read the projected config field
and never assume `controllerId === registry id`. The legacy
`auto_patcher.js` `assignMetadata` IP-heuristic has no callers and is slated
for deletion (docs/33 phase 4). CaptainPad: no changes needed.

## Files changed

`git diff --name-status claude/nice-cerf-bl2jnk..HEAD` (this slice's commits):

```text
M  docs/33_controller_mapping.md
M  simulation/src/dmx/controller_registry.js
M  simulation/tests/controller_registry.test.js
A  .agent/02_reports/202606/20260612_0_controller_id_ordinal.md
```

(The worktree also carries inherited parent-branch commits `460c27f`,
`a7c2e39`, `de5f02c` from branch creation.)

## Tests run

- **Unit:** `cd simulation && npm test` — 62/62 pass. Updated the
  `projectOntoConfigs` derived-fields test (stable id 7 now projects
  ordinal 1) and added a regression test: three controllers (stable ids
  1/2/3), delete the middle one, reproject → remaining fixtures project
  controllerId 1 and 2 (effects pin included), stable ids never renumber.
- **Auto-checks (spec 04):** `git diff --check -- simulation` pass;
  `node --check` on both changed JS files pass.
- **Sim smoke (real UI, required by 13_multi_agent §6):** booted the sim in
  this worktree on slot-0 ports (config.yaml edited locally, reverted before
  commit), scene `test_bench` with a temporarily churned
  `controllers.yaml` (two controllers, stable ids 3 and 7 — reverted after
  the run). Puppeteer under `xvfb-run` (agent_render.cjs launch flags,
  1280x720): `window.__globalPatchTree` showed every mapped fixture with the
  ordinal (`Par 1–4`, both effects → 1; `Bar Left/Right`,
  `Vintage Left/Right` → 2 — never 3/7), all unmapped fixtures → 0, and the
  `Bar Left` fixture-card metadata panel `Ctrl:` input read `2` after
  clicking the folders open. Screenshot visually inspected
  (`~/tmp/smoke_ordinal_card.png`). Remaining console errors were
  connection-refused to the (deliberately not running) engine :6968 and the
  sACN OUT monitor — environmental, not caused by this change.
- **CaptainPad:** not touched, not run.

## Known gaps / follow-ups

- Existing scenes' `patches.yaml` files still carry stable-id
  `controllerId` values on disk; they self-correct (logged as drift) on the
  first projection after boot and persist with the next save. No migration
  needed.
- `marsin_engine/models/*.js` regenerate with ordinal `cId` values the next
  time models are exported; not regenerated here (no scene/model change in
  this slice).
- The sim front-end hardcodes the engine status check to port 6968
  (`main.js`) and the sACN OUT monitor label to 6972 (`index.html`) — noise
  in per-slot smoke runs; pre-existing, out of scope.

## Operator action requested

Ready for review and merge.
