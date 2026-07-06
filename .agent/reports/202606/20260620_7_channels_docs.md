# 20260620 — Channels subsystem reference doc (deck/mixer/hot-swap)

**Agent**: sub-agent, slot `channels_docs` · **Branch**: `dev/channels_docs`
(local only) · **Worktree**: `~/workspace/BM26-Titanic-worktrees/channels_docs`

## Scope

ADDITIVE DOCUMENTATION only — zero behavior change. Wrote one new reference doc
capturing the channels subsystem (deck + mixer + hot-swap playlists +
production signals + CaptainPad two-view best practices + timeline-readiness)
as it stands on the deliverable tip after all channels-campaign waves merged.

Picked next free docs number: `docs/38_channels_deck_mixer.md` (37 was the
highest existing). snake_case, matches existing docs' heading/tone. Extends and
cross-references `docs/18_marsin_mixer.md`, `docs/19_playlists.md`,
`docs/27_mixer_layer_view_selection.md` rather than duplicating them.

## Files changed

- `docs/38_channels_deck_mixer.md` (new)
- `.agent/02_reports/202606/20260620_7_channels_docs.md` (this report)

`git diff --name-status` shows only these two files. No code touched.

## Verification proof (accuracy cross-check)

Every endpoint/field/behavior in the doc was read directly from the code on
this worktree tip (`5fd7f3d merge(channels): regression_fixes`), not from the
plan/recon prose. Specific cross-checks:

- **`/deck/playlist/swap`** body `{name, entryId?, transition?}`, response
  `{status, playlist, pattern, transitionId, targetEntryId}`, errors 400/404/409
  EBUSY — verified `api_server.js:4104-4198`.
- **`targetEntryId` FIX B** (response carries resolved id; `playlist.activeEntryId`
  is still OLD mid-fade) — verified `api_server.js:4177-4184` + consumer
  `PlaylistPanel.tsx:726-740`.
- **`/deck/playlist/queue`** warm-then-fire, `reused` flag, 409 EBUSY, leak-safe
  `warmInactiveDeckHandle` — verified `api_server.js:4199-4294` +
  `pattern_mixer.js:960-997` (redundant/refused handle destroyed).
- **Mixer swap is INSTANT** (`loadPlaylistEntry`, no double-buffer, no 409 on
  swap path) vs deck soft-swap (`loadPlaylistEntryWithTransition`) — verified
  `api_server.js:4429-4497` and `:1278-1297` (EBUSY thrown when enabled +
  in-flight).
- **Parametric transition validation** mirrors `/deck/transition-config`;
  `durationMs` finite-reject + clamp `[50,30000]` (`DECK_TRANSITION_MIN/MAX_MS`)
  — verified `validateSwapTransitionOverride` `api_server.js:238-278` +
  `/deck/transition-config` `:4325-4362`.
- **`/status.renderHealth {ok, frame, blendErrors}`** + boot precompile +
  fail-loud-once-per-mode fallback — verified `api_server.js:2274` +
  `pattern_mixer.js:266-284, 371-444` (patternsDir setter triggers
  `precompileAllBlends`).
- **`/status.deckRestoreDegraded {failedPattern, reason, fellBackTo}`**, deck
  never dark-starts, fatal only if default also fails, dangling activeEntryId
  cleared — verified `api_server.js:2281`, `restoreDeckWithFallback`
  `:372-411`, `buildChannelFromSaved` dangling-id clear `:1627-1634`.
- **`validateFader`** number/finite-only, reject null/bool/object, clamp
  `[0,1]`, 4 write paths — verified `:195-212` + callsites `:2957, 3124, 3957,
  4759`.
- **View crossfade / view-override lease / auto-finalize on tab-away** —
  verified `/mixer/view` `:3240-3258` (`finishDeckSwapNow` on view→mixer) +
  `/mixer/view-override` leased pin `:3260-3284`.
- **CaptainPad**: `useEngineConnection` WS-driven boot (no polling, reconnect-
  only-if-down) verified `useEngineConnection.ts:1-70`; swap clients honor
  `res.ok` + EBUSY-on-409 + cache invalidation `api.ts:1421-1490`;
  pending-gate watchdog `PENDING_WATCHDOG_MS = 8000` `PlaylistPanel.tsx:225`;
  honest mixer copy "Switch … (no crossfade)" vs deck "Crossfade"
  `PlaylistPanel.tsx:1474-1475`.

Repo checks on the worktree:
```
$ git diff --check         → clean (DIFFCHECK_OK)
$ git status --porcelain   → only docs/38_... (+ this report)
```
Markdown only; no source files modified.

## Known gaps

- Documented two stale-doc discrepancies in the new doc's §7 rather than
  editing code or the older docs (out of additive scope):
  `19_playlists.md` still marks mixer-channel playlist routes "Future" (now
  implemented); `18_marsin_mixer.md` §7 lists `POST /mixer/base` /
  `:id/pattern` which the as-built surface supersedes with playlist swap/entry
  routes.
- Flagged (not fixed) a latent UI timing edge: the deck pending-gate watchdog
  is 8s but `transition.durationMs` can be configured up to 30000 ms — a long
  fade could clear the gate before completing. Not observed at default
  durations.
- Timeline integration (arbiter → swap/queue wiring; single-deck-autopilot vs
  timeline per-channel autopilotPool reconciliation) is explicitly documented
  as FOLLOW-UP on `feat/timeline_support`, not done here.
