---
name: bm26_show_readiness
status: active
owner: Sina (lead artist) — coordinator agent acts as readiness manager
created: 2026-07-27
updated: 2026-07-31
---

# BM26 Show Readiness — Master Program

**This is the make-or-break doc.** Sina is the lead artist; the interface
agent is the readiness manager reporting to him. Goal: a **successful,
somewhat-autonomous art fixture** on playa — ambient by default, alive at
party moments, never stuck.

> **RULE (operator, 2026-07-27): this is THE master doc, and every agent
> maintains it.** Any agent that lands, parks, blocks, or reverses work
> touching a workstream below MUST update the affected row, the Open
> decisions, and the Log in the SAME session — before reporting done.
> Coordinator enforces; a completion message without the doc update is
> not done. Keep rows tight (state + next action + owner); evidence and
> detail belong in the linked reports, not here.

Sub-project dossiers link from here; this doc tracks the PROGRAM. Ops
detail per thread lives in `../memory/bm_readiness_thread_tracker.md`
(**canonical, most-current state**).

**Compacted end-of-day 2026-07-30 on operator order.** Everything removed —
the long workstream row bodies, the slice-by-slice `_58` wave narrative, the
resolved waiting items, the mapping-support wave block, the full dated Log —
moved **verbatim** to the archive report
[`../reports/202607/20260725_88_master_doc_archive.md`](../reports/202607/20260725_88_master_doc_archive.md)
(`_88`). Section pointers below name the archive section.

## Threads — what's going on right now (2026-07-31)

> Operator-requested quick-glance board. The coordinator maintains it
> on every launch/landing/ruling; one line per thread, detail in the
> Status snapshot below + the tracker + the linked reports.

> **MILESTONE (operator, 2026-07-31): the titanic is FULLY MAPPED, the
> sim works, and the 2D vis is pattern-check ready.** 🎉
> **And the ChatGPT pattern-tuning loop is LIVE** — the operator has
> started ChatGPT with the `_90` prompt, creating views and tuning
> patterns himself. Agents keep hands off `marsin_engine/patterns/**`
> unless he hands a specific pattern over.

**🔄 IN FLIGHT:**

| # | Thread | Agent | State |
|---|---|---|---|
| — | **Timeline & show planning** — the night arc, phase looks, playlist curation across the 78 patterns / 13 playlists / `playa_default` timeline | Coordinator + operator (interactive) | STARTED 2026-07-31 — operator's declared focus: "let's you and me focus on timeline and planning and having fun with that" |

**✅ LANDED 2026-07-31:**

