# 🧊 ICE ICE — Iceberg Lighting Stations

## Concept: "The End (Titanic's End)"

Surrounding the Titanic wreckage, scattered across the playa like frozen fragments of the North Atlantic, stand **procedurally-generated iceberg sculptures**. Each iceberg serves as both an art piece and a functional lighting station—illuminated from within by LED string art that traces the faceted geometry in spiraling patterns, while casting dramatic floods across the main ship structure.

The icebergs are the silent witnesses to the Titanic's demise. They glow with an eerie, cold beauty—ice-white LEDs tracing their angular faces like frozen veins, while a single flood light mounted atop each berg aims back at the wreckage, connecting the cause to its effect.

---

## Design Language

Each iceberg is **procedurally generated** from the Echoes Iceberg Generator, using:
- **Seed-based PRNG** — every iceberg is deterministic and reproducible
- **Delaunay triangulation** — organic, faceted geometry with configurable polygon density
- **Multi-peak height fields** — realistic craggy peaks with boundary falloff
- **LED string art** — spiral or parabolic LED patterns wired across every triangulated face, creating a haunting web of light that reveals the iceberg's internal geometry

### Generation Parameters (per iceberg)
| Parameter | Description | Default |
|-----------|-------------|---------|
| `seed` | PRNG seed for deterministic shape | Random |
| `radius` | Footprint radius of the iceberg | 4 |
| `height` | Maximum peak height | 6 |
| `detail` | Triangulation density | 10 |
| `peakCount` | Number of craggy peaks | 3 |
| `ledPattern` | `spiral` or `parabolic` | `spiral` |
| `ledDensity` | LED wiring density per face | 5 |
| `ledColor` | Ice-white LED color | `#aaeeff` |
| `floodColor` | Flood light aimed at Titanic | `#ffffff` |
| `floodIntensity` | Flood brightness | 5 |
| `floodAngle` | Flood cone angle | 40° |

---

## Placement Philosophy

Icebergs are positioned in a **ring of debris** around the sinking Titanic:
- **Close range** (15-25m from hull) — smaller fragments, higher LED density
- **Mid range** (25-40m) — medium bergs with dramatic floods aimed at the break point
- **Far range** (40-60m) — large sentinels catching the eye from across the playa. **The largest iceberg will also serve as a projection mapping surface** (see Stretch Goal below).

Each iceberg's position (`x`, `y`, `z`), rotation, and all generation parameters are fully configurable in `scene_config.yaml` under the **"The End (Titanic's End)"** section.

### Stretch Goal: Projection Mapping

The largest iceberg in the field doubles as a **projection surface**. Its faceted, angular geometry creates dramatic, fractured projections when hit by a high-lumen projector — think underwater footage, iceberg calving time-lapses, or abstract cold-blue animations that crawl across the craggy peaks. The flat-shaded triangulation naturally breaks the projected image into shards, reinforcing the shattered-ice aesthetic. This is a stretch goal contingent on projector availability and weather conditions on the playa.

---

## Technical Integration

### Scene Config Structure
```yaml
titanicEnd:
  _section:
    label: 🧊 The End (Titanic's End)
    type: icebergArray
  icebergs:
    - name: Berg Alpha
      seed: 42231
      x: -40
      y: 0
      z: 30
      radius: 4
      height: 6
      detail: 10
      peakCount: 3
      ledPattern: spiral
      ledDensity: 5
      ledColor: '#aaeeff'
      floodEnabled: true
      floodColor: '#ffffff'
      floodIntensity: 5
      floodAngle: 40
```

### Class Architecture
- `Iceberg.js` — fixture class following `ParLight.js` / `LedStrand.js` patterns
  - `constructor(config, index, scene, interactiveObjects)`
  - Generates mesh from seed using embedded PRNG + Delaunay
  - Creates LED line art from triangulated faces
  - Mounts optional flood SpotLight at peak
  - Interactive hitbox for translation/rotation
  - `syncFromConfig()`, `destroy()`, `setVisibility()`, `setSelected()`
