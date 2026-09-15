# Browser GPU Fix — the sim is rendering on the Intel iGPU

How to recognise, diagnose and fix the sim's red **"⚠ RENDERING ON ANGLE
(Intel, Intel(R) UHD Graphics …) — the discrete GPU is idle"** banner on the
operator laptop (RTX 4090 Laptop GPU + Intel UHD, Windows 11), and how to
hide the banner while you do. Read this before touching any FPS number.

> **Audience:** the operator and any agent that sees the banner, a 10-20 FPS
> sim, or `[GpuAdapter] … (INTEGRATED — SLOW)` in a console dump.
> Background: reports `20260725_38` (the "regression" that was the iGPU),
> `20260725_39` (the banner), `20260914_372` (this fix + dismissable banners);
> fact `.agent/memory/sim_perf_gpu_adapter.md`. **The rules behind this
> procedure — evidence standard, banner contract, what is operator-gated —
> are the spec `.agent/os/gpu_rendering.md`; it outranks this file.**

---

## The one-line version

```bash
node tools/browser_gpu_check.cjs          # which GPU is every browser on? (exit 1 = Chrome on the iGPU)
node tools/browser_gpu_check.cjs --fix    # quit Chrome COMPLETELY, relaunch same profile (tabs restored), re-verify
```

Then reload the sim: no banner, ~60 FPS.

---

## What the problem actually is

- Chrome's **GPU process picks an adapter once, at launch, and keeps it for
  its whole life.** Closing windows does not restart it (Chrome keeps running
  in the background by default), so "restart Chrome" only works as a **full
  quit** (every window gone, nothing left in Task Manager) and reopen.
- The Windows per-app graphics preference (Settings → System → Display →
  Graphics → *High performance*) is **keyed to the exe path**. It has been set
  for `C:\Program Files\Google\Chrome\Application\chrome.exe` since 2026-08-28
  (registry `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`,
  `GpuPreference=2;`). It applies to **nothing else**: Edge, and every Electron
  app on the box (Claude desktop, Slack, Notion, ChatGPT), run their GPU
  process on the Intel iGPU. Viewing the sim inside any of those shows the
  banner — correctly.
- 2026-09-14: with that preference in place for weeks, the operator's Chrome
  (launched 19:12) still came up on the iGPU. No driver, power, PnP or TDR
  event in the logs explains it; three fresh launches the same evening (two
  throwaway profiles, then the operator's real profile) all landed on the
  RTX 4090. Treat it as a one-off adapter pick at launch that only a full
  relaunch undoes — not as a settings problem.

## Recognise it

| Where | What you see |
|---|---|
| Sim HUD | red top-center banner `#gpu-adapter-warning` naming the adapter + the remedy |
| Console at boot | `[GpuAdapter] webgl: ANGLE (Intel, …) (INTEGRATED — SLOW)` as `console.error` |
| Console after 10 s under 20 FPS | `[LowFPS] N FPS — under 20 FPS for 10 consecutive seconds …` naming the adapter |
| FPS badge | 10-20 on the titanic `full` scene (59.9 on the 4090, same commit) |
| In any sim page | `window.__gpuAdapter` → `{ renderer, integrated: true, detectionFailed: false }` |

## Diagnose (what the tool does, by hand)

1. **Which processes hold a context on the NVIDIA GPU** — the oracle:
   ```bash
   nvidia-smi --query-compute-apps=pid,process_name --format=csv
   ```
   A healthy Chrome shows a `chrome.exe` row (its GPU process). "No running
   processes found" while Chrome is open = Chrome is on the iGPU.
2. **Which adapter each GPU process commits memory on** (Windows perf
   counters; LUIDs change every boot — the one with the display attached and
   the largest committed memory is the iGPU on this laptop):
   ```powershell
   (Get-Counter '\GPU Process Memory(*)\Shared Usage').CounterSamples |
     Where-Object { $_.CookedValue -gt 0 } | Select-Object InstanceName, CookedValue
   ```
   Instance names look like `pid_6268_luid_0x00000000_0x00011d8e_phys_0`.
3. **The Windows preference** for the exe that is showing the sim:
   ```powershell
   Get-ItemProperty 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
   ```
   `GpuPreference=2;` = High performance, `1` = Power saving, absent = Windows
   decides (→ iGPU here).
4. `chrome://gpu` → "GPU0 … *ACTIVE*" names the adapter Chrome is on.

## Fix

- **Chrome on the iGPU:** `node tools/browser_gpu_check.cjs --fix`. It quits
  Chrome gracefully (forces after 10 s if it lingers in the background),
  relaunches the same `--profile-directory` with `--restore-last-session`, and
  polls `nvidia-smi` until the new GPU process shows up on the 4090. Manual
  equivalent: close every Chrome window → Task Manager → end every
  `chrome.exe` → open Chrome again.
- **Another browser / app should use the 4090 too:**
  `node tools/browser_gpu_check.cjs --set-preference "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"`
  writes the same value the Settings page writes; then fully quit that app.
  Store/MSIX apps (the Claude desktop app lives under `…\WindowsApps\…`, a
  path that changes on every update) must be added through Settings → System
  → Display → Graphics → *Add an app* → *Microsoft Store app*.
- **Verify:** rerun the check (exit 0, `VERDICT: Chrome renders on the NVIDIA
  GPU`), reload the sim, confirm no banner and `window.__gpuAdapter.integrated
  === false`.

## Hide the banner meanwhile

Every persistent sim warning banner is dismissable since 2026-09-14
(`simulation/src/gui/hud_banner.js`): click its **✕** (the banner stays
`pointer-events:none`; only the ✕ takes the pointer), or press **H** twice for
`hide_all` (H again restores). A dismissal holds through status re-pushes and
the 10 s patch poll, and re-arms only when the condition clears and comes
back; for the GPU banner that means "until reload". Dismissing never changes
what the sim does — the GPU, the blackout, the arm, the patch are untouched.

## Rules for agents

- **An FPS number without its adapter is not evidence** (`.agent/ops/sim_auto_checks.md`
  → GPU Adapter Check). Run the check before blaming code.
- Run the report freely. Run `--fix` **only when the operator asks** (or has
  granted authority for it): it closes their browser.
- Probes that must reproduce the banner pin the iGPU with
  `--use-adapter-luid=<high>,<low>` (re-read LUIDs every boot — see the memory
  fact); agent screenshots deliberately keep the banner visible so a capture
  on the wrong GPU carries the stamp.
- Do not add auto-fallbacks to the sim for this (no backend switch, no profile
  downgrade): codex P0. The sim reports; the operator's environment is fixed
  outside it.
