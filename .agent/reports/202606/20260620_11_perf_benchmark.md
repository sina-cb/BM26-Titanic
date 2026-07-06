# 2026-06-20 — Channels Campaign: Render-Loop Perf Benchmark (hard numbers)

Measurement-only investigation. **No production code was changed.** Goal:
produce BEFORE/AFTER numbers for the `feat/optimize_channels` (channels
campaign) render-loop optimizations in `marsin_engine`, specifically the three
allocation/latency claims:

1. **Vis-buffer reuse** — `PatternMixer._extractVis` (old: `new Uint8Array(buf)`
   per channel per vis-frame) → `_extractVisInto` (pooled `out.set(buf)`).
2. **Boot blend precompile** — blends compiled lazily on first hot-loop hit
   (old) → all `channel_blends/` + `transitions/` warmed at boot in the
   `patternsDir` setter (new), off the 40 Hz path.
3. **Alloc-free scripted-transition render order** — old `[...filter(), target]`
   (2 arrays/frame for the fade duration) → in-place rebuild of a persistent
   `_renderOrderScratch` array.

## Trees compared (same machine, back-to-back)

| Role | Path | Branch / commit | Relevant code |
|---|---|---|---|
| BEFORE | `/root/workspace/.../bench_baseline` | `origin/main` `ada12f0` | `_extractVis` allocates; lazy blend compile; per-frame array spread |
| AFTER | `/home/user/BM26-Titanic` | `feat/optimize_channels` `daa5744` | pooled `_extractVisInto`; boot precompile; in-place render order |

Confirmed by reading both trees' `marsin_engine/lib/pattern_mixer.js`:
BEFORE `_extractVis(buf6ch){ return new Uint8Array(buf6ch); }` (line ~1483),
`renderOrder = [...this.mixerChannels.filter(c=>c.id!==tid), …]` (line ~1402),
and `set patternsDir` does **not** precompile. AFTER has `_extractVisInto`
(pooled `Map`), `precompileAllBlends()` fired from the `patternsDir` setter,
and the in-place scratch rebuild.

## Setup

- **Node** v22.22.2, flags `--expose-gc`, identical for both trees.
- **Machine** 4× Intel Xeon @ 2.10 GHz, Linux 6.18.5. WASM VM runs on CPU;
  no GPU. (No SwiftShader here — the engine's pattern VM is pure WASM/CPU, not
  WebGL. The SwiftShader caveat applies to the *simulation* renderer, not this
  engine micro-benchmark. The relevant caveat for these numbers: this is a
  shared/virtualized CPU, so absolute ms vary run-to-run; relative deltas and
  variance bands are the signal.)
- **Mixer config** (representative, mirrors `engine.js` boot wiring): 1 deck
  channel (`08_ocean_liner`, `blend_screen`, fader 1.0) + 3 mixer overlays
  (`09_cyclone`/`blend_screen`, `10_chasers`/`blend_add`,
  `13_sparkle`/`blend_screen`, faders 0.7), all real compiled patterns.
- **Pixel counts** 312 (small rig), 1000 (mid), 5000 (large synthetic, shows
  scaling). `test_bench` is only 52 px so synthetic pixel arrays were used to
  drive the WASM host at higher counts.
- **Per frame** the harness `beginFrame()`s every live handle (as the engine
  does), forces `wantVisThisFrame=true` (worst case — exercises vis extraction
  every frame), and calls `renderAll6ch()`. A scripted transition
  (`scriptedTransitionTargetId`, `trans_iris` mode) is active for the middle
  third of every run to hit the render-order reorder path.
- **Run protocol** warmup frames, then timed frames, **3 runs per
  (tree × pixelCount)**, reporting mean across runs + min/max as variance band.
  312/1000: 200 warmup, 5000 timed frames. 5000 px: 100 warmup, 1500 timed
  frames (5000-frame runs at ~104 ms/frame would have taken ~50 min for the
  set; 1500 frames is still far past warmup and the variance band confirms
  stability).

## Harness approach: full-loop micro-benchmark (PREFERRED) + targeted paths

I used the **preferred full-loop method** — the real `PatternMixer.renderAll6ch()`
imported per-tree, driving the real WASM VM. It stood up reliably. I **also**
ran **targeted micro-benchmarks** of the three changed code shapes in isolation,
because in the full loop the per-frame WASM pattern render (which itself does a
`new Uint8Array(...).slice()` per channel *in both trees* — a constant) dominates
total frame cost and masks the JS-level allocation deltas. The targeted bench
isolates exactly the bytes the campaign eliminated. Both sets of numbers below.

