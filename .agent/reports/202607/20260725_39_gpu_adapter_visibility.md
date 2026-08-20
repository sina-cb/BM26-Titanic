# 2026-07-28 — GPU adapter visibility: the sim now NAMES the GPU it is rendering on (bm_readiness `_39`)

Implementer session (Opus). Executes the 5-step fix plan in
`20260725_38_titanic_sim_fps_regression.md` §4 verbatim: the "10 FPS titanic
regression" was **not code** — the operator's Chrome had parked its GPU process
on the Intel UHD iGPU instead of the RTX 4090 (10.0 FPS iGPU-pinned vs 59.9 on
the dGPU, across all 9 probed configs; instancing intact; code exonerated). So
this change adds **zero rendering behaviour** and only makes the adapter
impossible to miss.

**Operator's live stack was never restarted** — every measurement was a
throwaway puppeteer client of his running `:6969`, fresh browser per run, both
closed after (verified: no `chrome.exe` with probe flags survives).

---

## 0. TL;DR

- Four code artifacts, all diagnostic: adapter detection at boot
  (`window.__gpuAdapter` + one log line), a red HUD banner when the adapter is
  integrated (or unknown), a fire-once `console.error` after 10 straight
  seconds under 20 FPS that names the adapter, and the ops-doc rule that an
  FPS number without an adapter is not evidence.
- **Proved live on BOTH adapters of this box** (the report's `--use-adapter-luid`
  method, LUIDs still valid): dGPU run = 59.9 FPS, `(discrete)` log line, **no
  banner**; Intel-pinned run = 15 FPS, banner visible naming the Intel string,
  boot `console.error`, and `[LowFPS] 16 FPS — under 20 FPS for 10 consecutive
  seconds …` naming the adapter.
- **Render path untouched** — no shader, material, light, pass, profile,
  pixel-ratio or loop-ordering change. The two edits to existing files are two
  import lines, a 9-line boot block after `renderer.init()`, and a branch
  *inside* the existing once-per-second FPS-badge block. Screenshots on both
  adapters show the identical scene.
- Sim suite **698 → 721 pass / 0 fail** (23 new tests).

## 1. What landed

| # (plan step) | Artifact | What it does |
|---|---|---|
| 1 | `simulation/src/core/gpu_adapter.js` (new) | Probes the live adapter — WebGL2 throwaway context → `WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL`; WebGPU → `requestAdapter().info`. Sets `window.__gpuAdapter = { renderer, integrated, detectionFailed }` and logs ONE line (`console.log` when discrete, `console.error` when not). Probe context is released via `WEBGL_lose_context`. |
| 1 | `simulation/main.js` | Two imports + a 9-line block right after the existing `[WebGPU] Renderer initialized` log: `await detectGpuAdapter({ rendererMode })` then mount the banner. |
| 2 | `simulation/src/gui/gpu_adapter_warning.js` (new) | Lazily-mounted `#gpu-adapter-warning` banner, top-center at `top: 84px` (clears the multi-client banner at 44px), error palette from theme vars, `pointer-events:none`, `role="alert"`. Pure `bannerStateForAdapter()` split out for tests, mirroring `multi_client_warning.js`. |
| 3 | `simulation/src/core/low_fps_alarm.js` (new) + `animate.js` | `createLowFpsAlarm(20, 10)` latch fed by the frame count the FPS badge already computes; on the 10th consecutive second under 20 FPS the loop `console.error`s ONCE with the adapter log line **and** the banner text. |
| 4 | `.agent/ops/sim_auto_checks.md`, `.agent/skills/see_the_world.md` | New "GPU Adapter Check (REQUIRED for every FPS / performance claim)" section + a done-bullet; skill gains a fresh-browser/`window.__gpuAdapter` agent tip. |
| 5 | This report + master doc + `.agent/memory/sim_perf_gpu_adapter.md` | The one-time operator Windows setting, recorded where it will be found again. |
| tests | `simulation/tests/gpu_adapter.test.js` (13), `simulation/tests/low_fps_alarm.test.js` (10) | Real adapter strings classified; Apple Silicon and AMD deliberately NOT flagged; unknown adapter reported as unknown, never assumed healthy; banner text is literally the same string the escalation logs; hitch stays quiet, sustained floor fires exactly once, recovery never re-arms; bad args and non-finite samples throw. |

