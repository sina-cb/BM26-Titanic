# Titanic Model Reference

This is the canonical geometry reference for model-aware Titanic pattern
authoring. Read it with
[`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md),
[`MARSIN_PB_LANG_SPEC.md`](MARSIN_PB_LANG_SPEC.md),
[`COLOR_THEORY.md`](COLOR_THEORY.md), and
[`AUDIO_SIGNALS.md`](AUDIO_SIGNALS.md).

The central rule is:

> A normalized coordinate is a location in the exported light cloud. It is
> not a promise that the ship is axis-aligned, symmetrical, equally dense, or
> sampled everywhere.

## 1. Quick orientation

### 1.1 Operator viewpoint and direction words

Direction words in this document always use one viewpoint: imagine a person
standing on the Titanic/deck and facing **FRONT**. **LEFT** is that person's
left, **RIGHT** is that person's right, **FRONT** is the end the ship points
toward, and **BACK** is the opposite rear end.

The current working model and Live Touch Spatial XY projection map those words
as follows. This mapping describes the existing geometry; it does not flip or
rewrite any coordinate:

| Operator direction | Raw world coordinate or membership |
|---|---|
| **LEFT** | positive world `X`; normalized `x >= 0.6575` for current Titanic pixels |
| **RIGHT** | negative world `X`; normalized `x <= 0.3861` for current Titanic pixels |
| **FRONT** | the named front regions; approximately world `+Z` on the RIGHT half and diagonal `+X,+Z` on the LEFT half |
| **BACK** | the named back regions; the reverse of the applicable half-local FRONT direction |
| **UP / DOWN** | world `+Y / -Y` |

There are no Titanic pixels in normalized `x` from `0.3861` to `0.6575`.
That empty middle band is about 27% of the normalized X span. A field centered
at `x = 0.5` can spend its strongest energy where no fixture exists.

### 1.2 Current runtime compatibility hazard

The working Spatial XY projection is spatially correct: painting or erasing at
an XY location reaches the matching pixels in the 3D model. Preserve that
projection. However, current scene group names and derived view strings were
created under an older side-label convention and are opposite to the operator
viewpoint above.

The following table is the only compatibility translation authors should need:

| Current code or data label | Actual current membership | Operator meaning |
|---|---|---|
| `inView("LEFT")`, scene names beginning `Left`, registry side value `"port"` | world `X < 0` | **RIGHT** |
| `inView("RIGHT")`, scene names beginning `Right`, registry side value `"starboard"` | world `X > 0` | **LEFT** |
| `inView("FRONT")`, names containing `Front` | front-region membership | **FRONT** |
| `inView("BACK")`, names containing `Back` | back-region membership | **BACK** |

This is a compatibility fact, not an authoring preference. Until the runtime
labels are migrated, physical-side intent must translate explicitly:

```javascript
// Current-runtime compatibility translation. Do not invert x or model data.
var onLeft = inView("RIGHT");
var onRight = inView("LEFT");
var onFront = inView("FRONT");
var onBack = inView("BACK");
```

Do not silently treat the current `LEFT` and `RIGHT` view strings as operator
directions. A runtime terminology migration must update scene names, derived
views, intent metadata, UI labels, tests, and this document together while
leaving pixel coordinates unchanged.

### 1.3 Pattern-author preflight

Before calling a Titanic pattern ready:

- Declare whether treatment is **uniform**, **mirrored**, or **deliberately
  asymmetric**. Unplanned absence is never asymmetry.
- Name every intended region. For whole-model work, account for all 24 current
  regions exactly once.
- Translate current runtime side labels using the compatibility table above.
- Use named membership for LEFT/RIGHT/FRONT/BACK staging; do not infer FRONT
  from one global axis.
- Check the empty X middle band and the isolated four-pixel stack regions.
- Use `fixtureType` for instrument role and `pixelLocalIndex` only inside one
  physical fixture.
- Test saved controls plus representative low and high values.
- Measure every intended region for both light and change; do not accept a
  static safety fill as coverage.
- Review a labelled four-wall diagnostic. The physical LEFT FRONT wall must
  not disappear, and neither may any other intended region.
- Run the model census and coverage gates described in section 8.

## 2. Authoritative sources and freshness

### 2.1 Source chain

Claims here are derived from current source data, never from screenshots:

1. Scene fixture placement and mapping:
   [`scene_config.yaml`](../simulation/scenes/titanic/scene_config.yaml),
   [`controllers.yaml`](../simulation/scenes/titanic/controllers.yaml), and
   [`patches.yaml`](../simulation/scenes/titanic/patches.yaml).
2. Semantic fixture views:
   [`views.yaml`](../simulation/scenes/titanic/views.yaml).
3. Exporter geometry, normalization, and local-index contract:
   [`pixelblaze_model_exporter.js`](../simulation/src/dmx/pixelblaze_model_exporter.js).
4. Generated engine model and view sidecar:
   [`titanic.js`](../marsin_engine/models/titanic.js) and
   [`titanic.viewmasks.js`](../marsin_engine/models/titanic.viewmasks.js).
5. Runtime coordinate and metadata packing:
   [`model_loader.js`](../marsin_engine/lib/model_loader.js),
   [`pixel_local_index.js`](../marsin_engine/lib/pixel_local_index.js),
   [`meta_abi.js`](../marsin_engine/lib/meta_abi.js), and
   [`wasm_host.js`](../marsin_engine/lib/wasm_host.js).
6. Derived membership and display orientation:
   [`auto_views.js`](../marsin_engine/lib/auto_views.js),
   [`pixel_map_view_defaults.js`](../simulation/src/gui/pixel_map/pixel_map_view_defaults.js),
   [`pixel_map_layout.js`](../simulation/src/gui/pixel_map/pixel_map_layout.js),
   [`pixel_map_views.yaml`](../simulation/scenes/titanic/pixel_map_views.yaml),
   [`cameras.yaml`](../simulation/scenes/titanic/cameras.yaml), and the shipped
   Live Touch source
   [`touch_control_wire.js`](ui/touch_control_wire.js).

The generated model is evidence, not an editing target. Change authoritative
scene data through its owning workflow and re-export it. Never edit model data
to make a coverage test pass.

### 2.2 Machine-readable truth

[`regions.mjs`](../marsin_engine/tools/titanic_model/regions.mjs) is the
machine-readable registry for exact scene-owned region identifiers, expected
pixel/fixture counts, fixture types, model bounds, and current FRONT axes.
`buildTitanicModelCensus()` derives current extents, sections, and local-index
ranges directly from `titanic.js` and fails loudly on registry/model drift.
The registry's current `side` metadata uses the legacy convention shown in the
compatibility table; it is not normative for operator LEFT/RIGHT wording.

The region tables in section 4 are a **derived human-readable snapshot** of a
fresh `buildTitanicModelCensus()` run, not a second source of truth. Freshness
is checked by running the census test and regenerating the JSON report in
section 9. A follow-up generator should emit the Markdown table from the same
census object so a future export cannot leave prose numbers behind.

## 3. Coordinate and orientation contract

### 3.1 Raw and normalized coordinates

The current 964 emitted light pixels occupy these raw world-coordinate bounds:

| Axis | Meaning | Current range | Span |
|---|---|---:|---:|
| `X` | global lateral component | `-50.318 .. 45.454` | `95.772` |
| `Y` | vertical; increasing is UP | `0.250 .. 14.900` | `14.650` |
| `Z` | global plan component; approximately FRONT-ward only on one half | `-26.379 .. 16.156` | `42.535` |

These are bounds of pattern-visible lights, not of the structural mesh. The
exporter normalizes each world axis independently over the complete light cloud
and rounds to four decimals:

```text
x = (raw_x - -50.318) / 95.772
y = (raw_y -   0.250) / 14.650
z = (raw_z - -26.379) / 42.535
```

`render3D(index, x, y, z)` receives these normalized values. Do not normalize
them again. Independent normalization removes physical aspect ratio. The raw
span ratio is `X:Z:Y = 95.772:42.535:14.650`, or approximately
`6.54:2.90:1.00`. For physical-distance math, scale normalized deltas by the
corresponding raw span before measuring:

```javascript
var dxPhysical = dx * 95.772;
var dyPhysical = dy * 14.650;
var dzPhysical = dz * 42.535;
var distance = sqrt(dxPhysical * dxPhysical
  + dyPhysical * dyPhysical
  + dzPhysical * dzPhysical);
```

### 3.2 FRONT/BACK are half-local

The two physical halves are rotated relative to one another. FRONT-ward is the
normalized direction from that half's back-wall centroid to its front-wall
centroid in the raw `X/Z` plane:

| Operator half | Current scene-name prefix | Unit FRONT vector `(X,Z)` | Geometry fact |
|---|---|---:|---|
| **RIGHT** | `Left` | `(-0.017985, +0.999838)` | nearly world `+Z` |
| **LEFT** | `Right` | `(+0.614702, +0.788759)` | diagonal in `+X,+Z` |

BACK-ward is the negative of the applicable vector. A global `z > threshold`
selects much of the physical RIGHT FRONT and can miss the physical LEFT FRONT
completely. Use exact front/back membership for discrete staging. For a
continuous longitudinal motion, project raw geometry onto the applicable
half-local vector and validate all four walls.

### 3.3 Supported display views

- **Live Touch Spatial XY, top plane:** uses the current normalized `x,z`
  geometry. Screen-right is `X+`; screen-up is `Z+`. That means operator LEFT
  appears on screen-right. This is an orientation choice, not a coordinate
  error; painting/erasing must continue to match the 3D model.
- **3D camera presets:** screen-left and screen-right vary by perspective.
  `Front`, `Side`, `Aerial`, and dramatic presets are review cameras, not
  pattern transforms.
- **Pixel Map Top:** world `+X` is screen-right and world `+Z` is screen-down
  in the saved operator layout. It may declare offsets or framing; it does not
  change runtime coordinates.
- **Pixel Map Front:** each current scene-named half is a separate panel. The
  projection is `X/Y`, with world `+Y` screen-up. It proves membership and
  output, not physical distance.
- **Pixel Map Side:** projection is `Z/Y`, with world `+Y` screen-up.
- **TE Sign:** each sign is fitted separately and rotated for legibility. The
  display rotation is not a pattern-space transform.
- **Offline galleries:** orientation must be labelled. A flattering camera is
  not acceptable evidence for named-region coverage.

## 4. Region census and topology

### 4.1 Instrument census

| Logical role | Runtime fixture role | Pixels | Physical fixtures | Topology |
|---|---|---:|---:|---|
| Hull Canvas | `FIX_BAR_18` | 360 | 20 bars | four walls; five 18-pixel bars per wall |
| Silhouette | `FIX_RAW_LED` | 320 | 8 strands | one 40-pixel strand per named region |
| Jewelry | `FIX_VINTAGE_6` | 96 | 16 rails | four 6-head fixtures per region |
| Organs | `FIX_PAR` | 40 | 40 pars | one pixel per fixture; region sizes differ |
| Identity | `FIX_TE_SIGN` | 148 | 4 fixture halves | two 74-pixel surfaces, each 40+34 pixels |

The roles sum to exactly 964 pixels. Density is not importance: one wall has
90 pixels while a small stack has four. A whole-model average can pass while
an entire visible feature is absent.

### 4.2 Per-region derived inventory

Names in the first column are exact current scene/runtime identifiers. They are
quoted for compatibility and must not be mistaken for operator LEFT/RIGHT.
Raw extents are `X / Y / Z`; normalized extents are `x / y / z`.

| Current scene/runtime region | Operator position | Pixels / fixtures | Export type | Raw extent `X / Y / Z` | Normalized extent `x / y / z` | Local index | Section |
|---|---|---:|---|---|---|---:|---:|
| `Right Front Wall` | LEFT FRONT | 90 / 5 | ShehdsBar | `21.943..31.999 / 2.953..10.495 / -5.974..1.942` | `0.7545..0.8595 / 0.1845..0.6993 / 0.4797..0.6658` | `0..17` | 556 |
| `Right Back Wall` | LEFT BACK | 90 / 5 | ShehdsBar | `12.648..22.805 / 2.860..10.155 / -17.853..-9.904` | `0.6575..0.7635 / 0.1782..0.6761 / 0.2004..0.3873` | `0..17` | 562 |
| `Left Front Wall` | RIGHT FRONT | 90 / 5 | ShehdsBar | `-27.925..-14.473 / 2.834..10.422 / 16.115..16.156` | `0.2338..0.3743 / 0.1764..0.6943 / 0.9990..1.0000` | `0..17` | 563 |
| `Left Back Wall` | RIGHT BACK | 90 / 5 | ShehdsBar | `-27.394..-14.464 / 2.956..10.182 / 1.109..1.146` | `0.2394..0.3744 / 0.1847..0.6780 / 0.6462..0.6471` | `0..17` | 561 |
| `Right_Front_Left` | LEFT FRONT | 40 / 1 | raw LED | `19.500..26.900 / 12.400..14.600 / -9.600..0.400` | `0.7290..0.8063 / 0.8294..0.9795 / 0.3945..0.6296` | `0..39` | 25 |
| `Right_Front_Right` | LEFT FRONT | 40 / 1 | raw LED | `28.600..33.600 / 2.100..12.600 / -11.300..-10.600` | `0.8240..0.8762 / 0.1263..0.8430 / 0.3545..0.3710` | `0..39` | 24 |
| `Right_Back_Left` | LEFT BACK | 40 / 1 | raw LED | `13.500..24.900 / 12.600..14.900 / -11.900..-7.100` | `0.6664..0.7854 / 0.8430..1.0000 / 0.3404..0.4533` | `0..39` | 22 |
| `Right_Back_Right` | LEFT BACK | 40 / 1 | raw LED | `27.200..27.600 / 2.100..12.700 / -18.100..-13.200` | `0.8094..0.8136 / 0.1263..0.8498 / 0.1946..0.3098` | `0..39` | 23 |
| `Left_Front_Left` | RIGHT FRONT | 40 / 1 | raw LED | `-31.500..-28.299 / 2.500..12.500 / 10.041..13.500` | `0.1965..0.2299 / 0.1536..0.8362 / 0.8562..0.9376` | `0..39` | 18 |
| `Left_Front_Right` | RIGHT FRONT | 40 / 1 | raw LED | `-25.500..-13.500 / 12.600..14.800 / 10.100..13.400` | `0.2591..0.3844 / 0.8430..0.9932 / 0.8576..0.9352` | `0..39` | 21 |
| `Left_Back_Left` | RIGHT BACK | 40 / 1 | raw LED | `-31.500..-28.000 / 2.000..12.500 / 4.000..7.500` | `0.1965..0.2330 / 0.1195..0.8362 / 0.7142..0.7965` | `0..39` | 19 |
| `Left_Back_Right` | RIGHT BACK | 40 / 1 | raw LED | `-25.400..-13.700 / 12.500..14.700 / 3.800..7.100` | `0.2602..0.3823 / 0.8362..0.9863 / 0.7095..0.7871` | `0..39` | 20 |
| `Right Front Rails` | LEFT FRONT | 24 / 4 | VintageLed | `22.974..30.327 / 6.287..11.840 / -7.618..-2.011` | `0.7653..0.8421 / 0.4121..0.7911 / 0.4411..0.5729` | `0..5` | 558 |
| `Right Back Rails` | LEFT BACK | 24 / 4 | VintageLed | `16.171..23.564 / 6.142..11.826 / -15.319..-9.354` | `0.6942..0.7714 / 0.4022..0.7902 / 0.2600..0.4003` | `0..5` | 566 |
| `Left Front Rails` | RIGHT FRONT | 24 / 4 | VintageLed | `-26.998..-17.286 / 5.836..11.588 / 13.536..13.796` | `0.2435..0.3449 / 0.3813..0.7739 / 0.9384..0.9445` | `0..5` | 565 |
| `Left Back Rails` | RIGHT BACK | 24 / 4 | VintageLed | `-26.582..-16.941 / 5.959..11.784 / 3.423..3.490` | `0.2478..0.3485 / 0.3897..0.7873 / 0.7006..0.7022` | `0..5` | 567 |
| `Right SmokeStacks` | LEFT, distributed | 8 / 8 | UkingPar | `20.620..25.873 / 6.462..9.807 / -11.653..-6.123` | `0.7407..0.7955 / 0.4240..0.6524 / 0.3462..0.4762` | `0` | 557 |
| `Right Small SmokeStack` | LEFT, outboard | 4 / 4 | UkingPar | `39.374..45.454 / 0.250 / -26.379..-20.299` | `0.9365..1.0000 / 0.0000 / 0.0000..0.1429` | `0` | 569 |
| `Right Auditorium` | LEFT, distributed | 8 / 8 | UkingPar | `13.409..19.166 / 12.541..12.565 / -6.780..0.452` | `0.6654..0.7255 / 0.8390..0.8406 / 0.4608..0.6308` | `0` | 559 |
| `Left SmokeStack` | RIGHT, distributed | 8 / 8 | UkingPar | `-24.742..-19.827 / 6.898..9.714 / 5.820..11.484` | `0.2671..0.3184 / 0.4538..0.6460 / 0.7570..0.8902` | `0` | 564 |
| `Left Small SmokeStack` | RIGHT, outboard | 4 / 4 | UkingPar | `-50.318..-42.318 / 0.500 / 4.624..12.624` | `0.0000..0.0835 / 0.0171 / 0.7289..0.9170` | `0` | 568 |
| `Left Auditorium` | RIGHT, distributed | 8 / 8 | UkingPar | `-13.353..-13.340 / 12.500 / 3.961..13.406` | `0.3860..0.3861 / 0.8362 / 0.7133..0.9353` | `0` | 560 |
| `TE Sign 2` | LEFT, local surface | 74 / 2 | TeSignV3A40 + TeSignV3B34 | `17.434..18.329 / 7.935..10.100 / -4.930..-3.624` | `0.7074..0.7168 / 0.5246..0.6724 / 0.5043..0.5350` | `0..39 / 0..33` | 415 |
| `TE Sign` | RIGHT, local surface | 74 / 2 | TeSignV3A40 + TeSignV3B34 | `-15.500 / 7.808..9.958 / 7.642..9.232` | `0.3636 / 0.5159..0.6627 / 0.7998..0.8372` | `0..39 / 0..33` | 3 |

### 4.3 Known gaps, density, and asymmetry

- The physical RIGHT front/back walls are almost constant-`Z` sheets. The
  physical LEFT walls are diagonal in `X/Z`.
- The physical RIGHT FRONT wall occupies `z ~= 1.0`; the physical LEFT FRONT
  wall occupies `z ~= 0.48..0.67`. A high-`z` FRONT mask is wrong.
- The normalized X dead band `(0.3861, 0.6575)` contains zero pixels. A center
  anchor, narrow ring, or brush centered there can miss the entire rig.
- The outboard small stacks sit at opposite global extrema and near the bottom
  of the exported Y range. A center-weighted field easily loses both.
- Hull bars sample surfaces densely; pars sample isolated landmarks. Brightness
  and coverage must be evaluated per region and physical role, not only by
  pixel count.
- No geometric mirror can be assumed between halves. Uniform energy intent can
  still sample differently; mirrored treatment needs an authored half-local
  transform.
- Each TE sign is two fixture halves. `pixelLocalIndex` resets at the seam.

### 4.4 Local-index walk behavior

`pixelLocalIndex` is zero-based and resets for every physical fixture. It is a
stable fixture-local walk, not a whole-region coordinate.

- **Bars:** every wall has five 18-pixel fixtures. On current scene names
  beginning `Left`, local `0 -> 17` moves mostly `X+` with a small `Y+` step;
  on names beginning `Right`, it moves mostly `X-` with small `Y+` and `Z+`
  steps. Fixture IDs are not a guaranteed bottom-to-top stack order.
- **Vintage rails:** every rail region has four 6-head fixtures. Local `0 -> 5`
  follows that fixture's exported physical walk; direction differs by region,
  so a region-wide sweep must combine local motion with geometry rather than
  concatenate fixture IDs.
- **Pars:** every par is one fixture and one pixel, so its local index is `0`.
- **Signs:** each 74-pixel sign is a 40-pixel fixture followed by a 34-pixel
  fixture. Local index resets from `39` to `0` at the seam.
- **Strands:** each named strand is one 40-pixel fixture. Current raw endpoints
  below are local `0 -> 39` and make the physical walk explicit.

| Current strand identifier | Operator position | Raw endpoint `0 -> 39` `(X,Y,Z)` | Dominant walk |
|---|---|---|---|
| `Right_Front_Left` | LEFT FRONT | `(19.5,12.4,0.4) -> (26.9,14.6,-9.6)` | `Z-` |
| `Right_Front_Right` | LEFT FRONT | `(33.6,2.1,-10.6) -> (28.6,12.6,-11.3)` | `Y+` |
| `Right_Back_Left` | LEFT BACK | `(13.5,12.6,-7.1) -> (24.9,14.9,-11.9)` | `X+` |
| `Right_Back_Right` | LEFT BACK | `(27.6,2.1,-18.1) -> (27.2,12.7,-13.2)` | `Y+` |
| `Left_Front_Left` | RIGHT FRONT | `(-31.5,2.5,13.5) -> (-28.299,12.5,10.041)` | `Y+` |
| `Left_Front_Right` | RIGHT FRONT | `(-13.5,12.6,13.4) -> (-25.5,14.8,10.1)` | `X-` |
| `Left_Back_Left` | RIGHT BACK | `(-31.5,2.0,4.0) -> (-28.0,12.5,7.5)` | `Y+` |
| `Left_Back_Right` | RIGHT BACK | `(-13.7,12.5,3.8) -> (-25.4,14.7,7.1)` | `X-` |

## 5. Runtime inputs

| Input | Actual meaning | Good use | Unsafe assumption |
|---|---|---|---|
| `x,y,z` | globally normalized exported coordinates | continuous fields, planes, aspect-corrected distances | equal physical scale, side-local FRONT axis |
| `index` | current global model-array index | guarded Titanic-specific sign mapping | portable identity after model reorder |
| `fixtureType` | canonical role id | capability staging by fixture family | region or physical side |
| `pixelLocalIndex` | physical pixel order inside one fixture | bar/strand sweeps, Vintage heads, seam-aware motifs | region position or continuous sign address |
| `fixtureId` | model-specific fixture id | deterministic per-fixture phase | portable taxonomy or contiguous order |
| `sectionId` | model-specific section id | narrowly declared Titanic-only logic | fixture role; values differ on test bench |
| `inView("Name")` | exact current authored/derived membership | region staging after compatibility translation | fuzzy matching or operator LEFT/RIGHT semantics |
| `viewMask` / `viewMaskHi` | implementation words backing views | compiler-emitted membership from `inView()` | stable hard-coded bits |

The model's `group` string is not a pattern-language builtin. It is exposed
through exact base views such as `inView("Right Front Wall")`. Composite views
include `Hull Canvas`, `Silhouette`, `Jewelry`, `Organs`, `Identity`, `Stacks`,
and `Auditoriums`. Derived views include the current compatibility strings
`LEFT`, `RIGHT`, `FRONT`, `BACK`, plus `Strands`, `TE Signs`, and role views
such as `@BAR`.

Use `inView()` for **where**, `fixtureType` for **what kind of instrument**,
coordinates for **continuous geometry**, and `pixelLocalIndex` for **motion
inside one physical fixture**.

## 6. Balance contracts

Every model-specific design must declare one:

- **Uniform treatment:** LEFT and RIGHT evaluate the same field and receive
  comparable energy intent. Topology may sample it differently.
- **Mirrored treatment:** one half's authored geometry is reflected into the
  other with matched timing and, if desired, opposite chirality.
- **Deliberately asymmetric:** the difference is part of the composition. Both
  halves and all intended regions remain named and reviewed.
- **Accidental omission:** an intended region has no meaningful lit or changing
  output because of mapping, density, indexing, or thresholds. This always
  fails review.

The pattern intent registry must say which contract applies and how each named
region participates. "The field did not happen to reach it" is not art
direction.

## 7. Whole-model authoring recipes

### 7.1 Start from declared regions

For whole-model work, begin with the machine registry's 24 exact current names
and declare every region once. Translate operator directions to the current
runtime names at the boundary; keep the rest of the pattern in operator terms.

```javascript
// Current runtime translation at one explicit boundary.
var onLeft = inView("RIGHT");
var onRight = inView("LEFT");
var onFront = inView("FRONT");
var onBack = inView("BACK");
```

Then evaluate the concept's geometry. If a sparse world-space feature can miss
a complete wall, give each relevant fixture a concept-specific local event,
not a generic constant wash:

```javascript
if (fixtureType == FIX_BAR_18) {
  var u = frac(pixelLocalIndex / 18.0 + phase + fixtureId * 0.61803399);
  var meridian = 1.0 - smoothstep(0.03, 0.10, abs(u - 0.5));
  brightness = max(brightness, meridian * 0.24);
}
```

This is wrong for whole-FRONT intent:

```javascript
var front = z > 0.85; // reaches physical RIGHT FRONT, misses physical LEFT FRONT
```

### 7.2 Uniform, mirrored, and asymmetric fields

- **Uniform:** apply the same energy envelope to `onLeft` and `onRight`, then
  measure per-region occupancy. Do not require byte identity from different
  topologies.
- **Mirrored:** construct a verified half-local lateral/longitudinal mapping.
  Do not use `1.0 - x` as an assumed mirror.
- **Deliberately asymmetric:** name both halves, state the difference, and keep
  nonzero meaningful participation on both unless the documented composition
  intentionally calls for a timed blackout.

### 7.3 FRONT-to-BACK and vertical motion

Use `FRONT` and `BACK` membership for discrete staging. For continuous motion,
project each half onto the FRONT vectors in section 3.2 and test all four wall
regions. `y` is safe for global DOWN-to-UP motion, but sparse pars and dense
walls sample it very differently.

### 7.4 Sparse roles and density-aware brightness

- Author intensity by physical role and fixture count, not pixel count.
- Keep broad hull material dimmer than sparse jewelry or organ punctuation.
- Move bounded cohorts through pars and Vintage heads. Never hash a four-pixel
  region into permanent winners and losers.
- Evaluate per-region fractions before whole-model averages.
- Preserve deliberate black intervals. A static baseline is not a valid fix
  for missing motion.

```javascript
// Wrong: a four-fixture region can lose every member forever.
var gate = frac(fixtureId * 0.61803399) < 0.18;

// Better: participation moves so every fixture receives a turn.
var cohort = floor(fixtureId + floor(phase * 8.0)) % 4.0;
var gate = cohort == 0.0;
```

### 7.5 Paired sign surfaces

Both signs must be complete, dynamic local compositions. The current export
places `TE Sign` at global indices `0..73` and `TE Sign 2` at `74..147`; each
is ordered as a 40-pixel fixture followed by a 34-pixel fixture:

```javascript
if (fixtureType == FIX_TE_SIGN) {
  var local74 = index % 74.0; // guarded Titanic export invariant
  var signPair = floor(index / 74.0) % 2.0;
  var localX = (local74 % 10.0) / 9.0;
  var localY = floor(local74 / 10.0) / 7.0;
  // One complete 2D field, with intentional pair variation.
}
```

This is model-specific. The census test must fail if sign ordering changes.
`pixelLocalIndex` alone cannot replace `local74` because it resets at the
40/34 seam.

## 8. Failure modes and the acid test

The acid test is operational: a pattern author following this document must
not miss the physical LEFT FRONT wall or any other named intended region. The
current physical LEFT FRONT wall is the compatibility region
`Right Front Wall`; the current `Left Front Wall` identifier is physical RIGHT
FRONT. Review and gates must make both visible by their operator directions.

The `ink_drops` missed-wall defect documented in
[`20260817_300_baby_tease_rebuild_implementation.md`](../.agent/reports/202608/20260817_300_baby_tease_rebuild_implementation.md)
is the exact failure class this contract must prevent: a plausible world-space
shape passed visual review while one wall fell outside the effective geometry.

Test all of these:

1. **World-space threshold:** high `z` reaches one FRONT wall but not the
   diagonal FRONT wall.
2. **Assumed symmetry:** `1-x` treats independently normalized, rotated halves
   as congruent.
3. **Side-label inversion:** current runtime `LEFT` is used as physical LEFT
   without the compatibility translation.
4. **Axis confusion:** `x` is used as FRONT/BACK progress because it separates
   the two halves.
5. **Empty-center composition:** energy is centered in the X dead band where
   no pixels exist.
6. **Sparse-extent loss:** a field misses one or both four-pixel small stacks.
7. **Permanent index mask:** a fixed `fixtureId` hash selects no member of a
   sparse region.
8. **Local/global mixing:** `pixelLocalIndex / 40` is treated as ship position.
9. **Dense-fixture dominance:** 360 wall pixels hide an absent four-par region
   in the whole-model average.
10. **Sign seam repeat:** the 40- and 34-pixel halves both redraw local row 0.
11. **Display-transform leakage:** UI framing, offsets, or camera orientation
    are mistaken for runtime geometry.
12. **Static safety fill:** a constant baseline hides missing motion and ruins
    intentional negative space.

## 9. Coverage gates

### 9.1 Current executable contract

The current implementation lives in
[`regions.mjs`](../marsin_engine/tools/titanic_model/regions.mjs),
[`coverage.mjs`](../marsin_engine/tools/titanic_model/coverage.mjs), and
[`titanic_model_coverage.test.mjs`](../marsin_engine/tests/patterns/titanic_model_coverage.test.mjs).
It currently runs the full pattern coverage contract for six Crisp keepers on
both `titanic` and `test_bench`, at saved controls and representative `0.2`
and `0.8` control scenarios.

| Gate | Current requirement |
|---|---|
| named-region census | all 24 exact identifiers; 964 total pixels; exact role/count/bounds/normalization invariants |
| declared intent | every gated pattern names every physical region exactly once and declares uniform, mirrored, or deliberate asymmetry |
| intended participation | at least 20% of every named region's pixels both ever light and change |
| whole-wall reach | at least 80% of each of the four wall regions ever light and change |
| black-space occupancy | mean wall lit-sample occupancy stays between 8% and 90% in each scenario |
| portable role truth | every `test_bench` group has at least 20% ever-lit and dynamic participation |
| uniform/mirrored balance | saved LEFT-wall versus RIGHT-wall mean occupancy differs by no more than 0.20 |
| deliberate asymmetry | both halves retain meaningful energy and the rationale names each region's treatment |

These thresholds prove reach and motion, not beauty. Endpoint color, fixture
heat, sign correspondence, continuity, performance, and output distinctness
still require their own contracts and visual review.

The current `test_bench` census is 166 pixels: `ParLights` 4, `VintageLights`
12, `BarLights` 36, `TE Sign` 74, `LED_0` 20, and `LED_1` 20. It is a portable
role check, not a geometric miniature of Titanic.

### 9.2 Required production-wide policy

Crisp-only coverage is not sufficient. Every production pattern family must:

1. own a machine-readable manifest of production patterns and region intent;
2. declare every intended Titanic region and one balance contract;
3. run the same named-region, four-wall, occupancy, and portable-role gates;
4. test saved and representative control values;
5. produce labelled wall evidence for visual review.

The concrete follow-up is to parameterize `coverage.mjs` over pattern-family or
playlist manifests, then enroll Baby and every other production family without
forking a second geometry vocabulary. No Baby source or family tests are
changed by this documentation task. The `ink_drops` miss proves why this is a
production requirement: the exact protective gate existed, but its family was
outside the gate set.

### 9.3 Offline validation commands

These checks do not start services or claim ports:

```powershell
cd marsin_engine
node --test tests/patterns/titanic_model_coverage.test.mjs
node tools/titanic_model_census.mjs --frames 160 --out "$env:TEMP/titanic_model_census.json"
```

## 10. Freshness and update procedure

When authoritative scene geometry or membership changes:

1. update the owning scene data and re-export the generated model/sidecar;
2. run `buildTitanicModelCensus()` and inspect every loud drift;
3. update the machine registry from authoritative evidence;
4. regenerate the derived region table and any sign/local-walk mappings from
   the same census output;
5. rerun Titanic and test-bench coverage at saved, low, and high controls;
6. regenerate and visually inspect labelled four-wall diagnostics;
7. verify the Live Touch Spatial XY projection still selects the matching 3D
   pixels without flipping coordinates;
8. update compatibility labels only as one coordinated runtime/UI/docs/test
   migration;
9. never lower a gate, add a fallback wash, or edit model data merely to keep
   a pattern green.

The long-term drift guard is one ownership chain: scene/export data ->
generated model -> machine census/region registry -> generated Markdown table
and coverage reports. Until the Markdown generation step is implemented, a
human-edited numeric table is not authoritative; the fresh census output wins.
