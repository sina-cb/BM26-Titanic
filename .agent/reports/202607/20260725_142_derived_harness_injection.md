# `_142` — the offline DERIVED-signal harness now resolves the model and runs `WasmHost`'s three injection passes

**Date:** 2026-08-03 · **Branch:** `feat/bm_readiness`

**Scope (operator-commissioned):** close the source-injection / model-resolution
gap in `marsin_engine/tools/pattern_derived_harness.mjs` — the same fault
`_140` fixed in `tools/pattern_audio_harness.mjs`, filed there as §6 item 1.
`.agent/skills/highdef_pattern_generation.md` §8.3 tells pattern agents to run
this harness on `--model titanic`, so the gap was reachable from the documented
workflow.

**Files written (four):**

- `marsin_engine/tools/pattern_derived_harness.mjs` — the fix.
- `marsin_engine/tests/tools/derived_harness_inview_injection.test.mjs` — new
  regression test (4 tests).
- `.agent/skills/highdef_pattern_generation.md` — §8.3 gains a measured
  targeting-parity note (§8.2 untouched, it is already correct per `_140`).
- this report (+ the tracker landing block in
  `.agent/memory/bm_readiness_thread_tracker.md`).

`lib/model_loader.js` needed **no** change — `_140` already extracted and
exported `buildMetaArray(pixels)`, which is exactly what this harness needed.

**No git operation of any kind. No engine boot, no sim boot, no server, no port
bound, no deploy, no install.** Every verification ran in-process or as an
offline subprocess against the vendored WASM; ports 6966–6972, 5568, 8081 and
10000 were never touched. Nothing under `simulation/` was read or written
(agent `_141` owns that sweep). Scratch lived in `~/tmp/_142`. The tree's other
uncommitted work is untouched.

---

## 1. Root cause — confirmed, three faults in one block

The old "model + VM" block (lines ~158–175) did three wrong things at once.

**(a) Bare import of the raw model.** `await import(pathToFileURL(modelPath))`
returns the UNRESOLVED module: no group-bit assignment, no
`<model>.viewmasks.js` sidecar merge, so every pixel carries `vMask: 0` and no
`vMaskHi` at all.

**(b) `createWasmRuntime` has no injection stage.** `lib/marsin_wasm_runtime.js`
`compile()` hands the source straight to `_compile()`. The harness hand-applied
*nothing* — not even `injectFixtureConstants` (the audio harness at least did
that one). Reproduced directly against that runtime with today's probes:

```text
$ node ~/tmp/_142/oldpath.mjs
OLD-PATH(createWasmRuntime, no injection) probe_fixtype.js -> COMPILE_FAIL: Line 3: Undefined var FIX_PAR
OLD-PATH(createWasmRuntime, no injection) probe_inview.js  -> COMPILE_FAIL: Line 3: strings cannot be used as a function argument
OLD-PATH(createWasmRuntime, no injection) probe_mask.js    -> COMPILE_FAIL: Line 3: Undefined var MASK_STACKS
OLD-PATH(createWasmRuntime, no injection) probe_meta.js    -> COMPILE_OK
```

and end-to-end through the pre-fix harness:

```text
$ node tools/pattern_derived_harness.mjs --pattern ~/tmp/_142/probe_inview.js \
    --model titanic --synth silence --frames 4 --mod micLow:sliderLevel
COMPILE_FAIL: Line 3: strings cannot be used as a function argument
```

**(c) A 4-lane meta pack against a 7-field ABI.** The harness packed only
`controllerId / sectionId / fixtureId / viewMask`, so `fixtureTypeId`,
`pixelLocalIndex` and `viewMaskHi` were all zero. This one is the dangerous
fault, because it **compiles**: `probe_meta.js` (`pixelLocalIndex == 0`) was
`COMPILE_OK` on the old path and rendered a silently wrong answer —

```text
PRE-FIX: pixelLocalIndex == 0 probe @ titanic
TOTAL_BRI min/avg/max=245820/245820/245820   →  245820 / 255 = 964 pixels lit
model truth (loadModelForGauge):                 88 pixels have pixelLocalIndex 0
```

**all 964** pixels matched instead of the true **88**. That is exactly the
codex-P0 failure mode — a wrong render with a green exit code. And since all 17
titanic composite views live in `viewMaskHi`, the missing high word meant every
composite view was empty here.

## 2. The fix

Mirrors `_140` exactly, for the same reason: use the engine's own entry points
rather than hand-mirroring passes, so the pass ORDER and the meta ABI cannot
drift into a third copy.

In `tools/pattern_derived_harness.mjs`:

