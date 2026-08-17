# 56 — Principal-Scoped Persistence (boot-locked engine + identity-gated saves)

**Status: SHIPPED (design `_226`, implementation + validation `_228`).** W1-W8
are all landed and the S1-S10 matrix is captured; see
`.agent/reports/202608/20260815_228_principal_scoped_persistence_impl.md` for
what changed against this contract. Three deviations, each recorded there and in
the sections below: the boot-lock's snapshot is captured **after the boot
restore** (§D1) because `captureLook()` needs the restored mixer; the sailor
backlog skip **excludes performance mode** (§D6 family 2) so the owner's
exit-time save-ask survives; and the broadcast carries **`authRequired`**
alongside `editPrincipal` (§D3) because a null principal cannot otherwise be told
apart from an engine with no gate at all. The two §5 defaults still stand.

Operator order (verbatim):

> "I want another thing for the live performance, I want the parameters to not
> be stored unless we are in edit mode with Sina's passcode. on initial launch,
> go into Performance mode on captain's pad, then when going into edit mode,
> you ask for pass code, when Sina's passcode is entered only allow auto saves
> for the parameters. if Misha or other sailor is entered, don't store params
> for the patterns or playlist changes"

This doc pins the exact semantics, the principal handshake, the gated save
surfaces (with file:line anchors), the UX, and the failure cases. It builds on
— and deliberately does not reinvent — three shipped mechanisms:

1. **Performance mode** already freezes ALL automatic persistence
   (`effectiveAutoSave()`, `marsin_engine/lib/api_server.js:1363-1365`) and
   captures a pre-show snapshot for deterministic restore
   (`api_server.js:12845-12874`).
2. **The passcode ring** already verifies the three named principals
   per-attempt with no session issuance
   (`verifyPassphrase`, `marsin_engine/lib/captainpad_auth.js:152-156`;
   takeover gate `api_server.js:4025-4085`; operator ruling 2026-08-14:
   "pass code is required EVERY TIME" — session tokens deliberately buy
   nothing).
3. **The _217 perf overlay** already renders the pad's performance face
   (PARAMETERS/AUTOPILOT hidden) as a pure derived view of the engine's
   broadcast state (`CaptainPad/components/deck/deck_workspace.tsx:215-217`).

What is missing, and what this design adds: (a) the engine **boots locked**,
(b) leaving the lock **identifies who unlocked it**, and (c) that identity —
not just the mode — **gates every path that writes rig state to disk**.

---

## 1. The five ruling decisions

### D1 — Boot mode: an engine with privileged auth enabled boots LOCKED

"On initial launch, go into Performance mode on captain's pad" is implemented
**engine-side, not pad-side**. CaptainPad has no mode of its own: it renders
the engine's broadcast state and never optimistically flips
(`CaptainPad/hooks/usePerformanceMode.ts`). A pad-side "boot into perf" would
be a lie one reconnect deep — and with several pads, an incoherent one.

Rule: **at startup, if `captainPadAuth.required` is true, the engine enters
performance mode before serving its first request.** No new config key:

- Privileged auth enabled (`BM26_CAPTAINPAD_AUTH_REQUIRED=1`, principals
  provisioned from the external `$BM26_SECRETS` file) **is** the show
  context — it is exactly the deployment where a passcode exists to unlock
  with. Boot-locked-without-a-key would be an unopenable box on benches.
- Auth disabled (benches, isolated test engines) boots unlocked, byte-identical
  to today. Zero churn across the existing test fleet, matching the existing
  inert-gate rule (`checkTakeoverPasscode`, `api_server.js:4036`; perf-exit
  gate, `api_server.js:12884`).

Boot-entry mechanics (anchor: the performance-mode init block,
`api_server.js:1353-1365`, executing after `snapshotManager` and the hoisted
`captureLook()`/`captureGlobalsForSnapshot()` are available):

- If the reserved `performance-preshow` snapshot already exists, this is the
  existing interrupted-restart path (`api_server.js:1354-1358, 1400-1410`):
  keep the snapshot (it is the older, still-correct pre-show restore source —
  disk was frozen the whole time), resume the lock. Unchanged.
- Otherwise capture the snapshot from boot state (disk state == memory at
  boot, so the snapshot is exactly "as Sina left it") and set
  `performanceMode.active = true`.
