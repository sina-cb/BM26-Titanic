---
name: effects_v2_midi_layout
status: active
owner: Sina (operator) / coordinator agent
created: 2026-07-08
updated: 2026-07-08
---

# Effects v2 — 32 paged slots + VSN1 MIDI layout pipeline

## Goal

Scale the global-effects (GEM) system from 8 slots to **4 pages × 8 = 32
slots**, give every effect **two MIDI-addressable controls** (a 0..1 value +
a discrete mode/toggle), and make the **engine the single source of truth**
that the CaptainPad UI and the VSN1 hardware both mirror — including an
**automatic "MIDI layout" deploy**: when the effects layout changes, the
engine converts it to a VSN1 device config and pushes it to the controller,
where it persists until the next change.

## Locked design (Sina, 2026-07-08)

### Slot model (engine = source of truth)
- 32 flat slots, IDs 1–32. Page p (0–3) views slots `8p+1 .. 8p+8`.
- `effectsPage` (0–3) lives in **engine state**, changed via REST/WS, and is
  broadcast — CaptainPad UI and VSN1 both follow it. Any writer (UI page
  switcher, VSN1 side button, future APC) goes through the engine so all
  surfaces stay in lockstep. No surface keeps a private page.

### Per-effect controls (two, MIDI-addressable)
1. **value** — 0..1 continuous (exists: `primaryIntensity` registry,
   `POST /global-effect-slots/:id/intensity{,/reset}`). VSN1 encoder turn.
2. **mode** — NEW discrete param per effect: `primaryMode`
   `{ label, values: [...], default }` (boolean = 2-value list; tempo
   divisions like 1/4, 1/2, 1x are just values). Cycled by
   `POST /global-effect-slots/:id/mode/cycle` (+ `{value}` set form).
   VSN1 **encoder press = mode cycle** (replaces the old press=reset-intensity;
   intensity reset moves to a long-press or UI-only — builder decides, doc it).
   Enable/disable stays on the slot buttons (behavior-aware, unchanged).
- Both tracked in engine state per slot, persisted, and included in slot
  status + WS broadcasts so UI/MIDI can render them.

### MIDI layout pipeline (engine → device)
- **Layout** = the mapping of the 32 slots (names, effect ids, colors,
  page assignment) — YAML/JSON, versioned, engine-owned.
- On layout change (slot assign/clear/reorder, page rename), the engine
  emits a layout-changed event and **auto-deploys**: converts the layout to
  VSN1 per-element Lua and pushes via the proven
  `marsin_engine/tools/vsn1_config/` serial path (child process). Config
  persists on device flash until the next deploy.
- Param VALUE changes (intensity/mode/active) are **runtime MIDI feedback**,
  NOT layout deploys — the device Lua renders them from incoming MIDI
  (`eventrx_cb`), so knob twists never trigger flash writes.
- Deploy failures fail loudly (device unplugged / port busy) and are
  reported in engine status; no silent retry loops.

### CaptainPad UI
- Effects panel gains a **page switcher** (4 pages × 8 slots). Follows +
  writes `effectsPage` on the engine.
- vsn1.yaml: sb0–sb3 (notes 41–44) → page select 0–3; encoder press → mode
  cycle; keys/jog unchanged otherwise.
- UI edits (layout, values, modes) reflect on the device and vice versa —
  the sync goes through engine state, and **tests must assert these
  connections** (engine↔UI, engine↔MIDI feedback, layout→deploy trigger).

### VSN1 on-device UX (from the field-proven demo)
- Keys: unique/effect colors, LED = slot state. Encoder LED ring must track
  the selected slot's value; LCD shows selected effect name + value bar +
  mode + **current page index**.

## Current state

**Track E ✅ done 2026-07-09** (report `20260709_1_effects_v2_engine.md`):
32 slots, engine-owned `effectsPage` (GET/PATCH /global-effects/page, WS,
persisted), `primaryMode` on all 16 effect modules + `POST …/mode/cycle` /
`…/mode {value}`, layout model + `GET /global-effects/layout` +
`layout-changed` → config-gated deploy hook (writes `vsn1_layout.json` to the
state dir on every change). W2a wiring turned out complete incl. 77 tests.
1853/1859 full suite (6 known env fails). Engine restart still pending.
Track C (CaptainPad) in flight; Track T debugging the cross-page CONFIG ACK
device bug, then finishing `deploy_layout.cjs` integration.

## Pre-v2 state (context)

- Wave-1 foundations LANDED on `feat/party_integration_20260711`
  (uncommitted): engine `primaryIntensity` registry + intensity endpoints
  (report `20260708_4`); CaptainPad vsn1.yaml + selected-slot/pickup runtime
  (`20260708_5`); vsn1_config read/write/restore tools field-proven — Sina
  live-deployed hello_world and the button-context demo (`20260708_6`).
