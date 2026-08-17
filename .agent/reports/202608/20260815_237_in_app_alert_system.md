# _237 — CaptainPad alerts become in-app UI (one notice/dialog system)

**Operator ruling 2026-08-15**, filed with a screenshot of a raw Chrome dialog:

> "do a deep analysis of alerts and make sure they are not like this regular
> HTML shit, and is handled properly as part of the app UI itself to be
> compatible with ipad too"

The screenshot: `localhost:6967 says / Switch failed / special event
"baby_reveal" is running and owns the deck — end or abort it from the Events
tab first  [OK]`.

Client-only wave. **No engine change was needed or made** — the engine's
refusal was already correct; only the client's way of showing it was wrong.

---

## 1. What was actually wrong (two bugs, not one)

CaptainPad ships **both** a native iPad build and a web build (`npm run
web:build`, served to the podium). react-native-web 0.21.2 implements Alert as
a literal no-op — `class Alert { static alert() {} }`
(`node_modules/react-native-web/dist/exports/Alert`). So the two pre-existing
surfaces each failed on one half of the product:

| Surface | Sites | iPad | Web (podium) |
|---|---|---|---|
| `Alert.alert(title, msg)` | 81 | correct | **SILENT NO-OP** — engine refuses, panel rolls back, operator sees the UI snap back with no message |
| `opAlert()` (`utils/op_alert.ts`, the 2026-07 patch for the above) | 16 | native Alert | **`window.alert`** — unthemed, origin-stamped, ignores all five themes, and BLOCKS the JS thread so engine WebSocket frames queue behind it |

The operator's screenshot is the second row. The first row is the quieter and
more dangerous bug: it looks right in review and in the iOS simulator, and
shows nothing at all on the podium. That is how 81 of them accumulated.

Neither could ever carry a **button** — RN-web drops `Alert.alert` button
callbacks entirely, which is why `components/ui/ConfirmSheet.tsx` already
existed for destructive confirms.

**Worst find:** `app/(tabs)/timeline.tsx` — the BABY REVEAL fire confirmation
was the only alert in the app with a button array, so on the podium it rendered
**nothing and the cue never fired**. A dead safety gate on a ceremonial cue.

---

## 2. Full inventory

Sweep: `Alert.alert` · `Alert.prompt` · `window.alert` · `window.confirm` ·
`window.prompt` · bare `alert()/confirm()/prompt()` · any util wrapping them.

**Totals: 97 operator-facing sites. 97 converted. 0 left. 0 HANDOFF.**

Categories: **(a)** error/refusal notice · **(b)** destructive confirm ·
**(c)** info/success notice · **(d)** text-input prompt.

### 2.1 By file

| File | Sites | Cat | Trigger condition | → |
|---|---|---|---|---|
| `app/(tabs)/mixer.tsx` | 23 | a | takeover/activation refused; mute/solo/solo-safe/bump rejected; channel add/remove; view selection; panic | 22 `opError`, 1 `opWarn` |
| `components/PlaylistPanel.tsx` | 17 | a | playlist load/switch/add/create/duplicate/remove/reorder/delete refused | 14 `opError`, 2 `opWarn`, 1 `opDialog` |
| `app/(tabs)/index.tsx` | 16 | a | deck transition/color-autopilot/profile/split/2nd-playlist/color/hue rejected + reverted; panic home-look | 16 `opError` |
| `components/DeckOverlayStack.tsx` | 11 | a | overlay add/remove/reorder/auto-cycle refused; view already in use; overlay cap | 5 `opError`, 6 `opWarn` |
| `components/GroupRail.tsx` | 6 | a | group create/delete/fader/mute/assign/unassign refused | 6 `opError` |
| `components/SnapshotBar.tsx` | 4 | a | look save/recall/morph/delete refused | 4 `opError` |
| `components/ParamPresetMenu.tsx` | 4 | a | preset save/recall/delete refused; preset captured on a different pattern | 3 `opError`, 1 `opWarn` |
| `hooks/use_tempo_tap.ts` | 3 | a | tap-tempo / tempo-sync / tempo-source rejected | 3 `opError` |
| `components/PerformanceModeControl.tsx` | 5 | a | performance-mode + edit-mode toggles refused; local lock incomplete | 2 `opError`, 1 `opWarn`; **2 sites removed outright by `_236`'s exit-hang refactor** |
| `components/GlobalEffectMacros.tsx` | 2 | a | effect slot bind/clear PATCH rejected | 2 `opError` |
| `app/(tabs)/timeline.tsx` | 2 | a, **b** | sequenced cue not editable; **BABY REVEAL fire confirmation** | 1 `opWarn`, **1 `opConfirm`** |
| `components/ui/HealthChip.tsx` | 1 | c | operator taps the degraded-health chip | 1 `opWarn` |
| `components/PlanLockBanner.tsx` | 1 | a | plan takeover refused | 1 `opError` |
| `components/MasterFadeGroup.tsx` | 1 | a | master fade refused | 1 `opError` |
| `components/EntryLabelEditor.tsx` | 1 | a | entry rename could not be saved | 1 `opError` |
| `app/(tabs)/_layout.tsx` | 1 | a | Live Touch handoff threw on tab switch | 1 `opError` |
| `utils/op_alert.ts` | — | — | the `window.alert` shim itself | **DELETED** |

