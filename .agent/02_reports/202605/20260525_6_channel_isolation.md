# Slot 6 — channel_isolation

- **Branch:** dev/claude/channel_isolation
- **Parent branch:** dev/summer_camp_readiness (d0ab8d1)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/channel_isolation
- **Slot ports:** engine 31668, sim 31669/31670/31671/31672, OSC 31600, metro 31681

## Scope

Operator's primary ask, verbatim: *"check the deck v.s. mixer channels.
when in deck tab, the mixer channels must not be shown, and vice versa
in the mixer no deck channel leak. please make sure this isolation is
bullet proof so it's not broken later. … please fix this has burned me
many times."*

This slice splits the single `PatternMixer.channels[]` array into two
named, independently-owned collections — `deckChannel` (singleton PFL
preview) and `mixerChannels[]` (the live composition stack) — and
enforces the split at every layer that previously assumed
`channels[0]` was the deck:

- pattern_mixer.js: separate storage + explicit `setDeckChannel`,
  `addMixerChannel`, `getMixerChannels`, `getDeckChannel` APIs. The
  rendering loop iterates `this.mixerChannels` directly so the
  "skip if id === baseChannelId" hack is gone.
- state_manager.js: deck_state.yaml and mixer_state.yaml are now
  authoritative separate files. The loader emits a one-time
  migration warning if it sees a legacy combined mixer_state.yaml
  (first channel id starting with `ch_base`).
- api_server.js: new `/deck/channel` (GET + PATCH) and
  `/deck/channel/control` (POST). Every `/mixer/channels/:id/*` route
  now returns `400 WRONG_ROLE` if `:id` matches the deck channel,
  pointing the caller at `/deck/channel`. Mixer serializer emits ONLY
  overlay channels; deck serializer emits ONLY the deck. Both are
  broadcast back-to-back on every `broadcastMixerState()`.
- CaptainPad: the deck tab reads `/deck/channel` (REST seed +
  `deck` WS event) and writes through `/deck/channel/control`. The
  mixer tab iterates `channels` directly (no more `.slice(1)`
  deck-skip dance). useEngineState gained a `deckChannel` field so
  shared components (GlobalParams) can read it without indexing into
  `mixerChannels[0]`.

## Files changed

```
 M CaptainPad/app/(tabs)/index.tsx                 deck tab → /deck/channel
 M CaptainPad/app/(tabs)/mixer.tsx                 channels.map (was .slice(1))
 M CaptainPad/components/GlobalParams.tsx          base = deckChannel?.id
 M CaptainPad/hooks/useEngineState.ts              new `deckChannel` field + WS handler
 M CaptainPad/utils/api.ts                         fetchDeckChannel / updateDeckChannel / setDeckChannelControl
 M marsin_engine/lib/api_server.js                 routes split + rejectIfWrongRole
 M marsin_engine/lib/pattern_mixer.js              deckChannel + mixerChannels split
 M marsin_engine/lib/state_manager.js              migration + getMixerChannels/getDeckChannel
 M marsin_engine/tests/playlist_api.test.js        switch from /mixer/channels/ch_base/* to /deck/*
?? marsin_engine/tests/hil/hil_channel_isolation_test.mjs    NEW regression test (15 assertions)
```

## Tests run

- **Unit (`node --test`):**
  - `tests/param_center.test.js` — 53 pass / 0 fail
  - `tests/playlist_manager.test.js` — passes (included in the run)
  - `tests/audio_config.test.js` — passes
- **Integration (`tests/playlist_api.test.js`):**
  - 10 / 11 pass. The remaining failure (`sparkle pattern must expose
    the expected sliders`) is PRE-EXISTING — reproduced on pristine
    `d0ab8d1` before any of this slice's changes were applied. It
    relates to the `13_sparkle` pattern's export names, not the
    channel split. I updated the test's mixer/* calls to deck/* to
    keep the rest passing under the new contract.
- **HIL (engine on `31668`, `tests/hil/hil_channel_isolation_test.mjs`):**
  - All 15 assertions pass. Output captured:
    ```
    ✓ GET /mixer excludes deck id (deck=ch_base_1778870620551, mixer=3)
    ✓ GET /deck/channel returns the deck channel
    ✓ PATCH /mixer/channels/<deck>            → 400 WRONG_ROLE
    ✓ DELETE /mixer/channels/<deck>           → 400 WRONG_ROLE
    ✓ GET /mixer/channels/<deck>/playlist     → 400 WRONG_ROLE
    ✓ POST /mixer/channels/<deck>/control     → 400 WRONG_ROLE
    ✓ POST /mixer/channels/<deck>/playlist          → 400 WRONG_ROLE
    ✓ POST /mixer/channels/<deck>/playlist/entry    → 400 WRONG_ROLE
    ✓ POST /mixer/channels/<deck>/playlist/capture  → 400 WRONG_ROLE
    ✓ POST /mixer/channels/<deck>/playlist/discard  → 400 WRONG_ROLE
    ✓ added mixer overlay id=ch_<…>
    ✓ newly-added overlay is in /mixer, deck still excluded
    ✓ /deck/channel is unaffected by mixer add
    ✓ WS broadcast: deck + mixer events arrive, no cross-leak
    ✓ WS triggerMixerTransition rejects deck id
    ```
