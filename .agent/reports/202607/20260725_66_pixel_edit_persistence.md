# 2D Pixel Map: the EDIT-tab arrangement now survives a reload, and auto-saves (`_66`)

**Operator bug (verbatim, 2026-07-30):** *"I edited the arrangement in the 2d
pixels and saved all the way but the reload of server ruined them again! Please
fix and make sure the edit tab in the 2d pixels view is working correctly and
auto saves the config so it persists."*

Opus debug + fix agent. **Zero writes to `scenes/**` or `marsin_engine/**`.**
Diagnosed from code + unit tests only — the operator is running lit hardware off
this sim right now, so no browser session, no server start, no save was
attempted. Live verification is his checklist in §7.

---

## 0. TL;DR

**His layout never reached disk. Not once.**

`params.pixelMapViews` — the container that holds every panel, hand-placed
anchor, per-view framing and every EDIT-mode offset — was a params key with **no
YAML wiring at either end**. `src/core/config.js` only ever knew the *retired*
`pixelMap2d` key: `reconstructYAML` never wrote `pixelMapViews` into the config
tree, and `extractParams` never read it back. So:

1. he moved fixtures → `commitViews()` updated `params.pixelMapViews` **in
   memory** and forced a full scene save;
2. the full save serialized the config tree — which has no `pixelMapViews` key —
   and wrote scene_config.yaml, patches.yaml, views.yaml, controllers.yaml,
   common.yaml and the engine model **without his layout**;
3. on reload, `loadViewsFromParams()` found `params.pixelMapViews === undefined`,
   `seedDefaultViews()` seeded the four shipped defaults, and his arrangement was
   gone. No error, no warning, disk and UI both looking healthy.

Reports `_54` and `_55` both state persistence rides "`commitViews()` →
`params.pixelMapViews` → his own Save". That last hop **did not exist**. The
grep is one line long: `pixelMapViews` appears nowhere in `src/core/config.js`,
and nowhere on disk under `simulation/scenes/`.

| | Before | Now |
|---|---|---|
| Where a move is stored | `params.pixelMapViews`, RAM only | `scenes/<scene>/pixel_map_views.yaml` |
| What a full Save writes | everything **except** the layout | unchanged — the layout has its own file |
| What a reload restores | the 4 shipped defaults, every time | exactly what he arranged |
| When it saves | never | **automatically**, ~0.8 s after the edit |
| What an edit-tab move triggers | a **forced full scene save** (over his `autoSave: false`) | one 3 kB sidecar write, nothing else |
| A failed save | silent | error toast + console error |

**Suite 1154 / 1146 / 8** — the same 8 named stale-model failures, **zero new**.
20 new tests.

---

## 1. Root cause, exactly

`simulation/src/core/config.js` is the only place params ↔ scene YAML is
translated. It carries explicit interception for `fixtures`, `dmxLights`,
`traces`, `strands`, `gradientStops`, `groupOverrides`, `ledGroupOverrides` and
the legacy `pixelMap2d` — and **nothing for `pixelMapViews`**, which replaced
`pixelMap2d` in the multiview rehaul. The replacement key was never given the
wiring the key it replaced already had.

Two consequences, both silent:

- **Save side.** `exportConfig()` → `reconstructYAML(configTree)` walks the
  scene tree and updates it from params. `configTree.pixelMapViews` does not
  exist, and `reconstructYAML` only ever *updates* keys that are already in the
  tree — it never creates one. The POST body therefore never contained the
  layout. The save-server had nothing to extract, so "does save-server drop it?"
  was never even reached.
- **Load side.** `extractParams` has no case for it either, so even a
  hand-written `pixelMapViews:` block in scene_config.yaml would have been
  walked by the generic `{ value }` recursion rather than read as data.

The suspects listed in the brief were each checked and cleared: the offsets do
reach `params` (the store is correct), `fixKey` is the fixture **name** and is
stable across reloads, and the boot path does not re-derive over a persisted
layout (`seedDefaultViews` no-ops on a non-empty container, and
`buildPanelsForView` lets persisted placements win over the seed and applies
offsets post-fit). Every one of those was already right. The layout simply never
got to disk to be clobbered.

## 2. The fix: the layout gets its own scene sidecar

**`scenes/<scene>/pixel_map_views.yaml`**, written through a new
`POST /save-pixel-map-views`, parsed at boot in `main.js` exactly like
`views.yaml` / `controllers.yaml` / `patches.yaml`.

