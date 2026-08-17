# _255 — COLORS interaction model: yield-on-leave for FOLLOW NOTE, mode visibility everywhere (DESIGN)

**Date:** 2026-08-15 · **Role:** Fable design agent (operator-ordered) ·
**Deliverable:** `docs/61_colors_interaction_model.md` — a sliceable contract
for 2-4 Sonnet implementers under an Opus lead. **Design only: zero product
files touched.**

**Operator order (verbatim intent):** *"check the color live control in the
deck tab please. I just got a conflict with follow note. when going from
follow note to another tab for example, it should safely disable the follow
note so it's not confusing. for the others too — plan interaction and
mechanism of the color."*

---

## 1. The conflict, diagnosed (docs/61 §1, C1-C8)

The COLORS window's three mode cards (TWO COLOUR / TURNS / FOLLOW NOTE) are
**local UI state**; the daemon's running family is **engine state**; nothing
links them and nothing off the family's own card says what is driving.
Concretely, with follow-note running and the operator on another card:

- **C1** — A/B wander on their own (note-driven) with **no follow-note
  footnote and no reachable STOP**: the existing "X is running" lines
  (`colors_window.tsx:1119-1125`, `:1171-1175`) cover turns/palette-set only.
- **C2** — the refusal sentence is deliberately kind-agnostic ("A colour
  rotation is driving…", `colors_window_logic.ts:1171`) — it stopped being
  honest-by-necessity once `rotationKind` could tell the families apart.
- **C3 — the sharpest trap**: `schemeTapOutcome` keys on the *engine* kind
  only, so tapping COMPLEMENT on the TWO COLOUR card while following PATCHes
  `followNote.method` and re-themes the rig — a method-override the operator
  thought was a staging tap.
- **C4** — the crossfade card's BLEND ramp/scrubber endpoints fall back to
  the moving live slots under follow-note (no `palettes` in the payload): a
  live-drawn but structurally meaningless control.
- **C5** — outside the Deck, nothing says a colour mode runs; Mixer/CPC/MIDI
  colour writes go ungated to `/param-center` and get eaten by the daemon at
  the next note change, with no visible cause.
- **C6** — the `_248` inferMode back-compat means any legacy palettes-shaped
  POST (old build, script, cue) flips follow-note off with no narration here.
- **C7** — the window always mounts on TWO COLOUR; a remote-armed mode lands
  the operator on a card full of anonymous refusals.
- **C8** — version skew disclosed: the live :6968 engine is **pre-`_248`**
  until the gen-7 bounce, so part of what the operator just hit is START/PATCH
  400/404 skew, not the post-bounce design.

## 2. The designed model (docs/61 §2-5)

**Intent gestures yield; disappearance never does.** Explicit navigation taps
on a connected surface may stop a mode (narrated); sleep/kill/WS-drop never
stop anything — **no engine lease, no deadman for any colour mode** (that
would strobe modes on WS blips and invert the `_211`/`_217` survives-sleep
goal). One line per mode:

- **FOLLOW NOTE** — *yields on leave* (the order): leaving its card (card
  tap, window hide, app-tab switch, each behind its own one-line constant)
  posts a bare `{active:false}` — mode + tuning survive via `inferMode`, the
  freeze is native, the stop is narrated both on success and on failure, the
  navigation never blocks, and it works against pre- and post-`_248` engines.
- **TURNS / crossfade (incl. CONT)** — *persist everywhere* (staged,
  cadenced ambience); confusion is closed by a DRIVING STRIP with an inline
  STOP on every card + kind-named gate sentences.
- **palette-set (AUTOPILOT window's)** — persists; strip points at its
  window.
- **scheme latch** — client staging, never engine state; survives card/hide
  (windows never unmount), dies with the app; correct for a draft.

Yield fires only when ALL of: explicit gesture · the card being left is
`'follow'` · broadcast kind is `'follow-note'` at gesture time · not
plan-locked/offline. Never on mount, broadcast arrival, reconnect, AppState.
Manual gestures (wheel/scrub/chips/MIDI) still refuse — never auto-stop
(`_211` §D survives, re-scoped to gestures).

**Visibility:** driving strip in the COLORS window (broadcast-derived, zero
timers) · `manualWriteGate(disabled, kind)` names the driver + its STOP ·
card auto-selects the running family on window entry · app-wide header chip
`COLORS · FOLLOW G / TURNS / XFADE / SET` on every tab (read-only, tap
navigates to Deck).

**Arbitration:** one daemon, one mode unchanged; START-other-family stays the
explicit takeover but the message names the loser; scheme taps gain a
`surface` argument so `method-override` is only reachable from the follow
card (stage-only refusal naming the driver elsewhere); blend scrubber inert
under follow-note.

## 3. Operator decision points (docs/61 §7)

D1 yield scope (rec: card + hide + app-tab, each one-line vetoable) · D2
TURNS/crossfade uniform yield? (rec: NO — persist + strip) · D3 chip scope
(rec: all tabs, all families) · D4 kind-named sentence (rec: yes) · D5
engine deadman (rec: NO; separate slice if ordered) · D6 entry auto-select
(rec: yes) · D7 engine-side `/param-center` colour write-gate for C5 (rec:
not this wave — chip covers the confusion).

## 4. Contract + slicing (docs/61 §8)

Client-only — **no engine files, no restart dependency** (validation must
still run against a post-`_248` scratch engine on 17xxx/TEST-NET-1).

- **W1** (Sonnet A, `colors_window_logic.ts` + test only): kind-named gate,
  `schemeTapOutcome(+surface)`, `yieldDecision`, `drivingStripModel`,
  `colorChipLabel`; table-driven tests per §3/§5 cell.
- **W2** (Sonnet B, `colors_window.tsx`): strip + inline STOP, L1 yield on
  ModeButton, entry auto-select, surface-aware scheme taps, inert scrubber;
  POST-shape mocks + the `_217` timer grep gate.
- **W3** (Sonnet C, `app/(tabs)/index.tsx`): L2/L3 triggers via
  `onCardChange` + workspace close + tab blur; loser-named takeover messages;
  zero-POST-on-reconnect assertion.
- **W4** (Sonnet D, `useEngineState.ts` + new chip component): app-wide
  colorAutopilot frame + header chip; no-write grep.
- **W5** (Opus validator): offline walk (yield leaves
  `active:false, mode:followNote` with tuning intact; restart-without-resend;
  legacy-engine stop property), two-tab race, 10-shot screenshot matrix.

Must-NOT-change list pinned in docs/61 §6: the `_242` dial, `_224` shared
transport, `_217` no-timer rule, single-writer gate strength, the engine wire
(bare-stop semantics are load-bearing), `ColorAutopilotPanel`'s banner, the
timeline cue path, plan-lock gating.

## 5. Residue / constraints honoured

No product code edited; no engines spawned (code reading sufficed — the
behaviour in question is client-side state plumbing plus already-tested
engine semantics); no git operations; no ports below 17000 touched; live
stack untouched. Shared-tree note: `_254` (blend-handle reds verdict) landed
while this design was in flight — report number re-checked at the tail and
claimed as `_255`; docs/60 was taken, so the contract is **docs/61**.
