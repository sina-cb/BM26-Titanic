# 20260805_163 — SIM test-gap implementation: harness extraction + 14 of 16 catalog gaps

**Agent:** test implementer `_163` (Sonnet 5, operator-assigned) · **Branch:** `feat/bm_readiness`.
**Blueprint:** report `20260805_161` (the 16-gap catalog). **Scope discipline honored:
TEST CODE ONLY.** Zero production files edited. Zero git operations. No port in
6966–6972/5568/8081/10000 bound; no real controller IP in any new test (10.x.x.x
documentation range or read from live scene data throughout). Scratch used:
`~/tmp/test_impl_163/` (not needed in the end — everything fit in `tests/`).

**Working-tree note:** this tree is under heavy concurrent multi-agent load. Mid-session,
`tests/bench_mirror_arm.test.js` and `server/sacn_bridge.js` (among many other files, none
mine) changed under me — the arm suite grew from 54→56 tests. The tracker tail was
re-read before every append below and immediately before starting the harness
extraction; the prerequisite refactor was verified against the CURRENT (56-test) file
content, not a stale read.

## 0. Prerequisite — H-A harness extraction (done first, as instructed)

Extracted the fake-module bridge harness (`Module._load` interception for `sacn`/`ws`,
`FakeSender`/`FakeReceiver`/`FakeClient`/`FakeWebSocketServer`/`FakeWebSocketClient`,
console capture, `connect`/`request`/`armFrom`/`disarmFrom`/`optionsFrom`,
`inbound`/`engineFrame`, `waitFor`/`waitMs`) from `bench_mirror_arm.test.js:518–847`
into **`simulation/tests/helpers/bridge_harness.mjs`**, exporting a `createBridgeHarness()`
factory (call once per test file — each `node --test` file is its own process, so the
`Module._load` patch and require-cache are safely file-scoped) plus the fixed live data
(`liveSidecar`, `liveResolution`, `LIVE_DESTS`, `GATEWAY`, `STRAND`, `ALL_SOURCES`,
`SIM_ROOT`, `routeKey`). Added two small generalizations needed by later gaps, both
backward-compatible:
- `setFetchImpl`/`resetFetchImpl` — a full `fetch` override (the original only supported
  swapping `engineStatus`, which can't express a rejecting fetch or a non-OK response;
  needed by G4).
- `waitMs` — the real-wall-clock poll-wait `bench_mirror_arm.test.js` already had inline
  for its two engine-poll-driven tests, promoted into the shared harness.

`bench_mirror_arm.test.js` refactored to consume it: `engineStatus =`/`sendHook =`
call sites became `H.setEngineStatus()`/`H.getEngineStatus()`/`H.setSendHook()`/
`H.clearSendHook()`; bare `armedSocket`/`receiverRef` became `H.armedSocket`
(a live getter — NOT destructured, since it changes after arming)/a one-time
snapshot; `Module._load = originalLoad` became `H.restoreModuleLoad()`. The
`observer` variable and its construction line stayed in the test file itself
(`H.setObserver(observer)` added right after), preserving the exact original
statement order. **Zero assertions changed.**

**Verified byte-for-byte:** `bench_mirror_arm.test.js` alone: **56/56** before and after
the refactor, same 56 test names. Full suite before: **1883/1877/6**; after the harness
refactor alone (before any new file): **1883/1877/6**, same six failing names
(`fixtures are docked beside the ship…`, `REFUSES: a patched fixture no chain reaches
(orphan patch record)`, `the real titanic scene can accept the block today (no
collisions)`, the two `scene_model_parity` CLI Phase-B tests, `the compression
threshold has real headroom on the live scene`).

## 1. Baseline

`cd simulation && npm test` before any new test: **1883 / 1877 / 6** (the CLI's own
measured baseline already included +2 tests from a concurrent agent's landing between
the `_161` survey and this session — 1881→1883 — same six pre-existing failures
throughout).

## 2. Per-gap disposition

