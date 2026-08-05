# `_147` — the offline `inView()` catalog is now the engine's catalog

**Date:** 2026-08-04 · **Branch:** `feat/bm_readiness`

**Scope (operator-commissioned):** close the harness↔engine parity gap `_146`
§4 measured. `engine.js` built its `inView()` view table from `groupBits` +
`viewMasks` **after** appending `deriveAutoViews(...)` — 60 resolvable names on
titanic. The three offline tools built theirs from `loadModelForGauge()` alone,
which never calls `deriveAutoViews`, so they held **31**. A pattern author
following the rewritten docs (`LEFT` / `RIGHT` / `FRONT` / `BACK` / `Strands` /
`TE Signs` / `WALLS` / `@BAR`) got a `COMPILE_FAIL` offline for a view that is
perfectly valid on the rig.

**No git operation of any kind. No engine boot, no sim boot, no server, no port
bound, no deploy, no install.** Everything below ran in-process or as an offline
subprocess against the vendored WASM; the operator's stack kept 6966–6972, 5568,
8081 and 10000 throughout. Scratch lived in `~/tmp/_147`.

**Files written (eight):**

| File | What |
|---|---|
| `marsin_engine/lib/view_catalog.js` | **new** — the shared sequence |
| `marsin_engine/engine.js` | now calls it (2 call sites, 1 import) |
| `marsin_engine/tools/pattern_audio_harness.mjs` | calls it; promoter gains `groupBits` |
| `marsin_engine/tools/pattern_derived_harness.mjs` | same |
| `marsin_engine/tools/param_truth/render_context.js` | same |
| `marsin_engine/tests/tools/view_catalog_parity.test.mjs` | **new** — 8 parity tests |
| `marsin_engine/tests/tools/harness_inview_injection.test.mjs` | +2 tests |
| `marsin_engine/tests/tools/derived_harness_inview_injection.test.mjs` | +1 test |

Plus `.agent/skills/highdef_pattern_generation.md` §8.2/§8.3 catalog-parity
notes, the regenerated `tools/param_truth/param_truth_results.{md,json}`
snapshots, this report and the tracker block.

---

## 1. Design choice — ONE shared helper, and engine.js uses it too

The brief allowed a mirrored copy as a fallback. I did **not** take it: a fourth
hand-written copy of the catalog sequence is exactly the class of bug `_140` and
`_142` had just killed for the injection *passes*, and it would have drifted the
same way the moment `_145` re-shaped the catalog.

`marsin_engine/lib/view_catalog.js` exports three functions:

- `appendAutoViews(pixels, viewMasks, groupBits)` — seeds `existingMaskNames`
  from base group names + resolved preset names, calls `deriveAutoViews`, pushes
  the entries onto `viewMasks` in order, returns the raw result so the caller
  can surface `warnings` + the family summary.
- `buildViewTable({ groupBits, viewMasks })` — base groups at word 0, every
  preset/auto-view at its authored `{ bit, word }`, bit-free views at `bit: 0`.
- `buildViewCatalog(loaded)` — the two above, in order. The tools' single call.

`engine.js` calls the **two primitives** (its logging sits between them and its
inline `deriveAutoViews` import is gone); the three tools call the composed
`buildViewCatalog`. So the tools' path is *literally* the engine's two
primitives in the engine's order — parity is structural, not a promise.
`deriveAutoViews` itself was not touched, and the view catalog was not changed.

`grep` over the repo now finds `viewTable[...]` construction in exactly **one**
production file (`lib/view_catalog.js`); `deriveAutoViews` has exactly one
production caller (the same file). The only other `setViewTable` calls are
`engine.js` consuming `model.viewTable` and three synthetic tables inside
`tests/mixer/in_view_intrinsic.test.js`.

### 1.1 A second, unrelated parity bug found and fixed in passing

All three tools wired the bit-free-view promoter as
`createBitFreeViewPromoter({ pixels, viewMasks }, host)` — **without
`groupBits`**, where `engine.js` passes its whole model. The promoter seeds its
`ViewBitAllocator` from every bit already claimed; with `groupBits` missing it
could hand a promoted Tier-A view a bit a base group already owns. It was
unreachable before (no offline table held a bit-free view, so nothing ever
promoted) and becomes reachable the moment the auto-views land — so all three
now pass `groupBits`.

## 2. engine.js behaviour is unchanged — proved, not asserted

Before touching `engine.js` I copied its inline sequence (lines 560-575 and
622-634) **verbatim** into a scratch reference module and dumped, per model, the
full `viewTable`, the auto-view names + count, the family summary string, the
warnings, the post-append `viewMasks` name list, and the `MASK_*` constant
names. After the refactor the same six artifacts were rebuilt through
`buildViewCatalog` and JSON-compared:

