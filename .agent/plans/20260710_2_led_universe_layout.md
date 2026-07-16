# 2026-07-10 — LED DMX-parity universe layout (RGBW 4 B/px) — plan

**Branch:** `feat/led_integration` (worktree `kind-banach-95157b`).
**Parent plans:** `.agent/plans/20260709_0_led_integration_execution.md` (P1–P6 +
Round 2 landed), `.agent/plans/20260710_1_led_patching_grouping_look.md`
(S1–S4 landed; S4 = manual per-output universes, report
`.agent/reports/202607/20260710_5_led_manual_universe.md`).
**Test baseline verified in this worktree:** `cd simulation && npm test` →
**235 pass / 0 fail** (2026-07-10). Every slice keeps it green and adds tests.
**Laws:** codex P0 (fail loud, no fallbacks, imports at top, snake_case),
`.agent/os/nodejs_style.md`, `.agent/os/ui_design.md`.
**HARD CONSTRAINTS:**

- The `test_bench` scene is **LOCKED** by another project. **No slice may edit
  anything under `simulation/scenes/test_bench/` or
  `marsin_engine/models/test_bench.*`.** All verification is unit tests
  (synthetic registries, pure functions) and — optionally — a throwaway scene
  created through the sim's own New Scene flow and **never committed** (delete
  it before reporting; it must not be named test_bench).
- **No device contact** (`10.x.x.201` is the operator's). No live pushes, no
  GETs; mocks only.
- **No git operations** until the operator asks.

## Goal

LED strands get a **full DMX-parity universe layout at RGBW = 4 bytes/pixel**:
512 ch/universe → **128 RGBW px/universe**, pixels spill whole into the next
universe (a pixel never straddles a boundary), start addresses and
multi-universe spans computed by the **same conceptual allocator** DMX uses,
and surfaced in the **UI and patches.yaml like DMX** — universe + start
channel **per segment** (and per pixel in the exported engine model, which
already carries it). Bound-controller byte layout must stay **byte-for-byte
identical** to today's shipped device-linear layout (= what the MarsinLED
firmware renders, docs/41 §3) — this plan is representational + unbound-path
fixes, never a re-map of hardware bytes.

---

## Part 1 — How DMX allocates today (the parity reference)

Exact data shapes and algorithm, all verified at file:line:

- **Constants** — `simulation/src/dmx/controller_registry.js:56-58`:
  `DMX_UNIVERSE_SIZE = 512`, `EFFECTS_UNIVERSE = 1`, `MAX_UNIVERSE = 63999`.
- **Allocation model** (header lines 15-21, docs/33 decision 19): every chain
  entry stores its **absolute address** `{fixture, at}` / `{gap, at}`,
  assigned **once at add time** from the end of the universe's occupancy map,
  **sticky** thereafter. Holes from removals stay (never reshuffled).
- **The allocator** — `simulation/src/gui/controller_map_editor.js:329-338`
  `makeAllocator(universe)`:
  `end = computeProjection().universeEnds.get(universe) || 0`;
  `at = end + 1`; **returns null when `end + footprint > 512`** — a DMX
  fixture never spans universes and never silently wraps; the operator picks
  another universe/port. Live preview of "next: ch N" at lines 1645-1649.
- **Universe allocation** — `controller_registry.js:507-517`
  `nextFreeUniverse` / `noteUniverseUsed`: **monotonic high-water mark**
  (`registry.nextUniverse`), universes never reused; `addPort` (919-930)
  assigns `port.universe = nextFreeUniverse(registry)` and bumps the mark.
- **Projection** — `computeProjection` (`controller_registry.js:1255-1601`):
  validates each entry (`at ≥ 1`, `at + footprint − 1 ≤ 512`, else
  `pin_overflow` → unpatched, lines 1494-1502), aggregates per-universe
  `occupancy` claims `{start, end, name, item, controllerId, portNum, effect}`
  (1340-1347), then builds `universeMaps` (sorted valid claims) +
  `universeEnds` (one past the last claim) with the overlap sweep — overlaps
  **warn, both kept** (1561-1598). Returns
  `{fields, violations, portLayouts, universeEnds, universeMaps}` (1236-1253).