What the operator now SEES on the wrong GPU (verbatim banner text):

> ⚠ RENDERING ON ANGLE (Intel, Intel(R) UHD Graphics (0x0000A788) Direct3D11
> vs_5_0 ps_5_0, D3D11) — the discrete GPU is idle. Expect ~10-20 FPS. Windows
> Settings → Display → Graphics → add Chrome → High performance, then restart
> Chrome. Verify chrome://gpu shows the NVIDIA GPU ACTIVE.

## 2. Live verification — both adapters (fresh browser each, both closed)

Probe: `~/tmp/gpu_adapter_verify.cjs` (throwaway), operator's exact URL
`http://127.0.0.1:6969/simulation/?scene=titanic&lighting_mode=sacn_in&profile=full&spotlights=60`.

| Run | Launch | `window.__gpuAdapter.renderer` | FPS | Banner | Console |
|---|---|---|---|---|---|
| A | default flags | `ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU (0x00002757) …)` — `integrated:false` | **59.9** (badge 58) | **absent** (element never created) | `log: [GpuAdapter] webgl: … (discrete)` — nothing else |
| B | `--use-adapter-luid=0,76052`, `deviceScaleFactor 1.5` (canvas 2000×1125) | `ANGLE (Intel, Intel(R) UHD Graphics (0x0000A788) …)` — `integrated:true` | **15** (badge 16) | **visible**, 800×78 at `top:84`, full text above | `error: [GpuAdapter] webgl: … (INTEGRATED — SLOW)` and `error: [LowFPS] 16 FPS — under 20 FPS for 10 consecutive seconds. [GpuAdapter] webgl: … (INTEGRATED — SLOW). ⚠ RENDERING ON … High performance …` |

Screenshots: `~/tmp/gpu_adapter_check/dgpu_default.png`,
`~/tmp/gpu_adapter_check/igpu_pinned.png` — inspected. Same scene, same
lighting, same panels in both; the only difference is the FPS badge (58 vs 16)
and the banner. Zero page errors in either run.

Notes from the runs: the report's Intel LUID `0,76052` is still correct; the
device id inside the string reads `0x0000A788` this session (the `_38` run
recorded `0x00009A60`) — the classifier keys on the vendor/family words, not
the id, so this is exactly the kind of drift it must survive. The probe context
and three's own context reported the identical string on both runs, which is
the assumption step 1 rests on.

## 3. Regression evidence

- `cd simulation && npm run check`: **721 pass / 0 fail** (baseline before this
  work: 698 / 0 — re-measured at session start, not quoted from the tracker).
- `node --check` on `main.js`, `animate.js`, `gpu_adapter.js`,
  `low_fps_alarm.js`, `gpu_adapter_warning.js`: pass.
- `git diff --check -- simulation`: clean (only the repo's pre-existing CRLF
  notices on files this session never touched).
- Visual: run A's screenshot is the normal titanic scene with no banner. A
  byte-identical before/after PNG comparison is **not possible on this scene**
  and never was — `createStarField()` places 3,000 stars with `Math.random()`
  on every load, so two renders of the SAME commit differ. The
  no-visual-change claim therefore rests on the diff scope (below) plus the
  screenshots, and is stated as such rather than dressed up as a pixel diff.
- Diff scope in existing files, in full: `main.js` +2 imports +9 boot lines;
  `animate.js` +2 imports, +1 module-level latch, and one `if` inside the
  existing `now - lastFpsTime >= 1000` block. Nothing else in either file was
  touched. (`main.js` also carries an unrelated pre-existing working-tree
  change from another slice — the `projectOntoConfigs` LED-strand argument —
  which this session did not author and did not modify.)
