# Tier-C Host Integration — viewMaskHi (62 in-VM views)

**Date:** 2026-06-19
**Branch:** `dev/claude/views_rehaul` (committed, NOT pushed — coordinator pushes)
**Role:** Integration developer (BM26 host side)
**Firmware:** FINAL at MarsinLED commit `e915c23` (production-closed). NO firmware changes.
**ABI conformed to:** `/home/user/MarsinLED/.agent/projects/202606/20260619_1_views_rehaul_tierc_abi.md`

---

## 1. What this delivers

Lifts the in-VM view-mask ceiling 31 → 62 on the BM26 host by adding the second
view word `viewMaskHi`. Views 0..30 stay in `viewMask` (lane 3, byte-identical
back-compat); views 31..61 live as bit `(view-31)` of `viewMaskHi` (lane 6). A
pattern tests a high view as `(viewMaskHi & <inlined single-bit literal>)`.

## 2. Reconciled from the stash vs the FINAL ABI

The stashed WIP (`tier-c-host-wip-resume`) applied cleanly and contained:
- `lib/meta_abi.js` — stride/lane constants behind a `VIEW_MASK_HI_ENABLED` gate
  (was `false`), `lib/view_word.js` — the two-word `ViewBitAllocator`.
- 7-lane meta pack in `wasm_host.js setPixelMeta` + `marsin_wasm_runtime.js`,
  gated by the flag, writing `m.viewMaskHi` into lane 6.
- An UNUSED import of `ViewBitAllocator` in `engine.js`.

The partial work was built to an EARLIER contract and was INCOMPLETE. Reconciled
to the FINAL ABI:
- **Flag flipped LIVE.** `VIEW_MASK_HI_ENABLED = true` — the 7-lane WASM is now
  vendored, so the host packs the 7-int stride (lane 6 = viewMaskHi).
- **7-lane pack confirmed** in `wasm_host.js` and `marsin_wasm_runtime.js`: lane 6
  = `m.viewMaskHi || 0`, packed as an exact Int32. The host only ever uses the
  bulk `*_all_with_meta[_6ch]` / `render_blend_6ch` metaBuf exports — never the
  single-pixel `marsin_render_with_meta` trailing-int path and never `setMeta`.
  So there is **no 7-arg setMeta** anywhere (grep-verified); the deleted lossy
  float lane is a no-op for this host (ABI §2 "Host impact: none"). The WASM
  reads lane 6 and calls `setViewMaskHi` internally (exact integer, no float
  round-trip).
- **Two-word allocation implemented** (was only an unused import). `engine.js`
  loadModel and `lib/model_loader.js` now carry a per-pixel `vMaskHi`
  accumulator, route each view to its word, and populate lane 6. Both meta
  builders (boot + hot-reload) emit `viewMaskHi`.
- **Injector inlined-literal emission implemented** (the firmware hardening): a
  high-word mask is emitted as an INLINED single-bit literal, not a `var`.

## 3. Two-word allocation scheme

- `lib/view_word.js` (`ViewBitAllocator`): 62 slots. `next()` fills word 0
  (bits 0..30) before word 1, so the first 31 views stay byte-identical to the
  legacy single-word layout. `claim(word, bit)` pins explicit bits. Past slot 61
  it throws LOUDLY (`Out of view-mask bits`). Bit 31 (`0x80000000`) is never
  handed out (negative under Int32).
