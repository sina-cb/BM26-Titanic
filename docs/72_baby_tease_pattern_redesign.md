# 72 — Baby Tease Pattern Redesign (implementation contract)

**Status:** Phase-1 DESIGN, ready for the implementation wave (report `_300`
reserved). Authored by the Baby Tease art-direction session (report
`.agent/reports/202608/20260817_299_baby_tease_redesign_audit_design.md`).
**Scope:** the 15 curated `baby_tease` patterns ONLY. Baby Boy / Baby Girl
patterns, playlists, and the reveal special event are out of scope and must
not change.

The operator's brief, verbatim core: *"Crisp separation does NOT mean
permanent bilateral segregation. Every pattern must spatially mix Baby Pink
and Baby Blue creatively while retaining sharp color identity. Do not make 15
variants of a left/right split."*


> **SUPERSEDED IN TWO PLACES BY REPORT `_305` (operator field review).** The
> keeper SET and every law here still stand, but two things in this document no
> longer describe the tree:
>
> 1. **File paths and numbers.** The thirteen keepers moved out of
>    `marsin_engine/patterns/baby/` into their own family directory
>    `marsin_engine/patterns/baby_tease/`, renumbered `01`-`13` in PLAYLIST
>    order. Read every `baby/NN_tease_<concept>` below as
>    `baby_tease/NN_<concept>` with the number from §7's arc:
>    `88→01 bullseye_tide`, `12→02 cellular_organism`, `90→03 star_exchange`,
>    `13→04 rotating_yin_yang`, `89→05 ink_drops`, `84→06 argyle_weave`,
>    `10→07 braided_rivers`, `82→08 checker_tide`, `85→09 candy_helix`,
>    `86→10 rail_exchange`, `83→11 carousel_sectors`, `87→12 counter_comets`,
>    `91→13 position_swap`.
> 2. **Every speed number in §5 and §8 is stale**, and **D3 is wrong**: the
>    legal global range is **g ∈ [0.25, 4.0]**, not `[0.25, 2.0]` — the engine's
>    knob is exponential, `0.25 · 16^speed` (`engine.js` createRenderLoop), so
>    max product is **8×** wall clock, not 4×. Ten of the thirteen keepers then
>    had their internal base rates rescaled by 1.15× to 14.4× onto the
>    operator's declared reference operating point (global SPEED 25,
>    `sliderLocalSpeed` 0.30). Per-pattern factors, the composition math and the
>    re-derived runaway table are in `_305`.

---

## 0. TL;DR for the implementation wave

1. **Kill 12 sources** (§6): `01,02,03,04,05,06,07,08,09,11,14,15` — all
   collapse to one thresholded plane with decorative wiggle = the same
   left/right split at 50 ft.
2. **Rework 3 survivors in place** (§5 K01–K03): `10_tease_braided_rivers`,
   `12_tease_cellular_organism`, `13_tease_rotating_yin_yang` (same files,
   same playlist entry ids).
3. **Author 10 new patterns** `82`–`91` (§5 K04–K13). Three of the riskiest
   skeletons are already **prototyped and harness-proven** (§Appendix A):
   checker tide, carousel sectors, argyle weave.
4. Every keeper uses the **canonical color/authority block** (§3) — the
   per-pattern pink-gain zoo (1.02×…9×) dies.
5. Rebuild playlist (both scenes, byte-identical, §7), `pattern_goals.json`,
   manifest, gallery; run the §10 gates and the two NEW offline checks
   (§2.3 anti-bilateral metric, §9 perceived-balance metric).

---

## 1. Audit of the current 15 (evidence)

Method: sources read line-by-line; gallery media regenerated offline from the
real model compiler at saved defaults
(`docs/pattern_gallery/playlists/titanic/baby_tease/`, digest-matched to the
current sources); 4-frame contact sheets inspected per pattern (t≈0.5, 3.5,
6.5, 9.5 s).

| # | Pattern | Owner-field skeleton | 50-ft read | Verdict |
|---|---|---|---|---|
| 01 | two_color_world_walk | `shipLong − plane(walk±0.03, bays±0.05)` | blue left / pink right, wiggly seam | **KILL** |
| 02 | port_starboard_tug | `shipWide fairPlane ± 0.08` | same split, other axis | **KILL** |
| 03 | crisp_quasifield | `shipLong plane ± 0.11 sinusoids` | same split | **KILL** |
| 04 | color_wells | two power-diagram wells, one per side | same split, curved seam | **KILL** |
| 05 | twin_lighthouse | fairPlane ± beam·0.07 (beams cosmetic) | mirrored split — "searchlights" invisible | **KILL** |
| 06 | corner_reservoirs | diagonal plane ± 0.10 | same split, diagonal | **KILL** |
| 07 | infinite_tug_of_war | `shipLong − boundary(±0.11)` | same split | **KILL** |
| 08 | boiling_opposites | fairPlane + 4 counter-bubbles | split; bubbles unreadable at distance | **KILL** |
| 09 | blue_entropy | `shipLong − front(±0.13)` | same split | **KILL** |
| 10 | braided_rivers | `sin(shipWide·2·2π + weave(±1.1))` lanes | alternating lanes that weave — **genuinely mixed** | **KEEP + rework** |
| 11 | folding_paper | fairPlane ± crease·0.06 (facets only dim lace) | mirrored split | **KILL** |
| 12 | cellular_organism | 8-cell Voronoi, interleaved families | pebble mosaic — **best of set** | **KEEP + rework** |
| 13 | rotating_yin_yang | `rotX + hooks(±0.27)` | split with S-seam; hooks too shallow, no eyes | **KEEP + deep rework** |
| 14 | traveling_compression_front | fairPlane + packet·0.14 texture | split + traveling texture | **KILL** |
| 15 | magnetic_poles | `balance·0.16 + (0.5−shipLong)·0.58` — plane term dominates 3.6× | same split, mild bend | **KILL** |

Root cause (mechanical, not taste): 12 of 15 compute
`field = (linear plane in ship frame) + (sinusoidal perturbations of 5–25 %
of the plane's dynamic range)` and threshold at 0. The perturbations can only
bend the seam, never move territory topology. The TE-sign branches replicate
the same bug locally: 12 of 15 sign arts are `signX − 0.5 ± wiggle` = a
vertical half split. Additionally the perceived-balance gains are ad-hoc and
contradictory per file: pink ×1.02…×1.32 (and ×(1.23+9·assist) on bars in 15)
while 03 boosts *blue* ×1.025 — despite the operator's observation that pink
already dominates the LED bars.

## 2. Composition laws (all keepers, enforced)

