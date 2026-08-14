# _189 — over-cap `?spotlights=`: ask the operator, raise the cap for one session

**Date:** 2026-08-06 · **Agent:** _189 (Opus implementer) · **Branch:** feat/bm_readiness
**Builds on:** `20260806_186_spotlights_url_precedence.md` (audit) and
`20260806_187_spotlights_pool_fix.md` (the landed chain)

**Operator ask:** "For the spotlight, if the URL is above the max cap, ask the user to
accept it or not, and when they do, raise the cap temporarily for that session."

## The flow

```
?spotlights=N
  ├─ not an integer / negative        → refused loudly, scene value kept        (unchanged)
  ├─ N > 2000 (absolute ceiling)      → refused loudly, NO prompt               (new)
  ├─ N ≤ 200 (hard cap)               → applied, NO prompt                      (unchanged)
  └─ 200 < N ≤ 2000                   → BLOCKING confirm at boot                (new)
        ├─ accept  → session ceiling raised to N; pool = N; slider 1..N;
        │            slider labelled "⚠ Max Spotlights (session N)";
        │            console.warn; NOT saved, NOT remembered
        └─ decline / dismissed / no dialog / prompt threw / non-boolean answer
                   → exactly the old behaviour: clamp to 200, console.error + cap toast
```

The gate sits inside `applyBootUrlOverrides()` (`main.js:812`), which runs immediately
after `extractParams()` and well before `setupLighting()` → `initLightPool()`. So the
answer is known **before a single `THREE.SpotLight` is allocated** — no unwinding, no
resize, no second pass.

**Why a native `confirm()`.** The repo has two dialog idioms: `scene_manager.js`'s themed
`showModal()` and the native `confirm()` (used in ~9 places in `gui_builder.js`). The
themed one is Promise-based and its overlay is built by the GUI layer, which does not
exist at `main.js:812`; making the gate async would force `applyBootUrlOverrides` to be
awaited from `main.js` and would let boot run past it. A blocking native `confirm()` is
the only thing that can gate a synchronous boot step here. This is recorded in the
function's own docstring so the next reader doesn't "fix" it.

**Injection seam.** `applyBootUrlOverrides(urlParams, { confirmSpotlightOverCap })`.
Production passes nothing and gets `defaultSpotlightOverCapConfirm` (the real dialog);
tests pass a spy. `buildSpotlightOverCapPrompt(requested)` is exported so the wording the
operator consents to is pinned by a test.

**Decline is the default on every ambiguity.** Non-boolean answer, a prompt that throws,
or no `confirm()` in this context (headless render tools, a stripped embed) → decline,
with a console.error saying so. There is no timeout that accepts, no remembered answer,
no `localStorage`. Only a literal `true` raises the cap.

## The persistence decision

**Chosen: clamp at the persistence boundary to the hard cap.** (The mission allowed either
this or "persist the pre-raise saved value".)

_187 deliberately kept persist-on-save for `maxSpotlights`, matching the
`lightingMode` / `lightingProfile` precedent: `reconstructYAML()` copies
`params.maxSpotlights` straight into the config-tree entry on every save
(`src/core/config.js:320`). Since the raised session *must* hold its value in
`params` (both the per-frame active limit and the GUI slider bind it), the raise would
ride that copy into `scene_config.yaml` and come back on the next boot with nobody asked.

New `clampPersistedSpotlightBudget(configTree)` in `light_pool.js` clamps the tree entry
back to `MAX_SPOTLIGHT_POOL_SIZE` and warns. It is called immediately after **both**
`reconstructYAML(configTree)` sites in `gui_builder.js` — `exportConfig()` (explicit 💾
*and* auto-save, which goes through the same function) and `flushPendingSaveBeacon()`
(the unload beacon). Both are before anything serializes the tree.

Why clamp rather than restore the pre-raise value: the pre-raise number is not recoverable
at save time without extra bookkeeping that would itself have to survive slider moves, and
the clamp states a stronger invariant that holds regardless of provenance — **no scene
file may ever declare more SpotLights than the GPU-safe cap**, hand-edited YAML included.
Slider positions inside `1..200` persist exactly as before; only the over-cap part is
dropped. The live session is untouched by a save: it keeps running the N it was granted.

**Where the session state lives:** `params.__spotlightSessionCeiling`, not the config
tree, not a module variable. The config tree is what gets serialized (it would persist);
a module variable is invisible to the per-boot module instances the tests create. `params`
is the one object every boot step shares, and `reconstructYAML` walks the config *tree*,
not `params`, so this key cannot reach a file. `__`-prefixed for the same reason
`undo.js` uses `__controllerRegistrySnapshot`. `applyBootUrlOverrides()` deletes it at the
top of every call, so a boot always starts at the hard cap.

## The sanity ceiling: `SPOTLIGHT_ABSOLUTE_CEILING = 2000`

