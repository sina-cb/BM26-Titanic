# 20260805_161 — SIMULATION test-gap catalog: every untested-but-offline-testable surface, with implementable specs

**Agent:** test-gap discovery `_161` (Fable, operator-requested) · **Branch:** `feat/bm_readiness`
**Partner:** `_162` owns the ENGINE side + cross-process integration; this report is sim-only.
**READ-ONLY on production code.** One action taken: ran the existing sim suite once to measure.
No port in 6966–6972/5568/8081/10000 was bound, no packet sent, no git write.
IPs redacted to `10.x.x.NN` in prose. Scratch: `~/tmp/test_gaps_161/`.

**Working-tree state at survey time:** `_156`'s v3 slice is fully present (post-`_158`
amendment); `_159`'s disarmed-path review had NOT landed — items flagged
`[_159-overlap?]` below must be reconciled against it when it does. Full sim suite
measured **1881 / 1875 / 6** — the same six pre-existing failures the tracker records
(`pixel_map_view_defaults` headroom/collision/docking, `orphan patch record`,
2× `scene_model_parity` CLI Phase-B) — so the catalog below is against a green-modulo-known tree.

**How to read a spec.** Every spec names: the file to create/extend, the harness to
reuse, and assertions concrete enough to write blind. Two proven harnesses already
exist and specs lean on them hard:

- **H-A (in-process bridge harness)** — `tests/bench_mirror_arm.test.js:518–770`:
  `Module._load` interception replaces `sacn` (FakeSender/FakeReceiver) and `ws`
  (FakeWebSocketServer/FakeClient keyed by port, nothing bound), stubs `fetch` as the
  engine, then `require`s the REAL `server/sacn_output_bridge.js` first and the REAL
  `server/sacn_bridge.js` second. Frames are injected via
  `receiverRef.emit('packet', {universe, priority, sourceName, payload, sequence})`;
  every "send" lands in an array. **Implementers: extract this harness into
  `tests/helpers/bridge_harness.mjs` rather than copy-pasting it a third time** —
  that extraction is test-code only, not a production edit.
- **H-B (real save-server on throwaway port/root)** — `tests/save_server_hardening.test.js`:
  spawns the REAL `server/save-server.js` with `SIM_SAVE_SERVER_PORT` (random high
  port) + `SIM_SAVE_SERVER_ROOT` (temp dir). Never touches :6970 or real `scenes/`.

**P0 discipline for implementers:** where current code contains a known falsy-default
or silent-ignore (flagged `[D12-pin]` etc., from `_157`), the spec says PIN the current
behavior with a comment naming the defect and the report — a characterization test that
must be deliberately flipped when the `_157` fix plan lands. Never write a test that
quietly blesses a fallback as design.

---

## 0. Top-10 priority list

| # | Gap | Why it's ranked here | Size |
|---|-----|----------------------|------|
| 1 | **G1** Input-bridge receiver priority arbitration + lockout (`sacn_bridge.js:1263–1310`) — zero tests on the branch that decides which frames reach the hardware relay | A rogue/high-priority source on playa flips this state machine; today its enter/exit/lockout/global-scope behavior is entirely unproven, and `_157` D4's "global across universes" trap has no pin | M |
| 2 | **G3** Bridge WS client lifecycle: `setScene` tagging, disconnect recompute, census broadcast (`sacn_bridge.js:1043–1182`) | This wiring is the fix for the 2026-07-24 bench-freeze root cause; only its PURE half (`bridge_routing.cjs`) is tested — the socket glue that invokes it is not | M |
| 3 | **G4** Engine-poll state machine (`sacn_bridge.js:981–1034`) | "Hardware follows the ENGINE's scene" rests on transitions that have never been exercised: reachable flips, scene change, `outputRouting` disappearing, wrong service answering :6968 | M |
| 4 | **G2** :6972 output-bridge DATA path (`sacn_output_bridge.js:90–248`) | Every physical frame in `sacn_in` mode crosses this parse/pool/error-dedup path; only the GATE is tested. Sender-pool reap (15 s) silently resets E1.31 sequence (`_157` D9) with no pin | M |
| 5 | **G6** `sacn_input_source` frame path + **protocol parity** (`src/dmx/sacn_input_source.js:349–447`) | The 515-byte wire format is hand-rolled at both ends with no round-trip test; an offset drift = sim renders garbage with no failing test. Also home of the `priority ‖ 200` inflation `[D12-pin]` | M |
| 6 | **G5** `UniverseRouter` + `UniverseFrameBuffer` merge core (`src/dmx/universe_router.js`, `universe_frame_buffer.js`) — **zero tests** | Decides what the sim displays AND what bytes `sacn_in` relay sends to real controllers (`getFullFrame` feeds `sendUniverse`); stale-source, merge modes, hold-last-frame all unproven | M |
| 7 | **G10** Input-bridge shutdown ordering (`sacn_bridge.js:2300–2334`) | Ctrl-C paths: disarmed fast-exit, signal-during-blackout, double-signal — none tested; a wrong branch = rig frozen bright at exit (the exact class `_157` D10 flags engine-side) | M |
| 8 | **G7** Save-server untested endpoints (`server/save-server.js`) — pattern delete/save, create/delete-scene, restore-backup at HTTP level, save-cameras/pixel-map-views | Show-night data-loss vector; the backup LIB is tested but most HTTP surfaces (incl. `/delete-pattern` traversal) are not | L |
| 9 | **G8** All-scenes structural lint (data test over `simulation/scenes/*`) | Parity gate covers only test_bench+titanic; the other six scene dirs (incl. a stray `patches.yaml.original`) have no structural checks at all | M |
| 10 | **G12** `sacn_output_client.sendUniverse` frame construction + round-trip with G2 (`src/dmx/sacn_output_client.js:81–122`) | The other half of the 519-byte protocol; carries a `priority ‖ 100` conflation `[D12-pin]` and silent IP-octet coercion | S |