Inherited hard contract (unchanged, see `marsin_engine/patterns/baby/README.md`):
exact family RGB only, never interpolated; W=A=U=0; no
`colorPalette1/2` exports; both families every frame near 50/50 with only
brief feints; never pitch-black (≥10 % exact-family glow); ≥15 % of the rig
in the 20–65 byte dim band at defaults; mean frame peak ≤145/255; smokestack
ship frame for all world geometry; portable to `test_bench` (fixture branches
are refinements — the world path must carry the pattern alone).

New laws from this redesign:

- **L1 — No plane monoculture.** The owner field of a keeper may not be
  expressible as `monotone(planeCoordinate) + bounded wiggle`. Ownership must
  come from a *periodic, cellular, angular, radial, laned, or multi-body*
  structure so both families appear on both halves of every axis.
- **L2 — Anti-bilateral metric (offline gate).** From a 60 s default-speed
  capture (`tools/pattern_audio_harness.mjs`, silence synth, sample ≥2 Hz):
  for each axis h ∈ {shipLong, y, shipWide}, label pixels ±1 by
  `sign(h − 0.5)` and owners ±1 (pink/blue). Predictability
  `P_h(t) = |mean(owner · label)|`. Require **time-mean P_h ≤ 0.35** and
  **time-max P_h ≤ 0.65** for all three axes. (The killed set scores
  P ≈ 0.9–1.0 on its split axis; the three prototypes score ≈ 0.)
- **L3 — Family share.** Time-averaged owned-pixel share per family within
  **42–58 %**; instantaneous excursions ≤ 65 % (the existing feint bound).
- **L4 — Sign art is pattern-specific 2D art.** Each keeper's TE-sign
  treatment must be a miniature of its own skeleton (mini-checker, mini
  pinwheel, barber pole, …) on the full local 10×8 face — never a static
  half split. Both signs byte-identical by address (`index % 74`).
- **L5 — Vintage fixtures interleave locally.** Every six-head Vintage carries
  both families within the fixture at all times.
- **L6 — Motion is territorial.** The primary clock must move *ownership*
  (blades sweep, tiles flip, lanes trade, rings pass, drops grow), not only
  brightness texture. Visible ownership change within 10–25 s at defaults;
  visible brightness life within 1–3 s.
- **L7 — No wholesale rig swap.** Territory exchange travels spatially
  (fronts, wipes, orbits); at no frame does >65 % of the rig change family
  within 0.5 s.
- **L8 — One authority law.** Perceived pink/blue balance is controlled ONLY
  by the canonical block in §3 — no per-pattern gains.

## 3. Canonical constants and the authority block

Family colors (verbatim, unchanged): Baby Blue `(0.033, 0.450, 1.000)`,
Baby Pink `(1.000, 0.035, 0.360)`.

Ship frame (verbatim from the current set — all 12 smokestack pixels/side):
```
var SHIP_CENTER_X = 0.5219458333333333;
var SHIP_CENTER_Z = 0.5606541666666667;
var SHIP_AXIS_X = 0.7658426753447269;
var SHIP_AXIS_Z = -0.6430279905422711;
// per pixel:
var shipLong = 0.5 + (x - SHIP_CENTER_X) * SHIP_AXIS_X + (z - SHIP_CENTER_Z) * SHIP_AXIS_Z;
var shipWide = 0.5 + (x - SHIP_CENTER_X) * (-SHIP_AXIS_Z) + (z - SHIP_CENTER_Z) * SHIP_AXIS_X;
```

TE-sign local frame (verbatim convention): `signAddress = index % 74`,
`signX = (signAddress % 10) / 9`, `signY = floor(signAddress / 10) / 7`
(row 7 carries 4 px — include it in the art, weight it like any row).

**Authority block** — copy verbatim into every keeper (the ONLY balance
tuning surface; twin-diff spirit — identical across all 15 files):

```
var PINK_TRIM = 0.90;      // global Helmholtz–Kohlrausch compensation
var PINK_BAR_TRIM = 0.80;  // extra trim on FIX_BAR_18 only
var FLOOR_I = 0.14;        // never-black pre-level floor

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }

function emitBlue(v) {
  var k = max(FLOOR_I, min(1.0, v)) * liveLevel;
  rgbwau(0.033 * k, 0.450 * k, 1.000 * k, 0.0, 0.0, 0.0);
}

function emitPink(v) {
  var k = max(FLOOR_I, min(1.0, v)) * liveLevel * PINK_TRIM;
  if (fixtureType == FIX_BAR_18) k = k * PINK_BAR_TRIM;
  rgbwau(1.000 * k, 0.035 * k, 0.360 * k, 0.0, 0.0, 0.0);
}
```

Rationale: Rec.709 luma of unit-drive pink is 0.264 vs blue 0.401, but the
red-saturated pink family gains strongly from the Helmholtz–Kohlrausch effect
at night and **empirically dominates the LED bars** (operator observation —
ground truth). Trims are starting points calibrated against the prototype
renders; retune is a two-constant edit (decision D2). Implementation note: if
the VM rejects reading the `fixtureType` global inside a helper, hoist the
`PINK_BAR_TRIM` multiply to the FIX_BAR_18 call sites — behavior, not shape,
is the contract.

Fixture roles: Hull Canvas + Silhouette = the world field (silhouette
naturally samples its extremes — give it the pattern's boundary/edge
emphasis); **Jewelry** = `FIX_VINTAGE_6` local branch; **Organs** = the
smokestack PAR chains — no dedicated branch required, but each keeper states
how its world field makes the stacks read as rhythmic anchors; **Identity** =
`FIX_TE_SIGN` local branch.

Common clock law: advance phases only in `beforeRender`;
`dt = min(0.1, max(0.0, delta/1000))`; slider curve
`speedScale = 0.35 + clamp01(localSpeed) * 1.65` (0.35×–2.0×, never frozen);
wrap every phase at an **even integer** (or a documented period multiple) so
parity math survives the wrap; assume global speed scales `delta` by
g ∈ [0.25, 2.0] (decision D3). Runaway analysis per keeper in its block; the
common ceiling: at max product (2.0 slider × 2.0 global = 4× default rate) no
ownership front may cross a fixed point more often than once per 2 s, and no
per-frame angular step may exceed 0.02 of a period at 40 fps (no aliasing).

Silence gate: `baby_tease` keepers are fully autonomous — **no**
`AUDIO_MODULATION_V1` block; both clocks free-run, so silence and music look
identical by construction. Saved defaults must satisfy L6 (alive, not
frantic).

MFT parameter law (`.agent/memory` conventions): declaration order = knob
order; `sliderLocalSpeed` first; `sliderDirection` — when present — is the
**second** local param (binary: `< 0.5` reverse, `≥ 0.5` forward, default 1);
`sliderLevel` next; then at most one character slider. Playlist `defaults`
name exactly the exported sliders.

