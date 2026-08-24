# `_337` — Party FAST/SLOW pair built from `ambient_sound_reactive` — PROPOSAL (no changes made)

**Date:** 2026-08-20. **Branch:** `feat/bm_readiness`. **READ-ONLY wave** —
zero writes to playlists, states, or patterns. This report + two scratchpad
ChatGPT appendices are the only artifacts.

**Supersedes report `_335` on source material.** Operator course correction:
the old `party_high`/`party_low` lists (33 patterns) are BAD OLD lists and
must NOT seed the new party pair. The new party FAST/SLOW pair is built
entirely from the operator's blessed, tuned
`simulation/scenes/titanic/playlists/ambient_sound_reactive.yaml`
(53 entries, operator-saved tunings). `_335`'s **mechanics** sections
(timeline wiring, gallery regen, engine restart) remain valid and are
referenced below; its split of the old 33 is retired to an audit work
package (appendix 2).

Hard rule honored: **tunings carry over VERBATIM** — every entry moves with
its exact saved `defaults`, `modulations`, `midiMappings`, `label`, and
`notes` from `ambient_sound_reactive.yaml`. This proposal changes *seating*
only. `ambient_sound_reactive` itself is untouched and stays in service.

---

## 1. Method

Objective signals, in priority order, cited per entry in §2:

1. **Saved `sliderLocalSpeed`** (the operator's static speed tuning).
   Canonical law `rate = pow(2, (s - 0.5) * k)`, 0.5 = 1×; k read from each
   pattern source (`* 4.0` typical; `22` uses k=6, `33` k=7, `44`/`45` k=3,
   `57` k=5.2, `121` k=3.6; `00`/`08` use shifted curves; several 118–127
   patterns use `base + span·pow(2,…)` rate formulas — effective multiples
   below are computed against each pattern's own formula). The
   `ambient_extra/*` (13 entries) and `crisp/*` (6 entries) families all sit
   at their seeded family default (0.30 / one 0.20) — never speed-tuned, so
   speed is **not** a discriminator there and pattern dynamics decide.
2. **Pattern source dynamics** (`marsin_engine/patterns/`) — motion grammar
   (breath/drift/flow vs travel/spin/event), rate constants, and whether
   audio fires a discrete *event* (kick-armed pulse/flash/step) or only
   shapes brightness/geometry.
3. **Saved modulation aggressiveness** (from the playlist YAML itself) —
   e.g. `crisp/10_geometric_echo` kick→echoPulse spans the FULL 0→1 range
   (a beat-fired shell), vs `19_swaying_lattice_ballet` kick range 0→0.06
   (near-nothing).
4. **Gallery goals** — per-pattern `goal` text in
   `docs/pattern_gallery/playlists/titanic/ambient_sound_reactive/manifest.json`
   (real curated goals exist for all 53).

FAST = the higher-energy half: sped-up tunings (>~1×), traveling/rotating
gestures, kick-fired events, dense sparkle. SLOW = breath/drift/contemplative
grammar at ≤~1×. **Honesty note:** this is an ambient-bred pool, so it skews
slow; a near-even 26/27 split necessarily seats several mid-energy entries
on the FAST side. Those are flagged in §4 exactly as the operator asked.

## 2. Verdict table (all 53)

Speed column = saved `sliderLocalSpeed` → effective multiple under that
pattern's own law. FAST 26 / SLOW 27.

| Pattern | Speed | Verdict | Evidence |
|---|---|---|---|
| `57_ink_diffuse` | 0.85 → ~3.5× | FAST | Operator cranked hardest in the list (k=5.2); three dye clouds churn |
| `21_pelagic_manta_rays` | 0.91 → ~3.1× | FAST | Second-hottest tuning; manta silhouettes cross at speed |
| `41_reaction_diffusion` | 0.85 → ~2.7× | FAST | Gray–Scott chemistry crawling at nearly triple rate |
| `127_grand_maelstrom` | 0.84 → ~2.6× | FAST | Whole-ocean rotation sped 2.6×; the storm centerpiece |
| `33_aurora_breath` | 0.66 → ~2.2× (k=7) | FAST | Curtains billow at double-plus; flux drives breath depth |
| `124_aurora_crown` | 0.74 → ~1.9× rate | FAST | Crown arcs curl at near-double; kick pulse mod |
| `35_sparkle_rain` | 0.65 → ~1.5× | FAST | Falling luminous weather; flux fires the kick channel |
| `08_ocean_liner` | 0.46 → ~1.5× (shifted curve, 1× at 0.31) | FAST | Operator ran the liner current hot; kick 0.12→0.28 |
| `13_sparkle` | 0.57 → ~1.2× | FAST | Constellation ignitions + kick→burst events, brilliance on highs |
| `43_golden_hour_pulse` | 0.46 → ~0.9× | FAST | Authored as the *musical double-heartbeat* sibling of 00; saved `sliderBlinder: 1.0` |
| `44_biolume_swell` | 0.33 → ~0.7× (k=3) | FAST | Kick modulation 0.01→**0.68** — the biggest kick throw in the list; crest slams on beats |
| `20_parametric_sway_field` | 0.47 → ~0.9× | FAST | Three *dancing* attractors with trails + node punctuation; kick 0.29→0.41 |
| `119_bow_stern_tidal_push` | 0.44 → ~0.85× | FAST | Traveling pressure wall + recoil — a directional gesture, kick pulse mod |
| `123_mirrored_broadside_call` | 0.36 → ~0.74× rate | FAST | Call-and-answer wave walls — rhythmic event grammar, kick pulse mod |
| `crisp/01_orbiting_circle` | 0.30 (family default) | FAST | Kick→count mod 0.5→**1.0** doubles the orbiting bodies on beats; hard black moats |
| `crisp/02_dimensional_slicer` | 0.30 (family default) | FAST | Kick→kickOffset 0→**0.72** jumps the razor slabs on beats |
| `crisp/03_magnetic_field_collision` | 0.20 → ~0.44× | FAST | Kick→collisionKick 0→**0.82**: beat-fired field collision + recoil (saved speed only calms the carrier) |
| `crisp/06_impossible_corridor` | 0.30 (family default) | FAST | Kick→roomScale 0.42→**0.88** blows the room open on beats |
| `crisp/10_geometric_echo` | 0.30 (family default) | FAST | Kick→echoPulse **0→1.0** — a full-range beat-fired shell echo |
| `07_shimmer` | 0.26 → ~0.5× | FAST * | Slow glint drift, but saved kick sits at 0.86→0.96 — the hottest kick engagement of the texture patterns |
| `118_grand_orbit_rings` | 0.47 → ~0.10 cyc/s | FAST * | Monumental orbiting ring shells + kick pulse; mid energy |
| `122_breathing_horizon` | 0.48 → ~0.95× | FAST * | Near-1× horizon rise/fall + kick pulse; breath grammar |
| `126_cathedral_rib_wave` | 0.33 → ~0.67× rate | FAST * | Sequential rib bows — a traveling wave through architecture |
| `121_spiral_wake` | 0.30 → ~0.6× (k=3.6) | FAST * | Helical wakes curl around the ship — directional motion |
| `16_ghost_tide_uv` | 0.30 → ~0.57× | FAST * | Traveling foam front + kick 0.31→0.43; motion is a front, not a drift |
| `14_lunar_current` | 0.39 → ~0.74× | FAST * | Flowing river with caustic lace; kick 0.26→0.39 and high-band shimmer |
| `12_breathing` | 0.30 → ~0.57× | SLOW | Whole-ship inhale/exhale — the definitional slow grammar |
| `22_abyssal_sway_garden` | 0.24 → ~0.34× (k=6) | SLOW | Rooted fronds sway; slowest effective tuning in the list |
| `46_abyssal_fronds` | 0.25 → ~0.5× | SLOW | Organisms breathe upward into phosphorescent tips |
| `11_bioluminescence` | 0.27 → ~0.56× | SLOW | Reef filaments, restrained crest flashes, UV undertow |
| `32_caustic_shimmer` | 0.30 → ~0.57× | SLOW | Calm refracted pool-light cells, explicitly "calm" by goal |
| `45_manta_drift` | 0.34 → ~0.72× (k=3) | SLOW | "Slow variable school" of soft manta fields — drift by name |
| `00_golden_hour_wash` | 0.38 → ~0.72× | SLOW | The iconic continuous sunset wash; kick flash mod is modest (0.24→0.4) |
| `02_phase_cathedral` | 0.17 → ~0.40× | SLOW | Interference arches at the second-slowest saved speed |
| `18_deep_space_lattice` | 0.30 → ~0.57× | SLOW | Rigid cosmic grid over near-black voids — near-static |
| `19_swaying_lattice_ballet` | 0.30 → ~0.57× | SLOW | Bowing lattice cohorts; kick mod range 0→0.06, near-zero |
| `ambient_extra/17_frost_branch` | 0.30 (family default) | SLOW | A crystal grows, holds, gently melts |
| `ambient_extra/01_harbor_glass` | 0.30 (family default) | SLOW | Stained-glass cells "slowly rearrange" |
| `ambient_extra/10_chart_lines` | 0.30 (family default) | SLOW | Nautical contours drift with survey marks |
| `ambient_extra/11_paper_fold` | 0.30 (family default) | SLOW | One sheet folds — facets + creases, contemplative |
| `ambient_extra/16_turning_tiles` | 0.30 (family default) | SLOW † | Tiles flip individually (discrete events, but stately) |
| `ambient_extra/35_turning_box` | 0.30 (family default) | SLOW | A wireframe box rotates — single slow gesture |
| `ambient_extra/12_floating_frames` | 0.30 (family default) | SLOW | Frames drift through depth "like suspended architecture" |
| `ambient_extra/22_balance_beam` | 0.30 (family default) | SLOW | Conserved-energy light transfer between bowls |
| `ambient_extra/03_pearl_chain` | 0.30 (family default) | SLOW | Pearl strings roll their focus along rails |
| `ambient_extra/02_brass_compass` | 0.30 (family default) | SLOW | One immense compass rose + slow meridian |
| `ambient_extra/07_keel_glow` | 0.30 (family default) | SLOW | Continuous low keel with sparse warm lift |
| `ambient_extra/09_shadow_slats` | 0.30 (family default) | SLOW † | Giant louvers pivot — bold, but stately by family design |
| `ambient_extra/05_open_gate` | 0.30 (family default) | SLOW | Doors part, hold a welcome, close — ceremonial |
| `crisp/08_topology_knot` | 0.30 (family default) | SLOW † | Ribbons tie/tighten/release; mods shape geometry, no kick event |
| `125_eclipse_orbit` | 0.18 → ~0.41× | SLOW | A dark body crosses slowly; rim keeps it legible |
| `58_lighthouse_solo` | 0.30 → ~0.115 turns/s (~9 s/rev) | SLOW | Lighthouse fan sweeps at a stately period |
| `120_crossing_beacons` | 0.14 → ~0.42× of default rate | SLOW | Operator slowed the crossed fans hard; long afterglow corridors |

`*` = borderline, seated FAST for balance (§4). `†` = borderline that
stayed SLOW (would be the first promotions if the operator wants FAST bigger).

## 3. The two proposed playlists (play order)

Ordering rationale: autopilot shuffles, but CaptainPad manual next/prev
walks list order — so each list is an **energy ramp**: FAST runs from
kick-hot textures through traveling gestures and beat-fired crisp geometry
to the sped-up monsters, closing on the maelstrom; SLOW runs breath →
organic reef → architecture → the contemplative extra family → celestial
closers.

### FAST (26) — proposed `party_high`

| # | Pattern | Ramp position |
|---|---|---|
| 1 | `07_shimmer` | Kick-hot glints — gentlest opener of the fast side |
| 2 | `14_lunar_current` | River with kick pops and shimmer lace |
| 3 | `16_ghost_tide_uv` | Foam front starts traveling |
| 4 | `118_grand_orbit_rings` | Monumental rings, kick pulse |
| 5 | `122_breathing_horizon` | Near-1× horizon heave |
| 6 | `126_cathedral_rib_wave` | Rib planes bow in sequence |
| 7 | `121_spiral_wake` | Helical wakes curl |
| 8 | `123_mirrored_broadside_call` | Call-and-answer wave walls |
| 9 | `119_bow_stern_tidal_push` | Pressure wall + recoil |
| 10 | `20_parametric_sway_field` | Dancing attractors, node hits |
| 11 | `08_ocean_liner` | Liner current at 1.5× |
| 12 | `13_sparkle` | Constellation ignitions, kick bursts |
| 13 | `35_sparkle_rain` | Falling sparks at 1.5× |
| 14 | `44_biolume_swell` | Kick-slammed crest (0→0.68 throw) |
| 15 | `43_golden_hour_pulse` | Double-heartbeat + full blinder |
| 16 | `crisp/01_orbiting_circle` | Kick doubles the orbiting bodies |
| 17 | `crisp/02_dimensional_slicer` | Kick-jumped razor slabs |
| 18 | `crisp/06_impossible_corridor` | Kick blows the room open |
| 19 | `crisp/03_magnetic_field_collision` | Beat-fired collision + recoil |
| 20 | `crisp/10_geometric_echo` | Full-range kick shell echo |
| 21 | `33_aurora_breath` | Curtains billow at 2.2× |
| 22 | `124_aurora_crown` | Crown arcs at near-double |
| 23 | `21_pelagic_manta_rays` | Mantas at 3.1× |
| 24 | `57_ink_diffuse` | Ink churn at 3.5× — speed peak |
| 25 | `41_reaction_diffusion` | Chemistry crawling at 2.7× |
| 26 | `127_grand_maelstrom` | Rotating maelstrom — climactic closer |

### SLOW (27) — proposed `party_low`

| # | Pattern | Ramp position |
|---|---|---|
| 1 | `12_breathing` | Whole-ship breath — softest open |
| 2 | `22_abyssal_sway_garden` | Slowest fronds (0.34×) |
| 3 | `46_abyssal_fronds` | Breathing crowns |
| 4 | `11_bioluminescence` | Reef filaments, UV undertow |
| 5 | `32_caustic_shimmer` | Calm pool light |
| 6 | `45_manta_drift` | Slow manta school |
| 7 | `00_golden_hour_wash` | The iconic sunset wash |
| 8 | `02_phase_cathedral` | Interference arches |
| 9 | `18_deep_space_lattice` | Cosmic grid, near-black voids |
| 10 | `19_swaying_lattice_ballet` | Lattice bows in counterphase |
| 11 | `ambient_extra/17_frost_branch` | Crystal grows and melts |
| 12 | `ambient_extra/01_harbor_glass` | Stained glass rearranges |
| 13 | `ambient_extra/10_chart_lines` | Nautical contours |
| 14 | `ambient_extra/11_paper_fold` | Folding luminous sheet |
| 15 | `ambient_extra/16_turning_tiles` | Tiles flip, material shifts |
| 16 | `ambient_extra/35_turning_box` | Wireframe box rotates |
| 17 | `ambient_extra/12_floating_frames` | Suspended frames drift |
| 18 | `ambient_extra/22_balance_beam` | Light transfers, energy conserved |
| 19 | `ambient_extra/03_pearl_chain` | Pearls roll their focus |
| 20 | `ambient_extra/02_brass_compass` | Compass rose + meridian |
| 21 | `ambient_extra/07_keel_glow` | Low luminous keel |
| 22 | `ambient_extra/09_shadow_slats` | Louvers pivot, carving black |
| 23 | `ambient_extra/05_open_gate` | Doors part and hold a welcome |
| 24 | `crisp/08_topology_knot` | Ribbons tie and release |
| 25 | `125_eclipse_orbit` | Dark body crossing |
| 26 | `58_lighthouse_solo` | Lighthouse fan sweeps |
| 27 | `120_crossing_beacons` | Crossed beacons, afterglow closer |

Counts: 26 + 27 = 53. Nothing added, nothing dropped, every entry placed
exactly once. Tunings verbatim; entry ids regenerate to the owning-playlist
convention (`e_party_high_<n>_<pattern>` / `e_party_low_<n>_<pattern>`) —
ids are playlist-local and nothing persists them across playlists.

## 4. Borderline, seated for balance

Seated **FAST** because that side needed the count (each could defensibly
live SLOW): `07_shimmer`, `14_lunar_current`, `16_ghost_tide_uv`,
`118_grand_orbit_rings`, `121_spiral_wake`, `122_breathing_horizon`,
`126_cathedral_rib_wave`.

Stayed **SLOW** but are the first promotions if the operator wants the fast
side hotter-count: `ambient_extra/09_shadow_slats`,
`ambient_extra/16_turning_tiles`, `crisp/08_topology_knot`.

The genuinely solid cores are FAST 1–19 of the ramp-independent evidence
(the ≥~1.2× tunings + the five kick-event crisp patterns + the four
gesture patterns) and SLOW's breath/extra families.

## 5. Naming recommendation

**Recommend: reuse `party_high` / `party_low` with the new content.** The
operator intends the pair to REPLACE the party playlists, and reusing the
names has **zero config ripple**. Verified reference set for those names:

- `marsin_engine/lib/timeline/timeline_state.js:23` — `PARTY_PLAYLIST_DEFAULT = 'party_high'`
- Persisted engine state: `marsin_engine/states/titanic/timeline_state.yaml:17`
  and `marsin_engine/states/test_bench/timeline_state.yaml:18` — `partyPlaylist: party_high`
- Timeline plans: `simulation/scenes/{titanic,test_bench}/timeline/playa_default.yaml`
  (party looks reference both names)
- `docs/77_bm26_night_arc_timeline.md` (narrative references)
- Timeline/special-events tests reference `party_high` as fixture names but
  build their own temp playlist dirs — unaffected either way.

If the operator prefers literal names (`party_fast` / `party_slow`), the
touch list is all of the above: the `PARTY_PLAYLIST_DEFAULT` constant, both
scenes' `playa_default.yaml` looks, both persisted `timeline_state.yaml`
`partyPlaylist` keys (engine runtime state — flip via `PUT /party-config`
on the live engine, not hand-edit), docs/77 wording, and gallery output
dirs regenerate under the new names. Grep-verify before claiming done.

## 6. Implementation mechanics (post-approval wave)

1. **Files that change** (name-reuse case):
   `simulation/scenes/titanic/playlists/party_high.yaml`,
   `.../titanic/playlists/party_low.yaml`, and the same two under
   `simulation/scenes/test_bench/playlists/`. Content = the §3 seatings
   with entry bodies copied byte-for-byte from
   `ambient_sound_reactive.yaml` (defaults, modulations, midiMappings,
   labels, notes). `ambient_sound_reactive.yaml` itself is NOT touched.
2. **Scene parity**: titanic and test_bench `ambient_sound_reactive.yaml`
   are already byte-identical (sha1 `005d86b3…` both), so building both
   scenes' party pair from the same bodies yields byte-identical pairs for
   free — restoring the pair convention that the old `party_high` had
   drifted on (report `202607/20260725_143`). No byte-gate test covers the
   party pair, but keep them identical anyway.
3. **Gallery regen** (from `marsin_engine/`):
   `node tools/playlist_gallery/generate.mjs --scene titanic --playlist party_high`,
   same for `party_low`, then `--index-only` (plus `--variation sound` per
   `.agent/ops/pattern_catalog.md` if wanted). `playlistDigest` changes are
   expected. Run `tests/patterns/playlist_gallery_tool.test.mjs` and the
   touched-subsystem auto-checks before claiming merge-ready.
4. **Engine restart required**: the engine caches the playlist library in
   memory (`playlist_manager.js`); landing file edits needs the standard
   post-wave launcher bounce (bench check first, per standing practice).
   If the deck sits on a party entry at restart, the cursor resets to new
   ids — cosmetic; give the operator a heads-up.
5. **Retired old party content**: recommend **retire/archive, do not
   delete** until the operator confirms. Concretely: before overwriting,
   copy the four current party YAMLs to
   `archived/playlists_party_pre_asr/` (tracked, no dates-in-future rule
   impact) so the old tunings stay one `ls` away; git history preserves
   them regardless. The 33 old patterns themselves stay in
   `marsin_engine/patterns/` untouched — their SALVAGE/PARK/RETIRE triage
   is the ChatGPT work package (appendix 2 of this wave, in the operator's
   scratchpad hand-off).
6. **CaptainPad**: no changes — the playlist picker lists whatever the
   engine serves; the new pair shows up after restart.

## 7. Appendices delivered (scratchpad, ChatGPT-ready, self-contained)

- `chatgpt_party_split_review.md` — the full proposed FAST/SLOW playlists
  with per-entry plain-English dossiers for no-repo review.
- `chatgpt_old_party_audit.md` — the 33 old party patterns as a
  SALVAGE / PARK / RETIRE triage work package, including the 7 ambiguity
  notes from `_335`.

Both contain no IPs/MACs/credentials and no repo paths.
