# 59 — FOLLOW NOTE colour mode + method autopilot + live retune

**Status:** DESIGN (report `_244`, Fable). Awaits an Opus implementer.
**Operator order (verbatim):** *"can you add a new option in the color to use
the note as the main color. I want to follow note for colors and then use the
different select color palette ideas (what are they called?) [scheme
generators] on a timer or sth like an auto pilot color. follow note, and have
the method cycling smoothly on a timer is what I want for the colors as a new
feature."* Follow-up: *"the color crossfade effects and palette turns are
awesome, add follow note, and method switch too. also make sure the changing
of the parameters for those existing ones too doesn't need a full stop and
start again."*

Decoded, two features:

1. **FOLLOW NOTE** — a third rotation family on the deck colour daemon. The
   live detected musical note drives the BASE HUE; the SCHEME GENERATOR
   (docs/55 §2.1 — MASTER/HUE/COMPLEMENT/CONTRAST + the `_224` five) being
   applied to that hue cycles on its own timer with smooth crossfades: the
   *method autopilot*.
2. **LIVE RETUNE** — changing the parameters of ANY running rotation
   (crossfade, TURNS, follow-note) applies in place. No stop→reconfigure→
   start, no phase reset, no snap.

Composes with `_224` (TURNS/shared transport/pair selection), `_242` (dial +
preset palettes — assumed landed before implementation) and `_217` (crossfade,
lerpHue parity idiom). Zero product code was edited by this design.

---

## 1. Mode semantics

FOLLOW NOTE is **a mode of the ONE colour daemon**, not a sibling daemon.
There is exactly one writer of `colorPalette1/2` behind the autopilot gate
today (`lib/color_autopilot.js`, docs/53 §4.4) and this feature keeps it that
way: mutual exclusion with TURNS / crossfade / palette-set is **by
construction** — one daemon, one mode at a time — not by a second active flag
every surface would have to remember to check.

While the mode runs, at every instant the rig shows:

```
ring = generateScheme(currentMethod, currentNoteHue)   // five colours
colorPalette1 = ring[sel[0]]                           // default sel = [0,1]
colorPalette2 = ring[sel[1]]
```

Two independent things move it:

- **The NOTE** (event-driven): when the committed pitch class or its
  configured hue changes, the ring re-derives and the pair slews to the new
  colours over `noteFadeMs`.
- **The METHOD** (timer-driven): every `methodHoldS` the daemon advances to
  the next generator in the operator's cycle subset and crossfades the pair to
  the new ring over `methodFadeS` — CONTRAST for a while, fading into
  TRIADIC, into ANALOGOUS, exactly the "auto pilot color" asked for. Hold and
  fade are ADDITIVE, the same scheduling contract the palette cycle already
  locks (operator ruling 2026-07-03).

The rotation "window" dimension of TURNS (sliding adjacent pairs) is
deliberately NOT layered on top: in this mode the hue axis belongs to the
music and the variety axis belongs to the method cycle. Adding a third
rotation axis would make the card unreadable and the writes unattributable.

## 2. The note signal — engine anchors (design question 1)

**The engine already has the note.** No new signal path is needed:

- The audio companion's `DerivedSignals`
  (`marsin_engine/audio/signals/derived_signals.js`) publishes
  `audioNote` (committed pitch class 0–11) and `audioNoteHue` (hue 0–1)
  every hop, and **holds the last committed note through silence** —
  `_heldPc/_heldHue`, test-pinned in
  `tests/audio/note_estimator_synthetic.test.js` ("audioNote should HOLD E
  through silence, not blink to C").
- They reach the engine CPC via the registered postproc keys
  (`marsin_engine/audio/postproc/audio_signals.js:116-117`, OSC
  `/marsin/audio/note` + `/marsin/audio/notehue`, 10 Hz).
- The stability is already engineered upstream: `note_estimator.js` commits a
  pitch-class change only after mode-window consensus + hold hysteresis
  (`holdHops`/`nearHoldHops`/`minConsensus`), specifically "so that hue
  doesn't strobe". The daemon consumes committed notes; it adds no second
  debounce.
- Precedent consumer: `lib/autopilot_profiles/audio_reactive_profile.js`
  already reads `audioNoteHue`/`audioNote` from the engine CPC to recolour.

So the loop runs **engine-side, inside the daemon** — deadman rule satisfied;
Live Touch's client-side `audionote` listener is irrelevant to the rig path.

**Note → hue mapping: `audioNoteHue`, NOT a fresh Scriabin port.** Live
Touch's FOLLOW NOTE uses its own client-side Scriabin table with per-note S/V
(`CaptainPad/live_touch/touch_control.html:3401-3414`). The engine's canonical note→colour
system is the **companion's configurable `noteColors` wheel**
(`audio/config/derived_signals_config.js`, editable in the companion UI,
circle-of-fifths layout, hue-only by design — "it never dims the color or
reduces saturation"). The daemon consumes that. Reasons:

1. One mapping, operator-tunable in one place. Porting Scriabin's HSV table
   into the engine would create a second note→colour authority that can
   disagree with the wheel the companion UI edits.
2. `generateScheme(scheme, baseH)` takes a **base hue only** and supplies
   S/V itself (docs/55 §2.1) — a hue-only input is exactly the right shape.
   Scriabin's S/V variation could not ride through the generators anyway.
3. Honest divergence, stated: Live Touch FOLLOW NOTE re-runs its generator on
   Scriabin HSV; rig FOLLOW NOTE re-runs the generator on the companion wheel
   hue. W9 ships a one-tap **"Scriabin" preset** for the companion's
   `noteColors` wheel (the 12 hue values from `touch_control.html:3401-3414`)
   so the operator can make the two agree if he wants them to.

## 3. The engine generator table (design question 1, continued)

The nine generators' math lives client-side only
(`CaptainPad/components/deck/colors_window_logic.ts:554-680`) and the engine
must re-derive the ring on every note change — precomputed client rings
cannot work. The math is small and pure (a base-S constant, two step tables,
`rotateHue`, one switch), so it is **ported** to a new engine module:

**`marsin_engine/lib/color_schemes.js`** — exports byte-equivalent
`SCHEME_IDS`, `SCHEME_BASE_S = 0.95`, `MONO_STEPS`, `COMP_OFFSETS`,
`SCHEME_MIN_V = 0.1`, `SCHEME_ROTATION_MIN_V = 0.25`, the `_224` step tables,
`GOLDEN_ANGLE_DEG = 137.5`, `rotateHue`, `schemeFromSteps`, `generateScheme`
(throws on unknown id, codex P0). No imports from CaptainPad; two
implementations, one contract.

**Parity is pinned the `lerpHue` way (_217 D1 idiom):** one REFERENCE TABLE of
exact expected outputs lives in BOTH suites —
`marsin_engine/tests/effects/color_schemes.test.js` and
`CaptainPad/components/deck/colors_window_logic.test.ts` — asserting, for
every scheme id at base hues `0`, `0.25`, `0.61803`, the full five `{h,s,v}`
triples to 1e-12. A change to either implementation breaks a test on both
sides; the client's staged ring and the engine's live ring can never drift.

## 4. Daemon design — wire, loops, writes

### 4.1 Wire shape (one front door, extended)

The `colorAutopilot` wire (persisted + REST + cue contract) gains a mode
discriminator. **Absent `mode` ≡ `'palettes'` — every existing config is
byte-unchanged and byte-understood.**

```yaml
colorAutopilot:
  active: true
  mode: followNote            # 'palettes' (default) | 'followNote'
  followNote:
    schemes: [complement, contrast, analogous, triadic, split, tetrad, golden]
    methodHoldS: 60           # >= 0; 0 = continuous method morphing
    methodFadeS: 3            # > 0; hold 0 requires fade >= 0.1 (spin-loop rule)
    noteFadeMs: 400           # >= 0; 0 = snap (Live Touch behaviour)
    sel: [0, 1]               # which two ring slots feed A/B (indices)
    shuffle: false            # method pick order
```

`ColorAutopilot.validate` grows the matching rules, throw-style (codex P0):

- `mode` must be `'palettes'`/`'followNote'`/absent; anything else throws.
- `mode:'followNote'` requires a `followNote` block and **forbids**
  `palettes`/`delay_s`/`transitionMs`/`shuffle` at top level (exactly one
  mode's fields may be present — a config carrying both would let the two
  halves disagree about what is running).
- `followNote.schemes`: non-empty array of unique known ids from the ported
  `SCHEME_IDS` — unknown id throws with the id named.
- `methodHoldS >= 0`; `methodFadeS > 0`; `methodHoldS === 0` requires
  `methodFadeS >= 0.1` (the existing `MIN_CONTINUOUS_TRANSITION_MS` rule,
  same refusal sentence family). `noteFadeMs >= 0`, finite.
- `sel`: two distinct integers in `[0,5)`.
- `mode:'palettes'` (or absent) additionally **forbids** a `followNote`
  block? No — it is *allowed and inert* (carried, not applied), so a mode
  toggle round-trips the operator's follow-note tuning instead of erasing it.
  This is stored config, not a fallback: nothing ever *reads* the inert block
  to make a decision.

### 4.2 The two loops

**Method timer** — the existing generation-guard timer model, verbatim: wait
`methodHoldS` → advance `currentMethod` to the next entry of `schemes`
(sequential cursor, or the existing avoid-repeat random pick under
`shuffle`) → tween the pair to the new ring over `methodFadeS` (AWAITED, so
hold+fade stay additive) → reschedule. `onSchedule` re-broadcasts
`nextMethodAtMs` for the card countdown, the `_211` idiom.

**Note listener** — event-driven, via injected hooks (api_server wires
`getSignal: (k) => paramCenter.get(k)` and
`subscribeSignals: (fn) => paramCenter.subscribe(fn)` —
`lib/param_center.js:499`). On each CPC mutation event the daemon reads
`(audioNote, audioNoteHue)`; if the pair is unchanged from the last applied
values it **bails before doing anything** (the subscriber fires at hop rate;
the compare is two floats — allocation-free discipline). On change it
re-derives the ring and tweens over `noteFadeMs` (`0` = direct
`applyParams`, a snap). Subscribing beats polling: zero work while the note
holds, and no third clock. The subscription is taken on activate and released
on stop/deactivate — profile-style lifecycle
(`audio_reactive_profile.js` `_unsub` precedent).

**One tween, latest event wins.** Both loops share the daemon's existing
single `_tween`: any new event cancels the in-flight fade and ramps **from
`_currentParams`** (wherever the fade actually is — the freeze-in-place
semantics `_cancelTween` already guarantees) to the freshly derived target,
over the event's own duration. Deterministic rule, no queue: the target is
always `generateScheme(currentMethod, currentNoteHue)` picked through `sel`;
`currentMethod` advances at fade *start*. No dark frame is possible because
every write is an interpolation from the live params. `lerpParams`/`lerpHue`
(short-arc) is untouched.

**Write discipline:** all writes go through the injected `applyParamsFn` —
the same `paramCenter.set(k, v, 'colorAutopilot')` path
(`api_server.js:6039`) every palette tick uses today. Attribution never
changes; "a colour rotation is driving" stays literally true.

### 4.3 Broadcast, persistence, timeline

- `colorAutopilotState()` (`api_server.js:6066`) adds `mode`, the
  `followNote` config, and runtime facts the card renders from:
  `{ currentScheme, notePc, noteHue, nextMethodAtMs }`. One payload shape for
  the REST reply and the WS `colorAutopilot` frame, as today.
- Persistence: the runtime file already carries the whole `colorAutopilot`
  block (`saveConfig`) — mode + followNote ride along free. Crash-boot with
  `active:true, mode:followNote` resumes following on start().
- Timeline: `setColorAutopilot` dep (`api_server.js:6519/6789`) accepts the
  new wire unchanged — a cue can arm follow-note. `deactivate()` (deck-pin
  release, docs/38 §16.11) is mode-agnostic and needs only the unsubscribe
  added to `stop()`.
- CaptainPad's ADD CUE and EDIT CUE surfaces expose the same mode discriminator
  directly: `2 TONE`, `5 TONE`, and `FOLLOW NOTE`. Follow Note authors the
  scheme subset plus method hold/fade and note-fade timing; cue save strips the
  broadcast-only runtime facts. Saved palette sets remain available as a
  compatibility mode for existing plans.
- `show_plan.js` delegates cue validation to this same
  `ColorAutopilot.validate` contract. The cue path therefore accepts the exact
  Deck wires, including continuous palette fades (`delay_s: 0` with a safe
  transition) and mode-scoped Follow Note blocks.
- MIDI: `colorAutopilotWritable` (CaptainPad `useMidiControl.ts:1398`)
  derives writability from `palettes` alone and would call a follow-note
  config un-toggleable — it must learn `mode` (writable when
  `mode:'followNote'` and the block validates). Covered in W6.

## 5. LIVE RETUNE — all three rotation families (operator follow-up)

Today every knob change posts a full config through `setState`, which bumps
`generation` (killing the in-flight tween), resets the cursor to −1 and
re-arms the hold from zero — a running rotation visibly restarts. `_230`
already set the idiom for the pattern daemon: a **sparse patch route** that
retunes live ("only the knob that moved is sent, so setting `durationMs`
cannot silently clear `mode`").

### 5.1 `ColorAutopilot.patchState(sparse)` — the new daemon method

Validates each supplied field with the SAME validators as `validate()`
(throw-style), then applies with these semantics — the load-bearing rule is
**`patchState` NEVER bumps `generation` and NEVER cancels the tween**:

| Field | Applies | Mechanism |
|---|---|---|
| `delay_s` / `followNote.methodHoldS` | immediately, phase-preserving | re-arm the pending timer to fire at `lastTickAtMs + newHold` (fire now-ish when already past); if no timer is armed (a fade is in flight) do nothing — the post-fade `_scheduleNext` reads the new value fresh. `onSchedule` re-broadcasts the countdown. |
| `transitionMs` / `followNote.methodFadeS` / `noteFadeMs` | next fade | an in-flight fade completes at its own duration; the very next transition uses the new one. UI says so (§7). |
| `palettes` (ring restage / re-point) | next transition | replace the array; cursor preserved (clamped into the new length); pending timer untouched. The scheduled tick reads `this.state` fresh at fire time, picks the next entry of the NEW ring and fades **from `_currentParams`** — seamless restage, no dark frame, no cut. |
| `shuffle` / `followNote.shuffle` | next pick | plain field swap. |
| `followNote.schemes` | next method advance | if the current scheme was removed it finishes its hold; the next advance picks from the new subset. |
| `followNote.sel` | immediately | retween to the newly selected pair over `noteFadeMs` — a pair re-selection is a colour choice *now*, matching `_224`'s immediate sel writes. |
| `active`, `mode` | **refused** | start/stop and mode changes are takeovers: they stay on `setState` (full replace, generation bump, clean break). The refusal names the field. |

Supporting change: `_runTick` records `this._lastTickAtMs = this._now()` when
it fires (one line; needed for the phase-preserving re-arm).

Why the generation guard makes this safe rather than scary: the pending tick
captured its gen at schedule time and `patchState` never bumps it, so the
tick still fires — but everything it *reads* (`this.state`, the ring, the
durations) it reads fresh at fire time. The reset behaviour of `setState` was
never in the tick; it was in the bump + cursor reset, which patch simply
doesn't do.

### 5.2 Front door + client

- **`PATCH /deck/color-autopilot`** (new method on the existing route,
  `api_server.js:9363-9368`): sparse body → `patchState` → broadcast → state
  reply. `POST` keeps its full-replace semantics, byte-unchanged. A PATCH
  while `active:false` edits the parked config (no timers to re-arm).
- Client (`colors_window_logic.ts`): pure helpers
  `retunableLive(kind, field): boolean` (the table above as code) and
  `rotationRetunePatch(fields)` (the sparse body builder). The shared
  transport pill rows (`colors_window.tsx` `SharedTransportRows`, ~:1209)
  switch from "post full config" to "PATCH the moved field" whenever the
  daemon is running the same kind; when parked or a different kind is
  running, the pills keep today's stage-only behaviour.
- `_224`'s one-tap scheme **restage** (`schemeTapOutcome` → `'restage'`)
  becomes a `palettes`-only PATCH instead of a full re-post — the ring swaps
  at the next transition with cadence, fade AND phase intact. Message text
  unchanged.

### 5.3 Acceptance (provable in the offline walk, fake clock)

- A running crossfade retimed HOLD 2 s → 10 s mid-hold: zero `applyParams`
  calls outside tweens (no snap), `nextSwapAtMs === lastTickAtMs + 10 000`,
  cursor unchanged, the in-flight nothing (it was holding) undisturbed.
- FADE 0.4 s → 3 s patched mid-fade: the current fade lands at 0.4 s, the
  next runs 3 s.
- A TURNS ring restaged to a different scheme's five colours mid-hold: the
  next tick fades from the live params to the NEW ring's next pair; no write
  lands between patch and tick.
- Follow-note `schemes` subset swapped mid-hold: current method finishes its
  hold, next advance is from the new subset.
- `patchState({active:false})` throws; generation is untouched by every
  accepted patch (asserted directly).

## 6. Single-writer composition (design question 2, second half)

- `rotationKind` (client, `colors_window_logic.ts:804`) gains
  `'follow-note'`, decided by the broadcast `mode` — not inferred from
  palette shapes.
- `manualWriteGate` (:827) is **unchanged**: it is deliberately
  kind-agnostic and its sentence ("A colour rotation is driving the colours —
  pause it to edit.") remains true. Wheel/dial drags, Live Touch chips, saved
  pairs, preset loads: all refused with that sentence while following, same
  as under any rotation.
- `schemeTapOutcome` (:862) gains the row:
  `'follow-note'` → **`method-override`**: a config write through the
  daemon's own front door (a `PATCH {followNote:{schemes:[tapped]}}`? No —)
  it PATCHes `schemes` to put the tapped generator NEXT and advances the
  method at the next boundary… **Decided simpler and honest:** tapping a
  scheme chip while following PATCHes nothing structural; it sets
  `currentMethod` via a dedicated sparse field `followNote.method` (validated
  member of `schemes` ∪ tapped id) and the daemon tweens to it over
  `methodFadeS` now, then resumes the cycle from there. Message: `"Method set
  to TRIADIC — cycle continues from here."` This is the `_224` `'restage'`
  idiom (single writer never changes hands), scoped to the method axis.
- START TURNS / crossfade RUN while following: allowed, explicit takeover —
  full `setState` replaces the mode, exactly as START TURNS already takes
  over a palette-set. **Nothing ever silently auto-pauses** (`_211` §D): the
  follow-note card's STOP is the only implicit-free pause, and every
  stage-only refusal names the button that would take over.

## 7. UI spec (design question 3)

**Placement:** a third transport card — **FOLLOW NOTE** — in the COLORS
window's mode transport region (`colors_window.tsx` ~:868), sibling to
CROSSFADE and PALETTE TURNS, reachable the same way those two are. It
composes with `_242` untouched: the dial stays the manual base-hue editor
(gated by `manualWriteGate` while following, as today under any rotation);
presets stay a manual-path feature (loading one is a manual write → same
gate, same sentence).

**Card contents, top to bottom:**

1. **State line** (derived from broadcast only — deadman): parked →
   `"FOLLOW NOTE — parked"`; running →
   `"NOTE IS DRIVING — E · TRIADIC → SPLIT in 42s"` (note letter from
   `notePc` via the client's `NOTE_NAMES`, current/next method, countdown
   rendered from `nextMethodAtMs` exactly like the `_211` autopilot
   countdown). Silence (`audioSilence` ≥ 0.5 from sharedParams) appends
   `"· HOLDING LAST NOTE (audio silent)"`.
2. **Method chips** — the nine generators as toggle chips in `SCHEME_TITLES`
   row order; lit = in the cycle. Default subset: the seven multi-hue
   generators (`complement, contrast, analogous, triadic, split, tetrad,
   golden`). MASTER and HUE ship off — they render the pair monochrome, and
   the mission's night-visibility bias wants two-hue pairs by default — but
   they are one tap away (a monochrome beat in the cycle is a legitimate
   choice, the operator's to make). Emptying the subset is refused with a
   sentence ("The cycle needs at least one method."), mirroring the engine's
   validator. While running, chip toggles PATCH live (§5).
3. **METHOD HOLD pills** — `[10, 30, 60, 120, 300]` s, default **60 s**, plus
   CONT (0). Its own row, NOT the `_224` shared row: the shared transport is
   the *pair* cadence (seconds-scale); the method cycle is a *mood* cadence
   (minutes-scale), and pretending they are one row would put 1 s method
   thrash one tap away. **METHOD FADE pills** — `[1.5, 3, 6, 10]` s, default
   **3 s** ("cycling smoothly" is the order; 0.4 s is a cut, not a cycle).
4. **NOTE FADE pills** — `SNAP · 0.4 · 1 · 2` s, default **0.4 s** (§8).
5. **A/B slot selection** — the `_224` pair-selection surface reused
   verbatim: five swatches of the CURRENT ring (live from broadcast
   `currentScheme` + `noteHue` through the client generator — parity-pinned,
   so it matches the rig), A/B badges on `sel`, arm-then-tap grammar.
   Because `sel` is indices, it survives every re-theme — the exact property
   `_224` built it for.
6. **START FOLLOW NOTE / STOP** — full-width, the TURNS button grammar.
   START posts the full config (`setState` — a start IS a clean break); STOP
   posts `active:false`. Stopping freezes in place (native `_cancelTween`
   semantics, docs/55 §2.2's "STOP freezes" carried over).

**Live-retune honesty microcopy (all three cards):** while their family is
running, HOLD pills tag `"applies now"` and FADE pills tag
`"from the next fade"` — the §5 table, visible. One caption line under the
shared rows, not a modal.

## 8. Note transitions + silence (design questions 2 and 4)

**Note change = short slew, default 400 ms, configurable to SNAP.** Live
Touch snaps because it repaints a preview glass; the rig is a 30 m ship where
an instant 180° hue jump on both slots reads as a fault, not a feature. The
estimator commits at most ~3–4 changes/s in the worst case (hysteresis
floors), and the retarget-from-current tween rule means a melodic run
degrades gracefully into continuous glide rather than queueing. 400 ms is
under the eye's "did it follow the music" threshold but over the "did it
glitch" one. `noteFadeMs: 0` is the honest Live Touch-parity escape hatch.

**Silence / no note: HOLD LAST, visibly.** Three layers, none of them a
fallback:

1. The companion already holds the last committed note through silence
   (`_heldPc/_heldHue` — a tested, documented contract, not our addition).
2. If the companion process dies, the engine CPC keys simply stop changing —
   the daemon's change-detector sees no events and the rig **stays exactly
   where it was**; the method cycle keeps cycling on the held hue (the show
   keeps breathing).
3. The card SAYS what is happening: `audioSilence` drives the
   `"HOLDING LAST NOTE"` state; the existing companion-health surface
   (HealthChip / audio status) already covers "the feed is down" — the card
   does not switch to the wheel base, does not park itself, does not invent a
   colour. Hold-with-a-sentence is the only behaviour compatible with the
   no-fallback rule.

Before any first note ever (companion boots into silence): `audioNoteHue` is
0 by the companion's own defined-neutral contract — the rig follows at red
until music arrives, and the card says it is holding. Defined, not spurious.

## 9. Implementation contract (ordered W-items)

**W1 — engine generator module + parity table.**
`marsin_engine/lib/color_schemes.js` (§3) +
`tests/effects/color_schemes.test.js`; the same reference table appended to
`colors_window_logic.test.ts`. *Accept:* both suites pin identical
five-colour outputs for all 9 ids × 3 base hues; engine module has zero
CaptainPad imports.

**W2 — wire + validate.** `mode`/`followNote` rules (§4.1) in
`ColorAutopilot.validate`. *Accept:* refusal tests for every rule (mixed-mode
config, unknown scheme, empty subset, spin-loop hold/fade, bad sel);
legacy configs validate byte-identically.

**W3 — daemon loops.** Method timer + note subscription + shared tween (§4.2)
with injected `getSignal`/`subscribeSignals` hooks; unsubscribe in
`stop()`/`deactivate()`. *Accept (fake clock/fake CPC):* note change tweens
pair over `noteFadeMs`; unchanged note publishes are write-free; method
advance tweens over `methodFadeS` and reschedules additively; mid-fade note
change retargets from current params; `shuffle` avoids immediate repeat;
crash-boot resume.

**W4 — front door + broadcast.** api_server wiring: hooks into the
constructor (:6055), `colorAutopilotState()` additions, timeline dep
pass-through, runtime-file round-trip. *Accept:* WS frame carries
`mode/currentScheme/notePc/noteHue/nextMethodAtMs`; a timeline cue arms
follow-note; deactivate releases the subscription.

**W5 — LIVE RETUNE engine.** `patchState` + `_lastTickAtMs` (§5.1) and
`PATCH /deck/color-autopilot` (§5.2). *Accept:* the §5.3 walk, plus:
generation asserted unchanged across every accepted patch; `active`/`mode`
patches throw.

**W6 — client logic.** `rotationKind 'follow-note'`; `schemeTapOutcome`
method-override row; `followNoteAutopilotPatch(...)` builder mirroring W2's
validation; `retunableLive`/`rotationRetunePatch`; `colorAutopilotWritable`
learns `mode`. *Accept:* suite covers the new interaction-table row, builder
refusals match engine sentences, MIDI writability true for a valid
follow-note config.

**W7 — UI.** The FOLLOW NOTE card (§7) + live-retune pill behaviour +
microcopy on all three cards. *Accept:* screenshot matrix below; zero timers
added to the window (grep-clean for `setInterval`/`requestAnimationFrame` in
the diff); round-trip byte-identical when parked.

**W8 — full-stack smoke.** Per `.agent/skills/full_stack_smoke.md`: engine +
sim + CaptainPad, companion feeding real audio or the HIL injector
(`tests/hil/hil_audio_reactive_profile_test.mjs` sets note keys via API —
same trick works headless). *Accept:* two-frame sim captures showing a note
change slew and a method crossfade; card state line matches the injected
note.

**W9 — companion Scriabin preset (small, optional-order).** A `noteColors`
preset in the companion UI carrying the 12 Scriabin hues (§2). *Accept:*
selecting it round-trips through the existing noteColors validation; a note
under the preset lands `audioNoteHue` on the table's hue.

**Screenshot matrix (W7/W8):** card parked · running (note letter + countdown
visible) · method mid-fade (state line shows →NEXT) · silence hold sentence ·
scheme-chip method-override message · wheel-drag refusal while following ·
HOLD pill "applies now" tag on a running crossfade · FADE pill "from the next
fade" tag mid-fade.

**Test plan summary:** W1 parity tables (both suites) · W2/W5 validator +
patch refusals · W3 fake-clock daemon walk · W5 §5.3 continuity walk · W6
client pure-logic rows · W7 component render states · W8 smoke with
screenshots. Engine suites must show a clean my-failures-empty run against
the pre-change baseline (the `_239` reporting discipline).

## 10. Operator vetoes / open questions

1. **Default method subset** — the seven multi-hue generators, MASTER/HUE
   opt-in. Veto: ship all nine on.
2. **Note fade default 400 ms** — veto to SNAP for Live Touch parity, or
   longer for a dreamier follow.
3. **Method hold default 60 s** — pill row is `[10,30,60,120,300]`; renumber
   at will.
4. **Scheme tap while following = method override now** (§6) — alternative:
   stage-only refusal like the crossfade row. The override felt truer to
   "one-tap restage" muscle memory from TURNS.
5. **W9 Scriabin preset** — include or drop.
