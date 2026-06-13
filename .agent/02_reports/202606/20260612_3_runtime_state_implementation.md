# Runtime/defaults state split — implementation report

**Date:** 2026-06-12 · **Author:** agent (developer role) · **Branch:** `claude/runtime-config-separation-p2tnmz`
**Plan:** `20260612_2_runtime_config_separation_plan.md` (implemented in full, single PR per Sina)

## What shipped

Running the engine no longer dirties git — ever. All live YAML state
(mixer, deck, globals incl. CPC params, audio, scheduler, autopilot,
playlists) moved to a gitignored runtime cache that persists across
restarts, with an explicit promote action to consolidate it back onto
the tracked defaults when the operator wants to keep it.

### Layout

```
marsin_engine/config.yaml               tracked settings — READ-ONLY at runtime now
marsin_engine/state_defaults/<model>/   tracked defaults (git mv of old states/)
  ├── *.yaml                            mixer/deck/globals/audio/slots/scheduler/autopilot
  └── playlists/*.yaml                  git mv of simulation/scenes/<scene>/playlists/
marsin_engine/states/<model>/           RUNTIME — gitignored, survives restarts
  └── (same shape, incl. playlists/)
```

### Engine (`marsin_engine/`)

- **`lib/runtime_state.js`** (new): `seedRuntimeState` (per-file copy of
  missing runtime files from defaults at boot — existing files never
  overwritten), `promoteRuntimeState` / `resetRuntimeState` (atomic
  tree mirrors incl. deletions, so a runtime-deleted playlist is
  removed from defaults on promote instead of resurrecting),
  `runtimeStateStatus` (per-file diff rollup). All paths anchored to
  the module dir — fixes the cwd bug that sprayed a stray `/states/`
  at the repo root.
- **`engine.js`**: seeds the runtime dir at boot, before the earliest
  reader (audio CLI flags).
