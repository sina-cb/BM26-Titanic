# DMX / LXStudio-TE / Chromatik Test Bench Analysis

Date: 2026-03-28
Analyzed repos:
- `C:\Users\sina_\workspace\LXStudio-TE`
- `C:\Users\sina_\workspace\BM26-Titanic`

## Executive summary

The BM26 Node.js test bench works because it assembles one shared 512-channel universe buffer and sends one sACN packet per universe. LXStudio-TE currently does something different: it creates one `DmxOutput` per fixture and sends a full 512-slot sACN packet for each fixture, even when multiple fixtures share universe 1. The smart router does not merge those packets; it forwards each one as it arrives. That means later fixture packets overwrite earlier fixtures on the same universe.

There is also a direct channel-address regression in the new `DmxOutput` logic. The codebase documents and uses `dmxChannel` as a 0-based DMX offset, but the new loop treats it as if it were 1-based. For the Titanic test bench PARs, LXStudio-TE now emits channels `135-144`, `145-154`, `155-164`, `165-174`, while BM26 expects `136-145`, `146-155`, `156-165`, `166-175`. On a dimmer-first fixture like the UKing PAR, that shift is enough to make the fixture appear dead even if packets are arriving.

Priority is not the main cause of the current failure. The router treats any input `>= 150` as the high-priority winner, and the LXStudio-TE test bench fixtures are configured to send `200`, so the router will forward them. The real failures are packet aggregation and channel alignment.

A separate architectural gap also remains: normal Chromatik pixel patterns do not automatically drive `UkingParModel`. Right now only code that explicitly writes DMX fields will control those PARs.

## What the working BM26 path does

### Universe topology

`dmx/universes.yaml` defines the test bench as one sACN universe routed to localhost:
- Controller target: `127.0.0.1`
- Universe: `1`
- Priority: `100`
- PAR start addresses: `136`, `146`, `156`, `166`

Relevant lines:
- `C:\Users\sina_\workspace\BM26-Titanic\dmx\universes.yaml:47-50`
- `C:\Users\sina_\workspace\BM26-Titanic\dmx\universes.yaml:52-74`

### Shared-buffer model

`DmxUniverse` attaches every fixture into one shared `Buffer.alloc(512, 0)` and converts each fixture's 1-indexed DMX start address into a 0-based byte offset with `dmxStartAddress - 1`.

Relevant lines:
- `C:\Users\sina_\workspace\BM26-Titanic\dmx\lib\DmxUniverse.js:35-37`
- `C:\Users\sina_\workspace\BM26-Titanic\dmx\lib\DmxUniverse.js:66-80`

It then sends exactly one combined payload for the whole universe:
- `C:\Users\sina_\workspace\BM26-Titanic\dmx\lib\DmxUniverse.js:131-148`

### Test bench frame flow

`testbench_helloworld.js` writes all fixtures first and only then calls `bench.send()` once per frame:
- `C:\Users\sina_\workspace\BM26-Titanic\dmx\test\testbench_helloworld.js:116-156`

That is the key reason the BM26 path behaves correctly.

## What LXStudio-TE currently does

### One output per fixture, not per universe

`DmxEngine.sendFinalDmx()` loops over every `DmxModel`, stages one fixture buffer, and sends it immediately:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\DmxEngine.java:553-581`

`createOutput()` also creates one `DmxOutput` per fixture:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\DmxEngine.java:585-586`

### Every Titanic test bench fixture is on the same universe

The Titanic PAR fixtures are all configured to send to localhost, universe 1:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\Fixtures\Titanic\UkingPar1.lxf:6-10`
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\Fixtures\Titanic\UkingPar2.lxf:6-10`
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\Fixtures\Titanic\UkingPar3.lxf:6-10`
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\Fixtures\Titanic\UkingPar4.lxf:6-10`

The composite `TestBench.lxf` also places additional fixtures on that same universe via offset semantics:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\Fixtures\Titanic\TestBench.lxf:9-21`

### Full-universe packet padding per fixture

The current `DmxOutput` now creates `new int[512]` and sends a padded full-universe packet for each fixture:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\DmxOutput.java:84-95`