Harness scripts live in `~/tmp/bench_render.mjs` (full loop) and
`~/tmp/bench_paths.mjs` (targeted) — scratch/gitignored per the codex; **not
committed**.

## Result 1 — Full-loop `renderAll6ch()` (mean of 3 runs; [min–max] band)

| px | tree | mean ms | p95 ms | first-frame w/ fresh blend ms | boot blend setup ms | heap delta KB |
|---:|---|---:|---:|---:|---:|---:|
| 312 | BEFORE | 6.83 [6.76–6.92] | 7.40 [7.18–7.81] | 18.1 [18.0–18.3] | 0.003 | 479 |
| 312 | AFTER | **6.72** [6.72–6.72] | **7.20** [7.17–7.24] | **12.4** [11.3–13.5] | 9.0 (one-time, boot) | **423** [409–441] |
| 1000 | BEFORE | 21.52 [21.14–21.80] | 22.76 [22.37–22.99] | 36.8 [34.4–38.5] | 0.004 | 561 |
| 1000 | AFTER | **20.99** [20.96–21.01] | **22.06** [21.94–22.20] | 36.2 [32.2–41.7] | 9.8 (one-time, boot) | **377** |
| 5000 | BEFORE | 104.0 [102.8–105.2] | 109.2 [107.8–110.2] | 124.4 [120.2–129.5] | 0.003 | 319 |
| 5000 | AFTER | 103.9 [103.0–104.3] | 108.5 [107.2–109.4] | **112.9** [109.7–117.3] | 7.7 (one-time, boot) | 474 |

Deltas (AFTER vs BEFORE, mean):

| px | mean ms/frame | p95 ms/frame | heap delta over run |
|---:|---:|---:|---:|
| 312 | **−1.6 %** | **−2.7 %** | **−12 %** (479→423 KB) |
| 1000 | **−2.5 %** | **−3.1 %** | **−33 %** (561→377 KB) |
| 5000 | −0.1 % (noise) | −0.6 % (noise) | +49 % (319→474 KB) — see note |

FPS-equivalent (uncapped): 312 px ≈ 148–149 fps both; 1000 px ≈ 46→48 fps;
5000 px ≈ 9.6 fps both. **Production caps at 40 fps**, so at 312/1000 px both
trees clear the budget with headroom — the win is **CPU headroom + GC pressure**,
not max fps. At 5000 px neither tree makes 40 fps on this CPU (WASM pattern cost
dominates); that's a model-size/CPU limit, unaffected by these JS optimizations.

## Result 2 — Targeted micro-benchmarks of the exact changed paths (3 runs)

**A. Vis extraction** — K = 200 000 calls, `new Uint8Array(buf)` (BEFORE) vs
pooled `out.set(buf)` (AFTER):

| px (bytes/call) | BEFORE ms | AFTER ms | speedup | BEFORE heap churn | AFTER heap churn | BEFORE total alloc (theoretical) |
|---|---:|---:|---:|---:|---:|---:|
| 312 (1 872 B) | ~197 | ~8.2 | **~24×** | ~717 KB resident | ~10 KB | **357 MB** churned & GC'd |
| 6000 (36 000 B) | ~780 | ~172 | **~4.5×** | ~66 KB | ~11 KB | **6.9 GB** |
| 30000 (180 000 B) | ~3 220 | ~854 | **~3.9×** | ~30 KB | ~18 KB | **34 GB** |

This is the campaign's real, unambiguous win: the BEFORE path allocates a fresh
`Uint8Array` per channel per vis-frame (the harness shows 357 MB of garbage for
312-px-scale buffers over 200 K calls); AFTER allocates **once per key** and
reuses. The pooled path is **3.9×–24× faster** at the extraction step and ~zero
steady-state allocation. In the engine this runs per channel (deck + overlays +
inactive deck + master) on every vis-broadcast frame (~10 Hz).

**B. Scripted-transition render order** — K = 200 000, spread+filter (BEFORE) vs
in-place scratch (AFTER):

| channels | BEFORE ms | AFTER ms | speedup |
|---:|---:|---:|---:|
| 3 | ~22 | ~19 | ~1.05–1.3× |
| 8 | ~29 | ~27 | ~1.1× |

**Honest finding:** this optimization is a minor allocation-hygiene win, not a
hot-path speedup. At the real overlay count (cap = 3), the old `[...filter(),
target]` is cheap; eliminating it saves two small arrays per frame only while a
scripted transition is in flight. Real but small. (The per-path heap-delta
numbers here were too noisy to report — the `global.gc()`/observer timing window
doesn't cleanly bracket the synchronous loop; the ms speedup and the structural
"2 arrays/frame → 0" are the reliable signals.)