- **`lib/api_server.js`**: `stateDir` → anchored runtime dir;
  `playlistsDir` → `states/<model>/playlists/`; new routes
  `GET /state/runtime`, `POST /state/promote` (flushes the CPC's
  250 ms debounced save first so the snapshot can't be torn),
  `POST /state/reset` (returns `restartRequired: true`).
- **`lib/autopilot.js`**: no longer reads/writes `config.yaml` (it used
  to rewrite the whole tracked settings file on every PLAY/PAUSE,
  destroying comments). State now rides an injected store →
  `autopilot_state.yaml` in the runtime dir; the old `playlist:` block
  values were preserved as `state_defaults/<model>/autopilot_state.yaml`
  for all four models and removed from `config.yaml`.
- **`lib/param_center.js`**: added `flushPendingSave()`;
  `lib/state_manager.js`: `save()` is now atomic (tmp+rename).
- **`tools/promote_state.mjs`** (new): headless wrapper —
  status / `--promote` / `--reset` against a running engine.
- Deleted dead `marsin_engine/param_center_state.yaml` (CPC persists
  via the saveHook into `globals_state.yaml`) and the stray repo-root
  `states/` residue.

### CaptainPad

- `utils/api.ts`: `fetchRuntimeStateStatus` / `promoteRuntimeState` /
  `resetRuntimeState`.
- CONFIG tab: new **SHOW STATE** card — MATCHES/DIFFERS chip, changed
  file list, `SAVE AS SHOW DEFAULTS` + `RESET TO DEFAULTS` as two-tap
  armed buttons (auto-disarm 4 s; `Alert.alert` confirms don't fire on
  the web build).

### Docs/specs updated

`CLAUDE.md` (residue note → gitignored-runtime note, repo map),
`.agent/00_gol/05` + `13`, `.agent/01_skills/04` + `05`, `docs/07`,
`15`, `18`, `19`, `24`. `.gitignore`: `+ marsin_engine/states/`, and
the now-obsolete `simulation/scenes/*/playlists/hil_*.yaml` rule
dropped (HIL playlist residue lands in the ignored runtime dir).

## Verification

- `node engine.js --list` ✓ · dry-run `test_const`/`test_bench` exits 0 ✓
- Boot seeds runtime (incl. playlists), `git status` stays clean ✓
- Live HTTP loop: CPC write + playlist create + autopilot toggle →
  `/state/runtime` dirty with correct per-file flags → promote writes
  exactly those files into `state_defaults/` (tuned value verified in
  the tracked yaml) → playlist delete + promote removes it from
  defaults → reset mirrors back + `restartRequired` ✓
- CLI wrapper: status + promote against the live engine ✓
- `node --test tests/*.test.js`: 525/526 pass; the 1 failure
  (`audio_config.test.js` AUDIO_LIVE_FIELDS) **pre-exists on the base
  branch** (verified via stash). `playlist_api.test.js` updated for the
  new layout (and now disables deck transitions via the API in
  `before()` — the seeded summer-camp defaults enable 500 ms soft
  swaps, which broke its synchronous switch assertions).
- CaptainPad: `npx tsc --noEmit` (only the 2 pre-existing
  `Modulation.tsx` errors), `npm run lint` (no new findings),
  `npm run web:build` ✓. Puppeteer-verified on the web build:
  CONNECTED + DIFFERS chip + file list, two-tap promote →
  "Saved to defaults: 3 file(s) written" → MATCHES (screenshots in
  `.agent_renders/captainpad_showstate_*.png`).

## ⚠️ Deploy / upgrade note (read before pulling this onto a show machine)

`marsin_engine/states/` flips from **tracked** to **gitignored** in this
change (the tracked content moved to `state_defaults/`). On a machine
that already ran the old engine, the on-disk `marsin_engine/states/`
directory physically persists after the pull — and because seeding is
per-file and **never overwrites existing runtime files**, the engine
will boot on whatever stale content is sitting there rather than the new
tracked defaults. This is harmless on a dev box but can show the *wrong
state* on the rig with no warning.

**One-time upgrade step on each deployed machine** (Titanic, Pis):
after pulling, delete the stale runtime dir so it re-seeds from the new
defaults:

```bash
rm -rf marsin_engine/states/
```

(Or run `node tools/promote_state.mjs --reset` against the running
engine, which mirrors defaults → runtime explicitly.)

## Cold-review fixes (2026-06-13, second commit)

A cold reviewer pass caught three issues; all addressed:

- **Promote dropped in-flight playlist captures (real tearing bug).**
  The per-channel auto-capture (`scheduleEntryCapture`, 500 ms debounce)
  writes playlist-entry defaults and was NOT flushed by `/state/promote`
  — a slider nudged within 500 ms of hitting save would miss the
  promoted defaults. Added `flushPendingCaptures()`, called in the
  promote handler alongside the CPC flush. Verified live: a 0.27 nudge
  immediately followed by promote now lands in the promoted playlist
  YAML.
- **Legacy `config.yaml` autopilot values silently dropped on upgrade.**
  Added a one-time boot migration: if a `playlist:` block still exists
  in `config.yaml` AND `autopilot_state.yaml` was freshly seeded this
  boot, its values are carried into the runtime file with a loud log.
  Verified live (`delay_s: 99` custom block → migrated).
- **No tests for the core module.** Added `tests/runtime_state.test.js`
  (7 tests: seed/never-overwrite, status/dirty rollup, promote incl.
  deletion mirroring, fail-loud on no-runtime, reset, no tmp residue).

Plus: autopilot now fails loudly on a present-but-corrupt state file
(was silently defaulting); engine.js audio paths use `runtimeStateDir()`
instead of re-hardcoding the `states/<model>` join.

## Notes / follow-ups (Notion when MCP is enabled)

- `state_defaults/titanic/` has no playlists yet — first promote on the
  titanic model will create them.
- Deferred from the plan's open questions: per-file promote granularity
  (whole-model only for now) and the sim save-server files
  (`common.yaml` & friends) getting the same treatment.
- `StateManager.save()` still warns-and-continues on a write error
  (pre-existing). In the extreme case (disk full mid-show) a promote
  could copy slightly stale mixer/deck data while reporting success.
  Left as-is to avoid changing global save semantics under this PR;
  worth revisiting if it ever bites.
