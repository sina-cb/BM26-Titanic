# `_136` — `model_loader.js` made word-aware (`loadModelForGauge('titanic')` fixed)

Developer thread, branch `feat/bm_readiness`. Subsystem: `marsin_engine/` VM-only
model loader + its two tool consumers. **No git operations, no deploys, no
installs, no live engine boot, no port bound.**

Fixes finding **§5.2 of `20260725_134_titanic_semantic_views.md`**: the VM-only
loader behind `tools/perf_gauge.mjs` and `tools/param_truth/render_context.js`
was blind to the Tier-C view **word**, so it refused to load the titanic model
after `_134` pinned 10 semantic views into word 1.

---

## 1. The defect

`marsin_engine/lib/model_loader.js` accumulated **one flat** `reservedMask`
across every `viewMasks` entry, ignoring each entry's `word` field, and
`assignGroupBits()` then validated the declared `groupBits` table against that
flat mask.

Word 0 (`viewMask`) and word 1 (`viewMaskHi`) are **independent bit spaces**
(`lib/view_word.js`): a word-1 preset bit `0x10` shares no meaning with a word-0
group bit `0x10`. Flattening them turned every word-1 preset into a phantom
word-0 collision. `engine.js` (the authoritative runtime loader, ~lines 338-395)
always tracked the two separately as `reservedMask` / `reservedMaskHi` and
validated `groupBits` against the **word-0** reservation only — the two loaders
had drifted.

titanic's sidecar pins `Left Jewelry` word-1 `0x1`, `Right Jewelry` word-1 `0x2`,
… `Auditoriums` word-1 `0x200` — ten values that all duplicate legitimate word-0
group bits.

### Reproduction (the brief's one-liner)

```
cd marsin_engine && node -e "(async()=>{const {loadModelForGauge}=await \
  import('./lib/model_loader.js'); try{const m=await loadModelForGauge('titanic'); \
  console.log('OK', m.viewMasks.length);}catch(e){console.log('THROW:', e.message);}})()"
```

| | Output |
|---|---|
| **before** | `THROW: groupBits['Left Back Wall'] reuses bit 0x10` |
| **after** | `OK viewMasks: 17 pixels: 964 · word1 views: 10 · pixels with viewMaskHi set: 284` |

---

## 2. The fix — `marsin_engine/lib/model_loader.js`

Mirrors `engine.js` semantics exactly; **no check was weakened**.

- `reserveExplicitBits()` now returns `{ reservedMask, reservedMaskHi }`,
  reserving each explicit bit into **its own word**. A genuine same-word reuse
  still throws loudly — word 0 with the original
  `reuses bit 0x…` message, word 1 with `reuses viewMaskHi bit 0x…` (engine.js's
  wording).
- Two validations `engine.js` had and `model_loader` lacked were brought over
  (strictly additive, both fail-loud): `word` outside `{0,1}` throws instead of
  being silently coerced to 0, and a `word:1` entry with no explicit bit throws
  (word 1 has no derived-slot path).
- `assignGroupBits()` is unchanged in behaviour but is now documented and called
  with the **word-0 reservation only** — group bits live in word 0, so a word-1
  preset must never constrain them. Its own duplicate-group-bit and
  missing/stale two-way sync checks are untouched.
- `assignGroupBits()` also initialises `px.vMaskHi ?? 0` alongside
  `vMask`/`viewMask`, matching `engine.js:417`.
- `reserveExplicitBits` / `assignGroupBits` are now **exported** so the word-space
  contract is directly testable (the loader's public entry point takes only a
  model name, and `MODELS_DIR` is fixed — testing a synthetic collision through
  it would have meant writing throwaway model files into the source tree).

The preset-resolution / allocator half of the file was already word-aware
(`resolvePresets` + `ViewBitAllocator` claim per word) and was not touched.

---

## 3. Regression test — `marsin_engine/tests/mixer/model_loader_word_aware.test.js`

New file, **14 tests, 14 pass**. No test previously loaded a real multi-word
model through `model_loader` — `view_mask_hi_host` uses a synthetic model and
`param_truth_smoke` uses `test_bench` — which is exactly why every suite stayed
green while the loader was broken.

```
cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs \
    --test tests/mixer/model_loader_word_aware.test.js
   ℹ tests 14   ℹ pass 14   ℹ fail 0
```

Coverage:

| Test | Asserts |
|---|---|
| the REAL titanic model loads | 24 group bits + 17 custom views (**41 named masks**), `pixelCount === pixels.length === metaArray.length` |
| titanic contains the cross-word bit pair that used to throw | at least one word-1 preset bit **equals** a word-0 group bit — so the suite fails loudly if a re-export ever removes the condition under test |
| word-1 presets land in `viewMaskHi`, word-0 in `viewMask` | hi-lane membership is non-empty; every view tagged word 0\|1; `viewMask` carries **only** group bits + word-0 preset bits (zero hi-word leak) |
| repeated loads are idempotent | two loads produce deep-equal `metaArray` (no bit accumulation across the module cache) |
| `reserveExplicitBits`: same bit value in different words | `reservedMask === 0x10` **and** `reservedMaskHi === 0x10`, no throw |
| `reserveExplicitBits`: genuine word-0 collision | throws `/reuses bit 0x10/` |
| `reserveExplicitBits`: genuine word-1 collision | throws `/reuses viewMaskHi bit 0x40/` |
| `reserveExplicitBits`: `word: 2` / `word:1` without a bit | throw (engine.js parity) |
| `reserveExplicitBits`: duplicate name / `0x80000000` | still throw |
| `assignGroupBits`: word-1 preset does not block the same group bit value | word-1 presets reserve **nothing** in word 0; declared table accepted verbatim |
| `assignGroupBits`: genuine word-0 preset/group collision | throws `/groupBits\['A'\] reuses bit 0x10/` |
| `assignGroupBits`: two groups on one bit | still throws |
| `assignGroupBits`: derived assignment | skips the word-0 reservation, is free to use the word-1-only bit value |

---

## 4. Blast radius confirmed working

Both consumers named in `_134` §5.2, driven offline out of the scratchpad — no
engine process, no socket, no port, and **no perf baseline written** (the tracked
`perf_baseline.json` is untouched):

```
[gauge-path] titanic loaded: 964 px, 24 groups, 17 views, 41 MASK_* constants
[gauge-path] compiled 01_cylon_sweep + rendered 1 frame — 964/964 px lit
[render-context] titanic ok: pixelCount=964
                 keys=[modelName, pixelCount, coords, inspect, render,
                       renderPulsed, renderBlend, close]
BLAST-RADIUS CHECK PASSED
```

The first block replays `perf_gauge.mjs`'s `measurePair()` load path verbatim
(`loadModelForGauge` → `buildMaskConstants` → `WasmHost` init/coords/meta →
compile → one frame) rather than running `--gate`/`--write-baseline`, which would
either write a tracked baseline or spend 6 pairs × 2000 timed frames. The 41
`MASK_*` constants match `_134` §3.1 exactly. The second is
`tools/param_truth/render_context.js`'s `createRenderContext('titanic')`.

---

## 5. Gate — full engine suite

```
cd marsin_engine && npm test
   ℹ tests 2601   ℹ pass 2593   ℹ fail 8   ℹ duration_ms 163662
```

**Zero new failures.** All 8 are the known environmental families carried in the
tracker (`_134` §3.5 baseline was 2588/8 on a slightly different tree state; the
+13 is this thread's new file, which contributes 14, against one test that has
since moved in another agent's concurrent work):

| Failing test | Family |
|---|---|
| `reframes mixed-size byte chunks into exact-size Int16Array frames` | audio_capture (env) |
| `emits status lifecycle: starting → running → stopped` | audio_capture (env) |
| `exponential backoff doubles on unexpected exit, capped at 30s` | audio_capture (env) |
| `stop() during pending restart cancels the timer and resolves` | audio_capture (env) |
| `a throwing onFrame does not break framing of subsequent frames` | audio_capture (env) |
| `tests/effects/effects_v2_mode_page_layout.test.js` (file-level) | known env |
| `startAsync rejects with EADDRINUSE when port is already bound` | OSC EADDRINUSE from the operator's live stack |
| `both scenes carry byte-identical copies of every specialty/themed playlist` | another agent's uncommitted playlist edits |

Every mixer / view / mask test passed, including the new file.

---

## 6. Autonomy / safety statement

- **No git command of any kind was run** — no add, commit, branch, checkout,
  stash, reset, push, diff.
- **No deploy, no `npm install`, no `package.json` / lockfile change.**
- **No engine booted by hand.** The blast-radius harness uses only the vendored
  WASM host and pure library modules. The one port-touching failure in §5 is the
  suite's own pre-existing OSC `EADDRINUSE` test losing the default port to the
  operator's live stack — nothing was sent to the running engine.
- The operator's launcher stack (6966-6972, 5568, 8081, 10000) kept every port.
- Scratch files live in the session scratchpad only; nothing temporary was
  written into the source tree.
- Other agents' uncommitted work in the tree is untouched. This thread wrote
  exactly three files: `lib/model_loader.js`,
  `tests/mixer/model_loader_word_aware.test.js`, and this report (plus the
  tracker landing block).

---

## 7. Still open (unchanged by this thread)

`_134` §5.1 (word 0 saturated — `view_registry.js`'s `nextFreeSlot` spends scarce
word-0 slots on custom views, so adding a new fixture group to the titanic scene
throws at export) and §5.3 (`simulation/lib/bench_section.cjs` T3 counts word-1
customs against the word-0 31-bit ceiling) are **sim-side** allocator/budget
defects and remain open. This thread fixed only the engine-side loader (§5.2).