- Snapshot capture failure at boot is **fatal** (throw, abort startup). A disk
  that cannot write the pre-show snapshot cannot save state either; the POST
  enter path already refuses entry on capture failure
  (`api_server.js:12852-12861`) — boot applies the same "never locked without
  a restore point, never silently unlocked" logic, and codex P0 forbids the
  quiet fallback of booting unlocked.

Pad behavior on launch needs **no change**: until the REST seed resolves,
`usePerfLock()` reports locked (`usePerformanceMode.ts:163-169` —
`!performanceModeReady`), and once seeded the engine says `active:true`, so
the _217 overlay and every structural lock render the performance face.

**Amendment (report `_236`) — the boot mode is now an operator toggle.** D1's
rule "auth enabled ⇒ boot locked" is the DEFAULT, not the only option. A
persisted engine setting, `bootMode` in `settings_state.yaml` (the same file and
the same atomic write as `autoSave`; CONFIG tab → ENGINE SETTINGS → BOOT MODE;
`POST /settings {autoSave, bootMode}`; takes effect on the NEXT engine start),
selects between:

- `'performance'` — D1 exactly as written above. **Default**, and the value any
  unreadable/absent field coerces to: an unreadable YAML must never open a gate.
- `'edit'` — the engine comes up with the show lock OFF. **The auth gate is not
  lifted.** `editSession.principal` still starts `null`, so on an auth-enabled
  engine `principalMaySave()` is false: structural editing is open, every
  automatic save is frozen, and the eight D6 writers 403 until a principal is
  asserted through `POST /edit-session` (the pad's session chip, which already
  renders `NO EDIT SESSION — NOT SAVING` for exactly this state). Editable rig,
  frozen disk. No pre-show snapshot is captured — nothing is locked, so there is
  nothing to restore to; the normal POST-enter path still captures one.

Two invariants survive the toggle: an **interrupted show still wins** (a
reserved `performance-preshow` snapshot on disk means the engine died mid-show,
so the lock resumes regardless of `bootMode` — a crash must not hand the rig to
whoever restarts the process), and **auth-disabled engines ignore it entirely**
(no gate to arm; benches boot unlocked either way). The toggle is itself a D6
family-4 write, so a sailor session cannot change it and the show lock 409s it.

### D2 — Edit-mode entry: perf exit requires a fresh passcode, EVERY attempt

Today the exit gate accepts a privileged **session**
(`captainPadAuth.isPrivilegedRequest(req)`, `api_server.js:12884-12890`).
That changes: **`POST /performance-mode {active:false, exitAction}` must carry
`X-CaptainPad-Passcode`, verified per-attempt via `verifyPassphrase`** — the
same ring, the same lockout policy (5 failures/rolling minute → 60 s), the
same "sessions and remembered devices buy nothing" ruling as the takeover
gate. The CORS allowlist already carries the header (`api_server.js:6449`).

The verified principal (`owner` / `collaborator` / `bringup` — the enum names
from `captainpad_auth.js:11-15`; Sina / Misha / Sailors respectively) becomes
the **edit-session principal** (D3). Entering performance mode stays ungated —
locking the rig is always free, mirroring "the reverse direction is never
gated" (`api_server.js:4020-4022`).

### D3 — Principal handshake: ONE engine-global edit session, set at unlock

New engine state, in-memory only, next to `performanceMode`:

```js
const editSession = { principal: null, unlockedAt: null };
// principal: null | 'owner' | 'collaborator' | 'bringup'
```

Lifecycle:

- **Perf mode active** (including boot under D1) → `principal = null`. There
  is no edit session while the show lock is on.
- **Perf exit accepted** (D2) → `principal = <verified principal>`,
  `unlockedAt = ISO now`.
- **Perf enter** → cleared back to null.
- **`POST /edit-session`** (new route, empty JSON body, `X-CaptainPad-Passcode`
  header): re-assert the principal while already in edit mode. Any valid
  passcode **replaces** the current principal — this is both the escalation
  path (sailor session → Sina enters her code → saves open up) and the
  handover path (Sina walks away → a sailor enters theirs → saves freeze).
  409 `EDIT_SESSION_PERFORMANCE_ACTIVE` while perf mode is on (use the exit
  flow), 401/429 from the shared ring on bad codes. Rate-limit and
  never-echo-the-secret behavior come free from `checkPassphrase`
  (`captainpad_auth.js:112-140`).