- **patches.yaml fixture shape** — `simulation/main.js:389-402` mirrors
  `{controllerIp, dmxUniverse, dmxAddress, controllerId, sectionId,
  fixtureId, viewMask}` into `window.__globalPatchTree`; the save server
  extracts it. Projected `controllerId` = the controller's 1-based **panel
  ordinal** (docs/33 decision 20; `controller_registry.js:1276-1285`).

**Parity essence:** universe capacity is a hard wall per claim (no straddle),
occupancy is a first-class per-universe map the UI renders and the allocator
reads, and every patched thing surfaces `U:addr` in patches.yaml and the UI.

## Part 2 — Current LED layout and where it diverges

- **The walker (single source of truth, already shipped)** —
  `simulation/src/dmx/led/led_patch_projection.js:61-77`
  `projectLedStrandPixels(universe, channel, stride, count)` →
  `{pixels: [{universe, addr}…], universe, channel, overflow}`. Whole-pixel
  spill: `if (channel + stride - 1 > 512) { universe += 1; channel = 1 }` —
  **exactly 128 RGBW px per universe at ch 1**, no straddle, loud `overflow`
  past `MAX_UNIVERSE`. This is already the DMX-parity byte rule; the plan
  reuses it everywhere rather than re-deriving math.
- **Bound (device) projection** — `computeLedStrandPatches`
  (`led_patch_projection.js:92-193`): device-bound LED controllers only; base
  = first enabled output's `port.universe`
  (`device_config_mapper.js:87-95 firstEnabledPortUniverse`) + `led.startAddr`;
  one contiguous cursor across ports sorted by port number (145-189), walking
  `projectLedStrandPixels` per strand. Per-strand record:
  `{controllerIp, controllerId (ordinal), dmxUniverse, dmxAddress,
  pixelCount, outputIndex}` (180-187) — **START ONLY**. Matches the firmware
  (`computeLinearLayout`, `device_config_mapper.js:295-402`, which already
  builds per-**output** `segments` — but nothing builds per-**strand**
  segments).
- **Unbound projection** — `computeLedProjection`
  (`controller_registry.js:1134-1224`): per-port lane anchored at
  `led.baseUniverse > 0 ? led.baseUniverse : port.universe` (1161-1163) +
  `led.startAddr`; optional per-strand `at` pin (1184-1186); whole-pixel
  cursor walk (1209-1219) — same wrap semantics as the walker. Record:
  `{controllerId, controllerIp, universe, addr, stride, order, whiteMode,
  footprint, ledCount}` (1195-1205).
- **Exporter** — `simulation/src/dmx/pixelblaze_model_exporter.js:227-386`:
  merges generic + device projections (263-286); **device-bound** per-pixel
  patches come from the shared walker (300-302, 315-319) — correct; the
  **unbound** per-pixel path (320-334) uses a dense-byte formula
  (`uniSpan = floor(startByte/512)`) instead of the walker.
- **Persistence** — `simulation/main.js:427-483`
  `window.projectLedStrandPatches` copies the six fields onto
  `params.ledStrands[i]` + `window.__globalPatchTree`;
  `simulation/server/save-server.js:189-254` emits the strand record
  `{controllerIp, controllerId, dmxUniverse, dmxAddress, pixelCount,
  outputIndex}` into patches.yaml and strips those six from
  scene_config.yaml.
- **UI** — `simulation/src/gui/controller_map_editor.js:947-1002`: strand
  chips show `U{u}:{a} ×{px}px` (start only, 963-968); the per-output derived
  line shows the output span (985-1002); the DMX universe bars render
  `computeProjection().universeMaps` — **LED occupancy is absent** from bars
  and from `universeEnds`.

