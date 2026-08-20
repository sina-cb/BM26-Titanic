# 2026-07-28 — Titanic sim "10 FPS regression": root cause is the GPU ADAPTER, not the code (bm_readiness `_38`)

Debugger session (Fable, per operator order). Operator report: the titanic sim
reads **~10 FPS** at
`http://localhost:6969/simulation/?scene=titanic&lighting_mode=sacn_in&profile=full&spotlights=60`,
was ~60 FPS after the 2026-07-24 instancing fix (`20260724_6`), and was fast
even with 200 spotlights. **No git mutations, no server restarts** — all
measurement via throwaway puppeteer probes (fresh browser per config, per
`sim_perf_per_object_explosion.md`) against the operator's live :6969. All
probe browsers closed after use.

---

## 0. TL;DR

- **There is no code regression.** At the operator's exact URL the sim renders
  **59.9 FPS** on this box's RTX 4090 in EVERY configuration probed — WebGL and
  WebGPU, 1600×900 and 3200×1687, idle wire and 24-universe×40 Hz sACN influx,
  5 s and 110 s sustained. Scene-graph census is healthy (1,515 objects; the
  20260724_6 instancing is intact; drawCalls 3,427 ≈ the 3,413 baseline).
- **The 10 FPS is numerically reproduced by pinning Chrome to the Intel UHD
  iGPU**: same URL, same page → **20.0 FPS** windowed (1600×900) and
  **10.0 FPS** at fullscreen-scale canvas (3200×1687 @ pixelRatio 1.25). This
  box is a dual-GPU laptop (RTX 4090 Laptop, LUID `{0,76925}` + Intel UHD, LUID
  `{0,76052}`); Windows has **no per-app GPU preference set for Chrome**
  (checked `HKCU:\Software\Microsoft\DirectX\UserGpuPreferences`), so "let
  Windows decide" is free to park Chrome's GPU process on the iGPU
  (battery/power events, driver or browser updates, window/monitor topology).
  Once the GPU process is on the iGPU, `powerPreference: "high-performance"`
  (already passed at `simulation/main.js:90`) is advisory and does not rescue it.
- The operator's fast runs and slow runs are the SAME code on different
  adapters. Fix plan = make the adapter VISIBLE and fail loudly (codex P0),
  plus a one-time Windows setting on the operator side. Expected recovery:
  10 → ~60 FPS (measured 59.9 on the dGPU at the same URL).

## 1. Measurement matrix (fresh browser per row; operator's live :6969; 5–6 s rAF median)

| # | Config (all `scene=titanic&profile=full`) | Backend | Adapter | Canvas | FPS |
|---|---|---|---|---|---|
| 1 | operator URL exact (`lighting_mode=sacn_in&spotlights=60`) | WebGL (TN) | RTX 4090 | 1600×900 | **59.9** |
| 2 | − `spotlights=60` | WebGL | RTX 4090 | 1600×900 | 59.9 |
| 3 | − `lighting_mode=sacn_in` | WebGL | RTX 4090 | 1600×900 | 59.9 |
| 4 | `renderer=webgpu` (the exact `20260724_6` baseline config) | WebGPU | RTX 4090 | 1600×900 | 59.9 |
| 5 | `lighting_mode=gradient` (per-pixel writes every frame) | WebGL | RTX 4090 | 1600×900 | 59.9 |
| 6 | `lighting_mode=gradient&renderer=webgpu` | WebGPU | RTX 4090 | 1600×900 | 59.9 |
| 7 | operator URL, high-DPI (dsf 1.5 → pr capped 1.25) | WebGL | RTX 4090 | 3200×1687 | 59.9 |
| 8 | operator URL, **110 s sustain** (early + late) | WebGL | RTX 4090 | 1600×900 | 59.9 / 59.9 |
| 9 | operator URL + **synthetic sACN influx** 24 universes × 40 Hz (12,312 frames injected into `window.sacnInput._handleDmxFrame`) | WebGL | RTX 4090 | 1600×900 | 59.9 |
| 10 | operator URL, **pinned to Intel UHD** (`--use-adapter-luid=0,76052`, verified `GL_RENDERER = ANGLE (Intel, Intel(R) UHD Graphics …)`) | WebGL | **Intel UHD** | 1600×900 | **20.0** |
| 11 | operator URL, Intel-pinned, fullscreen-scale | WebGL | **Intel UHD** | 3200×1687 | **10.0** ← operator's number |
| 12 | operator URL `renderer=webgpu`, Intel-pinned | WebGPU | Intel UHD | 1600×900 | 20.0 |

