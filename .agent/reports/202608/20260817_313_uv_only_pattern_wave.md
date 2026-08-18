# 20260817_313 — UV ONLY pattern wave (19 new + the legacy spike = 20)

Operator order (twin of the white-only wave `_312`): "kick off UV only
playlist too. I want total of 20 UV only patterns, so 19 new."

## 1. Existing-UV count finding — operator's arithmetic CONFIRMED

Exactly **one** UV-only pattern existed before this wave: `65_uv_only` (the
experimental spike, alone in the `uv_test` playlist). `16_ghost_tide_uv` uses
the U lane but is a full-colour palette pattern, not UV-only — it does not
count. So **1 existing + 19 new = 20 total**, exactly as the operator
believed. No discrepancy.

## 2. UV hardware census (numerically verified against the models)

The `u` lane of `rgbwau()` reaches a physical emitter on exactly two fixture
families — and it is a deep-VIOLET LED, not a 365-395 nm blacklight die (see
`65_uv_only.js` header):

| Fixture | Role | u channel | titanic px | test_bench px |
|---|---|---|---:|---:|
| ShehdsBar (RGBWA-V) | Hull Canvas, `FIX_BAR_18` — 4 walls x 5 bars x 18 px | YES (6th subchannel) | 360 | 36 |
| UkingPar (RGBWAU) | Organs, `FIX_PAR` — 40 single-pixel pars | YES (DMX ch 7 "Purple") | 40 | 4 |
| VintageLed (RGBW) | Jewelry | no | 0 of 96 | 0 of 12 |
| TeSignV3 (RGBW) | Identity | no | 0 of 148 | 0 of 74 |
| raw LED strands (RGB) | Silhouette | no | 0 of 320 | 0 of 40 |

**400 of 964 titanic pixels (41.5%) emit UV — and they are the entire hull
canvas plus every organ par**, i.e. the four biggest visible wall surfaces.
The rig's silhouette ropes, jewelry rails and TE signs stay physically dark
under UV; the wave was therefore authored as complete compositions on the
walls + pars, and each source masks U to `FIX_BAR_18`/`FIX_PAR` at emit time
so the sim preview, the gallery and the playa all show the same truth (the
legacy spike instead writes U everywhere and relies on sacn_mapper dropping
it — grandfathered, noted in its header).

**Night-legibility note:** the violet die reads far dimmer than white at
distance. Art direction compensated with high base activity (0.14-0.25 keep
everywhere, mids 0.35-0.60, crisp peaks 0.85-1.0) and the family gate rejects
parked darkness (`neverLit == 0` on every capable pixel). Distance judgment
still deserves one real-rig look; candidates where 50 ft legibility is most
worth eyeballing are listed in §6.

## 3. Source -> derivation map (one-sentence identity each)

All 19 derive from the existing ambient set — recognizable skeleton kept,
re-authored as violet-intensity art:

| # | uv_only pattern | derived from | identity (50 ft) |
|---|---|---|---|
| 01 | blacklight_tide | 119_bow_stern_tidal_push | A violet tidal wall surges down the ship and snaps back, its crest a thin blazing blacklight line. |
| 02 | crossing_uv_beacons | 120_crossing_beacons | Two counter-rotating violet beams cross the four walls, leaving afterglow trails; pars flash as a beam passes. |
| 03 | violet_maelstrom | 127_grand_maelstrom | Spiral violet arms wind around the ship and pull inward like a slow whirlpool. |
| 04 | cathedral_uv_ribs | 126_cathedral_rib_wave | Bowed violet ribs march along the hull like a cathedral nave in blacklight. |
| 05 | breathing_violet_horizon | 122_breathing_horizon | A breathing violet horizon band rises and settles across the ship, exhaling afterglow. |
| 06 | uv_orbit_rings | 118_grand_orbit_rings | Tilted orbital rings of violet sweep through the hull in slow procession. |
| 07 | violet_eclipse | 125_eclipse_orbit | A dark eclipse disc orbits across a bright violet field, its rim blazing. |
| 08 | uv_broadside_call | 123_mirrored_broadside_call | Opposing hull walls call and answer in alternating violet swells with an expanding wavefront. |
| 09 | uv_lighthouse | 58_lighthouse_solo | A single violet lighthouse beam sweeps the ship, punctuated by a slow double-flash. |
| 10 | violet_caustics | 32_caustic_shimmer | Rippling pool caustics play across the hull as crisp violet filaments over a deep glow. |
| 11 | uv_aurora_breath | 33_aurora_breath | Violet aurora curtains drift high on the walls, breathing brighter and dimmer in slow waves. |
| 12 | uv_rain | 35_sparkle_rain | Violet droplets streak down the hull walls and burst softly at the waterline. |
| 13 | violet_reaction | 41_reaction_diffusion | Living reaction-diffusion cells bloom and merge across the hull, rimmed in bright violet. |
| 14 | uv_lattice_drift | 18_deep_space_lattice | A softly glowing violet lattice drifts through the ship in three dimensions. |
| 15 | violet_breathing | 12_breathing | The whole ship inhales and exhales violet from its center, ribbed like bellows. |
| 16 | uv_starfield | 13_sparkle | Violet stars twinkle in slow chorus over a dusky ever-lit field. |
| 17 | violet_mantas | 21_pelagic_manta_rays | Violet manta wings glide the length of the ship, flapping in slow motion. |
| 18 | uv_ink_plumes | 57_ink_diffuse | Plumes of violet ink billow up through the hull and slowly diffuse away. |
| 19 | violet_frond_garden | 46_abyssal_fronds | A garden of violet fronds sways along the hull, tips glowing brightest. |

