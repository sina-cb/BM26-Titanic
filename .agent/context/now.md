# now.md — State of Play

> Updated by any agent, any time state changes. Keep it under a screen.
> Absolute dates only.

_Last touched: 2026-07-20 (show-server deployment tooling wave on `feat/auto_start` — docs/43)_

## Active branches

- **`main`** — integration branch. Push/merge is operator-gated.
- **`feat/party_integration_20260711`** — party merge wave (studio model +
  LED fixtures + CaptainPad MIDI + autopilot deck) **+ `feat/led_integration`
  merged 2026-07-10**: MarsinLED discovery, per-output DMX push (force +
  confirm, legacy path removed), LED strand sim parity + pixelblaze direct
  paint. Source branch kept per branch policy. `stable` tag still points at
  6a64084 (pre-LED party build) — NOT retagged, per Sina.
- **`feat/led_integration`** — merged into the party branch (kept as
  per-feature history). Plan: `.agent/plans/20260709_0_led_integration_execution.md`;
  reference: `docs/41_led_controller_onboarding.md`.

## Active projects

- **party_20260711** — party on Saturday 2026-07-11. THE current plan lives
  in the private repo:
  `BM26-Firmware-Deployment/.agent/plans/20260707_party_plan_20260711.md`
  (merge wave + testing plan, MarsinLED/Angio4 hardware, MIDI tests, pattern
  tuning, party + ambient playlists, party-detection cue). Source feat
  branches are kept; the integration branch is the working branch.
- **agent_os_rework** — reworking `.agent/` into the Agent OS. See
  [`../projects/agent_os_rework.md`](../projects/agent_os_rework.md).

## Party-prep status (2026-07-09, party is 2026-07-11)

**THE plan: [`../plans/20260709_party_readiness_execution.md`](../plans/20260709_party_readiness_execution.md)**
— Track A effects-controller wrap-up (single-page mode, welcome logo,
CaptainPad→VSN1 auto-deploy proof, UI polish), Track B three playlists
(party_high / party_low / ambient), Track C pattern tuning on the DMX test
bench (separate agent session). Sina's directive: ONE VSN1 page done right;
side buttons must stop switching pages.

DONE + hardware-confirmed:
- **MFT fast-twist FIXED** (Sina: "works perfect"): full-range `value−64`
  decode, linear step, ACCEL_GAIN_MAX 3.0 — do NOT retune the confirmed feel.
  Merged review: `reports/202607/20260709_11_mft_motion_review_merged.md`.
- **VSN1 layout auto-deploy LIVE**: `config.yaml vsn1.deployLayout: true`;
  slot edit → 1.2 s debounce → one-page COM12 flash (SYNCING screen) →
  verified end-to-end `lastResult: ok`. Fixed an unhandled-rejection crash in
  the serial waiters (grid_serial/restore/write/read_config `.catch` guards).
- **APC mini remapped** (docs/midi/apc_mini_mk2.md): shift=deck/mixer, track
  buttons=focus channels, clip_stop=combined autopilot, stop_all=blackout.

DONE + hardware-confirmed (2026-07-10):
- **LED per-output E2E LIVE**: MarsinLED titanic_202, BOTH outputs animating
  from the engine (out0→U10@1, out1→U12@1); legacy linear projection removed,
  per-output is the only layout; sim 272/272, CaptainPad 589/589 + tsc.
  ~~KNOWN ENGINE BUG: model hot-reload doesn't refresh the output-universe
  send set — restart the launcher after any Save that changes universes.~~
  **CORRECTED 2026-07-28 (`_36`)**: fixed by G10 (2026-07-24) — hot reload
  registers new universes on the fly. The real restart trigger is a
  **pixel-count change**, which the watcher refuses (`/status.modelStale`).
  Apply it deliberately with `POST /scene/reload {"scene":"<active>"}` —
  runbook `.agent/ops/engine_model_refresh.md`. Never bounce scenes for this.