Row 11 is the exact reproduction: **10.0 FPS median, 55 frames in 6 s**, zero
console/page errors, at the operator's URL. Rows 1–9 exonerate every sim-side
change since Jul 24. Row 12 shows switching backend does NOT rescue the iGPU.

## 2. What was ruled out, with numbers

**Object count (the `20260724_6` lesson — checked FIRST).** Runtime census at
the operator URL: **1,515 scene objects** = 877 Mesh + **267 InstancedMesh
(3,530 instances)** + 74 Sprites + 41 Line + 66 lights + 189 other + 1 Points.
The DMX-emitter instancing is intact (250 fixture InstancedMeshes + 80 LED
sprites per the baseline, plus LED strands + the V2 dot mesh). drawCalls 3,427
vs 3,413 post-fix baseline; triangles 1.28 M. **No per-object explosion.**

**Leaks / decay.** 110 s sustain: census byte-identical (1,515 → 1,515), heap
88.4 → 97.3 MB (noise), FPS 59.9 both ends.

**The sACN-in receive path** (never measured post-fix — the `20260724_6`
numbers were taken with the engine down). Synthetic influx of 24 universes at
40 Hz straight into `SacnInputSource._handleDmxFrame` (12,312 frames, changing
bytes each tick): 59.9 FPS, CPU profile shows three.js render internals
dominating (`get`/`draw`/`bindBufferBase` ~5 % each), no sim hot spot. Note
titanic ships **zero patches** (`controllers: []`, all 84 `dmxUniverse: 0`), so
the per-pixel demap/apply branch can't even run on this scene; entries take the
`paintUndrivenEntry` red path.

**Per-frame additions since d631c5c6** (`_applyLedOutputGate`,
`_applyDmxOutputGate`, gradient LUT, `blendEntryRgbwau`/`led_wire.js` preview
math, sacn_mapper LED branch): all exercised by rows 1–9 at 59.9 FPS.
The gradient LUT change actually REMOVED the old per-pixel chroma.js
allocation.

**Renderer mode.** `scenes/common.yaml:101-103` pins `rendererMode: webgl`, so
the operator's no-`renderer=`-param URL boots the **WebGL (TN) backend**, not
WebGPU — and has since at least Jul 15 (predates the fast era; verified across
c6eaa733→HEAD). WebGL on the dGPU is 59.9 (rows 1–3, 5, 7); mode is not the
cause. (Side-effect worth knowing: the `navigator.gpu` WebGPU preference at
`main.js:77` is UNREACHABLE while common.yaml pins a value — see follow-ups.)

**Engine cadence.** The engine is healthy: 39.1 fps measured off
`/status.renderHealth.frame` (329 frames / 8.4 s) while `00_golden_hour_wash`
streams. Not the choppiness source.

## 3. Root cause

**The operator's Chrome rendered the sim on the Intel UHD integrated GPU.**
Mechanism: this is a dual-GPU laptop; Chrome has **no per-app GPU preference**
in Windows (`HKCU:\...\DirectX\UserGpuPreferences` has no chrome.exe entry), so
adapter choice follows Windows' heuristics and can silently change with power
state (scheme is "Balanced"; battery events), driver/browser updates, or which
display hosts the window. The scene's fragment load (full profile: 66 lights,
bloom mip-chain, 1.28 M triangles) is ~6× over the UHD's budget at fullscreen:
measured 20 FPS at 1600×900 → 10 FPS at 3200×1687 (fragment-bound scaling).
The sim already requests `powerPreference: "high-performance"`
(`simulation/main.js:90`), but on Windows that hint cannot move a GPU process
that already sits on the iGPU — which is why nothing in the repo could have
prevented this, and why nothing in the repo caused it.

