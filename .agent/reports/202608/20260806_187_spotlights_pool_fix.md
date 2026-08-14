# _187 — spotlight pool sizing fix: the precedence chain made truthful

**Date:** 2026-08-06 · **Agent:** _187 (Opus implementer) · **Branch:** feat/bm_readiness
**Spec:** `.agent/reports/202608/20260806_186_spotlights_url_precedence.md` (fix spec §1–4)

## What the chain is now

```
scenes/<scene>/scene_config.yaml : parLights.maxSpotlights
        ↓ extractParams()                       (main.js:807)
        ↓ applyBootUrlOverrides(?spotlights=N)  (main.js:812 — URL wins, loud on bad input)
        ↓ initLightPool() allocates exactly params.maxSpotlights SpotLights
        ↓ setupGUI() binds "Max Spotlights" over 1..poolSize
```

One number, one owner, no silent clamps. `?spotlights=` now sits beside `?profile=`,
`?lighting_mode=` and `?renderer=` in the single boot-override module, and the pool is
sized from the *resolved* value rather than from a constant read at module load.

## Changes

### 1. `simulation/src/core/url_overrides.js` — the override moved here (spec §1, fixes D4)
- New `resolveSpotlightsUrlValue(raw)` — pure, exported, unit-testable. Accepts an integer
  literal only (`/^[+-]?\d+$/`, trimmed); returns `{ok, value, requested, capped, reason}`.
- New `?spotlights=` block in `applyBootUrlOverrides()`:
  - invalid (`''`, `abc`, `80px`, `1.5`, `8e1`, **negatives**) → `console.error` refusal,
    the YAML value is kept. Codex P0: no coercion.
  - over cap → clamped to `MAX_SPOTLIGHT_POOL_SIZE`, `console.error` + the existing
    `showSpotlightCapToast()` (the toast text and 8 s behaviour are unchanged).
  - valid → writes **both** `params.maxSpotlights` and
    `configTree.parLights.maxSpotlights.value`, then logs, exactly like the other three
    overrides. **D4 closed.**

### 2. `simulation/src/core/light_pool.js` — pool sized from the resolved value (spec §2, fixes D2/D3)
- Deleted the module-load URL read: `_urlParams`, `DEFAULT_POOL_SIZE = 60`,
  `_requestedPoolSizeRaw`, `REQUESTED_POOL_SIZE`. The module no longer touches
  `window` at import time at all.
- Deleted the `if (_urlParams.has('spotlights')) { params.maxSpotlights = … }` block from
  `initLightPool()` (old `:349-354`) — that authority now lives in `url_overrides.js`.
- New exported `resolveBootPoolSize(value)`: `clamp(floor(value), 0, MAX_SPOTLIGHT_POOL_SIZE)`,
  and **throws `TypeError`** if the value is not a finite *number*. A scene missing
  `parLights.maxSpotlights` now fails loudly instead of silently inheriting a pool of 60
  (all 8 scene YAMLs and `save-server.js`'s `NEW_SCENE_TEMPLATE` declare it — verified).
  `null`/`undefined` are rejected rather than numified to 0, so a missing key cannot
  blackout the analytic rig.
- `initLightPool()` sizes from `params.maxSpotlights` (final by then: extractParams → URL
  overrides → setupLighting → here). `resolveEffectivePoolSize()` now takes the requested
  size as an argument; the GPU/uniform diagnostics and the warning banner are unchanged.
- `showSpotlightCapToast` is exported (called from `url_overrides.js`) and no-ops headless
  (`typeof document === 'undefined'`), matching the guard `showSpotlightCountWarning`
  already had.
- `getRequestedPoolSize()` now returns the value resolved at init; added
  `isPoolInitialized()` and `getSpotlightSliderMax()`.
- `MAX_SPOTLIGHT_POOL_SIZE = 200` **untouched** (spec §3 / operator GPU ruling).

### 3. `simulation/src/gui/gui_builder.js` — the slider stops promising dead travel
`addControl()`'s max for `maxSpotlights` is now `getSpotlightSliderMax()` (= the pool that
exists this session) instead of the hard cap. The YAML `meta.max` is still written as
`MAX_SPOTLIGHT_POOL_SIZE` so the declared capability does not ratchet down into all 8 scene
files on save. Boot ordering (`setupLighting` at `environment.js:204` → `setupGUI` at `:217`)
is unchanged and is now load-bearing for this: the slider is born showing the resolved
value **and** the honest range.

### 4. Docs
`simulation/README.md` (Spotlight Preview Pool Note) and `docs/14_light_optimizations.md`
rewritten to describe the real chain, the refusal behaviour, and the slider range.

## Deviations from the spec (and why)