This is the exact opposite of the BM26 combined-universe model.

### Router behavior

The smart router does not merge same-universe packets. It forwards each packet immediately:
- Receive path: `C:\Users\sina_\workspace\BM26-Titanic\dmx\smart_router\sacn_smart_router.js:40-119`
- Forward call: `C:\Users\sina_\workspace\BM26-Titanic\dmx\smart_router\sacn_smart_router.js:121-124`

So if LXStudio-TE sends multiple padded universe-1 packets in one frame, the later packets overwrite the earlier ones at the router/hardware level.

## Primary finding 1: same-universe packets are clobbering each other

This is the most important architectural mismatch.

BM26 test bench behavior:
- One universe buffer
- One packet per frame
- All fixtures coexist in that packet

LXStudio-TE behavior today:
- One `DmxOutput` per fixture
- One padded 512-slot packet per fixture
- Multiple packets for universe 1 in the same frame

Because the current LXStudio-TE packet is padded to 512 slots, each fixture packet explicitly carries zeros for channels owned by every other fixture. That makes the overwrite deterministic.

This also explains why the setup may have "worked a little bit" before the recent sACN work. The current uncommitted `git diff` for `DmxOutput.java` shows a major behavior change from the old per-segment offset packet to a forced 512-slot padded packet. Even if the earlier behavior was never architecturally correct for multiple fixtures on one universe, the new code removes any accidental tolerance that may have masked that problem.

## Primary finding 2: the new `dmxChannel` math is off by one

`DmxModel` documents `dmxChannel` as a starting DMX channel offset, not a 1-indexed DMX address:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\model\DmxModel.java:367-369`

The previous output model also treated it like an offset by placing the segment at `definition.channel`.

The current code instead computes:
- `localIndex = loopIndex - (definition.channel - 1)`

Relevant lines:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\DmxOutput.java:56-68`

That changes the meaning of `dmxChannel` from 0-based offset to 1-based address.

### Concrete PAR mismatch

Current LXStudio-TE output from the existing fixture files:
- `dmx_channel: 135` emits DMX `135-144`
- `dmx_channel: 145` emits DMX `145-154`
- `dmx_channel: 155` emits DMX `155-164`
- `dmx_channel: 165` emits DMX `165-174`

Expected by BM26 universe config:
- PAR 1: `136-145`
- PAR 2: `146-155`
- PAR 3: `156-165`
- PAR 4: `166-175`

This one-slot shift is especially damaging for the UKing PAR because channel 1 is the master dimmer. Under the current code, the intended dimmer value lands one slot too early and the physical dimmer channel receives the intended red value instead.

### Broader impact beyond the test bench

This is not limited to the new Titanic fixtures. Existing fixtures in LXStudio-TE already use `dmx_channel: 0`, for example:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\Fixtures\Beacons\DJLightLeft.lxf:5-8`
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\Fixtures\Beacons\DjLightRight.lxf:5-8`

With the current formula, a fixture at offset `0` can never emit its first field at DMX channel 1. That confirms this is a real regression in output semantics, not just a bad test bench config.

## Primary finding 3: priority is not the root cause

The router's arbitration logic is simple:
- If priority `>= 150`, treat it as the winning high-priority source and forward it.
- Forwarded packets are then sent to hardware with router priority `200`.

Relevant lines:
- Threshold logic: `C:\Users\sina_\workspace\BM26-Titanic\dmx\smart_router\sacn_smart_router.js:86-103`
- Forwarded output priority: `C:\Users\sina_\workspace\BM26-Titanic\dmx\smart_router\sacn_smart_router.js:14-20`

The Titanic PAR fixtures in LXStudio-TE are configured to send priority `200` already:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\Fixtures\Titanic\UkingPar1.lxf:9-10`
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\Fixtures\Titanic\UkingPar2.lxf:9-10`
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\Fixtures\Titanic\UkingPar3.lxf:9-10`
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\Fixtures\Titanic\UkingPar4.lxf:9-10`

So the router will not ignore them. Priority only decides who wins; it does not explain why the winning payload is wrong.

The only practical note here is consistency: the smart-router README still says Chromatik should use `150`, while the new LX test bench fixtures use `200`. That inconsistency is confusing for humans, but it is not what is breaking output.

