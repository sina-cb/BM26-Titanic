# BM readiness local - operator test matrix

**Date:** 2026-08-13  
**Branch under test:** `dev/bm_readiness_local`  
**Required launch directory:**
`C:/Users/Titanic's End/workspace/BM26-Titanic-worktrees/live_touch_bm_readiness_rebase`

This is the final human acceptance gate before selective staging, durable
branch promotion, commit, push, and merge. Record Pass/Fail and a short note
for every numbered section. Do not commit the runtime YAML changes produced by
this test.

## 1. Start and connection truth

```powershell
cd "C:\Users\Titanic's End\workspace\BM26-Titanic-worktrees\live_touch_bm_readiness_rebase"
node launcher.js dev --scene titanic
```

Open:

- Audio Companion: <http://127.0.0.1:6966/>
- CaptainPad: <http://127.0.0.1:6967/>
- Engine status: <http://127.0.0.1:6968/status>
- Simulator: <http://127.0.0.1:6969/simulation/>

Pass when the launcher reports every child ready, CaptainPad says connected,
the simulator sACN input is connected, and the visible rig animates. Any child
exit, silent fallback, red offline badge, or static rig is a failure.

Result: [ ] Pass  [ ] Fail  Notes:

## 2. Audio Companion and microphone

1. Open Audio Companion and select the physical microphone.
2. Switch from Test to Mic. The selected device must remain visible; the UI
   must not silently fall back to Test.
3. Speak/clap/play music. Verify raw level, bands, beat/kick, and the designed
   Audio Signals move live in Companion and CaptainPad.
4. Reload Companion once. Verify the physical source reconciles correctly and
   live response resumes.
5. Confirm there is one analyzer only: Companion owns analysis and the engine
   does not produce a second conflicting signal stream.

Result: [ ] Pass  [ ] Fail  Selected device / notes:

## 3. Deck, Mixer, and pattern inventory

1. Select Deck, then Mixer, then Deck repeatedly.
2. Each linear blend should look seamless and take about 100 ms, with no
   one-second pause, black frame, stale layer, or failed Mixer surface.
3. Verify Mixer has an effective contributor and its controls visibly affect
   output. An unconfigured/all-black Mixer must fail loudly rather than land.
4. Confirm Live Touch patterns occupy 128-130 and Baby Reveal occupies 131-133.
5. Confirm Baby Tease chapters/controls load and the Girl/Boy answer remains
   manual-only.

Result: [ ] Pass  [ ] Fail  Notes:

## 4. Simulator BM readiness controls

1. In simulator Options, locate **Sim Spotlight Sampling**.
2. Exercise the available sampling strategies and confirm the selected method
   changes the analytic-light sampling without changing fixture identity,
   controller names, or pixel color truth.
3. Confirm Titanic loads with the expected 60-spotlight dev budget and no GPU
   warning or renderer loss at the shipped settings.

Result: [ ] Pass  [ ] Fail  Notes:

## 5. Live Touch ARM and canonical views

1. Open Live Touch. Merely opening the tab must leave Deck/Mixer on air and
   show DISARMED.
2. Press ARM. The full preparation and 100 ms blend should complete quickly;
   ARMED appears only after Live is proven landed.
3. Exercise Top Down, Front, Strands, and TE Sign. Verify centered orthographic
   orientation matches the aerial/3D simulator, Top includes auditorium
   fixtures, Front mirrors front/back with one stroke, and TE Sign brush radius
   selects only pixels inside the shown circle.
4. Pan, Fit, and enter/exit Spatial XY fullscreen. The model remains centered,
   no page-level overflow appears, and controls return intact.
5. Paint with two or more fingers. Every active touch must retain its own
   glyph-selection preview and server stroke until lifted.

Result: [ ] Pass  [ ] Fail  Notes:

## 6. Brush performance and fade

1. Draw continuously for at least 10 seconds with a long trail and multiple
   fingers. The iPad must remain responsive with no growing lag.
2. Try fade presets 0.1 s, 0.5 s, 1.0 s, and 1.5 s. Each trail should become
   visually absent at the selected duration; no old trail should freeze after
   a pause/background event.
3. Verify fade, size, color, and XY mapping agree between the 2D preview and
   the 3D rig.

Result: [ ] Pass  [ ] Fail  Device/browser/FPS notes:

## 7. Group profiles and dimmer authority

1. Exercise the full 24-group bank and both reduced creative profiles.
2. Horizontally scroll the bank from non-fader chrome. Vertical fader gestures
   must not accidentally pan the rail; lifting outside a fader must still send
   its final value.
3. Move group sliders rapidly. Brightness must update live without request
   backlog, dropped final values, or iPad slowdown.
4. Set a Dimmer Rack lane to 30%, then its Live factor to 50%. The effective
   result must remain at or below 15%. Test blackout, parked, and bypass policy.
   Live Touch must never bypass the authoritative Dimmer Rack ceiling.

Result: [ ] Pass  [ ] Fail  Notes:

## 8. Navigation and ARM lifetime

1. While armed, visit Dimmer Rack, Audio, Timeline, and other non-Layers tabs.
   Live output and ARM must remain active.
