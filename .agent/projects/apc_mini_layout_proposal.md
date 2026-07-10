# APC mini mk2 — freed-buttons layout proposal

**Date:** 2026-07-08 · **Status:** PROPOSAL (design-only; no code/yaml touched)
**Scope:** the 8 freed Scene-Launch column buttons (notes 112–119) + the four
arrow buttons (notes 100–103) per Deck/Mixer context. SHIFT (note 122) is
**decided**: press = flip Deck ↔ Mixer (app tab + MIDI context) — taken as
fixed here. Implementation belongs to the operator-started agent working
`CaptainPad/midi_profiles/apc_mini_mk2.yaml` + `utils/midi`; this doc only
says WHAT the mapping should be and why.

---

## 1. Current-state map (what's already taken)

### APC mini mk2 (`CaptainPad/midi_profiles/apc_mini_mk2.yaml`)

| Physical control | Notes/CCs | Current assignment |
|---|---|---|
| 8×8 grid, cols 1–4 | notes, column matches | Per-channel **playlist browsers** (layers 0–3): bottom pad scroll-down, top pad scroll-up, middle 6 = window select |
| 8×8 grid, cols 5–8 | column matches | **Colour-pair palettes** (16 curated pairs; cols 5–6 = bank 0, 7–8 = bank 1) |
| Faders 1–3 | CC 48–50 | Channel faders, layers 0–2 |
| Faders 4–8 | CC 51–55 | **MIDI-learn** local params on the FOCUSED channel (binding-first, per-pattern) |
| Fader 9 | CC 56 | Master brightness |
| Bottom row 1–3 | notes 100–102 | **Focus channel 1–3** (LED = focused; blink = pickup-locked) — *being reworked (these are the ▲▼◀ buttons)* |
| Bottom row 4–7 | notes 103–106 | Free (103 = ▶ arrow; 104–106 = Volume/Pan/Send legends) |
| Bottom row 8 | note 107 | **BLACKOUT e-stop** (blink while engaged) — *stays; muscle memory* |
| Scene column 1–8 | notes 112–119 | Global-effect slots 1–8 → **moved to VSN1 → FREED** |
| Shift | note 122 | **Decided: Deck ↔ Mixer flip** |

Hardware notes (from `apc_mini_mk2_reference.md`): the Scene column and bottom
row are **single-colour** LEDs (green column / red row) with only off / on /
blink (velocity 0/1/2). The Scene column's printed shift-legends top→bottom
are Clip Stop, Solo, Mute, Rec Arm, Select, Drum, Note, Stop All Clips; the
bottom row's first four legends are ▲ ▼ ◀ ▶ ("the arrows"). Shift has no LED.

### The other two surfaces (proposals must complement, not duplicate)

- **MFT** (`mft.yaml`): global SPEED (+BPM-sync push), per-channel HUE knob
  (+reset push), 12 focused-pattern param knobs, side buttons = focus
  prev/next/deck. Manual tap-tempo **deliberately not wired** (2026-06-17
  contract: Audio Companion is the sole tempo source).
- **VSN1** (`vsn1.yaml`): the entire global-effects surface — 8 keys × 4 pages
  = 32 effect slots, per-slot intensity encoders, mode cycle, page select.

### App capabilities not yet on any controller (grounded in code)

