# 20260817_300 — Baby Tease rebuild: implementation + validation (Phase 2)

**Wave:** `_300`, the implementation half of the Baby Tease redesign.
**Contract:** `docs/72_baby_tease_pattern_redesign.md` (design) +
`.agent/reports/202608/20260817_299_baby_tease_redesign_audit_design.md` (audit).
**Operator order:** "recreate the playlist and the proper patterns", extended
mid-wave with "clean up remaining patterns unused from disk".
**Scope honoured:** no git operations of any kind; no ports bound; the live
operator stack was never touched; Live Touch / CaptainPad / engine internals /
launcher / deployment / runtime state untouched.

> **THE ENGINE IS STILL RUNNING THE OLD PATTERN SET.** It loaded patterns at
> boot. Nothing in this wave restarted anything, by instruction. A launcher
> bounce is required before any of this is visible on the rig. See §9.

---

## 1. Concurrent-writer situation (read first)

The working tree arrived mid-bulldoze: a concurrent Codex writer had rewritten
`marsin_engine/patterns/baby/` between roughly 13:39 and 14:00 today. Sina
stopped it before this wave began implementing, and the coordinator confirmed
the stop.

A SHA-256 + mtime tripwire was taken over every Baby source, both scenes' three
Baby playlists, `pattern_goals.json` and `manifest.json` before any edit
(`C:\Users\TITANI~1\tmp\baby_snap\`) and re-checked through the wave. **No
foreign write landed during this session** — every change under
`patterns/baby/` after 14:00 is this wave's.

One important correction to the wave's premise: the audit that produced
`docs/72` ran against tease sources that were **never committed**. `HEAD` still
carries a completely different, older tease set (`01_tease_orbit_question`,
`10_tease_constellation_tides`, `81_tease_balance_beam`, …). So "restore from
HEAD" does not mean what it sounds like for the tease family — HEAD's tease
patterns are the retired generation, not the audited one.

## 2. The keeper set as landed (13)

All thirteen live in `marsin_engine/patterns/baby/`. Three are reworks in
place; ten are new files in the `82`–`91` block. No renumbering anywhere.

| K | file | entry id | 50-ft identity |
|---|---|---|---|
| K01 | `10_tease_braided_rivers` (reworked) | `e_baby_tease_braided_rivers` | Pink and blue rivers run the length of the hull and braid around each other. |
| K02 | `12_tease_cellular_organism` (reworked) | `e_baby_tease_cellular_organism` | A dozen soft pink and blue pebbles tile the whole ship and slowly trade places. |
| K03 | `13_tease_rotating_yin_yang` (deep rework) | `e_baby_tease_rotating_yin_yang` | Two interlocking hooks, each carrying the other colour's eye, rock and breathe around the ship's heart. |
| K04 | `82_tease_checker_tide` (new) | `e_baby_tease_checker_tide` | A giant pink/blue checkerboard whose tiles invert in a slow diagonal wave. |
| K05 | `83_tease_carousel_sectors` (new) | `e_baby_tease_carousel_sectors` | A six-blade pinwheel of alternating pink and blue spins over the whole ship. |
| K06 | `84_tease_argyle_weave` (new) | `e_baby_tease_argyle_weave` | Pink and blue diamonds slide across each other like woven ribbons. |
| K07 | `85_tease_candy_helix` (new) | `e_baby_tease_candy_helix` | A pink-and-blue candy-cane helix twists along the hull. |
| K08 | `86_tease_rail_exchange` (new) | `e_baby_tease_rail_exchange` | Stacked pink and blue rails stream in opposite directions and periodically trade lanes. |
| K09 | `87_tease_counter_comets` (new) | `e_baby_tease_counter_comets` | Pink and blue comets circle the ship in opposite directions over a woven lattice. |
| K10 | `88_tease_bullseye_tide` (new) | `e_baby_tease_bullseye_tide` | A pink-and-blue bullseye ripples outward from the heart of the ship. |
| K11 | `89_tease_ink_drops` (new) | `e_baby_tease_ink_drops` | Pink and blue ink drops keep blooming through each other. |
| K12 | `90_tease_star_exchange` (new) | `e_baby_tease_star_exchange` | Pink stars glitter inside blue country and blue stars inside pink country. |
| K13 | `91_tease_position_swap` (new) | `e_baby_tease_position_swap` | Two solid colour masses slide the length of the ship and zip through each other to swap ends. |

The three surviving entry ids kept their names, so CaptainPad state that
references them still resolves. Numbers 82-91 are a fresh block; nothing was
renumbered.

**Authority-block proof.** `PINK_TRIM 0.97` / `PINK_BAR_TRIM 0.80` /
`FLOOR_I 0.14` are byte-identical in all thirteen files, and the three emit
helpers hash identically across the set (md5 `762cdf46d7c7` over the
whitespace-stripped `emitBlue`/`emitPink` bodies). No call site multiplies an
emit argument. The per-pattern pink-gain zoo is gone: K02's `pinkEnergyScale
1.35` and its `FIX_BAR_18` x0.55 special case, and K01's pink gain and `+0.03`
field bias, were deleted. A new test pins this (§7).

### 2.1 Where the shipped patterns diverge from docs/72

This matters for the design doc's standing, so it is stated plainly: **every
one of `docs/72`'s identities, laws and parameter contracts shipped intact, but
a large fraction of its concrete formulas did not survive contact with the real
pixel geometry.** The gates, not taste, forced each change.

The universal one: `docs/72` writes its fields in terms of raw `y` or raw
`shipWide`. Measured, `y` spans 0.00-1.00 on titanic but only **0.09-0.36** on
the bench, and `shipWide` spans **0.32-0.74** on titanic but -0.16-1.10 on the
bench. Either axis alone is nearly degenerate on one of the two rigs, so
almost every keeper replaces it with a blend of the two (spans ~0.85 on both).

Per-keeper, the substantive ones:

- **K03** — `field = rotX + hooks` is a rotated half-plane; at the specified
  hook amplitudes the bow and stern extremes can never flip, so it fails L2 by
  construction. Shipped as a travelling lattice of point-antisymmetric yin-yang
  medallions, each keeping the spec's counter-colour eyes and iris rings.
  Continuous rotation was tried and rejected: a spinning yin-yang inverts
  colour every half turn and blows the per-second territory band, so the frame
  rocks (exactly the spec's bounded rock) and the lattice travels instead.
- **K08 — `docs/72`'s lane-pairing rule is arithmetically broken.**
  `laneWave = tradeClock − shipLong·0.8 − (r % 2)·0.5` with
  `parity = (r + flips) % 2` desynchronises by a half period, so for half of
  every cycle `floor()` returns the same value for both lane pairs and **all
  four rails land on the same family** — a single-colour rig on the outcome-
  blind stage. Replaced with two independent inversion fronts summed into one
  parity.
- **K11 — the drop rule breaks the review band.** "Newest drop wins, otherwise
  the old sea is the opposite family of the newest drop" hands most of the rig
  to one family at every birth. Shipped as counter-coloured drop *pairs* (one
  pink, one blue, same radius, born together) over a static 50/50 sea.
- **K13** — `owner = field > 0` on `(dB − dP)` is a plane split on shipLong
  (L2 ~ 1.0, automatic fail). The two mirror-symmetric masses survive, but as
  compact bodies riding a static lace lattice that is 50/50 by construction.
- **K09** — two antipodal bodies per family sample the lumpy orbital pixel
  density unevenly (review swung past 1.9); three evenly spaced bodies cancel
  all but the third harmonic. The spec's ground lattice uses two *correlated*
  floors (their arguments sum to `2·shipLong + const`) and measured strongly
  one-sided on both rigs; replaced with a three-factor lattice. Its ground is
  also mid-bright rather than the specified dim band — with a dim ground the
  bright fraction sat at 5-6 % against the 8 % floor, and a mid-bright hull
  serves the visibility mission better anyway.
- **K02, K10, K12** — hand-placed station counts (8 Voronoi centres, 3-5 rings,
  4-5 % stars) all produce uneven populations against the real pixel
  distribution; each shipped with a denser, swept structure. K12 in particular
  cannot reach the 8 % bright floor at 4-5 % star density.
- **K01, K05, K06, K07** — frequency and phase retunes of the specified
  skeleton, plus one genuine bug in K06's mirrored form (`duel ≡ 0` wherever
  the cross term vanishes, which blacked out 57 % of the sign).

Every Vintage branch also needed a black separator head that `docs/72` does not
mention, because the fixture gate requires >= 2 blue, >= 2 pink **and** >= 1
dark head simultaneously on six heads.

## 3. Removals

### 3.1 Kill list (docs/72 §6)

`docs/72` lists twelve tease sources to kill. Five of them
(`02_tease_port_starboard_tug`, `03_tease_crisp_quasifield`,
`06_tease_corner_reservoirs`, `07_tease_infinite_tug_of_war`,
`09_tease_blue_entropy`) had **already been deleted from disk by the Codex
writer** before this wave started, and were never committed, so they exist
nowhere any more. That is a real, unrecoverable loss of those five files — but
they are on the kill list, so nothing of value is gone.

The remaining seven were removed by this wave:

```
01_tease_two_color_world_walk.js   04_tease_color_wells.js
05_tease_twin_lighthouse.js        08_tease_boiling_opposites.js
11_tease_folding_paper.js          14_tease_traveling_compression_front.js
15_tease_magnetic_poles.js
```

All seven were untracked, so all seven were copied to
`C:/Users/TITANI~1/tmp/codex_baby_backup/` before deletion. Their
`pattern_goals.json` entries are gone and the manifest was regenerated.

### 3.1b The sweep (operator's "clean up remaining patterns unused from disk")

After the playlists, goals and manifest were rebuilt, `patterns/baby/` was
swept against them: everything not referenced by the three playlists (both
scenes) or `pattern_goals.json` came off disk.

| removed | git state | backup |
|---|---|---|
| the seven files above | untracked (`??`) | `C:/Users/TITANI~1/tmp/codex_baby_backup/` |

Nothing else was unreferenced. **End state: 33 sources on disk, 33 registered
in the manifest — 13 tease + 10 boy + 10 girl, and nothing else.** That is also
what the suite independently demands (`DISK_IDS.length === IDS.length`).

One trap worth recording: the first sweep pass removed **zero** files. The
manifest is *regenerated from disk*, so treating it as a reference authority
makes the sweep a tautology — it lists exactly the files under test. The
authorities have to be the playlists and the goals file, with the manifest
regenerated afterwards to match whatever survives.

### 3.2 Codex residue disposition

Ten untracked tease sources were on disk when the wave started. **All ten were
copied to `C:/Users/TITANI~1/tmp/codex_baby_backup/` before anything was
touched** — they are untracked, so deletion would otherwise be unrecoverable.

Their correct disposition turned out to be less dramatic than the brief
assumed. These ten are not foreign residue: they are exactly the set `_299`
audited, minus the five the writer had already deleted. So:

- **Three are keepers** — `10_tease_braided_rivers`,
  `12_tease_cellular_organism`, `13_tease_rotating_yin_yang`. `docs/72` K01–K03
  say "rework in place", and that is what happened: these three files were
  reworked, not replaced.
- **Seven are kill-list files** — removed from disk by the sweep, preserved in
  the backup.

I skimmed each of the seven for a mechanism worth rescuing, as instructed, and
spot-checked the owner fields myself rather than taking `_299`'s word for it:

| File | Owner field as written | Verdict |
|---|---|---|
| `01_tease_two_color_world_walk` | `field = shipLong - border` | Pure plane threshold. Nothing to rescue. |
| `04_tease_color_wells` | `field = blueDistance - pinkDistance - 0.018` | A two-site power diagram — a curved plane. Strictly weaker than K02's eight-cell Voronoi, and it carries a silent `-0.018` bias toward pink. Nothing to rescue. |
| `08_tease_boiling_opposites` | `familyBlue = territory >= 0.0`, plus a per-fixture `familyGain` of 1.0 / 0.90 | Plane threshold plus exactly the per-pattern gain zoo the redesign abolishes. Its counter-colour bubbles are conceptually adjacent to K11 ink drops, which does the same idea properly with growth fronts. |
| `05`, `11`, `14`, `15` | plane ± bounded wiggle (`_299` §1, re-confirmed) | Nothing to rescue. |

**No taste option worth carrying forward was found.** The one honest note for
Sina: `04_tease_color_wells`'s well construction and `08`'s counter-colour
bubbles are the two killed files whose *ideas* survive in the new set, in
better form, as K02 and K11.

### 3.3 The new L2 gate, measured against the set it was written to catch

Before deleting them I ran the new anti-bilateral metric over three of the
condemned patterns, so the gate has a recorded "before" reading rather than
only a design claim. Numbers are mean/max predictability on the ship's long
axis, titanic (limit: 0.35 mean, 0.65 max):

| Pattern | `P_shipLong` titanic | Reading |
|---|---|---|
| `15_tease_magnetic_poles` | **0.75 / 0.84** | Worst offender — confirms `docs/72`'s "the plane term dominates 3.6×". |
| `01_tease_two_color_world_walk` | **0.73 / 0.76** | The textbook left/right split. |
| `82_tease_checker_tide` (new) | **0.11 / 0.26** | For comparison. |

So the metric does catch the defect it was written for, by a wide margin.

One honest caveat, because it matters for how much weight the gate should
carry: **L2 does not condemn every killed pattern.** `05_tease_twin_lighthouse`
scores 0.26 max on its worst axis — it passes L2 comfortably and was killed on
the other grounds in `docs/72` §1 (mirrored split, cosmetic beams) plus a
perceived-balance reading of 1.23. L2 is a strong detector of the specific
plane-threshold failure, not a general "is this pattern good" score.

## 4. Boy / Girl — READ THIS, IT NEEDS SINA'S RATIFICATION

> **The Baby Boy and Baby Girl families were cut from 20 patterns each to 10
> each by the concurrent Codex writer. Not by Sina, and not by this wave.**
> Nobody in this session was told that cut was intended. It needs ratifying or
> reversing.

The wave's brief ordered every deleted Boy/Girl source restored byte-exact from
HEAD. Investigation showed that would have **broken** the set rather than
repaired it, so the order was escalated and the coordinator approved not doing
it. The evidence:

1. Both Boy and Girl playlists on disk (byte-identical across scenes) reference
   exactly the 10 surviving sources each. **They already fully resolve** —
   there is no dangling reference and nothing is broken today.
2. The surviving 10 + 10 are perfectly concept-paired: `orbit_glow`,
   `rose_glow`, `comet_lullaby`, `constellation_flow`, `ribbon_braid`,
   `bubble_chorus`, `lighthouse_fans`, `heartbeat_bloom`, `diamond_quilt`,
   `celebration_burst`.
3. The gate was rewritten to match the cut: `baby_color_contract.test.js` now
   declares `MIN_KEEPERS = 10` / `MAX_KEEPERS = 15` and asserts each family
   sits in that range. **Those constants do not exist at HEAD** — they are part
   of the same uncommitted overhaul.
4. Restoring 20 per family would therefore fail two gates: the curated-range
   assertion (20 > 15), and the derived rule that every family member must
   appear in its playlist.
5. The operator's own sweep order — "disk contains exactly the referenced set"
   — would then have deleted the restored files again.

**Nothing is lost either way:** all 20 are tracked and committed.

### 4.1 The 20 non-restored files, and how to reverse the cut

Each is recoverable with one command from the repo root:

```
git show HEAD:marsin_engine/patterns/baby/<FILE> > marsin_engine/patterns/baby/<FILE>
```

| Boy | Girl (its twin) |
|---|---|
| `17_boy_crossing_glow.js` | `32_girl_crossing_glow.js` |
| `19_boy_horizon_tides.js` | `34_girl_horizon_tides.js` |
| `20_boy_cradle_waves.js` | `35_girl_cradle_waves.js` |
| `23_boy_moonlit_ripples.js` | `38_girl_moonlit_ripples.js` |
| `28_boy_waterfall_veil.js` | `43_girl_waterfall_veil.js` |
| `55_boy_rail_cascade.js` | `70_girl_rail_cascade.js` |
| `58_boy_silhouette_tide.js` | `73_girl_silhouette_tide.js` |
| `60_boy_orbital_pearls.js` | `75_girl_orbital_pearls.js` |
| `61_boy_crossing_beacons.js` | `76_girl_crossing_beacons.js` |
| `64_boy_harbor_fireflies.js` | `79_girl_harbor_fireflies.js` |

**Restoring is not a one-command job overall**, and this is the consequence
Sina needs before deciding: restoring any of these also requires (a) adding a
matching entry to BOTH scenes' `baby_boy.yaml` / `baby_girl.yaml` in the same
concept order with identical defaults, (b) restoring the twin as well — the
pairing gate is absolute, and (c) if the family goes past 15, raising
`MAX_KEEPERS` in `baby_color_contract.test.js`. Restore boy and girl in pairs
or the suite goes red. The pre-cut playlists are recoverable the same way
(`git show HEAD:simulation/scenes/titanic/playlists/baby_boy.yaml`, and the
`test_bench` copy must stay byte-identical).

### 4.2 Gate results over the 20 surviving Boy/Girl files

Run offline over both rigs at t = 0, 0.5, 1.0, 2.5, 5.0 s. Content was left
exactly as the Codex writer left it — nothing was silently reverted.

- **18 of 20 pass** every colour-contract assertion (single family only, zero
  leak of the forbidden family, W = A = U = 0, no third hue, ≥ 3 % designed
  black).
- **Twin pairing is perfect**: 10 boy ↔ 10 girl by concept, and every pair is
  source-identical apart from its six `COLOR_*` constants.
- **2 fail, and they are a twin pair** —
  `22_boy_constellation_flow` and `37_girl_constellation_flow`, on
  `test_bench` only, at every sampled time:

| | titanic | test_bench |
|---|---|---|
| `22_boy_constellation_flow` | pass | blue lit pixels 8–12, gate needs ≥ 15 |
| `37_girl_constellation_flow` | pass | pink lit pixels 8–12, gate needs ≥ 15 |

It is a sparse star field; the bench rig is 166 pixels against titanic's 964,
so the same star density lands under the floor there. It fails identically on
both halves of the pair, which is at least consistent — the twins have not
drifted.

I then measured HEAD's version of the same file side by side (offline, without
writing it into the tree), because "is the committed version better?" is the
fact that actually decides this. It is, and not marginally — lit blue pixels:

| | titanic | test_bench | verdict |
|---|---|---|---|
| **HEAD** version | 77 – 154 | **17 – 27** | **passes both rigs** |
| working (Codex-edited) | 16 – 24 | 8 – 12 | fails the bench |

The Codex edit (+15/−6 lines) did not just push the bench under the floor — it
cut the pattern's lit population by roughly **6× on titanic too** (from ~119 to
~16 lit pixels at t = 0), leaving it barely over the ≥ 15 floor on the big rig
as well. That is a regression, not a retune.

> **FLAGGED FOR SINA, NOT RESOLVED HERE** (per the coordinator's instruction
> that a failing survivor's disposition is Sina's call). **My recommendation:
> restore the HEAD version of this twin pair** — it is the only one of the 20
> that fails, the committed version passes cleanly on both rigs, and the twin
> stays paired because both halves get restored together:
>
> ```
> git show HEAD:marsin_engine/patterns/baby/22_boy_constellation_flow.js > marsin_engine/patterns/baby/22_boy_constellation_flow.js
> git show HEAD:marsin_engine/patterns/baby/37_girl_constellation_flow.js > marsin_engine/patterns/baby/37_girl_constellation_flow.js
> ```
>
> I did not run this, because the wave was told to leave Boy/Girl content in
> place and not revert a foreign writer's edits silently. Both playlists
> already point at these ids, so nothing else needs changing.

## 5. Decisions D1–D8 as implemented

| D | docs/72 proposal | Taken | Note |
|---|---|---|---|
| **D1** keeper count | ship 13 | **13, as proposed** | The two shelved candidates were not authored. |
| **D2** authority constants | `PINK_TRIM 0.90`, `PINK_BAR_TRIM 0.80` | **MODIFIED — `PINK_TRIM` ships at 0.97**, `PINK_BAR_TRIM` at 0.80 as proposed | The one decision that could not be implemented as written. Full reasoning below. |
| **D3** legal global-speed range | assume g ∈ [0.25, 2.0] | **as proposed** | Every keeper's clock is bounded and wraps on an even integer; none is acceleration-coupled. Not independently re-derived against the CaptainPad clamp — still open. |
| **D4** keep the reworked yin-yang | keep | **kept**, deep-reworked per K03 | Gains dominant hooks plus the two counter-colour eyes. |
| **D5** playlist arc order | §7 order | **as proposed**, unchanged | |
| **D6** direction sliders on K05/K07/K08/K09 | approve | **as proposed** | `sliderDirection` is the 2nd declared slider on those four, binary, default 1.0. |
| **D7** bright front accents | keep 0.85–0.92 | **kept** | Mean frame peak stays far under the 145 ceiling everywhere, so the accents cost nothing. |
| **D8** K12 sign star addresses | data, veto freely | **as proposed** | |

### D2 — why `PINK_TRIM` ships at 0.97

`docs/72` asks for two things that are arithmetically incompatible:

- **§3** sets `PINK_TRIM 0.90` and `PINK_BAR_TRIM 0.80` as the only balance
  knobs.
- **§9** requires perceived balance `S_pink/S_blue ∈ [0.90, 1.11]` using
  `w_pink 0.46`, `w_blue 0.42`.

Those weights **already carry** the Helmholtz–Kohlrausch compensation — that is
what makes them unequal. Applying a 0.90 global trim on top double-counts it.
Measured on the real rigs: bars are 37.3 % of titanic's 964 pixels and take the
extra ×0.80, so `PINK_TRIM 0.90` lands an effective raw pink factor of **0.833**
on titanic and 0.861 on the bench. Since §9's window maps to an effective raw
factor of **[0.822, 1.014]**, 0.90 sits about 1 % off the floor — fine only if
territory is exactly 50/50 forever. It is not: the first build of
`82_tease_checker_tide` measured perceived balance **0.893 — a fail** — purely
because its census averaged a few percent under parity.

There is a second squeeze from the same constant. `baby_color_contract` wants
raw byte authority in 0.69–1.45, and inside 0.75–1.34 for 13 of 21 review
seconds. At effective 0.833, authority is `0.833 × territory`, so territory has
to stay above 0.90 just to clear the balanced window — which leaves no room for
the territorial motion this redesign exists to create.

`PINK_TRIM 0.97` with `PINK_BAR_TRIM 0.80` lands effective raw **0.897**
(titanic) / 0.928 (bench) → perceived **0.982 / 1.016**, mid-window, and gives
authority ≈ 0.90 × territory so territory may swing 0.83–1.49 while staying
balanced. Both gates pass with real margin, and the design's one-authority-law
principle is untouched: still exactly two constants, still byte-identical
across all thirteen files, still no per-pattern gain.

**To reverse:** set `PINK_TRIM` back to `0.90` in all 13 files. To keep 0.90
AND stay green, one of the following must also change — the §9 window would
have to widen to about `[0.88, 1.11]`, or the perceptual weights would have to
stop double-counting (`w_pink = w_blue`). `docs/72` §11 D2 now carries a pointer
to this section so the design doc does not silently disagree with the tree.

## 6. Playlist, manifest, goals

`simulation/scenes/titanic/playlists/baby_tease.yaml` and the `test_bench`
copy are **byte-identical** (sha256 `4655e30a5486…`, 4435 bytes — verified by
hash and by the suite's own byte-comparison test). Thirteen entries in the
`docs/72` §7 arc, calm to curious to kinetic:

1. Bullseye Tide · 2. Cellular Organism · 3. Star Exchange · 4. Rotating
Yin-Yang · 5. Ink Drops · 6. Argyle Weave · 7. Braided Rivers · 8. Checker
Tide · 9. Candy Helix · 10. Rail Exchange · 11. Carousel Sectors · 12. Counter
Comets · 13. Position Swap

Each entry's `defaults` block is generated **from the pattern's own declared
slider order** rather than hand-written, so the "defaults must name exactly the
exported sliders, in order" assertion cannot drift. `sliderDirection` is the
second key on K05/K07/K08/K09 per the MFT param law (D6). `modulations: []`
and `midiMappings: []` throughout; `notes:` carries the §4 identity sentence,
which is also the `pattern_goals.json` line.

`pattern_goals.json`: 12 retired tease entries removed, 13 keepers written,
file re-sorted by key. `marsin_engine/patterns/manifest.json` regenerated from
disk with the repo's own registry generator.

The Boy and Girl playlists were **not touched** and still resolve.

## 7. Validation

Everything below is offline: the real model compiler, both rigs, no engine, no
sockets, no show ports.

### 7.1 Repo gates

| gate | result |
|---|---|
| `marsin_engine tests/patterns/baby_color_contract.test.js` | **15 / 16** - the single red is `22_boy_constellation_flow` on the bench (section 4.2), flagged for Sina, not caused by this wave |
| `marsin_engine tests/patterns/baby_tease_redesign_metrics.test.js` (NEW) | **3 / 3** |
| `marsin_engine tests/patterns/playlist_gallery_tool.test.mjs` | **13 / 13** |
| `simulation tests/pattern_manifest.test.js` | **6 / 6** |

All thirteen keepers pass every tease assertion in the colour contract: exact
family RGB with zero intermediate hues, W = A = U = 0, both families in every
frame, designed black between 5 and 45 percent, mean frame peak under the 145
ceiling, no address-alternating noise, a balanced 20-second review, the
smokestack-frame source check (including "raw x and z appear exactly twice"),
byte-identical TE signs across port and starboard, a balanced local duet on
every six-head Vintage, pattern-specific animated sign art, real animation, and
pairwise distinctness.

### 7.2 The new metrics, per pattern, both rigs

Limits: L2 mean <= 0.35 and max <= 0.65 on every axis; perceived balance in
0.90-1.11; at least 13 of 21 review seconds balanced; no single second may hand
over more than 45 percent of the rig.

| pattern | rig | mean peak | perceived balance | balanced frames | max 1 s handoff | L2 shipLong | L2 y | L2 shipWide |
|---|---|---|---|---|---|---|---|---|
| `10_tease_braided_rivers` | titanic | 55.9 | 1.004 | 19/21 | 39% | 0.11/0.24 | 0.04/0.12 | 0.06/0.14 |
| `10_tease_braided_rivers` | bench | 64.5 | 1.088 | 17/21 | 27% | 0.10/0.23 | 0.10/0.23 | 0.09/0.18 |
| `12_tease_cellular_organism` | titanic | 55.7 | 1.049 | 20/21 | 39% | 0.13/0.30 | 0.10/0.25 | 0.10/0.26 |
| `12_tease_cellular_organism` | bench | 59.6 | 1.080 | 20/21 | 36% | 0.09/0.21 | 0.09/0.23 | 0.09/0.20 |
| `13_tease_rotating_yin_yang` | titanic | 63.0 | 0.919 | 21/21 | 29% | 0.09/0.19 | 0.22/0.43 | 0.07/0.17 |
| `13_tease_rotating_yin_yang` | bench | 63.2 | 1.012 | 19/21 | 24% | 0.11/0.23 | 0.07/0.17 | 0.11/0.22 |
| `82_tease_checker_tide` | titanic | 63.9 | 1.021 | 21/21 | 15% | 0.15/0.26 | 0.16/0.29 | 0.11/0.23 |
| `82_tease_checker_tide` | bench | 61.5 | 1.058 | 21/21 | 11% | 0.04/0.10 | 0.03/0.07 | 0.07/0.12 |
| `83_tease_carousel_sectors` | titanic | 60.3 | 1.028 | 21/21 | 32% | 0.20/0.31 | 0.10/0.16 | 0.20/0.33 |
| `83_tease_carousel_sectors` | bench | 64.5 | 1.094 | 20/21 | 24% | 0.07/0.13 | 0.09/0.16 | 0.05/0.10 |
| `84_tease_argyle_weave` | titanic | 66.8 | 1.048 | 21/21 | 29% | 0.05/0.10 | 0.10/0.22 | 0.08/0.14 |
| `84_tease_argyle_weave` | bench | 70.1 | 1.050 | 21/21 | 26% | 0.10/0.20 | 0.05/0.08 | 0.13/0.22 |
| `85_tease_candy_helix` | titanic | 71.4 | 0.998 | 21/21 | 24% | 0.06/0.13 | 0.14/0.28 | 0.14/0.23 |
| `85_tease_candy_helix` | bench | 69.5 | 1.046 | 21/21 | 23% | 0.06/0.08 | 0.04/0.07 | 0.04/0.11 |
| `86_tease_rail_exchange` | titanic | 72.2 | 1.029 | 21/21 | 19% | 0.05/0.19 | 0.04/0.11 | 0.03/0.09 |
| `86_tease_rail_exchange` | bench | 72.9 | 1.084 | 21/21 | 14% | 0.05/0.17 | 0.04/0.09 | 0.08/0.20 |
| `87_tease_counter_comets` | titanic | 50.9 | 0.979 | 16/21 | 14% | 0.06/0.14 | 0.04/0.12 | 0.08/0.16 |
| `87_tease_counter_comets` | bench | 58.6 | 0.955 | 21/21 | 12% | 0.08/0.16 | 0.04/0.12 | 0.03/0.08 |
| `88_tease_bullseye_tide` | titanic | 64.0 | 0.945 | 21/21 | 21% | 0.10/0.18 | 0.05/0.10 | 0.07/0.14 |
| `88_tease_bullseye_tide` | bench | 68.9 | 0.978 | 19/21 | 23% | 0.07/0.11 | 0.07/0.18 | 0.07/0.12 |
| `89_tease_ink_drops` | titanic | 54.8 | 1.052 | 19/21 | 12% | 0.24/0.39 | 0.19/0.26 | 0.09/0.20 |
| `89_tease_ink_drops` | bench | 65.2 | 1.001 | 21/21 | 7% | 0.09/0.20 | 0.03/0.06 | 0.05/0.09 |
| `90_tease_star_exchange` | titanic | 35.7 | 1.006 | 21/21 | 17% | 0.04/0.08 | 0.09/0.13 | 0.08/0.14 |
| `90_tease_star_exchange` | bench | 38.2 | 1.045 | 21/21 | 16% | 0.07/0.13 | 0.04/0.09 | 0.05/0.15 |
| `91_tease_position_swap` | titanic | 64.1 | 0.956 | 21/21 | 14% | 0.08/0.19 | 0.05/0.13 | 0.04/0.09 |
| `91_tease_position_swap` | bench | 58.1 | 1.008 | 21/21 | 22% | 0.06/0.11 | 0.05/0.12 | 0.05/0.12 |

Worst readings anywhere in the set: L2 mean 0.26 and L2 max 0.43, against
limits of 0.35 and 0.65; perceived balance stays inside 0.95-1.10 against a
0.90-1.11 window; the tightest balanced-frame count is 16/21 against a floor of
13. **Pairwise distinctness: closest pair 12.73**, against a floor of 1.5.

For contrast, the same L2 metric measured on patterns this wave deleted:
`15_tease_magnetic_poles` 0.75 mean / 0.84 max and
`01_tease_two_color_world_walk` 0.73 / 0.76 on the ship's long axis
(section 3.3).

### 7.3 The operating-point trap (found in central review)

`baby_color_contract` never calls `setControl`, and the WASM host initialises
every exported slider to **0.5** regardless of its declared initialiser. The
gates therefore judge every pattern at `level = 0.5`, while the show and the
gallery run at the playlist defaults (`level` 0.82-0.88). Tuning to the gate
alone would have shipped a set calibrated roughly 1.7x dimmer than reality.

So the whole set was measured a second time **at the real playlist defaults**,
driving each slider through `setControl`. Result: **all thirteen clean on both
rigs** - mean peak 35.7-128.0 against a 145 ceiling, designed black 11.2-37.2
percent against a 5-45 band, bright pixels 17.3-82.6 percent against an 8
percent floor, territory 0.93-1.10, perceived balance 0.925-1.086. The set is
valid at both operating points, not only the one the gate happens to use.

### 7.4 Two real defects caught in central review

Both were in **my own** reference pattern, and both had been reported green by
a harness that was itself wrong - which is the reason central re-validation is
not ceremony:

1. **The checking harness leaked VM state between passes.** It reused one
   compiled instance, so the Vintage and sign fixture review actually ran at
   clock 25-45 s instead of 0-20 s. `baby_color_contract` compiles a fresh
   instance per test and caught what the harness missed: `82_tease_checker_tide
   on titanic at 7.5s: Vintage 2979 needs >=2 pink heads`. Fixed by compiling a
   fresh instance for each pass, after which all thirteen were re-validated from
   scratch; the other twelve survived the corrected harness unchanged.
2. **A permanent pink bias hidden behind a per-frame gate.** In
   `82_tease_checker_tide` the rotating black separator head was
   `darkHead = headTick % 6`, whose own parity is `(headTick + headTick) % 2` -
   identically zero. The separator therefore ate a *blue* head on every single
   tick, pinning every Vintage fixture to a permanent 3 pink / 2 blue across 10
   percent of the rig. The per-frame ">= 2 of each" assertion passes happily on
   a standing 3/2 skew, so no gate would ever have reported it. Found by
   measuring Vintage family share over time across all thirteen patterns (skew:
   twelve sit at 0.93-1.05, this one at **1.21**) and fixed so the removed
   head's family alternates.

### 7.5 Boy / Girl

18 of 20 pass; the failing twin pair and its recommended disposition are in
section 4.2. Twin pairing is exact: 10 concepts, and every pair is
source-identical apart from its six `COLOR_*` constants.

### 7.6 Concurrent-writer tripwire

Re-checked at the end of the wave: **20 / 20 Boy and Girl sources byte-identical
to the session-start snapshot.** No foreign write landed during this session.

## 8. Gallery

Regenerated offline with the repo's own generator (`--scene titanic --playlist
baby_tease`, then `--index-only`). It publishes by atomically swapping the whole
directory, so the previous 15-look media is gone rather than left orphaned.

- `docs/pattern_gallery/playlists/titanic/baby_tease/` - 13 GIFs + 13 MP4s +
  `index.html` + `manifest.json`
- `docs/pattern_gallery/index.html` - rebuilt; Baby Tease now reads "13
  entries" and links.

**I inspected the media rather than trusting the numbers**, at 1, 5 and 9
seconds, across all three gallery views (two hull views plus both TE signs):

- A 13-tile hull montage at t = 1.5 s and again at t = 8.5 s: **not one entry
  reads as "one half pink, one half blue".** Every frame carries both families
  interleaved across the whole hull. That was the operator's complaint, and it
  is visibly gone.
- Full-resolution three-frame sheets for the three riskiest looks:
  `82_tease_checker_tide` (crisp interleaved board, tiles visibly changing
  family between frames, signs a clean pink/blue checker with black grout),
  `13_tease_rotating_yin_yang` (medallion lattice with counter-colour eyes and
  clear territorial change frame to frame), and `90_tease_star_exchange`
  (counter-colour gems - blue stars inside pink country and the reverse).

**One honest observation for Sina.** `90_tease_star_exchange` is by a clear
margin the dimmest entry: mean peak 35.7 at gate level and 59.4 at playlist
defaults, against roughly 100-128 for the rest. It is legitimate by design (a
sparse gem field over a dim country) and it clears every floor, but the mission
is "make the exterior highly visible at night", so it is the one entry whose
50-foot punch deserves an eye check on the rig. Raising its `level` default is
a one-number playlist edit.

Separately: the Baby Boy and Baby Girl galleries still rendered the **20 looks
per family that the concurrent writer had already cut to 10**, which failed two
gallery assertions. A gallery is derived media, not content, so both were
regenerated to match the playlists as they stand (10 looks each) and the
20-look originals were preserved at
`C:/Users/TITANI~1/tmp/baby_gallery_backup/` in case Sina reverses the cut
(section 4). Regenerating after a reversal is one command per family.

## 9. Restart / what the operator sees

**Nothing in this wave is live.** The engine loaded the pattern set at boot and
this wave deliberately restarted nothing — no launcher bounce, no engine
restart, no sim restart, no port bound at any point.

To see the rebuilt Tease set:

1. Bounce the launcher (bench arm-marker check first, per standing order).
2. In CaptainPad, load the `baby_tease` playlist on the deck.
3. Walk it from entry 1 (`Bullseye Tide`) to entry 13 (`Position Swap`) — the
   arc runs calm → curious → kinetic.
4. The eye test that matters, at fifty feet: **no entry may read as "one half
   pink, one half blue"**. Every one should show both families interleaved
   across the whole hull.
5. Judge the two authority constants on the rig. If pink still dominates the
   bars, the fix is `PINK_BAR_TRIM` (currently 0.80) in all 13 files; if pink
   reads weak overall, `PINK_TRIM` (currently 0.97). Never a per-pattern gain —
   that is the failure mode this redesign removed.

The offline gallery (§8) can be reviewed immediately, without any restart.

## 10. Files touched

**Patterns** (`marsin_engine/patterns/baby/`): 3 reworked (`10`, `12`, `13`),
10 created (`82`-`91`), 7 deleted (section 3.1).

**Data**: `simulation/scenes/titanic/playlists/baby_tease.yaml` and
`simulation/scenes/test_bench/playlists/baby_tease.yaml` (byte-identical),
`marsin_engine/tools/playlist_gallery/pattern_goals.json`,
`marsin_engine/patterns/manifest.json`.

**Tests**: `marsin_engine/tests/patterns/baby_tease_redesign_metrics.test.js`
(new - the L2 and section-9 gates plus the authority-block pin);
`marsin_engine/tests/patterns/playlist_gallery_tool.test.mjs` (one assertion -
it hardcoded the label of a pattern this redesign kills, so it now names the
playlist's current first entry).

**Docs and state**: `docs/72_baby_tease_pattern_redesign.md` (a note under D2
pointing at the D2 section here, so the design doc does not silently disagree
with the tree); `.agent/context/now.md` (its "Baby is exactly 20 Tease + 30 Boy
+ 30 Girl" line was stale on all three counts).

**Gallery**:
`docs/pattern_gallery/playlists/titanic/{baby_tease,baby_boy,baby_girl}/` and
`docs/pattern_gallery/index.html`.

**Not touched**, by instruction: Live Touch / touch_control, CaptainPad, engine
internals, the launcher, deployment, runtime state, Boy/Girl pattern *content*,
the Boy/Girl playlists, and the `baby_reveal` special event.

**Scratch, all outside the tree**: validation harness and landing script in
`C:/Users/TITANI~1/tmp/baby_check/`, contact sheets in
`C:/Users/TITANI~1/tmp/sheets/`, killed-source backups in
`C:/Users/TITANI~1/tmp/codex_baby_backup/`, 20-look gallery backups in
`C:/Users/TITANI~1/tmp/baby_gallery_backup/`, hash snapshots in
`C:/Users/TITANI~1/tmp/baby_snap/`.
