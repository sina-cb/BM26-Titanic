---
name: pattern_curation_and_playlist_blessing
status: active
owner: operator + curator
created: 2026-08-11
updated: 2026-08-15
---

# Pattern Curation and Playlist Blessing

## Goal

Turn the Titanic pattern catalog into a curated, visually distinct show library:
truthful controls, strong Titanic instrument authorship, portable behavior on
other models, durable playlist tuning, and an explicit human blessing before a
playlist is eligible for the playa schedule.

## Current state

- The Titanic `ambient` playlist is the canonical 34-pattern source of truth.
  Its locked static tune is mirrored byte-for-byte into test_bench and inherited
  by every non-diagnostic playlist reuse. `ambient_sound_reactive` is the party
  stash: the same order and defaults with 95 restrained audio mappings, mirrored
  byte-for-byte across both scenes.
- The permanent offline gallery and its generator exist. The display-only
  smoke-stack representation is complete in the simulator 2D views and
  gallery: all eight PARs per stack are prominent in Top, and the four
  front-facing PARs per stack render as compact sources with tapered light
  washing upward over the stack body in Front. The 34-entry gallery was
  regenerated and is ready for operator review.
- Every currently rendered gallery now uses a seekable MP4 player with visible
  Play/Pause, Restart, Repeat, and scrub controls, while retaining downloadable
  GIFs. Event patterns may additionally publish named chapter jump points.
- Baby is pattern-based rather than one time-coded reveal. The only playlists
  are `baby_tease` (20 autonomous pink+blue looks), `baby_boy` (30 hardcoded
  blue looks), and `baby_girl` (30 matching hardcoded pink looks). The operator
  performs the blackout and answer selection manually.
- Pattern tuning and automated offline gates are substantially complete, but
  **the playlist is not blessed yet**. A code/test pass is evidence, not the
  operator's artistic acceptance.
- Ambient tuning is evaluated without modulation. The separate
  `ambient_sound_reactive` playlist preserves the authored audio mappings for a
  later sound-reactive pass.
- The first six static thematic arcs are materialized in both scenes from the
  locked Ambient entries: `ambient_sea`, `ambient_shore`, `ambient_stars`,
  `ambient_burn`, `ambient_titanic`, and `ambient_tidal_architecture`. They add
  no modulation or alternate tuning and remain unblessed until physical review.
- `marsin_engine/tools/playlist_curation/sync_ambient_playlists.mjs` permanently
  enforces the hierarchy. It mirrors Ambient and its reactive party stash,
  rebuilds the six themes, and removes stale alternate defaults/modulation from
  every non-diagnostic Ambient reuse while preserving playlist entry IDs.
- Party tuning starts after the separate audio-analysis work lands; it does not
  block completing the ambient blessing campaign.
- `party_dancers` has been cut back to one prototype,
  `party_dancers/01_dom_ball_dancers`. It mirrors two dominant-frequency bands
  across the ship halves, uses their energies for width, and reserves LOW/KICK
  for the Organs. It remains an audition seed.
- `ambient_extra` is a 50-pattern DRAFT candidate family calibrated for the
  operator's Ambient review point: Global Speed 0.30 and Local Speed 0.30.
  Every source has a complete visibility floor, two valid audio suggestions,
  portable Titanic/test-bench behavior, paired TE treatment, W=A, and UV off.
  A quantitative 40-second motion contract protects both the whole model and
  the complete 74-pixel TE surfaces; none of the 50 is blessed yet.
- Titanic `default` has been cleaned from 72 entries to 27 live references.
  Eleven plausible ambient omissions are preserved in `ambient_default_bkup`
  for separate review instead of being silently folded into the locked pilot.

## Work completed in this campaign

- Reworked the Ambient pilot one pattern at a time with the operator. Saved
  playlist values were preserved as the durable tune while code-level control
  truth, live-edit behavior, direction semantics, white handling, contrast,
  and visual identity were repaired underneath them.
- Preserved `00_golden_hour_wash` as the iconic bread-and-butter look. Vintage
  fixtures remain its signature golden-white instrument, with independent
  Jewelry motion and a more active but still legible TE Identity treatment.
