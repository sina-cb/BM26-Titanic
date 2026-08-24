# Bike Link dedicated page and live validation

## Outcome

Bike Link now lives on a dedicated CaptainPad CONFIG sub-view at
`/bike_link`. The initial action saves the target set and enables the link in
one request, live target edits use a separate save action, and stopping the
link preserves the targets. Polling does not overwrite a focused or dirty
target draft, writes are followed by a server reread, and errors are shown
without optimistic success.

The suspected startup failure was reproduced: enabling an empty target set
returns HTTP 400. The engine continued serving both Bike Link and general
status immediately afterward, so there was no separate engine crash to fix.

## Changed files

- `CaptainPad/app/(tabs)/bike_link.tsx`
- `CaptainPad/app/(tabs)/config.tsx`
- `CaptainPad/app/(tabs)/_layout.tsx`
- `CaptainPad/components/BikeColorLinkCard.tsx`
- `CaptainPad/components/bike_link_logic.ts`
- `CaptainPad/components/bike_link_logic.test.ts`
- `CaptainPad/components/bike_link_route.test.ts`
- `CaptainPad/components/config_subview_frame.tsx`
- `CaptainPad/utils/captainpad_tab_policy.ts`
- `CaptainPad/utils/captainpad_tab_policy.test.ts`
- `marsin_engine/tests/io/bike_color_share_api.test.js`

No production engine source changed in this pass. No real controller address
was added to tracked source or documentation.

## Automated validation

- Engine Bike Link focused suites: 19/19 pass, including the HTTP 400 and
  subsequent liveness proof.
- CaptainPad Bike Link logic, route, navigation, and policy: 53/53 pass.
- CaptainPad TypeScript: pass.
- CaptainPad full lint: zero errors; nine unrelated existing warnings.
- CaptainPad offline web export: pass; `/bike_link` exported.
- Engine pattern listing and dry-run compile/render gates: pass.

## Isolated live evidence

The test used a normal isolated engine with only the TEST-NET sACN blackhole,
an isolated static CaptainPad export, and nonstandard loopback ports. The
operator-owned standard-port production stack and its launcher lock were not
touched.

Through the real CaptainPad UI, the two operator-authorized targets linked as
`bike_1_sina` and `bike_2_ramin`. Both showed fresh status, active leases, and
successful pushes. A supported two-color palette update read back from both
controller color APIs within float precision while each controller remained
engine-leased. Swarm roles stayed leader and follower respectively.

`SAVE TARGETS` preserved the running link. `STOP LINK` produced server truth
with `enabled=false` while retaining the target set. After the normal lease
window, both exact controller status reads showed no active lease; Swarm roles
were still unchanged.

Temporary landscape captures:

1. `~/tmp/bm26_bike_link_live_a2c1/screenshots/01_config_setup_surfaces.png`
2. `~/tmp/bm26_bike_link_live_a2c1/screenshots/02_startup_validation_error.png`
3. `~/tmp/bm26_bike_link_live_a2c1/screenshots/03_targets_entered_before_start.png`
4. `~/tmp/bm26_bike_link_live_a2c1/screenshots/04_both_bikes_linked.png`

The isolated engine and static server were stopped, and both alternate listen
ports were verified down. The operator-owned production processes remained
outside this task's process scope.

## Physical pad handoff

1. Integrate these worktree changes into the operator checkout under separate
   git authority, then rebuild/reload CaptainPad. If that checkout's engine
   predates the Bike Link API, the operator must restart the launcher only
   after the engine implementation has landed.
2. Open CONFIG, select BIKE LINK, enter the two approved targets, and use
   `SAVE & START`.
3. Wait for both controller IDs to show `LINKED`, fresh status, active leases,
   and successful push counts.
4. Exercise the normal supported color surface and confirm both rows remain
   healthy.
5. Use `STOP LINK`; confirm `LINK STOPPED`, retained targets, and eventual
   controller lease release.

No commit or push was made.