- **Playlist truth (Fable debug)**: web Alert was a silent stub (fixed,
  op_alert); `slow` playlist EMPTY; party_high/party_low/ambient DO NOT
  EXIST; 51 stale slider defaults across 21 default.yaml entries + 3 dead
  modulations (report 20260710_12 + agent output).

DONE + hardware-confirmed (2026-07-10):
- **VSN1 effects UI fully landed** — auto-deploy on layout change +
  deploy-on-load on boot + `POST /global-effects/deploy`; "Loading" reflash
  card; welcome logo first-connect only (host hello-driven); side-button ↔
  CaptainPad page sync; UI-lab tool `tools/vsn1_utils/ui_lab.cjs`.
  Docs: **[docs/42](../../docs/42_vsn1_controller.md)**.
- **2026-07-10 — freeze hunt + final redesign** (FULL HANDOFF:
  [`../reports/202607/20260710_11_vsn1_freeze_hunt_and_redesign.md`](../reports/202607/20260710_11_vsn1_freeze_hunt_and_redesign.md)):
  three stacked freeze causes found (wedged pad-scan → USB replug; zombie
  tabs double-dispatching; deploy pipeline bugs) and fixed; VSN1 redesigned
  to its party shape — DRUM behavior everywhere, COLOR-ONLY grid default,
  sb map MODE/VIEW/empty/LOGO. 589 CaptainPad tests + 7 device-build tests
  green. Auto-deploy remove+add cycles VERIFIED LIVE on hardware at handoff
  (rev 2+3, both `ok`, page snap-back correct).

OPEN (tracked in session task list):
- **KNOWN ISSUE:** VSN1 view mode resets to DRUM after a reset (hello-resync
  fixed the effect-add re-flash case, not reset). Sina accepts for party.
- **PR prep IN FLIGHT:** two Opus review agents running — (1) adversarial
  correctness review of the VSN1 stack, (2) security + PR-readiness across the
  whole diff (226 files, ~38.5k ins vs main). Party build.
- Verify: mixer focused-channel MFT fix, npm-test state pollution fix (B12 —
  keeps crashing the stack on restart), restart-activated engine fixes.
- Playlists (party_high/low + ambient), pattern tuning on the bench.
- Everything uncommitted on `feat/party_integration_20260711` — commit is
  operator-gated; security check + subsystem auto-checks first.

## 2026-07-13 wave (uncommitted, report `202607/20260713_0`)

- **studiodj black pixels FIXED**: scene had saved `simBrightness: 0` →
  now 0.4. Reload any pre-fix browser tab (it holds 0 dirty in memory).
- **Scene save backups LANDED**: pre-save snapshots →
  `simulation/.scene_backups/` (gitignored, keep 20), ⟲ Recover UI in the
  HUD top bar, `GET /backups` + `POST /restore-backup` on :6970. 281/281
  sim tests, security check PASS.
- **Engine auto-save LANDED**: deck tuning loss root-caused (capture-on-switch
  removed in c513108) and fixed; `autoSave` setting (default ON) in new
  `settings_state.yaml`; mixer `localControls` never persisted; CaptainPad
  `/config` toggle. Engine 1925/1935 (10 pre-existing/env fails),
  CaptainPad 639/639 + tsc. **Performance mode: analysis only, parked** —
  operator decision pending (see report).
- **Deck UI fixes LANDED**: pattern-list no longer jumps to the blue MIDI
  window on tap (window now recenters around the selection, pads+UI agree);
  green "✓ SAVED" badge restored via new `deckParamsSaved` WS broadcast
  (honest — silent when autoSave OFF). CaptainPad 666/666 + tsc.
- **APC window desync FIXED** (ID-keyed auto-follow baseline; pads always ≡
  blue highlight; manual browse sticks). CaptainPad 672/672.
