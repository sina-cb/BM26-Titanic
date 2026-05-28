# Code Review: dev/summer_camp_readiness vs main
_Generated 2026-05-27_

## Summary
- **Scope:** 341 files / 94 commits / ~68K insertions / ~4K deletions
- **P0:** 2 findings
- **P1:** 6 findings
- **P2:** 8 findings (brief)
- **P3 / nits:** combined short list
- **Overall assessment:** The branch is substantial and the engineering quality of the *new* code is generally high — well-commented, defensive about validation, with retry / backoff on the noisy subsystems (audio capture, OSC bind). However, two pre-existing security postures (no authentication on the engine REST/WS, OSC defaulting to wildcard-bind + empty allowlist meaning "accept from anybody") become materially more dangerous now that the engine exposes pattern writes, e-stop, blackout, mic config, and 30+ control endpoints to a venue WiFi. The OSC default in particular is new on this branch (entire OSC subsystem is new) and ships enabled by default in `config.yaml`. A second class of risk is operational: a handful of large rewrites (api_server.js +2330 lines, pattern_mixer.js +1405 lines, AudioChainsCard.tsx +2327 lines) consolidate a lot of behaviour into single files that nobody but the author will be able to debug live.

## Methodology
Read fully or near-fully:
- `marsin_engine/config.yaml`, all `control_podium/.config.*.yaml`, `network.yaml`, `.gitignore`
- `marsin_engine/lib/api_server.js` (entire 2808-line diff)
- `marsin_engine/lib/osc_listener.js` (new, 594 lines)
- `marsin_engine/lib/audio_capture.js` (new, 358 lines)
- `marsin_engine/lib/audio_devices.js`, `audio_mic_chooser.js` (new)
- `marsin_engine/engine.js` (~900 of ~1100 changed lines)
- `marsin_engine/lib/ws_topic_routing.js` (new)
- `marsin_engine/lib/modulation_controller.js` (new), `modulation_engine.js` (sampled)
- `marsin_engine/lib/signal_post_processor.js` (header + op catalog)
- `marsin_engine/lib/pattern_mixer.js` (deck-swap + view-selection paths; spot-check elsewhere)
- `marsin_engine/lib/playlist_manager.js`
- `CaptainPad/utils/api.ts` (full diff, 1214 changed lines), `engineBus.ts` (new), `engineEvents.ts`
- `simulation/src/dmx/sacn_mapper.js`, `simulation/src/core/animate.js`, `light_pool.js`

Sampled (read selected sections / diff sizes only):
- `CaptainPad/hooks/useEngineState.ts` (807 lines), `CaptainPad/components/audio/AudioChainsCard.tsx` (2327 lines) — high-signal areas but UI churn, not where stage-failure-class bugs typically live.

Skipped / not deeply reviewed:
- 24 new HIL test files (~9000 lines) — large but tests, no production impact
- Pattern files (`patterns/*.js`) — visual-only, no shared state
- YAML state files for individual scenes (read structure only)

## P0 Findings

### P0-1: OSC listener defaults to wildcard bind + empty allowlist (= accept from anyone on the network)
- **Location:** `marsin_engine/config.yaml:24-30`, `marsin_engine/lib/osc_listener.js:478-490`, enabled at boot via `engine.js:1351`
- **What's wrong:** New OSC subsystem ships with:
  ```yaml
  osc:
    enabled: true
    port: 10000
    host: 0.0.0.0
    allowedSenders: []
  ```
  The listener treats an empty `allowedSenders` as "no allowlist gate" (`_onPacket`: `if (this._allowedByIp.size > 0) { … }` in `osc_listener.js:481`). With wildcard bind on a venue WiFi, **any device that can reach the engine** can send `/marsin/cpc/*` OSC packets and:
  - Drive every CPC parameter (colors, speed, size, rotate, count) — visible on stage
  - Push mic gain values (`micLowGain`, `micKickGain`) — can blow out or kill audio reactivity
  - Send `/marsin/stems/*` to fake audio reactivity inputs and override the actual mic feed
  - With the auto-bound canonical bindings (`buildCanonicalBindings`), every CPC key with `oscAddress: …` is reachable; the operator does NOT need to configure anything
