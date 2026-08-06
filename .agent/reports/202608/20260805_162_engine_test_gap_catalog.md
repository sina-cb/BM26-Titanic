# 20260805_162 — Engine-side test-gap catalog: every untested-but-offline-testable surface

**Agent:** test-gap discovery `_162` (Fable, operator-requested) · **Branch:** `feat/bm_readiness`
**Scope:** `marsin_engine/` + cross-process boundaries (engine→bridge, CaptainPad↔engine).
Partner `_161` owns the simulation side. **DISCOVERY ONLY** — zero production edits, zero
git ops, no ports bound, no packets sent, no suites run (counts cited from `_156`/`_158`).
Specs are written for a Sonnet implementer who never saw this conversation; Opus reviews.

**Tree state at survey time:** `_156` LANDED (unmerged) + the post-`_158` amendment
(D-158-1/2/3 fixed in-tree, awaiting re-verification). Working tree carries the
documented engine-suite state residue in `marsin_engine/states/**` and `_156`'s edits;
none of it was touched. Engine suite totals are nondeterministic ±3 (known runner IPC
issue in `effects_v2_mode_page_layout.test.js`) — every count-sensitive spec below must
assert its OWN file's counts, never the suite total.

---

## 0. Top-10, ranked by playa impact

| # | Gap | Size |
|---|---|---|
| 1 | **G-1** `lib/sacn_output.js` has ZERO tests — the engine's only output path is unpinned at the wire level (packet fields, per-universe fan-out, start/stop gating, zero-channel semantics) | M |
| 2 | **G-2** `mapPixelsToSacn` (outgoing packing, `simulation/src/dmx/sacn_mapper.js:260`) has ZERO tests — every DMX byte the rig emits crosses this function; only the demap (inbound) direction is tested | M |
| 3 | **G-4** engine↔bridge cross-process contract has no permanent in-process rig — `_157`/`_158` proved the fake-`dgram` technique works, then left it in `~/tmp` | L |
| 4 | **G-3** only the `titanic` model has load-time tests — 8 other models (incl. `test_bench`, the bench-smoke model) can rot silently; no patch-table lint exists for ANY model | M |
| 5 | **G-5** REST surface has no malformed/hostile-input sweep — unauthenticated on the playa LAN (`_157` D7), yet no test sends broken JSON, oversize bodies, or traversal names at the HTTP layer | M |
| 6 | **G-6** corrupt state YAML behavior is completely unpinned — `state_manager.load()` silently limps to defaults (`lib/state_manager.js:109-117`), no test, no `/status` visibility, P0 tension unruled | S |
| 7 | **G-8** config.yaml key matrix — beyond the 3 guard keys, no test covers missing/wrong-typed keys; survey found LIVE dead keys and a wrong-typed value in the repo config | M |
| 8 | **G-9/G-10** CaptainPad↔engine contract — WS connect-replay set and the picker catalogs (`/model/view-selection-options`, `/patterns`, `/playlists`) are pinned on neither side against what CaptainPad actually parses | M |
| 9 | **G-7** shutdown ordering + blackout count unpinned — inputs-stopped-first ordering (`engine.js:2487`) and the 1× shutdown blackout (`_157` D10's inconsistency) have no test | S |
| 10 | **R-D5/R-D8** loud-failure regression specs for the `_157` fix wave (receiver drop listeners, sender socket error listeners) — specs ready below, blocked on their fix slices | S each |

Catalog total: **16 gap entries (G-1…G-16) + 8 regression specs (R-D1…R-D12) + 6 survey
defect notes (N-1…N-6) + explicit non-gaps (§5).**

---

## 1. Method

Inventoried all ~230 test files under `marsin_engine/tests/**` (12 domains + tools/vsn1/
e2e), mapped their assertions onto `lib/*.js`, `engine.js`, the two shared
`simulation/src/dmx/` modules the engine imports (`sacn_mapper.js`, `universe_router.js`),
and `CaptainPad`'s engine-facing parsers. Walked uncovered branches by hand. Ranked by
"what goes wrong on the playa at night and how silently."

Test conventions (binding on every spec below): unit files are
`tests/<domain>/<name>.test.js` (node:test, run by `npm test`); spawned-engine suites use
`tests/helpers/spawn_engine.mjs` (`createEngineHarness`) with `--dest 127.0.0.9`
(black-hole) so no packet can reach the operator's live bridge; **no test may bind
6966-6972, 5568, 8081, or 10000** — spawned engines take the harness's 7100-7399 random
port; in-process wire tests fake the socket layer instead of binding 5568. The vendored
`sacn@4.6.2` is CJS: patching `dgram.createSocket` (the module singleton) before
constructing a `Sender`/`Receiver` intercepts every datagram in-process — the exact
technique of `_157`'s `probe.cjs` and `_158`'s `bm158_gate_window.mjs`.

---

## 2. Catalog — sACN output path (post-`_156`)

### G-1 — `lib/sacn_output.js`: the engine's only output path, zero tests — **rank 1, size M**

**Surface:** `createSacnOutput` (121 lines): per-(universe,destination) `Sender` creation,
sparse payload build (`:75-79`), `_started` gating, `addUniverse`, `stop()` close,
send-error throttle integration, frameCount.
**Current coverage:** none. (`send_error_throttle.test.js` covers the throttle in
isolation; `output_config_guard.test.js:94` greps `engine.js` for the call — neither
sends a frame.)
**The gap:** nothing pins one-datagram-per-(universe,dest)-per-frame, packet field
placement, or the zero-channel semantics. A regression here is invisible until the rig
is dark or double-driven.

**TEST SPEC** — create `tests/io/sacn_output_wire.test.js`:
- Setup: `import dgram from 'node:dgram'` and monkeypatch `dgram.createSocket` to return
  a fake with `send(msg, …, cb)` capturing `Buffer.from(msg)` per call + invoking
  `cb(null)`, plus no-op `close/unref/setBroadcast`. Patch BEFORE importing
  `../../lib/sacn_output.js` (same-process import order is enough — the sacn lib calls
  `dgram.createSocket` at `Sender` construction). Restore in `after()`.
- Parse every captured buffer with the vendored package's own parser
  (`new (require('sacn/dist/packet').Packet)(buf)` or the package's public export) —
  assert via parsed fields, never hardcoded byte offsets.
- Cases (exact assertions):
  1. `createSacnOutput({universes:[1,2], destinations:['127.0.0.1','127.0.0.2'], priority:100, sourceName:'MarsinEngine'})`
     → `start()` → `sendFrame({1: u1buf, 2: u2buf})` → **exactly 4 datagrams** (2 universes
     × 2 destinations); parsed `universe` ∈ {1,2}, `priority === 100`,
     `sourceName === 'MarsinEngine'` on all 4.
  2. `sendFrame` BEFORE `start()` → **0 datagrams** (`:68`). `sendFrame` after `stop()`
     → 0 datagrams and no throw.
  3. `addUniverse(3)` twice → `sendFrame({3: buf})` emits **exactly
     destinations.length** datagrams for U3 (idempotency, `:41`).
  4. **Zero-channel wire truth:** frame A with `buf[9]=200`, then frame B with
     `buf[9]=0` → in frame B's parsed packet, channel 10 (1-indexed) **is 0 on the
     wire** (the sparse payload omits zeros at `:77`; the packet must still carry a
     full frame with that slot zeroed — this pins that a pixel turning OFF actually
     turns off downstream).
  5. 1-indexing: `buf[0]=42` lands on parsed channel 1, not 0.
  6. Sequence increments by 1 per packet per universe, wraps mod 256.
  7. `stop()` → every fake socket's `close()` called once; a second `stop()` doesn't throw.
  8. Value bytes: assert ONLY 0 and 255 inputs (0→0, 255→255) — the `_155` A5 rule —
     because intermediate values change when S-D1 (raw DMX) lands. Leave a comment
     pointing at R-D1 below for the full 0..255 table.
- Constraint: no real socket is ever created; assert `dgram.createSocket` was called
  with `'udp4'`.

### G-2 — `mapPixelsToSacn` outgoing packing: zero tests — **rank 2, size M**

**Surface:** `simulation/src/dmx/sacn_mapper.js:260-382` — the function `engine.js:942`
calls every frame for every model. Branches: master-dimmer force for par-family
(`:302-304`), numeric-`channels` polyfill ×3 (`:286-299`), LED-strand composite branch
(`:325-348`), RGB write + white synth `min(R,G,B)` vs explicit-W passthrough
(`:350-370`), amber/UV lanes, mono-W luma branch (`:377-380`), auto-universe creation
(`:271-276`), shared-address suppression (`pokeChannel`/`lostChannelsFor` — engine side
always uncontested since `window` is undefined ⇒ `lostIndex` null, worth pinning).
**Current coverage:** `simulation/tests/sacn_mapper.test.js` tests ONLY `demapSacnToPixels`
(inbound). `led_dmx_parity.test.js` tests `led_wire` projection math, not this packer.
**The gap:** the byte-generation function for every DMX fixture on the ship has no test
in either direction it is actually used by the ENGINE.

**TEST SPEC** — create `tests/io/sacn_mapper_pack.test.js` (engine-side home; it imports
`../../../simulation/src/dmx/sacn_mapper.js` exactly as `engine.js:61` does):
- Setup: real `UniverseRouter` (`simulation/src/dmx/universe_router.js`) with
  `addUniverse(1)`; entries are plain objects `{patch:{universe,addr,footprint},
  channels, fixtureType, type, r,g,b,w,a,u}`. Node has no `window` — assert that fact
  once (engine parity: suppression index is never consulted).
- Cases (exact bytes; note Uint8Array assignment truncates fractions):
  1. UkingPar-shape: `{fixtureType:'UkingPar', patch:{universe:1,addr:1,footprint:10},
     channels:{r:3,g:4,b:5,w:6,a:7,u:8}, r:1, g:0.5, b:0, w:0, a:0.2, u:0}` →
     `buf[0]===255` (master dimmer forced), `buf[2]===255`, `buf[3]===127`,
     `buf[4]===0`, `buf[5]===0` (white synth = min(255,127,0) = 0), `buf[6]===51`,
     `buf[7]===0`.
  2. White policy: same entry with `r:g:b = 0.8` and `w:0` → `buf[5]===204`
     (synth = min of the three written bytes); with `w:0.5` → `buf[5]===127`
     (explicit W passes through, no synth).
  3. Numeric-channels polyfill: `channels: 10` + `type:'par'` + `footprint:10` →
     resolves to `{r:3,g:4,b:5,w:6,a:7,u:8}` (same bytes as case 1);
     `channels: 6` + `footprint:6` → `{r:1..u:6}`; `channels: 3` → `{r:1,g:2,b:3}`
     and byte 4 untouched; `channels: 4` → `w:4` present.
  4. Mono fixture `{channels:{w:1}, w:0.5}` → `buf[addr-1]===127`; with `w` undefined
     and `r:1,g:1,b:1` → luma path `Math.round(0.299·255+0.587·255+0.114·255)=255`.
  5. Out-of-range clamp: `r: 1.5` → 255; `r: -0.2` → 0; `r: NaN` → 0 (the `|| 0`).
  6. Auto-universe: entry on universe 7 not pre-added → router gains U7 and bytes land
     (`:271-276`); entry with `patch` but router lacking `addUniverse` → skipped, no throw.
  7. Unpatched entry (`patch: undefined`) writes nothing anywhere.
  8. LED entry: one strand entry (shape per `led_wire.js` — copy the fixture from
     `led_dmx_parity.test.js`) → bytes equal `ledWireBytes(...)` output placed at
     r/g/b/w offsets, and `entry._ledWirePreview` set; RGB-only strand (no `w` in
     channels) → `bytes.r+bytes.w` composite per `:337-339`.
- Also `suppressNativeStrobes` (see G-11 — same file or its own).

### G-3 — per-model load + patch-table lint: only titanic is tested — **rank 4, size M**

**Surface:** `marsin_engine/models/*.js` (9 active models) through
`lib/model_loader.js`; the patch data drives universe assembly (`engine.js:1362-1393`)
and all of G-2's math.
**Current coverage:** `model_loader_word_aware.test.js` loads ONLY `titanic`;
`titanic_view_catalog.test.js` ditto; `view_catalog_parity.test.mjs` (tools) checks
catalog parity. Nothing loads `test_bench` — the model every smoke and HIL run uses —
or `studio*`, `summer_camp_*`, `led202`, `dev_test_bench`.
**The gap:** a bad edit to any non-titanic model (bit collision, patch off the end of a
universe, missing channels map) surfaces only at engine boot on the bench.

**TEST SPEC** — create `tests/mixer/all_models_load_lint.test.js`:
- Enumerate `models/*.js` excluding `*.effects.js`, `*.viewmasks.js`, `*.original`;
  derive model names. For each, `loadModel(name)` (same entry `engine.js` uses) inside
  `test(name, …)` — a throw is a test failure naming the model.
- Per loaded model, lint every `pixel.patch`: `Number.isInteger(universe) && universe
  >= 1 && universe <= 63999`; `addr >= 1 && addr <= 512`; where `patch.footprint`
  present, `addr + footprint - 1 <= 512` (LED strands that legitimately wrap universes
  per `computeLedProjection` are exempt — exempt exactly the entries
  `isLedEntry(entry)` matches, mirroring `led_dmx_parity`'s rule).
- Universe assembly parity: the set of patched universes equals what
  `engine.js:1367-1373` would collect (recompute the union in the test; this is the
  boot-time `universeIds`).
- Cross-fixture overlap map: build (universe, channel) → count of DISTINCT patch
  addrs writing it via the G-2 packer with all-channels-defined entries; overlaps are
  legal (operator order 2026-07-31) but must be REPORTED: snapshot the overlap count
  per model as an exact expected number in the test (derive on first run, then pin) so
  a NEW accidental overlap fails loudly with the pair named.
- Word-aware checks currently titanic-only (`reserveExplicitBits` collisions) run for
  every model that declares presets/groups.

### G-11 — `suppressNativeStrobes`: zero tests — size S

**Surface:** `sacn_mapper.js:37-61`, called at `engine.js:946` every frame.
**Gap:** the anti-beat-frequency safety (docs/28 §2.1) is unpinned; a table typo
(`EndyshowBar: [129,130]`) or a dedupe regression would strobe the rig.
**TEST SPEC** (fold into G-2's file): UkingPar entry at addr 1, prefill `frame[7]=200`
→ after call `frame[7]===0`; VintageLed rel 2; EndyshowBar rel 129+130 from addr 1 →
`frame[128]===0 && frame[129]===0`; ShehdsBar (empty list) leaves its bytes alone; two
entries sharing (universe,addr) → per-fixture write happens once (spy via a Proxy on the
frame or assert unchanged neighboring bytes); fixture whose `addr+relCh-1 >= 512` →
out-of-bounds write skipped, no throw (pin `:56`'s bound check); entry with patch but
unknown fixtureType → untouched.

### G-14 — folded into G-1 case 4 (zero-channel wire truth).

---

## 3. Catalog — API, state, config, mixer, VM, cross-process

### G-5 — REST malformed/hostile-input sweep — **rank 5, size M**

**Surface:** all ~90 routes in `lib/api_server.js`; `readBody` (`:4878-4901`, 1 MB cap
→ 413, bad JSON → 400); traversal guards (`path.basename` at `:5077`, `:5010`, `:5025`,
`:7201`, `:7707`, `:8769`, `:9038`; `VALID_PATTERN_DIR` at `:404`).
**Current coverage:** `ws_frame_crashproof.test.js` covers the WS side ONLY. HTTP-side
tests all send well-formed bodies; nothing exercises 413, top-level bad JSON per route,
or traversal names. The API is deliberately unauthenticated on the playa LAN (`_157`
D7) — hostile input is an expected operating condition.
**TEST SPEC** — create `tests/e2e/http_malformed_sweep.test.js` using
`createEngineHarness({scene:'test_bench', prefix:'httpsweep', extraArgs:['--dest','127.0.0.9']})`:
- Build a route list CONST in the test (curate ~20 mutating endpoints: `/pattern`,
  `/save-pattern`, `/mixer/channels`, `/mixer/view`, `/deck/channel`, `/deck/playlist`,
  `/playlists`, `/settings`, `/timeline/plans`, `/global-effect-macros/blackout`,
  `/param-center`, `/osc/config`, `/scene`, `/mixer/master/fade`, …).
- Per route: (a) body `"{not json"` → status 400 and JSON `{error:'Invalid JSON'}`;
  (b) body `"[]"`/`"42"` (valid JSON, wrong shape) → any 4xx, NEVER 5xx, NEVER a
  connection drop; (c) after each, `GET /status` → 200 with
  `service === 'marsin-engine'` (process alive — the real assertion).
- One 413 case: 1 MB + 1 byte of `"a"` to `/timeline/plans` → 413
  `Request body too large`.
- Traversal set: `POST /pattern {pattern:'../models/titanic'}` → basename strips to
  `titanic` → 404/400, and assert the response error string does NOT contain a path
  outside `patterns/`; `GET /pattern-code?name=../../secret.yaml` → 404 with body
  exactly `Not Found` (never file contents — assert body lacks `sacn:`);
  `GET /pattern-dirs/..%2F..` → 400 `Invalid pattern directory`.
- Unknown route `GET /definitely-not-a-route` → 404.
- Subdir-slug pin (see N-5): `POST /pattern {pattern:'test/breathing'}` currently
  resolves via `basename` to `breathing` → expect 404 (`patterns/breathing.js` absent).
  Pin it WITH a comment naming N-5 — if the fix wave changes routing, this test is the
  tripwire that the semantic changed deliberately.

### G-6 — corrupt state YAML: behavior unpinned — **rank 6, size S**

**Surface:** `lib/state_manager.js:109-117` — `load()` catches ANY error (unreadable,
corrupt YAML) → `console.warn` → **silently returns defaultState**. Affects
`mixer_state.yaml`, `deck_state.yaml`, `globals_state.yaml`, `settings_state.yaml`,
`global_effect_slots.yaml` (`:368-375` same pattern).
**Current coverage:** none for the corrupt case in any state test
(`state_atomicity`/`strict_save` cover WRITE failure; `settings_state` covers a
malformed VALUE inside valid YAML; `playlist_malformed_loud` shows what LOUD looks like
— for playlists only).
**The gap + P0 tension:** codex says fail loudly; deck-restore safety deliberately
degrades-but-reports via `/status.deckRestoreDegraded` (`api_server.js:4967`). Corrupt
state has NO equivalent flag — the operator cannot see that the mixer came up on
defaults because the YAML was garbage.
**TEST SPEC** — create `tests/state/state_corrupt_load.test.js` (unit, direct
`StateManager` against a temp dir):
1. Write `"{{{ not yaml"` to `mixer_state.yaml` → `loadMixerState()` returns the
   documented default `{master:1.0, channels:[], patternControls:{}, mixGroups:[]}`
   and a `console.warn` was emitted containing the filename (capture via patched
   `console.warn`).
2. Same for `deck_state.yaml` → `{channel:null}`; `globals_state.yaml` → defaults;
   truncated-mid-document YAML (write a valid file, chop at byte 20) for one of them.
3. Empty file → default (the `|| defaultState` at `:113`), NO warn.
4. A test named `NEEDS-RULING: corrupt state is a silent limp — no /status flag`
   that pins today's behavior and carries the ruling question in its comment: should
   `load()` failures surface a `/status.stateRestoreDegraded` array like
   `deckRestoreDegraded`? (File the follow-up on the Notion board when this lands.)

### G-8 — config.yaml validation matrix — **rank 7, size M**

**Surface:** `engine.js:125-218` (`loadConfig` + `parseArgs`) and every `config.<x>`
consumer. Guarded today: `controllers`/`alsoFlat`/`protocol` only.
**Current coverage:** `output_config_guard.test.js` (9 cases); `engine_cli_flags`
covers only audio flags. Nothing covers: missing `server.port` (the loud refusal at
`:214-217`), `MARSIN_CONFIG_FILE` relative/missing (throws, `:128-133`), corrupt YAML
in an override file, wrong-typed values, falsy conflations (`:164-165` — `_157` D12's
engine rows), unknown-key silence.
**TEST SPEC** — create `tests/state/config_boot_matrix.test.js`, spawning
`node engine.js --pattern 13_sparkle --model test_bench --dry-run` per case with
`MARSIN_CONFIG_FILE` pointing at a per-case temp YAML (absolute path;
`--dry-run` never opens sACN; still pass `--dest 127.0.0.9` defensively; give NO
`--port` except where the case needs boot to proceed):
1. Config without `server.port`, no `--port` → exit 1, stderr contains `No API port`
   and `Refusing to guess`.
2. `MARSIN_CONFIG_FILE=relative/path.yaml` → throw naming `must be an absolute path`.
3. `MARSIN_CONFIG_FILE=/nonexistent.yaml` → throw naming `does not exist`.
4. Override file with corrupt YAML → process exits nonzero (the `yaml.load` throw is
   NOT caught on the override path — pin that it stays loud).
5. `engine.fps: "abc"` + `--port <n>` → boots (dry-run OK) — **pin the silent 40
   default with a comment naming N-3**; same for `sacn.priority: 0` → currently
   coerced to 100 (`:165`, D12) — pin with a `blocked-on S-D12` note that the
   expected value flips to a loud refusal or an honored 0 when the falsy-default
   cleanup lands.
6. Guard keys inside the override file (not just injected objects): a real YAML file
   carrying `controllers: []` → exit nonzero, stderr names the key (today's guard
   test builds trees in-memory; this pins the file→boot path end-to-end).
7. **Dead-key documentation case** (see N-2): assert the repo `config.yaml` parses and
   list its top-level keys; the test's comment carries the dead-key inventory so the
   next person touching config sees it. (Refusing unknown keys is a RULING, not a
   test's call.)

### G-4 — engine↔bridge in-process contract rig — **rank 3, size L**

**Surface:** the wire between `marsin_engine/lib/sacn_output.js` and
`simulation/server/sacn_bridge.js` (Receiver, routing, relay, monitor counters) +
`simulation/server/bridge_routing.cjs` (`engineOwnedPairs` from
`/status.outputRouting`). `_157` probed the LIBRARY layer; `_158` proved both real
bridges run in-process with fake sockets. Neither left a permanent suite; nothing runs
the ENGINE's real sender objects against the BRIDGE's real receiver path in CI.
**Current coverage:** each side pins its own half (`status_output_routing.test.js`
engine-side; `bridge_routing.test.js` + `bench_mirror*` sim-side). The CONTRACT — what
the bridge derives from actual engine datagrams — is only ever proven live.
**TEST SPEC** — create `simulation/tests/engine_bridge_contract.test.js` (it lives
sim-side because the bridge module loads there; coordinate the FILE with `_161` to
avoid a duplicate — the SPEC is engine-scope, the home is sim):
- Setup: patch `dgram.createSocket` to a loopback fabric: sender-fakes' `send(msg)`
  synchronously invokes the receiver-fake's `'message'` handler with
  `(Buffer.from(msg), {address:'127.0.0.1', port:5568})`. Instantiate the REAL bridge
  receiver path (follow `bm158_gate_window.mjs`'s construction — `_158` scratch,
  reproduce from `sacn_bridge.js`'s exported/require-able pieces) with a synthetic
  scene of 2 relay routes; instantiate the REAL `createSacnOutput({universes:[1,2],
  destinations:['127.0.0.1'], priority:100, sourceName:'MarsinEngine'})`.
- Assertions:
  1. One `sendFrame` → bridge's per-universe monitor state shows source
     `MarsinEngine`, priority 100, and exactly 2 inbound frames counted.
  2. Relay fidelity: bytes relayed to a route equal the engine's wire bytes for all
     values in {0, 255} (extend to 0..255 exact when S-D1 lands — R-D1).
  3. `engineOwnedPairs` exclusion: a (universe → dest) pair declared engine-owned is
     NOT re-sent by the relay (zero datagrams from the bridge's senders for it).
  4. Pacing contract: N engine frames → relay emits N frames per fed route (no
     dropped, no doubled — the bridge relays per admitted inbound frame).
  5. Sequence: 300 frames → bridge accepts all 300 (no `PacketOutOfOrder` growth once
     R-D5's counters exist; until then assert the routed count).
- Size L because the bridge bring-up scaffold is the work; steal it from `_158`'s
  scratch pattern rather than reinventing.

### G-9 — WS connect-replay contract (CaptainPad's boot handshake) — size S

**Surface:** the four WS topics (`api_server.js:10002+`, `ws_topic_routing.js`) replay
cached payloads on connect; CaptainPad's `hooks/useEngineState.ts:472-580` switches on
exactly `sharedParams | paramSchema | liveParams | mixer | deck | oscStats |
audioStatus`.
**Current coverage:** `ws_topic_routing.test.js` pins type→topic mapping (unit);
`ws_frame_crashproof` proves replay EXISTS after abuse; nobody pins the replay SET.
**TEST SPEC** — create `tests/e2e/ws_connect_replay.test.js` (spawned harness):
connect a fresh client to each topic path; collect messages for 2 s; assert
`/ws/control` replays at minimum types `{mixer, deck}` and `/ws/params` replays
`{sharedParams, paramSchema}` (derive the full expected-per-topic sets from
`TOPICS`/`topicForType` in `lib/ws_topic_routing.js` — the test imports it, so the
expectation can't drift from the router); assert every replayed `type` on
`/ws/control`+`/ws/params` is ∈ CaptainPad's consumed set above OR in an explicit
`ENGINE_ONLY_TYPES` allowlist in the test (new types force a conscious decision);
assert JSON-parseable, `type` string-typed on every frame.

### G-10 — picker-catalog contract (CaptainPad HTTP) — size S

**Surface:** `GET /patterns`, `/pattern-dirs`, `/playlists`,
`/model/view-selection-options` — the catalogs CaptainPad's pickers render;
`components/view_selection_picker_logic.ts` (`ViewPickerModel`/`ViewPickerSection`/
`NamedView` interfaces) is the strictest consumer.
**Current coverage:** playlist_api pins `/playlists` partially; nothing pins
`/model/view-selection-options`'s shape, and CaptainPad's own vitest suite tests its
logic against FIXTURES, not against the engine.
**TEST SPEC** — create `tests/e2e/picker_catalog_contract.test.js` (spawned harness,
scene `test_bench`; second spawn with `titanic` guarded by a generous timeout):
- `/patterns` → array of strings, non-empty, every element matches
  `/^[A-Za-z0-9_/-]+$/`, includes `13_sparkle`.
- `/pattern-dirs` → array starting `'default'`.
- `/model/view-selection-options` → transcribe the field requirements from
  `CaptainPad/components/view_selection_picker_logic.ts` interfaces (implementer:
  read `NamedView`, `ViewSelectionValue`, `ViewPickerSection`, `ViewPickerModel` at
  `:25`, `:34`, `:161`, `:167` and assert presence + JS type of every field the
  parser dereferences, for every section/view in the response). For `titanic` assert
  at least one word-1 view is present and carries whatever word/bit discriminator the
  interface reads (this is the two-word system's public contract).
- Comment block naming the consumer file so the next CaptainPad change knows where
  the other half of the contract lives.

### G-7 — shutdown/boot ordering + blackout count — size S

**Surface:** `engine.js:2487` (inputs stopped FIRST), `:2530-2549` (final blackout,
sent 1×), sACN `stop()` after; boot side: universe forcing for effect-only universes
(`:1365`), stale-universe 3× blackout on hot-reload (`:1747-1761`).
**Current coverage:** `engine_port_kill_scope` (port hygiene only);
`scene_reload_api.test.js` (reload API, but not the stale-universe blackout bytes).
**TEST SPEC** — create `tests/e2e/shutdown_ordering.test.js` (spawned harness,
black-holed): wait ready → SIGINT (Windows note: use `proc.kill('SIGINT')`; if the
runner can't deliver it use the engine's HTTP shutdown if present, else SIGTERM and
assert the same log set) → collect full stdout; assert (a) the input-source stop lines
precede the `[sACN Out] Sender stopped` line, (b) exactly ONE shutdown-blackout marker
today — write the assertion as `assert.equal(blackoutSends, 1)` with a
`blocked-on S-D10: flips to 3` comment, (c) exit code 0, (d) port freed (connect
refused afterward). Stale-universe path: extend `scene_reload_api.test.js` — reload to
a model missing a previously-patched universe → engine log names the universe and the
3× blackout (`:1753` comment names the convention; assert its log line count).

### G-12 — meta-ABI stride gate — size S

**Surface:** `lib/meta_abi.js` (`META_LANES`, `VIEW_MASK_HI_ENABLED`) ↔
`wasm_host.js:283-306` (`setPixelMeta` stride) ↔ `engine.js:82-107`
(`buildMetaArray`/`repackMetaIfDirty` — "a drift here would" break view targeting).
**Current coverage:** no direct test of `meta_abi` (grep: zero references from
tests); the stride is exercised implicitly by every VM test.
**TEST SPEC** — create `tests/mixer/meta_abi_stride.test.js`: assert
`META_LANES === (VIEW_MASK_HI_ENABLED ? 7 : 6)` (transcribe the actual relation from
`meta_abi.js` — if it's a constant table, pin the pair); with a 3-pixel WasmHost
(real init), `setPixelMeta([{viewMask:5, viewMaskHi:9, …}])` → read back
`metaView` at stride offsets and assert lanes [ctrl,sec,fix,view,fixtureTypeId,
localIndex(,viewMaskHi)] land at indices 0-6 in order; when `VIEW_MASK_HI_ENABLED`
is false assert `viewMaskHi` is NOT written (no 7th-lane overrun).

### G-13 — `applyDmx` effect-universe truth — size S

**Surface:** `global_effects_controller.js:369+` (fogger/horn/fire DMX writes),
`engine.js:959` (blackout pass-through), `:1365` (effect universes forced into
`universeIds` even with zero pixels).
**Current coverage:** `global_effect_blackout.test.js` (blackout forces OFF) only.
**TEST SPEC** — extend `tests/effects/global_effect_blackout.test.js` or new
`applydmx_channels.test.js`: fogger active + frame present → the configured
(universe, channel, value) triple is written; universe frame absent → skipped, no
throw; horn + fire same; after `blackout:true` all three forced 0 in the same call
(exists — keep); boot-side: assert via `engine.js`'s collected `universeIds` (spawned
`--dry-run` boot log line `universe(s) [..]`) that a model-with-fogger-but-no-pixels
scene still lists the fogger universe (only if such a scene exists in-tree — else
mark the case model-gated and skip).

### G-15 — `/save-pattern` + `/pattern` compile-failure honesty — size S

**Surface:** `api_server.js:5019-5069` (validation compile, hot-swap of live
channels, `tryLoad` shield), `:5070-5095` (compile-first, deck never torn down).
**Current coverage:** none at the HTTP layer (deck_restore_safety covers BOOT-time
compile failure; performance_mode uses /set-pattern happy-path).
**TEST SPEC** — extend G-5's spawned suite: `POST /save-pattern
{name:'zz_gap162_tmp', code:'this is not a pattern ('}` → 400, body carries the VM's
compile error text, and `patterns/zz_gap162_tmp.js` was NOT created (compile gate
precedes write, `:5030-5036`); valid save → 200 + file exists → delete the temp file
in teardown (write inside the repo patterns dir is unavoidable here — use the
`zz_gap162_` prefix and remove in `after()`; note the residue rule in a comment);
`POST /pattern {pattern:'nonexistent_xyz'}` → 404, then `GET /status` shows
`activePattern` unchanged (deck survived).

### G-16 — `ffmpeg_resolver` fail-loud — size S

**Surface:** `lib/ffmpeg_resolver.js` (audio capture dependency resolution).
**Current coverage:** zero references from any test.
**TEST SPEC** — `tests/audio/ffmpeg_resolver.test.js`: read the module's exported
function(s); assert (a) explicit configured path that doesn't exist → throws naming
the path (no silent fallback to PATH probing — verify against the module's actual
contract and pin whichever loud behavior it implements), (b) `ffmpeg-static` package
path resolution returns an absolute existing file on this platform, (c) a
non-string/empty config value → loud TypeError. If the module turns out to have a
silent fallback chain, pin it and add a NEEDS-RULING comment (P0 pattern).

---

## 4. Regression specs for the `_157` fix wave — write WITH the slice, not before

Each entry pins the FIX; landing it against today's code would assert broken behavior
as correct. Mark each test file with the slice ID.

### R-D1 (blocked on S-D1, raw DMX end-to-end) — size M
`tests/io/sacn_output_wire.test.js` (extends G-1): full byte table — for every value
0..255 sent through `sendFrame`, the parsed packet's raw DMX slot equals the input
exactly (via `payloadAsBuffer` or parsed-packet raw slice). Cross-lane half lives in
G-4's rig: engine byte → bridge relay byte identical, 0..255. Kill the G-1 case-8
restriction comment when this lands.

### R-D3 (blocked on S-D3, per-role CIDs) — size S
In G-1's file: parsed CID is exactly 16 bytes, equals the engine role's documented
derivation (fixed namespace hash — copy the constant from the slice), differs from the
bridge-relay/mirror/output-bridge role CIDs (import each constant), and is byte-stable
across two `createSacnOutput` instances (E1.31 CID lifetime). Add the D3 receiver-side
proof to G-4's rig: two senders with DISTINCT CIDs interleaved on one universe → the
real Receiver accepts ~all packets (vs `_157` P4's 2-of-100 under a shared CID).

### R-D4 (blocked on S-D4, per-universe arbitration — bridge-side file, flag to `_161`) — size M
In G-4's rig: engine (prio 100) on U1+U2; inject a prio-150 source on U1 only →
U1 routes the 150 source, **U2 keeps routing the engine** (per-universe state);
after the 150 source stops + lockout elapses, U1 returns to the engine; threshold
boundary case at the slice's chosen value (recommended 120: 100 passes as ordinary).

### R-D5 (blocked on S-D5, receiver drop listeners) — size S
Bridge-side: emit `PacketOutOfOrder` and `PacketCorruption` on the real Receiver (or
feed an actual out-of-order sequence through G-4's fabric) → throttled warn emitted
once per window, running counters visible in the routes/monitor snapshot increment
exactly, and a listener EXISTS for both events (`listenerCount >= 1` — the test that
would have caught the bench night).

### R-D8 (blocked on S-D8, sender socket error listeners) — size S
In G-1's file: after the slice, every created Sender's fake socket has ≥1 `'error'`
listener; `fakeSocket.emit('error', Object.assign(new Error('ECONNRESET'),
{code:'ECONNRESET'}))` → process does NOT crash (test still running), one throttled
log line naming universe+destination; repeat-emit ×100 → log lines ≤ throttle budget.

### R-D10 (blocked on the 3× shutdown blackout fix) — size S
Flip G-7's `blackoutSends` assertion from 1 to 3; assert the three sends target every
live universe and PRECEDE `Sender stopped`.

### R-D11 (blocked on universe range validation) — size S
In G-1's file: `createSacnOutput({universes:[0]})` and `[64000]` → loud refusal naming
the universe and the legal range 1-63999; 65537 does NOT alias to 1.

### R-D12-engine (blocked on falsy-default cleanup) — size S
Config matrix additions (G-8 case 5 flips): `sacn.priority: 0` and `engine.fps: 0` →
whichever explicit behavior the slice chooses (refusal or honored value), never a
silent 100/40.

---

## 5. Explicit non-gaps — surveyed and adequately covered (do not re-spec)

- **OSC `:10000` hostile input** — `osc_listener.test.js`: malformed packet →
  `invalid` counter (`:470`), allowlist incl. v6-mapped forms, binding-schema
  refusals, out-of-range port, raw/post gain pairs. The remaining OSC risk is D7
  (policy), not a missing test.
- **fire_sync `:7703`** — `fire_sync_listener.test.js`: malformed/duplicate datagrams
  counted-not-acted, seq reboot survival, whistle-bit exclusion, min-ON hold, ack per
  understood frame, constructor config refusals, failing transport counted-once.
- **WS crash-proofing** — `ws_frame_crashproof.test.js` (malformed frames on all 4
  topics + `/` alias; replay survives). G-9 adds the replay-SET contract only.
- **Playlist machinery** — `playlist_malformed_loud` (corrupt YAML throws
  `PlaylistLoadError`; `tryLoad` degrade documented), `playlist_manager`,
  `playlist_api`, autopilot profiles, dance maker. Name/pattern slug validation solid
  (`VALID_NAME`/`VALID_PATTERN`).
- **State WRITE path** — atomicity, no-tmp-residue, failed-write keeps previous file,
  strict-vs-best-effort save, serializeChannel round-trips incl. clamps. (READ-side
  corruption is G-6.)
- **Mixer core** — ~40 files: blend-mode name gate, blend precompile + fallback
  presence (`renderHealth`), fader/hue/followScale/autoCycle validators, deck restore
  safety (boot compile failure → default pattern + `/status.deckRestoreDegraded`),
  stale-view sanitize (word-aware), undo, snapshots, groups/solo, session params,
  metering, never-black enforcer (incl. VM e2e).
- **Views two-word system** — allocator collisions per word, hi-host, inView
  intrinsic + both harness injection parities, titanic catalog + tools parity.
- **Output-config guard** — the 9 `_156` cases + mechanism-gone grep + `/status`
  shape (unit + spawned). G-8 case 6 adds only the real-file boot path.
- **VM host compile error path** — `{ok:false,error}` shape exercised via injection
  tests and `never_black_vm_e2e`; bad-pattern-over-HTTP is G-15's thin addition.
- **Send-error throttle** — unit-covered; G-1 integrates it implicitly.
- **Audio/companion/timeline** — broadest domains in the suite (structure detector,
  BPM octave/arbitration, companion OSC accounting, timeline arbiter/validation/
  dryrun/zoom e2e). Nothing engine-critical uncovered found.
- **Engine `/status.outputRouting` ↔ bridge `engineOwnedPairs`** — both halves pinned;
  shape is a hardcoded empty literal (`api_server.js:4995`); G-4 exercises the live
  join.

## 6. Survey defect notes (found while mapping — route to the fix wave, NOT test-fix-as-spec)

- **N-1** `state_manager.load()` (`lib/state_manager.js:109-117`) silently limps to
  defaults on corrupt state with no `/status` visibility — P0 tension; ruling needed
  (G-6 pins today's behavior either way).
- **N-2 dead config keys, live in the repo `config.yaml` today:** `sacn.multicast`
  (zero consumers in `engine.js`/`lib/`), the top-level `playlist:` block
  (`active/delay_s/shuffle` — zero consumers; runtime playlists come from state
  files), and `web_client.enabled` (only comments reference the block engine-side;
  possible external consumers — verify before ruling). A silently-ignored key is
  exactly the class `output_config_guard.js` exists to kill.
- **N-3** repo `config.yaml` carries `playlist.delay_s: '90'` — a STRING in a numeric
  field, harmless only because the key is dead (N-2). Cleanup candidate.
- **N-4** `loadConfig()` default path (`engine.js:136-143`) catch-warns-and-continues
  on an unreadable `config.yaml`; boot then dies on the port check UNLESS `--port` is
  passed, in which case the engine runs with the ENTIRE config silently ignored
  (default destinations, no OSC allowlist…). The override path throws; the default
  path should too.
- **N-5** direct pattern-set routes apply `path.basename` (`api_server.js:5077` et
  al.), which MANGLES legal subdir slugs (`test/breathing` → `breathing`): 404 if no
  root file shares the name, the WRONG pattern silently if one does. Playlist-driven
  loads accept `dir/name` correctly — the two paths disagree.
- **N-6** `sendFrame` silently skips buffer keys with no sender (`sacn_output.js:73`)
  — benign today (buffers are built from `universeIds`), but a drift between
  `universeIds` and the senders map would drop universes with zero log lines. G-1
  case 3 half-pins it; a one-line loud counter would close it properly.

## 7. Hygiene

Zero writes outside this report and the tracker `_162` block. No suites run, no
processes started, no ports bound, no packets sent, no scratch files needed. Read-only
survey of `marsin_engine/**`, the two shared `simulation/src/dmx/` modules, bridge/
bench-mirror test surfaces (for overlap avoidance with `_161`), and CaptainPad's
engine-facing parsers. IPs redacted throughout; the config file carrying real values
was read, not edited, and no address appears above. File-count claims are from
enumeration at survey time; line numbers cite the working tree (which `_156`'s
amendment is still resident in — expect drift after the next wave lands).