Also specced below: G9 (`load_ports` fail-loud contract, S), G11 (animate.js belt wiring, S),
G13 (monitor-panel pure logic, S, low), G14 (bridge boot-invariant exit paths, S),
G15 (static-host + port-guess characterization, S, low), G16 (broken-sidecar warn dedup, S,
`[_159-overlap?]`). **Total: 16 gaps** (10 priority + 6 secondary).

---

## 1. The catalog

### G1 — Receiver priority arbitration + lockout — **rank 1, size M**

- **Surface:** `server/sacn_bridge.js:1263–1310` (`receiver.on('packet')`), constants from
  `scenes/common.yaml` `colorWave` (`sacn_high_priority: 100`, `sacn_lockout_ms: 1000`,
  live values confirmed) via `readColorWaveSection` (`:125–158`).
- **Current coverage:** `bench_mirror_arm.test.js` injects packets but only to drive the
  mirror; no assertion anywhere touches `highPriorityActive`, `activeSource`, the lockout
  timer, or the low-priority-drop branch. `bridge_routing.test.js` is pure route math.
- **The gap:** the entire arbitration state machine, including:
  - OVERRIDE entry (`priority >= HIGH_PRIORITY`) → `🔴 OVERRIDE` broadcastLog, frame routed;
  - low-priority frame while `highPriorityActive` → **dropped entirely** (no relay send, no
    browser broadcast) — never asserted;
  - lockout release after `LOCKOUT_MS` silence → `🟢 RELEASED` log, low-priority resumes;
  - **the state is GLOBAL across universes** (`_157` D4): high on U1 silences low on U2;
  - falsy conflations `packet.priority ‖ 100`, `packet.universe ‖ 1`,
    `packet.sourceName ‖ 'Unknown'` (`:1264–1266`) — a priority-0 packet is treated as 100,
    a universe-0 packet lands on U1 `[D12-pin]`;
  - first-frame-on-runtime-universe log (`:1268–1272`).
- **TEST SPEC** — new file `tests/sacn_bridge_arbitration.test.js`, harness H-A:
  1. Boot both bridges in-process; connect one fake browser client; capture its received
     messages (binary + JSON) and every `FakeSender` send.
  2. Read the live threshold from `scenes/common.yaml` in the test (never hardcode 100/150):
     `T = colorWave.sacn_high_priority.value`, `L = colorWave.sacn_lockout_ms.value`.
  3. `emit packet {universe: <a relayed universe from the live route table>, priority: T,
     sourceName: 'ROGUE'}` → assert exactly one `{type:'log'}` containing `OVERRIDE` and
     `'ROGUE'` reaches the client, and the frame IS relayed (FakeSender send count +1) and
     broadcast (one 515-byte binary to the client).
  4. While active: `emit packet {priority: T-1, sourceName: 'Engine'}` on the SAME universe →
     assert send count and binary count both UNCHANGED (the drop is total).
  5. Cross-universe pin `[D4-pin]`: `emit {universe: U_other, priority: T-1}` → also dropped.
     Comment: this pins `_157` D4's global-lockout behavior; when D4's per-universe scoping
     lands, flip this assertion to "routed".
  6. Lockout: advance time past `L` (use `node:test` `mock.timers` over `setTimeout`, or
     accept a real `await setTimeout(L + 50)` — L is 1000 ms live) → assert one `RELEASED`
     log, then a T-1 frame routes again.
  7. Conflation pins: `emit {priority: 0}` → treated as 100 (routed as low), `emit
     {universe: 0}` → broadcast binary carries universe 1. Each with a `[D12-pin]` comment
     naming `_157` D12.
  8. Runtime-universe first-frame: emit on a universe not in the boot set → exactly one
     `First frame on U<n>` log; a second frame → no second log.

### G2 — :6972 output-bridge data path — **rank 4, size M**

- **Surface:** `server/sacn_output_bridge.js` — `getSender` (`:90–117`), stale sweep
  (`:123–133`), 519-byte parse (`:163–248`), send error dedup (`:208–233`), stats (`:237–247`).
- **Current coverage:** only the gate (`handleControlMessage`, `releaseGateIfHeldBy`) via
  `bench_mirror{,_arm}.test.js` — refusals, holder-scoped release, drop counting.
- **The gap:** everything a DMX frame actually touches when the mirror is NOT armed:
  frame parse (universe LE at 0, IP octets 2–5, priority byte 6, dmx 7–518), sender-pool
  keying/reuse (`"universe:ip"`), FakeSender constructed with `{universe, port: udpPort,
  useUnicastDestination: ip, defaultPacketOptions: {priority: 100}}`, 1-indexed payload,
  priority passthrough, 15 s stale reap (sequence-reset consequence, `_157` D9), the
  error-log dedup/heartbeat/recovery ladder, malformed-length frames ignored.
