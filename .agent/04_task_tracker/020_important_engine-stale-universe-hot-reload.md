# Engine keeps sending stale universes after model hot-reload

- **ID:** 020
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** operator report 2026-06-11 ("colors messed up from engine to sACN on sim" after remapping all fixtures onto one universe) + code audit
- **Location:** marsin_engine/engine.js:1078-1156 (hot reload), marsin_engine/engine.js:641-647 (sendFrame collection)
- **Created:** 2026-06-11
- **Updated:** 2026-06-11

## Description
The engine's model hot-reload (fs.watch on `models/`) only ever ADDS
universes: `registerUniverse` pushes new ids into `universeIds` and
creates router buffers + senders, but universes the new mapping no
longer uses stay registered, their router buffers keep the LAST
RENDERED FRAME, and the render loop re-sends those frozen buffers
every frame forever. After remapping fixtures between universes (the
exact Controller Mapping workflow), anything still listening on the
old universes — sim fixtures mid-session, or real hardware — shows
frozen/wrong colors. Two adjacent gaps in the same path:

1. Hot reload silently REFUSES when the pixel count changed (one
   console line: "Pixel count changed. Hot reload ignored. Please
   restart the engine") — the engine then runs the old model while
   the sim has already projected the new mapping, which guarantees the
   "engine sends one address, sim expects another" color scramble.
2. The sim applies mapping edits instantly (projection on every panel
   mutation) but the engine only learns at Save → model regen → hot
   reload. During an editing session with the engine running, mismatch
   is expected — but nothing surfaces it to the operator.

## Suggested fix
- On hot reload: diff old vs new universe sets; zero the router
  buffers of universes no longer referenced and stop (or stop sending
  from) their senders.
- Make the pixel-count refusal loud on the operator surface (engine
  status WS → CaptainPad / sim engine-blackout-warning), not just a
  console line.
- Consider a model-sync indicator: engine reports its loaded model
  hash; sim compares against its freshly exported one and shows a
  "engine model out of sync — save / restart" chip.

## Why it matters
This is the exact "colors messed up, addresses misaligned" failure the
operator hit after the first real Controller Mapping session, and on
playa it would present as fixtures frozen on stale colors with no
indication why.

## Notes
Audit ruled out a systematic skew in the new mapping pipeline itself:
panel → patches.yaml → regenerated model are byte-identical on
addresses (verified per real-UI run), and the engine imports
`mapPixelsToSacn` from the sim's own `sacn_mapper.js`, so the channel
math is literally shared. Related: task 010 (a surviving old engine
instance = second sACN source on the same universe scrambles colors
the same way; `reuseAddr: true` makes it silent).
