# 20260725_53 — Vintage fixture sizing: a fixture's pixels can no longer fuse into a blob

**Branch:** `feat/bm_readiness` · **Subsystem:** `simulation/` (3D render path only)
**Order (operator, relayed, with a close-up screenshot):** a vertical column of
large rounded blobs where the Vintage LED's heads should be, circled next to a
small fixture showing a neat run of tiny yellow-green dots — *"please resize the
vintage fixtures to match the sizing that I show in this screenshot."*

## TL;DR

The Vintage LED's six Edison heads sit **75 mm apart** and are **18 mm** across.
Their rendered core is that physical size multiplied by the global **"Global
Pixel Size"** slider — a multiplier that knows nothing about how far apart the
fixture's pixels actually are. At the slider value the titanic scene itself
ships (**5**, also the slider max) each head is drawn at **radius 0.100 world
units against a 0.075 pitch — a core 2.67× wider than the gap between heads**,
so the six heads render as one fused sausage. The LED strand beside it is
untouched by that slider (its radius is the absolute `params.ledPixelSize`) and
sits at **0.28 × its own spacing** — the "tiny, individually readable dots" the
operator pointed at.

Fixed by bounding a fixture's rendered pixel core by **its own pixel pitch**:
`clampPixelRadiusToPitch()` in `led_halo.js`, ceiling `MAX_BULB_PITCH_FRACTION =
0.3` — not a taste number, it is the ratio the reference LED strands already
render at. Below the ceiling every slider passes through untouched.

**`_49` (LED halo parity) did NOT cause this.** Verified against `HEAD`: the
DMX-bus bulb rule (`p.bulbSize * repScale * pixelScale`) and the DMX-bus halo
rule are byte-identical before and after `_49`, which only ever touched the
LED-bus branch. `VintageLed` is `bus: dmx` and was never reclassified. This is a
pre-existing rule, not a regression.

## Root cause

Two unrelated size systems decide "how big is one rendered pixel":

| Path | Bulb radius | Reacts to "Global Pixel Size"? |
|---|---|---|
| `led_strand.js` (LED strands) | `params.ledPixelSize` (GUI "Pixel Size", 0.08) — an ABSOLUTE world size | **no** |
| `dmx_fixture_runtime.js` (every model fixture: vintage, bars, pars, TE Sign) | `max(pixel size mm × 0.001, 0.02) × params.globalPixelScale` | **yes**, linearly, unbounded |

Neither system consults the fixture's own pixel spacing, so the second one runs
away. Fusion threshold per shipped type (rendered diameter ≥ pitch):

| fixture | pixels | pitch (world) | bulb base | fuses at Global Pixel Size ≥ |
|---|---|---|---|---|
| **VintageLed** | 6 | 0.0750 | 0.020 | **1.88** |
| ShehdsBar | 18 | 0.0550 | 0.020 | 1.38 |
| TeLedGrid40 | 40 | 0.0500 | 0.020 | 1.25 |
| TeSignV3A/B | 40 / 34 | 0.1666 | 0.020 | 4.17 |
| UkingPar | 1 | — | 0.039 | n/a (one head, nothing to fuse with) |
| _LED strand (reference)_ | 40 | 0.2835 | 0.080 | never — the slider does not reach it |

The slider's range is 0.1–5. `scenes/common.yaml` at `HEAD` ships **5** (working
tree currently holds 1.1), so **the committed scene default is already 2.7×
into the fused regime for the vintage lights** and the operator can walk back
into it with one drag at any time. That is the exact contrast he circled: the
strand keeps its dots because the slider cannot touch it; the vintage column
fuses because the slider multiplies it without limit.

The same unbounded shape applies to the DMX-bus **halo** (`bulb × 1.8 ×
globalHaloScale`): at the committed `globalHaloScale 4.7` the vintage halo is
radius 0.169 against a 0.075 pitch — 4.5× the head spacing.

## Fix

All in simulation **source**. Zero writes to `scenes/**`, `models/**`, or any
fixture model YAML.

