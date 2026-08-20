# `_140` — the offline audio harness now mirrors `WasmHost`'s three injection passes (`inView()` works)

**Date:** 2026-08-03 · **Branch:** `feat/bm_readiness`

**Scope (operator-commissioned):** make `marsin_engine/tools/pattern_audio_harness.mjs`
compile a pattern that calls `inView("Authored View Name")`. The measured
blocker was filed by `_139` §5: `inView()` is the documented targeting layer
(`docs/MARSIN_ENGINE_PATTERNS.md` §7.3, `.agent/skills/highdef_pattern_generation.md`
§3), yet an `inView()`-targeted pattern could not run the harness, the `--gate`
check, or the offline clip pipeline — and `tools/gallery/gen_variations.mjs`
shells out to the same harness, so titanic static/sound clips were blocked too.

**Files written (six):**

- `marsin_engine/tools/pattern_audio_harness.mjs` — the fix.
- `marsin_engine/lib/model_loader.js` — extracted + exported `buildMetaArray(pixels)`
  (the meta-lane pack `loadModelForGauge` already did inline), so the harness can
  re-pack after an on-demand view promotion without a second copy of the ABI.
- `marsin_engine/tests/tools/harness_inview_injection.test.mjs` — new regression test.
- `.agent/skills/highdef_pattern_generation.md` — §8.2 "Known tooling gap" note
  replaced with the new measured reality.
- this report
- the tracker landing block in `.agent/memory/bm_readiness_thread_tracker.md`

**No git operation of any kind. No engine boot, no sim boot, no server, no port
bound, no deploy, no install.** Every verification ran in-process or as an
offline subprocess against the vendored WASM; ports 6966–6972, 5568, 8081 and
10000 were never touched. Scratch lived in `~/tmp/_140` and the session
scratchpad. The tree's large volume of other agents' uncommitted work is
untouched.

---

## 1. Root cause — confirmed, and it was two faults, not one

The reported symptom reproduces exactly on the pre-fix harness:

```text
$ node tools/pattern_audio_harness.mjs --pattern ~/tmp/_140/probe_inview.js \
    --model titanic --synth silence --frames 8
COMPILE_FAIL: Line 9: strings cannot be used as a function argument
exit=2
```

`inView("…")` is **not** a VM builtin — it is a compile-time fold applied to
the SOURCE by `lib/in_view_intrinsic.js` before the MarsinScript compiler ever
runs. The harness never ran that fold, so the literal string reached the
compiler and the compiler correctly rejected it.

The real path, `lib/wasm_host.js` `compile()`, applies three source passes in
this order:

```js
source = injectInViewIntrinsic(code, this.viewTable, this.bitFreeViewPromoter);
source = injectMaskConstants(source, this.maskConstants);
source = injectFixtureConstants(source, this.fixtureConstants);
```

The harness drove `lib/marsin_wasm_runtime.js` (the handle-less functional
wrapper, which has **no** injection stage at all) and hand-applied only
`injectFixtureConstants` — its own comment at the old line ~163 said so:
*"MASK_* injection is NOT mirrored here"*.

**The second fault, which the ticket did not name and which mattering more:**
the harness loaded the model with a bare `await import(models/<name>.js)`. The
raw model module is **unresolved** — every pixel carries `vMask: 0`, `vMaskHi`
absent, and none of the `<model>.viewmasks.js` sidecar presets are merged.
Verified directly:

```text
titanic  pixelCount=964  pixels.length=964  nulls=0  withLocalIndex=964
sample pixel: { … "cId":17, "sId":3, "fId":13, "localIndex":0, "vMask":0, … }
```

So even with the injection passes bolted on, every `inView`/`MASK_*` test
would have folded to a bit that no pixel carries — a silent all-false render,
which is the exact codex-P0 failure mode the intrinsic exists to prevent. Both
faults had to be fixed together.

## 2. The fix

Design decision (mine to make, per the brief): **switch the harness to
`loadModelForGauge()` + the real `WasmHost`**, rather than building a view
table from the `.viewmasks.js` sidecar by hand. Rationale — object-identity /
behavioural parity with the engine with the least duplicated logic:
`WasmHost.compile()` *is* the engine's compile entry point, so the three
passes and their ORDER cannot drift; `loadModelForGauge()` is the same loader
`tools/param_truth/render_context.js` and `tools/perf_gauge.mjs` already use,
and it is word-aware after `_136`/`_138` (word 0 = `viewMask`, word 1 =
`viewMaskHi`; all 17 titanic composite views live in word 1). A hand-rolled
sidecar reader would have been a third copy of the bit-allocation contract.

