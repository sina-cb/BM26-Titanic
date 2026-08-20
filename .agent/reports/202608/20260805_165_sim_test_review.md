# 20260805_165 — Opus review of the `_163` SIM test wave (16 files + harness extraction)

**Agent:** reviewer `_165` (Opus, operator-assigned) · **Branch:** `feat/bm_readiness`.
**Under review:** report `20260805_163`'s implementation of catalog `20260805_161` —
`simulation/tests/helpers/bridge_harness.mjs`, 16 new `tests/*.test.js` files, and the
refactor of `tests/bench_mirror_arm.test.js` onto the extracted harness.

**READ-ONLY throughout.** Zero production files edited, zero test files edited, zero git
writes, no operator port bound (6966–6972/5568 untouched), no packet sent. Every mutation
below was applied **in memory only**, via a `--import`/`--require` preload that rewrites
source text at compile/load time (`~/tmp/review_165/mutate*.{mjs,cjs}`) — nothing on disk
changed. Scratch: `~/tmp/review_165/`. IPs redacted to `10.x.x.NN` in prose.

**Verdict: ACCEPT-WITH-FIXES.** The wave is genuinely sound — 30 mutations across 12
production files each killed exactly the test(s) that claim to pin the mutated behavior,
and no test in the wave is vacuous. Four defects, all coverage gaps rather than false
assertions, are listed in §5. None is blocking; none is BROKEN-RED.

---

## 1. Method

1. Read all 17 new files end to end, plus the harness-consumption diff region of
   `bench_mirror_arm.test.js`.
2. Ran `cd simulation && npm test` once, cold.
3. **Mutation-tested 30 production behaviors** the wave claims to pin. Each mutation
   rewrites one production expression in memory and re-runs the owning test file; a test
   that survives its own mutation is vacuous. Results: §3.
4. Re-ran the five timing-sensitive files 3× each in isolation for determinism.
5. Independently verified each of `_163`'s seven production-bug claims against source.
6. Diffed each implemented file's assertions against its `_161` spec item by item.

## 2. Suite integrity

| Measure | Expected (`_163`) | Measured (`_165`) | Verdict |
|---|---|---|---|
| `cd simulation && npm test` | 2003 / 1996 / 6 / 1 todo | **2003 / 1996 / 6 / 1 todo** | ✅ |
| Failing names | the same six | byte-identical (`fixtures are docked beside the ship…`, `REFUSES: a patched fixture no chain reaches (orphan patch record)`, `the real titanic scene can accept the block today (no collisions)`, 2× `scene_model_parity` CLI Phase-B, `the compression threshold has real headroom on the live scene`) | ✅ |
| `bench_mirror_arm.test.js` alone | 56/56 | **56/56** | ✅ |
| `python scripts/security_check.py --all` | 6 baseline | **6**, all in gitignored `.scene_backups/studiodj/**` | ✅ |
| Suite wall time | — | 44.4 s | — |

**Flake check — 3× in isolation, all clean:**

| File | run1 | run2 | run3 |
|---|---|---|---|
| `sacn_bridge_engine_poll.test.js` | 11/11 | 11/11 | 11/11 |
| `sacn_output_bridge_datapath.test.js` | 8/8 | 8/8 | 8/8 |
| `sacn_bridge_shutdown_armed.test.js` | 4/4 | 4/4 | 4/4 |
| `sacn_bridge_shutdown_blackout_race.test.js` | 2/2 | 2/2 | 2/2 |
| `sacn_bridge_arbitration.test.js` | 9/9 | 9/9 | 9/9 |

No flake observed in the new 120. The engine-poll file's four real-wall-clock waits use a
4500 ms budget against a 3000 ms interval — 1.5 s of headroom. That is adequate today but
is the wave's thinnest timing margin; if a future machine ever flakes, that is where.

**IP hygiene independently re-verified.** Every live controller address in every scene is
`10.1.1.x`; every literal in every new test file is `10.0.0.x` / `10.1.0.x` / `10.1.2.x` /
`10.9.9.x` / `127.0.0.1` / `0.0.0.0`. **Zero overlap — the claim holds.** (Wording nit for
the record: `_163` calls `10.x.x.x` "the documentation range". It is RFC 1918 private
space; RFC 5737 documentation space is `192.0.2.0/24` etc. The material point — no live
controller address in any test — is true.)

## 3. Mutation-test results — 30 mutations, 30 kills