- imports: `createWasmRuntime` + `pathToFileURL` → `WasmHost`,
  `loadModelForGauge`, `buildMetaArray`, `buildMaskConstants`,
  `createBitFreeViewPromoter`. All at top of file, none wrapped.
- model load: `loadModelForGauge(modelName)` supplies resolved `pixels`,
  `groupBits`, `viewMasks`, `metaArray` and `fixtureConstants`. The 4-lane
  hand-pack is gone — `loaded.metaArray` is the loader's full 7-field pack.
- view table assembled exactly as `engine.js` does: base groups at word 0, each
  resolved preset at its authored word.
- host wiring: `setCoords` / `setPixelMeta` / `setMaskConstants` /
  `setFixtureConstants` / `setViewTable` / `setBitFreeViewPromoter`, then
  `host.compile(src)` — which applies `injectInViewIntrinsic` →
  `injectMaskConstants` → `injectFixtureConstants` in the engine's order.
- post-compile: `if (host.metaDirty) host.setPixelMeta(buildMetaArray(px))`,
  mirroring `engine.js` `repackMetaIfDirty`. As in `_140` this is a correctness
  guard, not a measured path — no tracked model exposes a bit-free view here.
- render loop: `rt.*` → `host.*(handle, …)`; teardown `host.destroy(handle)` +
  `host.shutdown()`.
- header doc block gains the same "TARGETING PARITY" section `_140` added to
  the audio harness.

**Loud-failure surface, no fallbacks anywhere:**

| Condition | Before | After | Measured |
|---|---|---|---|
| missing model file | `MODEL_FAIL:` exit 2 | unchanged | `MODEL_FAIL: no model file …\models\no_such_model.js`, exit 2 |
| model exists but does not resolve | not reachable — raw import | `MODEL_FAIL: <model> failed to load: <reason>` exit 2 (new) | `MODEL_FAIL: titanic.effects failed to load: Model titanic.effects must export a pixels array`, exit 2 |
| `pixels[]` missing a required field | `MODEL_FAIL:` exit 2 | unchanged | — |
| declared `pixelCount` ≠ `pixels.length` | silently used `pixels.length` | `MODEL_FAIL:` exit 2 (new) | guard only; all three shipped models agree |
| unknown `inView("X")` | compiler noise about strings | `COMPILE_FAIL: Pattern references unknown view(s) …` + full known-view list, exit 2 | §3.3 |
| unknown `MASK_*` / `FIX_*` | `Undefined var …` | `COMPILE_FAIL:` exit 2 | — |
| missing pattern file | `PATTERN_FAIL:` exit 2 | unchanged (this harness already had it) | `PATTERN_FAIL: no pattern file …\patterns\does_not_exist.js`, exit 2 |

The one `try/catch` added wraps `await loadModelForGauge(...)` only, to convert
a throw into the harness's documented `MODEL_FAIL` + exit 2 contract. No import
is wrapped; nothing is swallowed.

## 3. Verification — all measured

### 3.1 Existing patterns unaffected — byte-identical

Same argv before and after the edit, MD5 of the trace JSON **and** of the full
stdout. Two patterns × both models, plus a genuinely derived-key run
(`--mod audioClimax:… ,audioRiserScore:…`, 200 frames, which exercises the
detector→derived chain) × both models. The derived harness prints **no timing
fields**, so unlike `_140` nothing had to be excluded — stdout compares raw.

| run | trace JSON | stdout (`OUT=` path normalized) |
|---|---|---|
| `25_heartbeat` @ `test_bench` | `82615d797550ecbe0ac03d030e5b68f9` **IDENTICAL** | `b95c5cbbafbff478caf7643b8962d3c8` **IDENTICAL** |
| `25_heartbeat` @ `titanic` | `27d28ec942a4969507a9f3054020a38d` **IDENTICAL** | `1c57863f4ec32fc61b0598518509d644` **IDENTICAL** |
| `29_kick_shockwave` @ `test_bench` | `a81a79baa06e5e522632c48976a3ee91` **IDENTICAL** | `6eab709ead0ce758a20419327cbcd8b1` **IDENTICAL** |
| `29_kick_shockwave` @ `titanic` | `806dcd591a694f12f83cdc1a0c286692` **IDENTICAL** | `a50d9e251720dc8dce4add02df25af17` **IDENTICAL** |
| `25_heartbeat` + derived mods @ `test_bench` | `369703bc20968fae95aea91b38854d3e` **IDENTICAL** | `6d400dfcee3b83cf4e9584dc30017d93` **IDENTICAL** |
| `25_heartbeat` + derived mods @ `titanic` | `eb1b2b807cf54bb6d0608170ab045f77` **IDENTICAL** | `b8a75c1f0138013f16f085a7ba7f7681` **IDENTICAL** |