Concretely, in `pattern_audio_harness.mjs`:

- imports: `createWasmRuntime` + `buildFixtureTypeIds/fixtureTypeId/injectFixtureConstants`
  → `WasmHost`, `loadModelForGauge`, `buildMetaArray`, `buildMaskConstants`,
  `createBitFreeViewPromoter`. All at top of file, none wrapped.
- model load: `loadModelForGauge(modelName)` supplies resolved `pixels`,
  `groupBits`, `viewMasks`, `metaArray` and `fixtureConstants`. The hand-rolled
  meta pack (which used `p.localIndex || 0` rather than the engine's
  `derivePixelLocalIndices`) is gone.
- view table assembled exactly as `engine.js` does: base groups at word 0,
  each resolved preset at its authored word.
- host wiring: `setMaskConstants` / `setFixtureConstants` / `setViewTable` /
  `setBitFreeViewPromoter`, then `host.compile(source)`.
- post-compile: `if (host.metaDirty) host.setPixelMeta(buildMetaArray(px))` —
  a bit-free (Tier-A) view promoted during the fold mutates the pixel objects,
  so the meta packed before the compile is stale. Mirrors `engine.js`
  `repackMetaIfDirty`. (No tracked model currently exposes a bit-free view to
  this path, so it is a correctness guard, not a measured path — stated as
  such.)
- render loop: `rt.*` → `host.*(handle, …)`; teardown `host.destroy(handle)` +
  `host.shutdown()`.

**Loud-failure surface kept and extended, no fallbacks anywhere:**

| Condition | Before | After |
|---|---|---|
| missing model file | `MODEL_FAIL:` exit 2 | unchanged |
| model fails to resolve (bad sidecar, bit collision, half-migrated `localIndex`) | not reachable — raw import | `MODEL_FAIL: <model> failed to load: <reason>` exit 2 |
| `pixels[]` missing a required field | `MODEL_FAIL:` exit 2 | unchanged |
| declared `pixelCount` ≠ `pixels.length` | silently used `pixels.length` | `MODEL_FAIL:` exit 2 (new) |
| unknown `inView("X")` | compiler noise about strings | `COMPILE_FAIL: Pattern references unknown view(s) … Known views for this model: …` exit 2 |
| unknown `MASK_*` / `FIX_*` | MASK_ not reachable | `COMPILE_FAIL:` exit 2 |
| missing pattern file | incidental `COMPILE_FAIL: ENOENT…` (it fell inside the injector try/catch) | `PATTERN_FAIL: no pattern file <path>` exit 2 (new — a raw ENOENT stack is not a diagnosis) |

The one `try/catch` added wraps `await loadModelForGauge(...)` only, to convert
a throw into the harness's documented `MODEL_FAIL` + exit 2 contract. No
import is wrapped; nothing is swallowed.

`lib/model_loader.js` change is a pure extraction: the `metaArray` map inside
`loadModelForGauge` became the exported `buildMetaArray(pixels)` and is called
from the same place. No behaviour change (see §4.3).

## 3. `gen_variations.mjs` — inherits, no touch needed

Checked and **deliberately not modified**. Its only coupling to the harness is
`execFileSync('node', [HARNESS, '--pattern', …, '--model', …, '--seconds', …,
'--out-fps', …, '--out', …, …flags])`. The fix is entirely inside the harness
process and changes no flag, no output line format and no exit-code contract,
so the capability is inherited automatically. Both legs measured:

1. The exact STATIC-variation argv it constructs, pointed at an `inView`
   pattern (previously impossible):

```text
$ node tools/pattern_audio_harness.mjs --pattern ~/tmp/_140/probe_inview.js \
    --model titanic --seconds 10 --out-fps 14 --out …/genvar_static.json --synth silence
QUALITY hueSpread=0.09 … peakMaxChan=255
GATE window=600f darkFrac=0.00 headDark=0.00 tailDark=0.00 peak=255 meanMs=0.04 worstMs=1.14 budget/ch=6.25ms
GATE_PASS
```

