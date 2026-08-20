# _236 — The perf-exit hang, and a persisted boot-mode toggle

Two operator orders, one wave.

> "when going from perform mode to the edit mode, now the 'restore pre-show' or
> the 'Keep live state' isn't making progress anymore. please fix"

> "in the config, add a new config toggle to go straight to edit mode or
> performance mode, and make sure that's stored as part of the state persisted"

Both are done, both are reproduced-then-pinned offline, and the engine needs a
restart to pick either of them up (§5).

---

## 1. The hang — root cause

Reproduced on an isolated auth-required engine (`:17236`, `--dest 192.0.2.x`,
fixture secrets) driving a fresh CaptainPad dist on `:7170` whose served bundle
hash was verified against the export. **The engine was never at fault**: raw
`POST /performance-mode {active:false, exitAction:'keep'|'restore'}` with the
owner passcode answered `200` in **95 ms / 121 ms**, and the whole `_228` suite
is green. The bug was entirely in the pad, and it was two bugs wearing one
symptom.

### (a) The choices were silently disabled while the passcode field was empty

`ExitPerformanceSheet` computed

```ts
const choicesDisabled = pending || (passcodeRequired && passcode.length === 0);
```

so on the operator's engine (`authRequired:true`) **both exits rendered at 0.45
opacity with `aria-disabled`, swallowed the tap, fired no request, and printed
no reason anywhere on the screen.** Tap RESTORE PRE-SHOW → nothing happens,
forever. That is the operator's sentence verbatim, and the offline repro shows it
exactly: the click lands, `engine after` is byte-identical to `engine before`, no
network request, no error text, no swallowed alert — just a dead button.

Two things were wrong with it. It was **mute** (nothing explained the greying),
and it was a **client-side guess at a gate the engine owns** — a pad holding a
stale `authRequired` could have bricked a legitimate exit on a bench.

Fixed: the choices disable only while a request is in flight. An empty submit now
POSTs and earns the engine's own `401 EXIT_AUTH_REQUIRED`, rendered in the
sheet's error box. That costs nothing against the lockout ring —
`verifyPrincipalPasscode` returns on a missing header *before* `verifyPassphrase`
is reached, so mashing the button cannot 429 the operator mid-show. A standing
hint now sits under the field: *"This engine requires an operator passcode to
leave performance mode. Whoever types it owns what gets saved for the rest of the
edit session."*

### (b) Every non-family refusal went to a function that does nothing

`doExit` mapped the four `EXIT_*` codes into the sheet and sent **everything
else** to `Alert.alert`. react-native-web 0.21.2 ships:

```js
class Alert { static alert() {} }   // node_modules/react-native-web/dist/exports/Alert
```

An empty stub. So a `400 PERFORMANCE_MODE_NOT_ACTIVE` (a second pad exited
first), a `423 TOUCH_CONTROL_LEASE_HELD` (Live Touch armed — `/performance-mode`
is not in `TOUCH_CONTROL_EMERGENCY_PATHS`), a `409 SPECIAL_EVENT`, a `500`
missing/corrupt pre-show snapshot, or the client's own 8 s timeout **all left the
sheet open with no message and no mode change.** Proven offline: raced the engine
out of the lock, tapped RESTORE, and the pad rendered nothing at all.

Fixed: `performanceExitFailureMessage()` in `utils/edit_session.ts` **always**
returns a sentence — named guidance for every code this route can answer with,
and the machine code itself for anything unrecognised. It keeps the module's
standing hygiene rule: only a `SCREAMING_SNAKE` enum is ever echoed (a
charset that cannot carry a passphrase, a path, or a sentence), never a raw
engine body. It lands in the sheet's own error box, not a toast — the sheet
persists, a 7 s toast does not, and the operator is already looking at the sheet.

A concurrent agent migrated this file's `Alert.alert` calls to `opError` while
this wave was in flight; that work is kept (the ENTER path now toasts visibly)
and the exit path goes further, into the sheet.

**Not the cause, checked and ruled out:** the operator's pad is NOT on a stale
bundle — their `:6967` Metro bundle contains `EXIT_KEEP_SAVE_OWNER_ONLY`,
`Operator passcode`, `EDIT_PRINCIPAL_READONLY` and `editPrincipal`. The engine's
exit route, the W4 backlog skip, the dedup fix in `_emit`, and CORS preflight
(204 before any gate, header allow-listed) were all verified working.

