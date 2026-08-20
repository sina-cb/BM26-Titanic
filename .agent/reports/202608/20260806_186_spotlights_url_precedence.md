# _186 — `?spotlights=` URL param vs "Max Spotlights" UI: precedence audit

**Date:** 2026-08-06 · **Agent:** _186 (Fable debug, read-only) · **Branch:** feat/bm_readiness
**Question:** with `?scene=titanic&lighting_mode=sacn_in&profile=full&spotlights=644`, how do the
URL param and the Lighting panel's "Max Spotlights" slider relate, and which wins?
**Operator expectation:** the URL param must be authoritative over the UI/saved value.

## Verdict

**URL is authoritative at boot — with one big asterisk: 644 is out of range and is
loudly clamped to 200.** The `?spotlights=` value overrides the saved scene value and is
what the UI slider shows after boot; a later slider move is a deliberate operator act and
behaves sanely. Two real deviations exist around the edges (pool sizing ignores the saved
value when the URL param is absent, and the URL-session value persists into the scene on
save but does not round-trip truthfully). Details + fix spec below.

## The two knobs are different things

- **`?spotlights=N`** sizes the **pre-allocated SpotLight pool** (how many THREE.SpotLights
  exist). Parsed at module load: `simulation/src/core/light_pool.js:18` (`_urlParams`),
  `:36-39` (`REQUESTED_POOL_SIZE`, default 60 when absent, negative → 0).
- **`Max Spotlights` slider** (`params.maxSpotlights`) is the **per-frame active limit** —
  how many pooled lights may be lit at once, clamped to the pool length:
  `light_pool.js:251-255` (`getSafeActiveSpotlightLimit`).
- `profile=full` does **not** carry a spotlight budget — it only selects
  `analyticLightMode` (whether the pool is used at all). No count interaction
  (`src/core/profile_registry.js`).

## Boot precedence chain (verified order)

1. `main.js:807` `extractParams()` — scene YAML → `params.maxSpotlights = 60`
   (`scenes/titanic/scene_config.yaml:73-78`).
2. `main.js:812` `applyBootUrlOverrides()` — handles **only** `profile`, `lighting_mode`,
   `renderer` (`src/core/url_overrides.js:35-88`). `spotlights` is NOT handled here.
3. `environment.js:204` `setupLighting()` → `:280` `initLightPool()`:
   - pool size = `min(REQUESTED_POOL_SIZE, MAX_SPOTLIGHT_POOL_SIZE=200)`
     (`light_pool.js:20`, `:169-230` `resolveEffectivePoolSize`, `:172`). For 644 → **200**.
   - **URL override of the slider value:** if `?spotlights` present,
     `params.maxSpotlights = effectivePoolSize` (`light_pool.js:349-350`) — this is the
     line that makes the URL win over the saved 60.
   - Out-of-range is **loud**: cap toast (`light_pool.js:44-65`, fired `:351-353`,
     "spotlights=644 exceeds the preview pool cap (200). Using 200.") + console line
     `:365` + the persistent GPU-threshold banner (200 > critical 160, `:123-130`).
4. `environment.js:217` `setupGUI()` — runs AFTER the override. The slider binds the live
   `params` object (`gui_builder.js:1559-1562`), so it **displays 200**, range 1..200
   (`gui_builder.js:1537-1546`). GUI shows the truth.

So for the operator's exact URL: pool = 200 SpotLights, active limit = 200, slider shows
200, saved scene value 60 is overridden. **URL wins at boot.** 644 itself is unreachable —
`MAX_SPOTLIGHT_POOL_SIZE = 200` is a deliberate GPU-safety cap (WebGPU/Mac scenes go
white/black above ~160; `light_pool.js:26-35`, README.md:155-159 documents the clamp).

## After boot: moving the slider

Slider move → `params.maxSpotlights` changes → per-frame limit re-clamped to pool length
(`light_pool.js:252-255`) + threshold banner re-evaluated (`gui_builder.js:1580-1588`).
It does NOT resize the pool (pool is fixed at boot). With `?spotlights=644` the pool is
200, so the whole 1..200 slider range is honored. This is well-defined and operator-owned:
the URL sets the session value, the UI shows it and can still be moved deliberately. ✔

## Deviations found

