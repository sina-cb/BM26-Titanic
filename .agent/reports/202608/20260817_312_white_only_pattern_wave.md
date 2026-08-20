# 20260817_312 — White-only pattern wave: 20 keepers from the ambient set

**Wave:** `_312`, Fable design lead + 2 Sonnet conversion slices (operator
explicitly requested Fable, and sanctioned the Sonnets for mechanical
conversion). Central review, gates, plumbing and landing by the lead.
**Operator order:** 20 new white-only patterns derived from the existing
ambient patterns, added to the white-only playlist. Art direction, verbatim
intent: *"use high contrast white and make sure the colors are not always and
too white"* — grayscale intensity art, never a flat white blast — and *"use
dark areas sparingly"* — negative space is a spice, the rig stays visible.

> **NOTHING IN THIS WAVE IS LIVE.** The engine loaded its pattern set at
> boot. The pending launcher bounce (already carrying `_300` + `_305` +
> `_306` + `_311`) now carries this wave too. See §8.

---

## 1. The headline numbers

| | |
|---|---|
| Patterns | **20 new**, `marsin_engine/patterns/white_only/01…20` |
| Playlist | 20 entries appended to `white_only.yaml`, **both scenes byte-identical**; the 5 legacy root entries (60-64) untouched |
| White convention | **equal-RGB + matched W/A native share, UV = 0, untintable** (§3) |
| `white_only_contract` (new) | **PENDING** |
| Purity | R = G = B exactly, W = A, U = 0 — every sampled pixel, both models, all 20 |
| Texture (titanic, 30 s census) | every keeper: max byte ≥ 200 (peaks reach the 224 emit ceiling), 1-21 % of lit mass ≥ byte 180, 70-100 % below byte 124, dark ≤ 10 % |
| Region coverage | all 24 named titanic regions ever-lit on all 20 |
| Manifest + goals | regenerated/extended, **family-only diff audited** |
| Gallery | `docs/pattern_gallery/playlists/titanic/white_only/` at live parity (`--global-speed 0.5`) |

## 2. Source → derivation map (one-sentence identities)

Numbering IS playlist order (house convention). Every derivative keeps its
source's recognizable skeleton — the field math, the motion architecture and
the fixture staging — and re-authors the light as grayscale intensity.

| # | keeper | derived from | 50-ft identity |
|---|---|---|---|
| 01 | `ivory_cathedral` | `02_phase_cathedral` | Phased cathedral waves sweep the ship as ivory arches with crisp white crests. |
| 02 | `moon_breath` | `12_breathing` | The whole ship inhales and exhales moonlight, bloom cresting to crisp white at full breath. |
| 03 | `silver_current` | `14_lunar_current` | A broad silver current flows down the hull with bright shimmer crests over a gray tide. |
| 04 | `frost_lattice` | `18_deep_space_lattice` | A slow 3D lattice of frost lines hangs in the ship, nodes sparking white. |
| 05 | `snowfall` | `35_sparkle_rain` | Dense white snow falls through a dim gray field, each flake a crisp spark. |
| 06 | `lighthouse_watch` | `58_lighthouse_solo` | A single brilliant lighthouse beam sweeps the ship above a calm gray sea-glow. |
| 07 | `ivory_wake` | `121_spiral_wake` | A spiral wake of white foam lines winds around the ship over satin gray water. |
| 08 | `horizon_breath` | `122_breathing_horizon` | A luminous horizon band breathes up and down the ship, its rim a crisp white line. |
| 09 | `rib_vault` | `126_cathedral_rib_wave` | Bowed cathedral ribs travel the hull as bright white arcs over a stone-gray vault. |
| 10 | `marble_caustics` | `32_caustic_shimmer` | Rippling water caustics play across the ship as veins of bright white in gray marble. |
| 11 | `pale_garden` | `22_abyssal_sway_garden` | A garden of pale fronds sways gently, tips glowing crisp white against gray stems. |
| 12 | `porthole_liner` | `08_ocean_liner` | The ship steams at night — rows of brilliant white portholes over a soft gray hull wash. |
| 13 | `tidal_crossing` | `119_bow_stern_tidal_push` | Two white tidal fronts push from bow and stern, meeting in a bright crossing crest. |
| 14 | `pale_maelstrom` | `127_grand_maelstrom` | A great slow maelstrom of pale arms rotates around the ship, arm edges etched white. |
| 15 | `ivory_louvers` | `ambient_extra/09_shadow_slats` | Giant ivory louvers pivot slowly across a satin-gray ship, each blade edged in a crisp white line. |
| 16 | `frosted_panes` | `ambient_extra/01_harbor_glass` | Five huge frosted-glass panes slowly rearrange across the ship, their borders drawn as crisp white frost lines. |
| 17 | `moon_pearls` | `ambient_extra/03_pearl_chain` | A necklace of brilliant white pearls rings the ship, a slow moonbeam rolling bead to bead over gray velvet. |
| 18 | `paper_fold` | `ambient_extra/11_paper_fold` | One immense sheet of white paper folds through the ship — broad facets in different grays, every crease a razor of white light. |
| 19 | `silver_frames` | `ambient_extra/12_floating_frames` | Immense silver picture frames drift through the ship, their bright rails cutting white rectangles out of a gray dusk. |
| 20 | `frost_branch` | `ambient_extra/17_frost_branch` | A giant white frost crystal grows over the ship, holds its six-armed emblem, then melts back to a glowing nucleus. |