```text
$ node ~/tmp/_147/parity_check.mjs
titanic:         names=60 autoViews=29 maskConstants=31 -> IDENTICAL
test_bench:      names=20 autoViews=9  maskConstants=11 -> IDENTICAL
studio_top_loft: names=13 autoViews=5  maskConstants=8  -> IDENTICAL
PARITY_OK (pre-refactor engine sequence == lib/view_catalog.js)
```

Three further reasons the extraction is safe:

- The push loop moved from inside `if (autoViews.entries.length > 0)` into the
  helper. Iterating an empty array pushes nothing, so the guard was decorative.
- `buildMaskConstants` **skips** `bit: 0` entries by design (a `MASK_X = 0`
  would be the silent zero it forbids), so appending the bit-free auto-views
  cannot move the `MASK_*` table — measured above, identical on all three models.
- `node --check` clean on `engine.js` and all four touched tool/lib files.

## 3. Verification — every number measured

### 3.1 Both harnesses, titanic

Audio harness (`--synth silence --frames 4`), lit-pixel counts read from the
capture JSON:

```text
inView("LEFT")        COMPILE_OK  LIT=482/964
inView("RIGHT")       COMPILE_OK  LIT=482/964
inView("Strands")     COMPILE_OK  LIT=320/964
inView("TE Signs")    COMPILE_OK  LIT=148/964
inView("FRONT")       COMPILE_OK  LIT=388/964
inView("Hull Canvas") COMPILE_OK  LIT=360/964     ← positive control, unchanged
```

Set algebra straight from the captures:

```text
LEFT 482 · RIGHT 482 · LEFT ∩ RIGHT = 0 · LEFT ∪ RIGHT = 964 of 964
Strands 320 · TE Signs 148 · Strands ∩ TE Signs = 0
```

Derived harness (`--mod micLow:sliderLevel`), `TOTAL_BRI / 255` = member count:

| probe | TOTAL_BRI | pixels |
|---|---:|---:|
| `inView("LEFT")` | 122910 | **482** |
| `inView("RIGHT")` | 122910 | **482** |
| `inView("Strands")` | 81600 | **320** |
| `inView("TE Signs")` | 37740 | **148** |
| `inView("FRONT")` | 98940 | **388** |
| `inView("Hull Canvas")` | 91800 | **360** |

Every figure matches the operator's spec and `_146`'s independent registry dump.

### 3.2 `render_context.js` (the param_truth path)

`patterns/examples/inview_demo.js` (which `_145` re-pointed at `LEFT`) is the
real probe — it is discovered by `pattern_discovery.js` and swept:

```text
$ node tools/param_truth/run_param_truth.mjs --pattern examples/inview_demo --out ~/tmp/_147/pt_inview
param_truth: model=titanic patterns=1
  [1/1] examples/inview_demo
patterns ok 0, compile errors 0, no params 1
```

**`compile errors 0`** — it used to be the sweep's single compile error. The
full sweep (§5) confirms it at scale: `compile errors 1 → 0`. The
`view_catalog_parity` test additionally drives `createRenderContext('titanic')`
in-process and asserts its error's known-view list equals the shared catalog.

### 3.3 Offline table vs engine table — exactly equal, 60 = 60

Built in-process from the same library functions `engine.js` imports; no engine
booted, no port bound. `tests/tools/view_catalog_parity.test.mjs` asserts
`deepEqual` on both the **key order** and every `{ bit, word }`, against a
reference transcription of engine.js's sequence that deliberately does *not*
route through the shared helper (otherwise it would prove nothing):

```text
✔ the shared view catalog matches the engine's construction on titanic
✔ the shared view catalog matches the engine's construction on test_bench
✔ the shared view catalog matches the engine's construction on studio_top_loft
```

titanic: **60** names = 24 base groups + 7 composites + 29 auto-views
(spatial 4, structural 2, typed 5, controller 18). test_bench 20, studio_top_loft 13.
Both harnesses' real `Known views for this model:` lists are asserted equal to
that same table, whole and in order.

### 3.4 Negative control — still loud, and now complete

```text
$ node tools/pattern_audio_harness.mjs --pattern <inView("No Such View")> --model titanic …
COMPILE_FAIL: Pattern references unknown view(s) via inView(): No Such View. Known views for this
model: Left Back Wall, Left Front Wall, Left_Front_Left, Left_Back_Left, Left_Back_Right,
Left_Front_Right, Right_Back_Left, Right_Back_Right, Right_Front_Right, Right_Front_Left, TE Sign,
Right SmokeStacks, Left Small SmokeStack, Right Small SmokeStack, Right Front Wall,
Right Front Rails, Right Auditorium, Left Auditorium, Right Back Wall, Left SmokeStack,
Left Front Rails, Right Back Rails, Left Back Rails, TE Sign 2, Hull Canvas, Silhouette, Jewelry,
Organs, Identity, Stacks, Auditoriums, LEFT, RIGHT, FRONT, BACK, WALLS, AUDITORIUM, TE Signs,
@BAR, @PAR, @VINTAGE, Strands, CTRL_1 … CTRL_18
exit=2
```

