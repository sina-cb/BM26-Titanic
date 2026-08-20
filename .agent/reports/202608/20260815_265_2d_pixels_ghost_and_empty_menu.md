# _265 — the 2D Pixels dark ghost ship, and the Lighting Controls menu that rendered blank

**Agent:** Opus fix agent · **Date:** 2026-08-15 · **Branch:** `feat/bm_audio_tuning`
**Subsystem:** `simulation/` (lighting profiles, GUI panels)

---

## The two defects, as the operator reported them

Both seen on the iPad's **2D Simulator** tab against the PROD stack, which serves
`http://<engine-host>:6969/simulation/?profile=2d_pixels&lighting_mode=sacn_in`
(`CaptainPad/utils/simulation_url.ts` → `PIXEL_SIMULATION_PATH`).

1. **The Lighting Controls menu renders EMPTY.**
2. **A dark "ghost ship"** — slightly larger than, and behind/beside, the live 2D
   pixel map.

Both are now fixed, both reproduced first, and neither was what the brief's
leading hypothesis assumed. Nothing was assumed; every claim below is a measured
number from a scratch sim.

---

## How this was verified without touching the live stack

The operator's stack was up the whole time (6966–6972, 5568, 6981, 7175 all
LISTENING). Renders open browsers, so they could not point at it. A **complete
scratch sim** was stood up instead:

- `~/tmp/ghost_sim/config.yaml` — http 7869, save 7870, sACN in/out 7871/7872,
  **UDP 15568** (never the E1.31 5568 the rig listens on), engine 7868.
- `~/tmp/ghost_sim/static_server.cjs` — serves the repo root exactly like the
  real `npx http-server ../`, **except** `/simulation/config.yaml`, which it
  answers from the scratch file. That is the one interception that matters: the
  page derives the save-server and both sACN bridge ports from that document, so
  without it a probe browser would have registered as a client on the operator's
  live input bridge and joined its route arbitration.
- `save-server.js` + both bridges under `BM26_SIM_CONFIG` (the documented
  override in `simulation/lib/load_ports.cjs`).

The scratch input bridge printed
`✅ Receive socket listening on :15568` and, finding the live bench-mirror arm
interlock claimed by pid 48344, **left it alone**. The scratch save-server logged
**no writes at all** (3 lines: two boot manifest regenerations, then "listening").
`simulation/scenes/titanic/pixel_map_views.yaml` did change on disk during the
window — that is the LIVE stack's own save-server, not this one. The whole
scratch constellation was torn down at the end; the live ports were verified
still up (11 listeners) and were never bound, restarted or swept.

Renders through the sanctioned path only: `simulation/agent_tools/agent_render.cjs
--url http://127.0.0.1:7869/... --viewport …` per `.agent/skills/see_the_world.md`.
Screenshots: **`~/tmp/ghost_sim/before/` and `~/tmp/ghost_sim/after/`** (13 PNGs
each side), all inspected.

---

## Defect 2 — the ghost: ROOT CAUSE

It is not an initial render before the gate, and it is not a CSS layer. It is a
**latch/authority conflict between two files**:

1. `src/core/animate.js` hides the 3D canvas when the profile becomes headless,
   but the latch is **EDGE-triggered**:
   `if (_headless !== _headlessLatched) { … }`. It fires once, on the transition,
   and never looks again.
2. `src/gui/split_layout.js` installs a debounced `window.resize` listener that
   calls `applyLayout()`. Its **not-engaged** branch (the ordinary, no-controller-
   -map case) ran `placeCanvas(null, true)`, whose first line was an
   **unconditional** `canvas.style.display = visible ? '' : 'none'`.

So: any resize re-showed the full-window 3D canvas while the profile was
`2d_pixels`, and the already-latched hide never took it back. The canvas is
`position: static` full-window; `#pixel-map-panel` is `z-index: 8` and inset
(`top: 44px`) — hence "slightly larger than, and behind" the map.

**What is on that canvas** is the last frame `composer.render()` drew before
headless was entered: the unlit hull under the working profile's flat material —
the dark ship. Three's `setSize` does not repaint it, and a same-size resize (an
iPad WebView layout settle, a rotation, the keyboard) does not even reallocate
the drawing buffer, so the frame survives indefinitely.

Measured transcript (`~/tmp/ghost_sim/before/`, boot `pixel_mapping` → switch to
`2d_pixels`):

```
after entering 2d_pixels: {"inline":"none", "computed":"none"}
after same-size resize  : {"inline":"",     "computed":"block"}   ← ghost on screen
after real resize       : {"inline":"",     "computed":"block"}
```

and the step-by-step walk, same run:

```
02_switched_to_2d      canvas.inline='none'   ✓
03_after_resize_small  canvas.inline=''       ✗ ghost
04_after_resize_back   canvas.inline=''       ✗ ghost
05_controller_map_open canvas.inline=''  rect={x:456,w:724}  ✗ ghost, shifted
```

