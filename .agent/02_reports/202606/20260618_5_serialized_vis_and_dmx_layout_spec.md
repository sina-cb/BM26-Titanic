# Spec — Serialized vis data ↔ fixtures/groups, and the test_bench DMX layout

**Date:** 2026-06-18
**Branch:** `claude/audio-corpus-tuning-olcd6i`
**Why:** Reference for decoding the engine's vis/DMX buffers per fixture, plus
the investigation that found the "all bar LEDs glow when the vis shows one
pixel" issue.

---

## 1. The serialized vis buffer (what CaptainPad DECK MAIN renders)

The engine broadcasts vis frames over WebSocket `ws://<host>:6968/ws/viz` as
JSON:

```
{ type: 'vis',
  pixelCount: <N sampled px>,             // 52 for test_bench (under the cap → NO subsampling)
  vis: { master: <base64>, rig: <base64>, ch_<id>: <base64>, … } }
```

- Each buffer is **6 bytes per pixel**, in order **R, G, B, W, A, U** (RGBWAU),
  values 0–255. So pixel `i` occupies bytes `[i*6 .. i*6+5]`.
- `master` = the mixer composition CaptainPad shows as "DECK MAIN" (pre section
  dimmers). `rig` = post-processed (blackout + section dimmers + global FX) —
  the hardware-truth preview. For a single deck at `viewFader=deck` they match
  except for the dimmer scaling.
- **Pixel order = the model's `pixels[]` array order** (NOT physical position,
  NOT DMX address). Index `i` in the buffer == `model.pixels[i]`.
- **Subsampling:** the engine subsamples to `visMaxPixels` only for big rigs.
  test_bench has 52 px which is under the cap, so the buffer is the full 52 px
  (`master` = 312 bytes = 52×6). Confirmed live: `pixelCount=52`, 312-byte
  buffers. The `<div class="css-view-…">` cells in CaptainPad's DECK MAIN strip
  are one-to-one with these 52 pixels in this same order.

### How to read it (the method)
1. `import('marsin_engine/models/test_bench.js')` → `pixels` (52 entries).
2. Each entry has: `i` (index, 0..51), `fId` (fixture id), `sId` (section id),
   `cId` (controller id), `group` (name), world `x/y/z`, normalized `nx/ny/nz`,
   `patch{universe,addr,footprint}`, `channels{r,g,b,w,a,u}`.
3. Group the buffer by walking `pixels[i].fId` — that tells you which bytes
   belong to which fixture/group. There is no separate header; the mapping is
   purely positional via the model array.

---

## 2. Fixture / group → pixel-index map (test_bench, 52 px)

| Group | `fId` | `sId` (section) | Buffer indices `i` | Count | Each pixel is |
|---|---|---|---|---|---|
| ParLights | 1,2,3,4 | 1 (Pars) | 0,1,2,3 | 4 | 1 single-pixel par per fId |
| VintageLights | 5 (Left), 6 (Right) | 2 (Vintage) | 4..9 (fId5), 10..15 (fId6) | 12 | 6 heads per strip |
| BarLights | 7 (Left), 8 (Right) | 3 (Bars) | 16..33 (fId7), 34..51 (fId8) | 36 | 18 LEDs per bar |

`sectionId` (1=Pars, 2=Vintage, 3=Bars) drives the section-brightness dimmers
(`POST /section-brightness`). `fixtureId` is what patterns self-filter on
(`if (fixtureId < 7 || fixtureId > 8) return black`).

### Physical-ordinal derivation (used by the swipe patterns)
The buffer/model order is NOT physical order. To swipe by physical position I
sorted each group's pixels by their normalized coordinate and read off the rank
(verified strictly monotonic against the model):

- **Pars** — physical x (`nx`): fId4 `nx=0.135` (left) … fId1 `nx=0.812` (right).
  Ordinal `ord = 4 - fId` → 0..3 left→right.
- **Bars** — physical x (`nx`): runs 0.000 → 1.000 across both bars. Within a
  bar, increasing `index` DECREASES `nx` (wired right→left), and the two bars
  are separated by a gap (`nx` 0.467→0.533). Physical-rank ordinals 0..35:
  `fId7 → 33 - index` (0..17, left bar), `fId8 → 69 - index` (18..35, right
  bar). The inter-bar gap collapses to contiguous ordinals (17↔18) so a swipe
  crosses both bars as one run. **Wiring/LED-index order is NOT physical** — this
  is why an index-based swipe looked wrong and was replaced by this nx-rank.