- Simplified several early patterns whose controls had become generic or
  misleading. Direction was removed where the concept was not truly
  directional; white controls were consolidated around a visible authored
  result; ambiguous radius/detail controls were repaired or replaced.
- Re-authored the middle and later Ambient set so the catalog does not collapse
  into one repeated mathematical field. The patterns now deliberately span
  water fronts, currents, caustics, lattice choreography, living organisms,
  analytic clouds, beacons, breathing volumes, rings, ribs, eclipses, and
  monumental vortices.
- Added explicit TE Identity treatments throughout the Ambient set. They retain
  each pattern's XYZ vocabulary and overall theme while keeping the signs
  readable, sufficiently lit, and visually alive.
- Added ten DRAFT large-scale patterns (`118`-`127`) designed to read across the
  playa. Each carries a 10-20% safety-floor control so the ship remains visible
  between major gestures.
- Kept the static Ambient blessing path free of audio modulation. The separate
  `ambient_sound_reactive` playlist preserves the audio-reactive work for its
  own later review. Audio-suggestion metadata and signal conditioning remain a
  separate audio-system workstream.
- Built a permanent playlist gallery and repeatable generator. Each gallery row
  shows Top, Front, and Identity motion at the exact saved playlist values. The
  player supports play/pause, restart, repeat, timeline scrubbing, and keeps a
  downloadable GIF beside the seekable MP4.
- Repaired `14_lunar_current` so Kick produces a broad whole-current crest
  response while retaining the operator's saved tune. Reworked
  `21_pelagic_manta_rays` Detail into attached manta anatomy (spines, leading
  edges, curved wing veins) plus fine pelagic filaments without changing its
  saved Ambient values.

### Ambient curator archival closeout

- The dedicated Ambient curation task is closed and archived after completing
  its bounded contract. It repaired the review queue for model-wide motion,
  TE-sign balance, W=A, portability, live-edit safety, and exact saved-tune
  behavior while freezing operator-approved patterns.
- `ambient_sound_reactive` is a strict 34/34 mirror of `ambient`: identical
  identity order, saved defaults, and stable matching entry IDs, with 95
  restrained mappings. Every entry has an ambient-safe primary intensity
  response (normally `micLow`) plus no more than two truthful detail,
  breadth, shimmer, or soft-pulse accents from `micHigh`, `micFlux`,
  `micMid`, or `micKick`. Silence resolves to the saved Ambient tune rather
  than darkness.
- The reactive matrix passed 204/204 offline cases across Titanic and
  `test_bench`, covering silence, full track, kicks, and hats. Full-track
  movement was deliberately restrained (0.29%-4.24%); W=A passed 60/60. Its
  permanent review gallery contains 34 resolved rows, 34 GIFs, and 34 MP4s.
- Titanic `default` was mechanically cleaned from 72 to 27 loadable entries
  by removing 45 manifest/source-proven stale references. All 27 survivors
  compile. `06_neon_elevator` remains an acknowledged dark look and
  `10_chasers` remains marginally over budget because both are loadable and
  aesthetic/performance judgment was outside the dead-reference cleanup.
- `ambient_default_bkup` preserves 11 viable non-Ambient review candidates in
  original order with complete entry data. All 11 pass Titanic and
  `test_bench`; its gallery contains 11 rows and 22 media files. The final
  stale-reference scan covered 25/25 Titanic playlists and 313 entries clean.
- Honest remaining operator gates: `126_cathedral_rib_wave` still needs an
  explicit visual blessing; `57_ink_diffuse` remains a replacement candidate;
  reactive gallery media show exact silent defaults while audio response is
  proven separately offline; final hardware/show-site judgment remains human.

## Party Dancers pilot

- Playlist: `simulation/scenes/titanic/playlists/party_dancers.yaml`.
- Pattern: `party_dancers/01_dom_ball_dancers`; one DRAFT prototype only.
- The two canonical DOM frequency/energy pairs paint two smooth high-contrast
  bands inside mirrored ship halves. Frequency owns local 1D position and
  energy owns band width; LOW and KICK support the Organ treatment.
