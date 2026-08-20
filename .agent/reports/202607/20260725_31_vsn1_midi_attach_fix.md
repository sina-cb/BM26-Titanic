# VSN1 CRLF overflow fix + first-class MIDI attach state — implementation (`_31`)

**Date:** 2026-07-28 · **Agent:** Opus implementer · **Executes:** `_30` §6 fix
plan, steps 1–10 and 12 (**step 11 deferred — operator sign-off**) · **Ports:**
none bound; operator's live stack (:6966–:6972, sACN 5568) untouched · **Git:**
no operations performed (file edits only).

---

## 0. Outcome

Both symptoms from `_30` are addressed, and the missing concept behind the
second-order damage — "is the controller even plugged in?" — now exists.

- **The 5960-char overflow is gone.** With the comment stripper fixed, all nine
  templates compile to exactly the July-15 known-good sizes (encoder INIT
  **904/909**, key INIT 871, lcd_draw 573, system 626). Verified by re-running
  Fable's own `~/tmp/vsn1_debug/measure_templates.cjs`, which reported six
  templates OVER budget before and zero after.
- **The silent-dead-Lua hazard (`_30` §2.7) is now unshippable**, and I proved
  the danger was real rather than theoretical: on a script whose entire body
  ends up inside a surviving comment, `GridScript.checkSyntax()` returns
  **`true`**. That assertion is now in the suite.
- **`attached | detached | unknown` is a first-class engine state.** With no
  device present, a boot plus three layout edits produce **one** log line, four
  cheap probe children, and **zero** deploy-CLI spawns (measured with real
  child processes — §5).
- **Suites:** engine `2324 → 2347` tests, `8 → 8` failures — the **same** eight,
  all pre-existing and proven independent of this work (§4). CaptainPad `886 →
  889` passing, `tsc` clean.

---

## 1. What changed, per plan step

| Step | File | Change |
|---|---|---|
| 1 | `marsin_engine/tools/vsn1_config/lua_action_string.cjs` | `stripLineComments` splits on `/\r?\n/` instead of `'\n'`. CRLF harmless forever. |
| 2 | same | Fail-loud guard: a `--` opener (not `--[[`) surviving into the single-line minified string throws `line comment survived comment stripping — refusing to flash …`, with the offending offset + surrounding text. |
| 3 | `.gitattributes` (new, repo root) | `*.lua text eol=lf`, with the RCA and the operator's renormalize instruction in the header comment. |
| 4 | `marsin_engine/tests/vsn1/template_budget.test.js` (new) | 7 tests — all templates compiled through the real pipeline in three line-ending forms, headroom report, known-good size pin, guard tests. |
| 5 | `marsin_engine/tools/vsn1_config/probe_vsn1.cjs` (new) | Port enumeration → one-line JSON, exit `0`/`3`/`1` = attached/detached/probe-error. Never opens the port. |
| 6 | `marsin_engine/lib/vsn1_layout_deploy.js` | Injectable `probeFn`, attach gate at the top of `runFlush()`, `skipped-detached` result, one-transition-log latch, `pendingPages` cleared, reattach catch-up, `attachState`/`lastProbeAt` in `status`, plus `probeAttach()` and `dispose()`. |
| 7 | `marsin_engine/lib/api_server.js` | Boot deploy goes through `probeAttach()`; `POST /global-effects/deploy` probes first and returns `attachState`; `dispose()` wired into `server.closeNow()`. |
| 8 | `CaptainPad/components/global_effect_macros_logic.ts` + `GlobalEffectMacros.tsx` | `deployBannerMessage` returns a `DeployBanner` union (`kind: 'error' \| 'offline'`); the strip renders neutral chrome for `offline`, red only for a genuine failure. |
| 9 | `marsin_engine/tests/vsn1/deploy_attach_survival.test.js` (new) | 16 tests — detach/reattach/vanish-mid-burst, probe exit-code mapping, and four child-misbehaviour survival cases. |
| 10 | `marsin_engine/engine.js` + `vsn1_layout_deploy.js` | `fs.watch` handle kept and `close()`d in `shutdown()` (was discarded); `dispose()` cancels the debounce timer and kills/unrefs any in-flight CLI child. |
| 11 | — | **NOT IMPLEMENTED — awaiting operator sign-off.** See §6. |
| 12 | — | Conditional on the abort persisting after 1–11. Nothing to do yet; §7 carries what to capture if it recurs. |