| Spec said | I did | Why |
|---|---|---|
| "clamp `0..MAX`" for the URL value | over-cap clamps loudly; **negatives are refused**, not floored to 0 | The old `Math.max(0, raw)` turned `?spotlights=-5` into a silently disabled pool. A typo must not blackout the rig — that is the exact silent-fallback shape the codex forbids. `?spotlights=0` still disables, as documented. |
| `Number.parseInt` | strict integer-literal regex first | `parseInt('80px')` is 80. Accepting that is a silent substitution. |
| (not mentioned) | slider max = pool size | Without it D2 simply moves post-boot: a slider ranging to 200 over a pool of 60 still lies. The mission's "slider range honest against pool size" test item. |
| (not mentioned) | `resolveBootPoolSize` throws on a non-number | Spec §2 said "compute poolSize = clamp(...)", which would treat a missing key as 0. Fail loudly instead. |

Spec §3 (persistence) taken as recommended: **kept persist-on-save**, no `transient` flag
added, matching the `lightingMode` / `lightingProfile` precedent. With §2 in place the
persisted value now actually reproduces — that was the whole complaint in D3.

## Operator-visible behaviour change

**Works now that did not before**
- A scene saved with `maxSpotlights: 150` and booted **with no URL param** allocates 150
  SpotLights. Before: pool 60, slider reading 150, per-frame limit silently 60.
- Boot with `?spotlights=200`, save, reload plain → still 200. The save round-trips.
- The `Max Spotlights` slider's range is the pool, so every position it can reach does
  something. Before, everything above the pool length was dead travel.
- `?spotlights=` lands in the config tree as well as `params`, so the GUI, the save path
  and the pool cannot disagree.

**Changed in a way to be aware of**
- `?spotlights=-5` (or `abc`, `80px`, `1.5`) is now **refused with a console error** and the
  scene value is used, instead of quietly becoming 0 / a coerced number.
- To *raise* the budget mid-session you must reboot (`?spotlights=N`, or save the higher
  value and reload). The pool has always been fixed at boot; the slider just stopped
  pretending otherwise.
- A scene_config.yaml missing `parLights.maxSpotlights` now fails the pool init loudly
  (`[LightPool] ❌ FAILED to initialize pool`) rather than defaulting to 60.
- Unchanged: `launcher.js` presets (`spotlights: 0` for edit/dev-lite, `60` for dev) behave
  exactly as before; the 200 cap; the cap toast; the 100/160 warning banner; the per-frame
  clamp of the active limit to the pool length.

## Tests

New: **`simulation/tests/spotlight_pool_budget.test.js`** — 17 tests, offline (no browser,
no ports, no scene writes). It boots the real `light_pool` module against a stub
`scene`/`configTree` (fresh module instance per boot via a cache-busted dynamic import, since
the pool is a one-shot singleton) and asserts:
- pure resolver: integers accepted, whitespace tolerated, `0` accepted, `644` → 200 with
  `capped: true`, and `''`/`abc`/`80px`/`1.5`/`8e1`/`NaN`/`--5`/`-5` all refused with a reason;
- precedence: URL beats saved (params **and** configTree); no URL → saved value survives;
  invalid URL → saved value kept + exactly one `console.error`; over-cap → clamped + loud;
  `?profile=`/`?lighting_mode=` unaffected;
- pool sizing: `resolveBootPoolSize` clamp/floor/throw; **D2 replay** (saved 150 → pool 150,
  active limit 150, slider max 150); URL 644 boot → 200 real SpotLights; `?spotlights=0` →
  pool 0; slider max == pool for saved values 1/37/60/150/200 and every reachable slider
  position is servable;
- **D3 replay**: URL-644 boot → save → plain reboot reproduces the same pool and limit;
- no regression at the shipped titanic value of 60.

**Suite run:** `node --test tests/*.test.js` — **2173 tests, 2165 pass, 7 fail, 1 todo.**
Failing list vs the _177 baseline (5× `bench_section_sync`, `pixel_map_view_defaults:487`,
`scene_data_lint:109` todo):

- ✅ identical on all baseline entries (5× `bench_section_sync`,
  `pixel_map_view_defaults.test.js:487`, `scene_data_lint.test.js:109` todo).
- ⚠️ **one extra failure that is NOT mine:** `bench_mirror_state.test.js:212` — *"_176 §5.3:
  a TEST-CONTEXT write into the REPO's real scenes dir is REFUSED"*. Its last assertion is
  `fs.existsSync(scenes/test_bench/bench_mirror_state.yaml) === false`, but that file is
  **tracked and committed** (commit `9e8b23b8`, the _174–_181 wave, after the _177 baseline
  was taken). So the test fails on a clean checkout regardless of this work; nothing in
  _187 touches `scenes/**` or bench-mirror code. Needs a ruling: either the test's last
  assertion is wrong now, or that YAML should never have been committed.
- `tests/pixel_order*` and the rest of `tests/bench_mirror*` (arm/resolve/reverse/mirror)
  all pass — the gui/config code paths this change shares with them are clean.

Also syntax-checked the three touched source modules with the vendored acorn parser
(browser ESM that Node cannot import wholesale): all OK.

No live processes were started; no operator ports were bound; no git operations were run.