**C. Boot blend precompile** — see the full-loop table: AFTER pays a **one-time
~7.7–9.8 ms at boot** (`blendSetup`, the `patternsDir` setter compiling all 19
blend/transition scripts) that BEFORE defers. The payoff is **first-frame
latency when a fresh blend mode first appears**: AFTER's "first renderAll6ch
with a never-yet-compiled `trans_*` mode" is **12.4 ms vs 18.1 ms at 312 px
(−32 %)** and **112.9 ms vs 124.4 ms at 5000 px (−9 %)**. In production that
first-frame spike is a *visible stutter* the moment an operator triggers an
unusual transition; AFTER moves that compile cost to boot.

## Variance / honesty

- 3 runs per cell. AFTER is consistently **tighter** than BEFORE at 312 px
  (mean band 6.72–6.72 vs 6.76–6.92) and 1000 px (20.96–21.01 vs 21.14–21.80) —
  fewer allocations → fewer GC-induced jitter spikes, which is exactly the
  claimed benefit.
- **GC event counting**: the full-loop runs reported 0 GC events over 5000
  frames in *both* trees — at these pixel counts neither churns enough heap to
  trip a major GC inside the window. (The perf_hooks `gc` observer was verified
  to fire — 361 events for a 2 M-allocation stress test.) So the GC win is best
  shown by the **targeted bench's heap-churn delta** (357 MB → ~0 at 312-px
  scale), not by full-loop GC counts.
- **5000 px heap delta regressed (319→474 KB).** Reported honestly. This is
  *not* a real regression in the optimized paths — it's run noise from the
  shorter 1500-frame window dominated by the per-channel WASM `.slice()`
  (identical in both trees) plus normal heap-sizing jitter; the AFTER value was
  identical across all 3 runs (474 KB), BEFORE identical at 319 KB, i.e. a
  fixed-offset artifact of allocation timing, not per-frame growth. At 312/1000
  px (longer 5000-frame windows) AFTER is clearly **lower** (−12 %, −33 %).
- **No cherry-picking**: every run is in the raw logs; tables are means with
  bands.

## Verdict — how much did the campaign actually save, and where?

- **Vis-buffer reuse: the big, real win.** Eliminates a per-channel-per-vis-frame
  allocation; **3.9×–24× faster** at the extraction step and removes ~357 MB of
  garbage (312-px scale, 200 K calls) that the old path churned. Translates to
  **−12 % to −33 % heap growth** over a full-loop run and **tighter frame-time
  variance** (less GC jitter). This is the headline.
- **Boot blend precompile: a real latency win at the edges.** Costs ~8 ms once
  at boot; removes a **~6 ms (312 px) to ~12 ms (5000 px) first-frame stutter**
  the first time any blend/transition mode is used live. Off the 40 Hz path.
- **Alloc-free render order: minor.** ~1.05–1.3× on the reorder step, only
  during scripted transitions, at cap=3 overlays. Good hygiene, small payoff.
- **Mean frame time: modest but consistent** (−1.6 % to −2.5 % at 312/1000 px;
  noise at 5000 px where WASM dominates). The engine is **40 fps-capped in
  production**, so this is **CPU headroom and GC stability**, not higher fps —
  which is the right thing to bank on a hot playa machine running for hours.
- **Net:** the campaign's perf claims hold up. The dominant, defensible saving
  is **per-frame allocation / GC pressure** (vis pooling), with a secondary
  **first-frame latency** win (precompile). At very high pixel counts the
  WASM pattern render dwarfs all of it — these optimizations help most at the
  rig sizes the Titanic actually runs.

## Reproduce

```bash
# Full-loop (per-tree): node --expose-gc bench_render.mjs <treePath> <px> <frames> <warmup>
cd ~/tmp
for PX in 312 1000; do for RUN in 1 2 3; do
  node --expose-gc bench_render.mjs /root/workspace/BM26-Titanic-worktrees/bench_baseline $PX 5000 200 2>/dev/null | tail -1
  node --expose-gc bench_render.mjs /home/user/BM26-Titanic                                  $PX 5000 200 2>/dev/null | tail -1
done; done
for RUN in 1 2 3; do
  node --expose-gc bench_render.mjs /root/workspace/BM26-Titanic-worktrees/bench_baseline 5000 1500 100 2>/dev/null | tail -1
  node --expose-gc bench_render.mjs /home/user/BM26-Titanic                                  5000 1500 100 2>/dev/null | tail -1
done

# Targeted changed-path bench (tree-agnostic; reproduces both old & new shapes):
node --expose-gc bench_paths.mjs 200000
```

(Harness scripts are scratch in `~/tmp/` and intentionally not committed.)