- **TEST SPEC** — new file `tests/sacn_output_bridge_datapath.test.js`, harness H-A
  (output bridge only; no input bridge needed):
  1. Connect a fake client; build a 519-byte `Buffer`: universe 7 LE, ip bytes `10,0,0,42`,
     priority 100, dmx = `i % 256` ramp. Send → assert ONE FakeSender created with
     `universe === 7` and `useUnicastDestination` equal to the same dotted quad the ip bytes encode; its `send()` got
     `payload` with keys `'1'..'512'` where `payload[k] === (k-1) % 256`, `priority === 100`.
  2. Same (universe, ip) again → pool size still 1 (reuse); different ip → 2.
  3. Priority passthrough: byte 6 = 0 → `send({priority: 0})` — assert the literal 0 arrives
     (the bridge passes it; the CLIENT is where 0 is inflated — see G12).
  4. Malformed: 518- and 520-byte buffers → zero senders created, zero throws, and — if the
     bytes happen to parse as non-JSON — zero acks (they fall into `handleControlMessage`
     and are ignored). Characterization with a comment: silent-ignore is the DOCUMENTED
     legacy contract here (`:164–169`), not a fallback being blessed.
  5. Error ladder: make `FakeSender.send` reject with `EHOSTDOWN` → first frame logs once;
     N more identical rejections inside 30 s → no new lines, `errorsSinceLog === N`; advance
     `Date.now` past `ERROR_LOG_INTERVAL_MS` (monkeypatch `Date.now` or mock timers) → one
     heartbeat naming the suppressed count; then a resolving send → one `Recovered` line and
     state reset. (Assert via a captured `console.error/log` — same technique the arm test
     uses for bridge logs.)
  6. Stale reap: `mock.timers` advance 20 s with no frames → sender `close()` called, pool
     empty; next frame recreates. Add comment: recreation resets E1.31 sequence to 0
     (`_157` D9) — this test pins WHEN that happens, the fix plan owns whether it should.
  7. Backpressure/burst sanity: 500 frames in one tick to one destination → exactly 500
     `send()` calls, pool size 1, process alive (no unbounded structure growth beyond the
     one entry — assert `senderPool.size === 1`).

### G3 — Bridge WS client lifecycle: setScene / disconnect / census — **rank 2, size M**

- **Surface:** `server/sacn_bridge.js:1043–1182` (`broadcastClientCensus`, connection
  handler, message dispatch, close handler).
- **Current coverage:** `multi_client_warning.test.js` covers the BROWSER banner (6 tests);
  `bridge_routing.test.js` covers the pure union math; the arm test covers `benchMirrorArm/
  Disarm/Options` dispatch and status-on-connect. NOT covered: `setScene` tagging through
  the real socket handler, the disconnect recompute, census broadcasts, non-JSON tolerance,
  `getRoutes` reply-failure path.
- **The gap + TEST SPEC** — new file `tests/sacn_bridge_client_lifecycle.test.js`, H-A:
  1. Connect client A, send `{type:'setScene', scene:'test_bench'}` → subsequent
     `getRoutes` reply's `activeScenes` includes `test_bench`; live senders appear for
     test_bench's pairs (read expected pairs from the scene files exactly as
     `bench_mirror_arm.test.js` does — no literals).
  2. Client A re-tags `{scene:'titanic'}` → old scene's client-contributed routes leave the
     union (unless pinned/engine-held), new ones join; `getRoutes.activeScenes` reflects the
     swap. (The pure math is tested; THIS asserts the `clientScenes` map glue at `:1095–1098`.)
  3. Connect client B → BOTH clients receive `{type:'clients', count:2}`, and a warn log
     mentioning contention goes out exactly once for the 1→2 transition (`:1058–1061`);
     disconnect B → `{count:1}` broadcast + the `cleared` line once (`:1062–1064`).
  4. Disconnect a scene-tagged client → a recompute runs (observable: its scene's
     client-only routes leave the next `getRoutes` snapshot).
  5. Robustness: send a non-JSON text frame, then `{type:'getRoutes'}` with no reqId, then
     a JSON frame with an unknown type → no throw, socket still answers a well-formed
     `getRoutes` afterwards.
  6. `getRoutes` reply failure: monkeypatch that client's fake `send` to throw once →
     assert the warn line (`:1117–1118`) and that the SERVER keeps serving other clients.