- The canonical frequency sliders carry the modulation engine's normalized
  Hertz transport and the pattern spring-smooths positions instead of chasing
  raw detector jitter. All 964 Titanic pixels retain a visible background.
- Permanent review gallery:
  `docs/pattern_gallery/playlists/titanic/party_dancers/index.html`.
- Human state: **DRAFT / UNBLESSED**. Review with real music and Bench Mirror;
  tune this baseline before commissioning more dancers.

## Baby ceremony playlists

- `baby_tease` contains 20 independent patterns. Every representative frame
  carries both approved pink and blue families and never implies the outcome.
- `baby_boy` and `baby_girl` contain 30 patterns each. Their choreographies are
  paired concept-for-concept; only six hardcoded color constants differ.
- Baby sources live under `marsin_engine/patterns/baby/` as qualified IDs
  `baby/01_...` through `baby/80_...`. They do not use global palettes, audio,
  fixture/view branches, native white, amber, or UV.
- The three playlists are identical between Titanic and test bench. There is
  no `baby_reveal`, `baby_pink`, `baby_blue`, celebration, burst, or timed
  handoff playlist. `baby_reveal` remains only the special-event/show name.
- The operator runs Tease, performs a manual blackout, then selects Boy or
  Girl. This manual choice is the ceremony contract.
- Permanent galleries:
  `docs/pattern_gallery/playlists/titanic/baby_tease/index.html`,
  `baby_boy/index.html`, and `baby_girl/index.html`.

## Ambient Extra candidate family

- Playlist: `ambient_extra`, synchronized byte-for-byte between Titanic and
  test bench, 50 entries in numeric order, empty saved modulations/MIDI maps.
- Sources: `marsin_engine/patterns/ambient_extra/01_harbor_glass.js` through
  `50_last_lantern.js`. All remain explicitly DRAFT pending operator review.
- The family deliberately spans finite glass cells, compass geometry, pearls,
  lantern materials, gates, flags, keel light, signals, louvers, chart lines,
  folds, frames, mechanical structures, instruments, celestial bodies, living
  forms, paired Identity seals, instrument echoes, convergence, and the final
  Vintage lantern. Neighboring patterns do not reuse one generic field.
- Mechanical acceptance: all 50 compile on Titanic and test bench. The current
  cross-model parameter-truth sweep is recorded honestly as 242 TRUE,
  90 UNKNOWN_CLAIM, 12 WRONG, 5 WEAK, and 2 controls unreachable on Titanic but
  alive on test_bench. Every pattern retains a complete visibility floor, two
  parseable audio suggestions, W=A, UV off, and paired TE treatment. Permanent
  tests pin registration, playlist parity, exact Local Speed 0.30, portability,
  lanes, sign equality, and visible motion at Global 0.30 / Local 0.30.
- The distance-motion refinement introduces simple broad ship-scale gestures
  over close-range mathematical material: Brass Compass, Healing Cracks,
  Side by Side, and Last Lantern carry left-to-right passages; Leaf Turn carries
  a top-to-bottom canopy passage; Pearl Chain carries a broad rolling focus.
  Sparse patterns received identity-specific full-surface TE animation without
  changing palette or native-white lane ownership.
- Gallery: `docs/pattern_gallery/playlists/titanic/ambient_extra/index.html`,
  rendered from exact playlist values for 40 seconds per pattern at 8 fps with
  an explicit 0.30 global pattern clock recorded in the manifest/header.
- Human state: **DRAFT / UNBLESSED**. Gallery review comes first; survivors are
  then tuned and run through Bench Mirror one by one.

## Ambient pilot pattern ledger

Human state is intentionally stricter than automated state. **Tune locked**
means the operator accepted the saved controls during the tuning loop; it does
not waive the final physical mirror blessing after later code/Identity changes.

