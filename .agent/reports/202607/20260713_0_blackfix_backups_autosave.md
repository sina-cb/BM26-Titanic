# 2026-07-13 — studiodj black-pixel fix, scene backups, engine auto-save

Coordinator session (Fable planners → Opus implementers). Branch:
`feat/party_integration_20260711`. Nothing committed (operator-gated).

## 1. studiodj black pixels — FIXED + proven

- **Root cause:** `simulation/scenes/studiodj/scene_config.yaml` was saved
  with `simBrightness: value: 0`. That param multiplies every preview
  pixel's RGB (`src/core/sim_preview.js` → `animate.js:470` and fixture
  runtimes), so the whole scene rendered black while sACN-in was healthy.
  Not the fogger — `TEFogMachine` is a known 1-channel fixture with no
  renderable pixels.
- **Fix:** `simBrightness` 0 → 0.4 (matches parent `studio`). No restart
  needed; verified via `agent_render.cjs` — before black, two after-frames
  showing the cylon sweep animating, zero console errors
  (`.agent_renders/1783960836/1783961174/1783961219_current.png`).
- **Hazard flagged to operator:** any browser tab opened pre-fix holds
  `simBrightness 0` dirty in memory and can re-save it. Reload tabs /
  drag the slider to 0.4. (Now recoverable via the new backups anyway.)

## 2. Scene save backups + ⟲ Recover UI — LANDED

- Every `POST /save | /save-cameras | /save-model` on the :6970 save server
  first snapshots the current on-disk files to gitignored
  `simulation/.scene_backups/<scene>/<YYYYMMDD_HHMMSS_mmm>/` (+manifest).
  Snapshot failure aborts the save with 500 (fail loud). 10 s burst
  coalescing (model-export triple → one snapshot); retention: newest 20
  per scene.
