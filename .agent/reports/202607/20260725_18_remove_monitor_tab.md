# 20260725_18 — Remove the Monitor tab · Audio "OPEN COMPANION" · Timeline PARTY MODE card

**Date:** 2026-07-27 · **Zone:** CaptainPad · **Branch:** `feat/bm_readiness`
**Master doc:** `.agent/projects/bm26_show_readiness.md` (R6 row + Log updated)

Three operator orders landed in one wave, all inside `CaptainPad/`:

1. **Remove the Monitor tab entirely** + clean up the code behind it.
2. **Audio tab:** an OPEN COMPANION button that opens the Marsin Audio
   Companion web UI, addressed from the app's effective api_base.
3. **PARTY MODE session-handling card** — first specced for the Audio tab,
   then moved by operator revision to the **TIMELINE tab** (division of
   concerns: the companion configures DETECTION, CaptainPad's Timeline tab
   owns HANDLING). The Audio tab keeps only the OPEN COMPANION link.

---

## 1. Monitor tab — deleted

| Change | File | Lines |
|---|---|---|
| Screen + route deleted | `CaptainPad/app/(tabs)/monitor.tsx` | −129 (whole file) |
| Tab-bar registration removed | `CaptainPad/app/(tabs)/_layout.tsx` | −7 |
| Dead icon mapping removed | `CaptainPad/components/ui/icon-symbol.tsx` | −1 (`'desktopcomputer': 'monitor'`) |
| Stale comment (tab list) | `CaptainPad/components/timeline/PendingProgramOverlay.tsx` | ±1 |

The tab was self-contained. Everything it imported is shared and was
**kept**: `useGlobalStyles`, `usePalette`, `IconSymbol`, `getApiBaseAsync`,
`testConnection` (also used by `config.tsx`, `useEngineConnection.ts`,
`useEngineState.ts`), `engineEvents`. Grep found no other importer of
`monitor.tsx`, no monitor-only components/hooks/utils/types/styles, and no
test asserting the tab's existence (vitest only globs pure `.ts` logic
suites — the tab layout is `.tsx` and untested), so no test needed editing.

### Kept-but-suspect (shared / deliberate)

- **`react-native-webview` (`package.json` + lockfile)** — `monitor.tsx` was
  its only app-code consumer, so the dependency is now unused. It was NOT
  removed: dropping a dep requires an `npm install`, and the offline-readiness
  rule forbids runtime installs on the playa; a rebuild proved it is simply
  no longer bundled. Worth removing in a deliberate dependency pass.
- **`IconSymbol` mappings** — only `'desktopcomputer'` was monitor-only and
  was removed; the rest are shared.

The sidebar now runs MIXER · DECK · STUDIO · AUDIO · OSC · TIMELINE ·
SCHEDULER · DIMMER RACK · MIDI · CONFIG (Monitor sat between OSC and
TIMELINE). `expo export` emits no `/monitor` route.

---

## 2. Audio tab — OPEN COMPANION

- **New pure helper** `CaptainPad/utils/companion_url.ts` (43 lines):
  `companionUrlFromApiBase(apiBase)` parses `scheme://host[:port]` and swaps
  the port for `AUDIO_COMPANION_PORT = 6966` — the value is not invented, it
  mirrors `launcher.js → COMPANIONS.audio.port` (the only place the repo
  names it; there is no importable JS/TS constant). An empty or unparseable
  base **throws** (codex P0 — no guessed address).
- **`CompanionLinkCard`** in `app/(tabs)/audio.tsx`, mounted above the
  SETTINGS disclosure (visible without expanding anything). It resolves the
  EFFECTIVE base via `getApiBaseAsync()` (Config-tab AsyncStorage override
  included), shows the resolved URL in the subtitle, and opens it with
  `Linking.openURL`. On a derivation failure the button disables and the card
  prints the error.
- **Verified on the operator's address:** with `API_BASE =
  http://10.x.x.151:6968` the card renders
  `http://10.x.x.151:6966` — never 127.0.0.1 (screenshot below).
- **Tests:** `utils/companion_url.test.ts`, 8 cases (override host, no port,
  loopback default, https + trailing slash, IPv6 literal, empty → throws,
  unparseable/`ws://` → throws, port pinned to 6966).

---

## 3. Timeline tab — PARTY MODE (session handling)

Originally built on the Audio tab, then **moved** per the operator revision.
The Audio tab no longer contains any party UI.

**Client:** `CaptainPad/utils/party_api.ts` (253 lines) against the engine
contract (engine agent building the server side concurrently):

```
GET  /party-config → { enabled, playlist, availablePlaylists,
                       minDwellSec, durationMin, cooldownSec, effectiveState? }
PUT  /party-config   partial { enabled?, playlist?, minDwellSec?,
                       durationMin?, cooldownSec? } → full new state | 400 { error }
```

