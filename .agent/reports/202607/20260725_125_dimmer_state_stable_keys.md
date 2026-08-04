# 20260725_125 — Dimmer state: stable group-name keys + forward migration

**Agent:** developer (engine) · **Branch:** feat/bm_readiness · **Status:** done, not committed (no git ops per brief)

Fixes the live-stack finding from `20260725_122` (addendum): persisted
per-group dimmer brightness was keyed by **numeric section id**, and the
titanic model's section ids moved (486-498 → 500-513), orphaning every
saved wall/stack/rail value — CaptainPad's Dimmer Rack fell back to the
`?? 1.0` default.

## 1. Root cause of the divergence (investigated, not an error to fix)

Section ids are minted **operator-side, in the simulation**, and the model
files are generated from the scene:

- `simulation/src/dmx/controller_registry.js` (§"Metadata: sectionId per
  group", ~:2339-2424) assigns `sectionId` per fixture **group**: existing
  positive ids are kept; a group with no id gets **`maxSectionId + 1`**,
  where the floor is the max over the whole DMX ∪ LED union (plus a
  one-time collision-repair pass that also mints `max+1` ids).
- `simulation/src/dmx/pixelblaze_model_exporter.js` then writes each
  pixel's `sId` into `marsin_engine/models/<scene>.js` ("Auto-generated
  Pixelblaze model — do not edit manually").

So any scene rework that clears/recreates fixture patch configs (fixture
re-adds, group renames, registry repair passes) re-mints ids above the
previous max, and the next export ships them. That is exactly what
happened: the operator regenerated the titanic scene (checked-in
`titanic.js` is now `Updated: 2026-08-03T20:32Z` and carries sIds
{3, 18-25, 415, 500-513}), while `states/titanic/globals_state.yaml`
still held brightness under keys {1-18, 189, 486-498}. Scenes/models are
operator-owned; ids are **expected churn**. Group **names** are the
stable identity — they are what the operator authors and what the whole
Dimmer Rack UI is organized around (and `groupFixedColors` was already
name-keyed, which set the precedent).

## 2. Fix — persist by group name, translate at the wire

Persisted `globalsState.dimmers` is now keyed by **stable group name**.
The HTTP wire format is **unchanged** (CaptainPad untouched, 0 files):

| Surface | Before | After |
|---|---|---|
| `globals_state.yaml → dimmers` | `{ "486": 0.13 }` | `{ "Left Wall": 0.13 }` (+ orphans preserved as-is) |
| `GET /dimmer-groups` | `{ group: sId }` | unchanged (now via shared `modelDimmerGroups()`) |
| `GET /dimmers` | `{ sId: v }` from state verbatim | `{ sId: v }` — names resolved to the **current** model's ids; unresolvable orphan keys pass through verbatim |
| `POST /section-brightness` | accepted ANY id, persisted under it | id resolved to its owning group, persisted under the name; **unknown id → 400 loudly** (codex P0 — an unmappable key could never be read back). Response gains an additive `group` field |

### Changed files

- `marsin_engine/lib/state_manager.js`
  - new `migrateDimmersToGroupKeys(globalsState, groupToSectionId)` —
    the one-time forward migration (details below);
  - `applyGlobalsState(...)` gains an optional 5th param
    `groupToSectionId`: name keys resolve to the CURRENT model's section
    id; **numeric keys still apply verbatim** (pre-fix behaviour — keeps
    old id-keyed snapshots restoring exactly as before, and is inert when
    no pixel carries the id); an unresolvable *name* key warns and is
    skipped, never guessed.
- `marsin_engine/lib/api_server.js`
  - `modelDimmerGroups()` — the single `{ group: sId }` translation table
    (same first-pixel-per-group map `/dimmer-groups` always served);
  - migration invoked immediately after `loadGlobalsState()` at boot;
  - both `applyGlobalsState` call sites (boot + performance-mode restore)
    pass the map;
  - `/dimmers` + `/section-brightness` endpoints translated as above.

### Migration design (`migrateDimmersToGroupKeys`)

Runs at engine load, in memory, against the loaded model's group map —
mutates `globalsState.dimmers`; the migrated shape reaches disk on the
**next globals save** (same precedent as the legacy `hueShift` discard in
`loadGlobalsState`; no forced write, so the auto-save gate stays honored).
Idempotent. Rules — loud, never lossy:

- numeric key whose id maps to a current group → rewritten to the name;
- numeric key duplicating an existing name key (half-migrated file) →
  name-keyed value wins (newer format), duplicate dropped **with a
  warning**;
- numeric key mapping to NO current group → **orphan**: one clear
  `console.warn` lists every orphaned key, values preserved in the file
  untouched (never deleted, never silently defaulted);
- name key unknown to the current model (group renamed/removed) → same
  loud-warn + preserve treatment.

**Operator note:** the pre-existing orphans (1-2, 4-17, 189, 486-498 in
the live titanic file) stay orphaned — the id→group mapping for the OLD
model generation is not in the current model, so they cannot be migrated
automatically. They are preserved on disk and named in the boot warning.
If the old values matter, git history has the pre-regeneration
`titanic.js` (ids 486-498 with their groups), so a hand-recovery is
possible; from this fix forward the problem cannot recur.

## 3. Other section-id-keyed persisted state (follow-ups, NOT fixed here)

- **`viewSelection.target`** — `deck_state.yaml`, `mixer_state.yaml`,
  snapshots (and any playlist entries carrying a view selection) persist
  `{ type: 'section' | 'fixture' | 'viewMask', target: <numeric id> }`
  (`lib/pattern_channel.js:199-208`). A renumbering silently re-aims a
  section/fixture-scoped channel at the wrong (or no) pixels. Same
  stable-name treatment would apply.
- **Snapshots** (`states/<scene>/snapshots/*.yaml`) — `globals.dimmers`
  captured pre-fix are id-keyed. Restore still behaves exactly as before
  (numeric path in `applyGlobalsState`); post-fix captures are name-keyed
  automatically since they deep-clone live `globalsState`. Old snapshots
  could be migrated with the same helper if ever needed.
- `audio_state.yaml` / `mixer_state.yaml` otherwise: no section-id keys
  found.

## 4. Test evidence

New suite `marsin_engine/tests/state/dimmer_state_stable_keys.test.js`
(pure StateManager + fake IntensityController, tmp dirs — no engine
spawn, no network): **7/7 pass**

1. legacy id-keyed file migrates to name keys on load;
2. migration idempotent;
3. renumbered model keeps values by name across save/load (fake model
   gen A ids {3,486,487} → gen B ids {3,500,501}; brightness lands on
   the NEW ids);
4. orphaned ids warn loudly (warning text asserted to name the keys) and
   survive the save round-trip byte-identical;
5. half-migrated duplicate: name key wins, drop is loud;
6. legacy numeric keys apply verbatim through `applyGlobalsState` (old
   snapshot compatibility);
7. unknown group name warns + skips, never guessed.

Black-holed live-engine e2e (scratchpad script, per the timeline-e2e
three-wall pattern: `controllers: []` + `sacn.destinations: [127.0.0.9]`
via `MARSIN_CONFIG_FILE`, temp `MARSIN_STATE_DIR`/`_PLAYLISTS_DIR`/
`_TIMELINE_DIR`, osc/audio/web_client off; walls ASSERTED from `/status`
before any check) against the **real titanic model** with a fixture copy
of the operator's legacy dimmers `{3, 18, 189, 486, 487}`:

- boot log: `2 entries rewritten` + orphan warning naming `[189, 486, 487]`;
- `GET /dimmers` → values under current ids 3/18, orphans verbatim;
- `POST /section-brightness` for a 500+ id → 200, persisted under the
  group's name; id 99999 → 400 with the loud error;
- on-disk file after save: `TE Sign`/`Left_Front_Left`/`Right Front Wall`
  name keys + orphans `189/486/487` byte-identical. **E2E PASS.**

Gates: `node --check` on both edited files pass · `git diff --check --
marsin_engine marsin_pb` pass · `engine.js --list` pass ·
`--dry-run` pass (no missing-blend warnings) · full engine suite:
**2534 tests / 2526 pass / 8 fail** — the 8 are exactly the known
environmental families (audio_capture no-device ×5, effects_v2 layout,
OSC EADDRINUSE from the operator's live stack holding :10000,
specialty_white_uv playlist drift from live-captured defaults). **Zero
new failures**; the +7 vs the prior count are this thread's new tests,
all passing.

Operator's live `states/titanic/` files untouched (his engine was
running + writing them throughout; all testing used fixture copies in
black-holed temp dirs). CaptainPad untouched → vitest not required.
