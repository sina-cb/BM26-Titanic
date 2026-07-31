/**
 * gpu_adapter.js — identify the GPU that is ACTUALLY rendering this page.
 *
 * Why this exists (report `20260725_38`): a "10 FPS titanic regression" was
 * chased through the whole render path and turned out to be no code change at
 * all — the operator's Chrome had parked its GPU process on the laptop's Intel
 * UHD iGPU instead of the RTX 4090. Same URL, same commit: 59.9 FPS on the
 * dGPU, 20 FPS iGPU windowed, 10.0 FPS iGPU at fullscreen-scale canvas. On a
 * dual-GPU Windows box the adapter can drift with power state, driver/browser
 * updates or window topology, and `powerPreference: "high-performance"`
 * (already requested at main.js) is advisory — it cannot move a GPU process
 * that already sits on the iGPU.
 *
 * So the sim REFUSES to be quiet about it (codex P0: fail loudly). This module
 * only OBSERVES and REPORTS — it changes nothing about how anything renders,
 * and must never grow an auto-fallback (no "switch backend if slow", no
 * profile downgrade). The remedy is a Windows setting on the operator's side.
 *
 * The pure helpers are exported separately so Node unit tests can cover the
 * classification and the messaging without a DOM (`gpu_adapter.test.js`).
 */

// Substrings that mean "this is not the discrete GPU we expect to render on":
// Intel iGPUs (`Intel(R) UHD Graphics`, `Intel(R) Iris(R) Xe`), anything that
// self-describes as integrated, and Chrome's software rasterizer
// (`Google SwiftShader` reports `... Basic Render Driver` on Windows).
// Apple Silicon deliberately does NOT match — its integrated GPU is the only
// GPU and renders this scene fine.
const INTEGRATED_ADAPTER_RE = /intel|uhd|iris|integrated|basic render/i;

// The one-time operator remedy. Verbatim from `20260725_38` §4.2/§4.5 — this
// exact string is what the banner shows and what the low-FPS escalation logs,
// so the fix is always one copy-paste away from wherever the symptom appears.
export const GPU_ADAPTER_REMEDY =
  'Windows Settings → Display → Graphics → add Chrome → High performance, ' +
  'then restart Chrome. Verify chrome://gpu shows the NVIDIA GPU ACTIVE.';

/**
 * Classify an unmasked adapter string.
 * @param {string|null|undefined} rendererString — e.g.
 *        `ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU …)`.
 * @returns {{ renderer: string|null, integrated: boolean, detectionFailed: boolean }}
 *          `detectionFailed` is TRUE when the browser would not tell us which
 *          GPU it is using — an unknown adapter is reported, never assumed OK.
 */
export function classifyAdapter(rendererString) {
  const s = typeof rendererString === 'string' ? rendererString.trim() : '';
  if (s === '') return { renderer: null, integrated: false, detectionFailed: true };
  return { renderer: s, integrated: INTEGRATED_ADAPTER_RE.test(s), detectionFailed: false };
}

/**
 * The loud message for an adapter, or null when the adapter is fine.
 * Shared by the HUD banner and the sustained-low-FPS escalation so the two can
 * never disagree about what the operator is told.
 * @param {{renderer: string|null, integrated: boolean, detectionFailed: boolean}} adapter
 * @returns {string|null}
 */
export function adapterWarningText(adapter) {
  if (!adapter) return null;
  if (adapter.detectionFailed) {
    return '⚠ GPU ADAPTER UNKNOWN — this browser would not report which GPU is ' +
      `rendering, so an FPS number from this window proves nothing. ${GPU_ADAPTER_REMEDY}`;
  }
  if (!adapter.integrated) return null;
  return `⚠ RENDERING ON ${adapter.renderer} — the discrete GPU is idle. ` +
    `Expect ~10-20 FPS. ${GPU_ADAPTER_REMEDY}`;
}

/**
 * One-line boot log for an adapter (also used verbatim in reports).
 * @param {{renderer: string|null, integrated: boolean, detectionFailed: boolean}} adapter
 * @param {string} rendererMode — `webgl` | `webgpu`, the backend three booted.
 * @returns {string}
 */
export function adapterLogLine(adapter, rendererMode) {
  if (!adapter || adapter.detectionFailed) {
    return `[GpuAdapter] ${rendererMode}: adapter UNKNOWN — the browser refused to name the GPU`;
  }
  const verdict = adapter.integrated ? 'INTEGRATED — SLOW' : 'discrete';
  return `[GpuAdapter] ${rendererMode}: ${adapter.renderer} (${verdict})`;
}

// ─── Browser probes ──────────────────────────────────────────────────────
// Read the adapter through a THROWAWAY probe, not through three's renderer:
// three keeps its own context/adapter handle private and version-dependent,
// while a probe lands on the same GPU process (verified in `20260725_38`).

function readWebglRendererString() {
  const canvas = document.createElement('canvas');
  // WebGL2 only — that is what three's WebGL backend uses here. A missing
  // WebGL2 is a real failure to report, not something to paper over with a
  // WebGL1 retry that would measure a different context.
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    console.error('[GpuAdapter] no WebGL2 probe context — cannot identify the GPU adapter.');
    return null;
  }
  const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
  let rendererString = null;
  if (debugExt) {
    rendererString = gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL);
  } else {
    console.error('[GpuAdapter] WEBGL_debug_renderer_info unavailable — ' +
      'the GPU adapter cannot be identified in this browser.');
  }
  // Release the probe immediately: contexts are a scarce per-tab resource and
  // this one exists only to read a string.
  const loseExt = gl.getExtension('WEBGL_lose_context');
  if (loseExt) loseExt.loseContext();
  return typeof rendererString === 'string' ? rendererString : null;
}

async function readWebgpuRendererString() {
  if (!navigator.gpu) {
    console.error('[GpuAdapter] navigator.gpu missing while the WebGPU backend is active — ' +
      'cannot identify the GPU adapter.');
    return null;
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    console.error('[GpuAdapter] navigator.gpu.requestAdapter returned null — ' +
      'cannot identify the GPU adapter.');
    return null;
  }
  const info = adapter.info;
  if (!info) {
    console.error('[GpuAdapter] WebGPU adapter exposes no .info — ' +
      'cannot identify the GPU adapter.');
    return null;
  }
  const parts = [info.vendor, info.architecture, info.device, info.description]
    .filter((part) => typeof part === 'string' && part.trim() !== '');
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Detect the live adapter, stash it on `window.__gpuAdapter` and log one line.
 * Purely diagnostic: nothing in the render path reads the result.
 * @param {{ rendererMode: string }} options — the backend three actually booted.
 * @returns {Promise<{renderer: string|null, integrated: boolean, detectionFailed: boolean}>}
 */
export async function detectGpuAdapter({ rendererMode }) {
  let rendererString = null;
  try {
    rendererString = rendererMode === 'webgpu'
      ? await readWebgpuRendererString()
      : readWebglRendererString();
  } catch (err) {
    // A diagnostic probe must never take the sim down with it — but it must
    // also never pretend it succeeded. Report, then classify as UNKNOWN.
    console.error(`[GpuAdapter] adapter probe threw: ${err.message}`);
  }
  const adapter = classifyAdapter(rendererString);
  window.__gpuAdapter = adapter;
  const line = adapterLogLine(adapter, rendererMode);
  if (adapter.integrated || adapter.detectionFailed) console.error(line);
  else console.log(line);
  return adapter;
}
