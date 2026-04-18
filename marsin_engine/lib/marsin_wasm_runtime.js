/**
 * marsin_wasm_runtime.js — WASM wrapper for the MarsinScript VM
 *
 * Drop-in replacement for marsin_runtime.js that uses the actual
 * MarsinVM compiled to WebAssembly via Emscripten. This gives bit-exact
 * parity with the ESP32 firmware — same compiler, same VM, same bytecode.
 *
 * Usage:
 *   const rt = await createWasmRuntime(pixelCount);
 *   rt.compile(patternCode);
 *   rt.beginFrame(elapsedSeconds);
 *   const rgbBuffer = rt.renderAll();  // Uint8Array, 3 bytes per pixel
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create a WASM-backed MarsinScript runtime.
 * @param {number} pixelCount Number of pixels.
 * @returns {Promise<object>} Runtime with compile/beginFrame/renderPixel/renderAll.
 */
export async function createWasmRuntime(pixelCount) {
  // ── Load Emscripten module ──────────────────────────────────────────
  const wasmDir = path.resolve(__dirname, '../../marsin_pb/wasm');
  const modulePath = path.join(wasmDir, 'marsin-engine.cjs');

  const require = createRequire(import.meta.url);
  const MarsinEngineModule = require(modulePath);
  const Module = await MarsinEngineModule({
    locateFile: (filename) => {
      if (filename.endsWith('.wasm')) {
        return path.join(wasmDir, 'marsin-engine.wasm');
      }
      return path.join(wasmDir, filename);
    },
  });

  // ── Bind C functions via cwrap ──────────────────────────────────────
  const _compile       = Module.cwrap('marsin_compile',       'number', ['string']);
  const _getError      = Module.cwrap('marsin_get_error',     'string', []);
  const _destroyVm     = Module.cwrap('marsin_destroy_vm',    null,     ['number']);
  const _beginFrame    = Module.cwrap('marsin_begin_frame',   null,     ['number', 'number']);
  const _renderPixel   = Module.cwrap('marsin_render_pixel',  'number', ['number', 'number', 'number', 'number', 'number']);
  const _renderAll     = Module.cwrap('marsin_render_all',    null,     ['number', 'number', 'number', 'number']);
  const _renderAllWithMeta = Module.cwrap('marsin_render_all_with_meta', null,
    ['number', 'number', 'number', 'number', 'number']);
  const _renderAllWithMeta6ch = Module.cwrap('marsin_render_all_with_meta_6ch', null,
    ['number', 'number', 'number', 'number', 'number']);
  const _setControl    = Module.cwrap('marsin_set_control',   null,     ['number', 'number', 'number', 'number', 'number']);
  const _getExportsJson = Module.cwrap('marsin_get_exports_json', 'string', ['number']);

  // ── State ───────────────────────────────────────────────────────────
  let handle = 0;

  // Pre-allocate WASM heap buffers
  const coordBufSize  = pixelCount * 3 * 4;  // 3 floats per pixel
  const outBufSize    = pixelCount * 3;       // 3 bytes per pixel (RGB)
  const outBuf6chSize = pixelCount * 6;       // 6 bytes per pixel (RGBWAU)
  const metaBufSize   = pixelCount * 4 * 4;   // 4 ints per pixel

  const coordPtr  = Module._malloc(coordBufSize);
  const outPtr    = Module._malloc(outBufSize);
  const outPtr6ch = Module._malloc(outBuf6chSize);
  let metaPtr = 0; // Allocated lazily

  // Typed views into WASM heap
  const coordView = new Float32Array(Module.HEAPF32.buffer, coordPtr, pixelCount * 3);

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Compile a MarsinScript pattern.
   * The C++ MarsinCompiler natively understands `export function` for UI
   * controls and `export var` for state variables — no JS-side stripping.
   * @param {string} code Pattern source code.
   * @returns {{ ok: boolean, error?: string }}
   */
  function compile(code) {
    if (handle) {
      _destroyVm(handle);
      handle = 0;
    }

    handle = _compile(code);
    if (handle === 0) {
      return { ok: false, error: _getError() };
    }
    return { ok: true };
  }

  /**
   * Begin a new animation frame.
   * @param {number} elapsedSeconds Elapsed time since start (seconds).
   */
  function beginFrame(elapsedSeconds) {
    if (handle) _beginFrame(handle, elapsedSeconds);
  }

  /**
   * Render a single pixel.
   * @returns {{ r: number, g: number, b: number }}
   */
  function renderPixel(index, x = 0, y = 0, z = 0) {
    if (!handle) return { r: 0, g: 0, b: 0 };
    const packed = _renderPixel(handle, index, x, y, z);
    return {
      r: (packed >> 16) & 0xFF,
      g: (packed >> 8) & 0xFF,
      b: packed & 0xFF,
    };
  }

  /**
   * Set normalized coordinates for all pixels (for batch rendering).
   * @param {Array<{nx: number, ny: number, nz: number}>} pixels
   */
  function setCoords(pixels) {
    for (let i = 0; i < pixelCount && i < pixels.length; i++) {
      coordView[i * 3]     = pixels[i].nx || 0;
      coordView[i * 3 + 1] = pixels[i].ny || 0;
      coordView[i * 3 + 2] = pixels[i].nz || 0;
    }
  }

  /**
   * Set per-pixel metadata for v2 model rendering.
   * @param {Array<{controllerId?: number, sectionId?: number, fixtureId?: number, viewMask?: number}>} metaArray
   */
  function setPixelMeta(metaArray) {
    if (!metaArray) {
      if (metaPtr) { Module._free(metaPtr); metaPtr = 0; }
      return;
    }

    if (!metaPtr) {
      metaPtr = Module._malloc(metaBufSize);
    }

    const metaView = new Int32Array(Module.HEAP32.buffer, metaPtr, pixelCount * 4);
    for (let i = 0; i < pixelCount && i < metaArray.length; i++) {
      const m = metaArray[i] || {};
      metaView[i * 4]     = m.controllerId || 0;
      metaView[i * 4 + 1] = m.sectionId || 0;
      metaView[i * 4 + 2] = m.fixtureId || 0;
      metaView[i * 4 + 3] = m.viewMask || 0;
    }
  }

  /**
   * Render all pixels in one WASM call (3-byte RGB).
   * @returns {Uint8Array} RGB buffer (3 bytes per pixel).
   */
  function renderAll() {
    if (!handle) return new Uint8Array(outBufSize);

    if (metaPtr) {
      _renderAllWithMeta(handle, outPtr, pixelCount, coordPtr, metaPtr);
    } else {
      _renderAll(handle, outPtr, pixelCount, coordPtr);
    }

    return new Uint8Array(Module.HEAPU8.buffer, outPtr, outBufSize).slice();
  }

  /**
   * Render all pixels in one WASM call (6-byte RGBWAU).
   * @returns {Uint8Array} RGBWAU buffer (6 bytes per pixel).
   */
  function renderAll6ch() {
    if (!handle) return new Uint8Array(outBuf6chSize);
    _renderAllWithMeta6ch(handle, outPtr6ch, pixelCount, coordPtr, metaPtr || 0);
    return new Uint8Array(Module.HEAPU8.buffer, outPtr6ch, outBuf6chSize).slice();
  }

  /**
   * Get UI export controls from the compiled pattern.
   * Uses the native C++ AST-to-JSON parser in the WASM binary.
   * @returns {Array<{id: number, kind: number, name: string}>}
   */
  function getExports() {
    if (!handle) return [];
    try {
      return JSON.parse(_getExportsJson(handle) || '[]');
    } catch (_) {
      return [];
    }
  }

  /**
   * Inject a parameter control value into the running pattern.
   * @param {number} id   Control ID from getExports().
   * @param {number} v0   Primary value (slider position, hue, etc.).
   * @param {number} v1   Secondary value (saturation for HSV pickers).
   * @param {number} v2   Tertiary value (value/brightness for HSV pickers).
   */
  function setControl(id, v0 = 0.0, v1 = 0.0, v2 = 0.0) {
    if (handle) _setControl(handle, id, v0, v1, v2);
  }

  /** Free all WASM resources. */
  function destroy() {
    if (handle) { _destroyVm(handle); handle = 0; }
    if (coordPtr)  Module._free(coordPtr);
    if (outPtr)    Module._free(outPtr);
    if (outPtr6ch) Module._free(outPtr6ch);
    if (metaPtr)   Module._free(metaPtr);
  }

  return {
    compile,
    beginFrame,
    renderPixel,
    renderAll,
    renderAll6ch,
    setCoords,
    setPixelMeta,
    getExports,
    setControl,
    destroy,
    pixelCount,
  };
}