The only raw-stdout difference on every run was the echoed `--out` path
(`base_*` vs `after_*`), which is by construction:

```text
$ diff base_25_heartbeat_titanic.out after_25_heartbeat_titanic.out
11c11
< OUT=…/base_25_heartbeat_titanic.json
---
> OUT=…/after_25_heartbeat_titanic.json
```

*Why identical rather than merely close:* exactly one shipped pattern even
mentions `viewMask` (`27_swipe`, in a comment) and none reads `fixtureType`,
`pixelLocalIndex` or `inView` — `grep -ln "viewMask\|fixtureType\|pixelLocalIndex\|inView(" patterns/*.js`
returns one file. Every tracked model is the new export format, so
`derivePixelLocalIndices` yields the same values the old pack claimed to, and
`pixelCount === pixels.length` on all three models. Timing does not enter this
harness's output at all.

### 3.2 `inView()` compiles, renders, and hits the right pixels

The derived harness's trace stores per-frame TOTAL brightness, not per-pixel
colour, so the probes light their target set full-red and nothing else —
`totalBri / 255` is then exactly the member count.

```text
$ node tools/pattern_derived_harness.mjs --pattern ~/tmp/_142/probe_inview.js \
    --model titanic --synth silence --frames 4 --mod micLow:sliderLevel
COMPILE_OK
SYNTH=silence MODEL=titanic PIX=964 FRAMES=4@40fps peakChan=255
TOTAL_BRI min/avg/max=97920/97920/97920 (LOW-VARIATION)
exit=0

Hull Canvas only:  TOTAL_BRI 91800  → 360 px
Stacks only:       TOTAL_BRI  6120  →  24 px
both (union):      TOTAL_BRI 97920  → 384 px = 360 + 24, so DISJOINT
```

against the model's own membership read back through `loadModelForGauge`:

```text
Hull Canvas word=1 bit=0x400 members=360
Stacks      word=1 bit=0x40  members=24
overlap=0
```

Exact match on both counts, and both views resolve out of the **high** word
(`viewMaskHi`), so the word-aware path is the one being exercised.

`MASK_*` also works now (pass 2): `viewMaskHi & MASK_STACKS` → `COMPILE_OK`,
`TOTAL_BRI 6120` = 24 px = the Stacks membership.

### 3.3 Negative control — unknown view fails loudly

```text
$ node tools/pattern_derived_harness.mjs --pattern ~/tmp/_142/probe_badview.js \
    --model titanic --synth silence --frames 4 --mod micLow:sliderLevel
COMPILE_FAIL: Pattern references unknown view(s) via inView(): No Such View. Known views for
this model: Left Back Wall, Left Front Wall, … TE Sign, … Hull Canvas, Left Hull, Right Hull,
Silhouette, … Organs, … Identity, Stacks, Left Stacks, Right Stacks, Auditoriums
exit=2
```

Named offender, full known-view list, non-zero exit. Never a constant-false test.

### 3.4 `fixtureType` / `pixelLocalIndex` now read true

```text
                                     harness        model truth (loadModelForGauge)
fixtureType == FIX_PAR      TOTAL_BRI 10200 →  40   fixtureTypeId histogram {0:148, 1:320, 2:40, 3:96, 4:360}, FIX_PAR = 2 → 40
pixelLocalIndex == 0        TOTAL_BRI 22440 →  88   88 pixels carry pixelLocalIndex 0 (one per fixture)
```

Both exact. Compare §1(c): the same `pixelLocalIndex` probe reported **964**
before the fix, and the `FIX_PAR` probe did not compile at all.

### 3.5 Test suites

| Suite | Result |
|---|---|
| `tests/tools/*.test.mjs` (incl. the new file) | **12 / 12 pass** — `_140`'s baseline of 8, plus my 4 |
| `tests/mixer/*.test.js` | **492 / 492 pass, 0 fail** |
| `tests/patterns/*.test.js` | **94 / 95 pass, 1 fail** — the same pre-existing `specialty_white_uv` playlist-parity red `_140` documented in its §4.5 (pure `simulation/scenes/**` YAML data, no engine code; unchanged by this work and out of my scope — `_141` owns `simulation/`) |

