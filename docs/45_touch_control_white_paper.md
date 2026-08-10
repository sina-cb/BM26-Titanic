# 45 — The Touch Control Panel: A White Paper

A complete technical and operational breakdown of the Titanic's manual lighting
surface, written as source material for operator documentation. Everything in
here is taken from the code as it stands (`docs/ui/touch_control.html`,
`docs/ui/touch_control_wire.js`, and the `marsin_engine` endpoints they drive)
and from behaviour verified in this repo's test harnesses. Companion docs:
`docs/44_touch_control.md` (constraints + write table), the audit at
`.agent/reports/202608/20260810_2_touch_panel_audit.md`, and the hardening
record in the wave commits.

---

## 1. What it is, in one paragraph

The Touch Control panel is a **standalone browser page** an operator runs on an
iPad to drive the ship's lighting **by hand** — painting light directly onto a
chart of the hull with a finger, sweeping brightness and strobe from a pad,
recoloring the rig from a wheel, and recording gestures to replay as loops. It
is a *manual override*: the ship normally runs an automatic show (the deck
autopilot cycling patterns), and the panel's job is to take the rig over
cleanly, be expressive while it holds it, and hand it back — or be taken back
by the engine — **without ever leaving the ship dark or stuck**.

## 2. System context

```
                    ┌────────────────────────────────────────┐
   iPad (Safari)    │  touch_control.html   (the PAGE)       │
   http://<host>:6969/docs/ui/touch_control.html             │
                    │   geometry · rendering · chips · takes │
                    │        ▲ DOM CustomEvents ▼            │
                    │  touch_control_wire.js (the WIRE)      │
                    │   engine socket · arm chain · queues   │
                    └───────┬──────────────────┬─────────────┘
                       REST / WS          ws://:6968/ws/signals (audio meters)
                            │             ws://:6968/ws/control (arm deadman)
                    ┌───────▼─────────────────────────────────┐
                    │  marsin_engine  (:6968)  40 fps          │
                    │  param center · mixer · global effects   │
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

1. Declare a **deadman lease** over `ws://:6968/ws/control`
   (`touchControlArmed`). **No socket or no acknowledgement within 1.5 s →
   the arm ABORTS** and the surface returns to DISARMED with the reason. A
   second panel is refused by the engine ("one desk at a time"); a *stale*
   holder (dead socket) is evicted so a dead panel can never lock out a live
   one.
2. Release any blackout **first** — the ship is lit before anything else
   happens.
3. Fade the house to the **arm floor** (`ARM_FADE_FLOOR = 0.12`) — dim, never
   black — to hide the takeover.
4. Take a **source lock** on six param-center keys (the two palettes, both
   transition times, rotate, speed), switch **both autopilots off**, run
   **disable-all** on the effect slots, **clear audio bindings**, and silence
   the overlay mixer channels (their levels are captured for restore).
5. Re-assert the panel's whole visible state (palette, effect slots, group
   paint), re-assert blackout-off, and fade the house back up.

**Disarm** is the mirror image, each step wrapped so one failure cannot cancel
the rest (`handbackStep`): spatial paint cleared, XY strobe/walk stopped,
painted groups released, effects disabled, effect preset colours restored,
overlay channels restored, source lock opened, autopilots restored to their
pre-arm state, and only then is the deadman lease released.

**Honest limit (pending a design decision):** the arm lease is exclusivity
against the *automatic systems*, not against other clients. CaptainPad or any
HTTP client can still change the rig while the panel is armed. The panel
surfaces external blackouts/master-zero on its status pill while armed; a
holder-token gate is a tracked decision (audit §0, task #32).

### 3.2 NEVER-BLACK

The ship's mission is to be visible at night. Every path this panel controls is
floored:

| Path | Floor |
|---|---|
| Arm/disarm envelope | 0.12 (`ARM_FADE_FLOOR`) — the ship dims to hide the takeover, never extinguishes |
| XY master axis | rescaled into **[0.05, 1]** — the far left of the pad is 5%, and the whole travel stays live (rescale, not clamp) |
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
| Panel tab closes cleanly | `pagehide` keepalive posts | House up, lock open, bindings cleared, strobe/walk stopped |
| Panel dies hard (wifi, battery, crash) | The **arm deadman**: engine pings the control socket; close-grace 1–5 s, lease default 15 s | `revertToAutomaticShow`: ship lit, dimmers checked, lock opened, scope cleared, bindings dropped, **spatial paint + strobe + walk cleared**, default playlist + autopilot on |
| Finger "stuck down" (missed pen-up of any cause) | Engine-side **touch staleness**: no touch write for 10 s (drawing refreshes every 33 ms) → brush lifted, loudly | The stroke cools on its own fade |
| Engine restarts under an armed panel | Crash-boot policy reverts to the automatic show; the panel **hears `armRevert`** and reconnect **re-checks the lock** | Panel forces DISARMED with the reason — it never shows ARMED over the autopilot |
| Painted group left behind | Per-group **paint lease** (12 s, heartbeat 3 s) + WS-close release; leased paint is never persisted | Group returns to the show |
| Back/forward-cache restore | `pageshow(persisted)` | Forced DISARMED (its lock was dropped at hide) |
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
- **Pattern select** — puts one of the panel's patterns on the deck
  (66 five-colour prism, 67 five-colour stations, 68 spatial paint). A
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
  pattern, badged ENGINE); slots 3–5 are pattern-local sliders (patterns 66/67
  only, badged LOCAL — silent elsewhere, and the capability line says so).