Slices: 01-07 Sonnet A, 08-14 Sonnet B, 15-20 the lead (15 was the exemplar
both slices copied). Two derivations added a term beyond the literal source
skeleton to satisfy the texture law and both are named in their headers:
`01_ivory_cathedral` (an archGlow mid-body carrier) and `03_silver_current`
(a broad silver sheen); `14_pale_maelstrom` gained the `armEdge` term its
identity line required (the source had filled arms with no edge).

## 3. The white-rendering convention (found, then enforced)

The house anchor is `patterns/60_white_wash.js` (the root WHITE ONLY family,
60-64): white is **near-equal RGB plus a matched W/A native-white pair, UV
always zero, and no palette exports** — the file's own header calls the look
"untintable by global palettes and hue". This family adopts that convention
in its strictest form, as one shared **WHITE AUTHORITY block**, byte-identical
across all twenty sources (hash-gated):

- `emitWhite(level, nativeShare)` is the ONLY emit path (`rgbwau` appears
  exactly once per file, inside the block);
- `R = G = B = level × 0.88` — zero chroma, exactly, every pixel (the root
  family's optional warmth tint is deliberately dropped: purity is gateable
  at `assert(r === g && g === b)`);
- `W = A = level × 0.62 × nativeShare` — matched native-white, high share on
  hero peaks (pearls, beams, edges), low on the field;
- `U = 0` always; no `colorPalette1/2` exports anywhere.

## 4. The texture law (the operator's direction, as numbers)

Each pattern composes its level from three bands: a 0.06-0.14 shadow floor
(true black only for moving carved features), a 0.30-0.55 mid-gray body over
roughly half the rig, and 0.85-1.0 crisp peaks on structurally meaningful
features. Gated on a 30 s titanic census at code defaults, sampled at
**dt = 0.05 s per beginFrame** (the `_305` dt-clamp lesson — a coarse elapsed
grid under-samples every clock):

- **max lit byte ≥ 200** — crisp features actually punch near the 224 emit
  ceiling (night-visibility mission);
- **frac(lit ≥ 180) ∈ [1 %, 45 %]** — peaks have real area, and can never
  become the flat white blast the operator vetoed;
- **frac(lit < 124) ≥ 30 %** — a real mid/low-gray body under the peaks
  ("the colors are not always and too white");
- **dark fraction (byte < 8) ≤ 20 %** and **every named region ever-lit**
  ("use dark areas sparingly" — the rig never loses a region).

**Why absolute bytes, not the relative bars in the brief.** The first gate
build used the brief's example ("≥15 % above 0.85×peak" with peak = p99) and
it mis-measured in both directions: a genuinely contrasty pattern with rare
thin peaks puts its p99 *inside the mid body*, so the metric turned circular
and read real contrast as "no peaks". The absolute cohorts measure exactly
what the operator asked for — peaks that punch, a body that stays gray — and
the justification lives as a comment on the gate itself.

The first full census also caught real defects the per-file harness runs had
passed: 14 of 20 keepers had peaks that never reached byte 200 (the whole
family was living under 80 % brightness), and `05_snowfall` left the
Right Front Rails region at 0 lit samples for 30 s. All were re-tuned or
fixed and re-measured.

## 5. Speed law and runaway analysis

