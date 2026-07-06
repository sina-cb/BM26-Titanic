# Round-2 #2 AUTO-CYCLE — Design (read-only recon)

Generalize deck autopilot to ANY channel: a mixer overlay auto-advances its playlist on a timer.
ONE engine writer (api_server.js + pattern_channel.js serial), UI after.

## Grounding (KEY)
Mixer overlay channels ALREADY have playlists AND a per-channel `autopilot {active,delay_s,shuffle}` field
in state (mixer_state.yaml:26-33; pattern_channel.js:175-178; constructed at loadPlaylistEntry api_server.js:1296).
But NOTHING ticks them: the ONLY runner is the single `Autopilot` daemon (autopilot.js:35), hard-bound to
`mixer.getDeckChannel()` (api_server.js:2790-2863) — it advances the DECK only. Mixer overlays have a working
manual advance route `POST /mixer/channels/:id/playlist/entry` → `loadPlaylistEntry(ch,name,entryId)` (api_server.js
:6043-6074, instant load; NO deck double-buffer machinery on overlays — comment :6057). Deck advance picks
next/shuffle + honors per-entry hold/loop (api_server.js:2808-2834) and routes through transition; overlays have
no transition path. DECISION: do NOT spin one setTimeout daemon per channel (N timers, drift, gen-counter sprawl).
Instead TICK auto-cycle from the engine render loop's accumulated clock (engine.js:539-581 patternClockSeconds),
reusing the per-frame fan-out already in pattern_mixer beginFrame (pattern_mixer.js:1971). Wall-clock advance via
the existing global clock = one source of time, no extra timer, naturally paused by blackout/clock reset.

## Model (DECISION: reuse the existing autopilot shape, ms-normalized)
Keep `channel.playlist.autopilot {active, delay_s, shuffle}` for on-disk continuity with the deck (do NOT invent a
parallel `autoCycle` — one schema, one UI). Add TRANSIENT (never serialized) `channel._autoCycleLastAdvanceMs=null`
(wall ms of last advance) on PatternChannel (sibling of `_phaseSeconds`, pattern_channel.js:142). The interval
floor is on delay_s (see validator). Exterior immunity: rely on the EXISTING opt-in — autopilot.active defaults
false (api_server.js:1296), so mission-critical exterior channels never auto-change unless an operator flips them;
no separate exclude flag needed (mirrors followsTempo immunity, report 33). Document this as the safety contract.

## Tick (engine writer owns; pattern_mixer or a thin helper called from beginFrame)
Per frame, for each mixer overlay with `playlist.autopilot.active`: `now=Date.now()`; if `_autoCycleLastAdvanceMs`
null set it=now (no advance on first frame); when `now-_lastAdvance >= delay_s*1000` AND no in-flight work, pick
next entry (shuffle: random other usable; else sequential walk skipping `_missing`; honor entry.hold→park,
entry.loop→same — MIRROR api_server.js:2808-2834) and advance, then `_lastAdvance=now`. Advance MUST be the
existing `loadPlaylistEntry` choke (api_server.js:1263) — NOT a raw handle swap. NOTE: overlay loadPlaylistEntry is
an INSTANT load (hard handle destroy+compile, :1282) → a visible hard-cut. For "no visible hard-cut": v1 ships
instant (overlays have no double-buffer today) but DOCUMENT it; v2 can fade the channel `fader` down→swap→up via
the existing fadeChannel (pattern_mixer.js:1213, see report 31). Do NOT block frame on compile: dispatch the
advance via a queued callback the render loop drains post-frame (or a setImmediate) so a 50-200ms compile never
darkens the composite — fail-loud log on compile error, channel keeps current pattern (NOT silent).

## API
PATCH the existing per-channel handler (api_server.js:4471): accept `autopilot:{active?,delay_s?,shuffle?}` and
merge into `channel.playlist.autopilot` (mirror deck `/deck/playlist/autopilot` api_server.js:5779-5790). Validate
delay_s: finite, floor 1s (reject ≤0 / non-finite → 400 AUTOCYCLE_BAD_DELAY, Codex P0 no silent coerce — mirror
validateSpeed api_server.js:251); `active`/`shuffle` via `!!`. Reject if channel has no `playlist.name` (400, like
:6050). saveAllState + broadcastMixerState after (autopilot rides the `mixer` broadcast, like solo/bump arrays).

## Serialize / restore
Already round-trips: `playlist` is serialized whole (serializeChannel api_server.js:2204 `playlist: c.playlist`),
state_manager mirrors it, and buildChannelFromSaved re-attaches `ch.playlist = saved.playlist` (api_server.js:1748).
NO new serializer field needed beyond ensuring `autopilot` defaults are filled on restore (already at :1296/:1556).
`_autoCycleLastAdvanceMs` is TRANSIENT — never serialized (re-seeds to now on first active frame post-boot).

## WS
REUSE the `mixer` broadcast (autopilot state lives inside per-channel `playlist`, already serialized) — NO new WS
type. ws_topic_routing has no "default" and pins unknown types (ws_topic_routing.js:177-181); adding a type would
need TOPIC_BY_TYPE + both topic tests. Riding `mixer` (TOPICS.CONTROL :65) avoids that and matches how solo/bump
state rides existing broadcasts (ws_topic_routing.js:114).

## Tests
Unit (auto_cycle.test.js): tick advances after delay_s elapses (fake clock); first frame no-advance; shuffle picks
≠current; sequential skips `_missing`; hold parks, loop replays (mirror deck gate); delay_s floor/non-finite → 400;
inactive autopilot never advances; serialize round-trip of autopilot via playlist + missing→defaults; exterior with
active=false never changes. HIL (hil_mixer_autocycle): set overlay autopilot active delay_s=1 → activeEntryId
advances ≥2 distinct over ~3s; toggle off → no further advance; bad delay_s→400; concurrent manual entry tap during
cycle resets the baseline (next tick counts from the manual change).

## Risks
- Hard-cut on overlay advance (no double-buffer): v1 documented; v2 fade via fadeChannel. NOT silent.
- Compile-on-tick latency darkening a frame: dispatch advance off the hot path (queued/post-frame), never await in
  beginFrame. Fail-loud on compile error, keep current pattern.
- Drift: anchored to wall `Date.now()` deltas (self-correcting), not accumulated intervals.
- Mission-critical exterior: protected by active=false default (opt-in). Document; no force-exclude in v1.
- Interaction w/ manual entry tap / transitions / phase clock: manual tap updates activeEntryId; next tick measures
  from then. Orthogonal to phase clock (speed/offset, report 33) and to fader transitions (level only). _morph /
  recall-fade (report 31): if a morph is rebuilding overlays, skip auto-advance that frame (check in-flight).

## Build order / ownership
Engine writer SERIAL on api_server.js + pattern_channel.js + pattern_mixer.js: (1) add transient field + tick
helper; (2) PATCH validator + merge; (3) tests. UI AFTER: mixer.tsx ChannelStrip AUTO toggle + delay/shuffle pills
(mirror DeckTopBar autopilot button, deck_client.js:373); channelExtrasApi setChannelAutoCycle; MixerChannel type
+= playlist.autopilot.

## Citations
mixer_state.yaml:26-33; pattern_channel.js:142/175-178; autopilot.js:35/99-138; engine.js:539-581;
pattern_mixer.js:1213/1971; api_server.js:251/1263/1296/1556/1748/2790-2863/2808-2834/4471/5779-5790/6043-6074/6050;
ws_topic_routing.js:65/114/177-181; deck_client.js:373.
