# 20260706 · Slot 1 — CaptainPad (deck autopilot profile + split playlists)

- **Branch:** `dev/deck_autopilot_captainpad` (local-only — never pushed)
- **Parent:** `feat/autopilot_deck_improvement`
- **Worktree:** `~/workspace/BM26-Titanic-worktrees/deck_autopilot_captainpad`
- **Slot ports:** Metro `31181`, web serve `31167` (not needed — built against the
  frozen engine contract; no live engine required for tsc/lint/web:build)
- **Role:** Opus DEVELOPER sub-agent, CaptainPad (operator UI) slice.

## Scope

Slot 1 of the master plan (`.agent/projects/autopilot_deck_improvement.md`):
the CaptainPad half of the three-feature deliverable. Built against the FROZEN
engine contracts in the two reference dossiers — I do NOT need a live engine to
compile/type-check. Disjoint files from slot 0 (engine): zero shared files, no
`marsin_engine/` edits.

- **U1** — Autopilot profile dropdown
  (`autopilot_profiles_audio_reactive.md` §"Profile dropdown UI").
- **U2** — Split playlist panes (`deck_split_playlists.md`).

## Files changed

`git diff --name-status feat/autopilot_deck_improvement..HEAD`:

```
M  CaptainPad/app/(tabs)/index.tsx
M  CaptainPad/components/PlaylistPanel.tsx
A  CaptainPad/components/deck/autopilot_profile_picker.tsx
M  CaptainPad/components/deck/pattern_autopilot_panel.tsx
A  CaptainPad/components/deck/split_playlist_panes.tsx
M  CaptainPad/utils/api.ts
```

Two new snake_case components; four modified files. No `package-lock.json`
change (deps were already pinned; `npm install` added none). No engine files.
No new npm dependencies — `PanResponder` + `Modal` are core RN.

## Commits (on `dev/deck_autopilot_captainpad`)

```
6ac06e0 feat(captainpad): U2 split playlist panes
94bc8e7 feat(captainpad): U1 autopilot profile dropdown
```

(parent tip `0252d37 docs(plan): autopilot+deck improvement multi-agent project dossiers`)

## Checks (HONEST)

Baseline BEFORE any change (recorded per brief):
- `npx tsc --noEmit`: **PASS** (exit 0).
- `npm run lint`: **PASS** (exit 0) — 15 pre-existing warnings, 0 errors.

After U1 and after U2 (final tip):
- `git diff --check -- CaptainPad`: **PASS** (no whitespace errors).
- `npx tsc --noEmit`: **PASS** (exit 0).
- `npm run lint`: **PASS** (exit 0) — **15 warnings, 0 errors; ZERO new
  warnings** from this branch. The two new files (`autopilot_profile_picker.tsx`,
  `split_playlist_panes.tsx`) lint clean; the shifted PlaylistPanel warning is
  the pre-existing `clearPending` exhaustive-deps one (line moved 487→493 by an
  added prop, not a new finding).
- `npm run web:build` (web-visible UI changed, so run per the auto-checks spec):
  **PASS** (exit 0, `Exported: dist`; deck route `/` + `/(tabs)` bundled clean).
  `CaptainPad/dist` is gitignored — not committed.

Every commit passed `python scripts/security_check.py --staged` (no leaks).
Working tree clean at handoff. Never `--no-verify`, never pushed, never merged.

## What I built

### U1 — Autopilot profile dropdown

- **New `components/deck/autopilot_profile_picker.tsx`** — presentational
  `{ profile, profiles, onSelect, disabled }`. Clones the `TransitionStylePicker`
  modal idiom (`DeckTransitionControls.tsx:221-320`): tap-to-open
  `<Modal transparent>` list with label+hint rows, current-item highlight, `▾`
  trigger. Two required departures from the source: colours come from
  `usePalette()` tokens ONLY (`C.primaryContainer` wash + `C.primary`/`C.text`),
  NOT the source's `rgba(95,35,199,…)` hex; trigger `minHeight:44` (deck touch
  floor). Option metadata local: `random → RANDOM / "Shuffle/sequential cycling
  (today)"`, `audio_reactive → AUDIO REACTIVE / "Pick driven by live audio"`; an
  unknown id renders as its raw uppercased id (deterministic — NOT a fallback).