- **Engine restart** → dies with the process. Under D1 the engine comes back
  locked; disk holds whatever an owner last persisted.
- **WS reconnect / pad reload** → no effect. The principal is engine state,
  not connection state; pads re-seed from `GET /performance-mode`.

Surface: `editPrincipal` (the enum or null) is added to the
`{type:'performanceMode'}` broadcast (`api_server.js:12864-12869, 12944-12947,
13000-13003`), the WS connect replay (`api_server.js:13601-13604`), and
`GET /performance-mode` (`api_server.js:12817-12824`). Payloads carry the
principal **enum name only** — never credential material, never a session
token.

**No timeout / no lease.** An edit session lasts until the next perf-enter or
the next principal assertion. Rationale: a decaying principal would silently
flip the persistence gate mid-tuning — precisely the kind of quiet behavior
change the codex forbids; the perf lock is the deliberate reset, and D8 keeps
the current principal loudly visible on every pad. (Live Touch deadman/lease
rules from the timeline-authority wave are untouched — they govern who drives
pixels, not who owns persistence.)

### D4 — Multi-pad precedence: persistence follows the GLOBAL session, not the pad

If two pads are connected and a change arrives from either one, persistence is
decided by the **engine-global edit-session principal**, not by which pad
touched the slider. Justification:

1. Disk is global — "is the engine saving" must have exactly one answer.
   Per-pad answers would let the same param write both save and not-save
   depending on which glass it came from, with one `deck_state.yaml` file.
2. Per-change attribution cannot be made honest. It would need a credential
   per request (passcode-per-slider — unusable) or a session token per pad
   (spoofable by any client that once logged in, and contrary to the
   "passcode EVERY TIME, sessions ignored" ruling this design inherits).
3. It matches performance mode's own engine-global semantics — the lock has
   never been per-pad; neither is its successor.
4. Show reality: the principal is "who unlocked the booth". Handing an
   unlocked pad to a sailor is a physical act the captain controls; the chip
   (D8) makes the active identity visible on every pad while it happens.

Consequence, stated plainly: **after Sina escalates a session to owner, the
current live look — including tweaks sailors made earlier in that session —
begins auto-saving.** That is intended: asserting the owner code is blessing
the current state, the same meaning `keep-save` has at perf exit. The
escalation sheet says so in its confirm copy (D8).

### D5 — The persistence gate, engine-side

Client-side gating alone would be a lie (any HTTP client can still write), so
every gate lands in the engine. Two mechanisms:

**(a) The automatic-save predicate grows a principal term** — one line, at the
single choke every auto-save trigger already reads (`api_server.js:1363-1365`):

```js
function principalMaySave() {
  return !captainPadAuth.required || editSession.principal === 'owner';
}
function effectiveAutoSave() {
  return engineSettings.autoSave && !performanceMode.active && principalMaySave();
}
```

Auth-disabled engines are unchanged (inert gate, as everywhere else). With
auth on: perf mode → frozen (as today); edit session as owner → stored
`autoSave` preference decides (as today); edit session as
collaborator/bringup, or no session yet → **frozen**.

**(b) Explicit file-writing routes get a 403 principal gate** — a sibling of
`rejectIfPerformanceMode` (`api_server.js:3980-3998`):

```js
// 403 {code:'EDIT_PRINCIPAL_READONLY', principal} when auth is on, perf is
// off, and the edit session is not owner. Logged once per refusal.
function rejectIfPrincipalReadonly(req, res, what)
```

### D6 — Exactly which save surfaces are gated

The engine's disk writes fall into four families. Anchors are to
`marsin_engine/lib/api_server.js` unless noted.