- W2a (wire 7 party effects into GLOBAL_EFFECT_LIBRARY) sits HALF-DONE
  uncommitted (library entries in, its new tests unwritten) — folded into
  this project's engine track.
- Demo hardware feedback (Sina): encoder feel is GREAT; bugs — encoder LED
  ring doesn't show the selected key's value, LCD bar doesn't track the
  encoder, page index missing on screen. Fix in the device track.

## STABILIZATION WAVE (2026-07-09 — after device+host agents land)

Unified diagnosis (review `20260709_7_toggle_trigger_review.md`) — all recent
"broken slot" symptoms = TWO roots:
1. **Device runs a STALE flashed layout** (embedded per-key kinds disagree with
   live engine): toggle-slots flashed as trigger-kind → device drops the sticky
   LED after a real toggle → "toggles not sticking"; also wrong/partial names.
   → FIX: redeploy current layout the moment COM12 is free; then AUTO-DEPLOY so
   it never drifts. Sina's sync decision: auto-deploy OK, **show a "reflashing…"
   window on the device LCD during the flash**, engine must NOT freeze, no
   mid-production effect changes expected.
2. **Trigger black-hole**: VSN1 keys hardcoded to slots 1-8 / channel 0 (NOT
   page-aware — only the knob got `anyChannel`); on page≠0 or boot/WS/restart
   race the behavior lookup misses → press routes to toggle path → `POST
   /:id/toggle` on a trigger (dropHit) is a **silent 200-OK no-op**
   (global_effect_slot_manager.js:844-848). → FIXES: (a) page-aware key→slot
   mapping [CaptainPad host, needs fresh multi-page capture], (b) server-side
   behavior-resolved `press` action + triggers REJECT non-firing actions loudly
   [engine], (c) select-cue LED + ~250ms commit debounce [host].

Also: **#1 "can't remove/change in CaptainPad" is UI-side** — engine swap/clear
PATCH verified working live (bound+cleared slot 8). Fix is in GlobalEffectMacros
/ SwapSheet, AFTER the 3 concurrent CaptainPad agents land (collision guard).
Also: live-engine slot state got scrambled by agents' test-POSTs (dup uvBlast
slot 5) — tell agents to stop mutating the live engine; use isolated test
engines. Two-step stays for TOGGLES only (with a visible select cue); triggers
stay fully bypassed (single press fires every time).

## Work tracks (multi-agent; disjoint zones)

| Track | Zone | Scope |
|---|---|---|
| **E — engine** | `marsin_engine/lib`, `effects/`, `tests/` | 32 slots + `effectsPage` state/API/WS; `primaryMode` registry + endpoints; finish W2a library wiring; layout model + layout-changed event + deploy hook (child-process call, mockable in tests) |
| **C — CaptainPad** | `CaptainPad/` | paged effects UI + page switcher; sb0–3 page mapping + encoder-press=mode in vsn1.yaml/runtime; state-sync plumbing + connection tests |
| **T — device/tools** | `marsin_engine/tools/vsn1_config/` | demo bug fixes (encoder ring, LCD bar, page index); `deploy_layout.cjs`: layout JSON → per-element Lua → serial deploy; runtime-feedback Lua (eventrx_cb renders value/mode/active from MIDI) |

Contract pins (so tracks run in parallel): slot IDs 1–32; page = engine
`effectsPage` via `GET/PATCH /global-effects/page` + WS broadcast; mode via
`POST /global-effect-slots/:id/mode/cycle`; layout deploy invoked as
`node tools/vsn1_config/deploy_layout.cjs --layout <file> [--live]`.

## Links

- **Plans:** party plan (private repo) `BM26-Firmware-Deployment/.agent/plans/20260707_party_plan_20260711.md` — tracked there as the active B18 successor task
- **Reports:** `../reports/202607/20260708_4..8_*.md` (foundations)
- **Branches:** `feat/party_integration_20260711`

## Decisions log

- **2026-07-08** — 8→32 slots as 4 pages × 8; page state lives in the engine
  (single source of truth) so UI + MIDI never diverge. (Sina)
- **2026-07-08** — two MIDI controls per effect: value 0..1 + discrete
  mode/toggle on encoder press. Enable/disable remains on buttons. (Sina)
- **2026-07-08** — layout changes auto-deploy to the VSN1 from the engine;
  runtime values go over MIDI feedback, never flash writes. (Sina)
- **2026-07-08** — VSN1 key LED colors confirmed fully scriptable; use them
  for slot state.

## Next steps

- [ ] Track E, C, T agents dispatched in parallel (short briefs, pinned contracts)
- [ ] Integration wave: engine restart, full-stack smoke, connection tests green
- [ ] Layout auto-deploy demo: change a slot in CaptainPad → VSN1 re-flashes
- [ ] Sina hardware pass on the fixed demo + first real effects layout
