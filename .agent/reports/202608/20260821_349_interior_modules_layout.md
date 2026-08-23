# 349 — `titanic_interior`: parallel Modules re-lay

Operator feedback on the scene built in `_345`/`_346` (patterns `_347`/`_348`):
put the six lines **side by side**, call them **Modules**, and make each one a
**single continuous string**. Done, re-saved through the sim's own save path,
and the five interior patterns re-derived for the new layout.

## 1. Layout chosen — six parallel rows along X, spread across Z

All six lines now run along **X** at the same height, evenly spaced across
**Z** — the layout that reads cleanest in the 2D pixel-map view (`projection:
top` = the x/z plane ⇒ six equal horizontal rows) and stays unambiguous in a
3/4 or overhead 3D view.

| Module | Controller · output | z | y | x | px |
|---|---|---|---|---|---|
| Module 1 | BoilerRoom-A · O1 | −2.0 | 2.0 | −5.5 → 5.5 | 330 |
| Module 2 | BoilerRoom-A · O2 | −1.2 | 2.0 | −5.5 → 5.5 | 330 |
| Module 3 | BoilerRoom-A · O3 | −0.4 | 2.0 | −5.5 → 5.5 | 330 |
| Module 4 | BoilerRoom-B · O1 | +0.4 | 2.0 | −5.5 → 5.5 | 330 |
| Module 5 | BoilerRoom-B · O2 | +1.2 | 2.0 | −5.5 → 5.5 | 330 |
| Module 6 | BoilerRoom-B · O3 | +2.0 | 2.0 | −5.5 → 5.5 | 330 |

Even 0.8 m pitch, no overlap, each line straight along its own axis. Scale is
unchanged at **30 px/m** (330 px over the 11 m run). Untouched by this wave:
controller IPs (`.69` / `.70`), universe allocation (A `U1→9`, B `U11→19`),
parked output 4 (`U10` / `U20`), pixel counts, RGBW stride 4 / `whiteMode:
native`, `startAddress 1`.

## 2. Naming — Modules everywhere the scene shows a name

The sim's strand **name is the label**, and this repo's scene convention allows
spaces in it (`titanic` ships `Left Front Wall`), so the identifier and the
visible label are the same string — no `Module_1` ↔ `Module 1` split to keep
in sync:

- `scene_config.yaml` strands: `Module 1` … `Module 6`.
- **Groups** are now per module (`Module 1` … `Module 6`) instead of
  `BoilerRoom-A/-B`, so `views.yaml` `groupBits` and the generated
  `titanic_interior.viewmasks.js` export `Module 1`…`Module 6` (bits
  `0x01`…`0x20`), and the engine compiles `MASK_MODULE_1` … `MASK_MODULE_6`.
- `patches.yaml` records are keyed `Module 1` … `Module 6`.
- Controller **port rows** read straight off the chain: `⌁ P1 → output 1: U1 ch
  1 → U3 ch 296 · 330px` with a single `Module 1 U1:1 → U3:296 ×330px` chip.
- Card names stay `BoilerRoom-A` / `BoilerRoom-B` (Modules 1–3 / 4–6) — the
  operator's mapping, unchanged.

## 3. One string per module — YES, a single 330-px strand

The sim's LED strand is a straight start→end line, and the new layout **is**
straight, so the 180-px + 150-px pair collapses into one fixture: each module
is now **one 330-px strand**, not a chained pair. 12 strands → **6**; 1980 px
unchanged. Each port carries exactly `1 strand(s)`.

Segment identity survives as pure geometry: the seam constant `SEAM =
0.5454545` (world `x = 0.5`) still splits every module **exactly 180 / 150** —
verified pixel-by-pixel against the generated model (index 179 sits at
`nx 0.5441`, index 180 at `nx 0.5471`).

## 4. Patterns 131–135 — line identity re-derived

The along-line axis did not change (`u = x`), so `SEAM` and all seam features
(132's weir, 134's lip flash) are untouched. What changed is **line identity**:
the old `wall(z) × tier(y)` no longer works now that every module shares one
`y`. All five patterns now use one shared idiom:

```
lineId = floor(clamp01(nz) * 6) clamped to 0..5      // one id per module
```

