# 2026-06-19 — True per-pixel `localIndex` from the exporter (Tier-B pixelLocalIndex)

Role: developer. Branch: `dev/claude/views_rehaul` (committed, **not pushed**).
No firmware change. Scope held to the exporter + the host `pixelLocalIndex`
resolver + their tests.

## Goal

`pixelLocalIndex` (Tier-B builtin: 0-based ordinal of a pixel WITHIN its own
fixture) was derived **host-side** by bucketing pixels by the `(group, fId)`
key (`marsin_engine/lib/pixel_local_index.js`). Correct-ish but indirect. The
sim exporter already knows the **real** fixture grouping, so it should emit the
true ordinal and the engine should prefer it — so a sweep keyed on
`pixelLocalIndex` runs ALONG a bar/strand in physical pixel order.

## What shipped

### 1. Exporter emits a true `localIndex` (simulation)

`simulation/src/dmx/pixelblaze_model_exporter.js` — every exported pixel now
carries a `localIndex`: a 0-based within-fixture ordinal taken straight from
the loop the exporter already runs over each fixture's own pixels:

- **DMX multi-pixel fixtures** (bars, multi-head): `localIndex: j`, the index
  into `fixture.pixels` — 0..N-1 per physical fixture, restarting at each.
- **DMX simple / single-pixel fixtures**: `localIndex: 0` (one pixel = ordinal 0).
- **LED strands**: `localIndex: j`, the per-strand LED index 0..count-1.

It is serialized unconditionally in `saveModelJS` (a NEW export always carries
it on every pixel) and documented in the model-file header comment.

### 2. Engine prefers the exporter field, legacy heuristic is the fallback

`marsin_engine/lib/pixel_local_index.js` — `derivePixelLocalIndices(pixels)`
rewritten to classify the model:

- **NEW format** (every non-null pixel carries a numeric `localIndex`) → trust
  the exporter value verbatim.
- **LEGACY format** (no pixel carries it) → the existing `(group, fId)`
  contiguous-run heuristic (unchanged math), documented now as fallback-only.
- **PARTIAL carry** (some non-null pixels have it, others don't) → **THROWS**
  (`Corrupt model: …`). Codex P0: a half-migrated export must fail loudly, not
  silently mis-derive. Null pixels (holes) are skipped and never trip the guard.

This is the single chokepoint every meta-builder already calls
(`engine.js` boot + hot-reload, `lib/model_loader.js` for tests/perf gauge), so
all three consume the exporter field through it with no further wiring. The
engine packs the result into meta lane 5 (`pixelLocalIndex`) exactly as before.

`engine.js` boot + reload meta-builder comments were updated to state the new
precedence (exporter-preferred, legacy fallback, throw-on-partial).

> **Residue note on `engine.js`:** the shared worktree carries another agent's
> **uncommitted** `inView(...)` intrinsic work in `engine.js` (+ new
> `lib/in_view_intrinsic.js`, `tests/in_view_intrinsic.test.js`, etc.) that is
> NOT at HEAD `7c2fc3e`. My engine.js edits are comment-only and the functional
> `localIndex` consumption flows entirely through `derivePixelLocalIndices`
> (which the engine already calls), so **I did NOT commit `engine.js`** —
> committing it would have swept in that other agent's in-flight work, and the
> codex forbids hiding/altering it. The engine consumes the new field correctly
> with the committed `pixel_local_index.js` alone; the operator/owning agent can
> land the engine.js comment touch-ups when their `inView` work merges.

### 3. Models NOT re-exported (by design)

Per the task, the regenerated `test_bench.js` / `titanic.js` models are the
operator's to re-export. They are LEGACY (no `localIndex`) until then and the
fallback path keeps them byte-identical — proven by the perf gate (all golden
hashes stable). New exports from the patched sim will carry the field and the
engine will prefer it automatically.

## Tests

- **New engine test** `marsin_engine/tests/pixel_local_index.test.js` (10):
  exporter-field preferred over heuristic; each fixture/strand numbered 0..N-1;
  a localIndex sweep lights a strand head→tail (advances along physical x/z);
  legacy `(group,fId)` derivation (test_bench + titanic shapes); null-hole
  handling; **partial carry throws**; null pixels don't trip the guard; empty
  model; and the engine meta-builder packs the exporter ordinal into the
  `pixelLocalIndex` lane.
- **New sim test** `simulation/tests/pixelblaze_model_exporter_local_index.test.js`
  (3): drives `generatePixelMap` with mocked globals — DMX fixtures number
  their own pixels 0..N-1 (distinct fId restarts), LED strands number 0..count-1
  per strand, and a strand's localIndex tracks physical position head→tail.

## Validation

- `node --check` on all touched files — clean.
- `marsin_engine`: `node --test tests/*.test.js` → **879 pass / 0 fail**
  (was 869; +10 new). `npm run check` (syntax + dry-run) green:
  `52/52 pixels patched`, compiles OK. `npm run perf:gate` → **GATE PASSED**,
  6 pairs, **all golden hashes stable** (legacy fallback ⇒ byte-identical).
- `simulation`: `node --test tests/*.test.js` → **118 pass / 0 fail** (+3 new).

## Files

Committed (mine, exclusively): `marsin_engine/lib/pixel_local_index.js`,
`marsin_engine/tests/pixel_local_index.test.js`,
`simulation/src/dmx/pixelblaze_model_exporter.js`,
`simulation/tests/pixelblaze_model_exporter_local_index.test.js`, this report.

NOT committed: `marsin_engine/engine.js` (comment-only edits, entangled with
another agent's uncommitted `inView` work — see residue note). Other unstaged
worktree residue left untouched: `lib/wasm_host.js`, `lib/in_view_intrinsic.js`,
`patterns/examples/`, `tests/in_view_intrinsic.test.js`,
`simulation/src/dmx/patch_manager.js`, `simulation/tests/patch_manager_subscribe.test.js`,
`simulation/scenes/titanic/scene_config.yaml`,
`marsin_engine/states/summer_camp_dome/audio_state.yaml`,
`simulation/scenes/summer_camp_dome/playlists/default.yaml`.
