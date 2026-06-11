# Controller mapping: registry model, packing, projection, persistence

- **ID:** 014
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** docs/33_controller_mapping.md (phase 1)
- **Location:** simulation/src/dmx/controller_registry.js (new), simulation/main.js, simulation/server/save-server.js
- **Created:** 2026-06-11
- **Updated:** 2026-06-11

## Description
Phase 1 of the Controller Mapping feature: the data layer. A new
`controller_registry.js` models controllers → ports (universe +
startAddress) → chains, packs addresses (full 1–512 budget), validates
(universe-1 effects pins per `config.yaml → global_effects`,
shared-universe range overlap, orphans, IP rules), and projects every
fixture's patch fields — including the deterministic invalid-state
projection to unpatched (`''/0/0`) so `patches.yaml` can never carry an
out-of-range or conflicting address. Projection also absorbs the
auto-patcher's `assignMetadata` (sectionId / fixtureId / controllerId)
and hooks fixture renames to update chain references atomically.

## Suggested fix
- `simulation/src/dmx/controller_registry.js` (new): create / validate /
  pack / project, per the "Derivation rules", "Projection under invalid
  state", and "Universe 1: effects" sections of docs/33.
- `simulation/main.js`: fetch + validate `controllers.yaml` (cache-busted)
  before first render; hard-stop boot on a present-but-broken file;
  missing file = legitimate "no mapping yet".
- `simulation/server/save-server.js`: extract `configTree.controllers`
  to `controllers.yaml` via the existing atomic-write path (mirror the
  views.yaml decouple at save-server.js:183).
- Unit tests for packing, validation, invalid-state projection, and
  save→load→save round-trip identity.

## Why it matters
Everything else (panel UI, 3D linkage, auto-patcher removal) builds on
this contract. The titanic scene ships with all 61 fixtures unpatched
and no safe way to patch them on playa.
