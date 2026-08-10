# 44 — TOUCH CONTROL

The operator surface for driving the ship **by hand**, live, without the deck or
a plan. It is a **standalone browser panel** — `docs/ui/touch_control.html`
(geometry + rendering) with `docs/ui/touch_control_wire.js` (the engine socket)
— served by the sim's HTTP server and driven on an iPad. The CaptainPad tab
this doc originally described is retired; its component tree was deleted from
`CaptainPad/components/touch_control/`.

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
│  Y AXIS (WALK·STROBE) │ TAKE (REC·PLAY·LOOP·CLR)             │
│  SIZE chips           │ POWER chips                          │
│  FADE chips           │ STEP chips                           │
│  ON TIME chips        │ SPEED chips                          │
│ D ┌────────────────────────────────────────────────────┐ I   │
│ R │            the pad — 150 charted fixtures,         │ N   │
│ A │            de-rotated hull, mirrored X             │ K   │
│ W └────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

DRAW (POOL·TRAIL·ERASE·IGNITE) and INK (ONE·MASTER·HUE·COMP·CLASH) run as
vertical columns flanking the pad. **XY mode**: X drives the grand master,
rescaled into **[0.05, 1]** — dim at the far left, never dark; Y drives the
strobe rate or the group walk (operator-selectable), both exponential, bottom
4% = off. **SPATIAL mode**: the pad is a per-pixel paint surface driving the
`/spatial-paint` global effect, which works on **every** pattern. TAKEs record
a gesture with its timing and replay/loop it; presets capture the whole panel
(schema v3).

Everything is gated behind a master **ARM** switch. Unarmed, the panel writes
nothing to the rig (`write()` refuses; only reads and the arm chain itself use
`req()`). Arming declares a **deadman lease** over `/ws/control` and will NOT
proceed without the engine's ack — no socket, no takeover.

---

## 2. The hard constraints (read this before proposing a layout)

These are not preferences. Each was verified against the running engine or the
model, and each one closes off a design that looks obvious on paper.

### 2.1 The engine has exactly TWO colour parameters
`colorPalette1` and `colorPalette2`. There is no `colorPalette3..5`. Any
"five colours" surface is therefore a client-side fiction that has to be
projected onto two engine slots, or onto something else entirely.

- Slots 1–2 write the real CPC params and colour every pattern.
- Slots 3–5 have **no engine home**. They reach a pattern only through
  per-pattern local sliders (`sliderHue3/4/5`, `sliderVal3/4/5`), which only
  `66_five_colour_prism` and `67_five_colour_stations` declare. On any other
  pattern those three slots do nothing at all.

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

### 2.4 Section dimmers SCALE, they do not overwrite
`POST /section-brightness` multiplies a group's output. The pattern keeps
running underneath. This is why on/off and per-group brightness use dimmers,
**not** group colour.

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

The sim already solves it: its Top-Down pixel view compresses empty bands
(`compress: {minWorldGap: 5, gapWorld: 4}`). SPATIAL reproduces that transform
so the pad and the sim picture agree.

### 2.6 The sim's 2D view has no inverse
Screen → panel design space is analytically invertible; design space → **world**
is not, anywhere in the repo. The projection drops an axis, the forward
constants are function-local, and the compression band table is discarded by its
caller. SPATIAL therefore rebuilds the compression and its inverse client-side.

### 2.7 Live colour at full resolution is not on the wire
The `vis` WS topic is subsampled to 100 px/strip at 5 Hz with no index→group
mapping. A faithful animated mirror of the rig is **not possible** over the
current API. A static map is.

### 2.8 The effect slot table is SHARED
Slots 1–8 are rendered by the Deck/Mixer grid and the VSN1 hardware. TOUCH
CONTROL only ever provisions into slots ≥ 9, and only ever switches off effects
it personally turned on.

### 2.9 Master brightness has two paths and they behave differently
- `PATCH /mixer { master }` → `setMaster()`, whose first statement cancels any
  in-flight fade. It can only SNAP.
- `POST /mixer/master/fade { target, durationMs }` → ramps.

The panel floors its own master writes at **10%** (`MIN_BRIGHTNESS`) — the
mission is that the ship is visible at night, and a touch surface is the easiest
place to drag a master to zero by accident. Deck and Mixer are unaffected and
can still reach black.

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
| Slots 3–5 | `sliderHue3/4/5`, `sliderVal3/4/5` | Only on patterns 66/67 — silent elsewhere |
| MASTER / HUE / COMP / CLASH | the five slots | Palette generators; ≥30° hue separation enforced |
| XY pad · X | `PATCH /mixer {master}` | Rescaled into **[XY_MASTER_FLOOR, 1]** (page-exported 0.05) — never dark |
| XY pad · Y (STROBE) | `POST /strobe-rate {hz, duty, intensity}` | 0.5–20 Hz exponential via the page's `xyStrobeHz`; bottom 4% = off |
| XY pad · Y (WALK) | `POST /movement-rate {pixelsPerSecond, colors}` | 0.5–30 grp/s via `xyWalkPps`; painted in the operator's palette |
| ON TIME chips | `duty` in the strobe body | Share of each flash cycle lit (id stays `strobeDuty`) |
| SPEED chips | `speed` (`POST /param-center`) | Reads `zFader.dataset.value`; overwritten while BPM sync is on |
| SPATIAL pad | `POST /spatial-paint` (global effect) | Per-pixel stroke on ANY pattern; per-axis world radii from `padBrushWorld` |
| DRAW modes | `mode` pool\|trail\|erase\|ignite | ERASE wipes to true black (operator ruling); POOL paints the opposite colour |
| INK schemes | stroke colour walk + `colorPalette1` | Painting IS how you change colour |
| TAKE | replays via `spatialplay` events | Same code path as a live finger; pen-up unconditional |
| EFFECTS | GEM slot toggle / patch | Catalog fetched from the engine at runtime |
| GROUPS · bar / ⏻ | `POST /section-brightness` | Strict numeric 0..1 engine-side |
| ARM | source lock (6-key lease) + autopilots off + disable-all + overlay silence + deadman WS lease | Fail-closed: no deadman ack ⇒ no takeover. NOT rig-wide exclusivity — see the audit (report 20260810_2 §0) |