Above it, `?spotlights=N` is refused loudly with **no prompt** — there is nothing to
consent to. Justification (in the constant's comment too):

- A pooled SpotLight costs ~`GPU_SAFE_VECTORS_PER_SPOTLIGHT` = 16 fragment-uniform
  vectors. 2000 lights want ~32,000 — roughly an order of magnitude past any real GPU's
  fragment-uniform budget.
- It is ~12× `SPOTLIGHT_WARN_CRITICAL_COUNT` (160), the count where Mac WebGPU already
  renders the scene solid white or black. Nothing in 200..2000 is *safe*; 2000 is simply
  the line past which a number cannot be a budget at all.
- It still allocates only a few thousand small JS objects, so a typo that somehow got
  accepted wedges a tab rather than OOM-ing the browser or hanging it for minutes.
- `?spotlights=999999` — the shape the mission named — lands far above it and is refused.

Raising it is an operator ruling, and a test asserts the number so a silent bump can't
happen.

## Files touched

| File | Change |
|---|---|
| `simulation/src/core/light_pool.js` | `SPOTLIGHT_ABSOLUTE_CEILING`; session-ceiling accessors (`clear` / `raise` / `get` / `isRaised`, all bounds-checked, `RangeError` on garbage); `clampPersistedSpotlightBudget()`; `resolveBootPoolSize()` and `resolveEffectivePoolSize()` now clamp to the **session** ceiling; `getSpotlightSliderMax()` pre-init returns it too; the critical GPU banner gains an "accepted over-cap budget … not saved" sentence |
| `simulation/src/core/url_overrides.js` | resolver's third outcome (`needsConfirm`, with `value` carrying the *decline*); `buildSpotlightOverCapPrompt()`; `defaultSpotlightOverCapConfirm()`; `askSpotlightOverCap()` (throw / non-boolean → decline); `deps.confirmSpotlightOverCap` seam; the accept / decline branches |
| `simulation/src/gui/gui_builder.js` | `clampPersistedSpotlightBudget()` after both `reconstructYAML()` sites; the over-cap slider label + tooltip (the shared `controlLabel` is byte-identical to `meta.label \|\| key` for every other control) |
| `simulation/tests/spotlight_pool_budget.test.js` | 17 → 33 tests |
| `simulation/README.md`, `docs/14_light_optimizations.md` | the prompt, the session scope, the ceiling |

`environment.js` needed no change — the boot order `applyBootUrlOverrides` →
`setupLighting` → `initLightPool` → `setupGUI` already puts the gate ahead of allocation.

## Tests

`simulation/tests/spotlight_pool_budget.test.js` — **33 tests, all pass** (17 kept, 16
new). One existing test changed: the `?spotlights=644` clamp test now injects an explicit
declining stub (it used to rely on there being no prompt at all).

New coverage: the resolver's third outcome; `needsConfirm` never set at `0/1/60/199/200`;
`2000` askable, `2001` and `999999` refused; the prompt wording (count, cap, GPU risk,
"THIS SESSION ONLY", "next boot asks again"); **accept** → params + tree + ceiling + one
`console.warn` and zero errors, and a real 260-SpotLight pool with slider max 260;
**decline** → 200, no raise; every not-a-yes shape (`undefined`, `null`, `0`, `''`,
`'yes'`, `1`, a throwing prompt) → 200; no-dialog default → decline + loud;
`raiseSpotlightSessionCeiling` rejects `200 / 0 / -1 / 2001 / 250.5 / '250' / null /
undefined / NaN`; **save clamps** to 200 while the live session keeps 400; the clamp is a
no-op below the cap and loud above it; **round-trip** accept → save → plain reboot = pool
200, ceiling cleared, nobody prompted; a hand-edited scene value of 500 clamps and never
prompts; three over-cap boots = three prompts.

**Full suite:** `node --test tests/*.test.js` → **2189 tests, 2181 pass, 7 fail, 1 todo.**
The 7 failures are exactly the known baseline, all pre-existing and untouched by this work:
`bench_section_sync.test.js` ×5 (`:119 :221 :271 :451 :460`),
`pixel_map_view_defaults.test.js:487`, `bench_mirror_state.test.js:212` (the tracked
`scenes/test_bench/bench_mirror_state.yaml` that _187 flagged as needing an operator
ruling). The 1 todo is `scene_data_lint.test.js:109` (`summer_camp_dome/patches.yaml.original`
residue, operator-owned).

Also acorn-parsed the three touched browser modules (Node cannot import them wholesale):
all OK. No live processes were started, no operator ports bound, no git operations run,
nothing written under `scenes/**`.

## What the operator should try after a refresh

1. **The ask.** Boot `?scene=titanic&profile=full&spotlights=644`. A confirm appears
   before anything renders: *"URL requests 644 spotlights, above the safe cap of 200 …
   Accept 644 for THIS SESSION ONLY?"*
   - **Cancel** → 200, the red cap toast, exactly as today.
   - **OK** → the console logs `over-cap ?spotlights=644 ACCEPTED …`, the light census
     reports 644 pooled SpotLights, and the Lighting panel slider reads
     `⚠ Max Spotlights (session 644)` ranging 1..644. Expect the GPU risk it warned
     about — that is the point of asking.
2. **It does not stick.** With that session running, hit 💾. Then reload **without** the
   URL param: the pool is back to 200 (or whatever the scene had ≤ 200), the ⚠ label is
   gone, and `scene_config.yaml` shows at most `maxSpotlights: 200`. Reload **with**
   `?spotlights=644` again → it asks again. Every time.
3. **Typos still bounce.** `?spotlights=999999` → no dialog, one console.error
   (*"above the absolute ceiling (2000)"*), scene value kept. `?spotlights=-5`,
   `=abc`, `=80px` → refused as before.
4. **Nothing changed below the cap.** `?spotlights=100`, `?spotlights=200`, and plain
   boots never prompt.
