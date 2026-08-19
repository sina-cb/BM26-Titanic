# TOUCH CONTROL — the operator's live surface

This folder holds the **Touch Control panel**: a single-page, touch-first
lighting desk for the Titanic, meant for an iPad in someone's hands at the rail.

| File | What it is |
|---|---|
| `touch_control.html` | The page. Owns the DOM, the layout, the palette wheel, the group strips, the presets. |
| `touch_control_wire.js` | The wire. Owns the engine socket — every REST call and every WebSocket message. |
| `touch_control_v2.html` | A stub. Not the live surface. |

The split is deliberate: the page never talks to the engine, and the wire never
builds UI. They communicate through DOM CustomEvents (`palettechange`,
`groupmodeschange`, `fxassign`, `audionote`, `audiobeat`, `presettransition`).
If you are changing what a control *looks like*, you are in the HTML; if you are
changing what it *sends*, you are in the wire.

Design rationale, the physical constraints of the ship, and the open questions
live in [`../44_touch_control.md`](../44_touch_control.md). **This file is the
operator manual.** That one is the spec.

---

## 1. What it is for

CaptainPad is the show's control app — scenes, playlists, the timeline, the
whole run. Touch Control is the opposite of that: it is for **driving the ship
by hand, right now**, when someone wants to play the boat like an instrument
rather than run a show.

It is built around one idea: *the person holding it can see the ship*. So it is
big-target, low-text, and it never asks you to open a menu to find out what
state something is in — the state is on the face of the control.

It drives the **deck channel only**. It is not a replacement for CaptainPad and
it cannot edit playlists, scenes, or the timeline.

---

## 2. Where it runs

The panel is served by the **simulator's** HTTP server, but it talks to the
**engine**:

```
http://<host>:6969/CaptainPad/live_touch/touch_control.html
```

| Port | Service | Panel's relationship to it |
|---|---|---|
| 6968 | marsin_engine | **Everything.** REST + `ws://…/ws/signals`. |
| 6969 | simulation (HTTP) | Serves this page. Nothing else. |
| 6971 / 6972 | sim sACN-IN bridges | Where the light actually shows up, in the sim. |
| 6967 | CaptainPad (Expo web) | A **sibling**, not a dependency. See §4. |
| 6966 | audio companion | Feeds the engine the stems and BPM the panel binds to. |

Bring the stack up with `node launcher.js dev` from the repo root.

### The signal chain

```
Touch Control  ──REST/WS──>  marsin_engine  ──sACN──>  simulator  (or the real rig)
   :6969 page                    :6968                   :6971/:6972
                                   ^
CaptainPad :6967  ──REST/WS────────┘
```

Both surfaces point at the same engine. Neither talks to the other. **The engine
is the only shared truth**, which is why arming matters so much — see next.

---

## 3. ARM — the one control that matters

Nothing this panel does reaches the rig until you **ARM** it. Disarmed, every
write is refused at the wire; you can set up a palette, pick effects, and stage
a look, and none of it leaves the tab. That is the safety, not a courtesy.

Arming is not a mode flag. **It is a takeover**, and all of it is reversible:

| On ARM | On DISARM |
|---|---|
| Source-locks 6 engine params to the HTTP channel | Lock released (`mode: open`) |
| Both autopilots switched **off** (state captured first) | Autopilots restored to what they were |
| Every global effect disabled — starts from silence | Everything this panel started is stopped |
| Overlay mixer channels faded to 0 | Overlay faders put back exactly as found |
| Blackout **released** | Blackout **re-engaged** |
| Panel's whole visible state asserted onto the rig | Audio bindings, effect scope, parked groups and group paint all cleared |

The six locked params are `colorPalette1`, `colorPalette2`, `colorTransitionMs`,
`motionTransitionMs`, `rotate`, `speed`.

**An honest limit, from the source:** the lock is against the *HTTP channel*,
not against this browser tab. Another HTTP client could still write those
params. It is exclusivity against the automatic systems — which is what "I have
the desk now" actually needs to mean — not against a determined second operator.

### Arming and disarming now fade

Arming used to be a hard cut: the autopilots dying, the overlays snapping to
zero, and every effect being disabled all landed at once on a lit ship. Both
transitions now run under a **1.5 s house fade** handled inside the engine:

```
fade out  →  do the entire takeover invisibly  →  fade back up on the finished look
```

The fade-up deliberately waits for the palette, the effect slots and the group
paint to actually land, so you never watch the ship fade up into a stale look
and then correct itself. The ramp lives in the engine (`POST /arm-fade`), not in
the browser, so it still lands on target if the tab dies mid-fade.