Plus entry 0: `65_uv_only` — the legacy spike (rising undertow x slow bloom),
now anchoring the program.

## 4. Family architecture

- **UV AUTHORITY block** — byte-identical across all 19 sources (hash-gated):
  a single `emitUv()` that clamps, masks U to `FIX_BAR_18`/`FIX_PAR`, and
  writes `rgbwau(0,0,0,0,0,u)`. R=G=B=W=A=0 is machine-asserted on every
  pixel of every sampled frame, both models. No `colorPalette` exports —
  untintable, same convention as WHITE ONLY.
- **MFT conventions**: `localSpeed` first, `direction` second (guarded sign,
  never 0), `level` last; 5-7 sliders per pattern (bank budget 12).
- **Speed law**: local `speedScale = 0.35 + 1.65*localSpeed`; authored to
  reference global 0.25 (engine factor `0.25*16^g` = 0.5) x local 0.30 =
  rate factor 0.4225; primary cycles 15-40 s at reference. Runaway analysis
  in every header to unclamped g=4.0 (dt saturates the family 0.1 s clamp;
  fastest clocks stay orders of magnitude under alias/wrap limits) and a
  machine runaway gate renders 400 frames at 409.6 s/frame.
- **Task #69 discipline**: named-variable accumulation for 3+ term sums;
  the contract test regex-rejects any leading-`+` continuation line.
- **dt < 0.1 s sampling** everywhere (reference frame advances 12.5 ms).
- **AUDIO_MODULATION_V1**: every pattern declares `sliderLevel <- micLow
  range 0.35..1.00` as PRIMARY (+ at most one accent mapping); the silence
  gate renders at the range floor and asserts lit + alive.

## 5. Deliverables landed

- `marsin_engine/patterns/uv_only/01..19_*.js` — 19 sources.
- `simulation/scenes/{titanic,test_bench}/playlists/uv_only.yaml` —
  byte-identical, 20 entries in numbered order, every slider saved in
  declaration order, no modulations/MIDI.
- `65_uv_only.js` header updated (spike promoted into `uv_only`, still
  banned from every other program); `specialty_white_uv.test.js` updated
  the same way (uv_only joined SPECIALTY_PLAYLISTS; spike allowed in
  uv_test + uv_only only).
- `simulation/server/pattern_manifest.cjs`: `uv_only` registered in
  `MANIFEST_PATTERN_DIRS` (alongside the white wave's `white_only`).
- `marsin_engine/patterns/manifest.json` + `tools/playlist_gallery/
  pattern_goals.json`: lock-protected family-scoped insertions (see §7).
- `marsin_engine/tests/patterns/uv_only_contract.test.js` — the family gate
  (adapted from the white/crisp harness ideas: purity, hardware truth,
  texture spread, sparse-dark, animation, silence floor, runaway,
  distinctness across all 20, playlist/manifest integrity).
- Gallery: docs/pattern_gallery/playlists/titanic/uv_only/ (see §8).

## 6. Gate numbers

TBD_GATES

## 7. Manifest/goals regen lock protocol

TBD_LOCK

## 8. Gallery + visual inspection

TBD_GALLERY

## 9. Restart note

**The pending launcher/engine bounce now carries this wave too** (with
`_311`/`_312`): the live engine must rescan patterns/ and playlists to see
`uv_only`. No CaptainPad rebuild needed — the family is pure engine + YAML
data. The sim save-server regenerates `patterns/manifest.json` at boot; with
`uv_only` registered in `pattern_manifest.cjs` the regenerated file must be
byte-identical to the tracked one.

## 10. Coordination notes (parallel waves)

- `_312` (white) and `_313` (this wave) both edited
  `pattern_manifest.cjs` (each adding its own directory) and share the
  manifest/goals regen lock. This wave's manifest/goals writes were
  family-scoped inserts audited to touch zero `white_only`, `baby_*`,
  `crisp` lines.
- Untouched, per orders: `patterns/baby_reveal/**`, `patterns/baby_tease/**`,
  `patterns/crisp/**`, `patterns/white_only/**` + white playlist, Live Touch,
  CaptainPad, launcher, engine internals. No ports bound; offline WasmHost
  harness only; no git operations.
