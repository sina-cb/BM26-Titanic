# 20260724_27 — LED blackout semantics: OFF = BLACK on every path

**Author:** Opus implementer · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-24
**Slice:** operator live-test bug + punch item (f). Builds on report
`20260724_24_led_group_lock_generator.md` (the LED group master this fixes) and
`20260724_23_led_fixtures_grouping.md`.

## What the operator hit (verbatim intent)

1. With a strand group's `⏻ Group On` toggled **OFF**, the sim still showed
   dim-but-clear residue — LED dots faintly glowing red/yellow, blurry halo
   blobs, glows — and "it's still being **mapped** clearly!" (2D Pixel Map +
   output still lit).
2. Punch (f): with the LED Fixtures section's global **Master Enabled** OFF, all
   LEDs must go black; instead they "keep emitting and only lose the halo."

Both must mean **BLACK everywhere** — 3D render, 2D Pixel Map, and every output
path. No fallbacks.

## Root cause (one bug, two symptoms)

Report _24 made the LED group master real **only on the per-strand bulb/halo
meshes**: the exporter's `apply` closure and the static preview
(`led_strand.rebuildVisuals`) scale those via `scaleRgbForGroup`. But an LED
strand pixel is painted by **four** consumers, and the other three read the RAW
`_batchRenderList` entry color (`entry.r/g/b/w/a/u`), which nothing scaled:

| Consumer | Reads | Gated by _24? |
|---|---|---|
| Per-strand `bulbInst`/`haloInst` (LedStrand) | `apply()` → `setLedColorRGB` | ✅ (closure + static) |
| Global V2 instanced-dot flush (`_pixelInstancedMesh`, animate.js ~L432) | raw `entry.r/g/b` | ❌ |
| 2D Pixel Map (`pixel_map_frame_source` → `entryDisplayRgb`) | raw `entry.r/g/b` | ❌ |
| sACN OUTPUT map (`mapPixelsToSacn`) | raw `entry.r/g/b/w/a/u` | ❌ |

- **Group OFF residue** = the global instanced dots (a *second*, un-gated set of
  dots at the same LED positions, ~14 mm, blooming) + the 2D map + the output,
  all painting the raw pattern color.
- **Master OFF "keeps emitting, loses only the halo"** = `strandsEnabled`'s
  handler ONLY calls `setVisibility(false)`, which hides the LedStrand THREE
  group (its bulb+halo) — but the global instanced dots, the 2D map and the
  output are **separate** and kept the raw color. Exact match to the symptom.

### The keying trap (why a naïve fix silently fails for THIS scene)

The titanic show scene has **8 LED strands, all `group: ''` (Ungrouped)** — the
operator removed the rest; I did not restore any. The exporter tags each LED
pixel with `group: groupKeyForStrand(strand)` = the strand's **NAME** for an
ungrouped strand (each is its own view/section group of one). But the GUI group
master + the bulb closure key by `ledDisplayGroup` = the shared **`'Ungrouped'`**
bucket. So a gate keyed on `entry.group` would look up
`ledGroupOverrides['Left_Front_Left']` (never set) and **never blacken** the very
scene the operator is running. The gate must key by the display group.

## The fix (single authority, every path)

**`ledOutputScale(strandsEnabled, overrides, groupName) → 0..1`** (new, pure,
in `src/core/group_lock.js`) is now THE one authority: global master OFF ⇒ 0;
group OFF ⇒ 0; else the group's brightness fraction (1 at ≥100 %). Every LED
output path derives from it:

- **`_applyLedOutputGate(list)`** (new, `animate.js`) scales
  `entry.r/g/b/w/a/u` **in place** for `entry.type === 'led'` entries, keyed by a
  new **`entry.displayGroup`** field (see below). Runs AFTER every color source
  (pattern / gradient / sACN demap) and BEFORE the three raw-color consumers —
  so the global dot flush, the 2D map, and `mapPixelsToSacn` all go black. Two
  call sites in the DMX-router block: after `demapSacnToPixels` (sacn_in) and
  before `mapPixelsToSacn` (mapping mode, so the sACN OUTPUT is gated too, the
  LED parity of `applyFixtureOutputOverrides` zeroing DMX universe bytes). A
  full-on group (scale 1) is skipped — zero behavior change when nothing is off.