Deliberately a sidecar, not a new section of scene_config.yaml:

- **It must be saveable ALONE.** The operator runs `autoSave: false` on purpose.
  The auto-save he asked for has to be able to persist the pixel map without
  dragging fixtures, patches, model exports and engine sidecars to disk behind
  his back. One endpoint, one file. (See §3.)
- **`configTree.views` is already the view REGISTRY.** Putting a second "views"
  concept into the same tree is a name collision waiting to happen; the sidecar
  sidesteps it entirely.
- **It matches the idiom this repo already uses** for every other piece of
  scene-owned data, including the pre-save snapshot + recovery story.

**Boot is fail-loud.** A corrupt `pixel_map_views.yaml` **halts the boot** with
`fatalBootError`, same as `views.yaml`. That is not ceremony: booting past it
would seed the shipped defaults and the map's own auto-save would then write
them straight over his file. A **missing** file stays the legitimate "no layout
saved yet" case and seeds the defaults, as before.

**One writer, by construction.** `config.js` still has no `pixelMapViews`
wiring, and a test pins that it never gets any — two writers for one layout is
how the next silent clobber would arrive.

## 3. The auto-save, and the scoping decision

`commitViews()` — already called on drag-end, arrow-nudge, rotate, every Views-
manager op and (debounced 400 ms upstream) every pan/zoom — now calls
`schedulePixelMapViewsSave()`: an **800 ms debounce** onto the scoped endpoint.
A drag is one write; a five-key nudge burst is one write; the write always sends
the **live** container, not the snapshot that armed the timer. A pending write is
**flushed on `beforeunload` via `sendBeacon`**, so "move it, then immediately
reload" cannot outrun it — the exact race that would otherwise reproduce his bug
in miniature.

**Scoping — and a widening that was already happening, now removed.**
`commitViews()` used to call `window.debounceAutoSave(true)` and
`window._setSceneDirty(true)`. The `true` is a **force**, which bypasses
`params.autoSave` — so panning the 2D map was already triggering full scene
saves against his deliberate `autoSave: false`, saving fixtures, patches, the
model and the engine sidecars, **and still not saving the layout**. Both calls
are gone. The pixel map now writes exactly one file: its own. The scene dirty
chip is no longer raised by a pixel-map edit, because the layout no longer lives
in the scene config — the chip would have been lying.

So: no autosave was widened; one that was silently too wide got narrowed to
what it actually owns. A test scans `commitViews`'s body and the whole
`src/gui/pixel_map/` directory to keep it that way.

**Loud on failure (S4 conventions).** A non-200, an unreachable server, a
missing/garbage views source — each raises
`window.showSaveToast('⚠ PIXEL MAP LAYOUT NOT SAVED — <verbatim reason>', true)`
plus `console.error`, and `window.sacnLog(msg, 'error')` when present. A source
returning a non-`{views:[]}` tree **refuses to write at all** rather than
overwriting a good layout with garbage. On a static host the write is impossible
by construction and says so once (`logStaticHostSkip`) instead of pretending.

## 4. Server side

`POST /save-pixel-map-views?scene=<scene>` takes the JSON `{version, views[]}`
tree and writes it as YAML (hand-readable and hand-editable like every other
sidecar). Order is **validate → snapshot → write**:

- a malformed or truncated body is a **400 that touches nothing** — it must
  never be allowed to overwrite a good layout;
- `snapshotBeforeWrite(scene, filesForPixelMapViews(scene), 'save-pixel-map-views')`
  runs before the write (codex P0), coalescing into the existing burst window;
- `writeFileAtomic` for the write itself.

`filesForSave` also gained the sidecar, so a **full** scene snapshot captures it
too — otherwise "Recover scene" would restore a scene whose pixel-map
arrangement came from a different era.

## 5. Files

Source:
- `simulation/src/gui/pixel_map/pixel_map_persist.js` — **NEW**. The scoped
  persister: endpoint/filename constants, the debounce, the awaitable
  `savePixelMapViewsNow()`, the unload beacon flush, the loud-failure reporting.
- `simulation/src/gui/pixel_map/pixel_map_store.js` — `commitViews()` now
  schedules the scoped save and no longer forces a full scene save;
  `loadViewsFromParams()` installs the live views source.