- **`src/fixtures/led_halo.js`** (the module `_49` established as the one place
  LED sizing lives) gains:
  - `MAX_BULB_PITCH_FRACTION = 0.3` — the largest a pixel core may be drawn as a
    fraction of the distance to its nearest neighbour **in the same fixture**.
    Derived from the reference: a titanic LED strand renders at
    `0.080 / 0.2835 = 0.28 ×` its own spacing. At 0.3 there is always 40 % of
    the pitch left as dark gap, so neighbours stay individually readable.
  - `clampPixelRadiusToPitch(radius, pitch)` — a **ceiling, not a replacement**.
    Below it the radius passes through untouched. `pitch === 0` (a single-pixel
    fixture) means no ceiling. Non-finite / negative input **throws** (P0: no
    fallback behaviours).
  - `minPixelPitch(positions)` — nearest-neighbour spacing over the whole
    fixture, not "consecutive in the list", because a grid or an arbitrary sign
    map says nothing about adjacency through list order.
- **`src/fixtures/dmx_fixture_runtime.js`**:
  - measures `this._minPixelPitch` **once** at build (it is a property of the
    model, never re-measured when a slider moves);
  - bulb radius becomes `clampPixelRadiusToPitch(bulbSize × pixelScale, pitch)`;
  - the DMX-bus halo is bounded by the same ceiling scaled by the rim factor
    (`pitch × HALO_RIM_FACTOR`), so the rim keeps its relationship to the bulb it
    rims and neighbouring glows may touch but never swamp the run into a bar;
  - the magic `1.8` became the named `HALO_RIM_FACTOR`;
  - `fixture_representative` emitter mode is **exempt** — it draws ONE
    deliberately oversized instance standing in for the whole fixture, and there
    is no neighbour to fuse with.

### The sliders still work

