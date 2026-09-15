---
name: sim-perf-gpu-adapter
description: On the dual-GPU operator laptop, sim FPS collapse with a HEALTHY object census means the browser's GPU process is on the Intel iGPU, not the RTX 4090 — even with the Windows preference set; a GPU process keeps its adapter for life, so only a FULL browser quit/relaunch moves it. nvidia-smi proves which GPU a browser is on; `tools/browser_gpu_check.cjs --fix` does the relaunch.
type: lesson
created: 2026-07-28
updated: 2026-09-14
---

**What happened (2026-07-28, report `20260725_38`):** operator saw ~10 FPS on
the titanic `full` scene and called it a code regression since the
`20260724_6` instancing fix. Nine fresh-browser probe configs (WebGL+WebGPU,
hi-DPI, gradient, sacn_in, 110 s sustain, synthetic 40 Hz sACN influx) all
read **59.9 FPS** and the object census was byte-stable at 1,515 objects — the
code was innocent. Pinning Chrome to the **Intel UHD iGPU** reproduced the
number exactly: 20 FPS windowed, **10.0 FPS** at fullscreen-scale canvas
(3200×1687 @ pr 1.25). Backend switch (WebGL↔WebGPU) does NOT rescue the iGPU.

**What happened again (2026-09-14, report `20260914_372`):** the Windows per-app
preference for `chrome.exe` had been *High performance* since 2026-08-28 —
and the operator's Chrome (launched 19:12) still came up on the iGPU
(nvidia-smi listed no chrome.exe; the banner was up). No driver / power / PnP
/ TDR event that day explains the pick. Three fresh launches that evening
(two throwaway profiles, then the real Profile 4) all landed on the RTX 4090.
**A GPU process picks its adapter once, at launch, and keeps it**: closing
windows does nothing (Chrome lingers in the background); only a full quit +
reopen moves it. Every Electron app on the box (Claude desktop, Slack,
Notion, ChatGPT) and Edge run on the iGPU — the preference is per-EXE and
they have none — so the sim viewed in any of them shows the banner, correctly.

**Why it drifts:** `powerPreference: "high-performance"` (`simulation/main.js`)
is advisory only; it cannot move a GPU process already sitting on the iGPU.
The Windows preference decides the adapter at launch; whatever made one launch
ignore it is not in the logs.

**The sim tells you (`20260725_39`; dismissable since `20260914_372`):** every
page sets `window.__gpuAdapter = { renderer, integrated, detectionFailed }` at
boot and logs one line; an integrated (or unnameable) adapter raises the red
`#gpu-adapter-warning` banner (now with a ✕, also hidden by `H` → hide_all;
per-page, so a fresh probe browser always sees it) plus a `console.error`;
10 consecutive seconds under 20 FPS logs a one-shot `[LowFPS] …`
`console.error` naming the adapter (this one also catches the RIGHT adapter
under contention — leftover probe windows). Zero rendering changes; no
auto-fallback anywhere.

**How to apply:**
- The rules live in the spec `.agent/os/gpu_rendering.md` (evidence
  standard, no-fallback, banner dismissal contract, operator gates).
- FPS tanked but the scene-graph census is normal? **Check the adapter first**:
  `node tools/browser_gpu_check.cjs` (skill `.agent/skills/browser_gpu_fix.md`)
  — nvidia-smi (`--query-compute-apps=pid,process_name`) is the oracle: a
  browser on the 4090 shows its GPU process there; "No running processes
  found" while it is open = iGPU. In-page: `window.__gpuAdapter`; or
  `chrome://gpu` → "GPU0 … *ACTIVE*".
- Fix: `node tools/browser_gpu_check.cjs --fix` — full quit, relaunch same
  profile with `--restore-last-session`, re-verify. Operator's browser: run it
  on their request. Other browsers/apps: `--set-preference "<exe>"` (Store
  apps like the Claude desktop app must be added through the Settings page).
- To measure either GPU deliberately, pin the probe browser with
  `--use-adapter-luid=HIGH,LOW`. **LUIDs change every boot** — read them from
  the `GPU Process Memory(*)` perf-counter instance names (or chrome://gpu);
  on 2026-09-14: Intel `0x119a6` → `--use-adapter-luid=0,72102`, NVIDIA
  `0x11d8e`; on 2026-07-28 they were `{0,76052}` / `{0,76925}`.
- Any FPS measurement reported without naming the adapter is not evidence.
- Also remember: `scenes/common.yaml` pins `rendererMode: webgl`, so ALL
  no-`renderer=`-param URLs run the WebGL (TN) backend — the `navigator.gpu`
  prefer-WebGPU branch in `main.js` is currently unreachable.

Related: [[sim-perf-per-object-explosion]] (object count is still the FIRST
suspect; this lesson is what to check when the census comes back clean).
