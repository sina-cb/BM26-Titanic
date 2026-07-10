# VSN1 effects UI — views, welcome logo, page sync (5 refinements + 2 coordinator adds)

**Date:** 2026-07-10 (dated 07-09 per the assigned filename)
**Branch:** feat/party_integration_20260711
**Scope:** Complete the partial VSN1 (Intech Grid VSN1L) effects UI: finish the
first-pass intent + apply the operator's 5 live-hardware refinements, plus 2
coordinator course-corrections (device-hello-driven resync; drum small-button
labels). DRY-RUN ONLY — the operator flashes hardware after this lands.

## Starting state (assessed)

- Deploy dry-run PASSED but CaptainPad was **RED**: `npx tsc --noEmit` had 8
  errors and `npm test` had 7 failing tests — the prior agent left the wiring
  half-done (missing `resetAllGlobalEffects` / `disableAllGlobalEffects` on the
  manager api + test mocks; a router-path type; stale tests still asserting the
  OLD notes-41-44 = page-select contract).
- Templates already carried the host-armed-welcome model (device INIT defaults
  `hi = 0`; only the host hello sets `hi = 1`) — item 1's device side was done;
  the CaptainPad side + everything else was not.

## What changed

### CaptainPad (utils/midi + hooks)
- **Wiring fix (blocker):** added `resetAllGlobalEffects` / `disableAllGlobalEffects`
  to the manager api object (`hooks/useMidiControl.ts`) + their imports; cast the
  `deckMixerToggleTarget` route to the expo-router href type. TSC green.
- **Stale-test fix:** notes 41-44 are now `vsn1SmallButton` 0..3 (sb_0 view mode,
  sb_1 no-op, sb_2 reset-all, sb_3 disable-all), not `effectsPageSelect`. Updated
  `vsn1_intensity.test.ts` + `effects_v2.test.ts` accordingly.