### One deliberate deviation from the plan (step 4)

The plan had the new test resolve the compiler through `grid_serial.cjs`. That
file `require`s **`serialport`, a native addon** — so the engine's `npm test`
would have loaded native serial code into the test runner, importing exactly the
crash surface that `_30` §1 credits for keeping device faults away from the show.

So I split the pure compiler out into **`tools/vsn1_config/lua_action_string.cjs`**
(`stripLineComments`, `buildActionStringFromLua`, `toDeviceActionString`,
`toHumanActionString`) — zero I/O, zero native code. `grid_serial.cjs` requires
and **re-exports all four**, so `deploy_layout.cjs`, `write_config.cjs`,
`restore_config.cjs` and every other caller are byte-for-byte unaffected
(verified: all four exports present and callable through `grid_serial.cjs`).

### Attach-state design as built

- **Probe moments** (no polling loop, per §5): start of every flush drain, engine
  boot, `POST /global-effects/deploy`.
- **`detached`** → `pendingPages` cleared, `status.lastResult = 'skipped-detached'`,
  `lastError = null`, **one** line per `attached→detached` transition:
  `VSN1 not attached — layout deploy skipped (deploys resume on next change once attached)`.
  No deploy child, no throw, no red banner. The layout YAML is still written, so
  tools and the operator keep their inspection artifact.
- **`unknown`** (probe itself failed) **does not block the deploy.** We could not
  tell, so we do what we always did and let the deploy CLI fail loud. Suppressing
  deploys on a broken probe would be a fallback wearing a safety costume (P0).
- **Reattach:** the next probe that finds the device re-queues page 0 **once** if
  the layout revision moved past the last successfully deployed one.
- **Gated OFF ⇒ nothing spawns at all.** `probeAttach()` short-circuits when
  `isLayoutDeployEnabled()` is false and returns `unknown` — a probe is still a
  child, and a CI box or dev laptop must never spawn one. (Verified by test.)

Step 7's "add `attachState` to the deploy-status payload and the broadcast" is
satisfied structurally: both `GET /global-effects/layout` and the
`vsn1LayoutDeploy` broadcast already serialise the whole `status` object, so the
new fields flow automatically. `POST /global-effects/deploy` additionally returns
`attachState` at the top level.

---

## 2. Root cause #1 — confirmed fixed, with numbers

`~/tmp/vsn1_debug/measure_templates.cjs`, unmodified, before → after:

```
                       BEFORE (CRLF bug)      AFTER
  encoder_init.lua     OVER  5958/909    →    OK   904/909
  key_init.lua         OVER  3745/909    →    OK   871/909
  lcd_init.lua         OVER  4536/909    →    (ladder — see below)
  lcd_draw.lua         OVER  2130/909    →    OK   573/909
  system_init.lua      OVER  1652/909    →    OK   626/909
  side_button.lua      OVER  1558/909    →    OK    75/909
  encoder_turn.lua     OVER  1047/909    →    OK   300/909
  encoder_press.lua                      →    OK   107/909
  key_bc_toggle.lua                      →    OK    75/909
```

These match the July-15 known-good device dump exactly (`endless INIT = 904`,
key INITs 870–872, lcd INIT 833, system 626) — i.e. the fix restores the tree to
its last-known-good compile, it does not merely get under the line.