- New module `simulation/server/scene_backup.cjs` (owns the shared
  `writeFileAtomic`); endpoints `GET /backups?scene=X`,
  `POST /restore-backup?scene=X {id}` (restore snapshots current state
  first as `pre-restore`; strict scene/id validation, reject-don't-sanitize).
- UI: `⟲` button in the HUD top bar (`#scene-recover-btn`, between ⧉ and 🗑),
  `src/gui/scene_recovery.js` + shared list modal in `scene_manager.js`;
  empty state 'No backups yet for "<scene>"'. Recovery disarms the pending
  autosave debounce/beacon (`window.disarmUnloadGuard`) before restoring —
  otherwise unload would re-save the bad state over the recovery.
- Verified live: corrupt→recover round trip md5-matched originals;
  sim tests 281/281; security check PASS. Screenshots:
  `.agent_renders/recover_a_buttons.png`, `recover_b_list.png`,
  `recover_c_empty.png`. Sim stack restarted and left healthy.
- Note: restored `marsin_engine/models/<scene>.js` reaches a running engine
  only on its next model load/restart (no engine-poking by design).

## 3. Deck tuning loss + engine auto-save — FIXED + LANDED

- **Root cause of the party tuning loss:** deck param writes DID persist to
  `deck_state.yaml`, but `loadPlaylistEntry()` wipes `localControls` on
  every pattern switch, and the auto-capture into playlist entry `defaults`
  was removed in c513108 (2026-07-08 mixer channel-isolation ruling) — deck
  capture was collateral; `/deck/playlist/capture` had no UI caller. Every
  manual/autopilot switch discarded that pattern's tuning.
- **Fix:** deck-only, autoSave-gated capture-on-entry-switch at the top of
  `loadPlaylistEntry` (outgoing entry, only if params were touched);
  mixer/overlay channels never auto-capture (ruling preserved).
- **New `autoSave` setting** (default TRUE) in new per-scene
  `settings_state.yaml` (persists even when saving is off; malformed →
  fails safe to TRUE). Single choke gate on `saveAllState()` + a
  `saveGlobals()` helper over all globals-save sites. OFF = zero automatic
  state writes; explicit content-authoring paths (playlist CRUD, captures,
  snapshots, presets) unchanged. `GET/POST /settings`,
  `POST /settings/save-now` (checkpoint while OFF), WS `engineSettings`
  broadcast + connect snapshot.
- **Mixer params NEVER saved:** `saveMixerState()` strips overlay
  `localControls` unconditionally; boot skips replay for mixer role.
- **CaptainPad:** AUTO-SAVE toggle card on `/config`
  (`engine_settings_logic.ts` + `EngineSettingsCard`), optimistic toggle,
  WS reconcile, error row on fetch failure.
- **Tests:** engine 1925/1935 (10 failures pre-existing/env:
  audio_capture×5, osc_listener×1, effects_v2_mode_page_layout×3 VSN1
  deploy-count, 1 flaky-under-load timeline test that passes alone);
  CaptainPad 639/639 + tsc clean. Restart-survival proven on isolated
  engines (0.123 survives SIGTERM+respawn; OFF reverts as specified).
  Screenshots: `.agent_renders/captainpad_config_autosave_on/off.png`.
- Engine restarted on :6968 (studiodj) and left healthy; CaptainPad web on
  :6967.

## 4. Deck UI follow-up wave (same day) — LANDED

- **Pattern-list scroll jump FIXED:** tapping a pattern no longer scrolls
  back to the blue MIDI pad window. Causes: `PlaylistPanel.tsx` window
  effect re-fired on every `playlist` object refresh (scrolling to the
  stale window), and the MIDI `windowCursor` never followed the active
  entry. Now `syncWindowsToActiveEntries()` (utils/midi/manager.ts) recenters
  the window around any active-entry change via pure
  `recenterWindowStart()` (window_slot.ts; clamped ends, short playlists),
  keeping pads/LEDs and UI in agreement; scroll decisions go through pure
  `pattern_scroll_logic.ts` — user taps never scroll, external changes
  (pads/autopilot) scroll only if the row is off-screen.
- **Green "✓ SAVED" badge RESTORED:** badge only listened for
  `playlistEntryCaptured`, whose per-tweak emitter was retired in the
  2026-07-07 isolation ruling. Engine now broadcasts
  `{type:'deckParamsSaved'}` from the three deck param-write paths — ONLY
  when `autoSave` is on (no false "saved" when OFF); registered in
  `ws_topic_routing.js`; badge fires via `deck_saved_logic.ts`.
- Tests: CaptainPad 666/666 (+27 new) + tsc clean; engine autosave_gating
  7/7 (+2 WS tests), routing/isolation/autocapture 20/20. Screenshots:
  `.agent_renders/cp_window_before_tap.png`, `cp_window_after_tap.png`
  (windowMoved/surroundsTapped/noJump all asserted true),
  `cp_deck_saved_flash.png`. Residue: deck active entry left at
  `06_neon_elevator` from proof taps; states/studiodj runtime files.

## 5. Later same day — APC window desync + PERFORMANCE MODE (operator-authorized)

- **APC pad↔UI window desync FIXED** (regression from the same-day
  auto-follow): `syncWindowsToActiveEntries` tracked the active entry by
  INDEX; playlist-refresh flicker (`findIndex` transiently -1) read as an
  entry change and recentered the window mid-browse, so pads no longer
  matched the blue highlight when pressed. Fix in `utils/midi/manager.ts`:
  ID-keyed baseline, unresolved entries ignored (hold window, keep
  baseline), `handleScroll` seeds the baseline. Invariant: pads ≡ the six
  blue-highlighted entries at all times; genuine entry changes still
  recenter. New `window_sync_regression.test.ts` (6 tests, fake-APC
  transport, red-before/green-after). CaptainPad 672/672.
- **PERFORMANCE MODE IMPLEMENTED** (operator gave the go; defaults from the
  analysis): in-memory `performanceMode` + `effectiveAutoSave()` composed
  into the 4 save choke points (auto-save force-suspended, ✓ SAVED badge
  honest); pre-show snapshot on entry (SnapshotManager grew an additive
  `globals` field; snapshot-fail aborts entry); 39 gates (36 routes + 3
  viewSelection field-level) return 409 `PERFORMANCE_MODE` + mixer
  snap-back; safety paths (blackout/panic) and all runtime/selection routes
  never gated; timeline/scheduled CRUD ungated per allowed-but-ephemeral
  ruling; reserved snapshot name `performance-preshow`. Exit = KEEP
  (force-persist once, even with stored autoSave OFF) or RESTORE
  (panicStop → recallLook → applyGlobalsState → force-persist); crash =
  implicit restore (mode not persisted; boot deletes stale snapshot).
  Tempo deliberately not restored. `GET/POST /performance-mode`, /status
  field, WS `performanceMode` broadcast + connect replay (+ ws_topic_routing
  registration — plan omission caught by implementer).
  CaptainPad: shared `PerformanceModeControl` + `usePerformanceMode`
  module-cache hook mounted in BOTH deck (`DeckTopBar`) and mixer headers
  (single source of truth); ConfirmSheet to enter, ExitPerformanceSheet
  KEEP/RESTORE/CANCEL; SnapshotBar + playlist-add buttons greyed; MIDI
  dispatch quiets PERFORMANCE_MODE 409s (🔒 status, no fail-streak).
  `setActivePattern` also made fail-loud (pre-existing ok:true-on-error gap).
- Tests: engine 1936/1945 (9 = known env fails), incl. new
  `performance_mode.test.js` (10: gating matrices, effective-save,
  KEEP/RESTORE round-trips, SIGKILL crash-restart, fail-loud 400s);
  CaptainPad 686/686 + tsc. Live curl smoke green; screenshots
  `.agent_renders/pm_a..pm_h`. Security check: my files zero findings;
  **3 pre-existing MAC-address findings in
  `simulation/scenes/**/controllers.yaml` will block a commit** — resolve
  before the operator-gated commit.

## 6. Performance mode follow-up wave — comprehensive UI lock + APC SOLO + red EDIT

- **All 39 gates mapped to deck/mixer UI and greyed** (opacity/disabled
  idiom; engine 409 remains enforcement): mixer add/reorder/delete/view
  pills, overlay add/reorder/delete/view, playlist editors + dropdowns →
  "(locked)", modulation + MIDI-mapping editors inert, secondary-pane
  bind/clear, mixer capture prompt SAVE greyed, SnapshotBar, GROUPS
  structural edits (gang fader + MUTE stay live), GEM layout edit/⋯/+
  sockets (effect firing stays live). Gates with **no UI on these tabs**
  explicitly enumerated (deck view editor, deck capture, undo, param
  presets — unmounted, settings/scene/pattern — other tabs, channel
  duplicate — dead prop). Allowed controls verified live in screenshots.
- **APC mini SOLO (note 113) = performance/edit switch** — was UNASSIGNED
  (nothing displaced). New `performanceDialog` action kind through
  profile→YAML→resolver→dispatch→summon bus in performance_mode_logic;
  SOLO summons the same guarded sheets as the header control (enter-confirm
  idle / KEEP-RESTORE active; second press cancels; never a blind toggle).
  SOLO LED lit while active (scene-column LEDs are single-colour — lit/dark
  is the palette). docs/midi/apc_mini_mk2.md updated.
- **Control visual:** active = RED (#D32F2F) filled button labeled "EDIT";
  idle = amber outline "PERFORMANCE".
- Tests: CaptainPad 696/696 (+10) + tsc clean; engine untouched this pass.
  Screenshots `.agent_renders/pm2_*` (locked deck/mixer with live faders
  beside greyed structure; groups locked; full unlock after exit).
- **Branch note (operator directive):** ALL of today's work lives as
  uncommitted changes on `feat/party_integration_20260711` in the main
  working tree — no other branch, no worktrees used. Pre-existing
  `dev/midi_w1_*` / `worktree-agent-*` branches were not touched.

## 7. Evening wave — session retention, dirty flush, touch rows, APC confirm

- **Session param retention (engine)**: new in-memory `lib/session_param_cache.js`
  — tuned params survive ALL pattern switches for the whole session (deck +
  overlays + mixer), regardless of effectiveAutoSave; overlay applied last
  (pattern defaults → entry defaults → session cache). Keyed by channel +
  playlist-entry-id (pattern-name fallback for direct sets) — entry-id
  chosen because same-pattern twin entries must keep independent defaults
  (pinned by playlist_api test). Six switch paths covered INCLUDING the
  transition/crossfade deck swap (previous gap closed). Mixer scoping per
  operator: a layer's retained tuning clears when its playlist is changed
  or (re)loaded (same-name reload counts); deck keeps session-long scope.
  Performance RESTORE clears the cache; KEEP keeps it; crash = gone.
- **Dirty flags + flush-on-re-enable (engine)**: skipped deck captures are
  remembered in-memory; flush to playlist files on `POST /settings
  autoSave:true` (perf off) or performance exit-KEEP (stored autoSave on),
  incl. the currently-loaded pattern's live tuning; RESTORE discards;
  mixer never flushes (isolation ruling). deckParamsSaved fires only on
  real writes. 22 new tests; suite 1968/1977 (only known env fails). Live
  curl proof: 0.642 retained w/ files md5-identical → flush landed it;
  mid-show 0.808 never resurfaced after RESTORE.
- **Perf-mode pattern rows ~70% taller (CaptainPad)**: the thinness was a
  locking-pass regression (hidden edit sub-row collapsed rows to ~27px).
  New pure `playlist_row_sizing.ts`: perf-active rows 88px deck / 78px
  mixer (1.73×), bigger fonts, centered, uniform tap targets; edit-mode
  byte-identical; scroll math unaffected (measured offsets). 703/703.
- **APC SOLO press-again confirm (CaptainPad)**: enter sheet shows amber
  "● PRESS SOLO AGAIN TO GO LIVE" only when a controller binding
  performanceDialog is connected; second SOLO press CONFIRMS enter. Exit
  sheet: second press only closes (never picks KEEP/RESTORE) + hint that
  the choice is made on the iPad. Live E2E: SOLO×2 entered, SOLO×4 closed
  sheet with mode still active, RESTORE clean. 711/711 + tsc.
  NOTE: added dev-only `FakeApcDemoTransport` behind explicit
  `?fakeMidi=apc` URL flag (real Web MIDI from a second browser instance
  hangs the renderer on this box) — loud console warning, zero effect
  without the flag; remove if the operator objects.

## 8. Night wave — exit-save ask + VSN1 deploy/profile redesign

- **Exit-to-edit save ask LANDED**: engine exposes {dirtyCount, dirtyEntries}
  on GET /performance-mode + WS broadcast/replay; exitAction split into
  keep-save / keep (discard flush backlog, keep session state) / restore;
  flat exit sheet shows "N patterns were tuned this session" (names ≤3) +
  KEEP & SAVE TUNING / KEEP WITHOUT SAVING / RESTORE PRE-SHOW; RESTORE hint
  carries the discard count; config-page autoSave-on trigger still
  auto-flushes. Live-proven both keeps (file written vs untouched, session
  value kept). Engine 1973/1982 (env fails only), CaptainPad 723 + tsc.
- **VSN1 "swap doesn't deploy" ROOT-CAUSED**: not a trigger bug — the flash
  died silently on the 909-char LCD INIT budget (full 8-slot page compiles
  928+), triple-silenced (debounce catch, flush error path, CaptainPad
  ignoring lastResult error), and the failed page was stranded out of the
  queue. Closes freeze-report OPEN "swap failed to re-flash".
- **Engine fixes LANDED** (no hardware flashed; engine now runs with
  MARSIN_VSN1_DEPLOY=0 — restart WITHOUT that env var to re-enable
  deploys; config.yaml deployLayout restored true): budget auto-shrink
  ladder (name 10→6, mode 3→2, drop mode tables; loud warns; 990→907/909
  proven), loud deploy-failure logging + failed-page requeue, PAGE-0-ONLY
  clamp (hook + requestFullDeploy + CLI activation pin;
  --allow-nonzero-page escape hatch), controllerProfile 'edit'|'play'
  (GET/PATCH /global-effects/profile, WS controllerProfile broadcast +
  replay, persisted in global_effect_slots.yaml, PATCH triggers page-0
  redeploy; deliberately NOT perf-mode-gated), new
  templates/effects_layout_play/ (big-cell PLAY surface, encoder press
  no-op, 884/909 budget), deploys end page-0-active + page changes LOCKED
  (activate_page --lock; without --lock = recovery unlock).
- **CaptainPad LANDED**: visible dismissible "VSN1 layout NOT deployed"
  banner (clears on next ok); sb_2 → profile toggle (engine-authoritative,
  idempotent resync on profile echo AND deploy-ok); PLAY grid presentation
  (big cells, no ⋯/clear/picker, BLACKOUT kept) via useControllerProfile
  module-cache hook; device page-follow retired behind
  DEVICE_PAGE_FOLLOW_ENABLED=false (hard-delete follow-up chip filed);
  vsn1.yaml sb2_profile + docs/42 sb map updated. 739/739 + tsc.
- **Coordinator joint smoke caught + fixed a REST contract mismatch**
  (engine key `controllerProfile` vs client `profile` — WS was fine):
  normalized in CaptainPad utils/api.ts (wire = controllerProfile,
  callers see profile). Round-trip verified live: edit→play→edit,
  bogus 400, triggeredPages [0]; 739/739 + tsc after fix; dist rebuilt.
- **HARDWARE-GATED checklist for Sina** (in Implementer A output): one
  page-0 flash per profile, sb_2 cycle E2E, side-button-inert final state,
  one-time wipe of stale device pages 1-3 via --allow-nonzero-page, then
  restart engine without MARSIN_VSN1_DEPLOY=0.

## 9. Late-night — MAC write-path, VSN1 logo toast, colorWash exclusivity

- **MAC no longer persisted**: removed the 3 real MACs from studio/studiodj/
  test_bench controllers.yaml, THEN closed the write path — `mac` dropped
  from `normalizeDeviceBlock`'s persisted-field list + `bindControllerDevice`
  (controller_registry.js), so it never serializes and legacy YAML drops it
  on next save (silent migration). Discovery panel still shows the MAC from
  a memory-only live cache (led_discovery_panel.js). Sim 284/284. gitleaks
  commit blocker cleared (the gitignored .scene_backups/ copy + git history
  still hold MACs — not a commit-path concern).
- **VSN1 "P0" flash → MarsinLED logo toast**: `fdw` in effects_layout/
  system_init.lua now flashes the brand wordmark (reusing wdw art) instead
  of "P<n>" — paging retired, page number was dead signal. Both fallbacks
  (edit + play lcd_draw) → "MarsinLED" text. Offline: 11/11 tool tests,
  real studiodj dry-run system element 626/909, page 0 OK. Shows on next
  page-0 deploy. Dormant DRUM corner "P0" (key_init.lua:56) left as-is
  (not visible in grid mode, tight budget) — optional follow-up.
- **colorWash mutual-exclusion FIXED**: Ocean Wash + Emergency Red are two
  presets of the singleton `colorWash` (one wash layer) — activating one
  evicted the other. Made colorWash MULTI-INSTANCE keyed `slot:${slotId}`
  (slotless scheduler → `sched:${presetId}`) in global_effects_controller.js;
  entries composite ascending slotId (replace/tint = later slot wins;
  multiply/max order-independent); per-slot deactivate/fade (also fixes a
  latent untargeted-kill bug). Legacy `colorWashConfig`/`getStatus().colorWash`
  kept as a compat view over the new Map. strobe/feedbackTrails stay
  exclusive (correct — shared gate/buffer). Scheduler singleton guard left
  as-is (flag now scopes scheduled tasks, not runtime instances). New
  color_wash_multi_instance.test.js (8) + 1 updated; engine 628/5 (env-only
  fails). Runtime-only — never fires the VSN1 deploy hook. **Needs engine
  restart to take effect.**

## Parked / follow-ups

- **Performance mode — ANALYSIS ONLY, not implemented** (operator directive).
  Full analysis in the planner output: engine-level 409 gating of structural
  mutations, force-suspend of auto-save without flipping the stored bit
  (`effective = autoSave && !performanceMode`), snapshot-on-entry with
  KEEP/RESTORE prompt on exit recommended. 6 open operator questions
  (exit semantics, restart survival, entry-selection allowed?, lock scope,
  toggle gating, scheduled-task behavior).
- Transition-ENABLED deck swaps (crossfade path) do not auto-capture —
  default is disabled so the reported loss case is covered; small follow-up
  if wanted.
- Deck tuning of a pattern loaded WITHOUT a playlist entry still doesn't
  survive a switch (would need per-pattern map in deck_state extras) —
  proposed follow-up.
- Empty-state copy is 'No backups yet for "<scene>"' rather than literal
  "none" — trivial copy tweak if the operator wants it verbatim.
- Follow-ups belong on the Notion board (not filed this session).

## Residue (expected, uncommitted)

- `marsin_engine/states/studiodj/*` runtime state incl. new
  `settings_state.yaml` (untracked); pre-existing M/?? entries unchanged.
- Browser on-load model re-export touched `studio.{js,effects,viewmasks}`
  during UI capture — restored md5-identical from aside copies.