- **Item 1 + 2 (device-hello-driven welcome + resync — coordinator's model):**
  - `vsn1_feedback.ts`: added pure `isDeviceHello` + `DEVICE_HELLO_CC` (41) and
    `decodeDevicePageCc` + `DEVICE_PAGE_CC` (40).
  - `manager.ts`: on a genuine (re)connect, arm `vsn1WelcomeArmNextHello` (NOT a
    blind send). On receiving the device's readiness hello (CC 41), `handleDeviceHello`
    re-echoes the view mode + forces a full feedback re-sync; the FIRST hello of a
    connection also arms the welcome logo, every SUBSEQUENT hello (page load /
    post-flash VM restart) only re-pushes state. This is the RACE-FREE guarantee
    the coordinator required — the device asks only once its receiver is live.
  - Belt-and-suspenders: still subscribe to the engine's `vsn1LayoutDeploy` WS
    message (`resyncVsn1AfterLayoutDeploy` on a completed `deploying:false /
    lastResult:'ok'` deploy) — re-echoes view mode + full frame, never the welcome.
- **Item 3b (drum any-key trigger):** `handleVsn1SlotKey` — in DRUM view every key
  press immediately fires that slot AND snaps the LCD to it (select cue moves `sel`);
  EFFECT view keeps the two-step select-then-trigger.
- **Item 5 (device → app page follow):** manager `onMessage` intercepts the device
  page CC (controller 40) → PATCH `/global-effects/page`; skips a redundant PATCH
  when already on that page; arms a full re-sync so the device repaints after its
  VM restart. Never re-arms the welcome.

### Device Lua templates (marsin_engine/tools/vsn1_config/templates/effects_layout)
- **encoder_init.lua:** added the DEVICE HELLO emit `self:midi_send(-1, 176, __HCC__, 1)`
  at the end of INIT (after the receiver registers) — the device announces "VM ready"
  on every VM restart (power-on / page load / re-flash). Shares controller __HCC__
  with the host→device welcome-arm (opposite directions, no on-wire collision).
- **lcd_init.lua:** `gdw` now draws each EFFECT-grid cell's short ABBREVIATION
  (item 4) in a contrast color (black on light / white on dark — the same luminance
  test the selected-cell border uses). `abr` array added; `knd` MOVED OUT to the key
  INIT for budget.
- **key_init.lua:** now hosts `dtl` (the LCD detail renderer) + `knd`. `dtl` draws
  the pressed slot's readout in ONE draw sequence whose sizes/positions switch by
  view mode: DRUM = full-screen (large name, very large value, mode line, ON, P<n>,
  a RAISED value bar, + the four small-button labels MODE/-/RESET/OFF centered over
  their columns); EFFECT = a compact line under the grid. (gdw + dtl exceed 909 on
  one element, so the two LCD renderers live apart; all INITs run before the first
  paint, so `dtl`/`knd` globals are always ready.)
- **lcd_draw.lua:** thin — welcome / (EFFECT: gdw + dtl) / (DRUM: dtl) / flash. Calls
  `dtl(self)` nil-guarded (a lost key INIT degrades to a minimal readout, never black).
- **deploy_layout.cjs (substitution map ONLY — flagged):** added `__ABBRS__` (per-page
  abbreviations via the existing `abbreviate()`) to the LCD-INIT sub map; MOVED
  `__KINDS__` from the LCD-INIT sub map to the KEY-INIT sub map. No logic change
  beyond the substitution maps.

## Budget table (deploy dry-run, example_layout.json — 11 slots)

| Action string        | Before | After | Note |
|----------------------|-------:|------:|------|
| encoder INIT (rx)    | 874 | **896** | +22: device hello emit |
| LCD DRAW             | 904 | **574** | detail moved to dtl (key INIT) |
| p0 LCD INIT          | 778 | **821** | +abbr array + gdw text; −knd |
| p0 key 0 INIT        | 59  | **871** | +dtl renderer + knd |
| system INIT          | 558 | 558 | unchanged |
| p1/p2/p3 LCD INIT    | 710/700/692 | 735/722/711 | |

All ≤ 909; all 4 pages round-trip validate (restore_config dry-run OK).

**Dense-page headroom:** a realistic full 8-slot page (8-char names + 1-2 modes)
now fits at LCD INIT 864/909 (before the `knd` move it was 933 — OVER). The
`knd` relocation bought ~65 chars.

**Known pre-existing limit (NOT introduced here):** the absolute pathological page
— all 8 slots with 12-char names AND 2×10-char modes — overflows the LCD INIT
(~1031) because the `nms` + `mnm` arrays live on that element. This predates this
work (the mode array alone is ~217 chars); it is bounded by the existing
`MAX_NAME_LEN = 12` validation. The party's real layouts fit with margin.

## The welcome-arm signal (item 1, resolved)

The welcome is now DEVICE-HELLO-DRIVEN. Device INIT defaults `hi = 0` and NOTHING
in any INIT sets `hi = 1`. The device emits a hello CC on every VM restart; the
host answers with a state re-push, and only the FIRST hello of a fresh host
connection arms the logo (host→device welcome CC ch2 cc41 = 1). A page change /
re-flash is a subsequent hello → state only, no logo. Tracing a page_load: VM
restarts → INIT (hi=0, live layout paints) → device hello → host re-pushes state
(no welcome) → logo never appears. ✅

## Test results

- CaptainPad `npx tsc --noEmit`: **0 errors**.
- `npm test`: **586 passed** (was 573 at a green baseline; +13 new). New/updated
  coverage: `decodeDevicePageCc` + `isDeviceHello` (pure); device page CC → app
  PATCH + authoritative-engine-page; view-mode re-echo on `resyncVsn1AfterLayoutDeploy`
  (no welcome); **first device hello → welcome + full re-sync; subsequent hello →
  view-mode re-echo + state, NO welcome** (the coordinator's required test); DRUM
  any-key trigger + LCD snap vs EFFECT two-step; welcome never on a page change.

## How mode survives an effect-add re-flash (item 2, confirmed)

An effect add → engine layout auto-deploy → device re-flash → VM restart (view mode
resets to DRUM on-device). Two independent host paths restore it: (a) PRIMARY — the
device emits its readiness hello the moment its receiver re-registers; the host's
`handleDeviceHello` re-echoes the current view-mode CC (+ full feedback) and, because
the DEVICE asks only once ready, the re-echo can't be lost to a restart still in
flight; (b) belt-and-suspenders — the `vsn1LayoutDeploy` WS completion also triggers
`resyncVsn1AfterLayoutDeploy`. Neither re-arms the welcome.

## Per-item status

1. Welcome logo only on connect, never on page change — ✅ (device INIT hi=0;
   host arms on the FIRST device hello of a connection only).
2. View mode survives a re-flash — ✅ (device-hello-driven re-echo, race-free;
   + vsn1LayoutDeploy belt-and-suspenders).
3a. Drum layout fills the freed space (big name/value, mode line, RAISED bar,
    small-button labels) — ✅.
3b. Drum any-key trigger + LCD switch — ✅ (EFFECT keeps two-step).
4. Grid-cell abbreviations back, contrast text — ✅.
5. Side button page change → CaptainPad follows (device page CC → POST page) — ✅.

## What the operator should expect on hardware (flash then test)

- **Boot / first connect:** MarsinLED wordmark, then live layout on the first
  device hello + state push. Wordmark does NOT reappear on any page change.
- **Physical side button:** device changes page AND the CaptainPad page switcher +
  engine follow (lockstep); the device repaints the new page's grid/detail.
- **Effect view (double-click sb_0):** 2x4 grid with a short abbreviation in each
  cell (contrast text), selected cell outlined; compact detail line beneath.
- **Drum view (single-click sb_0):** full-screen readout — big name, big value,
  mode line, ON/P<n>, a value bar raised to leave a bottom strip, and a bottom row
  of labels MODE / - / RESET / OFF above the four small buttons. Pressing ANY key
  fires that slot immediately and the LCD switches to it.
- **Add an effect (auto-deploy re-flash):** the device re-flashes and comes back in
  the SAME view mode (drum/effect) with live state restored — no logo flash.

## DO-NOT-TOUCH honored
No edits to grid_serial.cjs, restore_config.cjs, write/read_config.cjs,
lib/vsn1_layout_deploy.js, lib/api_server.js, lib/global_effect_slot_manager.js,
or any MFT code. `deploy_layout.cjs` changed ONLY in its substitution maps
(`__ABBRS__` added to LCD INIT; `__KINDS__` moved to KEY INIT) — flagged here.
