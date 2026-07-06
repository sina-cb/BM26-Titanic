# Round-2 Channel Feature Backlog (discovery, 2026-06-20)

Next round after the first 13-feature backlog (~all shipped). STRICT channels lane.
Serial bottlenecks: api_server.js (router arms before /mixer/channels/:id regex) +
pattern_mixer.js (hot path) — one engine writer at a time. Favor NEW-file engine logic
+ CaptainPad-only. Integration points cited.

## Ranked
1. **Snapshot crossfade/morph** (flagship, M, both hot files) — recall-fade over duration;
   ramp master+faders+group-faders of channels in both looks, instant structural for adds/
   removes. Reuse startMasterFade/fadeChannel/recallLook. Schedule SOLO slot.
2. **Snapshot auto-cycle** (M, NEW lib/snapshot_cycler.js + thin arm) — rotate tagged looks on
   a timer (+morph). Transient. After #1.
3. **Per-channel speed multiplier** (M, both) — pattern_channel.speed; per-channel phase clock
   in beginFrame (channel._phaseSeconds += dt*speed). Clamp [0.05,8]. Establishes phase clock.
4. **Tap-tempo / global channel speed** (S-M) — POST /mixer/tempo{bpm} (tap detect client-side);
   feeds #3's phase clock. Manual tap only (audio BPM is out-of-scope DSP).
5. **Flash/bump (momentary full-while-held)** (S-M, pattern_mixer _effFader) — _bumpedChannelIds
   Set like solo; WS bump/unbump low-latency; release on disconnect. Owns pattern_mixer slot.
6. **Channel follow/link** (M, both) — followChannelId+ratio; resolve in WAVE-15 precompute before
   _effFader; reject follow-cycles (fail loud). After groups.
7. **Cue-to-deck (deck A/B preview)** (S, near-pure plumbing) — deckFocusChannelId ALREADY honored
   in render (pattern_mixer.js:183/:1883); just add POST /deck/focus + serialize + CaptainPad CUE.
   EXCELLENT early win. /deck/* arm (away from regex hazard).
8. **Per-channel invert** (S-M, both) — pattern_channel.invert; 255-v pass before blend, gated.
9. **Saved per-channel param presets** (M, NEW lib/param_preset_manager.js + arms) — capture/apply
   localControls by name; validate export match on apply (fail loud). Models on snapshot_manager.
10. **Undo/redo for mixer ops** (M-L, NEW lib/mixer_undo_stack.js) — push captureLook blobs before
    mutations; undo=recallLook. After ops cluster. Highest design cost; last.
11. **Per-channel chase/offset** (M, both) — phaseOffsetMs in beginFrame; HARD depends on #3.

## Recommended NEXT PARALLEL BATCH (after ops cluster merges; disjoint)
- **A #7 cue-to-deck**: api_server.js (/deck/focus arm) + index.tsx + api.ts. Render done.
- **B #9 param presets**: NEW lib/param_preset_manager.js + thin api_server.js arms + new
  utils/paramPresetApi.ts + PlaylistPanel/mixer.tsx.
- **C #5 flash/bump**: pattern_mixer.js (_bumpedChannelIds in _effFader) + WS arm + mixer.tsx/
  groupsSoloApi.ts. Owns pattern_mixer.js alone this round.
A+B both touch api_server.js but in different regions (additive arms) → one integrator merge pass.
C owns pattern_mixer.js uncontested. Do NOT add #1/#3/#6/#8/#11 to this batch (all rewrite
pattern_mixer composite/beginFrame → collide with C). Safest 2-feature batch: A+B only, C next.

## Ordering for the rest
Batch A/B/C → then #3 (phase clock) → #11 + #4 ride it (same owner, back-to-back) → #1 morph
(solo slot) → #2 cycle → #6 follow → #8 invert (opportunistic) → #10 undo (last, after ops).

## Integration points
_effFader + precompute pattern_mixer.js:842/:1833 (bump#5, follow#6, invert#8); beginFrame phase
clock :1734 (#3/#4/#11); deckFocusChannelId honored :183/:1883 (#7 plumbing); startMasterFade/
fadeChannel :955/:1058 + recallLook api_server.js:1801 (#1 morph); captureLook :1752 (#9/#10);
router-arm-before-:id-regex hazard ~api_server.js:3456.
