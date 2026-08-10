# 44 — TOUCH CONTROL

The CaptainPad tab for driving the ship **by hand**, live, without the deck or a
plan. Everything here is a manual override of whatever the automatic system is
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

One tab, three regions:

```
┌─────────────────────────────┬──────────────────────────────┐
│ COLOR                       │ XY  (toggle → SPATIAL)       │
│  hue/sat pad                │  X = rig master brightness   │
│  brightness · fade          │  Y = pattern rotate          │
│  5 colour slots             │  Z = motion speed (fader)    │
│  MASTER HUE COMPLEMENT      │  BPM sync                    │
│  CONTRAST CYCLE PAINT SHIP  │                              │
├─────────────────────────────┴──────────────────────────────┤
│ EFFECTS   strobe · random · tracers (along / rise / ring)   │
├────────────────────────────────────────────────────────────┤
│ GROUPS    24 cards: name (aims colour) · ⏻ · brightness bar │
└────────────────────────────────────────────────────────────┘
```

Everything is gated behind a master **ARM** switch. Unarmed, the panel writes
nothing to the rig.

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
| Colour pad | `colorPalette1/2` (CPC over WS) | Or ONE group, when a group is focused (§4) |
| Colour brightness | the V of the chosen slot | |
| Colour fade | `colorTransitionMs` | Engine-side perceptual (OKLab) crossfade |
| Slots 1–2 | `colorPalette1/2` | Reach every pattern |
| Slots 3–5 | `sliderHue3/4/5`, `sliderVal3/4/5` | Only on patterns 66/67 — silent elsewhere |
| MASTER / HUE / COMPLEMENT / CONTRAST | the five slots | Palette generators; ≥30° hue separation enforced |
| CYCLE | both palette slots + zone rotation | Same colour to both slots, so only chosen colours appear |
| PAINT SHIP | `PUT /group-fixed-colors/*` (leased) | Five zones; painted groups go static (§2.3) |
| XY pad · X | `POST /mixer/master/fade` or `PATCH /mixer` | Rig master, floored at 10% |
| XY pad · Y | `rotate` | Slewed if `motionTransitionMs` > 0 |
| Z fader | `speed` | Overwritten by the engine while BPM sync is on |
| BPM sync | `bpmSpeedSync` | Engine reads it as a bool at 0.5 |
| SPATIAL pad | `sliderTargetX/Y` on the running pattern | Needs a pattern exposing them (`68_spatial_paint`) |
| EFFECTS | GEM slot toggle / patch | Provisions only into slots ≥ 9 |
| GROUPS · name | focuses the colour pad on that group | Rig-neutral by itself |
| GROUPS · ⏻ | `POST /section-brightness` 0 / restore | Remembers the previous level |
| GROUPS · bar | `POST /section-brightness` | That group's own brightness |
| ARM | `POST /timeline/takeover` + engage ramp | Also snapshots the look being taken over |

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
- **Disarm** releases paint, switches off only the effects this panel lit, and
  restores the look snapshotted at ARM — ramped, not snapped.
- **`pagehide`** does the same on the web build. Best-effort: the browser can
  kill the page mid-flight, which is exactly why the engine-side lease is the
  real guarantee.

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