- `parsePartyConfig()` validates every field and **throws** on a malformed
  payload (no half-populated card, no defaults).
- `fetchPartyConfig` / `setPartyConfig` return the repo-standard
  `{ok, data, error, status}` envelope and surface the engine's `error` body
  verbatim on a non-2xx.
- Pure helpers: `stepPartyField()` (per-field bounds + step, clamped and
  snapped to the step grid), `formatMinSec()`, `formatMinutes()`,
  `describePartyStatus()` — prefers the engine's `effectiveState` when sent,
  else derives from `enabled` + `/timeline/state` (`planActive`, `party`,
  `currentMood`, `partyCooldownRemainingSec`); `ENGINE OFFLINE` and
  `CHECKING…` are honest states, and "enabled but no plan running" reports
  **NO PLAN**, not ARMED (party only takes effect under an active plan).
- `utils/timelineApi.ts` `TimelineState` gained two OPTIONAL fields
  (`partyEnabled`, `partyCooldownRemainingSec`, +8 lines) so a pre-contract
  engine still typechecks.

**UI:** `PartyModeSection` + `PartyStepperRow` in `app/(tabs)/timeline.tsx`
(+315 lines incl. styles), mounted as the FIRST block of the tab's scroll
body, above the festival editor:

- Header: status pill (ARMED / DISABLED / NO PLAN / IN SESSION / COOLDOWN /
  CHECKING… / ENGINE OFFLINE) + one-line explanation, and a big
  ENABLED/DISABLED toggle.
- TRIGGER PLAYLIST: chips from `availablePlaylists`, wrapping (works in both
  orientations); empty list renders a loud "nothing to run" line.
- SESSION HANDLING: `− value +` stepper rows for SUSTAIN BEFORE TRIGGER
  (m:ss), SESSION LENGTH (min), COOLDOWN (min). Taps mutate a local pending
  value (touch feel) and a 700 ms debounce PUTs the settled value; the row
  marks itself unsaved until the response lands.
- **Reconciliation:** every PUT response replaces local state; optimistic
  toggle state is cleared unconditionally; a 400/network failure prints
  `Rejected — <engine message>` and the card snaps back to server truth.
- A gate flip arriving on the control bus (`timelineState.partyEnabled`)
  mirrors into the card so it can't show a stale toggle.

**Tests:** `utils/party_api.test.ts`, 25 cases with mocked fetch — GET/PUT
wire shape, partial-patch bodies, verbatim 400, transport failure, six
malformed-payload rejections, stepper bounds/snapping, formatters, and the
full status matrix incl. `effectiveState` precedence and NO PLAN.

---

## Verification

- `npx tsc --noEmit` — **clean** (run after every stage).
- `npx vitest run` — **842 passed**, 6 skipped, 40 files
  (baseline 809 + 8 companion_url + 25 party_api). No existing test changed.
- Fresh `npx expo export --platform web`, served with `npx serve dist -p 7167`,
  captured at iPad-10 dims **1180×820**.
- Every remaining tab loaded. Console errors seen are **pre-existing and
  environmental**: `ERR_CONNECTION_REFUSED` when no engine is reachable, and
  a minified React **#418** hydration warning that fires on every route
  (including untouched tabs) in the static export — present before this wave.

### Screenshots (`~/tmp/captainpad_ui_wave/`)

| File | What it proves |
|---|---|
| `tabbar_no_monitor.png` | New sidebar — **no Monitor** between OSC and TIMELINE |
| `audio_companion.png` | Audio tab: party UI gone, AUDIO COMPANION card present |
| `audio_party_companion.png` | Companion row resolving `http://10.x.x.151:6966` |
| `timeline_party.png` | Timeline PARTY MODE card against the LIVE engine — fail-loud `HTTP 404` (route not up yet) |
| `timeline_party_populated.png` | Full card: playlist chips + all three steppers (page-level `/party-config` stub) |
| `timeline_party_rejected.png` | `Rejected — 'ambient' is not a party playlist` from a stubbed 400 |

---

## Deploy — SKIPPED (correctly)

Checked the deployed stack as instructed:

- `deploy/deploy.py` mirrors the working tree, but the show-server manifest
  (`$BM26_MACHINES`) has **titanic-ext on `profile: prod`**, and
  `launcher.js` defines `prod.processes = ['sim', 'engine']` — **no
  CaptainPad process runs on titanic-ext**. `:6967` on 10.x.x.151 does not
  answer.
- `CaptainPad/dist/` is **gitignored / untracked**, so no prebuilt bundle
  ships with the repo.

CaptainPad reaches Sina's iPad from **his own laptop's Metro on :6967**
(never touched by this wave — all saves are compile-clean, so the Monitor tab
simply vanishes and the two cards appear on hot-reload). No `deploy.py`
invocation was made; there is nothing on the remote to update for this change.

