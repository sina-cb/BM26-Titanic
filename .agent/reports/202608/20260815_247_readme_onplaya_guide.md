# _247 — README rewritten as the on-playa operations guide

**Date:** 2026-08-15 · **Branch:** `feat/bm_audio_tuning` (shared tree) · **Agent:** _247 (Fable designer/writer)
**Operator order (verbatim):** *"review this readme and the state of the tools we
have to launch and monitor and deploy here: README.md. even explain how to
install deps, launch services individually, the prod and dev launcher envs.
their diffs in a nice table. also, I want to have this treated as our main on
playa guide to do all from the machine that is running the engine, and from the
debug laptop that I will have with me. explain the services that come up,
explain the --no-launch for prod, dev launching 3 apps in desktop. and keep it
tight, and to the point"*

**One tracked file edited: `README.md`** (plus this report + the tracker block).

---

## 1. What was reviewed (ground truth, current state)

* `launcher.js` post-`_245`: profiles table (prod/dev/dev-lite — ALL now run
  CaptainPad), sACN priorities 150/120/120, prod = `2d_pixels` sim profile,
  prod serves the prebuilt `CaptainPad/dist` via `tools/static_web_server.cjs`
  and refuses to start without `dist/index.html`, `CI` deleted from the
  captainpad child env, `REACT_NATIVE_PACKAGER_HOSTNAME` auto-detected
  (`--lan-host`/`BM26_LAN_HOST`), `--force-sacn` accepted, `--no-launch`
  (alias `--no-open`), prod force-claims ports by default, `setup` subcommand,
  `status` with frame-flow read, `stop` with blackout-before-kill,
  engine exit-75 tracked scene-switch restart, `BM26_SECRETS` validation.
* `_245` report §2–§5 (profiles, static server rationale, deploy dry-run,
  operator checklist) and `_246` (CaptainPad now DERIVES the engine address
  from the serving host — landed, so the README documents derivation, not the
  manual CONFIG step).
* `deploy/CHEATSHEET.md` + `deploy/deploy.py` (stdlib-only Python),
  `scripts/security_check.py` (stdlib-only), per-subsystem `package.json`
  (no root one; `web:build`, `pixel-views:export` verified as real scripts).
* Monitoring reality: launcher supervision + teardown-on-child-death
  (CaptainPad show-critical on prod), `status` frame-flow probe, engine
  `GET /status`, bench-mirror ARM/DISARM + burst-skew rollup lines in
  `simulation/server/sacn_bridge.js` (post-`_233` semantics: rollup benign,
  STUCK verdict only on `NO whole frame` + `PERSISTENT multi-step offset`,
  `RESTART THE ENGINE` advice deleted), `[sACN Out] Sender started — …
  priority N` in `marsin_engine/lib/sacn_output.js`.

## 2. New README structure

1. **Quick Start (engine machine)** — clone, hooks, `launcher.js setup`
   (per-subsystem installs, online pre-playa), `BM26_SECRETS`, `web:build`,
   the prod launch line, the exact ✅ lines to expect.
2. **Services and Ports** — the 4 services / 8 ports table + one-line data-flow
   diagram; startup order; full-stack-smoke pointer.
3. **Profiles: prod vs dev** — the diff table (use, processes, sim profile,
   sACN priority, CaptainPad serving mode, preconditions, port claiming,
   auto-open), why prod outranks dev on sACN, CaptainPad show-critical note.
4. **`--no-launch` and auto-open** — dev's 3 desktop windows; the show-box boot
   chain (task → `boot_server.ps1` → `prod --no-launch`).
5. **Running Services Individually** — sim / engine (+mic) / CaptainPad /
   companion, exact commands + when.
6. **Debug Laptop and iPads (LAN)** — URL table with `<engine-machine>`
   placeholders, `_246` address derivation + CONFIG override, Expo Go LAN host.
7. **Monitoring and Health** — supervision semantics (exit-75 exception),
   `status` frame-flow, engine `/status`, log-lines table (sACN Out priority,
   bench mirror ARM/DISARM, burst-skew benign, real STUCK verdict,
   EnginePriority), states residue + lock location.
8. **Deploying to the Show Box** — distilled `_245` §5: build dist → reachability
   + node parity → dry-run (with must-NOT-list names) → deploy → verify row →
   rollback (`--restart-only`, full re-mirror, `deploy.py stop`); private-repo
   pointer by name only; tests-excluded note.
9. **Troubleshooting Quick Hits** — port conflicts, prod refusals, stale Metro
   (`CI`), Expo loopback bundle, Live Touch pixel-view regen
   (`npm run pixel-views:export`), bench-mirror stuck (post-`_233`), ARMED
   bridge kill-refusal + `--force-sacn` cost, scene-switch-is-not-a-crash.
10. Kept and trimmed: sim screenshot renderer section (verbatim workflow), repo
    map (+ `tools/`, `deploy/`, `LookingGlass` flash warning), key docs links,
    mission, maintainer.

Removed: the stale profile table (said prod = sim + engine only), the
"Quick Fetch & Run a Branch" block (branch-specific dev noise; its `npm ci`
Metro cure lives on in Troubleshooting), the three-terminal framing (now
"Running Services Individually"), duplicated per-component marketing prose.

**P0 compliance:** no future dates/deadlines, no dotted-quad IPs
(`<engine-machine>` / `<show-box>` placeholders), no credentials, private repo
referenced by name only. No git operations performed.

## 3. Found while reviewing (flagged, not fixed — code untouched)

1. **Stale comment in `launcher.js`** (~line 966, `openProfileUis` header):
   still says `prod (no captainpad process) → sim → Companion`. Since `_245`,
   prod includes captainpad and opens all three UIs. Comment-only rot.
2. **Two reports share the `_245` slot**
   (`20260815_245_launcher_prod_deploy_prep.md` and
   `20260815_245_deck_transition_debug_audit.md`) and `_249` already exists —
   the report-number claim discipline slipped somewhere in the wave.
3. **`deploy/CHEATSHEET.md` "Dev quick-ref"** describes `dev` as
   "sim + engine + CaptainPad" — true, but omits the audio companion; harmless
   shorthand, noted for that file's owner.
4. **README's old prerequisite table drift** (now fixed by this rewrite): the
   pre-`_247` README claimed prod ran only sim + engine and made no mention of
   `web:build`, sACN priorities, the companion, `--no-launch`, `status`
   frame-flow, or the deploy path — it predated `_195`–`_245` entirely.

## 4. Verification

* Every command in the new README was checked against the current source:
  launcher flags/subcommands against `parseArgs`/`usage()`, npm scripts against
  each `package.json`, deploy lines against `deploy.py` + `_245` §5, log lines
  against `sacn_output.js` / `sacn_bridge.js` greps.
* `_246` landing confirmed at the tracker tail → derivation documented instead
  of the manual CONFIG step.
* No servers started or killed; no ports touched; no code edited.