| # | Thread | Agent | State |
|---|---|---|---|
| `_120` | **WAVE 1 W1-1 follow-up — L5 strict save-now** (the `_116` fix-7 handoff, in the shared engine core outside W1-1's 3-file lane). Owns ONLY `lib/state_manager.js` `save`/strict-path + the `saveMixerState`/`saveDeckState`/`saveGlobalsState` signatures + the save-now call site in `api_server.js` | Opus | **LANDED** — `20260725_120_wave1_strict_save_now.md`. **Root confirmed:** `StateManager.save()` swallowed the atomic-write error (warn-only), so `POST /settings/save-now`'s deck/mixer/globals branch reported a lying 200 `{saved:true}` on a failed write (CaptainPad "✓ SAVED" badge, `_115` L5). **Fix — STRICT/BEST-EFFORT split:** `save()` gains `{ strict=false }` (default warn-only unchanged; `strict:true` re-throws); the three save methods thread it; `saveAllState(strict=false)`/`saveGlobals(withParams,strict=false)` thread it; save-now calls `saveAllState(true)`+`saveGlobals(true,true)` so its (W1-1) try/catch catches a real throw → honest 500 `{saved:false,error}`. **The ~80 AUTO-SAVE triggers pass nothing → best-effort, byte-UNCHANGED** (a transient disk blip never reaches W1-1's `exit(1)` backstop → no dark ship). **The L5 lie is now an honest non-200.** **GATES:** full engine **2524/8** = the SAME known environmental baseline (audio-capture framing, OSC lifecycle/EADDRINUSE, effects_v2 layout, specialty-playlist parity — **none touch `state_manager.js`/save paths; zero new failures**). +8 new tests all GREEN: `tests/state/strict_save.test.js` (7, strict/best-effort seam) + `tests/e2e/save_now_honesty_e2e.test.js` (1, real engine: save-now→non-200 on a broken dir while a `/global-blackout` auto-save over the SAME dir stays 200 + engine survives; timeline disabled to isolate; imports `setup_config_guard.mjs`). `config.yaml` CLEAN vs HEAD; spawned engine black-holed via `MARSIN_CONFIG_FILE`, state via `MARSIN_STATE_DIR`; zero device HTTP, zero sACN, operator stack untouched; no git ops |
| `_116` | **WAVE 1 W1-1 — engine HTTP/WS/timeline crash-proofing** (Family A CRITICAL `_108` + `_109`; J1/J2 `_113`; I3 `_112`; L2/L5 `_115`). Owns ONLY `engine.js` + `lib/api_server.js` + `lib/timeline/*.js` (+ `lib/autopilot_pick.js` for I3) | Opus | **LANDED** — `20260725_116_wave1_engine_hardening.md`. **7 fixes, each a red-team repro flipped to a GREEN committed test.** **CRITICAL (`_108`) — malformed WS frame kills the engine:** classified non-fatal per-CONNECTION `ws.on('error')` in the upgrade router covers all four `/ws/*` topics + the `/` alias (the `_99` shape). **Process backstops (`_108`/`_109`):** module-scope `uncaughtException`/`unhandledRejection` in `engine.js` → log NAMED + `exit(1)` (never half-alive; W1-2 watchdog restarts the clean non-75 exit). **J1 (`_113`, P0) — `/timeline/overview` 296 s freeze:** Intl formatters cached per tz, per-day `dayTimes` injected into the per-sample resolver, + a per-(plan,day) memo on `getOverview` → 500 cues × 8 days now **~347 ms (~850×)**. **J2/L3 (`_113`+`_115`, P0, 2×-confirmed) — corrupt state silently dead:** `loadTimelineState` validates the ENTIRE persisted shape (maps+values, numerics, `mode` enum, non-object doc), THROWS naming file+field → `start()` refuses to half-run. **I3 (`_112`, P1) — non-compiling entry wedges the sequential autopilot:** picker excludes `_broken` + de-dupes ids; all three advance sites flag a deterministic compile failure + skip it (loud, cleared on clean load). **L2 (`_115`, P1) — backward wall-clock step strands the party cue:** clamp future-dated `moodSince`/`moodLastFire` to `now` → self-healing re-arm. **L5 (`_115`, P1) — failed write returns 200 {saved:true}:** timeline-state writes already throw (honest); `POST /settings/save-now` wrapped → honest 500. **HANDOFF/spawn_task:** `StateManager.save()` (`lib/state_manager.js`, shared core OUTSIDE the lane) swallows the atomic-write error → deck/mixer/globals save-now can still lie; a STRICT explicit-save path is the follow-up. **W1-3 handoff WIRED:** `/timeline/state` now carries `renderHealth` (`mixer.getNeverBlackHealth()`, guarded/additive). **W1-2 handoff:** `/status`+`/timeline/state` now report HONEST health (a corrupt-state timeline refuses to start; a clean `exit(1)` is the restart signal). **GATES:** timeline family **410/410**; full engine **2520/8** = the known environmental baseline (audio no-device, osc EADDRINUSE, mixer view-fader, pattern/scene parity, effects layout — **none import a W1-1 module; zero new failures**). New tests: `tests/e2e/ws_frame_crashproof.test.js` + 5 `tests/timeline/*` (clock_backstep_clamp, timeline_state_validation, autopilot_broken_entry, overview_perf, save_write_honesty). `config.yaml` CLEAN vs HEAD; every spawned engine black-holed via `MARSIN_CONFIG_FILE`; zero device HTTP, zero sACN, operator stack untouched; no git ops |
| `_118` | **WAVE 1 W1-3 — pattern-VM "never black" enforcement + `_90` audit-harness hardening** (Family I `_112` I1/I2/I4). Owns ONLY `lib/pattern_mixer.js` + `tools/pattern_audio_harness.mjs` | Opus | **LANDED** — `20260725_118_wave1_pattern_never_black.md`. Protects the LIVE ChatGPT loop. **The never-black model:** the vendored WASM absorbs a NaN (I1: any one arg to `rgbwau()`/`hsv()` blacks the whole pixel, absorbing in persistent state) or a `beforeRender` budget overrun (I2: truncates silently, palette never resolves → black ship) into a black composite with no signal, and the NaN is already `0` by the time JS sees a byte — so enforcement is on the CONSEQUENCE. **New runtime R4 enforcer in `renderAll6ch()`** (the exact buffer engine.js emits): counts consecutive fully-black-while-lit frames — gated by `_isExpectingLight()` so a legit operator blackout (master 0 / faders down / muted) is never flagged — and at 8 frames (0.2 s) LOUDLY trips `renderHealth` (naming the deck pattern) AND writes a dim last-resort floor (10/255) so the ship is never shipped dark without `/status.renderHealth.ok=false`; auto-recovers when light returns. Also a solid-red detector (`_112` F9 VM over-budget). **VERIFIED end-to-end through the REAL WASM** (`never_black_vm_e2e.test.mjs`): NaN-arg, absorbing-NaN, and beforeRender-overrun all compile CLEAN and trip; healthy stays green. **I2 finding (honest):** `marsin_begin_frame` is compiled `void` (confirmed: `number` binding → `undefined`; no error set) and there's no C source to re-vendor, so a truncation return channel is impossible — the mission-critical black outcome is caught by the enforcer; a wrong-but-non-black truncation is caught only offline by the harness. **I4 — the harness can now FAIL:** `--gate` mode exits 3 with a NAMED reason on DARK (fully/mostly black — fails `evil_black`), BLACK_LATCH (renders a 600-frame window past the clip — fails the `evil_sleeper` post-window latch), and OVER_BUDGET (MEAN VM frame time > budget/mix-channels, default 25/4=6.25 ms). Verdict always PRINTS; only `--gate` changes the exit code (clip/gif tooling unaffected). **Shipped patterns stay green** on titanic (worst `26_dom_dancers_chevron` mean 4.56 ms → GATE_PASS). **Operator: add `--gate` to the `_90` recipe's two harness runs.** **Suite:** +16 new green tests (7 enforcer + 4 real-VM e2e + 5 harness-gate); **zero new failures from this thread** (full run 2520/2510/10 = the 8 known baseline + 2 sibling `tests/timeline/overview_perf.test.js` J1 perf tests that PASS in isolation and are uncoupled to this work). `config.yaml` + `patterns/` CLEAN; no `engine.js`/`api_server.js`/`timeline/*`/`simulation/`/`scenes/**` touched; zero device HTTP, zero sACN. **HANDOFF to W1-1:** never-black is ALREADY on `/status` (getRenderHealth folds `darkness` into `ok`, no engine edit needed); a standalone `mixer.getNeverBlackHealth()` `{lit,black,blackStreak,tripped,floorActive,solidRed,pattern,sinceFrame,message}` is provided for `/timeline/state` + the launcher watchdog |
| `_117` | **WAVE 1 W1-2 — launcher supervision & watchdog** (Family A capstone `_115` L1/P0 + L4/L6/P2-6). Owns ONLY `simulation/start.js` + `launcher.js` | Opus | **LANDED** — `20260725_117_wave1_launcher_watchdog.md`. **The `_115` L1 dark-ship-green-dashboard gap is CLOSED.** `start.js` is now a real SUPERVISOR: every child's DEATH (crash/`kill -9`) and FREEZE (alive-but-unresponsive, 3 missed health probes) is detected → bounded restart (5/60 s) → **loud escalation** (`exit(1)` so the launcher tears down + the show-server supervisor relaunches) rather than an endless restart-loop fallback. `launcher.js status` now health-probes **EVERY child** (save :6970, sACN-in :6971, sACN-out :6972 — the two `ws` bridges via a 426-aware, census-neutral GET — not just :6969/:6968) and reads the input bridge's `packets/5s` surface for **frame-flow**, so a dark/wedged server turns the dashboard **RED** and "green" means frames are actually flowing. **L4:** `checkPortFree` now bind-probes BOTH families (IPv4 `0.0.0.0` + IPv6 `::`) — the IPv4-only-squatter shadowing is caught (repro'd, then fixed). **L6:** `validate()` now runs BEFORE the destructive `assertSingleInstance()`/`-f` takeover, so a scene typo no longer kills the show first. **P2-6:** new **`BM26_SIM_CONFIG`** override (fail-loud, same contract as `MARSIN_CONFIG_FILE`) points the whole constellation — launcher + start.js + save-server + both bridges (via `load_ports.cjs`) — at throwaway ports; `main()`/boot guarded behind `require.main` + pure helpers exported for tests. **Suite: baseline 1645/8 fail → 1663/8 fail — +6 new W1-2 tests, ZERO new failures** (same 8 known stale-model/scene-drift/compression). Live-proven: killed a child under the watchdog → detected+restarted (fresh pid); killed sACN-out → `status` line went **❌ not green**; frame-flow warned of a dark rig. Ran entirely on 786x/787x + UDP 7568; operator :6969-:6972 byte-identical (same PIDs), throwaway orphans swept, `config.yaml`/`scenes/**`/engine untouched. **Wants (flagged, not built): a census-neutral `/health` on both bridges + a frame/output indicator on W1-1's engine `/status` for continuous frame-flow supervision** |
| `_119` | **WAVE 1 W1-4 — sim save-server & controller-probe crash-proofing + save honesty** (Family A `_109` P1-1/P1-3, Family F `_115` L5). Owns ONLY `simulation/server/save-server.js` + `controller_probe_service.cjs` | Opus | **LANDED** — `20260725_119_wave1_saveserver_hardening.md`. **The `_109` P1-1 process-kill is CLOSED and the crash is now SURVIVED** (proven end-to-end: real save-server on a random high port, the exact `timeoutMs:-1` request answers a loud **400** and the process stays alive + fully functional). **Four fixes:** (1) P1-1 — probe route now VALIDATES `timeoutMs` (finite, `>0`, `≤60 s`) → 400, and `tcpProbe` registers `socket.on('error')` BEFORE `setTimeout` (the throw that used to escape a listener-less connecting socket is caught → honest UNKNOWN); plus process-level `uncaughtException`/`unhandledRejection` backstops that log NAMED and exit (no half-alive run — supervision is W1-2's job). (2) P1-3 — the "1.2 s ceiling" was an IDLE timeout a slow-drip host held 10.4 s; added an ABSOLUTE per-probe deadline (TCP + HTTP) so one slow host can't wedge the pool, plus a 256 KB response cap. (3) L5 save-honesty — every save-server write path now surfaces a NAMED non-200 on failure (was bare `Error`); proven a failed disk write answers `500 Error: …`, never `200 Saved`. (4) endpoint hardening — 1 MB body cap (413), non-object body (incl. the `null`→TypeError→kill vector) rejected 400, garbage body 400. **Suite: baseline 1645/8 fail → 1657/8 fail — +12 new green tests, ZERO new failures** (`save_server_hardening.test.js` spawns the real server on a throwaway `~/tmp` root; probe module tests for the crash-proofing, absolute deadline, overflow cap). Repro `~/tmp/redteam_controller/04_probe_crash_repro.mjs` (all green). **Test-only env hooks `SIM_SAVE_SERVER_PORT`/`SIM_SAVE_SERVER_ROOT` default to production paths when unset** (explicit config, not a fallback). Zero device HTTP (loopback + RFC 5737 `192.0.2.x` only), zero sACN, operator :6970/:6967/:6969-72 never touched; `marsin_engine/config.yaml` CLEAN |
| `_113` | **Red-team: timeline REVIEW/ZOOM machinery** — the day ribbon + `/timeline/overview`, `resolveDeckStateAt`, travel/resolve targeting, `validateShowPlan`/`lintShowPlan`, and `loadTimelineState`; adversarial hunt for stuck shows, silent coercion and review-surface lies | Opus (red-team) | **LANDED (report-only)** — `20260725_113_redteam_timeline_ribbon_state.md`. **2 P0, 2 P1, 3 P2, 5 P3. Zero source edits, zero suite edits, zero `scenes/**` writes; every spawned engine black-holed and ASSERTED (3 walls), port 7717 only, zero device HTTP; `config.yaml` CLEAN vs HEAD; timeline family 410/410 before AND after.** Deliberately complementary to `_103` (triggers/arbiter/party) and `_104` (pad zoom state machine) — it attacks the ribbon/overview cost, the state-file loader, the resolver-vs-tick divergence and target/plan input validation, and it **narrows two of `_103`'s "safe" verdicts**. **P0-F1 (stuck/DARK show): `GET`+`POST /timeline/overview` build the day ribbon SYNCHRONOUSLY on the HTTP thread in O(days × cues²)** — `buildDaySegments` calls `resolveDeckStateAt` per sample point and each call re-runs `resolveDayTimes` over the WHOLE cue list, constructing 2 `Intl.DateTimeFormat` per clock cue. Measured on a real engine: 64 cues × 8 days = **2.8 s frozen**, 128 = **11.4 s** (concurrent `GET /status` ECONNRESET), 256 = **58 s**, **512 (the schema's own cap) = 296 s** — render loop, sACN out and the timeline tick all dead, process still "alive" so no supervisor restart. One unauthenticated POST of an UNSAVED draft is enough. The 512 cap predates the ribbon (`show_plan.js:799` cites "a 10k-cue POST froze /status ~32s" — the ribbon makes 512 cost 9× that). **P0-F2 (silent dead timeline): `loadTimelineState` validates ONLY the 5 party fields** — a corrupted `firedToday: yes` / `moodArmed: 5` / a scalar document loads clean and then throws at boot or on EVERY tick (`Cannot create property 'c_x' on string 'yes'`), so the whole plan drives nothing all night while the engine looks healthy: the exact D11 failure mode the party guard exists to stop, on the fields it doesn't cover. **P1-F3: two cues at the SAME fire time — the resolver (ribbon, `/resolve`, `/travel`, boot `_catchUp`) picks the FIRST in plan order (`resolve_deck_state.js:152`, strict `>`), the live tick applies in order so the deck ends on the LAST** → the review surface built to be honest and a running engine disagree about the same instant, and rebooting flips the deck. Sharpens `_103` L3. **P1-F4: `hold.min` has no upper bound** — `{min: 1e12}` (or a fat-fingered `9000` = 6¼ days) passes validation and the program owns the deck for the rest of the festival, suppressing every later cue; `{min: .inf}` also passes and serialises to `untilMs: null`, indistinguishable on the wire from an open hold. **P2: `/timeline/travel` + `/timeline/resolve` shape-check the target date with a bare regex and never round-trip it — `2026-07-00` → 200, silently resolved as `2026-06-30`, impossible date echoed back (`assertDate` does this right 30 lines away); `validateNoOverlap` keys windows by festival-day INDEX so a `durationMin` window that CROSSES MIDNIGHT is never compared to the next day's cues (narrows `_103`'s "overlaps rejected at load"); nothing validates that a look's playlist/palette EXISTS — save 200, activate 200, `planWarnings: []`, and it only surfaces as a `cueErrors` entry at fire time (narrows `_103`'s "missing playlists fail loud").** **P3: the ribbon draws a 23 h/25 h DST day as `00:00→24:00` (tiling correct, scale ~4 % off); `sun.offsetMin` unbounded (a cue can fire on a different calendar day than the ribbon draws it); `_assertPlanName` accepts a 500-char name; `resume()` loses a same-instant race with `takeover` (self-heals at lease expiry); `mode` in the state file is never checked against {armed, overridden} (`mode: banana` and a truncated `mode: arm` both run and go out on the wire).** **What HELD:** no prototype pollution (`__proto__`/`constructor` rejected by `assertSlug`); the 512-cue cap and the 1 MB body cap enforced; a real `SIGTERM` mid-zoom at BOTH scopes wakes `armed`/`zoom:null` (boot scrub works — and re-confirms `_100` F1 / `_104` A2 that the lease bytes ARE on disk); stepping past the plan edges 400s and never clamps; polar sun safe; 33 of 43 hostile plan mutants produced a NAMED error; a 12× concurrent travel‖perform‖savePlan‖activity storm left `mode: armed`, `zoom: null`, `lastError: null`. Coordinator: F1 first (memoise `dayTimes` per day + cache the `Intl` objects in `clockToEpochMs` — either alone is ~100×; then a perf regression test with a stated budget), then F2 (extend the D11 guard to the whole persisted shape) |
| `_111` | **Red-team sweep SYNTHESIS** — consolidates the 8 adversary reports (`_103`–`_110`) | Coordinator | **LANDED** — `20260725_111_redteam_synthesis.md`. **1 CRITICAL** (malformed WS frame → dark ship, no restart), ~15 HIGH/P1, clustered into **7 families**. Engine cores HELD. **Fix plan: 3 waves, all operator-gated, none launched.** W1 = dark-ship hardening (launch first). `_109`/`_110` were UNCOMMISSIONED adversaries (verified safe, flagged). Coordinator cleared the `_105` report-IP commit blocker |
| `_107` | **Red-team: fixture / model / patch layer** — adversarial hunt across LED-vs-DMX classification, the exporter, `scene_model_parity`, orphan detection, the TE-sign RGBW generator, and the 2D pixel-map view defaults | Opus (red-team) | **LANDED (report-only)** — `20260725_107_redteam_fixtures.md`. **2 HIGH, 2 MED, 2 LOW; no CRITICAL. Zero source edits; zero writes to `scenes/**`/`models/**`/`dmx/fixtures/**`** (generator run `--dry-run` only, parity gate read-only, mutate-and-check used fabricated inputs to the pure parity lib; harnesses in `~/tmp/redteam_fixtures/`). **Both HIGHs live in the parity gate's LED lane, blind to two silent classes its DMX lane already catches. HIGH-1 (silent-mispatch, the `_92` RGB↔RGBW class RE-OPENED): an RGBW TE sign chained on a MarsinLED output configured `order: RGB` exports stride-3, white-less pixels and passes `--strict` CLEAN** — parity discards the LED-bus fixture definition's declared physical format (`channels: ledBus ? undefined`, no `channel_mode` cross-check) and trusts the controller order as sole truth, so it only fires when model & controller DISAGREE (control run: RGBW→0 err, RGB self-consistent→0 err, RGB-vs-stride4-model→2 err). **HIGH-2 (silent-DARK, `_92` patched-but-unroutable): a strand/LED-bus fixture chained on an UNBOUND LED controller (no `device:` block) with a stale patched record+model passes `--strict` clean** — parity never reads `controller.device`, has no LED analogue of DMX's `patch_record_disagrees_with_chains`, and a fresh export would drop the record and render the rope DARK. **MED-1: `checkAddressHygiene` models an LED-bus fixture as one `def.footprint` DMX block (ignores `record.segments`)** — a spilling LED-bus fixture false-positives `patch_address_out_of_range` while `checkLedStrandPatch` validates the same walk as correct, and its spill-universe occupancy is never claimed (real collision there missed); harmless for the 160/136-ch single-universe signs, latent for the extensible LED-bus kind. **MED-2: parity `ledStride()` accepts a sub-minimum stride the sim's `normalizeLedConfig` hard-throws on** → misleading `strand_stride_mismatch` on a config that never boots. LOW: te_sign `SHARED_PANEL` msg repeats per occurrence + panel-reappearance role mislabel (comment-only); LED-bus footprint never cross-checked (root hook for HIGH-1). **What HELD:** `gen_te_sign_fixture.js` (every malformed CSV fails loud; all-same-coord caught before the NaN normalization path → divide-by-zero unreachable); `orphan_fixtures.js` (strict `=== true`, ownership `groupName\|\|name`, throws on unreadable lists, no guessing); parity's DMX lane + pure re-statement; the `_48` name-drift + `TE Sign 2` swallow (covered by `pixel_map_view_defaults.test.js`, but only for SHIPPED defaults, not a persisted `pixel_map_views.yaml`). Coordinator: HIGH-2 first (one fix — re-derive LED binding grade + an LED `patch_record_disagrees_with_chains` — closes the silent-dark rope class the gate exists to prevent) |
| `_108` | **Red-team: engine HTTP/WS API contract + CaptainPad client** — adversarial hunt for engine-wedging crashes, unhandled rejections, contract lies, enum drift, write races, reconnection storms | Opus (red-team) | **LANDED (report-only)** — `20260725_108_redteam_api.md`. **1 CRITICAL, 1 MED, 4 LOW. No source touched; every engine black-holed (asserted); zero device HTTP, zero sACN to hardware; operator stack untouched; `config.yaml` CLEAN.** **CRITICAL (engine-crash, the `_99` sibling): a single malformed WebSocket frame kills the whole engine.** None of the four `/ws/*` servers (nor the `/` alias) attaches a per-connection `ws.on('error')`, so an invalid-UTF-8 text frame (or reserved opcode / oversize control frame / bad close code) makes `ws` emit `'error'` on the socket instance with no listener → uncaught throw → `process.exit`. Proven live on `/ws/control` AND `/ws/params`; no malice needed (a flaky WiFi-corrupted frame does it). **Blast radius = dark ship with no self-heal:** `launcher.js:623` does NOT restart a crashed engine — it logs "exited unexpectedly … Tearing down" and `teardown(1)`s the whole stack. **MED (enum-drift): the `effectiveState` enum is a hard engine↔pad coupling** — `parsePartyConfig` throws on any value outside the 6 known; no live drift today (producer closed to 6; all 3 pad consumers wrap the throw so no crash) but a future 7th engine state puts every older pad's PARTY card into a permanent error banner on a healthy engine. **LOW: `POST /timeline/takeover` coerces a non-object body (null/number/string/array/bool) into a silent plain takeover (200) not 400** (fallback shape); concurrent `takeover(perform)`+`travel` both return 200 (last-writer, momentary response lie, broadcast reconciles); `/timeline/resolve` over-long query → 431 empty body (non-JSON); `/timeline/resolve` matches by `startsWith`. **What HELD (the hardening works):** the entire REST surface — hundreds of malformed/OOR/unicode/traversal/`__proto__`/huge payloads → clean verbatim 400s, no 500 on input, no unhandled rejection, no silent clamp; `festival.days` bounded [1,31]; WS message handler try/caught; reconnection storm survived. Coordinator: fix #1 is the per-socket `ws.on('error')` (+ a per-topic frame-violation regression test). |
| `_106` | **Red-team: controller lifecycle / provisional / status / push** — adversarial hunt for promotion corruption, reconcile side-picks, status lies, push half-states | Opus (red-team) | **LANDED (report-only)** — `20260725_106_redteam_controller.md`. **2 HIGH, 3 MED, 3 LOW; no CRITICAL. No source touched; NO device HTTP, NO sACN to hardware, NO scene writes** (pure repros in `~/tmp/redteam_controller/` against the real modules with injected transports; operator stack untouched). **HIGH-1 (promotion-corruption): the `ip_mismatch` reconcile guard is DEAD CODE on the provisional lifecycle** — provisional cards match by IP only, and every promote path builds `device.ip` FROM `controller.ip`, so the guard its own doc says protects against "a board found at a different IP than typed" can never fire. A one-digit IP typo (or a DHCP reshuffle) makes the card AUTO-VERIFY against whatever MarsinLED answers at that address; the only catch is an OPTIONAL boardId/deviceName expectation. **HIGH-2 (quirk→corruption): the default-ON auto status-sweep re-raises the reconcile dialog every ~20 s** for an online-but-contradicted provisional card (no "dialog already open" de-dup) → dialogs stack unbounded, and once the operator resolves one the stale dialogs' "Promote anyway" calls `promoteProvisionalBinding` on a now-verified card and THROWS uncaught inside `ctx.mutate`. **MED-1 (status-lie / push-half-state): a push whose scene-SAVE fails/cancels settles the DURABLE sync chip to a GREEN "In sync"** (stale-feed warning tooltip-only), and the next `refreshSyncChips` recompute (device≡plan → bare `{state:'in-sync'}`) drops even that — disk stale, LEDs dark, every surface green (the exact _58/_60 shape). **MED-2: first contact promotes off a CACHED fingerprint** (probe cache key `type:ip`, 5 s TTL, stores `device`; auto-sweep is `force:false`) → a same-IP hot-swap binds the card to the PREVIOUS board. **MED-3: ECONNREFUSED/RST is always ONLINE** — a reject-firewall, any other host, or a DHCP squatter reads green ONLINE while a drop-firewall on the identical dead box reads OFFLINE; LED partial-200 + `unrecognized` hosts share the same green dot. **LOW: `reconcileProvisionalContact` silently skips the `controller_id_claimed` hard blocker when `registry` is omitted** (`checkedClaims:false`); the push notifies the bridge TWICE (exportConfig loud + push quiet); the 1.2 s status deadline flaps cold boards (discovery budget is 6.5-8 s). **What HELD:** two provisionals at one IP (2nd correctly hard-blocks `controller_id_claimed`), partial-answer refusal (no promote off a half `/api/status`), lost-write reply arbitration (read-back decides, never the timeout), and the G8 delete/undo-during-reboot liveness guard. Coordinator: triage HIGH-1 (gate unattended promote on a stated expectation OR a confirm) + HIGH-2 (per-card dialog de-dup + stale-dialog no-op) into fix threads |
| `_105` | **Red-team: sACN bridge / routing / subscription / bench mirror / same-address merge** — adversarial hunt for route flaps, double-writes, dropped universes, boot crashes, merge miscomposition | Opus (red-team) | **LANDED (report-only)** — `20260725_105_redteam_bridge.md`. **1 HIGH, 3 MED, 3 LOW; no CRITICAL. No source touched; no sACN frame toward hardware** (pure-module harness `~/tmp/redteam_bridge/harness.mjs`, 41/41). **HIGH (boot-crash): an out-of-range universe (>63999) in the LIVE hand-edited `📡 Subscribed Universes` field — `common.yaml` currently `1..37` — or a bad `patches.yaml dmxUniverse` bypasses the boot-list builders** (`parseSubscribedUniversesField` and `patchRecordUniverses` have NO upper-bound guard), reaches `new Receiver({universes})`, where `multicastGroup()` throws `RangeError`, which `classifyReceiverError` calls FATAL → `process.exit(1)`. **The runtime diff path buckets the same value as invalid and survives — boot and runtime disagree**, so a bad save is fine until the NEXT restart, which is dead-on-arrival with a misleading "socket FAILED" message. **MED1 (dropped-universe): a present-but-truncated `segments[]` silently drops the spill universe with NO anomaly** — the interpolation guard only exists on the empty-segments branch; the `_87` dark-pixel class one field deeper. **MED2 (double-write): bench-mirror `mirrorTargets` is built without subtracting `engineState.owned`, and `dest_host` is validated only against placeholder/broadcast/loopback, never the real controller registry** — a mirror can be pointed at an engine/sim-owned controller and become a second writer, unwarned. **MED3 (merge-miscompose): `composeUnifiedFrame` does not self-guard same-IP contested channels** (only throws on unrankable IP) and sorts before filtering by universe. **LOW: leading-zero octet folds decimal in the merge but passes raw to the socket (octal-interpretation divergence); boot gate replays only the last deferred reason; multi-NIC selection is an OS coin-flip by design (pin `sacn_interface` on the show box).** **What HELD:** the `_99` boot gate + double-join invariant (tried 3+ universes, interleaved), route-diff flap-freedom, merge intersection off-by-one at both edges, runtime subscription range + per-universe isolation, bench-mirror spec validation + activation gating, field-parser server/browser parity |
| `_104` | **Red-team: timeline ZOOM** — day/event zoom, time travel, the operator lease + scopes, the exit state machine; adversarial hunt for races, stuck states, lease leaks, ghost zooms, orphaned decks, a lying pad | Opus (red-team) | **LANDED (report-only)** — `20260725_104_redteam_zoom.md`. **1 HIGH, 2 MED, 2 LOW; no CRITICAL. No source touched; no engine spawned → `config.yaml` CLEAN vs HEAD; no `:6967`/`:6969-:6972`/device touched** (static code-path analysis + the four build reports; scratch `~/tmp/redteam_zoom/`). **The engine "never stuck" invariant HELD** — no zoom the rig can't leave (resume nulls the lease before catchUp & catches throws; the tick releases expired + self-heals orphaned leases; the boot scrub is synchronous before the first broadcast; `_goDormant` drops an expired travel lease; malformed `/timeline/travel` all 400 pre-mutation). **A1 (HIGH, silent-fallback / pad-lying): `_zoomExitRequested` leaks.** `_resume()` sets that module-level exit-claim UNCONDITIONALLY (`useTimeline.ts:171`), and it is ALSO the plain-takeover RESUME NOW (`resumeNow: resume` — deck + PlanLockBanner); it is only ever cleared by `clearZoomClaims()` on a zoom→null transition (`ZoomBanner.tsx:88`). A plain takeover has no zoom → the flag stays true → the next real PERFORM/TRAVEL zoom the ENGINE ends (lease expiry / restart / AUTO OFF / maker save) reads `ours:true` → the "Zoom ended — the plan resumed" toast + auto-nav is SUPPRESSED and the operator is silently stranded on a deck they no longer own. Inverts the exact `_97` §3.4 fix; the unit test only covers the pure `shouldAnnounceZoomEnd`, not the leaky latch. **A2 (MED): confirms `_100` F1** — the scoped lease IS persisted to `timeline_state.yaml`; only the one-line boot scrub prevents a ghost PERFORM banner on reboot (scrub ordering independently verified → latent, not live). **A3 (MED, pad-lying): the D3 "Show due: X — starts when you exit" banner keeps promising a show `_catchUp` will SILENTLY SKIP if you linger past the cue's hold**, and then EXIT (skips) vs ENABLE (fresh hold, plays) diverge. **A4/A5 (LOW): engine doesn't verify a PERFORM `cueId` is the live cue (spoofable banner); travel steppers' strict `>`/`<` make co-timed cues unreachable.** Coordinator: A1 first (it will mislead the operator on a show night), then A2/A3 honesty fixes |
| `_103` | **Red-team: timeline / arbiter / party-session** — adversarial hunt across triggers, arbiter precedence, festival/sun/tz math, cue/look/phase resolution, plan lint, and the party sustain/session/cooldown/arm-latch lifecycle | Opus (red-team) | **LANDED (report-only)** — `20260725_103_redteam_timeline.md`. **1 HIGH, 1 MED, 5 LOW; no CRITICAL. No source touched; no engine spawned (the `_93` dry-run harness runs offline, writing only to `~/tmp/timeline_dryrun/`) → `config.yaml` CLEAN vs HEAD; no `:6967`/`:6969-:6972`/device/sACN touched.** Repros in `~/tmp/redteam_timeline/`. **The trigger/arbiter/festival/sun cores HELD** — DST fall-back de-dupes, polar/degenerate sun fails safe to the defaultCue, overlapping `durationMin` windows rejected at load, festival day-gating exact + out-of-window refuses loud, missing playlists fail loud (non-fatal), zero-cue/identical-time plans deterministic, the edge-storm dwell defence works at default dwell, and the `_98` arm-latch fix is confirmed on burn night (27 sessions after the 2 h hold). **H1 (HIGH — deck-thrash): the mood→party cue has NO "I already own the deck" idempotency guard.** A detector that dips-and-returns (any music with quiet gaps ≥ the audio companion's `offConfirmMs`, default 30 s) RE-ARMS the cue on the calm dip (`triggers.js:284`), and with the SHIPPED dwell (20 s) the next loud return re-fires it while its own session is still live — the arbiter passes it (`controller==='autopilot'`, no ownership check), and `_applyAction` re-runs the whole look. `timelineLoadPlaylistOnDeck` (`api_server.js:4372`) ALWAYS loads the playlist's FIRST entry with a transition swap (no "already loaded" short-circuit), so **the exterior snaps back to party-pattern-1 with a transition on every music gap, all party night** (harness: realistic 3-on/2-off flap → 60 re-fires, 1 honest window-elapse in 5 h). **M1 (MED — silent cadence loss, same root): each re-fire re-stamps `_deckWindowUntilMs = now + durationMin`** (`timeline_service.js:845`; the :824 guard only protects the session-END bookkeeping), so a "12-min session + 2-min cooldown" collapses into ONE endless session whenever the music keeps returning — the operator's configured cadence + cooldown never run, and `sessionEndsAtMs` slides forever. **LOW: `mood` cue `from===to` validates but is a silent dead cue (never fires); a program `hold.until` an already-past anchor gives a ~zero hold (logged revert, intent silently lost); two same-time PROGRAMS both dispatch (deck double-write) and the earlier one's HOLD is silently discarded — `validateNoOverlap` only checks `durationMin`, never `hold`; DST spring-forward fires a gap-hour cue an hour late (N/A to BM dates); the dry-run harness mis-counts the `party-config` lifecycle line as a session end.** Coordinator: H1 first (idempotent re-fire no-op while the party cue already owns the live window + a `timelineLoadPlaylistOnDeck` same-playlist short-circuit) — it will visibly reset the exterior on the mission-critical party night; M1 rides the same fix (don't re-stamp the window on a re-fire) |
| `_102` | **Same-address merge with warning** — overlapping (universe, channel) claims: allowed with a PERSISTENT ⚠ warning in the mapping pane, packets unified into one per destination, conflicts resolved higher-IP-wins; IP-less/tied conflicts stay hard errors | Opus | **LANDED** — `20260725_102_same_address_merge.md`. **There was exactly ONE hard refusal** and it is now a warning: `derivePerOutputPlan`'s `universe_owned` collision, which used to refuse the push in all three consumers (single push, fleet push, sync chip). New pure module `simulation/src/dmx/address_merge.js` owns the whole rule. **Merge one-liner: overlapping claims are allowed; each (universe, destination IP) gets exactly ONE packet, and on any contested channel the numerically higher controller IP overrides.** The IP comparison is **octet-wise numeric, never string** — the pair `.9` vs `.10` is the case string ordering gets backwards, and it is `a*2**24` not `a<<24` because a signed shift makes every ≥128.x address negative. The contested region is the **intersection only** (a par at ch10–13 vs a strand at ch12–20 contest ch12–13; the strand keeps ch14–20). **Four warning surfaces:** a PERSISTENT amber card banner in the mapping pane (not a toast — the operator maps for an hour), the push/save dialog's `⚠ N SHARED ADDRESSES` block placed FIRST, the sync-chip detail/tooltip (chip stays in-sync — a share does not make the device differ from the plan), and console/fleet-push logs naming the winner. **Runtime override does not depend on render order:** the loser is told which absolute channels it must not write (index built once per projection, resolved once per pixel), including the par master-dimmer force-write. **Deliberate asymmetry kept:** an EXPLICIT operator universe may be shared, but auto-assign (repair, park) still skips every claimed universe — the sim never chooses to create a shared address. **Composes WITH the `_89` bench mirror rather than fighting it** (mirror unifies at the bridge, this unifies at the sim; `server/sacn_bridge.js` untouched, `git status` confirms). Sim suite 1592 → **1645, fail 8 → 8** (the known baseline, byte-identical list), +53 tests incl. byte-level frame composition. Security PASS (one self-inflicted finding found + fixed: a real routable IP in a test, swapped for RFC 5737). **LIVE-PROVEN with 13/13 checks + screenshots** on the operator's own sim, sACN OUT socket blocked and asserted, zero device HTTP, zero scene writes. **TWO OPERATOR DECISIONS handed back** (§4 of the report): a same-IP overlap and a no-IP overlap are still HARD ERRORS — the operator's rule ranks IP-bearing claimants only, and inventing a tie-break would be a fallback he did not ask for. **Memory amendment proposed** (§7): `sacn-route-ownership`'s flat "one writer per (universe, controller) is the law" now needs two enforcers — the bridge's suppression AND the sim's merge |
| `_100` | **Timeline zoom e2e (S5) — THE WAVE CLOSER** — a committed engine e2e suite: every exit-table row, two-client scenarios, party-vs-zoom, post-`_98` conformance | Opus | **LANDED** — `20260725_100_timeline_zoom_e2e.md`. **17/17 scenarios green**, driving a REAL engine subprocess over REST + `/ws/control`, restarted by really killing it. **The two exit paths nobody had ever exercised live are now covered: ENGINE RESTART mid-zoom (both scopes — a reconnecting pad sees the truth on its FIRST frame) and PLAN SAVE mid-zoom (the maker auto-saves; the pad is TOLD, it never asked).** Every other exit-table row too — resume, lease expiry, AUTO OFF, activate, ENABLE; the one remaining row (festival window closing) is UNIT-only for a stated structural reason: every e2e route to it short-circuits through another exit. **`_97`'s exit-race pinned e2e** — the cleared-zoom broadcast really does beat the `resume()` response, so the pad's pre-staked claim answers a real ordering. **`_98` fix 1 proved on a real engine with a real mood feed**: a party fire during a PERFORM lease is suppressed, visible, edge-only, and consumes NOTHING — it fires the instant the operator hands back. **THE `--dest` TRAP IS CLOSED AT THE SOURCE:** `MARSIN_CONFIG_FILE` now governs the engine's BOOT read as well as the autopilot write-back, so a harness can finally neutralise the per-controller `controllers:` block instead of hand-editing your tracked config (which is what `_97` had to do, and what `_98` then flagged as a commit blocker). Plus new `MARSIN_TIMELINE_DIR` — a test engine can no longer write plans into `scenes/**`. **One real bug found + fixed (B1):** the day ribbon only sampled where cues START, so a cue was drawn owning the deck for hours after it handed back — on the shipped plan it mis-stated exactly the stretch `_98` FIX 7 gives ambient. The review surface built to make the plan honest was lying about the biggest thing `_98` changed. Timeline suite 407 → **410/410**; full engine 2470/2478 (the 8 baseline, zero new); CaptainPad **914 = baseline**; security PASS; **`config.yaml` clean — nothing to restore.** Two findings reported not fixed: the "runtime-only" lease IS written to disk (only the boot scrub saves it), and entering ANY takeover stands the deck's pattern autopilot down |
| `_97` | **Zoom pad slices S3+S4** — day zoom (phase bands + resolved ribbon) and event zoom (PERFORM / TIME TRAVEL banners, snapshot steppers, D3 deferred banner) in CaptainPad, against the `_95` §3 API | Opus | **LANDED** — `20260725_97_timeline_zoom_pad.md`. The ladder is real: **FESTIVAL → DAY → EVENT**, where the two browse rungs make ZERO engine calls and only the event rung touches the rig. Day cards now ZOOM IN on tap (the old select-vs-EDIT-DAY split is gone; `DayEditor` was promoted into the new full-screen `DayView`). DAY carries **phase bands** — with `party_night` correctly drawn as TWO pieces across midnight, the one thing that would have silently blanked a night — and the **resolved ribbon** with a plain-language reason per segment. EVENT is one sheet with one action, the branch chosen by the engine (`activeCue`) **and scoped to TODAY's card** (a cue-id-only test offered "perform tomorrow's show" — caught live). Global `ZoomBanner` on every tab: green PERFORMING / purple TIME TRAVELING with `◀ ▶` steppers, EXIT everywhere, and the D3 line **"Show due: … — starts when you exit"** + ENABLE. `PendingProgramOverlay` now stands down under a zoom instead of counting down to an auto-start the engine has deferred. GATES: tsc clean, CaptainPad **914/914 (+22 new, 0 fail)**, lint clean on touched files, security PASS. **LIVE-PROVEN on a fresh :7167 dist against a real engine** (operator's :6967 never touched): day zoom on the dormant real plan, PERFORM over the deck, TIME TRAVEL over the deck, the deferred banner 4 min into a hands-off performance, stepper retargets, the boundary 400 printed verbatim (`no prev event on …`), a second client rendering the banner without auto-exiting, and the full D3 loop end to end — the deferred show was **not** dismissed, it fired via catchUp on lease release. **One real bug found live + fixed + pinned:** the engine's 1 s broadcast beats our own `resume()` response, so the operator's own tab-return exit raised a "zoom ended" alarm at the person who just asked to leave |
| `_99` | **sACN input-bridge boot crash** — `addMembership EINVAL` from the `sacn` package kills the input bridge at stack boot | Opus | **LANDED** — `20260725_99_sacn_bridge_einval_fix.md`. **Not the NIC** (joins succeed three ways on this box) — a **boot-ordering race in our own code**: `recomputeRoutes('boot')` subscribed synchronously while the `sacn` Receiver's join loop is deferred to the socket's `listening` callback **over the same array** `addUniverse` pushes into, so the universe was joined **twice on one socket** = `EINVAL` on Windows; and `sacn_bridge.js` had **no `receiver.on('error')`**, so the package's re-emit threw and killed the bridge. **Trigger: any scene patched to a universe the `📡 Subscribed Universes` field does not name** — which `_92` passed through on U38/U39, and which the pending TE-sign attach re-creates. Fixed with a **boot gate** (work held + replayed at `listening`, every deferral logged), a **classified error handler** (join failure = loud + isolated, exactly like the runtime path; any other socket error = FATAL exit), a **self-policing invariant** that hard-exits naming the racing universes, and **deterministic + logged interface selection** (optional `sacn_interface` pin; a mismatch throws with an inventory, never a silent NIC switch). Proven end-to-end by re-creating the divergence against the real bridge (`common.yaml` restored byte-clean). Sim **1590/8 fail = the baseline 8, zero new** (+19 tests, incl. 2 LIVE receivers pinning both orderings). **Stack left UP** — sim servers on :6969-:6972 + UDP 5568, pinned `titanic` (input bridge verified receiving 1168 pkt/5 s from `MarsinEngine` while the engine was still up). **`launcher.js prod` was REFUSED by the permission gate** (blocked-by-classifier) and not worked around; it had also been held off earlier because `prod` force-claims `:6968` and would have killed `_97`/`_98`'s engine. :6966/:6967/:6968/:7167 are all down now, so **`node launcher.js prod --scene titanic` completes the prod shape in one command** — it absorbs the running sim servers, nothing to stop first. Note `marsin_engine/config.yaml` is clean vs HEAD with a real `10.x.x.NN` Titanic host, so that start puts engine frames on the wire |
| `_98` | **Timeline bug-fix wave** — `_93` bugs 1–5 + `_95` F1 + G1 conformance (hold expiry → ambient) | Opus | **LANDED** — `20260725_98_timeline_bugfix_wave.md`. Engine-side only; **zero `scenes/**` writes**. **Burn night + 8 h of music: 0 sessions → 27** (a suppressed fire now consumes NOTHING — no arm latch, no cooldown; `wouldFire` went edge-only). **Quiet night: `ambient` 0 h → 12 h 20 m (51 %)** — a hold expiring naturally hands the deck to the ambient `defaultCue`, palette reset included (G1 fixed at runtime AND at boot AND in the ribbon; `source:'hold-expired-baseline'` is gone). A restart mid-hold now cycles (`ap OFF` → `ap 90s seq`). An ambient cue can no longer wipe a live program's look — the burn show keeps all 120 of its minutes. The background phase look **returns after every session** instead of being evicted for the night (0 h 40 m → 7 h 04 m). `_95`'s `clobberedByBootBaseline` pin **flipped to assert-the-fix**. Timeline suite 387 → **407/407**; full engine 2449/2459 (8 pre-existing + 1 flake + 1 from a concurrent thread's `config.yaml` edit — since RESOLVED: it was `_97`'s deliberate black-hole, restored at its landing and coordinator-verified byte-clean vs HEAD). **Fix 4 verdict:** program looks with no `autopilot` block are now a LOUD authoring lint (`planWarnings` on `/timeline/state`), not a throw — the shipped plan **trips it 3×** (`sunrise`, `burn_night`, `temple`) and still loads: **your plan edit**. **`whenPhase` restoration remains operator-gated** |
| `_94` | **Timeline zoom DESIGN** — day zoom + event zoom (perform / time travel) | Fable (operator-named) | LANDED + ACCEPTED (D1–D8 as recommended, "do them") — `20260725_94_timeline_zoom_design.md`; build wave running as `_95` (landed) / `_97` / `_98` |
| `_96` | **Optional-discovery lifecycle + controller status** — typed-IP provisional binding patches everything with the board OFFLINE; first contact fetches the board's data + promotes (loud reconcile on mismatch); plus per-controller ONLINE/OFFLINE/UNKNOWN dots (parallel server-side probes, MarsinLED = HTTP never ICMP) | Opus | **LANDED** — `20260725_96_optional_discovery_lifecycle.md`. Lifecycle `unbound → PROVISIONAL → VERIFIED`; a provisional card patches **byte-identically to a verified one** (patches.yaml + model lanes + bridge routes + subscribed universes) and **promotion moves nothing** — both pinned. Contradiction → loud reconcile dialog, **nothing changed on either side**, two explicit choices, hard-blocked on an unidentifiable box or a fingerprint another card owns. `0.0.0.0` refuses a provisional binding (type the real IP first) and the two compose. Status: three honest states, `unknown` never rendered as offline, per-type probes (LED = HTTP `/api/status`; DMX = TCP connect where a **refused** connection proves the box is up), bounded pool + box-keyed cache, pane never blocks. **76 new tests; sim 1482→1559, fail 9 = the 8 baseline + `_92`'s in-flight parity finding (proof in §7.2); zero new.** 18/18 live checks + 7 inspected screenshots, **1 off-host request attempted and REFUSED** (the pane's own pre-existing sync-chip read). Fixed in passing: `bench_section.cjs` dropped `provisional` from the mirrored block, which would have written a file the loader refuses. **You: restart the stack once (page + save-server route), then type the three rope IPs → ⚑ Patch without the board → Save** |
| `_89` | **Test bench = titanic stand-in** — bench pars/vintage/bars/LED strings show the ship's LEFT FRONT while the engine runs titanic | Opus | LANDED — bridge-side **bench mirror** (`20260725_89_test_bench_titanic_standin.md`). **ZERO device pushes, zero gateway edits.** You: restart the launcher, then run the sim pinned `--scene test_bench` with the engine on titanic |
| `_90` | **ChatGPT pattern-tuning prompt pack** — paste-ready self-contained prompt (pattern API, MFT/param-order hard rules, geometry + `FIX_*` targeting, style doctrine, response contract, harness-verified example) | Opus | LANDED — doc-only, `20260725_90_chatgpt_pattern_tuning_prompt.md` |
| `_92`+ | **TE signs → LED correction (URGENT)** — remove the DMX placeholder; signs become mappable **LED** fixtures on MarsinLED outputs | Opus | **LANDED** — ADDENDUM in `20260725_92_te_sign_patch_model_fix.md`. `TeSigns-PLACEHOLDER` **deleted** (controllers 17→16), all four sign patch records dropped, U38/U39 unsubscribed. New **LED PIXEL FIXTURE** kind: a `parLights` fixture whose definition says `bus: led` is now LED end-to-end — LED tray (not DMX), LED per-output addressing, `type: 'led'` model pixels, strand-shaped patch record. Data-driven (`bus`), so **`fixtureType` strings never changed** → every `te_sign` selector and the `_48` add-2 one-panel-per-sign guarantee are intact. **LIVE PROOF:** pane reads `UNMAPPED — 0 FIXTURE(S), 4 STRAND(S)` with the four 💡 sign chips, no PLACEHOLDER. Caught 2 latent bugs (identity lost on unmap; split LED output gate). Sim **1571/8 fail = the baseline 8, zero new** (+12 tests). **Parity now 4 errors — the 4 unmapped signs, ON PURPOSE:** you attach them to a MarsinLED output running **RGBW / stride 4 — the same setting the rope outputs already use** — and it goes green (side A 160 ch + side B 136 ch = 296 ch, one sign fits one universe). ⚠ **CORRECTED 2026-07-31** — this row first said *RGB order*; the operator: *"sign is also RGBW, same lights as the ropes."* Definitions regenerated RGBW and renamed `model_a_160.yaml` / `model_b_136.yaml`; no byte-level bug (stride always came from the controller), suite 1590/8 = baseline, parity unchanged at 4. Sim servers only, engine never started; `_96` files untouched |
| `_92` | **TE sign patch + model rebuild (URGENT)** — 4 reported defects; rebuild the sign pixel model from the fresh Fusion CSVs | Opus | **LANDED** — `20260725_92_te_sign_patch_model_fix.md`. All 4 confirmed + fixed. **`scene_model_parity titanic`: 21 errors → 0, RESULT PASS** — the titanic scene is now fully patched. Sim suite fail **10 → 8** (zero new; both titanic scene-drift pins went green). Signs on a `0.0.0.0` PLACEHOLDER controller, U38 (sign 1) / U39 (sign 2); sign 2 renamed `TE Sign 2 V3 A/B` → distinct sId 415 / fId 2204-2205. Model regenerated by the new `simulation/tools/gen_te_sign_fixture.js` (points identical, **wire order** changed). **Zero device traffic; no engine restart needed** (pixelCount unchanged, hot-reloaded) |
| `_91` | **Show infrastructure audit** — timeline mechanics, theme-night support, party-trigger chain, playa time + postpone, 68×13 coverage matrix, testability; GAP LIST + proposed test plan | Opus | LANDED — read-only, `20260725_91_show_infra_audit.md`. **Machinery strong (317/317 tests), the SHOW is not**: 6 of 8 reachable looks load `default`, which is 62% dead entries + 92% untuned; 9 of 13 playlists unreachable. "Ambient only" PARTIAL, "VJ stand-down" + "postpone" MISSING. **First build: a timeline dry-run harness** |
| `_93` | **Timeline dry-run harness** — `timeline_dryrun.mjs`: real plan + real TimelineService on an injected fast clock + scripted mood; minute-by-minute night narrative, suppressed-fire log, session lifecycle; works while the plan is dormant | Opus | **LANDED** — `20260725_93_timeline_dryrun_harness.md`. `node tools/timeline_dryrun.mjs --fixture` (or `--date <in-window>` for the real plan) prints a whole playa night in seconds, offline. Confirmed G1/G2 + the daylight party fire; **5 NEW bugs, report-only** — worst: a *suppressed* party fire burns the arm latch, so 8 h of music on burn night gave **0 sessions** (35 on a normal night). Engine timeline suite 317 → **340/340**; both `_91` fix-on-sight items done |
| `_95` | **Zoom build S1+S2 (ENGINE)** — pure `resolveDeckStateAt` + `GET /timeline/resolve` + overview `phases`/`segments`; lease scopes perform/travel + `POST /timeline/travel` + `zoom` broadcast + D3 cue-deferral | Opus | **LANDED** — `20260725_95_timeline_zoom_engine.md`. **`_catchUp` refactor proved BYTE-IDENTICAL: 1116 boot+resume+savePlan scenarios vs `HEAD`, 0 diffs.** Timeline suite 340 → **387/387**; full engine suite 2434/2442 (8 pre-existing/environmental, zero new); **19/19 REST checks** against a real engine + the real `playa_default`. **S3/S4 build from `_95` §3 (the API surface).** Day-zoom ribbon now shows the shipped plan's truth on the wire (`c_sunrise` owns 07:53→18:49, `c_visibility_on` owns 20:34→midnight). D3 deferral is scoped strictly to zoom leases — a plain takeover keeps the I2 30 s auto-start byte-identical. Travel works while the plan is **dormant** (the rehearsal case, `_91` #16). **2 pre-existing engine truths surfaced + pinned, NOT fixed: F1** boot-baseline clobber (catchUp restores a non-program cue, then the baseline reloads over it — invisible today only because every look points at `default`), **F2** `_91` G1 now visible as `source:'hold-expired-baseline'` |

## Operator test checklist (2026-07-31 wave — tick as you verify)

> Operator-requested: "keep track of a set of things for me to learn
> what you did and test as much as I can." Each item: what to do → what
> you should see. Deep detail in the linked report.

**Controller pane (reload the sim page first):**
- [ ] **Status dots** (`_96`): every controller card shows ● ONLINE / ○ OFFLINE / ◌ UNKNOWN; pane never freezes waiting on a probe.
- [ ] **TE signs → LED** (`_92`+): four 💡 sign chips in the UNMAPPED LED tray; DMX list has no PLACEHOLDER. Map them: attach to a MarsinLED output, **output color order = RGBW — operator correction 2026-07-31: the sign pucks are the SAME RGBW lights as the ropes** (the `_92` report's RGB claim was wrong; verification thread running), Save → `scene_model_parity titanic` goes 4 errors → 0.
- [ ] **Provisional binding** (`_96`): on each rope controller (the 3 unbound ones) type the real IP → **⚑ Patch without the board** → Save. Expect: patches/routes exist immediately, card shows PROVISIONAL, flips ✓ VERIFIED on its own when the board first answers.
- [ ] **Reconcile dialog** (`_96`): if a board disagrees at first contact you get a two-choice dialog, nothing auto-picked.

**Timeline (engine running):**
- [ ] **Dry-run a night** (`_93`): `cd marsin_engine && node tools/timeline_dryrun.mjs --fixture` — whole night, minute by minute, party sessions + suppressions explained. Try `--list-moods`.
- [ ] **Burn-night fix** (`_98`): same harness, `--mood all_night` on a festival day — sessions fire again after the burn hold (was 0 all night).
- [ ] **Ambient-dominant** (`_98`): quiet-night run — ambient playlist owns ~half the day; no `hold-expired-baseline` source anywhere.
- [ ] **Plan lint** (`_98`): `/timeline/state` → `planWarnings` names 3 looks needing autopilot blocks (`sunrise`, `burn_night`, `temple`) — your yaml edit.
- [ ] **Zoom e2e, one command** (`_100`): `cd marsin_engine && npm test` (or `node --import ./tests/helpers/setup_config_guard.mjs --test "tests/e2e/*.test.js"`) — 17/17, ~2 min, real engines on throwaway ports with sACN black-holed and asserted. Run it after ANY timeline change.
- [ ] **Ribbon hand-back fix** (`_100`): in DAY zoom, a program cue's ribbon row now **stops at its hold end** and the ambient default cue takes the rest — it used to be drawn owning hours it had already handed back.

**CaptainPad (fresh dist or your Expo):**
- [ ] **Day zoom** (`_97`): tap a day card → OPEN DAY ▸ — phase bands (party_night wraps midnight as two pieces) + "what actually plays" ribbon with a reason per segment.
- [ ] **Event zoom LIVE** (`_97`): tap today's active cue → green PERFORMING banner; drive the deck; a due show says "starts when you exit" and fires on exit — never steals mid-performance.
- [ ] **Time travel** (`_97`): tap an inactive event → purple TIME TRAVELING banner, ◀ ▶ steppers; back to the timeline tab exits and resumes truth.
- [ ] **Two pads** (`_97`): second client shows the banner, doesn't get kicked, can't fight the writer.

**Stack & bench:**
- [ ] **Prod bring-up** (`_99`): `cd simulation && node launcher.js prod --scene titanic` — boot log shows the interface inventory + subscriptions held until the socket listens; no EINVAL death.
- [ ] **Bench mirror** (`_89`): sim window pinned `--scene test_bench` while engine runs titanic → `🪞 BENCH MIRROR ACTIVE` in the bridge log; bench plays the ship's LEFT FRONT (Auditorium pars, Front Rails, Front Wall bars, port-rope heads). If strands stay dark: one Push on the Titanic_202 card in test_bench (revert push, the only one).

**Your config edits owed:** `whenPhase: party_night` back on the party cue · 3-line autopilot blocks ×3 (lint above) · roof-edge par row patching · `.60` one-push · smokestack margin (27).

**⏸ WAITING ON YOU (full list in "Waiting on the operator" below)**

| # | Action | Why |
|---|---|---|
| 23 | **Hard-reload the sim tab** | One reload picks up the whole day: dot scale (`_74`), live halo knob (`_75`), per-fixture Halo × (`_77`), knob relabels (`_78`), sorted menus (`_80`), red gating (`_81`), the halo-pool leak fix (`_82`) |
| — | **Check the roof-edge par row's patching** | `_78` measured only 8 of 40 pars patched — you believed that row was mapped. Since `_81` they render DARK rather than red, so the gap is quiet instead of loud: it is still real and still yours to close |
| 15 · 18 · 22 | **`.60` card: expect ▲ Drift (normal), ⬆ Push ONCE** | One push re-parks output 3 off U23, completes the timed-out write's save+notify, and doubles as acceptance step 1 (`_71` §6) |
| 3 | **Titanic re-export + engine restart** | Clears the standing 8 stale-model suite failures AND the 2 operator-scene drift pins in one sim-save + reload |
| 17 · 19 | Live acceptance run (`_63` §3) · gamma W-preset veto (`_65`) | The `_58` wave is unit-proven only until 17 runs once on hardware |
| 27 | Top-Down compression margin (`_84`) | Nudge the Left Small SmokeStack generator x outward, or retune the pin — one more inward nudge tears a side of the view |

**✅ LANDED TODAY (2026-07-30):** the `_58` push/save wave S1–S5 complete in
code; port→output mapping (`_70`/`_71`); reboot-aware push timeout (`_69`);
LED gamma sliders + live curve (`_64`/`_65`); 2D edit-tab persistence
(`_66`, layout committed `b8b8bca5`); the halo family — fixture scale-up
(`_68`/`_73`), the dot-scale bug (`_74`), one global knob for every bus
(`_75`), per-fixture `Halo ×` (`_77`), the not-a-colour-bug verdict (`_78`),
the independent double-check (`_79`), red gating (`_81`) and the
60-slot SpotLight leak (`_82`); orphan badges + one-click removal (`_76`);
generator move carries its fixtures (`_83`) + Fable sanity PASS (`_84`);
tray layout (`_85`); `📡 Subscribed Universes` auto-sync (`_86`); and
**`_87` — zero restarts for mapping changes**. Security sweep `_67` cleared
the commit path; the whole wave was committed and pushed as **`3246deb2`**.
Suite ends the day at **1452/1442/10** (8 known stale-model + the compression
tripwire + operator-side scene drift — zero new all day).
Full detail: reports `_47`–`_87` and archive `_88` §1–§2.

## Status snapshot (read this first)

**Orientation for any reader:** reports live in
`../reports/202607/20260725_N_*.md` (N assigned centrally; the ledger and the
most-current campaign state are in `.agent/memory/bm_readiness_thread_tracker.md`
— that tracker is canonical, this doc is the program board). **Next free
report: `_95`** (`_89`–`_94` are taken). Everything this doc used to carry in long form is in
archive `_88`; each section below names the archive section that holds its
history.

**Scheduling (operator rule, 2026-07-28):** dated deadline/schedule planning
lives ONLY in `.agent/reports_local/` — gitignored AND deploy-excluded.
Tracked docs record what and why, never when-by.

**Standing orders in force:**
- **NO deploys to titanic-ext** — operator develops locally and deploys
  himself. (Remote is one deploy ahead-and-consistent with local through
  `_26`.)
- Operator runs his own Expo/Metro on :6967 — agents never touch it;
  CaptainPad verification happens on `:7167` dist builds.
- **Controller firmware work PAUSED** (flash requires USB per unit); the HTTP
  config API is the supported path for controller settings.
- **White-pattern residual work PAUSED** ("colored patterns look good") —
  diagnosis + ready-to-go fix plans on file in `~/tmp`; resume only on an
  explicit ask. The RGBWAU→LED colour path is operator-ACCEPTED.
- **Commits are operator-gated.** The readiness wave WAS committed and pushed
  on operator order 2026-07-30 — **`3246deb2` on `feat/bm_readiness`** (441
  files, reports `_47`–`_87` included), plus a follow-up removing a stray
  0-byte tool-residue file. The tree is clean apart from the ledger files
  (this doc, the tracker, and today's reports). Next commit still needs his
  word, and a passing `python scripts/security_check.py --staged` first.
- **Operator is LIVE-MAPPING real DMX/LED controllers** (since 2026-07-29):
  all agent browser work runs readonly-guarded (no saves, no output-enable
  touches, sACN OUT socket blocked, short sessions); `simulation/scenes/**`
  and the models are operator-owned. The one exception on record is the
  operator-ordered coordinator scene fix of 2026-07-30 (Decisions log).
- **Scene configs may carry controller IPs** (operator ruling 2026-07-30):
  the security checker already tolerates them, and the redaction convention
  applies to `.agent/` prose, not scene data. `.agent/` files stay redacted
  (`10.x.x.60` style) — the `_67` sweep's convention holds.
- **Doc standing order (2026-07-30):** a doc contradicting verified
  code/hardware behavior gets fixed and cleaned up on sight
  (`.agent/memory/doc_inconsistency_standing_fix.md`).
- Some LED evidence deliberately lives OUTSIDE this public repo in `~/tmp`
  (colour/white reviews, controller debug transcripts) — an operator privacy
  rule for external-hardware detail; this doc carries only BM-side facts.

## Operator requirements (verbatim intent, 2026-07-27)

Headlines only — the full verbatim section, including the settled party
session model, is archive `_88` §4.

- Somewhat autonomous fixture; "we have a freaking strong base."
- **Party detection** must be calibrated and proven ON PLAYA; default
  operation is a preplanned program of playlists. Sustained party audio
  (~2 min) starts a ~10–15 min session. Must NOT catch music from across the
  playa. **Party only fires while a timeline plan is active and NEVER
  overrides a human operator** (human > operator disable > automation).
  Division of concerns: the companion configures DETECTION, the CaptainPad
  TIMELINE tab owns HANDLING, the engine owns the persisted `/party-config`.
  Session model shipped as specified (sustain always on; duration toggle,
  OFF = follow-the-music with the companion's `offConfirmMs` as the single
  release sustain; cooldown default 2 min, clock from session END).
- **Pattern pass:** manually test ALL patterns, tune speeds + defaults, record
  the tuned results as playlists.
- **Show program:** a couple of planned party moments; the rest ambient, with
  a party playlist triggered by detection.
- **Hardware:** test the smokestack rope LEDs; test the TE sign.

**Show-behavior refinements (operator, thinking out loud, 2026-07-31):**
- **Party auto-trigger fires from AMBIENT only** — an automatic party can
  only interrupt ambient operation, nothing else.
- **Parties are gated to SHORT sessions** (consistent with the settled
  10–15 min session model above); **ambient is the most important aspect
  most of the time — occasional party**.
- **Party night is VJed** — a separate human-driven setup; probably **no
  trigger cue at all** on those nights (automation stands down).
- **Playa time in the app** — the timeline should reason in playa-local
  time, and the operator wants the ability to **postpone/shift** planned
  phases ("allow postponing and shit maybe").
- These are stated as things "to test and figure out" WITH the coordinator
  — infra + system testing is the current focus. **Filling and tuning
  unassigned playlists is a ChatGPT task now, not an agent task.**

## Waiting on the operator (no agent action until he moves)

Numbers are the ORIGINALS — they are referenced across the reports, so they
are never renumbered. Resolved-and-retired items **1, 4, 16, 20, 24, 26** are
archived with their full text and a one-line verdict in `_88` §3.

2. **⟳ Restart-device button** on the LED controller cards — yes/no (`_56`;
   `rebootDevice()` is dead code today and the reboot endpoint is verified).
3. **Titanic re-export + engine restart.** One sim-save + re-export clears the
   standing 8 stale-model suite failures, the 2 operator-scene drift pins
   (`_84`'s compression tripwire, `_87`'s test_bench mapping pin) and the
   parity errors. Runbook: `.agent/ops/engine_model_refresh.md`.
4. *(resolved — `_88` §3)*
5. **TE Sign duplicate fixture names** (both groups carry `TE Sign V3 A/B`) —
   pick an option from `_52` §3. It also surfaces as the push dialog's save
   step failing during the item-17 acceptance run.
6. **Clear-All test-controller checkbox** (~3 h, design in `_50`) — go?
7. **Per-selector stale-name sweep** (~2–4 h, design in `_48` Add.2) — go?
8. **Membership editing** for 2D views (~0.5 d, design in `_54`) — go?
9. **Free-placement layout mode** for edit-mode moves (`_55` offer) — go?
10. **Migrate-addresses opt-in (11b)** y/n, and ratification of the step-11
    loud refusal on individually renaming a generated fixture (`_47`).
11. **Global Pixel Size can't reach LED strands** — fold strands in, or
    relabel the knob (`_53`; this is why it crept to 5).
12. **Top-Down bar-width narrowing (17→14)** partially walks back the `_40`
    ruling on that view — veto available (`_48` Add.4).
13. **Relay to the external WiFi/Ethernet agent:** the `.60` reports **no
    Ethernet interface at all** (`_56`) — Ethernet-only may be impossible on
    that hardware.
14. **`_58` push-save scope — SHIPPED AS OPTION A (`_61`), veto still open.**
    ⬆ Push runs the FULL scene save and the confirm dialog says so up front.
    If "saves everything dirty, not just the mapping" is unacceptable, S1 gets
    re-pointed at Option B (a scoped `/save-mapping` endpoint).
15. **(with 18 and 22) — ONE push settles all three.** The `.60`'s output 3 is
    enabled on-device at U23 (LeftFrontDeck's DMX universe — a cross-controller
    collision minted by the old auto-extender; inert but armed). Expect the
    card to read **▲ Drift** the moment you open the pane: that is the landmine
    becoming visible, not a new fault. One ⬆ Push re-parks output 3 onto a
    claims-approved free universe (nothing is disabled — output 3 stays
    enabled, subscribed and dark), completes the timed-out write's save+notify
    (`_69` fixed the 5 s abort), and is step 1 of the `_71` §6 live
    acceptance: cross P1→out2 / P2→out1 and back, GET-verify no output changed
    `enabled`, then the output-4 case and the duplicate refusal. Costs one
    ~11 s device reboot and one real scene save per push.
16. *(resolved — `_88` §3)*
17. **Live acceptance run for the WHOLE `_58` wave.** Every slice is proven by
    unit tests only until this runs once on hardware. Three tests, full
    checklist + pre-flight in **`_63` §3**: (a) change one port universe on the
    `.60` card, press ⬆ Push and nothing else — expect device✓/save✓/notify✓,
    a route transition in the bridge log, LEDs following with no manual save;
    (b) a mapping-only change + 💾 Save Configuration — LEDs follow;
    (c) with the bridge WS down, a save → red toast + red sACN-IN monitor line,
    then self-heal on reconnect. Interacts with item 15 and with the TE Sign
    duplicate-name save-abort (item 5).
18. *(merged into 15)*
19. **Gamma preset W-doctrine veto (`_65`):** the sim's `2.2 sRGB` / `Punchy`
    presets hold **W at 1.0** per docs/41 §4.1(d); the firmware's own presets
    put the exponent on W too. Test-guarded as shipped — say the word for
    firmware parity instead. Related unnumbered follow-up: a verified gamma
    push still mirrors in memory only, so save the scene once after a gamma
    push until the persist slice lands.
20. *(resolved — `_88` §3)*
21. **Left Front Deck — the two taste calls that survived `_72`'s
    cancellation.** The size half is fixed (`_74`) and the unpatched-red
    rendering is now toggle-gated (`_81`), so what remains is the **U23 feed
    level**: what the engine actually sends on that universe, not how big it
    draws.
22. *(merged into 15)*
23. **Hard-reload the sim tab** — the Threads board's top row. It is the
    "regenerate the instances" you asked for: it rebuilds the pixel map and
    every instance, no runtime cache survives it, no server restart needed.
    Check the Left Front Rails heads fill their housings (`_74`) and that
    Global Halo Size moves every bus live (`_75`).
24. *(resolved — `_88` §3)*
25. **Per-fixture `Halo ×` (`_77`) — two one-liners if you want them:**
    (a) fog/haze machines show the field but have no halo to scale — hide it
    there? (b) LED-bus halos still have NO pitch ceiling (deliberate — a
    sign's halos are meant to merge); say the word if you want one.
26. *(resolved — `_88` §3)*
27. **Top-Down compression margin (`_84`, NEW 2026-07-30).** Your Left Small
    SmokeStack x-move left the smallest Top-Down collapsed band at **5.20**
    against the 5-unit compressor threshold (the guard wants ≥ 7.5) — that is
    the 9th suite failure, and it is scene drift, not code. Nudge the
    generator's x outward, or retune the pin. One more inward nudge could tear
    a side of the Top-Down view.

28. **Patch the six rope strands without powering a board (`_96`, NEW).**
    Restart the stack once (the page needs the new pane; the save server needs
    the new `/controllers/probe` route), then open 🎛 Controller Mapping, and on
    `LeftRightRopes` / `RightLeftRopes` / `RightRightRopes` press
    **⚑ Patch without the board** and Save. That writes all six `patches.yaml`
    records, the six model addresses and the six bridge routes — the `_92` §4
    darkness — with the boards still boxed. They promote themselves to
    ✓ VERIFIED the first time they answer. Same move converts the TE sign
    controller once its box has a real IP (type it over `0.0.0.0` first — the
    button refuses the sentinel on purpose).

Plus the older parked items: party `ambientFloor` calibration; the R2
pattern-tuning session; theme culling + the party-moment schedule; R4 hardware
tests; the 20-vs-40 px/strand test_bench question.

## Open decisions (Sina)

Numbers preserved. Settled items 1–4, 8 and 11 are archived in `_88` §6.

5. Pick a playa (or driveway) night for the ambient-vs-party baseline capture
   (threshold calibration).
6. TE sign test_bench mapping (`20260725_4`): agent applies via the live UI, or
   Sina maps it himself?
7. Scheduled party moments: how many / what times (rough is fine).
8. *(resolved 2026-07-27 by delegation — `_88` §6)*
9. Themed playlists: which of the proposed themes (`_88` §7) to adopt, and
   which nights get them.
10. UV spike: go/no-go after the on-fixture test (also confirm UV channel
    presence in the par inventory).
11. *(resolved — the orphans were deleted after `_76`; `_88` §6)*
12. **Live-derived 2D default views** (`_44` §5 Q2, third recurrence via
    `_51` §6): every group rename re-breaks the hardcoded names in
    `pixel_map_view_defaults.js`. Keep patching names, or derive the defaults
    from live groups?

## Workstreams

State + next action + owner only. **Full history for every row: archive `_88`
§5.**

| # | Workstream | State | Next action | Owner |
|---|---|---|---|---|
| R1 | **Party-mode detection + session logic** | BUILT + DEPLOYED (`_12`, `_19`); all 11 validation defects fixed and independently revalidated (`_20`→`_22`→`_23`) — sessions repeat, cooldown clocks from session END, restart-safe in every mode | Sina calibrates `ambientFloor` on playa via the companion PARTY tab capture flow. Standing rule from `_23`: use `hold`, not `durationMin`, for a moment that must not be interrupted | Sina (calibration) |
| R2 | **Pattern tuning + playlist capture**; specialty patterns (WHITE ONLY, UV spike) | PARKED for Sina's presence. Specialty patterns 60–65 sit on disk unvalidated; WHITE=AMBER lane match landed (`_26`); param-truth sweep (`_32`) measured 817 params across 125 patterns — real punch-list 73, while 137 "dead" params are dead only because titanic reports `sectionId 0` and clear when R8 lands sections. **NEW TOOL (`_90`): a paste-ready ChatGPT prompt** turns Sina's own copy-paste loop (pattern + 2D-map screenshot + ask → complete edited file) into a working tuning path that needs no agent in the room | Resume the parked agent (validation → rosters) when Sina schedules the tuning session; eyeball the 7 patterns whose amber did real work; run ChatGPT-returned files through `pattern_audio_harness.mjs` before trusting them | Sina (art) + parked agent |
| R3 | **Show program** — ambient default, scheduled party moments, detection-triggered party playlist, themed nights | Machinery DONE and now AUDITED (`_91`): sun/tz/festival math pure and DST-correct, precedence holds, 317/317 timeline tests green. **The CONTENT is the gap** — the on-disk `playa_default` is still template-shaped: 6 of 8 reachable looks load `default` (45/72 entries unreachable `summer_camp` names, 66/72 untuned), 9 of 13 playlists referenced by nothing incl. both tuned ones, `burn_night`/`temple` looks point at `default`, `daytime`+`party_low` are dead looks. Arc findings: a hold expiring lands on the autopilot baseline not the `ambient` defaultCue, and `c_party_start` owns the deck with no expiry sunset+120 → sunrise−15 (party ≈ 8 h, ambient the exception). Proposed theme table: `_88` §7 | **Dry-run harness LANDED (`_93`)** — `node tools/timeline_dryrun.mjs` reads a whole playa night back in seconds, offline, on the real (dormant) plan. It already answered §Phase 1.1 on the record and measured the arc: quiet night = `party` look 8 h 40 m and `ambient` **0 minutes**; night with music = `ambient` returns but the `party` look never comes back after the first session. **Next: Sina's arc review (§8 Phase 1.2)** with those printouts in hand, then look→playlist re-pointing (1.3), party-moment schedule (§Open 7) + theme culling (§Open 9). Also queued from `_93` §5: five report-only bugs, worst being a *suppressed* party fire consuming the arm latch | agent tooling → Sina curates |
| R4a | **Smokestack rope LEDs** — physical test | BLOCKED ON HARDWARE ACCESS | Sina schedules bench time; agent preps the test checklist (mapping, universes, patterns) | Sina + agent checklist |
| R4b | **TE sign** — physical test | BLOCKED ON ASSEMBLY | Same checklist treatment; test_bench mapping fix diagnosed (`20260725_4`), awaiting the §Open 6 mapping decision | Sina + agent checklist |
| R5 | **Autonomy & robustness** — boot, supervision, recovery, offline | STRONG BASE (deploy pipeline + supervisor + schtasks). Log disk-fill CLOSED (`_17`); VSN1 CRLF deploy-overflow fixed and MIDI attach state made first-class (`_31`) — the libuv abort's trigger environment is gone but the race itself is unpinned | **Sina, one git command:** `git add --renormalize .` (the 9 `.lua` templates are still CRLF in the tree). **Sina, step-11 sign-off** (`_30` §7 Q4): bounded launcher auto-restart on abort-class engine exits | Sina (renormalize + sign-off) |
| R6 | **Operator surface** — CaptainPad live-performance UI | SHIPPED and validated end to end: rounds 1+2 (`_11`), swap-wedge fix + hardening (`_14`–`_17`), surface trim + PARTY handling card (`_18`), adversarial validation and the D6 fix (`_20`/`_22`/`_23`), Studio-tab editor debug + fix (`_27`/`_28`) | Nothing agent-side. Needs his physical iPad for the Studio editor's remaining checks: smart punctuation, touch/magnifier caret drag, real keyboard geometry, felt Safari latency, one SAVE round-trip | done / Sina eyes |
| R7 | **LED strand tuning & mapping** — colour/white fidelity, controller onboarding | Colour path operator-ACCEPTED; white residual and firmware work PAUSED. Gamma is an operator control with sliders + a live curve and per-card / fleet push (`_25`/`_29`/`_64`/`_65`). The `_58` wave, `_71` port→output and `_87` no-restart subscription together make "map a universe → save → LEDs work" true with zero restarts | Waiting items **15·18·22** (one push), **17** (acceptance), **19** (gamma W veto). Open follow-ups: measure the strands' white-emitter colour temperature, reconcile the engine's LED controller host with the scene's, PSU/power-cap audit for the long RGB runs | Sina (eyes) + agents |
| R8 | **Titanic scene output mapping + bench section** | Phase A COMPLETE (`_34` sId/fId fix, `_35` parity validator, `_36` same-scene reload, `_37` bench-sync tool); chain-order splits + ⇄ Swap (`_42`) with the 3D chain visualisation (`_43`); the renumbering semantic was ratified by his own informed use 2026-07-29. **Phase B = his live mapping session, in progress since 2026-07-29** | Answer O1–O9 from `_33` §2 (especially the universe plan O3); do the one sim-save + re-export (waiting item 3); decide the deferred `_42` §6 items (esp. group-level "+ gen" bulk-add, which needs a yes against the 2026-06-11 no-group-add ruling); then Phase C = full-stack E2E + placeholder retirement | agents + Sina |
| R9 | **Sim render performance on the operator's box** | DIAGNOSED — NOT a code regression (`_38`): the sim was rendering on the Intel UHD iGPU (10 FPS) instead of the RTX 4090 (59.9 FPS). Visibility layer shipped (`_39`: adapter probe, red integrated-GPU banner, fire-once low-FPS error) with no auto-fallback; 2D Top-Down layout tweaks rode along (`_40`) | **The only thing still open:** Windows Settings → System → Display → Graphics → add `chrome.exe` → High performance → restart Chrome → confirm `chrome://gpu` shows the NVIDIA GPU ACTIVE. Avoid battery-saver while running the sim | Sina (setting) |
| R10 | **Generator editor UX** — select freeze, laggy move, name↔chain parity, rename hygiene | All three planned slices LANDED (`_45` select freeze 2,719 ms → ≤133 ms + cold move, `_46` parity surfaces + chimney-ring restore, `_47` rename hygiene = check-then-invalidate loudly), plus the mapping-pane and LED-menu ergonomics (`_50`/`_52`/`_55`), the Left Back Wall diagnosis (`_51`) and generator-move fixture sync with its Fable sanity PASS (`_83`/`_84`) | Operator gates only: waiting item 10 (migrate-addresses + step-11 refusal), §Open 12 (live-derived 2D defaults), and the `_44` step-17 chain-sort button + numeric bulk-add | agents + Sina |

## Existing base (don't rebuild)

- Audio companion (`marsin_engine/audio/companion/`): live capture, BPM,
  genre — sole OSC analyzer; mic recovery fixed (`20260725_7`/`_8`).
- Playlists: engine `config.yaml playlist:`, per-channel playlists in
  mixer/deck state, CaptainPad deck playlist UI.
- Autopilot + audio-reactive profiles: `autopilot_profiles_audio_reactive.md`,
  `autopilot_deck_improvement.md`, `deck_split_playlists.md` dossiers.
- Mapping/views program: `bm_readiness_mapping.md` (sub-project).
- Deploy + supervision: `deploy/deploy.py` → titanic-ext, schtasks
  `BM26TitanicStack`, verified restart-stable.

## Links

- **Archive of everything compacted out of this doc (2026-07-30):**
  `../reports/202607/20260725_88_master_doc_archive.md`
- Thread tracker (canonical state): `../memory/bm_readiness_thread_tracker.md`
- Sub-projects: `bm_readiness_mapping.md`, `autopilot_profiles_audio_reactive.md`,
  `deck_split_playlists.md`, `effect_tuning.md`
- Plans: `../plans/20260709_party_readiness_execution.md`
- Ops: `../ops/engine_model_refresh.md`, `../ops/sim_auto_checks.md`,
  `../ops/marsin_engine_auto_checks.md`
- Branch: `feat/bm_readiness` (pushed; last wave `3246deb2`)

## Decisions log

Most recent only — the full list is archive `_88` §8.

- **2026-07-29** — Standing model policy: **all sub-agents run on Opus unless
  the operator directly names another model** for a task.
- **2026-07-30** — Operator-ordered EXCEPTION to scenes-are-operator-owned:
  the coordinator manually fixed `simulation/scenes/titanic/` (5 ghost
  fixtures deleted, `Left Back Wall Generator*` → `Left Back Wall*` across
  scene/patches/views, 0 stale refs). Sticky-by-name held on his next save.
- **2026-07-30** — Standing order: doc inconsistency vs verified behavior →
  **fix and clean up on sight** (`doc_inconsistency_standing_fix.md`); first
  application `_57`.
- **2026-07-30** — Operator confirmed 2D-view framing persists to the SCENE
  (rides his save/autosave) — approved as-is, no localStorage.
- **2026-07-30** — **Commit + push authorized and done:** `3246deb2` on
  `feat/bm_readiness`, 441 files including reports `_47`–`_87`. Security check
  failed first on two full IPs in the fresh `_87` report, which were redacted
  to `10.x.x.60` before it passed.
- **2026-07-30** — **Operator ruling: scene config files (`scenes/**`) may
  carry controller IPs.** The checker already tolerates them; the redaction
  convention applies to `.agent/` prose, not scene data.
- **2026-07-30** — Operator ordered this doc compacted end-of-day, Threads
  board kept, the detail moved verbatim to a report — archive `_88`.

## Log

Every dated entry from 2026-07-27 through 2026-07-30 is archived verbatim in
`_88` §9. **New entries append here, newest first.**

- **2026-07-31 — `_120` WAVE 1 W1-1 follow-up LANDED (fix): L5 strict
  save-now.** Report `20260725_120_wave1_strict_save_now.md`. Closes the `_116`
  fix-7 handoff — the last piece of red-team `_115` L5. Scope owned exclusively:
  `lib/state_manager.js` (`save`/strict path + the three save-method signatures)
  + the `POST /settings/save-now` call site in `api_server.js` (no `engine.js`,
  `timeline/*`, `scenes/**`, `simulation/`, or the W1-1 WS/backstop code — that
  was left intact and built on). **Root confirmed:** `StateManager.save()`
  swallowed the atomic-write error with only a `console.warn`, so the
  deck/mixer/globals branch of save-now still reported a lying 200 `{saved:true}`
  on a disk-full/EBUSY write (the CaptainPad "✓ SAVED" badge reads that
  response). **Fix — a STRICT / BEST-EFFORT split at the save seam:** `save()`
  grows an options `{ strict = false }` (default warn-only, UNCHANGED;
  `strict:true` re-throws); `saveMixerState`/`saveDeckState`/`saveGlobalsState`
  thread the flag; in `api_server.js` `saveAllState(strict=false)` +
  `saveGlobals(withParams, strict=false)` thread it, and save-now calls
  `saveAllState(true)` + `saveGlobals(true, true)` so its existing (W1-1)
  try/catch now catches a real throw → honest 500 `{saved:false,error}`. **The
  ~80 AUTO-SAVE triggers pass nothing → best-effort, byte-UNCHANGED** — a
  transient disk blip during auto-save is still swallowed and can never reach
  W1-1's `exit(1)` backstop (no dark ship); the existing
  `state_atomicity.test.js` "failed write is swallowed" invariant still passes.
  **The L5 lie is now an honest non-200.** **Suite:** full engine **2524/8** =
  the SAME 8 known environmental baseline (audio-capture framing ×2, OSC
  lifecycle/EADDRINUSE ×4, effects_v2 layout ×1, specialty-playlist parity ×1 —
  none touch `state_manager.js` / the save paths; **zero new failures**). +8 new
  green tests: `tests/state/strict_save.test.js` (7, deterministic strict/
  best-effort seam over a dir-replaced-by-a-file) + `tests/e2e/
  save_now_honesty_e2e.test.js` (1, real engine subprocess: save-now → non-200
  on the broken dir while a `/global-blackout` auto-save over the SAME dir stays
  200 and the engine survives; timeline DISABLED to isolate the deck/mixer/
  globals path; imports `setup_config_guard.mjs`). `config.yaml` CLEAN vs HEAD;
  spawned engine black-holed via `MARSIN_CONFIG_FILE`, state redirected via
  `MARSIN_STATE_DIR`; zero device HTTP, zero sACN, operator stack untouched; no
  git ops.
- **2026-07-31 — `_118` WAVE 1 W1-3 LANDED (fix): pattern-VM "never black"
  enforcement + `_90` audit-harness hardening.** Report
  `20260725_118_wave1_pattern_never_black.md`. Family I of the red-team campaign
  — sits on the LIVE ChatGPT pattern loop. Scope owned exclusively:
  `lib/pattern_mixer.js` + `tools/pattern_audio_harness.mjs` (no `engine.js`,
  `api_server.js`, `timeline/*`, `simulation/`, `scenes/**`, `patterns/**`).
  **I1 (P0) + I2 (P0) — runtime R4 enforcer.** The vendored WASM absorbs a NaN
  (any one arg to `rgbwau()`/`hsv()` blacks the whole pixel and is absorbing in
  persistent state) or a `beforeRender` budget overrun (truncates silently, the
  palette resolve never runs → black ship) into a black composite with no
  signal; and the NaN is already `0` before JS sees a byte, so per-channel
  sanitising is unreachable — enforcement is on the CONSEQUENCE. New
  `_enforceNeverBlack()` in `renderAll6ch()` (the exact buffer engine.js emits):
  counts consecutive fully-black-while-lit frames — gated by `_isExpectingLight()`
  so a legit operator blackout is never flagged — and at 8 frames (0.2 s) LOUDLY
  trips `renderHealth` (naming the deck pattern) AND writes a dim last-resort
  floor (10/255) so the ship is never shipped dark without
  `/status.renderHealth.ok=false`; auto-recovers when light returns. Plus a
  solid-red detector (`_112` F9). **Proven end-to-end through the REAL WASM** —
  NaN-arg, absorbing-NaN, and beforeRender-overrun all compile clean and trip.
  **I2 honest finding:** `marsin_begin_frame` is compiled `void` (verified) with
  no error set on truncation and no C source to re-vendor, so a direct ABI
  truncation channel is impossible; the black outcome is caught by the enforcer,
  a wrong-but-non-black truncation only offline by the harness. **I4 (P1) — the
  `_90` harness can now FAIL:** `--gate` exits 3 with a NAMED reason on DARK
  (fails `evil_black`), BLACK_LATCH (renders 600 frames past the clip — fails the
  `evil_sleeper` post-window latch), OVER_BUDGET (MEAN VM frame time >
  budget/mix-channels, default 25/4=6.25 ms). Verdict always PRINTS; only
  `--gate` changes the exit code (clip/gif tooling unaffected). Shipped patterns
  stay green on titanic (worst `26_dom_dancers_chevron` mean 4.56 ms → PASS).
  **Operator: add `--gate` to the `_90` recipe's two harness runs.** **Suite:**
  +16 new green tests (7 enforcer + 4 real-VM e2e + 5 harness-gate); zero new
  failures from this thread (full run 2520/2510/10 = the 8 known baseline + 2
  sibling `tests/timeline/overview_perf.test.js` J1 perf tests that PASS in
  isolation, uncoupled to this work). `config.yaml` + `patterns/` CLEAN; zero
  device HTTP, zero sACN, no git ops. **Handoff to W1-1:** never-black is ALREADY
  on `/status` (`getRenderHealth()` folds `darkness` into `ok`); standalone
  `mixer.getNeverBlackHealth()` provided for `/timeline/state` + the launcher
  watchdog.
- **2026-07-31 — `_117` WAVE 1 W1-2 LANDED (fix): launcher supervision &
  watchdog — the `_115` L1/P0 capstone.** Report
  `20260725_117_wave1_launcher_watchdog.md`. Scope owned exclusively:
  `simulation/start.js` + `launcher.js` (+ one additive fail-loud line in
  `simulation/lib/load_ports.cjs` for the override — the only path the port map
  reaches the child servers). **L1 CLOSED — dark ship / green dashboard is
  over.** `start.js` was blind to its children's death (it only `console.log`'d
  an exit) and `launcher status` probed only :6969/:6968, so `kill -9` on the
  save server or either sACN bridge left the rig dark with every surface green.
  Now `start.js` is a real supervisor: DEATH and FREEZE (3 missed 10 s health
  probes on a live child) are detected → bounded restart (5/60 s) →, past
  budget, **loud escalation** (`exit(1)` → launcher teardown → show-server
  supervisor relaunch) instead of a crash-loop fallback. `launcher status` now
  probes EVERY child (save/sacn-in/sacn-out via a 426-aware, census-neutral GET
  — a `ws` bridge answers a plain GET 426, and a bare GET fires no `connection`
  event so it never pollutes the input bridge's sim-window census) AND reads the
  bridge's `packets/5s` for frame-flow, so a dark/wedged server reads **RED** and
  green means frames flow. **L4:** `checkPortFree` bind-probes BOTH families
  (IPv4 `0.0.0.0` + IPv6 `::`) — the IPv4-only-squatter shadowing is caught
  (repro'd then fixed). **L6:** `validate()` moved BEFORE the destructive
  `assertSingleInstance`/`-f` takeover — a scene typo no longer kills the show
  first. **P2-6:** new **`BM26_SIM_CONFIG`** override (fail-loud, `MARSIN_CONFIG_
  FILE`-style) points launcher + start.js + save-server + both bridges at
  throwaway ports; `main()`/boot guarded behind `require.main`, pure helpers
  exported. **Suite 1645/8 → 1663/8: +6 green, ZERO new failures** (the 8 are
  the known baseline, byte-identical set). Live-proven: watchdog restart on a
  real `kill -9` (fresh pid, `exited unexpectedly` logged); sACN-out kill →
  `status` line **❌ not green**; frame-flow warned of a dark rig. Ran entirely on
  786x/787x + UDP 7568; operator :6969-:6972 byte-identical (same PIDs 35692/
  17308/38388/50272), throwaway orphans swept, `config.yaml`/`scenes/**`/engine
  untouched. **No git ops** — landed on the uncommitted `feat/bm_readiness` tree.
  **Flagged for later (out of these two files): a census-neutral `/health` on
  both sACN bridges + a frame/output indicator on W1-1's engine `/status`** would
  let the watchdog verify frames continuously (today freeze/death is continuous,
  frame-flow is an on-demand `status` advisory); and `_115` P2-3 (status/stop
  refuse on a corrupt lock) is unowned.
- **2026-07-31 — `_119` WAVE 1 W1-4 LANDED (fix): sim save-server &
  controller-probe crash-proofing + save honesty.** Report
  `20260725_119_wave1_saveserver_hardening.md`. First Wave-1 fix thread of the
  operator-greenlit ("go") red-team campaign. Scope owned exclusively:
  `simulation/server/save-server.js` + `controller_probe_service.cjs`.
  **`_109` P1-1 (Family A) CLOSED and the process-kill is now SURVIVED** — the
  malformed `POST /controllers/probe` with `timeoutMs:-1` used to reach
  `socket.setTimeout(-1)` on a still-connecting socket BEFORE its `error`
  listener existed, so the later socket error was unhandled → whole save-server
  exited (saves/backups/gamma/probe all die). Fix: the route now validates
  `timeoutMs` (finite, `>0`, `≤60 s`) → 400; `tcpProbe` attaches `on('error')`
  before `setTimeout` and catches the throw → honest UNKNOWN; process-level
  `uncaughtException`/`unhandledRejection` backstops log NAMED and exit (no
  half-alive run; auto-restart is W1-2). **P1-3:** the "1.2 s ceiling" was an
  IDLE timeout a slow-drip host held 10.4 s and wedged every later sweep — added
  an ABSOLUTE per-probe deadline (TCP + HTTP) + a 256 KB response cap. **`_115`
  L5 save-honesty:** every save-server write path now returns a NAMED non-200 on
  failure (was bare `Error`) — proven a failed disk write answers
  `500 Error: …`, never `200 Saved`. **Endpoint hardening:** 1 MB body cap (413),
  non-object body (incl. the `null`→TypeError→kill vector) → 400, garbage → 400.
  **Suite 1645/8 → 1657/8: +12 green, ZERO new failures** (the 8 are the known
  baseline, byte-identical). New tracked tests: `save_server_hardening.test.js`
  (spawns the real server on a random port + throwaway `~/tmp` root) and probe
  module tests. Repro `~/tmp/redteam_controller/04_probe_crash_repro.mjs` all
  green. Test-only env hooks `SIM_SAVE_SERVER_PORT`/`SIM_SAVE_SERVER_ROOT`
  default to production paths when unset. Zero device HTTP (loopback + RFC 5737
  `192.0.2.x`), zero sACN, operator ports never touched, `marsin_engine/
  config.yaml` CLEAN. **No git ops** — landed on the uncommitted
  `feat/bm_readiness` tree for the operator to review.
- **2026-07-31 — `_103` RED-TEAM (report-only): the timeline / arbiter /
  party-session subsystem was hammered with the `_93` dry-run harness; 1 HIGH,
  1 MED, 5 LOW, no CRITICAL.** Report `20260725_103_redteam_timeline.md`, repros
  `~/tmp/redteam_timeline/`. No engine spawned (harness is offline, writes only
  `~/tmp/timeline_dryrun/`); `config.yaml` CLEAN vs HEAD, no device/sACN/stack
  touched. **The trigger/arbiter/festival/sun cores HELD** (DST fall-back
  de-dupe, polar-safe defaultCue, overlap rejected at load, exact festival
  day-gating + loud out-of-window, missing playlists fail loud, edge-storm dwell
  defence, `_98` arm-latch confirmed on burn night). **H1 (HIGH — deck-thrash):
  the mood→party cue has NO "I already own the deck" idempotency guard — a
  detector that dips-and-returns re-arms it (`triggers.js:284`) and at the
  shipped dwell (20 s) it re-fires while its own session is live; each re-fire
  re-runs the look and `timelineLoadPlaylistOnDeck` (`api_server.js:4372`) always
  reloads pattern-1 with a transition swap → the exterior resets on every music
  gap all party night** (harness: 60 re-fires / 1 window-elapse in 5 h on a
  realistic 3-on/2-off flap). **M1 (MED, same root): the re-fire re-stamps
  `_deckWindowUntilMs` (`timeline_service.js:845`) so a 12-min-session +
  2-min-cooldown becomes one endless session — cadence + cooldown silently never
  run.** LOW: `mood` `from===to` silent dead cue; `hold.until` a past anchor →
  ~zero hold; two same-time PROGRAMS double-dispatch + the earlier hold silently
  discarded (overlap validator ignores `hold`); DST spring quirk (off-playa);
  harness mis-counts `party-config` as a session end. Coordinator: H1 first
  (idempotent re-fire no-op + same-playlist load short-circuit); M1 rides it.
- **2026-07-31 — `_107` RED-TEAM (report-only): the fixture / model / patch layer
  was hammered; 2 HIGH, 2 MED, 2 LOW, no CRITICAL.** Report
  `20260725_107_redteam_fixtures.md`, harnesses `~/tmp/redteam_fixtures/` (pure
  parity-lib inputs + `gen_te_sign_fixture.js --dry-run`; **zero source edits,
  zero writes to `scenes/**`/`models/**`/`dmx/fixtures/**`**, no stack run).
  **Both HIGHs are in `scene_model_parity`'s LED lane — the gate is blind to two
  silent classes its DMX lane already catches. HIGH-1 (silent-mispatch, the `_92`
  RGB↔RGBW class re-opened): chain an RGBW TE sign on a MarsinLED output set
  `order: RGB` and the exporter emits stride-3, white-less pixels that pass
  `--strict` CLEAN** — parity discards the LED-bus fixture DEFINITION's declared
  physical format (`channels: ledBus ? undefined`; no `channel_mode` cross-check)
  and takes the controller order as sole truth, firing only when model &
  controller disagree. **HIGH-2 (silent-dark, patched-but-unroutable): a
  strand/LED-bus fixture chained on an UNBOUND LED controller (no `device:`
  block) with a stale patched record+model passes clean** — parity never reads
  `controller.device` and has no LED analogue of DMX's
  `patch_record_disagrees_with_chains`, so a rope a fresh export would render DARK
  reads green. MED: address-hygiene models an LED-bus fixture as one
  `def.footprint` DMX block (ignores `record.segments`) → false out-of-range +
  missed spill-universe collisions on larger LED-bus fixtures; `ledStride()`
  accepts a sub-minimum stride the sim refuses to boot on (misleading diagnosis).
  LOW: te_sign `SHARED_PANEL` message spam + role-annotation mislabel;
  LED-bus footprint never cross-checked (root hook for HIGH-1). **What HELD:** the
  te_sign generator (every malformed CSV fails loud; the degenerate all-same-coord
  case is caught before the divide-by-zero normalization path), `orphan_fixtures`
  (strict `=== true`, rename-safe ownership, no guessing), parity's DMX lane, and
  the `_48`/`TE Sign 2` name-drift protections (via `pixel_map_view_defaults.test.js`,
  shipped-defaults only). Recommended fix order: HIGH-2, then HIGH-1, then MED-1.
- **2026-07-31 — `_108` RED-TEAM (report-only): the engine HTTP/WS API contract +
  CaptainPad client — malformed requests, protocol races, enum drift, concurrent
  writers, reconnection storms — was attacked; 1 CRITICAL, 1 MED, 4 LOW.** Report
  `20260725_108_redteam_api.md`, repros in `~/tmp/redteam_api/` (`probe.mjs`,
  `ws_crash.mjs`). Every engine black-holed via the `_100` harness and asserted so;
  **no source touched, zero device HTTP, zero sACN to hardware, operator stack
  untouched, `config.yaml` CLEAN vs HEAD.** **CRITICAL (engine-crash, the `_99`
  sibling): one malformed WebSocket frame crashes the whole engine.** None of the
  four `/ws/*` `WebSocketServer`s (nor the transitional `/` alias) attach a
  per-connection `ws.on('error')` — only `wssInst.on('error')` + `server.on('error')`.
  An invalid-UTF-8 text frame (also: reserved opcode, oversize control frame, bad
  close code, RSV1) makes `ws` emit `'error'` on the socket instance with no
  listener → uncaught throw → `process.exit`, and there is no
  `uncaughtException`/`unhandledRejection` handler anywhere in engine.js/api_server.js.
  Proven live on `/ws/control` AND `/ws/params`. **Ship-dark with no self-heal:**
  `launcher.js:623`'s child-exit handler does NOT restart a crashed engine — it
  `teardown(1)`s the entire stack. No malice required (a WiFi-corrupted frame
  suffices). Fix: classified non-fatal per-socket `ws.on('error')` on all four
  servers (the `_99` shape) + a per-topic frame-violation regression test.
  **MED (enum-drift): the `effectiveState` enum is a hard engine↔pad coupling** —
  `parsePartyConfig` throws on any value outside the 6 known. No live drift today
  (producer closed to 6; all 3 pad consumers wrap the throw → no crash, degrades to
  a loadError) but a future 7th engine state puts every older pad's PARTY card into
  a permanent error banner on a healthy engine — the exact fragility `_98` §8.3
  worked around. Fix: pass an unknown `effectiveState` through and let
  `describePartyStatus`'s `default:` branch derive; keep the throw for type
  violations only. **LOW: `POST /timeline/takeover` silently coerces a non-object
  body into a plain takeover (200 not 400)** (fallback shape); concurrent
  `takeover(perform)`+`travel` both 200 (last-writer, momentary response lie,
  broadcast reconciles ≤1 s); `/timeline/resolve` over-long query → 431 empty
  (non-JSON) body; `/timeline/resolve` routes by `startsWith`. **What HELD:** the
  REST surface is genuinely hard — hundreds of malformed/OOR/unicode/traversal/
  `__proto__`/huge payloads across takeover/travel/resolve/party-config/plans →
  clean verbatim 400s, no 500 on input, no unhandled rejection, no silent clamp;
  `festival.days` bounded [1,31] (no `buildOverview` wedge); WS `message` handler
  try/caught; 60× reconnection storm + garbage/oversize *text* frames survived.
- **2026-07-31 — `_106` RED-TEAM (report-only): the LED controller lifecycle —
  provisional binding, promotion/reconcile, ONLINE/OFFLINE status probes, and the
  six-layer push/save chain — was attacked; 2 HIGH, 3 MED, 3 LOW, no CRITICAL.**
  Report `20260725_106_redteam_controller.md`. All repros pure Node against the
  real modules with injected transports; **no device HTTP, no sACN to hardware,
  no scene writes, operator stack untouched.** **HIGH-1:** `provisional_binding.js`
  documents `ip_mismatch` as a first-contact contradiction, but on the provisional
  path it is DEAD CODE — provisional cards match by IP only and every promote path
  sets `device.ip = controller.ip`, so a mistyped/DHCP-shuffled IP AUTO-VERIFIES a
  card against whatever board answers there, catchable only by the OPTIONAL
  boardId/deviceName expectation. **HIGH-2:** the default-ON auto-sweep
  (`applyControllerProbeResults`) re-raises the reconcile dialog every ~20 s for an
  online-but-contradicted provisional card with no de-dup → unbounded modal
  stacking, and a stale stacked dialog's "Promote anyway" throws uncaught inside
  `ctx.mutate` once the card is verified. **MED-1:** a push whose scene-save fails
  leaves a GREEN "In sync" chip and the next recompute drops even the tooltip
  warning (disk stale, LEDs dark, surface green — the _58/_60 shape the loud push
  path otherwise closes). **MED-2:** promotion consumes a possibly-CACHED
  fingerprint (probe cache `type:ip`, 5 s TTL) so a same-IP hot-swap binds to the
  previous board. **MED-3:** ECONNREFUSED/RST is always ONLINE (reject-firewall /
  DHCP squatter reads green; drop-firewall on the same dead box reads OFFLINE).
  LOW: registry-omit skips the `controller_id_claimed` blocker; the push
  double-notifies the bridge; the 1.2 s status deadline flaps cold boards.
  Recommended first fixes: gate unattended provisional promote on a stated
  expectation or a confirm (HIGH-1); per-card dialog de-dup + stale-dialog no-op
  (HIGH-2).
- **2026-07-31 — `_104` RED-TEAM (report-only): the timeline ZOOM surface —
  day/event zoom, time travel, the lease + exit machine — was attacked; 1 HIGH,
  2 MED, 2 LOW, no CRITICAL.** Report `20260725_104_redteam_zoom.md`. **The
  engine's "never stuck" invariant HELD** — I could not build a zoom the rig
  can't leave (resume nulls the lease before catchUp and catches its throws; the
  tick releases expired + self-heals orphaned leases; the boot scrub runs
  synchronously before the first broadcast; `_goDormant` drops an expired travel
  lease; malformed `/timeline/travel` all 400 pre-mutation). **The break is on
  the PAD (A1, HIGH):** `_zoomExitRequested` is a module-level exit-claim latch
  set UNCONDITIONALLY by `_resume()` (`useTimeline.ts:171`) — which is ALSO the
  plain-takeover RESUME NOW (`resumeNow: resume`, used by deck + PlanLockBanner)
  — and it is only ever cleared by `clearZoomClaims()` on a zoom→null transition
  in `ZoomBanner.tsx:88`. A plain takeover has no zoom, so the flag leaks true;
  the next real PERFORM/TRAVEL zoom that the ENGINE ends (lease expiry / restart
  / AUTO OFF / maker save) is then read as `ours:true` → the "Zoom ended — the
  plan resumed" toast + auto-nav is SUPPRESSED and the operator is stranded on a
  deck they no longer own. Inverts the exact `_97` §3.4 protection; the unit
  test only covers the pure `shouldAnnounceZoomEnd`, not the leaky latch feeding
  it. **A2 (MED):** confirms `_100` F1 — the scoped lease IS written to
  `timeline_state.yaml`; only the one-line boot scrub prevents a ghost PERFORM
  banner on reboot (I verified the scrub's synchronous ordering, so latent not
  live). **A3 (MED):** the D3 "Show due: X — starts when you exit" banner keeps
  promising a show that `_catchUp` SILENTLY SKIPS if you linger past the cue's
  hold — and then EXIT (skips) and ENABLE (fresh hold, plays) diverge. **A4/A5
  (LOW):** engine doesn't check a PERFORM `cueId` is the live cue (spoofable
  banner label); travel steppers' strict `>`/`<` make co-timed cues
  unreachable. Report-only; **`config.yaml` CLEAN vs HEAD** (no engine spawned —
  static code-path analysis), no `:6967`/`:6969-:6972` or device touched, no git
  ops.
- **2026-07-31 — `_105` RED-TEAM (report-only): the sACN bridge surface was
  hammered with pure-module harnesses; 1 HIGH, 3 MED, 3 LOW, no CRITICAL.**
  Report `20260725_105_redteam_bridge.md`, repro `~/tmp/redteam_bridge/harness.mjs`
  (41/41, no sockets, no Sender, **no sACN frame toward hardware**, zero device
  HTTP). **The one that can bite the show: a universe > 63999 in the LIVE
  hand-edited `📡 Subscribed Universes` field (`common.yaml` is `1..37` today)
  or a corrupt `patches.yaml dmxUniverse` bypasses the boot accept-list — neither
  `parseSubscribedUniversesField` nor `patchRecordUniverses` enforces the E1.31
  ceiling — reaches `new Receiver`, `multicastGroup()` throws `RangeError`, and
  `classifyReceiverError` calls it FATAL → the whole input bridge
  `process.exit(1)` at boot.** The runtime diff path (`computeUniverseSubscriptionDiff`)
  buckets the identical value as invalid and survives, so the two paths disagree:
  a bad save looks fine at runtime and kills the NEXT boot with a misleading
  "socket FAILED" line. MED findings: a truncated `segments[]` silently drops a
  spill universe (no anomaly — the `_87` dark class one field deeper); the bench
  mirror never subtracts its `dest_host`/dest-universe from the engine-owned set
  and doesn't validate `dest_host` against real controllers (latent double-write
  vs the one-writer law); and `composeUnifiedFrame` doesn't self-guard same-IP
  contests. LOW: leading-zero-octet decimal/octal divergence, boot gate replays
  only the last deferred reason, multi-NIC = OS coin-flip by design (pin
  `sacn_interface`). **What held:** the `_99` boot gate + double-join invariant,
  route-diff flap-freedom, merge intersection off-by-one at both edges, runtime
  range enforcement + per-universe isolation, bench-mirror validation/gating,
  field-parser parity. All findings are report-only; the operator/coordinator
  decides which to fix (H1 is the recommended first — a one-line ceiling guard
  in the two boot-list builders closes it).

- **2026-07-31 — `_102` LANDED: sending to the same address is a WARNING now,
  and the wire decides it deterministically.** Report
  `20260725_102_same_address_merge.md`. Operator order: *"make controllers allow
  sending to the same address with a warning instead of an error — and for those,
  make sure you unify the packets and then send; if conflicting, prioritize
  higher IPs and override"*, plus the emphasis *"but the UI must show that
  that's a warning."* **The sweep found exactly ONE hard refusal** —
  `derivePerOutputPlan`'s `universe_owned` collision, which blocked the single
  push, the fleet push and the sync chip alike (three other overlap sites —
  `validateLedManualUniverses`, the registry's per-universe overlap sweep, the
  bridge's cross-scene conflict — were already warnings and are unchanged).
  New pure module `simulation/src/dmx/address_merge.js` owns the rule end to
  end. **The merge:** an overlap is same-universe-and-intersecting-range, the
  contested region is the **intersection only**, each `(universe, destination
  IP)` gets **exactly one packet**, and on a contested channel the **numerically
  higher controller IP overrides**. The comparison is **octet-wise numeric and
  the distinction matters here**: two boxes in one `/24` ending `.9` and `.10` sort
  the WRONG way as strings (the `.9` one comes out higher), which is
  backwards, and `a*2**24` is used rather than `a<<24` because JS's signed shift
  would rank every ≥`128.x` address below every `10.x`. Global-effect pins stay
  exempt — gang-firing foggers on one address is the operator's own 2026-06-12
  ruling, not a contest. **The UI requirement is met as a standing state, not a
  toast:** a PERSISTENT amber banner on the affected controller card naming both
  claimants, the exact `(universe, ch a–b)` and who wins; the push dialog carries
  a `⚠ N SHARED ADDRESSES` block placed **first**, above even the saves-the-scene
  notice, because it is the one line on that plan that changes what OTHER
  hardware sees; the sync chip stays `in-sync` (a share does not make the device
  differ from the plan — that is what the chip measures) but carries the warning
  in its tooltip; and `[AddressMerge]` logs fire on every transition so an
  operator who never opens the pane still learns of it. **The override cannot be
  decided by render order:** the loser is handed the absolute channels it must
  not write (index built once per projection, resolved once per pixel, keyed by
  IP because a pixel knows its controller IP and its channel but not which
  projection record it came from) — including the par master-dimmer force-write,
  which would otherwise blast the winner's fixture to full. **Deliberate
  asymmetry kept:** an EXPLICIT operator-declared universe may be shared, but the
  auto-assign paths (universe repair, park allocation) still skip every claimed
  universe — the sim never *chooses* to create a shared address, it only honours
  one he declared. **It composes WITH `_89` rather than against it:** the bench
  mirror unifies at the bridge (owning its destination pairs, suppressing the raw
  relay), this unifies at the sim (one packet per destination, one winner per
  channel) — same doctrine at two layers; `server/sacn_bridge.js`,
  `bench_mirror.cjs` and `bridge_routing.cjs` are untouched and `git status`
  confirms the uncommitted `_89`/`_99` work is intact. Sim suite 1592 →
  **1645 (+53), fail 8 → 8**, the known baseline with a byte-identical list;
  the new tests include **byte-level frame composition** and a control case
  proving that *without* the merge the render order decides — the defect this
  closes. Security PASS; one self-inflicted finding was caught and fixed en route
  (a real routable address, first octet 128, in an IP test — swapped for an
  RFC 5737 TEST-NET-2 address, which still proves the unsigned-above-127 point).
  **LIVE-PROVEN, 13/13 checks + four screenshots**, on the operator's own sim
  via a new `agent_tools/shared_address_verify.cjs`: the sACN OUT socket blocked
  before the first page script and *asserted* at `framesSent = 0`, zero device
  HTTP, zero scene writes (the overlap is injected into the in-memory registry
  with RFC 5737 TEST-NET IPs and removed again — the last screenshot shows the
  pane back exactly as it was). On the wire, both render orders composed to the
  identical frame with the `.10` box owning the contested channels, and each of
  the two controllers got exactly one destination — no racing packets.
  **RESIDUE REPORTED, NOT HIDDEN (report §9):** the probe's first runs — before
  I added the save-server guard — re-exported `marsin_engine/models/test_bench.js`,
  because `main.js` calls `saveModelJS()` on page boot. Not a regression: the diff
  is the timestamp plus the 76 TE-sign pixels flipping `dmx` → `led`/`unpatched`,
  which is the `_92` correction landing in the export, and the suite is
  byte-identical either side of it. Left in place (never `git checkout` to hide a
  test side effect); the probe now aborts every non-GET to :6970 per the `_89`
  GUARD-3 recipe, re-verified at 4 writes aborted / 14-of-14 checks / model
  byte-identical. Separately flagged and **not mine**: `scenes/common.yaml` has
  `lightingMode: sacn_in → pixelblaze` sitting uncommitted, mtime three quarters
  of an hour before my first page load.
  **TWO OPERATOR DECISIONS handed back:** a **same-IP** overlap and a **no-IP /
  placeholder-IP** overlap are still HARD ERRORS with the reason named, because
  his rule ranks IP-BEARING claimants and inventing a tie-break for the rest
  would be precisely the fallback the codex forbids. If either should resolve
  automatically, the rule has to come from him. **Memory amendment proposed
  (report §7):** `sacn-route-ownership`'s flat *"one writer per (universe,
  controller) is the law"* is no longer the whole truth — it is still the law on
  the wire, but it now has TWO enforcers (the bridge's suppression, and the sim's
  merge), and the sim preserves it by MERGING rather than by refusing.

- **2026-07-31 — `_100` LANDED: the timeline-zoom e2e suite (S5). The S1–S5
  wave is CLOSED.** Report `20260725_100_timeline_zoom_e2e.md`. 17 scenarios,
  17 green, driving a **real `engine.js` subprocess** over real HTTP and real
  `/ws/control` sockets, restarted by really killing it — the
  `tests/timeline/*` family pins the LOGIC, this pins the WIRING. **The two
  exit paths `_97` could never reach live are now covered.** *Engine restart
  mid-zoom, both scopes:* the process dies, and the rebooted ship has no zoom,
  no lease, mode `armed`, the plan back on the deck — and a **reconnecting pad
  sees the truth on its very first frame** (the connect replay), which is what
  stops a stale PERFORM banner surviving a reboot. *Plan save mid-zoom:* the
  maker's auto-save over the active plan hot-reloads, drops the zoom, returns
  the deck to the plan-at-now, and the pad learns it **from the broadcast** —
  it never asked for that exit. Every other exit-table row is covered too;
  the single remaining row (festival window closing) is UNIT-only for a stated
  structural reason — every e2e route to it goes through `savePlan`/`activate`,
  which are themselves exits, so the scenario would assert the wrong row. Its
  observable consequence (a PERFORM cannot exist out of window) IS covered.
  **Two clients:** B gets the banner on its replay, B *browsing* changes
  nothing, B retargets the ONE session and A renders the identical zoom, B's
  EXIT ends it for both. **`_97`'s exit race pinned e2e** — the cleared-zoom
  broadcast genuinely beats the `resume()` response, so the pad's pre-staked
  exit claim answers a real ordering rather than a hypothesis. **`_98` fix 1
  proved on a real engine with a real mood feed:** a party fire during a
  PERFORM lease is suppressed, *visible* (`wouldFire`, edge-only — one entry
  per episode), and consumes NOTHING — latch intact, cooldown unstamped — so
  the session fires the instant the operator hands back. **The `--dest` trap
  is closed at the source.** `_97` streamed 30 s of live sACN to the real rig
  believing `--dest` black-holed it; the honest problem was that
  **there was no way to neutralise the per-controller `controllers:` block** —
  `engine.js` read the tracked `config.yaml` unconditionally. `MARSIN_CONFIG_FILE`
  now governs the BOOT read as well as the autopilot write-back (fail-loud on a
  set-but-missing path), so a harness writes a black-holed config instead of
  editing his file — the exact edit `_98` had to flag as a commit blocker. New
  `MARSIN_TIMELINE_DIR` likewise means a test engine can no longer write show
  plans into `scenes/**`. Both walls are **asserted on every boot**, not
  assumed. **One real bug found + fixed (B1, in `_95`'s S1 code):** the day
  ribbon sampled only where cues START — never where they HAND BACK — so a
  segment ran from a cue's fire time to the next unrelated boundary. On the
  shipped plan that reported a 90-minute program hold as owning past its end;
  on the fixture it mis-stated **2 h 10 m**. That is exactly the stretch `_98`
  FIX 7 gives the ambient `defaultCue` — **the surface built to make the plan
  honest was lying about the biggest thing `_98` changed.** Fixed in
  `buildDaySegments` (sample `windowUntilMs` + `holdUntilMs`), pinned by three
  tests including a full ribbon-vs-resolver equivalence walk, and guarded e2e on
  his real `playa_default`. GATES: timeline 407 → **410/410**, full engine
  2470/2478 (the 8 baseline, zero new), CaptainPad **914 = baseline**, security
  PASS, **`config.yaml` clean — nothing to restore**, his sim stack on
  :6969-:6972 never approached. **Two findings reported, not fixed:** (F1) the
  "runtime-only" zoom lease IS written to `timeline_state.yaml`, scope and all —
  only the boot `_catchUp` scrub stands between it and a ship that wakes up
  thinking a human has the deck (the scrub works, and is now the thing pinned);
  (F2) entering ANY takeover — plain or PERFORM — stands the deck's pattern
  autopilot down, so a look stops cycling while you perform under it. Worth his
  ruling; not a zoom-path defect.

- **2026-07-31 — `_92` CORRECTION: the TE sign pucks are RGBW, not RGB — "same
  lights as the ropes".** Operator: *"sign is also RGBW, same lights as the
  ropes."* The addendum entry below told him to set the MarsinLED output's
  channel order to **RGB**; that was wrong and is retracted — the corrected
  instruction is **RGBW / stride 4, the same setting the rope outputs already
  use**. Audit result: **no byte-level bug existed.** For an LED-bus fixture the
  stride and channel map come from the owning controller's `led.order` (for a
  sign exactly as for a strand), so the wire would have been right either way —
  `led_fixture_kind.js` counts PIXELS not bytes, the exporter takes
  `footprint: ledProj.stride`, and the parity gate cross-checks stride against
  `ledStride(controller)`. What was wrong was every number a HUMAN reads: the
  definitions' `channel_mode` (120/102), their per-pixel `{red,green,blue}` map
  and `type: "rgb"`, the channel count baked into the FILE NAMES, the
  `20260725_13` pattern-catalog row, and my mapping instruction. Fixed: the
  generator gained `BYTES_PER_PIXEL = 4` / `PIXEL_FORMAT = 'rgbw'` threaded
  through footprint, the per-pixel quad, the controls block and its summary
  line; definitions regenerated and renamed **`model_a_160.yaml`** (40 px × 4 =
  160 ch) and **`model_b_136.yaml`** (34 px × 4 = 136 ch) with `type: "rgbw"`
  and `channels: {red: 4i+1, green: 4i+2, blue: 4i+3, white: 4i+4}`; `main.js`'s
  4 registration refs repointed (sequenced new → repoint → delete-old so no page
  load could ever fetch a missing file while he was testing); catalog row
  corrected. **Geometry byte-identical** — same 148 points, same wire order,
  same shared normalisation. Corrected arithmetic: one whole sign is **296 ch**
  (not 222) and still fits one universe, with 216 ch of headroom. Two new
  regression tests pin RGBW at 4 bytes/px and tie it to the stride every titanic
  LED controller runs, so the generator cannot quietly fall back to 3. Sim suite
  **1590 tests, 8 fail = the baseline 8, zero new**; parity **unchanged at 4
  `unmapped_fixture`**. No server started/stopped/reloaded, no scene file
  written, zero device HTTP — his next hard reload picks up the RGBW
  definitions. Correction section appended to
  `20260725_92_te_sign_patch_model_fix.md`.

- **2026-07-31 — `_97` LANDED: the timeline zoom ladder is on the pad (slices
  S3 + S4).** Report `20260725_97_timeline_zoom_pad.md`, built against `_95` §3;
  **zero engine changes**. **S3 — DAY ZOOM.** The 8-day strip's day cards now
  ZOOM IN on tap (`OPEN DAY ▸`), replacing the old select-vs-`EDIT DAY` split —
  two gestures with two invisible meanings was exactly the 3 a.m. problem the
  operator flagged. The `DayEditor` modal was **promoted into a full-screen
  `DayView`** carrying everything it had (agenda, ＋ CUE, per-row edit/delete
  into the existing `CueEditorSheet` — *no new edit semantics*) plus the two
  things a REVIEW needs: **phase bands**, where a band whose end precedes its
  start is drawn as TWO pieces across midnight (`party_night ⤵` — drawing it as
  one inverted rectangle renders *nothing*, and a whole night would have read as
  empty), and the **resolved ribbon** with a plain-language reason per segment
  (`the cue owns the deck` / `gap — the plan default cue` / the amber
  `⚠ hold expired — the autopilot baseline plays under the cue`). The engine's
  calendar-day limit is **stated on screen**, not faked: "the ribbon resolves
  this CALENDAR DAY only". Missing `phases`/`segments` produce a loud red block,
  never an empty ribbon passed off as a review. Theme badges ride on the day
  cards; the `SHIFT TONIGHT` slot is reserved, dashed and labelled inert (D8).
  **S4 — EVENT ZOOM.** One sheet, one primary action, branch chosen by the
  ENGINE (`activeCue`) **and scoped to TODAY's card** — a cue-id-only comparison
  offered "perform tomorrow's show" and was caught by the live pass. PERFORM is
  withheld out of window (takeover refuses to arm there; a button that can only
  400 is a lie), while TRAVEL stays available while the plan is **dormant** —
  the rehearsal case, and the rig's state today. A global `ZoomBanner` mounted
  outside `<Tabs>` floats over EVERY surface: green `🎚 PERFORMING`, purple
  `🕰 TIME TRAVELING` with `◀ ▶` steppers, EXIT on every client, and the D3 line
  **"Show due: … — starts when you exit"** with ENABLE. Presence pings (30 s,
  banner-scoped) keep a hands-off performance alive and die with the banner, so
  the never-stuck invariant survives. `PendingProgramOverlay` now **stands down
  under a zoom** — it would otherwise count down to an auto-start the engine has
  deferred, two surfaces contradicting each other mid-show. GATES: tsc clean,
  CaptainPad **914 pass / 6 skipped / 0 fail** (+22 new pinned tests), lint clean
  on touched files, security PASS. **LIVE-PROVEN on a fresh `:7167` dist against
  a real engine** — the operator's `:6967` Expo was never touched: day zoom on
  the dormant shipped plan, PERFORM over the deck, TIME TRAVEL over the deck,
  the deferred banner four minutes into a hands-off performance with the deck
  fully live underneath, stepper retargets (23:50 → 12:51 → 00:30), the boundary
  400 printed **verbatim** (`no prev event on …`, never clamped), a second client
  rendering the banner without auto-exiting, and the whole D3 loop end to end —
  the deferred show was **not dismissed**: on lease release `_catchUp` fired it.
  **One real bug found by the live run, fixed and pinned:** the engine clears the
  zoom and broadcasts on its own 1 s tick, which beats our `resume()` response
  back, so the operator's own tab-return exit raised a *"zoom ended"* alarm at
  the person who had just asked to leave — the exit claim is now staked before
  the request leaves. **Honest slip reported (`_97` §4.4):** the first
  verification engine streamed sACN to a real LED controller for ~30 s, because
  `--dest` does **not** override `config.yaml`'s per-controller `controllers:`
  block. Killed on sight, host black-holed for every later run, `config.yaml`
  snapshotted and **restored** — which also clears `_98`'s loopback-host commit
  blocker. The throwaway in-window probe plan was deleted and the test_bench
  timeline dir `diff -r`s IDENTICAL to its pre-run snapshot. Engine and dist
  server shut down at the end, so `_99`'s deferred `launcher.js prod` is
  unblocked. **S5 (e2e) is what remains of the zoom wave** — `_97` §7 lists the
  eight scenarios, the two exit paths never exercised live (engine restart
  mid-zoom, plan-save mid-zoom), and the `--dest` trap the runner must assert.

- **2026-07-31 — `_99`: the sACN input bridge's `addMembership EINVAL` boot
  crash, root-caused and killed.** The brief's hypothesis was a NIC/multicast
  condition; it is **not** — a direct probe joins five groups successfully with
  the interface unset, `0.0.0.0`, and the adapter's own address. The bug is
  **ours, and it is an ordering race**. `new Receiver({universes})` keeps *our*
  array (`this.universes = universes`) and joins each entry from inside the
  socket's `listening` callback, i.e. a tick later, **iterating that live
  array**. `sacn_bridge.js` then called `recomputeRoutes('boot')`
  synchronously, and `addUniverse(u)` joins `u` **now** and pushes it into that
  same array — so the deferred loop joined it a **second time**, and a duplicate
  `IP_ADD_MEMBERSHIP` is `EINVAL` on Windows. The package reports that as
  `receiver.emit('error')`, the bridge had **only** a `packet` listener, and an
  EventEmitter `'error'` with no handler **throws** — the input bridge died
  before relaying a frame, with a bare stack trace naming no interface and no
  universe. The reproduction is damning: the bridge's own subscription log
  printed `added:[38], failed:[]` — *success* — and the process was dead a tick
  later. **What changed was DATA, not the box**: the trigger is any universe in
  the boot union that is absent from the boot subscription list, and when the
  `📡 Subscribed Universes` field is set it **replaces** the patch-derived list
  outright — so a scene patched to a universe the field does not name crashes
  the bridge at boot. `_92` passed through exactly that state on U38/U39, and
  `_92` §A8 step 1 (attach the TE signs to a MarsinLED output) re-creates it.
  **The fix is four things, none of them a fallback:** a **boot gate** — nothing
  subscribes until the receive socket is listening, the held reason is replayed
  in full one tick later, and every deferral prints a line (ordering, not
  suppression); a **classified `receiver.on('error')`** — an `addMembership`
  failure is loud and isolated, naming the interface, stating that UNICAST still
  arrives while MULTICAST does not, and pointing at the config lever, exactly
  the contract `applyUniverseSubscriptions` already documents for the runtime
  path, while **every other socket error is FATAL** (`exit 1`, "refusing to run
  half-alive"); a **self-policing invariant** at `listening` that hard-exits
  naming the racing universes and saying *fix the ordering, do not retry*, so a
  future refactor fails at startup with the diagnosis pre-written; and
  **deterministic, logged interface selection** — the boot log now always says
  which interface the joins go to plus the full IPv4 inventory, warns when
  several NICs are up (the OS choice is a coin flip) or none is (the brief's
  original hypothesis, now a named diagnosis), and an optional `sacn_interface`
  in `simulation/config.yaml` pins it, **throwing with an inventory** on a
  mismatch and on an ambiguous adapter — never a silent switch to another NIC.
  Proven end-to-end by re-creating the divergence against the real bridge
  (field narrowed to 1-27 while titanic patches U30/U31): held → listening →
  `runtime-subscribed U30/U31`, no EINVAL, no exit; `common.yaml` restored
  **byte-clean**. Sim **1590 tests / 8 fail = the documented baseline 8, zero
  new** (+19, including two LIVE receivers that pin both orderings). Two
  follow-ups filed: the field still **replaces** rather than widens the boot
  list, and `launcher.js prod` has **no `--no-force`** — it can only start by
  killing whatever holds its ports, which is why the prod profile was held off
  while `:6968` belonged to `_97`/`_98`. **The prod bring-up was ultimately
  REFUSED by the permission gate** (blocked-by-classifier) and not worked
  around, so the sim servers are up on :6969-:6972 + UDP 5568 pinned `titanic`
  and the engine is not — `node launcher.js prod --scene titanic` finishes it
  in one command now that :6966/:6967/:6968/:7167 are all free.

- **2026-07-31 — `_98`: the timeline bugfix wave. Seven findings from `_93` and
  `_95`, fixed engine-side, each with a before/after dry-run transcript on the
  REAL `playa_default`.** (1) **A suppressed party fire now consumes NOTHING.**
  `triggers.js` is pure and stamps the cooldown + burns the one-fire-per-arrival
  arm latch at evaluation time; the arbiter then dropped the fire, and
  `moodArmed` only re-arms on a return to CALM — so one suppression inside the
  burn-night hold killed party for the whole night. The SERVICE now snapshots
  both maps and rolls them back for every dropped mood fire (the same invariant
  the `partyEnabled` gate already states: *suppression suppresses the SHOW, it
  does not consume the trigger*). **Burn night + continuous music: 0 sessions →
  27**, the first landing on the exact tick the hold ends. `wouldFire` went
  edge-only (the trigger now legitimately re-asks every tick). `getPartyStatus`
  gained `triggerArmed`; **no new `effectiveState` value** — CaptainPad throws on
  unknown ones. (2) **catchUp disarms the baseline BEFORE applying a caught-up
  program**, matching the live path: a restart/resume/savePlan/lease-release
  inside any hold used to freeze the deck (`ap OFF`, one pattern for 90 min) and
  now cycles (`ap 90s seq`). (3) **An ambient cue can no longer overwrite a live
  program's look** — it obeys the mood layer's gate (`controller === 'autopilot'`)
  and is surfaced as a suppression instead; the burn show keeps all 120 of its
  minutes (was 30). (4) **Program looks with no `autopilot` block** are now a
  LOUD authoring lint (`lintShowPlan` → `console.error` + additive
  `planWarnings` on `/timeline/state`) rather than a silent 2am freeze —
  deliberately NOT a load-time throw, because that would refuse to load the
  operator's running show. **His plan trips it 3× and still loads:** `sunrise`,
  `burn_night`, `temple` each need a three-line autopilot block — **his edit**.
  (5) **The background phase look survives multiple sessions.** `kind: ambient`
  is the plan's background layer; a timed session is a temporary punch-through,
  so the displaced owner is remembered and re-applied when the window elapses
  (fails closed: still enabled, still ambient, and for a phase trigger only while
  the phase is still active). 0 h 40 m → 7 h 04 m on a two-DJ-set night. The day
  `c_party_start` is re-pointed at the `ambient` look, this same mechanism gives
  exactly "ambient → session → ambient". (6) **`_95` F1 fixed** — the boot
  baseline no longer reloads `plan.autopilot.playlist` over a restored
  non-program cue; the `clobberedByBootBaseline` pin flipped to assert-the-fix.
  (7) **G1 conformance** — a hold expiring naturally hands the deck to the
  ambient `defaultCue` (runtime, boot AND ribbon), palette reset included;
  `source:'hold-expired-baseline'` is never emitted again. **Quiet night:
  `ambient` 0 h → 12 h 20 m (51 %)**. Timeline suite 387 → **407/407**; full
  engine 2449/2459 (8 pre-existing/environmental + 1 parallel-load flake + 1
  caused by a concurrent thread's `config.yaml` edit). **`whenPhase` restoration
  on the party cue remains operator-gated — his scene file, untouched.**
  ⚠ **`marsin_engine/config.yaml`'s declared controller host is currently a
  loopback black-hole (a concurrent thread's edit, not `_98`'s) — restore it
  before any commit.** Report: `20260725_98_timeline_bugfix_wave.md`.

- **2026-07-31 — `_92` ADDENDUM: the TE signs are LED, not DMX. The DMX
  placeholder is gone and both signs are mappable MarsinLED fixtures.** Operator
  correction: *"the TE signs must be associated with MarsinLED controllers …
  I saw DMX ones, that's wrong! … make sure the TE sign fixtures are clearly of
  type LED not DMX."* He is right — the earlier fix parked them on a DMX
  placeholder gateway because that was the only thing the mapping chain would
  let a `parLights` fixture attach to. **REMOVED:** the whole
  `TeSigns-PLACEHOLDER` controller (17 → 16 controllers), all four sign patch
  records, universes 38/39 from the subscribed field, and the DMX whole-fixture
  patch on all 148 sign pixels. **ADDED — a new first-class kind, the LED PIXEL
  FIXTURE:** a `parLights` fixture whose DEFINITION declares `bus: led` (the TE
  Sign V3 halves have said so since they landed). It keeps its baked per-pixel
  logo geometry but is wired exactly like a strand — one MarsinLED output,
  cursor at (port universe, ch 1), stride bytes per pixel — so it takes the
  strand's per-pixel patch, the strand's record shape, and `type: 'led'` model
  pixels. The hinge is one new pure module `src/dmx/led/led_fixture_kind.js`
  whose `ledMappableCounts()` is the UNION of strands and LED fixtures: both LED
  projections already key purely off that map, so **neither projection changed
  at all**. Threaded one call site each through `main.js`, `controller_registry`
  (`projectOntoConfigs` gained `ledBusNames` — LED fixtures are still NUMBERED
  but their addresses belong to the LED pass), the exporter, the mapping pane,
  the save-server and the parity validator. Classification is DATA, never a name
  list, so **the `fixtureType` strings never changed** — every `te_sign`
  selector still resolves and the `_48` addendum-2 one-panel-per-sign guarantee
  is intact (the 2D layer had already been calling them `kind: 'led'` via a
  hardcoded workaround, now redundant but left in place for old models).
  **Two latent bugs caught on the way:** (1) an LED thing only has a patch
  record while patched, so parking `sectionId`/`fixtureId` there would have lost
  the signs' identity the moment they were unmapped and re-minted different ids
  every boot — identity now lives structurally in `scene_config.yaml` like a
  strand's, seeded with the existing ids so nothing renumbered; (2) a `type:
  'led'` pixel is scaled by the LED last-layer gate keyed on `displayGroup`,
  which the signs lacked — the LED Fixtures panel's On/Brightness would have
  moved their meshes while the raw entry, the 2D tap and the sACN map stayed
  bright (the split `_40` closed for DMX). **LIVE PROOF** (sim servers only,
  engine never started, every `:6970` write aborted): the Controller Mapping
  pane reads `CONTROLLERS (16)`, `DMX CONTROLLERS (12)`, no PLACEHOLDER, and
  `UNMAPPED — 0 FIXTURE(S), 4 STRAND(S)` with the four 💡 TE Sign chips in the
  LED half; both signs still render and light correctly. Sim suite **1571
  tests, 8 fail = the documented baseline 8, zero new** (+12 new tests);
  security check PASS. **Parity is deliberately RED at 4 errors** — the four
  unmapped sign halves. Removing the controller without a replacement (per the
  brief) necessarily re-opens them, and softening `unmapped_fixture` to INFO
  would blind the gate to a genuinely dark fixture. **One operator action closes
  it:** attach the four halves to a MarsinLED output — set that output's order
  to **RGB** (the pucks are RGB; the ropes are RGBW) — and save. `_96`'s
  provisional typed-IP binding, landed in parallel, means the boards can stay
  boxed. Report: the ADDENDUM in `20260725_92_te_sign_patch_model_fix.md`.

- **2026-07-31 — `_95` LANDED: the timeline-zoom ENGINE (slices S1 + S2). The
  `_catchUp` refactor is provably byte-identical — 1 116 scenarios, 0 diffs.**
  Report `20260725_95_timeline_zoom_engine.md`. **S1:** the selection core of
  `_catchUp` is now ONE pure function, `resolveDeckStateAt` in the new
  `marsin_engine/lib/timeline/resolve_deck_state.js` (operator ruling D5) —
  no IO, no `Date.now()`, plan never mutated. It returns two deliberately
  distinct answers: `restored` (what catchUp re-applies, present even when the
  cue's window has elapsed) and `owner`/`playlist`/`palette`/`controller`/
  `source` (what actually drives the deck at T — a live hold owns outright, an
  elapsed `durationMin` window yields to the `defaultCue`). Consumers: catchUp,
  travel, `GET /timeline/resolve`, and the day ribbon. `buildOverview` gained
  additive per-day `phases` (plan-ordered bands, midnight-wrapping) and
  `segments` — the **resolved ribbon**, tiling `00:00 → 24:00` with no gaps,
  built by sampling the resolver at that day's own boundaries. On the shipped
  `playa_default` it puts `_91`'s findings on the wire at a glance:
  `defaultCue/ambient` until 06:08, `c_sunrise` owning **07:53 → 18:49**,
  `c_visibility_on` owning **20:34 → midnight**. **S2:** the operator lease
  gained a `scope` (`perform` | `travel`) — the zoom rides ON the lease, so
  every path that already cleared the lease clears the zoom and a zoom is
  structurally un-strandable (8 exit paths unit-tested, incl. engine restart,
  maker auto-save and lease expiry). New `POST /timeline/travel`
  (`{date,time}` | `{cueId,date?}` | `{step:'prev'|'next'}`) enters a scoped
  takeover and applies the resolved snapshot through the NORMAL dispatch path —
  a **static snapshot** (D4), never a live clock warp, and it writes none of the
  live plan's bookkeeping (no `firedToday`, no cooldown, no `activeProgram`, no
  deck window, no party session). New additive `zoom` field on
  `/timeline/state` + the `timelineState` broadcast. **D3 deferral:** while a
  zoom lease is alive the service pushes `pendingProgram.expiresAtMs` out to the
  zoom lease's expiry — a service-level nudge BEFORE `arbitrate()`, so the
  arbiter module stays pure and untouched. Deferred, never dismissed: ENABLE
  still starts it now, and the zoom exit fires it via catchUp. **A plain
  (bodyless) takeover keeps today's I2 30 s auto-start byte-identical** — pinned
  in both directions. One design gap closed on the way: the dormancy gate would
  have torn down a travel zoom within a second, so `_goDormant` now preserves an
  unexpired travel lease (and only that) — **time travel works while the plan is
  asleep**, which is exactly the bench/rehearsal state the rig is in today
  (`_91` #16). GATES: timeline family **387/387** (was 340), full engine suite
  2434/2442 (the 8 are audio-device/EACCES/playlist-drift, all pre-existing —
  three more files that failed under parallel load pass 47/47, 4/4 and 11/11 in
  isolation), **19/19** REST checks against a real engine with sACN
  black-holed, security check PASS, sim suite not run (zero shared files
  touched). **2 pre-existing engine truths found, pinned by tests, NOT fixed**
  (fixing either would break the byte-identical mandate): **F1** — `_catchUp`
  dispatches the restored cue and THEN lets `_establishBaselineIfActive` reload
  `plan.autopilot.playlist` over it, so a boot inside a non-program cue's live
  window lands on the BASELINE playlist; invisible on the shipped plan only
  because every look already points at `default`, and it will bite the moment
  `_91`'s T1 re-pointing lands. **F2** — `_91`'s G1 is now VISIBLE as
  `source:'hold-expired-baseline'` (the cue keeps the ownership latch while the
  baseline playlist plays under it and the palette is never reset).
  **S3/S4 pad slices build from `_95` §3.**

- **2026-07-31 — `_92` LANDED: the TE signs are patched and the sign model is
  rebuilt from CAD — `scene_model_parity titanic` goes 21 errors → 0, PASS.**
  All four reported defects confirmed from the repo and closed. (1) Both signs
  were unpatched — 148 px with `patch: null`, no controller carrying them at
  all — now chained on a new `TeSigns-PLACEHOLDER` controller (`0.0.0.0`
  sentinel + `PLACEHOLDER` marker, per plan `_33` §O5), U38 for sign 1 and U39
  for sign 2, A@1 + B@121 (222 ch fits one universe); `📡 Subscribed Universes`
  widened by 38, 39 so the IN bridge cannot silently drop them. (2) The A/B
  module names were duplicated across both signs — sign 2's halves are now
  `TE Sign 2 V3 A/B`, which also retires the `~2` dedupe keys the 2D pixel map
  had been inventing. (3) The shared `sectionId 3` + `fixtureId 13/14`
  collisions were a *symptom* of (2): `projectOntoConfigs` keys its config map
  by NAME, so the second sign never entered it. The rename alone let the
  projection mint `TE Sign 2` fresh (sId **415**, fId **2204/2205**) — no id
  surgery. (4) The six disagreeing strands are named:
  `Left_Front_Right`, `Left_Back_Right`, `Right_Front_Left`, `Right_Back_Left`,
  `Right_Front_Right`, `Right_Back_Right` — every strand on the three rope
  controllers with **no `device:` binding**. `main.js` writes `patches.yaml`
  from the device-bound projection only (no binding → no record → no bridge
  route), while the exporter seeded its lanes from the GENERIC projection and
  handed them addresses anyway: the engine rendered onto U32–U37, the bridge
  forwarded nothing, six ropes dark with every surface green. **patches.yaml
  wins** (operator's ruling): the exporter now builds its lane table from the
  bound projection alone, so an unbound strand exports `patch: null` +
  `unpatched: true`, loudly. The other direction would have created relay
  routes to three real rope controllers — device traffic this order forbade.
  Blast radius is exactly those six: every LED controller in every other scene
  is device-bound. **Model rebuild:** the sign's geometry lives only in
  `simulation/dmx/fixtures/te_sign_v3/model_{a_120,b_102}.yaml`; both were
  regenerated by the new reusable `simulation/tools/gen_te_sign_fixture.js`
  from the CAD CSVs. The point sets are IDENTICAL old→new — the delta is
  **wire order** (A: P9→P10→P1→P2→P3→P4→P11; B: P8→P7→P6→P5), i.e. which LED
  takes which DMX channel. Normalization is ONE shared factor over A ∪ B —
  `k = 1/2165.1 mm`, giving A `u 0…0.539, v 0.333…1.0` and B `u 0.269…0.731,
  v 0…0.800` — deliberately NOT 0…1 per side, which is what keeps the two
  halves interlocking instead of stacking. Y is not inverted vs the CSV.
  Verified: parity PASS (8 honest INFO, all promoted by `--strict`), sim suite
  1482/**8 fail** (10 → 8, zero new — every delta explained in the report §6.2),
  engine suite unchanged, security check PASS, and eyes-on renders of both signs
  lit with a wire-order chase plus the 2D `te_sign` view resolving one panel per
  sign (the `_48` addendum-2 regression is not back). Re-export ran through the
  sim's own save path — **no interactive operator step left**, no engine restart
  (pixelCount unchanged at 964, hot-reloaded, `modelStale: false`). Two hardware
  items remain yours: the sign controller's real IP, and binding the three rope
  controllers (both need device conversations). Report:
  `20260725_92_te_sign_patch_model_fix.md`.

- **2026-07-31 — `_93` LANDED: the timeline dry-run harness — a whole playa
  night in seconds, offline.** `_91`'s recommended first build, shipped as
  `marsin_engine/tools/timeline_dryrun.mjs`. It drives the **real** show code
  — `loadShowPlan`, `TimelineService._tick()` with an injected `nowFn` and
  `getMood()`, the real `triggers.js` evaluator, the real `arbiter.js`
  precedence, the real sun/tz/festival math, the real `PlaylistManager` and the
  real autopilot picker — against recording fakes that mirror the engine's own
  contracts, including the fail-loud "a playlist with no loadable entries
  throws". Zero sACN, zero network, no engine, and the plan is COPIED to
  `~/tmp` before the service sees a directory, so it physically cannot write
  into `simulation/scenes/**`. The dormancy problem is solved two ways: an
  out-of-window `--date` is a **loud refusal** naming the window, and
  `--fixture` runs a committed, date-free bench plan
  (`tests/fixtures/timeline/dryrun_bench.yaml`) that carries **no `festival`
  block** — the engine's own always-in-window escape hatch, mirroring the
  shipped show's shape and pointing at real titanic playlists. Flags cover the
  clock (`--date/--from/--days/--to/--step`, all independent of today), the
  mood track (four built-ins incl. `quiet` and `loud_stereo_1500`, plus
  `--mood-file`), reproducibility (`--seed`), what-ifs through the REAL
  `setPartyConfig` (`--party-config`), and output shaping
  (`--events-only`, `--engine-log`, `--out`). Each step prints playa-local
  time, phase, controller, deck OWNER, playlist ▸ pattern, autopilot, palette
  and party state, with cue fires (and WHY), lifecycle rows, **suppressed
  `wouldFire`s with the arbiter rule that dropped them**, and party-session
  transitions; the run closes with deck minutes by playlist / owner /
  controller / palette, fire + suppression counts, session outcomes, and
  playlist health as the engine actually resolved it.
  **Four 24 h nights at 1-minute resolution were run for the record.** They
  confirm `_91` on the shipped plan: the 90 min hold expires onto the autopilot
  **baseline**, not the `ambient` defaultCue (G1); `c_party_start` owns the
  deck **8 h 40 m** unbroken (G2); and a 40-minute daylight stereo fires
  **three** full party sessions at 15:02 / 15:16 / 15:30, exactly the missing
  `whenPhase` gap. Two measurements sharpen the arc picture: on a QUIET night
  the `ambient` playlist gets **zero minutes** (every deck cue is a
  no-`durationMin` cue, so the defaultCue never gets the deck back), and
  `c_sunrise` — not `party` — is the single biggest owner at 12 h 35 m because
  it holds the deck all day.
  **Five NEW bugs, all report-only (`_93` §5), nothing in the timeline logic
  was touched.** Worst: a **suppressed** party fire still consumes the
  arm latch and stamps the cooldown (`triggers.js:256-259` bookkeeps before
  `arbiter.js:174-180` drops the fire; `moodArmed` only re-arms on a return to
  CALM) — so on burn night **8 hours of continuous music produced 0 party
  sessions** after one suppression under the burn program's hold, where the
  same script on a normal day gave **35**; and the PARTY card would read
  "armed" the whole time. Also: `_catchUp` disarms the deck autopilot AFTER
  applying a caught-up program's look, so any restart/resume inside a hold
  freezes the deck on entry 1 (the live fire path does it in the opposite
  order); an `ambient` cue overwrites a running program's look while the
  program keeps precedence (harmless today, wipes the burn-night show the
  moment `_91`'s T1 re-pointing lands); program looks with no `autopilot`
  block freeze the deck for the whole 90–120 min hold (authoring); and the
  first party session permanently evicts the `party` look for the night.
  **Both `_91` fix-on-sight items done:** `.agent/ops/timeline_e2e_tests.md`
  S5 rewritten (it asserted a `mode='paused'` deleted in the 2026-07-03
  simplification, and drove a DISABLE PLAN button that no longer exists), with
  S1, S10 and the level table cleaned up in the same pass per the doc standing
  order; and `timeline_deck_release_default_cue.test.js` now mutes
  `console.log`, so it passes 9/9 run alone instead of tripping the Windows
  `node:test` IPC flake. Gates: engine timeline suite **317 → 340/340** (+23
  harness tests), full `npm test` 2387/2395 with **zero new failures** (the 8
  are the documented environmental + full-run-pollution + operator
  playlist-drift set), security check clean on every touched file, sim
  untouched. No git operations.

- **2026-07-31 — `_94` DESIGN LANDED: timeline zoom (day zoom + event
  zoom).** Design-only thread for the operator's two verbatim features.
  Delivered `20260725_94_timeline_zoom_design.md`: one navigation ladder
  (FESTIVAL week strip → DAY calendar view → EVENT = the deck itself), where
  the two browse levels are pure client UI and only the event level touches
  the rig. **Day zoom** promotes the existing 8-day strip + DayEditor and
  adds the two things review needs: per-day phase bands and a RESOLVED
  "what actually plays" ribbon (which renders `_91`'s G1/G2 findings visibly
  instead of hiding them), plus a reserved day-header slot where the
  postpone/shift build (`_91` §3.1a) would live. **Event zoom** maps onto the
  EXISTING arbiter human layer — a scoped takeover (`operatorLease.scope
  'perform'|'travel'`), no new controller, no parallel ownership: PERFORM =
  takeover whose only new semantics is deferring (never dismissing) a due
  program's 30 s auto-start while zoomed; TIME TRAVEL applies a snapshot from
  a new pure `resolveDeckStateAt` (extracted from `_catchUp`, cross-checked
  against the `_93` harness's throwaway-service recipe) to the real deck
  under the takeover — a live clock warp was explicitly rejected because
  catchUp's `firedToday` latches would cancel the real night. Every exit
  path (timeline-tab return, EXIT, lease expiry via presence pings, engine
  restart, autopilot off, plan save) funnels through resume/catchUp, so the
  PAUSE/HOLD-removal "never stuck" invariant is preserved. Engine surface:
  additive overview `phases`+`segments`, `GET /timeline/resolve`, takeover
  body `{scope}`, `POST /timeline/travel`, `zoom` field on `timelineState`
  (runtime-only). 8 open decisions (D1–D8, each with a recommendation) and 5
  independently-landable slices (S1 resolver, S2 zoom scopes, S3 day zoom
  UI, S4 event zoom UI, S5 e2e) await the operator's go. Zero code/scene
  writes; design report + ledgers only.
- **2026-07-31 — `_91` LANDED: show-infrastructure audit + test plan.**
  Read-only sweep of the whole show stack against the operator's requirements
  (incl. the new 2026-07-31 refinements): timeline mechanics, theme nights,
  the party-trigger chain, playa time + postpone, a 68-pattern × 13-playlist
  coverage matrix, and testability. **The verdict splits cleanly: the
  MACHINERY is strong, the SHOW is not.** The engine is the sole consumer of
  `scenes/<scene>/timeline/*.yaml` (sim/launcher read nothing); sun anchors,
  tz math and the festival span are pure, DST-correct and clock-injected;
  precedence (human > program > autopilot) holds; **317/317 timeline unit
  tests pass**; every failure path is loud. But the plan on disk is a lightly
  edited copy of the built-in template — **6 of its 8 reachable looks load the
  `default` playlist, and that playlist is 45/72 unreachable entries (all
  `summer_camp` names, silently skipped by autopilot) and 66/72 untuned**.
  Nine of thirteen playlists are referenced by NOTHING, including both fully
  tuned ones (`temple_white`, `white_wednesday`); the `burn_night` and
  `temple` looks point at `default` instead of their own playlists; `daytime`
  and `party_low` are dead looks. Two structural findings on the night arc:
  a program's hold expiring naturally lands on the autopilot **baseline**, not
  the `ambient` defaultCue (only boot / durationMin-elapse / END SHOW reach
  it), and `c_party_start` owns the deck with **no expiry** from sunset+120 to
  sunrise−15 — so "look: party" runs ~8 h and ambient is the exception, the
  inverse of the requirement. Against the refinements: **"fires from ambient
  only" is PARTIAL** — the only gate is `controller === 'autopilot'`, which
  blocks takeovers and program holds but not the `kind: ambient` party look,
  and the on-disk cue **dropped the `whenPhase: party_night`** the template
  ships, so party can fire in daylight. **"VJ night stands down" is MISSING**
  as a mode (manual `partyEnabled` toggle or a hand-authored `days:`
  exclusion only). **Playa time is fully SUPPORTED** (engine + CaptainPad both
  reason in the plan tz, explicitly so the tab is right off-playa);
  **POSTPONE is MISSING** — PAUSE/HOLD were removed in the 2026-07-03
  simplification, leaving only takeover (auto-resumes), AUTO OFF, DISMISS and
  hand-editing the plan. Short sessions, END-anchored cooldown, always-on
  dwell and human-wins are all SUPPORTED and test-proven. Testability: the
  cores are clock-injectable and the tests exploit it, but the rig is
  copy-pasted per file with fake deps — **there is no way to fast-forward a
  playa night**, no dry-run tool, and the committed e2e runner the ops spec
  asks for still does not exist. Blocking everything: today is outside the
  festival span, so the plan is **dormant** (`controller: manual`) and nothing
  can be observed without a run-time in-window fixture plan.
  **Recommended first build: `tools/timeline_dryrun.mjs`** — load the real
  plan, inject the clock, print a minute-by-minute playa night (phase,
  controller, cue fires, deck playlist, suppressions) with zero device
  traffic; 4–6 h, and it turns every open show question into a 5-second
  answer. Full findings, GAP LIST (16 rows) and the ordered 4-phase test plan:
  `20260725_91_show_infra_audit.md`. Zero code/scene writes; playlists and
  `patterns/**` measured only (ChatGPT+operator territory). Also flagged:
  `.agent/ops/timeline_e2e_tests.md` S5 asserts a `mode='paused'` that no
  longer exists.

- **2026-07-31 — MILESTONE + focus shift to the SHOW.** Operator declares
  the titanic **fully mapped**, sim working, 2D vis pattern-check ready; he
  has started the ChatGPT tuning loop live off the `_90` prompt ("creating
  views and then slowly tuning patterns"). New declared focus, his words:
  "let's you and me focus on timeline and planning and having fun with
  that!" — coordinator engages directly on the show timeline
  (`scenes/titanic/timeline/playa_default.yaml`, sun-phase looks), playlist
  curation (13 playlists over 78 patterns), and the ambient-by-default /
  alive-at-party-moments arc. Pattern files are now operator+ChatGPT
  territory — agents touch them only on explicit hand-over.

- **2026-07-31 — `_89` LANDED: the test bench became a window onto the ship.**
  Operator order "set up test bench to show part of the titanic scene for me —
  led bars, par lights and vintage lights! LED strings too." The measurement came
  first and decided the design: only the **pars** line up (titanic pars sit at
  1/11/21/31 in seven universes, exactly where the bench's are), while **no**
  titanic bar starts at 107/226 and **no** vintage at 41/74 in any universe — and
  a DMX start address lives in the physical fixture. So pure config solves one
  third and the rest of the bytes have to move. Built the minimal bridge-side
  option: a **bench mirror**, a per-destination list of slices
  (`source universe/addr/length → dest addr`) composed into the universes the
  bench boxes ALREADY listen on, which is why the change needs **zero controller
  pushes and zero gateway edits**. The slice is the ship's **left front**, one
  contiguous neighbourhood so spatial patterns read correctly: Left Auditorium
  5-8 → Par 1-4 (a byte-for-byte identity copy, the alignment finding put to
  work), Left Front Rails 1/2 → Vintage Left/Right, Left Front Wall 1/2 → Bar
  Left/Right, and the two port ropes' first 20 pixels → LED_0/LED_1. Every source
  is a fixture with a real `patches.yaml` record, so a re-export cannot silently
  darken it. Activation needs **three** preconditions, none of them a fallback:
  `enabled: true`, the ENGINE on the declared source scene (the wrong model would
  splice par bytes into a bar's control channels), and the spec's own scene
  active — the last being the deployment guard, so the file can ride a
  `robocopy /MIR` onto the show server and stay inert while the ship's real
  gateway keeps its ordinary relay. While active the mirror OWNS its destination
  pairs and the raw relay for exactly those is suppressed with a named log line
  (one-writer law, `_15`). Proven by loading the REAL bridge with fake
  `sacn`/`ws` — his stack on 6967-6972/5568 was never approached — with the
  composed bytes exact at every fixture boundary and both inert scenarios
  restoring normal bench behaviour. Sim suite 1452 → 1482 (+30), fail 10 → 10,
  byte-identical list; the new file is 30/30 and six of those are **live-map**
  tests that read the committed spec against the real scenes and models, so the
  map cannot rot in silence. Visual check ran under four guards including
  aborting every non-GET to the save server, because `saveModelJS()` on page boot
  would otherwise rewrite the operator-owned titanic export; `git status`
  confirms zero writes to `scenes/titanic/**` or `marsin_engine/models/**`. His
  only possible push is a **revert**: if the strands stay dark, the `.60` box is
  still on the ship's rope universes from the titanic-scene push whose receipt
  reads `needs-reboot`, and one Push on the `Titanic_202` card in the
  **test_bench** scene puts it back.

- **2026-07-31 — `_90` LANDED: ChatGPT pattern-tuning prompt pack.** Operator
  order "let ChatGPT fine tune our patterns", his chosen loop being manual
  copy-paste (he passes the prompt himself; ChatGPT has no repo or network).
  Delivered `20260725_90_chatgpt_pattern_tuning_prompt.md`: a how-to-use header
  plus a 482-line self-contained prompt covering the pattern file format, the
  complete MarsinScript API (nothing outside it exists), nine hard rules
  (slider declaration order = MFT knob order, `localSpeed` 1st / `direction`
  2nd, ≤12 sliders, guarded direction dead-zone, `w == a`, RGB-space palette
  blending, coords arrive 0..1, no fallbacks, no invented API), the titanic
  coordinate space and `FIX_*` fixture targeting, ambient-vs-party style
  doctrine, a strict response contract (COMPLETE file in one block, never
  reorder/rename an existing slider, short Changes list, ask rather than
  guess), and a full worked example. The example was **compiled and measured
  on the real offline harness** from a scratch path — `COMPILE_OK`,
  hueSpread 0.79/0.97, peakMaxChan 247/255, silence-safe, PRIMARY corr 0.52
  REACTIVE — so the `FIX_*` targeting, the guarded-direction idiom and the
  `w == a` emit are proven against the live compiler, not transcribed. Doc-only:
  zero engine/sim changes, nothing added to `patterns/`, no git ops. Open note
  carried in the report: on the ship `sectionId` is NOT 1/2/3, so legacy
  `sectionId == 2` blinder branches do not select the vintage heads there —
  the prompt steers new logic to `fixtureType` and forbids touching the legacy
  branches unasked.