`lcd_init` is the one template whose size scales with the operator's slot names,
and `deploy_layout.cjs` protects it with a display-shrink ladder. Its real
contract is therefore "fits at the ladder's **floor**" (6-char names, no mode
tables) — measured **769/909**. The test pins the floor, because if the floor
overflowed the page would be undeployable no matter what the operator typed.

**Incidental finding.** Several templates mention placeholders such as
`__KINDS__`, `__MCH__`, `__VCC__` inside `--` documentation comments;
`deploy_layout.cjs` never substitutes those. Normally harmless — the comment is
stripped. **Under the CRLF bug those raw `__KINDS__` tokens were riding onto the
device too**, as bare Lua identifiers that are valid syntax and silently `nil`.
The new test asserts no `__…__` token reaches a device action string.

---

## 3. Root cause #2 — what was done, and what was deliberately not

Step 10 (teardown hygiene) is in. Step 11 (supervision policy) is not — §6.

- `engine.js:1578` created an `fs.watch` on `models/` and **discarded the
  handle**, so the engine always exited with a live watcher (plus its threadpool
  work) open. The handle is now kept and `close()`d in `shutdown()`, alongside
  cancelling `modelReloadTimer`.
- `vsn1_layout_deploy.js` now tracks the in-flight CLI child and
  `kill()`/`unref()`s it in `dispose()`, called from `server.closeNow()` — which
  `engine.js shutdown()` already invokes. Previously the engine could exit while
  still holding a child's stdout/stderr pipes.

This shrinks the live-handle set at teardown, which is the only window in which
`!(handle->flags & UV_HANDLE_CLOSING)` is reachable in a zero-native-addon
process (`_30` §3). It is **hygiene, not a proven fix** — `_30` could not pin
which process aborted, and I have not reproduced the abort. The honest status:
the churn that maximised the exposure (a doomed deploy child + WASM init on
every boot and every effect change) is now gone, which removes the trigger
environment; the underlying race is unpinned.

---

## 4. Test evidence

### New: `marsin_engine/tests/vsn1/template_budget.test.js` — 7/7 pass

Core invariant asserted: **on-disk, forced-LF and forced-CRLF bytes must compile
to byte-identical device strings.** That is precisely what the bug violated, and
it is stronger than a size check alone. Plus: no placeholder reaches the device,
no line comment reaches the device, `checkSyntax` passes, and a coverage test
fails if a `.lua` template is added without a budget profile.

The headroom report the plan asked for (printed on every run):

```
  VSN1 template budget — device limit 909 chars:
    encoder_init.lua              904/909  headroom    5  ⚠ TIGHT
    key_init.lua                  871/909  headroom   38
    lcd_init.lua (ladder floor)   769/909  headroom  140
    system_init.lua               626/909  headroom  283
    lcd_draw.lua                  573/909  headroom  336
    encoder_turn.lua              300/909  headroom  609
    encoder_press.lua             107/909  headroom  802
    key_bc_toggle.lua              75/909  headroom  834
    side_button.lua                75/909  headroom  834
```

Guard tests use a **real** residual case rather than a contrived one: CR-only
(classic Mac) line endings still defeat the stripper by construction, so the
guard is what catches them. And the reason the guard must exist is asserted, not
merely asserted-in-prose:

```
minified    = "local a=1 -- this comment survives\rlocal b=2\rself:led(1,1,1)"
checkSyntax = true      ← the entire body is dead, and the syntax check passes
```

### New: `marsin_engine/tests/vsn1/deploy_attach_survival.test.js` — 16/16 pass

Attach state: detached spawns no deploy child and does not throw; **ten edits
while detached produce exactly one skip line**; the YAML is still written;
device vanishing between debounce and drain is caught with one line and no
spawn; reattach re-queues page 0 exactly once and never repeats; `unknown` still
attempts; a *throwing* probe degrades to `unknown` and never claims "detached";
the default probe's exit-code mapping (`0/3/1/2`) is exercised through the real
CLI path; a gated-off engine spawns no child of any kind.