- **Why it matters:** A summer camp Wi-Fi will have campers, staff, possibly guest devices. Anyone running a free OSC sender app on their phone (TouchOSC, etc.) can scan + spam port 10000 and start nudging the show. Even unintentional traffic (random app sweeps) will paint the rig. The OSC stats throttle would mask it from the operator.
- **Suggested fix:** Either (a) ship the boot default as `enabled: false` and require explicit opt-in, OR (b) make an empty `allowedSenders` an explicit error at boot (force the operator to declare an explicit allowlist if they really mean "any"), OR (c) default `host: 127.0.0.1` so the operator must consciously open it to the LAN. Option (b) matches the listener's own "fail loud, never silently fall back" posture stated in its constructor docstring.
- **Confidence:** High. The behavior is in the source.

### P0-2: Engine REST + WebSocket exposes full control plane with no authentication, CORS wide open
- **Location:** `marsin_engine/lib/api_server.js:1496-1498` (CORS), throughout the rest of the file for endpoint definitions; engine binds to all interfaces on port 6968
- **What's wrong:** The HTTP server sets `Access-Control-Allow-Origin: *` and accepts every method, with **zero** authentication on any endpoint. The same is true for `/ws/control`, `/ws/params`, `/ws/signals`, `/ws/viz`. Unauthenticated POST verbs available to any LAN peer include:
  - `POST /save-pattern` — writes arbitrary JS to `patterns/*.js`, then compiles + installs it on every running channel (basename-sanitized, but content is unrestricted)
  - `POST /set-pattern`, `POST /control`, `POST /mixer/channels` (create), `DELETE /mixer/channels/:id`
  - `POST /global-blackout`, `POST /global-effect-macros/blackout` (e-stop the show)
  - `POST /global-effect-macros/panic-stop`
  - `POST /audio/config/reset`, `PATCH /audio/config`, all `/audio/chains/*` mutations
  - `PATCH /osc/config` (which can flip the OSC allowlist or restart it)
  - `POST /deck/playlist`, `POST /deck/playlist/entry`, `POST /deck/transition-config`
- **Why it matters:** On a venue WiFi this is a remote-blackout vector (anyone with a browser can `fetch('http://<engine>:6968/global-blackout', {method:'POST', body:'{"state":true}'})` from a console). The pattern-write path is worse — arbitrary JS persisted on disk and immediately compiled into the WASM VM. Pre-existing on main, but the surface area on this branch grew dramatically (added: GEM macros, audio config, OSC config, modulation CRUD, deck transition config, deck channel routes). The summer camp scenario explicitly hands a non-engineer-controlled network to the engine.
- **Suggested fix:** Minimum for the event: bind HTTP to `127.0.0.1` and tunnel the iPad over a USB-attached Mac (or a dedicated SSID for operator + iPad only). Better: a shared-bearer-token check on all `POST/PATCH/PUT/DELETE` endpoints + WS upgrade, with the token shipped in CaptainPad config. The `*` CORS is fine for a token-protected service; without a token it's an open door from any browser tab on a connected device.
- **Confidence:** High for the technical observation. Severity is context-dependent — if the camp will use a closed operator-only SSID, drop to P1; if the rig sits on the same Wi-Fi as guests, P0 stands.

## P1 Findings

### P1-1: Tracked `.original` backup files committed into source tree
- **Location:** `marsin_engine/models/summer_camp_dome.js.original` (334 lines), `simulation/scenes/summer_camp_dome/patches.yaml.original` (185 lines)
- **What's wrong:** Two `.original` snapshots from a manual model regen got committed to the tree. They're not referenced by any code, but they shadow the live files in IDE searches and a future "diff against .original" tool would now report no changes.
- **Why it matters:** Cosmetic for the event itself, but more importantly — if anyone edits the live `summer_camp_dome.js` against a different baseline than `.original` represents, this becomes a confusing-diff source live during teardown.
- **Suggested fix:** `git rm` both, add `*.original` to `.gitignore`.
- **Confidence:** High.