New regression test `tests/tools/derived_harness_inview_injection.test.mjs`,
next to `harness_inview_injection.test.mjs`, same subprocess shape. Four tests:
(1) `inView()` compiles and lights exactly the two views' member sets, with the
union proving disjointness; (2) `MASK_*` + `FIX_*` resolve and the
`fixtureType` / `pixelLocalIndex` lanes read true; (3) an unknown view name is
a `COMPILE_FAIL` naming the view, exit 2; (4) a model that exists but does not
resolve is a named `MODEL_FAIL`, exit 2. Every expected count is read from
`loadModelForGauge` at runtime, so the test stays honest if titanic is
re-authored. `--frames 2 --synth silence` keeps each subprocess ~90–150 ms.

### 3.6 Callers — none in code

`grep -rl pattern_derived_harness` over the repo returns **nine** files: this
harness, and eight `.agent/` docs/reports/plans. **No script, test or tool
spawns it** (unlike the audio harness, which `tools/gallery/gen_variations.mjs`
shells out to). The `--pattern/--synth/--model/--frames/--mod/--set/--bpm/--out`
flags, every printed line format and the exit-code contract are unchanged, so
even a caller landing later inherits the fix. The one documentation caller,
`.agent/skills/highdef_pattern_generation.md` §8.3, is updated (§4).

### 3.7 Other models still load

```text
studio_top_loft   SYNTH=silence MODEL=studio_top_loft PIX=252 FRAMES=4@40fps peakChan=66
summer_camp_dome  SYNTH=silence MODEL=summer_camp_dome PIX=266 FRAMES=4@40fps peakChan=67
dev_test_bench    MODEL_FAIL: dev_test_bench failed to load: groupBits out of sync with
                  model — missing: [] stale: [ParLights, VintageLights, BarLights, LED_0]
```

Reported honestly: `dev_test_bench` used to "work" here (with `vMask: 0` on
every pixel) and is now a loud `MODEL_FAIL`. That is the **correct** outcome —
its `dev_test_bench.viewmasks.js` sidecar declares four groups the model no
longer has, and the audio harness (post-`_140`), `perf_gauge` and everything
else on `loadModelForGauge` already reject it identically:

```text
$ node tools/pattern_audio_harness.mjs --model dev_test_bench …
MODEL_FAIL: dev_test_bench failed to load: groupBits out of sync with model — missing: [] stale: [ParLights, VintageLights, BarLights, LED_0]
```

`dev_test_bench` is referenced by nothing but its own sidecar (`grep -rl` over
all `.js/.mjs/.yaml/.json`), so this is a dead dev model, not a live rig.

### 3.8 No generated output in the tree

The harness writes only to `--out` (default `$HOME/tmp/derived_vis.json`,
outside the repo) and binds nothing. `git status --porcelain -- marsin_engine/`
after all verification shows exactly the intended surface —
`M marsin_engine/tools/pattern_derived_harness.mjs` and the new untracked
`marsin_engine/tests/tools/derived_harness_inview_injection.test.mjs` — plus
other agents' pre-existing entries. No tracked directory accumulated output.

## 4. Skill §8.3 update

§8.3 carried no limitation note (unlike §8.2 pre-`_140`), so nothing had to be
retracted. It gains a measured "Targeting parity" block: the three injection
passes now run, the measured numbers (360 / 24 / 384, `MASK_STACKS` → 24,
`FIX_PAR` → 40, `pixelLocalIndex == 0` → 88), the loud-failure contract, the
pinning test, and a short statement of what the old behaviour actually was.
**§8.2 was not touched.**

## 5. Security check

```text
$ python scripts/security_check.py --all
WRN leaks found: 6
```

**6 findings — exactly the stated baseline**, all `bm26-mac-address` in the
UNTRACKED `simulation/.scene_backups/studiodj/**` backup snapshots. Zero new
findings; nothing I wrote contains an address, MAC or secret.

## 6. Left open / refused

1. The bit-free (Tier-A) view **promotion** path is wired (promoter + meta
   re-pack) but **not measured** — same honest caveat as `_140` §6.2:
   `loadModelForGauge` does not add the engine's auto-views, and every tracked
   view resolves to a real bit. A correctness guard, not a measured path.
2. `pixelCount ≠ pixels.length` is likewise a guard — all three shipped models
   agree, so the branch is unreachable today.
3. The `specialty_white_uv` playlist-parity red (§3.5) is pre-existing and
   lives in `simulation/scenes/**`, which is `_141`'s territory this wave. Not
   touched.
4. `dev_test_bench`'s stale sidecar (§3.7) is a real, pre-existing data bug in
   a dead dev model. Not fixed here — it is not this task, and "fixing" it
   would mean editing a model file no live path uses.
5. Per the brief: **no git operation of any kind** — staging, committing and
   branch work stay with the operator.
