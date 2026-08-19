# BM26 TITANIC: Design Intent

Top-level design decisions for the Titanic exterior lighting system at Burning Man 2026. Agent workflow and repo map live in `AGENTS.md`.

## Mission

Make the exterior **highly visible at night** (mission critical). Light the rooms. Strike in under two hours. Carry TE's DNA forward: welcoming, interactive, kind, fun.

This is a recovery year: do less on playa, keep hardware dumb and deployment volunteer-friendly.

## The Rig

No pan/tilt movers. Wash bars and pars stay fixed; motion comes from WASM math, not mechanics. Playa dust kills movers; sealed IP65 bars survive.

The ship is **964 mapped pixels** across five instruments (see `docs/COLOR_THEORY.md`):

- **Hull Canvas**: Shehds 18x18W bars (RGBWAU), volumetric baseline and Cylon-style scans
- **Silhouette**: rope/strand runs, ship outline
- **Jewelry**: Vintage wash heads, amber accents on architectural high points
- **Organs**: Uking pars, broad uplight (Stacks + Auditoriums)
- **Identity**: TE sign pixels

Modules store flat-packed in labeled bins. Setup card: plug in order, climb the ship side, drape over the ridge hooks.

Shehds bars use a hardware-verified **119-channel** footprint per fixture; universes bridge aggressively. Patterns target named views (`inView("Hull Canvas")`, etc.), not legacy section IDs. Geometry and the LEFT/RIGHT naming hazard are in `docs/TITANIC_MODEL.md`.

## Software Surfaces

**MarsinEngine** (`marsin_engine/`): Pixelblaze-compatible WASM VM, parametric JavaScript patterns, multi-universe sACN out, REST/WebSocket API. Chromatik/NDI is retired.

**Simulation** (`simulation/`): Three.js scene mirror, gallery review, bench blessing before playa.

**CaptainPad** (`CaptainPad/`): primary iPad UI. Deck, Mixer, Timeline, Live Touch spatial painting, performance effects, audio. Reads engine exports over WebSocket; builds sliders, presets, and master dimmer on demand.

**LookingGlass** (`LookingGlass/`): physical arcade-button panel at the podium.

**Control Podium** (`LookingGlass/control_podium/`, archived): LoRa mesh for field ops away from the LAN.

Chain: CaptainPad (or podium mesh) to MarsinEngine to sACN to fixtures. Sim listens on the same stream for parity. Show target: ambient by default, alive at party moments, never stuck.

## Look and Feel

No random RGB noise.

1. **Color locking**: UI color choice binds the script; bounded hue shifts only.
2. **Ambient slowness**: speed sliders map to 50 to 100 second breathing waves, not strobe chaos.
3. **Hardware W/A**: white and amber blowout hits physical W and A emitters, not RGB desaturation.
4. **Wood is not neutral**: yellow-stained smokestacks absorb blue; dark hull paint absorbs most hues.

Playlists need automated gates, gallery review, bench mirror, and operator blessing (see `.agent/projects/pattern_curation_and_playlist_blessing.md`).

**Iceberg work lights**: industrial mobile towers, movable during build, lowerable for storms. Shells must crack open for access. Diffusers turn construction lighting into art-mode ambient after hours.

**Smokestack rings**: stacks are the beacon; ring the tops if a lift is already on site. Partially submerged stacks need safety lighting more than the main hull. Do not light from ground level.

## Playa and Ops

- Offline only on playa: no CDNs, no runtime installs, vendored deps in `simulation/vendor/`.
- No silent fallbacks. Missing deps, bad config, or failed auth must crash loud (P0).
- Plug-and-go on playa: power, DMX, launch iPad. Complexity lives in the repo.
- Dumb hardware, sophisticated algorithms. Volunteer-deployable from a written card. IP65 minimum, no exposed connectors, no ground-level cable runs where avoidable.

Operator gates: agents do not commit, push, arm the rig, or start live services without explicit permission. Panel firmware flashes only through registry-locked `LookingGlass/panel_firmware/deploy.py`. Exterior deploy and physical iPad smoke are operator-run.