Every row: a production expression neutralized in memory, then the owning test file re-run.
"Killed" names the test(s) that failed. A surviving mutation is called out explicitly.

| # | Production mutation (in memory only) | File | Test(s) killed |
|---|---|---|---|
| M1 | `packet.priority \|\| 100` → `packet.priority` | `sacn_bridge.js` | G1 priority-0 pin |
| M2 | `packet.universe \|\| 1` → `packet.universe` | `sacn_bridge.js` | G1 universe-0 pin |
| M3 | low-priority branch `if (!highPriorityActive)` → `if (true)` | `sacn_bridge.js` | G1 same-universe drop, **G1 D4-pin**, G1 lockout release (3) |
| M4 | `}, LOCKOUT_MS)` → `LOCKOUT_MS * 100` | `sacn_bridge.js` | G1 lockout release, G1 universe-0 pin (2) |
| M5 | `if (_enginePollBusy) return;` removed | `sacn_bridge.js` | G4 re-entrancy |
| M6 | `j.service === 'marsin-engine'` check removed | `sacn_bridge.js` | G4 wrong-service, G4 non-OK, G4 outputRouting-absent (3) |
| M7 | armed-shutdown fast-exit gate → `if (true)` | `sacn_bridge.js` | G10 armed blackout-then-exit, G10 gate released (2) |
| M8 | `if (_shuttingDown) return;` removed | `sacn_bridge.js` | G10 double-signal no-op |
| M9 | mid-blackout `if (_mirrorArm === null)` → `if (false)` | `sacn_bridge.js` | G10 signal-mid-blackout |
| M10 | pool key `` `${universe}:${ip}` `` → `` `${universe}` `` | `sacn_output_bridge.js` | G2 pool keying |
| M11 | `data.length !== 519` → `data.length < 400` | `sacn_output_bridge.js` | G2 malformed-length |
| M12 | `STALE_SENDER_MS` 15000 → 150000 | `sacn_output_bridge.js` | G2 stale reap |
| M13 | error fork `if (!fatal)` → `if (false)` | `sacn_bridge.js` | G14 non-fatal warns |
| M14 | `if (!invariant.ok)` → `if (false)` | `sacn_bridge.js` | G14 boot-invariant exit |
| M15 | `priority \|\| DEFAULT_PRIORITY` → `priority` | `sacn_output_client.js` | G12 D12-pin |
| M16 | `parseInt(parts[i],10) \|\| 0` → NaN→255 | `sacn_output_client.js` | G12 IP coercion |
| M17 | `priority \|\| SACN_DEFAULT_PRIORITY` → `priority` | `sacn_input_source.js` | G6 D12-pin |
| M18 | `SOURCE_STALE_MS` 2000 → 2001 | `universe_router.js` | G5 strict stale boundary |
| M23 | `clientScenes.set(ws, …)` removed | `sacn_bridge.js` | G3 setScene, re-tag, census, disconnect (4) |
| M24 | `clientScenes.delete(ws)` removed | `sacn_bridge.js` | G3 disconnect recompute |
| M25 | `/save-cameras` default `'titanic'` → `'g7_seed'` | `save-server.js` | G7 P0-tension pin |
| M26 | `!benchMirrorArmed` → `true` (source text) | `animate.js` | G11 belt guard |
| M27 | `priority: 150` → `151` (source text) | `animate.js` | G11 priority-150 tripwire |
| M28 | `MAX_LOG_ENTRIES = 20` → `50` (source text) | `sacn_monitor_panel.js` | G13 log cap |

### 3a. Harness-extraction falsification (task requirement 3)

The `_152`/`_158` falsification-hardened regressions were re-falsified **through the new
harness**, to prove the extraction did not blunt them:

| # | Mutation | Test(s) killed |
|---|---|---|
| **M21** | `if (_mirrorDisarming) continue;` removed (the D1 fix — mirror senders may now be closed mid-blackout) | **`_152 D1: no raw relay frame reaches an owned pair between the blackout frames`** ✅, `_151 bridge: the arming socket disconnecting disarms with the same blackout` |
| M20 | `blackoutInFlight()` no longer reports the disarm blackout | `_152 D2`, `_152 RESIDUAL-1`, `_155 A3` |
| M22 | `const fixed = stuckUniverses.length > 0` → `false` | `_158 R-158-A: a FIXED sequence offset is named as such` |

**The D1-class regression still has full teeth through `bridge_harness.mjs`.** So do D2,
RESIDUAL-1, A3 and R-158-A. The extraction is safe.

### 3b. Mutations that SURVIVED — coverage evidence, not vacuity

| # | Mutation | Result | Reading |
|---|---|---|---|
| M19 | `if (!_relaySuspended)` → `if (true)` in `routeFrame` | 56/56 still pass | Not a defect of this wave. `_relaySuspended` closes the ARM-side window, and `outgoingSenders` is already empty by the time it matters (the production comment says exactly this), so the window is unobservable through the fake wire. Pre-existing arm-suite nuance; `_163` changed zero assertions there. |
| **M29** | 30 s error-heartbeat branch `else if (now - lastErrorLoggedAt >= ERROR_LOG_INTERVAL_MS)` → `else if (false)` | **8/8 still pass** | **DEFECT D-165-1** — the heartbeat is entirely untested. `_161` G2 spec item 5 explicitly asked for it. See §5. |
| **M30** | `Recovered …(after N suppressed errors)` count tail → `''` | **8/8 still pass** | **DEFECT D-165-1** (same) — `errorsSinceLog` is never asserted anywhere. |

## 4. Per-file verdicts

| File | Tests | Verdict |
|---|---|---|
| `tests/helpers/bridge_harness.mjs` | (helper) | **SOUND.** Faithful extraction. `armedSocket` correctly exposed as a live getter, not destructured; console capture is reference-counted; `FakeWebSocketServer` deliberately omits the deferred `listening` emit with a documented reason; `setFetchImpl`/`waitMs` are backward-compatible additions. All five `_152`/`_158` falsifications re-pass through it (§3a). |
| `tests/bench_mirror_arm.test.js` (refactor) | 56 | **SOUND.** 56/56 in isolation, same names. Destructure at `:502–508` re-binds exactly the names the inline block declared; `observer` construction and `setObserver` preserve the original statement order. Zero assertions changed — confirmed by re-falsifying D1/D2/RESIDUAL-1/A3/R-158-A. |
| `sacn_bridge_arbitration.test.js` (G1) | 9 | **SOUND.** Highest-value file in the wave. Threshold/lockout read live from `common.yaml`; the D4-pin correctly discriminates on the browser BINARY broadcast rather than the relay send (the only observable that would move if the lockout were per-universe — an unrouted universe produces no send either way, so a `sends` assertion there would have been vacuous). The OVERRIDE test correctly filters the 5 s packet heartbeat out of its log match. 4/4 mutations killed. |
| `sacn_bridge_engine_poll.test.js` (G4) | 11 | **SOUND.** Full `_161` fidelity (all 8 spec items). Every transition assertion is a strict before/after delta, never `>= 1` — which is the correct discipline given the boot poll already fires one real transition. The re-entrancy test genuinely proves `_enginePollBusy` (M5). The catalog's "call the poll directly" instruction was impossible: **`server/sacn_bridge.js` contains zero `module.exports`** — verified. |
| `sacn_output_bridge_datapath.test.js` (G2) | 8 | **WEAK.** Six of seven spec items are sound and mutation-proven (M10/M11/M12). Spec item 5's second half — the 30 s heartbeat and `errorsSinceLog === N` — is **not implemented and not disclosed** (M29/M30 survive). Spec item 4's "zero acks" clause also dropped. See D-165-1. |
| `sacn_bridge_client_lifecycle.test.js` (G3) | 7 | **SOUND** (one narrowing). M23/M24 kill it hard. Spec item 1 asked the test to read test_bench's expected pairs off disk and assert they appear; the implementation asserts only `routes.length > 0`. Narrower than specced but not vacuous. |
| `sacn_input_frames.test.js` (G6) | 8 | **SOUND.** Full spec fidelity. The round-trip parity test plus the source guard on `Buffer.alloc(515)` / `writeUInt16LE(universe, 0)` / `writeUInt8(priority, 2)` — all three verified present in `sacn_bridge.js:2405–2407`. Static-host fold-in uses the correct signal (`window.location.protocol === 'https:'`, per `src/core/static_host.js`) and would fail loudly if a WebSocket were constructed. |
| `universe_router.test.js` (G5) | 10 | **SOUND.** All 9 spec items. Fake `performance.now` clock, strict boundary proven by M18. One tautological line: `assert.equal(frame[512], undefined)` cannot fail for any `Uint8Array(512)` — harmless, but it is decoration, not an assertion. |
| `sacn_bridge_shutdown.test.js` (G10.1/4) | 3 | **SOUND.** Grabbing `process.listeners('SIGINT')[1]` rather than `process.emit` is the right call (both bridges install handlers). M8 kills the latch test. |
| `sacn_bridge_shutdown_armed.test.js` (G10.2) | 4 | **SOUND.** Asserts `exitCalls.length === 0` synchronously *before* awaiting — the ordering claim has real teeth (M7 kills both tests). Exactly-3 zero frames per owned destination, plus a live gate-release probe. |
| `sacn_bridge_shutdown_blackout_race.test.js` (G10.3) | 2 | **SOUND.** Enters the race window via `disarmBenchMirror`'s synchronous prologue rather than the spec's manual-promise rig — simpler and equivalent. M9 kills it. |
| `sacn_bridge_boot_invariant.test.js` (G14) | 5 | **SOUND.** M13/M14 kill the two forks. Spec item 3's "assert the boot recompute ran exactly once" alternative was not taken; the invariant-violation branch (the spec's other option) was. The spec's open question — "does the harness ever emit `listening`?" — is answered by construction: `bridge_harness.mjs:285` emits it explicitly. |
| `sacn_output_client_frames.test.js` (G12) | 6 | **SOUND.** All 5 spec items + G15 static-host half. M15/M16 kill both pins. Decodes with the bridge's own reader shape, so it is a genuine round-trip mate of G2. |
| `load_ports.test.js` (G9) | 5 | **SOUND.** All 5 spec items including the `BM26_SIM_CONFIG` never-falls-back case, with env save/restore in `finally`. |
| `animate_output_wiring.test.js` (G11) | 5 | **SOUND for its class.** Source-text by design (the spec's own instruction). Correctly scopes every regex to the isolated sACN-output block so it cannot match elsewhere. M26/M27 kill it. Structurally weak — it cannot catch a semantic regression that preserves the text — but that is inherent to the technique, and the file header says so. |
| `scene_data_lint.test.js` (G8) | 21 + 1 todo | **SOUND for what it covers** (see §5 D-165-3 for the reduction). Leans on the already-unit-tested `readPatchDeclarations` and `isValidIp` rather than re-deriving them — correct discipline. The residue `test.todo` correctly fails today and is honestly surfaced, not suppressed. |
| `sacn_monitor_panel_pure.test.js` (G13) | 5 | **WEAK (sanctioned).** Option (a) of the spec's own two options. Pins literals only; M28 confirms the literals are pinned, but a behavioral change that keeps the text is invisible. The file header says to delete this file if option (b) ever lands — correct. |
| `save_server_endpoints.test.js` (G7) | 10 | **SOUND for what it covers** (see §5 D-165-2 for the reduction). Real server on a random free port and a `mkdtempSync` root; `childExited === null` is asserted after the hostile probes, so "the process never dies" is a real claim. M25 kills the P0-tension pin. |

## 5. Defects (ACCEPT-WITH-FIXES list)

**D-165-1 — G2's error ladder is half-implemented, and the reduction was not disclosed.**
`_161` G2 spec item 5 has four steps: first-failure log · suppressed repeats ·
**30 s heartbeat naming the suppressed count** · recovery. The file implements steps 1, 2
and a weakened 4. Mutation evidence: neutralizing the entire heartbeat branch
(`sacn_output_bridge.js:223–229`) leaves the file **8/8 green** (M29); blanking the
`(after N suppressed errors)` tail on the recovery line also leaves it 8/8 (M30).
`errorsSinceLog` is asserted nowhere. `_163`'s report lists G2 as "Implemented" with no
scope note. *Fix: add the `Date.now` monkeypatch step from the spec, or record the
reduction explicitly.* Non-blocking.

**D-165-2 — G15's port-guess half is missing, and the report says G15 was fully folded in.**
`_161` G15 has two halves. The static-host half is implemented in both G6 and G12 (and
mutation-proven). The second half — a **source-text `[D12-pin]` on the config-fetch port
fallbacks** — is implemented nowhere: `src/dmx/sacn_input_source.js:477` (`match ?
match[1] : '6971'`) and `:492` (catch → hardcoded `6971`), and
`src/dmx/sacn_output_client.js:221`/`:231` (the same shape on `6972`) are unpinned by any
test in the repo. `_163`'s gap table records G15 as "Folded into G6 + G12 **(as specced)**"
— that is an overstatement. *Fix: add the four literal pins.* Non-blocking, S-sized.

**D-165-3 — G8's stated blocker is overstated: `checkSceneModelParity` does NOT require a
loaded 3D model.** `_163` skipped the per-(scene, IP) DMX-overlap check because the real
rule "needs … for its strictest checks a loaded 3D model — most of the six non-gated
scenes are DMX-only stubs without one." Verified against source: `checkSceneModelParity`
takes `input.model` **optionally** (`lib/scene_model_parity.cjs:285` `input.model || {}`,
`:280` `modelPixels` defaults to `[]`), and the overlap rule
(`shared_universe_overlap`, `:1186–1194`) does not read `modelPixels`. The real
validator *could* have been invoked on the six scenes with findings filtered to that one
code — which is exactly the "don't write a second overlap algorithm" outcome `_163`
wanted. The underlying concern was right; the stated impossibility was not. *Fix: a
follow-up slice can implement this against the real validator as-is — no export change
needed.* Non-blocking.

**D-165-4 — G7's rationale contains an inaccurate sub-claim.** The `ENGINE_ROOT`
isolation gap itself is **confirmed** (see §6). But `_163` writes that it declined to
exercise the pattern endpoints because doing so "risked colliding with a concurrent test
run … not something to route around by writing to shared OS temp space anyway." In fact
`save-server.js:218` calls `writePatternManifest()` **unconditionally at boot**, so the
file already writes `<os.tmpdir()>/marsin_engine/patterns/manifest.json` on every run —
as does the pre-existing `save_server_hardening.test.js`. Directly observed:
`[SAVE SERVER] Regenerated C:\…\Temp\marsin_engine\patterns\manifest.json`. The
decision not to *delete* files there was still correct; the stated reasoning is not
accurate. Non-blocking; the fix is the report wording, plus the real hook fix in §6.

**Minor, no action required:** `universe_router.test.js:123` (`frame[512] === undefined`)
is a tautology for any `Uint8Array(512)`; `sacn_bridge_client_lifecycle.test.js` item 1
asserts `routes.length > 0` where the spec asked for the scene's expected pairs.

## 6. Production-bug verification (`_163` §4)

Each claim independently checked against source by `_165`.

| # | `_163`'s claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Priority-0 packet is arbitrated as an **OVERRIDE** on the live config (not "routed as low" as `_161` assumed) | **CONFIRMED — and `_161` was indeed wrong** | `sacn_bridge.js:1267` `packet.priority \|\| 100`; `:1277` `priority >= HIGH_PRIORITY`; `scenes/common.yaml:200-201` `sacn_high_priority.value: 100`. 100 ≥ 100. Worth adding: the slider's `min` is also **100**, so the operator cannot configure their way out below the default — only *above* it (raising it to e.g. 150 does defuse this specific case). |
| 2 | The high-priority lockout is **GLOBAL** across universes, not per-universe | **CONFIRMED** | `highPriorityActive` / `activeSource` are single module-level vars (`:1209–1210`); the drop branch `:1293` consults them with no universe key. Mutation M3 proves the test pins it. |
| 3 | Three more silent-remap conflations | **CONFIRMED ×3** | `sacn_bridge.js:1269` `packet.universe \|\| 1`; `sacn_input_source.js:428` `priority \|\| SACN_DEFAULT_PRIORITY` (=200, `:22`); `sacn_output_client.js:98` `priority \|\| DEFAULT_PRIORITY` (=100) and `:94` `parseInt(parts[i],10) \|\| 0`. All four are silent remaps to a *different valid value*, never a refusal. |
| 4 | The 15 s stale reap silently resets the E1.31 sequence when a pair resumes | **CONFIRMED (timing), PARTLY UNPROVEN (consequence)** | `sacn_output_bridge.js:45` `STALE_SENDER_MS = 15000`, `:123–132` sweep every 5000 ms → worst case 20 s; the test's 21 s wait is correct. The *sequence-reset consequence* is a property of the real `sacn` package's `Sender`, not of the fake, so the test pins **when the sender is destroyed and recreated**, which is the honest claim its comment makes. Not overstated. |
| 5 | `/save-cameras` with no `?scene=` silently targets/creates `scenes/titanic/` | **CONFIRMED** | `save-server.js:60–63` `(sceneName \|\| 'titanic')`. Empirically: the test's tmpRoot has no titanic and the endpoint returns 200 after creating one. **Note the blast radius is wider than `_163` says** — the same `\|\| 'titanic'` appears at `:56` (`scene_config`), `:66` (`pixel_map_views`) **and at `:242`, `:488`, `:532`** as `const backupScene = sceneName \|\| 'titanic'`, i.e. a scene-less write also files its **backup** under titanic. Five call sites, not two. |
| 6 | `SIM_SAVE_SERVER_ROOT` does not redirect `ENGINE_ROOT` | **CONFIRMED, with direct evidence** | `save-server.js:35–36`: `SIM_ROOT = process.env.SIM_SAVE_SERVER_ROOT \|\| …`, then `ENGINE_ROOT = path.join(SIM_ROOT, '..', 'marsin_engine')` — one level **above** the `mkdtempSync` dir, i.e. `<os.tmpdir()>/marsin_engine`, shared by every run on the machine. Observed live while reviewing: a standalone spawn logged `Regenerated C:\…\Temp\marsin_engine\patterns\manifest.json`. **This is a genuine new finding and the most actionable item in `_163`'s list.** |
| 7 | `simulation/scenes/summer_camp_dome/patches.yaml.original` residue | **CONFIRMED** | Present today; the `test.todo` fires with the exact path. Operator action: delete or archive — `robocopy /MIR` ships everything under `scenes/`. |
| — | `_163`'s side note: `/delete-pattern` is safe by construction | **CONFIRMED** | `save-server.js:594` `name.replace(/[^a-z0-9_-]/gi, '_')` replaces `.`, `/` **and** `\`, so `../sentinel` → `___sentinel.js` in the same directory. Traversal is structurally impossible. (Unstated side effect: distinct names can collide after sanitizing — a data-loss nuance, not a security one.) |

**Zero claims wrong. Two understated (#1's config floor, #5's five call sites), one
usefully precise about its own limits (#4).**

## 7. Spec-fidelity table (`_161` → `_163`)

| Gap | Spec items | Implemented | Fidelity |
|---|---|---|---|
| G1 arbitration | 8 | 8 | **Full**, plus a documented + independently verified correction to the spec's own priority-0 example |
| G2 output datapath | 7 | 6.5 | **Reduced, undisclosed** — item 5's heartbeat + `errorsSinceLog` missing (D-165-1); item 4's "zero acks" clause dropped |
| G3 client lifecycle | 6 | 6 | **Full**, item 1 narrowed (`routes.length > 0` vs the scene's expected pairs) |
| G4 engine poll | 8 | 8 | **Full.** The spec's "call the poll directly" is impossible — zero `module.exports` in `sacn_bridge.js`, verified |
| G5 router/buffer | 9 | 9 | **Full** |
| G6 input frames (+G15a) | 6 | 6 | **Full** |
| G7 save-server | 5 | 3.5 | **Reduced, disclosed.** Pattern endpoints legitimately blocked (§6 #6); rationale wording inaccurate (D-165-4) |
| G8 scene lint | 6 | 4 | **Reduced, disclosed.** Item 6 correctly deferred to `_162`. Item 3's blocker overstated (D-165-3) |
| G9 load_ports | 5 | 5 | **Full** |
| G10 shutdown | 4 | 4 | **Full** |
| G11 animate wiring | 5 | 5 | **Full** (source-text, as specced) |
| G12 output client (+G15a) | 5 | 5 | **Full** |
| G13 monitor panel | option (a) or (b) | (a) | **Sanctioned weak** — the spec offered (a) explicitly |
| G14 boot invariant | 3 | 3 | **Full** (took the spec's second option for item 3) |
| G15 static host + port guess | 2 halves | 1 | **Reduced, undisclosed** (D-165-2) |
| G16 sidecar dedup | — | skipped | **Blocker real.** `SIM_ROOT = path.join(__dirname,'..')` (`sacn_bridge.js:23`) with no env hook; `readBenchMirrorSpecs` unexported. The spec's weak fallback (log-count on the LIVE tree) would have been genuinely vacuous — `warnOnce` never fires on a valid tree — so skipping beat writing a zero-teeth test. **Skip endorsed.** |

## 8. PIN discipline

Every characterization pin names its defect ID, cites `_157`, and states the post-fix
expectation. Checked one by one:

| Pin | Names defect | Cites report | States post-fix expectation | Name blesses the bug? |
|---|---|---|---|---|
| G1 universe-0 | `[D12-pin]` | `_157` D12 | "a named refusal, not a silent remap" | No — "**not refused**" |
| G1 priority-0 | `[D12-pin]` | `_157` D12 | "preserved as 0 … or refused, but never promoted" | No — names it a defect in the title |
| G1 D4 lockout | `[D4-pin]` | `_157` D4 | "when D4's per-universe scoping lands this flips to routed" | No |
| G2 stale reap | D9 ref | `_161` D9 | "the fix plan owns whether it should" | No |
| G2 malformed | characterization | documented legacy contract `:164–169` | — | No |
| G5 per-patch mode | characterization | — | "must be rewritten, not silently deleted" | No |
| G6 priority-0 | `[D12-pin]` | `_157` D12 | "the post-fix expectation is a preserved 0" | No |
| G12 priority-0 | `[D12-pin]` | `_157` D12 | "the post-fix expectation is a preserved 0" | No |
| G12 IP coercion | characterization | fail-loud-rule candidate | "not blessed behavior" | No |
| G13 priority `'—'` | `[D12-pin]` | `_157` D12 | — | No |
| G7 save-cameras | `[P0-tension]` | fix-plan candidate | "so a fix changes this assertion" | No |
| G11 `priority: 150` | tripwire | `_157` D2 | "a re-review trigger" | No |

**Twelve pins, zero blessings.** Every test NAME either states the defect
("is inflated to 200, **not preserved as 0**", "a typo'd IP octet is **silently** coerced
… **not a refusal**") or is explicitly labelled a characterization. This is the strongest
part of the wave — pin discipline is exactly right. One small inconsistency: G2's stale-reap
comment cites the D9 finding to report `20260805_161`; D9 originates in `_157`.

## 9. Not defects (checked and cleared)

- **No try/catch swallows an assertion.** All four `try {` blocks in the wave are
  `try/finally` restores (console capture, `globalThis.WebSocket`, `BM26_SIM_CONFIG`).
- **No `assert.ok(<bare object>)` / truthy-on-object assertions.**
- **No missing `await` before an assertion** — every async action is awaited or explicitly
  raced on purpose (and where the race is the point, e.g. the blackout-race file, the
  synchronous pre-await assertion IS the claim, and M9 proves it).
- **No assertion on a value the test itself told the mock to produce.** The engine-status
  stub is the closest call; the assertions are on the bridge's *derived* logs and route
  sets, never on the stub's own fields.
- **Order-dependence is deliberate and documented** in the three files that have it (G1,
  G3, G4), and matches the pre-existing arm-suite idiom.
- **No new file binds a port, sends a packet, or spawns onto an operator port.** G7's
  server takes a kernel-assigned free port; everything else is `Module._load`-faked.

## 10. Verdict

**ACCEPT-WITH-FIXES.**

The operator's stated distrust of Sonnet work is not borne out here. Thirty independent
mutations, including three re-falsifications of the `_152`/`_158` hardened regressions
through the newly extracted harness, all killed exactly the intended tests. Suite counts,
failing names, and the security baseline reproduce byte-for-byte. Pin discipline is clean
across all twelve characterizations. Nothing is BROKEN-RED and nothing blocks.

Fix list (all non-blocking, all test-code or report-wording):

1. **D-165-1** — implement `_161` G2 spec item 5's heartbeat + `errorsSinceLog` assertions,
   or record the reduction. (S)
2. **D-165-2** — add the four missing G15 port-guess `[D12-pin]` source-text pins. (S)
3. **D-165-3** — G8's overlap check is implementable today against the real
   `checkSceneModelParity` (`model` is optional); reopen as a follow-up slice. (M)
4. **D-165-4** — correct `_163`'s G7 rationale wording; the boot-time
   `writePatternManifest()` already writes to shared OS temp on every run.

Highest-value item for the operator's fix wave, from §6: **the `SIM_SAVE_SERVER_ROOT` →
`ENGINE_ROOT` isolation gap** (`save-server.js:35–36`) — a one-line production fix that
unblocks the whole pattern-endpoint test surface and stops every save-server test run from
writing into shared OS temp space. Second: **`/save-cameras`'s `\|\| 'titanic'`** is at
**five** call sites, not two — the backup path files under titanic too.

This slice is test coverage only and does not move the standing **NOT SHIP** verdict.