Modules 1–3 (BoilerRoom-A) land on 0–2, modules 4–6 (BoilerRoom-B) on 3–5, so
`133_counter_current`'s two-hue split is now `lineId >= 3` — the same partition
it used to get from `z >= 0.5`, stated in module terms. Header docs updated in
all five. **The cross axis is `z`** — noted here for the wave-2 patterns
(`_350` §1 asks the implementer to confirm which of `y`/`z` it is).

## 5. Re-save + validation

- **Sim save path only.** `scene_config.yaml` + `controllers.yaml` were
  hand-authored; `patches.yaml`, `views.yaml` and
  `marsin_engine/models/titanic_interior.{js,effects.js,viewmasks.js}` were all
  written by the sim's own 💾 `window.exportConfig()`. Nothing generated was
  hand-edited.
- **Idempotent.** A second save through the same path leaves
  `scene_config.yaml`, `controllers.yaml`, `patches.yaml`, `views.yaml` and
  `pixel_map_views.yaml` **byte-identical**; the three model files differ only
  in their `// Updated:` stamp.
- **Independent projection replay** (`computeLedStrandPatches` over the two
  authored YAMLs): **6 strands · 1980 px · 0 violations**, 7920 channel cells
  claimed with **0 overlaps**, and the saved `patches.yaml` is field-for-field
  equal to the independently computed projection. Per output: `U ch1–512` ×128,
  `U+1 ch1–512` ×128, `U+2 ch1–296` ×74.
- **Engine boot** (scratch API port in the 17xxx range, sACN destination on a
  TEST-NET blackhole, `MARSIN_STATE_DIR`/`MARSIN_TIMELINE_DIR` redirected out
  of the repo, `--model titanic_interior --pattern 131_river_run`):
  `✅ Model loaded: 1980 pixels` · `✅ Shared DMX mapper: 1980/1980 pixels
  patched across 18 universe(s) [1..9, 11..19]` · `[sACN Out] Sender started —
  18 universe(s)` · `✅ Playlist library: 3 playlist(s)` · pattern constants
  `MASK_MODULE_1..6`. Terminated after the probe; the scene's foreign-owned
  `timeline/playa_default.yaml` was never touched (the auto-write landed in the
  redirected scratch dir).
- **`cd simulation && npm run check`** — see §7.

## 6. Pixel-map views (2D)

`scenes/titanic_interior/pixel_map_views.yaml` was a leftover copy of the
`titanic` file — every selector named a group this scene does not have, which
the resolver treats as a loud per-panel error. Replaced with two interior
views, both hand-authored (the sim writes this sidecar only on an operator
edit) and both confirmed to load (`[PixelMap] loaded 2 saved view(s)`):

| View | Panel | Reads as |
|---|---|---|
| `modules` (default) | `kind: led`, `layout: spatial`, `projection: top` | the true geometry — six equal horizontal rows |
| `module_lanes` | `kind: led`, `layout: lanes` | one logical lane per module, in module order |

The 2D pane header reports `6 fix · 1980 px`.

## 7. Checks run

`cd simulation && npm run check` (run alone, with no probe browser of mine
open — a first run taken while a render browser was up was contaminated by
GPU/timing contention and is not reported):

- pixel-views check: PASS — `[touch-pixel-views] artifact is current`.
- node suite: **2670 tests · 2659 pass · 10 fail · 0 skipped · 1 todo**.

None of the 10 names a file from this wave. They split into two known groups:

| Failing | Why | Owner |
|---|---|---|
| `operator sidecar geometry` ×2 (`1440x900`, `ipad 1024x768`), `Spatial lifecycle cleanup …`, `multi-take bank mixes two slots …` | the pre-existing UI/canvas suites hard-pinned to the `titanic` scene | pre-existing |
| `_69: …` ×3 (`marsinled_client.test.js`), `an unrankable overlap ELSEWHERE …` / `a RESOLVABLE shared address pushes …` / `a ctx with NO addressMergePlan still pushes` (`shared_address_ui.test.js`) | another wave's **uncommitted** `simulation/src/dmx/led/marsinled_client.js` edit; they fail identically when the two files are run alone, and neither test reads a scene | foreign, in flight |

Every interior gate passes: `G8: titanic_interior — every existing structural
YAML file parses`, `G8: titanic_interior/patches.yaml — zero anomalies`,
`G8: titanic_interior/controllers.yaml — every IP well-formed, no duplicates`.
The `titanic` model drift note (964 vs 963) is the known pre-existing one.

## 8. Renders (visually inspected)

Captured through `.agent/skills/see_the_world.md` (`agent_render.cjs`, ad-hoc
`--camera/--target`, 1280×720 SwiftShader) against the already-running operator
stack — no reserved port was bound, killed or restarted, and no built-in
browser tool touched the sim.

| File (`.agent_renders/`) | What it shows |
|---|---|
| `1787425174_ti_modules_threequarter.png` | 3/4 view, `131_river_run` running: six parallel modules, evenly spaced, no overlap, teal body with travelling crests |
| `1787425181_ti_modules_aerial.png` | overhead: six equal parallel rows across the full 11 m |
| `1787425274_ti_modules_2d_pixels.png` | the sim's **2D Pixel Map**, view `Modules` — six rows, header `6 fix · 1980 px` |
| `1787425804_ti_modules_132_seam_aerial.png` | `132_tide_pools` overhead — the **seam check**: every module reads bright/pooled upstream and darker/drained downstream with the break at the same relative point on all six, the per-module stagger visible, and the lilac spill sitting on the lip of module 6 |

Controller Mapping pane (`controllers_pane_toggle_verify.cjs` plus a read-only
scroll probe with the sACN-OUT socket blocked in-page, nothing saved):
`CONTROLLERS (2)` · `MARSINLED CONTROLLERS (2)` · `✓ fully patched` ·
`UNMAPPED FIXTURES (0) — every fixture & strand is mapped`. Every port row
reads `1 strand(s)` with its single Module chip:

```
⌁ P1 → output 1: U1  ch 1 → U3  ch 296 · 330px      Module 1
⌁ P2 → output 2: U4  ch 1 → U6  ch 296 · 330px      Module 2
⌁ P3 → output 3: U7  ch 1 → U9  ch 296 · 330px      Module 3
⌁ P1 → output 1: U11 ch 1 → U13 ch 296 · 330px      Module 4
⌁ P2 → output 2: U14 ch 1 → U16 ch 296 · 330px      Module 5
⌁ P3 → output 3: U17 ch 1 → U19 ch 296 · 330px      Module 6
```

The Lighting Controls LED tree lists `Module 1 (1)` … `Module 6 (1)` — one
fixture per module, which is the one-string answer restated by the UI.

## 9. Residue and notes for the operator

1. **`simulation/scenes/titanic/pixel_map_views.yaml`** carries the known
   2-line offset drift from `pixel_map_edit_lifecycle.test.js`, and
   `CaptainPad/live_touch/touch_control_pixel_views.json` is modified — both
   pre-existing in this working tree, both untouched by hand here. Reported,
   not reverted.
2. **The cards still read `board unverified` / `Discover / bind device`** — the
   expected pre-hardware state; no `device:` block is persisted and no MAC is
   stored. Opening the mapping pane makes the pane attempt a read-only gamma
   GET to each card IP, which times out with no boards on the bench; harmless.
3. **The scene's `timeline/playa_default.yaml` and the playlists were not
   touched.** The three playlists still load with zero warnings.
4. **Foreign work in the tree** (`_350`'s wave-2 pattern spec, the `titanic` /
   `test_bench` night-arc playlists, `states/`, and the concurrent uncommitted
   `marsinled_client.js` / gamma / smokestack edits) was left alone. The
   interior scene's own `playlists/*.yaml` were also rewritten by something
   else on this box during the wave — not by this thread, which never opened
   them.
5. **`python scripts/security_check.py --all`** — 7 findings, **none in any
   file from this wave**: six pre-existing MACs inside the gitignored
   `simulation/.scene_backups/`, one pre-existing SSID literal in
   `simulation/tests/led_gamma_workflow.test.js`.
6. **`npm run check` sweeps stack ports.** The suite's port-cleanup /
   launcher-supervision tests hold and release the stack ports, and the sim
   HTTP + save server PIDs changed across the run (supervision brought them
   back). All of `:6967`–`:6972` are listening at hand-off. Nothing in this
   wave bound, killed or restarted a reserved port itself, and every probe
   browser was closed (the `--open` lock file is gone, no orphan).
7. No commits, no pushes.
