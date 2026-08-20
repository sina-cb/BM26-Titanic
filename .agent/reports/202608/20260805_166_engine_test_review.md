# 20260805_166 — Opus review of the ENGINE-side test wave (`_164` vs catalog `_162`)

**Agent:** reviewer `_166` (Opus, operator-assigned — "Sonnet agents wrote tests,
Opus agents review them") · **Branch:** `feat/bm_readiness`.
**Under review:** the 12 new `marsin_engine/tests/**` files + the one sim-side
G-4 file listed in `.agent/reports/202608/20260805_164_engine_test_implementation.md`.
Sibling `_165` reviews the SIM wave (`_161`/`_163`) concurrently — this review
stays in the engine lane plus the G-4 contract rig.

**Method:** read every new file line-by-line; MUTATION-TESTED the safety-critical
files (27 mutations, all applied **in memory only** via an ESM `load` hook —
zero production bytes changed on disk, verified by `git status` before and
after); independently reproduced the `/pattern-dirs` crash twice (a from-scratch
Node-semantics rig on an ephemeral port, and the real spawned engine); ran the
engine suite, the sim suite, `performance_mode.test.js` in isolation, and
`security_check.py --all`. No operator port bound, no packets to hardware, no
git writes. Scratch in `~/tmp/review_166/` (gitignored).

**VERDICT: ACCEPT-WITH-FIXES.** The wave is genuinely load-bearing — 24 of 26
conclusive mutations were killed. The crash claim is real, reproduced
independently, and the pin is a true tripwire (fixing the bug in memory turns
the pin red). Four defects require follow-up; none is a reason to reject.

---

## 1. Mutation-test results (the anti-vacuous gate)

All mutations rewrite production source **in memory** (`--import` load hook,
`MUT_SPEC` env). Every rule fails loudly if its target string is absent, so a
"surviving" test can never be a silently-unapplied mutation.

| # | Target | Mutation | Result |
|---|---|---|---|
| M1b | `lib/sacn_output.js` | drop `addUniverse` idempotency guard | **KILLED** (idempotency test red) |
| M2 | `lib/sacn_output.js` | `if (!_started) return` → never gate | **KILLED** |
| M3 | `lib/sacn_output.js` | `payload[ch+1]` → `payload[ch]` (off-by-one) | **KILLED** ×3 tests |
| M4 | `lib/sacn_output.js` | `sender.close()` → no-op | **KILLED** |
| M5b | `lib/sacn_output.js` | send with wrong `sourceName`/`priority` | **KILLED** |
| M6 | `sacn_mapper.js` | master dimmer forced to 0 instead of 255 | **KILLED** ×2 |
| M7 | `sacn_mapper.js` | remove the strobe out-of-bounds guard | **SURVIVED — vacuous test, see D-1** |
| M8 | `sacn_mapper.js` | remove `suppressNativeStrobes` dedupe | **KILLED** |
| M9 | `sacn_mapper.js` | `EndyshowBar: [129,130]` → `[129]` | **KILLED** |
| M10 | `state_manager.js` | delete the `console.warn` on load failure | **KILLED** ×4 |
| M13 | `api_server.js` | **FIX the `/pattern-dirs` bug** (build body before `writeHead`) | **KILLED** — the crash pin goes red (10.6 s timeout waiting for an exit that never comes) |
| M14 | `engine.js` | `cSacn.priority \|\| 100` → `?? 100` | **KILLED** (priority-0 pin red) |
| M16 | `led_wire.js` | `isLedEntry` → always false | SURVIVED — inconclusive, see D-3 |
| M17 | `lib/sacn_output.js` (via the G-4 rig) | off-by-one in the packing | **KILLED** — relay fidelity red |
| M18 | `api_server.js` | change the bad-JSON error string | **KILLED** ×14 |
| M19 | `model_loader.js` | force one patch to `addr: 900` | **KILLED** ×6 models (incl. titanic, test_bench) |
| M20 | `model_loader.js` | force a cross-fixture channel overlap | **KILLED** ×2 models |
| M21 | `api_server.js` | change the 413 message | **KILLED** |
| M22 | `api_server.js` | change the `Not Found` body by one space | **KILLED** |
| M23 | `engine.js` | change the "No API port" refusal text | **KILLED** |
| M24 | `output_config_guard.js` | change the guard-key refusal text | **KILLED** |
| M25 | `state_manager.js` | return a mutated default object | **KILLED** ×4 |
| M26 | `wasm_host.js` | `base+6` → `base+5` (meta lane drift) | **KILLED** |
| M27 | `bridge_routing.cjs` | neuter `engineOwnedPairs` | **INCONCLUSIVE** — the loader cannot reach CJS behind the harness's `Module._load` patch; not a test defect (see §2 G-4) |

Score: **24 killed / 1 survived-vacuous / 1 inconclusive-by-tooling / 1
inconclusive-by-target**. This is a real suite, not decoration.

---

## 2. Per-file verdicts

| File | Spec | Verdict | Evidence |
|---|---|---|---|
| `tests/io/sacn_output_wire.test.js` (9) | G-1 | **SOUND** | 5/5 mutations killed. Parses with the vendored `Packet`, never hardcoded offsets. The `{0,255}`-only value restriction is correct and correctly explained (the sacn lib's 2.55 percentage scale). Minor: case 1 never asserts the destination ADDRESS each datagram went to (only the count), so a "all 4 datagrams to one destination" regression would survive — see D-4. |
| `tests/io/sacn_mapper_pack.test.js` (22) | G-2 + G-11 | **SOUND** (1 vacuous test) | 4/5 mutations killed. Honest correction of the catalog's arithmetic (mono luma `Math.round` → 128, not the draft's 127). The out-of-bounds test is vacuous (D-1). |
| `tests/mixer/all_models_load_lint.test.js` (34) | G-3 | **SOUND** | Range lint and overlap pin both bite (M19/M20). `dev_test_bench` is pinned as a NAMED failing characterization with a "if this stops throwing, update this pin" note — correct pin discipline. Minor dead assertion at `:83` (`'summer_camp_dome.js.original'.replace(/\.js$/,'')` is a no-op; the line asserts a name that could never appear). |
| `simulation/tests/engine_bridge_contract.test.js` (5) | G-4 | **SOUND with one policy defect** | The only test anywhere that runs the ENGINE's real `Sender` bytes into the BRIDGE's real receiver — M17 proves the byte assertions bite. The `engineOwnedPairs` test waits on an observable state change through the real 3 s poll and `h.waitMs` throws on timeout, so it has teeth even though M27 could not reach CJS. **Defect D-2: a real controller IP literal is hardcoded** (`:91`), contradicting `_164`'s own "no real controller IP literal in any new test" claim. |
| `tests/e2e/http_malformed_sweep.test.js` (36) | G-5 + G-15 | **SOUND with a narrowing** | M18/M21/M22 all killed. Cleans up its own `zz_gap162_` residue in `finally`. **Defect D-5: `ACCEPTS_NONOBJECT_AS_NOOP` is a skip-list, not a pin** — for those 5 routes only `status < 500` is asserted, so a route entering or leaving the set is invisible. The catalog's "(b) → any 4xx" was weakened rather than characterized. Route count is 14, not the spec's "~20". |
| `tests/e2e/pattern_dirs_crash_pin.test.js` (1) | (new) | **SOUND — the best file in the wave** | Correctly isolated: `node --test` runs each file in its own child process, and the harness takes its own random 7100-7399 port, so the killed engine cannot cascade. M13 (fixing the bug) turns it red — it is a genuine tripwire, not a tautology. Header carries the full root cause + "rewrite me when the fix lands". |
| `tests/state/state_corrupt_load.test.js` (6) | G-6 | **SOUND** | M10/M25 killed 4 tests each. `NEEDS-RULING` test is explicitly marked as pinning a P0-tension gap, with the ruling question in-comment. Correct pin discipline. |
| `tests/state/config_boot_matrix.test.js` (8) | G-8 | **SOUND with a brittleness defect** | M14/M23/M24 killed. `blocked-on S-D12` comment on the priority-0 pin is exactly right. **Defect D-6: case 7 asserts the CONTENT of the live `marsin_engine/config.yaml`** (`sacn.multicast === false`, `web_client.enabled === false`, `playlist` deep-equals `{active:false, delay_s:'90', shuffle:true}`). Any legitimate operator config edit turns this red for no safety reason. It should assert dead-*ness* (grep for consumers), not the operator's current values. |
| `tests/e2e/ws_connect_replay.test.js` (5) | G-9 | **SOUND** | The spec correction is verified below (`/ws/params` really replays only `sharedParams`). The `ENGINE_ONLY_TYPES` allowlist forces a conscious decision on a genuinely new type — the right shape for this contract. |
| `tests/e2e/picker_catalog_contract.test.js` (4) | G-10 | **SOUND** | Spec correction verified (no word discriminator exists in `MaskEntry` or the API response). The substituted claim — a known word-1 preset surfaces by name — is the right thing to pin. Spawns a second `titanic` engine with a 45 s timeout; slow but bounded. |
| `tests/e2e/shutdown_ordering.test.js` (3) | G-7 | **WEAK — narrowed to source-text greps, disclosed** | All three tests read `engine.js` as a STRING and assert substring ordering / regex shape. No process is spawned, no signal sent, no byte observed. Both reasons for the cut are legitimate (Windows cannot deliver a catchable SIGINT to a child; the model watcher writes into the shared tracked `models/` dir), and both are documented in the header. But these pins break on any refactor that preserves behavior and pass on any behavior change that preserves the text — the weakest coupling in the wave. Accept as an interim pin; G-7 remains genuinely open. |
| `tests/mixer/meta_abi_stride.test.js` (6) | G-12 | **SOUND** | M26 killed the real-runtime-offset test. The dead-code pin is honest and self-invalidating ("if this file starts importing LANE_*, update this test"). Two near-vacuous tests (the trivially-true `META_LANES - 1 === 6`, and a dangling 2-pixel `setPixelMeta` call on a 1-pixel host at `:97-99` that asserts nothing) — cosmetic. |
| `tests/audio/ffmpeg_resolver.test.js` (4) | G-16 | **SOUND** | Correctly refuses to assert the catalog's assumption and pins the real (P0-violating) behavior with a NEEDS-RULING marker. Cosmetic: the local helper `path_isAbsoluteAndExists` only checks existence, never absoluteness. |

**Zero VACUOUS files. One vacuous test (D-1). No test asserts a tautology in
place of a behavior.**

---

## 3. THE CRITICAL CLAIM — independently reproduced and confirmed

`_164`'s claim: `GET /pattern-dirs/<invalid-slug>` kills the whole engine
process via an uncaught `ERR_HTTP_HEADERS_SENT`. **CONFIRMED, twice, with the
severity and trigger class characterized more precisely below.**

**Reproduction 1 — mechanism, from scratch (no engine involved).** A
from-first-principles `http` server on an ephemeral loopback port carrying only
the branch's exact 6 lines and the exact `VALID_PATTERN_DIR` regex
(`api_server.js:404`). Every slug that fails the regex raises
`uncaughtException: ERR_HTTP_HEADERS_SENT`; the request itself never completes
(the client hangs until it times out, because the response was head-sent and
never ended). Slugs tried: `..%2F..`, `Default`, `has space`, `dot.name`,
`_leading`, a 70-char name — all crash. `default` and `test` return 200.

**Reproduction 2 — the real engine.** `tests/e2e/pattern_dirs_crash_pin.test.js`
in isolation: the spawned engine prints
`⛔ ENGINE FATAL — uncaughtException (uncaughtException): Error [ERR_HTTP_HEADERS_SENT]`
and exits. Confirmed the code path is untouched by the working-tree diff
(`git diff -U0 -- lib/api_server.js` has zero `pattern-dirs` hunks) — this is
pre-existing on the branch, not introduced by uncommitted work.

**Reproduction 3 — causality.** Mutation M13 rebuilds the JSON body BEFORE
`writeHead(200)` (nothing else changed). The engine then survives the same
request and the pin goes red waiting for an exit that never comes. That isolates
the cause to the `writeHead`-before-`throw` ordering exactly as claimed.

**Severity — does it kill the PROCESS?** Yes. `process.exit(1)` from
`engine.js:1090-1096`. Nuance `_164` did not carry: the repo ships a supervisor,
`deploy/boot_server.ps1`, which relaunches on a non-75 exit after
`RestartDelaySeconds = 10`. So on a supervised playa boot one request buys a
**~10 s + engine-boot blackout**, and a client that repeats the request buys a
**permanent crash-loop**. Launched by hand (`npm start` / `node engine.js`,
which is how the bench and every agent run it) there is no supervisor at all and
the ship stays dark until a human notices. `_164`'s "the exterior lighting goes
dark" is right in kind; the supervised case is a repeating blink rather than a
one-shot permanent kill.

**Trigger class — exactly which inputs reach it.** Any `GET` whose URL matches
`^/pattern-dirs/[^/]+$` and whose `decodeURIComponent`'d segment is not
`default` and fails `/^[a-z0-9][a-z0-9_-]{0,63}$/`. In practice: **any uppercase
letter, space, dot, leading `_` or `-`, any non-`[a-z0-9_-]` character, or a
name longer than 64 characters.** `GET /pattern-dirs/Default` is enough.
Two inputs that do NOT crash and are worth knowing for the fix: a malformed
percent-escape (`%zz`) makes `decodeURIComponent` throw BEFORE `writeHead(200)`,
so the catch works correctly and returns 400 — the bug is strictly the
post-`writeHead` throw.

**Remotely triggerable by any LAN client?** Yes — unauthenticated (`_157` D7),
no state, no body, single request. Worse than "LAN client": it is a plain GET
with no custom headers, so **any web page open in any browser on the playa LAN
can fire it cross-origin** (`<img src="http://<engine>:<port>/pattern-dirs/X">`
— no preflight, and the response never needs to be readable for the crash to
land). That widens the blast radius beyond deliberate probes to any accidental
page load.

**Is the pin correctly isolated?** Yes. `node --test` with a file glob runs each
test FILE in its own child process, and `createEngineHarness` allocates its own
random port in 7100-7399, so the deliberately-killed engine belongs to that file
alone. Verified empirically: the full engine suite ran 2769 tests with exactly
the 7 known failures, and the pin passes both inside the suite and in isolation.
`http_malformed_sweep.test.js` explicitly documents why it does not touch this
input.

**Reviewer's recommendation:** agree with `_164` — this is the #1 fix-wave item.
The fix is three lines (build the body, then `writeHead`), plus an audit of
every other `writeHead`-before-work site in `api_server.js` for the same shape.

---

## 4. Spec fidelity vs `_162`

| Catalog | Claimed | Verified | Notes |
|---|---|---|---|
| G-1 | Implemented, 9 tests | **FAITHFUL** | All 8 catalog cases present. Case 1's destination-address assertion is absent (D-4). |
| G-2 | Implemented, 22 | **FAITHFUL + corrected** | All 8 cases. The catalog's expected `127` for the mono branch was wrong; `_164` pinned the real `128` with the reason. Correct call. |
| G-11 | Folded into G-2 | **FAITHFUL** | All 6 sub-cases present. |
| G-3 | Implemented, 34 | **FAITHFUL** | Enumeration, range lint, universe-union parity, overlap snapshot, word-aware fold-in — all present and all biting (M19/M20). |
| G-4 | Implemented, 5, scope cut disclosed | **FAITHFUL, cuts justified** | Both cuts are correct: no per-universe monitor structure exists in `sacn_bridge.js` (grep-confirmed), and `getRoutes` is the real queryable equivalent. Cases 1-5 all present in substituted form. |
| G-5 | Implemented, 36 | **NARROWED** | 14 routes not "~20"; the "(b) → any 4xx" requirement is waived for 5 routes via a skip-list rather than pinned (D-5); the 413 case moved off `/timeline/plans` for a documented, correct reason; the `/pattern-dirs/..%2F..` case moved to its own file for a correct reason. |
| G-15 | Folded into G-5 | **FAITHFUL** | All three sub-cases; temp-file cleanup in `finally`. |
| G-6 | Implemented, 6 | **FAITHFUL** | All 4 catalog cases plus the NEEDS-RULING pin. |
| G-7 | Implemented, 3, cuts disclosed | **SUBSTANTIALLY NARROWED** | Zero of the catalog's four live assertions (log ordering from a real shutdown, blackout count, exit code 0, port freed) are exercised against a running process. Replaced by source-text greps. Cuts are honestly reasoned. G-7 should stay OPEN on the board. |
| G-8 | Implemented, 8 | **FAITHFUL** | All 7 cases. Case 7 over-couples to live config content (D-6). |
| G-9 | Implemented, 5 | **FAITHFUL + spec correction verified** | I read `api_server.js:10596-10607`: `/ws/params` sends only `{type:'sharedParams', ...}` on connect; `paramSchema` is broadcast on registry change. `_162`'s spec text was wrong; `_164` is right. |
| G-10 | Implemented, 4 | **FAITHFUL + spec correction verified** | No `word` field exists on `MaskEntry` or in the `/model/view-selection-options` response. `_162`'s "word/bit discriminator" does not exist. `_164` is right. |
| G-12 | Implemented, 6 | **FAITHFUL** | Both the constant relation and the real runtime offsets, plus the dead-code pin. |
| G-13 | **Skipped, "time budget"** | **SKIP NOT JUSTIFIED BY COST** | See below. |
| G-14 | Folded into G-1 case 4 | **FAITHFUL** | |
| G-16 | Implemented, 4 | **FAITHFUL + correction** | Catalog assumed a throw; the code silently substitutes. `_164` pinned reality with a NEEDS-RULING marker, exactly as the catalog's own escape hatch instructed. |
| R-D1/D3/D4/D5/D8/D10/D11/D12 | Untouched (blocked) | **CORRECT** | Zero of the 8 regression specs were written. Verified by reading every new file: no test asserts a post-fix behavior. `blocked-on S-D10` / `blocked-on S-D12` / `R-D1` forward-references are present in the right places (`shutdown_ordering.test.js:85`, `config_boot_matrix.test.js:182`, `sacn_output_wire.test.js:26-35`). |

### G-13 — was skipping it lazy or reasonable?

**Lazy-ish, in the mildest sense.** `applyDmx(dmxBuffers, {blackout})`
(`lib/global_effects_controller.js:369`) is a plain synchronous method over
`this.foggers` / horn / fire; `tests/effects/global_effect_blackout.test.js`
(159 lines) already stands up the controller and the buffers the spec needs.
Extending it was the cheapest unimplemented entry in the catalog — no spawn, no
harness, no new fixture, likely 60-80 lines. The crash investigation was
genuinely expensive and was the right thing to spend time on, so this is not a
serious ding — but "time budget" undersells how cheap this one was. It should
be the first pickup of the follow-up slice, not left behind the D-series.

### `_162`'s N-2 needs a correction note — `_164` is RIGHT

I verified independently:
- `lib/autopilot.js:11` sets `CONFIG_FILE = process.env.MARSIN_CONFIG_FILE || <repo config.yaml>`; `:69` `this.config = this.loadConfig()`; `:83-88` `loadConfig()` reads and `yaml.load`s that file; `:90-94` `saveConfig()` **writes it back**; `:97` `get state() { return this.config.playlist || … }`; `:101-108` `updateState()` mutates `config.playlist.{active,delay_s,shuffle}` and saves. `Autopilot` is imported and constructed by `lib/api_server.js:7`.
  → **the top-level `playlist:` block is LIVE.** `_162`'s "zero consumers" claim is wrong.
- `sacn.multicast`: repo-wide grep finds it only in `config.yaml`, one test fixture, one test harness, and `_164`'s own comment. **Dead — `_162` right.**
- `web_client.enabled`: only comments in `engine.js` and test harnesses. **Dead — `_162` right.**
- `_164`'s N-3 correction also holds: `lib/autopilot.js:155` is
  `parseInt(this.state.delay_s, 10) || 30`, so the string `'90'` is defused by
  the consumer, not by deadness.

**Action for the operator (I did not edit `_162`'s file):**
`.agent/reports/202608/20260805_162_engine_test_gap_catalog.md` §6 N-2 and N-3
need a correction note — the `playlist:` block is not dead. One inaccuracy in
`_164`'s own comment while correcting it: `config_boot_matrix.test.js:216`
claims "web_client.port/build_dir ARE consumed (CaptainPad build)" — engine-side
they are not consumed either (`engine.js:1192-1194` is a comment saying the
engine deliberately does not touch `web_client.port`). Harmless comment drift,
but do not treat it as verified.

---

## 5. Pin discipline — are the characterizations marked as bugs, not blessings?

| Pin | Marked as buggy? | Fix reference? | Verdict |
|---|---|---|---|
| `/pattern-dirs` crash | Yes — file title says CRITICAL, header says "must be rewritten the moment the fix wave lands" | Root cause + line numbers + `engine.js` handler cited | **CORRECT** |
| ffmpeg silent discard (P0 violation) | Yes — test name literally starts `NEEDS-RULING:`, header names the codex rule it violates | Ruling question stated, Notion follow-up named | **CORRECT** |
| `dev_test_bench` boot failure | Yes — test name says `KNOWN-BROKEN`, assertion message says "if this stops throwing, the sidecar was fixed — update/remove this pin" | Names the file, the stale keys, and the real engine repro | **CORRECT** |
| `LANE_*` dead code | Yes — test name starts `DEAD-CODE PIN:`, header explains the drift risk | Self-invalidating: the assertion message tells the next agent to delete the pin if the constants get imported | **CORRECT** |
| `/ws/params` replay gap | Yes — header is an explicit `IMPORTANT CORRECTION vs the catalog's spec text` | Cites `api_server.js:10596-10607` | **CORRECT** — this one is a spec correction rather than a bug pin, and is labelled as such |
| N-1 silent state limp | Yes — `NEEDS-RULING:` test name, P0 tension spelled out in the header | Proposes the `/status.stateRestoreDegraded` shape | **CORRECT** |
| `sacn.priority: 0` → 100 | Yes — `blocked-on S-D12` comment, states the expected flip | Names R-D12 | **CORRECT** |
| 1× shutdown blackout | Yes — `blocked-on S-D10: flips to 3` | Names R-D10 | **CORRECT** |
| `{0,255}`-only wire values | Yes — header quirk note explains the sacn 2.55 scale and why mid values are excluded | Names R-D1 and S-D1 | **CORRECT** |
| N-5 basename mangling | Yes — test name carries `N-5`, comment calls it a tripwire | Names N-5 | **CORRECT** |
| Non-object body → 200 no-op | **Partially** — prose comment calls it "inconsistent … flagged for the reviewer", but the mechanism is a silent skip-list, not a pin | None | **D-5** |

**No pin blesses buggy behavior as correct.** Pin discipline in this wave is
better than average for the repo.

---

## 6. Production-bug claims — independent verification

| `_164` claim | My verdict | Evidence |
|---|---|---|
| `/pattern-dirs/<invalid>` crashes the engine process | **CONFIRMED** (severity refined: supervised = ~10 s blink + crash-loop on repeat; unsupervised = dark) | §3, three independent reproductions |
| N-1: `state_manager.load()` silently limps to defaults, no `/status` flag | **CONFIRMED** | `lib/state_manager.js:108-118` — bare `catch` → `console.warn` → `return defaultState`; no degraded field anywhere on the class |
| N-2 CORRECTION: `playlist:` block is live via `autopilot.js` | **CONFIRMED — `_164` right, `_162` wrong** | §4 |
| N-2: `sacn.multicast` / `web_client.enabled` are dead | **CONFIRMED** | Repo-wide grep |
| N-3 CORRECTION: `delay_s: '90'` defused by `parseInt` at `autopilot.js:155` | **CONFIRMED** | Read the line |
| N-5: `path.basename` mangles `dir/name` slugs | **CONFIRMED** | `api_server.js:5077` `path.basename(data.pattern, '.js')` on the `/pattern` route |
| NEW: `dev_test_bench` cannot boot | **CONFIRMED** | Ran the real engine: exit 1, `❌ groupBits in dev_test_bench.viewmasks.js is out of sync with model 'dev_test_bench' — table key(s) not in the model: ParLights, VintageLights, BarLights, LED_0` |
| NEW: `resolveFfmpegPath` silently discards a bad explicit path (P0 violation) | **CONFIRMED** | `resolveFfmpegPath('/does/not/exist/ffmpeg')` returns the vendored `ffmpeg-static` binary — identical to `resolveFfmpegPath(null)` |
| NEW: `LANE_*` constants are dead; both pack loops hardcode offsets | **CONFIRMED** | Repo-wide grep: `LANE_*` appears only in `meta_abi.js` (definitions) and in the new test |
| NEW: `/ws/params` replays only `sharedParams` | **CONFIRMED** | `api_server.js:10596-10607` |
| NEW: no word discriminator on `namedViews` | **CONFIRMED** | `mask_registry.js` `MaskEntry` and `api_server.js:6514-6523` both carry `{name, kind, bit, memberCount}` |
| Minor: 5 routes accept a non-object body as a 200 no-op | **CONFIRMED BY INSPECTION** (not spawned separately) | Every field read is `data.x !== undefined`-gated; `PATCH /osc/config:8038` is `typeof data !== 'object'`, and `typeof [] === 'object'` is `true`, so `[]` passes and `42` is rejected — exactly as described |
| N-4 (`loadConfig` default-path silent continue), N-6 (`sendFrame` skips senderless universes) | **NOT RE-VERIFIED BY ME EITHER** — `_164` correctly declares both as not re-tested | Both remain open survey notes |
| `security_check.py --all`: 7 findings | **STALE — 6 today** | I ran it: 6 findings, all in gitignored `simulation/.scene_backups/studiodj/**`. The 7th (a MAC literal in `_163`'s report) has been cleaned by the coordinator. `_164`'s report was accurate at its write time. |

**Zero wrong claims. One refinement (crash severity under a supervisor), one
stale count (security findings), two honestly-declared non-verifications.**

---

## 7. Defects (report-only — I edited nothing)

- **D-1 · VACUOUS TEST · low.**
  `sacn_mapper_pack.test.js:332` `suppressNativeStrobes: an out-of-bounds
  relative channel is skipped, no throw` asserts only `doesNotThrow`. Removing
  the production bound check (`sacn_mapper.js:56`) entirely leaves all 22 tests
  green (M7), because an out-of-range write on a `Uint8Array` silently no-ops in
  JS — the assertion is unfalsifiable. Fix: assert that a NEIGHBOURING in-range
  byte was not clobbered and that no byte of another fixture's frame changed, or
  delete the test and keep the comment.

- **D-2 · POLICY · medium.**
  `simulation/tests/engine_bridge_contract.test.js:91` hardcodes a real
  controller address as `RELAY_HOST` (also repeated twice in the header
  comment at `:51` and `:86`). `_164`'s report and tracker block both claim "no
  real controller IP literal in any new test"; that claim is false. The value is
  already tracked in `simulation/scenes/{titanic,test_bench}/controllers.yaml`
  so this is not a new disclosure and `security_check.py` does not flag it, but
  it (a) contradicts a stated hygiene claim and (b) hard-couples the test to a
  value the operator may re-address. Fix: derive the host from
  `liveResolution` / the scene data the harness already loads, as the file's own
  `ALL_SOURCES` does.

- **D-3 · COVERAGE GAP · low.**
  Mutating `isLedEntry` to always return `false` leaves all 34 `all_models`
  tests green (M16) — i.e. the LED exemption in the footprint lint is currently
  inert (no in-tree strand pixel actually crosses 512 with its footprint). Not a
  test bug; worth knowing that the exemption branch is unproven.

- **D-4 · WEAK ASSERTION · low.**
  `sacn_output_wire.test.js:101` counts 4 datagrams and checks universe /
  priority / sourceName but never asserts the destination address of each. A
  regression that sent all four datagrams to one destination would survive.
  The fake socket already captures `addr` — one `deepEqual` on the sorted
  `(universe, addr)` pairs closes it.

- **D-5 · SPEC WEAKENING · medium.**
  `http_malformed_sweep.test.js:115` `ACCEPTS_NONOBJECT_AS_NOOP` turns the
  catalog's "wrong-shape body → any 4xx" into a skip: for those 5 routes only
  `status < 500` is asserted. A route silently joining or leaving that set is
  invisible, and the "minor consistency defect" `_164` reports is therefore not
  actually pinned anywhere. Fix: assert the exact status per route (200 for the
  members, 4xx for everyone else) so the set is a characterization, not a mute.

- **D-6 · BRITTLENESS · medium.**
  `config_boot_matrix.test.js:206-229` asserts the live
  `marsin_engine/config.yaml`'s VALUES (`sacn.multicast === false`,
  `web_client.enabled === false`, `playlist` deep-equal). A legitimate operator
  config change turns the suite red with no safety benefit — and
  `marsin_engine/config.yaml` is already modified in the working tree. Fix:
  assert the keys' dead-*ness* (a repo grep for consumers) or just their
  presence, never their values.

- **D-7 · WEAK COUPLING · medium (accepted).**
  `shutdown_ordering.test.js` is 3 source-text greps against `engine.js`. Both
  cuts are legitimately reasoned, but G-7's real assertions (ordering of live
  log lines, blackout count on the wire, exit code, port release) remain
  unproven. Keep G-7 open; the durable fix is a `POST /shutdown` route (which
  would also give the fix wave a clean way to test R-D10).

- **D-8 · COSMETIC.** `all_models_load_lint.test.js:83` dead assertion
  (`'…js.original'.replace(/\.js$/,'')` is a no-op — the line can never fail);
  `meta_abi_stride.test.js:97-99` a dangling 2-pixel `setPixelMeta` on a 1-pixel
  host that asserts nothing; `meta_abi_stride.test.js:120` a trivially-true
  arithmetic assertion; `ffmpeg_resolver.test.js:80` helper named
  `path_isAbsoluteAndExists` that never checks absoluteness;
  `config_boot_matrix.test.js:82` `spawnAndObserve`'s `port` parameter is never
  used.

---

## 8. Suite integrity

| Check | Result | Expected | Verdict |
|---|---|---|---|
| `cd marsin_engine && npm test` | **2769 tests / 2762 pass / 7 fail**, 121 s | 2631-2772 era, 7 known fails | **PASS** |
| Failing LIST (the stable quantity) | 5× `tests/audio/audio_capture.test.js` (Windows: no pinned mic), 1× `tests/effects/effects_v2_mode_page_layout.test.js` (file-level IPC deserialize), 1× `tests/io/osc_listener.test.js` EADDRINUSE→EACCES | identical set | **BYTE-MATCH — zero new failures** |
| `tests/mixer/performance_mode.test.js` isolated | **11 / 11 / 0** | green in isolation | **PASS** (contention caveat holds) |
| `tests/e2e/pattern_dirs_crash_pin.test.js` isolated | **1 / 1 / 0**, engine FATAL observed | green | **PASS** |
| `cd simulation && npm test` | **2008 tests / 2001 pass / 6 fail** | ~2008 / 6 known | **PASS** — the 6 are the pre-existing dock/orphan-patch/CLI-parity/compression set, none from G-4 |
| `python scripts/security_check.py --all` | **6 findings**, all in gitignored `simulation/.scene_backups/studiodj/**` | 6 baseline | **PASS** — the 7th from `_163` is confirmed cleaned |
| Production files edited by this review | **none** — all 27 mutations were in-memory | — | **PASS** |
| Engine-suite state-yaml residue | present in `marsin_engine/states/**` and `simulation/scenes/*/playlists/*.yaml` | documented-expected | **PASS** |

Note for attribution hygiene: the working tree also carries production changes
(`marsin_engine/engine.js`, `lib/api_server.js`, `simulation/server/sacn_bridge.js`,
the deleted `artnet_output.js`/`output_dispatch.js`, the untracked
`lib/output_config_guard.js`). None of these are `_164`'s — `output_config_guard`
is cited as pre-existing coverage in `_162` itself, and `git diff` on
`api_server.js` contains zero `pattern-dirs` hunks. `_164`'s "zero production
edits" claim holds for this review's purposes.

---

## 9. Verdict and handoff

**ACCEPT-WITH-FIXES.** The engine test wave is real coverage: 24 of 26
conclusive mutations killed, one genuinely vacuous test, no vacuous files, no
pin that blesses a bug, and one production crash found, correctly root-caused,
correctly isolated, and proven to be a live tripwire rather than a tautology.
The Sonnet work here does not need redoing.

Fixes to land before this is considered closed (all test-side, none blocking):
D-1 (vacuous strobe test), D-2 (real IP literal in the G-4 rig), D-5 (skip-list
→ characterization), D-6 (config-value coupling). D-3/D-4/D-7/D-8 are
lower-priority polish.

Follow-ups for the operator, in order:
1. **Fix `GET /pattern-dirs/<invalid-slug>`** — three lines, plus an audit of
   every other `writeHead`-before-work site in `api_server.js`.
2. Rulings needed before their fix slices can land: the ffmpeg
   explicit-path-discard P0 question, and the `/status.stateRestoreDegraded`
   question.
3. `dev_test_bench` — fix the sidecar or mark the model scratch-only.
4. G-13 (cheap) and G-7 (needs a `POST /shutdown` route to do properly) stay
   open; R-D1/D3/D4/D5/D8/D10/D11/D12 remain correctly blocked on `_157`.
5. Add a correction note to `_162` §6 N-2/N-3 — the top-level `playlist:` block
   is live, not dead. (I did not edit their file.)

Addresses redacted in prose per the repo's public-repo rules; the one real
address literal is called out as D-2 by file and line only.

---

## 10. ADDENDUM (end of review) — the fix landed mid-review; the crash pin is now RED

Between the start of this review and its close, a concurrent agent landed the
`/pattern-dirs` fix into the working tree (`marsin_engine/lib/api_server.js`:
the route now carries a `COMPUTE THE BODY BEFORE COMMITTING HEADERS` block, and
a new `sendJsonError` responder was added whose header comment cites `_164` §3).
`git diff -U0 -- marsin_engine/lib/api_server.js | grep -c pattern-dirs` went
from **0** (measured early in this review) to **1**.

**Consequence, verified by re-running the file just now:**
`tests/e2e/pattern_dirs_crash_pin.test.js` is **RED** — `1 test / 0 pass /
1 fail`, failing after 10.3 s on `engine did not exit within timeout`. This is
the exact failure mode mutation M13 predicted, which independently re-confirms
both the root cause and that the pin is a real tripwire rather than a tautology.

**Every count in §8 was taken BEFORE that fix landed** and is accurate as of
that moment. Post-fix the engine suite is expected to read **2769 / 2761 / 8**
with `pattern_dirs_crash_pin.test.js` as the 8th failure. Nothing else in this
review changes: all 27 mutations, the three crash reproductions, the spec-fidelity
table and the defect list stand.

**Required follow-up, now urgent:** the crash pin must be REWRITTEN, exactly as
its own header instructs — flip it from "the engine must die" to "the request is
handled without dying" (assert a 4xx with the `Invalid pattern directory` body,
then `GET /status` still 200), and keep the root-cause comment as the historical
record. Whoever owns the fix slice owns this rewrite; until it lands the engine
suite carries a spurious 8th failure. Recommend the rewrite also cover the two
non-crashing companions found in §3: a malformed percent-escape (`%ZZ`) and the
legal `default` / sub-directory slugs, so the fix's own edges are pinned.