| # | Pattern | Authored identity / work completed | Human state |
| ---: | --- | --- | --- |
| 1 | `00_golden_hour_wash` | Iconic continuous sunset wash; Vintage-only golden white; separate Jewelry speed; dynamic sunset-horizon Identity | TUNE LOCKED; mirror recheck |
| 2 | `02_phase_cathedral` | Portable fixture topology; readable phase architecture; repaired Level/Kick/Radius behavior | TUNE LOCKED; mirror recheck |
| 3 | `07_shimmer` | Candle-water shimmer with visible Jewelry glints; removed control clutter and strengthened the authored white treatment | TUNE LOCKED; mirror recheck |
| 4 | `08_ocean_liner` | Dark ocean body with clear secondary color and warm porthole whites; fixed motion rate and contrast | TUNE LOCKED; mirror recheck |
| 5 | `11_bioluminescence` | Branching phosphor detail, obvious crest punch, honest white level/speed, controlled UV roles | TUNE LOCKED; mirror recheck |
| 6 | `12_breathing` | Full-model asymmetric breath over a detailed negative-space field; richer filigree and truthful creative controls | TUNE LOCKED; mirror recheck |
| 7 | `13_sparkle` | Elegant directionless celestial chandelier; sparse stable stars, afterglow, chorus, Jewelry gold, UV prism | OPERATOR-POSITIVE; blessing pending |
| 8 | `14_lunar_current` | Coherent curved moon river with banks and lace; palette-only color; live-edit-safe shimmer and detailed Identity current | OPERATOR-POSITIVE; blessing pending |
| 9 | `16_ghost_tide_uv` | Sparse moving foam front, mist, and UV undertow; distinct from the river and caustic looks | AUTOMATED READY; bench pending |
| 10 | `18_deep_space_lattice` | Crossed stellar lattice with truthful geometry/detail and fixed forward travel | AUTOMATED READY; bench pending |
| 11 | `19_swaying_lattice_ballet` | Two counterphase woven lattice families that bow and cross like a corps | AUTOMATED READY; bench pending |
| 12 | `20_parametric_sway_field` | Three-body attractor field with real XYZ orbits, lagged trails, and gravitational Identity contours | AUTOMATED READY; bench pending |
| 13 | `21_pelagic_manta_rays` | Two coherent manta silhouettes over dark pelagic negative space | RECHECK brightness and sign motion |
| 14 | `22_abyssal_sway_garden` | Rooted fronds and phosphorescent crowns; repaired inverse Base Darkness behavior | TUNE LOCKED; preserve current Ambient defaults; mirror blessing pending |
| 15 | `32_caustic_shimmer` | Refracted pool-glass cells, evolving walls, lenses, and focal nodes | TUNE LOCKED; preserve current Ambient defaults; mirror blessing pending |
| 16 | `33_aurora_breath` | Breath-modulated folded aurora volume with curling ribbons rather than translated waves | AUTOMATED READY; bench pending |
| 17 | `35_sparkle_rain` | Continuous descending droplets and thicker traces; visually distinct from fixed chandelier stars | RECHECK rain weight and distance readability |
| 18 | `41_reaction_diffusion` | Real Gray-Scott chemistry with morphing nuclei and crawling fronts | RECHECK whole-model brightness/activity |
| 19 | `43_golden_hour_pulse` | Musical Golden Hour sibling with warm double-heartbeat staging, not a copy of the continuous `00` wash | RECHECK elegance and identity |
| 20 | `44_biolume_swell` | Broad coherent underwater swell with bioluminescent crest and readable Identity response | OPERATOR-POSITIVE; verify brighter pass |
| 21 | `45_manta_drift` | Broad lit ocean stage and a variable drifting manta school, distinct from `21`'s two silhouettes | RECHECK contrast and announcement |
| 22 | `46_abyssal_fronds` | Crisp kelp/frond bodies with breathing crowns, phosphor glints, and a real base-glow floor | AUTOMATED READY; bench pending |
| 23 | `57_ink_diffuse` | Three analytic XYZ dye clouds with flow, bloom, diffusion, and palette-derived Jewelry droplets | RECHECK whole-model brightness |
| 24 | `58_lighthouse_solo` | Mirrored night field with a monumental rotating lighthouse wedge and explicit beam core | RECHECK both-side coverage |
| 25 | `118_grand_orbit_rings` | Three huge circular tube shells orbiting in independent oblique planes | DRAFT; operator likes new family; blessing pending |
| 26 | `119_bow_stern_tidal_push` | Large longitudinal wave exchange between bow and stern | DRAFT; operator likes new family; blessing pending |
| 27 | `120_crossing_beacons` | Two antipodal counter-rotating fan axes opening into a grand X | DRAFT; operator likes new family; blessing pending |
| 28 | `121_spiral_wake` | Two broad counter-curving helical crests wrapping the complete vessel | DRAFT; operator likes new family; blessing pending |
| 29 | `122_breathing_horizon` | One enormous horizontal light plane rising and falling across the skyline | DRAFT; operator likes new family; blessing pending |
| 30 | `123_mirrored_broadside_call` | Mirrored center-to-edge wall call and inward answer across both broadsides | DRAFT; operator likes new family; blessing pending |
| 31 | `124_aurora_crown` | Four monumental upper-ship crown arcs with slow curl and sweep | DRAFT; operator likes new family; blessing pending |
| 32 | `125_eclipse_orbit` | One large celestial occlusion and luminous rim traveling around the ship | DRAFT; operator likes new family; blessing pending |
| 33 | `126_cathedral_rib_wave` | Sequential monumental rib planes opening through a broad vaulted crown | DRAFT; operator likes new family; blessing pending |
| 34 | `127_grand_maelstrom` | One broad, filled, multi-arm polar ocean vortex with a calm eye | DRAFT; operator likes new family; blessing pending |