## Open / owed

- **Live PARTY MODE proof** — `GET http://10.x.x.151:6968/party-config`
  still returns **404**; the engine side had not landed at the end of this
  wave. The card's populated state was proven with a page-level stub of that
  one route. Re-run against the engine once it is up (coordinator sequences).
- `react-native-webview` is now an unused dependency (see above).

---

# Addendum — session-length modes + cooldown gating (same day)

Two operator revisions landed after the body above was written. The second
supersedes part of the first; the final state is what's described here.

## Contract (final)

```
GET  /party-config → { enabled, playlist, availablePlaylists, minDwellSec,
                       durationEnabled, durationMin,
                       cooldownEnabled, cooldownSec, effectiveState? }
PUT  /party-config   partial of the same → full new state | 400 { error }
```

`cooldownSec` default is now **120 s (2 min)**. `releaseSustainSec` was
specified in revision 1 and **removed** in revision 2 — there is NO
timeline-side release value; the release IS the companion's `offConfirmMs`
detection param (one sustain, not two stacked). It is gone from
`party_api.ts` entirely (type, bounds, parser, and the `formatSeconds`
helper that only served it).

## Card behaviour

- **SUSTAIN BEFORE TRIGGER** — always shown, **no toggle**: the
  strong-detection guarantee.
