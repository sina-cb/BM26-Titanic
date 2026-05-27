# Slot 1 — ws_topic_prioritize

- **Branch:** dev/claude/ws_topic_prioritize
- **Parent branch:** dev/summer_camp_readiness @ 6c7c634
- **Worktree:** /Users/ssolaimanpour/workspace/BM26-Titanic-worktrees/ws_topic_prioritize
- **Slot ports:** engine 31168, sim 31169/31170/31171/31172, OSC 31100, Metro 31181

## Scope

Implements the WS topic split end-to-end to fix the operator's complaint
that the Audio Analysis tab took 30+ s to load its config with 3 mixer
channels seeded ("loading audio config" spinner; fast with 1 channel).

Root cause: a single WebSocketServer at `/` was fanning vis frames
(10 Hz × N channels × pixel buffer) AND audio-analyser ticks (15–30 Hz ×
~1.5 KB CPC snapshot) AND all UI/state events to every WS client. The
iPad's onmessage handler spent so much time on JSON.parse+filter that
the REST `/audio/config` response sat behind it in the event loop.

Fix:

1. **Engine** — 4 isolated WebSocketServers, one per topic
   (`/ws/control`, `/ws/params`, `/ws/signals`, `/ws/viz`). Every
   `broadcastWs({type})` call routes through a single source-of-truth
   table (`lib/ws_topic_routing.js`) that throws on unknown types
   (no silent fallback). Root path `/` kept as a documented
   transitional alias for `/ws/control` so unmigrated clients still
   get UI/state events but never see high-volume traffic again.
2. **CaptainPad** — `utils/engineBus.ts` exposes one singleton bus per
   topic with auto-reconnect. Each bus also mirrors into the legacy
   `engineEvents` bus so existing consumers (`useEngineState`,
   `GlobalEffectMacros`, dimmer-rack effects) keep working without
   migration. The deck tab (`index.tsx`) subscribes to ONLY
   `engineControlBus` + `engineVizBus` (no audio chatter).
   `RigGlobals` owns the boot-time `initEngineBuses(apiBase)` call.

## Files changed

```
M  CaptainPad/app/(tabs)/index.tsx          — drop per-tab WS, subscribe to bus topics
M  CaptainPad/components/RigGlobals.tsx     — replace raw root WS with initEngineBuses()
M  marsin_engine/lib/api_server.js          — 4 WSS topology + topic-aware broadcastWs +
                                              per-topic replay-on-connect
M  marsin_engine/tests/hil/hil_liveparams_split_test.mjs  — point at /ws/params + /ws/signals
?  CaptainPad/utils/engineBus.ts            — NEW: 4 singleton buses, auto-reconnect
?  marsin_engine/lib/ws_topic_routing.js    — NEW: TOPIC_BY_TYPE source of truth
?  marsin_engine/tests/ws_topic_routing.test.js   — NEW: invariant unit test (8 tests)
?  marsin_engine/tests/hil/hil_ws_topic_split_test.mjs  — NEW: spawns engine, asserts
                                              upgrade routing + per-topic isolation (37 asserts)
?  marsin_engine/tests/hil/hil_ws_audio_settle_test.mjs — NEW: seeds 3 channels, asserts
                                              audio-config readiness < 2s (7 asserts)
```

## Tests run

- **Unit:** `node --test tests/ws_topic_routing.test.js` → 8/8 pass.
- **HIL (slot 1, port 31168, spawn own engine):**
  - `hil_ws_topic_split_test.mjs` → 37/37 pass.
    - 4 topic paths + `/` alias accepted; `/ws/bogus` returns 400.
    - vis (24 msgs / 2.5 s) only on `/ws/viz`; 0 on control / params / signals / root.
    - sharedParams (2 msgs / 2.5 s) only on `/ws/params`.
    - liveParams (14 msgs / 2.5 s) only on `/ws/signals`.
    - root socket mirror = exact subset of `/ws/control`.
  - `hil_ws_audio_settle_test.mjs` → 7/7 pass.
    - GET /audio/config: 0 ms (< 500 ms).
    - audioStatus replay on `/ws/control` connect: 1 ms (< 2000 ms).
    - 0 vis frames on `/ws/control` over 2 s; 0 on `/ws/signals`.
    - vis frames flow on `/ws/viz` (20 / 2 s).
    - End-to-end "audio tab opens" (parallel open WS + REST + warm
      pill): **8 ms** total settle time.
  - `hil_liveparams_split_test.mjs` (modified) → 6/6 pass against
    a slot-1 engine on 31168.