## Pattern quality contract

Every pattern accepted by this campaign should satisfy the following:

1. Controls are truthful, visually distinct, live-editable, and ordered for
   the physical MIDI surface. Local speed is available; direction exists only
   when reversal is integral to the concept.
2. White and amber lanes remain byte-identical whenever native white is used.
   Native white is intentionally authored by fixture role rather than sprayed
   indiscriminately across the ship.
3. The five Titanic instruments remain legible: Hull Canvas, Silhouette,
   Jewelry, Organs, and Identity. TE signs receive themed XYZ motion and never
   disappear into an accidental dark branch.
4. Shared patterns stay portable through stable fixture capabilities wherever
   practical. Titanic-only semantic views are reserved for effects whose value
   genuinely depends on the ship and must fail loudly elsewhere.
5. Neighboring patterns must differ in topology, movement grammar, density,
   and silhouette—not merely palette or speed.
6. Ambient code must be calm and useful without audio. Audio-reactive handles
   should be obvious when bound, but modulation is reviewed in a separate
   playlist so it cannot hide the underlying composition.
7. Pattern and playlist approval requires the exact saved tune. Code defaults,
   gallery values, and a different playlist's values are not substitutes.

## Blessing contract

A playlist becomes **BLESSED** only when all of the following are true:

1. Every referenced pattern resolves, compiles, passes the relevant offline
   gates, and has no stale saved parameter or modulation target.
2. Its gallery is regenerated from the exact saved playlist values and reviewed
   by the operator.
3. Every pattern is run through the physical test-bench mirror and manually
   checked by the operator for color, motion, fixture order, brightness floor,
   and model legibility.
4. The operator explicitly says the playlist is blessed. Until then it remains
   `DRAFT` or `IN REVIEW` and is not eligible for the week's show plan.

Blessing is per playlist tune, not per source file. The same pattern can be
blessed in one playlist and remain unreviewed in another because saved values
change the look.

## Playlist-family target

Build 15–20 ambient playlists with 15–20 patterns each. Seed from already tuned
patterns before commissioning new content; write a new pattern only when the
desired visual identity is genuinely missing.

Confirmed operator themes:

- `ambient_sea`
- `ambient_shore`
- `ambient_stars`
- `ambient_burn`
- Titanic- and Burning-Man-related collections
- love, peace, playful, dreamlike, and other creative ambient collections

Proposed roster (all 16-18 entries):

- Sea/shore: `ambient_sea`, `ambient_shore`, `ambient_abyssal_bloom`,
  `ambient_moonlit_passage`, `ambient_tidal_architecture`