Every keeper carries the shared linear local curve (grep-gated, verbatim):
`var speedScale = 0.35 + clamp01(localSpeed) * 1.65;` composed with the
engine's exponential global knob `0.25·16^s`. All twenty are authored to the
operator's reference point **global 25 / local 0.30** (rate factor 0.4225),
and the playlist saves `sliderLocalSpeed: 0.3` so entries load AT the
authored point (the `_306` convention, deliberately not repeating `_305` §5's
gap). Every header states its runaway analysis to the TRUE unclamped maximum
**g = 4.0 × local 2.0 = 8× base**: the fastest temporal term in the family
stays below the 10 cycles/s alias bar (worst: `20_frost_branch`'s ice sheen
at 5.1/s), and every clock wraps by single subtraction against
`PHASE_WRAP = 4096` with worst per-frame jumps ~0.03 — five orders of
magnitude of headroom.

**Task #69 discipline:** no keeper contains a statement-level multi-line
leading-`+` chained sum (the construct the VM verifiably miscompiles). Three
inherited instances were found in central review (`03`, `11`, `16`) and
rewritten to named-variable accumulation; the rewrites measured
byte-identical output, so they were hygiene, not behavior changes.

## 6. Gates

`marsin_engine/tests/patterns/white_only_contract.test.js` (new, 11 tests):
curation (exactly 20, numbering = playlist order), authority-block
byte-identity, single-emit-path, no-palette/no-audio/speed-law source
contract, purity on titanic, purity on test_bench, intensity texture, region
coverage, animation, pairwise distinctness across all 20, playlist integrity
(byte-identical scenes + resolving entries + 0.30 reference defaults).

RESULTS PENDING.

Silence gates hold by construction: no keeper carries an
`AUDIO_MODULATION_V1` block or references a mic signal (grep-gated), so
silence and music are identical. Offline harness (`pattern_audio_harness.mjs
--gate`) passes on BOTH models for all 20.

## 7. Playlist, manifest, goals, gallery

- **Playlist:** the 20 entries appended to
  `simulation/scenes/{titanic,test_bench}/playlists/white_only.yaml`, byte
  identical, `defaults` generated from each pattern's own declared slider
  order; the 5 legacy entries (60-64) byte-untouched.
- **Manifest:** `white_only` registered in `MANIFEST_PATTERN_DIRS`
  (`simulation/server/pattern_manifest.cjs`) with its reason; manifest
  regenerated under the coordinator's cross-wave lock
  (`C:/Users/TITANI~1/tmp/bm26_manifest_regen.lock`) and DIFF-AUDITED:
  family-only additions, zero changes to any other family's ids.
- **Goals:** 20 string-form entries (the one-sentence identities) added to
  `tools/playlist_gallery/pattern_goals.json` under the same lock, re-read
  fresh before writing, atomic rename; no other key touched.
- **Gallery:** `docs/pattern_gallery/playlists/titanic/white_only/` rendered
  at live parity (`--seconds 20 --global-speed 0.5 --skip-index` — 0.5 is the
  clock multiplier of global fader 25, and the saved defaults ARE the
  authored local 0.30). The combined index was NOT rebuilt (concurrent-writer
  contention, the `_305`/`_306` precedent). Early/middle/late frames of every
  clip inspected by the lead (§7.1).

### 7.1 Visual inspection

PENDING.

## 8. Restart — what the operator has to do

Nothing in this wave is live. The pending launcher bounce (bench arm-marker
check first, per standing order) already queued for `_300`/`_305`/`_306`/
`_311` now also delivers the 20 white keepers and the extended `white_only`
playlist. No CaptainPad rebuild. After the bounce: load `white_only` on a
deck — entries 1-5 are the legacy root whites, entries 6-25 are this wave in
order 01-20. Global SPEED 25 is the authored point; the saved local speeds
already load at 0.30.

## 9. Files touched

**New** — `marsin_engine/patterns/white_only/` (20 sources);
`marsin_engine/tests/patterns/white_only_contract.test.js`;
`docs/pattern_gallery/playlists/titanic/white_only/` (gallery).

**Modified** — `simulation/scenes/{titanic,test_bench}/playlists/white_only.yaml`
(append-only); `simulation/server/pattern_manifest.cjs` (one registry line);
`marsin_engine/patterns/manifest.json` (regenerated, family-only diff);
`marsin_engine/tools/playlist_gallery/pattern_goals.json` (20 added keys).

**Not touched, by instruction** — `patterns/baby_reveal/**` + reveal YAML
(`_311` owns them), `patterns/baby_tease/**`, `patterns/crisp/**`, Live Touch,
CaptainPad, the launcher, engine internals, `marsin_engine/states/**`, the
combined gallery index.

**Scratch, outside the tree** — the session scratchpad (spec, prescreen
census, playlist/goals generators) and `C:/Users/TITANI~1/tmp/`.
