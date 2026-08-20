# VSN1 MIDI attach/detach + deploy overflow + libuv abort — diagnosis & fix plan (`_30`)

**Date:** 2026-07-28 · **Agent:** Fable debug/investigator (read-only; no source edits, no git ops, no show ports touched) · **For:** Opus implementer (`_31`).

**Operator symptom (today, local machine):** on an effect change in the CaptainPad UI the engine path logs
`VSN1 layout NOT deployed: ERROR: Action string is 5960 chars; device limit is 909 (grid CONFIG_LENGTH). Shorten the Lua.`
then a libuv hard abort appears: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94` — and the stack is down. Same pair sighted 2026-07-25 (`_27` report §Session notes; tracker ~04:17/04:18 stack event).

---

## 1. Architecture map (who actually talks to the VSN1)

- **The engine process holds NO device handle and NO native addons** (deps: ffmpeg-static path, fft.js, js-yaml, osc-min, sacn, ws — all pure JS; verified zero `.node` files under `marsin_engine/node_modules`). Runtime MIDI feedback is **CaptainPad Web MIDI in the browser** (`CaptainPad/utils/midi/*`), not the engine.
- Layout flashing: `marsin_engine/lib/vsn1_layout_deploy.js` (debounced, serialized) **spawns a short-lived CLI child** `tools/vsn1_config/deploy_layout.cjs --from-engine --page 0 --live` (runCli, `:397-412`). Serial/`serialport` native code lives **only** in those children (`tools/vsn1_config/node_modules/@serialport/bindings-cpp`). This is good crash isolation by construction.
- Gate: `vsn1.deployLayout: true` + `deployOnBoot: true` are **ON in the committed `marsin_engine/config.yaml` (:25-28)** — so every engine boot on any machine fires a deploy ~1.2 s in (`api_server.js:1178-1183`), and every slot assign/clear/rename fires one after the 1200 ms debounce.
- The exact banner string `VSN1 layout NOT deployed: <detail>` is CaptainPad's (`components/global_effect_macros_logic.ts:366`), fed by the engine's `vsn1LayoutDeploy` WS broadcast carrying the CLI's stderr; the engine console prints the same stderr as `[VSN1] page 0 deploy FAILED: …` (`vsn1_layout_deploy.js:259-261`).

## 2. Root cause #1 — the 5960-char overflow: **CRLF line endings break comment stripping** (content is innocent)

**Proven end-to-end offline** (no device, no ports; scripts in `~/tmp/vsn1_debug/`):

1. `grid_serial.cjs:606-611 stripLineComments()` splits on `'\n'` and strips line comments with `/--(?!\[\[).*$/` (no `/m` flag). On a line ending in `\r`, `.` cannot cross the `\r` (it's a line terminator) and `$` without `/m` only matches absolute end-of-string ⇒ **the regex never matches ⇒ no comment is ever stripped**.
2. The working-tree template `templates/effects_layout/encoder_init.lua` is **CRLF today (140 CRLF, 0 bare LF)** while the git index stores LF (`git ls-files --eol`: `i/lf w/crlf`), repo has `core.autocrlf=true` and **no `.gitattributes`**. Any checkout/branch-switch materializes the Lua templates as CRLF.
3. Surviving comments ride into `minifyScript` (which deliberately *keeps* comments — vendor `dist/index.js` `minifyLua`) and into the `\n → space` collapse, producing a 5960-char device action for **`encoder INIT (midirx receiver)`** — the FIRST element compiled in `buildLayout` (`deploy_layout.cjs:431-443`), so every deploy dies there, **before any serial/COM12 contact** (`findVsn1Port` is only reached inside `restore_config.cjs --live`, never in this failure).
4. **Reproduced exactly:** `node deploy_layout.cjs --layout layouts/example_layout.json --page 0` → `ERROR: Action string is 5960 chars…`, exit 1 — identical with a fake-engine `--from-engine` run (layout-independent; the number is a pure template constant).
5. **Proof the templates fit with LF:** the July-15 known-good dump `tools/vsn1_config/dumps/layout_engine_page0.json` — same templates (only commit ever touching them: `c6eaa733`, July 11), same installed `@intechstudio/grid-protocol` **1.20260615.942** — records `endless INIT = 904/909`, key INITs 870-872, lcd INIT 833, system 626. Stage measurement today: raw 7418 → "stripped" 7278 (only trailing whitespace went) → minified 6002 → device 5958-5960.
6. Under CRLF, **six of nine templates** blow the 909 budget (key_init 3745, lcd_init 4536 pre-ladder, lcd_draw 2130, system_init 1652, side_button 1558, encoder_turn 1047) — the shrink ladder only protects `lcd_init`, so fixing the encoder alone would just move the error.
7. **Latent correctness hazard (worse than the overflow):** once newlines are collapsed to spaces, any surviving `--` line comment comments out the **rest of the entire script**, and `checkSyntax` still passes (a comment is valid Lua). A shorter template with a surviving comment would flash semantically dead code with green lights. The overflow error is what *saved* the device here.

**Verdict:** not a content bug, not "shorten the Lua", not minifier/package drift — a line-endings bug in `stripLineComments` plus a missing `.gitattributes`. Razor-thin headroom (904/909) is a secondary risk worth a headroom report in the new test.

## 3. Root cause #2 — the libuv abort: **not the deploy child, not serialport; a process-teardown race, with the overflow as an omnipresent red herring**

What is proven / excluded on this exact box (Node v24.18.0, libuv 1.52.1):

- **The deploy child exits cleanly (code 1) on the failing path — 21/21 runs**, including the byte-exact engine invocation shape (`--from-engine <url> --page 0 --live`, piped stdio, cwd marsin_engine) against a fake engine on an ephemeral port. Serial is never opened (throw precedes it), so the serialport close-race theory is dead for this path.
- **The engine survives the identical failure**: proven live 2026-07-25 04:17 (tracker: "engine kept running"), and by code audit every rejection path is caught — `api_server.js:1143-1145` (hook), `vsn1_layout_deploy.js:178-181` (debounce), the `runFlush` try/finally (`:228-303`).
- In a **zero-native-addon** Node process, every `uv_async_send` caller (threadpool `wq_async`, V8-platform task posting, the Windows console-ctrl handler thread, MessagePorts) can only trip `!(flags & UV_HANDLE_CLOSING)` **while handles are being torn down** — i.e. during process exit or a `spawnSync`/`execSync` temp-loop lifecycle. There is no steady-state path to this assert in the engine's own code.
- Ranked candidates for which process aborts:
  1. **Engine at exit** (scene-switch exit-75, Ctrl+C, teardown): it exits with live handles — the never-closed `fs.watch(modelsDir)` (`engine.js:1578`, return value discarded), possibly an in-flight deploy child's pipes, threadpool fs work. An abort here *replaces* the intended exit code, and under `launcher.js` any non-75 engine exit ⇒ `teardown(1)` ⇒ the launcher's `process.on('exit')` **force-kills every child** (`launcher.js:623-644, 781-793`) — exactly "takes the whole engine down".
  2. **The launcher itself**: it runs `execFileSync('netstat'…/'powershell'…)` at child-exit/restart moments (`launcher.js:389, 417-421`) — the known-fragile sync-spawn temp-loop family; it died code 1 "around the engine-child restart" on 07-25 04:18 with services surviving.
  3. The child at exit under timing not hit in 21 tries (grid-protocol WASM formatter + undici sockets alive at `process.exit(1)`).
- **Causal link verdict (task Q4):** the overflow and the abort are **NOT mechanically linked** — the overflow error is printed on *every boot* (deploy-on-boot) and *every effect change*, so it is nearly always the last log line before *any* crash; on 07-25 the engine demonstrably survived it. They are environmentally linked: the constant doomed-deploy churn (a node child + WASM init every debounce, plus CaptainPad reacting to every failure broadcast) maximizes the teardown-race surface. Kill the churn (fix #1 + the attach gate) and the observed crash trigger environment disappears; harden supervision (plan step 11) and even an unfixed abort can no longer take the show down.
- **No crash artifacts on the box**: no WER/Event-1000/1001 records for node.exe in 6 days (Node suppresses the abort dialog), so the process attribution needs the operator's one observation (below).

## 4. Attach/detach today (task Q1/Q2)

- **Attach detection: NONE.** The only gate is config/env (`isLayoutDeployEnabled`, `vsn1_layout_deploy.js:83-88`). The engine never asks whether a device exists — not at boot, not per deploy. Device discovery happens only deep inside the flash child (`grid_serial.cjs:69-81 findVsn1Port`, VID/PID scan) *after* the full ~2-3 s compile+validation.
- **Detached behavior (once templates are fixed):** every layout change would still spawn the full CLI, burn the compile, then fail with `No VSN1 found (looking for VID:… PID:…)`, log a full-stderr error, **re-queue page 0** (`vsn1_layout_deploy.js:252`), and retry on the next change — per-change spam, an error-red banner in CaptainPad, no "not attached" concept anywhere.
- **Hot unplug/replug mid-show:** invisible to the engine; the next deploy just fails as above. (CaptainPad's Web MIDI runtime feedback has its own browser-side lifecycle — out of scope.)

## 5. Proposed attach-state model

Engine-side tri-state `attached: 'attached' | 'detached' | 'unknown'`, owned by the deploy-hook module, updated by a **probe child** (serialport stays out of the engine process — crash isolation preserved):

- New `tools/vsn1_config/probe_vsn1.cjs`: `serialport.list()` → VID/PID match → one-line JSON `{attached, path, vid, pid}`; exit 0 = present, 3 = absent, 1 = real error. ~40 lines, imports at top, snake_case.
- Probe moments: engine boot (before deploy-on-boot), start of every flush drain, `POST /global-effects/deploy`, and on demand via the deploy-status endpoint. **No polling loop** (no cheap USB events without native code; probing at decision points is sufficient).
- **Detached is an explicit designed state (Codex P0 — loud, once, no silent fallback):** clear `pendingPages` (the layout YAML is still written for tools), set `status.lastResult = 'skipped-detached'`, print **exactly one** line per attached→detached transition — `VSN1 not attached — layout deploy skipped (deploys resume on next change once attached)` — and broadcast so CaptainPad renders a neutral "VSN1 OFFLINE" badge instead of the red NOT-deployed banner.
- Reattach: the next probe that finds the device while the layout revision is newer than the last deployed one queues page 0 once.

## 6. Fix plan (numbered, verbatim-executable)

1. **`marsin_engine/tools/vsn1_config/grid_serial.cjs` — `stripLineComments` (:606-611):** split on `/\r?\n/` instead of `'\n'` (the `trimEnd()` already handles a stray `\r`). One-line change; makes CRLF harmless forever.
2. **Same file — `buildActionStringFromLua` (:617-647):** after the minify + newline-collapse, add a fail-loud guard: if the single-line string still contains a line-comment opener (`--` NOT followed by `[[` — the `--[[@cb]]`/`--[[@s…]]` block markers stay legal), throw `line comment survived comment stripping — refusing to flash (would comment out the rest of the script)`. This makes the whole CRLF/minifier-regression class unshippable, closing the silent dead-Lua hazard in §2.7.
3. **Repo root `.gitattributes` (new):** `*.lua text eol=lf`. Note in the commit message that already-checked-out trees keep CRLF until re-checkout — step 1 makes that harmless; the attribute stops the drift class.
4. **New offline regression test** `marsin_engine/tests/vsn1/template_budget.test.js` (node --test; resolve `@intechstudio/grid-protocol` via `createRequire` from `tools/vsn1_config/` — no new deps): for every `templates/effects_layout/*.lua`, compile through the real pipeline with (a) file bytes as-is, (b) forced-CRLF, (c) forced-LF; assert device length ≤ `CONFIG_LENGTH`, assert the step-2 guard finds no surviving line comment, assert `checkSyntax` passes, and PRINT headroom per template (encoder INIT sits at 904/909 — flag anything < 20 chars in the test output so the next template edit doesn't ship blind).
5. **New `tools/vsn1_config/probe_vsn1.cjs`** per §5 (exit 0/3/1, single-line JSON stdout).
6. **`marsin_engine/lib/vsn1_layout_deploy.js`:** add injectable `probeFn` (default: run the probe CLI via the existing `runCli`); call it at the top of `runFlush()` and in the boot-deploy path; implement the detached state machine of §5 (`skipped-detached` result, one-transition-log with a `lastAttachState` latch, pendingPages cleared, broadcast); expose `attachState` in `status`.
7. **`marsin_engine/lib/api_server.js`:** boot deploy (`:1178-1183`) goes through the same gate; add `attachState` to the deploy-status payload (`:5476-5485`) and to the `vsn1LayoutDeploy` broadcast.
8. **`CaptainPad/components/global_effect_macros_logic.ts` (`deployBannerMessage`, :353-370):** `lastResult === 'skipped-detached'` ⇒ a distinct neutral return (new union member) so the UI shows "VSN1 offline — layout deploy skipped", never the red error banner; extend the existing vitest suite (`global_effect_macros_logic.test.ts` already covers banner folding).
9. **Engine-survival regression tests** (unit-level, injectable `spawnFn`/`probeFn`, zero real processes — extend the existing hook tests): (a) child exits code 1 with 6 KB stderr; (b) `spawnFn` child emits `error`; (c) **child "hard-aborts"** (close with code 3221226505, i.e. 0xC0000409) mid-drain with pages pending; (d) **device vanishes between debounce and drain** (probe flips attached→detached mid-burst). Assert in each: no unhandled rejection (install a test-scoped `unhandledRejection` trap), status settles correctly, console got exactly ONE skip line in (d), `pendingPages` behavior per spec, hook still usable afterwards. These are the "device-absent" and "device-vanishing-mid-send" proofs the operator asked for.
10. **Teardown hygiene (shrink the abort surface):** `engine.js:1578` — keep the `fs.watch` return value and `close()` it in `shutdown()`; `vsn1_layout_deploy.js` — track the in-flight child and kill/unref it in a new `dispose()` called from `shutdown()` before `process.exit`.
11. **Launcher supervision policy (OPERATOR SIGN-OFF — changes semantics):** in `launcher.js` `startChild`'s engine `onExit`, recognize abort-class exit codes (3, 134, 3221226505) → log the decoded code loudly and **restart the engine once with backoff** (bounded: >2 aborts in 10 min ⇒ teardown as today) instead of tearing the whole stack down. This is the playa guarantee: even an unpinned teardown race can no longer end the night. Explicit, loud, bounded — not a silent fallback.
12. **Only if the abort persists after 1-11:** capture it — operator answers the attribution question (§7), and/or enable WER LocalDumps for node.exe (registry change, operator action) to get a dump naming the faulting thread.

**Prove-out for `_31`:** engine `npm test` (expect only the known env-fail baseline), new template test green in all three ending modes, hook survival tests green, CaptainPad `tsc` + vitest green, then one manual end-to-end on the operator's box: effect change with device attached (deploy succeeds ≤909), device unplugged (ONE skip line, neutral badge, no child spawn beyond the probe), replug + change (deploy resumes).

## 7. Questions only the operator can answer

1. In the console where you saw `Assertion failed: … async.c:94` — was the line prefixed `[engine]` (launcher tag), embedded inside a `[VSN1] page 0 deploy FAILED: …` blob, or bare/unprefixed? (bare ⇒ the launcher aborted; own-line `[engine]` ⇒ the engine process; embedded ⇒ the CLI child.)
2. Immediately after the crash, does `http://127.0.0.1:6968/status` still answer? (Distinguishes "engine died" from "launcher died and force-killed the stack".)
3. Are you running via `node launcher.js …` or bare `node engine.js …` in that session?
4. Step 11 (engine auto-restart on abort-class exits, bounded) — approve the supervision change?

## 8. Session residue

- Repro/measure scripts left in `~/tmp/vsn1_debug/` (`measure_templates.cjs`, `repro_child_abort.cjs`, `stage_diff.cjs`) — offline, ephemeral-port only.
- No source-tree changes, no dumps written (the throw precedes `writePatches`; `dumps/` mtimes unchanged since Jul 15), no show ports bound, no git operations, operator's live stack untouched (one blocked attempt to dry-run against :6968 was abandoned in favor of a fake-engine on an ephemeral port).
