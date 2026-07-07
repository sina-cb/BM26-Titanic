# MIDI fix waves complete — bench handoff (MFT + APC mini)

**Date:** 2026-07-02 · **Branch:** `feat/captainpad-midi-control` (pushed, tip `29b63e54`)
**Author:** Opus dev-manager session + sub-agents · **Plan:** `20260702_4_meta_review_and_opus_5agent_plan.md`

Executed the meta-reviewed fix plan as **6 disjoint packages over 2 waves**, each
**red-first tested** and **independently V-b verified** by a fresh agent, with a full
integration gate per wave. Hardware round-trip is UNVERIFIED (no APC/MFT on the cloud
machine) — that is what the bench checklist below is for.

## Commits
- `71a4aa32` — Wave 1 (D1 manager core, D5 engine, D2 hook, D4 projector, D3 screens)
- `29b63e54` — Wave 2 (D6 hotplug hygiene #11 + safe cleanup)

## Gate (both waves, cloud)
| gate | Wave 1 | Wave 2 |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| CaptainPad `vitest run` | 241 | 237 (−7 dead-decoder tests, +3 hotplug) |
| engine `node --test` (midi_mapping + v0_seeding) | 14 | 14 (unchanged) |
| `expo lint` | 0 err | 0 err |
| `web:build` | dist | dist |
| independent V-b | 5/5 PASS | 1/1 PASS |

## What shipped (post-vet finding → fix)
**P1 (bench-blockers):**
- **#1 knob index ≠ screen order** — engine now seeds real `v0` for every untouched
  local-control export at all 3 load paths (incl. discard); client renders knob order
  from ONE `deriveKnobOrder` derivation feeding both the screen (with knob-number
  badges) and the MFT knob mapping.
- **#2 focus reconcile gap** — `setFocusIntent` single-source-of-truth + `effectiveFocusLayer`;
  touch and MIDI focus now agree; stale-focus fader-swallow gone.
- **#3 fast-turn undershoot** — optimistic anchor accumulates deltas across coalescer
  windows on both delta paths.
- **#4 BPM-sync gate asymmetry** — shared `syncOwnedKeys` fact gates BOTH the MFT speed
  knob and the APC fader 7; magic-string + false "mirrors fader-7" comments removed.
- **N1 deck-modulation leak** — modulation base/pulse applied only when the focused
  channel is the deck; mixer channels no longer inherit a colliding deck param's base.

**P2/P3:** #5 pickup base-anchor, #6 ring base-anchor, #7 reset-cancels-turn, N3 cross-channel
delta guard, 8a throw / 8b visible-error, N2 paramCenterRelative validation, N5 dispose flush,
#9 orphaned-LED off, #10 no CPC-rate rebuild, 12a/b/c render churn, N4 no fabricated
mixer write, N6 comment, #11 hotplug hygiene, P5 cleanup (shared clamp, dead decoders,
stale TODO).

## Decisions taken (Fable-recommended, applied)
- **D-1 = yes:** engine seeds real `v0`. **Behavior note:** an untouched slider now runs at
  its Pixelblaze default (0.5 / toggle 0 / hsv 0,1,1) from frame 0 — this MATCHES real
  Pixelblaze/Chromatik (a slider fires at 0.5 on startup) and never clobbers touched or
  saved-default values. A pattern whose `export var` initializer differs from `sliderX(0.5)`
  may look marginally different at load until touched. **Watch at bench:** confirm fresh
  patterns look right on load.
- **D-2 = yes:** MFT ring shows `base` (the value the knob edits); the pulse animation still
  signals "modulated".
- **D-3 = yes:** every deployment requests the Chrome sysex permission (both profiles bundled).
- **#13 driver seam DEFERRED** to when the VSN1 arrives — a core hot-path refactor with no
  present consumer would only add risk to this bench. Filed as a task.
- **D-4 (branch kebab-case name):** untouched — your call.

## Watch-items for the bench (not bugs — tuning/observation)
1. **Optimistic reseed epsilon (`OPTIMISTIC_RESEED_EPSILON=0.15`, manager.ts):** a sub-0.15
   external nudge to the SAME param while you keep continuously turning that same knob is
   discarded until a focus/reset event. If a small touch-nudge during an active MFT turn
   "snaps back," this constant is the one-line tuning knob. Relevant to bench steps 3 & 6.
2. **Detent step sizes** ±0.005/0.02/0.06 per accel tier and **encoder-push = reset-to-default**
   (vs fine-adjust) — bench feel calls, report back for tuning.

## BENCH CHECKLIST (Ring 1: APC + MFT → Chrome Web MIDI → CaptainPad web → engine → sim)
Bring up sim → engine (model matches scene) → CaptainPad web; plug in APC + MFT; grant the
sysex prompt. Then:

1. **Knob order (#1):** load a FRESH pattern, touch nothing. Every on-screen slider shows a
   "KNOB N" badge; turning physical knob N moves the Nth badged slider (including sliders you
   never touched). Matched/CPC rows are dimmed and show NO knob number.
2. **Focus truth (#2):** APC track-2 → on-screen FOCUS ch3 → move a learned fader: it applies
   to ch3 immediately (no "settling" swallow). APC focus LED shows ch3; MFT side-button "next"
   → ch4 (no off-by-one).
3. **Fast sweep (#3):** rip an MFT knob 0→max in <1 s → the param lands at/near max, not ~20%.
   (If it stutters/snaps back, see watch-item 1.)
4. **Sync gate (#4):** BPM→Speed sync ON → BOTH APC fader 7 and MFT speed knob are inert and
   their LEDs strobe, status says why; sync OFF → both live again.
5. **Reset gesture (#7):** spin an encoder then immediately press → value sits at the saved
   default, no post-reset jump.
6. **Modulated pickup (#5/#6):** audio-modulate a param → learned fader picks up against the
   base (no jump on unlock); MFT ring shows the base value with the pulse animation.
7. **Mixer scoping (N1/N4):** focus a mixer channel whose pattern shares a param name with a
   deck-modulated param → ring shows the MIXER value, no false pulse; a non-slider export
   shows NO fake fader (a "DECK ONLY" chip instead).
8. **Hotplug (#11):** with MFT rings lit mid-"set", unplug/replug the APC → MFT rings do NOT
   flicker or reconfigure; then replug the MFT itself → its config pushes once and rings restore.
9. **Feel check:** detent step sizes + encoder-push-as-reset (watch-item 2) — note anything to tune.

Report any step that misbehaves with which knob/fader and what you saw; most are one-line tuning
or a localized fix.