| Capability | Client API (existing — docs/34 says MIDI must dispatch through these) |
|---|---|
| Snapshots ("looks": full mixer state) — save / recall / **morph-recall** / delete | `channelExtrasApi.recallSnapshot`, `recallSnapshotFade`, `fetchSnapshots`; WS `snapshots` event (SnapshotBar.tsx) |
| Pattern-autopilot play/pause, shuffle, cadence, group mode, profile | `api.setAutopilot`, `setAutopilotProfile` (pattern_autopilot_panel.tsx) |
| Deck transitions on/off, style, duration, shuffle-style | `api.setDeckTransitionConfig` (DeckTransitionControls.tsx) |
| Colour autopilot on/off (independent palette cycler) | `api.setDeckColorAutopilot` |
| Timed grand-master fade TO BLACK / UP (1/3/5/10 s) | `masterApi.fadeMaster`; in-flight state on the mixer/deck WS broadcast (DeckTopBar.tsx) |
| Tap tempo / tempo re-sync / source pref | `channelExtrasApi.postTapTempo`, `postTempoSync` (use_tempo_tap.ts) — **contract question, see §6** |
| Per-channel SOLO (safe wrapper) | `groupsSoloApi.setChannelSoloSafe`, `clearAllSolo` |
| Per-channel BUMP (hold = flash to full) | `bumpApi.postBump` — **needs Note Off release wiring; resolver currently swallows releases** (dispatch.ts TODO) |
| Armed colour cue ("QUEUE" slot: pre-arm a palette pair, tap fires it) | CPCControls local state — would need lifting to a shared store |
| Channel reorder / duplicate / add / remove | `channelOpsApi` — deliberately NOT proposed for hardware (destructive, needs eyes on screen) |

---

## 2. Research notes (brief)

- **Ableton/APC convention:** the right-hand column launches **scenes** — whole
  looks, one press — and the arrows move the session window (the "red box"),
  i.e. they are *navigation*, not value nudges. Resolume VJs map the APC mini
  the same way: grid = clips, right column = whole-column/scene triggers
  ([Resolume forum](https://resolume.com/forum/viewtopic.php?t=22233),
  [Resolume MIDI shortcuts](https://resolume.com/support/en/midi-shortcuts),
  [DocOptic external-control tutorials](https://docoptic.com/tag/resolume-6-training-control/)).
- **Lighting busking practice:** operators build around playbacks that recall
  full looks plus a handful of bump/flash buttons; the winning trait is a
  layout you can hit **without looking**, grouped by concept, with everything
  reachable from the main view
  ([ControlBooth busking-layout thread](https://www.controlbooth.com/threads/lighting-console-layout-for-busking-looking-for-suggestions.50150/),
  [On Stage Lighting — essential busking pages](https://www.onstagelighting.co.uk/console-programming/essential-busking-page-lighting-control/),
  [Church Production — cueing vs busking](https://www.churchproduction.com/education/lighting-cueing-vs-busking/)).
- **Ergonomics in the dark:** edge buttons beat interior ones (findable by
  feel); a column split into two 4-blocks is countable by thumb; toggles need
  LED state truth; anything destructive stays off hardware or far from
  frequently-hit keys (blackout at 107, bottom-right corner, already follows
  this).

Applied to us: the freed column *is* our scene-launch column → **looks
(snapshots) + ride toggles**; the arrows *are* navigation → **focus + window
paging**, not parameter nudges (consistent with Sina rejecting
transition-time and autopilot next/prev on arrows).

---

## 3. Scheme A — "Looks & Ride" ★ RECOMMENDED

**Concept:** Scene column = top 4 recall **LOOKS**, bottom 4 **RIDE toggles**
(the "let it run" switches). Same in both contexts — a look and the autopilot
are global, so the column never changes meaning when Shift flips. Arrows =
navigation, context-flavoured: Deck arrows drive colour/look moves, Mixer
arrows drive the focused channel. Direct focus 1–3 moves three buttons right
(104–106), so nothing is lost.

### Scene column (notes 112–119) — identical in Deck and Mixer

| # (top→btm) | Note | Assignment | LED (on/blink/off) | Why |
|---|---|---|---|---|
| 1 | 112 | **SNAPSHOT slot 1** — recall (instant) | on = slot has a look; blink = morph in flight / last recalled | One-press full-look recall = the highest-value busking move; matches the scene-launch metaphor exactly |
| 2 | 113 | **SNAPSHOT slot 2** | 〃 | 〃 |
| 3 | 114 | **SNAPSHOT slot 3** | 〃 | 〃 |
| 4 | 115 | **SNAPSHOT slot 4** | 〃 | 〃 |
| 5 | 116 | **AUTOPILOT play/pause** (`setAutopilot({active})`) | on = playing | "It rides vs I drive" is *the* mode switch of a long night shift |
| 6 | 117 | **PATTERN SHUFFLE toggle** (`setAutopilot({shuffle})`) | on = shuffle | Energy character without opening the panel |
| 7 | 118 | **DECK TX on/off** (`setDeckTransitionConfig({enabled})`) | on = enabled | Hard-cut vs crossfade feel, one press (style/duration stay in UI) |
| 8 | 119 | **MASTER FADE toggle** — fade to black over 3 s; press again = fade back up (`masterApi.fadeMaster`) | blink = fading; on = parked at black | The *graceful* end-of-song dip. Deliberately adjacent to but distinct from 107 BLACKOUT (hard e-stop + effect clear) |

### Arrows (notes 100–103)

| Arrow | Deck context | Mixer context |
|---|---|---|
| ▲ Up (100) | **FIRE armed colour cue** — send the QUEUE-armed palette pair live (the "drop" button: arm during the build, hit on the hit) | **FOCUS prev** (`focusStep dir:prev` — already implemented for MFT) |
| ▼ Down (101) | **TAP TEMPO** (`postTapTempo`) — *pending Q2; fallback = colour-autopilot toggle* | **FOCUS next** (`focusStep dir:next`) |
| ◀ Left (102) | **SNAPSHOT page ◀** — repoint column slots 1–4 at the previous window of 4 saved looks (LEDs repaint) | **SOLO toggle** on the focused channel (`setChannelSoloSafe`; LED on = soloed) |
| ▶ Right (103) | **SNAPSHOT page ▶** | **BUMP focused channel** — hold = flash to full, release = back (`postBump`) — *needs release wiring, see §5/Q3* |

### Rest of the bottom row

| Button | Note | Assignment |
|---|---|---|
| 5–7 | 104–106 | **FOCUS channel 1–3 direct** (relocated from 100–102, same LED semantics incl. pickup-blink) |
| 8 | 107 | **BLACKOUT e-stop** — unchanged |

**Why this wins:** every button is a live *move*, not a config edit; the
column reads as two thumb-countable 4-blocks with one meaning across contexts;
the arrows stay navigation (Ableton instinct) and give the Mixer a complete
focused-channel workflow (choose with ▲▼, punctuate with ◀ solo / ▶ bump)
one-handed while the other hand rides faders. Snapshots finally get hardware,
which no current surface offers.

**Trade-offs:** snapshot slots need a deterministic ordering rule (Q1); the
armed-cue fire needs a small app refactor; bump needs the release path (can
ship press-only v1 without ▶ bump).

---

## 4. Alternative schemes

### Scheme B — "Channel strip column" (mixer-first)

Column = per-layer ops, Ableton track-button style rotated onto the column:

| # | Notes | Assignment |
|---|---|---|
| 1–4 | 112–115 | **FOCUS layer 1–4** (LED on = focused, blink = pickup-locked) |
| 5–8 | 116–119 | **SOLO layer 1–4** (Mixer); inert on Deck (single channel) |

Arrows — Deck: ◀▶ snapshot page, ▲ fire colour cue, ▼ autopilot play/pause;
Mixer: ▲▼ playlist-scroll the *focused* channel (nearer than reaching into the
grid), ◀▶ move the focused channel down/up the blend stack
(`reorderMixerChannels`).

*Pros:* strongest per-channel story; direct focus grows to 4 layers; solo
returns to hardware. *Cons:* half the column is dead on the Deck tab — the
primary performance surface; snapshots/autopilot get no buttons (or crowd the
arrows); solo was already deliberately dropped from the controller once
(2026-06 focus-model redesign) — re-adding 4 solo keys re-litigates that.

### Scheme C — "Transport wall" (deck-first, no snapshots)

Column = all eight ride toggles: play/pause, shuffle, group mode,
colour-autopilot, deck TX, TX shuffle-style, tempo re-sync (`postTempoSync`),
master-fade. Arrows — Deck: ▲▼ autopilot cadence step through the preset
ladder, ◀▶ transition style step; Mixer: ▲▼ focus prev/next, ◀▶ snapshot
prev/next (sequential recall).

*Pros:* the whole autopilot/transition panel leaves the screen; zero new
runtime models (all simple toggles). *Cons:* eight look-alike toggles are
hard to tell apart in the dark with single-colour LEDs; cadence/style steps on
arrows are value-nudges of exactly the flavour Sina already rejected twice;
looks (the highest-value recall) stay screen-only.

---

## 5. New hooks needed (Scheme A)

All dispatch through **existing** client functions — no new engine surface
(docs/34 constraint holds). Per item: new profile `action.kind` +
resolver/dispatch case unless noted.

1. **`snapshotSlot { slot }`** → `recallSnapshot(name)` (or
   `recallSnapshotFade(name, 3)` if morph-by-default is wanted). Runtime needs
   a snapshot-list model: seed `fetchSnapshots()`, reconcile on the WS
   `snapshots` event; slot = page×4 + index → name; LED projection from the
   list + morph/last-recalled state.
2. **`snapshotPage { dir }`** — runtime-only (like `playlistScroll`): moves the
   4-slot window over the saved-look list, repaints LEDs.
3. **`autopilotToggle`** → `setAutopilot({ active })` — needs live autopilot
   state in the MIDI snapshot (deck screen already tracks it via WS; lift into
   `useMidiControl`'s snapshot) for toggle-base + LED. Same optimistic-echo
   guard pattern as `blackoutToggle`.
4. **`autopilotShuffleToggle`** → `setAutopilot({ shuffle })` (state as above).
5. **`deckTxToggle`** → `setDeckTransitionConfig({ enabled })` (live config in
   snapshot for LED).
6. **`masterFadeToggle { durationS }`** → `masterApi.fadeMaster` — target 0
   when not parked/fading-down, else 1; LED from the `masterFade` WS state
   (already broadcast — DeckTopBar consumes it).
7. **`colorCueFire`** → the armed-pair state currently lives inside
   `CPCControls` component state; lift to a shared store (module-level, like
   `engineEvents`) so the runtime can read/fire/clear it. Moderate app
   refactor — the only item touching UI code.
8. **`soloFocusedToggle`** → `setChannelSoloSafe` on the focused channel;
   soloed-ids already ride the mixer broadcast.
9. **`bumpFocusedHold`** → `postBump(id, true/false)` — **requires wiring Note
   Off releases through `resolveEvent`** (documented TODO in dispatch.ts: v1
   swallows every Note Off). Ship-without: leave ▶ unbound in v1.
10. **Focus relocation** — `focusChannel` bindings just renumber to 104–106;
    `focusStep` on ▲▼ (Mixer) already exists (MFT side buttons).

LED constraint reminder: column/row buttons are single-colour, off/on/blink
only — "slot exists" must be on/off, no colour coding.

---

## 6. Open questions for Sina

1. **Snapshot slot ordering / naming.** The 4 slot buttons need a stable
   slot→look rule for muscle memory. Options: (a) alphabetical over all saved
   looks with ◀▶ paging (proposed); (b) a reserved naming convention (e.g.
   `apc_1`…`apc_8`) so slots are pinned and paging is unnecessary; (c)
   most-recently-saved first. Which one? (a) is zero-convention but pages can
   shift when looks are added; (b) is the most muscle-memory-safe.
2. **Tap tempo on hardware.** The 2026-06-17 contract made Audio Companion the
   sole tempo source and deliberately kept TAP off the MFT — but the tap/tempo
   arbitration path exists and the iPad UI exposes it. Does the APC rework
   revisit that (▼ Deck = TAP), or keep tempo off controllers (▼ Deck falls
   back to colour-autopilot toggle)?
3. **Hold gestures now or later?** BUMP (▶ Mixer, hold-to-flash) needs Note
   Off releases wired through the resolver — a real but contained runtime
   change that also unlocks the engine's 'hold' effect behavior later. Invest
   now, or ship press-only v1 (drop bump, keep solo) and add it after?

---

*Prepared read-only; no profile/yaml/code was modified. Sources: Resolume
forum/support + DocOptic (APC-mini VJ conventions), ControlBooth + On Stage
Lighting + Church Production (busking layout practice) — linked in §2.*