Byte-identical output from the derived harness. **60 names listed** (was 31),
the offender is named, exit 2 — never a silent constant-false test.

### 3.5 Byte-stability — existing patterns unaffected

Two patterns × two models × each harness, same argv before and after
(`--synth full_track --frames 40`), per `_140`/`_142`'s method:

| run | capture/trace JSON |
|---|---|
| `27_swipe` @ `test_bench` (audio) | `8eb3e221037ddb485e2005df29a243f5` **IDENTICAL** |
| `27_swipe` @ `titanic` (audio) | `2839bb30956a9d1f82fa01ff2f0a0ffc` **IDENTICAL** |
| `44_biolume_swell` @ `test_bench` (audio) | `2c4cc4e20ed6499dd3b41eb336fec3b2` **IDENTICAL** |
| `44_biolume_swell` @ `titanic` (audio) | `b213c4a97b21733ae55fc697f793cd2c` **IDENTICAL** |
| `25_heartbeat` @ `test_bench` (derived) | `847ffddc12064e4c1bd09a22a8c9e491` **IDENTICAL** |
| `25_heartbeat` @ `titanic` (derived) | `cab1a925a902f543d35c60971d0f3b5a` **IDENTICAL** |
| `29_kick_shockwave` @ `test_bench` (derived) | `33b576214132bc9c39800a243e582f48` **IDENTICAL** |
| `29_kick_shockwave` @ `titanic` (derived) | `cf9467e9a8c8ef2c955fb82a48314dda` **IDENTICAL** |

(The four audio MD5s are the *same values `_140` recorded* — the baseline is
demonstrably intact across three threads.)

**Derived-harness stdout** differs on exactly one line, the echoed `--out` path,
which is by construction — the same single-line delta `_142` documented.
**Audio-harness stdout** differs on the `--out` path plus `meanMs`/`worstMs`,
which always move (e.g. `27_swipe` @ titanic `meanMs 0.72 → 0.70`); every
`LIT` / `TOTAL_BRI` / `QUALITY` / `GATE` verdict line is identical.

**One deliberate new output, on stderr only.** `deriveAutoViews` emits warnings
(`test_bench`: two controllers straddle the centreline); the engine prints them
and dropping them offline would be a silent difference. They go to
`console.warn` → **stderr**, so stdout stays byte-stable for every caller.
Measured: `titanic` 0 bytes of stderr, `test_bench` 184 bytes —

```text
[Model] auto-view: controller 1 has pixels on BOTH halves — LEFT/RIGHT cross its boundary
[Model] auto-view: controller 2 has pixels on BOTH halves — LEFT/RIGHT cross its boundary
```

`tools/gallery/gen_variations.mjs` spawns the audio harness with
`stdio: 'inherit'` and parses nothing, so its contract is untouched.

### 3.6 Test suites

| Suite | Result | Baseline |
|---|---|---|
| `tests/tools/*.test.mjs` | **23 / 23 pass** | 12 → +11 (mine) |
| `tests/mixer/*.test.js` + `*.test.mjs` | **510 / 510 pass** | 510/510 — exact |
| `tests/patterns/*` | **95 / 95 pass** | was 94/95 (the `specialty_white_uv` red is gone — fixed by another thread, not by me) |
| `marsin_engine && npm test` (run 1) | **2657 · pass 2650 · fail 7** | 2643 / 7 |
| `marsin_engine && npm test` (run 2) | **2654 · pass 2647 · fail 7** | |

The +11 in `tests/tools` is mine: 2 auto-view tests in the audio file, 1 in the
derived file, 8 in the new parity file.

**Accounting for every delta.** Run 2's total, **2654 = 2643 + 11**, closes
exactly on my contribution. Run 1 reported **2657** — the full-suite total is
**not deterministic on this box**: two identical runs of the same tree differed
by 3. The cause is file-level aborts (`tests/effects/effects_v2_mode_page_layout.test.js`
fails at file level, so its inner tests are never counted), which vary with
load. I touched no test outside `tests/tools`, and the ±3 is inside that
observed run-to-run variance.

The **7 failures are identical in both runs** and are exactly the documented
environmental set — 5 × `tests/audio/audio_capture.test.js`
(`device_not_configured`), the `effects_v2_mode_page_layout` file-level
deserialize error, and `tests/io/osc_listener.test.js` `EADDRINUSE` against the
operator's live stack. **Zero view-related failures.** The
`fire_sync_listener` edge test `_146` saw flake did **not** flake in either run.

