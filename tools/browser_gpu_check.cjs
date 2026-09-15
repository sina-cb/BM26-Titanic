#!/usr/bin/env node
/**
 * browser_gpu_check.cjs — which GPU is the operator's browser rendering on, and
 * put Chrome back on the discrete one when it is not.
 *
 * Why this exists (report `20260914_372`, skill `.agent/skills/browser_gpu_fix.md`):
 * the sim's red "RENDERING ON ANGLE (Intel …)" banner means the browser's GPU
 * process sits on the Intel iGPU, and the scene drops from ~60 FPS to 10-20.
 * The Windows per-app "High performance" preference for chrome.exe had been set
 * for weeks and Chrome STILL came up on the iGPU once — a GPU process keeps the
 * adapter it started on, so the only remedy is a FULL quit + relaunch. This
 * tool proves which adapter every browser GPU process is on (nvidia-smi is the
 * oracle: it lists every process that holds a context on the NVIDIA GPU) and,
 * on request, performs that relaunch and re-verifies.
 *
 * Windows + NVIDIA only — that is the operator laptop (RTX 4090 Laptop GPU +
 * Intel UHD). Anywhere else it exits 2 with a clear message; no fallbacks.
 *
 * Usage:
 *   node tools/browser_gpu_check.cjs
 *       Report every adapter, every browser GPU process → adapter, and the
 *       Windows per-app preference of each browser exe. Exit 1 if a running
 *       Chrome GPU process is NOT on the NVIDIA GPU.
 *   node tools/browser_gpu_check.cjs --fix
 *       …and if Chrome is on the iGPU: quit Chrome completely (graceful close,
 *       forced after 10 s — Chrome keeps running in the background otherwise),
 *       relaunch it with the same profile and `--restore-last-session`, then
 *       re-verify with nvidia-smi. Closes the operator's browser: run it on
 *       their request.
 *   node tools/browser_gpu_check.cjs --set-preference "C:\path\to\browser.exe"
 *       Write the Windows per-app "High performance" preference for that exe
 *       (exactly what Settings → System → Display → Graphics does). The app
 *       must then be fully quit and reopened. Store/MSIX apps (…\WindowsApps\…)
 *       are refused — add those through the Settings page as "Microsoft Store
 *       app".
 */
const { spawnSync } = require('child_process');
const fs = require('fs');

const CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const REG_KEY = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
// Browser / Electron GPU hosts worth naming in the report. Anything else with a
// `--type=gpu-process` child is listed too, just without commentary.
const BROWSER_EXES = new Set(['chrome.exe', 'msedge.exe', 'msedgewebview2.exe', 'brave.exe',
  'claude.exe', 'chatgpt.exe', 'slack.exe', 'notion.exe', 'code.exe', 'discord.exe']);
const GRACEFUL_QUIT_MS = 10000;
const RELAUNCH_VERIFY_MS = 25000;

const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const SET_PREF_INDEX = args.indexOf('--set-preference');
const SET_PREF_EXE = SET_PREF_INDEX !== -1 ? args[SET_PREF_INDEX + 1] : null;

function log(line) {
  console.log(`[gpu-check] ${line}`);
}

function fail(code, message) {
  console.error(`[gpu-check] ${message}`);
  process.exit(code);
}

// ── shell helpers ─────────────────────────────────────────────────────────

function ps(script) {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', script], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`powershell exited ${r.status}: ${(r.stderr || r.stdout || '').trim()}`);
  }
  return r.stdout;
}