---

## 4. How this interacts with CaptainPad

This is the part that surprises people.

**They are peers.** Both are clients of the same engine. There is no master/slave
relationship, no handshake, and no message passing between them.

**While Touch Control is ARMED, CaptainPad loses some control.** The source lock
is set to the HTTP channel, and the engine rejects writes from other writers —
the WebSocket clients, bpm-sync, MIDI, OSC — with `reason: 'source_lock'`. So
CaptainPad's colour and speed controls will appear to do nothing on those six
params until Touch Control disarms.

> Verified: the lock is applied and the param centre rejects non-`api` writers.
> **Not verified in this repo's testing:** CaptainPad's own behaviour when its
> writes are rejected — whether it surfaces the rejection to its operator or
> silently swallows it. Worth checking before a show where two people are
> holding two surfaces.

**Practical rule for running the two together:** decide who has the desk. If
someone is playing the ship by hand from Touch Control, CaptainPad is for
watching. When the hand-driving is done, **disarm** — that is what hands the
autopilots, the overlays and the params back.

**What Touch Control never touches:** playlists, scenes, the timeline, the
show scheduler, panel firmware. All of that stays CaptainPad's job.

---

## 5. The panels

Six panels. **METERS is always on, and always in the top row.** The rest dock and
undock.

### METERS (always visible)
Live audio: the stems, the BPM readout, and the note the engine is hearing.
Everything that can be bound to audio elsewhere in the panel is metered here
first, so you can see the signal before you bind to it.

### COLOR
The palette wheel. The engine has exactly **two** colour slots and patterns
interpolate between them, so the wheel is not a free painting surface — read
`../44_touch_control.md` §2.1 and §2.2 before assuming otherwise.

- **FOLLOW NOTE** (`#noteFollow`) — a global modifier. When on, the palette
  tracks the note the audio engine is hearing, using Scriabin's
  note-to-colour mapping. It sits *over* whatever palette scheme you have
  chosen; it is not a scheme of its own.

### SPATIAL / XY
Positional control across the hull. Note the ship has a **25% dead band on X
that runs diagonally** — an XY move is not a straight sweep in world space.

### EFFECTS
The global effect grid. Each cell picks an effect into a slot.

- The pressed state is a bright mint fill with near-black ink — deliberately
  high contrast, measured at 14.87:1, because this gets read at night.
- Each cell carries an **audio row**: a signal picker and an **LVL / HIT**
  mode toggle.
  - **LVL** — the effect follows the signal continuously.
  - **HIT** — the effect fires on a spike.
- **Binding a tempo signal (BPM) locks the effect to the beat** rather than
  pulsing its depth. A tempo-bound sweep travels one pass per bar; movement
  trace travels on the beat; ocean breath swells over four bars; the strobe
  phase-locks so its flashes land on the downbeat. The effect's depth stays
  exactly where you set it.
  - **Only 5 of the 19 effects own a clock to lock to**: strobe, beat pump,
    waterline sweep, movement trace, ocean breath. The rest have nothing but a
    depth — for those, use **HIT** so they stab on the beat instead of throbbing.
  - Two effects are already audio-driven by their own nature and need no tempo
    lock: **kick punch** fires off the kick drum (a bound signal only sets how
    hard it is allowed to land), and **frost sparkle** has an `audioDensity`
    mode that ties its spawn rate to the high band.

### GROUPS
24 group faders plus the master, in a reorderable bank.

Each strip carries, top to bottom: the colour-source checkboxes, the fader with
its name rotated inside the bar, its **number** (matching the wheel dot), a
**power** square, and an **audio** picker.

- **OWN** cycles the group's palette scheme. The toggle lives on the OWN button
  itself, colour-coded to the group, and shows its state as a short label:

  | Label | Scheme | Meaning |
  |---|---|---|
  | `-` | manual | You placed the colour yourself. |
  | `MST` | master | Follows the master palette. |
  | `HUE` | hue | A hue step off the master. |
  | `CMP` | complement | The master's complement. |
  | `CNT` | contrast | A contrasting pick. |

  Every OWN group is given a **unique** hue, so no two groups collide.
- A group can carry **5 colours at once**.
- **LOCK** parks a group. A locked group is held exactly as set — it is immune
  even to the master fader. (The arm envelope and blackout still override it;
  those are session/e-stop level, not level controls.)
- **ALL ON / ALL OFF** toggles every group at once.
- **All groups off means ZERO light**, regardless of where the master fader is.

**The master fader is the absolute master when armed — no exceptions**, except
locked groups, which is a deliberate operator ruling.

