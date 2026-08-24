# 360 — Midday wave wrap: calendar frames live, colour anomaly solved, safety fixes

Coordinator wrap for the operator. Covers everything landed after the `_358`
overnight handoff. Chain per ruling: Fable designs (`_359`), Opus implements,
Sonnet/coordinator verify. Everything is UNCOMMITTED on `feat/bm_readiness`
(no git operations were requested). Companion reports: `_359` (frame design),
`_361` (colour anomaly investigation).

## 1. Landed and live-verified

1. **Working-day calendar frames** (`_359` S0/S1/S2/S4/S5, Opus): pad-side
   `working` (Night k = 6 PM → next-day 6 PM) vs `regular` frame with a device
   toggle; pure model `CaptainPad/components/timeline/day_frame_logic.ts`;
   engine `/timeline/overview` additively carries per-day `partyWindow`,
   `sun.civilDawn`, `nextSun`. S3 (cue editor/event sheet on the frame model)
   was stopped by the operator and stays unlaunched.
2. **NOW marker + midnight line** (operator override of `_359` C-01): the red
   NOW line now always draws at the position whose ruler label is the current
   clock — on exactly one week-strip card and in the day view, both frames,
   even before Night 1 opens (sentence retained). Midnight gridline + labels
   are muted green (`#4a8f6d`, `FRAME_MIDNIGHT_COLOR`). Exhaustive sweep tests
   pin single-card uniqueness. Verified in the served bundle's live DOM.
3. **Party signal source switch** (companion-owned): `party.source:
   qualified|simple` in `marsin_engine/config.yaml`, selector in the Audio
   Companion PARTY tab, exposed on the pad's LIVE tab. Precedence
   override > source > detectors. Round-trip verified live including the
   surgical line persist (comment block byte-identical).
4. **Party-window day-index rule fix**: pad editor no longer applies the
   operator-day 6 PM shift to party windows (the `× WINDOW · OPENS 09:00`
   mystery — the engine had been right all along).
5. **timeline.tsx dead-body deletion, finished by hand**: the Opus agent was
   stopped mid-edit, stranding the file non-compiling while a broken dist was
   being served (white Timeline page). Coordinator restored the three still-live
   declarations (`saveOk`, `showAllDays`, `TimelineCue` import), moved the four
   stale source pins in `timeline_maker_ownership_contract.test.ts` onto live
   mounts (alert-line `saveError`, `timeline_priority_feedback` strings, the
   manual PREEMPT button now pinned absent), rebuilt, and verified the page
   renders. Net ~1,270 lines of legacy body gone.

## 2. Colour anomaly (`_361`) — root causes fixed

Verdict: engine **data**, not sim rendering. Two proven causes, both fixed:

- **Test-suite sACN leak (BLOCKER)**: engine `npm test` used to transmit real
  sACN from up to 4 concurrent test engines to `127.0.0.1` — the live sim
  bridge — with the show engine's own CID, stalling universes via sequence
  collisions (the "random colours"). The global config guard now rewrites test
  destinations to TEST-NET-1 `192.0.2.9` with multicast off, asserted loudly;
  canonical definition in `marsin_engine/tests/helpers/sacn_black_hole.mjs`;
  regression-pinned by `tests/io/config_guard_sacn_wall.test.mjs`.
- **Un-zeroed WASM render buffer (MAJOR)**: `wasm_host.js` now zeroes a
  once-allocated scratch before each render, so budget-truncated (skipped)
  pixels emit black instead of freed heap. Removing per-frame malloc/free made
  the hot path ~12.7% faster. Mutation-checked tests cover both paths.
- Doc half closed: `.agent/os/multi_agent.md` slot table gained an sACN Dest
  column and the isolation procedure now requires `--dest 192.0.2.9` alongside
  `--port`, with the loopback-is-not-a-black-hole explanation. The
  `bm26-report-ip` gitleaks rule allowlists the RFC 5737 documentation ranges
  (class false positive, per `security_privacy.md` option 4).

## 3. Shutdown blackout safety fix

Old shutdown zeroed only patched pixels, so DMX-only raw writes (fogger, haze,
horn, fire) survived in the final frame — a relay could latch ON with nothing
left transmitting to clear it, and delivery was never confirmed. New
`marsin_engine/lib/shutdown_blackout.js` zeroes all 512 channels of every
universe (including pruned ones), verifies, and sends via delivery-checked
`sendFrameChecked`; any unconfirmed blackout prints a boxed
`SHUTDOWN BLACKOUT NOT CONFIRMED — CHECK THE RIG PHYSICALLY` banner and exits
non-zero. 16 new tests, including a real-effects-controller latch case.

## 4. Gate status

- CaptainPad: `tsc --noEmit` clean; vitest 3063 passed / 0 failed / 6 skipped;
  lint no new warnings; web dist rebuilt and served.
- Engine: full suite 4156 tests, 4151 pass. The only failures are the 2 known
  `ambient_playlist_derivation` pins and 3 in `specialty_white_uv` caused by an
  **uncommitted working-tree deletion of
  `simulation/scenes/titanic/playlists/uv_test.yaml`** (present at commit
  `3246deb2`; deleted locally before this wave). Operator decision pending:
  restore the file or update the contract test.
- Sonnet live verification: overview fields, deckOwner/partyWindow coherence,
  party-source round-trip, dist wiring, 103/103 frame/party-window logic tests
  — all PASS.

## 5. Runtime / operational state

- Stack runs from the coordinator's launcher with `--sacn-priority 150`; a
  local watchdog (untracked, `~/tmp/launcher_watchdog.cjs`) restarts the stack
  from latest code whenever it goes down; off-switch = create
  `~/tmp/launcher_watchdog_off`.
- The **running engine predates** the wasm zeroing and blackout fixes; both go
  live at the next restart (watchdog handles it automatically on any stop).
  Until then, the next engine stop is the last one with the old blackout path.
- Capture tool for any future colour anomaly:
  `~/tmp/sim_color_anomaly/color_anomaly_capture.cjs`.
- Expected residue (report, don't commit): `marsin_engine/states/**`,
  companion `party_profiles.yaml`, bench mirror state.

## 6. Open items for the operator

1. `uv_test.yaml`: restore vs. update `specialty_white_uv` contract test.
2. `_357` P0s T-01/T-02 still block editing `playa_default` cues from the pad.
3. Passcode-gate asymmetry on `/party/*` routes in performance mode (`_358` §6).
4. S3 of `_359` (cue editor / event sheet on the frame model) — relaunch only
   on explicit ask.
5. Nothing committed. Suggested split: engine timeline + party fixes (+tests),
   engine safety/test-wall fixes, CaptainPad timeline/party/frames (+tests),
   companion party-source, Agent OS docs + gitleaks, reports `_356`–`_361`.
