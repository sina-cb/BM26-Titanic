# gpu_rendering.md — GPU Adapter Checks, Fixes, and Warning-Banner Rules

Which GPU actually renders our browser surfaces (the sim, CaptainPad web, any
probe), how we prove it, how we fix it when it is the wrong one, and the rules
every warning banner in the sim must follow. This is a **spec** — the shared
agreements. The step-by-step procedure lives in
[`../skills/browser_gpu_fix.md`](../skills/browser_gpu_fix.md); the per-measurement
checklist lives in [`../ops/sim_auto_checks.md`](../ops/sim_auto_checks.md)
("GPU Adapter Check").

Established 2026-09-14 (report `202609/20260914_372`), from two incidents:
`20260725_38` (a full session spent proving a "10 FPS regression" was the Intel
iGPU, not our code) and 2026-09-14 (the same banner again — with the Windows
preference already set correctly for weeks).

---

## 1. The machine reality

The operator laptop has two GPUs, and **the integrated one drives the display**:

| | NVIDIA GeForce RTX 4090 Laptop GPU | Intel(R) UHD Graphics |
|---|---|---|
| Role | render-only, no display attached | drives the 2560×1600 panel |
| Sim FPS, titanic `full` | **59.9** | 20 windowed, **10.0** at fullscreen-scale canvas |
| Chosen when | the app's exe has a Windows *High performance* preference | by default, for everything else |

Three facts decide everything below:

1. **A Chromium GPU process picks its adapter once, at launch, and keeps it for
   life.** Closing windows does not restart it — Chrome stays resident in the
   background — so "restart the browser" only counts as a **full quit** (no
   `chrome.exe` left) followed by a reopen.
2. **The Windows per-app graphics preference is keyed to the exact exe path**
   (`HKCU\Software\Microsoft\DirectX\UserGpuPreferences`, `GpuPreference=2;` =
   High performance). Setting it for `chrome.exe` does nothing for `msedge.exe`
   or for any Electron app (the Claude desktop app, Slack, Notion, ChatGPT — all
   of which run on the iGPU on this box). The sim viewed inside one of those
   shows the warning **correctly**.
3. **`powerPreference: "high-performance"` (passed in `simulation/main.js`) is
   advisory.** It cannot move a GPU process that already sits on the iGPU.

On 2026-09-14 the preference for `chrome.exe` had been *High performance* since
2026-08-28 and the running Chrome was still on the iGPU. No driver, power, PnP
or TDR event explained it; three fresh launches all landed on the 4090. **An
unexplained adapter pick at launch is a known, expected event — the fix is a
relaunch, not an investigation.**

---

## 2. Hard rules

### R1 — An FPS number without its adapter is not evidence

Every performance claim records `window.__gpuAdapter.renderer` alongside the
number, and the adapter must read `integrated: false, detectionFailed: false`.
An integrated or unnameable adapter **invalidates the measurement**: report the
adapter, not the number. This applies to agents, reports, dossiers, and to the
operator's own eyeball checks.

### R2 — Never add a fallback for a wrong adapter

Codex P0. No backend switch, no profile downgrade, no pixel-ratio drop, no
"auto-fix" triggered by detection. The sim **observes and reports**; the remedy
is an environment change the operator (or the tool, on request) performs. Code
that silently compensates hides the 6× performance cliff and guarantees the next
"regression" hunt.

### R3 — One remedy string, in one place

`GPU_ADAPTER_REMEDY` in `simulation/src/core/gpu_adapter.js` is the single source
of truth for what the operator is told. The HUD banner and the sustained-low-FPS
`console.error` both embed it verbatim so they can never disagree. It must always
say both things the incidents taught us:

- the preference is **per-EXE** — name the exe that is showing this page, not
  "Chrome";
- the browser must be **fully quit**, not "restarted".

`simulation/tests/gpu_adapter.test.js` pins both clauses. Change the string →
update that test in the same commit.

### R4 — Every persistent warning surface in the sim must be dismissable

Operator ruling, 2026-09-14: *"these errors all must be hideable."* A warning
that cannot be put away stops being a warning and becomes furniture. Two hide
paths, both required:

1. the surface's own **✕**, built with `simulation/src/gui/hud_banner.js`;
2. the global **`H`** cycle (`show_all → hide_noncritical → hide_all`), which
   hides every banner and toast through the body class — so the id must be
   listed in `HIDE_ALL_ONLY_SELECTORS` (`src/gui/panel_visibility.js`).

