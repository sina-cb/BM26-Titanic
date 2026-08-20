# _228 — Principal-scoped persistence: implementation + validation

**Implements `docs/56_principal_scoped_persistence.md` (the `_226` design) in full —
W1 through W8.** The operator's order was:

> "I want the parameters to not be stored unless we are in edit mode with Sina's
> passcode. on initial launch, go into Performance mode on captain's pad, then
> when going into edit mode, you ask for pass code, when Sina's passcode is
> entered only allow auto saves for the parameters. if Misha or other sailor is
> entered, don't store params for the patterns or playlist changes"

That is now true, engine-side, and visible on every pad.

---

## 1. What shipped

### W1 — `editSession` + the principal term (`marsin_engine/lib/api_server.js`)

A new in-memory `editSession = { principal, unlockedAt }` next to
`performanceMode`, plus:

```js
function principalMaySave() {
  return !captainPadAuth.required || editSession.principal === 'owner';
}
function effectiveAutoSave() {
  return engineSettings.autoSave && !performanceMode.active && principalMaySave();
}
```

`setEditPrincipal(principal, why)` is the single mutator and logs **one line per
transition** (D8) — never per cycle. The ~80 automatic persistence triggers
needed no edits at all: they already re-read `effectiveAutoSave()` **at write
time**, which is also why a principal that flips while an auto-save timer is in
flight is honoured rather than raced (D9).

### W2 — the engine boots LOCKED when auth is required

`bootLockForShow = captainPadAuth.required && !interruptedPerformanceMode`. The
lock is armed in the performance-mode init block, **before anything can serve a
request or auto-save**; the reserved pre-show snapshot is captured later, right
after the boot restore completes, because `captureLook()` serializes the
RESTORED mixer — a snapshot taken at the init block would have restored the
operator to a bare boot rig. Capture failure there is **fatal** (throws, aborts
startup): a disk that cannot write the pre-show snapshot cannot persist state
either, and booting unlocked because the disk misbehaved is exactly the quiet
fallback the codex forbids.

Auth-disabled engines are untouched — no lock, no snapshot, byte-identical.

### W3 — perf exit takes a fresh passcode, and the D7 exit matrix

The session check at the old `:12884` is **gone**. `POST /performance-mode
{active:false}` now runs `verifyPrincipalPasscode()` (shared helper, same ring /
same lockout / same never-echo posture as `checkTakeoverPasscode`) and the
verified principal becomes the edit session. Entering stays free.

| exitAction | owner (or auth off) | collaborator / bringup |
|---|---|---|
| `keep-save` | `forcePersist` + `flushPendingDeckCaptures` | **400 `EXIT_KEEP_SAVE_OWNER_ONLY`** |
| `keep` | `forcePersist` | no `forcePersist` — disk keeps the pre-show state |
| `restore` | recall + `forcePersist` | recall, no `forcePersist` (disk already equals it) |

### W4 — the sailor backlog skip

`captureOrDeferOutgoingDeckEntry` skips `recordPendingDeckFlush` when
`!performanceMode.active && !principalMaySave()`. **Performance mode is
deliberately excluded from the skip** — while the show lock is on there is no
edit session at all, yet that backlog is what feeds the exit sheet's "N unsaved
entries" ask and the owner's `keep-save` flush. Without that exclusion the
design's own "perf-mode accumulation unchanged" acceptance criterion would have
broken. In-session continuity is untouched: `stowSessionParams` stays
unconditional.

### W5 — `rejectIfPrincipalReadonly` at eight route heads

A 403 `EDIT_PRINCIPAL_READONLY` sibling of `rejectIfPerformanceMode`, always
placed **after** it so a locked show outranks identity. Applied to: `POST
/playlists`, `DELETE /playlists/:name`, the modulation and MIDI-mapping mutation
routes, `POST /deck/playlist/capture`, `POST /mixer/channels/:id/playlist/capture`,
`POST /settings`, `POST /settings/save-now`. One warn line per refusal.

Live param writes and structural edit routes stay OPEN, as designed — sailors
edit the rig live, they just don't write it down.

### W6 — `POST /edit-session`

Escalation and handover in one route: any valid passcode replaces the principal.
409 `EDIT_SESSION_PERFORMANCE_ACTIVE` while locked; 503 `PRIVILEGED_AUTH_DISABLED`
on a bench (fail loud rather than pretend a session was asserted); 401/429 from
the shared ring.

### W7 — CaptainPad