2. A REAL end-to-end `gen_variations` run (harness → `publish.mjs` → widget) on
   the ship, to prove the chain still works post-change:

```text
$ node tools/gallery/gen_variations.mjs --pattern 27 --model titanic --seconds 2 --fps 10
  [titanic] static -> /w/27_swipe__titanic__static
  1 pattern(s) × 1 model(s) = 1 renders: 1 static, 0 sound, 1 no-block
exit=0
```

`tools/gallery/widgets/` is a **tracked** directory, so the one generated
widget (`27_swipe__titanic__static.html`, a new untracked file) was deleted
afterwards and the directory diffed back to its original 6 entries —
**restored clean**. No tracked widget was overwritten.

Note, honestly: no *shipped* numbered pattern uses `inView()` today, so
`gen_variations`'s default sweep does not yet exercise the new path on a real
pattern — it exercises it the moment one lands.

## 4. Verification — all measured

### 4.1 `inView()` compiles, renders, and hits the right pixels

Probe (`~/tmp/_140/probe_inview.js`): `inView("Hull Canvas")` → red,
`inView("Stacks")` → green, else off.

```text
$ node tools/pattern_audio_harness.mjs --pattern ~/tmp/_140/probe_inview.js \
    --model titanic --synth silence --frames 8 --out …/probe_after.json
COMPILE_OK
SYNTH=silence FRAMES=8@40fps MODEL=titanic PIX=964 LIT=384/964 maxChan=255
GATE window=600f darkFrac=0.00 … peak=255 meanMs=0.03 worstMs=0.57 budget/ch=6.25ms
GATE_PASS
exit=0
```

Frame 0 of the capture, classified by colour, against the model's own view
membership read back through `loadModelForGauge`:

```text
frame0: red(HullCanvas)=360  green(Stacks)=24  off=580  other/mixed=0  total=964
overlap(red ∩ green)=0

model truth:
  Hull Canvas  word=1  bit=0x400  members=360
  Stacks       word=1  bit=0x40   members=24
  Hull Canvas ∩ Stacks = 0
```

Exact match on both counts, zero mixed pixels, zero overlap — and both views
resolve out of the **high** word (`viewMaskHi`), so the word-aware path is the
one being exercised.

### 4.2 Negative control — unknown view fails loudly

```text
$ node tools/pattern_audio_harness.mjs --pattern ~/tmp/_140/probe_badview.js \
    --model titanic --synth silence --frames 8
COMPILE_FAIL: Pattern references unknown view(s) via inView(): No Such View. Known views for
this model: Left Back Wall, Left Front Wall, … Hull Canvas, Left Hull, Right Hull, Silhouette,
… Organs, … Identity, Stacks, Left Stacks, Right Stacks, Auditoriums
exit=2
```

Named offender, full known-view list, non-zero exit. Never a constant-false test.

### 4.3 Existing patterns unaffected — byte-identical captures

Same argv before and after the edit (`--synth full_track --frames 40`), MD5 of
the capture JSON (which contains every rendered frame of every pixel):

| pattern @ model | before | after | |
|---|---|---|---|
| `27_swipe` @ `test_bench` | `8eb3e221037ddb485e2005df29a243f5` | `8eb3e221037ddb485e2005df29a243f5` | **IDENTICAL** |
| `27_swipe` @ `titanic` | `2839bb30956a9d1f82fa01ff2f0a0ffc` | `2839bb30956a9d1f82fa01ff2f0a0ffc` | **IDENTICAL** |
| `44_biolume_swell` @ `test_bench` | `2c4cc4e20ed6499dd3b41eb336fec3b2` | `2c4cc4e20ed6499dd3b41eb336fec3b2` | **IDENTICAL** |
| `44_biolume_swell` @ `titanic` | `b213c4a97b21733ae55fc697f793cd2c` | `b213c4a97b21733ae55fc697f793cd2c` | **IDENTICAL** |

Every summary line (`LIT`, `TOTAL_BRI`, `LIT_BY_SECTION`, `QUALITY`, `GATE`,
verdict) is identical too; only `meanMs`/`worstMs` move, as timing always does
(e.g. `27_swipe` @ titanic `meanMs 0.72 → 0.83`, both ~7× under the 6.25 ms
per-channel budget). `WasmHost.renderAll6ch` mallocs its output per call where
the old wrapper reused one buffer — measured cost, still far inside budget on
the 964-px ship; `GATE_PASS` on all four before and after.