## 4. The keeper set (13)

| K | File | Entry id | 50-ft identity (one sentence) |
|---|---|---|---|
| K01 | `10_tease_braided_rivers` (rework) | `e_baby_tease_braided_rivers` | Pink and blue rivers run the length of the hull and braid around each other. |
| K02 | `12_tease_cellular_organism` (rework) | `e_baby_tease_cellular_organism` | A dozen soft pink and blue pebbles tile the whole ship and slowly trade places. |
| K03 | `13_tease_rotating_yin_yang` (deep rework) | `e_baby_tease_rotating_yin_yang` | Two interlocking hooks — each carrying the other color's eye — rock and breathe around the ship's heart. |
| K04 | `82_tease_checker_tide` (new, prototyped) | `e_baby_tease_checker_tide` | A giant pink/blue checkerboard whose tiles invert in a slow diagonal wave. |
| K05 | `83_tease_carousel_sectors` (new, prototyped) | `e_baby_tease_carousel_sectors` | A six-blade pinwheel of alternating pink and blue spins over the whole ship. |
| K06 | `84_tease_argyle_weave` (new, prototyped) | `e_baby_tease_argyle_weave` | Pink and blue diamonds slide across each other like woven ribbons. |
| K07 | `85_tease_candy_helix` (new) | `e_baby_tease_candy_helix` | A pink-and-blue candy-cane helix twists along the hull. |
| K08 | `86_tease_rail_exchange` (new) | `e_baby_tease_rail_exchange` | Stacked pink and blue rails stream in opposite directions and periodically trade lanes. |
| K09 | `87_tease_counter_comets` (new) | `e_baby_tease_counter_comets` | Pink and blue comets circle the ship in opposite directions over a dim woven lattice. |
| K10 | `88_tease_bullseye_tide` (new) | `e_baby_tease_bullseye_tide` | A pink-and-blue bullseye ripples outward from the heart of the ship. |
| K11 | `89_tease_ink_drops` (new) | `e_baby_tease_ink_drops` | Pink and blue ink drops keep blooming through each other. |
| K12 | `90_tease_star_exchange` (new) | `e_baby_tease_star_exchange` | Pink stars glitter inside blue country and blue stars inside pink country. |
| K13 | `91_tease_position_swap` (new) | `e_baby_tease_position_swap` | Two solid color masses slide the length of the ship and zip through each other to swap ends. |

Thirteen distinct mathematical skeletons: laned flow, Voronoi cells,
rotational interlock, lattice parity + wipe, angular sectors, stripe-duel
interference, helical angle, counter-flow lanes + trades, orbital bodies,
radial rings, growth fronts, sparse counter-color points, mass exchange.
No two share a family. (Room for 2 more if Sina wants 15 — decision D1.)

## 5. Keeper specifications

Shared elements are stated once in §3 and not repeated: authority block,
ship frame, sign frame, clock law, floors. `L` below = `liveLevel`.

### K01 — `baby/10_tease_braided_rivers` (rework in place)

- **Skeleton (kept):** lanes across the width:
  `riverField = sin(shipWide·2π·2 + lateralWeave)` with
  `lateralWeave = sin(shipLong·2π − currentClock·2π)·(0.30 + bend·0.88) + …`
  (as shipped). Owner = sign of `field`.
- **Rework directives:**
  1. Delete the `+ 0.03` constant bias in `field` (silently favors blue).
  2. Replace both emit helpers with the §3 authority block (drops the ×1.02
     pink gain).
  3. Raise default `currentBend` 0.60 → 0.66 and widen the weave term's
     second harmonic `0.18 → 0.24·liveBend` so crossings read at 50 ft.
  4. Keep the sign art (it is already a lane weave) but re-balance its seam
     threshold from `0.16` to `0.13` (the wide seams read as dead rows on the
     contact sheets).
- **Fixtures:** hull/silhouette = lanes; Vintage = alternating six-head braid
  (kept); Organs: the stacks sit near lane extremes — their chains alternate
  family with the weave and pulse on `currentClock` (no code change needed);
  signs = local 3-lane weave (kept, retuned).
- **Params (MFT order, defaults):** `sliderLocalSpeed 0.47`,
  `sliderLevel 0.84`, `sliderBraidWidth 0.54`, `sliderCurrentBend 0.66`.
- **Speed:** default current 0.065 Hz → lane crossing pattern repeats ~15 s;
  max product 4× → 3.8 s per arc, front speed ≈ 0.26 length/s — bounded, no
  aliasing (0.0065 cycle/frame at 40 fps).
- **Silence:** current + width clocks free-run (unchanged).

### K02 — `baby/12_tease_cellular_organism` (rework in place)

- **Skeleton (kept):** 8 anisotropic Voronoi cells with fixed interleaved
  families; membrane dim, nucleus highlight.
- **Rework directives:**
  1. Replace emits with §3 block; **delete** `pinkEnergyScale 1.32` and the
     `FIX_BAR_18 ×0.55` special-case (the bar trim now lives in the block).
  2. Raise center travel `push = 0.025 + livePush·0.075` →
     `0.035 + livePush·0.105` so cells visibly migrate (L6).
  3. Sign art: keep the 6-cell tissue, but drive the column warp from
     `bodyPhase` at ±0.09 (was 0.055) so cells visibly squeeze past each
     other on the sign.
- **Fixtures:** Vintage kept (3+3 with dim waist); Organs: stack chains land
  inside two different cells by construction — they read as two counter-color
  columns pulsing on `membranePhase`; signs per above.
- **Params:** `sliderLocalSpeed 0.42`, `sliderLevel 0.86`,
  `sliderCellPush 0.58`.
- **Speed:** body 0.043–0.078 Hz base; at 4× the fastest center oscillation
  is 0.31 Hz over a ±0.14 travel — cells wobble briskly but ownership fronts
  move ≤0.2 length/s. Safe.
- **Silence:** body + membrane clocks free-run.

### K03 — `baby/13_tease_rotating_yin_yang` (deep rework in place)

- **Problem:** hooks (±0.27 max) are shallow against the rotX plane → reads
  bilateral; no counter-color eyes, so no mixing.
- **Skeleton (new):** in the rotated frame (kept):
  `hooks = sin(rotZ·2π)·(0.14 + curl·0.16) + sin(rotZ·2π·2 − turnClock·2π·0.24 + y·2π·0.18)·(0.05 + curl·0.07)`
  `field = rotX + hooks`
  **Eyes (new, the yin-yang dots):** two ellipsoids at
  `E_pink = R(+0.20, +0.10)`, `E_blue = R(−0.20, −0.10)` in (rotX, rotZ),
  radius `0.11` (weights: rotX 1.0, rotZ 1.0, y 0.55): inside `E_pink` the
  owner is **pink regardless of field**, inside `E_blue` blue. Eye interiors
  get `0.55 + wave(breathClock·0.5 + y·0.3)·0.25`; a one-pixel-wide dim iris
  ring at the eye boundary.