### PRESETS
A 5×5 grid. Record the current state into a slot, recall it later.

- Slots are **labelable** — set one, then name it, and the label shows on the
  button.
- **Transitions** between presets: **SNAP**, **FADE**, **DIP**. The chosen
  transition is labelled on the control.
- **Auto-advance** in NEXT or RANDOM order, timed in **beats** (4 / 8 / 16 / 32),
  not seconds — so it stays with the music.

> Known issue: the **DIP** transition has roughly a 2.3 s dark gap, because the
> fade back up queues behind the ~24 restore writes. Not fixed.

### Layout rules

- Two horizontal rows. SPATIAL / COLOR / PRESETS on top, EFFECTS / GROUPS on the
  bottom. METERS is always in the top row.
- Collapsing docks a panel to a rail on the **left**.
- **At most two panels open per row**, and never fewer than two panels open
  overall.

---

## 6. Failsafes — what protects the ship

The mission rule is that the Titanic must be **visible at night**. A dark ship
is the worst outcome there is, worse than a wrong-looking one. These exist to
enforce that:

| Guard | What it does |
|---|---|
| Writes refused while disarmed | A staged look cannot leak onto the rig. |
| Engine-side fade ramp | Lands on target even if the panel dies mid-fade. |
| `pagehide` handler | A closing tab raises the house, releases the source lock, and clears the audio bindings. |
| Persisted blackout never restored | A crash after a disarm used to boot the ship dark, forever. Now refused, loudly, at boot. |
| Persisted zero master never restored | Same hazard, and the one that actually bit: clearing blackout does not light the ship if the grand master is separately restored at 0. |
| `POST /mixer/panic` | The engine's "make it lit" e-stop: blackout off, master up, arm envelope snapped to 1. |

### Not built yet — know these before relying on the panel unattended

- **The engine does not notice a dead panel.** If the tab closes cleanly the
  `pagehide` handler fires, but a wifi drop, a slept iPad, or a power loss
  leaves the rig frozen exactly as the panel left it, source lock and all. The
  deadman that would revert to the automatic show is **not implemented**.
- **A crash does not revert to the automatic playlist.** The ship is now
  guaranteed *lit* after a restart, but it comes back on one pinned pattern,
  not running the automatic show.
- **The autopilot ratchet.** Arming turns the autopilots off and captures their
  prior state in page memory only. If the panel dies or reloads before you
  disarm, nothing restores them — and the *next* arm captures "off" as the prior
  state and faithfully restores "off". The automatic show does not come back on
  its own. **If in doubt, check the autopilot before walking away.**
- **`launcher.js` does not restart the engine.** It claims only exit code 75
  (scene switch); any other exit tears the whole stack down. Whether the show
  server's supervisor is installed is unverified in this repo.

---

## 7. Running it

```bash
node launcher.js dev          # from the repo root: sim + engine + audio + CaptainPad
```

Then open `http://<host>:6969/CaptainPad/live_touch/touch_control.html`.

**Use one browser client at a time.** The simulator is a WebGL client; opening
the sim in a second tab alongside a rendering tool has been observed to cost the
first tab its WebGL context.

### Troubleshooting

| Symptom | Cause to check first |
|---|---|
| Controls do nothing | Not ARMED. Writes are refused by design. |
| CaptainPad's colour/speed controls do nothing | Touch Control is armed and holding the source lock. Disarm it. |
| Ship is dark and every control says it is lit | Check `GET /arm-fade` — if `armFade` is 0 the envelope is holding it down. `POST /mixer/panic` recovers. |
| Rig keeps moving with no panel open | A previous session died while armed. Check `GET /param-center` for a stale `sourceLock` and `GET /autopilot`. |
| Effects pulse instead of running in time | The effect has no rate to lock to. Switch its audio row to **HIT**. |
| Everything looks too dark | Check the grand master and the section dimmers separately — they are different paths. |

---

## 8. Related docs

- [`../44_touch_control.md`](../44_touch_control.md) — the design spec: the
  ship's physical constraints, why the surface is shaped this way, open questions.
- [`../38_control_panel.md`](../38_control_panel.md) — the control panel.
- [`../39_channels_deck_mixer.md`](../39_channels_deck_mixer.md) — deck vs
  overlay channels, which is what §3's overlay silencing is about.
- [`../41_audio_reactive_tuning.md`](../41_audio_reactive_tuning.md) — the audio
  signals the panel binds to.
- `../../.agent/skills/full_stack_smoke.md` — bringing the whole chain up and
  proving each link.
