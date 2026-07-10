# 20260710_11 — VSN1 freeze hunt, pipeline hardening, drum/grid redesign (handoff)

**Author:** Fable (coordinator session, 2026-07-10 all day). **Party is 2026-07-11.**
All work is UNCOMMITTED on `feat/party_integration_20260711` (commit is
operator-gated; security check + states/-residue exclusion still required).

## TL;DR for the next session

The VSN1 "completely frozen" day had THREE stacked causes, all found and
fixed/mitigated: (1) a **wedged pad-scan** (hardware — only a USB unplug/replug
clears it; a machine reboot does NOT), (2) **zombie CaptainPad tabs**
double-dispatching every key press into self-cancellation, (3) real deploy
pipeline bugs (page-stranding, page-change lock, stuck-deploying wedge). Full
triage playbook: `docs/42_vsn1_controller.md` → Troubleshooting + auto-memory
`vsn1-freeze-playbook`.

The VSN1 UX was then REDESIGNED to its final party shape (Sina, evening):

- **DRUM behavior everywhere** — every key press fires immediately + selects;
  two-step is retired (manager.ts `handleVsn1SlotKey`, unconditional).
- **GRID visual by default** — 2×4 COLOR-ONLY cells (no per-cell text; freed
  ~90 chars of LCD budget → p0 LCD INIT 803/909), selected cell gets a
  contrast border, compact detail line under the grid. Device defaults
  `vm=1` (lcd_init.lua) so VM wipes land on the grid.
- **Small buttons (final map)**: sb_0 = MODE cycle (selected slot, same as
  encoder press) · sb_1 = VIEW toggle (grid ↔ full readout, visual only) ·
  sb_2 = empty · sb_3 = MarsinLED logo (welcome CC). Reset/disable-all moved
  off the buttons (UI only). Readout labels: `MODE VIEW - LOGO`.

## Verified state at handoff

- CaptainPad: 589/589 vitest, tsc clean. Engine: 11/11 effects_v2_api.
  Device build: 7/7 test_offline, worst budget = encoder INIT 904/909.
- Full stack RUNNING (launcher dev, test_bench) with the latest code; boot
  deploy flashed the new grid to the device (pages 0+1, ok).
- A deploy-state Monitor was live watching Sina's auto-deploy test
  (add/remove/swap in the UI) — **check the outcome of that test first.**
  Baseline layout: 1:strobe 2:vintageWhite 3+4:feedbackTrails 5+6:colorWash
  7:vintageWhite 8:fogger 9:blastWhite(p1).

## Pipeline fixes landed today (all uncommitted)

1. `restore_config/write_config/ui_lab`: `enablePageChange` in `finally` —
   an interrupted flash can no longer page-lock the device (the #1
   power-cycle cause). Field unlock: `vsn1_config/activate_page.cjs --page 0`.
2. `deploy_layout.cjs`: after EVERY live deploy, spawn `activate_page.cjs`
   (new tool) to re-activate the ENGINE's current effectsPage + re-latch page
   changes (fixes device stranded on flashed page; effectsPage captured in
   `loadLayoutFromEngine` from `/global-effect-slots/status`).
3. `vsn1_layout_deploy.js`: final broadcast after `deploying=false` (was dead
   code — CaptainPad's post-deploy resync never fired) + try/finally so a
   spawn failure can't wedge `deploying=true` forever.
4. `encoder_init.lua`: nil-guard on `knd` in the receiver — an early feedback
   frame crashed midirx_cb before `dirty=1` = permanently frozen LCD.
5. manager.ts: 15 s keepalive full resync (self-heals any missed hello);
   select-cue re-emitted on device hello; BroadcastChannel newest-tab-wins
   guard in useMidiControl (origin-scoped: localhost vs 127.0.0.1 are blind
   to each other — ONE TAB remains the operator rule).

## OPEN — ranked

1. **HIGHEST (Sina's explicit call): auto-deploy on effect changes must be
   bulletproof.** An effect SWAP in the UI failed to re-flash the device
   earlier today (pre-restart; not yet root-caused — Sina was mid-retest at
   handoff). Watch: does the layout-changed hook fire on swap? Same-page
   change coalescing? Check `vsn1_layout_deploy.js` hook + slot manager
   `_emitLayoutChanged` paths for the swap mutation specifically.
2. **MFT encoder smoothing** — an Opus agent was reworking
   `CaptainPad/utils/midi/accel.ts` (+ its test) ONLY: EMA-smoothed rate,
   dead zone at slow turns, capped smooth ramp ("too sensitive" feedback).
   May still be in flight — check `git diff CaptainPad/utils/midi/accel.ts`
   and run its test file; report the feel knobs to Sina.
3. Engine shutdown doesn't kill a mid-flash deploy child (orphan holds COM12
   mid-page-write) — engine.js shutdown fix designed but NOT landed
   (audit 20260710, engine-deploy agent D2; also api_server.js:1034 drops
   the hook's `flush`).
4. Slot-add should reuse the lowest disabled slot on the current page
   (server-side allocator sketch in the engine-deploy agent report).
5. Playlists (party_high/low/ambient), pattern tuning, commit gate (tasks
   #7/#11/#12), mixer-MFT + test-isolation verifications (#4/#5/#6).

## Key file map (today's touched set)

- Device: `marsin_engine/tools/vsn1_config/templates/effects_layout/*.lua`
  (lcd_init/lcd_draw/key_init/encoder_init), builder `deploy_layout.cjs`,
  serial `grid_serial/restore_config/write_config/activate_page(.new)`,
  `test_offline.cjs`, `vsn1_utils/ui_lab.cjs`.
- Client: `CaptainPad/utils/midi/manager.ts` (drum contract, sb map,
  keepalive, pinned-default view echo), `hooks/useMidiControl.ts` (D4 guard,
  loud start() failure), `midi_profiles/vsn1.yaml` (sb ids sb0_mode/sb1_view/
  sb2_empty/sb3_logo), tests `vsn1_intensity/effects_v2` rewritten to the
  final contract.
- Engine: `lib/vsn1_layout_deploy.js`, `lib/api_server.js` (debug relay was
  added then fully REMOVED — zero residue).
- Docs: `docs/42` (final design + Troubleshooting playbook), `docs/34`
  pointer intact. Memory: `vsn1-freeze-playbook` (+ index).
