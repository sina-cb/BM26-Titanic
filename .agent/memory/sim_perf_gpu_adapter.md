---
name: sim-perf-gpu-adapter
description: On the dual-GPU operator laptop, sim FPS collapse with a HEALTHY object census means the browser is on the Intel iGPU, not the RTX 4090 — check the adapter before blaming code; a puppeteer probe can pin either adapter by LUID.
type: lesson
created: 2026-07-28
updated: 2026-07-28
---

**What happened (2026-07-28, report `20260725_38`):** operator saw ~10 FPS on
the titanic `full` scene and called it a code regression since the
`20260724_6` instancing fix. Nine fresh-browser probe configs (WebGL+WebGPU,
hi-DPI, gradient, sacn_in, 110 s sustain, synthetic 40 Hz sACN influx) all
read **59.9 FPS** and the object census was byte-stable at 1,515 objects — the
code was innocent. Pinning Chrome to the **Intel UHD iGPU** reproduced the
number exactly: 20 FPS windowed, **10.0 FPS** at fullscreen-scale canvas
(3200×1687 @ pr 1.25). Backend switch (WebGL↔WebGPU) does NOT rescue the iGPU.

**Why it drifts:** the operator's box is a dual-GPU laptop (RTX 4090 Laptop +
Intel UHD) with NO Windows per-app GPU preference for Chrome, so the adapter
follows Windows heuristics (power state, driver/browser updates, monitor
topology). `powerPreference: "high-performance"` is already passed
(`simulation/main.js:90`) and is advisory only — it cannot move a GPU process
already sitting on the iGPU.

**The sim now tells you (report `20260725_39`, landed 2026-07-28):** every page
sets `window.__gpuAdapter = { renderer, integrated, detectionFailed }` at boot
and logs one line; an integrated (or unnameable) adapter raises a red
`#gpu-adapter-warning` banner naming the GPU and the Windows remedy, plus a
`console.error`; and 10 consecutive seconds under 20 FPS logs a one-shot
`[LowFPS] …` `console.error` that names the adapter (this one also catches the
RIGHT adapter under contention — leftover probe windows). Zero rendering
changes; no auto-fallback anywhere.

**How to apply:**
- FPS tanked but the scene-graph census is normal? **Check the adapter first**:
  read `window.__gpuAdapter` in the page (fastest), or `chrome://gpu` →
  "GPU0 … *ACTIVE*", or `WEBGL_debug_renderer_info` → `UNMASKED_RENDERER_WEBGL`.
- To measure either GPU deliberately: read the LUIDs from `chrome://gpu`
  (this box: NVIDIA `{0,76925}`, Intel `{0,76052}`) and launch the probe
  browser with `--use-adapter-luid=LOW,HIGH-part-order` — e.g.
  `--use-adapter-luid=0,76052` pins Intel. Re-read LUIDs after driver changes.
- Any FPS measurement reported without naming the adapter is not evidence.
- Remediation is a Windows setting, not code: Settings → Display → Graphics →
  chrome.exe → High performance.
- Also remember: `scenes/common.yaml` pins `rendererMode: webgl`, so ALL
  no-`renderer=`-param URLs run the WebGL (TN) backend — the `navigator.gpu`
  prefer-WebGPU branch in `main.js` is currently unreachable.

Related: [[sim-perf-per-object-explosion]] (object count is still the FIRST
suspect; this lesson is what to check when the census comes back clean).
