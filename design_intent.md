# BM26 TITANIC — Design Intent & Implementation Notes

This document captures the current implementation decisions, field-tested operational guidelines, and future integration goals for the TITANIC lighting system.

---

## 1. Par Light Module System

### Design Philosophy
The par lights use a **modular, volunteer-friendly rigging system** designed around zero-heavy-equipment deployment:

- **1-meter pre-rigged sections** — each module is a straight bar with fixtures pre-wired and pre-focused. Two people can carry and install a section without heavy equipment. This matches the standard used in professional EDM touring rigs where 1m sections fit width-wise in any rental truck (vs. 3m sections that won't fit in a U-Haul).
- **Flexible strong wire hanging** — modules mount via stiff but bendable wire arms that hook over integrated 8" wooden hooks built into the ship's top ridge. No bolting, no heavy equipment — a volunteer simply carries the module up the ship side and drapes it over the hooks.
- **Bin storage** — modules store flat-packed in labeled bins. Setup instruction: *"Plug these in in-order, climb the ship side, drape them over the wooden hooks you see built into the top ridge."*
- **Self-alignment gravity hang** — each module has a gravity-assisted alignment mechanism so it naturally aims downward along the hull when hung from the hooks.

### Static vs. Moving Heads
The pars are **static fixtures** — no pan/tilt movers. Rationale:
- Moving heads add significant budget and depreciation from playa dust exposure
- Narratively, why would spotlights on the Titanic track and move? Static uplighting is more authentic
- The additional complexity of movers is not justified by the visual payoff for this piece

### Festoon Alternative (Under Consideration)
A heavy-duty festoon strand could achieve a similar visual effect with dramatically simpler setup and strike:
- Two people, one hour — just hanging cable over integrated wood hooks
- No mechanical/electrical join futzing at bar connections
- Trade-off: festoons lose the precise 1m spacing and focused beam control of par bars
- A hybrid approach is worth exploring: festoon-style cabling with individual par cans at regular intervals

### Fixture Selection
Targeting **IP65-rated LED pars** (eBay-sourced, ~50-100W class):
- IP65 is essential for playa dust and occasional rain
- **Old-style PowerCon** (not True1) connectors — significantly cheaper cabling
- Lower wattage (50W) pars allow longer daisy-chains per circuit (see DMX Power section)
- Consider 3D-printed globe diffusers: open/direct-emitting downward for hull wash, diffused from the side for festoon-style circular glow patterns

> **Note:** Order a single 50W LED par to evaluate — they produce surprisingly usable output. 10W/30W/50W floods are all viable at different ranges. The big light circles on the ground in the simulation are almost as visually impactful as the hull wash — a dual-personality fixture (globe on top, direct beam below) could achieve both.

---

## 2. Iceberg Work Lights — Industrial Light Towers

### Design Decision
The work lights inside the icebergs are **industrial mobile light towers** — the kind rented from Sunbelt or similar:
- Must be movable during construction
- Must be lowerable for storms (playa wind protocol)
- The iceberg sculptures must **crack open** to allow access for getting towers in and out

### Diffuser Concept
For non-work hours, custom diffuser shells can be placed over the bare emitters:
- Stylized globe or ice-crystal shapes that fit over the work light heads
- Transforms functional construction lighting into art-mode ambient lighting
- Removable for construction operations

### Modularity & Burn Plan
The 4 stylized icebergs raise important build and logistics questions:
- As shown, they are **4 custom pieces** — significant fabrication time
- Consider making them from modular panels (2x4 + plywood frames) for ease of build
- **Burn plan options to decide:**
  - Move closer to the ship and burn with it (increases complexity)
  - Disassemble and take home (reuse value, but labor-intensive)
  - Burn in place (dramatically increases burn circle diameter)
  - All LEDs must be removable regardless — even with modular growler fixtures

---

## 3. Smokestack Ring Lighting

### Top Rings (VR Opportunity)
If a vehicle rental (VR) is needed anyway for construction/strike, it's a **missed opportunity** not to ring the top of the smokestacks:
- The stacks are the **pinnacle and beacon** of the piece — the most iconic visual cue
- "What makes you read a ship as the Titanic? The stacks."
- Implementation: direct outward-facing LED rings or downward-facing rings that scrape light down the stack surface

### Partially Submerged Stack Safety Lighting
The partially-submerged smokestacks need lighting **more than the main ship** for safety:
- They are smaller obstacles — harder to see in a dust storm on an e-bike
- The main ship hull eventually fills your field of vision; the stacks don't
- **Do NOT light from the ground** — that means more cables to trench and more fixtures to accidentally bike over
- Use the **same ring fixture design** as the stack tops → 4 identical modular units
- Perfect candidate for **1D animation** (Pixelblaze patterns) — very high visual impact for minimal engineering effort

### Guy Line Lighting
- **Rope light on guy lines** going into playa — these are safety-critical (bikers/art cars can hit them)
- Considered but deferred: LEDs on all guy lines for an aesthetic "tent" / "catenoid rib" effect
- The aesthetic vision for far-distance readability: pars dim, smokestack ring halos + all guy lines very bright → looks like floating halos with translucent veils/ribs as you approach from afar

---

## 4. DMX Power Requirements

### Power Budget Per Circuit
Each powercon daisy-chain should not exceed **1600W per circuit/chain**.

| Fixture Wattage | Max Fixtures Per Chain | Notes |
|-----------------|----------------------|-------|
| 200W pars | 7 fixtures | Current eBay par selection |
| 100W pars | 15 fixtures | Better chain length |
| 50W pars | 30+ fixtures | Excellent chain length, consider these |

### DMX Channel Allocation

| Fixture Type | Channels Per Fixture | Notes |
|-------------|---------------------|-------|
| LED Par (RGBW) | 4-8 ch | Depends on mode (4ch = RGBW, 8ch = RGBW + dimmer/strobe/mode) |
| LED Par (RGB) | 3-6 ch | Simplest mode |
| Smokestack Rings | 1-3 ch per pixel | If Pixelblaze-driven: 3ch RGB per pixel |
| Iceberg Floods | 1, 4, or 8 ch | Single dimmer or full RGBW |
| LED Strands | Varies | Addressable: 3ch per LED; segments: 3ch per segment |

### DMX Universe Planning
- **1 universe = 512 channels**
- At 8ch/fixture, 1 universe handles ~64 par lights
- With ~100+ pars planned, budget **2 DMX universes minimum** for pars alone
- Smokestack rings + iceberg floods in a **3rd universe**
- Total estimate: **3-4 DMX universes**

---

## 5. Chromatik Export Goals

### 3D Model Import
- Export the simulation's ship geometry as an optimized mesh (OBJ/FBX) for import into Chromatik's 3D visualizer
- Correct coordinate system baking (Y-up vs Z-up alignment) for accurate spatial mapping

### Light Position Export
- Export all light fixture positions as **"big pixels"** in Chromatik
- Each par light → 1 pixel with XYZ position from `scene_config.yaml`
- Each iceberg flood → 1 pixel
- Each smokestack ring segment → 1 pixel per segment
- Format: Chromatik fixture JSON or CSV with `(x, y, z, fixture_type, dmx_universe, dmx_address)`

### Workflow
1. Tune fixture positions in the simulation (current workflow)
2. Export → Chromatik fixture map
3. Author patterns in Chromatik against the 3D model
4. Send patterns to real hardware via DMX output

---

## 6. NDI In/Out — Simulation ↔ Chromatik Pipeline

### Intent
Bidirectional real-time video/data streaming between the Three.js simulation and Chromatik:

#### Simulation → Chromatik (NDI Out)
- The simulation generates patterns (eventually running Pixelblaze pattern code) and sends pixel data out as NDI
- Chromatik receives this as a video source and maps it to DMX output for real hardware
- Use case: develop and preview patterns in the sim, then deploy directly to physical fixtures

#### Chromatik → Simulation (NDI In)
- Chromatik sends its pattern output back to the simulation as NDI
- The simulation receives and applies the color data to the 3D fixture meshes in real-time
- Use case: pattern development in Chromatik with immediate visual feedback in the full 3D scene (no physical hardware required)

### Technical Notes
- NDI transport via WebSocket bridge (NDI SDK → Node.js → WebSocket → Three.js)
- Pixel mapping: each NDI pixel corresponds to a fixture index in `scene_config.yaml`
- Latency target: <100ms roundtrip for interactive pattern development

---

## 7. Operational Philosophy

> *"This is supposed to be a recovery year to 'do less on playa' and keep things simple."*

Every lighting decision should be evaluated through the lens of:
1. **Dumb lights over smart lights** — premade, cheap products that "just work" beat custom solutions
2. **Volunteer-deployable** — can someone with zero training set it up from a written instruction card?
3. **Dust-proof** — IP65 minimum, no exposed connectors, no ground-level cable runs where avoidable
4. **Modular & identical** — 4 identical smokestack ring units beats 4 custom pieces
5. **Complexity budget** — every custom, ambitious, "new thing" costs exponentially more human hours on playa than anticipated. New and ambitious feels like the Mothership intro sequence fiasco. Plan accordingly.