Exactly two surfaces are exempt, both deliberately:
`#panel-visibility-toast` (the `H`-key feedback — the one thing that must stay
readable in `hide_all`) and `#fatal-boot-error` (the sim is dead behind it;
there is nothing to reveal). `simulation/tests/panel_visibility.test.js`
enforces the list and the two exemptions.

### R5 — Hiding is cosmetic, never operational

Dismissing a banner changes **nothing** about the condition: no blackout clear,
no bench-mirror disarm, no re-patch, no GPU change. The controls that change
state live in their own panels (RESUME in the sACN OUT panel, DISARM in the
Controllers view). A ✕ that also acted would make the loud-warning contract a
lie.

### R6 — A dismissal must stick, and must re-arm

The contract implemented by `DismissalLatch` / `reduceDismissal`:

| Event | Behaviour |
|---|---|
| Condition re-pushed while dismissed (WS status, 10 s patch poll, re-render) | stays hidden; the **text is still updated** so it is never stale when it returns |
| The occurrence changes (different adapter, different missing-universe set, blackout → stale-model) | **re-shows** — new information was never dismissed |
| Condition clears | hides and **re-arms**, so the next occurrence is announced |

The bug this rule exists to prevent: before 2026-09-14 the patch-manager bars
had click-to-dismiss, and the 10 s safety poll put them back within seconds.

### R7 — The GPU banner stays in evidence screenshots

`agent_render.cjs` (the canonical screenshot path) must **not** hide
`#gpu-adapter-warning`: a capture taken on the wrong GPU has to carry the stamp
that says so. Dismissals are per-page and per-session, and a probe launches a
fresh browser, so agent captures always show it.

Two specialized tools do hide it — `pixel_map_view_tuning_verify.cjs` and
`vintage_sizing_capture.cjs` — because they compare layout pixels. Output from a
tool that hides the banner is **not** admissible as GPU or performance evidence;
use it only for the layout question it was built for.

### R8 — Closing or relaunching the operator's browser is an operator gate

Report mode is free — run it whenever the banner or a low FPS number appears.
`--fix` closes the operator's browser and everything they had open in it, so it
runs **only on their request** (or standing authority for the session). Same for
`--set-preference`, which writes to their registry. See
[`autonomy.md`](autonomy.md) → operator gates.

### R9 — Never hardcode a LUID

Adapter LUIDs change on every boot. Read them at use time from the
`\GPU Process Memory(*)` perf-counter instance names or `chrome://gpu`. Any LUID
written into a doc is a **dated observation**, not a constant (2026-09-14: Intel
`0x119a6`, NVIDIA `0x11d8e`; 2026-07-28 they were different).

### R10 — New sim overlays use the shared helper

A new persistent HUD banner is built with `createHudBanner`, or — when it needs
bespoke DOM — with `DismissalLatch` + `createDismissButton`. Keep
`pointer-events: none` on the banner itself so it never blocks the canvas; only
the ✕ opts back in. Do not hand-roll a twelfth overlay recipe.

CaptainPad's lock surfaces (`EngineLockoutOverlay`, `PlanLockScrim`,
`PlanLockBanner` plan-locked variant, `ViewOverrideBanner`,
`LiveTouchHandoffOverlay`) are **authority** surfaces, not warnings, and are
deliberately not dismissable. R4 does not reach them; leave them alone.

---

## 3. The check contract

`node tools/browser_gpu_check.cjs` — Windows + NVIDIA only; anywhere else it
exits 2 with a clear message rather than guessing (P0: no fallbacks).

It must report, for the current moment:

| Section | Content |
|---|---|
| Adapters | every `Win32_VideoController`, its driver version, and which one drives the display |
| Browser GPU processes | every process with a `--type=gpu-process` child, marked **NVIDIA GPU** or **iGPU**, with its committed video memory per adapter LUID and the Windows preference for its exe |
| Chrome verdict | on the NVIDIA GPU / on the iGPU / not running, plus the exact next command |

**`nvidia-smi --query-compute-apps` is the oracle**: a browser on the 4090 has
its GPU process listed there; "No running processes found" while the browser is
open means it is on the iGPU. The perf counters add per-adapter detail but are
not the verdict (a process on the 4090 still commits some memory on the iGPU,
which drives the display).

Exit codes — the tool is usable from a check script:

| Code | Meaning |
|---|---|
| 0 | Chrome is on the NVIDIA GPU, or not running, or `--fix` succeeded, or `--set-preference` wrote the value |
| 1 | Chrome's GPU process is on the iGPU (or `--fix` ran and did not move it) |
| 2 | cannot answer: not Windows, no `nvidia-smi`, bad `--set-preference` argument |

