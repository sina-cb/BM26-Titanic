# 345 — Build spec: `titanic_interior` simulation scene

Planner spec (Fable) for an Opus implementer. Nothing here is implemented yet.
References: `docs/41_led_controller_onboarding.md` (§3 per-output contract is
binding), memory note `marsinled-controller-onboarding`, scene precedents
`simulation/scenes/test_bench/` (LED card shape) and `simulation/scenes/led202/`
(minimal file set).

## 1. What we are building

A new sim scene `simulation/scenes/titanic_interior/` for the ship's interior
(boiler room), driven by **two MarsinLED controllers, sACN pixel only — zero
DMX fixtures**:

| Card name | Board | IP (last octet) | Outputs used |
|---|---|---|---|
| `BoilerRoom-A` | Angio4 (old) — GPIO 35/36/37/38 | `.69` | 1–3 (4 parked) |
| `BoilerRoom-B` | Angio4 (new) — GPIO 21/45/14/38 | `.70` | 1–3 (4 parked) |

(Operator wrote "BoilderRoom"; assume the typo, use `BoilerRoom-A/-B` — legal
`deviceName` charset. Full IPs go in the scene YAML per existing convention.)

Each output drives ONE physical LED line made of **two chained segments:
180 px + 150 px = 330 px**. Sim strands are straight start/end lines
(`src/fixtures/led_strand.js` — no polyline), so each line = **two strand
fixtures chained on one port** (chain order packs contiguously, docs/41 §3.3).
Model total: 6 lines / 12 strands / 1980 px.

## 2. Pixel format + channel math

Angio4 boards everywhere else in this repo run **WS281X_RGBW, colorOrder RGBW,
rgbwMode exact → 4 bytes/px** (test_bench card `led:` block, docs/41 §4.1).
Assume the same; read actual strand `type`/pins from `/api/config` at push
time — never invent pins.

Per output: 330 px × 4 = 1320 ch. Pixels never straddle a universe
(128 RGBW px/universe), so one output spans **3 universes** from its base U:

| Pixels | Universe | Channels |
|---|---|---|
| 1–128 | U | 1–512 |
| 129–256 | U+1 | 1–512 |
| 257–330 | U+2 | 1–296 |

Split across the two chained strands:
- **Seg1 (180 px):** U ch1–512 (128 px) + U+1 ch1–208 (52 px)
- **Seg2 (150 px):** starts U+1 ch209 → U+1 ch209–512 (76 px) + U+2 ch1–296 (74 px)

## 3. Universe allocation (fresh scene — no cross-scene constraint)

startAddress always 1; spill stays inside the output's stream; span ≤ 16 per
controller (A: U1–10, B: U11–20 — both fine).

| Card | Port→Output | Base U (spill) |
|---|---|---|
| BoilerRoom-A | P1→O1 | U1 (2,3) |
| BoilerRoom-A | P2→O2 | U4 (5,6) |
| BoilerRoom-A | P3→O3 | U7 (8,9) |
| BoilerRoom-A | O4 parked | U10 |
| BoilerRoom-B | P1→O1 | U11 (12,13) |
| BoilerRoom-B | P2→O2 | U14 (15,16) |
| BoilerRoom-B | P3→O3 | U17 (18,19) |
| BoilerRoom-B | O4 parked | U20 |

## 4. Geometry — boiler room, 6 lines

Room envelope ~12 m × 4.4 m × 3 m. All lines run along X at 30 px/m; each line
is Seg1 (6 m, 180 px) then Seg2 (5 m, 150 px), continuous head-to-tail:
- Seg1: `startX -5.5 → endX 0.5`; Seg2: `startX 0.5 → endX 5.5` (same y/z).
- BoilerRoom-A lines on the port wall `z = -2.2`: L1 `y=2.6`, L2 `y=1.8`, L3 `y=1.0`.
- BoilerRoom-B lines on the starboard wall `z = 2.2`: L1 `y=2.6`, L2 `y=1.8`, L3 `y=1.0`.

Strand names (also the patch keys): `BoilerA_L1_Seg1`, `BoilerA_L1_Seg2`, …
`BoilerA_L3_Seg2`, `BoilerB_L1_Seg1` … `BoilerB_L3_Seg2`. Color `'#ff8800'`,
intensity 1, groups `BoilerRoom-A` / `BoilerRoom-B`.

