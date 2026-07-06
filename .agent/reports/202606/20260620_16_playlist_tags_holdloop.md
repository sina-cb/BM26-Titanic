# Slot 2 — playlist_tags_holdloop

- **Branch:** dev/playlist_tags_holdloop
- **Parent branch:** deliverable tip `132504e` (merge(channels): channel_features_engine)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/playlist_tags_holdloop
- **Slot ports:** engine 31268 (HIL), sim n/a, metro n/a

## Scope

Built two additive, backward-compatible playlist features per the approved
design: **#11 Playlist Tags + Search/Filter** and **#12 Per-Entry Hold/Loop**.
Sole engine writer this wave — exactly the two surgical `api_server.js` edits
the design called for, plus the schema coercion in `playlist_manager.js` and
the CaptainPad UI. No new engine routes. `lib/autopilot.js`, `pattern_mixer.js`,
`pattern_channel.js`, `state_manager.js`, `snapshot_manager.js`, and the
other-agent CaptainPad files were left untouched.

## Files changed

```
M CaptainPad/components/PlaylistPanel.tsx
M CaptainPad/utils/api.ts
M marsin_engine/lib/api_server.js          (TWO surgical edits)
M marsin_engine/lib/playlist_manager.js
A marsin_engine/tests/playlist_tags_holdloop.test.js
A marsin_engine/tests/hil/hil_playlist_hold_loop_test.mjs
M docs/19_playlists.md                     (new §2.5)
M docs/39_channels_deck_mixer.md           (appended §9 + §9.1)
```

### Engine

- **`playlist_manager.js`** — `load()` + `save()` mirror the existing
  `defaults`/`modulations` coercion precedent:
  - Playlist-level `tags: string[]`: load coerces (filter strings → trim →
    lowercase → drop empties), save adds a `Set` dedupe; non-array junk → `[]`,
    never throws.
  - Per-entry `hold`/`loop: boolean`: strict `=== true` in BOTH load and save
    (absent/null/0/"false" → false), so old entries are byte-compatible.
- **`api_server.js`** — exactly two edits:
  1. `POST /playlists`: `save({ name, tags: data.tags, entries })` (was dropping
     `tags`). Tags on READ already ride `GET /playlists/:name`.
  2. Autopilot `changePattern` callback: after loading the current entry,
     `hold` → `return` (park, timer keeps re-checking — binary
     park-until-released, not a timed hold); `loop` → next = current (overrides
     shuffle); else existing shuffle/sequential pick. Stale/undefined current
     entry skips the gate. Manual `POST /deck/playlist/entry` taps are NOT
     gated (release mechanism). The sequential `else` was changed to
     `else if (!nextEntry)` so a loop pick isn't clobbered.

### CaptainPad

- **`api.ts`** — `tags?: string[]` on `PlaylistData`; `hold?`/`loop?: boolean`
  on `PlaylistEntry`; `savePlaylist` arg now `{ name; tags?; entries }`.
- **`PlaylistPanel.tsx`** — search box + tag chips in `LibraryModal` AND
  `SwapPlaylistModal` (shared `PlaylistFilterBar` + `filterPlaylistNames`
  helper, client-side, lazy per-name tag fetch via the api.ts cache, names
  render immediately, filter additive). Tag-edit row for the loaded playlist
  (comma-separated → `savePlaylist({ name, tags, entries })`, optimistic +
  flashSaved + rollback). Per-entry H/L toggle buttons mirroring the
  handleMoveEntry optimistic+rollback template, guarded by the same
  editable/playlist-edits-lock guard as the reorder chevrons, ≥44pt via
  hitSlop. Note in-code: hold/loop honored by the deck autopilot only; mixer
  persists but has no live autopilot (no mixer autopilot added).

## Tests run

### Engine (from worktree `marsin_engine/`)

- `git diff --check -- marsin_engine`: **pass** (DIFF-CHECK-OK).
- `node --check lib/playlist_manager.js lib/api_server.js` + both new test
  files: **pass**.
- `node engine.js --list`: **60 pattern(s)**.
- `node engine.js --pattern test_const --model test_bench --dry-run`:
  **exit 0**, "Dry run complete", no missing-blend warning.
- `node --test "tests/*.test.js"`: **876 pass / 0 fail** (869 baseline + 7 new).
  - One transient: a single run flagged `startMasterFade ramps master toward
    the target` (test_bench-unrelated, master-fade timing) failing under
    parallel CPU contention; it passes 8/8 in isolation every time and the
    re-run of the full glob was 876/876/0. Not touched by this slice (no
    fade/render code changed). Pre-existing flaky timing test.
- **New unit tests** (`tests/playlist_tags_holdloop.test.js`, 7/7 pass):
  tags round-trip (lowercase/trim/dedupe), tags junk coercion (object/scalar/
  null/mixed → []), tags malformed-on-disk coercion, hold/loop round-trip,
  hold/loop truthy-but-not-true → false, **OLD-playlist byte-compat** (no tags
  → [], entries → hold/loop false, pre-existing fields intact), load→save→load
  cycle preservation.

### HIL (engine on :31268)

`tests/hil/hil_playlist_hold_loop_test.mjs` — **9/9 assertions passed**:

- HOLD: active entry stayed on the held entry across ≥3 autopilot ticks
  (delay_s=1); after clearing the flag (re-save) the autopilot advanced off it.
- LOOP: active stayed on the looping entry across ≥3 ticks **despite shuffle
  ON** (loop overrides shuffle).
- MANUAL TAP OVERRIDES HOLD: while parked + autopilot active, a manual
  `POST /deck/playlist/entry` moved the active entry off the held entry
  (autopilot honored hold the tick before; the tap is the release).

State hygiene: snapshotted `states/test_bench/{deck,mixer,globals}_state.yaml`
+ `config.yaml` before booting; restored after. Cleaned a throwaway probe
playlist; engine killed; **port 31268 free**. `git status` shows only the
4 intended source edits + 2 new tests + 2 doc edits (node_modules are
untracked symlinks). `states/summer_camp_dome` + that scene's regenerated
`playlists/default.yaml` residue (engine re-saved old playlists with the new
`tags: []` / `hold: false` / `loop: false` fields — proof of byte-compat
additivity) was restored to HEAD with `git checkout --`; nothing committed.

### CaptainPad (from worktree `CaptainPad/`)

- `git diff --check -- CaptainPad`: **pass**.
- `npx tsc --noEmit`: **exit 0**.
- `npm run lint`: **0 errors / 12 warnings** (baseline). One new warning was
  introduced and fixed (the tag-seed effect now depends on the joined string +
  name, both used) so we are back at the 12-warning baseline. The remaining
  PlaylistPanel warning (line ~527, `clearPending` dep) is pre-existing.
- `npm run web:build`: **exit 0**, 21 static routes.

## Known gaps / follow-ups

- Hold/loop are honored only by the **deck** autopilot (per design). Mixer
  overlays persist the flags but have no live autopilot; we deliberately did
  NOT add a mixer autopilot (out of scope, and would collide with
  feat/timeline_support). The mixer panel still shows the toggles for symmetry.
- Hold is a binary park-until-released flag, intentionally NOT a
  timed/scheduled hold (kept clear of feat/timeline_support).
- The `master_fade` flaky timing test under parallel contention is not ours to
  fix here; flagging for whoever owns the test-runner concurrency.

## Operator action requested

Ready for review and merge. Pure-additive + localized: schema coercion +
two surgical engine edits + UI + docs; safe to merge early in the
safest-first order (additive-first).