- **Vintage** — physical y (`ny`): 6 heads stacked, `ny` 0.000 (bottom) → 0.273
  (top); both strips share heights. Ordinal `ord = 9 - index` (fId5) /
  `15 - index` (fId6) → 0..5 bottom→top; a given ordinal is the same head height
  on both strips (mirrored).

---

## 3. test_bench DMX layout (per fixture)

All on **universe 2** (test_bench). Addresses are 1-indexed DMX slots; the
`channels` map gives **offsets within the fixture's footprint** that the
renderer writes R/G/B/W/A/U into. Mapping code: `simulation/src/dmx/sacn_mapper.js`
(`mapPixelsToSacn`).

| Group | fixtureType | footprint | addr(s) | Pixel channels (offset within fixture) | Control channels |
|---|---|---|---|---|---|
| Pars | `UkingPar` | 10 | 1, 11, 21, 31 | r2 g3 b4 w5 a6 u7 | ch1 = master dimmer; ch8 = native strobe |
| Vintage | `VintageLed` | 33 | 41 … 74 | per head: w3, r16 g17 b18 (+ heads tiled) | ch1 = master dimmer; ch2 = native strobe |
| Bars | `ShehdsBar` | 119 | 107 (L), 226 (R) | pixel_k at offsets 12 + (k-1)*6 … i.e. pixel1 = ch12–17, pixel2 = ch18–23, … pixel18 = ch114–119 (r,g,b,w,a,u each) | ch1 = master dimmer; ch6–11 = global RGBWAUV dimmers (left at 0); no global strobe |

Notes:
- `mapPixelsToSacn` **force-sets channel 1 (master dimmer) = 255** for
  UkingPar / VintageLed / ShehdsBar so the fixture passes pixel data through.
  It deliberately does NOT set the bar's global RGBWAUV dimmers (ch6–11) — those
  stay 0 so the fixture doesn't blast full white.
- `suppressNativeStrobes` (`NATIVE_STROBE_CHANNELS`) zeros the native strobe
  channel each frame (UkingPar ch8, VintageLed ch2) so the software strobe macro
  owns intensity. ShehdsBar has none.
- The W channel: the renderer writes `entry.w*255`. Patterns that only call
  `rgb()` leave W=0, so the white emitter stays off. (If `entry.w` were
  undefined the mapper would backfill W = min(r,g,b) — not the case here.)

### Signal path (pattern → glass)
`render3D` (6ch RGBWAU per pixel) → `mixer.renderAll6ch()` →
`model.pixels[i].{r,g,b,w,a,u}` (÷255) → global FX (vintage W boost, UV, macros,
group fixed colors) → `intensityController` (section dimmers + blackout) →
`mapPixelsToSacn` (writes the channels above + master dimmer) →
`suppressNativeStrobes` → `sacnOut.sendFrame` → universe 2 → fixtures / sim
sACN-in. The vis `rig` buffer mirrors `model.pixels` AFTER intensity, so it is
the faithful per-pixel DMX-side preview.

---

## 4. Investigation: "vis shows 1 pixel but all bar LEDs are on"

**Finding: not a wiring/DMX/engine bug.** The DMX layout above is correct and
each pixel maps to the right channels. The glow is the swipe pattern's
**`BASE_FLOOR = 0.04`** — a deliberate "never fully dark" floor written to EVERY
pixel's RGB.

Proof (live `rig`, frozen 1-px core, blur=trail=0, bars at 100%): exactly one
bar pixel read 130 (the core) and **all 35 others read 5/255** — i.e. ~2%
floor on every LED. On the dark vis UI 5/255 is invisible → "looks like one
pixel". On physical LEDs ~2% across 36 LEDs is a clear background wash. The
mapper's master-dimmer = 255 makes that floor fully pass through.

**Fix:** set `BASE_FLOOR = 0` in the three swipe patterns (30/31/32) so
un-swept LEDs are truly off and only the swept pixel (+ blur/trail) lights. The
fixture is still "alive" because the core pixel is always lit, so this does not
violate the codex no-blackout intent for a swipe (the prior handoff explicitly
allowed a near-dark off-state for these high-contrast swipes).

General rule this surfaced: **judge brightness floors on the `rig`/DMX bytes,
not the vis UI.** A few-percent floor disappears against the dark preview but is
visible on hardware. For "only the active element lights" patterns, floor = 0.