### P1-2: Broadcast site throws on unregistered message types — could crash an HTTP/WS handler under iteration
- **Location:** `marsin_engine/lib/api_server.js` `broadcastWs` (~line 184), `marsin_engine/lib/ws_topic_routing.js:122-130` (`topicForType` throws on unknown)
- **What's wrong:** `topicForType` is explicit that unknown types throw, by design ("there is no default topic on purpose"). The throw flows up through `broadcastWs` to the call site. There are dozens of broadcast call sites in `api_server.js` — most are inside HTTP route handlers wrapped in route-level try blocks, but a handful (e.g. `mixer.onTransitionProgress`, the 5 Hz `signalChainTimer` interval, `mixer.onDeckSwapComplete` callbacks) are NOT. If a developer adds a new `type` string and forgets to update `TOPIC_BY_TYPE`, those untriaged call sites will throw inside `setInterval` callbacks → uncaught exception → engine crash mid-show.
- **Why it matters:** Code reviewers will catch this in PRs; live, it's a "we shipped a new GEM slot type at 3 PM and the rig went dark at 9 PM" failure mode. The intentional strictness is good for catching mistakes early in development but is hostile to live operation.
- **Suggested fix:** In `broadcastWs`, wrap `topicForType` in a try/catch that logs+skips instead of throwing. Keep the strictness in the unit/HIL tests where it belongs. (Or: add a `TOPIC_BY_TYPE` lookup that returns CONTROL on unknown but `console.error`s — same safety net.)
- **Confidence:** High that the throw path exists; Medium that any in-flight callbacks miss the try guard (didn't audit every call site).

### P1-3: Engine spawns `lsof` and `process.kill(pid, 'SIGKILL')` against arbitrary PIDs on `--force-osc-port`
- **Location:** `marsin_engine/engine.js:1238-1262` (`forceKillUdpPort`)
- **What's wrong:** When the operator passes `--force-osc-port`, the engine shells out to `lsof -nP -iUDP:10000 -t`, parses the PID list, and SIGKILLs every one that isn't itself. The function is well-bounded (timeout 1500 ms, parses integers only) but on macOS with a co-resident OSC application (Ableton Live with Max for Live OSC, TouchOSC bridge, a DAW, etc.) this will silently kill the operator's other tools. The lsof shell command is safe (no user input flows into it), but the kill action is destructive.
- **Why it matters:** The flag is explicit, so this is operator-opt-in. But the warning is buried in stderr and there's no second-chance confirmation. Pre-flight check: SIGKILLing your DAW mid-set is recoverable but breaks the flow.
- **Suggested fix:** Log the candidate PIDs + their command lines BEFORE killing, with a short delay (or require `--force-osc-port=confirm`). Or simply require an env var.
- **Confidence:** High for behavior; Medium for severity — depends on the operator's machine setup at the camp.

### P1-4: SignalPostProcessor Gain op accepts `value` up to 1000 with no chain-output ceiling — can lock mic bands at 1.0
- **Location:** `marsin_engine/lib/signal_post_processor.js` OP_SCHEMA `gain` block (`value: { type: 'number', min: 0, max: 1000 }`); `marsin_engine/engine.js:702-713` (CPC gainMax override)
- **What's wrong:** The CPC mic-gain registry is overridden to `range: [0, gainMax]` where `gainMax` defaults to 2 (`config.yaml osc.gainMax: 2`). Good. But the SignalPostProcessor Gain op schema accepts `value: { min: 0, max: 1000 }` — and a Gain op can use either `value` OR `paramKey`. An operator who configures a chain on the iPad with a fixed `value: 50` on a mic band will receive `low * 50` from the chain into CPC, which then clamps to the [0,1] live key range. Net effect: the band sticks at 1.0 the moment any signal is present. Visually that's a "blown-out reactivity" stage failure — kicks/strobes never relax.
- **Why it matters:** Subtle. The operator may build a chain on the bench, tap the wrong value, and not realize the consequence until they're in front of an audience and the rig is locked into a strobe-on-everything posture.
- **Suggested fix:** Either (a) lower the Gain op `value: max` to ~10, OR (b) propagate `osc.gainMax` into the Gain op schema's max, OR (c) clamp the chain output to [0, 1] explicitly inside `signal_post_processor.process()` before the CPC write. Option (c) is cheapest insurance.
- **Confidence:** Medium. Did not trace every path; the AudioChainsCard.tsx is 2327 lines and may clamp client-side, but trusting client-side clamps for stage safety is itself a P1 (operator on bench can author the bad chain via curl).

### P1-5: `findConfiguredDevice` returns null → audio disabled, but no automatic operator-actionable retry
- **Location:** `marsin_engine/engine.js:697-738` (configured_mic_not_found branch)
- **What's wrong:** The cross-machine portability guard correctly detects "saved mic not present on this rig" and surfaces a clear status banner. But the engine then leaves audio off until the operator opens the iPad → AUDIO tab → mic picker → re-saves → PATCH /audio/config arrives. During those minutes (if the operator hasn't noticed yet), all audio-reactive patterns are static.
- **Why it matters:** Show starts, operator boots the engine on the rig laptop, mic was renumbered by macOS overnight (very common — Bluetooth device powered on first, mic shifted from `:2` to `:3`), engine boots silent, operator notices because the dome looks dead, scrambles. Not a crash — but the recovery requires walking to the iPad, opening a tab, picking from a list, all under house lights.
- **Suggested fix:** When the configured mic is missing AND `availableDevices.length === 1`, auto-fall-back to that single device with a loud log line + audioStatus banner ("auto-picked the only available mic — re-save to confirm"). For >1 device, surface a high-priority banner in CaptainPad (red, dismissible only after a re-save). Right now the banner exists but it's just text.
- **Confidence:** Medium. Operator-experience claim, not a code defect — depends on the camp's workflow.

