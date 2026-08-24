# 346 — `titanic_interior` scene: implementation

Implements the Fable build spec `20260821_345_titanic_interior_scene_spec.md`
exactly: a new sim scene for the ship's boiler room, driven by **two MarsinLED
Angio4 controllers, sACN pixel only — zero DMX fixtures**.

## 1. Files

Hand-authored:

| File | What |
|---|---|
| `simulation/scenes/titanic_interior/scene_config.yaml` | `NEW_SCENE_TEMPLATE` shape; `parLights.fixtures: []`; 12 LED strands per spec §4 |
| `simulation/scenes/titanic_interior/controllers.yaml` | `nextControllerId: 3`, `nextUniverse: 21`; cards `BoilerRoom-A` (id 1, host `.69`) and `BoilerRoom-B` (id 2, host `.70`), `type: LED`, `protocol: sACN`, 3 ports each + `parkedOutputs`; **no `device:` block** (binding happens later against real hardware) |
| `simulation/scenes/manifest.json` | `"titanic_interior"` added after `"titanic"` (the save server also regenerates it) |

Written by the sim's own 💾 Save Configuration path (`window.exportConfig`),
never by hand:

| File | What |
|---|---|
| `simulation/scenes/titanic_interior/patches.yaml` | 12 LED patch records with per-universe `segments` |
| `simulation/scenes/titanic_interior/views.yaml` | group bits `BoilerRoom-A: 1`, `BoilerRoom-B: 2` |
| `marsin_engine/models/titanic_interior.js` | auto-generated Pixelblaze model, 1980 pixels |
| `marsin_engine/models/titanic_interior.effects.js` | empty (no non-light effects) |
| `marsin_engine/models/titanic_interior.viewmasks.js` | pinned group bits, 0 presets |

## 2. Geometry and addressing — as specified, verified

6 lines × (Seg1 180 px + Seg2 150 px) = **12 strands / 1980 px**. Seg1
`x −5.5 → 0.5`, Seg2 `x 0.5 → 5.5`; A on `z −2.2`, B on `z +2.2`; `y` 2.6 /
1.8 / 1.0. Colour `#ff8800`, intensity 1, groups `BoilerRoom-A` / `-B`.

RGBW stride 4, `whiteMode: native`, `startAddress: 1` on every output. The
per-output projection (`led_patch_projection.js`, the single source of truth)
returns **zero violations** and exactly the spec's layout:

| Card | Port→Output | Seg1 | Seg2 | Output span |
|---|---|---|---|---|
| A | P1→O1 | U1 ch1–512 ×128, U2 ch1–208 ×52 | U2 ch209–512 ×76, U3 ch1–296 ×74 | U1 ch1 → U3 ch296 · 330 px |
| A | P2→O2 | U4 / U5 | U5 / U6 | U4 ch1 → U6 ch296 · 330 px |
| A | P3→O3 | U7 / U8 | U8 / U9 | U7 ch1 → U9 ch296 · 330 px |
| B | P1→O1 | U11 / U12 | U12 / U13 | U11 ch1 → U13 ch296 · 330 px |
| B | P2→O2 | U14 / U15 | U15 / U16 | U14 ch1 → U16 ch296 · 330 px |
| B | P3→O3 | U17 / U18 | U18 / U19 | U17 ch1 → U19 ch296 · 330 px |

O4 parked on U10 / U20 on each card. Span per controller: A U1–10, B U11–20
(both ≤ 16).

## 3. Checks run

- **Independent projection replay** — `computeLedStrandPatches` over the two
  authored YAMLs: 12 strands, **1980 px**, **0 violations**, byte layout
  identical to spec §2/§3 above.