### The five concrete parity gaps

- **G1 — No per-segment surfacing.** A 200 px strand really occupies
  `U6 ch1–512 (128 px)` **and** `U7 ch1–288 (72 px)`, but patches.yaml + the
  strand chip + the strand GUI folder show only `U6:1`. The operator asked
  for universe + start channel per segment, like DMX.
- **G2 — Spill universes never auto-subscribe.**
  `simulation/src/dmx/patch_manager.js:44-60 deriveSubscribedUniverses` adds
  only `strand.dmxUniverse` (the START universe). A strand spanning U6→U7
  leaves U7 unsubscribed — pixels 129+ dark in the sim under sACN-in.
- **G3 — Exporter unbound per-pixel math diverges from the walker.**
  `pixelblaze_model_exporter.js:320-334`: the dense-byte formula ignores the
  tail bytes skipped at each no-straddle wrap. Worked example (stride 4,
  startAddr 3): pixel 127 wraps to `U+1 ch1` in both models, but pixel 128
  lands at `U+1 ch5` per the walker vs `U+1 ch3` per the formula. Only
  `(startAddr − 1) % stride == 0` layouts agree today.
- **G4 — Spill universes are never reserved in the universe allocator.**
  `computeLedProjection` calls `noteUniverseUsed` only for the strand's
  START universe (`controller_registry.js:1206`); `computeLedStrandPatches`
  is pure and reserves nothing. So `addPort`'s `nextFreeUniverse` can hand a
  brand-new port the very universe a 200 px strand already spills into —
  exactly the "silently re-meaning addresses" hazard the DMX high-water mark
  exists to prevent (`controller_registry.js:452-464`).
- **G5 — LED occupancy is invisible to the operator's universe map.** DMX
  claims render as universe bars and feed overlap warnings; LED spans only
  appear via `validateLedManualUniverses` warnings
  (`led_patch_projection.js:289-347`) — no per-universe claim map, nothing in
  the bars.

## Part 3 — Device reconciliation (what must NOT change)

docs/41 §3 (`docs/41_led_controller_onboarding.md:72-106`): the MarsinLED
firmware maps sACN channels **linearly and contiguously across enabled
outputs** from a single `(dmx.universe, dmx.startAddress)`, 4 B/px RGBW,
spilling whole pixels at 512 (128 px/universe), skipping disabled outputs.
`computeLinearLayout` reproduces it byte-for-byte and
`computeLedStrandPatches` walks the identical cursor. **Therefore: for bound
controllers, every address this plan surfaces must be a derived VIEW of the
existing walker — zero byte movement.** The S4 manual per-output universes
(base = first enabled output, honorability warnings, never rewrite/block)
stay exactly as shipped. The operator's separate per-output-universe firmware
request is out of scope — this plan targets today's single-base firmware.

## Part 4 — Shipped work this plan builds on (do not duplicate)

Reports `.agent/reports/202607/`: `20260709_1` (client+mapper),
`20260709_3` (discovery UI), `20260710_1` (exporter device-linear override),
`20260710_2` (round 2 UI), `20260710_4` (LED groups/metadata),
`20260710_5` (S4 manual universes). Reuse, never reimplement:
`projectLedStrandPixels`, `computeLedStrandPatches`, `computeLinearLayout`,
`synthLinearConfig`, `firstEnabledPortUniverse`, `validateLedManualUniverses`,
`ledStrideForOrder`, `LED_CHANNEL_ORDERS` (RGBW stride 4 default,
`controller_registry.js:95-106`).

---

## Slices (Opus-implementable, file-disjoint, dependency-ordered)

### L1 — Segment walker + per-strand segments + LED universe claims (pure core)

**Owns:** `simulation/src/dmx/led/led_patch_projection.js`,
`simulation/tests/led_patch_projection.test.js`. **Depends on:** nothing.

