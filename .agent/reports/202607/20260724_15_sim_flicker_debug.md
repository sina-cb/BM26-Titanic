# 2026-07-24 — Flicker/freeze debug: sACN route flapping + dual-writer topology (Slice 15, bm_readiness)

Debugger session. Operator report evolved live: "annoying flicker sometimes in
the visuals" → "more like a FREEZE in the 3D vis area" → "confirmed in the
actual data ON THE LIGHTS, ~every 0.5–1 s" → "bench currently fine". All four
statements are explained below by ONE topology story plus GPU contention.
**No git ops, no commits.** Probes in `~/tmp/`, services restarted as
authorized (engine + sACN in-bridge + the dead save server), all on standard
ports.

---

## 0. TL;DR

- **The viewport freeze is NOT sim render code.** Under zero contention the
  render loop shows **0 rAF gaps >50 ms in 90 s**; the same probe 15 min later
  (fleet browsers + operator tab active) shows **20 freezes >100 ms (max
  481 ms)** with **zero JS long tasks** during the stalls — the main thread is
  idle; it's GPU/present starvation from multiple live sim windows. The
  emitter-instancing change is exonerated (and its 60 FPS preserved — no
  render-path file was touched by this fix).
- **The lights freeze/flicker is a DATA-PLANE topology fault, two-headed:**
  1. **Route flapping (the freeze):** the bench DMX gateway `10.x.x.10`
     (test_bench U1/U2) is fed ONLY by the sACN in-bridge's hardware relay,
     and the relay's route table was **global last-writer state** — every
     browser's `setScene` on WS connect replaced it wholesale
     (`sacn_input_source.js:116` → old `sacn_bridge.js loadRoutesForScene`).
     `titanic` declares 0 controller IPs, so **every titanic tab load
     disconnected the bench lights**; every test_bench tab restored them.
     `~/tmp/sim_restart.log` shows the table swapping test_bench↔titanic
     dozens of times today, in lockstep with fleet browser activity.
  2. **Dual writers (the flicker):** `marsin_engine/config.yaml` declares
     controller **Titanic-202 (10.x.x.202, U10+U12, alsoFlat:true)** → the
     engine unicasts those universes itself; `test_bench/patches.yaml` ALSO
     carries `controllerIp: 10.x.x.202` for U10/U12 → whenever the bridge held
     test_bench routes it relayed the engine's own loopback frames back to the
     controller. Two interleaved sACN sources ('MarsinEngine' +
     'MarsinRelay Engine'), independent sequence numbers, equal priority 100 —
     textbook receiver flicker (the MarsinLED firmware even counts
     `sacn.seqErrors`, docs/41). Both halves landed together in **c6eaa733
     (July 11 Post Party)**.
- **"Not there before today":** the wiring is July-11 old; the **activator is
  today's fleet** — agents opened/closed titanic + test_bench sim pages all
  afternoon (probes, captures, smokes), flapping the routes near-continuously,
  and full-stack smokes kept test_bench tabs alive = a **second writer**
  (`BM26-Simulation`, the browser's own sACN-out relay in `sacn_in` mode,
  prio 150 via :6972) against the bridge relay. Single-user pre-today = one
  writer + sticky routes = no symptom.
- **Engine exonerated at the wire:** 60 s WS-tap of the engine stream:
  U1/U2/U10/U12 at a rock-steady **39 Hz, max inter-frame gap 46 ms, zero
  gaps >100 ms**, single source. The G10 dispatch is clean at runtime
  (senders idempotent; `/status` introspection below proves 1 flat + 1
  controller sender).
- **Fixed (landed + live):** relay routes are now a **pure union**
  (CLI pin ∪ engine's active scene ∪ connected clients' scenes, refcounted)
  **minus engine-owned (universe→host) pairs** (new `/status outputRouting`
  introspection). Flip-proof: 5 scripted tab open/close cycles under the
  fixed bridge → **0 route removals** (was: a full table swap per tab).
  Suppression engaged live: `🚫 Relay suppressed: U10 → 10.x.x.202 — the
  engine delivers this universe to that controller ITSELF`.
