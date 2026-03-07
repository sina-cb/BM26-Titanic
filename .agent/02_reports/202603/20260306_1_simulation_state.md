# Simulation State Report — 2026-03-06
**Project:** BM26-Titanic Lighting Simulation  
**Status:** Active Development

---

## Current State Summary

The Three.js lighting simulation is functional and actively in use for lighting design iteration. The simulation renders the full Titanic FBX model with real-time PBR materials, a night-sky environment, and a fully dynamic lighting rig driven from `scene_config.yaml`.

### What Works

| System | Status | Notes |
|--------|--------|-------|
| Ship FBX Model | ✅ Running | Loaded from `2601_001_BURNING MAN HONORARIA_TE.fbx`, PBR wood material with smooth normals |
| Atmosphere (Moonlight/Bloom/Ambient) | ✅ Running | Full moon, hemisphere ambient, bloom post-processing |
| Par Lights (Uplight Array) | ✅ Running | ~100+ fixtures across 10 generator groups (both port & starboard sides) |
| Par Light Generators | ✅ Running | Line and Circle generators with bi-directional UI sync, camera fly-to |
| Icebergs (Titanic's End) | ✅ Running | 4 procedural icebergs with floodlights, LED string art, interactive hitboxes |
| Iceberg Geometry Loading | ✅ Running | Deferred checkbox-based loading with STL cache and progress overlay |
| Master Flood Controls | ✅ Running | Master enable/color/intensity/angle for all iceberg floodlights |
| Color Wave Animation | ✅ Running | Gradient-driven par light color cycling |
| Transform Controls | ✅ Running | Multi-select, W/E/R/S hotkeys, snap-to-surface mode |
| YAML Config Save/Load | ✅ Running | Auto-save debounced, manual save button, server at `:8181` |
| Undo/Redo | ✅ Running | Full snapshot-based undo with Ctrl+Z/Ctrl+Y |
| Camera Presets | ✅ Running | YAML-based preset cameras |

### What Needs Work

| System | Status | Notes |
|--------|--------|-------|
| **LED Strands** | 🟡 In Progress | **Only 2 strands placed.** LED strand system is built (`LedStrand.js`) with start/end point handles, but needs many more strands added to the ship to match the density of the real installation. This is a manual placement task. |
| Smokestack Ring Lighting | ⬜ Not Started | Per lighting advisor feedback, the smokestack tops and partially-submerged stacks are the highest-value lighting targets. Ring fixtures would be modular and identical. |
| Guy Line Lighting | ⬜ Not Started | Safety rope lights for tension cables going into playa |
| Master Flood Dimmer | ⬜ Not Started | Need a 0-100 dimmer for quick overall brightness control |
| Chromatik Export | ⬜ Not Started | Export 3D model + light positions as big pixels to Chromatik |
| NDI Pipeline | ⬜ Not Started | NDI in/out between Chromatik and simulation for pattern development |

---

## LED Strand Status

> [!IMPORTANT]
> **Only 2 LED strands are currently placed.** The LED strand infrastructure (`LedStrand.js`, GUI, transform handles) is fully operational, but the strands need to be manually routed along the ship geometry to represent the actual lighting installation. This is one of the highest-priority tasks for the next work session.

---

## Next Steps (Priority Order)

1. **Add Master Flood Dimmer (0-100)** to The End section for quick brightness control
2. **Optimize iceberg geometry loading** for faster experience
3. **Place additional LED strands** along ship hull and interior — currently at 2 of many
4. **Implement smokestack ring lighting** — modular, identical ring fixtures for stack tops and partially-submerged stacks
5. **Design par light module system** — 1m pre-rigged sections with self-alignment hanging hooks
6. **Chromatik integration** — export 3D model + light fixture positions for pattern authoring
7. **NDI bidirectional pipeline** — send patterns from sim → DMX and from Chromatik → sim
8. **Add partially-submerged smokestack safety lighting** — modular rings with optional 1D animation (Pixelblaze patterns)
