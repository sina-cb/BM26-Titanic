# 45 — The Touch Control Panel: A White Paper

A complete technical and operational breakdown of the Titanic's manual lighting
surface, written as source material for operator documentation. Everything in
here is taken from the code as it stands (`CaptainPad/live_touch/touch_control.html`,
`CaptainPad/live_touch/touch_control_wire.js`, and the `marsin_engine` endpoints they drive)
and from behaviour verified in this repo's test harnesses. Companion docs:
`docs/44_touch_control.md` (constraints + write table), the audit at
`.agent/reports/202608/20260810_2_touch_panel_audit.md`, and the hardening
record in the wave commits.

---

## 1. What it is, in one paragraph

Live Touch is CaptainPad's third **Layers** setting. Its tuned browser
instrument remains independent of the React Native shell, but CaptainPad owns
its navigation and theme chrome. The operator can paint the hull, sweep
brightness and rhythm, recolor the rig, and record gestures. Explicit ARM
blends from Deck or Mixer into Live Touch; leaving blends to the selected
Deck/Mixer destination and releases the lease — **without leaving the ship
dark or stuck**.

## 2. System context

```
                    ┌────────────────────────────────────────┐
   CaptainPad :6967 │  Layers → Live Touch (iframe host)    │
                    │  touch_control.html   (the PAGE)       │
                    │   geometry · rendering · chips · takes │
                    │        ▲ DOM CustomEvents ▼            │
                    │  touch_control_wire.js (the WIRE)      │
                    │   engine socket · ARM/layer chain     │
                    └───────┬──────────────────┬─────────────┘
                       REST / WS          ws://:6968/ws/signals (audio meters)
                            │             ws://:6968/ws/control (arm deadman)
                    ┌───────▼─────────────────────────────────┐
                    │  marsin_engine  (:6968)  40 fps          │
                    │  Layers router · Live brightness · FX    │
                    │  spatial paint · strobe · movement       │
                    └───────┬─────────────────────────────────┘
                        sACN │
              ┌─────────────▼──────────────┐
              │  simulation (:6969-:6972)   │   + the real rig
              └────────────────────────────┘
   Audio Companion (:6966) → OSC :10000 → engine CPC → the meter strip
```

**The page/wire split is a hard design rule.** The page owns everything visual
and geometric (the hull chart, the brush ring, the chips, the take recorder)
and *never talks to the engine*. The wire owns the engine connection and *never
touches geometry*. They communicate through DOM CustomEvents
(`sliderchange`, `palettechange`, `spatialplay`, `xyaxischange`,
`groupmodeschange`, `audionote`, `audiobeat`). This is why a cosmetic redesign
(sliders becoming chip buttons) cannot break the engine path: the hidden slider
elements remain the value carriers, and a chip fires the same `sliderchange` a
drag does.

Shared constants are **single-sourced**: the page defines and exports
`XY_MASTER_FLOOR` (0.05) and the two Y-axis curves (`xyStrobeHz`, `xyWalkPps`);
the wire consumes the exports and refuses to drive the master if the floor
export is missing.

## 3. The core concepts an operator must know

### 3.1 ARM is a contract, not a toggle

**Disarmed**, the panel writes nothing — every write is refused client-side.
The operator can stage a full look (palette, effects, brush settings) while
disarmed; **arming asserts all of it**, so the rig snaps to what the panel
shows ("arming means: make the rig match this panel").

**Arming** runs a fixed chain:

1. Verify the canonical generated pixel-view artifact against the live model.
2. Declare a **deadman lease** over `ws://:6968/ws/control`
   (`touchControlArmed`). **No socket or no acknowledgement within 1.5 s →
   the arm ABORTS** and the surface returns to DISARMED with the reason. A
   second panel is refused by the engine ("one desk at a time"); a *stale*
   holder (dead socket) is evicted so a dead panel can never lock out a live
   one.
3. After the acknowledgement, stage the selected pattern in the isolated
   `live_touch` channel and assert the full visible state, including exhaustive
   transient brightness factors.
