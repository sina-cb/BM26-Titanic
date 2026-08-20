// render_context.js — headless pattern renderer for the parameter truth
// harness.
//
// This is deliberately the SAME machinery the live engine uses, not a second
// loader: `loadModelForGauge()` (lib/model_loader.js) builds the pixel/meta
// tables, `buildMaskConstants()` (lib/view_mask_constants.js) builds the
// MASK_* table, the `inView()` view catalog comes from the shared
// `lib/view_catalog.js` primitives engine.js itself calls, and the pattern is
// compiled through `WasmHost.compile()`. Nothing here opens a
// socket, reads config.yaml, or touches the show ports — the sweep must be
// runnable while the operator's live stack is up.
//
// Baseline control values mirror the live engine's documented behaviour:
// `parsePatternDefaults()` (lib/pattern_defaults.js) resolves each slider's
// `export var` code default, and a slider with no literal default is left at
// the VM's compiled-in slider seed — which is exactly what
// api_server.seedSliderCodeDefaults() does. The harness RECORDS which of the
// two applied per slider (`defaultSource`) so nothing is silently assumed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { WasmHost } from '../../lib/wasm_host.js';
import { loadModelForGauge } from '../../lib/model_loader.js';
import { buildViewCatalog } from '../../lib/view_catalog.js';
import { buildMaskConstants } from '../../lib/view_mask_constants.js';
import { createBitFreeViewPromoter } from '../../lib/in_view_intrinsic.js';
import { parsePatternDefaults } from '../../lib/pattern_defaults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ENGINE_DIR = path.resolve(__dirname, '../..');
export const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');

// The VM's compiled-in seed for a `slider*` control that was never written.
// Mirrors PIXELBLAZE_SLIDER_DEFAULT in lib/pattern_channel.js.
export const VM_SLIDER_SEED = 0.5;

// Export kinds reported by marsin_get_exports_json.
export const KIND_SLIDER = 1;
export const KIND_TOGGLE = 2;
export const KIND_HSV_PICKER = 6;
export const KIND_VAR = 4;

/** Frame timing: the engine runs the show at 40 fps. */
export const FRAME_DT = 0.025;

/**
 * Build a reusable offline render context for one model.
 *
 * @param {string} modelName — model file stem under marsin_engine/models.
 * @returns {Promise<object>} context with `render()` / `close()`.
 */