- **Sim save round-trip** — the saved `patches.yaml` is **byte-identical** to
  the independently computed expectation (the exporter's math, not mine).
- **Idempotent re-save** — second 💾 through the same path: `scene_config.yaml`,
  `controllers.yaml`, `patches.yaml`, `views.yaml` and the engine model all
  **identical** (model differs only in its `// Updated:` stamp). No churn.
- **`cd simulation && npm run check`** — pixel-views check PASSes
  (`artifact is current`); node suite **2610 tests, 2605 pass, 4 fail, 1 todo**.
  All 4 failures are pre-existing UI/canvas tests hard-pinned to the `titanic`
  scene (`live_touch_ui_layout`, `pixel_map_edit_lifecycle`,
  `pixel_map_geometry_regression` ×2) and untouched by an additive new scene;
  they sit on top of this wave's concurrent Titanic + controllers-panel work
  (the run also reports the pre-existing `titanic` model drift, 964 vs 963).
  The `scene_data_lint` G8 residue warning is the known
  `summer_camp_dome/patches.yaml.original` item, not new.
- **Scene lint gates for the new scene all PASS**: every structural YAML
  parses; `patches.yaml` → zero anomalies; `controllers.yaml` → every IP
  well-formed, no duplicates.
- **Engine boot** (`--model titanic_interior --pattern 01_cylon_sweep`, scratch
  API port, sACN destination pointed at a blackhole test address, state dir
  redirected out of the repo):
  `✅ Model loaded: 1980 pixels` ·
  `✅ Shared DMX mapper: 1980/1980 pixels patched across 18 universe(s) [1..9, 11..19]` ·
  `[sACN Out] Sender started — 18 universe(s), priority 100`.
  Universe histogram off the generated model matches: 128/128/74 per output,
  nothing on U10/U20.
- **`python scripts/security_check.py --all`** — **no finding in any
  `titanic_interior` file**. The 6 repo-wide findings are pre-existing MACs
  inside the gitignored `simulation/.scene_backups/`.

## 4. Renders (visually inspected)

Via `.agent/skills/see_the_world.md` (`agent_render.cjs`, `--url` scene
override, ad-hoc `--camera/--target`, 1280×720 SwiftShader):

- `.agent_renders/1787345026_ti_front.png` — six lit lines, two depth planes.
- `.agent_renders/1787345057_ti_aerial.png` — top-down: two bands symmetric
  about the room centreline (the two walls), each spanning the full 11 m.
- `.agent_renders/1787345077_ti_threequarter.png` — six clearly separated
  lines, 3 per wall, evenly stacked.

Controller Mapping pane (`agent_tools/controllers_pane_toggle_verify.cjs` +
a scratch scroll probe, sACN-OUT socket blocked, nothing saved):
`~/tmp/ti_controllers_pane/`. Reads `CONTROLLERS (2)` ·
`DMX CONTROLLERS (0)` · `MARSINLED CONTROLLERS (2)`; both cards show
`MarsinLED / sACN`, `order RGBW stride 4 base U1 @ 1` (B: `base U11`),
`W:native`; every port row shows its two strand chips with the exact
universe:channel spans of the table above and the derived
`⌁ P<n> → output <n>: … · 330px` line; `UNMAPPED FIXTURES (0) — every fixture
& strand is mapped`; **no collision, duplicate or unpatched chips**.

## 5. Open items / residue (operator decisions)

1. **`simulation/scenes/titanic_interior/timeline/playa_default.yaml` — engine
   boot residue.** The engine's timeline service auto-wrote a default plan into
   the new scene during the boot probe. The spec's initial file set has no
   timeline, and **this generated file contains future dates**, which tracked
   files in this public repo must not carry. I did not delete it (timeline
   files are read-only for me this wave). **Delete it before committing the
   scene**, or move it under the local-only planning path.
2. **`maxSpotlights` saves as 0, not the template's 60.** The sim's canonical
   boot URL pins `spotlights=0` (the operator-facing default: analytic
   SpotLight pool disabled), so any 💾 writes 0. Kept as written — that is what
   makes the save idempotent, and the scene has zero DMX fixtures so the pool
   is inert.
3. **`§6.2`'s `Board outputs:` line is not reachable yet** — by design. The pane
   renders it only from a device that has actually been READ, and per spec §5
   the cards carry no `device:` block. It appears after discovery + bind against
   the real boards; the cards currently show `board unverified` /
   `Discover / bind device`, which is the expected pre-hardware state.
4. **`§6.3`'s sim-side half (sACN-IN monitor showing the strands animating) was
   not exercised.** Streaming U1–U19 into the shared sACN-IN bridge would have
   driven another operator sim window's DMX fixtures on those same universes
   (the sim reported `2 sim windows connected` throughout). The engine half is
   proven above; run the sim half from the launcher when the stack is yours.
5. **Test side effect from `npm run check`:**
   `simulation/scenes/titanic/pixel_map_views.yaml` gained a 2-line offset drift
   (`Left_Back_Left` dx/dy) from `pixel_map_edit_lifecycle.test.js`. Reported,
   not reverted.
6. **Not mine:** `simulation/scenes/common.yaml` (`lightingMode`),
   `simulation/scenes/studiodj/patches.yaml`, `marsin_engine/models/studiodj.*`
   and `marsin_engine/states/titanic/*` all changed after my runs finished —
   concurrent work on this box. Untouched.
7. **Sim stack:** it was down when this work started; I brought a bare
   `npm start` up for the save + renders and shut it down again. Relaunch
   through the launcher as usual.

No commits, no pushes. Hardware push (⬆) remains out of scope: the plan already
satisfies `validatePerOutputPlan` (all-or-none, sACN, start 1, span ≤ 16, no
overlap), so it needs nothing beyond discovery + bind.