- Playa/Titanic: `ambient_burn`, `titanic_identity`,
  `burning_man_dreaming`, `playa_horizon`, `sunset_to_starlight`
- Stars/emotion/play: `ambient_stars`, `gravity_of_love`,
  `peace_in_the_deep`, `cosmic_playground`, `lucid_dream_ship`,
  `living_tide_garden`, `cathedral_of_the_cosmos`

Each new playlist begins with `modulations: []` for deterministic blessing.
Audio-reactive variants follow only after the static look is accepted.

### Proposed playlist matrix

| Playlist | Entries | Journey / curation intent | Seed status |
| --- | ---: | --- | --- |
| `ambient_sea` | 18 | Full ocean voyage: departure, pelagic life, abyss, storm, beacon, return | Ambient tunes |
| `ambient_shore` | 16 | Portholes, foam, moonlit coast, beacons, warm landfall | Ambient tunes |
| `ambient_abyssal_bloom` | 16 | Deep-water organisms, kelp, chemistry, and phosphor life | Ambient tunes |
| `ambient_moonlit_passage` | 17 | Restrained night crossing from lunar current to lighthouse | Ambient tunes |
| `ambient_tidal_architecture` | 18 | Water expressed as monumental ribs, walls, rings, and currents | Ambient tunes |
| `ambient_burn` | 16 | Ember, horizon, crown, maelstrom, and ceremonial warmth | Ambient tunes |
| `titanic_identity` | 18 | The ship as icon: silhouette, portholes, Jewelry, organs, signs, beacons | Ambient tunes |
| `burning_man_dreaming` | 16 | Playa-scale surrealism with warmth, dust-like fields, and large gestures | Ambient tunes |
| `playa_horizon` | 16 | Distant horizontal motion and slow monumental structures | Ambient tunes |
| `sunset_to_starlight` | 16 | Golden Hour through dusk, eclipse, aurora, and stars | Ambient tunes |
| `ambient_stars` | 16 | Constellation, orbit, eclipse, aurora, lighthouse, and dawn | Ambient tunes |
| `gravity_of_love` | 17 | Approach, heartbeat, embrace, duet, shared orbit, and sunrise | Mostly Ambient; one code-default candidate |
| `peace_in_the_deep` | 17 | Restorative descent through living water and guided return | Ambient tunes |
| `cosmic_playground` | 16 | Curious stars, kinetic structures, crossings, and celestial toys | Mostly Ambient; one code-default candidate |
| `lucid_dream_ship` | 16 | Familiar ship forms dissolving into ribbons, creatures, and folded sky | Mostly Ambient; one code-default candidate |
| `living_tide_garden` | 17 | Chemistry-to-fronds-to-creatures ecosystem growth | Ambient plus three code-default candidates |
| `cathedral_of_the_cosmos` | 17 | Titanic as monumental navigation and celestial architecture | Ambient plus one code-default candidate |

The proposal dossiers under `~/tmp/ambient_playlist_proposals_*.md` contain the
ordered membership, per-entry rationale, exact saved-value source, transition
review focus, and true missing-pattern gaps. They remain design evidence only;
the durable YAML and gallery become the review artifacts once names and order
are accepted.

## Future pattern gaps worth commissioning

Create these only when a playlist review proves the existing catalog cannot
carry the requested chapter:

- A coherent V-shaped Kelvin bow wake anchored to the ship axis.
- A deep parallax starfield that occasionally resolves into large
  constellations.
- A two-body love duet that seeks, merges color, and separates smoothly.
- An almost-still deep sanctuary with minutes-scale tidal change.
- Friendly ambient creatures, bubbles, or comets without confetti semantics.
- A moving dream doorway that reveals a second field behind it.
- Root-to-branch-to-bloom growth topology for the organic family.
- A rare celestial alignment that converges, holds, and separates.
- Playa-specific dust, ember-bed, flame-column, boiler-glow, and static-dusk
  compositions where the current catalog does not yet provide a truthful look.

## Blessing ledger