- `simulation/main.js` — fetches + strictly validates the sidecar at boot,
  loads it into `params.pixelMapViews`, halts the boot on a corrupt file.
- `simulation/src/gui/modern/pixel_map_panel.js` — arms the unload flush at
  init; the Adjust panel's copy now tells the truth ("auto-saved to
  pixel_map_views.yaml", not "use the sim's own Save").
- `simulation/server/save-server.js` — the `/save-pixel-map-views` endpoint.
- `simulation/server/scene_backup.cjs` — `filesForPixelMapViews`, the new
  trigger, and the sidecar added to `filesForSave`.

Tests: `simulation/tests/pixel_map_edit_persistence.test.js` (**NEW**, 20).

## 6. Verification

- **Suite 1154 / 1146 / 8** — the same 8 named stale-model failures, **zero
  new**. (Two other agents were landing tests concurrently; the 8 are the known
  family and none of them touch this chain.)
- `node --check` clean on all 7 touched files; `git diff --check -- simulation`
  clean.
- **20 new tests**: an edited layout round-trips through serialize →
  deserialize with identical offsets and framing, and a second round-trip is a
  fixed point; it survives the **exact YAML dump/load the sidecar uses**;
  fixKeys containing colons, quotes, `~` and `#` round-trip verbatim; seeding
  the shipped defaults never clobbers a persisted layout; a persisted view that
  shadows a shipped default id keeps ITS values; the seed guard fires only on an
  empty container; a 5-edit burst coalesces into exactly one write; the
  debounced write sends the LATEST layout; a 500 is loud (error toast, `ok:false`
  with a verbatim reason); a broken views source writes nothing; the unload
  beacon carries the same body and disarms the debounce; `commitViews` calls the
  scoped save and **neither** `debounceAutoSave` **nor** `_setSceneDirty`; no
  file in `src/gui/pixel_map/` reaches for the full-scene save at all; client and
  server agree on endpoint + filename + validate-then-snapshot-then-write; boot
  fetches, validates and loads the sidecar and halts on a corrupt one; the panel
  arms the flush; `config.js` still has no `pixelMapViews` wiring; the sidecar is
  in both snapshot sets and a scoped write leaves a recoverable copy.
- **Zero live checks** — LIVE-MAPPING LOCKDOWN. No browser session, no server
  start, no HTTP to any device, no scene write. The newest `scenes/titanic/*`
  mtime is still his own.

## 7. Operator live-verification checklist

The one thing this could not prove without touching his running rig:

1. **Restart the sim server** (`cd simulation && npm start`) so the new
   `/save-pixel-map-views` endpoint exists — the browser reload alone is not
   enough for this one.
2. Reload the sim, open the Pixel Map, switch to **EDIT**.
3. Move a fixture (drag, or right-click a group and drag). **Wait ~1 second.**
4. Confirm `simulation/scenes/titanic/pixel_map_views.yaml` now exists and
   contains an `offsets:` block for the fixture you moved. The save-server
   console prints `✅ Wrote …/pixel_map_views.yaml (N view(s))`.
5. **Reload the page** — the fixture is where you left it. No Save needed.
6. **Restart the server and reload** — still where you left it.
7. Pan/zoom a view, wait a second, reload — the framing is kept too.
8. Sanity check on the scoping: an edit-tab move should **not** raise the
   `● UNSAVED CHANGES` chip and should **not** rewrite `scene_config.yaml`
   (its mtime stays put). That is the fix for a second bug found on the way —
   the map was force-saving your whole scene despite `autoSave: false`.

If anything fails, it will now **say so**: a red toast reading
`⚠ PIXEL MAP LAYOUT NOT SAVED — <reason>`. That is the whole point.

## 8. One adjacent gap, deliberately not fixed here

A **group rename** rewrites the pixel map's `{group: '<name>'}` selectors in
memory (`renameGroupInPixelMapViews`), but by design does not save — the
rename's caller in `gui_builder.js` owns that decision, and a wiring test pins
it (a probe harness with auto-save stubbed must stay a no-write). Before this
change that made no difference, because nothing persisted at all. Now it does:
after a rename, the sidecar keeps the old group name until the next pixel-map
edit, and a reload in between shows that panel's loud zero-match banner. Loud,
not silent — so it is a follow-up, not part of this repair, and it lives in
`gui_builder.js`'s rename path, which another agent is touching.