4. `POST /layers/activate {target:'live_touch'}` and poll `/layers/state` until
   the shared linear blend lands. Only then show `ARMED`.

Deck patterns, Mixer faders, both autopilots, the Dimmer Rack, and Mixer master
are not captured or mutated by ARM. **Disarm/tab exit** routes to the requested
Deck or Mixer setting with that same blend, proves landing and Live cleanup,
then acknowledges CaptainPad navigation. Incomplete cleanup remains a visible,
blocking failure rather than a false success.

### 3.2 NEVER-BLACK

The ship's mission is to be visible at night. Every path this panel controls is
floored:

| Path | Floor |
|---|---|
| Layer switches | One canonical Deck/Mixer/Live linear blend; no private ARM dip |
| XY Live master | rescaled into **[0.05, 1]**, then multiplied under the Dimmer Rack ceiling |
| Strobe | `onFrames ≥ 1` and `intensity ≥ 0.02` engine-side (an active strobe at intensity 0 is a constant blackout — refused) |
| Walk palettes | all-black colour sets refused engine-side |
| `/global-blackout` | strict boolean only — `"false"` can no longer *engage* it |

The one deliberate exception: **ERASE paints to true black** (operator ruling —
"so you can do fun washes and swipes"). It is per-pixel, transient, decays on
the fade curve, and is covered by the failsafes below. Whether a *full-coverage*
erase while armed should floor at 5% is an open operator ruling.

### 3.3 The failsafe lattice (what happens when things die)

| Failure | What catches it | Result |
|---|---|---|
| Operator selects Deck/Mixer | exact-origin lifecycle handshake | Canonical blend and cleanup complete before CaptainPad navigates |
| Panel tab closes cleanly | `pagehide` keepalive starts Live→Deck | Engine completes the handback or the deadman finishes it |
| Panel dies hard (wifi, battery, crash) | The **arm deadman** | Canonical Deck handback; bindings, spatial paint, strobe and walk cleared |
| Finger "stuck down" (missed pen-up of any cause) | Engine-side **touch staleness**: no touch write for 10 s (drawing refreshes every 33 ms) → brush lifted, loudly | The stroke cools on its own fade |
| Engine restarts under an armed panel | Panel hears `armRevert`; reconnect checks `/layers/state` owner + Live participation | Panel forces DISARMED and never auto-reactivates |
| Painted group left behind | Per-group **paint lease** (12 s, heartbeat 3 s) + WS-close release; leased paint is never persisted | Group returns to the show |
| Back/forward-cache restore | `pageshow(persisted)` | A frozen ARM is cancelled into authoritative cleanup, or an armed session resumes its Deck handback; it never reactivates automatically |
| OS-cancelled touch (notification, palm) | `pointercancel` → same lift path as pointerup | Pen-up recorded and sent |

Nothing on the panel can wedge the rig in a way the deadman cannot clear —
this was the audit's one critical finding, and it is closed and covered by
`tests/effects/revert_clears_spatial.test.js`.

## 4. The surface, panel by panel

The page is five panels plus a header and a footer action bar. Panels can be
individually **locked** (🔓 icon — blocks accidental touches) and **collapsed**.

### 4.1 Header

- **ARM** — the master switch (§3.1). Shows ARMED/DISARMED, a lock glyph, and
  dims the shell when disarmed (content stays full-contrast: colours on a
  control surface must not lie). One arm/disarm chain runs at a time;
  double-taps are refused with a notice.
- **Pattern select** — stages one of the panel's patterns on the isolated Live channel
  (128 five-colour prism, 129 five-colour stations, 130 spatial paint). A
  capability line warns when the current pattern lacks per-slot colour.
- **BPM** — global tempo readout + **SYNC** toggle (`bpmSpeedSync`): when on,
  the engine drives pattern speed from the detected tempo (the SPEED chips are
  overridden while it holds).
- **Status pill** — every failure the wire encounters lands here in words, and
  holds for at least 5 s. If this pill is talking, believe it.

### 4.2 METER strip