- Tests: sim **436/436** (426 baseline + 10 new), engine **2091 pass / 8
  fail** — all 8 are the documented pre-existing environmental/parallel
  families (5 audio_capture, osc EACCES-vs-EADDRINUSE, effects_v2 parallel
  IPC, timeline parallel IPC — the timeline one passes 9/9 in isolation).
  `pick_accuracy` 2/2; scene smokes at pre-change baseline noise.

---

## 1. Timeline of evidence

| # | Probe (all in `~/tmp/`) | Result |
|---|---|---|
| 1 | `freeze_probe.cjs` full/WebGPU 90 s + CDP CPU profiler | median 42 FPS, one 166 ms gap **coinciding with a −63 MB heap drop**; profiler shows a 128 ms contiguous `(garbage collector)` stall — but see #3 |
| 2 | `alloc_probe.cjs` 45 s heap-sampling | **0.02 MB/s** JS allocation — the "churn" was profiler-induced; GC exonerated |
| 3 | `heap_curve.cjs` (no CDP) 90 s idle | **0 gaps >50 ms**, median 50 FPS — clean when uncontended |
| 4 | `interact_probe.cjs` (presets/orbit/zoom/clicks) | 400–450 ms stalls in EVERY phase incl. idle, **zero longtasks** during them → not JS; paired ~700 ms apart |
| 5 | `heap_curve.cjs` re-run 15 min later, identical config | **20 gaps >100 ms, max 481 ms, median 23.6 FPS** — bistable ⇒ external contention (operator's sim tab open since 13:11 at 35% GPU-3D + fleet browsers) |
| 6 | `ws_tap.cjs` 60 s on :6971 | engine stream 39 Hz, max gap 46 ms, 0 gaps >100 ms, single source — engine send loop clean |
| 7 | `ws_tap2.cjs` autocorrelation (good state) | only the pattern's own periodicity (~2 s on U2); no anomalous beat while single-writer |
| 8 | `sim_restart.log` forensics | dozens of `route switch` flips titanic↔test_bench all afternoon; `Route Created: U10/U12 → 10.x.x.202` during every test_bench window (dual-write windows); a junk `setScene '--scene'` from a misparsing client |
| 9 | ARP + HTTP probes | `10.x.x.10` live (the operator's bench); MarsinLEDs 201/202/203 currently absent (no ARP, HTTP timeout) — seqErrors counters unreadable this session |

## 2. Root causes (file:line)

1. **Freeze — global last-writer relay routes.**
   `simulation/src/dmx/sacn_input_source.js:112-117` sends
   `{type:'setScene', scene:<url scene>}` on EVERY WS (re)connect;
   old `simulation/server/sacn_bridge.js` `loadRoutesForScene()` closed all
   senders and rebuilt the table for that one scene. titanic ⇒ 0 routes ⇒
   bench dark/frozen (gateway holds last look).
2. **Flicker — dual sACN writers on one universe.**
   `marsin_engine/config.yaml` `controllers: Titanic-202` (U10,U12,
   `alsoFlat: true`) + `simulation/scenes/test_bench/patches.yaml`
   `controllerIp: 10.x.x.202` for the same universes ⇒ engine-direct unicast
   AND bridge relay of the engine's own alsoFlat loopback stream. Introduced
   together in c6eaa733.
3. **Writer #2 (still OPEN, operator decision pending):**
   `simulation/src/core/animate.js:543-590` — in `sacn_in` mode the browser
   relays ALL patched universes to controller IPs (via :6972,
   `BM26-Simulation`, prio 150). This is ALSO the layer that delivers the
   operator's per-fixture Off/Brightness overrides to hardware, so it cannot
   be simply removed. While any test_bench tab is open it is a second writer
   against the bridge relay; under GPU contention that tab's rAF stalls
   (measured 0.3–1 Hz cadence) make it re-send **stale** frames in bursts —
   the leading mechanism for the operator's "constant ~0.5–1 s" beat.
   Options put to the operator: (i) input-bridge stands down per
   (universe,ip) while a browser actively drives it, (ii) sim-out stands
   down / overrides move server-side, (iii) rely on receiver priority
   (broken on these gateways). Recommended: (i). A 2-min operator-eyes A/B
   (`~/tmp/ab_writer2.cjs`, phases baseline / writer-2 / off / writer-2+jank
   / off) is staged and ready to run on go.

## 3. The fix (landed, live)

### `simulation/lib/bridge_routing.cjs` (new, pure, unit-tested)
`computeEffectiveRoutes()`: route set = union over active scenes
(CLI `--scene` pin ∪ engine's active scene ∪ connected clients' tagged
scenes) minus `engineOwned` (universe→host) pairs; reports `excluded` and
cross-scene `conflicts` for loud logging. `engineOwnedPairs()` parses the
engine's `/status outputRouting`.

### `simulation/server/sacn_bridge.js`
- Per-client scene TAGS (`clientScenes: Map<ws,scene>`; tag on `setScene`,
  drop on close) replace last-writer-wins. A client can only ADD its scene.
- **Engine poll** every 3 s: `GET http://127.0.0.1:<marsin_engine_port>/status`
  → active scene (hardware follows the data generator, browsers optional) +
  engine-owned pairs. Reachability/scene/ownership transitions logged once,
  loudly; engine-down ⇒ no engine routes and no suppression (no dual writer
  can exist then) — stated in the log, no silent fallback.
- Diff-based sender lifecycle with per-transition logs AND monitor-panel
  broadcasts: `Route created/removed`, `🚫 Relay suppressed … engine owns
  this route`, `⚠ U<n> relayed to MULTIPLE controllers` (cross-scene
  conflict), `⚠ Unknown scene`.
- patches.yaml re-read on every recompute ⇒ `PatchManager.notifySacnBridge`
  (post-save `setScene`) still lands fresh patch edits.

### `marsin_engine/engine.js` + `marsin_engine/lib/api_server.js`
`engineCore.sacnOut` exposed; `GET /status` gains
`outputRouting: { controllers: [{name, host, protocol, alsoFlat, universes}] }`
(the dispatch's declared routes — the bridge's suppression contract).

### `simulation/lib/load_ports.cjs`
`marsin_engine_port` now read fail-loud from `simulation/config.yaml`.

### Tests added
- `simulation/tests/bridge_routing.test.js` — 10 tests: titanic client can't
  clobber engine-scene routes; engine-scene-alone keeps hardware alive;
  engine-owned exclusion; engine-unreachable = no routes + no suppression;
  engine scene change swaps set deterministically; duplicate-client refcount
  + last-disconnect drop; cross-scene conflict reporting; same-pair dedup;
  outputRouting parsing incl. malformed payloads.
- `marsin_engine/tests/io/status_output_routing.test.js` — spawns a real
  engine; asserts the `/status outputRouting` contract (Titanic-202 present,
  shape stable across reads).

## 4. Verification

| Check | Result |
|---|---|
| Fixed bridge live behavior | boot → engine poll → `Route created U1/U2→10.x.x.10, U10/U12→10.x.x.202 [engine]`; old engine detected: `⚠ no outputRouting … Restart the engine` |
| Engine restarted (same flags: `--model test_bench --pattern 01_cylon_sweep`; deck restored `00_golden_hour_wash` as before) | `/status` carries `outputRouting`; within one poll the bridge logged `Route removed U10/U12→10.x.x.202` + `🚫 Relay suppressed` ×2 — **dual-write dead, with the WHY in the log** |
| **Flip-proof** (`~/tmp/flip_proof.cjs`): titanic ×3, test_bench ×1, titanic ×1 tab open/close vs fixed bridge | **0 bench-route removals** — only `Client tagged scene` lines. Old bridge: full table swap per tab (log evidence) |
| Wire after fix (`ws_tap.cjs` 30 s) | 39.1 Hz all universes, max gap **29 ms**, 0 gaps >100 ms, single source |
| Sim unit tests | **436 pass / 0 fail** (baseline 426) |
| Engine suite | **2091 pass / 8 fail** — same pre-existing env/parallel families as this morning's 2088/9 baseline; none import the changed modules; timeline flake passes 9/9 in isolation |
| `pick_accuracy_test.cjs` | **2/2** split-invariant |
| `scene_console_smoke.cjs` titanic / test_bench | titanic: 1×404 (pre-existing noise); test_bench: 1×404 + 3×ERR_CONNECTION_REFUSED traced to the **save server (:6970) being dead since before this session** — restarted it (`node server/save-server.js`, pid live, :6970 listening) |
| Viewport perf (heap_curve, my window + operator's live tab) | full 33–50 FPS median across runs (varies with the operator tab's occlusion), **0 gaps >100 ms**; emissive 49.5 median, 0 gaps >50 ms. No render-path file changed by this fix ⇒ the instancing 60 FPS result stands |

## 5. Operational state left behind

- sACN in-bridge: **new code**, pid on :6971, log `~/tmp/sacn_bridge_fixed.log`
  (started `node server/sacn_bridge.js --scene titanic`, same argv).
- Engine: restarted ~15:59 on current code (same argv as the finished agent's
  launch); bench blinked once during restart — expected/authorized.
- Save server :6970: restarted (was dead — pre-existing, silently eating
  saves; log `~/tmp/save_server_restart.log`).
- `~/tmp/ab_writer2.cjs` staged for the operator-eyes writer-#2 A/B (awaiting
  go via coordinator).
- Engine `states/**` runtime residue: expected, untouched, not committed.

## 6. Follow-ups (for the Notion board)

1. **Writer-#2 arbitration decision** (§2.3) — operator to pick (i)/(ii)/(iii);
   implement + A/B verify. Until then: avoid leaving extra test_bench sim tabs
   open while hardware is watched.
2. **Fleet etiquette (activator):** agent probe browsers MUST close when done,
   and full-stack smokes must not leave sim tabs alive — browser churn was
   today's activator (GPU contention + route flapping). Coordinator codifying
   OS-side.
3. **Playa launcher:** pin the show scene (`npm start -- --scene <show_scene>`)
   so relay routes survive engine restarts (belt-and-suspenders on top of the
   engine-scene follow).
4. `setScene '--scene'` junk from some client's argv-parsing (seen in the old
   log) — harmless under union semantics (loud unknown-scene warn) but worth
   finding the sender.