- **engine.js / model_loader.js:** base group bits stay word 0 (back-compat —
  titanic's ≤28 group bits are unaffected). Presets carry a `word` (0|1).
  Word-0 bits merge into `px.vMask` (lane 3); word-1 bits merge into `px.vMaskHi`
  (lane 6). Explicit preset bits validate per-word (word 0 and word 1 are
  independent bit spaces — a word-1 bit value may equal a word-0 value without
  collision). model_loader's bit-less pixelIndices presets draw from a shared
  `ViewBitAllocator` (groups pre-claimed in word 0), so the 32nd+ view spills
  into `viewMaskHi`.
- **simulation/src/dmx/view_registry.js:** extended to the 62-bit scheme.
  `nextFreeSlot()` returns `{word, bit}` filling word 0 first; `addCustomView`
  uses it and tags `view.word`; `createViewRegistry` parses/validates `word`
  (absent ⇒ 0, back-compat); `usedBitsMask(registry, word)` and
  `setCustomViewBit` are per-word; `buildViewmasksSidecarJS` emits `word: 1` for
  high views and reads membership from `vMaskHi` for word-1 pixelIndices views.
  Throws LOUDLY past 62 slots.

## 4. Injector inlined-literal scheme (the firmware hardening)

The firmware requires the mask in `(viewMaskHi & MASK)` to be a COMPILE-TIME
CONSTANT single-bit LITERAL — a `var MASK = (1<<k)` is rejected. So:
- `name_id_registry.js`: a table value may be a bare number (LEGACY — injected as
  `var PREFIX_X = n;`, unchanged) or `{ value, inline: true }` (INLINE — every
  `PREFIX_X` token is textually replaced by the literal, no `var` emitted).
  `buildConstantTable` carries `inline`; `injectConstants` does whole-token,
  longest-name-first substitution for inline names.
- The self-declaration detector was tightened: a name counts as self-declared
  only when it is a DECLARATION TARGET in a `var` statement (`var X =` / `, X =`),
  not merely appearing in another declarator's initializer
  (`var on = (viewMaskHi & MASK_X)`). The old loose form would have suppressed
  inline substitution. Legacy var-injection behavior is unchanged.
- `view_mask_constants.js buildMaskConstants`: a preset with `word === 1` becomes
  an inline entry; groups and word-0 presets stay legacy `var`. So
  `(viewMaskHi & MASK_HIGH)` compiles to `(viewMaskHi & 1073741824)` and the
  firmware single-bit-mask guard is satisfied.

## 5. Vendored artifact + require()-load result

Copied from `/home/user/MarsinLED/build/wasm/`:
- `marsin-engine.js` (62,103 B, md5 `f140275a…`) → `marsin_pb/wasm/marsin-engine.cjs` AND `…/marsin-engine.js`
- `marsin-engine.wasm` (244,017 B, md5 `a08360f1…`) → `marsin_pb/wasm/marsin-engine.wasm`

**require()-load verification** (a ~/tmp script replicating wasm_host's
createRequire load, then again from the vendored path):
- Module loads under `require()` ✓
- `(viewMaskHi & 1073741824)` single-bit literal compiles ✓
- `(viewMaskHi & 1073741825)` bypass literal (2^30+1) → REJECTED at compile ✓
  (the e915c23 float-trap fix is PRESENT in this binary)
- `(viewMaskHi & M)` var-mask → REJECTED at compile ✓

**IMPORTANT artifact note (coordinator reconcile):** the vendored
`marsin-engine.js` embeds the build-tag string `4a30497`, NOT `e915c23`. But the
binary BEHAVES as e915c23 — it rejects the bypass/var masks above — because
e915c23's commit message states the only change vs `4a30497` is a compile-time
validator tightening with byte-identical bytecode, and the embedded version
constant was simply not re-bumped. em++ is NOT installed in this container, so a
rebuild from `e915c23` was not possible; the on-disk
`/home/user/MarsinLED/build/wasm/marsin-engine.{js,wasm}` (the ABI's stated
stable consumer copies) is what was vendored. The coordinator should, on a
machine with em++, optionally rebuild at `e915c23` to refresh the embedded tag —
functionally a no-op (bytecode identical, behavior verified identical).

## 6. Test / perf / e2e results

- **engine `node --test tests/*.test.js`: 832 pass / 0 fail** (was 814; +18 new
  in `tests/view_mask_hi_host.test.js`).
- **sim `npm test`: 106 pass / 0 fail** (view_registry two-word changes green).
- **`node tools/perf_gauge.mjs --gate`: PASS — "6 pairs within thresholds, all
  golden hashes stable."** The re-vendored WASM renders existing patterns
  byte-identically (golden/bytecode hashes unchanged), confirming e915c23's
  byte-identical-bytecode claim. (One run flagged a +23% p99 TIMING blip on
  titanic/27_swipe — pure container-load noise; a clean re-run passed and NO
  golden hash moved. No re-baseline needed.)
- **Live engine smoke:** `node engine.js --model test_bench --pattern
  01_cylon_sweep --dry-run` boots clean against the vendored 7-lane WASM (model
  loads, meta packs, pattern compiles + renders).

New Tier-C host unit tests cover: slot→(word,bit) mapping incl. bit-30 boundary
and view 61; allocator word-0-before-word-1 fill, the 32nd view → hi word bit 0,
exactly-62-then-throw, bit-31 rejection; `buildConstantTable` inline entries +
inline-mode collision; injector inline literal substitution (no var), mixed
low+high, longest-name-first; `buildMaskConstants` word routing; 7-lane pack
carries viewMaskHi in lane 6; and two end-to-end tests through the vendored WASM.

### 62-view selection proof (e2e, through the VENDORED WASM)

Direct-meta e2e test + a full-pipeline ~/tmp harness (`loadModelForGauge`
test_bench → pack a hi-word view + a low-word view → render):
- HI-word view `(viewMaskHi & 1)` (the inlined-literal path) selected EXACTLY
  pixels `[0,1,2]` (expected `[0,1,2]`).
- LOW-word view `(viewMask & 256)` selected EXACTLY pixels `[10,11,12]`.
- Cross-word leak: `[]` (NONE). Result: hi=EXACT, low=EXACT, leak=NONE.
- The float-trap case (a pixel in two high views, combined hi word bits 5 and 28,
  tested with `(viewMaskHi & (1<<5))`) selects exactly; a bit-28-only pixel does
  NOT match the bit-5 test.
- `model_loader` metaArray entries carry the `viewMaskHi` lane and every view is
  tagged `word` 0|1.

## 7. Files changed

| File | Change |
|---|---|
| `marsin_engine/lib/meta_abi.js` (new) | Stride/lane ABI constants; `VIEW_MASK_HI_ENABLED=true`; META_LANES=7 |
| `marsin_engine/lib/view_word.js` (new) | Two-word `ViewBitAllocator`, `slotToWordBit`, 62-slot cap |
| `marsin_engine/lib/name_id_registry.js` | Inline injection mode + tightened self-declaration detector |
| `marsin_engine/lib/view_mask_constants.js` | `buildMaskConstants` routes `word:1` presets to inline entries |
| `marsin_engine/lib/model_loader.js` | Two-word allocator + per-pixel `vMaskHi` + lane-6 metaArray |
| `marsin_engine/lib/wasm_host.js` | 7-lane `setPixelMeta` (lane 6 viewMaskHi) — flag now live |
| `marsin_engine/lib/marsin_wasm_runtime.js` | 7-lane meta pack — flag now live |
| `marsin_engine/engine.js` | Per-word preset validation/merge, `vMaskHi`, both meta builders |
| `simulation/src/dmx/view_registry.js` | 62-bit two-word allocator + sidecar `word` emission |
| `marsin_engine/tests/view_mask_hi_host.test.js` (new) | 18 Tier-C host unit + e2e tests |
| `marsin_pb/wasm/marsin-engine.{cjs,js,wasm}` | Vendored final Tier-C WASM |

## 8. Smoke residue (NOT committed)

The dry-run boot wrote runtime state into two TRACKED files (expected residue,
left uncommitted per CLAUDE.md):
- `marsin_engine/states/summer_camp_dome/audio_state.yaml`
- `simulation/scenes/summer_camp_dome/playlists/default.yaml`

## 9. Coordinator must still reconcile

1. **WASM build tag:** the vendored `.js` embeds `4a30497`, not `e915c23`
   (behavior verified identical — see §5). Optionally rebuild at `e915c23` on an
   em++ machine to refresh the tag; functionally a no-op.
2. **Sim Views-panel editor for high views:** `view_registry.js` allocates and
   exports word-1 views, and group-based word-1 views work end-to-end. But the
   editor (`view_masks_editor.js`) still stores per-fixture membership in the
   single-word fixture `viewMask` field — per-fixture (pixelIndices) high-view
   AUTHORING in the UI is a follow-up. Group-based high views and the engine/host
   render path are complete.
3. **Not pushed** — commit is on `dev/claude/views_rehaul` for the coordinator
   to push after verifying.