My probes always read 59.9 because the puppeteer launch flags
(`--ignore-gpu-blocklist --enable-gpu …`) land Chromium's GPU process on the
NVIDIA adapter (verified `GL_RENDERER = ANGLE (NVIDIA, RTX 4090 …)`,
chrome://gpu `GPU0 NVIDIA *ACTIVE*`).

**Honesty note:** the operator's slow session was already closed when this
session started (the :6971 bridge census showed my probe as the only client),
so I could not read its `GL_RENDERER` directly. The attribution rests on (a)
exact numeric reproduction (10.0 FPS) under the iGPU at his URL and canvas
scale, (b) 59.9 FPS on the dGPU across a 9-row bisect of every other variable,
and (c) an unchanged object census. If the operator can reproduce the 10 FPS
again, `chrome://gpu` → "GPU0 … *ACTIVE*" is the one-line confirmation.

## 4. Fix plan (for the Opus implementer)

The code is innocent, so the fix is **visibility + refusal-to-be-silent**
(codex P0: fail loudly), plus a one-time operator action. Zero rendering
changes → zero visual regressions by construction.

1. **Log + expose the live adapter at boot.**
   `simulation/main.js` — right after `renderer.init()` (the
   `console.log('[WebGPU] Renderer initialized …')` at main.js:115): resolve
   the adapter identity and stash it. WebGL path: create a probe context and
   read `WEBGL_debug_renderer_info` → `UNMASKED_RENDERER_WEBGL`. WebGPU path:
   `navigator.gpu.requestAdapter(...)` → `adapter.info` (three keeps its own
   adapter; the probe adapter matches the GPU process). Set
   `window.__gpuAdapter = { renderer: <string>, integrated: /intel|uhd|iris|integrated|basic render/i.test(s) }`
   and log it on one line.
2. **Loud on-screen banner when the adapter is integrated.**
   New tiny module (suggest `simulation/src/gui/gpu_adapter_warning.js`,
   mirroring the `unpatched-warning` banner pattern; wire it from
   `onModelLoaded` where the other banners mount). If
   `window.__gpuAdapter.integrated` → fixed banner:
   "⚠ RENDERING ON <adapter string> — the discrete GPU is idle. Expect ~10-20
   FPS. Windows Settings → Display → Graphics → add Chrome → High performance,
   then restart Chrome. Verify chrome://gpu shows the NVIDIA GPU ACTIVE."
   No auto-fallback, no silent degradation — a banner, not a behavior change.
3. **Escalate on sustained low FPS with the adapter named.**
   `simulation/src/core/animate.js:344-352` (the FPS badge block): when the
   1 s frame count is `< 20` for 10 consecutive seconds, `console.error` ONCE
   naming the adapter string and the banner text. This catches the
   dGPU-but-contended case too (leftover probe windows, documented in
   `sim_perf_per_object_explosion.md`).
4. **Ops doc.** Add a "GPU adapter check" item to
   `.agent/ops/sim_auto_checks.md` (perf section): any FPS report must record
   `window.__gpuAdapter.renderer`; an Intel/integrated string invalidates the
   measurement. Add the same one-liner to `.agent/skills/see_the_world.md`
   next to the fresh-browser rule.
5. **Operator remediation (no code, tell Sina):** Windows Settings → System →
   Display → Graphics → add `chrome.exe` → **High performance** (this box has
   no entry today); avoid battery-saver while running the sim; `chrome://gpu`
   GPU0 should read `NVIDIA … *ACTIVE*`.

**Expected recovery:** 10 → **~60 FPS** (59.9 measured on the dGPU at the
operator's exact URL, rows 1/7).

**Verification recipe (fresh browser per run, close all probes after):**
- dGPU run: probe at the operator URL → 59+ FPS, no banner, adapter logs NVIDIA.
- iGPU run: same probe launched with `--use-adapter-luid=0,76052` (Intel LUID
  on this box; re-read LUIDs from `chrome://gpu` if drivers changed) → banner
  visible, console.error fires, FPS ~20 (windowed). Screenshot both.
- Regression guard: `cd simulation && npm run check` stays green; a render via
  `agent_render.cjs --view front` is pixel-unchanged (no rendering code touched).

## 5. Follow-ups filed (out of scope here)

- **Engine sACN never reaches the sim bridge**: engine `/status` says
  `streaming` at 39 fps with `sacn.destinations: [127.0.0.1]`, the bridge owns
  UDP 0.0.0.0:5568, yet a 6 s ws listen on :6971 (with the `setScene` handshake)
  forwarded **zero** DMX frames and the bridge's own 'ACTIVE — forwarding' log
  never fired — so `lighting_mode=sacn_in` currently shows undriven red, engine
  running or not. Separate investigation (spawned as a background task chip).
- **`common.yaml` pins `rendererMode: webgl` for every no-param URL**, making
  `main.js:77`'s prefer-WebGPU branch dead code. Deliberate for GitHub-Pages
  compat once; worth an operator decision now that WebGPU is the measured-equal
  (and on some Macs better) backend.

## 6. Probes (all throwaway, in `~/tmp/`)

`fps_regress_bisect.cjs` (+`.json`) — rows 1–4 · `fps_regress_probe2.cjs`
(+`.json`) — rows 5–8 + census/heap · `fps_regress_probe3.cjs` (+`.json`) —
row 9 + CPU profile · `fps_regress_probe4.cjs` — WebGPU power-pref A/B ·
inline one-offs — rows 10–12, chrome://gpu LUID dump, engine fps poll, :6971
ws listens. All launched fresh browsers and closed them; the operator's stack
was never restarted, and the only writes to his system were reads.
