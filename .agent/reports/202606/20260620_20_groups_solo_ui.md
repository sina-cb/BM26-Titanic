# 20260620_20 — Channel Groups (gang-faders) + Server-Authoritative Solo / Solo-Safe (WAVE 15, CaptainPad UI side)

**Branch:** `dev/groups_solo_ui` (local only) ·
**Worktree:** `/root/workspace/BM26-Titanic-worktrees/groups_solo_ui` ·
**Builds on:** the merged groups/solo ENGINE wave (`20260620_18_groups_solo_engine.md`, docs/39 §10) ·
**Scope:** CaptainPad UI only — the engine was NOT touched.

The follow-on UI wave deferred by the engine wave (docs/39 §10.6). Builds the
group rail + solo-safe toggle and replaces the destructive client-side solo
with server-authoritative solo. Additive, fail-loud, no new silent fallbacks,
no new deps.

## What was built

- **NEW `CaptainPad/utils/groupsSoloApi.ts`** — typed, fail-loud `ApiResult`
  clients for the entire WAVE-15 REST surface, mirroring `channelExtrasApi.ts`
  (same `fetchWithTimeout` + `api_base` from `./apiBase`; api.ts NOT edited):
  - Groups: `fetchMixGroups` (GET), `createMixGroup` (POST), `updateMixGroup`
    (PATCH name/fader/muted/color), `deleteMixGroup` (DELETE),
    `addChannelToGroup` (POST members), `removeChannelFromGroup` (DELETE
    members). Plus a `MixGroup` interface.
  - Solo: `postSolo` (POST /mixer/solo {channelId,additive}), `deleteSolo`
    (DELETE /mixer/solo/:id), `clearAllSolo` (DELETE /mixer/solo).
  - Solo-safe: `setChannelSoloSafe` (PATCH /mixer/channels/:id {soloSafe}).
  - Every client honours `res.ok`; a non-2xx returns `{ ok:false, error, data }`
    with the engine body surfaced verbatim (the single-membership 400 "already
    in another group", deck `WRONG_ROLE` 400, solo 400/404, group 404).

- **NEW `CaptainPad/components/GroupRail.tsx`** — the channel-groups operator
  surface. Stateless w.r.t. the registry: renders the parent-owned `mixGroups`
  + `channels` (both reconciled from the `mixer` broadcast) and reports edits up
  through the typed clients. Per group: a gang FADER, MUTE toggle, rename field,
  delete (ConfirmSheet-gated), member chips (tap ✕ to unassign), and a
  "+ CHANNEL" assign picker that disables channels already in another group and
  surfaces the engine's single-membership 400 if one is somehow picked.
  Create-group button. All targets ≥44 pt (minHeight/hitSlop). Fail-loud Alerts
  on every rejection; the next broadcast reconciles truth.

- **`CaptainPad/app/(tabs)/mixer.tsx`** —
  - **DELETED the destructive client-side solo**: removed `soloRef`,
    `preSoloStateRef`, and the `handleSoloToggle` save/restore that mutated
    every sibling channel's `enabled`+`fader`. Removed the `soloRef` teardown in
    `handleMuteToggle` and `handleTransition`.
  - **Server-authoritative solo**: new `handleSoloToggle` sends WS
    `setSolo`/`clearSolo` (low-latency) + a REST mirror (`postSolo`/`deleteSolo`,
    fail-loud). A single tap REPLACES the soloed set (`additive:false`); tapping
    the soloed channel clears it. New `soloedIds: Set<string>` state +
    `mixGroups: MixGroup[]` state, both reconciled DISPLAY-ONLY from the
    broadcast's top-level `soloedChannelIds[]` + `mixGroups[]` (seeded from GET
    /mixer too). `handleClearAllSolo` (header CLEAR SOLO button, shown only while
    a solo is engaged) sends WS clearSolo + `clearAllSolo`. `handleTransition`
    now optimistically clears `soloedIds` (engine clears the Set at transition
    start) instead of poking the deleted refs.
  - **Solo display is reconcile-only**: per strip the render loop derives
    `isSolo` (in the Set), `soloActive` (Set non-empty), and `dimmedBySolo`
    (a solo is active AND this channel is not soloed / soloSafe / faderLocked)
    — mirroring the engine's `_effFader` gate visually (0.45 opacity). Sibling
    `enabled`/`fader` are NEVER mutated.
  - **Solo-safe toggle + indicator** per strip (SAFE button in the mute/solo
    row): `handleSoloSafeToggle` → `setChannelSoloSafe` (PATCH {soloSafe}),
    optimistic flip + revert + Alert on rejection. Reads `soloProtected =
    soloSafe || faderLocked` (fader-lock implies solo-safe on the engine); shows
    a lit teal state while a solo is active so protected (mission-critical)
    strips are visibly surviving the solo; labels "SAFE (LOCK)" when protection
    comes from the fader-lock.
  - **Group tint + badge** per strip: a member strip takes its group's color on
    the left edge (channel's own color wins if set; lock border wins over both)
    and shows a tinted group-name badge in the header. `ChannelStrip` stays
    `React.memo` with stable empty-dep callbacks — the new `onSoloSafeToggle`
    handler is `useCallback([])`-stable.
  - **GroupRail mounted** between CPCControls and the master viz.

## Server-authoritative migration (per docs/39 §10 / report _18)

- Old destructive `preSoloStateRef`/`soloRef` save-restore: **REMOVED** (grep
  confirms zero remaining references in mixer.tsx).
- Solo now driven by: WS `setSolo`/`clearSolo` + REST `POST /mixer/solo` /
  `DELETE /mixer/solo/:id` / `DELETE /mixer/solo`.
- Display reconcile: `soloedIds` Set rebuilt from every broadcast's
  `soloedChannelIds[]`; survives reconnect because it lives server-side.
- Solo-safe: `PATCH /mixer/channels/:id { soloSafe }`.
- Group rail: GET/POST/PATCH/DELETE `/mixer/groups[/:gid[/members[/:channelId]]]`;
  `mixGroups[]` + per-channel `mixGroupId` reconciled from the broadcast.

## Verification proof

From the worktree `CaptainPad/` unless noted:

- `git -C <worktree> diff --check -- CaptainPad` → **DIFF-CHECK-CLEAN** (no
  whitespace errors).
- `npx tsc --noEmit` → **exit 0**.
- `npm run lint` → **0 errors, 11 warnings**. All 11 are pre-existing
  (`config.tsx`, `monitor.tsx`, `studio.tsx`, `AllModulationsPanel.tsx`,
  `GlobalEffectMacros.tsx`, `NauticalFader.tsx`, `PlaylistPanel.tsx`,
  `ScheduledTaskRow.tsx`, `HorizontalFader.tsx`, `TimerWheel.tsx`, and the
  pre-existing `mixer.tsx:976` `setInlinePlaylist` exhaustive-deps in an
  untouched callback). **No new warnings** from `groupsSoloApi.ts`,
  `GroupRail.tsx`, or the new mixer.tsx code. (Count is 11 vs the quoted 12
  baseline — one fewer; importantly nothing new was introduced.)
- `npm run web:build` → **exit 0, 21 static routes** (`/mixer` 53.8 kB built).
  First attempt hit a transient `ENOTEMPTY` on the shared `/tmp/metro-cache`
  from the `-c` cache-clear; `rm -rf /tmp/metro-cache` + retry succeeded.

### Structural assertions

- **Solo is server-driven**: tap → WS `setSolo {channelId, additive:false}` (or
  `clearSolo {channelId}`) + REST mirror (`postSolo`/`deleteSolo`); display
  reconciled from broadcast `soloedChannelIds[]` into the `soloedIds` Set;
  `dimmedBySolo` is display-only (opacity), never mutates `enabled`/`fader`.
- **Destructive logic removed**: `soloRef`, `preSoloStateRef`, and the
  sibling-mutating save/restore are deleted.
- **Solo-safe**: SAFE toggle → `setChannelSoloSafe` → PATCH `{ soloSafe }`;
  indicator reflects `soloSafe || faderLocked`.
- **Group rail**: all six group endpoints + the two solo-membership 400s/404s
  wired; `mixGroups[]` + per-channel `mixGroupId` reconciled from the broadcast;
  strip tint/badge driven by the resolved group.

**No headless screenshot** was captured: this is a CaptainPad (Expo/React
Native web) UI change verified through the canonical CaptainPad auto-checks
(`.agent/00_gol/03_captain_pad_auto_checks.md`: tsc + lint + web:build), not a
Three.js sim view — the `agent_render.cjs` puppeteer renderer targets the
simulation, not CaptainPad. A live full-stack solo/group smoke (sim + engine +
CaptainPad) is the natural next validation when a running engine with the
WAVE-15 routes is available.

## Codex P0 compliance

- All imports at top of file (no in-function / try-catch-wrapped imports).
- snake_case-free per repo convention: matches neighbor casing (the existing
  CaptainPad files use camelCase `.ts`/PascalCase `.tsx` component filenames —
  `groupsSoloApi.ts` / `GroupRail.tsx` mirror `channelExtrasApi.ts` /
  `SnapshotBar.tsx`).
- No new silent fallbacks: every client honours `res.ok`; UI surfaces
  rejections via `Alert`/`console.error`; solo/group display is reconciled from
  the authoritative broadcast, never fabricated.
- No new deps; offline-safe (no CDNs/fonts/telemetry added).
- api.ts, ChannelVizStrip.tsx, DeckTopBar.tsx, index.tsx, PlaylistPanel.tsx, and
  all engine files were NOT touched.

## Deferrals (documented)

- **Group color picker** is not surfaced in the rail yet — `createMixGroup`
  takes no color, and there is no swatch UI for `updateMixGroup({color})`.
  Groups render with a neutral dot until colored; the API + the tint/badge
  rendering both already honour `group.color`, so adding a swatch picker
  (reusing the channel-color swatch grid) is a small additive follow-up.
- **Additive multi-solo** is supported by the client (`postSolo(id, additive)`)
  but the single SOLO tap deliberately uses `additive:false` (replace) as the
  dominant operator gesture; no separate "add to solo" affordance is surfaced.
- **Live full-stack smoke** (rendered dim/lit proof through sim) deferred to
  when a WAVE-15 engine is running — see Verification note above.