| Playlist family | Content | Gallery | Bench mirror | Operator blessing | State |
| --- | --- | --- | --- | --- | --- |
| `ambient` | 34 entries; code/gallery ready | 34/34 regenerated; operator accepted pattern direction | IN PROGRESS | Required | IN REVIEW |
| `ambient_sound_reactive` | Same 34 identities; 95 restrained mappings | Regenerated | Required | Required | IN REVIEW |
| `ambient_default_bkup` | 11 former-default ambient candidates | Regenerated | Required if promoted | Required if promoted | DRAFT REVIEW |
| `ambient_extra` | 50 DRAFT candidates at Global/Local 0.30 | 50/50 at 40 s, 8 fps, 0.30 clock | Required per survivor | Required per survivor | DRAFT REVIEW |
| `party_dancers` | One DOM-frequency prototype | Regenerated | Required with music | Required | DRAFT REVIEW |
| Ambient subcategories | 6 materialized arcs, 16-18 entries each; all exact Ambient tunes | Not generated | Mirrored YAML ready; physical pass required | Required per playlist | DRAFT REVIEW |
| `baby_tease` | 20 outcome-blind pink+blue patterns | 20/20 regenerated | Required | Required | IN REVIEW |
| `baby_boy` | 30 blue-only patterns | 30/30 regenerated | Required | Required | IN REVIEW |
| `baby_girl` | 30 pink-only patterns | 30/30 regenerated | Required | Required | IN REVIEW |

### Per-pattern mirror review record

For the current Ambient pilot, record each physical pass as:

| Pattern | Color/material | Motion/speed | Mapping/order | Identity/sign | Brightness/safety | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `<pattern>` | PASS / note | PASS / note | PASS / note | PASS / note | PASS / note | KEEP / REPAIR / REJECT |

The final playlist blessing is granted only after all 34 rows have a verdict
and repaired entries have been replayed. A gallery-only acceptance is useful
art direction, but it is not the physical blessing.

## Working rules

- Re-read playlist YAML immediately before every edit so UI-saved operator
  values are never overwritten.
- Preserve tuned saved values unless the operator explicitly retunes them.
- Keep parameter names/order stable once blessed.
- Keep the gallery reproducible through
  `marsin_engine/tools/playlist_gallery/generate.mjs`.
- Pattern code remains portable through fixture capabilities where practical;
  Titanic-specific semantic treatment is allowed when it materially improves
  the icon and fails loudly when intentionally Titanic-only.
- No playlist enters the show plan merely because automated tests pass.
- Git operations remain operator/Claude-owned. The curator prepares a bounded,
  verified checkpoint handoff and does not commit shared-tree work.

## Decisions log

- **2026-08-11** — A physical test-bench mirror run plus explicit operator
  acceptance is required to bless every playlist.
- **2026-08-11** — Complete and checkpoint the current Ambient pilot before the
  15–20-playlist expansion, so the large curation wave starts from a stable
  boundary.
- **2026-08-11** — New ambient subcategories use existing tuned patterns first;
  new patterns fill real artistic gaps rather than satisfying a quota.
- **2026-08-11** — Ambient blessing runs without modulation; audio-reactive and
  party tuning are separate passes.
- **2026-08-15** — Baby ceremony content is autonomous-pattern based: Tease,
  manual blackout, then the operator selects Boy or Girl. Retire the timed
  reveal/celebration pattern and every extra Baby playlist alias.
- **2026-08-15** — `ambient_extra` is a 50-pattern DRAFT audition family. It
  remains unmodulated for blessing even though each source declares two audio
  suggestions for a later reactive pass.
- **2026-08-13** — Permanent gallery playback uses seekable MP4 as the review
  surface and retains GIF only as the downloadable/shareable loop format.
- **2026-08-15** — Ambient Extra and White review galleries use schema 3,
  exact source/playlist/goal fingerprints, and 40-second 8-fps MP4+GIF media.
  Ambient Extra review states are 30 READY FOR OPERATOR, 24 TUNE, and one
  REJECT (`45_moss_islands`); these are content-review states, not playlist
  blessing or show-scheduling approval.

## Next steps

- [x] Finish smoke-stack representation in simulator Top/Front and gallery.
- [x] Regenerate the 34-entry Ambient gallery and ask the operator to review it.
- [ ] Run every Ambient entry through the test-bench mirror; record the six
  review columns above and keep/repair/reject.
