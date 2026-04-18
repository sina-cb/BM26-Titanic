# BM26 TITANIC — Design Intent & Implementation Notes

This document captures the current implementation decisions, field-tested operational guidelines, and architectural realities for the TITANIC lighting system codebase as of April 2026.

---

## 1. Modular LED Rigging System

### Design Philosophy
The primary light fixtures use a **modular, volunteer-friendly rigging system** designed around zero-heavy-equipment deployment:

- **Shehds 18x18W Bars** — Powerful 6-channel (RGBWAU) rectilinear wall-washers deployed for volumetric baseline colors and swift Cylon-style scanning sequences. Mapped to `sectionId: 3` in the V2 engine model.
- **Uking Par Lights** — Structural uplighting and broad illumination, mapped to `sectionId: 1`. 
- **Vintage Wash Heads** — Deep amber, cinematic lighting targeting architectural high-points and specific "classic Titanic" focal scenes. Mapped to `sectionId: 2`.
- **Bin storage** — Modules store flat-packed in labeled bins. Setup instruction: *"Plug these in in-order, climb the ship side, drape them over the wooden hooks you see built into the top ridge."*

### Static Execution over Movers
The pars and bars are **static fixtures** — no pan/tilt movers. Rationale:
- Moving heads add significant budget and depreciation from playa dust exposure.
- Static uplighting combined with high-speed WASM-based Pixelblaze logic creates profound artificial motion mathematically, without mechanical risk.

---

## 2. MarsinEngine WASM V2 & Software Patterns

### Depreciation of Third-Party Consoles (Chromatik)
Early concepts relied on exporting 3D meshes to Chromatik (LXStudio) and sending NDI data. **This pipeline has been entirely superseded**.
- The system now exclusively uses **MarsinEngine**, a native WASM-compiled Pixelblaze virtual machine that parses highly mathematical, physics-driven scripts at sub-millisecond speeds.
- Rather than drawing "video" across the ship, 26 highly specific, parametric JavaScript algorithms (00–25) generate continuous multi-universe sACN streams internally.

### The Color Bible & Aesthetic Design
We do not run random, algorithmic RGB noise. The aesthetic depends heavily on:
1. **Primary Restrictive Locking**: If the UI asks for Red, the script stays strictly Red with carefully bounded mathematical hue shifts. 
2. **Deep Ambient Slowness**: Speed sliders map via strict inverse math logic natively limiting chaotic blinking in favor of 50–100 second ambient breathing waves. 
3. **Hardware Channels over Mixing**: White and Amber blowout effects directly strike the dedicated physical `W` and `A` chips inside the Uking/Shehds fixtures rather than relying on software RGB desaturation.

---

## 3. Iceberg Work Lights — Industrial Light Towers

### Design Decision
The work lights inside the icebergs are **industrial mobile light towers** — the kind rented from Sunbelt or similar:
- Must be movable during construction
- Must be lowerable for storms (playa wind protocol)
- The iceberg sculptures must **crack open** to allow access for getting towers in and out

### Diffuser Concept
For non-work hours, custom diffuser shells can be placed over the bare emitters:
- Stylized globe or ice-crystal shapes that fit over the work light heads.
- Transforms functional construction lighting into art-mode ambient lighting.

---

## 4. Smokestack Ring Lighting

### Top Rings (VR Opportunity)
If a vehicle rental (VR) is needed anyway for construction/strike, it's a **missed opportunity** not to ring the top of the smokestacks:
- The stacks are the **pinnacle and beacon** of the piece — the most iconic visual cue.
- Implementation: direct outward-facing LED rings or downward-facing rings that scrape light down the stack surface.

### Partially Submerged Stack Safety Lighting
The partially-submerged smokestacks need lighting **more than the main ship** for safety:
- They are smaller obstacles — harder to see in a dust storm on an e-bike.
- **Do NOT light from the ground** — that means more cables to trench and more fixtures to accidentally bike over.

---

## 5. Master Architecture — CaptainPad UI

To remove the need for a lighting engineer to sit at a laptop parsing configurations, the entire interaction surface has been offloaded to **CaptainPad**:
- An Expo/React Native application sitting on an iPad at the podium.
- Dynamically reads WebSocket exports from MarsinEngine to synthesize UI sliders on-demand (e.g. `Eye Width`, `Shimmer Density`, `Secondary Tail Hue`).
- Connects directly to global DMX variables to ensure "Master Dimmer" override states are strictly enforced during interactive pattern execution.

---

## 6. DMX Power Requirements & Footprints

- **1 universe = 512 channels**
- Shehds 18x18 Bars are running on massive 119-channel footprint mapping to properly decouple every LED cluster on the hardware into discrete pixel models inside the WASM engine.
- Due to the large footprint, universes must be aggressively bridged. The MarsinEngine compiler seamlessly handles the multi-universe gap crossing natively without intervention.

---

## 7. Operational Philosophy

> *"This is supposed to be a recovery year to 'do less on playa' and keep things simple."*

Every lighting decision should be evaluated through the lens of:
1. **Dumb Hardware, Sophisticated Algorithms** — cheap, sealed wash bars executing profoundly complicated software algorithms beats mechanical lighting products.
2. **Volunteer-deployable** — can someone with zero training set it up from a written instruction card?
3. **Dust-proof** — IP65 minimum, no exposed connectors, no ground-level cable runs where avoidable.
4. **Complexity budget** — The software complexity has been absorbed upfront. Deployment on-playa must remain "plug in DMX, plug in power, launch iPad."