- **PERFORMANCE MODE LANDED** (operator-authorized): 39 engine gates (409
  `PERFORMANCE_MODE`), pre-show snapshot on entry, KEEP/RESTORE exit,
  crash = implicit restore, effective-save suspension; shared control in
  deck + mixer headers. Engine 1936/1945 (env fails only), CaptainPad
  686/686 + tsc. Screenshots `pm_a..pm_h`.
- **Perf-mode follow-up LANDED**: all 39 gates greyed comprehensively on
  deck+mixer UI; APC SOLO = performance/edit dialog switch (LED lit when
  active); active button = RED "EDIT". CaptainPad 696/696 + tsc.
- **Later wave LANDED**: engine session param retention (all channels,
  transition path covered; mixer scoped to playlist assignment) + dirty
  flush on auto-save re-enable / exit-KEEP (engine 1968/1977, +22 tests);
  perf-mode pattern rows 1.73× taller for touch (703/703); APC SOLO
  press-again-to-confirm enter + exit-sheet hint (711/711 + tsc). Dev-only
  `?fakeMidi=apc` transport added for headless MIDI testing.
- **Final wave LANDED**: performance-exit save ask (keep-save / keep /
  restore + dirty summary); VSN1 silent-deploy root cause = 909-char LCD
  budget overflow (fixed: auto-shrink + loud errors + requeue); page-0-only
  deploys; controllerProfile edit/play (sb_2 toggle, PLAY big-cell surface
  device+CaptainPad); device paging retired (page changes locked post-
  deploy). Joint smoke fixed a REST key mismatch (controllerProfile vs
  profile). Engine 1973+/1982, CaptainPad 739/739 + tsc.
- **ENGINE DEPLOY GATE:** current engine process runs with
  MARSIN_VSN1_DEPLOY=0 (no hardware flashes possible). Restart engine
  without that env var to re-enable VSN1 deploy-on-change. Hardware
  verification checklist (page-0 flashes, sb_2 E2E, pages 1-3 wipe) is in
  report 20260713_0 §8 — operator-gated.
- **COMMIT BLOCKER:** security check flags 3 pre-existing MAC addresses in
  `simulation/scenes/**/controllers.yaml` — must be resolved before the
  operator-gated commit of this branch. All 2026-07-13 work is uncommitted
  on `feat/party_integration_20260711` only (operator directive).

## 2026-07-14 (uncommitted, continues report 20260713_0)

- **HIL leak cleaned + guarded**: hil_mixer_autocycle_test leaked playlist
  `hil_autocycle_test` into studiodj (removed; backup in ~/tmp);
  assertDisposableEngine() pre-flight added (HIL tests exit 2 unless
  activeModel=test_bench). Follow-up chip: apply guard to all ~40 HIL tests.
- **Effects UI "regression" = engine controllerProfile stuck on 'play'**
  (CaptainPad renders faithfully; edit path verified byte-identical +
  regression-guard tests). THEN found profile flips edit→play at runtime
  with no operator action: only writer is the VSN1 sb_2 handler; ranked
  cause = stale Web MIDI replay / self-echo alias (fw TXes sb notes on
  ch=page; our page-2 LED feedback == sb_2 note 43!). HARDENED
  (manager.ts handleVsn1ProfileButton): stale>2s drop, 400ms debounce,
  in-flight ignore, refuse-unseeded (no more blind 'edit' default),
  50ms self-echo guard, accepted/dropped audit via lastEvent. Engine PATCH
  handler now logs `[ControllerProfile] prev -> next (source, remote)` +
  accepts/echoes body `source` ('vsn1_sb2' threaded). CaptainPad 756/756 +
  tsc. Engine logging needs engine restart.