Live audio, straight from the engine's param center (fed by the Audio
Companion): nine scrolling traces (LOW, MID, HIGH, KICK, FLUX, DOM1/DOM2
frequency on a log scale, DOM1/DOM2 energy), BPM and the detected musical NOTE.
The strip says **"analyser quiet — no new values"** when the companion stops
publishing, so silence and a dead link are distinguishable. Rendering is
coalesced to one animation frame and layout reads are batched — the meters
cannot starve the pad (measured: 62 timer ticks/s with audio live).

### 4.3 COLOR

- **The wheel** — hue by angle, saturation/value by radius (white core, black
  rim). Drives the five colour slots; with a group focused, it paints *that
  group* instead.
- **FADE** — `colorTransitionMs`, the engine-side perceptual (OKLab) crossfade.
- **Five slots** — slots 1–2 are engine palette params (reach *every*
  pattern, badged ENGINE); slots 3–5 are pattern-local sliders (patterns
  128/129/130 only, badged LOCAL — silent elsewhere, and the capability line
  says so).
- **Generators** — MASTER / HUE / COMPLEMENT / CONTRAST build five-colour
  schemes from the wheel's base colour (≥30° hue separation enforced).
- **FOLLOW NOTE** — recolors the rig from the music's detected pitch class
  (the wire broadcasts `audionote`; the page maps note → hue).

### 4.4 SPATIAL / XY — the pad

One rectangle, two modes, toggled at the panel header. The chart reads fixture
markers and projection metadata from the main view's generated canonical
artifact: the hull is **de-rotated**
(it sits 44.3° diagonal in world space), scaled per axis, and **mirrored in X**
so starboard is on the left, matching what the operator sees from the sim
camera. Pad↔world round-trips are exact; hash and live per-pixel identity and
coordinate checks refuse ARM if chart and engine differ. There is no raw
coordinate fallback. In SPATIAL mode, up to ten fingers own independent
stroke segments in one bounded frame request; their histories never connect.
Lifting one finger leaves the others live, and `pointercancel` retires only the
cancelled finger. FULL expands the Spatial panel to the Live Touch viewport;
it is hidden in XY mode and exits on XY mode or Escape.

**XY MODE** — brightness × rhythm:

- **X** → Live master factor, `[5%, 1]`, beneath the rack ceilings.
- **Y** → per the **Y AXIS** buttons: **STROBE** (0.5–20 Hz exponential,
  bottom 4% = off) or **WALK** (light steps group-by-group along the ship,
  0.5–30 groups/s, painted in the operator's palette).
- **ON TIME** chips (10/25/50/75/90) — the strobe duty cycle: what share of
  each flash the lights are ON. 10 = a hard stab, 90 = lit with a dark notch.
  Takes effect on the next pad sample.
- The live readout shows exactly what is being sent ("53% · 3.6 grp/s").

**SPATIAL MODE** — per-pixel paint, on **any Live** pattern (it is an
owner-scoped creative stage on the isolated Live buffer before the blend):

| DRAW mode | Behaviour |
|---|---|
| **TRAIL** (default) | Lights turn ON to your colour where you draw and fall back off in step with the fade on the pad. Your colour — the dot is the ship. |
| **POOL** | A pool in the *opposite* colour under your finger only; gone on lift. |
| **ERASE** | Wipes to true black where you draw; the dark cools behind you. |
| **IGNITE** | Your stroke keeps your colour and the whole hull answers in the contrasting one, swelling and falling with the stroke. |

- **INK** schemes (ONE / MASTER / HUE / COMP / CLASH) — the stroke *walks*
  through a five-colour scheme as the finger travels, with **STEP** setting the
  travel distance per colour. Painting is how you change colour; four hue
  families can coexist on the hull.
- **SIZE** chips — the brush's area of effect; the ring on the pad is the
  world-exact preview (per-axis radii keep it round on the glass *and* on the
  hull). **POWER** — how hard the stroke acts; past halfway is overdrive.
  **FADE** — exact linear time to zero (0.1 / 0.5 / 1.0 / 1.5 s), one curve shared by pad ink
  and hull heat.
- **TAKE** — ● REC arms recording of the next stroke *with its timing*;
  ▶ PLAY replays it at performed speed through the *same code path a live
  finger uses*; ⟲ LOOP repeats it until stopped; CLR discards. Takes are
  stored in presets. Playback ignores mode switches safely (the pen-up is
  unconditional) and PLAY ends an armed REC.
- **SPEED** chips (¼×–2×) — global pattern speed (overridden while BPM SYNC
  holds).

Controls that only mean something in the other mode are **dimmed and their
buttons disabled** — visible (a vanished control reads as a bug) but inert to
touch *and* keyboard.

### 4.5 PRESETS

25 slots. **REC** then a cell records the *entire visible surface* (schema v3):
base colour, generator, all 24 group states (level/on/flags/scheme/own-colour),
effect grid (with stable effect+preset identity, immune to catalog reordering),
draw mode, brush size/power/fade, ink scheme + step, Y-axis mode, ON TIME,
SPEED, the drawn ink path, and the recorded take. Cells can be **named**;
re-recording keeps the name. Older presets recall cleanly — missing keys leave
the current control state alone, never guess.

**TRANSITION** picks how a recall lands: **SNAP** (instant), **FADE** (palette
eases over the chosen time), **DIP** (master dips, swap happens unseen, master
returns). **Auto-advance** steps through stored presets on a beat count from
the detected tempo — a hands-off preset show that stays with the music.

### 4.6 EFFECTS

A 4×4 grid of cells, each re-pointable to any (effect, preset) pair from the
**engine's own catalog, fetched at runtime** (31 pairs at present; a new engine
effect appears without editing the page). The legend encodes the concurrency
families: **DIM / FLASH / FRAME** — one at a time each; **TEXTURE** stacks
freely; movement effects take their colours from the wheel. The default layout
gives the first two rows to the eight movement patterns.

### 4.7 GROUPS