2. Return to Live Touch; the same owner/session and values must still be there.
3. Select Deck or Mixer. The requested 100 ms blend must land first, cleanup
   must complete, and only then may ARM release.
4. Background the iPad/app. This global safety path must hand back to Deck and
   disarm even if a non-Layers tab was visible.

Result: [ ] Pass  [ ] Fail  Notes:

## 9. Timeline lease and dismissible UI

The shipped operator inactivity lease is 120 seconds.

1. Start with an active Timeline plan, then explicitly ARM Live Touch. ARM is
   the takeover gesture and Live should land.
2. Make no real control changes for slightly more than 120 seconds. WebSocket
   heartbeats must keep ARM alive but must not renew Timeline ownership.
3. Timeline must reclaim Deck while the private Live session remains armed.
4. Make one real Live change. It must reacquire the operator lease and blend
   back to Live in about 100 ms, with prior Live values intact.
5. Dismiss/collapse the lease UI. It must stay out of the performance area
   without changing lease behavior; make another control change and verify the
   countdown renews.
6. Briefly disconnect/reconnect Wi-Fi while in the armed-but-Timeline-yielded
   state. The same owner must rebind during grace; an old socket must not steal
   or clear the new lease.

Result: [ ] Pass  [ ] Fail  Observed idle/reclaim times:

## 10. Theme and failure behavior

1. Change CaptainPad among the default, Gruvbox, and Light themes while armed.
   Only colors may change: no control geometry, owner ID, WebSocket, value,
   pattern, or ARM state may reset.
2. Reload or kill the Live iframe once. The engine deadman must land Deck,
   clean Live-owned state, and release ownership; no false success is allowed.
3. Verify errors remain visible and dismissible rather than covering the live
   controls indefinitely.

Result: [ ] Pass  [ ] Fail  Notes:

## 11. Global Performance and privileged Edit access

1. Enter global Performance mode from the single sidebar control. Confirm the
   protected structural/edit controls are hidden or locked on both iPads.
2. On only one iPad, open Edit and authenticate with one of the private
   operator passphrases. The passphrase must not appear in logs, URLs, browser
   storage, or screenshots. Confirm the other iPad remains locked.
3. Repeat once with **Remember for 30 minutes** disabled and once enabled.
   Reload and reconnect the remembered device; it may remain privileged only
   for the server-authorized remaining lifetime. Switch the engine host once
   and confirm the old session is discarded rather than sent cross-origin.
4. Use **LOCK** to relock only the authenticated iPad. Reauthenticate, then use
   **END GLOBAL** and one of the existing keep/keep-save/restore choices to
   leave Performance for every device.
5. While global Performance is active, restart the engine. Global Performance
   must resume locked, the pre-restart token must be rejected, and a fresh
   authentication must be required to exit.

Result: [ ] Pass  [ ] Fail  Devices / notes:

## 12. Privileged embedded tools

1. In privileged Edit, open **Audio Companion** from CaptainPad. Confirm the
   iframe/WebView uses the selected engine host on port 6966, shows the real
   analyzer UI, and unloads when the tab loses focus.
2. Open **2D Simulator**. Confirm it uses the selected host on port 6969 with
   the `2d_pixels` and `sacn_in` profile, receives live frames, and unloads on
   focus loss.
3. Re-enter global Performance without authenticating. Both privileged tabs
   must disappear from navigation, and direct/deep links must fail closed
   before mounting either embedded service.

Result: [ ] Pass  [ ] Fail  Notes:

## 13. Spatial true fullscreen and adjustable view

1. Open Live Touch while DISARMED and enter **FULL** from Spatial / XY.
   Spatial must cover the complete browser viewport, including the sidebar;
   no CaptainPad chrome or neighboring Live controls may remain over it.
2. Select each canonical pixel view. Use PAN, pinch/wheel zoom, +/- zoom, and
   FIT. Navigation gestures must never create paint strokes.
3. Return to paint mode and use two fingers. Both pointers must paint and keep
   independent previews; panning must remain inactive while painting.
4. Press EXIT. The iframe must return to its exact original DOM position and
   the Live Touch layout, scroll position, controls, and DISARMED state must be
   intact.

Result: [ ] Pass  [ ] Fail  Device/browser/notes:

## 14. LAN policy decision

Audio Companion intentionally binds `0.0.0.0` so the iPad can use it, but its
live mutation WebSocket is not authenticated. Record one explicit decision:

- [ ] Accept the show-LAN exposure for tonight's merge.
- [ ] Reject it and defer merge until authenticated pairing is designed.

Decision/notes:

## 15. Stop and preserve evidence

```powershell
node launcher.js stop
node launcher.js status
```

Pass when the launcher lock is gone and ports 6966-6972 have no listeners.
Leave generated Titanic state residue untouched for selective staging. For any
failure, capture: exact time, tab/action, expected versus observed behavior,
browser/device, screenshot or short video, and the matching launcher log lines.

Final operator verdict:

- [ ] Approved for selective staging and durable branch promotion.
- [ ] Changes required before merge.

Operator/date/notes:
