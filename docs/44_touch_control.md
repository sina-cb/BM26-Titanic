# 44 — TOUCH CONTROL

The operator surface for driving the ship **by hand**, live. The tuned
instrument remains `docs/ui/touch_control.html` (geometry + rendering) with
`docs/ui/touch_control_wire.js` (engine transport), served by the sim and
embedded in CaptainPad as **Layers → Live Touch**. CaptainPad owns navigation
and theme chrome; the iframe keeps the instrument geometry and gestures.

Everything here is a manual override of whatever the automatic system is
doing, so the document is organised around the two questions that actually
decide the layout:

1. **What can the engine physically be told?** (§2 — the hard constraints)
2. **What must never be left behind when the operator walks away?** (§5 — the
   failsafe model)

This doc exists partly to get a **second opinion on the layout**. §7 lists the
open design questions honestly, including the ones where the current answer is
a compromise rather than a good idea.

---

## 1. What the surface is

One page, five panels — METER (live audio traces), COLOUR (wheel + 5 slots +
scheme generators), SPATIAL/XY, EFFECTS, GROUPS (24 fader cards + presets).
The SPATIAL/XY panel, the one this doc mostly concerns:

```
┌──────────────────────────────────────────────────────────────┐
│ SPATIAL / XY                        [XY MODE | SPATIAL MODE] │
│  VIEW [TOP / FRONT / STRANDS / SIGN]              [PAN][FIT] │
│  Y AXIS (WALK·STROBE) │ TAKE (REC·PLAY·LOOP·CLR)             │
│  SIZE chips           │ POWER chips                          │
│  FADE chips           │ STEP chips                           │
│  ON TIME chips        │ SPEED chips                          │
│ D ┌────────────────────────────────────────────────────┐ I   │
│ R │       generated canonical pixel view, centered FIT │ N   │
│ A │       exact pixel identities, display-only PAN     │ K   │
│ W └────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

DRAW (POOL·TRAIL·ERASE·IGNITE) and INK (ONE·MASTER·HUE·COMP·CLASH) run as
vertical columns flanking the pad. **XY mode**: X drives the transient Live
Touch master factor, rescaled into **[0.05, 1]** — dim at the far left, never
dark; the Dimmer Rack ceiling still wins. Y drives the
strobe rate or the group walk (operator-selectable), both exponential, bottom
4% = off. **SPATIAL mode**: the pad is a per-pixel paint surface driving the
lease-owned `/spatial-paint` stage, which works on **every** Live pattern. Up
to ten fingers paint as one bounded request per frame, with an independent
sweep origin per finger so touches never draw lines between each other. FULL
expands the panel to the entire Live Touch viewport and is available only in
SPATIAL mode; switching to XY or pressing Escape exits it. TAKEs record
a gesture with its timing and replay/loop it; presets capture the whole panel
(schema v3).

Everything is gated behind a master **ARM** switch. Opening the tab is passive.
Arming declares a **deadman lease** over `/ws/control`, stages the isolated
Live pattern, atomically prepares its owner-local state through
`POST /layers/live_touch/prepare`, then activates `live_touch` through the same
100 ms Layers blend used by Deck and Mixer. `ARMED` appears only after the
landing readback.

---

## 2. The hard constraints (read this before proposing a layout)

These are not preferences. Each was verified against the running engine or the
model, and each one closes off a design that looks obvious on paper.

### 2.1 The engine has exactly TWO colour parameters
`colorPalette1` and `colorPalette2`. There is no `colorPalette3..5`. Any
"five colours" surface is therefore a client-side fiction that has to be
projected onto two engine slots, or onto something else entirely.

- Slots 1–2 write the real CPC params and colour every pattern.
- Slots 3–5 have **no shared engine home**. They reach a pattern only through
  per-pattern local sliders (`sliderHue3/4/5`, `sliderVal3/4/5`), declared by
  `128_five_colour_prism`, `129_five_colour_stations`, and
  `130_spatial_paint`. On any other pattern those three slots do nothing.

### 2.2 Patterns INTERPOLATE between the two palette slots
A pattern given cp1 = 116° and cp2 = 188° paints every hue in between across
the model. So "pick a colour and see that colour" is only true when both slots
hold it. This is why CYCLE writes the *same* colour to both slots.

### 2.3 Group colour is a FLAT OVERWRITE — painted groups go STATIC
`PUT /group-fixed-colors/:group` sets `px.r = c[0] * b` for every pixel in the
group, discarding the pattern's contribution. It is applied after macros, so it
also covers tracers on that group. A group holding a fixed colour **stops
animating** until the colour is cleared.

This is the single most important trade-off on the surface: it is the only way
to put different colours on different parts of the ship simultaneously, and it
costs all motion on those parts.

### 2.4 Dimmer Rack is the brightness authority
The Dimmer Rack's section value is a hard ceiling. Live Touch cannot write
`/section-brightness` or Mixer master. Its master and group faders write
revisioned, lease-owned factors through `/touch-control/brightness`; the engine
applies `rack ceiling × Live master × Live group`. Thus a Live fader at 100%
under a rack group at 30% produces at most 30%, and disarm drops the transient
factors without changing the rack.

The Groups profile selector is only a control projection over those same 24
factors. **Individual groups** preserves the full bank. **Show instruments**
uses the authored Hull Canvas, Silhouette, Jewelry, Organs, and Identity views.
**Performance planes** uses the derived Front/Back views plus Organs and
Identity. The engine publishes each view's exact full-group and partial-group
memberships; the client accepts only non-overlapping, group-complete profiles
that partition all 24 groups. A broader view displays `MIX` when its underlying
groups differ, and moving it intentionally unifies those members at the new
level. Switching profiles never changes a level by itself.

### 2.5 The ship has a 25% dead band on X, and it runs diagonally
Measured on `models/titanic.js` (964 pixels):

```
nx 0.40 .. 0.65   ZERO pixels        (the empty middle of the ship)
Left  groups      nx 0.04-0.39,  nz 0.65-1.00
Right groups      nx 0.69-0.97,  nz 0.07-0.57
```

A screen-aligned (nx, nz) pad is **73.6% dead** (38 of 144 cells contain any
pixel), and "left to right" cuts diagonally across the hull rather than running
bow-to-stern. Any spatial surface must rectify this or it will feel broken.

The sim supplies the canonical fixture membership, styling, projection, and
resolved design coordinates. Live Touch serializes those exact resolved glyphs
without a second geometry pass, then uniformly fits the same design to 92% of
the available pad. The shipped Top view has no per-fixture offsets, gap
compression, pitch stretching, or perspective; runtime PAN remains display-only.

### 2.6 The sim's generated 2D view is canonical
Live Touch loads `docs/ui/touch_control_pixel_views.json`, generated from the
same YAML, camera source, and resolver as the main views. Schema 4 stores the
simulator resolver's exact glyph coordinates. It verifies every source hash and
compares each live engine pixel identity and coordinate before ARM. Top contains
720 pixels, including all 16 auditorium uplights. Top and Strands address
`(nx,nz)` with `Z+` ship-forward/down-screen as seen from Aerial, Front addresses
`(nx,ny)`, and the rotated TE Sign addresses screen-horizontal `nz` plus
screen-vertical `ny`. Front displays 396 Front glyphs but sends an exact
792-identity Front+Back paint mask so the stroke mirrors onto the hidden face.
Every mask is validated, unique, and in range. View or mask changes lift the
brush and clear its owner-local heat so hidden-view paint cannot leak. PAN
changes screen coordinates only; pixel identity and world coordinates are
unchanged.

### 2.7 Live colour at full resolution is not on the wire
The `vis` WS topic is subsampled to 100 px/strip at 5 Hz with no index→group
mapping. A faithful animated mirror of the rig is **not possible** over the
current API. A static map is.

### 2.8 Live effect slots are session-local
The engine seeds an in-memory Live creative context when the ARM lease lands.
Owner-tagged effect-slot requests read and mutate that context, never the
durable Deck/Mixer/global slot table. Touch Control still provisions slots ≥ 9
to preserve the established panel layout and hardware numbering.

### 2.9 Live brightness has one isolated, revisioned path
Direct changes use `PATCH /touch-control/brightness`; preset dips use
`POST /touch-control/brightness/master/fade`. Both affect only the armed Live
setting, are rejected without its owner lease, and remain subordinate to the
Dimmer Rack. Deck/Mixer master state is untouched.

### 2.10 There is no "auto system" outside the festival window
The timeline plan declares a festival window; outside it `_inFestivalWindow()`
is false, the service goes dormant, and `POST /timeline/resume` is a silent
no-op. "Revert to auto" only means something inside the window.

---

## 3. What each control does

| Control | Writes | Notes |
|---|---|---|
| Colour wheel | `colorPalette1/2` (`POST /param-center`) | Or ONE group, when a group is focused (§4) |
| Colour fade | `colorTransitionMs` | Engine-side perceptual (OKLab) crossfade |
| Slots 1–2 | `colorPalette1/2` | Reach every pattern |
| Slots 3–5 | `sliderHue3/4/5`, `sliderVal3/4/5` | Only on patterns 128/129/130 — silent elsewhere |
| MASTER / HUE / COMP / CLASH | the five slots | Palette generators; ≥30° hue separation enforced |
| XY pad · X | `PATCH /touch-control/brightness {master}` | Live factor in **[XY_MASTER_FLOOR, 1]**; rack ceiling remains authoritative |
| XY pad · Y (STROBE) | `POST /strobe-rate {hz, duty, intensity}` | 0.5–20 Hz exponential via the page's `xyStrobeHz`; bottom 4% = off |
| XY pad · Y (WALK) | `POST /movement-rate {pixelsPerSecond, colors}` | 0.5–30 grp/s via `xyWalkPps`; painted in the operator's palette |
| ON TIME chips | `duty` in the strobe body | Share of each flash cycle lit (id stays `strobeDuty`) |
| SPEED chips | `speed` (`POST /param-center`) | Reads `zFader.dataset.value`; overwritten while BPM sync is on |
| SPATIAL pad | owner-tagged `POST /spatial-paint` | Per-pixel stroke on any Live pattern; per-axis world radii from `padBrushWorld` |
| FULL | local Spatial surface takeover | Spatial mode only; fills the Live Touch viewport and exits on XY mode or Escape |
| DRAW modes | `mode` pool\|trail\|erase\|ignite | ERASE wipes to true black (operator ruling); POOL paints the opposite colour |
| FADE chips | `fadeSeconds` in `POST /spatial-paint` | Exact linear time-to-zero: 0.1 s, 0.5 s, 1.0 s, or 1.5 s; pad, global stage, and pattern 130 share the contract |
| INK schemes | stroke colour walk + `colorPalette1` | Painting IS how you change colour |
| TAKE | replays via `spatialplay` events | Same code path as a live finger; pen-up unconditional |
| EFFECTS | GEM slot toggle / patch | Catalog fetched from the engine at runtime |
| GROUPS · bar / ⏻ | `PATCH /touch-control/brightness {groups}` | Transient factor; cannot write Dimmer Rack |
| ARM | deadman lease → stage pattern → atomic `POST /layers/live_touch/prepare` → `POST /layers/activate {target:'live_touch',durationMs:100}` | Fail-closed; tab focus is inert; Deck/Mixer state is preserved |

---

## 4. Per-group colour

Tapping a group **name** aims the colour pad at that group. While focused:

- the pad writes owner-tagged `PUT /group-fixed-colors/<group>` and does **not** move the
  Live palette;
- each group keeps its own colour when focus moves elsewhere, because the
  override is stored per group in the in-memory Live context;
- the card shows a swatch and a `clear` action that hands the group back to the
  pattern;
- **the focused group goes static** (§2.3), and the header says so.

---

## 5. The failsafe model

A manual surface that dies must not leave the ship stuck. Two independent nets,
modelled on the engine's existing FLASH/BUMP lease:

1. **Lease** — every group colour this panel writes carries an `ownerId` and a
   12 s lease (`BM26_TOUCH_PAINT_LEASE_MS`). The panel heartbeats every 3 s. A
   sweep clears anything lapsed. This covers hard link loss, where no close
   event ever fires.
2. **WS close** — the socket that owns the lease releases its groups
   immediately on close. This covers the common tab-closed / app-quit case
   without waiting out the lease.

Plus:

- **Leased colours are never persisted**, so an engine restart cannot resurrect
  a frozen group. Unleased (operator-saved) colours still persist as before.
- **The arm deadman** (`/ws/control` lease, `BM26_ARM_LEASE_MS`): a dead panel
  initiates a canonical Live→Deck blend and destroys its owner-scoped creative
  context, including spatial paint, slots, bindings and XY strobe/walk.
- **Touch staleness**: a spatial `touch:true` nobody refreshes for 10 s
  (`spatialTouchStaleMs`; drawing refreshes every 33 ms) is lifted by the
  engine itself, loudly — a dead panel's finger, not a slow stroke.
- **The panel hears the revert**: `armRevert` forces DISARMED, and reconnect
  verifies `/layers/state` still reports this owner and Live participation. It
  never infers ownership from a ParamCenter lock or automatically re-activates.
- **Disarm / tab exit** posts the exact Deck or Mixer destination to the shared
  router, waits for the blend to land, releases Live transient state, and only
  then lets CaptainPad navigate.
- **`pagehide`** starts the same Live→Deck activation via keepalive without
  stripping the look mid-blend. Best-effort: the browser can kill
  the page mid-flight, which is exactly why the engine-side lease is the real
  guarantee.

Why this is allowed at all: the codex forbids fallback behaviours *unless
explicitly asked*. This was explicitly requested, and it is built to fail
**loudly** — every auto-release logs and broadcasts the same message a manual
release does.

---

## 6. Everything it touches

**Engine REST**
`/status` · `/layers/state` · `/layers/activate` ·
`/layers/live_touch/prepare|pattern|exports|control` · `/spatial-paint` ·
`/touch-control/brightness*` ·
`/param-center` · `/mixer` (tempo reads/writes only) · `/dimmer-groups` ·
`/dimmers` (read only) · `/group-fixed-colors` (GET/PUT/DELETE) ·
`/global-effect-slots/*` ·
`/model/group-layout` · `/model/pixel-layout`

**Engine WS** (`/ws/control`)
`touchControlHello` · `touchControlArmed` · `touchControlArmedAck` ·
`touchControlArmedRejected` · `touchControlBrightness` · `dimmerState` ·
`armRevert`

**Engine params** `colorPalette1/2` · `colorTransitionMs` ·
`motionTransitionMs` · `size` · `rotate` · `speed` · `bpmSpeedSync`

**Lease-local state** includes the Live pattern controls, transient brightness,
creative effects, ParamCenter palette/tempo, audio bindings and group fixed
colours. The engine seeds and destroys this in-memory context with the ARM
lease. Dimmer Rack and Deck/Mixer pattern/fader/durable creative state are not
Live-owned.

---

## 7. Open design questions — the point of the second opinion

1. **Five colours on a two-colour engine.** Slots 3–5 are silent outside Live
   patterns 128, 129, and 130. Options: keep the fiction and label it; cut to two slots; or add
   three real CPC params and update every pattern's colour maths. Currently the
   fiction is kept and stated in the UI. Is that the right call?

2. **Colour vs motion is a genuine either/or.** Per-group colour costs animation
   on that group (§2.3). Should the surface make that trade explicit as a mode
   ("PAINT" vs "PATTERN"), rather than as a side effect of tapping a name?

3. **Where does per-group focus belong?** Focus currently lives on the group
   card, so aiming the colour pad means reaching to the bottom of the screen.
   Should it instead be a target selector in the COLOUR panel header?

4. **The Individual GROUPS profile is 24 cards in a horizontal scroll.** A pointer that
   starts on a fader is captured by that vertical fader for the whole gesture.
   Horizontal bank pan starts only from chrome/gaps after a horizontal-dominant
   threshold, so the two gestures cannot oscillate. Two exact view profiles
   reduce the active bank to five or four faders without replacing the stored
   individual levels.

5. **Should SPATIAL replace the XY pad or sit beside it?** They are different
   mental models (parameter space vs physical space) sharing one area.

6. **Brightness authority is resolved.** The rack owns the ceiling; Live's
   duplicate-looking faders are fast 0..100% factors within that ceiling.

7. **ARM transition is resolved.** Tab focus stays silent; explicit ARM blends
   into Live Touch using the exact operation used by Deck↔Mixer.

---

## 8. Related docs

`37` audio companion · `38` timeline · `39` channels/deck/mixer ·
`41` audio-reactive tuning · `42` VSN1 controller ·
`MARSIN_ENGINE_PATTERNS.md` (pattern authoring, palette rules) ·
`COLOR_THEORY.md`