/** Run a PowerShell pipeline and parse its JSON; always returns an array. */
function psRows(script) {
  const out = ps(`@(${script}) | ConvertTo-Json -Compress -Depth 4`).trim();
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function nvidiaSmi(queryArgs) {
  const r = spawnSync('nvidia-smi', queryArgs, { encoding: 'utf8', windowsHide: true });
  if (r.error) {
    if (r.error.code === 'ENOENT') return null; // no NVIDIA driver on this box
    throw r.error;
  }
  if (r.status !== 0) throw new Error(`nvidia-smi exited ${r.status}: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ── data collection ───────────────────────────────────────────────────────

function readAdapters() {
  return psRows("Get-CimInstance Win32_VideoController | Select-Object Name, PNPDeviceID, DriverVersion, CurrentHorizontalResolution, CurrentVerticalResolution");
}

function readGpuProcesses() {
  // The PowerShell running this very query carries the search string on its own
  // command line — exclude shells so the tool never lists itself.
  return psRows("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--type=gpu-process*' -and $_.Name -notmatch '^(powershell|pwsh|cmd|bash|node)\\.exe$' } | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath");
}

function readChromeBrowserProcesses() {
  return psRows("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -notlike '*--type=*' } | Select-Object ProcessId, CommandLine");
}

/** pid → Set<pid> of processes holding a context on the NVIDIA GPU. */
function readNvidiaPids() {
  const out = nvidiaSmi(['--query-compute-apps=pid,process_name', '--format=csv,noheader']);
  if (out === null) return null;
  const pids = new Set();
  for (const line of out.split('\n')) {
    const pid = Number(line.split(',')[0]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return pids;
}

/** pid → [{luid, mb}] committed video memory per adapter, from Windows perf counters. */
function readLuidMemory(pids) {
  if (pids.length === 0) return new Map();
  const rows = psRows("(Get-Counter '\\GPU Process Memory(*)\\Shared Usage','\\GPU Process Memory(*)\\Dedicated Usage' -ErrorAction SilentlyContinue).CounterSamples | Where-Object { $_.CookedValue -gt 0 } | Select-Object InstanceName, CookedValue");
  const byPid = new Map();
  for (const row of rows) {
    const m = /^pid_(\d+)_luid_0x[0-9a-f]+_0x([0-9a-f]+)_phys_\d+$/i.exec(row.InstanceName || '');
    if (!m) continue;
    const pid = Number(m[1]);
    if (!pids.includes(pid)) continue;
    const list = byPid.get(pid) || [];
    const luid = `0x${m[2]}`;
    const entry = list.find((e) => e.luid === luid);
    if (entry) entry.mb += row.CookedValue / 1048576;
    else list.push({ luid, mb: row.CookedValue / 1048576 });
    byPid.set(pid, list);
  }
  return byPid;
}

/** exe path → the raw Windows per-app graphics preference string ('' when unset). */
function readPreferences() {
  const rows = psRows(`$k = Get-Item -Path '${REG_KEY}' -ErrorAction SilentlyContinue; if ($k) { $k.GetValueNames() | ForEach-Object { [pscustomobject]@{ name = $_; value = [string]$k.GetValue($_) } } }`);
  const prefs = new Map();
  for (const row of rows) prefs.set(String(row.name).toLowerCase(), String(row.value));
  return prefs;
}

function describePreference(raw) {
  if (!raw) return 'NOT SET (Windows decides → iGPU on this laptop)';
  const m = /GpuPreference=(\d+);/.exec(raw);
  if (!m) return `set but unreadable: "${raw}"`;
  return { 0: 'Let Windows decide', 1: 'POWER SAVING (iGPU)', 2: 'High performance (discrete)' }[m[1]] || `GpuPreference=${m[1]}`;
}

// ── report ────────────────────────────────────────────────────────────────

function report() {
  const adapters = readAdapters();
  log('Adapters:');
  for (const a of adapters) {
    const display = a.CurrentHorizontalResolution ? `drives the display ${a.CurrentHorizontalResolution}x${a.CurrentVerticalResolution}` : 'no display attached (render-only)';
    log(`  ${a.Name} — driver ${a.DriverVersion} — ${display}`);
  }
  const nvidiaPids = readNvidiaPids();
  if (nvidiaPids === null) {
    fail(2, 'nvidia-smi not found — this tool identifies the discrete GPU through the NVIDIA driver and knows nothing else. Not an NVIDIA box: use chrome://gpu ("GPU0 … *ACTIVE*") by hand.');
  }
  const gpuProcs = readGpuProcesses();
  const luidMem = readLuidMemory(gpuProcs.map((p) => p.ProcessId));
  const prefs = readPreferences();

  log('Browser GPU processes (nvidia-smi is the oracle for "on the NVIDIA GPU"):');
  let chromeVerdict = null; // null = not running, true = discrete, false = iGPU
  for (const p of gpuProcs) {
    const name = String(p.Name || '').toLowerCase();
    const onNvidia = nvidiaPids.has(p.ProcessId);
    const mem = (luidMem.get(p.ProcessId) || []).map((e) => `${e.luid}=${e.mb.toFixed(0)}MB`).join(' ') || 'no committed memory';
    const exe = String(p.ExecutablePath || '');
    const pref = describePreference(prefs.get(exe.toLowerCase()));
    const marker = onNvidia ? 'NVIDIA GPU  ' : 'iGPU        ';
    const note = BROWSER_EXES.has(name) ? '' : '  (not a browser)';
    log(`  ${marker} ${name.padEnd(20)} pid ${String(p.ProcessId).padEnd(6)} [${mem}]  Windows preference: ${pref}${note}`);
    if (name === 'chrome.exe') chromeVerdict = onNvidia;
  }
  if (gpuProcs.length === 0) log('  (none running)');

  const chromePref = describePreference(prefs.get(CHROME_EXE.toLowerCase()));
  log(`Windows preference for ${CHROME_EXE}: ${chromePref}`);

  if (chromeVerdict === null) {
    log('Chrome is not running. A fresh launch picks the GPU from the Windows preference above — launch it, then run this check again.');
  } else if (chromeVerdict) {
    log('VERDICT: Chrome renders on the NVIDIA GPU. The sim will show no GPU banner.');
  } else {
    log('VERDICT: Chrome\'s GPU process is on the Intel iGPU — the sim will show the red banner and run at 10-20 FPS.');
    log('  A GPU process keeps the adapter it started on: closing windows is not enough; Chrome must fully quit.');
    log('  Fix: node tools/browser_gpu_check.cjs --fix   (quits Chrome completely, relaunches the same profile with tabs restored, re-verifies)');
    if (!/High performance/.test(chromePref)) {
      log(`  Also set the preference first: node tools/browser_gpu_check.cjs --set-preference "${CHROME_EXE}"`);
    }
  }
  return { chromeVerdict, chromePref };
}

// ── --fix ─────────────────────────────────────────────────────────────────

function chromeRunning() {
  return readGpuProcesses().some((p) => String(p.Name || '').toLowerCase() === 'chrome.exe')
    || readChromeBrowserProcesses().length > 0;
}

function waitUntil(predicate, timeoutMs, stepMs = 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (predicate()) return true;
    sleep(stepMs);
  }
  return predicate();
}

function fixChrome() {
  const browsers = readChromeBrowserProcesses();
  const cmd = browsers.length > 0 ? String(browsers[0].CommandLine || '') : '';
  const profileMatch = /--profile-directory=(?:"([^"]+)"|(\S+))/.exec(cmd);
  const profile = profileMatch ? (profileMatch[1] || profileMatch[2]) : 'Default';
  log(`Quitting Chrome completely (profile "${profile}"; its tabs are restored on relaunch)…`);
  spawnSync('taskkill', ['/IM', 'chrome.exe'], { encoding: 'utf8', windowsHide: true }); // graceful: WM_CLOSE
  if (!waitUntil(() => !chromeRunning(), GRACEFUL_QUIT_MS)) {
    log('  Chrome is still running after the graceful close (background mode or a hung process) — forcing.');
    spawnSync('taskkill', ['/F', '/IM', 'chrome.exe'], { encoding: 'utf8', windowsHide: true });
    if (!waitUntil(() => !chromeRunning(), 5000)) fail(1, 'Chrome would not exit even when forced — quit it from Task Manager and rerun.');
  }
  log('  Chrome is fully closed. Relaunching…');
  ps(`Start-Process -FilePath '${CHROME_EXE}' -ArgumentList '--profile-directory="${profile}"','--restore-last-session'`);
  const nvidiaHasChrome = () => {
    const pids = readNvidiaPids();
    return readGpuProcesses().some((p) => String(p.Name || '').toLowerCase() === 'chrome.exe' && pids && pids.has(p.ProcessId));
  };
  if (waitUntil(nvidiaHasChrome, RELAUNCH_VERIFY_MS, 1000)) {
    log('VERIFIED: the relaunched Chrome GPU process is on the NVIDIA GPU. Reload the sim — the banner is gone.');
    return true;
  }
  log('NOT FIXED: the relaunched Chrome is still not on the NVIDIA GPU after ' + (RELAUNCH_VERIFY_MS / 1000) + ' s.');
  log('  Check the Windows preference (above) and chrome://gpu, then see .agent/skills/browser_gpu_fix.md.');
  return false;
}

// ── --set-preference ──────────────────────────────────────────────────────

function setPreference(exe) {
  if (!exe) fail(2, '--set-preference needs the full path of the browser exe.');
  if (!fs.existsSync(exe)) fail(2, `--set-preference: "${exe}" does not exist on disk — the preference is keyed to the exact exe path.`);
  if (/\\WindowsApps\\/i.test(exe)) {
    fail(2, `--set-preference: "${exe}" is a Store/MSIX app whose path changes on every update. Add it in Settings → System → Display → Graphics → Add an app → "Microsoft Store app" instead.`);
  }
  const current = readPreferences().get(exe.toLowerCase()) || '';
  const next = /GpuPreference=\d+;/.test(current)
    ? current.replace(/GpuPreference=\d+;/, 'GpuPreference=2;')
    : `${current}GpuPreference=2;`;
  ps(`if (-not (Test-Path '${REG_KEY}')) { New-Item -Path '${REG_KEY}' -Force | Out-Null }; Set-ItemProperty -Path '${REG_KEY}' -Name '${exe.replace(/'/g, "''")}' -Value '${next}' -Type String`);
  const written = readPreferences().get(exe.toLowerCase());
  if (written !== next) fail(1, `--set-preference: wrote "${next}" but read back "${written}".`);
  log(`Windows per-app graphics preference for ${exe}: ${describePreference(written)}`);
  log('  (= Settings → System → Display → Graphics → High performance.) Now QUIT that app completely and reopen it — a running GPU process keeps its adapter.');
}

// ── main ──────────────────────────────────────────────────────────────────

if (process.platform !== 'win32') {
  fail(2, 'Windows only — this tool reads Windows per-app graphics preferences and GPU perf counters.');
}

if (SET_PREF_INDEX !== -1) {
  setPreference(SET_PREF_EXE);
  process.exit(0);
}

const { chromeVerdict } = report();
if (chromeVerdict === false && FIX) {
  process.exit(fixChrome() ? 0 : 1);
}
process.exit(chromeVerdict === false ? 1 : 0);