1. **`projectLedStrandSegments(universe, channel, stride, count)`** — new
   pure export, O(#universes) not O(#pixels): returns
   `{segments: [{universe, startChannel, endChannel, pixelCount}…],
   universe, channel, overflow}` with semantics **identical by construction**
   to `projectLedStrandPixels` (implement one in terms of the other, or
   property-test them against each other — the walker at :61-77 stays the
   single truth; per-universe capacity from `channel` is
   `floor((512 − channel + 1) / stride)` whole pixels, then full universes of
   `floor(512 / stride)`).
2. **Extend `computeLedStrandPatches` records** (:180-187) with
   `segments` (from step 1), `endUniverse`, `endChannel`. Existing fields
   unchanged (dmxUniverse/dmxAddress stay the start — bytes identical).
3. **`computeLedUniverseClaims(registry, strandCounts)`** — new pure export:
   for every LED controller (bound via `computeLedStrandPatches` segments;
   unbound via the same walker run over `computeLedProjection`'s per-strand
   `{universe, addr, stride, ledCount}` — take that projection's `fields` as
   input to avoid an import cycle with `controller_registry.js`; signature
   `computeLedUniverseClaims(boundFields, genericFields, strideResolver)` or
   simply accept both projections' outputs), returns
   `Map<universe, [{start, end, name, controllerId, portNum?, led: true}]>` —
   the LED mirror of `universeMaps` claims, sorted like
   `computeProjection`'s (1570-1598). **Never mutates the registry** (pure,
   like everything in this file).
4. **Violations unchanged**; `overflow` keeps the loud
   `led_universe_overflow` contract (:166-176).

**Tests (goldens, RGBW stride 4, startAddr 1 unless noted; all synthetic
registries, no scene files):**

- **200 px @ U6:** segments `[U6 ch1–512 (128 px), U7 ch1–288 (72 px)]`;
  record `dmxUniverse 6, dmxAddress 1, endUniverse 7, endChannel 288`;
  next-strand cursor `U7 ch289`.
- **40 px @ U6:** one segment `U6 ch1–160`; `endUniverse 6, endChannel 160`.
- **Multi-strand packing across a port:** A=100 px, B=100 px chained on one
  output → A: `[U6 ch1–400]`; B: `[U6 ch401–512 (28 px), U7 ch1–288 (72 px)]`.
- **No-straddle proof:** cursor at `U6 ch511` (startAddr 511), stride 4 →
  first pixel at `U7 ch1`; assert **no segment touches U6 ch511–512** and
  segment math equals `projectLedStrandPixels` pixel-for-pixel.
- **Misaligned start:** startAddr 3, 129 px → pixel 127 at `U6 ch511`? No —
  `3 + 127×4 = 511`, `511+3 > 512` → pixel 127 at `U7 ch1`; segments
  `[U6 ch3–510 (127 px), U7 ch1–8 (2 px)]`; equals the pixel walker exactly.
- **Equivalence property:** for a grid of (startAddr ∈ {1,2,3,509,511,512},
  count ∈ {1, 40, 127, 128, 129, 200, 256}, stride ∈ {3,4,5}) segments
  reconstruct the identical pixel list as `projectLedStrandPixels`.
- **Claims:** bound 200 px @ U6 + a second controller's strand @ U7 →
  claims map carries both U7 entries (collision visible to L3's UI).
- **Regression:** every existing test in the file still passes (records only
  GAIN fields).

### L2 — Exporter per-pixel parity (the walker everywhere)

**Owns:** `simulation/src/dmx/pixelblaze_model_exporter.js`,
`simulation/tests/pixelblaze_model_exporter_local_index.test.js`.
**Depends on:** L1 (merge order only; no API dependency —
`projectLedStrandPixels` is already imported at :7).

1. Replace the unbound dense-byte per-pixel branch (:320-334) with a
   precomputed `projectLedStrandPixels(proj.universe, proj.addr, proj.stride,
   count).pixels` walk — the exact pattern the device-bound branch already
   uses at :300-302/315-319. One walker, both paths; delete the divergent
   formula. `overflow` from the walk → **throw loudly** (codex P0 — an
   unbound strand past the sACN ceiling must not export a truncated model
   silently); keep the existing unpatched-marker contract for `!proj`
   (:303-307, 367).
2. No change to device-bound emission, `channels` maps, `whiteMode`,
   `localIndex`, group tagging, or the DMX sections — byte-for-byte identical
   output for every layout where `(startAddr − 1) % stride == 0` (i.e. every
   scene shipped so far, startAddr defaults to 1).

**Tests:** extend the exporter test file — (a) unbound strand, startAddr 3,
130 px: pixel 128's emitted `{universe, addr}` equals the walker (regression
for G3); (b) unbound 200 px strand @ U3 spills to U4 with per-pixel patches
matching `projectLedStrandSegments` boundaries; (c) existing 11+ tests
unchanged; (d) device-bound goldens (U3 ch1–160/161–320) byte-identical
before/after.

### L3 — Persistence, subscription, spill reservation, UI surfacing

**Owns:** `simulation/main.js`, `simulation/server/save-server.js`,
`simulation/src/dmx/patch_manager.js`,
`simulation/src/gui/controller_map_editor.js`,
`simulation/src/gui/gui_builder.js` (strand-folder patch line only),
`simulation/style.css` (LED bar/claim tokens only), NEW
`simulation/tests/led_segments_persistence.test.js`, extend
`simulation/tests/led_controller_ui_round2.test.js`.
**Depends on:** L1 (consumes `segments` + `computeLedUniverseClaims`).

1. **`main.js` `projectLedStrandPatches` (:427-483):** copy `segments`,
   `endUniverse`, `endChannel` onto the strand and into
   `window.__globalPatchTree[strand.name]` (patched case); clear them in the
   unpatched case (the existing loud-clear contract, :450-457).
2. **`save-server.js` strand extraction (:225-254):** emit `segments` (list
   of `{universe, startChannel, endChannel, pixelCount}`), `endUniverse`,
   `endChannel` in the patches.yaml strand record **and add all three to the
   structural-strip list** (:246-251) so scene_config.yaml stays clean.
   patches.yaml strand shape becomes:
   ```yaml
   LED_X:
     controllerIp: 10.x.x.201
     controllerId: 2
     dmxUniverse: 6        # start (unchanged)
     dmxAddress: 1         # start (unchanged)
     pixelCount: 200
     outputIndex: 0
     endUniverse: 7
     endChannel: 288
     segments:
       - { universe: 6, startChannel: 1, endChannel: 512, pixelCount: 128 }
       - { universe: 7, startChannel: 1, endChannel: 288, pixelCount: 72 }
   ```
   (Additive — DMX fixture records untouched; loaders `Object.assign`, so
   old files without segments still load; `projectLedStrandPatches`
   re-derives at boot regardless.)
3. **`patch_manager.js` `deriveSubscribedUniverses` (:44-60):** for strands,
   add **every** `segments[].universe` (fall back to `dmxUniverse` only when
   no segments field exists — a freshly-loaded legacy record before the first
   projection pass; never silent: it is start-universe behavior identical to
   today). Fixes G2.
4. **Spill-universe reservation (G4):** in `controller_map_editor.js`
   `recomputeAndMark` (:161-191), after `projectLedStrandPatches`, walk
   `computeLedUniverseClaims` and `noteUniverseUsed(registry, u)` for every
   claimed universe — mutation-time reservation, mirroring the DMX
   high-water contract (`controller_registry.js:452-464`); the registry save
   then persists `nextUniverse` past every LED spill. (Projection functions
   stay pure — reservation only happens on the mutation path, exactly like
   the DMX panel's manual-universe `noteUniverseUsed` at :897-901.)
5. **UI parity (`controller_map_editor.js`):**
   - Strand chips (:963-968): multi-universe strands render the full span —
     `💡 LED_0 U6:1 → U7:288 ×200px` (single-universe keeps `U6:1–160`
     form); tooltip lists the segments.
   - **LED claims in the universe bars:** merge `computeLedUniverseClaims`
     into the bar rendering for any universe carrying LED claims (distinct
     token-based tint, e.g. `--cm-led-claim`), so the operator SEES a DMX
     port sharing a universe with an LED stream. **Decision: display + the
     existing `led_universe_collision` warnings only — `makeAllocator`
     (:329-338) stays DMX-claims-only** (S4's warn-never-block contract;
     changing DMX allocation math is explicitly out of scope).
   - `gui_builder.js` strand folder (near :4136-4162): a read-only patch
     line `U6:1 → U7:288 · 200px · 2 universes` (or `unpatched`), same
     data source (`strand.segments`).
6. **Docs:** add the segments shape to docs/41 §5 and a short "LED universe
   parity" note to docs/33 (docs are not scene files; allowed).

**Tests:** `led_segments_persistence.test.js` — a pure round-trip: build a
synthetic registry (bound controller, 200 px strand), run
`computeLedStrandPatches` + the record shape used by save-server (extract the
record-building into a tiny pure helper if needed — but do NOT import the
server into the browser bundle), assert the yaml-shape golden above; strip
list covers all nine fields. Extend the round-2 UI test with: chip text for a
spilling strand; claims merged per universe; `noteUniverseUsed` called for U7
after mapping the 200 px strand (assert `registry.nextUniverse ≥ 8`).
`deriveSubscribedUniverses` returns `[6,7]` for the golden strand.

### L4 — Integration sweep + verification + report

**Owns:** no exclusive source files. **Depends on:** L1–L3.

- Full `cd simulation && npm test` (target: 235 baseline + all new, 0 fail).
- **Scratch-scene verification (NOT test_bench):** create a throwaway scene
  via the sim UI (per `.agent/skills/see_the_world.md` for screenshots): one
  LED controller (unbound), ports U2/U3, one 200 px RGBW strand → verify
  chip `U2:1 → U3:288`, bars show LED claims on U2+U3, patches.yaml carries
  the segments, exported model's pixel 128 sits at `U3 ch1`; **delete the
  scene afterwards** (it lives only in the working tree; nothing committed).
- Confirm DMX regression surface: run the full suite + a visual pass on the
  Controller Mapping panel with a DMX-only registry (bars/allocator
  unchanged).
- Dated report in `.agent/reports/202607/`; follow-ups → Notion board.

**Operator device test: NOT required.** Bound-controller bytes are unchanged
by construction (L1/L3 are derived views of the shipped walker; L2 touches
only unbound strands, which have no hardware). Recommend one optional
operator sanity: open the push dialog on `10.x.x.201`'s controller after
upgrade and confirm the diff chip still reads **In sync** (read-only,
operator-run). If the operator ever sets a non-default `led.startAddr` with
`(startAddr−1) % 4 ≠ 0` on a bound controller, the L2-fixed sim/engine model
now matches the firmware where the old exporter silently disagreed — worth a
one-line mention in the report.

## Dependency order

`L1 → (L2 ∥ L3) → L4`. L2 and L3 touch disjoint files and can run
concurrently in separate worktrees per `.agent/os/multi_agent.md`.

## Out of scope (file on Notion)

- Per-output-universe **firmware** change (operator's separate MarsinLED
  request) — this plan targets today's single-base linear firmware.
- Making `makeAllocator` LED-aware (changing DMX allocation math).
- Retiring the dormant `led.baseUniverse` schema field (unbound projection
  still reads it at `controller_registry.js:1161-1163`; leave as shipped).
- Fleet-wide (Titanic-202/-203) universe auto-allocation.