5. MarsinLED seqErrors counters (201–203 were offline today) — read
   `/api/status sacn.seqErrors` during the next hardware session as the
   definitive receiver-side dual-write metric.
6. One-per-family cleanup: `effects_v2_mode_page_layout` + timeline suites
   fail only under parallel `node --test` (runner IPC) — known, documented,
   still worth a runner shard fix.

## 7. Round 2 — the rhythmic freeze ("2s ok, freeze, freeze") + multi-client warning

Operator reported the freeze persisting post-fix with a clock-like signature
while testing titanic (2d_pixels + 3D, sacn_in, U1-13). Round-2 verdicts, in
suspect order:

1. **My engine-status poll / bridge recompute — CLEARED.** The bridge log
   shows 42 lines in ~1 h: transitions only, zero recompute churn (recompute
   fires only on engine-state signature change; the `--scene titanic` pin
   contributes titanic's 0 routes exactly once — no pin-vs-poll fight). A
   190 s wire tap RUN CONCURRENTLY with a GPU-heavy tab: 7,438 packets per
   universe, 39.1 Hz, max gap 40 ms, **zero gaps >100 ms, no 3 s periodicity**.
2. **Engine time loop (operator hypothesis) — CLEARED at the wire.** Same
   tap: no 2 s cadence in arrival times. Code: `setInterval(tick, 25ms)`
   (engine.js:1025; Node coalesces missed ticks — catch-up bursts are
   impossible) and the pattern clock is a monotonic accumulator
   (`patternClockSeconds += wallDelta × speedMult`, engine.js:750-753 — no
   wrap/normalization hitch). Exactly ONE engine process (coordinator audit).
   Note: the CONTENT (00_golden_hour_wash) has a measured **~1.99 s level
   cycle** on U2 (autocorr r=0.77) — a slow wash's swell can read as rhythmic
   "hitches"; flagged to the operator as a perceptual cross-check, not a claim.
3. **"The 2 chrome connections" (operator hypothesis) — NOT SUFFICIENT BY
   ITSELF.** Controlled A/B (`~/tmp/ab_clients.cjs`), client A = titanic
   2d_pixels instrumented: solo 60 s → 1 freeze; + B (full/webgpu) 60 s →
   1 freeze, zero coupled stalls; + B2 (full + `lighting_mode=pixelblaze`,
   the operator-requested direct-paint path) 60 s → **0 freezes**; even a
   SATURATED second client (full + 2D map overlay = the config that measures
   ~10 longtasks/s, exactly what my op_mimic ran during his observation
   window) produced 1 freeze in 100 s (`~/tmp/ab_saturated.cjs`). The
   rhythmic state existed only under the FULL afternoon load: saturated
   mimic tab + 2,000-test engine suite + sweep pages + his 5-hour-old
   session. Client count is a contention PROXY. 2d_pixels solo:
   1 freeze/120 s, 0 longtasks (matches operator's "looks good").
4. **Timer-callback instrumentation** (`~/tmp/op_mimic.cjs` patches
   setInterval/setTimeout pre-boot and times every callback): across
   full+map and 2d_pixels runs, only ONE >40 ms timer callback total, zero
   autosave/export activity — **no in-page periodic JS stall exists** in a
   fresh tab. Whatever clocks his tab is not a page timer; next capture
   opportunity: if the rhythm reappears, hard-refresh splits session-age vs
   code, and I attach alongside without closing anything.

### Multi-client warning (NEW, operator-authorized)

- `simulation/server/sacn_bridge.js` — broadcasts `{type:'clients', count}`
  to every client on each connect/disconnect + loud transition logs both
  directions (enter >1 / recover ≤1), mirrored to the sACN monitor panel.
- `simulation/src/gui/multi_client_warning.js` (new, top-level HUD — outside
  S4's pixel_map) — red banner `⚠ N sim windows connected — hardware output
  contention risk` in EVERY connected window while count>1; hides on
  recovery and on census-unknown (bridge disconnect). Pure
  `bannerStateForCount()` exported for tests. **Warning only — no
  auto-kick**; writer arbitration (§2.3 options i/ii/iii) remains the
  operator's pending decision.
- `simulation/src/dmx/sacn_input_source.js` — handles the census message;
  hides the banner when the bridge socket drops.
- Tests: `simulation/tests/multi_client_warning.test.js` (6 tests —
  transitions 0/1/2/3/recovery/unknown). Sim suite: **442/442**.
- Live proof: bridge restarted (~16:55, clients auto-reconnected); banner
  verified in two windows with live count updates 2→3→2, screenshots in
  `.agent_renders/flicker_multiclient_{before_1window,after_windowA,
  after_windowB,recovered_1window}.png`. The feature immediately did its
  job: my "solo" window showed "2 connected" — the other was the operator's
  own tab.
- Census transitions in the live log: `⚠ 2/3 sim clients connected …` and
  `✅ Back to 1 sim client(s) — multi-window contention cleared.`

## 8. Honesty notes

- The 0.5–1 s beat is attributed to writer-#2 stale-burst interleaving on the
  strength of: measured tab-jank cadence under contention, code-path
  confirmation of the second writer, and the wire-clean single-writer stream.
  It is NOT yet confirmed by receiver-side counters (gateways expose none /
  were offline) or by the operator A/B (staged, awaiting go). If the A/B
  contradicts it, the next suspect list is in the transcript (engine timeline
  tick, autopilot transitions — both were reviewed and don't touch the wire
  cadence per the 39 Hz tap).
- The uncontended viewport baseline could not be measured with the operator's
  own tab closed (not mine to close); numbers above carry that caveat.
- The GOOD/BAD bistability was reproduced on PRE-fix code both ways; the
  fixed bridge has so far been proven against the route-flap trigger
  specifically (flip-proof), not yet against a full fleet-scale replay.