---

## 2. The boot-mode toggle

`bootMode: 'performance' | 'edit'` — an **engine-persisted** operator preference
in `settings_state.yaml`, the same file and the same atomic write as `autoSave`,
reached through the existing `POST /settings` (no new route), broadcast on
`engineSettings` so every pad agrees. CONFIG tab → ENGINE SETTINGS → **BOOT
MODE**, under AUTO-SAVE, with copy that says it applies on the NEXT engine start.

### The semantics chosen, and why

**Boot-into-EDIT lifts the show lock. It does NOT lift the auth gate.**
`editSession.principal` still starts `null`, so on an auth-enabled engine
`principalMaySave()` is false: structural editing is open, every automatic save
is frozen, and all eight `_228` D6 writers `403` until someone identifies through
`POST /edit-session`. Editable rig, frozen disk.

That is the reading `docs/56` forces. Its gate is engine-side precisely so it
never opens by itself; booting straight into an ownerless *saving* session would
mean the engine started persisting to disk with nobody having proved who they
are, which is the exact hole D5 exists to close. And it needs no new UI: the pad
already renders `NO EDIT SESSION — NOT SAVING` for a null principal with auth on
and perf off (D8) — a state that used to be reachable only through boot-unlock
edge cases and is now a first-class mode.

Three further rulings, each pinned by a test:

- **Default `'performance'`**, and any unreadable/absent value coerces to it.
  An old `settings_state.yaml` with no `bootMode`, a typo (`edti`), a number, a
  `null` — all load as `performance`. A gate that opens because a YAML value was
  unreadable is exactly the quiet fallback the codex forbids, so this coerces the
  same direction `autoSave` coerces (toward "keep the safe behaviour"), not
  toward convenience.
- **An interrupted show still wins.** A reserved `performance-preshow` snapshot
  on disk means the engine died mid-show, so the lock resumes regardless of the
  toggle — a crash must not hand the rig to whoever restarts the process.
- **No pre-show snapshot is captured on an edit boot.** Nothing is locked, so
  there is nothing to restore to; the normal POST-enter path still captures one.

The route rejects an unknown `bootMode` with `400 INVALID_BOOT_MODE` rather than
coercing (no silent guess on a safety-critical toggle), the field is optional on
the wire so every pre-`_236` client keeps working, and it inherits `/settings`'s
existing gates: `409 PERFORMANCE_MODE` while a show is live, `403
EDIT_PRINCIPAL_READONLY` for a sailor session. Auth-disabled engines persist and
report the field but arm nothing — benches boot unlocked either way.

---

## 3. What changed

**Engine**
- `lib/state_manager.js` — `BOOT_MODES`, `normalizeBootMode()`,
  `load/saveSettingsState` carry `bootMode`.
- `lib/api_server.js` — `bootLockForShow` reads the toggle (+ one log line on an
  edit boot); `POST /settings` validates and persists `bootMode`.

**CaptainPad**
- `utils/edit_session.ts` — `performanceExitFailureMessage()` (total, hygienic).
- `components/ExitPerformanceSheet.tsx` — the passcode-empty disable is gone;
  standing hint under the field.
- `components/PerformanceModeControl.tsx` — `doExit` has no branch that ends
  without a visible sentence.
- `components/performance_mode_logic.ts` — `PASSCODE_REQUIRED_HINT`.
- `components/engine_settings_logic.ts` — `bootMode` in the card state,
  `normalizeBootMode`, `withBootMode`, `bootModeHint`, `BOOT_MODE_OPTIONS`.
- `app/(tabs)/config.tsx` — the BOOT MODE group.
- `utils/api.ts` — `EngineSettings.bootMode`.

**Docs** — `docs/56` carries both amendments (the boot toggle under D1, the
loudness rule under D8).

---

## 4. Verification

**Engine `npm test`: 3451 tests, 3444 pass, 7 fail** — and the failing list is
the stated baseline family, nothing more: 5× `dev_test_bench` (`all_models_load_lint`)
plus the 2 Baby-playlist cross-scene parity findings from the concurrent curation
wave. Nothing new is red.

- **NEW `tests/security/boot_mode_toggle.test.js` — 9/9.** Default boot still
  locks; the toggle 409s under the show lock and 403s for a sailor; `'edit'`
  persists to `settings_state.yaml` without moving the current session; a restart
  comes back UNLOCKED with `editPrincipal:null`, no pre-show snapshot, live edits
  `200` and `save-now` `403`; asserting owner opens persistence; flipping back
  re-locks; a junk YAML value loads as `performance`; auth-off is inert.