| Gap | Rank | Status | File(s) | Tests |
|---|---|---|---|---|
| Prereq (H-A extraction) | — | **Implemented** | `tests/helpers/bridge_harness.mjs` | n/a (refactor) |
| G1 arbitration+lockout | 1 | **Implemented** | `sacn_bridge_arbitration.test.js` | 9 |
| G3 client lifecycle | 2 | **Implemented** | `sacn_bridge_client_lifecycle.test.js` | 7 |
| G4 engine-poll state machine | 3 | **Implemented** | `sacn_bridge_engine_poll.test.js` | 11 |
| G2 output-bridge data path | 4 | **Implemented** | `sacn_output_bridge_datapath.test.js` | 8 |
| G6 sacn_input_source frames (+G15 half) | 5 | **Implemented** | `sacn_input_frames.test.js` | 8 |
| G5 UniverseRouter/FrameBuffer | 6 | **Implemented** | `universe_router.test.js` | 10 |
| G10 shutdown ordering | 7 | **Implemented** | `sacn_bridge_shutdown.test.js`, `sacn_bridge_shutdown_armed.test.js`, `sacn_bridge_shutdown_blackout_race.test.js` | 3+4+2=9 |
| G7 save-server endpoints | 8 | **Implemented, reduced scope** (see below) | `save_server_endpoints.test.js` | 10 |
| G8 all-scenes structural lint | 9 | **Implemented, reduced scope** (see below) | `scene_data_lint.test.js` | 21 + 1 todo |
| G12 sacn_output_client (+G15 half) | 10 | **Implemented** | `sacn_output_client_frames.test.js` | 6 |
| G9 load_ports fail-loud | S | **Implemented** | `load_ports.test.js` | 5 |
| G11 animate.js belt wiring | S | **Implemented** | `animate_output_wiring.test.js` | 5 |
| G14 boot-invariant/error exits | S | **Implemented** | `sacn_bridge_boot_invariant.test.js` | 5 |
| G13 monitor-panel pure logic | S, low | **Implemented, weak (option a)** | `sacn_monitor_panel_pure.test.js` | 5 |
| G15 static-host gates | S, low | **Folded into G6 + G12** (as specced) | (above) | (above) |
| G16 sidecar warn dedup | S | **Skipped** — see below | — | — |

**Totals: 120 new tests registered (119 pass, 1 `todo`), across 16 new files + 1 new
helper.** Every `[D12-pin]`/`[D4-pin]` characterization is named as a PIN with a `_157`
report reference, per the catalog's rule — none bless a fallback as design.

### Spec-vs-reality corrections found while implementing (for the reviewer)