**Runtime residue.** `marsin_engine/states/titanic/mixer_state.yaml` was already
modified when this thread started (md5 `36c7f448f861e90baca2540e7d091872`) and
is **byte-identical after** two full `npm test` runs — my runs produced no new
residue. Reported, never reverted.

### 3.7 Security check

```text
$ python scripts/security_check.py --all
INF scanned ~83355387 bytes (83.36 MB) in 1.41s
WRN leaks found: 6
```

**6 — exactly the baseline**, all `bm26-mac-address` in the UNTRACKED
`simulation/.scene_backups/studiodj/**` snapshots. Zero new findings; nothing I
wrote contains an address, MAC or secret.

## 4. Tests added

`tests/tools/view_catalog_parity.test.mjs` (new, 8 tests):

1-3. the shared catalog `deepEqual`s an independent transcription of engine.js's
sequence, per model (titanic / test_bench / studio_top_loft) — names, order and
every `{ bit, word }`;
4. titanic's catalog exceeds its bit-backed names and carries `LEFT`, `RIGHT`,
`FRONT`, `BACK`, `Strands`, `TE Signs`, `WALLS`, `@BAR`, each at `bit: 0`;
5-6. each harness's *real* `Known views` list (read out of its loud
`COMPILE_FAIL`) equals the shared table, whole and in order;
7. `param_truth`'s `createRenderContext` compiles `inView("LEFT")` and lists the
same catalog on an unknown name;
8. assembling the catalog twice for one model **throws** (a double append would
register every auto-view twice).

`harness_inview_injection.test.mjs` (+2): `LEFT` and `Strands` each compile and
light exactly their member count, with nothing outside the view lit; the
unknown-view error must name both derived views in its known-view list.
`derived_harness_inview_injection.test.mjs` (+1): the same two views through the
`TOTAL_BRI` route, plus the same known-view-list assertion.

Every expected count is read from the shared catalog at run time, so the tests
stay honest if titanic is re-authored.

## 5. The `_146` cleanup item — stale param_truth snapshots

`tools/param_truth/param_truth_results.{md,json}` are tracked generated
snapshots that still recorded `examples/inview_demo` failing with
`inView(): PORT`, against a superseded titanic (`981` px, `* Generator` group
names). Regenerated through the canonical generator, fully offline (sharded
subprocesses, no socket, no port):

```text
$ node tools/param_truth/sweep_all.mjs
param_truth: model=titanic workers=12 cross-model=test_bench
TRUE 579 · WEAK 37 · WRONG 47 · DEAD 112 · UNKNOWN_CLAIM 42
  of the DEAD, 80 are alive on test_bench (model coverage, not a broken control)
patterns ok 125, compile errors 0, no params 26, params 817
took 161.7s
```

Header now reads `Model titanic (964 px)` (was 981) and `compile errors 0` (was
1). `grep -c PORT` over both files → **0**; `grep -c Generator` → **0**. The
stale reference `_146` flagged is gone.

Worth an operator eye, though it is a *measurement* not a regression: the
verdict census moved (`WRONG 39 → 47`, `DEAD 170 → 112`, `TRUE 548 → 579`).
That is the honest re-measurement of the current 964-px titanic against a
snapshot taken on the old 981-px model, with the intervening pattern edits — not
something this change caused. `tests/patterns/param_truth_smoke.test.js`
deliberately pins no census, and it is green.

## 6. Left open / refused

1. **`docs/MARSIN_ENGINE_PATTERNS.md` needed no change** — it carries no stale
   claim about the offline harnesses. Only
   `.agent/skills/highdef_pattern_generation.md` §8.2/§8.3 (the pattern-author
   entry point, which does make measured harness claims) gained a catalog-parity
   note. `_146`'s §4 finding is now false by construction; the report is left
   intact as the historical record.
2. **The bit-free promotion path is now MEASURED, not just wired.** `_140` §6.2
   and `_142` §6.1 both had to caveat it as an unexercised correctness guard,
   because no offline table held a bit-free view. Every `LEFT` / `Strands` /
   `FRONT` probe above promotes one on demand and re-packs the meta — the caveat
   is retired.
3. **`marsin_engine/tests/mixer/model_loader_word_aware.test.js`** shows as
   modified in the working tree and is **not mine** — it is `_145`-authored
   content (7 composites / 31 names) that the session-start status snapshot
   omitted. Untouched by me; flagged so it is not misattributed.
4. Per the brief: **no git operation of any kind** — staging, committing and
   branch work stay with the operator.
