# inView("Name") compile-time membership intrinsic

**Date:** 2026-06-19
**Author:** developer agent (requested by Sina; coordinator-dispatched)
**Branch:** `dev/claude/views_rehaul` (committed, NOT pushed)
**Scope:** IMPLEMENTATION. Add an `inView("ViewName")` convenience that
patterns call to test membership of a named in-VM view, resolved at COMPILE
TIME by the existing name→id injector substrate — NO firmware change (works
at the JS injector layer that rewrites pattern source before compile).
**Firmware:** unchanged (vendored Tier-C WASM, ABI `20260619_1`). Builds on
the named-masks (`20260618_2`) + Tier-C host integration (`20260619_4`) +
auto-views (`20260619_5`) work.

---

## TL;DR

- New module `marsin_engine/lib/in_view_intrinsic.js` —
  `injectInViewIntrinsic(source, viewTable, promote?)` folds every
  `inView("Name")` call to its exact bitwise membership test at compile time,
  plus `createBitFreeViewPromoter(model, host)` for on-demand bit allocation.
- Wired into `WasmHost.compile` (runs FIRST, before the MASK_*/FIX_*
  injectors) and into `engine.js` (boot + hot-reload) which builds the
  per-model `viewTable` and the promoter.
- A small example `patterns/examples/inview_demo.js` and 19 new tests
  (all green); the full engine suite is **898/898**, sim **118/118**.

---

## The fold

`inView("Name")` resolves the AUTHORED view name (the same string the Views
panel / `/model/view-selection-options` use — NOT the sanitized `MASK_*`
identifier) to its allocated in-VM `{bit, word}` and folds to:

| View word | Fold |
|---|---|
| low word (word 0) | `inView("X")` → `((viewMask & <bit>) != 0)` |
| high word (word 1) | `inView("X")` → `((viewMaskHi & <inlined single-bit literal>) != 0)` |

The high-word mask is emitted as an INLINED bare-number LITERAL (e.g.
`(viewMaskHi & 1073741824)`), NEVER a `var` — the Tier-C firmware single-bit
guard (ABI `20260619_1` §0, §5) rejects a runtime (`var`) mask on
`viewMaskHi`. This mirrors the `name_id_registry` inline-injection
discipline. The match is whole-token (`\binView\b`) and supports both `"`
and `'` quotes and names with spaces / the `@` typed-view prefix.

## Low vs high word routing

The host holds a `viewTable` = AUTHORED-name → `{bit, word}` built in
`engine.js loadModel` from `groupBits` (every base group, word 0) + every
`viewMasks` entry (its own `bit`/`word`). At fold time the intrinsic reads
`word`: word 1 → `viewMaskHi` + inlined literal; word 0 → `viewMask` + bit.
Proven end-to-end: a high-word view selects EXACTLY its pixels with zero
leak through the vendored WASM (the inlined-literal path).

## Bit-free (Tier-A) views — ON-DEMAND ALLOCATION (preferred path)

A Tier-A auto-view (`bit:0`, e.g. `PORT`, `@BAR`, `BAND_LOW`) has per-pixel
host-side membership but no in-VM bit, so it cannot be tested by a raw bit
in the VM. Rather than error out, `inView` PROMOTES it on demand (the
preferred option — Tier-C's second word gives headroom):

`createBitFreeViewPromoter(model, host)` owns a two-word `ViewBitAllocator`
seeded with every bit already in use (group bits + bit-backed presets, per
word). On the first `inView` of a bit-free view it:
1. allocates the lowest free `(word, bit)` from the 62-bit budget (word 0
   before word 1; exhaustion throws LOUDLY — codex P0),
2. SETS that bit on the view's member pixels (by `groups[]` or
   `pixelIndices[]`) in both `vMask`/`vMaskHi` and the mirrored `viewMask`,
3. pins `bit`/`word` on the view entry (a repeat `inView` reuses it),
4. raises `host.metaDirty` so the meta buffer is re-packed before render.

Ordering makes this sound: the boot pattern compiles BEFORE `setPixelMeta`,
so the boot pack naturally carries the promoted bit. For later compiles
(mixer channels, live edits) the render loop's `tick()` calls
`repackMetaIfDirty()` — a cheap flag check, a no-op when nothing promoted —
to re-pack before the next frame. Hot-reload re-seeds the promoter and
re-packs against the reloaded model.

