# 20260814 _197 — SPECIAL EVENTS tab design (Baby Reveal show #1)

**Agent:** _197 (Fable, DESIGN role) · **Branch:** `feat/bm_readiness` @ 3a4d559d
**Deliverable:** `docs/52_special_events_tab.md` (docs 46–51 were taken; 52 was
the next free number). Design only — no code, no git ops, stack untouched.

## What was studied (ground truth, not assumption)

- **Patterns verified.** `131_baby_reveal` (all-in-one 92 s oracle, auto reveal
  reads `finalColor` at t=92), `132_baby_tease` (158 s outcome-blind tease →
  indefinite blackout; `restartTease` reset + `replayFinale` rising-edge pulse
  jumps to the t=120 finale), `133_baby_reveal_burst` (manual answer from
  black; `finalColor` 0=pink/1=blue; ignores deck palette by design). All three
  are marked `DRAFT — pending operator review`. Live Touch trio 128–130
  verified present (five-colour prism/stations, spatial paint) — unrelated to
  events but they establish the local-slider idiom the shows use.
- **Engine machinery mapped.** Deck activation paths (`/set-pattern`,
  `/deck/playlist/entry`, `/deck/channel/control` → `setChannelControl`),
  mixer snapshots incl. timed morph recall (the restore primitive),
  `/mixer/master/fade`, both deck autopilots, timeline service internals
  (plan lock, operator takeover lease, `fireCue`, action vocabulary in
  `show_plan.js`), PANIC routes, performance-mode 409 gate +
  `captainpad_tab_policy.ts`.

## Decisions made (and why)

1. **Engine-side runner (new `lib/special_events/`), not a CaptainPad runner
   and not the timeline.** iPad-side dies with the tab (sleep kills timers,
   autopilot keeps writing the deck). Timeline was close but disqualified:
   `/timeline/plan/activate` swaps THE plan (an event would deactivate the
   nightly plan), and stages/arming/choices/extension don't fit the arbiter.
   The runner is a sibling of `timeline_service` in shape, tiny in scope, and
   REUSES the takeover lease, snapshots, and deck internals rather than
   inventing locks.
2. **Shows are scene-owned YAML data**
   (`simulation/scenes/<scene>/special_events/*.yaml`), validated throw-style
   like `show_plan.js`. New show = new file; the tab renders whatever
   validates. Broken YAML = visible error card, never loadable.
3. **Stage model:** ordered stages; next stage is ARMED when current fires
   (engine 409s out-of-order fires); `advance: manual` or `{afterSec}` with
   engine-side countdown; per-stage EXTEND (`addSec` on timed stages, or an
   authored action set — Baby Reveal's tease extend pulses `replayFinale`);
   CHOICE stages hold 2–4 variant buttons (the pink/blue reveal — the answer
   is chosen at the button, so the envelope stays sealed until the moment).
4. **ARM is a transaction:** snapshot `ev_prev` + record autopilot flags +
   takeover lease + autopilots off; any failure unwinds. ABORT/FINISH share
   one restore path (3 s snapshot morph + flag restore + lease release).
   Engine restart mid-show = abort + restore on boot.
5. **Safety:** PANIC always wins — fire-and-forget `notePanic()` ends the show
   WITHOUT snapshot recall (panic already established LIT). Dimmer Rack
   authority untouched (no verb writes dimmers). Deck content routes 409
   `SPECIAL_EVENT` while running (single writer). Tab is
   `showInPerformance: true` — an event IS a performance action; routes not
   performance-gated.
6. **Baby Reveal = 132 + 133** (three stages: TEASE → ceremonial pink/blue
   REVEAL → PHOTO GLOW → finish/restore). 131 reserved for a future
   one-button auto variant.

## Handoff

Two slices in the doc's §6: **Slice A** engine runner + routes + WS + gate +
tests (lands first; NEW endpoints flagged as their own slice as required),
**Slice B** the tab + api/hook/policy wiring. Test list (10 items, all
fail-loud paths) and a 9-shot validator screenshot matrix (`:7167` dist,
running stack untouched) are in the doc. Five open operator decisions listed
in §7 (tab name, reveal wording, photo stage, pattern DRAFT status, snapshot
retention).