*Why identical rather than merely close:* neither pattern reads `viewMask`
(27_swipe mentions it only in a comment), every tracked model is the NEW export
format so `derivePixelLocalIndices` returns the same `px.localIndex` the old
hand-pack used, `fixtureTypeId` came from the same canonical registry already,
and `pixelCount === pixels.length` on all three models.

Also spot-checked as still working: `--mod` ranges
(`AUDIO_REACT micLow->sliderSwell: corr=-0.77 … (REACTIVE)`), `--set`, and a
`MASK_*` probe (`(viewMaskHi & MASK_STACKS)`) which now compiles and renders —
previously impossible.

### 4.4 `--gate` still works, including on `inView`

```text
inView probe, --gate            -> GATE_PASS,                 exit 0
inView probe rendering black    -> GATE_FAIL DARK: 100% of 600 frames … , exit 3
27_swipe @ test_bench, --gate   -> GATE_PASS,                 exit 0
```

### 4.5 Test suites — zero new failures

| Suite | Result |
|---|---|
| `tests/mixer/**` | **489 / 489 pass, 0 fail** |
| `tests/patterns/**` | **94 / 95 pass, 1 fail** — pre-existing, see below |
| `tests/tools/*.test.mjs` (incl. the new file) | **8 / 8 pass** |

The single `tests/patterns` red is
`specialty_white_uv.test.js › both scenes carry byte-identical copies of every
specialty/themed playlist`. It is **pre-existing and unrelated to this change**:
it diffs `simulation/scenes/{test_bench,titanic}/playlists/*.yaml` — pure scene
data, no engine code — and `test_bench/white_only.yaml` has acquired per-entry
slider `defaults:` that `titanic/white_only.yaml` lacks. File mtimes are
**2026-07-28 16:01** and **2026-07-27 16:32**, i.e. both predate this session
(2026-08-03). Filed as a follow-up, not fixed here.

### 4.6 New regression test

`marsin_engine/tests/tools/harness_inview_injection.test.mjs` — natural home
next to the existing `harness_gate.test.mjs`, same subprocess-driven shape.
Three tests: (1) an `inView()` pattern compiles and lights exactly the two
views' member sets with zero overlap, with the expected counts read from
`loadModelForGauge` at runtime so the test stays honest if titanic is
re-authored; (2) the same pattern still produces a `--gate` verdict; (3) an
unknown view name is a `COMPILE_FAIL` naming the view, exit 2. Short
`--gate-frames 4` keeps each run ~100 ms.

## 5. Security check

```text
$ python scripts/security_check.py --all
WRN leaks found: 6
```

**6 findings — exactly the stated baseline**, all `bm26-mac-address` in the
UNTRACKED `simulation/.scene_backups/studiodj/**` backup snapshots. Zero new
findings; nothing I wrote contains an address, MAC or secret.

## 6. Left open / refused

1. **`tools/pattern_derived_harness.mjs` has the SAME gap, and worse.** It is
   §8.3 of the same skill, runs on `--model titanic`, and its model block is
   the old shape: bare `import` of the raw model, `createWasmRuntime`, **no**
   injection pass at all (not even `FIX_*`), and a 4-lane meta pack
   (`controllerId/sectionId/fixtureId/viewMask`) that omits `fixtureTypeId`,
   `pixelLocalIndex` and `viewMaskHi`. So an `inView()`, `MASK_*`, `FIX_*` or
   `pixelLocalIndex` pattern is broken or mis-rendered there. **Not fixed** —
   the brief scoped this task to the audio harness, and the derived harness
   needs its own verification pass over the derived-signal chain. Filed, not
   silently expanded into.
2. The bit-free (Tier-A) view **promotion** path is wired (promoter + meta
   re-pack) but **not measured**: `loadModelForGauge` does not add the engine's
   auto-views, and every tracked titanic/test_bench/studio_top_loft view
   resolves to a real bit. Claimed as a correctness guard only.
3. The `specialty_white_uv` playlist-parity red from §4.5.
4. Per the brief: **no git operation of any kind** — staging, committing and
   branch work stay with the operator.
