# Plan: Runtime / defaults separation for engine YAML state

**Date:** 2026-06-12 · **Author:** agent (planner role) · **Status:** proposal, awaiting Sina's sign-off
**Branch:** `claude/runtime-config-separation-p2tnmz`

## 1. Problem

The engine live-writes YAML into git-tracked files. Any run of the
engine (or a CaptainPad knob twiddle) dirties the working tree, which
we currently paper over as "expected residue — report it, don't commit
it" (CLAUDE.md, full-stack smoke skill). Sina wants:

1. Tracked files become **defaults** only — loaded at boot, never
   written at runtime.
2. Live state goes to **runtime files** that are gitignored but
   persist across runs (a cache, not a tmpdir).
3. An elegant, deliberate **"save runtime → defaults"** action when the
   current live state is worth keeping as the new defaults.

## 2. Inventory — who writes what today

| File(s) | Writer | Trigger |
|---|---|---|
| `marsin_engine/states/<model>/mixer_state.yaml`, `deck_state.yaml`, `globals_state.yaml`, `global_effect_slots.yaml` | `StateManager` (`lib/state_manager.js`, driven by `api_server.js`) | every mixer/deck/global/slot mutation (debounced) |
| `marsin_engine/states/<model>/audio_state.yaml` | `lib/audio_config_store.js` | audio config PATCH/reset, mic chooser |
| `marsin_engine/states/<model>/scheduled_tasks.yaml` | `lib/scheduled_tasks.js` | task CRUD + fire bookkeeping |
| `marsin_engine/config.yaml` | **`lib/autopilot.js`** (`saveConfig()`) | autopilot PLAY/PAUSE/delay/shuffle. Rewrites the *entire settings file* via `yaml.dump` — also destroys comments/ordering. Worst offender: runtime state living inside the defaults file. |
| `marsin_engine/param_center_state.yaml` | **nobody anymore** | `ParamCenter` is constructed with `statePath = null` (`engine.js:873`) and persists through `saveHook → globals_state.yaml` (`api_server.js:325`). The tracked root file is stale residue. |
| `/states/test_bench/` (repo root!) | `StateManager` | path bug: `api_server.js:247` builds `stateDir` from the **cwd-relative** `'./patterns'` arg, so running the engine from the repo root sprays state into `/states/`. |
| `simulation/scenes/<scene>/playlists/*.yaml` | `lib/playlist_manager.js` | playlist CRUD from CaptainPad. Curated content, not churn — see open questions. |
| `simulation/scenes/{common,scene_config,views,patches,cameras}.yaml` | sim save-server (`:6970`) | deliberate sim-side saves. **Out of scope here**; same pattern could apply later (see §7). |

## 3. Target design

### 3.1 Directory split

```
marsin_engine/
  config.yaml                 # tracked settings — READ-ONLY at runtime
  state_defaults/<model>/     # tracked defaults  (git mv of today's states/)
  states/<model>/             # RUNTIME — gitignored, persists across runs
```

The runtime dir keeps the existing `states/<model>/` path on purpose:
every writer (`StateManager`, audio store, scheduled tasks) already
points there, so the live read/write code paths need **zero churn**.
The tracked copies move out from under it via
`git mv marsin_engine/states marsin_engine/state_defaults`, and
`.gitignore` gains `marsin_engine/states/`.

### 3.2 Boot seeding (defaults → runtime)

In `StateManager` (it already owns the dir):

- `seedRuntime(defaultsDir)` runs once at boot, **per file**: for each
  `*.yaml` in `state_defaults/<model>/` that does not exist in
  `states/<model>/`, copy it over. Per-file (not per-dir-exists) so a
  default file added later still seeds into an existing runtime cache.
- Existing runtime files are never overwritten at boot — that's the
  cache behavior Sina asked for.
- If neither runtime nor default file exists, the current in-code
  `defaultState` contract applies unchanged (this is today's behavior,
  not a new fallback).
- Anchor `stateDir` to the module dir (`__dirname`-derived), not the
  cwd-relative `patternsDir`, killing the repo-root `/states/` bug.

### 3.3 `config.yaml` becomes truly read-only