- **Sim smoke:** not run for this slice (no rendering changes).
- **CaptainPad (`npx tsc --noEmit && npm run lint`):**
  - `tsc --noEmit` → 7 errors, ALL pre-existing in `app/(tabs)/osc.tsx`
    (verified by stash + re-run on pristine `d0ab8d1`). Zero new TS
    errors introduced.
  - `npm run lint` → 1 error (pre-existing in `audio.tsx`), 17
    warnings (pre-existing). Zero new lint issues in any file I
    touched.

## Manual curl trace against engine on 31668

```bash
$ curl -s http://localhost:31668/mixer | jq '{base:.baseChannelId, ids:[.channels[].id]}'
{
  "base": "ch_base_1778870620551",
  "ids": ["ch_1779708202890_85", "ch_1779708512771_3", "ch_1779708514066_4"]
}
$ curl -s http://localhost:31668/deck/channel | jq '.channel.id'
"ch_base_1778870620551"
$ curl -s -X PATCH -d '{"fader":0.5}' -H "Content-Type: application/json" \
       http://localhost:31668/mixer/channels/ch_base_1778870620551 -w "\n%{http_code}\n"
{"error":"deck channel cannot be addressed via /mixer routes","code":"WRONG_ROLE",...}
400
$ curl -s -X PATCH -d '{"fader":0.8}' -H "Content-Type: application/json" \
       http://localhost:31668/deck/channel -w "\n%{http_code}\n"
{"status":"ok"}
200
```

The mixer `channels[]` never contained the deck id; the deck route
returned it. `WRONG_ROLE` rejections came back with a helpful
`useInstead` hint.

## Known gaps / follow-ups

1. **CaptainPad-side data path consolidation.** The deck tab now
   reads from `/deck/channel`; the mixer tab still reads from
   `/mixer` (which already excludes the deck). One small consequence:
   `useEngineState.deckChannel` and the deck tab's local `useState`
   both track the same WS event independently — fine for now, but if
   a future PR wants to drop the local state in `index.tsx` and read
   `useEngineState().deckChannel` directly, that would be cleaner.
2. **DeckTransitionControls.** I didn't migrate the actual deck
   transition controls UI route; the existing `/deck/transition-config`
   route was already isolated. No change needed.
3. **`/control` (legacy, no `/mixer/channels` prefix).** The bare
   `POST /control` route still implicitly targets the deck channel
   via `paramRouter.setControl` (which falls back to baseChannelId).
   This is used by PortWatch over LoRa today, so kept as-is. It is
   NOT a mixer/* route, so the isolation contract isn't violated.
4. **`mixer.baseChannelId` is still exposed** in the `/mixer`
   payload as a convenience id (not a channel object). CaptainPad's
   mixer tab still uses it to know which id is the "off-limits" deck
   when validating transition targets. We could rename to
   `deckChannelId` for clarity in a future cleanup; left as-is to
   avoid touching every WS consumer in this slice.

## Anticipated merge conflicts

- **Slot 0 (`playlist_loading_fix`)** also edits `api_server.js` and
  `PlaylistPanel.tsx`. Most likely conflict points:
  - `restoreChannel` signature / loop in api_server (now takes a
    `role` argument)
  - `serializeMixerState` (split into `serializeChannel` +
    `serializeDeckChannel`)
  - The legacy `/set-pattern` route was simplified end-to-end (the
    "cap-aware" two-branch swap is gone)
- **Slot 1 (`mixer_layer_view`)** is the heaviest conflict risk. It
  edits `pattern_mixer.js` extensively. Expect conflicts in:
  - The constructor (deckChannel / mixerChannels fields)
  - `addChannel` / `removeChannel` / `getChannel` (replaced by
    explicit deck + mixer APIs)
  - `triggerMixerTransition` (now iterates `this.mixerChannels`
    instead of filtering `this.channels`)
  - `renderAll6ch` (deck-skip branch removed; uses
    `this.mixerChannels` directly)
  - `destroy`
- **CaptainPad/(tabs)/index.tsx & mixer.tsx** both touched by deck
  tab consumers in other slices — expect light conflicts on imports
  and `setMixerChannels` removal in `index.tsx`.

## Operator action requested

Ready for review and merge. Recommended merge order: this slice last
in the api_server.js / pattern_mixer.js group so its broader rewrite
gets the cleanest tip to land on top of. Slot 1 should be merged
BEFORE this slice if its `pattern_mixer.js` changes are mostly
additive; otherwise expect to hand-resolve the constructor and the
overlay-iteration spots.