| # | Surface | Anchor | Today | Under a sailor session |
|---|---|---|---|---|
| 1 | Auto-save cycle: `deck_state` / `mixer_state` / `globals_state` (+ capture-on-entry-switch trigger) | `saveGlobals` :1472-1473, `saveAllState` :2005-2011, second choke :2048, all reading `effectiveAutoSave()` | frozen in perf mode; open in edit | **frozen** via the D5(a) principal term — no code change at the chokes themselves; they already re-read the predicate at write time |
| 2 | Deck capture-on-switch writeback of entry defaults | `captureOrDeferOutgoingDeckEntry` :1946-1972 → `captureActiveEntryDefaults` :2103-2111 → `writeEntryDefaults` :2114-2126 (THE single playlist-file writeback path) | autoSave on → write file; off/perf → `recordPendingDeckFlush` (:1390-1398) backlog for later flush | file write frozen by (a); **additionally, `recordPendingDeckFlush` is SKIPPED when `!principalMaySave()`** — sailor tuning must never enter the save backlog, or a later owner `keep-save` / autosave re-enable (`flushPendingDeckCaptures` :2133, call sites :12775, :12934) would flush it to disk behind Sina's back. Session continuity is untouched: `stowSessionParams` (:1930-1935) is deliberately unconditional (in-memory only) |
| 3 | Explicit playlist-file mutations: `POST /playlists` :11608, `DELETE /playlists/:name` :11662, modulation PUT/DELETE :11688-11782, MIDI-mapping PUT/DELETE :11800-11884 (writebacks via `playlistManager.save` :11623/:11671/:11737/:11762/:11782/:11839/:11864/:11884), explicit captures `POST /deck/playlist/capture` :12630 and `POST /mixer/channels/:id/playlist/capture` :13141 | route heads | write even with autoSave off ("explicit content-authoring") ; perf mode 409s the CRUD set | **403 `EDIT_PRINCIPAL_READONLY`** via D5(b) at each route head. Refusing loudly is the honest reading of "don't store playlist changes": an in-memory playlist overlay that evaporates on restart would be a silent drop wearing a success response — worse than a visible refusal, and a large complexity bill (every `playlistManager.load` caller would need overlay awareness) |
| 4 | Persistence controls themselves: `POST /settings` :12749 (writes `settings_state.yaml` :12766) and `POST /settings/save-now` :12779 (forced full persist :12795-12806) | route heads | open in edit mode | **403** via D5(b). `/settings` is a persistent config write ("disk stays as Sina left it"), and note the principal term also makes a hypothetical sailor `autoSave:true` flip harmless — `effectiveAutoSave()` still returns false. `/save-now` is the explicit "write everything now" act — owner only, or its 200 `{saved:true}` badge would lie |

