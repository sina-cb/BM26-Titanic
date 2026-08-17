# _244 — FOLLOW NOTE colour mode + method autopilot + live retune (DESIGN)

**Date:** 2026-08-15 · **Role:** designer (Fable) · **Deliverable:**
`docs/59_follow_note_color_autopilot.md` · Design only — **zero product-code
edits**. Awaits an Opus implementer.

**Operator orders:** (1) *"use the note as the main color … follow note, and
have the method cycling smoothly on a timer"* — a new COLORS mode where the
live detected note drives the base hue and the scheme generators cycle on an
autopilot timer with smooth transitions. (2) Follow-up: *"add follow note,
and method switch too. also make sure the changing of the parameters for
those existing ones too doesn't need a full stop and start again"* — live
retune for ALL rotation families (crossfade, TURNS, follow-note).

## The four calls

**1. Loop location: engine-side, inside the ONE colour daemon.** The decisive
find: the engine already has the note. The companion's `DerivedSignals`
publishes `audioNote` (committed pitch class) + `audioNoteHue` (configurable
note→hue wheel) into the engine CPC at 10 Hz
(`audio/postproc/audio_signals.js:116-117`), with hold-through-silence
test-pinned upstream (`note_estimator_synthetic.test.js`), and
`audio_reactive_profile.js` already consumes them engine-side. FOLLOW NOTE
becomes a **mode of `lib/color_autopilot.js`** (`mode:'followNote'` on the
existing wire; absent mode ≡ legacy `'palettes'`, byte-unchanged) — mutual
exclusion with TURNS/crossfade **by construction**, one writer, one broadcast,
one front door, deadman-clean (the note listener is a
`paramCenter.subscribe` with a changed-value bail; the method cycle is the
daemon's existing generation-guard timer). Note→hue uses **`audioNoteHue`**,
NOT a fresh Scriabin port — one operator-tunable mapping (the companion's
noteColors wheel), and `generateScheme(scheme, baseH)` wants exactly a bare
hue. W9 offers a Scriabin *preset* for that wheel for Live Touch parity.

**2. Generator math: ported to the engine, parity-pinned.** New pure module
`marsin_engine/lib/color_schemes.js` (the 9 generators from
`colors_window_logic.ts:554-680` — small, pure, no CaptainPad imports), with
a shared REFERENCE TABLE (all 9 ids × 3 base hues → exact five `{h,s,v}`)
asserted in BOTH suites — the `_217` lerpHue idiom, so client staging and
engine derivation can never drift. Client-side precomputation was rejected:
the note changes continuously, the engine must re-derive.

**3. Smoothness.** Method advances crossfade over `methodFadeS` (default 3 s,
holds `[10,30,60,120,300]` s default 60 — its own rows, deliberately NOT the
`_224` shared seconds-scale transport). Note changes **slew 400 ms by
default** (Live Touch snaps; on a 30 m rig a 180° two-slot snap reads as a
fault), `noteFadeMs: 0` = snap available. One tween, latest-event-wins,
always ramping from `_currentParams` — no dark frame possible.
Single-writer: `rotationKind` gains `'follow-note'` from the broadcast
`mode`; `manualWriteGate` unchanged (kind-agnostic sentence still true);
scheme tap while following = **method override through the daemon's front
door** (the `_224` restage idiom); START TURNS / crossfade RUN = explicit
takeover; nothing ever silently auto-pauses (`_211` §D).

**4. Silence: hold-last, visibly.** Three non-fallback layers: the companion
already holds the committed note through silence; a dead companion means the
CPC keys stop changing and the daemon simply keeps cycling methods on the
held hue; the card SAYS `"HOLDING LAST NOTE (audio silent)"` from
`audioSilence`. No switch to wheel base, no invented colour.

## Live retune (the follow-up order)

`ColorAutopilot.patchState(sparse)` + `PATCH /deck/color-autopilot`, the
`_230` sparse-patch idiom. Load-bearing rule: **patch never bumps
`generation`, never cancels the tween** — the reset behaviour was never in
the tick (which reads state fresh at fire time), it was in the bump.
Semantics table in docs/59 §5.1: hold changes re-arm phase-preserving off a
new `_lastTickAtMs`; fade changes apply from the next fade (stated in UI);
ring restages adopt at the next transition fading from live params; `sel`
retweens now; `active`/`mode` refused (those stay `setState` takeovers).
`_224`'s one-tap restage becomes a palettes-only PATCH — cadence, fade and
phase survive a scheme swap. Acceptance: fake-clock walk proving a 2 s→10 s
retimed crossfade never snaps and countdown continuity holds (§5.3).

## Contract

Nine ordered W-items (docs/59 §9) with per-item acceptance: W1 parity module,
W2 validate, W3 daemon loops, W4 front door/broadcast/timeline, W5 live
retune, W6 client logic (incl. `colorAutopilotWritable` learning `mode` —
today it would call a follow-note config un-toggleable from the APC), W7 UI
card + retune microcopy, W8 full-stack smoke with note injection (HIL trick),
W9 optional Scriabin preset. Screenshot matrix + test plan included.

## Operator vetoes (docs/59 §10)

1. Default method subset = the 7 multi-hue generators (MASTER/HUE opt-in).
2. Note fade default 400 ms (vs SNAP parity).
3. Method hold default 60 s.
4. Scheme tap while following = method override now (vs stage-only refusal).
5. W9 Scriabin preset: include or drop.

## Residue / verification

Docs + report + tracker block only; no product code, no git ops, no servers
touched. Numbers verified free at write time (docs tail `58_`, reports tail
`_241` landed + `_240` tracker block; `_242`/`_243` in flight elsewhere).
Design anchors read from the live working tree, including `_242`'s dial +
preset work already present in `colors_window_logic.ts`.
