# APC mini mk2 — CaptainPad control-surface map

Reference for the **Akai APC mini mk2** as CaptainPad drives it (MIDI driver
`#1`). This is the operator-facing map: every physical control, its MIDI
number, the function it performs, and its LED behaviour. It is kept in sync
with the shipped profile `CaptainPad/midi_profiles/apc_mini_mk2.yaml` (the
YAML carries the same map as inline comments, next to the bindings).

All buttons are **Port 0, MIDI channel 0**. Buttons send note-on `0x90 vel 127`
on press and note-off `0x80 vel 0` on release. Faders send **CC** (control
change), not notes. LED colours are written back on the same note numbers per
the APC mk2 protocol.

> Authored from the operator's 2026-07 fresh mk2 discovery capture, verified
> against `apc_mini_mk2.yaml`. If you re-layout the surface, edit the YAML
> **and** this file together.

---

## Faders (CC)

| Fader | CC | Function | Notes |
|------:|---:|----------|-------|
| 1 | 48 | Mixer channel 0 fader (`mixerLayerFader` layer 0) | Deck tab: the single deck channel. |
| 2 | 49 | Mixer channel 1 fader (layer 1) | |
| 3 | 50 | Mixer channel 2 fader (layer 2) | |
| 4 | 51 | Mixer channel 3 fader (layer 3) | **The 4th-fader fix**: CC 51 was previously an unmapped LEARN fader, so fader 4 moved nothing. Now bound to the 4th mixer channel. |
| 5 | 52 | Local param (MIDI-learn) | Bound at runtime per-pattern on the focused channel — not statically mapped. |
| 6 | 53 | Local param (MIDI-learn) | |
| 7 | 54 | Local param (MIDI-learn) | |
| 8 | 55 | Local param (MIDI-learn) | |
| 9 | 56 | **MASTER** brightness (`master`) | Grand master 0..1. |

CC 48–55 are Faders 1–8; CC 56 is Fader 9 (master).

---

## Top soft-button row (notes 100–103) — FOCUS channel

Pressing one **focuses** that mixer channel, so the MFT hue / local-param
faders drive its active pattern (the same single focused channel the on-screen
mixer FOCUS button and the MFT follow — one focus at a time).

| Button | Note | Function | LED |
|--------|-----:|----------|-----|
| Volume | 100 | Focus channel 0 (`focusChannel` layer 0) | Solid on the focused channel; **blinks** while a bound fader is pickup-locked; dark otherwise. |
| Pan | 101 | Focus channel 1 (layer 1) | as above |
| Send | 102 | Focus channel 2 (layer 2) | as above |
| Device | 103 | Focus channel 3 (layer 3) | as above |

On the Deck tab only channel 0 exists (auto-focused), so 101–103 stay dark.

---

## Arrows (notes 104–107) — UNASSIGNED

| Button | Note | Function | LED |
|--------|-----:|----------|-----|
| Up | 104 | *(unassigned)* | **Driven dark** (`ledOff`) |
| Down | 105 | *(unassigned)* | **Driven dark** |
| Left | 106 | *(unassigned)* | **Driven dark** |
| Right | 107 | *(unassigned)* | **Driven dark** |

These carry no control, but "absent from the profile" is **not** enough to keep
them dark: the APC latches whatever LED it last held, so an unmapped button
that was ever lit stays lit. Each therefore gets an explicit `ledOff` control —
inert on press, but projected at velocity 0 so a note-off is sent on connect
and held dark thereafter (codex P0: loud silence made visible on the hardware,
not a wrapped no-op).

---

## Right-column scene-launch buttons (notes 112–119)

| Button | Note | Function | LED |
|--------|-----:|----------|-----|
| Clip Stop | 112 | **Combined AUTOPILOT toggle** (pattern + colour) | Lit when the autopilot is on (see below) |
| Solo | 113 | *(unassigned)* | Driven dark (`ledOff`) |
| Mute | 114 | *(unassigned)* | Driven dark |
| Rec Arm | 115 | *(unassigned)* | Driven dark |
| Select | 116 | *(unassigned)* | Driven dark |
| Drum | 117 | *(unassigned)* | Driven dark |
| Note | 118 | *(unassigned)* | Driven dark |
| Stop All Clips | 119 | **BLACKOUT toggle** (e-stop) | Lit when blacked out |

### Clip Stop (112) — combined autopilot toggle

Operator contract: **press → if BOTH autopilots (pattern AND colour) are on,
turn BOTH off; otherwise (either one off) turn BOTH on.**

The engine runs two independent deck autopilots — the **pattern** autopilot
(`/autopilot`, cycles patterns) and the **colour** autopilot
(`/deck/color-autopilot`, cycles palettes). Clip Stop drives them as one.

**Colour-unconfigured degrade.** The engine rejects *every*
`/deck/color-autopilot` write — in **both** directions — unless a **non-empty
palette set** is configured (strict validation, codex P0). Out of the box no
palettes are set, so the colour autopilot can never be on. In that state
Clip Stop degrades to a **pure pattern toggle**: it writes only the pattern
autopilot, skips the guaranteed-400 colour write, and the LED tracks the
pattern autopilot alone. Configure a palette set (deck → **AUTOPILOT COLORS**)
to get the full both-flip-together behaviour and a LED that requires both on.

