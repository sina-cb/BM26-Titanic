# 🔥 Smokestack Ring Lighting

## Concept

The smokestacks are the **most iconic visual element** of the Titanic form. They are the pinnacle and beacon of the piece — the feature that makes you read a ship as *the Titanic* from across the playa. Ringed LED fixtures on the stack tops and the partially-submerged stacks create a dramatic, legible silhouette that serves both as art and as critical safety lighting.

---

## Stack Top Rings

### Why
- The literal highest point of the structure — maximum visual impact
- If a vehicle rental is already needed for construction/strike, rigging rings at the top is a natural addition
- Far-distance readability: bright ring halos on stack tops are visible from deep playa

### Implementation Options
1. **Direct outward-facing rings** — LEDs point radially outward, creating a glowing crown effect
2. **Downward-facing rings** — LEDs aim down and scrape light across the stack surface, emphasizing the cylindrical form

### Construction
- **4 identical modular ring units** — same dimensions, same wiring, same mounting hardware
- Build once, replicate 4× — dramatically simpler than 4 custom pieces
- Pre-wired with weatherproof connectors
- Mount via bolted bracket at stack top

---

## Partially Submerged Stack Lighting (Safety Critical)

### Why This Matters More Than the Ship
The partially-submerged smokestacks are **harder to see** than the main ship hull:
- The main ship hull eventually fills your field of vision even in a whiteout
- The stacks are smaller, more isolated obstacles
- An e-biker in a dust storm could easily clip one

### Design Constraints
- **Do NOT light from the ground** — ground-level fixtures mean more cables to trench and more fixtures to accidentally bike over
- Use the **same ring fixture design** as the stack tops for modularity
- Mount at the top of the exposed stack section, lighting downward and outward

### Animation Opportunity
This is the **highest-impact, lowest-effort** place to add animation:
- 1D pixelblaze patterns around a ring are trivially simple to program
- Even basic effects (color chase, breathing, color temperature drift) are extremely appealing
- Much easier than mapping animations across the par light array
- Small pixel count = minimal data overhead, simple wiring

---

## Combined Visual Effect

The far-distance visual narrative when all rings are active:

> *As you approach from deep playa, you see floating halos — bright rings suspended in the dust. As you get closer, the guy line rope lights become visible as translucent veils or catenoid ribs descending from the halos. Finally, the softer par upwash on the ship hull resolves as you reach the structure.*

This layered reveal — halos → veils → hull — creates a compelling approach sequence.

---

## DMX Integration

| Component | Channels | Notes |
|-----------|----------|-------|
| Stack top ring (per ring) | 3ch × N pixels | RGB per pixel, N = pixel count around circumference |
| Submerged stack ring | 3ch × N pixels | Same as top rings for modularity |
| Simple mode (no animation) | 3-4ch per ring | Single RGB + dimmer, whole-ring color |

**Pixelblaze option:** Each ring runs an independent Pixelblaze controller. Patterns authored locally, no DMX needed. The Pixelblaze can also accept DMX input for Chromatik integration.
