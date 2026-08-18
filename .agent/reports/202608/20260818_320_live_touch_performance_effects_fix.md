# Live Touch Performance effects P0 fix

## Outcome

The two `_316` review root causes are fixed without changing the durable/shared
effect-slot manager:

1. Passive and pre-lease Performance projection is blocked until Live Touch is
   fully `armed`. The ordinary refresh path is blocked at the same boundary, so
   a DISARMED or ARMING page cannot issue the owner-tagged slot GET that falls
   through to the shared bank.
2. An already-owned Live Touch session now synchronizes its transient slot
   manager only when Performance mode actually changes. Same-mode lease renewal
   remains a no-op and preserves live action state.

Performance mode entry and every exit path synchronize an active Live Touch
session. A mode change stops running session effects, replaces only the private
slot manager, preserves the rest of the Live session, and advances its revision.

The Performance Effects grid now presents an explicit disabled state and
`ARM to use effects` hint until authoritative slots arrive. DISARM clears the
projected bindings and lit/pending state. Effect truth is read from the engine's
per-slot `active` flags, including movement overlays.

## Ownership and changed surface

The retained in-flight changes in `docs/ui/touch_control_wire.js` were preserved
and extended. This fix changes only:

- `docs/ui/touch_control.html`
- `docs/ui/touch_control_wire.js` (shared/in-flight ownership)
- `marsin_engine/lib/api_server.js`
- `marsin_engine/lib/live_touch_session_context.js`
- `marsin_engine/tests/effects/live_touch_session_performance_authority.test.js`
- `simulation/tests/live_touch_ui_layout.test.js`

All unrelated dirty-tree files and runtime-state residue were left untouched.
No git write operation was performed.

## Acceptance evidence

- Engine same-owner Edit -> Performance -> Edit: PASS, including exact canonical
  slots 9-24, running-effect deactivation, same-mode renewal preservation,
  shared manager equality, and durable slot-file byte equality.
- Focused engine authority suite: 4/4 PASS.
- Real browser pointer path: PASS. Puppeteer sends real mouse down/up events to
  `.fx-cell [data-role=fxface]`; toggle reconciles on then off and hold sends
  ordered down/up, with engine readback authoritative.
- DISARMED/ARMING Performance: PASS. No `/global-effect-slots` request, no
  operator error, no bindings, all faces disabled, ARM hint visible.
- Trigger/toggle engine action contracts: 65/65 PASS.
- Touch wire/lifecycle contracts: 40/40 PASS.
- Protected Spatial stroke-id contracts: 9/9 PASS.
- Pixel-view artifact check: PASS.
- Engine list and dry-run checks: PASS.
- CaptainPad TypeScript: PASS.
- CaptainPad lint: PASS with zero errors and nine existing warnings.
- Fresh offline web export to `~/tmp/live_touch_performance_export_20260818_01`:
  PASS.
- Syntax and diff whitespace checks: PASS.

The simulation full suite completed 2459 passes out of 2462 tests, with one
known todo. Its two reported failures were the pre-existing repo-scene residue
guard and a browser-load Spatial timeout; the Spatial case passed immediately
when rerun alone. Every changed Live Touch UI test passed in the full run.

The engine full suite completed 3867 passes out of 3888 tests. Its 21 failures
are outside this patch surface and expose concurrent dirty-tree campaigns
(retired movement API expectations, dev model sidecar drift, pattern/gallery,
White/UV, and wedding playlist work). The focused Live Touch authority and
global-effect behavior suites are green.

## Screenshots

Isolated iPad-landscape evidence is in
`~/tmp/live_touch_stabilization_evidence/`:

- `native_ipad_landscape_effects_performance_disarmed.png`
- `native_ipad_landscape_effects_performance_armed.png`

## Remaining operator gate

Physical-iPad acceptance against the live production surface remains required.
The live stack was not written, restarted, rebound, armed, or disarmed during
this work.