---

## 4. Per-group colour

Tapping a group **name** aims the colour pad at that group. While focused:

- the pad writes `PUT /group-fixed-colors/<group>` and does **not** move the
  global palette;
- each group keeps its own colour when focus moves elsewhere, because the
  override is stored per group engine-side;
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
  triggers `revertToAutomaticShow`, which lights the ship, opens the lock,
  resumes the autopilots — **and clears the panel-driven global effects**:
  spatial paint (a dead panel's ERASE used to keep darking the ship every
  frame, immune to every failsafe) and the slot-less XY strobe/walk.
- **Touch staleness**: a spatial `touch:true` nobody refreshes for 10 s
  (`spatialTouchStaleMs`; drawing refreshes every 33 ms) is lifted by the
  engine itself, loudly — a dead panel's finger, not a slow stroke.
- **The panel hears the revert**: the `armRevert` broadcast forces the surface
  to DISARMED with the reason on the pill, and a reconnect while armed
  re-checks the lock instead of blindly re-arming — if the takeover is gone,
  the panel says so and disarms rather than fighting the autopilot.
- **Disarm** releases paint, stops the XY strobe/walk explicitly, switches off
  the effects this panel lit, and hands back the automatic show — ramped, not
  snapped, floored at `ARM_FADE_FLOOR` (0.12), never black.
- **`pagehide`** does the same via keepalive posts (arm-fade up, lock open,
  audio bindings clear, strobe/walk off). Best-effort: the browser can kill
  the page mid-flight, which is exactly why the engine-side lease is the real
  guarantee.

Why this is allowed at all: the codex forbids fallback behaviours *unless
explicitly asked*. This was explicitly requested, and it is built to fail
**loudly** — every auto-release logs and broadcasts the same message a manual
release does.

---

## 6. Everything it touches

**Engine REST**
`/status` · `/param-center` · `/mixer` · `PATCH /mixer` ·
`POST /mixer/master/fade` · `/dimmer-groups` · `/dimmers` ·
`POST /section-brightness` · `/group-fixed-colors` (GET/PUT/DELETE) ·
`/global-effect-slots/*` · `/deck/channel` · `POST /deck/channel/control` ·
`POST /pattern` · `/timeline/takeover` · `/timeline/resume` ·
`/model/group-layout` · `/model/pixel-layout`

**Engine WS** (`/ws/control`)
`setSharedParam` · `paramRejected` · `globalEffectSlots` ·
`touchControlHello` / `touchControlHeartbeat` / `touchControlRelease`

**Engine params** `colorPalette1/2` · `colorTransitionMs` ·
`motionTransitionMs` · `size` · `rotate` · `speed` · `bpmSpeedSync`

**Shared state** the GEM slot table (with Deck/Mixer/VSN1), section dimmers
(with the Dimmer Rack), group fixed colours (with the Dimmer Rack), the rig
master (with everything).

---

## 7. Open design questions — the point of the second opinion

1. **Five colours on a two-colour engine.** Slots 3–5 are silent on 68 of 70
   patterns. Options: keep the fiction and label it; cut to two slots; or add
   three real CPC params and update every pattern's colour maths. Currently the
   fiction is kept and stated in the UI. Is that the right call?

2. **Colour vs motion is a genuine either/or.** Per-group colour costs animation
   on that group (§2.3). Should the surface make that trade explicit as a mode
   ("PAINT" vs "PATTERN"), rather than as a side effect of tapping a name?

3. **Where does per-group focus belong?** Focus currently lives on the group
   card, so aiming the colour pad means reaching to the bottom of the screen.
   Should it instead be a target selector in the COLOUR panel header?

4. **The GROUPS strip is 24 cards in a horizontal scroll.** That is a lot of
   small targets, and it puts a horizontal drag (the brightness bar) inside a
   horizontal scroll. A grid, a two-row strip, or a separate page may be better.

5. **Should SPATIAL replace the XY pad or sit beside it?** They are different
   mental models (parameter space vs physical space) sharing one area.

6. **The panel duplicates the Dimmer Rack.** Per-group brightness now exists in
   both. Should the rack own it, or should this be the fast version?

7. **ARM now writes to the rig** (the engage crossfade needs a destination).
   Previously ARM was inert. Is a visible crossfade on arming correct, or should
   arming stay silent until the operator touches something?

---

## 8. Related docs

`37` audio companion · `38` timeline · `39` channels/deck/mixer ·
`41` audio-reactive tuning · `42` VSN1 controller ·
`MARSIN_ENGINE_PATTERNS.md` (pattern authoring, palette rules) ·
`COLOR_THEORY.md`