Survival (all with a test-scoped `unhandledRejection` trap asserted empty):
child exits 1 with **6 KB** of stderr; child emits an `error` event; child
**hard-aborts with `3221226505` (0xC0000409)** mid-drain carrying the real
`UV_HANDLE_CLOSING` assert text; `spawnFn` throws synchronously. Each asserts
the busy-guard reset, correct `pendingPages`, loud logging, and that **the hook
still works afterwards** — the 2026-07-10 wedged-`flushing` class.

Teardown: `dispose()` cancels the debounce so nothing fires after shutdown,
kills+unrefs a hanging in-flight child, and is idempotent.

### Full suites

| Suite | Before | After |
|---|---|---|
| `marsin_engine` `npm test` | 2324 tests, 2316 pass, **8 fail** | 2347 tests, 2339 pass, **8 fail** |
| CaptainPad `vitest run` | 886 pass, 6 skipped | **889 pass**, 6 skipped, 41 files |
| CaptainPad `tsc --noEmit` | clean | clean |

**The 8 engine failures are the same 8 before and after — none are mine.** I
verified this rather than assuming it:

- 7 are assertion failures in three files this change never touches:
  `tests/audio/audio_capture.test.js` (5 × `device_not_configured` — Windows
  audio capture needs a pinned mic), `tests/io/osc_listener.test.js` (`bind
  EACCES` where the test wants `EADDRINUSE`), `tests/patterns/specialty_white_uv.test.js`
  (playlist parity, R2's parked work-in-progress). Running those three files
  alone reproduces exactly 7 failures.
- The 8th is a **file-level Node test-runner IPC artifact** on
  `effects_v2_mode_page_layout.test.js`: `Unable to deserialize cloned data …`
  raised inside `node:internal/test_runner/runner`. Proven not mine three ways:
  the file passes **47/47, exit 0, 3 runs in a row** in isolation; the full suite
  reproduces it identically **with my two new test files removed**; and a serial
  run (`--test-concurrency=1`) of `tests/effects/*` + `tests/vsn1/*` gives
  **465/465 pass, exit 0**. It is a parallel-load artifact in Node's runner.

One existing test file was edited: `tests/effects/effects_v2_mode_page_layout.test.js`
now passes `probeFn: async () => 'attached'` at its ten enabled-hook call sites.
Without it the new probe child appears in each test's `calls[]` array and breaks
spawn-count assertions. Injecting the probe is the right fix — those tests are
about the deploy contract, not about presence — and the file is back to 47/47.

### Real-child end-to-end (no fakes, no ports, no device)

`~/tmp/vsn1_debug/verify_attach_real_child.mjs` drives the hook with the **real**
`spawn` and the **real** `probe_vsn1.cjs`, with the VSN1 currently unplugged:

```
--- boot: probeAttach() ---
🎛 VSN1 not attached — layout deploy skipped (deploys resume on next change once attached)
  attachState = detached
--- three layout edits ---
--- result ---
  children spawned      : ["probe_vsn1.cjs","probe_vsn1.cjs","probe_vsn1.cjs","probe_vsn1.cjs"]
  lastResult            : skipped-detached
  attachState           : detached
  pendingPages          : []
  layout YAML written   : true
  deploy_layout.cjs runs: 0
```

Before this change the same sequence would have spawned **four full deploy CLIs**,
burned four ~2–3 s compiles, failed four times, re-queued the page four times and
painted four red banners. Re-run the same script with the device plugged in to
see the `attached` path.

I did **not** spawn a full engine for a manual smoke: the harness that does so
emits sACN, and the operator's sim is live on this machine. The boot path is
covered by the `probeAttach()` unit tests plus the real-child run above.

---

## 5. Operator follow-ups

### 5.1 Git — one command, yours to run (I performed no git operations)

`.gitattributes` does not rewrite an already-checked-out tree. All nine templates
are still CRLF in the working tree right now. Step 1 makes that **harmless**, so
this is not urgent and nothing is broken without it — but it is what stops the
drift class:

```bash
cd "C:/Users/Titanic's End/workspace/BM26-Titanic"
git add --renormalize .
git status            # expect: the 9 tools/vsn1_config/templates/effects_layout/*.lua
git diff --cached --stat
```

The diff should be line-endings-only (`git diff --cached -w` shows nothing).
Commit it together with the code, and note in the message that already-checked-out
trees keep CRLF until re-checkout.

Also worth a one-time check on any other clone/worktree:

```bash
git config core.hooksPath .githooks     # per AGENTS.md, once per clone
git ls-files --eol tools/vsn1_config/templates/effects_layout/   # want i/lf
```

### 5.2 Still-useful diagnostic questions from `_30` §7

Q4 is now the only blocking one; Q1–Q3 stay valuable **only if the abort recurs**
after this change, since fixing the churn removes its trigger environment.

1. **Q1 — the abort's prefix.** When you saw
   `Assertion failed: … async.c:94`: was the line prefixed `[engine]`, embedded
   inside a `[VSN1] page 0 deploy FAILED: …` blob, or bare? (bare ⇒ the launcher
   aborted; own-line `[engine]` ⇒ the engine; embedded ⇒ the CLI child.) This is
   what step 12 needs to know where to look.
2. **Q2 — did `http://127.0.0.1:6968/status` still answer** right after the
   crash? Distinguishes "engine died" from "launcher died and force-killed the
   stack".
3. **Q3 — `node launcher.js …` or bare `node engine.js …`** in that session?
4. **Q4 — step 11 sign-off (BLOCKING, see §6).**

### 5.3 What you should see on your box now

- **Device unplugged:** one `🎛 VSN1 not attached — layout deploy skipped …` line
  at boot and no further noise however much you edit; CaptainPad shows a neutral
  "VSN1 offline — layout deploy skipped" strip, not the red one.
- **Device plugged in:** a normal deploy, page 0, ≤909 chars, no overflow error.
- **Unplug mid-session, edit, replug, edit:** one skip line on the way out, a
  `🎛 VSN1 attached — layout deploy resumed.` line on the way back, and page 0
  re-queued once to catch up.

---

## 6. Step 11 — deferred, awaiting operator sign-off

**Not implemented.** `_30` step 11 changes `launcher.js` supervision semantics:
recognise abort-class exit codes (3, 134, 3221226505) in the engine child's
`onExit` and **restart the engine once with bounded backoff** (>2 aborts in
10 min ⇒ teardown as today) instead of tearing the whole stack down. `_30` §7 Q4
asks for approval and it has not been given, so `launcher.js` is **untouched**.

**Nothing else in this change depends on it.** Steps 1–10 stand alone: the
overflow fix, the guard, the attach state and the teardown hygiene are all
independent of supervision policy. Step 11 is the belt to their braces — it is
what makes an *unpinned* teardown race unable to end the night, which is the one
guarantee this change does not provide. If you want it, it is a small, contained
edit to one `onExit` handler.

---

## 7. Session residue

- **No git operations.** No branch, stage, commit, checkout or renormalize.
- **No ports bound.** No engine spawned by hand; no `titanic-ext` contact. The
  engine test suite spawns its own engines on random 7100–7400 ports as it always
  has.
- `~/tmp/vsn1_debug/` — Fable's `measure_templates.cjs`, `repro_child_abort.cjs`,
  `stage_diff.cjs` (reused, unmodified) plus my `verify_attach_real_child.mjs`.
  All offline; `~/tmp/` is gitignored.
- Test logs under `~/tmp/engine_test_*.log`, `~/tmp/serial_effects.log`.
- Working tree: the nine `.lua` templates remain CRLF pending §5.1 — harmless by
  construction now, and asserted harmless by the new test.