- `tests/state/settings_state.test.js` — 8/8 (grew 4 `bootMode` pins).
- `tests/security/principal_scoped_persistence.test.js` — **9/9**, unchanged.
- `captainpad_auth_api` 4/4, `special_events_timeline_api` 3/3,
  `live_touch_timeline_priority_api` 3/3, `performance_mode` 11/11,
  `autosave_gating` 7/7, `state_corrupt_load` 6/6, `http_malformed_sweep` 36/36.

**CaptainPad `vitest`: 80 files, 1584 pass, 6 skip, 0 fail — failing list EMPTY.**
`tsc --noEmit` clean for this wave (the only errors are a concurrent agent's
in-flight `pixel_view_logic` work). `eslint`: **0 errors**, warning set unchanged.
New pins: 5 in `utils/edit_session.test.ts` (the mapper has no silent branch;
family copy is byte-identical; unknown codes carry the code; the no-code case;
secret hygiene extended to the new mapper), 1 in `performance_mode_logic.test.ts`,
and `engine_settings_logic.test.ts` rebuilt to 20.

**Browser regression + screenshots** —
`simulation/agent_tools/exit_sheet_regression.cjs` (new, re-runnable, asserts as
well as captures; aborts any stray `:69xx` request so every frame provably comes
from the isolated engine). **17/17 checks pass.** Output in `~/tmp/fix_236/`:

| file | shows |
|---|---|
| `r1a_sheet_before_any_tap` | both exits at full opacity + the standing hint (the before-state the old build greyed) |
| `r1b_empty_passcode_refused_loudly` | "An operator passcode is required to leave performance mode." in the error box |
| `r2_wrong_passcode_refused` | "Passcode rejected." + field wiped |
| `r3_non_family_refusal_visible` | the `PERFORMANCE_MODE_NOT_ACTIVE` sentence — the case that used to render nothing |
| `r4a_before_keep` / `r4b_after_keep` | KEEP resolves: sheet closes, PARAMETERS/AUTOPILOT return, engine `active:false, editPrincipal:'owner'` |
| `r5_after_restore` | RESTORE resolves the same way |
| `r6a_boot_mode_performance` / `r6b_boot_mode_edit` | the new toggle in both positions, each persisted to the engine |

The pre-fix repro screenshots (`repro_nopass_1_sheet.png`, the dead greyed
buttons) are in the same directory.

**Isolation.** Nothing was bound, started or killed on 6966-6972 / UDP 5568. The
operator's engine was read with GETs only (`/performance-mode`, `/status`) and
their `:6967` Metro bundle was fetched read-only once to rule out a stale build —
no POST, no passcode, no mode toggle. Test and capture engines ran on 17236 /
17237 / 17238 with scratch state + playlist dirs and `--dest 192.0.2.x`
(TEST-NET-1). Fixture passcodes are obvious placeholders living only in `~/tmp`
(gitignored) and in the suites' own scratch YAML. `CaptainPad/dist` was rebuilt
(gitignored). No git operations.

---

## 5. The engine must be restarted

**Yes, for both halves.**

- **Part 1** is a pad-side fix, but the operator's pad is served by the Metro dev
  server on `:6967` — a **hard reload of the pad** (and, per the standing note
  about this box serving stale bundles, a Metro restart if the reload does not
  pick it up) is what makes the fix live. No engine change is required for the
  hang itself.
- **Part 2** changes engine code (`state_manager.js`, `api_server.js`), so the
  **engine must be restarted** before the CONFIG toggle appears or has any
  meaning — a running `:6968` will answer `GET /settings` without `bootMode`, and
  the card will simply keep showing its default. And by design the setting itself
  only takes effect on the boot after the one where it was set: restart once to
  load the code, set the toggle, and the *next* start honours it.

---

## 6. Follow-up worth filing

`Alert.alert` is still imported in a handful of CaptainPad surfaces, and on the
web build every one of them is a silent no-op. `utils/op_dialog.ts` (the
2026-08-15 operator ruling) is the replacement and a concurrent agent has begun
the migration; a sweep that finishes it — and a lint rule banning the raw import
— would close this class of bug rather than this instance of it.