- [ ] Repair only the entries the physical pass rejects, regenerate their
  gallery rows, and replay those entries through the mirror.
- [ ] Receive the operator's explicit blessing for `ambient`.
- [ ] Prepare the verified Ambient checkpoint handoff and resolve the active
  adversarial `feat/bm_readiness` merge-readiness review.
- [x] Synthesize the three playlist-family proposals into a 17-playlist roster
  with 16-18 patterns per playlist.
- [ ] Approve playlist names/order, then create the first low-risk draft wave:
  `ambient_stars`, `peace_in_the_deep`, `ambient_sea`, and
  `titanic_identity`.
- [ ] Copy exact approved Ambient values into those drafts, with empty
  modulation and MIDI maps; code-default candidate rows remain visibly
  unblessed.
- [ ] Generate one gallery per draft, review transitions as well as standalone
  patterns, then run the same bench-mirror blessing loop.
- [ ] Repeat in small playlist waves until all approved ambient families are
  blessed; do not create all 17 YAML files ahead of human review.
- [ ] Hand blessed playlist names to the timeline/show-plan owner for deliberate
  placement across the week.
- [ ] Begin party tuning after the audio-analysis thread reports its accepted
  signal contracts.
- [x] Author, integrate, and mechanically verify the 50-pattern
  `ambient_extra` candidate family on Titanic and test bench.
- [x] Generate the 40-second schema-3 `ambient_extra` review gallery and
  permanent contract tests.
- [x] Review all 50 Ambient Extra rows and mark READY FOR OPERATOR / TUNE /
  REJECT before any physical pass.
- [x] Tune the current gallery survivors and regenerate exact-current rows.
- [ ] Run READY/TUNE survivors through Bench Mirror before blessing
  `ambient_extra`; `45_moss_islands` stays rejected unless materially
  reauthored and re-proven under the render budget.
- [x] Author and mechanically verify 20 Tease, 30 Boy, and 30 Girl Baby
  patterns with synchronized Titanic/test-bench playlists and galleries.
- [ ] Review the three Baby galleries for legibility, photo-safe cadence, and
  family purity; then rehearse Tease → manual blackout → chosen answer through
  Bench Mirror.
- [ ] Record explicit operator blessing for `baby_tease`, `baby_boy`, and
  `baby_girl` before scheduling the ceremony.

## Links

- **Master program:** `bm26_show_readiness.md`
- **Pattern authoring contract:** `../../docs/MARSIN_ENGINE_PATTERNS.md`
- **Gallery:** `../../docs/pattern_gallery/index.html`
- **Gallery generator:**
  `../../marsin_engine/tools/playlist_gallery/generate.mjs`
- **Gallery goals metadata:**
  `../../marsin_engine/tools/playlist_gallery/pattern_goals.json`
- **Ambient playlist:**
  `../../simulation/scenes/titanic/playlists/ambient.yaml`
- **Sound-reactive backup:**
  `../../simulation/scenes/titanic/playlists/ambient_sound_reactive.yaml`
- **Ambient Extra gallery:**
  `../../docs/pattern_gallery/playlists/titanic/ambient_extra/index.html`
- **White review gallery:**
  `../../docs/pattern_gallery/playlists/titanic/white_only/index.html`
- **Ambient Sound Reactive gallery:**
  `../../docs/pattern_gallery/playlists/titanic/ambient_sound_reactive/index.html`
- **Ambient Default Backup gallery:**
  `../../docs/pattern_gallery/playlists/titanic/ambient_default_bkup/index.html`
- **Party Dancers gallery:**
  `../../docs/pattern_gallery/playlists/titanic/party_dancers/index.html`
- **Baby Tease gallery:**
  `../../docs/pattern_gallery/playlists/titanic/baby_tease/index.html`
- **Baby Boy gallery:**
  `../../docs/pattern_gallery/playlists/titanic/baby_boy/index.html`
- **Baby Girl gallery:**
  `../../docs/pattern_gallery/playlists/titanic/baby_girl/index.html`
