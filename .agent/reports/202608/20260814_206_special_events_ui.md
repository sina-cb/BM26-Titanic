# _206 — CaptainPad SPECIAL EVENTS tab (Baby Reveal, operator's revised flow)

Date: 2026-08-14 · Agent `_206` · Branch `feat/bm_readiness` (shared tree) ·
Scope: `CaptainPad/**` only · No git ops, no stack touched

Slice B of `docs/52_special_events_tab.md` (design `_197`). Slice A — the
engine runner — is `_205`'s, and it landed in the tree while this was being
built; §4 is the full reconciliation.

---

## 1. The flow this serves

The operator's revised Baby Reveal, verbatim in intent: *start on the `baby
tease` playlist with quick-effect buttons (STROBE, FLASH VINTAGE WHITE, a
couple more) shown in front of the button that starts the reveal sequence; a
BLACKOUT stage in between; during the reveal two big buttons enable baby pink
or baby blue; pressing one flashes all white then enables that playlist.*

```
   ┌──────────────────────────────────────────────┐
   │ START TEASE                        LIVE      │  current — glowing
   │ Pink and blue, no answer yet.                │
   └──────────────────────────────────────────────┘
     [ STROBE ] [ VINTAGE WHITE ] [ FLASH ALL WHITE ] [ UV BLAST ]   ← lit
   ┌──────────────────────────────────────────────┐
   │ GO DARK                            NEXT      │  armed — full brightness
   └──────────────────────────────────────────────┘
   ┌──────────────────────────────────────────────┐
   │ THE REVEAL                       LOCKED      │  40 % opacity
   └──────────────────────────────────────────────┘
        ┌───────────────────┐ ┌───────────────────┐
        │   IT'S A GIRL     │ │    IT'S A BOY     │  ≥168 pt, dark until armed
        └───────────────────┘ └───────────────────┘
   ── EXTEND (RESTART TEASE) ─────────── END SHOW · ABORT ──
```

The quick effects render **directly under their own stage row**, which puts
them physically in front of the armed "next stage" button below — the placement
the operator asked for, achieved without a special case: effects always belong
to their stage, and the stage order does the rest.

## 2. Screens

| Mode | When | What is on the glass |
|---|---|---|
| `offline` | no WS frame **and** no REST seed | The offline notice, and nothing else. No show list, no buttons — Codex P0, we never paint a guess. |
| `picker` | runner `idle` (or running a show this catalog lacks) | One 132 pt card per show: accent bar in the show colour, name at 30 pt, the stage names as a `→` chain, `ARM SHOW`. Broken YAML files render as red, untappable `WILL NOT LOAD` cards carrying the loader's own message. |
| `show` | `armed` / `running` | The stage column (§1) + the fixed chrome bar. |
| `ended` | `ended` | The reason banner with a DISMISS that calls the **engine's** `/dismiss` — the tab never clears an engine flag locally. The picker stays underneath so the next show is one tap away. |

Stage placements: `done` (checkmark, 55 %), `current` (3 pt accent border,
LIVE), `armed` (3 pt accent border, raised surface, NEXT, `M:SS` when the
stage auto-advances), `locked` (40 %). While a ceremonial stage is armed or
current every non-ceremonial row drops to 18 % opacity, so the two big buttons
are the only bright thing on the glass.

Sizes: stage rows ≥ 88 pt, ceremonial buttons ≥ 168 pt, quick effects and
chrome ≥ 56 pt with 8 pt hitSlop. Every colour is a `usePalette()` token except
the show's own accents, which are contrast-checked at render (§3).

## 3. State flow — the UI renders truth, it never assumes

```
engine /ws/control  ──`specialEvents`──┐
                                       ├─► useSpecialEvents (module cache)
GET /special-events/state ── seed ─────┘        │
                                                ▼
                                describeEventScreen(state)   ← PURE
                                                │
                                                ▼
                             app/(tabs)/special_events.tsx   ← no opinions
