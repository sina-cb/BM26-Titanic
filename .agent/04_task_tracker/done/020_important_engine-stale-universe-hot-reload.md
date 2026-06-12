# Engine keeps sending stale universes after model hot-reload

- **ID:** 020
- **Priority:** IMPORTANT
- **Status:** DONE
- **Source:** operator report 2026-06-11 ("colors messed up from engine to sACN on sim" after remapping all fixtures onto one universe) + code audit
- **Location:** marsin_engine/engine.js:1078-1156 (hot reload), marsin_engine/engine.js:641-647 (sendFrame collection)
- **Created:** 2026-06-11
- **Updated:** 2026-06-12

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

## Resolution (2026-06-12)
Both gaps fixed in `marsin_engine/engine.js` (hot-reload handler) +
`marsin_engine/lib/api_server.js` + a small wiring change in
`simulation/src/gui/engine_blackout_warning.js`:

1. **Stale universes:** after applying a hot-reloaded model, the handler
   now computes the set of universes referenced by the new
   `pixels[].patch` + `specialEffects[].patch`; every universe in
   `universeIds` no longer referenced gets its router buffer zeroed,
   ONE final all-zero frame sent (listeners go dark instead of frozen),
   and is removed from `universeIds` so `sendFrame` stops including it.
   Sender objects stay alive so a later reload can revive the universe.
   Log: `🧹 Universe N no longer mapped — sent blackout, stopped
   transmitting`.
2. **Loud pixel-count refusal:** `engineCore.modelSync { stale,
   message }` is set when hot reload is refused (pixel count changed)
   and cleared on the next successful reload (or when the disk model
   matches the running model again). Exposed as `modelStale` /
   `modelStaleMessage` on GET `/status` and in the `type: 'mixer'` WS
   broadcast. The sim's engine-blackout-warning banner now also renders
   the stale state ("ENGINE MODEL STALE — RESTART ENGINE" + message);
   blackout takes precedence and the stale path does not repaint the
   sACN blackout button.

**Verified live** (engine on test_bench + 00_golden_hour_wash):
remapped Par 1 U2→U3 (hot reload added U3, UDP sniff on 5568 showed
U1/U2/U3 at 40 pps), reverted → engine logged the 🧹 line and the sniff
showed U3 packets stop while U1/U2 continued. Refusal test (removed
pixel 51): `/status` + WS both carried `modelStale: true` with the
message; sim screenshot showed the banner; restoring the model cleared
the flag. `node --check` clean on all touched files; simulation suite
37/37 green. Model-sync hash indicator (third suggestion) not done —
follow-up material if still wanted.

## Notes
Audit ruled out a systematic skew in the new mapping pipeline itself:
panel → patches.yaml → regenerated model are byte-identical on
addresses (verified per real-UI run), and the engine imports
`mapPixelsToSacn` from the sim's own `sacn_mapper.js`, so the channel
math is literally shared. Related: task 010 (a surviving old engine
instance = second sACN source on the same universe scrambles colors
the same way; `reuseAddr: true` makes it silent).