**No silent fallback anywhere (codex P0):** an unknown view name is a loud
compile error listing the known views (exactly like the MASK_* unknown-name
path); a bit-free view with NO promoter wired is a loud compile error; a
promoter returning an invalid `{bit, word}` is rejected. `inView` NEVER
folds to a constant true/false.

## Files changed

| File | Change |
|---|---|
| `marsin_engine/lib/in_view_intrinsic.js` (new) | The fold + `createBitFreeViewPromoter` |
| `marsin_engine/lib/wasm_host.js` | `setViewTable` / `setBitFreeViewPromoter` / `metaDirty`; `compile` folds `inView` first |
| `marsin_engine/engine.js` | Build `viewTable`; wire promoter (boot + hot-reload); `buildMetaArray`/`repackMetaIfDirty` helpers; `tick()` re-pack guard |
| `marsin_engine/patterns/examples/inview_demo.js` (new) | Example `if (inView("PORT")) …` (NOT in the manifest — an example, not a playlist pattern) |
| `marsin_engine/tests/in_view_intrinsic.test.js` (new) | 19 unit + e2e tests |

I did NOT touch `lib/auto_views.js`'s view definitions, the exporter,
engine.js meta *definitions* (only added shared helpers + wiring), transport
code, or scene_config.

## Validation

- `node --check` on all changed JS — OK.
- `cd marsin_engine && node --test tests/*.test.js` → **898 pass / 0 fail**
  (was 869; +19 new inView tests + pre-existing suite growth). Green.
- `cd simulation && npm test` → **118 pass / 0 fail** (no sim files touched).
- `node tools/perf_gauge.mjs --gate`: every GOLDEN correctness hash STABLE
  (byte-identical render output, incl. `titanic/27_swipe`
  `golden=6993b71cfcb1` matching baseline). The gate flags a p99 TIMING blip
  on `titanic/27_swipe` (~11%) — the documented container-load-noise flake
  (report `20260619_4` §6); persists across runs, no golden hash moved. My
  change is compile-time only (the injector runs ONCE per compile, never in
  the 40 fps render path), so this is noise, not a regression — no
  re-baseline warranted.

### Vendored-WASM selection proof (e2e)

Three e2e tests render through the VENDORED Tier-C WASM:
- low-word `inView("PORT")` selects EXACTLY its members, zero leak;
- high-word `inView("HIVIEW")` (inlined `viewMaskHi & 1` literal) selects
  exactly, zero cross-word leak vs a low-word view;
- a bit-free `pixelIndices` view is PROMOTED on demand and then selects
  exactly its pixels.

Plus a live whole-model harness (`~/tmp/inview_live_demo.mjs`, throwaway):
boots titanic's real pixels through `deriveAutoViews` + the viewTable +
promoter, compiles the ACTUAL `patterns/examples/inview_demo.js`
(`inView("PORT")`), and confirms PORT (a bit-free Tier-A auto-view, 485
members) promotes to word-0 bit `0x10000000`, sets it on exactly the 485
PORT pixels, and renders to EXACTLY those 485 — **zero leak, zero miss**.

## Smoke residue (NOT committed)

Pre-existing working-tree residue left uncommitted per CLAUDE.md:
- `marsin_engine/states/summer_camp_dome/audio_state.yaml` (runtime residue)
- `simulation/scenes/summer_camp_dome/playlists/default.yaml` (runtime residue)

Also present (another agent's uncommitted work, NOT mine, left untouched):
`simulation/src/dmx/patch_manager.js`,
`simulation/scenes/titanic/scene_config.yaml`,
`simulation/tests/patch_manager_subscribe.test.js`.

## Coordinator notes

- Committed on `dev/claude/views_rehaul`, **NOT pushed**. Commit = 6 files:
  `lib/in_view_intrinsic.js`, `lib/wasm_host.js`, `engine.js`,
  `patterns/examples/inview_demo.js`, `tests/in_view_intrinsic.test.js`, and
  this report.
- `lib/model_loader.js` (the gauge/test loader) builds no `viewTable` and is
  unchanged; it does not run `deriveAutoViews`, so `inView` is exercised in
  tests via direct `WasmHost` wiring + the real engine path proof above. If
  a future tool needs `inView` through `model_loader`, mirror the engine's
  `viewTable`/promoter build there.