The default **Individual groups** profile is 24 fader strips plus a grand
master. Each strip: level bar, ⏻ power,
**GLOBAL** (follows the wheel), **OWN** (its own colour — a dot appears *on the
wheel* to drag), **FX** (marks the group as an effects target — the FX-marked
set becomes the engine's effect scope), and a lock. The toolbar offers
**LINK** (gang faders), **TAG**/selection tools, and scheme modes; the footer
has **ALL OFF** and the other bulk actions. Two smaller projections come from
the live model view catalog: **Show instruments** (Hull Canvas, Silhouette,
Jewelry, Organs, Identity) and **Performance planes** (Front, Back, Organs,
Identity). Both partition all model groups exactly once. They fan each gesture
out to the existing group factors, preserve individual state while switching,
show `MIX` for a view whose members differ, and fail visibly if the canonical
catalog becomes partial, overlapping, or stale. Group levels remain transient
Live factors. The Dimmer Rack is still the durable ceiling and is never
overwritten.

## 5. Transport details (for the reference section)

- Every request is bounded (6 s timeout) — a wedged engine turns into a
  reported failure, not a hung chain.
- Writes coalesce: general state at 100 ms (last-writer-wins per key), drawing
  at 33 ms with **in-flight backpressure** (one `/spatial-paint` POST at a
  time; the newest sample always wins).
- Config patches (brush size/mode/colour) accumulate and ride the same flush
  so a colour change and a position sample cannot race; the "already sent"
  cache is forgotten at ARM so nothing staged while disarmed is lost.
- The two sockets self-heal: reconnect on close *and* on constructor failure;
  the meter socket sniff-skips frames it does not use.
- Boot: `/status`, `/layers/state`, `/dimmer-groups`, `/dimmers`, the effect
  catalog and canonical chart verification. A fresh engine may explicitly
  report Live as unstaged; focus stays online/read-only, and exports are read
  only after ARM stages a pattern. The engine's runtime
  state files under `marsin_engine/states/` are *its* memory, not the
  panel's; the panel treats the DOM as its own source of truth and asserts it
  on arm.

## 6. Error messages an operator may see (and what they mean)

| Pill says | Meaning | Do |
|---|---|---|
| "ABORTED — the control link to the engine is down…" | Arm refused: no deadman possible | Check the engine/network; re-arm |
| "ABORTED — the engine did not acknowledge the deadman lease…" | Engine up but not answering the arm socket | Re-arm; if persistent, restart the engine |
| "REFUSED — another panel holds the desk (held by …)" | One desk at a time | Disarm the other panel first |
| "the engine REVERTED to the automatic show…" | Deadman/crash-boot took the rig back | Re-arm when ready — deliberate, never automatic |
| "the engine no longer reports this panel as the active Live Touch owner…" | Reconnected after a revert/restart | Same — re-arm deliberately |
| "an arm/disarm is already in progress" | Double-tap guard | Wait for the chain to finish |
| "PIXEL VIEW …" / chart verification failure | Generated artifact and live model differ | Regenerate the canonical artifact; ARM remains refused |
| "this page came back from the browser cache…" | bfcache restore | Wait for DISARMED, then re-arm |
| "analyser quiet — no new values" | Audio companion stopped publishing | Check the companion on :6966 |

## 7. Operating procedures (skeleton for the user guide)

**Start of night:** stack up (sim → engine → companion), open the panel,
confirm the meter is live and the pill is quiet, confirm the chart tripwire did
not fire. Stage your first look while disarmed. ARM.

**Performing:** the pad is the instrument — XY for brightness/rhythm, SPATIAL
for painting. Record takes for figures you want to loop. Save looks to preset
cells as you find them; name the keepers. Watch the pill.

**Handing back:** select Deck or Mixer (or disarm to Deck). The same Layers
blend lands with everything this panel started stopped. Walking away without disarming is *survivable*
(the deadman reverts within seconds) but disarming is the polite exit.

**Emergency:** the ship dark and nothing obvious — `/mixer/panic` (forceLit)
from any shell, or simply close the panel and let the deadman revert. Both are
built to end with a lit ship running the automatic show.

## 8. Honest limits (put these in the docs — operators deserve them)

1. **Live HTTP creative state is lease-local.** Owner-tagged generic effects,
   ParamCenter, fixed group colors, tempo and audio routes are routed into an
   in-memory Live context. Untagged callers retain durable global semantics;
   missing or foreign leases fail rather than leaking writes across settings.
2. **The chart is generated.** Hash and live-layout verification catch drift;
   regeneration is still required after a model/view definition change.
3. **Slots 3–5 are pattern-local** — on most patterns only the two engine
   palette slots reach the rig, and the capability line says so.
4. **BPM SYNC overrides SPEED** while it holds; the chips are not broken, they
   are outvoted.
5. **iPad specifics:** pointer capture keeps strokes alive off the pad's edge;
   an app switch pauses the panel's rendering, and the deadman treats a long
   background as death — by design, the wifi-drop and pocket-iPad cases are
   the same case.

## 9. Glossary

**Arm lease / deadman** — the engine-side watch on the panel's control socket
while armed. **Layer setting** — Deck, Mixer or Live Touch, switched by one
shared linear blend transaction.
**CPC / param center** — palette parameters; Live owner-tagged calls use the
session-local context, while untagged calls use the durable shared store. **Chart** — the
pad's de-rotated, mirrored map of the hull. **DIP** — preset transition through
a master dip. **Ink** — the stroke drawn on the pad (and its colour scheme).
**Overlay channels** — mixer channels above the deck base that blend extra
patterns. **Dimmer Rack ceiling** — durable per-group maximum; Live factors
only scale beneath it. **Take** — a recorded pad
gesture with its timing. **The automatic show** — default playlist + deck
autopilot, the state every failsafe returns the ship to.

---

*Doc-writing pointers: §7 is the quick-start skeleton; §4 is the reference
tour; §3 and §8 are the "how it thinks" chapter that keeps operators out of
trouble; §6 is a pull-out troubleshooting card. The write table in
docs/44 §3 is the API appendix.*
