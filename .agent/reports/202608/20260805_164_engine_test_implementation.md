# 20260805_164 — Engine-side test-gap implementation: 11 of 16 gaps + a critical crash pin

**Agent:** test implementer `_164` (Sonnet 5, operator-assigned) · **Branch:**
`feat/bm_readiness`. Implements report `_162`'s catalog
(`.agent/reports/202608/20260805_162_engine_test_gap_catalog.md`). **TEST CODE
ONLY** — zero production edits, zero git ops, no operator port bound, no real
controller IP literal in any new test, no packets to hardware.

Sibling `_163` implemented the SIM-side catalog (`_161`) concurrently on the same
branch. Coordination point (G-4): `simulation/tests/helpers/bridge_harness.mjs`
already existed when this session reached it — reused as-is, not modified, not
reinvented. No `_163`-owned file was touched.

---

## 1. Baseline

`cd marsin_engine && npm test` before any change: **2631 tests / 2624 pass / 7
fail** — inside the catalog's documented 2631–2634 nondeterministic range. The 7
failures (unchanged throughout this session, verified again at the end):
5x `tests/audio/audio_capture.test.js` (Windows: no pinned mic device on this
box), 1x `tests/effects/effects_v2_mode_page_layout.test.js` (file-level IPC
deserialize crash, documented pre-existing), 1x `tests/io/osc_listener.test.js`
"EADDRINUSE" case (gets `EACCES` instead, sandbox/OS permission artifact of this
box, not this branch).

## 2. Per-entry disposition

| Catalog # | Disposition | File | Tests |
|---|---|---|---|
| G-1 sacn_output.js wire truth | **Implemented** | `tests/io/sacn_output_wire.test.js` | 9 |
| G-2 mapPixelsToSacn packing | **Implemented** | `tests/io/sacn_mapper_pack.test.js` | 22 (incl. G-11) |
| G-11 suppressNativeStrobes | **Implemented** (folded into G-2 file) | same | — |
| G-3 all-models load + lint | **Implemented**, 1 real defect pinned | `tests/mixer/all_models_load_lint.test.js` | 34 |
| G-4 engine↔bridge contract rig | **Implemented**, reused `_163`'s harness | `simulation/tests/engine_bridge_contract.test.js` | 5 |
| G-5 HTTP malformed sweep | **Implemented**, 1 CRITICAL bug found+isolated | `tests/e2e/http_malformed_sweep.test.js` | 36 |
| — pattern-dirs crash (found during G-5) | **Pinned in its own file** | `tests/e2e/pattern_dirs_crash_pin.test.js` | 1 |
| G-15 save-pattern/pattern compile honesty | **Implemented** (folded into G-5 file) | same | — |
| G-6 corrupt state YAML | **Implemented** | `tests/state/state_corrupt_load.test.js` | 6 |
| G-7 shutdown ordering + blackout | **Implemented, scope cut disclosed** | `tests/e2e/shutdown_ordering.test.js` | 3 |
| G-8 config boot matrix | **Implemented, N-2 correction found** | `tests/state/config_boot_matrix.test.js` | 8 |
| G-9 WS connect-replay | **Implemented, spec correction found** | `tests/e2e/ws_connect_replay.test.js` | 5 |
| G-10 picker catalog contract | **Implemented, spec correction found** | `tests/e2e/picker_catalog_contract.test.js` | 4 |
| G-12 meta-ABI stride | **Implemented**, dead-code finding | `tests/mixer/meta_abi_stride.test.js` | 6 |
| G-13 applyDmx channels | **Skipped — time budget**, not blocked | — | 0 |
| G-14 | folded into G-1 (per catalog) | — | — |
| G-16 ffmpeg_resolver | **Implemented**, P0 fallback-chain finding | `tests/audio/ffmpeg_resolver.test.js` | 4 |
| R-D1/D3/D4/D5/D8/D10/D11/D12 | **Blocked on `_157` fix slices — not mine** | — | 0 |

**Totals: 12 catalog entries implemented (11 gaps + G-11/G-15 folds), 1 entry
skipped for time (G-13), 8 regression specs correctly left untouched (blocked),
1 extra file for a critical bug found mid-implementation. 138 new engine-side
tests + 5 new sim-side tests (G-4) = 143 new tests, all green.**

---

## 3. CRITICAL production bug found and pinned: one GET request kills the whole engine

**`GET /pattern-dirs/<invalid-slug>` crashes the entire engine process.**
Reproduced deterministically (7/7 isolated runs). Root cause,
`marsin_engine/lib/api_server.js:4911-4920`:

```js
} else if (req.method === 'GET' && req.url.match(/^\/pattern-dirs\/[^\/]+$/)) {
  try {
    const dir = decodeURIComponent(req.url.split('/')[2]);
    res.writeHead(200, { 'Content-Type': 'application/json' });          // (A)
    res.end(JSON.stringify(listPatternsInDir(patternsDir, dir)));        // (B)
  } catch (e) {
    res.writeHead(400); res.end(JSON.stringify({ error: e.message }));   // (C)
  }
}
```

Line (A) sends response headers UNCONDITIONALLY before line (B)'s
`listPatternsInDir` call — which throws `Invalid pattern directory: "<dir>"`
whenever `dir` fails `VALID_PATTERN_DIR` (`api_server.js:404`,
`/^[a-z0-9][a-z0-9_-]{0,63}$/`) — has run. When it throws, the catch block (C)
calls `res.writeHead(400)` a SECOND time on an already-headers-sent response,
which throws `ERR_HTTP_HEADERS_SENT` with nothing left to catch it. That reaches
`engine.js`'s `process.on('uncaughtException', ...)` (engine.js:1090-1096),
which — correctly, per its own design — logs "ENGINE FATAL" and calls
`process.exit(1)`.

This is a **one-request, no-state-required, unauthenticated remote crash**: any
device on the playa LAN (report `_157` D7), or a stray curl, or a buggy
CaptainPad build, hitting e.g. `GET /pattern-dirs/Default` (capital D) goes dark.
Not fixed here (test code only) — pinned as a named characterization in
`tests/e2e/pattern_dirs_crash_pin.test.js`, isolated in its OWN spawn/teardown so
it cannot cascade into other tests. The main sweep (`http_malformed_sweep.test.js`)
deliberately does NOT exercise this exact input (see that file's header) —
doing so would kill the shared engine harness and cascade false failures across
every test after it in the file.

**Recommend this as the single highest-priority item for the next fix wave** —
higher than any of the already-tracked D-series items, since it is trivially
reachable and total.

## 4. Other production-bug / defect findings (pinned, not fixed)

Folding in `_162`'s N-1..N-6 survey notes with this session's test evidence,
plus new findings from this implementation pass:

- **N-1** (`_162`) `state_manager.js:109-117` silently limps to defaults on
  corrupt state, no `/status` visibility. **Confirmed and pinned**
  (`tests/state/state_corrupt_load.test.js`, the `NEEDS-RULING` test). Ruling
  question carried in the test comment for the Notion follow-up.
- **N-2 CORRECTION** (`_162` was partly wrong): the catalog's survey claimed
  the top-level `playlist:` config block is dead (zero consumers). **It is
  NOT** — `lib/autopilot.js:11,69,83,97-104` reads/writes it directly via its
  OWN independent config load/save cycle (same file, via `MARSIN_CONFIG_FILE`,
  bypassing `engine.js`'s `parseArgs`/`loadConfig` entirely). `sacn.multicast`
  and `web_client.enabled` ARE confirmed dead (zero references anywhere in the
  repo, grep-verified). Pinned in `tests/state/config_boot_matrix.test.js`'s
  dead-key-inventory test.
- **N-3 CORRECTION**: `playlist.delay_s: '90'` (a string) is harmless not
  because the key is dead (it isn't — see N-2), but because its one consumer
  already defensively parses it: `parseInt(this.state.delay_s, 10) || 30`
  (`lib/autopilot.js:155`).
- **N-4** (`_162`) `loadConfig()`'s default path catch-warns-continues on an
  unreadable `config.yaml`; with `--port` supplied the engine boots with the
  ENTIRE config silently ignored. **Not independently re-tested this pass**
  (G-8 covers the override path's throw, which stays loud; the default-path
  silent-continue is `engine.js:136-143`, unchanged, still a real gap) —
  flagged for a future slice.
- **N-5** (`_162`) `path.basename` on direct pattern-set routes mangles legal
  `dir/name` slugs. **Confirmed and pinned**
  (`tests/e2e/http_malformed_sweep.test.js`, the N-5 test: `test/breathing`
  resolves to nonexistent root `breathing.js`, 404s).
- **N-6** (`_162`) `sendFrame` silently skips universes with no sender
  (`sacn_output.js:73`). Not independently re-tested this pass (G-1's case 3
  half-pins the related idempotency behavior; the drift-detection half is
  still open).
- **NEW — `dev_test_bench` model cannot boot.** `models/dev_test_bench.viewmasks.js`
  declares group names (`ParLights`, `VintageLights`, `BarLights`, `LED_0`)
  absent from the (0-pixel) `dev_test_bench.js` model. Verified against the
  REAL engine: `node engine.js --pattern 13_sparkle --model dev_test_bench
  --dry-run` prints `❌ groupBits in dev_test_bench.viewmasks.js is out of sync
  with model 'dev_test_bench'` and exits. Pinned as a named characterization in
  `tests/mixer/all_models_load_lint.test.js`.
- **NEW — G-16 `resolveFfmpegPath` violates the "no fallback behaviors" P0
  rule.** An explicit `configuredPath` that does not exist on disk is
  SILENTLY discarded (not refused) — the function cascades through local
  `bin/` probing then `ffmpeg-static` and returns that binary with no warning
  the operator's configured path was ignored. Verified empirically:
  `resolveFfmpegPath('/does/not/exist/ffmpeg')` returns the vendored
  `ffmpeg-static` binary path. NEEDS-RULING pinned in
  `tests/audio/ffmpeg_resolver.test.js` — should a bad explicit path throw, or
  is silent substitution the intended UX? A non-string config value DOES throw
  loudly (a raw Node `TypeError`, not a custom actionable message).
- **NEW — G-12 dead constants / drift risk.** `lib/meta_abi.js`'s
  `LANE_CONTROLLER_ID`..`LANE_VIEW_MASK_HI` named constants are imported
  NOWHERE (grep-verified: only `META_LANES`/`VIEW_MASK_HI_ENABLED` are ever
  imported). Both `lib/wasm_host.js` and `lib/marsin_wasm_runtime.js`
  hardcode their own `base+0`..`base+6` pack offsets independently. A future
  edit to the documented lane order in `meta_abi.js` would silently drift
  from the two real pack loops with nothing failing inside them. Pinned in
  `tests/mixer/meta_abi_stride.test.js` (a dedicated dead-code-pin test plus
  real-runtime-offset tests that DO fail if the relationship ever breaks).
- **NEW — G-9 spec correction.** `/ws/params` replays ONLY `sharedParams` on
  connect (`api_server.js:10596-10607`) — `paramSchema` is broadcast on
  registry CHANGE, never replayed at connect. The catalog's draft spec
  ("`/ws/params` replays `{sharedParams, paramSchema}`") does not match the
  real code; pinned to the real behavior instead.
- **NEW — G-10 spec correction.** There is no "word/bit discriminator" on
  `namedViews` entries anywhere in the wire contract — `lib/mask_registry.js`'s
  `MaskEntry` and the API response (`api_server.js:6514-6523`) both carry only
  `{name, kind, bit, memberCount}`, no word field. This is BY DESIGN: Tier-A
  named-view selection resolves entirely by NAME on the engine side, so the
  client never needs to know which internal word backs it. Confirmed the
  spirit of the requirement instead: a known word-1 titanic preset ("Hull
  Canvas") surfaces under `namedViews` by name.
- **Minor consistency defect (G-5 sweep, not a security hole):** `POST
  /mixer/view`, `PATCH /mixer`, `PATCH /deck/channel`, `POST /param-center`,
  and `PATCH /osc/config` (only for a non-object array; a number IS rejected)
  all accept a non-object body (`[]`/`42`) as a silent 200 no-op rather than
  a 4xx, because every field read is gated by `data.<field> !== undefined`
  which is simply false for a non-matching shape. Not dangerous, but
  inconsistent with every other route in the sweep. Listed in
  `tests/e2e/http_malformed_sweep.test.js`'s `ACCEPTS_NONOBJECT_AS_NOOP` set
  with a comment; not asserted as a bug to fix.

## 5. Scope cuts, disclosed

- **G-7**: the stale-universe hot-reload blackout (`engine.js:1747-1763`)
  fires from a REAL model-file watcher on the SHARED, TRACKED
  `marsin_engine/models/` directory — every concurrently-running agent's
  spawned engine also watches it. Proving it live would require writing a
  throwaway model file into that shared directory, a cross-agent side effect
  this session must not risk. Pinned STRUCTURALLY instead (source-order + the
  3x-repeat/log-line convention, verified by reading the code).
- **G-7**: the live SIGINT/SIGTERM shutdown-ordering test could not be
  written. Empirically, on this Windows box, `childProcess.kill('SIGINT')`
  AND `.kill('SIGTERM')` against a real spawned engine both return `{code:
  null, signal: '...'}` with none of the shutdown log lines ever printed —
  Node's own docs confirm Windows signal delivery to a child process is not
  a real catchable signal. No HTTP shutdown endpoint exists to fall back to
  (grep-verified). The two structural tests in `shutdown_ordering.test.js`
  are this suite's real coverage; a live proof needs a POSIX CI runner or a
  new HTTP shutdown route (production change, out of scope).
- **G-13 (applyDmx channels)**: not implemented this pass — time budget after
  the CRITICAL bug investigation (§3) consumed significant time bisecting a
  nondeterministic-looking crash that turned out to be fully deterministic
  once isolated correctly. Not blocked; a straightforward pickup for a
  follow-up slice.
- **G-4**: scoped to what's genuinely NEW value (byte-fidelity of the ENGINE's
  REAL `createSacnOutput` Sender's wire bytes through the bridge's REAL
  receiver path) rather than re-testing engineOwnedPairs unit logic (already
  covered by `simulation/tests/bridge_routing.test.js`) or re-deriving a
  "per-universe monitor state" structure that does not exist in
  `server/sacn_bridge.js` (only global `activeSource`/`packetCount` exist —
  replaced with the real, queryable `{type:'getRoutes'}` introspection).

## 6. Suite counts

**Engine (`marsin_engine`), final full run:** 2772 tests / 2765 pass / 7 fail —
same 7 failure names as baseline (verified line-for-line), **zero new
failures**. `tests/mixer/performance_mode.test.js` verified green in isolation
(11/11) per the documented concurrent-agent-contention caveat — not chased.

**Sim (`simulation`), one full run** (touched via G-4's new file):
2008 tests / 2001 pass / 6 fail — same 6 pre-existing failures (unrelated to
this session's file), **zero new failures**.

**`python scripts/security_check.py --all`: 7 findings, not 6.** The
documented baseline (6, all in gitignored `simulation/.scene_backups/studiodj/**`)
is unchanged and still present. The 7th is NEW but **not from this session**:
`.agent/reports/202608/20260805_163_sim_test_implementation.md:113` (written
by the concurrent sibling agent `_163`, untracked at the time this check ran)
contains a real MAC address literal in a TRACKED (non-gitignored) report file
— more concerning than the gitignored `.scene_backups` findings since it would
actually be committed. Flagged for `_163`/the reviewer to redact; not touched
here (not this session's file, and editing another agent's report is out of
scope). **This session's own additions contribute zero new findings** — none
of the 7 findings are in any file this session created or edited.

## 7. Working-tree residue, disclosed

Running the engine suite spawns real engines against the tracked
`marsin_engine/states/**` and `simulation/scenes/*/playlists/default.yaml` —
documented-expected residue per AGENTS.md, reported not reverted. None of it
is an edit of mine; every file this session wrote is a new `tests/**` file
(list in §2) plus this report and the tracker block.

## 8. Files

**New (marsin_engine):**
- `tests/io/sacn_output_wire.test.js`
- `tests/io/sacn_mapper_pack.test.js`
- `tests/mixer/all_models_load_lint.test.js`
- `tests/state/state_corrupt_load.test.js`
- `tests/state/config_boot_matrix.test.js`
- `tests/e2e/http_malformed_sweep.test.js`
- `tests/e2e/pattern_dirs_crash_pin.test.js`
- `tests/e2e/ws_connect_replay.test.js`
- `tests/e2e/picker_catalog_contract.test.js`
- `tests/e2e/shutdown_ordering.test.js`
- `tests/mixer/meta_abi_stride.test.js`
- `tests/audio/ffmpeg_resolver.test.js`

**New (simulation):**
- `tests/engine_bridge_contract.test.js`

**Not touched:** every production file; `simulation/tests/helpers/bridge_harness.mjs`
(reused, read-only); no `_163`-owned file.

## 9. Handoff

Highest priority for the reviewer: the `GET /pattern-dirs/<invalid-slug>` crash
(§3) — trivial to reach, total impact. Second: the G-16 ffmpeg fallback-chain
ruling and the N-1 state-restore-degraded ruling both need an operator/reviewer
decision before a fix slice can land cleanly. `dev_test_bench`'s boot failure
should be fixed or the model should be removed/marked scratch-only if it's
never meant to boot. G-13 remains open for a follow-up slice. R-D1/D3/D4/D5/D8/
D10/D11/D12 remain blocked on their `_157` fix slices as designed — this
session did not implement them.