### P1-6: HTTP server has no retry on EADDRINUSE; relies on `npx -y kill-port` (network dependency) to free the port
- **Location:** `marsin_engine/engine.js:603-613` (port kill block), `marsin_engine/lib/api_server.js:3289-3294` (EADDRINUSE exit)
- **What's wrong:** `npx -y kill-port` runs only in non-dry-run mode and silently swallows errors. When it fails (no network for npm install, no `npx` in PATH, etc.), the engine continues and hits EADDRINUSE which logs and crashes (no retry, no backoff like OSC has). The operator's only recovery is to find and kill the prior process by hand.
- **Why it matters:** Cold-restart in the middle of a show needs to be quick. If a previous engine instance is still grace-period-holding the port for a few seconds, the new boot dies. Compare with the OSC listener, which has a 4-attempt retry with backoff — but the HTTP server doesn't.
- **Suggested fix:** Mirror the OSC port-bind retry pattern on the HTTP listener — 3–5 attempts with 250 ms backoff. The kill-port shell-out should also use a local binary instead of `npx -y` (which can hang on a flaky network trying to fetch).
- **Confidence:** High for the code; Medium for severity (only bites under hot-restart on a stale port).

## P2 Findings (brief)

- **`global.wss` and `global.wssByTopic` globals** — used as a side-channel between `engine.js`, `api_server.js`, broadcasts, etc. Functional but brittle and a recipe for "broadcasts go nowhere because we haven't assigned global.wssByTopic yet". Already acknowledged in code comments; worth eliminating.
- **`CaptainPad/components/audio/AudioChainsCard.tsx` weighs in at 2327 lines.** Hard to maintain or hand off to a different operator during the camp.
- **`api_server.js` at 3300+ lines after the diff.** Same maintainability concern.
- **`pattern_mixer.js` at ~1900 lines** after the +1405 diff. Spans deck swap, mixer transitions, view selection, blend handles, and channel lifecycle in one class.
- **`reachableUrls` in api_server.js silently drops link-local + tunnel interfaces.** Reasonable, but a venue with only a corp-VPN-on Mac will see "Reachable on: [http://127.0.0.1:6968]" and conclude the engine isn't on the LAN at all. A `--reachable-include-tunnels` debug flag would help.
- **`fetchPatternCode(name)` URL-injects `name`** (`/pattern-code?name=${name}`) without encoding — `CaptainPad/utils/api.ts:432`. Server-side enforces `path.basename` so traversal is blocked, but a name with `&` or `?` would break the query. Use `encodeURIComponent`.
- **`/save-pattern` writes arbitrary JS** then compiles into the WASM VM. Defended by basename + WASM compiler validation but combined with P0-2 (no auth) this is an unauthenticated arbitrary-write of executable code. Not unique to this branch.
- **Default `mixer.maxChannels: 4` in config.yaml** but `engine.js` PatternMixer constructor defaults to `3` when missing — divergence; document the source of truth.

