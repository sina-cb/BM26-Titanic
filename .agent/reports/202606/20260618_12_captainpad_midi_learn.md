# CaptainPad MIDI-learn (the per-param "MIDI map" feature) — build report

**Date:** 2026-06-18 · **Branch:** `feat/captainpad-midi-control` ·
**Worktree:** `.claude/worktrees/midi-learn-build`
**Author:** agent (handoff to Sina for end-to-end review)

## What this adds

The **consumer side** of MIDI-learn — the feature that was "missing" (the engine
storage backend `b6103059` had no UI to create or use bindings). You can now
bind a physical fader to a pattern's LOCAL param, modulator-style:

> press the violet **⊞ MIDI** button on a param → **LEARN** → move a fader →
> it binds. From then on that fader sets the param's **static** value. Audio
> modulators stay layered on top untouched.

Bindings persist per playlist entry (engine `midiMappings`, applied by
CaptainPad — the render loop never reads them) and sync across clients via the
`playlistSaved` broadcast, exactly like modulations.

## Architecture (all CaptainPad-side, zero new engine surface)

```
fader move ─▶ WebMidiTransport ─▶ MidiManager.onMessage
   1) learn armed?  → capture the control, hand to the popover (swallowed)
   2) focused binding match? → scale 0-127→range, soft-takeover pickup,
        coalesce ~30Hz → dispatch → setDeck/MixerChannelControl (STATIC write)
   3) else → existing profile-mapped action
```

- **`utils/midi/learn.ts`** (new, pure, 14 tests): `LearnController`
  (arm/capture/cancel), `scaleMidiToRange`, `bindingMatches`,
  `controlRefFromEvent`, `pickup` soft-takeover.
- **`utils/api.ts`**: `MidiMapping` type + `putMidiMapping`/`patch`/`delete`
  (mirror the modulation CRUD; same cache-invalidation + endpoint shape).
- **`manager.ts`**: `armLearn()`, snapshot `focused` channel (exports +
  active-entry bindings), `applyBinding()` with per-binding soft-takeover
  (a fader stays locked until it crosses the param's current value, so a
  focus/pattern switch never jumps the value).
- **`resolver.ts`/`dispatch.ts`**: `localParam` + `focusChannel` actions.
- **`useMidiControl.ts`**: builds `focused` from the engine state, exposes
  `armMidiLearn()`, `setMidiFocus()`/`useMidiFocus()`, wires `onFocusChange`.
- **`components/MidiMap.tsx`** (new): the ⊞ badge + learn popover, wired into
  the deck slider header next to the green ◎ modulation badge.
- **Profile** (`apc_mini_mk2.yaml`): track buttons 1-3 → **focusChannel**
  (replaces solo per the focus-model redesign); faders 4-6 + 8 reserved for
  learned bindings (binding-first in the manager); fader 7 global speed, 9
  master unchanged. Focused channel's track button lights (LED projector).

## Focus model

- **Deck tab:** the single deck channel is auto-focused — the ⊞ button + faders
  4-6 just work.
- **Mixer tab:** press a track button (1-3) to focus that overlay; its track
  LED lights; faders 4-6 then drive that channel's active pattern's bindings.

## Verification (all green, in this worktree)

| check | result |
|---|---|
| `npx tsc --noEmit` | clean (exit 0) |
| `npx vitest run` | **98 passed** (was 74; +24: learn 14, manager +6, dispatch +3, led +1) |
| engine `node --test tests/midi_mapping.test.js` | 6/6 |
| `npx expo lint` | 0 errors (12 pre-existing warnings, none in changed files) |
| `npm run web:build` | Exported: dist (bundles clean) |

15 files changed, 3 new (+~588 lines). No engine code changed.

## Needs a bench pass with the APC (can't verify offline)

1. **Deck happy path:** deck tab → ⊞ on a slider → LEARN → move fader 4 →
   confirm it binds, label shows `CC 51`, moving the fader sets the value, the
   value survives a reload (persisted).
2. **Soft-takeover:** after binding, switch the active pattern and back — the
   fader should be "locked" until you move it across the value, then track.
3. **Mixer focus:** track buttons 1-3 select focus (LED follows); faders 4-6
   drive the focused channel.

## Known follow-ups (deliberately deferred, documented not silently dropped)

- **Mixer on-screen UI:** the ⊞ badge currently shows on the **deck** sliders.
  Adding it to the mixer channel strips + an on-screen focus button (so touch
  agrees with the track-button focus) is additive and left for after review.
- **Fader 8 "local speed":** left as a learnable slot rather than hard-mapped —
  hard-coding a guessed `speed` export name would risk a silent no-op (codex
  P0). Bind the pattern's speed slider onto fader 8 to get "local speed".
- **Per-fader lock-flash LED:** focus LED is done; flashing a track button
  while its fader is in pickup-lock is a small projector addition pending the
  real device's LED behaviour.
- **Solo** moved off the controller in favour of focus (track buttons). Re-add
  via Shift+track later if wanted.