This was the standing rule from `_49` ("all LED fixtures abide by the halo
settings") and it is preserved in both directions:

- **"Pixel Size" / "Global Pixel Size"** still scale every fixture linearly for
  the whole part of their range where the pixels do not overlap. `updateScales()`
  is unchanged and still re-reads `params` live; a test drives the slider from
  0.5 → 1.0 on the vintage light and asserts the radius tracks the setting
  exactly.
- **"Halo Size" / "Global Halo Size"** are untouched for LED-bus fixtures — an
  LED-bus halo is still exactly `ledHaloSize × globalHaloScale`, per pixel, equal
  to an LED strand's. `_49`'s parity test still passes, and this report's suite
  adds its own guard for it at the extreme slider values (5 / 4.7). A backlit
  sign's halos are *meant* to merge into one luminous sheet; only the opaque
  core is bounded.
- Nothing is hardcoded to a magic size: the ceiling is computed from the
  fixture's own model geometry.

## Before / after (measured, not estimated)

Rendered radius read back off the `InstancedMesh` matrices the real
`DmxFixtureRuntime` writes, with every shipped model YAML loaded into the real
registry. Full table: `~/tmp/vintage_fixture_sizing/sizing_before_after.md`.

At **Global Pixel Size 5 / Global Halo Size 4.7** (the committed
`scenes/common.yaml` values, and the slider max):

| fixture | pitch | bulb r BEFORE | ×pitch | fused | bulb r AFTER | ×pitch | fused | halo r BEFORE | halo r AFTER |
|---|---|---|---|---|---|---|---|---|---|
| **VintageLed** | 0.0750 | 0.1000 | 1.33 | **YES** | **0.0225** | **0.30** | **no** | 0.1692 | **0.0405** |
| ShehdsBar | 0.0550 | 0.1000 | 1.82 | **YES** | 0.0165 | 0.30 | no | 0.1692 | 0.0297 |
| TeLedGrid40 | 0.0500 | 0.1000 | 2.00 | **YES** | 0.0150 | 0.30 | no | 0.6580 | 0.6580 |
| TeSignV3A40 | 0.1666 | 0.1000 | 0.60 | **YES** | 0.0500 | 0.30 | no | 0.6580 | 0.6580 |
| UkingPar | — | 0.1950 | — | — | 0.1950 | — | — | 0.3299 | 0.3299 |
| _LED strand (ref)_ | 0.2835 | 0.0800 | 0.28 | no | 0.0800 | 0.28 | no | 0.6580 | 0.6580 |

At the **working tree's** 1.1 / 0.6 nothing was fused, and the only movement is
the two densest fixtures tightening to the reference ratio (ShehdsBar
0.40 → 0.30 × pitch, TeLedGrid 0.44 → 0.30). The vintage light, the TE Sign and
the single-head par are **pixel-identical** at those settings.

## Tests

`simulation/tests/fixture_pixel_pitch_sizing.test.js` — 7 tests, all passing.
Like `_49`'s, it sweeps **every** shipped model YAML from the real registry, so
a new fixture type is covered the moment it lands:

1. `minPixelPitch` finds the CLOSEST pair (not list order), returns 0 for
   0/1/coincident pixels;
2. `clampPixelRadiusToPitch` is a ceiling not a replacement, no ceiling without
   a neighbour, and **throws** on NaN / negative radius or pitch;
3. **no shipped fixture fuses at ANY position of the Global Pixel Size slider**
   (0.1 / 1.1 / 5) — asserted per pixel, both against the ceiling and against
   the thing the operator actually sees (core diameter < pitch);
4. **the vintage regression pin** — at Global Pixel Size 5 the six heads read no
   fatter, relative to their own spacing, than the reference strand pixels
   (measured against a real `LedStrand` built from titanic's own
   `Left_Front_Left` endpoints);
5. the sliders still drive the vintage light linearly below the ceiling, through
   the live `updateScales()` path;
6. `fixture_representative` mode stays exempt;
7. **no regression to `_49`** — every LED-bus halo still equals `ledHaloRadius()`
   per pixel at the extreme settings.

## Auto-checks (`.agent/ops/sim_auto_checks.md`)

- `git diff --check -- simulation` — **PASS**
- `node --check` on every changed/added JS file — **PASS**
- `cd simulation && npm run check` — **1002 tests, 994 pass, 8 fail.** The 8 are
  the known stale-titanic-model family, named individually and identical to the
  `_48`/`_52` baseline (`scene_model_parity` real-scene checks ×3, view-bit
  headroom, fixture docking, block collision, the emit CLI pair). **Zero new
  failures**; the count moved 995 → 1002 only because this report adds 7.
- Scene ↔ model parity gate — **not applicable**: no scene YAML and no generated
  model changed. `git status` on `simulation/scenes/**` and `models/**` is
  byte-for-byte the session-start snapshot.
- Browser smoke — **PASS** (addendum run): the sim was driven live at `:6969`
  (`?scene=titanic&profile=full&renderer=webgl`) through the new
  `agent_tools/vintage_sizing_capture.cjs`; page loaded, fixtures render, the
  only console errors were a pre-existing 404 and the low-FPS notice.
- GPU adapter — **no FPS number is reported here.** Captures ran under
  SwiftShader (software GL, `--viewport 1280x720`) per the skill: valid for
  layout/regression checks, invalid for perf claims. The sim's own low-FPS alarm
  fired during the run for that reason.

## Captures (addendum — taken once the operator's sim came back up)

The first pass of this work ran while the stack was down (nothing on 6967–6972),
and the live-session brief said stop rather than restart it with hardware
cabled, so the numeric table above was the only evidence. The sim came back on
`:6969` and the captures were taken in **one short browser session**.

New harness: **`simulation/agent_tools/vintage_sizing_capture.cjs`**. It cannot
produce a "before" by reverting the source (that would mean editing the
operator's working tree mid-session), so it writes the **pre-fix instance
matrices itself, in the page** — the pre-fix formula stated exactly and verified
against `HEAD`:

```
bulb radius = p.bulbSize * repScale * pixelScale
halo radius = p.haloSize * repScale * haloScale
```

`updateScales()` then puts the shipped sizing back. Nothing is written to disk.
Guards, all reported by the run: `__readonlyMode` installed as an **accessor**
before any page script (so `animate.js` never enables the sACN output client),
the `:6972` bridge socket refused at the `WebSocket` constructor, every
save-server request counted, and the two global scales snapshotted and restored.

**Run result: 0 `[sACN Out] Enabling` lines, 0 requests to `:6970`, scales
restored to the operator's own `{pixel: 1.1, halo: 0.6}`, trace overlay put
back, browser closed, no leftover Chrome processes.** The live scene surveyed
16 `VintageLed` fixtures (pitch 0.0750) and 8 strands, `_patchesActive: true`
(his rig is driving them — the captures show real DMX colour, amber/yellow, not
the config colour). Renders are SwiftShader, valid for layout, invalid for FPS.

### `~/tmp/vintage_fixture_sizing/`

| File | What it shows |
|---|---|
| `tight_before_sliders_5_4p7.png` / `zoom_…` | **the reported bug**: the six heads' cores touch in a continuous chain and the halos merge into one huge amber blob envelope swallowing the whole fixture |
| `tight_after_sliders_5_4p7.png` / `zoom_…` | same camera, same settings: **six clearly separate amber heads** in a neat vertical run on the dark body |
| `tight_before/after_sliders_1p1_0p6.png` / `zoom_…` | his current settings — **visually identical**, exactly as predicted (vintage bulb 0.0220 and halo 0.0216 in both) |
| `pair_before/after_sliders_5_4p7.png` | vintage column and the `Left_Front_Left` strand in one frame at the high settings |
| `pair_after_sliders_1p1_0p6.png` | the reference at his current settings: the strand is a neat run of individually resolvable dots, the vintage lights small and separate |
| `after_wide_context.png` | wide shot for context, his settings restored |
| `sizing_before_after.md`, `before_after_table.mjs`, `probe_sizes.mjs` | the numeric table and the scripts that produce it |
| `crop_rail_zoom.png`, `crop_orange_zoom.png` | zoom crops of an EXISTING `.agent_renders` capture, inspected while locating the fixtures — the large discs there are the trace/chain-order **editing overlay**, not fixture emitters (kept so nobody re-derives that dead end) |

### Verdict

**At the operator's current sliders (1.1 / 0.6) the vintage column already reads
as six distinct heads and the before/after frames are indistinguishable — the
visual defect only appears at high slider values.** It is fully reproduced at
5 / 4.7, the value `scenes/common.yaml` ships at `HEAD` and the slider maximum,
and the fix removes it there completely. So the blob column he screenshotted was
rendered at a high "Global Pixel Size"/"Global Halo Size"; whatever he does to
those sliders from now on, the heads stay separate.

Two honest limits of the capture: the in-page "before" rewrites **`VintageLed`
matrices only** (the subject of the order), so the bars and signs are in their
fixed state in every frame — at 1.1 the fix also tightens `ShehdsBar`
0.40 → 0.30 and `TeLedGrid` 0.44 → 0.30 × pitch, which these captures do not
isolate. And the fixture colours are whatever his live DMX was driving at that
moment.

## Notes / follow-ups

- **`globalPixelScale` still does not reach LED strands at all.** That asymmetry
  is the reason the slider was ever pushed to 5: turning it up to make the
  strands read does nothing to them and blows up every model fixture instead.
  Worth an operator ruling — either fold the strand bulb onto the same global
  multiplier, or relabel the slider so it is clear it only drives model
  fixtures. Not changed here: strands are the reference the operator says is
  already correct, and this order was about the vintage lights.
- The `Math.max(pixelSize * 0.001, 0.02)` floor silently inflates an 18 mm head
  to 20 mm and a 12 mm TE Sign puck to 20 mm. Harmless under the new ceiling,
  but it means "physical size" in the model YAML is not honoured below 20 mm.
- The LED **diffusion sprites** (`haloBaseSize × globalHaloScale × amount`) are
  still unbounded. They are soft additive quads on LED-bus fixtures only and
  merging is their whole point, so they were deliberately left alone.
- Still owed by the operator, unchanged: re-export `models/titanic.js` and
  restart the engine to clear the 8 stale-model suite failures.