> This degrade is the fix for the "Clip Stop doesn't toggle on hardware" bug:
> the old code always posted the colour write, which 400'd on the empty default
> palette set. The pattern write had already landed, so the press half-applied
> and returned an error — and because "both on" was unreachable, the both-aware
> direction could never turn anything off, so the light looked stuck.

**LED.** Lit when "the autopilot is on" as the operator reads it — i.e. the
state a press turns off:
- palettes configured → lit when **both** autopilots are on;
- no palettes → lit when the **pattern** autopilot is on.

It tracks state from any surface (a screen toggle, the Clip Stop press, the
idle auto-disable) via the engine's `autopilot` / `colorAutopilot` WS
broadcasts.

### Stop All Clips (119) — blackout toggle

Toggles the engine's e-stop **blackout** — the same unified GEM blackout the
on-screen e-stop uses (`POST /global-effect-macros/blackout { enabled }`),
which blacks out pixels and clears active macros / global effects. The toggle
direction reads the current `blackout` state the app already tracks; the shared
`blackoutToggle` dispatch adds optimistic-echo protection for a panic
double-tap. LED lit when blacked out. (This button previously did a master
fade; that was dropped by operator decision 2026-07.)

---

## Shift (note 122)

| Button | Note | Function | LED |
|--------|-----:|----------|-----|
| Shift | 122 | **Toggle Deck ↔ Mixer view** (`viewToggle`) | none (protocol: light-less button) |

Reads the active tab and navigates the other. From a non-Deck/Mixer tab (e.g.
Config) it lands on the Deck.

---

## Grid pads (8×8, notes 0–63)

Unchanged from the prior layout. Columns 1–4 are a per-channel playlist
browser; columns 5–8 are colour-pair pads.

| Columns | Function | LED |
|---------|----------|-----|
| 1–4 | Per-channel **playlist window browser**: bottom pad scrolls down, top pad scrolls up, middle 6 pads select within a 6-entry window. Column *c* browses channel *c*'s playlist. | Active entry green, selectable blue, empty slots a dim frame; absent channel's whole column dark; scroll pads white only when scrollable. |
| 5–6 | **Colour-pair pads**, palettes 1–8 (bank 0). Each row = one curated CaptainPad palette; pressing applies the pair (col 5 → colorPalette1, col 6 → colorPalette2). | Pads show the palette hues (col 5 shows colour 1, col 6 shows colour 2). |
| 7–8 | Colour-pair pads, palettes 9–16 (bank 1). | as above |

---

## How the code maps this

The map is data, resolved by a small set of shared pieces — no per-button
special cases:

- **`CaptainPad/midi_profiles/apc_mini_mk2.yaml`** — the authoritative binding
  list. Each control has a `match` (note/cc/column) and an `action` (the *kind*
  below), plus optional `led` velocities. The **deck** and **mixer** tabs share
  one unified control list (a YAML anchor); only the channel targets differ per
  tab (deck channel vs. overlay layers), resolved by the active context.
- **`CaptainPad/utils/midi/profile.ts`** — loads and validates the YAML
  (a bad profile is fatal — fail loud).
- **`CaptainPad/utils/midi/manager.ts` + `resolver.ts` + `dispatch.ts`** —
  match an inbound event to a control, resolve its target for the active
  context, and dispatch the action; `led_projector.ts` paints feedback from the
  live engine snapshot.

Action **kinds** used by this surface:

| Kind | Buttons | What it does |
|------|---------|--------------|
| `mixerLayerFader` | faders 1–4 | Set a mixer channel's fader (`layer`). |
| `master` | fader 9 | Set the grand master. |
| `focusChannel` | 100–103 | Focus a mixer channel (`layer`). |
| `ledOff` | 104–107, 113–118 | Inert on press; projected at velocity 0 so the LED is driven dark and held. |
| `autopilotToggle` | 112 | Combined autopilot toggle. Decision logic in `utils/midi/apc_button_logic.ts` (`combinedAutopilotTarget` / `combinedAutopilotLedOn` / `colorAutopilotWritable`); the read-both / write logic in `hooks/useMidiControl.ts` (`toggleCombinedAutopilot`), injected as an api method. |
| `blackoutToggle` | 119 | e-stop blackout toggle. |
| `viewToggle` | 122 | Toggle Deck ↔ Mixer tab (`toggleDeckMixerView` in the hook). |
| `playlistScroll` / `playlistWindowSelect` | grid cols 1–4 | Playlist window browser. |
| `colorPalettePair` | grid cols 5–8 | Apply a curated colour pair (`bank`). |

The three buttons that need live app state (Clip Stop, Stop All Clips, Shift)
are implemented in `hooks/useMidiControl.ts` — the hook owns the router and the
engine reads — and injected into the manager as `api` methods, so the
manager/dispatcher stay pure and dependency-injected.