1. **G1 — the catalog's own priority-0 conflation example was wrong for the LIVE
   config.** The `_161` spec text for the `priority||100` pin assumed the inflated
   value (100) would land BELOW the high-priority threshold ("routed as low"). On
   the actual live `scenes/common.yaml` value, `sacn_high_priority` is ALSO exactly
   100, and the arbitration test is `priority >= HIGH_PRIORITY` — so **100 >= 100
   is true**, and a priority-0 packet (sACN's legal lowest priority) is arbitrated
   as an **OVERRIDE**, not "routed as low". This is a sharper defect than the
   catalog described: a naive/misconfigured test source sending priority 0 doesn't
   just get treated as normal traffic, it seizes the high-priority lock and locks
   out every other universe for a full second. Pinned as-observed in
   `sacn_bridge_arbitration.test.js` with the discrepancy documented inline.
2. **G4 — `pollEngineStatus` is not exported** (no `module.exports` in
   `sacn_bridge.js` at all), so the catalog's "All calls direct — never wait for the
   3s interval" instruction cannot be followed literally. Drove it the same way
   `bench_mirror_arm.test.js` already does for its two engine-poll auto-disarm
   cases: real wall-clock waits via the (now-shared) `waitMs` helper. The
   G4 file's own runtime is ~40s as a result — this is the true cost of testing an
   un-exported, interval-driven state machine, not a shortcut.
3. **G4 — the console log text and the browser-broadcast log text for the same
   transition DIFFER by design** (`console.log('Engine active scene changed:
   ...')` vs `broadcastLog("Engine scene → '...'")`). Cost one failed iteration
   before the fix; noted here so nobody "fixes" the mismatch thinking it's a bug —
   it's the verbose-operator-line vs terse-HUD-line split used throughout this file.
4. **G12 — confirmed (not a correction, a positive finding):** `sacn_output_client
   .js`'s silent IP-octet coercion (`parseInt(part,10)||0`) turns a typo'd
   controller IP into a DIFFERENT VALID address rather than refusing it — e.g.
   a quad with a non-numeric octet (`'A.B.x.D'`) becomes `A.B.0.D`. Pinned as a characterization, flagged as a
   fail-loud-rule candidate exactly as the catalog anticipated.

### G7 — reduced scope (save-server endpoints)

Implemented: `/create-scene` (invalid-name refusal, happy path, 409 on existing),
`/delete-scene` (invalid-name, 404 on well-formed-but-missing, sibling isolation),
`/backups` + `/restore-backup` HTTP glue (a real overwrite → backup appears with the
pre-overwrite content → restore rolls it back; a syntactically-bad id is a named 400,
a well-formed-but-unknown id is a named 404, process never dies), `/list-scenes`, and
the `/save-cameras` **silent-default characterization** (`[P0-tension]`: no `?scene=`
param silently targets `scenes/titanic/`, creating a scene directory the operator
never named — pinned, not endorsed).

**Deliberately NOT implemented:** `/save-pattern`, `/delete-pattern`, `/list-patterns`
(including the catalog's headline `/delete-pattern` traversal probe). Reason: these
three endpoints resolve their target dir as
`path.join(SIM_ROOT, '..', 'marsin_engine', 'patterns')`, and the test-only
`SIM_SAVE_SERVER_ROOT` override only substitutes for `SIM_ROOT` — so under the
override, `ENGINE_ROOT` resolves to `<the OS temp dir>/marsin_engine`, **one level
above** the per-test unique `mkdtempSync()` directory, not inside it. That path is
shared across every test run on the machine (not unique per run), so exercising it
from a test in this actively multi-agent tree risked colliding with a concurrent
run. This is itself worth flagging as a test-hook isolation gap (`SIM_SAVE_SERVER_ROOT`
should also redirect `ENGINE_ROOT`, or the pattern endpoints need their own hook) —
recorded here rather than routed around by writing into shared OS temp space.
Separately, read-only inspection of `/delete-pattern`'s sanitizer
(`name.replace(/[^a-z0-9_-]/gi, '_')`) shows it replaces `.`, `/` **and** `\` — so a
`../sentinel`-shaped name collapses to a harmless same-directory filename
(`___sentinel.js`) by construction. It reads as already safe, not merely untested,
but this was not verified by an executed test and should be confirmed once the
isolation gap above is closed.

Also found in passing (not a bug, just worth recording): `scene_backup.cjs`'s
`snapshotBeforeWrite` writes a backup manifest (with an empty `files[]`) on **every**
call, even the very first save when nothing existed yet to back up — and coalesces
into that same entry for the next 10s (`COALESCE_WINDOW_MS`). A naive "count went up
by exactly one" assertion is therefore wrong; the test asserts on backup *content*
instead.

### G8 — reduced scope (all-scenes structural lint)

Implemented: YAML-parses-without-throwing for every existing structural file across
all 8 scene dirs, `readPatchDeclarations(...).anomalies.length === 0` for every
`patches.yaml` (zero anomalies found — no allowlist needed), `controllers.yaml` IP
well-formedness + no-duplicate-IP-within-scene for every scene that has one, and the
residue tripwire.

**Deliberately NOT implemented:** the per-(scene, controller IP) DMX-address-overlap
check (catalog spec item 3). The real overlap rule lives inside
`lib/scene_model_parity.cjs`'s `checkSceneModelParity`, which needs full
fixture-footprint resolution against `dmx/fixtures`, chain/segment walking, and (for
its strictest checks) a loaded 3D model — most of the six non-gated scenes are
DMX-only stubs without one. Reimplementing a second, simplified overlap algorithm
risked being subtly different from the real one — exactly the "two implementations of
what a patch record occupies" drift `readPatchDeclarations` exists to prevent.
Left for a slice that can invoke the real validator's overlap check directly (or an
export making it standalone). Playlist→pattern resolution (spec item 6) skipped per
the catalog's own boundary note (coordinate with `_162`'s engine-side catalog test).

**Residue tripwire is a `test.todo`, not a normal assertion** — it correctly fails
today (`summer_camp_dome/patches.yaml.original` still exists) and is marked `todo`
so that real, expected failure doesn't violate the "every new test passes" gate. This
is a genuine, unfixed finding for the operator, not a suppressed defect:

> **Residue for the operator:** `simulation/scenes/summer_camp_dome/patches.yaml.original`
> still exists (first flagged in report `20260805_161`). A test-only implementer must
> not delete operator data — please delete or archive it; `robocopy /MIR` ships
> everything under `scenes/` to the show server, junk included.

### G16 — skipped

Per the catalog's own text: broken-sidecar fixtures can't be tested without either (a)
writing into the real `scenes/` tree (forbidden for this task) or (b) a new
`BM26_SIM_SCENES_ROOT` test-only env hook, which is a **production edit** requiring its
own reviewed slice — not something a test-code-only implementer can add. Left exactly
where `_161` left it: pending `_159`'s disarmed-path review landing fixture machinery,
or a follow-up production-edit slice.

## 3. Final counts

`cd simulation && npm test`: **2003 / 1996 / 6 / 1 todo** — same six pre-existing
failures, byte-identical names to the baseline; **+120 tests, zero new failures.**

`python scripts/security_check.py --all`: **6 findings**, all in gitignored
`.scene_backups/studiodj/**` (the documented baseline) — **zero new findings.**

No new test file binds a real port, sends a real packet, or carries a real controller
IP literal (verified: every address in every new file is either read from live scene
data via `getRoutes`/the harness, or drawn from the `10.x.x.x` documentation range
consistent with the D-158-7 tests).

## 4. Production-bug / follow-up list for the Opus reviewer

None of these were fixed (test-code-only scope) — all pinned or documented above:

1. **[D12-class, sharper than catalogued]** A priority-0 sACN packet is arbitrated
   as an OVERRIDE on the live `sacn_high_priority=100` config, not merely
   "treated as low" — `server/sacn_bridge.js:1264` `packet.priority || 100`
   combined with the `>=` threshold comparison. (`sacn_bridge_arbitration.test.js`)
2. **[D4, confirmed]** The high-priority lockout is GLOBAL across universes, not
   scoped to the universe that triggered it. (`sacn_bridge_arbitration.test.js`)
3. **[D12, confirmed x3]** `universe||1` and `priority||SACN_DEFAULT_PRIORITY(200)`
   (browser `sacn_input_source.js`) and `priority||DEFAULT_PRIORITY(100)` +
   silent IP-octet coercion (browser `sacn_output_client.js`) all silently
   remap malformed input to a DIFFERENT VALID value rather than refusing it.
   (`sacn_input_frames.test.js`, `sacn_output_client_frames.test.js`)
4. **[D9, confirmed]** The output bridge's 15s stale-sender reap silently resets
   the E1.31 sequence when a pair resumes sending — timing pinned exactly.
   (`sacn_output_bridge_datapath.test.js`)
5. **[P0-tension]** `/save-cameras` (and by the same code path,
   `/save-pixel-map-views`) with no `?scene=` param silently targets/creates
   `scenes/titanic/` rather than refusing. (`save_server_endpoints.test.js`)
6. **[Test-hook isolation gap, save-server]** `SIM_SAVE_SERVER_ROOT` does not
   redirect `ENGINE_ROOT` (`path.join(SIM_ROOT, '..', 'marsin_engine')`), so
   pattern-endpoint tests under this hook write into a SHARED OS-temp path, not
   an isolated one. No test exercises this until the hook is fixed or the
   endpoints gain their own root override.
7. **[Data hygiene, not code]** `simulation/scenes/summer_camp_dome/patches.yaml.original`
   is still present — flagged since `20260805_161`, now has a `test.todo`
   tripwire in `scene_data_lint.test.js` waiting for it to be deleted.

## 5. Files touched

**New:** `simulation/tests/helpers/bridge_harness.mjs`,
`simulation/tests/sacn_bridge_arbitration.test.js`,
`simulation/tests/sacn_bridge_client_lifecycle.test.js`,
`simulation/tests/sacn_bridge_engine_poll.test.js`,
`simulation/tests/sacn_output_bridge_datapath.test.js`,
`simulation/tests/sacn_input_frames.test.js`,
`simulation/tests/universe_router.test.js`,
`simulation/tests/sacn_bridge_shutdown.test.js`,
`simulation/tests/sacn_bridge_shutdown_armed.test.js`,
`simulation/tests/sacn_bridge_shutdown_blackout_race.test.js`,
`simulation/tests/sacn_bridge_boot_invariant.test.js`,
`simulation/tests/sacn_output_client_frames.test.js`,
`simulation/tests/load_ports.test.js`,
`simulation/tests/animate_output_wiring.test.js`,
`simulation/tests/scene_data_lint.test.js`,
`simulation/tests/sacn_monitor_panel_pure.test.js`,
`simulation/tests/save_server_endpoints.test.js`.

**Modified:** `simulation/tests/bench_mirror_arm.test.js` (harness-consumption
refactor only — no assertion changed, verified 56/56 before and after).

**Not touched:** every production file (`server/*.js`, `src/**/*.js`, `lib/*.cjs`,
`scenes/**`, `dmx/**`). Confirmed via `git status` — the only tracked-file diff this
session produced is the one line above; the concurrent tree churn visible in
`git status` (marsin_engine/*, several other simulation/* files) belongs to other
agents working in parallel, not this task.