---

## 4. The fix contract

```bash
node tools/browser_gpu_check.cjs            # report (free)
node tools/browser_gpu_check.cjs --fix      # operator-gated: closes their browser
node tools/browser_gpu_check.cjs --set-preference "C:\path\to\browser.exe"
```

`--fix` performs exactly the manual remedy, in order, and proves each step:

1. graceful close of every `chrome.exe` (`taskkill /IM`), **forced after 10 s** —
   background mode keeps Chrome alive after its windows close;
2. relaunch with the same `--profile-directory` and `--restore-last-session`, so
   the operator gets their tabs back;
3. poll `nvidia-smi` for up to 25 s and **report whether the new GPU process is
   on the 4090** — a fix that is not verified is not a fix.

`--set-preference` writes the same registry value the Settings page writes, and
**refuses** paths that do not exist and Store/MSIX paths (`…\WindowsApps\…`,
which change on every app update — those go through Settings → System → Display
→ Graphics → Add an app → *Microsoft Store app*). After either, the app must be
fully quit and reopened.

---

## 5. Evidence standard

Any claim about sim performance, and any screenshot offered as proof of a visual
state, carries:

- `window.__gpuAdapter.renderer` and its `integrated` / `detectionFailed` flags;
- a **fresh browser** for the measurement, closed afterwards (leftover probe
  windows contend for the GPU and the low-FPS alarm will name the *right*
  adapter under contention — read the message before blaming the adapter);
- the scene-graph object census when the claim is about a change in FPS
  (`sim-perf-per-object-explosion` is still the first suspect; the adapter is
  what to check when the census comes back clean).

---

## 6. Reproducing the condition (for tests and probes)

Pin a throwaway browser to the iGPU — never change the operator's environment to
reproduce a bug:

```bash
# LUIDs change every boot — read them first (R9)
node tools/browser_gpu_check.cjs          # prints each process's adapter LUID
# then launch the probe with --use-adapter-luid=<high>,<low>
```

Two traps, both paid for on 2026-09-14:

- **The sim leaves `sacn_in` mode when the engine is unreachable.** `main.js`
  fetches the engine `/status` at boot and, if that rejects (including a CORS
  rejection), pins the page to `pixelblaze`. A page pinned that way never joins
  the sACN bridge, so the bridge client census — and the multi-client banner —
  never appears. A stand-in engine must answer `/status` **with CORS headers**.
- **A puppeteer `page.click` hangs on a background tab.** Bring the page to the
  front before clicking, and close helper pages in a `finally`. The hang is the
  tab state, not the element under the cursor.

---

## 7. Where everything lives

| Path | Role |
|---|---|
| `simulation/src/core/gpu_adapter.js` | detection (`detectGpuAdapter`), classification, `GPU_ADAPTER_REMEDY`, the shared warning text |
| `simulation/src/gui/gpu_adapter_warning.js` | the `#gpu-adapter-warning` banner |
| `simulation/src/core/low_fps_alarm.js` + `animate.js` | one-shot escalation after 10 s under 20 FPS, naming the adapter |
| `simulation/src/gui/hud_banner.js` | the shared dismissable-banner recipe (R4, R6, R10) |
| `simulation/src/gui/panel_visibility.js` | the `H` cycle + `HIDE_ALL_ONLY_SELECTORS` |
| `tools/browser_gpu_check.cjs` | the check and the fix (§3, §4) |
| `.agent/skills/browser_gpu_fix.md` | the procedure — symptom → diagnose → fix → verify |
| `.agent/ops/sim_auto_checks.md` | "GPU Adapter Check", required for every FPS claim |
| `.agent/memory/sim_perf_gpu_adapter.md` | the durable lesson + current LUIDs |
| `.agent/reports/202607/20260725_38`, `_39`, `202609/20260914_372` | the incident record |

---

## 8. Change control

- Changing `GPU_ADAPTER_REMEDY` → update `tests/gpu_adapter.test.js` (R3).
- Adding a persistent sim overlay → `createHudBanner` **and** an entry in
  `HIDE_ALL_ONLY_SELECTORS`, which `tests/panel_visibility.test.js` enforces
  (R4, R10).
- Changing what `tools/browser_gpu_check.cjs` prints or returns → update §3/§4
  here and the skill in the same commit; the exit codes are an interface.
- Observing a new adapter-pick cause (a driver event, a dock, a power state) →
  record it in `.agent/memory/sim_perf_gpu_adapter.md` and amend §1. The current
  honest answer is "unexplained, relaunch fixes it"; replace it only with
  evidence.