**Deliberately NOT gated** (decision, not oversight): pattern/param LIVE
writes (they drive the rig — that is the point of a sailor edit session);
structural mixer/deck routes in edit mode (their persistence is family 1,
already principal-frozen; refusing the live action too would turn "edit works
live" into a second perf lock); snapshots, param presets, GEM slots, timeline
and scheduler files (named-artifact authoring that does not overwrite the
rig's restore-on-boot state files; perf mode already 409s the structural
ones); `POST /mixer/.../playlist/discard` :13164 (drops pending state, writes
nothing). If the operator wants sailor-proofing on named artifacts too, that
is a follow-up wave — the `rejectIfPrincipalReadonly` helper drops onto any
route head in one line.

### D7 — Exit semantics by principal (the forcePersist hole)

Today every exit path calls `forcePersist()` (`api_server.js:12911-12920`) —
a full disk write regardless of the autoSave toggle. If a sailor could exit
with `keep`, the live look — their look — would land on disk. Ruled:

| exitAction | owner | collaborator / bringup |
|---|---|---|
| `keep-save` | as today: `forcePersist` + `flushPendingDeckCaptures` when enabled (:12928-12934) | **400 `EXIT_KEEP_SAVE_OWNER_ONLY`** — mid-show tuning reaches playlist files only through an owner exit |
| `keep` | as today: `forcePersist`, backlog cleared (:12935-12942) | live look stays in memory; **NO `forcePersist`** (disk keeps the pre-show state — saves were frozen the whole show, so disk is already "as Sina left it"); backlog cleared |
| `restore` | as today: recall + `forcePersist` (:12952-13007) | recall snapshot + globals, caches cleared as today; **NO `forcePersist`** (disk already equals the restored state, byte-for-byte the frozen pre-show files) |

All exits still delete the reserved snapshot (uniform, as today) and broadcast
`performanceMode {active:false, editPrincipal}`. The session-cache rules are
unchanged (keep variants retain it, restore clears it — :12925-12927,
:12977-12984).

### D8 — Loud, not spammy (codex no-fallback vs. mid-show error storms)

A refused save must be visible; it must not be a per-tick siren.

Engine:
- ONE log line per edit-session transition:
  `[EditSession] principal 'bringup' — parameter/playlist persistence FROZEN (session-only)`
  and the mirror line when an owner session opens persistence.
- ONE log line per refused explicit write (403s are discrete user acts, rare
  by construction). Zero logging on the auto-save predicate itself — it is
  evaluated every cycle and its state is already broadcast.

CaptainPad:
- **Persistent session chip**, mounted beside `PerformanceModeControl` in the
  sidebar, driven by `editPrincipal` off the shared performance-mode state:
  owner → no chip (normal is silent); `collaborator` → amber
  `CREW SESSION — LIVE, NOT SAVING`; `bringup` → amber
  `SAILOR SESSION — LIVE, NOT SAVING`; null with perf off + auth on (possible
  only between boot-unlock edge cases) → same amber idiom, `NO EDIT SESSION —
  NOT SAVING`. Tapping the chip opens the assert-principal passcode sheet
  (escalation, D3), whose confirm copy states the D4 consequence: "Entering
  the captain's passcode starts auto-saving the CURRENT live tuning."
- **403 `EDIT_PRINCIPAL_READONLY`** surfaces through the existing loud-error
  path in `utils/api.ts` (the `{ok:false, code}` shape, :461-481 pattern) as a
  toast naming the cause ("Not saved — sailor session. Playlist files are
  read-only."), and playlist CRUD affordances render the standard locked idiom
  (opacity 0.45 + disabled, as the perf lock does) when `editPrincipal` is
  non-owner, so the refusal is mostly never reachable from the UI.
- **The exit sheet** (`ExitPerformanceSheet.tsx`) gains a passcode field using
  the `takeover_passcode_sheet.tsx` idiom (single `useState`, wiped on
  submit/close, no remember affordance, storage audit per
  `utils/takeover_passcode.ts`) — NOT `PrivilegedAuthSheet`, which mints the
  session this flow must ignore. `keep-save` stays visible with the caption
  "captain's passcode only"; the client cannot pre-know the principal (that
  would require verifying before submit), so a sailor picking `keep-save`
  gets the engine's 400 rendered in the sheet's error box. One request, one
  verification, atomic with the exit action.

**Amendment (report `_236`) — the exit sheet may never end a tap in silence.**
The shipped `_228` build broke D8's own rule in two places, and the operator hit
both as "the RESTORE PRE-SHOW / KEEP LIVE STATE buttons aren't making progress":

1. The sheet greyed BOTH exit choices while the passcode field was empty
   (`pending || (passcodeRequired && passcode.length === 0)`) with no sentence
   anywhere saying why — a client-side gate, guessing at a rule the ENGINE owns,
   that swallowed the tap outright. Removed: the choices disable only while a
   request is in flight, an empty submit earns the engine's own 401
   `EXIT_AUTH_REQUIRED` in the error box (a missing header returns before
   `verifyPassphrase`, so it costs nothing against the lockout ring), and a
   standing hint under the field states that a passcode is needed and that
   whoever types it owns persistence.
2. Every refusal OUTSIDE the four `EXIT_*` codes went to `Alert.alert`, which
   react-native-web implements as `class Alert { static alert() {} }` — an empty
   stub. A 400 / 423 / 500 / client timeout therefore left the sheet open with
   no message at all. Replaced by `performanceExitFailureMessage()`, which
   ALWAYS returns copy: named guidance for the codes this route can answer with,
   and the machine code itself (SCREAMING_SNAKE only, never a raw engine body)
   for anything unrecognised. Rendered in the sheet's own error box rather than
   a toast, because the sheet persists and a toast self-dismisses mid-cue.

The rule this pins, for every future surface: **a refusal the operator cannot
see is the same failure as no refusal at all.** `utils/op_dialog.ts` is the
imperative surface for anything that has no sheet of its own — `Alert.alert` is
never it.

Boot UX composition (order of events on a fresh launch): engine boots locked
(D1) → pad seeds → perf overlay active (_217: PARAMETERS/AUTOPILOT windows
hidden — screen composition reads RAW `active`,
`deck_workspace.tsx:209-217`) + red EDIT control → tap EDIT → passcode+choice
sheet (D8) → engine verifies, exits, sets principal → overlay drops for
EVERYONE (composition follows `active`, not the principal) → persistence
follows the principal (D5) → chip says so. The principal never changes what a
pad shows; it changes only what the engine writes.

### D9 — Danger cases, decided

| Case | Ruling |
|---|---|
| Engine restart during a sailor edit session | Nothing to flush: `shutdown()` (`marsin_engine/engine.js:2879-2955`) writes **zero state** (verified: blackout frame + socket/watcher teardown only), sailor edits exist only in live channels + `sessionParamCache` (in-memory by design, :1367-1375). Restart → D1 boots locked → disk state is Sina's. No code change needed; a test pins it |
| Autosave timer already in flight when the principal flips | Every choke re-reads `effectiveAutoSave()` at write time (:1473, :2011, :2048) — the gate is evaluated inside the write, never captured at schedule time. Contract adds a regression test so this stays true |
| Crash mid-perf (existing) | Unchanged: reserved snapshot present → boot resumes the lock, disk already pre-show (:1400-1410). D1 makes the auth-on engine boot locked even without the snapshot |
| Sailor exits `keep`, engine later restarts | Disk was never touched (D7 no-forcePersist) → restart restores Sina's state. The sailor's kept look dies with the process — session-only, exactly as ordered |
| Sina escalates after sailor tuning | Current live look begins auto-saving (D4, deliberate, stated in the escalation sheet copy) |
| Two pads, different humans | One global principal (D4); the chip renders on every pad so pad B always sees whose session it is |
| Pad reload / WS drop | Principal is engine state; re-seeded by the existing REST+replay ring (`usePerformanceMode.ts:63-93`). Nothing principal-shaped is ever stored on the client |
| Bad passcode storms | Shared ring lockout: 5 fails/rolling minute → 60 s 429 with `Retry-After` (`captainpad_auth.js:91-140`), identical to takeover |
| Auth disabled (benches/tests) | All gates inert, boots unlocked, `principalMaySave()` true — byte-identical behavior to today everywhere auth is off |

---

## 2. Security notes (repo is PUBLIC)

- No credential material anywhere in this design: principals travel as the
  enum names `owner`/`collaborator`/`bringup` already public in
  `captainpad_auth.js`; passphrases stay exclusively in the external
  `$BM26_SECRETS` YAML, digested at load (:26-54), never logged/echoed
  (:4056-4058 precedent), never stored client-side.
- The new route and fields add no session surface: `POST /edit-session`
  verifies per-attempt and issues nothing, inheriting the every-time ruling.
- Tests must provision auth from a **scratch secrets YAML with obviously fake
  values** (the `captainpad_auth.test.js` pattern) — never the operator's
  file, never fixtures committed with plausible-looking secrets.
- No future dates or schedule material in any tracked file of this wave.

---

## 3. Implementation contract (ordered; Opus)

Suite baselines to hold: **CaptainPad failing list EMPTY** (1372 pass / 6 skip
as of _217); **engine known reds and ONLY those**: 5× `dev_test_bench`
groupBits drifts, `playlist_gallery` baby ENOENT, `party_dancers` numeric
drift (concurrent audio-tuning branch). Anything newly red is a stop-ship.

**W1 — editSession + principal term** (`api_server.js:1353-1375` region).
State object, `principalMaySave()`, `effectiveAutoSave()` third term,
transition logging (D8). Accept: auth-off engine byte-identical (existing
suites green); auth-on engine with no/sailor session performs zero
auto-writes (state-dir hash unchanged across param churn + entry switches);
owner session writes as today.

**W2 — boot-locked** (same region + startup order). D1 rule, snapshot
capture-or-keep, fatal on capture failure. Accept: auth-on fresh boot answers
`GET /performance-mode {active:true, editPrincipal:null}` before any client
acts; interrupted-restart path unchanged; the two auth-enabled API suites
(`tests/special_events/special_events_timeline_api.test.js`,
`tests/effects/live_touch_timeline_priority_api.test.js`) updated for the new
boot state and green.

**W3 — exit gate swap + per-principal exits** (:12876-13008). Passcode header
verify (shared helper with the takeover ring's header/verify/refusal shape,
:4031-4073), principal capture, D7 matrix (`EXIT_KEEP_SAVE_OWNER_ONLY`,
owner-only `forcePersist`), `editPrincipal` in POST responses, broadcasts
(:12864, :12944, :13000), GET (:12817), WS replay (:13601). Accept: session
token alone can no longer exit (401 `TAKEOVER_AUTH_REQUIRED`-style code, e.g.
`EXIT_AUTH_REQUIRED`); each principal × exitAction cell behaves per D7,
proven by disk-hash assertions; lockout shared with takeover attempts.

**W4 — sailor backlog skip** (:1946-1972). Skip `recordPendingDeckFlush` when
`!principalMaySave()`; `computeDirtyDeckState` (:2178) therefore reports 0 for
sailor sessions. Accept: sailor session → entry switches produce no pending
flush, later owner `keep-save`/autosave-enable flushes nothing sailor-made;
perf-mode accumulation for the owner exit-ask unchanged.

**W5 — `rejectIfPrincipalReadonly` + route gates** (helper near :3980;
applied at :11608, :11662, :11697, :11804, :12630, :12749, :12779, :13141).
Accept: sailor session → 403 `EDIT_PRINCIPAL_READONLY` on each, files
untouched (hash), one warn line each; owner session → all 200 as today;
perf-mode 409s still win (perf gate checked first — a locked show outranks
identity).

**W6 — `POST /edit-session`** (new route + api.ts client). Accept: 409 in
perf mode; 401/429 shape shared with the ring; success replaces principal,
broadcasts, flips `effectiveAutoSave` observably (auto-write resumes/stops
without restart).

**W7 — CaptainPad**: `PerformanceModeState.editPrincipal`
(`performance_mode_logic.ts` reconcile + `usePerformanceMode.ts`),
exit-sheet passcode field + keep-save caption + engine-error rendering
(`ExitPerformanceSheet.tsx`, `PerformanceModeControl.tsx`,
`utils/api.ts:461` signature change to carry the header), session chip +
escalation sheet (D8), locked idiom on playlist CRUD affordances, 403 toast.
Accept: vitest pins for the new copy/choice logic
(`performanceExitChoices`, :179, grows the owner-only caption), `tsc
--noEmit` + eslint clean, failing list still empty.

**W8 — verification pass**: full engine + CaptainPad suites, screenshot
matrix (§4), report + tracker + dossier updates.

Isolation rules for all waves: isolated engine on a scratch port (the _217
precedent: :7842, scratch state + config dirs, sACN to TEST-NET-1); never the
operator's live stack (ports 6967-6972 pinned — memory: BM26 port topology);
operator's Expo on :6967 untouched, all pad verification against a fresh dist
export on :7167.

## 4. Screenshot verification matrix (fresh dist :7167 — never :6967)

Every capture inspected before claiming success; console muted before boot;
one tab.

| # | Scenario | Proof required |
|---|---|---|
| S1 | Fresh auth-on engine boot + pad launch | Pad lands on the performance face: red control, _217 overlay (no PARAMETERS/AUTOPILOT windows), structural leaves locked — with zero prior taps |
| S2 | Tap EDIT | Exit sheet with passcode field + KEEP / KEEP&SAVE("captain's passcode only") / RESTORE; no remember affordance |
| S3 | Wrong passcode | Sheet error box, field wiped, no mode change; 5th failure shows the 429 wait message |
| S4 | Sailor passcode + `keep` | Edit mode opens, amber `SAILOR SESSION — LIVE, NOT SAVING` chip visible in sidebar; playlist CRUD affordances locked-idiom |
| S5 | Sailor session disk proof | SHA-256 of the isolated engine's `states/` tree before → tune params on 2 patterns, switch deck entries, attempt playlist edit (toast shown) → hash after: **identical**; engine log shows the FROZEN line + one 403 line |
| S6 | Sailor `keep-save` attempt | Sheet renders the engine 400 `EXIT_KEEP_SAVE_OWNER_ONLY` |
| S7 | Escalation | Tap chip → passcode sheet with the "starts auto-saving the CURRENT live tuning" copy → owner code → chip disappears |
| S8 | Owner session disk proof | Same hash protocol as S5: hash **changes** after a param tweak + autosave cycle; `settings/save-now` returns 200 |
| S9 | Engine restart mid-sailor-session | Kill + relaunch isolated engine → boots locked (S1 face), `states/` hash still equals the S5 baseline — Sina's state survived, sailor look gone |
| S10 | Second pad | While pad A holds a sailor session, pad B (second browser context) shows the same chip and the same locked CRUD |

---

## 5. Open questions (operator, non-blocking — defaults chosen)

None blocking. Two defaults worth a nod when convenient: (1) named-artifact
authoring (snapshots/presets/GEM/timeline files) stays open to sailors — say
the word and W5's helper gates them too; (2) edit sessions have no timeout —
the perf lock is the reset. Both are one-line changes if ruled otherwise.