## Primary finding 4: generic Chromatik patterns still do not drive `UkingParModel`

The DMX path in LXStudio-TE is not a general "mirror arbitrary rendered color into DMX fixtures" system.

`DmxPattern` only works when a pattern explicitly writes DMX fields into the DMX buffer:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\pattern\DmxPattern.java:43-47`
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\pattern\DmxPattern.java:49-108`

For the UKing PARs, the only explicit writer currently present is `TestBenchPattern`:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\pattern\TestBenchPattern.java:47-58`

There is no generic `DmxColorMapperEffect` or equivalent implementation in the codebase. The design note for that exists in `.agent/designs/01_dmx_sacn.md`, but the implementation does not.

That means:
- Adding PAR fixtures to the Chromatik model does not automatically make ordinary pixel patterns control them.
- Even after transport is fixed, you still need either a dedicated PAR DMX pattern or a generic color-to-DMX mapper.

## Secondary note: `TestBenchPattern` is still in debug mode

If you are using `TestBenchPattern` for validation, note that it currently hardcodes red to full:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\pattern\TestBenchPattern.java:41`

So even once transport works, this pattern will not be a faithful color test until that debug line is removed.

## Most likely current real-world behavior

Based on the code as it exists on 2026-03-28, the most likely runtime behavior is:

1. LXStudio-TE is sending sACN traffic to `127.0.0.1` successfully.
2. The smart router is accepting that traffic as the high-priority source.
3. Each fixture sends its own padded universe-1 packet.
4. Those packets overwrite one another because the router forwards them individually.
5. The PAR channel ranges are also shifted one slot early, so even the packet that reaches the hardware does not line up with the physical fixture's dimmer/red/green/blue channel order.
6. Result: the PARs look dead or nonsensical even though traffic may still exist on the wire.

## Recommended fix order

1. Fix the transport architecture first.
   - LXStudio-TE needs one output packet per `(host, protocol, universe)` group, not one packet per fixture.
   - This should mirror the BM26 `DmxUniverse` design: shared 512-channel universe buffer, then one send per universe.

2. Fix the channel-offset regression second.
   - Restore `dmxChannel` to true 0-based offset semantics.
   - In practice that means either:
     - change the new loop math to use `definition.channel` directly, not `definition.channel - 1`, or
     - revert to segment-based channel placement and let the LX datagram classes handle the protocol buffer offset.

3. Only after transport is stable, decide how Chromatik should control PARs.
   - If dedicated DMX patterns are acceptable, keep using explicit `UkingParModel` writers.
   - If the goal is "ordinary Chromatik color patterns should drive the PARs", then a generic RGB-to-DMX mapper still has to be implemented.

4. Normalize priority after the above is fixed.
   - Using `150` on the LX side would align with the router README and still win over the BM26 test bench at `100`.
   - This is optional cleanup, not the root fix.

## Bottom line

The current failure is not primarily "sACN priority broke the fixtures." The actual situation is:
- LXStudio-TE now sends full-universe packets per fixture instead of one merged packet per universe.
- Those packets overwrite each other on universe 1.
- The new output code also shifted DMX addresses one slot early.
- Generic Chromatik color output still does not automatically map into `UkingParModel`.

That combination fully explains why the BM26 Node.js test bench works while the Chromatik/LXStudio-TE path does not.

## Follow-up: Chromatik visualization for DMX patterns

To make DMX-driven fixtures read clearly inside Chromatik, the correct pattern/effect behavior is not just "write DMX". It is:
- Write the DMX channels.
- Also mirror an approximate preview color back onto the fixture's LX point with `setColor(d.model, previewColor)`.

That should be the standard rule for all DMX patterns/effects that target visible fixtures.

### Why this matters

Without the preview writeback, the hardware may be receiving valid DMX while the on-screen fixture point remains black or misleading. This is especially true for fixtures like the UKing PAR where the useful channels are not just RGB, but `White`, `Amber`, and `UV` as well.

### Good preview behavior for the UKing PAR