Autopilot's `playlist:` block is runtime state and moves to
`states/<model>/autopilot_state.yaml` through `StateManager`. One-time
migration (same precedent as `loadMixerState()`'s channel-split): if
the runtime file is missing but `config.yaml` has a `playlist:` block,
seed from it and log once. `Autopilot` loses its private
`CONFIG_FILE` read/write entirely; `api_server` hands it a load/save
pair like every other subsystem.

### 3.4 Dead-file cleanup

- `git rm marsin_engine/param_center_state.yaml` (stale — see §2).
- `git rm -r states/` at repo root (residue of the cwd bug).

## 4. Promote — "save runtime onto defaults"

**Recommendation: an engine REST endpoint, surfaced as a CaptainPad
Settings button.** Rationale: the engine owns the in-memory truth and
the debounced writers (ParamCenter saves on a 250 ms timer, mixer saves
are deferred). Only the engine can flush pending saves *before*
copying, so the promoted snapshot is never torn. A repo-side script
copying files couldn't guarantee that.

New endpoints in `api_server.js`:

- `GET /state/runtime` → `{ files: [{ name, differsFromDefault }] }` —
  lets CaptainPad show a "runtime differs from defaults" badge.
- `POST /state/promote` → flush all pending debounced saves, then
  atomically copy every `states/<model>/*.yaml` →
  `state_defaults/<model>/` (write-tmp-then-rename, the
  `scheduled_tasks.js` pattern). Returns the list of files that
  changed. Errors fail loudly (P0 rule), nothing half-copied.
- `POST /state/reset` (cheap symmetry, v1-optional) → copy defaults →
  runtime and respond `{ restartRequired: true }`. No live re-apply in
  v1 — honest and simple beats clever.

Promotion deliberately stops at the working tree: the resulting diff
under `state_defaults/` **is** the review artifact. Committing it
stays a human/agent decision per the codex (no auto-git).

Surfacing:

1. **CaptainPad → Settings tab**: "Save current state as show
   defaults" button → `POST /state/promote`, then show the returned
   file list. (Phase 3.)
2. **Headless/CLI**: `node tools/promote_state.mjs` (thin wrapper
   around the endpoint) for SSH'd-into-the-Pi use.

## 5. Touch points

| Where | Change |
|---|---|
| `lib/state_manager.js` | add `seedRuntime`, `promote`, `runtimeStatus`; atomic writes in `save()` (hardening, matches existing atomic writers) |
| `lib/api_server.js:247` | `__dirname`-anchored `stateDir`; call seeding at boot; new `/state/*` routes |
| `engine.js:764,1043,1183` | audio `sceneStateDir`/`scenePath` → same anchored runtime dir |
| `lib/autopilot.js` | drop `CONFIG_FILE`; state via injected load/save (`autopilot_state.yaml`) |
| `.gitignore` | `+ marsin_engine/states/` |
| repo | `git mv states→state_defaults`; rm `param_center_state.yaml`, root `states/` |
| tests | `tests/audio_config_store.test.js`, `tests/hil/*` path references |
| docs/specs | `.agent/00_gol/05` (auto-checks), `07` (runbook), `.agent/01_skills/05_full_stack_smoke.md` + `CLAUDE.md` — replace "expected residue" guidance with "runtime is gitignored"; `docs/15/18/24/25` path mentions |

## 6. Phasing

1. **PR 1 — the split** (core value, no UI): §3 in full + §5 cleanups
   + docs/tests. After this, running the engine never dirties git.
2. **PR 2 — promote**: endpoints + CLI wrapper (§4).
3. **PR 3 — CaptainPad**: Settings button + differs-badge.
4. **Later (separate Notion cards)**: sim save-server files
   (`common.yaml` & friends) with the same defaults/runtime pattern;
   playlists decision (below).

## 7. Open questions for Sina

1. **Playlists** (`simulation/scenes/<scene>/playlists/`): keep
   tracked-and-live-written (they're curated content, like patterns),
   or fold into the runtime+promote scheme? Plan assumes **keep as-is**.
2. **Reset-to-defaults** endpoint in v1, or skip until wanted?
3. **Promote granularity**: whole model in v1 (proposed); per-file
   selection could come with the CaptainPad UI if useful.
4. `simulation/scenes/common.yaml` and the other sim-side saves: same
   treatment as a follow-up, or intentionally leave sim saves tracked
   since they're deliberate design edits?
