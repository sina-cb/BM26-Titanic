# 2026-06-18 — Validation + Performance-Regression Gauge for the MarsinScript Pipeline

Role: validator / investigator. Scope: define the **validation + performance-regression
methodology** that proves three in-flight MarsinScript pipeline efforts are correct and
non-regressing, before any of them is declared merge-ready.

The three efforts (all touch compiler → bytecode → VM):

- **Task 1 — Fixture-type metadata**: model-independent fixture-type carried
  scene → compiler → bytecode → pixel.
- **Task 2 — Expanded + named masks**: lift the mask-count ceiling; reference masks by name.
- **Task 3 — Strings**: MarsinScript string support via compile-time interned string
  handles, zero cost on the 40 fps hot path.

**Investigation/design only.** No production source was modified, no git ops run. All
prototypes live in `~/tmp/` (gitignored). One side effect: `marsin_engine/npm install`
populated `marsin_engine/node_modules/` (gitignored) — expected dev residue, not committed.

---

## 1. What exists today (inventory, file:line)

### Pipeline shape (the thing under test)

- **VM / compiler entry point**: `marsin_engine/lib/wasm_host.js`. `WasmHost.compile()`
  (`wasm_host.js:82`) is the single funnel every compile path goes through (boot pattern,
  mixer channels, live-edit API, blends/transitions). It calls `injectMaskConstants()`
  then `marsin_compile` in WASM. Per-frame hot path: `beginFrame()` (`:102`) +
  `renderAll6ch()` (`:108`).
- **Alt runtime wrapper**: `marsin_engine/lib/marsin_wasm_runtime.js` (`createWasmRuntime`,
  same WASM, used by some tests/tools). Two wrappers over the same `.wasm` — keep both in
  sync when the ABI changes.
- **WASM ABI** (exported C funcs, grepped from `marsin_pb/wasm/marsin-engine.cjs`):
  `marsin_compile`, `marsin_get_error`, `marsin_destroy_vm`, `marsin_begin_frame`,
  `marsin_render_pixel`, `marsin_render_all`, `marsin_render_all_with_meta`,
  `marsin_render_all_with_meta_6ch`, `marsin_render_blend_6ch`, `marsin_set_control`,
  `marsin_get_exports_json`. **There is NO bytecode-size or bytecode-dump export** (see §3
  blocker).
- **Per-pixel metadata into the VM**: `wasm_host.js:224` `setPixelMeta()` packs **exactly 4
  Int32 per pixel** — `controllerId, sectionId, fixtureId, viewMask`. The model pixel
  already carries `fixtureType: "UkingPar"` as a **JS-side string** (verified:
  `models/test_bench.js` pixel0 has `fixtureType`, `group`, `vMask`) but **that string never
  reaches the VM** — only `fId` does. This is the crux linking Task 1 and Task 3.
- **Mask system (already compile-time injection)**: `marsin_engine/lib/view_mask_constants.js`.
  `buildMaskConstants()` (`:40`) builds a `{MASK_NAME: bit}` table from model group bits +
  view-mask presets; `injectMaskConstants()` (`:92`) prepends `var MASK_X = <bit>;` only for
  referenced names, fails loudly on unknown names (codex P0), pattern-declared values win.
  **The mask is a single Int32 (`viewMask`) → hard ceiling of 32 masks.** This is exactly
  the limit Task 2 must lift. Named masks already exist (`MASK_*`); Task 2 expands count +
  naming, so it is a direct evolution of this file, not a greenfield.

### Existing tests / auto-checks

- **Engine auto-check spec**: `.agent/00_gol/05_marsin_engine_auto_checks.md`. Required before
  commit: `git diff --check`, `node --check` on changed JS, `node engine.js --list`,
  `node engine.js --pattern test_const --model test_bench --dry-run` (must exit 0, no missing
  blend warning), HIL transition test when mixer/blend behavior changed, and confirm tracked
  `states/test_bench/*.yaml` unchanged.
- **Mask correctness oracle**: `marsin_engine/tests/view_mask_constants.test.js` — 18 unit
  tests including **3 end-to-end through the real WASM compiler** (`:149`, `:163`, `:183`):
  injected constant compiles+renders, pattern value overrides injected value, unknown name is
  a loud compile failure. This is the template + anchor for Task 2's correctness checks.
- **Transition pixel-perfect oracle**: `marsin_engine/tests/transitions_pixel_perfect.test.js`
  — runs every transition through the WASM host directly with deterministic FROM/TO buffers,
  asserts byte-exact endpoints. **This is the model template for the new golden-frame oracles
  all three tasks need.**