- **Generators** — MASTER / HUE / COMPLEMENT / CONTRAST build five-colour
  schemes from the wheel's base colour (≥30° hue separation enforced).
- **FOLLOW NOTE** — recolors the rig from the music's detected pitch class
  (the wire broadcasts `audionote`; the page maps note → hue).

### 4.4 SPATIAL / XY — the pad

One rectangle, two modes, toggled at the panel header. The chart plots ~150
fixture markers from tables baked out of the model: the hull is **de-rotated**
(it sits 44.3° diagonal in world space), scaled per axis, and **mirrored in X**
so starboard is on the left, matching what the operator sees from the sim
camera. Pad↔world round-trips are exact; a boot-time tripwire compares the
baked group list against the engine's live model and banners **"THE PAD CHART
IS STALE"** if they ever differ. One finger owns a stroke (a second finger is
ignored); `pointercancel` lifts the brush.

**XY MODE** — brightness × rhythm:

- **X** → grand master, `[5%, 1]` (axis label: "DIM 5%" — it cannot reach
  black).
- **Y** → per the **Y AXIS** buttons: **STROBE** (0.5–20 Hz exponential,
  bottom 4% = off) or **WALK** (light steps group-by-group along the ship,
  0.5–30 groups/s, painted in the operator's palette).
- **ON TIME** chips (10/25/50/75/90) — the strobe duty cycle: what share of
  each flash the lights are ON. 10 = a hard stab, 90 = lit with a dark notch.
  Takes effect on the next pad sample.
- The live readout shows exactly what is being sent ("53% · 3.6 grp/s").

**SPATIAL MODE** — per-pixel paint, on **any** pattern (it is a global effect
stage that runs after group paint and before the grand master):

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
  **FADE** — how long the trail lingers (0.1–8 s), one curve shared by pad ink
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

24 fader strips plus a grand master. Each strip: level bar, ⏻ power,
**GLOBAL** (follows the wheel), **OWN** (its own colour — a dot appears *on the
wheel* to drag), **FX** (marks the group as an effects target — the FX-marked
set becomes the engine's effect scope), and a lock. The toolbar offers
**LINK** (gang faders), **TAG**/selection tools, and scheme modes; the footer
has **ALL OFF** and the other bulk actions. Group brightness rides the
engine's *section dimmers* (scaling, not overwriting — patterns keep playing
underneath), and the deadman revert raises them if a dead panel left them all
down.

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
- Boot: `/status`, `/exports`, `/dimmer-groups`, `/dimmers`, the effect
  catalog, the chart tripwire — then the panel is live. The engine's runtime
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
| "the engine lost this panel's takeover while the link was down…" | Reconnected after a revert/restart | Same — re-arm deliberately |
| "an arm/disarm is already in progress" | Double-tap guard | Wait for the chain to finish |
| "BLACKOUT was engaged by ANOTHER surface…" / "grand master was driven to N%…" | Someone else darked the rig while you were armed | Coordinate; disarm+re-arm asserts it off, or `/mixer/panic` |
| "THE PAD CHART IS STALE…" | The model changed since the chart was baked | Regenerate the chart tables before trusting positions |
| "this page came back from the browser cache…" | bfcache restore | Re-arm |
| "analyser quiet — no new values" | Audio companion stopped publishing | Check the companion on :6966 |

## 7. Operating procedures (skeleton for the user guide)

**Start of night:** stack up (sim → engine → companion), open the panel,
confirm the meter is live and the pill is quiet, confirm the chart tripwire did
not fire. Stage your first look while disarmed. ARM.

**Performing:** the pad is the instrument — XY for brightness/rhythm, SPATIAL
for painting. Record takes for figures you want to loop. Save looks to preset
cells as you find them; name the keepers. Watch the pill.

**Handing back:** disarm. The automatic show returns ramped, with everything
this panel started stopped. Walking away without disarming is *survivable*
(the deadman reverts within seconds) but disarming is the polite exit.

**Emergency:** the ship dark and nothing obvious — `/mixer/panic` (forceLit)
from any shell, or simply close the panel and let the deadman revert. Both are
built to end with a lit ship running the automatic show.

## 8. Honest limits (put these in the docs — operators deserve them)

1. **Armed is not rig-wide exclusivity** (§3.1). Until the holder-token
   decision lands, coordinate humans by radio, not by lease.
2. **The chart is baked.** The tripwire catches drift loudly, but regeneration
   is a manual step after any model change.
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
while armed. **Arm floor** — the 12% the house dims to during takeover.
**CPC / param center** — the engine's shared parameter store. **Chart** — the
pad's de-rotated, mirrored map of the hull. **DIP** — preset transition through
a master dip. **Ink** — the stroke drawn on the pad (and its colour scheme).
**Overlay channels** — mixer channels above the deck base that blend extra
patterns. **Section dimmers** — per-group brightness scaling. **Source lock** —
the param-center write filter the arm chain installs. **Take** — a recorded pad
gesture with its timing. **The automatic show** — default playlist + deck
autopilot, the state every failsafe returns the ship to.

---

*Doc-writing pointers: §7 is the quick-start skeleton; §4 is the reference
tour; §3 and §8 are the "how it thinks" chapter that keeps operators out of
trouble; §6 is a pull-out troubleshooting card. The write table in
docs/44 §3 is the API appendix.*