### 2.2 Category counts

| Cat | Found | Disposition |
|---|---|---|
| (a) error/refusal notice | 95 | 81 `opError` (failure) + 12 `opWarn` (user-correctable refusal) + 1 `opDialog` (special-event, needs a route out) + 1 removed by `_236` |
| (b) destructive confirm | 1 | `opConfirm` — the BABY REVEAL fire gate, previously dead on web |
| (c) info/success notice | 1 | `opWarn` — the health chip |
| (d) text-input prompt | **0** | Nothing used `window.prompt` / `Alert.prompt`. Text entry already goes through in-app modals (`PlaylistPanel`'s name modals, `EntryLabelEditor`, `takeover_passcode_sheet`). **No prompt primitive was built** — there is nothing to call it. |

### 2.3 HANDOFF

**None.** At inventory time `_236` owned the passcode/exit sheets and
`config.tsx`; none of those files contained a real alert call site (only prose
mentioning `Alert.alert` in `ExitPerformanceSheet.tsx`'s header). `_236` has
since landed, and a re-audit after it landed found **zero** raw alert surfaces
anywhere — it introduced none.

### 2.4 Deliberately left alone

`components/ui/ConfirmSheet.tsx` and its 9 consumers. It is already in-app,
themed and canon-correct; it is the **declarative** confirm (a component owns
`visible`). The new `opConfirm` is the **imperative** twin for callers that
have no component to hang state on. Both stay, and they are drawn identically.

---

## 3. The system

Reuses the existing `takeover_passcode` idiom exactly: a **pure-TS module-level
broker** + **one app-wide host** mounted outside `<Tabs>`.

```
utils/op_dialog.ts        broker — no React/RN import, so vitest drives it in node
  ├─ opError/opWarn/opInfo  → themed TOAST (non-blocking, auto-dismiss, stacked)
  ├─ opDialog(...)          → Promise<actionId|null>, themed MODAL
  └─ opConfirm(...)         → Promise<boolean>  →  `if (await opConfirm({...}))`
styles/op_tone.ts         tone → palette tokens (pure, theme-swept by tests)
components/op_dialog_host.tsx   the ONE mount, in app/(tabs)/_layout.tsx
  ├─ components/ui/op_toast_stack.tsx
  └─ components/ui/op_dialog_sheet.tsx
utils/engine_refusal.ts   pure detector for refusals that deserve a modal
```

**Toast vs modal.** The ~90 "engine rejected X, we reverted" notices became
**toasts**: during a live show the operator must KNOW, but must never be
stopped mid-cue to acknowledge. Modals are reserved for things that need a
decision or a route out.

**Canon reuse (docs/54 / `CaptainPad/DESIGN.md`).** The dialog is
`globalStyles.panel` (row 19 — "a modal IS a panel"), same `rgba(0,0,0,0.5)`
backdrop, same 44pt targets + 8pt hitSlop, same `accentFill(C.error)` danger
ink, `Radius`/`Space`/`Type` scales throughout — byte-identical treatment to
ConfirmSheet, deliberately, so the two are indistinguishable. Toasts sit
bottom-right at `zIndex 1300` (the top band is already a four-way contest
between PlanLock/ViewOverride/PendingProgram/Zoom banners), wrapper
`pointerEvents="box-none"` so taps fall through to the faders.

**Three tones, zero new palette keys**: `error` / `warning` / `info` map onto
tokens the design-token contract already contrast-tests.

### 3.1 A real contrast bug the new tests caught

The first design filled the toast with `errorContainer`. `components/op_tone.test.ts`
measured **gruvbox `error` (#fb4934) at 3.23:1 on its own wash** — far under
the 4.5 an 11pt bold cap needs. Untinting the card only got it to 3.82:1,
because the token layer's contract (`components/design_tokens.test.ts`) pins
**`warning`** as AA text on every surface but has **never pinned `error`** — no
theme owes us a text-grade error red.

Resolution: the card is an untinted panel; the accent is a **non-text carrier
only** (icon + 3px leading bar, 3:1), and the title ink is `C.text`. The tone
still reads through the icon, the bar, the border, and a spoken
`accessibilityLabel` — colour is never the only carrier. Pinned by a test so a
future "make the title pop" edit has to argue with a failing assertion.

### 3.2 The screenshot's exact case

`PlaylistPanel.reportSwitchFailure()` special-cases the engine's
`409 SPECIAL_EVENT` (`api_server.js` `rejectIfSpecialEventHoldsRig`, ~L6646):
that refusal is a **navigation instruction**, not a status message, so it gets a
modal that stays put and carries **`OPEN EVENTS`** → `router.push('/special_events')`.
The engine's sentence is passed through **verbatim** — it already names the show
and says where to go; re-wording it would put two different sentences in front
of the operator for one condition. `utils/engine_refusal.ts` **throws** if the
engine ever sends `SPECIAL_EVENT` with no reason rather than inventing one.

---

## 4. Regression guards (two, deliberately)

1. **eslint `no-restricted-imports`** (`CaptainPad/eslint.config.js`) bans the
   `Alert` named export from `react-native`, error-level, with a message
   pointing at `utils/op_dialog.ts`. Verified by planting a probe file: it
   fails with the intended message. Off only for the two files that *document*
   the ban.
2. **`components/no_raw_alerts.test.ts`** — a source scan for what a lint rule
   cannot see: `window.alert/confirm/prompt`, a bare `alert('x')`, `Alert`
   reached via namespace, and any re-import of the retired `op_alert`. It
   strips comments first (every mention in the tree is prose explaining the
   ban) and includes self-tests proving the scanner walks a real tree and
   matches what it claims.

---

## 5. Verification

**`npx tsc --noEmit` — CLEAN** (0 errors).
**`npx expo lint` — 0 errors**, 14 warnings, all pre-existing and none in the
new code.
**`npx vitest run` — 80 files / 1588 passed / 6 skipped / 0 failed.**
**Failing list EMPTY** against the moving baseline (`_236`'s hand-off baseline
was 80/1584/6/0; the +4 are late additions to `op_tone.test.ts`).

New tests: `utils/op_dialog.test.ts` (22 — broker protocol, the pre-mount
buffer, "opNotify never throws so it cannot mask a caught error", "opDialog
THROWS with no host rather than resolving null", double-resolve, Fast-Refresh
re-registration), `components/op_tone.test.ts` (13 — five-theme contrast
sweep), `utils/engine_refusal.test.ts` (7 — the engine sentence verbatim, both
envelope shapes, and the throw), `components/no_raw_alerts.test.ts` (8).

### 5.1 Screenshots — `~/tmp/fix_237/`

Fresh dist, bundle `entry-554e02874859c64507252a444ca17fbb.js`, **served from a
private snapshot** on `:7171` (the shared `CaptainPad/dist` was being rebuilt
by a concurrent agent mid-run — copied it to `~/tmp/fix_237/dist` and served
that so it could not change underneath the capture). Console muted before boot.
Engine: throwaway on **:17237**, `--dest 192.0.2.x`, `wedding_program` armed so
it really owned the deck.

| File | What it proves |
|---|---|
| `02_409_refusal_dialog.png` | **the operator's exact scenario** — themed panel, amber warning icon, `SWITCH REFUSED`, the engine's verbatim sentence, `DISMISS` + `OPEN EVENTS` |
| `03_409_dialog_ipad_narrow.png` | same dialog at iPad-portrait 834×1112 — app reflows, card stays centred and in bounds |
| `05_toast_error.png` | a **fully real** refusal as a non-blocking toast (`LOAD FAILED` + the same engine sentence), deck still fully interactive |
| `07_toast_ipad_narrow.png` | the toast at 834×1112 — caps at maxWidth 420, stays in bounds |
| `06_destructive_confirm.png` | the destructive confirm (`PANIC TO SAFE STATE?`, red PANIC button) — identical card geometry to the new sheet |
| `01_playlist_loaded.png` | the clean pre-refusal deck |

`baby_reveal` is **not** in this tree (only `wedding_program` loads on
`test_bench`), so the captures name the wedding show. The refusal is the same
engine template, byte for byte.

**`opConfirm`'s destructive path has no screenshot**: its one call site is the
BABY REVEAL cue gate, and no plan on the bench carries a `c_baby_reveal_*` cue.
It is covered by unit tests and by `06`'s proof that the identical card renders.

---

## 6. Isolation and residue

Nothing was bound, started or killed on **6966-6972 / UDP 5568**. The capture
harness **aborts every request to those ports at the interceptor** (it caught
and blocked one — a `:6969` pixel-map fetch). The only contact with the live
stack was a single read-only `GET /status` to confirm it was still up
afterwards. My `:17237` and `:7171` are both shut down.

**Residue to report, not revert** (per AGENTS.md): my first bench engine run
passed `MARSIN_STATE_DIR` as an MSYS path (`$HOME/tmp/...`), which Node on
Windows did not resolve, so it wrote to the **tracked** states dir before I
caught it:

- `marsin_engine/states/test_bench/deck_state.yaml` (modified)
- `marsin_engine/states/test_bench/globals_state.yaml` (modified)
- `marsin_engine/states/test_bench/.mixer_state.yaml.31488.2.tmp` (stray temp)

Subsequent runs used a Windows-style path and the redirect took (`🧪 state
redirect active` in the log), writing only to `~/tmp/fix_237/state`. The
`states/titanic/*` changes are **foreign** — I never ran the titanic model.
`CaptainPad/dist` was rebuilt (gitignored). **No git operations.**

**Lesson worth keeping:** `MARSIN_STATE_DIR` must be a Windows-style path when
the engine is launched from Git Bash, or the redirect silently does nothing and
the engine writes into tracked state.

---

## 7. Notes / follow-ups

- `_236` converged on the same module and file names independently. There is
  exactly **one** `utils/op_dialog.ts`, **one** `components/op_dialog_host.tsx`,
  mounted **once**, carrying the 2026-08-15 ruling comment — verified on disk.
  The shipped module is the superset (adds the toast primitives, the tone
  layer, and the promise-based confirm).
- The engine has **no** `baby_reveal` special-event show in this tree, though
  `config.yaml` still carries `baby_reveal_duet` / `baby_pink` / `baby_blue`
  palettes and the operator's screenshot shows one running. Worth confirming
  whether that show lives only on the show server (see `_238`).
- The token layer never pinned `error` as AA text on any surface (only
  `warning`). Not fixed here — that is the shared token layer's call, and
  changing a palette hex ripples. Recorded so the next person does not
  rediscover it at 3.82:1.
- `opInfo` currently has no call site. It exists because the tone triad is
  cheaper to complete than to retrofit; it costs three lines.