## 5. Files to create

**`scene_config.yaml`** — clone the `NEW_SCENE_TEMPLATE` shape
(`simulation/server/save-server.js` ~line 168): `modelTransform` (all zeros),
`parLights` with `fixtures: []` (stays empty — no DMX), `ledStrands` with
`strandsEnabled: true` and the 12 strands (`name,startX..endZ,color,intensity,
ledCount,group`; let the sim save assign `sectionId`/`fixtureId`/`viewMask`).

**`controllers.yaml`** — header `nextControllerId: 3`, `nextUniverse: 21`.
Two cards, `id: 1` (A, `.69`) and `id: 2` (B, `.70`), `type: LED`,
`protocol: sACN`. Ports per §3, each row:
`{port, universe, startAddress: 1, output, chain: [<Seg1 name>, <Seg2 name>]}`
(LED chains are plain name lists, not `fixture/at` maps). Per card:
`led: {baseUniverse: 0, startAddr: 1, order: RGBW, stride: 4, whiteMode: native}`
and `parkedOutputs: [{output: 4, universe: 10|20}]`. **No `device:` block** —
binding is by live device `controllerId` via the discovery modal, done later
against real hardware; never persist a MAC.

**`patches.yaml`** — one record per strand:
`controllerIp, controllerId (card id), dmxUniverse/dmxAddress (strand's first
pixel per §2), pixelCount, outputIndex (0-based output), endUniverse,
endChannel, segments: [{universe,startChannel,endChannel,pixelCount}]` per the
§2 split. Note: test_bench's `LED_0` carries a stale `controllerId` mismatched
from its card — do NOT copy that; then confirm a sim save round-trips your
values unchanged (the exporter walks `projectLedStrandSegments`, the single
source of truth — if the save rewrites your math, the save is right).

**`simulation/scenes/manifest.json`** — add `"titanic_interior"` (alphabetical,
after `titanic`). The save server regenerates this file too.

**`marsin_engine/models/titanic_interior.js` (+ `.effects.js`)** — auto-
generated: NEVER hand-write. Load the scene in the sim and 💾 save; the client
POSTs `/save-model` (1980 LED pixels, each with `patch:{universe,addr,
footprint:4}` on the §3 universes). No viewmasks/cameras/playlists/timeline
needed initially (led202 precedent); timeline/playlist files are foreign-owned
this wave — do not touch any existing scene's.

Preferred flow: hand-author `scene_config.yaml` + `controllers.yaml` +
manifest entry → load scene in sim → 💾 Save Configuration → verify the saved
`patches.yaml` + engine model against §2/§3 (fail loud on any delta).

## 6. "Set up properly" end-to-end

1. Scene appears in the sim scene picker; 12 strands render in the layout of §4.
2. Controllers panel shows both LED cards with `Board outputs:`
   `1←P1(U..) 2←P2 3←P3 4 parked U10/U20`, no duplicate/collision chips.
3. Engine pairs: `node engine.js --model titanic_interior --pattern
   01_cylon_sweep` boots with pixelCount 1980 and streams U1–U9/U11–U19 to the
   flat destinations; sim sACN-IN monitor shows the strands animating.
4. Hardware push (⬆ Push, later, boards on the bench) is out of scope here but
   must need nothing beyond discovery+bind — the plan in §3 already satisfies
   `validatePerOutputPlan` (all-or-none, sACN, start 1, span ≤16, no overlap).

## 7. Implementer verification list

- `cd simulation && npm run check` (pixel-views check + node --test suite).
- Engine boot per §6.3 against the running stack; **never bind or kill ports
  6966–6972/6981/5568** — one stack, operator-owned. If the stack is down,
  coordinate with the operator; do not spin a second stack on other ports.
- Renders via `.agent/skills/see_the_world.md` ONLY (`agent_render.cjs`,
  `--show-ui` for the controllers panel + sACN-IN monitor) — never built-in
  browser tools on the sim. Visually inspect PNGs before claiming success.
- Round-trip check: re-save the scene; `git diff` on the scene YAMLs must be
  churn-free (idempotent save = schemas correct).
- `python scripts/security_check.py --staged` before any commit (operator asks
  first): no MACs, no `device:` identity blocks, IPs in scene YAML are the
  accepted convention.