- **Mixer masking**: `marsin_engine/tests/pattern_mixer_masking.test.js` (per-layer masked
  commit, PFL/deck blackout, malformed-payload rejection).
- **HIL (live integration, port 6968)**: `marsin_engine/tests/hil/` —
  `hil_transition_pixel_perfect_test.mjs`, `hil_channel_isolation_test.mjs`,
  `hil_deck_swap_test.mjs`, `hil_playlist_swap_cycles_test.mjs`,
  `hil_add_button_latency_test.mjs`, `hil_liveparams_split_test.mjs`,
  `hil_ws_audio_settle_test.mjs`. Need a running engine.
- **Full node suite**: `node --test tests/*.test.js` → **750 tests** (audio, mixer,
  param-center, routing, etc.).
- **package.json gap**: `marsin_engine/package.json` ships only `start` + pattern shortcuts +
  three `check:<pattern>` dry-runs. It does **NOT** define the `check`, `check:syntax`, or
  `test:hil:transition` scripts the auto-check spec (`05_*.md:40-51`) calls for, and there is
  **no `npm test` wired to `node --test`**. Adding these is a prerequisite for a clean gate.

### Existing perf instrumentation

- **None for the compiler/VM.** No benchmark harness, no timing assertions, no bytecode-size
  tracking anywhere in `marsin_engine/tests/` or `tools/`. The engine targets 40 fps
  (`07_run_marsin_engine.md`, `08_patterns.md`) but nothing measures per-frame compute or
  fails on regression. **This methodology introduces the first perf gauge for the pipeline.**

---

## 2. Baseline numbers (measured this session)

Environment: Node v22.22.2, Linux, single core wall-clock. Harness loads `WasmHost` directly
(no engine `node_modules` needed for the VM — the `.wasm` is vendored). Prototype:
`~/tmp/bench.mjs`. Per-frame = `beginFrame()` + `renderAll6ch()` into a reused buffer; compile
= median of 7; 2000 frames after a 100-frame warmup. **Budget at 40 fps = 25.0 ms/frame.**

| Model / pattern | px | compile ms | frame mean ms | p50 | p95 | p99 | max | p99 headroom |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| test_bench / 27_swipe | 52 | 0.678 | 0.1798 | 0.170 | 0.234 | 0.256 | 0.740 | 99.0 % |
| test_bench / 01_cylon_sweep | 52 | 0.420 | 0.0190 | 0.014 | 0.032 | 0.047 | 0.563 | 99.8 % |
| test_bench / 11_bioluminescence | 52 | 0.581 | 0.0256 | 0.018 | 0.045 | 0.061 | 0.594 | 99.8 % |
| test_bench / 26_dom_dancers_chevron | 52 | 1.054 | 0.4585 | 0.448 | 0.509 | 0.738 | 1.019 | 97.0 % |
| titanic / 27_swipe | 972 | 0.574 | 0.1296 | 0.113 | 0.196 | 0.218 | 1.267 | 99.1 % |
| titanic / 01_cylon_sweep | 972 | 0.388 | 0.2495 | 0.244 | 0.278 | 0.309 | 0.749 | 98.8 % |

Reading these:

- **The VM is ~100–1300× under the 40 fps budget.** Even the heaviest pattern
  (`26_dom_dancers_chevron`, with nested per-pixel work) runs at p99 = 0.74 ms vs 25 ms
  budget. This is the headroom the three tasks are spending against — generous, but the codex
  bans silent regression, so we gauge it regardless.
- **`27_swipe` is FASTER on titanic (972 px) than on test_bench (52 px)**: 0.13 ms vs 0.18 ms.
  Reason: the pattern's `render3D` P0 self-filter (`27_swipe.js:169`) early-returns black for
  any `fixtureId` outside 1–8, and most titanic pixels miss the lanes. **Lesson for the gauge:
  always A/B the *same* (model, pattern) pair — cross-pattern/model comparison is meaningless.**
- **Determinism verified** (`~/tmp/determinism.mjs`): two independent runs of 200 fixed-time-step
  frames produce **byte-identical** output (SHA-256 `aa6d0a79…` both runs). This is what makes
  golden-frame hashing a valid correctness + A/B oracle — see §4.

### Auto-checks run (all green)

- `node engine.js --list` → exit 0, patterns listed.
- `node engine.js --pattern test_const --model test_bench --dry-run` → exit 0, **no missing
  blend warning**, mask presets/groups resolved, "52 pixels (2 special effects)", test pixel
  rendered.
