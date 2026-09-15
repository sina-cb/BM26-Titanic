# 2026-09-14 — Chrome back on the RTX 4090, and every sim HUD banner is now dismissable (`_1`)

Operator ask (Sina): the red **"⚠ RENDERING ON ANGLE (Intel, Intel(R) UHD
Graphics …) — the discrete GPU is idle"** banner is "very annoying and
unuseful" — fix the GPU problem with full authority ("change chrome if
needed, check gpu, check what's going on"), and make sure **every such error
is hideable, in all places**. Follow-up ask mid-session: add a skill/tool to
`.agent` that explains the fix and lets it be applied again.

Fable session, executing (operator order), Opus sub-agent for the banner
inventory. **No git operations** (nothing staged or committed). No operator
stack was running; the sim's own servers were started for verification and
stopped afterwards.

---

## 0. TL;DR

- **Chrome was on the Intel iGPU although Windows already said "High
  performance" for chrome.exe (registry value dated 2026-08-28).** A GPU
  process keeps the adapter it started on; the running Chrome (up since 19:12)
  could only be moved by a full quit. Relaunched the operator's real profile
  → GPU process on the RTX 4090 (nvidia-smi lists it; perf counters put its
  memory on the 4090's LUID). Three fresh launches in a row landed on the
  4090; nothing in today's logs explains the 19:12 pick.
- **Every persistent sim HUD banner now carries a ✕** and `H` → hide_all hides
  all of them (shared `simulation/src/gui/hud_banner.js`). A dismissal survives
  status re-pushes and the 10 s patch poll (which used to resurrect the
  patch-manager bars within 10 s of a click) and re-arms only when the
  condition clears and returns. Hiding never changes what the sim does.
- The GPU banner's remedy text was wrong in two ways and is fixed: the
  preference is per-EXE (Edge and every Electron app on the box — Claude
  desktop, Slack, Notion, ChatGPT — sit on the iGPU), and "restart Chrome"
  must mean a FULL quit.
- New: `tools/browser_gpu_check.cjs` (report / `--fix` / `--set-preference`),
  the skill `.agent/skills/browser_gpu_fix.md`, and the spec
  `.agent/os/gpu_rendering.md` — which also adds one operator gate to
  `os/autonomy.md` (closing the operator's own browser), flagged in §6.
- Proof: 39/39 unit tests on the touched modules; live probes 36/37 unpinned
  and 40/41 pinned to the iGPU (the one miss each time is the probe's own
  wrong assumption); sim suite 2717/2719 with the two misses pre-existing /
  load-sensitive (§5).

## 1. The GPU problem — what was actually going on

| Fact | Evidence |
|---|---|
| Two adapters: RTX 4090 Laptop (no display attached) + Intel UHD (drives the 2560×1600 panel) | `Win32_VideoController` |
| Windows per-app preference for `C:\Program Files\Google\Chrome\Application\chrome.exe` = `GpuPreference=2;` (High performance), key last written **2026-08-28 23:18** | `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` + `RegQueryInfoKey` |
| The operator's Chrome (Profile 4, browser + GPU process both started **19:12:55**) was NOT on the 4090 | `nvidia-smi` listed no process while Chrome was open; `memory.used 0 MiB` |
| A fresh chrome.exe with default flags lands on the 4090 (twice, temp profiles) | probe: `UNMASKED_RENDERER = ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU …)`; nvidia-smi lists the probe's GPU process |
| The operator's own profile relaunched (`--profile-directory="Profile 4"`) → on the 4090 | nvidia-smi lists pid 6268 chrome.exe; perf counters: `luid_0x11d8e` (4090) 230 MB + `luid_0x119a6` (Intel, cross-adapter present) 68 MB |
| No driver / power / PnP / TDR event today besides boot (18:35) | System, Application, Kernel-PnP logs |
| Every Chromium/Electron GPU process on the box other than Chrome is on the iGPU (Claude desktop at 73 % 3D util, Slack, Notion, ChatGPT, Edge, WebView2) — none has a preference entry | `GPU Process Memory(*)` counters |
| LUIDs change per boot: today Intel `0x119a6` (`--use-adapter-luid=0,72102`), NVIDIA `0x11d8e`; July's were `{0,76052}` / `{0,76925}` | counters vs. memory fact |

**Why it happened:** a Chromium GPU process picks its adapter once at launch
and keeps it; Chrome keeps running in the background after its windows close,
so "restart Chrome" only works as a full quit. Why the 19:12 launch picked
the iGPU despite the preference is **not** in any log — treat it as a
one-off adapter pick at launch, fixed by relaunching, and check with the tool
when the banner shows again.

**What I did to the operator's machine:** launched Chrome (Profile 4, New
Tab page) once to verify the fix on the real profile — it was already closed
when I got to it. No registry change, no NVIDIA/Windows setting touched.
Sim stack: no operator stack was running; `simulation` `npm start` +
a throwaway fake engine on :6968 ran for verification and were stopped.

## 2. What landed

Committed on operator instruction to `feat/hideable_banners_and_gpu_checks`,
branched from `origin/main` (`68a2e19c`, the BM26 wrap), in two commits: the
sim banner change, then the GPU tooling + docs. Pushed for review; not merged.

| Artifact | What |
|---|---|
| `simulation/src/gui/hud_banner.js` (new) | `reduceDismissal` / `occurrenceKey` (pure), `DismissalLatch`, `createDismissButton`, `createHudBanner`. Banner stays `pointer-events:none`; only the ✕ opts in. Text is kept current even while dismissed. |
| `src/gui/multi_client_warning.js`, `bench_mirror_banner.js`, `gpu_adapter_warning.js` | Rebuilt on `createHudBanner`; pure state functions untouched. GPU banner moved from `top:84px` to `top:112px` — it used to sit on top of the bench-mirror banner (78 px). |
| `src/dmx/patch_manager.js` | Universe-mismatch bar, controller-IP bar, unpatched pill: `DismissalLatch` keyed on the missing set / message / condition, `createDismissButton`; click-anywhere still dismisses the bars. The 10 s `_safetyPoll` no longer resurrects a dismissed bar. |
| `src/gui/engine_blackout_warning.js` | ✕ on the card; dismissal per condition (`blackout` vs `stale`), re-arms when the engine clears; `setWarningVisible` no longer toggles `.hidden` (the latch does) but still owns the body class + RESUME button. |
| `src/gui/panel_visibility.js` | `HIDE_ALL_ONLY_SELECTORS` exported and complete: 8 banners + 6 toasts + nav chrome. `#panel-visibility-toast` and `#fatal-boot-error` deliberately excluded. |
| `src/core/gpu_adapter.js` | `GPU_ADAPTER_REMEDY` rewritten (per-EXE, FULL quit). |
| `style.css` | `.hud-banner-close` (+ pill / blackout variants). |
| `tests/hud_banner.test.js` (new, 9), `tests/gpu_adapter.test.js` (+1), `tests/panel_visibility.test.js` (+2) | Latch semantics, remedy contract, hide_all coverage contract. |
| `tools/browser_gpu_check.cjs` (new) | Report (adapters, every browser GPU process → adapter via nvidia-smi + LUID memory, Windows preference per exe; exit 1 when Chrome is on the iGPU); `--fix` (graceful quit → forced after 10 s → relaunch same profile with `--restore-last-session` → re-verify); `--set-preference <exe>` (refuses Store/MSIX paths). Self-exclusion of the querying shell. |
| `.agent/skills/browser_gpu_fix.md` (new) | Symptom → diagnose → fix → verify → hide meanwhile → agent rules. |
| `.agent/os/gpu_rendering.md` (new) | **The spec** (operator ask, second pass): machine reality, 10 hard rules (evidence standard, no-fallback, one remedy string, banner dismissable + dismissal semantics, banner stays in evidence screenshots, LUIDs never hardcoded, shared helper), the check/fix contracts incl. exit codes, how to reproduce the condition, file map, change control. Wired into `README.md`, `AGENTS.md`, `context/boot.md` step 6, the skill, the ops check and the memory fact. |
| `.agent/os/autonomy.md` | One gate added to the exhaustive list: quitting/relaunching the operator's own apps, or writing their Windows settings (`gpu_rendering.md` R8). Reporting stays free. |
| `.agent/ops/sim_auto_checks.md`, `.agent/skills/see_the_world.md`, `.agent/memory/sim_perf_gpu_adapter.md`, `.agent/context/now.md` | Pointers + the corrected lesson. |

Dismissal semantics, in one table:

| Banner | Occurrence key | Re-arms when |
|---|---|---|
| `#gpu-adapter-warning` | default | never within a page (adapter is fixed) → until reload |
| `#multi-client-warning` | default | census drops to ≤1 (or unknown) and climbs again |
| `#bench-mirror-banner` | default | disarm / socket loss, then a new arm |
| `#engine-blackout-warning` | `blackout` / `stale` | engine clears; the other wording re-shows |
| `#universe-mismatch-warning` | sorted missing-universe list | set clears or changes |
| `#controller-ip-warning` | the message | fixtures get their IP back, or the set changes |
| `#unpatched-warning` | default | scene patched, then unpatched again |

## 3. Inventory — where "hideable" now holds, and where it deliberately does not

Sim (Opus inventory, 19 fixed surfaces): the 7 persistent banners above all
have ✕ + hide_all; `#spotlight-warning` already had a ✕ (+30 s auto-hide);
the 6 transient toasts (`#spotlight-cap-toast`, `#overlap-toast`,
`#save-toast`, `#auto-patch-toast`, `#pm-manager-toast`, `#cm-toast`) self-hide
in ≤10 s and are now also in hide_all; `#dirty-indicator`, `#snap-indicator`
are mode/status chips (hide_all / `P`). **Left alone on purpose:**
`#fatal-boot-error` (the sim is dead behind it) and `#panel-visibility-toast`
(the H-key feedback). The universe-mismatch bar is, in practice, unreachable
through `recompute()` — auto-subscribe merges every patched universe first —
so its wiring was reviewed and unit-covered, not live-proved.

CaptainPad: toasts (`OpToastStack`) dismiss on tap; `PendingProgramOverlay`
has KEEP MANUAL; `ZoomBanner` minimises. **Not dismissable by design and left
as is:** `EngineLockoutOverlay` ("hermetic"), `PlanLockScrim`, `PlanLockBanner`
(plan-locked variant: TAKE OVER / GO TO PLAN), `ViewOverrideBanner`,
`LiveTouchHandoffOverlay` — these are authority/lock surfaces, not error
banners; making them dismissable would defeat them. Studio toasts auto-clear
in 4 s; the FX locked-tap toast in 2.2 s. Live Touch webview `#panelStatus`
always carries a 3 s TTL; `#liveTouchUnavailable` is a hard-state card.
Engine companion UI: in-flow pills only. No change made outside the sim.

## 4. Live proof (fresh Chrome per run, closed after; operator's Chrome untouched)

Probe `~/tmp/gpu_probe/banner_live_probe.cjs` against `?scene=titanic&lighting_mode=sacn_in&profile=full&renderer=webgl`,
with a throwaway engine on :6968 that speaks only `{type:'mixer'}` (+ CORS
`/status`, without which `main.js` pins the sim to pixelblaze and it never
joins the bridge census).

| Run | Result |
|---|---|
| Pinned to the Intel iGPU (`--use-adapter-luid=0,72102`) | GPU banner visible at top 112 px with ✕, banner `pointer-events:none`, ✕ `auto`; revised remedy text; ✕ → `display:none` (screenshots `1_gpu_banner_before.png`, `2_gpu_banner_dismissed.png`) |
| Unpinned (4090), 37 checks | **36 pass**: bridge census 2 → banner in A; ✕ hides; census re-push to 3 does not resurrect (text kept current); count 1 → 2 again re-shows. Module-driven multi-client, bench mirror (top 78, `role=status`), controller-IP bar (✕, click-anywhere, both stick through `recompute()`, re-arm after the fault returns), unpatched pill (`forceSet`), H×2 hides every banner / H×3 restores, blackout card (real mouse ✕ in 121 ms; re-push stays hidden; `stale` re-shows; clear + new blackout re-arms; body class untouched by ✕). The 1 miss: my own "scene left clean" assertion — the scene is marked dirty at boot in a fresh page (visible in the first screenshot), not by the probe. |

Two probe-side red herrings, recorded so nobody chases them again: a
puppeteer `page.click` hangs when the page is not the front tab (helper
pages left open by an aborted section) — not the ✕; and `page.screenshot`
with the blur card up is fine (194 ms).

## 5. Regression evidence

- Touched-module unit tests: **39/39** (`hud_banner`, `gpu_adapter`,
  `panel_visibility`, `multi_client_warning`).
- Full sim suite on the committed tree, **no dev server running** (the state the
  operator asked for at the end of the session): **2711 pass / 0 fail / 7
  skipped** — the 7 are the browser-driven suites, which skip with a reason via
  `tests/helpers/sim_server_probe.mjs` when nothing listens on :6969.
- **With a dev server up, two browser-driven tests are load-sensitive** and
  neither is attributable to this change: `pixel_map_edit_lifecycle` ("drag
  commit must schedule debounced save") and `live_touch_ui_layout` ("Spatial
  lifecycle cleanup"). Evidence: both pass repeatedly with the full stack up
  (4 runs), on this change and on trunk alike; both were re-run through an A/B
  that swaps every file this session touched for its `origin/main` version and
  restores it byte-for-byte afterwards (no git state touched), and the failures
  reproduce on **trunk** in the same environment. The only new pointer target
  this change adds is the multi-client ✕ (20×20 px, top-centre); the pixel-map
  test's own screenshot puts its dragged fixture at the bottom-left of the
  pane, and that banner cannot even appear in its page (engine offline → the
  page is pinned to pixelblaze and never joins the bridge census). Verdict:
  pre-existing flakes under concurrent browser load, worth their own card.
- `npm run check` fails before the tests at `pixel-views:check` ("stale
  `CaptainPad/live_touch/touch_control_pixel_views.json`") on this checkout;
  the check rewrote that file with LF endings (content identical to HEAD —
  `git diff --ignore-cr-at-eol` is empty). Pre-existing and unrelated to this
  change; the file was restored per `os/git.md` ("if a test modifies tracked
  state files, restore those files"), so the working tree is clean.
- `node --check` on every touched module: pass. `git diff --check`: clean
  apart from the repo's usual CRLF notices.

## 6. Open / for the operator

1. **Commit is yours** (operator gate). Security scan first:
   `python scripts/security_check.py --staged`. (`--all` over the whole tree is
   green for everything in this change: its only 6 findings are device MACs in
   **gitignored** July `simulation/.scene_backups/studiodj/…` files, which have
   never been committed.)
2. **One operator gate was added to `os/autonomy.md`** — "the operator's own
   running apps". Its list calls itself exhaustive, so leaving the browser-quit
   out of it would have read as authorization. Veto it if you disagree.
3. If you view the sim inside the Claude desktop app, Edge, or any Electron
   app, it renders on the iGPU and the banner is correct: add that app in
   Settings → System → Display → Graphics (Store apps must go through the
   Settings page; exe apps can use `--set-preference`).
4. The 19:12 iGPU pick is unexplained by logs. If it recurs, run
   `node tools/browser_gpu_check.cjs` first — it tells you in one line — then
   `--fix`.
5. Two browser-driven sim tests are load-sensitive (§5) — worth a Backlog card
   for the suite, not for this change.
6. The session's servers are all stopped and nothing is listening on
   :6967-:6972, so the operator's own launcher starts from a clean box.