- **Note:** same-socket FIFO ordering (`setScene` then `getRoutes` answered post-recompute)
  is already asserted end-to-end in `bridge_route_readback.test.js` ("integration — notify
  then read-back") — do NOT respec it; extend that file only if the harness differs.

### G4 — Engine-poll state machine — **rank 3, size M**

- **Surface:** `server/sacn_bridge.js:981–1034` (`pollEngineStatus`), `ENGINE_POLL_MS=3000`,
  abort at `ENGINE_POLL_MS-500`.
- **Current coverage:** the arm test stubs `fetch` to a healthy engine and exercises
  R-6/R-7/R-8/R-21 arm refusals + the two runtime auto-disarm transitions. The poll's OWN
  transition/logging/dedup logic is untested.
- **The gap + TEST SPEC** — new file `tests/sacn_bridge_engine_poll.test.js`, H-A (the
  harness's `fetch` stub must be swappable per test):
  1. Unreachable → reachable: first poll with fetch rejecting → `engineState.reachable`
     false, no engine routes in `getRoutes`; swap stub to healthy
     `{service:'marsin-engine', activeScene:'titanic', outputRouting:{controllers:[]}}` and
     invoke the poll → ONE `Engine up` broadcastLog, engine-scene routes appear.
  2. Scene change: `activeScene` titanic → studio → ONE `scene changed` log and the route
     set swaps (studio's pairs from disk).
  3. Signature dedup: two consecutive identical polls → exactly one recompute/log total
     (assert no duplicate `Engine up`/scene lines; optionally count `getRoutes` snapshots'
     stability).
  4. `activeScene: 'unknown'` → `next.scene === null` (assert via arm refusal R-7 text or a
     status field, whichever the harness exposes).
  5. Wrong service: `{service:'other-thing'}` with 200 OK → treated UNREACHABLE (`:997`).
  6. `res.ok === false` (500) → unreachable, one warn on the transition.
  7. `outputRouting` absent (undefined) → `ownedUnavailable` true + the one-time "too old
     for dual-source suppression" warn (`:1029–1032`); present-empty → no warn.
  8. Re-entrancy: make fetch hang (never-resolving promise), call `pollEngineStatus()` twice
     → second call returns immediately (`_enginePollBusy`, `:987`); resolve → state settles
     once. (All calls direct — never wait for the 3 s interval; the interval itself is
     `unref`'d and boot-called, already exercised by loading the module.)

### G5 — UniverseRouter / UniverseFrameBuffer merge core — **rank 6, size M**

- **Surface:** `src/dmx/universe_router.js` (207 lines), `src/dmx/universe_frame_buffer.js`
  (106 lines). Pure ESM, no DOM. **Zero tests reference either.**
- **Why it matters:** `processFrame()` decides the read buffers that (a) paint every fixture
  in the sim and (b) are read back by `animate.js:732` `getFullFrame` and sent to REAL
  controllers in `sacn_in` mode. `SOURCE_STALE_MS=2000` staleness is the only thing that
  stops a dead source from holding the rig.
- **TEST SPEC** — new file `tests/universe_router.test.js` (plain ESM import, like
  `dmx_output_gate.test.js`):
  - Monkeypatch time: `const realNow = performance.now` / restore in `after`; or inject by
    advancing a wrapper — the module calls `performance.now()` directly, so patch
    `globalThis.performance.now`.
  1. **source_lock:** two sources on U1 (prio 200 full-255 frame, prio 100 full-17 frame) →
     after `processFrame`, `getFullFrame(1)` is all 255; remove/stale the 200 source → next
     `processFrame` yields all 17.
  2. **Stale boundary:** source last seen exactly 2000 ms ago → INACTIVE (`< SOURCE_STALE_MS`
     is strict); 1999 ms → active. Assert via `isSourceActive` AND via merge output.
  3. **Hold-last-frame:** all sources stale → `swap()` not dirty → read buffer RETAINS the
     last merged frame (assert byte-identical), write buffer stays zeroed. This is the
     documented hold behavior (`universe_frame_buffer.js:76`) — pin it with a comment that
     hardware-facing timeout behavior lives elsewhere.
  4. **htp mode:** per-channel max of two overlapping partial writes at different
     `startAddr`s; verify a channel covered by only one source keeps that source's value.
  5. **highest_priority_per_patch:** currently identical to source_lock (`:147–157`) —
     characterization test with a comment that per-patch routing is unimplemented; if
     someone implements it, this test must be rewritten, not deleted.
  6. **Bounds:** `write(startAddr=1, 512 bytes)` fills exactly; `write(500, 20 bytes)` →
     channels 500–512 written, no overflow, no throw; `getSlice(510, 10)` returns a 3-byte
     view (subarray clamp) — assert `.length === 3` so a future "pad to footprint" change
     is a conscious one.
  7. **View semantics:** `getSlice` returns a live view — after the next `swap()`, the view
     reflects the new frame (this is load-bearing for fixture runtimes; pin it).
  8. **Equal priorities:** two sources, same priority, insertion order A then B → document
     which wins (`Array.prototype.sort` is stable: first-submitted wins after sort). Pin it.
  9. `submitFrame` updates priority on every call (a source can re-priority itself); `clear()`
     zeroes both buffers.

### G6 — sacn_input_source frame handling + protocol parity — **rank 5, size M**

- **Surface:** `src/dmx/sacn_input_source.js` — `_handleMessage` (`:349–369`),
  `_handleTextMessage` (`:371–410`), `_handleDmxFrame` (`:412–447`), `_cleanup` waiter
  rejection (`:307–342`), `disable()` (`:95–106`).
- **Current coverage:** `queryRoutes` waiter logic fully covered (`bridge_route_readback`),
  bench-mirror waiters + banner/census dispatch covered (`bench_mirror_arm`). NOT covered:
  the DMX frame path, the binary/text dispatch, stats bookkeeping, `disable()`.
- **TEST SPEC** — new file `tests/sacn_input_frames.test.js`:
  - Setup: `global.window = { dmxRouter: fake, sacnLog: recorded }` (the module reads
    `window.*` lazily inside methods; construct `new SacnInputSource('ws://x')` directly —
    do NOT touch the singleton/`getSacnInput`). The imports (`static_host`,
    `multi_client_warning`, `bench_mirror_banner`) are already node-safe (the arm test
    imports two of them).
  1. 515-byte `ArrayBuffer` (universe 9 LE at 0, priority 100 at 2, ramp dmx at 3..514) →
     fake router got `addUniverse(9)` (when unknown) then
     `submitFrame('sacn_in', 100, 9, dmx)` with `dmx.length === 512` and byte parity with
     the input ramp; stats updated (`framesReceived`, `lastUniverse`, `lastPriority`,
     `lastFrameAt > 0`, `activeUniverses` contains 9).
  2. **`[D12-pin]` priority-0 inflation:** frame with priority byte 0 → router receives
     priority **200** (`priority ‖ SACN_DEFAULT_PRIORITY`, `:428`). Pin with a comment
     naming `_157` D12; the post-fix assertion is `0`.
  3. **Round-trip parity (the load-bearing one):** in the SAME test file, require
     nothing from the server — instead replicate `routeFrame`'s writer (`sacn_bridge.js:
     2257–2260`: `writeUInt16LE(universe,0)`, `writeUInt8(priority,2)`, dmx at 3) as a
     fixture builder, and assert the client parses back the exact tuple. THEN add a
     one-line source guard: read `server/sacn_bridge.js` text and assert it still contains
     `Buffer.alloc(515)` / `writeUInt16LE(universe, 0)` / `writeUInt8(priority, 2)` so a
     server-side format change breaks THIS test by name. (Full two-process parity already
     exists implicitly in the arm harness; this makes the byte layout an explicit contract.)
  4. Non-515 ArrayBuffer containing JSON `{type:'log'}` → decoded and forwarded to
     `window.sacnLog` (`:362–367`); containing garbage bytes → no throw, nothing logged.
  5. String `{type:'clients', count:2}` → census handler path (assert via the banner DOM…
     no — assert `handleClientCensus` effect indirectly is already covered; here just assert
     no throw and that an unknown `type` is ignored).
  6. `disable()` → `window.dmxRouter.removeSource('sacn_in')` called, `stats.connected`
     false, pending waiters of all three maps rejected (construct one of each first).

### G7 — Save-server endpoint coverage — **rank 8, size L**

- **Surface:** `server/save-server.js` endpoints: `/save-cameras` (`:480`),
  `/save-pixel-map-views` (`:502`), `/save-stl` (`:546`), `/save-pattern` (`:567`),
  `/delete-pattern` (`:587`), `/list-patterns` (`:611`), `/save-model` (`:621`),
  `/create-scene` (`:662`), `/delete-scene` (`:740`), `/backups` (`:771`),
  `/restore-backup` (`:787`), `/list-scenes` (`:948`).
- **Current coverage:** H-B covers hostile bodies for `/save` + `/controllers/probe` +
  oversize + failed-write-500. `scene_backup.test.js` covers the backup LIB including
  traversal (9 tests). `scene_duplicate.test.js` covers the duplicate lib.
  `led_gamma*.test.js` cover the gamma service. The endpoints listed above have NO
  HTTP-level tests.
- **TEST SPEC** — new file `tests/save_server_endpoints.test.js`, harness H-B (copy the
  `before/after` spawn block; seed the temp root with a minimal scene dir cloned from
  `scenes/test_bench` minus playlists, plus a `patterns/` dir with one dummy file):
  1. **`/delete-pattern` traversal (the sharp one):** plant a sentinel file OUTSIDE the
     patterns dir inside tmpRoot; POST names like `../sentinel`, `..\\sentinel`,
     `%2e%2e/sentinel`, absolute paths → assert 4xx (or effective refusal), sentinel
     survives, and the response body NAMES the rejection (fail-loud, not silent-200).
     Mirror the same probe set on `/save-pattern`, `/restore-backup` (`id` field),
     `/delete-scene`, `/create-scene`, `/scene/duplicate` (names). `scene_backup.cjs`
     already rejects traversal at the lib layer — these assert the HTTP layer actually
     ROUTES through the guarded lib and answers a named error, not a 500 stack or a 200.
  2. **Happy paths into tmpRoot:** `/save-cameras` + `/save-pixel-map-views` for the seeded
     scene → file exists at `scenes/<scene>/cameras.yaml` / `pixel_map_views.yaml`, parses
     as YAML, answer 200 with `ok`; `/list-scenes` includes the seeded scene;
     `/list-patterns` lists the dummy; `/save-pattern` then `/delete-pattern` round-trips.
  3. **`/create-scene` then `/delete-scene`:** created dir has the expected skeleton;
     deleting a NON-existent scene → 4xx named; deleting the seeded scene does not touch a
     sibling.
  4. **`/backups` + `/restore-backup` HTTP glue:** perform a `/save` (mutating a seeded
     file), assert a backup dir appeared; `GET /backups?scene=` returns it newest-first;
     `POST /restore-backup` with its id → file content rolled back; with garbage id → 404
     and body names it (`:773` comment promises reject-never-sanitize — assert it).
  5. **Silent-default characterization `[P0-tension]`:** `/save-cameras` with NO scene param
     → today resolves to `titanic` (`resolveSceneCamerasPath`, `:60–63` `‖ 'titanic'`).
     In the tmpRoot there is no titanic — assert whatever loud/quiet behavior results and
     PIN it with a comment: a missing scene name silently targeting titanic is a defect
     candidate for the fix plan, and this test is its tripwire.

### G8 — All-scenes structural lint — **rank 9, size M**

- **Surface:** the eight scene dirs under `simulation/scenes/` (led202, studio,
  studio_top_loft, studiodj, summer_camp_dome, summer_camp_logsville, test_bench, titanic)
  + `common.yaml` + `manifest.json`.
- **Current coverage:** `scene_model_parity.test.js` runs the REAL validator on
  **test_bench and titanic only**. `bridge_routing.test.js` covers `readPatchDeclarations`
  on synthetic trees. Nothing validates the other six scenes, and the bridge's boot scan
  (`getAllPatchUniverses`) intentionally warn-and-continues past a malformed file — so a
  broken studio patches.yaml today produces one console warn nobody reads.
- **TEST SPEC** — new file `tests/scene_data_lint.test.js` (data-only; `js-yaml` +
  `lib/bridge_routing.cjs`):
  1. Every `scenes/*/{scene_config,patches,controllers,cameras,views,pixel_map_views,
     bench_mirror}.yaml` that EXISTS parses as YAML without throwing (walk with
     `fs.readdirSync`; missing files are legal — led202 has only scene_config).
  2. For every existing `patches.yaml`: `readPatchDeclarations(tree)` reports
     `anomalies.length === 0` — or, if a committed anomaly is currently real, an explicit
     per-scene allowlist frozen in the test with a comment (measure first, then freeze).
  3. Per (scene, controller IP): no two patch records overlap in (universe, address..
     address+footprint) — reuse the parity validator's overlap rule only for the six
     scenes parity does not gate; footprints from `dmx/fixtures` registry where resolvable,
     else the record's own footprint/segments.
  4. `controllers.yaml` (where present): every IP is a well-formed dotted quad, no
     duplicate controller IPs within a scene (the parity suite proves this class for
     titanic/test_bench; this extends the invariant).
  5. **Residue tripwire:** assert NO file under `scenes/` matches
     `*.original|*.bak|*.orig|*~` — `summer_camp_dome/patches.yaml.original` exists TODAY
     and will fail this until the operator disposes of it: surface it in the test message
     ("delete or archive — robocopy /MIR ships junk in scenes/ to the show server").
     Implementer: raise it to the operator via the tracker rather than deleting the file.
  6. Playlist references: every `playlists/*.yaml` `entries[].pattern` resolves to
     `marsin_engine/patterns/<pattern>.js` **[boundary: coordinate with `_162` — if their
     engine catalog test already asserts this, drop this clause rather than duplicate]**.

### G9 — `load_ports.cjs` fail-loud contract — size S

- **Surface:** `lib/load_ports.cjs` (69 lines). Required by every server process at boot.
- **Current coverage:** exercised incidentally by every harness; its REFUSALS are never
  tested.
- **TEST SPEC** — new file `tests/load_ports.test.js`:
  1. A temp config with all five ports → returns them; `sacn_udp_port` absent → 5568.
  2. Missing `sacn_port` → throws naming BOTH the key and the resolved path.
  3. `http_port: "6969"` (string) → throws (Number.isInteger gate).
  4. `sacn_interface: ''` and `sacn_interface: 3` → throw; absent → `null`; a valid
     dotted quad wrapped in whitespace → trimmed.
  5. `BM26_SIM_CONFIG` set to a temp file → wins over the passed path; set to a
     nonexistent path → throws (readFileSync), NEVER falls back to the real config.
     (Save/restore the env var in `before/after` — the arm test already manipulates it.)

### G10 — Input-bridge shutdown ordering — **rank 7, size M**

- **Surface:** `server/sacn_bridge.js:2300–2334` (`shutdown`).
- **Current coverage:** none. The arm suite covers disarm-on-disconnect and
  blackout-in-flight refusals but never the SIGNAL paths.
- **TEST SPEC** — extend the H-A harness file (or new `tests/sacn_bridge_shutdown.test.js`;
  note H-A loads the bridge ONCE per process, so shutdown tests must run LAST or in a
  separate spawned-harness file — prefer a separate file that re-creates the harness):
  - Stub `process.exit` (save/restore; record calls) BEFORE emitting signals; invoke via
    `process.emit('SIGINT')`.
  1. Disarmed, no blackout → `exit(0)` called synchronously, log contains
     `was not armed`, and NO zero frames were sent to any FakeSender.
  2. Armed → `exit` NOT called synchronously; each owned destination receives exactly 3
     all-zero frames (same counting the arm tests use), THEN `exit(0)`; gate released on
     the output bridge (its fake link sees the ungate or the link close).
  3. Signal DURING a disarm blackout (`_mirrorArm` null, `blackoutInFlight()` true — enter
     via a disarm whose FakeSender zeros are withheld behind a manual promise) → the
     `waiting for its all-zero frames` branch (`:2320–2325`): `exit` fires only after
     `_blackoutSettled` resolves — release the sends and assert ordering.
  4. Double signal → second `shutdown` returns immediately (`_shuttingDown`), `exit`
     recorded once (plus the bounded 1500 ms timer is `unref`'d — assert no test hang).

### G11 — animate.js `sacn_in` output loop: belt + grouping rules — size S

- **Surface:** `src/core/animate.js:680–740`.
- **Current coverage:** none. The SERVER gate is fully tested; the belt (`!benchMirrorArmed`
  at `:703`, strict `armed === true` at `:701`) and the group-skip rules (`:714`:
  `!u || u<=0 || !addr || addr<=0 || !ip || ip==='0.0.0.0'`) are not.
- **TEST SPEC** — new file `tests/animate_output_wiring.test.js`, text/AST level (the loop
  is inline in a giant closure; this repo already uses source-text wiring tests —
  follow that pattern, with `acorn` parse if regex gets brittle):
  1. The `sendUniverse` call site is lexically inside a block guarded by a condition
     containing `!benchMirrorArmed` and `sacnOutputClient.connected`.
  2. `benchMirrorArmed` is computed with a strict `.armed === true` comparison.
  3. The skip line for `0.0.0.0` and non-positive universe/address exists verbatim.
  4. The literal `priority: 150` appears exactly ONCE in the file (the outputGroups
     construction) — a second occurrence or a removal is a deliberate re-review trigger
     (`_157` D2/priority-150 is a named defect; when its fix changes 150, this count
     assertion is the tripwire that the belt was updated CONSISTENTLY).
  5. `window.__readonlyMode` gates the whole block (iPad observer safety).

### G12 — sacn_output_client frame construction — **rank 10, size S**

- **Surface:** `src/dmx/sacn_output_client.js:81–122` (`sendUniverse`).
- **Current coverage:** none.
- **TEST SPEC** — new file `tests/sacn_output_client_frames.test.js` (direct class
  construction; fake `this._ws = {send: captured}`; set `_connected = true`):
  1. 519-byte layout: universe LE at 0, ip string `'A.B.C.D'` → bytes `A,B,C,D` at 2–5,
     priority at 6, dmx ramp at 7–518. Cross-parse the captured ArrayBuffer with the
     OUTPUT BRIDGE's own reader logic (universe `getUint16(0,true)`, `bytesToIp`, etc.
     replicated as a fixture) — the round-trip mate of G2 step 1.
  2. **`[D12-pin]`:** `priority = 0` → byte 6 is **100** (`priority ‖ DEFAULT_PRIORITY`,
     `:98`). Pin with a `_157` D12 comment; post-fix expectation is 0.
  3. Silent IP coercion: a quad with a non-numeric octet (`'A.B.x.D'`) → octet `0` at
     that position (`parseInt ‖ 0`, `:94`) — characterization pin: a typo'd controller
     IP today becomes a VALID different address (`A.B.0.D`) rather than a refusal.
     Flag in the comment as a fix-plan candidate (fail-loud rule).
  4. Short dmx buffer (100 bytes) → bytes 0–99 copied, 100–511 zero; oversized (600) →
     truncated at 512.
  5. Not connected → no send, no throw, no stats mutation.

### G13 — sACN monitor panel pure logic — size S, LOW priority

- **Surface:** `src/gui/modern/sacn_monitor_panel.js` — `readDirectionStats` (`:70–88`),
  `formatUniverses` (`:33–39`), `pushLog` cap (`:50–53`).
- **Current coverage:** the arm suite asserts §8.5 (no actionable ARM control) and the
  read-only projection via `benchMirrorControlState`; the stats/dot logic is untested.
- **Caveat:** the module imports `htm/preact` — NOT node-resolvable today. The pure
  functions are module-private anyway. Options for the implementer, in order: (a) test
  only via a source-text guard that the dot ladder and the 20-entry cap literals exist
  (cheap, weak); (b) propose (as its own reviewed slice, not inside the test task) moving
  `readDirectionStats`/`formatUniverses` to a DOM-free sibling module like
  `bench_mirror_control.js` did, then unit-test properly. Spec (b)'s assertions now:
  dot = `'receiving'` iff connected && fps>0, `'connected'` iff connected && fps===0,
  `''` otherwise; `st.lastPriority ‖ '—'` renders priority 0 as `'—'` `[D12-pin]`;
  `formatUniverses(new Set([3,1,2]))` → `'3 [1,2,3]'`; log capped at 20 keeping newest.

### G14 — Bridge boot invariant + receiver-error exit paths — size S

- **Surface:** `server/sacn_bridge.js:1226–1253` (`receiver.on('error')` fatal/non-fatal
  fork, `listening` invariant → `process.exit(1)`).
- **Current coverage:** `sacn_receiver_boot.test.js` proves the LIB (classification,
  invariant, gate) exhaustively, including two LIVE socket tests. The BRIDGE's use of the
  lib — that a fatal classification actually exits and a non-fatal one broadcasts and
  continues — is glue with no test.
- **TEST SPEC** — extend the harness file from G1 (needs `process.exit` stubbed as in G10):
  1. `receiverRef.emit('error', addMembershipEINVALShaped)` → non-fatal: one broadcastLog
     warn to clients, `process.exit` NOT called, a subsequent packet still routes.
  2. `receiverRef.emit('error', socketLevelError)` → `process.exit(1)` recorded.
  3. Boot-gate replay through the REAL socket-listening handler: the harness already
     drives `receiver.socket.emit('listening')` implicitly at load — assert the boot
     recompute ran exactly once (no double `recomputeRoutes('boot')` route churn:
     `getRoutes` stable across a second synthetic `listening` — or simpler, assert the
     invariant-violation branch: pre-poison `receiver.universes` with an extra entry
     before emitting a second `listening` → `exit(1)` with the universe named).
     (Implementer: check FakeReceiver's `listening` emission order in the harness first;
     if the harness never emits it, THAT is worth a test of its own — the boot gate would
     be holding every recompute in the fake world and the arm tests pass only because
     `open()` was called some other way. Verify, then pin whichever is true.)

### G15 — Static-host gates + config-fetch port fallbacks — size S, LOW

- **Surface:** `sacn_input_source.js:79–90, 463–495`; `sacn_output_client.js:47–59,
  202–234`.
- **Gap:** `enable()` refuses on static hosts (both classes); the singleton's
  `fetch('config.yaml')` port-guess fallbacks (`match ? m[1] : '6971'` / catch → hardcoded
  port) are `[D12-pin]` P0-tension fallbacks flagged by `_157` D12.
- **TEST SPEC** — fold into G6/G12 files: with `isStaticHost` true (set the hostname global
  it reads — see `src/core/static_host.js` for the exact signal), `enable()` leaves
  `_enabled` false and never constructs a WebSocket (fake `global.WebSocket` that throws if
  constructed). For the port-guess: source-text pin only (the singleton is
  fetch-in-module-scope; don't contort — assert the two fallback literals exist with a
  D12 comment so their removal is visible).

### G16 — Broken-sidecar warn dedup + spec surfacing (disarmed path) — size S `[_159-overlap?]`

- **Surface:** `server/sacn_bridge.js` `readBenchMirrorSpecs` (`:471–499`) +
  `_warnedMirrorSpecs` dedup; `warnOnce` (`:349–354`).
- **Current coverage:** parse refusals are exhaustively covered at the LIB level
  (`bench_mirror.test.js`, 52 tests); the arm test covers `specErrors` reaching refusals
  and the control state. NOT covered: the warn-once-per-(scene|message) dedup across
  repeated recomputes, and a broken sidecar appearing in `benchMirrorStatus.specErrors`
  for a fresh client while DISARMED.
- **TEST SPEC** — extend G3's file: point the harness at a temp scene tree? No — scenes
  are read from `SIM_ROOT/scenes` which is fixed; instead TEMPORARILY the test cannot
  add a broken sidecar without writing into `scenes/` (forbidden). Therefore: assert the
  dedup with the LIVE (valid) tree via log counting on repeated recomputes (weak), and
  leave the broken-sidecar-status case to `_159`'s review if it lands a fixture strategy;
  if `_159` doesn't, file a follow-up proposing a `BM26_SIM_SCENES_ROOT` test-only env
  hook (same pattern as `SIM_SAVE_SERVER_ROOT` — a PRODUCTION edit, so it goes through a
  reviewed slice, not a test PR).

---

## 2. Explicit non-gaps (checked, adequately covered — do not re-spend)

| Surface | Evidence |
|---|---|
| Bench-mirror ARM/DISARM/gate, cadence, tearing, CID/priority, socket-scoped disarm, auto-disarm reasons, R-1…R-23 | `bench_mirror_arm.test.js` (54 tests, tier-2 in-process bridges), `bench_mirror.test.js` (52), `bench_mirror_resolve.test.js` — plus `_158`'s adversarial re-measurement |
| Route union/ownership/suppression pure math, sentinel refusal, subscription diff, patch declarations incl. LED spill | `bridge_routing.test.js` (43) |
| Route read-back protocol (reqId correlation, timeouts, transport failures, FIFO integration) | `bridge_route_readback.test.js` (24) |
| Subscribed-universes field arithmetic + save-flow dialog | `subscribed_universes.test.js` (30) |
| Receive-socket boot lib: iface resolution, boot gate, error classification, EINVAL live repro | `sacn_receiver_boot.test.js` (19, incl. 2 live-socket) |
| Save-server hostile bodies (P1-1 probe kill, oversize, failed-write 500) | `save_server_hardening.test.js` (8, real process on throwaway port) |
| Scene backup/restore LIB incl. traversal + coalescing + pruning | `scene_backup.test.js` (9); duplicate: `scene_duplicate.test.js` |
| Launcher supervision: port checks, health probes, freeze watchdog, restart budget, real -9 e2e | `launcher_supervision.test.js` (6) |
| Controller probe service, MarsinLED client, gamma push | `controller_probe_service.test.js` (27), `marsinled_client.test.js` (26), `led_gamma*.test.js` |
| Multi-client banner (browser side) | `multi_client_warning.test.js` (6) |
| Bench-mirror banner text/hide, header-control 8 states, picker preselect/refusal render | in `bench_mirror_arm.test.js` tier 1 |
| View masks/views system: registry, bulletproofing, hi-export, persistence round-trip, rename invalidation | `views_bulletproofing` (15), `pixel_map_views` (55), `view_mask_hi_export` (13), `view_mask_persistence_roundtrip` (4), `rename_invalidation` (36) |
| Pixel map panes/edit/persistence/fit/frame source | 15 `pixel_map_*` files |
| Scene↔model parity validator (synthetic coverage + LIVE gates for test_bench + titanic) | `scene_model_parity.test.js` |
| DMX output gate math + exporter join | `dmx_output_gate.test.js` (16), `dmx_output_overrides.test.js` |
| sACN mapper, controller status/registry, address merge (+runtime), orphan fixtures/removal | dedicated files each |

Not covered and **deliberately not specced** (needs a browser, not offline-unit-testable
at fair cost): drag/panel DOM behavior in `floating_panel.js`, three.js render paths,
`scene_recovery.js` modal flow (fetch+DOM+reload; its lib halves are the tested
backup/restore endpoints), `gui_builder.js` beyond the 15 existing wiring tests.

## 3. Overlap ledger

- **`_159` (pending):** G16 flagged; if their review lands fixture machinery for broken
  sidecars, G16 upgrades from "weak log-count" to a real test.
- **`_157` fix plan:** every `[D12-pin]`/`[D4-pin]` characterization above is designed to
  be FLIPPED by the D1/D4/D12 fixes — the pins make the fixes' behavioral deltas visible
  in review instead of silent.
- **`_162` (engine/integration):** G8 step 6 (playlist→pattern resolution) is the one
  shared edge; they own `/status` shape truth (G4 consumes it as a stub).

## 4. Estimated totals

16 gaps: 7 M, 1 L, 8 S. The top-6 (G1–G6) are all reachable with the two existing
harnesses; the single prerequisite worth doing first is extracting H-A into
`tests/helpers/bridge_harness.mjs` (pure test refactor, no production edit).