- **Fixtures:** hull/silhouette = S-field + eyes; Vintage: two opposing
  3-head hooks (kept) **plus** the middle head of each trio flips to the
  opposite family (local eyes); Organs: stacks ride the crescent accent
  (kept `crescentRadius` highlight); signs: rocking S with both eyes on the
  10×8 face — `signField` as shipped, plus two r=0.14 eye discs at
  (0.32, 0.62) / (0.68, 0.38) in sign space, counter-colored.
- **Params:** `sliderLocalSpeed 0.40`, `sliderLevel 0.82`,
  `sliderCurlDepth 0.62`, `sliderTurnReach 0.48`.
- **Speed:** rock ±(0.08 + 0.46·turnReach) rad on a 0.0585 Hz clock —
  bounded rotation, no runaway by construction; 4× product → 0.23 Hz rock,
  max angular rate ≈ 0.8 rad/s at the extreme = blade-free (no thin
  features), acceptable; eyes orbit with the frame only.
- **Silence:** turn + breath clocks free-run.
- **Anti-bilateral note:** with A1 ≥ 0.14 the S reaches ≥0.55 of the ship
  width per hook and each side carries a counter-color eye → P_axis well
  under 0.35 (verify with L2).

### K04 — `baby/82_tease_checker_tide.js` (new — prototyped, Appendix A)

- **Skeleton:** ship-frame lattice
  `cellL = floor(shipLong·tilesL)`, `cellY = floor(y·2)`,
  `cellW = floor(shipWide·2)`, `tilesL = 3 + floor(grain·2)`;
  `baseParity = (cellL+cellY+cellW) % 2`;
  inversion wave `wavePhase = tideClock − (shipLong·0.85 + y·0.35)`
  (add 2.0 while negative), `flips = floor(wavePhase)`,
  `parity = (baseParity + flips) % 2` → the flip front is the level set
  `frac(wavePhase)=0`, a diagonal wipe that repaints the board into its own
  negative as it passes. Owner: parity 0 = blue.
  Dim art: tile grout `min(fl,1−fl,fy,1−fy)`-based at 0.18; tile interior
  shade `0.40 + wave(shimmer + cell hash)·0.22`; front ridge `0.92` when
  `frac(wavePhase) < 0.045` (the incoming color flashes its edge).
  `tideClock` wraps at 2.0 (parity-safe).
- **Fixtures:** hull/silhouette = the board; Vintage = 6-head mini checker
  with per-head staggered flips (prototyped); Organs: each 4-PAR stack chain
  spans ~one tile — it flips as a unit when the front passes = the
  metronome; signs = 5×4 mini-checker with the same wave (prototyped).
- **Params:** `sliderLocalSpeed 0.45`, `sliderLevel 0.86`,
  `sliderTileGrain 0.5` (3–5 tiles along the hull).
- **Speed:** default tide 0.055 → a tile hosts each family alternately every
  ~18 s; front crosses the ship in ~15 s. Max product: flip every 4.5 s,
  front speed 0.27 length/s. Bounded; flips are per-pixel crisp but arrive as
  a traveling front (L7 satisfied; never a full-board swap).
- **Silence:** tide + shimmer free-run.

### K05 — `baby/83_tease_carousel_sectors.js` (new — prototyped)

- **Skeleton:** top-plane polar frame:
  `ang = atan2(shipWide−0.5, shipLong−0.5)/2π + 0.5`,
  `u = ang·6 + spinSectors + scallop·6`,
  `scallop = sin(y·2π + breath·0.7)·(0.02 + scallopSlider·0.055)`;
  `sector = floor(u)`; owner = `sector % 2` (3 pink + 3 blue blades always).
  Blade seams dim at `frac(u) < 0.07 || > 0.93`; radial contour
  `wave(radius·2.1 − breathClock·0.42 + y·0.25)` shades blade depth; spoke
  lace dims thin moving arcs. `spinSectors` wraps at 12.0 (even → parity-safe).
- **Direction:** `sliderDirection` (2nd param) flips the sign of the
  `spinSectors` increment; on reverse, wrap at 0 by adding 12.0.
- **Fixtures:** hull/silhouette = blades sweeping bow→stern→bow; Vintage =
  rotating 6-head alternation (head parity advances with `spinSectors`,
  prototyped); Organs: each stack chain sits at a fixed bearing — blades
  crossing it produce a clean color metronome; signs = 4-blade local
  pinwheel spinning at `spinSectors/3` (prototyped).
- **Params:** `sliderLocalSpeed 0.45`, `sliderDirection 1.0`,
  `sliderLevel 0.86`, `sliderBladeScallop 0.55`.
- **Speed:** default 0.115 sectors/s → a blade passes a fixed point every
  ~8.7 s, full revolution ~52 s. Max product 0.46 sectors/s → pass every
  2.2 s (limit of the §3 ceiling), per-frame step 0.0115 sector — no
  aliasing. Bounded linear clock; no runaway.
- **Silence:** spin + breath free-run.

### K06 — `baby/84_tease_argyle_weave.js` (new — prototyped)

- **Skeleton:** two counter-sliding diagonal stripe systems dueling for
  ownership:
  `diagPink = (shipLong + y·0.85 + shipWide·0.20)·freq`,
  `diagBlue = (shipLong − y·0.85 − shipWide·0.20)·freq`,
  `freq = 1.1 + weaveScale·0.9`;
  `stripePink = sin((diagPink − pinkPhase)·2π)`,
  `stripeBlue = sin((diagBlue + bluePhase)·2π)`;
  owner = `stripePink > stripeBlue` → pink. Result: diamond fields sliding in
  opposite diagonals; every diamond is surrounded by the other family.
  Seam dim at `|stripePink − stripeBlue| < 0.24`; thread lace
  `|sin((diagPink+diagBlue …)·2π)| < 0.22` dims moving cross-threads.
  Phases wrap at 1.0.
- **Prototype tuning note (from Appendix A sheets):** at defaults the frames
  sit slightly dim — raise the winner term to
  `ownedLevel = 0.38 + clamp01(winner)·0.40` and cut the thread-lace duty to
  `< 0.16` so the mean peak lands in the 120–145 band.
- **Fixtures:** hull/silhouette = the weave; Vintage = 6-head two-frequency
  duel (prototyped); Organs: stacks alternate as the diamonds slide past
  their bearing (~9 s cadence at defaults); signs = same duel at `freq+0.7`
  (≈3 diamonds per face, prototyped).