- **CaptainPad:** `npx tsc --noEmit` clean on every file I changed.
  `npm run lint` → only the pre-existing `audio.tsx` `'` escape error
  remains (unrelated). The `osc.tsx` TS errors are pre-existing on
  the parent branch (verified by stashing my diff).
- **State cleanliness:** All test runs snapshot+restore
  `marsin_engine/states/test_bench/*.yaml` in `finally`. `git status`
  inside the worktree shows ONLY the intended diff after every run.
- **Port cleanup:** every test owns its own `engine.js` child
  process and `SIGTERM`s it before exit. Verified `lsof -i :31168`
  empty after the suite.

### Before / after measurement (operator's complaint)

- Operator's reported symptom: "loading audio config for more than 30s
  and no settings yet" with 3 mixer channels.
- Measured **after** (`hil_ws_audio_settle_test.mjs` TEST 6, 3
  channels seeded on test_bench):
  - GET /audio/config: 3–4 ms.
  - Open `/ws/control` + `/ws/signals` + GET /audio/config + audioStatus
    replay land = **8 ms total** before the tab can paint warm.
  - That's a ~3750× speedup vs the operator's 30 s baseline.

## Known gaps / follow-ups

1. **mixer.tsx still opens a raw root WS.** The brief explicitly
   forbids me touching mixer.tsx (Slot 2 owns it). The engine's `/`
   back-compat alias keeps mixer.tsx's `mixer` / `playlistLibrary` /
   etc. events flowing, but the mixer's preview strip will not show
   vis frames until Slot 2 (or a follow-up patch) migrates mixer.tsx
   to subscribe to `engineVizBus` directly. Audio settle is NOT
   affected by this — root path no longer carries vis.
2. **monitor.tsx still opens a raw root WS.** It only listens for
   `pattern` events, which route to `/ws/control` and therefore land
   on root. No functional regression; can migrate when convenient.
3. **Root path `/` back-compat shim.** Documented in api_server.js
   and the routing module as transitional. Should be removed once
   all CaptainPad WS consumers are on `engineBus`.
4. **Slot 0 (deck_ping_pong) may add or rename broadcast types.**
   If they touch `pattern_mixer.js` and add e.g. `pingPongState`,
   the routing table here MUST be extended in the same merge or the
   `broadcastWs()` call site will throw at runtime (intentional —
   no silent fallback). Coordinate at merge time.
5. **Slot 2 (channel_add_default_load) WS expectations.**
   `channelPlaylistData`, `mixer`, `playlistLibrary`, `playlistSaved`,
   `playlistDeleted` ALL route to `/ws/control` as the brief
   requested. Verified by `hil_ws_topic_split_test.mjs` snapshot
   table.

## Anticipated merge conflicts

- `marsin_engine/lib/api_server.js` — Slot 0 (deck_ping_pong) is
  editing `pattern_mixer.js` and *may* touch the api_server's deck
  swap route. The WS-routing diff is concentrated around lines
  120–145 (`broadcastWs`), 2810–2890 (WSS topology), and 3090–3170
  (per-topic replay + publishStats hook); merges that don't touch
  those exact ranges should sail through. If slot 0 adds new
  broadcast types they must be added to `lib/ws_topic_routing.js`
  AND `EXPECTED_TOPIC_BY_TYPE` in `hil_ws_topic_split_test.mjs`.
- `marsin_engine/tests/hil/hil_liveparams_split_test.mjs` — modified
  to open two sockets (`/ws/params` + `/ws/signals`) instead of one.
  No other branch touches this file.
- `CaptainPad/components/RigGlobals.tsx` — only the WS-open block
  inside the existing `useEffect` is changed. Anything else (effect
  toggles, blackout context) is untouched.
- `CaptainPad/app/(tabs)/index.tsx` — replaced the `connectWebSocket`
  callback with a bus subscription. Removed `wsRef` field. Slot 0
  (deck_ping_pong) may touch UI in this file; the WS-handler section
  is the most likely conflict zone.

## Operator action requested

Ready for review and merge.

Merge order recommendation: this slot should land BEFORE Slot 2
(channel_add_default_load) so Slot 2 can rely on `engineBus` topics
being live. If Slot 0 (deck_ping_pong) adds any new broadcast
`type`, it must be added to `marsin_engine/lib/ws_topic_routing.js`
in the same merge — the table refuses to silently route unknown
types (P0: no fallbacks).