```

- **No client stage cursor.** Placement comes from the engine's own
  `stageId` / `armedStageId`; the view never derives "next" by adding one to an
  index. A test pins that an engine cursor which skips ahead is followed.
- **No optimistic anything.** Every mutation answers with the engine's new
  state document and the hook **adopts that answer**. A refusal instead re-reads
  `/state`, which lands the tab on the engine's real stage rather than the
  operator's hope — and the re-read deliberately does *not* wipe the refusal
  message (a failure that vanishes in a millisecond is a silent failure).
- **Enablement mirrors the engine's own guards, byte for byte.** Quick effects
  are lit exactly when `status === 'running'` **and** the effect's stage is
  current — which is precisely when `special_events_service.quickEffect()` will
  not answer `NO_STAGE_RUNNING` / `QUICK_EFFECT_NOT_FOUND`. EXTEND is lit when
  the current stage authored one, and a `time` extend additionally needs a live
  countdown (`NO_COUNTDOWN`). A lit button is a button the engine will honour;
  a dark one is a refusal the operator never discovers by tapping. The engine's
  409 remains the real guard and is surfaced verbatim either way.
- **Nothing is stored.** No AsyncStorage, no localStorage, no passcode anywhere
  but one request header. Pinned by a source-scan test over all five files.
- **A frame we cannot parse is LOUD** — it becomes a visible error rather than a
  dropped message that leaves the tab painting a stale stage.
- **Data accents are checked, chrome is tokens.** `paintAccent()` refuses an
  accent below WCAG 3:1 against the surface and the button falls back to a token
  treatment; the hex itself was validated at parse time, so a malformed colour is
  a load error, never a render crash.

**ARM = takeover.** `runArmShow` goes through `_201`'s `runGatedTakeover`
unchanged: performance OFF sends one plain request; performance ON opens the
per-attempt sheet **before** any request, sends `X-CaptainPad-Passcode` on that
one request, remembers nothing, and treats CANCEL as a non-event (no request,
no error, no alert). Two ARMs prompt twice. With no host mounted it fails loudly
rather than arming unauthenticated. The engine wears the same gate on
`/special-events/arm` (`rejectTakeoverWithoutPasscode`), and every other verb —
including ABORT — is ungated: handing the rig back is always free.

## 4. Contract reconciliation with `_205` — CONVERGED

Built against `_197`'s design, then reconciled against `_205`'s landed engine
code (`marsin_engine/lib/special_events/*`, `api_server.js`, the show YAML).
**Six divergences found, all resolved in this client. No engine change is
needed and nothing is left guessing.**

| # | `_197` design (what I built first) | `_205` engine (the truth) | Resolution |
|---|---|---|---|
| 1 | I invented `POST /special-events/effect {stageId, effectId}` for the quick effects (`_197` had no verb for them) | `POST /special-events/quick-effect { id }` — the engine resolves the id against the CURRENT stage | Client uses the engine's route and id-only body. The stage is not sent at all. |
| 2 | Seven routes | Nine — `quick-effect` (row 1) **and** `POST /special-events/dismiss`, which clears a sticky `ended` banner | Adopted both: the ENDED banner's DISMISS calls the engine. |
| 3 | Separate catalog document | The state document **carries** `shows` + `loadErrors`, and every mutation answers `{status:'ok', state}` | Dropped the separate catalog fetch entirely. One document, one shape; run and library can never be a version apart. |
| 4 | `currentStageId`, `error`, `effects`, `extendLabel`, `advanceSec` | `stageId`, `lastError`, `quickEffects`, `extend:{label,kind}`, `advance:{mode,afterSec}` | Renamed **at the parser**; the UI keeps its own vocabulary and a future wire rename is one file. Mapping table is in `special_events_api.ts`'s header. |
| 5 | I modelled optional `availableEffectIds` / `extendAvailable` refinements | The engine sends neither — its own guards are exactly stage-currency + countdown | Removed both (speculative generality). Replaced with `extendKind`, which is real and does change enablement. |
| 6 | Stage `advanceSec: number\|null` | `advance:{mode:'manual'\|'timed', afterSec}` | Parsed into `advanceSec`, with a loud throw on `timed` + non-positive `afterSec`. |

Also confirmed aligned without change: WS type `specialEvents` broadcast flat
(`{type, ...state}`, the `timelineState` idiom — the parser also accepts a
`state`-nested envelope and throws on anything else); status vocabulary
`idle|armed|running|ended`; end reasons `finished|aborted|panic|restore_failed`;
the ARM passcode gate; `showInPerformance: true` with `/special-events/*`
ungated by performance mode; refusal `code`s (all 17 mapped, 11 given operator
sentences, unknown ones passed through verbatim).

`_205`'s own tracker entry independently confirms the convergence (*"_206's
`special_events_api.ts` already matches the table field-for-field"*).

**Two things for the operator, not for code:**

1. The reveal buttons read `IT'S A GIRL` / `IT'S A BOY` in
   `simulation/scenes/titanic/special_events/baby_reveal.yaml`. The operator's
   brief said *"baby pink or baby blue"*. That is show DATA — a one-line YAML
   edit in `_205`'s file, outside this slice's `CaptainPad/**` boundary.
2. `baby_reveal.yaml` sets `icon: gift`, which is **not** in CaptainPad's
   `IconSymbol` MAPPING (an unmapped SF name renders a blank 0×0 glyph on web).
   The picker card deliberately uses the show's accent **bar** and never the
   icon, so nothing is invisible today — but `show.icon` is currently dead data.
   Either map `gift`, or drop the field.

**One overlap to settle:** `components/timeline/baby_reveal_confirmation.ts`
already fires `c_baby_reveal_pink` / `c_baby_reveal_blue` as TIMELINE cues.
That is the older path. Untouched here; the operator should decide whether it
retires now that the Events tab owns the ceremony.

## 5. Files

**New**
- `CaptainPad/utils/special_events_api.ts` — wire types, throw-style parsers,
  the nine routes, refusal copy. Carries the contract + field mapping as its
  header comment.
- `CaptainPad/hooks/useSpecialEvents.ts` — WS + REST mirror, module cache,
  gated ARM, the action layer. Exports `runArmShow` / `runFireStage` / … for
  vitest.
- `CaptainPad/components/special_events/special_events_view.ts` — the PURE
  screen model (placement, enablement, accents, copy). Everything the tab
  decides lives here, because the repo's vitest runs pure `.ts` only.
- `CaptainPad/components/special_events/stage_button.tsx` — stage row, choice
  button, quick-effect pulse, chrome button. Presentation only.
- `CaptainPad/app/(tabs)/special_events.tsx` — the tab.
- 3 test files (§6).

**Changed (surgical)**
- `CaptainPad/utils/captainpad_tab_policy.ts` — `special_events` entry
  (`Events`, `sparkles`, group `Show`, `showInPerformance: true`).
- `CaptainPad/utils/captainpad_tab_policy.test.ts` — the two assertions that
  encoded the old route set (performance route list, count 12 → 13), plus a new
  test pinning the entry.
- `CaptainPad/app/(tabs)/_layout.tsx` — one `<Tabs.Screen>` registration.

## 6. Tests

**New — 75 tests across 3 files.**

- `utils/special_events_api.test.ts` (28) — show/stage/catalog/state parsing
  against `_205`'s real payload shapes; the field renames; `kind` contradiction,
  malformed accent, empty stage list, bad `advance.afterSec`, bad `extend.kind`,
  unknown status/end-reason, missing library all throw with the field named;
  both WS envelopes and a loud throw on an unreadable frame; the mutation
  envelope (adopted on success, refused when it carries no `state`); transport —
  passcode present on exactly the ARM that carries it and **not** in the URL or
  body, absent on the next request, absent on every other verb; the 409 `code`
  threaded through; a transport failure reported honestly; refusal copy.
- `components/special_events/special_events_view.test.ts` (30) — placement from
  every cursor combination incl. an engine cursor that skips ahead; armed fires,
  current re-fires behind a confirm, done/locked refuse; a choice stage row is
  never itself tappable; countdown only on an armed auto-advance stage; the
  ceremonial pair live **only** in its stage, confirm-gated once an answer is on
  the ship, accents carried, chrome dimmed while it is live; quick effects live
  only during their own current stage (and the two engine refusals mirrored
  exactly); EXTEND only on a current stage that authored one, greyed for a
  `time` extend with no live countdown; the four screen modes; ABORT from ARM
  onward and FINISH only on the last stage; a catalog-divergence notice that
  keeps the engine error alongside it; every end reason incl. PANIC's "was NOT
  restored" and the appended engine detail; accent contrast + refusal; ARM copy.
- `hooks/useSpecialEvents.test.ts` (17) — ARM with performance OFF (one request,
  no prompt) and the flipped-on race; performance ON prompts before any request,
  prompts again on the next ARM, cancel costs nothing, a rejected passcode
  retries in place without echoing the attempt, no host mounted fails loudly;
  409 `STAGE_NOT_ARMED` surfaces "Out of order" **with the engine sentence
  intact** and re-reads the real stage; success adopts the returned state with
  no re-read; quick-effect / extend / finish / abort / dismiss routes; an abort
  failure surfaced instead of a pretend restore; **storage audit** — a source
  scan of all five files for AsyncStorage / localStorage / sessionStorage /
  `console.` / any module-level passcode binding, plus a cache-reset check.

**Suite results**

| Check | Before | After |
|---|---|---|
| `npx vitest run` | 68 files · **1192 pass**, 6 skip, 0 fail | 69 files · **1224 pass**, 6 skip, **0 fail** |
| `npx tsc --noEmit` | clean | clean **for every file in this slice** (see below) |
| `npx eslint` (touched files) | — | 0 errors; 5 `import/first` warnings — the standard `vi.mock` hoisting idiom already used by `party_api.test.ts` and `_201`'s tests |
| `npm run web:build` | — | exported; `/special_events` + `/(tabs)/special_events` present |

Failing lists compared: identical (empty) before and after. No pre-existing test
was modified except the two tab-policy assertions that literally encoded the old
route set — that change IS the policy change docs/52 §4 asked for.

The +32 delta (not +75) is because the run also picked up another agent's new
`components/design_tokens.test.ts` and my three files replaced no existing ones;
the count reconciles against the 69-file run above, not against the 1121
baseline quoted in the brief, which predates `_207`/`_208`'s landings.

**SHARED-TREE STOP-ON-CONFLICT — read this.** `npx tsc --noEmit` currently
reports **3 errors, all in `CaptainPad/constants/theme.ts`**, from a foreign
in-flight edit (a `feat/bm_readiness` sibling adding `warning`,
`warningContainer`, `warningContainerBorder`, `borderStrong` to the `Palette`
type — added to `light` and `dark`, **not yet** to `midnight`, `sunset`,
`gruvbox`). I did not touch that file and did not fix it. `tsc` was clean on my
work before that edit landed and `tsc --noEmit | grep -v '^constants/theme.ts'`
is empty now. Whoever owns the token work must finish the three remaining
palettes.

## 7. Validator screenshot matrix

CaptainPad on a **fresh `:7167` dist export** (never the operator's `:6967`),
engine live on the standard ports, scene `titanic`. Mute the console before
boot (see memory: captainpad-screenshot-technique). Exact states, in order:

1. **Picker** — the `Baby Reveal` card: pink accent bar, `4 stages · START
   TEASE → GO DARK → THE REVEAL → …`, `ARM SHOW`. Drop a deliberately broken
   `*.yaml` in the scene's `special_events/` first so the red `WILL NOT LOAD`
   card is in the same shot.
2. **ARM confirm sheet** — the ConfirmSheet naming snapshot + autopilot pause +
   plan takeover.
3. **Armed** — the stage column with `START TEASE` armed (NEXT chip), the rest
   locked at 40 %, quick-effect buttons **drawn but dark**, ABORT present.
4. **Mid-tease** — `START TEASE` current (LIVE, glowing) with its hint line,
   the four quick effects **lit**, `GO DARK` armed below them, `RESTART TEASE`
   in the bottom-left.
5. **Blackout** — `GO DARK` current, the tease effects back to dark, `THE
   REVEAL` armed.
6. **The reveal moment** — the two ≥168 pt buttons in pink and blue, every
   other row dimmed to 18 %.
7. **Post-choice** — the burst running, the choice stage current, the chosen
   button still live behind a confirm, the next stage armed.
8. **ABORT flow** — the ConfirmSheet, then a before/after pair of the rig
   showing the pre-show look restored.
9. **PANIC mid-show** — the tab reading `ENDED — PANIC … was NOT restored`,
   with the DISMISS button.
10. **Out-of-order refusal** — tap a locked stage via the engine (or fire a
    stale stage id) and capture the red strip carrying `Out of order …` plus the
    engine's own sentence.
11. **Performance mode ON** — the nav showing `Events` next to Deck / Mixer /
    Live Touch, and the ARM passcode sheet it opens.

## 8. Shared-tree note

Every file was re-read immediately before editing; all edits surgical; nothing
outside `CaptainPad/**` touched (engine files were **read only**, to reconcile
the contract). No foreign content reverted — the `constants/theme.ts` breakage
in §6 is reported, not repaired. No git operations. No live process or port
(6966–6972) used: the whole verification is vitest + tsc + eslint + a dist
export, none of which need the engine.
