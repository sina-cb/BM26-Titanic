# `_335` — Party playlist FAST/SLOW split — PROPOSAL (no changes made)

**Date:** 2026-08-20. **Branch:** `feat/bm_readiness`. **READ-ONLY wave** —
zero writes to playlists, states, patterns, or anything else. This report is
the only artifact. `marsin_engine/states/**` untouched.

Operator ask (must-have #1): separate the current party material into a
**FAST (high-energy)** playlist and a **SLOW (lower-energy)** playlist,
preserving every saved tuning verbatim.

---

## 1. What the current party material is

The party material lives in two scene playlists (the engine resolves
playlists from `simulation/scenes/<scene>/playlists/`, per
`marsin_engine/lib/state_paths.js`):

| File | Entries | Notes |
|---|---|---|
| `simulation/scenes/titanic/playlists/party_high.yaml` | 15 | Carries operator saved tunings (8 entries with `defaults`, 1 modulation on `50_phase_cathedral_hd`) |
| `simulation/scenes/titanic/playlists/party_low.yaml` | 18 | 2 entries with saved defaults (`06`, `26`) |
| `simulation/scenes/test_bench/playlists/party_high.yaml` | 15 | Same membership/order as titanic, **no** saved tunings |
| `simulation/scenes/test_bench/playlists/party_low.yaml` | 18 | **Byte-identical** to titanic's |

Total party material: **33 entries, 33 distinct patterns** (no duplicates,
no `_missing` entries — every referenced pattern file exists in
`marsin_engine/patterns/`). The original curation (report
`202607/20260725_12_party_detection_build.md` §9) split by
"beat-reactive/strobing" vs "groove/flow"; this proposal re-assesses each
entry as FAST vs SLOW using the operator's saved tunings and the pattern
source dynamics, per the ask.

`party_dancers.yaml` (titanic-only, 2 DOM-dancer prototypes with heavy
dom-frequency modulation stacks) is a separate specialty list, not part of
the high/low pair — **left untouched** by this proposal.

Timeline wiring that constrains naming: `lib/timeline/timeline_state.js:23`
`PARTY_PLAYLIST_DEFAULT = 'party_high'`; persisted
`states/titanic/timeline_state.yaml` → `partyPlaylist: party_high`; plan
looks `party_high` / `party_low` in
`simulation/scenes/{titanic,test_bench}/timeline/playa_default.yaml`
(autopilot 30 s / 45 s, both shuffle).

## 2. Method (evidence used per entry)

Objective signals, in priority order:

1. **Saved `sliderLocalSpeed`** (titanic defaults). Canonical law is
   `rate = pow(2, (s - 0.5) * k)` (k = 2..4 per pattern), 0.5 = 1×. This is
   the *static, operator-set* speed — the strongest tuning signal.
2. **Pattern source dynamics** — motion grammar (sweep/collapse/strobe vs
   drift/flow), base rates (`BASE_RATE`/`MAX_RATE` constants), and whether
   the pattern has a beat-locked *event* (kick-armed shockwave, strobe
   flash, discrete step) or only continuous modulation.
3. **`AUDIO_MODULATION_V1` headers** — what the audio drives. Note:
   `sliderLevel`/`sliderKick` etc. are **audio-target sliders**; their saved
   values are resting (silence) values, not energy tunings — they were NOT
   used to classify.
4. Gallery manifests (`docs/pattern_gallery/playlists/titanic/party_*/manifest.json`)
   for control descriptions; no per-pattern goals exist for these 33 in
   `pattern_goals.json` (only ambient/white families are covered there).

FAST = beat-locked events, strobing/flash, hard transients, high sweep
rates. SLOW = continuous flow/drift/groove, audio shaping brightness or
geometry rather than firing events.

## 3. Summary table (entry → FAST / SLOW / ASK)

"Now" = current playlist. ASK entries appear again in §5 with the
recommendation. Every entry carries its exact current saved values — see §6.

| Pattern | Now | Proposal | Why |
|---|---|---|---|
| `01_cylon_sweep` | high | **FAST** | Bold scanner beam sweeps the rig; kick pops the eye + vintage blinder pop (`AUDIO_MODULATION_V1` header) |
| `03_dual_axis_crush` | high | **FAST** | Beams collapse to center at ~0.55 cycles/s (`BASE_RATE`, saved speed 0.5 = 1×) with a convergence flash + kick pop |
| `04_beat_folded_helix` | high | **FAST** | Helix tunnel at 6 turns/s (`TRAVEL_RATE`); beat pulse pops pars, kick drives vintage blinders HARD (header) |
| `09_cyclone` | high | **ASK → FAST** | Confetti storm w/ kick bursts + blinder set; but operator slowed swirl to 0.05 (~0.29×) — see §5 |
| `25_heartbeat` | high | **ASK → SLOW** | Gentle lub-dub: `BEAT_RATE 0.85` ≈ 51 bpm base, continuous whole-rig gradient, dormant glow between beats — see §5 |
| `28_spectrum_bloom` | high | **FAST** | Literal 3-band spectrum analyzer painted on the rig; operator sped shimmer to 0.79 (~2.2×) |
| `29_kick_shockwave` | high | **FAST** | Kick-armed expanding shock ring is the whole show (env fires on kick crossing ~0.5); slow saved speed (0.09) only calms the idle breathing |
| `30_bass_comet` | high | **FAST** | Comet streak, 3.1 → 96.7 lane-cells/s under bass (`MIN_RATE`/`MAX_RATE`) |
| `31_strobe_lattice` | high | **FAST** | "EDM-banger" strobing node lattice; kick slams all nodes to full; operator sped drift to 0.85 (~2.6×) |
| `36_orbital_pulse` | high | **ASK → FAST** | Kick flares every gravity well (transient bloom), but the carrier is a smooth ≤0.5 orbit/s weave — see §5 |
| `48_heartbeat_drive` | high | **FAST** | Kick-armed LUB-DUB + bright shell expanding from center; dark/crisp between beats (the hard heartbeat) |
| `49_cylon_crush` | high | **FAST** | Scanner sweep × dual-axis collapse with collision flash; saved speed 0.54 ≈ 1× |
| `50_phase_cathedral_hd` | high | **ASK → SLOW** | Interference-lattice drift; operator halved it (0.14 → ~0.47×); only audio coupling is dom-energy → sharpness (no beat event) — see §5 |
| `51_confetti_cyclone` | high | **FAST** | Crisp orbiting sparks with trails over true black; saved speed 0.38 (~0.78×) keeps it sparky |
| `54_murmuration_storm` | high | **ASK → SLOW** | Flock/flow grammar (0.40 rad/s orbits); audio drives cohesion/scatter, no beat-locked event; sibling of `24` (SLOW) — see §5 |
| `05_orbital_attractor_field` | low | **SLOW** | Three orbiting attractors, crisp cores over near-black — continuous flow |
| `06_neon_elevator` | low | **SLOW** | Elevator car at ≤0.22 rides/s (`MAX_RATE`) with arrival "ding"; groove, not pounding; saved `sliderSteps 0.2` |
| `10_chasers` | low | **SLOW** | Comet chasers at ≤0.42 laps/s with life-cycles; kick only flares heads — streaming groove |
| `15_silk_prism_ribbons` | low | **SLOW** | Satin ribbons sliding, soft cross-shadow — flow |
| `17_rolling_color_dunes` | low | **SLOW** | Dunes drift/fold; kick surf-pop is an accent on a rolling field |
| `23_prismatic_strange_attractors` | low | **SLOW** | Strange gravity wells, prismatic filaments — drift |
| `24_chromatic_murmuration` | low | **SLOW** | Flocking colour storm, soft glows + ribbon filaments — flow |
| `26_dom_dancers_chevron` | low | **SLOW** | Two soft dancing orbs + spiral filigree, alive at zero audio; saved ball energies 0.333 |
| `27_swipe` | low | **SLOW** | One band sweeps at ≤0.6 sweeps/s; micLow *positions* the band (motion shaping, not events) |
| `34_moire_interference` | low | **SLOW** | Moiré beat bands "crawl and breathe" at an irrational drift |
| `37_chevron_chase` | low | **ASK → FAST** | Kick edge SNAPS the chevron field one step (beat-locked stepping), true-black gaps, authored "EDM / structural" — see §5 |
| `38_prism_helix` | low | **SLOW** | Helix arms at ≤0.5 spins/s; audio drives brightness + sparkle detail only |
| `39_tide_riser` | low | **ASK → FAST** | Authored "EDM BUILD": flux climbs the tide, kick flings crest spray — but between builds it is a slow tide — see §5 |
| `40_lissajous_weave` | low | **SLOW** | A woven never-repeating curve — continuous motion, no events |
| `42_phyllotaxis_spiral` | low | **SLOW** | Sunflower seed bloom, proximity glow field — organic drift |
| `47_quasicrystal_dunes` | low | **SLOW** | Quasi-periodic dune field rolls and reshapes forever — flow |
| `52_silk_ribbons` | low | **SLOW** | Meandering satin bands, dark between ribbons — flow |
| `53_neon_elevator_hd` | low | **SLOW** | Rest scroll 0.045 floors/s (`SCROLL_BASE`) with kick floor-steps as accents — a rising groove |

Net (if all recommendations are accepted): **FAST = 14**, **SLOW = 19**,
all 33 preserved, nothing added, nothing dropped.

## 4. The two proposed playlists

**Naming.** Primary recommendation: **keep the existing names** —
`party_high` = the FAST list, `party_low` = the SLOW list. They already mean
exactly this pair, and renaming ripples into
`lib/timeline/timeline_state.js` (`PARTY_PLAYLIST_DEFAULT`), the persisted
`states/*/timeline_state.yaml` `partyPlaylist` key, and both scenes'
`timeline/playa_default.yaml` looks. If the operator prefers literal names,
`party_fast` / `party_slow` fit the snake_case convention — the rename touch
list is in §7.4.

**Ordering rationale.** Both party looks run autopilot **shuffle** (30 s /
45 s), so order is cosmetic under autopilot — but manual next/prev on
CaptainPad walks the list order, so each list is arranged as an energy ramp:
FAST opens with iconic sweep material, climaxes at the strobe, and closes on
kick-event patterns; SLOW flows from silk textures through orbital/flock
material into the more kinetic grooves.

**Proposed `party_high` (FAST, 14)** — ASK entries marked `*`:

| # | Pattern | Ramp position |
|---|---|---|
| 1 | `01_cylon_sweep` | Iconic opener — one bold beam |
| 2 | `49_cylon_crush` | Scanner gains the collision flash |
| 3 | `03_dual_axis_crush` | Full collapse-to-center attack |
| 4 | `30_bass_comet` | Bass-driven streaks |
| 5 | `09_cyclone` * | Confetti storm builds |
| 6 | `51_confetti_cyclone` | HD sparks, higher contrast |
| 7 | `28_spectrum_bloom` | Spectrum takes the whole rig |
| 8 | `36_orbital_pulse` * | Kick flares on every well |
| 9 | `37_chevron_chase` * | Beat-locked chevron stepping |
| 10 | `39_tide_riser` * | Build/riser payoff |
| 11 | `48_heartbeat_drive` | Kick shells from center |
| 12 | `29_kick_shockwave` | Pure kick shock rings |
| 13 | `31_strobe_lattice` | Strobe peak |
| 14 | `04_beat_folded_helix` | Sustained tunnel closer with blinders |

**Proposed `party_low` (SLOW, 19)** — ASK entries marked `*`:

| # | Pattern | Ramp position |
|---|---|---|
| 1 | `15_silk_prism_ribbons` | Softest silk open |
| 2 | `52_silk_ribbons` | HD silk |
| 3 | `17_rolling_color_dunes` | Rolling dunes |
| 4 | `47_quasicrystal_dunes` | Dunes, quasi-periodic |
| 5 | `34_moire_interference` | Breathing moiré bands |
| 6 | `40_lissajous_weave` | Woven curve |
| 7 | `42_phyllotaxis_spiral` | Sunflower bloom |
| 8 | `05_orbital_attractor_field` | Orbits begin |
| 9 | `23_prismatic_strange_attractors` | Strange wells |
| 10 | `24_chromatic_murmuration` | Flocking storm |
| 11 | `54_murmuration_storm` * | HD flock, more presence |
| 12 | `50_phase_cathedral_hd` * | Architectural lattice |
| 13 | `25_heartbeat` * | Gentle whole-rig pulse |
| 14 | `26_dom_dancers_chevron` | Dancers + filigree |
| 15 | `27_swipe` | Single-band groove |
| 16 | `10_chasers` | Streaming comets |
| 17 | `38_prism_helix` | Helix swirl |
| 18 | `06_neon_elevator` | Elevator groove |
| 19 | `53_neon_elevator_hd` | Kick-stepped floors closer |

## 5. Operator ruling needed (7 entries)

Each could defensibly land either way; recommendation and the tension:

| Pattern | Now | Recommendation | The call |
|---|---|---|---|
| `09_cyclone` | high | **FAST** | Operator slowed the swirl hard (speed 0.05 ≈ 0.29×) but left kick 0.5 and the full white/blinder set at 0.5 — reads as scale-taming, not de-energizing. If the slowdown was meant to mellow it, it belongs in SLOW. |
| `25_heartbeat` | high | **SLOW** | ~51 bpm base double-pulse, continuous gradient, dormant glow — the *soft* heartbeat. `48_heartbeat_drive` already covers the hard kick-armed version in FAST. Keeping both in FAST doubles the motif. |
| `36_orbital_pulse` | high | **FAST** | Kick transient-blooms every well (its headline feature), but the carrier is a smooth ≤0.5 orbit/s weave amalgamated from two SLOW patterns (`05`, `23`). |
| `50_phase_cathedral_hd` | high | **SLOW** | Operator halved the drift (0.14 ≈ 0.47×) and its only audio coupling is dom-energy → node sharpness (the one saved modulation in the party material — carried verbatim wherever it lands). No kick, no strobe: architectural. |
| `54_murmuration_storm` | high | **SLOW** | Pure flock/flow grammar (0.40 rad/s orbits); audio drives cohesion/scatter/build, never a beat-locked event. Its non-HD sibling `24` sits in SLOW. Named "storm", though — the operator may want it as FAST texture relief. |
| `37_chevron_chase` | low | **FAST** | Authored as "EDM / structural"; kick rising-edge SNAPS the field a step — beat-locked stepping with true-black gaps. Only its free-run (silence) rate is gentle (0.103 turns/s), which is why it survived in SLOW. |
| `39_tide_riser` | low | **FAST** | Authored as "EDM BUILD": flux climbs the tide, kick flings crest spray — it pays off exactly when the music is high-energy. Visual tempo *between* builds is tidal, which is the SLOW argument. |

## 6. Tunings carried verbatim — the hard rule

Every entry moves (or stays) with its **exact current saved block from the
titanic files** — `defaults`, `modulations`, `midiMappings`, `label`,
`notes` — byte-for-byte values, no retuning, no normalization, no
"cleanup". Concretely that means preserving, verbatim:

- `party_high` titanic defaults on: `03` (6 sliders), `09` (9), `28` (5),
  `29` (5), `31` (5), `48` (3), `49` (4), `50` (5 + the
  `mod_sliderSharpBase_micDomEnergy1` modulation), `51` (5).
- `party_low` defaults on: `06` (`sliderSteps: 0.2`),
  `26` (`sliderBall1Energy`/`sliderBall2Energy: 0.333333`).
- Everything else keeps `defaults: {}` exactly as saved.

Entry **ids** are the only field that changes (they encode the owning
playlist: `e_party_high_<n>_<pattern>`). Ids are playlist-local; nothing
persists them across playlists (titanic `deck_state.yaml`'s
`activeEntryId` points into `default`, not the party lists).

## 7. Implementation notes for the follow-up wave (post-approval)

### 7.1 Files that change

- `simulation/scenes/titanic/playlists/party_high.yaml`
- `simulation/scenes/titanic/playlists/party_low.yaml`
- `simulation/scenes/test_bench/playlists/party_high.yaml`
- `simulation/scenes/test_bench/playlists/party_low.yaml`

Nothing else *needs* to change if the names stay `party_high`/`party_low`.
`marsin_engine/states/**` is not touched (engine-owned runtime state).

### 7.2 Scene-pair parity — current facts, and the choice

- The **byte-identity test** (`tests/patterns/specialty_white_uv.test.js:293`)
  covers only `white_only`/`uv_test`/`uv_only` — the party pair is **not**
  under a byte gate.
- Today: `party_low` **is** byte-identical across scenes; `party_high` is
  membership-identical but titanic carries tunings test_bench lacks (a bench
  capture-on-switch footprint risk documented in report
  `202607/20260725_143_playlist_parity_drift.md`).
- Recommendation: after the re-split, write **both scenes byte-identical**
  by adopting the titanic tuned entry bodies on test_bench too (bench gains
  titanic's saved defaults — harmless there, and it restores the pair
  convention). Alternative: keep membership/order parity only and accept
  the tuning asymmetry as-is. Operator's call; default to byte-identical.
- The ambient-derivation invariants
  (`tests/playlist/ambient_playlist_derivation.test.mjs`) are unaffected:
  none of the 33 party patterns appear in canonical `ambient`, and
  `sync_ambient_playlists.mjs` manages only the ambient family.

### 7.3 Gallery regeneration

From `marsin_engine/`:

```bash
node tools/playlist_gallery/generate.mjs --scene titanic --playlist party_high
node tools/playlist_gallery/generate.mjs --scene titanic --playlist party_low
node tools/playlist_gallery/generate.mjs --index-only
```

(plus `--variation sound` per `.agent/ops/pattern_catalog.md` if the sound
variation pages are wanted). Output lands in
`docs/pattern_gallery/playlists/titanic/{party_high,party_low}/`; the
manifests' `playlistDigest` will change, which is expected. Run the gallery
tool test (`tests/patterns/playlist_gallery_tool.test.mjs`) with the
touched-subsystem auto-checks before claiming merge-ready.

### 7.4 If the operator instead wants `party_fast` / `party_slow` names

Additional touches beyond §7.1: `lib/timeline/timeline_state.js:23`
(`PARTY_PLAYLIST_DEFAULT`), both scenes'
`simulation/scenes/*/timeline/playa_default.yaml` looks (`party_high`,
`party_low` look names + `playlist:` fields), the persisted
`states/titanic/timeline_state.yaml` `partyPlaylist: party_high` (engine
runtime state — flip via `PUT /party-config` on the live engine, not by
hand-editing), gallery directories regenerate under the new names, and the
timeline tests that use `party_high` as a fixture name keep working (they
build their own temp playlist dirs) but grep before claiming done.

### 7.5 CaptainPad

No changes. The playlist picker (`components/PlaylistPanel.tsx`) lists
whatever the engine's `GET /playlists` returns (in-memory library seeded
from the scene dir) — no hardcoded party names anywhere in CaptainPad. The
re-split (or a rename) shows up automatically after engine restart.

### 7.6 Runtime notes

- The engine caches the playlist library in memory
  (`playlist_manager.js`) — landing file edits requires an engine restart
  (which the post-wave launcher bounce covers per standing practice), or
  the operator saves through the API instead.
- If the deck is sitting on a party playlist entry when the new files land,
  the next entry switch resolves by id against the new file; regenerated
  ids mean the cursor resets — cosmetic, worth a heads-up to the operator.

## 8. Sanity constraints honored + flags

- **Nothing added**: both proposed lists draw only from the existing 33.
- **Nothing dropped**: all 33 are placed exactly once.
- **No broken entries found**: all 33 pattern files exist; no `_missing`
  candidates; the single saved modulation (`50_phase_cathedral_hd`)
  validates against the one-per-target rule.
- Flag (informational): test_bench `party_high` never received the titanic
  tunings — resolved by the §7.2 recommendation.
- Flag (informational): titanic `party_high`'s tuned `sliderLevel`/`sliderKick`
  saved values are audio-target resting values (silence baselines), not
  energy tunings — they were deliberately not used as split evidence.