- `node --test tests/*.test.js` → **750 pass, 0 fail** (≈6.0 s).
- WASM probe (`~/tmp/wasm_probe.mjs`): compile + render red works without `node_modules`.

These six rows + the three green auto-checks are the **frozen baseline** the gauge A/Bs against.

---

## 3. Blockers / environment notes (precise)

1. **No bytecode-size accessor in the WASM ABI.** The "bytecode size" deliverable cannot be
   measured through the current ABI — `marsin-engine.cjs` exports no `marsin_get_bytecode_size`
   / dump. To gauge bytecode size you must **add a `marsin_get_bytecode_size(handle)` export to
   the C++ source and rebuild the WASM** (provenance required per `05_*.md` §"Current Fix
   Targets" #4). Until then use the **proxy metrics** in §4.3 (compiled-source byte length +
   `marsin_get_exports_json` length + compile time), which are observable today. Flag this to
   whoever owns the WASM build — it is the single missing instrument.
2. **Full engine + HIL need `node_modules`** (`ws`, `sacn`, `js-yaml`, …). `npm install`
   succeeded here in 3 s (network available), but on the **playa this is forbidden** (codex
   offline rule). Gauge runs in dev/CI only, never as a runtime dependency.
3. **The VM-only harness does NOT need `node_modules`** — it imports `wasm_host.js` and the
   vendored `.wasm` directly. Keep the perf gauge VM-only so it runs even on a bare checkout.
4. **WASM glue uses a hashed filename** (`marsin-engine-Live-<hash>.wasm`); `WasmHost.init`'s
   `locateFile` maps any `*.wasm` correctly, but a naive standalone loader that returns the
   filename verbatim will ENOENT. Always load through `WasmHost`.

---

## 4. The performance gauge (harness + commands + thresholds)

### 4.1 Where it lives

New committed harness: `marsin_engine/tools/perf_gauge.mjs` (VM-only; mirror of the proven
`~/tmp/bench.mjs`). Wire into `package.json`:

```json
"scripts": {
  "test": "node --test tests/*.test.js",
  "check:syntax": "node --check engine.js",
  "check": "npm run check:syntax && node engine.js --pattern test_const --model test_bench --dry-run",
  "perf:baseline": "node tools/perf_gauge.mjs --write-baseline",
  "perf:gate": "node tools/perf_gauge.mjs --gate"
}
```

### 4.2 Benchmark matrix (fixed, representative)

Always A/B the **same** (model, pattern) pairs — never cross-compare:

| Pair | Why it's in the set |
|---|---|
| test_bench / 27_swipe | uses `fixtureId` self-filter + trail ring buffer → Task 1 sensitive |
| test_bench / 26_dom_dancers_chevron | heaviest per-pixel pattern (worst-case hot loop) |
| test_bench / 11_bioluminescence | mid-weight, noise-driven |
| test_bench / 01_cylon_sweep | lightweight baseline (catches per-call overhead regressions) |
| titanic / 27_swipe | 972 px — real deployment scale |
| titanic / 01_cylon_sweep | 972 px lightweight (per-pixel cost isolation) |

Each task adds **one mask/fixture/string-exercising pattern** to the matrix so its own feature
is on the hot path (e.g. a pattern that reads `fixtureType`, references ≥8 named masks, or
holds string handles). A feature that "costs nothing" must prove it on a pattern that uses it.

### 4.3 Metrics captured per pair

1. **compile_ms** — median of 7 compiles via `WasmHost.compile`.
2. **frame mean / p50 / p95 / p99 / max ms** — 2000 frames after 100-frame warmup, fixed dt =
   1/40, output into a reused buffer (no per-frame alloc).
3. **Bytecode-size proxy** (today): compiled-source byte length (post `injectMaskConstants`) +
   `getExports(handle).length`. **True bytecode size** once the ABI export from §3.1 lands.
4. **Correctness fingerprint** — SHA-256 over 200 fixed-step rendered frames (the golden hash;
   see §5). Lets perf and correctness share one harness run.

### 4.4 Thresholds (fail loudly — no warn-and-continue, codex P0)

`perf:gate` reads `tools/perf_baseline.json` (committed, regenerated only via
`perf:baseline` with sign-off) and **exits non-zero** if, for any pair:

- **frame p99 regresses > 8 %** vs baseline p99 (hot-loop guard — the headline gate), OR
- **frame mean regresses > 5 %** vs baseline mean, OR
- **compile_ms regresses > 25 %** vs baseline (compile is off the 40 fps path → looser), OR
- **bytecode-size proxy grows > 15 %** vs baseline, OR
- **absolute p99 ≥ 5.0 ms** on any pair (hard ceiling: 5× safety margin under the 25 ms 40 fps
  budget — even if the relative delta passes, we never quietly burn the deployment headroom).

Percentages are deltas off the per-pair baseline. Margins are wide *because the baseline is
sub-millisecond* — a 5 % regression on 0.02 ms is noise, so the **absolute 5 ms ceiling is the
real backstop** and the relative gates catch order-of-magnitude algorithmic mistakes. The gate
prints the offending pair, baseline vs measured, and the delta, then `process.exit(1)`.

To suppress timing jitter: gate runs each pair **3 times and takes the best (min) p99** before
comparing (best-of-N rejects scheduler noise without hiding real regressions).

### 4.5 A/B procedure (before vs after a task)

```bash
cd marsin_engine && npm install            # dev/CI only
git checkout <base>   && npm run perf:baseline   # writes tools/perf_baseline.json
git checkout <task-branch> && npm run perf:gate  # exits non-zero on regression
```

Because renders are deterministic (§2), the same run also diffs the golden hashes: a changed
hash on a pair the task claims it does **not** affect is an automatic FAIL.

---

## 5. Per-task correctness checklists

Each task is **done** only when its checklist passes AND the §4 gate is green AND back-compat
holds (numeric-only patterns, existing masks/models byte-identical).

### Task 3 — Strings (validate FIRST; foundational)

Tie to: `view_mask_constants.test.js` style (e2e-through-WASM unit tests) + new oracle.

- [ ] **Compile-time interning**: identical string literals → same handle; distinct → distinct.
      New unit test through `WasmHost.compile` + an introspection path.
- [ ] **Zero hot-path cost (P0 claim)**: add a string-holding pattern to the §4 matrix; its
      frame p99 must pass the §4.4 gate vs an equivalent string-free pattern. **A "zero cost"
      claim that isn't measured is rejected.** The handle must be an integer on the VM side —
      no per-frame allocation, no string compare in `render`/`beforeRender`.
- [ ] **Back-compat — numeric-only patterns**: all 6 baseline pairs produce **byte-identical**
      golden hashes (§2) with the string-enabled VM. No bytecode-size growth on string-free
      patterns (§4.4 proxy).
- [ ] **Loud failure**: undefined/typo string handle is a compile-stage error, never a silent
      empty string (codex: no fallback).
- [ ] **Bit-exact ESP32 parity**: if the string table changes the WASM, confirm the same
      compiler/VM is what ships to firmware (the WASM is "bit-exact parity with ESP32",
      `marsin_wasm_runtime.js:5`). Provenance note required if `marsin_pb/wasm/*` changes.
- [ ] All 750 existing tests + `--dry-run` + `--list` still green.

### Task 1 — Fixture-type metadata (validate SECOND; may consume Task 3 string handles)

Tie to: `setPixelMeta` (`wasm_host.js:224`) + dry-run mask/group resolution + new oracle.

- [ ] **Metadata reaches the pixel**: a pattern reading fixture-type sees the value the model
      declared (`fixtureType: "UkingPar"` today is JS-only — confirm the chosen encoding
      actually arrives in the VM). If fixture-type is carried **as a string**, it MUST ride
      Task 3's interned handle (one ABI, one source of truth) — validate that linkage
      explicitly rather than adding a parallel 5th Int32 ad hoc.
- [ ] **Model-independence**: the same pattern behaves correctly across `test_bench`,
      `titanic`, and `summer_camp_*` — fixture-type is resolved from the model, not hardcoded.
- [ ] **Meta-buffer layout change is consistent**: if `setPixelMeta` grows beyond 4 Int32,
      **both** `wasm_host.js` AND `marsin_wasm_runtime.js` (`:134`) must change together, plus
      the WASM ABI; assert buffer length matches on both sides (mismatch must throw at init).
- [ ] **Back-compat**: patterns that never read fixture-type → byte-identical golden hashes;
      `27_swipe`'s `fixtureId`-based self-filter still produces its baseline hash.
