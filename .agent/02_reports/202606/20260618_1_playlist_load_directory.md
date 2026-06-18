# 2026-06-18 — Playlist "Load Directory" (bulk-add a patterns/ sub-folder)

## What

Added a **Load Directory** affordance to the playlist feature: bulk-add
every pattern in one of the `patterns/*` sub-directories
(`transitions`, `channel_blends`, `test`, …) into the current playlist
in a single tap. Patterns are referenced with the existing `<dir>/<name>`
slug form that `VALID_PATTERN` and `patternExists` already accept.

## Engine (`marsin_engine`)

- `lib/api_server.js`
  - `listPatternDirs(patternsDir)` — immediate sub-directories of
    `patterns/`, slug-guarded (`VALID_PATTERN_DIR`).
  - `listPatternsInDir(patternsDir, dir)` — `<dir>/<name>` slugs for one
    folder; skips `_`-prefixed internal helpers; rejects a bad dir name
    loudly (no fallback).
  - `GET /pattern-dirs` → directory names.
  - `GET /pattern-dirs/:dir` → prefixed pattern slugs.
- `tests/playlist_api.test.js` — 4 new tests (list dirs, list slugs,
  bulk-add round-trips with no `_missing`, traversal rejection).
  Full suite: **17/17 pass**.

## CaptainPad

- `utils/api.ts` — `fetchPatternDirs()`, `fetchPatternsInDir(dir)`.
- `components/ui/icon-symbol.tsx` — `folder.fill` → Material `folder`.
- `components/PlaylistPanel.tsx`
  - Folder button beside `+`; opens `LoadDirectoryModal`, lazily
    fetching the dir list on first open.
  - `handleLoadDirectory(dir)` appends all patterns as new entries and
    auto-saves (same optimistic/auto-persist model as `+`).
  - **Visibility:** same gate as `+` — hidden when the channel is
    `locked`, and on the deck when the playlist-edits lock is engaged.
  - **Mixer:** same button rides the `compact` sizing tokens, so it
    renders as the requested small button on mixer strips.

## Checks

- Engine: `node --test tests/playlist_api.test.js` → 17/17 pass.
- CaptainPad: `tsc --noEmit` clean for the touched files (only
  pre-existing `Modulation.tsx` errors remain); `eslint` of the three
  changed files added 0 errors / 0 new warnings.