### D1 — clamp, not honor: 644 → 200 (expected, but know it)
Not a bug — the cap is loud (toast + console) and documented. But the operator should know
`spotlights=644` can never mean 644 without raising `MAX_SPOTLIGHT_POOL_SIZE`
(`light_pool.js:20`), which is a GPU-risk decision (WebGPU only; WebGL fragment-uniform
budget tops out far lower, see `:200-210`).

### D2 — without the URL param, the saved/UI value above 60 is silently ineffective
`REQUESTED_POOL_SIZE` defaults to `DEFAULT_POOL_SIZE = 60` when `?spotlights` is absent
(`light_pool.js:19,36`), so the pool is 60 **regardless of the saved
`maxSpotlights`**. A scene saved with `maxSpotlights: 150`, booted without the URL param,
shows a slider at 150 (range 1..200) while the effective limit is silently clamped to 60
(`:254`). Silent ineffectiveness — violates the no-silent-fallback spirit.

### D3 — the URL-session value persists into the scene on save, then doesn't round-trip
`maxSpotlights` has no `transient` flag in any scene YAML, so every save runs
`entry.value = params[key]` (`src/core/config.js:320-321` via `reconstructYAML`, called
from `exportConfig` at `gui_builder.js:567`). Booting with `spotlights=644` and then
saving (explicit 💾, or autosave if `autoSave` — default false, `common.yaml:216-218`)
writes `maxSpotlights: 200` into `scenes/titanic/scene_config.yaml`.
**Repo precedent says persist-on-save is the intended semantic** — `lightingMode` is
explicitly `transient: false` (`common.yaml:174`) and `lightingProfile`/`rendererMode`
persist the URL override the same way. The spotlights inconsistency is that, per D2, the
persisted 200 is then silently squashed to 60 on the next plain boot — the save lies.

### D4 — minor: light_pool updates `params` but not `configTree`
`light_pool.js:350` sets only `params.maxSpotlights`; `url_overrides.js` sets both for its
params. Harmless today (GUI binds `params`; `reconstructYAML` copies from `params`), but it
diverges from the established override pattern.

## Fix spec (for an Opus implementer)

Goal: URL wins at boot (already true), saved value truthful without the URL, one
authority module, precedent-consistent persistence.

1. **Centralize the override** — add `spotlights` handling to `applyBootUrlOverrides()`
   (`src/core/url_overrides.js`): parse int, reject non-finite loudly (console.error, keep
   YAML value — codex P0 shape already used there), clamp `0..MAX_SPOTLIGHT_POOL_SIZE`
   with the existing cap toast semantics, write **both** `params.maxSpotlights` and
   `configTree.parLights.maxSpotlights.value`. Import the cap constant from
   `light_pool.js` (it is already exported). Delete the `params.maxSpotlights = ...` block
   from `initLightPool` (`light_pool.js:349-354`); keep the toast helper, called from the
   override path or at init by comparing requested vs applied.
2. **Size the pool from the resolved boot value, not from a module-load constant** — in
   `initLightPool()` compute `poolSize = clamp(Math.floor(params.maxSpotlights), 0,
   MAX_SPOTLIGHT_POOL_SIZE)` (params is final by then: extractParams → url overrides →
   setupLighting). Drop `DEFAULT_POOL_SIZE`/`REQUESTED_POOL_SIZE` module constants (or
   keep `REQUESTED` purely for the log line). This fixes D2 (saved 150 → pool 150) and
   makes D3's persisted value round-trip truthfully (`?spotlights=0` still disables the
   pool: params becomes 0 via the override). Note the slider min is 1 (`gui_builder.js:1539`)
   — the 0-disable path stays URL-only, which matches README.md:159.
3. **Persistence: keep it** (recommended) — matching `lightingMode`/`lightingProfile`
   precedent: URL sets the session, save means "keep what I'm running". With fix 2 the
   saved value actually reproduces. If the operator instead wants URL sessions to never
   touch the scene file, the mechanism already exists: add `transient: true` to
   `maxSpotlights` in the 8 scene YAMLs + `NEW_SCENE_TEMPLATE` in
   `simulation/server/save-server.js:185` — but that would also stop *slider* moves from
   persisting, so it is the operator's call, not the implementer's.
4. **Tests** — extend the url_overrides/light_pool coverage: (a) URL present beats YAML;
   (b) URL absent → pool honors saved value up to cap; (c) 644 clamps to 200 loudly;
   (d) round-trip: save after URL boot then plain boot reproduces the same active limit.

No source files were modified by this investigation.