- `PerformanceModeState` grows `editPrincipal` **and `authRequired`**.
  `authRequired` is a small addition to the design: a null principal is
  ambiguous on its own (on a show engine it means "nobody has unlocked saving",
  on a bench "there is no gate"), and the engine knows the answer, so it now
  states it on every `performanceMode` frame, the GET and the WS replay. Only a
  real boolean adopts; an absent field preserves the previous value, so a
  pre-`_228` engine never invents or erases a gate.
- **Exit sheet**: an operator-passcode field using the `takeover_passcode_sheet`
  idiom (one `useState`, wiped on submit and on close, no remember affordance),
  an error box that renders the engine's refusal, and a `Captain's passcode
  only.` caption under KEEP & SAVE TUNING. The passcode rides the SAME request
  as the choice — one entry, one verification, atomic with the action.
- **Session chip** (`components/edit_session_chip.tsx`): amber
  `SAILOR SESSION — LIVE, NOT SAVING` / `CREW SESSION …` / `NO EDIT SESSION …`,
  mounted beside `PerformanceModeControl`. Renders NOTHING for an owner session,
  under the show lock, or on an auth-disabled bench — normal is silent. Tapping
  it opens the escalation sheet whose copy states the D4 consequence verbatim.
- **Locked idiom**: a new `useEditPersistLock()` folds into PlaylistPanel's
  existing `editable`, so playlist CRUD wears the same read-only face a sailor
  session already earns from the engine.
- `utils/edit_session.ts` — a dependency-free leaf holding the refusal copy and
  `TAKEOVER_PASSCODE_HEADER` (relocated there so the four transports that need
  it share one definition and no suite that mocks a transport can make it
  vanish).

---

## 2. Three defects found while validating

These were not in the design; they were found by driving the real thing.

**(a) The exit sheet was unreachable on a freshly boot-locked engine.** Opening
it required a privileged CaptainPad *session*, and on a fresh show engine no pad
has one — so tapping EDIT opened the login sheet, which mints exactly the session
D2 rules must be ignored. Two credentials for one act, and the design's stated
flow ("tap EDIT → passcode+choice sheet") was impossible. Fixed: when
`authRequired`, the EDIT chip and `openExitSheet` go straight to the exit sheet.
The passcode typed there IS the authorisation. Auth-off benches are unchanged.

**(b) The escalation broadcast was silently swallowed.** `_emit()` in
`usePerformanceMode.ts` skipped the fan-out unless `active`, `enteredAt` or the
dirty key changed — and `POST /edit-session` changes ONLY `editPrincipal`. The
amber chip never cleared when Sina took the session, and every pad kept showing a
stale identity while the engine had already changed what it persists. Fixed by
putting `editPrincipal` and `authRequired` into that identity. This one is worth
remembering: a no-op guard is a correctness surface, not an optimisation.

**(c) The chip truncated the half that matters.** In the 80pt sidebar the label
clipped to `SAILOR SESSION — LIVE, NOT …`. A warning that hides "NOT SAVING" is
worse than no warning; the line count and letter-spacing now let it wrap whole.

---

## 3. Validation

### Engine suite — the baseline held exactly

`npm test` failing list: **5× `dev_test_bench` groupBits
(`all_models_load_lint`) + `baby_color_contract` + 4× `party_dancers`** — the
stated `_226` baseline (the `playlist_gallery` baby red is now the
`baby_color_contract` file, and `party_dancers` is the concurrent audio branch).
**Nothing new is red.** Two failures in an earlier run
(`timeline_zoom_e2e` X4, 4× `deck_entry_autocapture`) did not reproduce in
isolation or on re-run — they are port/concurrency flakes: `deck_entry_autocapture`
uses `portBase 6960` with the default span 300, which overlaps the operator's
live stack at **:6966-:6972**. Worth narrowing in a follow-up; not touched here.

New suite: **`marsin_engine/tests/security/principal_scoped_persistence.test.js`
— 9/9 green.** Covers D1 (boots locked, snapshot exists, `/edit-session` 409s),
D2 (bare / session-token / wrong-code all refused, secret never echoed), D7 (the
keep-save 400 and the sailor keep), D5 (SHA-256 of the state + playlist tree
unchanged across live churn), D6 (403 on all eight writers, files untouched), D3
(escalation opens persistence observably without a restart; handover refreezes),
D9 (SIGKILL mid-sailor-session → disk intact, reboots locked), and the auth-off
regression (boots unlocked, gates inert, `/edit-session` 503).

Three existing auth-enabled suites were updated for the new boot state and the
passcode exit and are green: `captainpad_auth_api`, `special_events_timeline_api`,
`live_touch_timeline_priority_api`.

### CaptainPad — failing list EMPTY

`npx vitest run` → **75/75 files, 1498 pass, 6 skip, 0 fail.** `tsc --noEmit`
clean. `eslint` reports **zero errors** on every file this wave touched (the 10
repo-wide errors are pre-existing `no-undef` on `scripts/osc_synth.mjs`).

New: `utils/edit_session.test.ts` (refusal copy + a secret-hygiene test proving no
mapper can carry an attempted passcode into the UI) and
`utils/edit_session_api.test.ts` (wire-level: header only, never URL or body,
never leaked into the next request). `performance_mode_logic.test.ts` grew pins
for the principal reconcile, `editSessionChip`, `editPrincipalMaySave` and the
owner-only caption.

### Disk-state proof (isolated engine :17228, TEST-NET-1 sACN, fixture secrets)

```
== SAILOR SESSION ==
before: a12e74d8a40dff0b
  6 live writes (3× control, 3× fader) + POST /settings/save-now → 403
                                        + POST /playlists       → 403