- **`displayGroup`** added to each LED pixel in
  `pixelblaze_model_exporter.js` (= `ledDisplayGroup(strand)`, the `'Ungrouped'`
  bucket key). Runtime-only — NOT in the `saveModelJS` field list, so the engine
  model is byte-identical. This is the join that dodges the keying trap.
- **`scaleRgbForLedOutput(strandsEnabled, overrides, group, r,g,b)`** (new,
  wraps `ledOutputScale`) replaces `scaleRgbForGroup` in the exporter `apply`
  closure and `led_strand.rebuildVisuals`, so the per-strand bulb/halo also honor
  the **global master** (not just the group) — true blackout independent of the
  visibility toggle. `scaleRgbForGroup` is removed (its only two callers migrated;
  all math now flows through `ledOutputScale`, one source of truth).

No `gui_builder.js` edits (concurrent-agent territory) — the fix lives entirely
in the render/output gating paths.

`light_pool.js` was ruled out: its `_collectLightRequests` iterates only
`parFixtures` + `dmxSceneFixtures`, never LED strands, so LED strands cast no
analytic spotlight and contribute no pool residue.

## Proof (live, renderer-only against the running :6969 stack)

Tool: `simulation/agent_tools/led_blackout_verify.cjs` — launches its OWN
throwaway Chromium, never starts/stops a server, stubs `debounceAutoSave` (no
scene write), closes at the end. Forces gradient paint so LED entries carry
non-zero color, then toggles GROUP OFF and MASTER OFF and samples the LIVE app:
`maxEntry` (feeds global dots + sACN out), `max2dDecode` (the 2D map's OWN
`entryDisplayRgb`), `maxBulb`/`maxHalo` (per-strand meshes), across all 8
Ungrouped strands (320 LED entries).

| State | entry | 2D decode | bulb | halo | verdict |
|---|---|---|---|---|---|
| Baseline ON | 1.9961 | 1.9961 | 0.45 | 0.45 | lit (sanity) |
| **GROUP OFF** | **0** | **0** | **0** | **0** | BLACK ✅ |
| **MASTER OFF** | **0** | **0** | **0** | **0** | BLACK ✅ (group also hidden) |

`RESULT: PASS ✅`, 0 filtered console errors. Screenshots
`.agent_renders/ledblk_*_group_on|group_off|master_off.png` visually inspected:
the rainbow LED strand lines along the deck edges (present ON) are **gone** in
both OFF states; remaining glow is the DMX generators/pars (correctly NOT
governed by the LED master). Browser closed (no lingering probe window).

## Tests

`cd simulation && npm test` → **484 pass / 0 fail** (was 483 pre-change baseline
in this tree; net +1 after swapping the `scaleRgbForGroup` cases for
`scaleRgbForLedOutput` + adding `ledOutputScale` cases in
`tests/group_lock.test.js`). `node --check` clean on every edited file.

## Files touched

- `simulation/src/core/group_lock.js` — new `ledOutputScale` +
  `scaleRgbForLedOutput`; removed `scaleRgbForGroup` (migrated).
- `simulation/src/core/animate.js` — `_applyLedOutputGate` + two gated call
  sites; import `ledOutputScale`.
- `simulation/src/dmx/pixelblaze_model_exporter.js` — LED pixel `displayGroup`
  field; `apply` closure now uses `scaleRgbForLedOutput` (master + group).
- `simulation/src/fixtures/led_strand.js` — static preview uses
  `scaleRgbForLedOutput`.
- `simulation/tests/group_lock.test.js` — updated/added cases.
- **New:** `simulation/agent_tools/led_blackout_verify.cjs`.

## Operator notes / observations

- The LED master/group governs **LED strands** only. The **TE Sign** (homed in
  the LED Fixtures UI but a `parFixtures` member) keeps its own **DMX** group
  master (`applyFixtureOutputOverrides`) — a strand group's `Group On` does not
  and should not touch it. If the "diffuser bar / pill glows" the operator saw
  were a DMX fixture, black it via its DMX group master, not the LED one.
- **Follow-up (out of scope, not fixed):** the same global instanced-dot flush
  reads raw `entry.r/g/b` for *patched DMX* pixels (animate.js ~L466), so the DMX
  group master (which gates the universe buffer + the DMX runtime bulbs) may
  likewise leave faint un-gated dots in the global mesh. Not reported by the
  operator and outside this LED slice; worth a look if DMX group-off shows dot
  residue.