- The sim's undriven-red look in both screenshots is the separate `:6971`
  bridge finding from `_38` §5 (another thread's chip) — deliberately untouched.

## 4. Deliberate design calls (and one deviation from the plan)

1. **Banner mounts from `main.js` init, not `onModelLoaded`.** The plan
   suggested `onModelLoaded`; the engine-blackout banner — the closest sibling —
   mounts from `init()`, and mounting at detection time means the warning is up
   during the slow load instead of after it, with no argument threading through
   `onModelLoaded`'s fixed signature. Same DOM, same lifetime.
2. **No auto-anything.** No backend switch, no profile downgrade, no pixel-ratio
   drop when the adapter is integrated (codex P0: no fallback behaviours). The
   sim renders exactly as before and says what is wrong.
3. **Unknown adapter is its own loud state.** If the browser will not name the
   GPU (`WEBGL_debug_renderer_info` missing, no WebGL2, WebGPU with no
   `.info`), `detectionFailed: true` → `console.error` + a banner saying an FPS
   number from this window proves nothing. An undetectable adapter is never
   silently treated as healthy.
4. **A probe throw does not kill the sim.** `detectGpuAdapter` catches, prints
   `[GpuAdapter] adapter probe threw: …`, and classifies UNKNOWN — loud, but a
   diagnostic must not take down the show surface.
5. **The banner is NOT in the edit-mode hide list and is not hidden by
   `agent_render.cjs`'s UI-hiding pass** — on purpose. A screenshot taken on
   the wrong GPU should carry the stamp that says so.

## 5. Honest gaps

- **The `/intel|uhd|iris|integrated|basic render/i` classifier is the plan's,
  verbatim, and it has two known edges**: a *discrete* Intel Arc would be
  false-flagged (no such GPU here), and Chrome's SwiftShader software renderer
  (`ANGLE (Google, Vulkan … SwiftShader Device …)`) does **not** match, so a
  software-GL machine gets no banner — the low-FPS escalation still fires there.
  Widening the regex was left to the operator's call because it would put a
  banner into every headless agent render on software-GL boxes.
- **20 FPS exactly does not trip the escalation** (`< 20` is strict), which is
  the `_38` row-10 number for the iGPU at 1600×900. That window still gets the
  banner and the boot `console.error`; only the sustained-FPS line stays quiet.
  Kept strict per the plan's "`< 20`".
- **Fires once per page load.** A recovery re-arms the run counter, never the
  message — deliberate (no console spam), but a second slow spell in a long
  session is silent apart from the badge and the banner.
- The adapter is read once, at boot. Windows can in principle migrate a GPU
  process mid-session; `window.__gpuAdapter` would then be stale. The low-FPS
  escalation is the backstop for that case, and it says so in its own text
  ("the adapter looks correct — check for other windows or apps contending").

## 6. Operator action (still required — code cannot do this)

One-time, on the operator's box:

1. **Windows Settings → System → Display → Graphics** → *Add desktop app* →
   `chrome.exe` → **Options → High performance** → Save. (This box has **no**
   entry for Chrome today — `HKCU:\Software\Microsoft\DirectX\UserGpuPreferences`
   is empty for it, which is exactly why the adapter is free to drift.)
2. **Restart Chrome**, then open `chrome://gpu` and confirm the top block reads
   **`GPU0 … NVIDIA … *ACTIVE*`** (not Intel).
3. Avoid battery-saver / unplugged operation while running the sim — a power
   event is one of the ways the GPU process lands on the iGPU.

Expected: **10 → ~60 FPS** at the same URL (59.9 measured on the dGPU today).
If it ever drops again, the sim will now say which GPU it is on before anyone
opens a code editor.

## 7. Files

Created: `simulation/src/core/gpu_adapter.js`,
`simulation/src/core/low_fps_alarm.js`,
`simulation/src/gui/gpu_adapter_warning.js`,
`simulation/tests/gpu_adapter.test.js`,
`simulation/tests/low_fps_alarm.test.js`.
Edited: `simulation/main.js`, `simulation/src/core/animate.js`,
`.agent/ops/sim_auto_checks.md`, `.agent/skills/see_the_world.md`,
`.agent/memory/sim_perf_gpu_adapter.md`,
`.agent/projects/bm26_show_readiness.md`.
Throwaway: `~/tmp/gpu_adapter_verify.cjs`, `~/tmp/gpu_adapter_check/`.
No git operations, no deploys, no server restarts.