- **`pattern_autopilot_panel.tsx`** — added `profile`/`profiles` props + a
  `profile?` key on `PatternAutopilotPatch`. Renders a `PROFILE` row directly
  under the header (only when a non-empty `profiles` list is supplied, so the cue
  editor reuse — which omits it — shows no profile row). The row emits
  `onChange({ profile })`, guarded through `onInteraction()`.
- **`utils/api.ts`** — `setAutopilotProfile(profile)` → `POST
  /deck/playlist/autopilot { profile }`. Surfaces the engine's loud 400 on an
  unknown profile.
- **`index.tsx`** — `autopilotProfile` (default `'random'`) + `autopilotProfiles`
  (default `['random']`) state; seed from `getAutopilot()` (reads
  `data.profile`/`data.profiles`); reconcile in the `autopilot` WS branch
  (defensive typed adoption); `handleAutopilotProfileChange` cloned from
  `handleDeckTxChange` (`notifyInteraction` → snapshot → optimistic set → POST →
  rollback + `Alert` on `!ok`), planGate-guarded (panel `disabled`, `PlanLockScrim`
  overlay, AND an early `if (planGate) return`). The `profile` patch routes to
  this handler (NOT `setAutopilot`, which would double-write).

### U2 — Split playlist panes

- **New `components/deck/split_playlist_panes.tsx`** — two `PlaylistPanel`
  instances (`role="deckSlot"`, `channelId` `primary`/`secondary`, labels DECK A/
  DECK B) separated by a `PanResponder` drag divider cloning
  `HorizontalFader.tsx:65-109` idioms verbatim (transposed to the Y axis):
  responder built ONCE via `useRef`; the release callback read through a ref;
  `*ShouldSetPanResponderCapture:()=>true` + `onPanResponderTerminationRequest:
  ()=>false` so the column ScrollView can't steal the drag; `onPanResponder
  Terminate` mirrors release (browser `pointercancel`); live drag updates LOCAL
  state only, POST once on release/terminate. `MIN_PANE_PT = 140` clamp via an
  `effectiveClamp` bound to the `onLayout` container height; when `h < 2·MIN` the
  stored ratio is left untouched. Pane 2 is opt-in/collapsed by default — a slim
  dashed `+ SECOND PLAYLIST` bar under pane 1; expanding reveals an UNASSIGNED
  secondary panel whose LOAD… dropdown binds a playlist; the pane's ✕
  (`onClosePane`) clears the slot AND collapses. `secondaryBound` (from engine
  WS) keeps the pane open once a binding exists.
- **`utils/api.ts`** — `'deckSlot'` added to `ChannelRole` with branches in:
  `fetchChannelPlaylist` (`GET /deck/playlist/slots` → `[channelId]`),
  `setChannelPlaylist` (primary → existing `POST /deck/playlist` (assign =
  activate); secondary → `POST /deck/playlist/secondary` (browse-only); `null` →
  clear), `setChannelPlaylistEntry` (`POST /deck/playlist/entry { entryId, slot }`,
  keeps the 409/EBUSY `code` contract). New `fetchDeckPlaylistSlots()` (whole
  `{primary,secondary,splitRatio}` map for the seed) + `setDeckPlaylistSplit(ratio)`
  (`POST /deck/playlist/split`).
- **`PlaylistPanel.tsx`** — ONE `role==='deckSlot'` WS branch mirroring the
  `deckOverlay` branch line-for-line (`:574-588`): reads
  `msg.playlistSlots?.[channelId]`, suppress-gate included. Optional `onClosePane`
  prop renders a ✕ header button beside refresh (44pt via hitSlop, `xmark` icon).
- **`index.tsx`** — `deckSplitRatio` (default `0.5`) + `deckSecondaryBound`
  (default `false`) state; seed via `fetchDeckPlaylistSlots()`; reconcile from the
  `deck` WS message's `playlistSlots` (defensive typed ratio adoption);
  `handleSplitRelease` (optimistic ratio + rollback + Alert) and
  `handleCloseSecondary` (`setChannelPlaylist('deckSlot','secondary',null)`,
  optimistic + rollback + Alert), both planGate-guarded. Replaced the single
  `<PlaylistPanel role="deck">` mount (`index.tsx` col-1) with
  `<SplitPlaylistPanes>`; removed the now-unused `PlaylistPanel` direct import.
  **Columns 2/3 (the single parameter panel) untouched.** The `GlobalHueRow`
  still sits pinned above the panes.

## Intended operator interaction (for the validator)

- **Profile:** deck screen → AUTOPILOT PATTERNS card → tap the `PROFILE ▾` row →
  modal lists RANDOM / AUDIO REACTIVE with hints → tap one → optimistic apply,
  POST, engine `autopilot` broadcast reconciles the dropdown. A rejected POST
  reverts + Alerts. Frozen under a live plan (dim + scrim) until takeover.
- **Split panes:** DECK A shows today's list. Tap `+ SECOND PLAYLIST` → an
  unassigned DECK B pane appears; its LOAD… dropdown binds a playlist
  (browse-only — does NOT change what's playing). Tap an entry in EITHER pane to
  drive it (deck plays one pattern; autopilot follows the last-driven pane per the
  engine design). Drag the divider grip to resize; the ratio POSTs once on
  release and rides the `deck` broadcast to every iPad. ✕ on DECK B clears the
  slot + collapses back to the bar. Reload → ratio + secondary presence rehydrate
  from `GET /deck/playlist/slots` then the WS broadcast.

## Known gaps / risks

- **No live-engine integration test.** Per the brief, the primary gate is
  tsc + lint (compiled against the frozen contract); full integration against a
  running engine is the validator's job (slot 2). I did NOT stand up an engine or
  mock the WS — the wiring matches the dossier contract tables exactly, but the
  first real end-to-end run should confirm: (a) `GET /deck/playlist/slots`
  response shape (`{primary,secondary,splitRatio}` with virtual assignments), (b)
  the `autopilot` broadcast actually carries `profile`/`profiles`, (c) the `deck`
  broadcast carries `playlistSlots`, (d) `POST /deck/playlist/autopilot {profile}`
  400s an unknown profile.
- **`getAutopilot()` return shape assumption.** U1 seeds `data.profile` /
  `data.profiles` off `GET /autopilot`. The autopilot dossier says the WS
  broadcast carries them; the master plan phase E1 also folds them into the same
  builder. If the engine exposes them ONLY on the WS (not the GET), the dropdown
  still hydrates on the first `autopilot` broadcast — seed is just a warm-start.
  Confirm during validation; if the GET omits them, no code change is needed
  (typed guards leave the `['random']` default until the broadcast lands).
- **Autopilot target = last-driven pane** is enforced entirely engine-side (the
  daemon reads the live `channel.playlist`); the UI adds no per-pane autopilot
  control, matching gate D2's default. If the operator wants an explicit A/B
  autopilot selector (D2 alt), that's a follow-up.
- **Split ratio scope** is per-scene (shared across iPads) by construction — the
  divider POSTs to engine state, and the WS echo moves every connected iPad's
  divider. Matches gate D3's default. Per-device (AsyncStorage) would be a
  different wiring.

## Ready for merge?

**Ready for merge into `feat/autopilot_deck_improvement`** from the CaptainPad
side, pending the validator's live end-to-end pass (slot 2). tsc/lint/web:build
all green; zero new warnings; no engine files touched; contract-faithful to both
dossiers. The one thing I could not verify without a live engine is the exact
runtime response/broadcast shapes — but those are FROZEN contracts owned by slot
0, and my typed guards degrade safely (documented defaults) if a field is absent.