`before/ghost_pixel_mapping_b_map_hidden.png` is the ghost itself, with the map
panel temporarily hidden: three dark grey hull sections at the default camera.

### The fix

A new **single authority**, `simulation/src/core/canvas_visibility.js` (pure,
DOM-free, imports only the profile registry):

- `isHeadlessProfile(profileId)` — read from the registry, not a hardcoded list,
  so a second headless profile inherits the rule.
- `canvasDisplayFor(profileId, layoutWantsVisible)` — **the layout ASKS, the
  profile VETOES.** A headless profile returns `'none'` whatever the layout wants;
  a 3D profile still obeys the layout in both directions (so `mapMax` still hides
  the canvas, and leaving `2d_pixels` still brings the 3D view back).
  A non-boolean request throws (codex P0 — no guessing).
- `applyCanvasVisibility(renderer, profileId, layoutWantsVisible)` — sets the
  display **and calls `renderer.clear()` whenever it hides**, so there is no stale
  frame left for any future caller to reveal. Belt (the veto) and braces (nothing
  to show).

Both call sites now go through it:
- `animate.js` headless latch → `applyCanvasVisibility(...)`
- `split_layout.js` `placeCanvas()` → `canvas.style.display = canvasDisplayFor(params.lightingProfile, visible)`

After, same probes:

```
after entering 2d_pixels: {"inline":"none"}
after same-size resize  : {"inline":"none"}
after real resize       : {"inline":"none"}
```

```
02_switched_to_2d      canvas.inline='none'  notice=banner
03_after_resize_small  canvas.inline='none'  notice=banner
04_after_resize_back   canvas.inline='none'  notice=banner
05_controller_map_open canvas.inline='none'  notice=banner
06_back_to_3d          canvas.inline=''  rect={x:456,w:724}  notice=null   ← 3D restored
07_second_entry_2d     canvas.inline='none'  notice=banner
```

`after/ghost_pixel_mapping_b_map_hidden.png` — the identical capture — is pure
black. `after/06_back_to_3d.png` shows the 3D view rendering live inside the
controller-map split, so this is **not a one-way door**.

---

## Defect 1 — the empty menu: ROOT CAUSE

Also not what it looked like. The panel is **not** empty by profile design — in
`2d_pixels` it legitimately carries Atmosphere, Model Transform, Layout Tools,
DMX Fixtures, LED Fixtures and Options, and at 1180×820 it renders all of them.

The blank came from `gui_builder.js`'s last three lines:

```js
if (window.innerWidth <= 768) { gui.close(); }   // "Small Screen Auto-Collapse"
```

That closes the **lil-gui ROOT**. But this panel hides lil-gui's root `.title`
(our own `#gui-panel` header replaces it, ~line 455) — so a closed root has **no
affordance left to reopen it**. Measured at 760×1000:

```
panelRect       : 330 × 848      (the drawer is open)
controllers     : 1103           (all present in the DOM)
visibleControllers: 0            (none rendered)
bodyScrollHeight: 815 (chrome only)
bodyText        : ""
```

A 330×848 panel titled "🔦 LIGHTING CONTROLS" containing literally nothing, with
no way back — `before/menu_760x1000.png`.

The small-screen protection that close was reaching for **already exists one
layer up**: `control_drawer.js` `readCollapsed()` defaults to collapsed below
800 px, sliding the whole drawer off the right edge and leaving a reopen tab
(visible in `before/narrow_760x1000_drawer_collapsed.png`). The root close was
redundant *and* it broke the drawer it was duplicating.

### The fix, in two parts

**(a) Remove the unreachable root close.** The drawer is the affordance. After:
`visibleControllers: 24`, `bodyScrollHeight: 1317`, every section back.

**(b) Name the state anyway** — new `simulation/src/gui/profile_capability_notice.js`.
A panel that goes contentless must never be mute. Pure policy + a DOM installer
that takes any panel body, so a sibling panel can reuse it:

- `profileNoticeMode(profileId, controlCount)` → `'none' | 'banner' | 'sole'`.
  A 3D profile is always `'none'` (the controls mean something — not this
  module's business). A headless profile with rendered controls gets `'banner'`;
  with **zero** gets `'sole'` — the notice *is* the panel.
- `countPanelControls(bodyEl)` counts controls that are **actually rendered**
  (rect height > 0), because the operator's case had 1103 rows in the DOM and 0
  px of them. Presence is not content.
- Wired at the end of `setupGUI` **and** in the `lightingProfile` change handler,
  so it appears and disappears in both directions at runtime.

The wording invents no controls and changes no capability — it narrates the one
the registry already declares:

> **LIGHTING CONTROLS UNAVAILABLE — 2D PIXELS (PI / NO-GPU)**
> The lighting controls in this panel are unavailable — they shape a 3D render
> this profile does not do.
> This sim is running the "2D Pixels (Pi / no-GPU)" lighting profile
> (`2d_pixels`): no analytic lights, no light cones, no emitters, no bloom or
> shadows, and no per-frame 3D render at all. The live surface is the 2D Pixel Map.
> Patching, mapping, sACN and the pixel map itself are unaffected — only the 3D
> lighting render is off.
> Want the 3D view and its controls back? Options → 💡 Lighting Profile → edit,
> pixel_mapping, emissive or full.

In `'sole'` mode the first line becomes *"There is nothing to control here. This
panel is empty on purpose — it is not broken."* The `'banner'` copy is explicitly
tested **not** to claim an unpopulated panel, and neither variant claims patching
or mapping is off — because they are not.

Styling: `.profile-capability-notice` in `style.css`, built on the existing
`--warning` / `--warning-container` / `--warning-container-border` theme tokens
(no new variables, so `theme_parity` stays green).

**Scope check on "sibling panels that go contentless":** the Pattern Editor,
Controller Mapping and Pixel Map panels were all inspected in `2d_pixels` and
none goes contentless — the notice is wired to the Lighting Controls panel only,
via a helper that any other panel can adopt when it needs to.

---

## Files changed

| File | Change |
|---|---|
| `simulation/src/core/canvas_visibility.js` | **new** — the profile-vetoes-layout authority + clear-on-hide |
| `simulation/src/core/animate.js` | headless latch routes through `applyCanvasVisibility` |
| `simulation/src/gui/split_layout.js` | `placeCanvas` asks `canvasDisplayFor` instead of forcing `display` |
| `simulation/src/gui/profile_capability_notice.js` | **new** — the named contentless-panel state |
| `simulation/src/gui/gui_builder.js` | unreachable `gui.close()` removed; notice synced at boot + on profile change |
| `simulation/style.css` | `.profile-capability-notice` styling on existing theme tokens |
| `simulation/tests/headless_canvas_visibility.test.js` | **new** — 11 tests |
| `simulation/tests/profile_capability_notice.test.js` | **new** — 13 tests |

No profile capability was changed: `profile_registry.js` is untouched.

---

## Gates

**Sim suite:** `node --test tests/*.test.js` → **2409 tests, 2399 pass, 9 fail,
1 todo** (70.5 s). The two new files are **24/24 green**.

All 9 reds are **pre-existing and foreign** — none of their files imports any
module touched here (verified by grep for `canvas_visibility`,
`profile_capability_notice`, `split_layout`, `gui_builder`, `core/animate`):

| File | Reds | Why it is foreign |
|---|---|---|
| `scene_data_lint` | 1 | `scenes/summer_camp_dome/patches.yaml.original` residue — the test's own message says the operator must delete/archive it (report `20260805_163`) |
| `bench_mirror_state` | 1 | same residue file trips "the repo scene directory must be untouched" |
| `bench_section_sync` | 5 | working-tree scene data — `simulation/scenes/**` currently carries foreign modifications and deleted playlists from other in-flight waves |
| `launcher_supervision` | 2 | spawns real children / asserts a shared Metro env contract while the operator's stack owns 6969–6972 |
| `touch_control_pixel_views` | 1 | orientation-projection correlation, exported pixel-view artifact |

**Screenshots (all inspected):** `~/tmp/ghost_sim/before/` vs `~/tmp/ghost_sim/after/`
— `ghost_pixel_mapping_b_map_hidden.png` (dark hull → pure black),
`menu_760x1000.png` (blank 330×848 panel → notice + 24 rendered controls),
`ipad_landscape_1180x820.png` (the operator's actual view, notice reading cleanly),
`01..07_*.png` (the full transition walk, both directions).

---

## Hygiene / handoff

- **No git operations.** No commits, no branch work.
- Scratch stack (7869–7872, UDP 15568) torn down; live 6966–6972 / 5568 / 6981 /
  7175 never bound, restarted or swept. No engine or Metro restart, no dist write.
- All scratch tooling and screenshots live in `~/tmp/ghost_sim/` (gitignored).
- **This lands on the live surface only at the coordinator's end-of-batch
  restart** — the sim serves these files statically, so the fix is live for the
  operator on the next reload of the 2D Simulator tab after the sim stack is
  restarted (or immediately on a hard reload, since `npx http-server` runs with
  `-c-1`). Nothing here needs an engine restart.
- **Operator check:** open the iPad's 2D Simulator tab, rotate the iPad (or
  resize the window) a few times — no dark ship should ever appear behind the
  pixel map. Then open the Lighting Controls drawer: it names the profile at the
  top and lists its sections; switch Lighting Profile to `full` and the notice
  goes away with the 3D view coming back.