- **APC window policy (operator ruling)**: recenter ONLY on mouse/touch UI
  tap; APC pad-select, autopilot, external changes NEVER move the window
  (explicit source signal, non-UI sources don't republish). 747-base tests.
- **Page-follow code DELETED** (was gated): constant + device-page-CC block
  + dead vsn1 branch gone; decoder + hello handler + effectsPage plumbing
  kept.
- **Perf-mode exit save-ask, session param cache, dirty flush, colorWash
  multi-instance, MAC write-path removal, MarsinLED logo toast**: see
  report §7-9.
- **Effects mode badge LANDED**: PLAY mode was silently hiding all authoring
  UI (the only hint was gated !isStrip and never rendered; sb_2 hardware was
  the only escape). Now an always-visible badge in the strip header: amber
  "PLAY — tap for EDIT" (TAPPABLE → PATCH profile edit, source
  captainpad_badge) / red "LOCKED — performance mode". PLAYLIST_DBG console
  spam gated behind a flag (fixes screenshot starvation). Metro evicted from
  :6967 (again) → serve dist. CaptainPad 761/761 + tsc. studiodj persisted
  profile = edit.
- **Dynamic VSN1 deploy: config-persistent now** — `config.yaml
  vsn1.deployLayout: true` (operator hit the disabled-gate trap 3× in one
  day; env var no longer required). Boot deploy verified ok to page 0,
  operator confirmed working. NOTE for commit review: `true` means any
  machine with a board on COM12 auto-flashes on layout change.
- **NAMED EFFECT BANKS (v3) LANDED (uncommitted, post-PR)** — supersedes the
  2-profile model. controllerProfile edit/play → an ORDERED LIST of NAMED
  banks (each its own effect set), cycled by sb_2 (atomic POST
  /global-effects/banks/next, wrap), always >=1 (engine + UI auto-create
  'Default' if none). Engine: this.banks + this.slots alias (all slot
  endpoints bank-aware for free), migrateSlotFile v1/v2→v3 (studiodj v1 → one
  'edit' bank, no phantom), 6 bank endpoints (GET banks / PATCH active /
  POST next / POST create+DELETE+PATCH rename — switch/next ungated, CRUD
  perf-gated), effectBanks broadcast + connect replay. CaptainPad: sb_2
  cycle (all guards kept), "BANK: name (i/n)" badge, +/delete controls
  (last-bank disabled), ensure-default; chrome INVARIANT. Cleanups:
  pageCount REMOVED from getLayout (zero readers); vsn1_layout.json → .yaml
  (js-yaml, stale .json deleted on write + 3 checked-in artifacts removed);
  D1 banks replace profiles → ONE device surface (base detail;
  effects_layout_play/ deleted). Engine global_effect_banks + effects_v2_api
  54/54, full suite env-fails only; CaptainPad 778/778 + tsc.
  effect_layout_guard loader taught v3 + fail-loud on unknown shape (12/12).
  LIVE 3-bank cycle render verified (throwaway :7008: Ambient/Party/Peak,
  chrome identical, wrap works) + migration + empty-recovery. NEEDS engine
  restart on :6968. FOLLOW-UPS: device LCD sb_2 label still 'PROF' (cosmetic,
  lcd_draw.lua); bank rename UI deferred (endpoint exists); studiodj scene
  has a secondary sACN dest on the LAN (unrelated).
- **BANKS UX SHELVED (operator decision 2026-07-14)** — multi-bank switching
  gated OFF behind `BANKS_UI_ENABLED=false` (global_effect_macros_logic.ts:20).
  CaptainPad now a plain single grid of 8 effects: no BANK badge, no +/delete
  controls; sb_2 DISABLED (handleVsn1BankButton early-returns; vsn1.yaml
  sb2_disabled). ALL banks machinery KEPT as dormant TODO (engine endpoints,
  useEffectBanks hook, guards, pageCount removal, vsn1_layout.yaml, v3 guard
  fix) — flip the flag + re-enable sb_2 + vsn1.yaml to restore. CaptainPad
  772 pass + 6 skipped (shelved-guard tests) + tsc. Device LCD 'PROF' label
  (engine lcd_draw.lua) still needs relabel when the shelf lands.
- **TEST-SUITE CLEANUP LANDED (uncommitted, 2026-07-15)** — 2 Fable reviews →
  adversarial consolidation → 2 Opus implementers (engine + CaptainPad,
  disjoint). ENGINE: 135 flat tests/*.test.js → 8 domain subdirs
  (audio/companion/timeline/mixer/effects/state/playlist/io) + helpers/ +
  hil/ + integration/; SAFE explicit glob `tests/**/*.test.{js,mjs}` (NEVER
  bare `node --test tests/` — sweeps HIL on Node v24; verified 0 hil in
  default suite); 7 silently-dead node:test suites reactivated (+61 tests,
  all pass); detector_eval → test:eval (53s); spawn_engine helper extracted
  (7 dups); HIL: hil_client.mjs + run_hil.mjs dispatcher + single test:hil +
  NODE_TEST_CONTEXT inertness guard + README backfill (43 harnesses);
  package.json dup keys removed. CaptainPad: FakeTransport → test_support/;
  decodeDevicePageCc DELETED (0 callers); VSN1 runtime tests deduped 4→1 home
  + scenarios/ dir (window_sync, vsn1_runtime, vsn1_feedback_pipeline, …);
  762 pass/6 skip/tsc. New law `.agent/os/testing.md` (naming boundary:
  *.test.* = default suite, *_test.mjs = HIL, *.eval.mjs = eval). Zero
  coverage loss (every delete grep-proven to survive; reorg = pure move).
  FOLLOW-UP CHIP: HIL httpJson mass-migration deferred (36 harnesses resolve
  {status,data}, 7 resolve body — semantic drift, needs per-file verify).
- **PARKED (operator stopped the agent)**: performance-button
  state-sync hardening (render from authoritative state, reconnect re-seed,
  disconnected-neutral) — relaunch only if operator asks.
- **Sim stack pre-MAC-fix**: the running sim re-wrote `mac:` into
  studiodj/controllers.yaml (pre-fix code in memory); strip recurs until
  the sim stack is restarted onto the fixed code.

## 2026-07-20 show-server deployment wave (uncommitted, `feat/auto_start`, docs/43)

- **Deployment tooling COMPLETE on `feat/auto_start`** (docs/43): server
  bring-up suite fetched from the interior server and pushed — commits
  8650735 + db3aa43. Laptop `deploy/deploy.py` now does deploy / fetch /
  stop / start, per-machine overlay merge-fragments, and hardened `verify`
  (crash-loop check is a STABILITY check — reads boot_status twice ~15 s
  apart, fails only if `restart_count` rose; hardened after adversarial
  review).
- **interior1 SET UP**: the interior server (manifest key `titanic-int`) fully
  provisioned; stack running `test_bench`; SSH + SMB from the laptop proven.
- **Scratch residue curated** to `feat/test_bench_tuning` (pushed; engine
  runtime states dropped per operator).
- **VSN1 auto-deploy default = TRUE everywhere** (operator ruling
  2026-07-20); `titanic-int` carries NO overlay overrides.
- **PENDING — operator-run live gates**: `deploy --restart-only`, then full
  `deploy --scene test_bench` (both blink/bounce the live rig). After those
  pass → operator-gated commit + PR of the tooling wave.
- **OPEN ITEM**: dropped the `TestBench-10` (bench LED controller) override
  (bench-LEDs question still unresolved).

## Hot notes

- **2026-07-31 — the TIMELINE ZOOM WAVE (S1–S5) IS CLOSED** (`_100`, report
  `202607/20260725_100_timeline_zoom_e2e.md`). `_94` design → `_95` engine →
  `_97` pad → `_98` bugfixes → `_100` e2e. The verification slice landed as a
  committed suite in **`marsin_engine/tests/e2e/`** (17/17, ~2 min, inside
  `npm test`) that spawns REAL engines and restarts them by killing them.
- **2026-07-31 — SPAWNING A TEST ENGINE IS NOW SAFE BY CONSTRUCTION** (`_100`).
  `--dest` does NOT black-hole sACN — the config's per-controller
  `controllers:` block wins for the universes it claims (this cost `_97` 30 s
  of live sACN on the real rig). **`MARSIN_CONFIG_FILE` now governs the
  engine's BOOT read**, not just the autopilot write-back, so a harness hands
  the engine a black-holed config instead of editing the tracked
  `config.yaml`. New **`MARSIN_TIMELINE_DIR`** does the same for the show-plan
  library (`POST /timeline/plans` can no longer reach `scenes/**`). Both are
  ASSERTED on every boot by `tests/e2e/timeline_e2e_harness.mjs` — copy that
  pattern for any new engine-spawning harness, and always import
  `tests/helpers/setup_config_guard.mjs`.
- **2026-07-31 — full engine suite baseline is now 8 failures, not 9**: the
  `tests/io/status_output_routing.test.js` failure `_98` reported is GONE (it
  was caused by `_97`'s temporary loopback controller host, since restored).
  The remaining 8 are 5 × `audio_capture` + 1 × `osc_listener` (environmental),
  1 × `effects_v2_mode_page_layout` (known full-run state pollution), 1 ×
  `specialty_white_uv` (pre-existing playlist drift between the two scenes).
- **2026-07-31 — sim servers UP, engine DOWN** (`_99`, `feat/bm_readiness`):
  sim running via `cd simulation && npm start`, pinned `titanic` (:6969 HTTP,
  :6970 save, :6971 sACN-IN, :6972 sACN-OUT, UDP 5568). :6966/:6967/:6968/:7167
  are all free — the concurrent `_97`/`_98` threads released them.
  `node launcher.js prod --scene titanic` was **refused by the permission
  gate**; run it to finish the prod shape (it absorbs the sim servers, nothing
  to stop first). It force-claims ports, so never start it while another agent
  holds :6968 (`launcher.js:1025`, there is no `--no-force`).
- **2026-07-31 — the sACN input bridge's `addMembership EINVAL` boot crash is
  FIXED** (report `202607/20260725_99`). It was never a NIC problem: the bridge
  subscribed universes synchronously at boot while the `sacn` Receiver's own
  join loop is deferred to the socket's `listening` callback over the SAME
  array, so the universe was joined twice = `EINVAL` on Windows, and there was
  no `receiver.on('error')` to catch the package's re-emit. Trigger: any scene
  patched to a universe the `📡 Subscribed Universes` field does not name.

- **Show-server deployment DESIGNED (2026-07-17)**: `docs/43_show_server_deployment.md`
  — power-safe boot chain (BIOS AC-restore → autologon → scheduled task →
  `deploy/boot_server.ps1` supervisor → `launcher.js prod --scene <X> --no-launch`)
  + one-command laptop→server deploy (`deploy/deploy.py`: SSH control, robocopy
  /MIR sync incl. node_modules, per-machine overlays, verify probes). Phase 1 =
  manual bring-up of first interior server (`interior1`); Phase 2 = the deploy/
  tooling (IMPLEMENTED — see the "2026-07-20 show-server deployment wave"
  section above). Open questions for Sina in doc §Open questions.

- **Effects v2 Track C (CaptainPad) LANDED** on `feat/party_integration_20260711`
  (uncommitted): 4-page effects switcher + per-slot value/mode UI; VSN1 side
  buttons → engine `effectsPage`, encoder press → mode cycle; VSN1 MIDI feedback
  stream (slot active/value/mode + page). 428/428 CaptainPad tests, tsc clean.
  Needs the parallel engine track (`/global-effects/page`, `mode/cycle`,
  `primaryMode` + `mode*` on slot status). Report `20260709_2_effects_v2_captainpad`.

- **gitleaks v8.28.0** on `PATH` confirmed working (gate passed 2026-07-07).
- **marsin_engine tests on the Windows box**: `audio_capture` (no audio
  device configured), `osc_listener` (EACCES instead of EADDRINUSE), and
  `led_dmx_parity` fail identically on `main` — environmental/pre-existing,
  not regressions. Same set fails on the party integration branch.