- **Params:** `sliderLocalSpeed 0.45`, `sliderLevel 0.86`,
  `sliderWeaveScale 0.55`.
- **Speed:** phases 0.045/0.028 Hz (incommensurate) → composition period
  ~2 min, visible slide within 2 s. Max product 0.18 Hz — stripes cross a
  point every 5.5 s. Bounded.
- **Silence:** both phases free-run.

### K07 — `baby/85_tease_candy_helix.js` (new)

- **Skeleton:** cross-section angle
  `theta = atan2(y − 0.55, shipWide − 0.5)/2π + 0.5`;
  `turns = 1.6 + sin(breathClock·2π)·0.25`;
  `helixU = theta + shipLong·turns + twistClock`;
  `stripe = helixU − floor(helixU)`; owner = `stripe < 0.5` → pink, else
  blue (two half-period ribbons). Seam dim where
  `min(|stripe−0.0|, |stripe−0.5|, |stripe−1.0|) < 0.045` (black-cut ribbon
  separation at the ≥0.14 floor, per contract).
  Depth shading: `rad = sqrt((y−0.55)²·1.3 + (shipWide−0.5)²)`;
  `ownedLevel = 0.40 + wave(rad·2.0 − twistClock·0.8)·0.26`; sparkle lace
  `|sin((helixU·3 + rad·1.5)·2π)| < 0.18` → dim.
  `twistClock` wraps at 2.0.
- **Direction (2nd param):** flips `twistClock` increment (helix screws
  bow-ward vs stern-ward).
- **Fixtures:** hull = the barber pole; silhouette shows the ribbon edges
  crossing the outline diagonally; Vintage: `stripe(head/6·1.2 + twistClock)`
  → a two-color rotation around the six heads; Organs: each stack chain reads
  one ribbon phase — the four PARs light in sequence as the ribbon screws past
  (built-in metronome); signs: diagonal barber pole
  `helixU_sign = signY·1.5 + signX·0.4 + twistClock·1.4`, 2 stripes
  scrolling corner-to-corner.
- **Params:** `sliderLocalSpeed 0.46`, `sliderDirection 1.0`,
  `sliderLevel 0.86`, `sliderTwistBreath 0.5` (scales the `turns` breathing
  ±0.1…±0.4).
- **Speed:** default twist 0.024 cycle/s → ribbon advances one wrap ~42 s;
  ownership at a fixed point alternates every ~21 s. Max product 0.096
  cycle/s → alternation every 5.2 s; per-frame phase step 0.0024 — clean.
- **Silence:** twist + breath free-run.
- **Balance:** exact 50/50 by construction (half-period ribbons).

### K08 — `baby/86_tease_rail_exchange.js` (new)

- **Skeleton:** 4 horizontal lanes `r = min(3, floor(y·4))`.
  Lane inversion (per-lane checker-tide): schedule pairs — lanes {0,2} on
  phase A, {1,3} on B:
  `laneWave = tradeClock − shipLong·0.8 − (r % 2)·0.5` (add 2.0 while < 0),
  `flips = floor(laneWave)`, `parity = (r + flips) % 2` → owner
  (0 = blue). The flip arrives as a bow→stern wipe per lane; pairing keeps
  the instantaneous census at 2 pink + 2 blue lanes outside fronts.
  Flow life: pulse trains INSIDE each lane:
  `dir = (parity == 0) ? +1 : −1` (blue streams bow→stern, pink the other
  way), `pulse = wave(shipLong·2.2 − dir·flowClock + r·0.31)`;
  `ownedLevel = 0.30 + pulse·0.38`; lane-edge grout dim at
  `|frac(y·4) − 0.5| > 0.42`; front ridge bright 0.9 at
  `frac(laneWave) < 0.05`.
  `tradeClock` wraps at 2.0, `flowClock` at 10000.
- **Direction (2nd param):** flips both stream directions.
- **Fixtures:** hull = the four streaming rails; silhouette carries the lane
  edges as long dim rules; Vintage: 6 heads = 6 micro-lanes with alternating
  direction pulses; Organs: each stack chain crosses all lanes vertically —
  reads as a 4-step color ladder that re-stacks when a front passes; signs:
  4 mini-rails (`r_s = floor(signY·4)`) streaming with the same trade rule at
  1.6× phase rate.
- **Params:** `sliderLocalSpeed 0.46`, `sliderDirection 1.0`,
  `sliderLevel 0.86`, `sliderStreamDensity 0.5` (pulse spatial frequency
  1.6–3.0).
- **Speed:** flow 0.17 Hz default (pulses drift ~0.08 length/s); trade
  0.033/s → each lane pair inverts every ~30 s via a ~24 s traveling front.
  Max product: pulses 0.31 length/s, lane fronts every 7.5 s. Bounded.
- **Silence:** flow + trade free-run.

### K09 — `baby/87_tease_counter_comets.js` (new)

- **Skeleton:** four orbital bodies over a dim woven ground.
  Orbits in (shipLong, y) with shipWide bowing:
  pink heads at `aP = orbitClock·2π` and `aP + π` on
  `c = (0.5 + 0.34·cos(a), 0.5 + 0.22·sin(a), 0.5 + 0.18·sin(a·0.5 + 0.9))`;
  blue heads at `aB = −0.85·orbitClock·2π + 1.3` and `aB + π` (counter
  direction, incommensurate rate).
  Head field per body: `f = max(0, 1 − d/0.16)` with
  `d = sqrt(dL² + dy²·1.4 + dW²·0.8)`.
  Tail: in orbit-angle space, `lag = wrap(pointAngle − headAngle)` signed
  against travel; `tail = max(0, 1 − |lag|/0.9) · max(0, 1 − rDelta/0.10)`
  for lag behind the head only (`rDelta` = distance from the orbit ring);
  `bodyField = max(f, tail·0.55)`.
  Owner: `fPink = max(pink bodies)`, `fBlue = max(blue bodies)`;
  if `max(fPink, fBlue) > 0.12` → larger field wins,
  `ownedLevel = 0.34 + winner·0.55`; else ground lattice:
  `parity = (floor((shipLong+shipWide)·3) + floor((shipLong−shipWide+1)·3)) % 2`
  → dim basket weave `0.17 + wave(shimmer + parity)·0.07` (both families,
  static territory, all in the 20–65 byte band).
- **Direction (2nd param):** swaps the two orbit directions.
- **Fixtures:** hull/silhouette = comets + ground; Vintage: two bright chase
  heads (one per family) run around the six heads in opposite directions
  (`floor(orbitClock·6) % 6` and its counter-rotating mirror), remaining
  heads alternate dim; Organs: a stack flares (+0.25 for ~1 s) when a comet's
  `shipLong` passes its bearing — four beats per revolution; signs: one pink
  and one blue dot with 2-px tails counter-orbiting an ellipse over a dim
  4×3 mini-checker.