export async function createRenderContext(modelName) {
  const loaded = await loadModelForGauge(modelName);

  // The `inView()` catalog is assembled by the SHARED lib/view_catalog.js
  // primitives engine.js itself calls, so the Tier-A auto-views (LEFT /
  // RIGHT / FRONT / BACK / Strands / TE Signs / @BAR / CTRL_n …) are
  // present offline exactly as on the rig. loadModelForGauge() alone does not
  // derive them, and a hand-built table here held 31 of titanic's 58 names —
  // a documented view was a COMPILE_FAIL in this sweep while it compiled on
  // the rig (reports 20260804_146 §4, 20260804_147). This runs BEFORE
  // buildMaskConstants because the auto-views ride the same viewMasks array;
  // they are all bit-free (bit: 0) and buildMaskConstants deliberately skips
  // those, so the MASK_* table is unchanged by the append.
  const { viewTable, autoViews } = buildViewCatalog(loaded);
  for (const w of autoViews.warnings) console.warn(`[Model] auto-view: ${w}`);

  const maskConstants = buildMaskConstants({
    groupBits: loaded.groupBits,
    viewMasks: loaded.viewMasks,
  });

  const host = new WasmHost();
  await host.init(loaded.pixelCount);
  host.setCoords(loaded.pixels.map(p => ({ nx: p.nx, ny: p.ny, nz: p.nz })));
  host.setPixelMeta(loaded.metaArray);
  host.setMaskConstants(maskConstants);
  host.setFixtureConstants(loaded.fixtureConstants);
  host.setViewTable(viewTable);
  // `groupBits` is passed for the same reason engine.js passes its whole
  // model: the promoter seeds its allocator with every bit already claimed,
  // and a promotion that skipped the base group bits could hand a bit-free
  // view a bit a group already owns.
  host.setBitFreeViewPromoter(createBitFreeViewPromoter(
    { pixels: loaded.pixels, viewMasks: loaded.viewMasks, groupBits: loaded.groupBits }, host));

  const coords = loaded.pixels.map(p => ({ nx: p.nx, ny: p.ny, nz: p.nz }));
  const scratch = new Uint8Array(loaded.pixelCount * 6);
  const { from: blendFrom, to: blendTo } = buildBlendSources(coords);

  return {
    modelName,
    pixelCount: loaded.pixelCount,
    coords,

    /**
     * Compile `source` and return its declared controls, or the compile error.
     *
     * @param {string} source — pattern text.
     * @returns {{ ok: boolean, error?: string, exports?: object[] }}
     */
    inspect(source) {
      const res = host.compile(source);
      if (!res.ok) return { ok: false, error: res.error };
      const exports = host.getExports(res.handle) || [];
      host.destroy(res.handle);
      return { ok: true, exports };
    },

    /**
     * Render a fixed frame sequence with an explicit control assignment.
     *
     * A FRESH VM is compiled for every render so two renders of the same
     * controls are byte-identical (the harness relies on that to compute an
     * empirical per-pattern noise floor rather than assuming determinism).
     *
     * @param {string} source — pattern text.
     * @param {Map<number, number[]>} controls — control id → [v0, v1, v2].
     * @param {number} frames — frames to render AFTER warmup.
     * @param {number} warmup — leading frames to render and discard, so
     *   trail/decay/accumulator patterns are measured in steady state.
     * @returns {{ ok: boolean, error?: string, frames?: Uint8Array[] }}
     */
    render(source, controls, frames, warmup, frameTimeScale = 1) {
      const res = host.compile(source);
      if (!res.ok) return { ok: false, error: res.error };
      const handle = res.handle;
      for (const [id, v] of controls) {
        host.setControl(handle, id, v[0], v[1] || 0, v[2] || 0);
      }
      const out = [];
      const total = warmup + frames;
      for (let f = 0; f < total; f++) {
        host.beginFrame(handle, f * FRAME_DT * frameTimeScale);
        const buf = host.renderAll6ch(handle, scratch);
        if (f >= warmup) out.push(buf.slice());
      }
      host.destroy(handle);
      return { ok: true, frames: out };
    },

    /**
     * Render with ONE control pulsed as a square wave instead of held static.
     *
     * Some controls are edge-triggered by design, not level-driven:
     * 29_kick_shockwave arms its wave on `kick >= 0.5 && prevKick < 0.5`, so a
     * slider HELD anywhere in its range fires exactly nothing after the first
     * frame and measures stone dead. Those controls are meant to be driven by a
     * modulation mapping (docs/MARSIN_ENGINE_PATTERNS.md §8), and pulsing is
     * how you ask them whether they work.
     *
     * @param {string} source
     * @param {Map<number, number[]>} controls — base assignment.
     * @param {number} pulseId — control id to pulse; null renders the reference.
     * @param {number} frames
     * @param {number} warmup
     * @param {number} periodFrames — full pulse period, in frames.
     * @returns {{ ok: boolean, error?: string, frames?: Uint8Array[] }}
     */
    renderPulsed(source, controls, pulseId, frames, warmup, periodFrames,
      frameTimeScale = 1) {
      const res = host.compile(source);
      if (!res.ok) return { ok: false, error: res.error };
      const handle = res.handle;
      for (const [id, v] of controls) {
        host.setControl(handle, id, v[0], v[1] || 0, v[2] || 0);
      }
      const out = [];
      const total = warmup + frames;
      for (let f = 0; f < total; f++) {
        if (pulseId !== null) {
          // Square wave: high for the first half of each period. The rising
          // edge is what an edge-triggered control is listening for.
          const high = (f % periodFrames) < (periodFrames / 2);
          host.setControl(handle, pulseId, high ? 1.0 : 0.0, 0, 0);
        }
        host.beginFrame(handle, f * FRAME_DT * frameTimeScale);
        const buf = host.renderAll6ch(handle, scratch);
        if (f >= warmup) out.push(buf.slice());
      }
      host.destroy(handle);
      return { ok: true, frames: out };
    },

    /**
     * Render a BLEND/TRANSITION pattern through its real VM entry point.
     *
     * Transitions and channel blends do not run `renderAll` at all — the mixer
     * feeds them two source buffers and a `progress` fader via
     * `renderBlend6ch` (lib/pattern_mixer.js). Rendering them the normal way
     * leaves `progress` at 0 and every edge/feather control measures dead,
     * which is a fact about the harness, not about the pattern.
     *
     * `progress` ramps 0 → 1 across the frame sequence, exactly as a real
     * transition runs, so a wipe actually wipes and its edge controls become
     * observable.
     *
     * @param {string} source — pattern text.
     * @param {Map<number, number[]>} controls
     * @param {number} frames
     * @returns {{ ok: boolean, error?: string, frames?: Uint8Array[] }}
     */
    renderBlend(source, controls, frames, frameTimeScale = 1) {
      const res = host.compile(source);
      if (!res.ok) return { ok: false, error: res.error };
      const handle = res.handle;
      for (const [id, v] of controls) {
        host.setControl(handle, id, v[0], v[1] || 0, v[2] || 0);
      }
      const out = [];
      for (let f = 0; f < frames; f++) {
        host.beginFrame(handle, f * FRAME_DT * frameTimeScale);
        const progress = frames > 1 ? f / (frames - 1) : 0;
        out.push(host.renderBlend6ch(handle, loaded.pixelCount,
          blendFrom, blendTo, progress).slice());
      }
      host.destroy(handle);
      return { ok: true, frames: out };
    },

    close() {
      host.shutdown();
    },
  };
}

