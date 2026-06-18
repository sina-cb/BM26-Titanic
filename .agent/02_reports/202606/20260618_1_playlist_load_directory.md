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

## Update — dual action + `default` root (operator request)

The picker was reworked from a single append-on-tap into a richer chooser
(applies to **both deck and mixer**, same shared component):

- **`default` root option.** `GET /pattern-dirs` now leads with the
  synthetic `default` entry (the top-level `patterns/` folder);
  `GET /pattern-dirs/default` returns bare top-level slugs filtered like
  `generateDefault` (`test*` / `_*` excluded). Sub-folders still return
  `<dir>/<name>`.
- **Two actions per folder** (`LoadDirectoryModal`):
  - **New playlist** (filled primary) — `handleDirNewPlaylist(dir)`:
    creates a playlist named after the folder, fills it with that
    folder's patterns, and loads it onto the channel. Confirms before
    overwriting an existing name.
  - **Append** (outline secondary) — `handleDirAppend(dir)`: the prior
    behaviour, adds the folder's patterns to the loaded playlist;
    disabled when none is loaded.
- **Taller chooser** — card `maxHeight 90%`, scroll `maxHeight 520`, with
  a one-line legend explaining the two actions.
- Folder button is now always enabled (New-playlist needs no loaded
  playlist); shared `fetchDirEntries` helper backs both actions.

## Checks

- Engine: `node --test tests/playlist_api.test.js` → **18/18 pass**
  (added `default` dir-list + bare-slug tests).
- CaptainPad: `tsc --noEmit` clean for the touched files (only
  pre-existing `Modulation.tsx` errors remain); `eslint PlaylistPanel.tsx`
  → 0 errors (only the pre-existing `clearPending` dep warning).
- Verified live with screenshots on test_bench (deck + mixer): taller
  modal with `default` + folders, "New playlist" creating + loading a
  `transitions` playlist, and the same modal on a mixer channel.
