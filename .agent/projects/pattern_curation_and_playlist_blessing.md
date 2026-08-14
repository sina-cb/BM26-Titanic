---
name: pattern_curation_and_playlist_blessing
status: active
owner: operator + curator
created: 2026-08-11
updated: 2026-08-13
---

# Pattern Curation and Playlist Blessing

## Goal

Turn the Titanic pattern catalog into a curated, visually distinct show library:
truthful controls, strong Titanic instrument authorship, portable behavior on
other models, durable playlist tuning, and an explicit human blessing before a
playlist is eligible for the playa schedule.

## Current state

- The Titanic `ambient` playlist is the pilot collection. It currently has 34
  gallery entries, including ten new large-scale spatial drafts (`118`–`127`).
- The permanent offline gallery and its generator exist. The display-only
  smoke-stack representation is complete in the simulator 2D views and
  gallery: all eight PARs per stack are prominent in Top, and the four
  front-facing PARs per stack render as compact sources with tapered light
  washing upward over the stack body in Front. The 34-entry gallery was
  regenerated and is ready for operator review.
- Every currently rendered gallery now uses a seekable MP4 player with visible
  Play/Pause, Restart, Repeat, and scrub controls, while retaining downloadable
  GIFs. Event patterns may additionally publish named chapter jump points.
- The Baby Reveal event package is authored and mechanically verified: one
  outcome-blind six-act pattern, explicit pink and blue entries, matching
  photo-hold playlists/palettes, manual timeline cues, and long-form galleries.
  It is **not event-blessed** until the operator rehearses both complete paths.
- Pattern tuning and automated offline gates are substantially complete, but
  **the playlist is not blessed yet**. A code/test pass is evidence, not the
  operator's artistic acceptance.
- Ambient tuning is evaluated without modulation. The separate
  `ambient_sound_reactive` playlist preserves the authored audio mappings for a
  later sound-reactive pass.
- Three read-only curator passes produced a 17-playlist family matrix under
  `~/tmp/`: sea/shore, playa/Titanic/burn, and stars/emotional/playful. No YAML
  will be created until the Ambient pilot is blessed and checkpointed.
- Party tuning starts after the separate audio-analysis work lands; it does not
  block completing the ambient blessing campaign.

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

## Baby Reveal event package

- `131_baby_reveal` is a palette-independent 100-second event composition. Its
  authored chapters are: Pink Prophecy (0 s), Blue Answer (14 s), Spatial
  Duality (28 s), Cellular Chase (46 s), Helix Duel (64 s), Speed-up (78 s),
  Flash Barrage (88 s), exact blackout (90-92 s), and Reveal Explosion (92 s).
- Every active RGB pixel is discretely inside the approved baby-pink or
  baby-blue family. Mixed chapters put the two families on different pixels;
  they never interpolate through purple, green, or orange. UV is always zero.
  Native white is restricted to Vintage Jewelry and remains W == A.
- `sliderFinalColor` is intentionally outcome-blind before 92 seconds. The
  dedicated long test proves that pink and blue runs are byte-identical before
  reveal, then diverge only into the selected answer after blackout.
- Titanic and test_bench each have explicit pink and blue entries in
  `baby_reveal`. Titanic also has `baby_pink` and `baby_blue` photo-hold
  playlists with ten far-field looks and empty modulation.
- Two manual Titanic cues start the exact selected entry at time zero with BPM
  speed sync disabled. At 992 seconds they hand off to the matching single-
  family photo playlist: 90-second tease + 2-second blackout + 900-second hold.
- The permanent Baby Reveal gallery records both complete outcomes at 100
  seconds and 2 fps. Nine chapter buttons make the full show directly seekable;
  the pink and blue follow-on galleries are also generated with the same player.

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
| 14 | `22_abyssal_sway_garden` | Rooted fronds and phosphorescent crowns; repaired inverse Base Darkness behavior | AUTOMATED READY; bench pending |
| 15 | `32_caustic_shimmer` | Refracted pool-glass cells, evolving walls, lenses, and focal nodes | AUTOMATED READY; bench pending |
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
| `ambient_sound_reactive` | Modulation backup | Later audio pass | Required later | Required later | PARKED |
| New ambient subcategories | 17 proposals, 16-18 entries each | Not generated | Required per playlist | Required per playlist | DRAFT DESIGN |
| `baby_reveal` pink path | 6-act event + 15-minute hold path | 100 s seekable clip ready | Full-sequence rehearsal required | Required | IN REVIEW |
| `baby_reveal` blue path | 6-act event + 15-minute hold path | 100 s seekable clip ready | Full-sequence rehearsal required | Required | IN REVIEW |
| `baby_pink` / `baby_blue` | 10 photo-hold looks each | Both galleries ready | Required after reveal rehearsal | Required | IN REVIEW |

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
- **2026-08-13** — Baby Reveal is one outcome-blind authored pattern with two
  explicit final entries. Its gallery must show the entire sequence and permit
  chapter jumps and arbitrary scrubbing; a short looping excerpt is not valid
  event-review evidence.
- **2026-08-13** — Permanent gallery playback uses seekable MP4 as the review
  surface and retains GIF only as the downloadable/shareable loop format.

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
- [x] Author and mechanically verify both Baby Reveal paths, their matched
  photo-hold playlists, and the 100-second chaptered gallery.
- [ ] Review both complete Baby Reveal outcomes in the gallery, including every
  named chapter, blackout timing, explosion, and family purity.
- [ ] Rehearse pink and blue paths through the physical test-bench mirror from
  cue time zero through reveal; then separately rehearse the 992-second handoff.
- [ ] Record explicit operator blessing for each outcome path and both photo-
  hold playlists before scheduling the event.

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
- **Baby Reveal gallery:**
  `../../docs/pattern_gallery/playlists/titanic/baby_reveal/index.html`
- **Baby pink gallery:**
  `../../docs/pattern_gallery/playlists/titanic/baby_pink/index.html`
- **Baby blue gallery:**
  `../../docs/pattern_gallery/playlists/titanic/baby_blue/index.html`