## P3 / Nits

- Many `console.warn` strings throughout the diff use `(error: ' + e.message + ')` style; consistent format would help log greps.
- `validateViewSelection` returns `{ ok: true, value: { type: 'all', target: null, invert: false } }` for both `null` and `undefined` — fine, but worth a unit test if not already covered.
- The `--force-osc-port` flag is parsed via `process.argv.includes(...)` directly in engine.js rather than going through `parseEngineFlags`. Asymmetric with the other audio CLI flags.
- `engineBus.ts` `AppState.addEventListener` subscription is never removed (the bus is a singleton so it's harmless, but if `createBus` is ever called multiple times — e.g. in tests — listeners will accumulate).
- The bipolar modulation math in `modulation_engine.applyContinuousModulation` uses `Math.max(Math.abs(minDelta), Math.abs(maxDelta))` as the scale — works for symmetric `[-x, +x]` but for `[-0.1, +0.5]` you lose the asymmetry. Probably intentional; comment doesn't say so.
- `engine.js` carries new `--force-osc-port` arg but it's not surfaced in any `--help` output that I could find.

## Areas Reviewed Lightly / Not Reviewed

- **HIL tests** (`marsin_engine/tests/hil/*.mjs`, ~24 new files, ~9000 lines): scanned filenames, did not read implementations. They are extensive and a real positive for the branch.
- **Patterns** (`marsin_engine/patterns/40_*..85_*`): visual content, did not read for behavior.
- **Simulation YAML edits** (`simulation/scenes/summer_camp_dome/playlists/*`, `simulation/scenes/summer_camp_logsville/*`): structural-only review.
- **CaptainPad `audio.tsx` (1665 lines), `mixer.tsx` (+1116 lines diff), `useEngineState.ts` (807 lines diff)**: spot-read key sections; did not deep-dive because the failure modes I'd worry about (uncaught render exceptions on disconnect, leaked timers) are scenarios that the existing in-tree HIL/unit tests should catch.
- **AudioChainsCard.tsx** (2327 new lines): scanned the public surface (op catalog rendering, drag-add-op, param sliders); did not audit every callback for cleanup.
- **PortWatch changes** (small): scanned, found nothing concerning; clear separation from CaptainPad is maintained per the project memory.
- **GLSL / shader files**: none changed.
- **`marsin_pb/wasm/marsin-engine.wasm` (binary)**: single commit on this branch changes byte length 230748 → 231876; only WASM consumers touch this.
- **`apply_patches.js`, model `.viewmasks.js` sidecars**: read enough to confirm shape; full audit skipped.

## Notable Positive Changes

- **OSC listener's boot-time validation** is exemplary: fails loud on malformed bindings, has IP-allowlist contract, normalizes IP forms (`::ffff:`, `::1`, brackets), and the constructor docstring explicitly states "no silent fallbacks." The bones are right; just the default config is wrong (see P0-1).
- **AudioCapture uses `shell:false`** for ffmpeg spawn, with retry+backoff. Cross-platform device discovery is centralized and unit-testable.
- **Channel-role enforcement** (`rejectIfWrongRole`) on `/mixer/channels/:id/*` and `/deck/*` routes turns a silent-data-corruption class of bugs into 400-class errors. Good defensive design.
- **`fetchWithTimeout` + `warnThrottled`** in CaptainPad fixes a known class of "fetch hangs and locks the UI" bugs and tames the offline-engine log spam.
- **WS topic split + dedicated buses** (`engineBus.ts`, `engineParamsEvents`, `engineSignalsEvents`, `engineVizEvents`) addresses real iPad-thread-starvation problems and was the right architectural call.
- **Deck pattern swap via shadow channel** (`triggerDeckPatternSwap` + `_inactiveDeckChannel`) with ping-pong handle reuse is clever — recompiling WASM on every entry tap was visible latency.
- **`reachableUrls` printed on boot** is a small thing but huge for "what IP do I type into the iPad" diagnostics.
- **Playlist manager hardening** (lenient `load`, strict `save`, in-memory library cache) directly addresses the "third-channel-add bug" that the report directory documents extensively.
- **The .agent reports directory** is itself a strong sign of disciplined process — the author has written detailed problem investigations alongside each rolled change.