- **Params:** `sliderLocalSpeed 0.44`, `sliderDirection 1.0`,
  `sliderLevel 0.87`, `sliderCometSize 0.5` (head radius 0.11–0.22).
- **Speed:** default orbit 0.030 rev/s (33 s/lap; passes every ~9 s
  somewhere on the hull). Max product 0.12 rev/s = 8.3 s/lap — fast but the
  heads are 0.16-radius soft bodies, ≈0.26 length/s edge speed. Bounded.
- **Silence:** orbit + shimmer free-run.
- **Balance:** 2 bodies each; ground is 50/50 parity. Feints impossible
  (>65 % needs a body overlap the lattice can't produce).

### K10 — `baby/88_tease_bullseye_tide.js` (new)

- **Skeleton:** radial rings from the ship's heart:
  `r = sqrt(((shipLong−0.5)·1.15)² + ((y−0.52)·0.9)² + ((shipWide−0.5)·0.8)²)`;
  `ringU = r·(2.4 + ringSlider·2.0) + 8.0 − ringClock` (the +8 keeps it
  positive); `ring = floor(ringU)`; owner = `ring % 2` (0 = pink center
  epoch — alternates as rings pass). Ring seam dim at `frac(ringU) < 0.08`;
  crest bright `+0.22` at `0.45 < frac < 0.60`; interior
  `0.38 + wave(frac·1.2 + shimmer)·0.22`.
  `ringClock` wraps at 2.0 (parity-safe) — rings drift **outward** forever
  (a spring at the heart of the ship).
- **Fixtures:** hull/silhouette: rings cross the silhouette as expanding
  arches; Vintage: `dist = min(head, 5−head)`,
  `parity = floor(dist·1.6 + 2.0 − ringClock) % 2` → rings pass through each
  fixture; Organs: the stacks are the outermost shells — each ring's arrival
  at the stacks is the pattern's downbeat (brightness crest crossing the
  chains bottom-to-top); signs: mini bullseye centered (0.5, 0.5), 3 rings,
  same clock at 1.5×.
- **Params:** `sliderLocalSpeed 0.42`, `sliderLevel 0.85`,
  `sliderRingCount 0.5`.
- **Speed:** default 0.05 ring/s → a point alternates family every 20 s;
  crest travels ~0.015 r/s. Max product 0.2 ring/s → alternation every 5 s.
  Bounded (monotone phase, even wrap).
- **Silence:** ring + shimmer free-run.

### K11 — `baby/89_tease_ink_drops.js` (new)

- **Skeleton:** four nucleation sites, alternating families:
  `S0 = (0.24, 0.38, 0.42) blue`, `S1 = (0.72, 0.58, 0.62) pink`,
  `S2 = (0.42, 0.66, 0.30) blue`, `S3 = (0.58, 0.30, 0.72) pink`
  in (shipLong, y, shipWide). `phase = dropClock` (wrap 4.0);
  per site `age_k = wrap4(phase − k)`;
  radius `R_k = 0.62 · min(1, age_k/1.6)^0.65`.
  Owner: test drops **newest first** (smallest age); the first with
  `d_k < R_k` wins (d uses weights 1.0/0.9/0.9); if none covers, owner =
  the opposite family of the newest drop (the "old sea" it is invading).
  Growing rim: for the two newest drops, `|d − R| < 0.03` → bright 0.85;
  interior `0.36 + wave(d·3 − dropClock·0.7)·0.24`; elsewhere the old sea
  sits mostly in the dim band `0.20 ± lace`.
- **Fixtures:** hull/silhouette: blooms sweep them as expanding arcs;
  Vintage: drops expand alternately from head 0 (blue) and head 5 (pink),
  meeting mid-fixture; Organs: a stack chain lights bottom-to-top as a rim
  crosses it — one clean sweep per drop; signs: two alternating sites at
  (0.3, 0.35) / (0.7, 0.65), R capped 0.75, same aging rule.
- **Params:** `sliderLocalSpeed 0.43`, `sliderLevel 0.86`,
  `sliderDropReach 0.5` (R cap 0.5–0.74 — the conquest bound).
- **Speed:** default `dropClock` 0.045/s → a new drop every ~22 s, full
  growth in ~36 s, rims travel ≤0.03 length/s. Max product: drop every
  5.5 s, rim 0.12 length/s. Bounded; R cap keeps L3/L7 (no drop ever owns
  more than ~58 % before the counter-drop blooms).
- **Silence:** drop clock free-runs; rims are always alive.

### K12 — `baby/90_tease_star_exchange.js` (new)

- **Skeleton:** dim interlocked country + counter-color stars.
  Country: `p = sin((shipLong·1.1 + y·0.6)·2π·0.8 + patchClock·0.3·2π) +
  sin((shipWide·0.9 − y·0.5)·2π·0.7 − patchClock·0.21·2π)`;
  `patchOwner = p > 0` → blue else pink; brightness
  `0.20 + wave(p·0.8 + shimmer·0.4)·0.07` (large drifting blobs, both
  families, all dim band — this is the ≥15 % dim mass).
  Stars: per-pixel hash `h = s − floor(s)` with
  `s = sin(index·12.9898)·43758.5453`; star iff `h > 0.955` (≈4–5 % of
  pixels). **Star family = opposite of patchOwner at that pixel** (the
  counter-color law). Twinkle: `t = pow(wave(h·37 + twinkleClock·(0.5 + h)), 3)`;
  star level `0.35 + t·0.60`. A star whose patch flips (country drift)
  switches family WITH the patch — territory motion, not a rig swap.
- **Fixtures:** hull/silhouette: dim country + scattered gems; Vintage: five
  heads follow the fixture's patch family dim, one head
  (`floor(twinkleClock·0.7) % 6`) is the counter-color star at 0.8;
  Organs: one PAR per chain (rotating by `floor(twinkleClock·0.25) % 4`)
  carries the counter-color star — slow four-step ladder; signs: 8 fixed
  star addresses `{7, 16, 25, 33, 48, 57, 62, 71}` counter-colored over the
  sign's own two-blob dim country (same `p` formula in sign coords).
- **Params:** `sliderLocalSpeed 0.40`, `sliderLevel 0.88`,
  `sliderStarDensity 0.5` (hash threshold 0.97–0.93).
- **Speed:** patch drift 0.02 cycle/s (country reshapes over ~50 s);
  twinkles 0.5–1.5 s swells. Max product: country 12 s reshape — still calm;
  twinkle at 4× ≈ shimmer, never strobe (wave() is smooth, pow³ narrows but
  the base period ≥1.3 s at max).
- **Silence:** patch + twinkle free-run.
- **Contract note:** mean peak will sit LOW (sparse stars) — verify the
  ≥40-pixel-per-family floor via the country (trivially satisfied) and the
  animated floor via twinkles (peak delta ≈ 0.6·level·255 ≫ 40).

### K13 — `baby/91_tease_position_swap.js` (new)

- **Skeleton:** two equal soft masses exchanging ends through a zipper.
  Anchors `A = 0.26`, `B = 0.74` on shipLong (y center 0.5).
  `t = wave(swapClock)` (smooth 0→1→0); pink center
  `Pc = (A + (B−A)·t, 0.5 + 0.06·sin(swapClock·2π·2))`, blue center
  `Bc = (B + (A−B)·t, 0.5 − 0.06·sin(swapClock·2π·2))` — they pass at
  t = 0.5.
  `dP, dB` = weighted distances (shipLong 1.0, y 0.75, shipWide 0.6).
  `overlap = clamp01(1 − (dP + dB − |Pc−Bc|_L)·4)` — nonzero only in the
  crossing zone; `comb = sin(shipWide·2π·(1.8 + fingers·1.8) + y·2π·0.8)`;
  `field = (dB − dP) + comb·0.10·overlap`; owner = `field > 0` → pink.
  During the pass the seam shatters into interleaved vertical fingers across
  the width; away from the pass it is two clean masses.
  Brightness: `core = max(0, 1 − nearestD/0.34)`;
  `ownedLevel = 0.30 + core·0.50 + overlap·0.15`; trailing dim wake lace
  behind each mass (`wave(shipLong·2.4 − motion dir·swapClock·2π)`< 0.2 →
  dim).
- **Fixtures:** hull = the exchange; silhouette shows the two cores sliding
  the full outline length; Vintage: left trio vs right trio swap families
  via a per-head traveling flip synced to `t` crossing 0.5; Organs: stacks
  flare as a core passes their bearing (two beats per exchange); signs: two
  discs swapping horizontally across the face with a 3-finger zipper at the
  crossing (same comb rule in sign coords).
- **Params:** `sliderLocalSpeed 0.44`, `sliderLevel 0.87`,
  `sliderFingerCount 0.5`.
- **Speed:** `swapClock` 0.030/s → full there-and-back 33 s, one crossing
  every ~16 s; core speed ≤ 0.09 length/s default, 0.36 at max product —
  the fastest thing in the set, still under the 0.5 length/s ceiling.
- **Silence:** swap clock free-runs; wake lace keeps 1–3 s life.
- **Balance:** exact 50/50 by mirror symmetry at every t.

## 6. Kill list and removal operations

Remove these 12 sources from `marsin_engine/patterns/baby/` (they are tease
singles — no boy/girl twins reference them):

```
01_tease_two_color_world_walk.js   02_tease_port_starboard_tug.js
03_tease_crisp_quasifield.js       04_tease_color_wells.js
05_tease_twin_lighthouse.js        06_tease_corner_reservoirs.js
07_tease_infinite_tug_of_war.js    08_tease_boiling_opposites.js
09_tease_blue_entropy.js           11_tease_folding_paper.js
14_tease_traveling_compression_front.js  15_tease_magnetic_poles.js
```

Also: delete their 12 `pattern_goals.json` entries; regenerate
`marsin_engine/patterns/manifest.json` from disk (registry generator);
remove their 12 playlist entries from BOTH scenes' `baby_tease.yaml`;
regenerate the baby_tease gallery (old media disappears with the manifest).
Numbers 01–09, 11, 14–15 are retired — do NOT renumber anything (per the
baby README, numbers grow in blocks; new work took 82–91).

## 7. Playlist (both scenes, byte-identical)

Order is the show arc calm → curious → kinetic:

| # | entry id | pattern | defaults (exactly the exported sliders) |
|---|---|---|---|
| 1 | `e_baby_tease_bullseye_tide` | `baby/88_tease_bullseye_tide` | localSpeed 0.42, level 0.85, ringCount 0.5 |
| 2 | `e_baby_tease_cellular_organism` | `baby/12_tease_cellular_organism` | localSpeed 0.42, level 0.86, cellPush 0.58 |
| 3 | `e_baby_tease_star_exchange` | `baby/90_tease_star_exchange` | localSpeed 0.40, level 0.88, starDensity 0.5 |
| 4 | `e_baby_tease_rotating_yin_yang` | `baby/13_tease_rotating_yin_yang` | localSpeed 0.40, level 0.82, curlDepth 0.62, turnReach 0.48 |
| 5 | `e_baby_tease_ink_drops` | `baby/89_tease_ink_drops` | localSpeed 0.43, level 0.86, dropReach 0.5 |
| 6 | `e_baby_tease_argyle_weave` | `baby/84_tease_argyle_weave` | localSpeed 0.45, level 0.86, weaveScale 0.55 |
| 7 | `e_baby_tease_braided_rivers` | `baby/10_tease_braided_rivers` | localSpeed 0.47, level 0.84, braidWidth 0.54, currentBend 0.66 |
| 8 | `e_baby_tease_checker_tide` | `baby/82_tease_checker_tide` | localSpeed 0.45, level 0.86, tileGrain 0.5 |
| 9 | `e_baby_tease_candy_helix` | `baby/85_tease_candy_helix` | localSpeed 0.46, direction 1, level 0.86, twistBreath 0.5 |
| 10 | `e_baby_tease_rail_exchange` | `baby/86_tease_rail_exchange` | localSpeed 0.46, direction 1, level 0.86, streamDensity 0.5 |
| 11 | `e_baby_tease_carousel_sectors` | `baby/83_tease_carousel_sectors` | localSpeed 0.45, direction 1, level 0.86, bladeScallop 0.55 |
| 12 | `e_baby_tease_counter_comets` | `baby/87_tease_counter_comets` | localSpeed 0.44, direction 1, level 0.87, cometSize 0.5 |
| 13 | `e_baby_tease_position_swap` | `baby/91_tease_position_swap` | localSpeed 0.44, level 0.87, fingerCount 0.5 |

`notes:` per entry = the 50-ft identity sentence from §4 (also the
`pattern_goals.json` line). `modulations: []`, `midiMappings: []` throughout.
The three surviving entry ids keep their positions in CaptainPad state; the
SPECIAL EVENT arms the playlist as a whole (rotation cadence is show data in
`baby_reveal.yaml`, untouched).

## 8. Speed & runaway summary

Common: `speedScale = 0.35 + s·1.65`; global g assumed ∈ [0.25, 2.0] (D3);
max product 4× default. Wraps on even integers preserve parity. Per-keeper
worst-case at 4×: fastest ownership-front crossing of a fixed point —
K05 2.2 s, K13 ~4 s core pass, K08 5 s pulses / 7.5 s fronts, K04 4.5 s
flips, K10 5 s ring, K06 5.5 s stripes, K07 5.2 s ribbon, K09 8.3 s lap,
K11 5.5 s drop, K12 country only (12 s), K01–K03 ≥4 s. All ≥ the 2 s
ceiling; none strobes; no clock is unbounded or acceleration-coupled.

## 9. Perceived-balance verification (the concrete rule)

Perception model (documented so the numbers are auditable): unit-drive
Rec.709 luma — pink 0.264, blue 0.401; night-time Helmholtz–Kohlrausch
factors — saturated red-pink ×1.75, blue ×1.05 → perceived weights
**w_pink = 0.46, w_blue = 0.42** per unit drive. The operator's field
observation (pink dominates the bars) is the ground truth these factors
encode.

Offline check (impl wave adds it next to the L2 metric, same 60 s capture):
`S_f(t) = Σ_pixels∈f max(R,G,B)_byte · w_f` over emitted (post-trim) bytes.
Require `mean_t(S_pink/S_blue) ∈ [0.90, 1.11]` per pattern, whole rig AND
bars-only. The §3 trims (0.90 global, ×0.80 bars) are the only knobs; if the
rig-side eye test disagrees, retune the two constants once, globally (D2) —
never per pattern.

## 10. Implementation wave — files, gates, evidence

Touch list:
- `marsin_engine/patterns/baby/`: −12 (§6), rework 3 (§5 K01–K03), +10
  (`82…91`, §5 K04–K13).
- `marsin_engine/patterns/manifest.json` — regenerate.
- `simulation/scenes/titanic/playlists/baby_tease.yaml` +
  `simulation/scenes/test_bench/playlists/baby_tease.yaml` — §7,
  byte-identical (hash-verify).
- `marsin_engine/tools/playlist_gallery/pattern_goals.json` — −12/+10 lines.
- `docs/pattern_gallery/playlists/titanic/baby_tease/` — regenerate
  (`generate.mjs --playlist baby_tease`, then `--index-only`).
- NEW offline checks (suggest `marsin_engine/tests/patterns/`):
  L2 anti-bilateral + §9 balance over harness captures at defaults.

Gates (all must be green before merge-ready is claimed):
```
cd marsin_engine
node --test tests/patterns/baby_color_contract.test.js
node --test tests/patterns/playlist_gallery_tool.test.mjs
cd ../simulation && node --test tests/pattern_manifest.test.js
```
plus the L2/§9 checks and a fresh gallery whose contact sheets a reviewer can
tell apart blind (the §4 one-sentence test).

Evidence to hand back: regenerated gallery, per-keeper 4-frame contact
sheets, the L2/L3/§9 numbers in a table.

Prototype code may be lifted: the three Appendix-A files are engine-idiom
compliant but are **prototypes** — apply §3's canonical block (they carry an
inline 0.90 pink trim without the bar term), the §5 tuning notes, and the
direction slider before landing.

## 11. Open decisions for Sina (D1–D8)

- **D1 — Keeper count.** 13 designed. Want 15? Two shelved candidates:
  "corner quilt" (four corner-anchored quilted quadrants trading patches)
  and "braided columns" (vertical braid = K01 rotated 90°). Both are weaker
  than the 13 — recommendation: ship 13.
- **D2 — Authority constants.** `PINK_TRIM 0.90`, `PINK_BAR_TRIM 0.80`
  (§3/§9). Approve as starting values; one on-rig eye pass may retune the
  two constants globally.
  > **SHIPPED VALUE DIFFERS: `PINK_TRIM` is `0.97` in the tree.** The `_300`
  > implementation wave measured that `0.90` cannot satisfy §9 and the
  > `baby_color_contract` authority gate at the same time — the §9 weights
  > already carry the Helmholtz–Kohlrausch compensation, so a 0.90 trim on
  > top double-counts it. Rationale, numbers, and the counterfactual are in
  > `.agent/reports/202608/20260817_300_baby_tease_rebuild_implementation.md`
  > §"D2". `PINK_BAR_TRIM` ships at `0.80` as specified.
- **D3 — Legal global-speed range.** Analysis assumes g ∈ [0.25, 2.0].
  Confirm the CaptainPad clamp; if g can exceed 2.0 the §8 ceilings need one
  more pass.
  > **ANSWERED, AND THE ASSUMPTION WAS WRONG (`_305`).** There is no CaptainPad
  > clamp: the GLOBALS SPEED fader writes the ParamCenter `speed` key over its
  > full `[0, 1]` range, and `engine.js` maps it
  > `multiplier = 0.25 · (4.0/0.25)^speed`. So **g ∈ [0.25, 4.0]** and the max
  > product against the 2.0 slider ceiling is **8×**, double what §8 assumed —
  > every "max product 4×" figure in §8 is optimistic by a factor of two. The
  > re-derived table is in `_305`.
- **D4 — Yin-yang survivor.** K03 is the weakest keeper even reworked
  (rock-and-breathe is gentler than its neighbors). Keep (recommended — the
  set needs calm entries) or kill and promote a D1 candidate?
- **D5 — Playlist arc order** (§7). Approve or reorder.
- **D6 — Direction sliders** on K05/K07/K08/K09 (2nd MFT knob per the
  param-order law). Approve, or drop for uniform 3-slider layouts?
- **D7 — Bright-front accents.** K04/K08/K11 flash a 0.85–0.92 rim at their
  fronts (crisp, but raises mean peak). Keep the accent or cap at 0.80?
- **D8 — Star addresses** (K12 signs): the 8 listed addresses are chosen for
  spread on the 10×8 face; veto/replace freely — they are data, not law.

## Appendix A — prototype evidence (offline, harness-proven)

Rendered with the real model compiler + gallery projection at saved
defaults, silence synth, 10 s / 8 fps, `GATE_PASS` (animated + floor gates)
on all three:

- `~/tmp/baby_proto/proto_carousel_sectors.js` → `vid_carousel_sectors.mp4`,
  `sheet_carousel_sectors.png` — blades sweep; both families on both halves
  in every frame; signs pinwheel.
- `~/tmp/baby_proto/proto_argyle_weave.js` → `sheet_argyle_weave.png` —
  diamonds slide; fully interleaved; slightly dim at defaults (tuning note
  in K06).
- `~/tmp/baby_proto/proto_checker_tide.js` → `sheet_checker_tide.png` —
  mosaic parity flips travel as a front; signs mini-checker works.

Contact sheets for the CURRENT 15 (audit evidence) were regenerated into the
tracked gallery; the session's per-pattern sheets live in the session
scratchpad (paths in report `_299`).