after : a12e74d8a40dff0b     ← IDENTICAL
== OWNER SESSION ==   (escalated via POST /edit-session)
before: a12e74d8a40dff0b
  POST /settings/save-now → 200
after : 54a3fdac057a8463     ← CHANGED
```

(SHA-256 over the scene's `states/*.yaml` plus the whole playlists tree; the
`snapshots/` subdir is excluded because the reserved pre-show snapshot is created
and deleted by the lock itself.)

### Screenshot matrix — S1-S10, all inspected

Fresh dist export (never the operator's `:6967`; `:7167` was already held by
another session's server, so the fresh export was served on its own high port),
console muted before boot, and — new — **puppeteer request interception that
aborts any request to `:69xx`**, so every frame in every capture provably comes
from the isolated engine rather than racing out to the config-default address
while `getApiBaseAsync()` resolves.

`~/tmp/fix_228/`: `s1_boot_locked_performance_face.png`,
`s2_exit_sheet_passcode.png`, `s3_wrong_passcode_refused.png`,
`s4_sailor_session_chip.png`, `s6_sailor_keep_save_refused.png`,
`s7a_escalation_sheet_copy.png`, `s7b_owner_session_no_chip.png`,
`s9_relocked_performance_face.png`, `s10_second_pad_same_session.png`.
S5 and S8 are the hash proofs above. Tool:
`simulation/agent_tools/principal_session_capture.cjs`.

What they show: the pad lands on the performance face with **zero taps**; EDIT
opens the passcode+choice sheet; a wrong code renders "Passcode rejected" and
wipes the field without changing mode; a sailor picking KEEP & SAVE gets the
engine's owner-only refusal in the sheet; the sailor session paints the amber
chip and `bench228 (locked)` while PARAMETERS/AUTOPILOT stay fully live; a
**second browser context shows the same chip and the same locked CRUD**; the
escalation sheet carries the "starts auto-saving the CURRENT live tuning" copy;
and after the owner code the chip is gone and the CRUD affordances return.

---

## 4. Isolation

Nothing was bound, killed or restarted on **6966-6972 / UDP 5568**. The
operator's engine was read with GETs only — no mode toggle, no passcode posted.
Test and capture engines ran on the coordinator-assigned **17228 / 17229** with
scratch state and playlist dirs and `--dest 192.0.2.x` (TEST-NET-1).

Fixture passcodes are obvious placeholders and live only in `~/tmp` (gitignored)
and in the test files' own scratch YAML. **No credential material is in this
repo**; principals travel as the public enum names only.

**Note for the coordinator:** the operator's live engine on :6968 already answers
with `editPrincipal` / `authRequired` and is **boot-locked** — it has picked up
this wave. No git ops were performed.

---

## 5. Open (operator nod, non-blocking)

Both defaults from `docs/56` §5 stand as designed; say the word and each is a
one-line change:

1. **Named-artifact authoring stays sailor-open** — snapshots, param presets, GEM
   slots, timeline and scheduler files do not overwrite the rig's restore-on-boot
   state, so `rejectIfPrincipalReadonly` was not applied to them.
2. **Edit sessions have no timeout** — a decaying principal would silently flip
   the persistence gate mid-tuning. The perf lock is the deliberate reset, and
   the chip keeps the current identity visible on every pad meanwhile.