For `UkingParModel`, the preview color should be synthesized from the actual DMX values being sent, not just the source RGB pixel:
- `R`, `G`, `B` contribute directly.
- `White` should brighten all three preview channels.
- `Amber` should bias the preview toward warm red/yellow.
- `UV` should bias the preview toward violet/blue.

This makes white/amber/UV-only looks visible in Chromatik even though the screen itself is still RGB.

### Concrete implementation points

The right extension points in the LXStudio-TE codebase are:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\effect\DjLightsColorMapperEffect.java`
  - The mapper effect should preview the mapped DMX result, not only the source color.
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\pattern\TestBenchPattern.java`
  - Dedicated PAR test patterns should also call `setColor(...)` so their white/amber/UV phases are visible in the model.

### Additional ideas beyond the basic preview

1. Add a `Preview Mode` selector to the mapper effect.
   - `Mapped Output`: show the synthesized DMX output preview.
   - `Source Color`: show the original sampled pixel color.
   - `Off`: write DMX only, leave the model untouched.

2. Add per-fixture debug labels in the UI.
   - Show current mapper mode (`RGB` or `WAU`) and the static fill values.

3. Add a small DMX monitor/modulator-style panel later.
   - A compact readout of `R/G/B/W/A/UV` per selected fixture would make debugging much easier than watching raw packets.

## Follow-up: configurable channel mapping in `DjLightsColorMapperEffect`

The clean design for the color mapper effect is to treat the UKing PAR as two logical channel groups:
- `RGB`
- `WAU` (`White`, `Amber`, `UV`)

Then the effect chooses which group is driven dynamically by the rendered pixel color, while the other group is held at static UI-controlled values.

### Recommended mapping behavior

#### Mode: `RGB`

Use the sampled rendered color for:
- `Red`
- `Green`
- `Blue`

Use UI knobs for static values on:
- `White`
- `Amber`
- `UV`

This is the right mode when you want Chromatik's normal color patterns to behave like a standard RGB wash, while still letting you season the output with constant warm/UV components.

#### Mode: `WAU`

Use the sampled rendered color channels as three independent modulators for:
- rendered `R` -> fixture `White`
- rendered `G` -> fixture `Amber`
- rendered `B` -> fixture `UV`

Use UI knobs for static values on:
- `Red`
- `Green`
- `Blue`

This is the right mode when you want the rendered pattern to animate the non-RGB emitters while holding a base RGB color underneath.

### Required fixed channels for sane operation

For `UkingParModel`, the mapper should always also force the non-color channels into a safe manual state:
- `Dimmer`: open when any mapped/static output is non-zero
- `Strobe`: `0`
- `Function`: `0`
- `Speed`: `0`

That prevents the fixture from drifting into internal macros or appearing black due to the master dimmer channel.

### UI shape that fits Chromatik well

The effect UI should be a small dedicated device panel with:
- a `Mapped` drop-down (`RGB` / `WAU`)
- a `Preview` toggle
- one static-value column for `RGB`
- one static-value column for `WAU`

The two static columns should be mutually exclusive in visibility:
- if `Mapped = RGB`, show only `Static WAU`
- if `Mapped = WAU`, show only `Static RGB`

That keeps the UI obvious and prevents the operator from thinking both groups are being dynamically mapped at once.

### Concrete implementation points

The right files for this are:
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\dmx\effect\DjLightsColorMapperEffect.java`
  - add the `Mapped` mode parameter, static fill parameters, preview toggle, and the actual mapping logic.
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\titanicsend\ui\effect\UIDjLightsColorMapperEffect.java`
  - dedicated effect UI with mode-dependent visibility.
- `C:\Users\sina_\workspace\LXStudio-TE\te-app\src\main\java\heronarts\lx\studio\TEApp.java`
  - register the custom effect UI with the LXStudio registry.

### Practical note about non-UKing fixtures

This `RGB` vs `WAU` split is specifically meaningful for `UkingParModel` because that fixture has all six color emitters.

For `AdjStealthModel` and other RGBW fixtures, the same UI can still coexist, but the `WAU` concept is not a natural fit. The clean long-term answer is:
- keep the current RGBW mapping for RGBW fixtures, or
- split the mapper into fixture-specific effects if you want the UI semantics to stay perfectly literal.
