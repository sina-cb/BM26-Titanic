# 🎯 Par Light Module System

## Overview

The par light array is the primary interactive lighting layer of the TITANIC installation. This document describes the modular hardware design for deploying ~100+ par fixtures along the ship hull using a **volunteer-friendly, zero-heavy-equipment rigging approach**.

---

## Module Design

### 1-Meter Pre-Rigged Sections
Each module is a straight aluminum or steel bar with fixtures pre-mounted, pre-wired, and pre-focused:

- **Length:** 1 meter (fits width-wise in any rental truck; 3m sections do not fit in a U-Haul)
- **Fixtures per module:** 3-5 pars depending on spacing
- **Wiring:** Pre-wired with PowerCon (old-style, not True1 — lower cable cost) daisy-chain
- **Weight:** Manageable by 1-2 people without equipment

### Flexible Wire Hanging Arms
- **Material:** Stiff but bendable heavy-gauge wire (think coat-hanger-gauge but stronger)
- **Mounting:** Hook over 8" wooden hooks integrated into the ship's top ridge during construction
- **Alignment:** Gravity-assisted self-alignment — when the module hangs from the hooks, the pars naturally aim downward along the hull face
- **Adjustment:** Wire arms can be bent by hand for fine-tuning aim angle

### Storage & Transport
- Modules store flat in labeled bins
- Each bin contains modules for one section of the ship (e.g., "Port Forward — Bins 1-4")
- PowerCon jumper cables stored with modules

---

## Deployment Workflow

### Setup (Target: 2-person crew, ~1 hour per ship side)
1. Carry bin to deployment section
2. Unpack modules
3. Starting from one end, plug modules into PowerCon daisy-chain
4. Climb the ship side and drape each module over the wooden hooks
5. Hand-adjust wire arms for aim (mostly unnecessary due to gravity alignment)
6. Connect trunk power line at the end of the chain

### Strike
1. Unplug power
2. Lift modules off hooks
3. Coil cables, pack into bins
4. No tools required, no bolts, no heavy equipment

---

## Fixture Selection

### Target Specs
| Spec | Value | Rationale |
|------|-------|-----------|
| Wattage | 50-100W | Longer daisy-chains, surprisingly bright output |
| IP Rating | IP65 minimum | Essential for playa dust and rain |
| Connector | Old PowerCon | Cheaper cabling than True1 |
| Color | RGBW | Full color mixing plus dedicated white |
| DMX | 4-8 channel modes | Flexible control depth |

### Power Chain Budget
At 1600W max per PowerCon circuit:
- **200W pars:** 7 per chain (current plan — short chains, many runs)
- **100W pars:** 15 per chain (good middle ground)
- **50W pars:** 30+ per chain (excellent — consider these seriously)

### Globe Diffuser Concept
3D-printed globe diffusers that attach over each par can:
- **Downward:** Open/direct-emitting for focused hull wash
- **Side:** Diffused for festoon-style circular glow on the ground
- Creates the big light circles visible in the simulation, almost as impactful as the hull wash itself

---

## Festoon Alternative

A heavy-duty LED festoon strand with built-in fixtures at regular intervals offers a dramatically simpler approach:

### Advantages
- **Setup:** Two people, one hour — just draping cable over wood hooks
- **Strike:** Pull cable, coil, pack — no mechanical/electrical join futzing
- **Reliability:** Fewer connections = fewer failure points in dust

### Trade-offs
- Less precise beam control vs. bar-mounted pars
- Fixed spacing determined by strand manufacturing
- May not achieve the focused upwash effect

### Hybrid Approach
Consider festoon-style cabling (continuous weatherproof cable) with individual par cans mounted at 1m intervals — the installation simplicity of festoons with the optical precision of pars.

---

## DMX Addressing

With ~100+ par lights at 4-8 channels each:
- **Minimum:** 2 DMX universes (at 4ch/fixture)
- **Recommended:** 2-3 universes with room for expansion
- Address sequentially along each ship section for intuitive pattern mapping
