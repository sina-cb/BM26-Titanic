# Bike Link global-color cadence and bracket ranges

## Outcome

Bike Link now sends the engine's shared global Color 1 and Color 2 values to
every linked controller on a fixed 10-second cadence. The production cadence
is no longer operator-tunable. Previously valid stored cadence values are
migrated explicitly to 10 seconds on load; malformed values still fail loudly.

Target parsing now also accepts inclusive bracket ranges:

- `A.B.C.[D...E]`
- `A.B.C.[D...E]:port`

The existing single-address, explicit-port, and full-address range forms remain
supported. Expansion remains ordered, deduplicated, strictly validated, and
capped at 256 addresses.

The dedicated CaptainPad Bike Link page shows safe examples for every accepted
form above the target editor, explains comma composition and inclusive ranges,
and states the shared-global-color 10-second contract. No real controller
address is present in tracked source, tests, or documentation.

## Changed files

- `marsin_engine/lib/bike_color_share.js`
- `marsin_engine/engine.js`
- `marsin_engine/config.yaml`
- `marsin_engine/tests/io/bike_color_share.test.js`
- `marsin_engine/tests/io/bike_color_share_api.test.js`
- `CaptainPad/components/BikeColorLinkCard.tsx`
- `CaptainPad/components/bike_link_route.test.ts`

## Validation

- Engine Bike Link focused suites: 21/21 pass.
- CaptainPad Bike Link logic, route, navigation, and policy: 54/54 pass.
- CaptainPad TypeScript: pass.
- CaptainPad full lint: zero errors; nine unrelated existing warnings.
- CaptainPad offline web export: pass; `/bike_link` exported.
- Engine dry-run compile/render: pass.
- Repository security scan: pass.
- Changed-file privacy scan: pass.

The spawned-engine test proves two successive shared global Color 1/2 writes
reach a mock controller on the fixed cadence. Unit coverage includes both
bracket forms, malformed and descending ranges, port bounds, address bounds,
the expansion cap, and stored-cadence migration.

## Isolated real-controller evidence

The live run used a normal isolated engine, TEST-NET sACN blackhole, isolated
static CaptainPad export, and nonstandard ports. Through the real Bike Link UI,
an inclusive two-address bracket range named exactly the two previously
authorized controllers and no others.

Both expected controller IDs reached `LINKED`. A distinctive shared global
Color 1/2 update reached both direct controller color API readbacks in 5.336
seconds. Successive isolated push timestamps were 10.146 seconds and 10.134
seconds apart. Both readbacks matched within controller float precision, both
were engine-leased, and the isolated link reported zero failed pushes. Swarm
roles remained leader and follower.

`STOP LINK` left the bracket target persisted with `enabled=false`. The browser,
isolated engine, and static server were stopped, and both alternate listen ports
were verified down. A later controller status check showed a fresh lease renewal
after the isolated engine was already stopped; that renewal belongs to the
operator-owned production link, which remained outside this task's process and
control scope.

## Main-checkout integration

Selectively integrate the seven changed implementation/test files above into
the operator checkout while preserving newer unrelated work. This pass changes
production engine behavior, so after integration the stack owner must restart
the launcher-owned engine. Refresh CaptainPad only through
`node launcher.js rebuild-pad`, then reload the pad; do not copy a worktree
`dist` directory.

No commit or push was made.