/**
 * Build the two static source buffers a blend/transition pattern composites.
 *
 * They are deliberately structured and DIFFERENT along different axes — a
 * cool ramp across x against a warm ramp across y — so a wipe's edge, its
 * direction, and its feather all leave a measurable trace. Two flat fills
 * would make most edge controls unobservable no matter how well they work.
 *
 * @param {{nx:number, ny:number, nz:number}[]} coords
 * @returns {{ from: Uint8Array, to: Uint8Array }}
 */
export function buildBlendSources(coords) {
  const n = coords.length;
  const from = new Uint8Array(n * 6);
  const to = new Uint8Array(n * 6);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const cx = coords[i].nx;
    const cy = coords[i].ny;
    // FROM: cool blue/cyan ramp along x, with a little white.
    from[o] = Math.round(20 + 40 * cx);
    from[o + 1] = Math.round(60 + 120 * cx);
    from[o + 2] = Math.round(180 + 60 * cx);
    from[o + 3] = 30;
    from[o + 4] = 30;
    from[o + 5] = 0;
    // TO: warm amber/red ramp along y, with UV so the UV lane is exercised.
    to[o] = Math.round(200 + 50 * cy);
    to[o + 1] = Math.round(90 + 80 * cy);
    to[o + 2] = Math.round(10 + 20 * cy);
    to[o + 3] = 80;
    to[o + 4] = 80;
    to[o + 5] = Math.round(40 * cy);
  }
  return { from, to };
}

/**
 * Read a pattern's source from disk.
 *
 * @param {string} id — pattern id relative to patterns/, no extension.
 * @returns {string}
 */
export function readPatternSource(id) {
  return fs.readFileSync(path.join(PATTERNS_DIR, `${id}.js`), 'utf8');
}

/**
 * Is this a blend/transition pattern (driven by `renderBlend6ch`)?
 *
 * Detected from the SOURCE, not from the file path: patterns are being renamed
 * and reorganised into themed subdirectories, so a `transitions/` prefix test
 * would quietly stop working the day someone moves a folder. A blend script is
 * the only kind that reads the mixer's `progress` fader together with the
 * `fromR…toU` source-buffer built-ins.
 *
 * @param {string} source — pattern text.
 * @returns {boolean}
 */
export function isBlendPattern(source) {
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return /\bprogress\b/.test(bare) && /\b(from|to)[RGBWAU]\b/.test(bare);
}

/**
 * Resolve the baseline control assignment for a compiled pattern.
 *
 * @param {object[]} exports — WasmHost.getExports() result.
 * @param {string} source — pattern text (for code defaults).
 * @returns {{ controls: Map<number, number[]>, sliders: object[] }}
 *   `sliders` carries { id, name, defaultValue, defaultSource } per slider.
 */
export function baselineControls(exports, source) {
  const { defaults } = parsePatternDefaults(source);
  const controls = new Map();
  const sliders = [];
  for (const exp of exports) {
    if (exp.kind !== KIND_SLIDER) continue;
    const hasCodeDefault = exp.name in defaults;
    const value = hasCodeDefault ? defaults[exp.name] : VM_SLIDER_SEED;
    controls.set(exp.id, [value, 0, 0]);
    sliders.push({
      id: exp.id,
      name: exp.name,
      defaultValue: value,
      defaultSource: hasCodeDefault ? 'code_default' : 'vm_slider_seed',
    });
  }
  return { controls, sliders };
}