- **SESSION LENGTH** — ON: `durationMin` stepper (fixed length). OFF:
  the row becomes a **hint, not an editor** — "Follows the music — ends when
  the party signal drops (release sustain = `offConfirmMs`, tuned in the
  **Audio Companion ↗**)", where *Audio Companion* is tappable and deep-opens
  the companion via the same `companionUrlFromApiBase()` helper the Audio tab
  uses (plain text, no link, if the base can't be parsed).
- **COOLDOWN** — own toggle, but **forced off, greyed, and stepper-less**
  whenever duration is off, with the hint "No cooldown in follow-the-music
  mode." The rule lives in ONE pure function, `describePartyRows()`, applied
  to the engine's own fields, so the card cannot show a combination the
  engine doesn't hold.

## Playa-proofing (operator emphasis)

Rebuilt the card's edit model around **one coalesced pending patch**:

- Every control (gate, playlist, both toggles, every stepper) queues into a
  single `PartyConfigPatch` via the pure `coalescePartyPatches()`, committed
  after a 700 ms debounce. **Rapid flapping collapses to one PUT carrying the
  final intent** — verified live: 6 fast taps on the SESSION LENGTH toggle
  produced exactly `[{"durationEnabled": false}]`.
- **Engine unreachable mid-edit:** the PUT failure path now **keeps** the
  pending edits, shows the error plus "Your edits are still here, unsaved",
  and offers a **RETRY** button that re-sends them. Only the fields a
  successful PUT actually carried are cleared, so anything touched while a
  request was in flight survives.
- **Contract fields missing:** `parsePartyConfig()` rejects a non-boolean
  `durationEnabled` / `cooldownEnabled` and any non-finite number by name —
  loud, never guessed.
- Display is `mergePartyPatch(server, pending)` — server truth with the
  unacknowledged edit laid on top, replaced wholesale by the PUT response.

## Tests / checks (addendum)

- `utils/party_api.test.ts` now **35 cases** (was 25): the row rule in all
  three combinations incl. duration-off overriding a `cooldownEnabled: true`
  from the engine, flap coalescing (mashed toggle, mixed fields, empty
  queue), `mergePartyPatch` + the rule over a merged view, PUT transport
  failure returning no data, and a successful retry with the same body.
- `npx tsc --noEmit` clean; full `npx vitest run` → **852 passed**, 6 skipped
  (809 baseline + 43 new).

### Extra screenshots (`~/tmp/captainpad_ui_wave/`)

| File | What it proves |
|---|---|
| `timeline_party_fixed_length.png` | Duration ON: SESSION LENGTH stepper + live COOLDOWN (2 min default) |
| `timeline_party_follow_music.png` | Duration OFF: follow-the-music hint with the tappable Audio Companion link, COOLDOWN greyed + "No cooldown in follow-the-music mode." |
| `timeline_party_portrait.png` | Same card at 820×1180 (portrait) |

Unchanged from the body: the engine's `/party-config` route still 404s on
titanic-ext, so these were captured against an in-page stub of that one
route; the card's live state against the real engine remains the fail-loud
`HTTP 404` in `timeline_party.png`. No deploy (titanic-ext runs `profile:
prod`, no CaptainPad process).

---

# Addendum 2 — landed contract consumed + LIVE proof (404 IOU closed)

The engine side went live on titanic-ext during this wave. Everything below
is **display-only / additive** — no behavioural change to what the card
writes, so the parallel adversarial validator's target didn't move.

## Contract additions consumed

`effectiveState` is now AUTHORITATIVE with **six** values —
`armed | disabled | no_plan | manual | in_session | cooldown`:

- **`manual`** renders as its own amber **MANUAL** pill, "the operator has
  the deck. Party sessions stay parked until the plan is driving again" —
  deliberately NOT folded into NO PLAN.
- **`no_plan` + `inFestivalWindow: false`** renders **OUT OF WINDOW**,
  "Outside the festival window — the plan is dormant…" instead of a mystery
  dormancy. Inside the window (or unknown) it stays NO PLAN.
- **`in_session`** shows a live **"ends in m:ss"** countdown from
  `sessionEndsAtMs` (clamped at 0:00), or "follows the music, ends when the
  signal drops" when `sessionFollowsMusic` is true — never a fake clock for a
  session that has no fixed end.
- **`cooldown`** shows **"Cooling down m:ss"** from `cooldownRemainingSec`.

Also consumed: `effectiveCooldownEnabled` now drives the cooldown greying
(engine wins where it disagrees with the raw toggle; a *pending* duration-off
still greys instantly so the row never lags a round-trip);
`effectiveDurationMin` / `effectiveCooldownSec` surface as an inline
"· engine uses N" note when they differ from the configured value;
`planActive` / `inFestivalWindow` / `partyCueId` are read from
`/party-config` in preference to the control bus, with the bus kept only as
the gap-filler for a pre-addition engine.

While `effectiveState` is `in_session` or `cooldown` the card ticks its
countdown once a second and re-reads `/party-config` every 5 s, so the
numbers always come from the ENGINE rather than a drifting client timer.
Idle states poll nothing.

All additions are **optional** in `parsePartyConfig()` (a pre-addition engine
still parses) but **type-checked by name when present**, including the
nullable `sessionFollowsMusic` / `sessionEndsAtMs` / `partyCueId`.

## LIVE proof — the 404 IOU is closed

Fresh `expo export` → `serve dist -p 7167`, driven headless at 1180×820
against the REAL `http://10.x.x.151:6968` (no stubs anywhere):

1. **Real GET renders** — `timeline_party_live.png`: OUT OF WINDOW pill with
   the festival-window explanation (engine: `effectiveState: no_plan`,
   `planActive: false`, `inFestivalWindow: false`), all **14** real
   playlists, SUSTAIN 2:00 / SESSION LENGTH 12 min / COOLDOWN 2 min.
2. **Real PUT round-trip** — `timeline_party_live_put.png`: tapping the
   COOLDOWN "+" sent exactly `{"cooldownSec":180}`; the engine echoed 180 and
   the card re-rendered "3 min"; "−" restored **120**. The exact numbers the
   order named were also round-tripped straight at the endpoint:
   `PUT {"cooldownSec":121}` → engine 121 (`effectiveCooldownSec` 121) →
   `PUT {"cooldownSec":120}` → 120. (The UI stepper walks a 60 s grid, so 121
   isn't reachable by tapping.)
3. **Greying driven by the ENGINE** —
   `timeline_party_live_follow_music.png`: toggling SESSION LENGTH off made
   the engine report `durationEnabled: false` **and**
   `effectiveCooldownEnabled: false`; the card switched to the
   follow-the-music hint (with the tappable Audio Companion link) and greyed
   the COOLDOWN row to "No cooldown in follow-the-music mode." Toggled back
   to ON afterwards.

**titanic-ext restored** — verified by a final GET:
`enabled true · playlist party_high · minDwellSec 120 · durationEnabled true ·
durationMin 12 · cooldownEnabled true · cooldownSec 120`. Identical to the
pre-test read.

Only console error remains the pre-existing minified React **#418** hydration
warning that fires on every route of the static export.

## Checks (addendum 2)

- `npx tsc --noEmit` clean.
- `npx vitest run` → **867 passed**, 6 skipped (809 baseline + 58 new).
  `utils/party_api.test.ts` is now **50 cases**, including the real
  titanic-ext payload parsed verbatim, a pre-addition payload still parsing,
  `manual` accepted, each addition type-checked when present, the
  engine-effective greying override, `describeEffectiveNote`, and the full
  six-state status matrix with countdown clamping.

### Live screenshots (`~/tmp/captainpad_ui_wave/`)

| File | What it proves |
|---|---|
| `timeline_party_live.png` | Real GET against titanic-ext — OUT OF WINDOW + 14 real playlists |
| `timeline_party_live_put.png` | Real PUT round-trip: cooldown 2 min → 3 min from a stepper tap |
| `timeline_party_live_follow_music.png` | Duration OFF live: cooldown greyed from the engine's `effectiveCooldownEnabled` |