- [ ] **Loud failure**: a fixture-type name not in the model is a compile/load error, not a
      silent default (mirror `injectMaskConstants`'s unknown-name throw).
- [ ] Dry-run still prints correct group/preset/pixel-count lines; `--list` + 750 tests green.

### Task 2 — Expanded + named masks (validate THIRD; builds on the mask infra + Task 3)

Tie to: `view_mask_constants.test.js` (extend) + `pattern_mixer_masking.test.js` + dry-run.

- [ ] **Count ceiling lifted correctly**: today `viewMask` is **one Int32 → 32 masks max**.
      The new representation (wider int / array / handle table) must be validated at the
      boundary: define ≥ 33 masks on a model, reference the 33rd by name, confirm it resolves
      and renders. If names route through Task 3 string handles, validate that path.
- [ ] **Named resolution**: `buildMaskConstants` + `injectMaskConstants` behavior preserved —
      referenced-only injection, pattern-declared override wins, sanitized-name collision
      throws, unknown name throws naming the known set (all 18 existing assertions stay green).
- [ ] **Back-compat — existing masks/models**: `test_bench.viewmasks.js` (3 groups + 5 presets,
      bits `0x01`…`0x80`) resolves to the **same** `MASK_*` constants and the dry-run prints
      the same 8 `Pattern constants:`. Existing 32-bit patterns → byte-identical golden hashes.
- [ ] **Mixer integration**: `compileViewSelectionMask` (`pattern_mixer.js:30`) and masked
      commit (`:1447`) handle the wider mask without truncation; `pattern_mixer_masking.test.js`
      green, extended with a > 32-mask selection case.
- [ ] **Loud failure**: overflow / unknown named mask is a hard error, never a silent wrap to 0.
- [ ] `--dry-run` + `--list` + 750 tests green.

---

## 6. Merge-ready go/no-go gate

A task in this trio is **merge-ready** only when **every** item below is true and pasted into
its final report (extends `05_*.md` "What Counts As Done"):

1. `git diff --check -- marsin_engine marsin_pb` — clean.
2. `node --check` on every changed engine JS/MJS/CJS — pass.
3. `node engine.js --list` — exit 0.
4. `node engine.js --pattern test_const --model test_bench --dry-run` — exit 0, **no missing
   blend warning**.
5. `node --test tests/*.test.js` — **750+ pass, 0 fail** (count only grows; a dropped test is a
   no-go).
6. The task's **correctness checklist (§5) fully checked**, including the new e2e-through-WASM
   oracle test committed under `tests/`.
7. `npm run perf:gate` — **exit 0** (no pair regresses past §4.4 thresholds; absolute p99 < 5 ms
   on every pair).
8. **Golden-hash back-compat**: every baseline pair the task claims not to affect produces a
   byte-identical golden hash (§2 determinism makes this exact).
9. HIL transition test green **if mixer/blend/meta-buffer behavior changed**; tracked
   `states/test_bench/*.yaml` unchanged after the run.
10. If `marsin_pb/wasm/*` changed: **provenance note** (source change or rebuild steps) per
    `05_*.md` #4 — mandatory for all three tasks since they touch the C++ compiler/VM.

**Any single failing item is a no-go.** No "warn and merge" — codex P0 bans fallback behavior;
the gate fails loudly or passes silently, nothing between.

### Validation ORDER (dependency-driven)

**Task 3 (strings) → Task 1 (fixture-type) → Task 2 (named masks).**

- **Task 3 is foundational**: interned string handles are the natural carrier for *both*
  fixture-type names (Task 1) and expanded mask names (Task 2). Validate and freeze the string
  ABI first so 1 and 2 build on a proven, gated representation instead of inventing parallel
  ones. Task 3's gate must be green before 1 or 2 are even benchmarked.
- **Task 1 second**: it extends the per-pixel meta buffer and (likely) consumes Task 3 handles
  for the type name; its meta-layout change is independent of masks.
- **Task 2 last**: it's the largest representation change (32-mask ceiling) and most likely to
  ride *both* the string handles (names) and any meta-layout precedent set by Task 1.
- **Integration gate**: after all three land, run the **full §4 matrix + 750 tests + dry-run on
  the combined branch** — pairwise-green does not prove the union is green. The combined branch
  must pass items 1–10 as a unit before the trio is declared merge-ready.

---

## 7. Prototypes (throwaway, ~/tmp/, gitignored)

- `~/tmp/wasm_probe.mjs` — proves `WasmHost` loads + compiles + renders without `node_modules`.
- `~/tmp/bench.mjs` — the perf-gauge prototype (compile/frame timing, percentiles); productionize
  as `marsin_engine/tools/perf_gauge.mjs`.
- `~/tmp/determinism.mjs` — proves fixed-step renders are byte-identical run-to-run (golden-hash
  validity).

Side effect to report (not commit): `marsin_engine/node_modules/` populated by `npm install`
(gitignored). No tracked files changed; no git ops run.
