import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

import { injectMaskConstants } from './view_mask_constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WasmHost {
  constructor() {
    this.Module = null;
    this.pixelCount = 0;

    // Model-derived {MASK_NAME: bit} table injected into pattern source
    // at compile time (see view_mask_constants.js). Set by the engine
    // after loadModel and refreshed on model hot-reload.
    this.maskConstants = {};

    // Pointers and Views
    this.coordPtr = 0;
    this.coordView = null;
    this.metaPtr = 0;
    this.metaView = null;

    // C function bindings
    this._compile = null;
    this._getError = null;
    this._destroyVm = null;
    this._beginFrame = null;
    this._renderPixel = null;
    this._renderAll = null;
    this._renderAllWithMeta = null;
    this._renderAllWithMeta6ch = null;
    this._setControl = null;
    this._getExportsJson = null;
    this._renderBlend6ch = null;
  }

  async init(pixelCount) {
    this.pixelCount = pixelCount;
    const wasmDir = path.resolve(__dirname, '../../marsin_pb/wasm');
    const modulePath = path.join(wasmDir, 'marsin-engine.cjs');

    const require = createRequire(import.meta.url);
    const MarsinEngineModule = require(modulePath);
    this.Module = await MarsinEngineModule({
      locateFile: (filename) => {
        if (filename.endsWith('.wasm')) {
          return path.join(wasmDir, 'marsin-engine.wasm');
        }
        return path.join(wasmDir, filename);
      },
    });

    this._compile = this.Module.cwrap('marsin_compile', 'number', ['string']);
    this._getError = this.Module.cwrap('marsin_get_error', 'string', []);
    this._destroyVm = this.Module.cwrap('marsin_destroy_vm', null, ['number']);
    this._beginFrame = this.Module.cwrap('marsin_begin_frame', null, ['number', 'number']);
    this._renderPixel = this.Module.cwrap('marsin_render_pixel', 'number', ['number', 'number', 'number', 'number', 'number']);
    this._renderAll = this.Module.cwrap('marsin_render_all', null, ['number', 'number', 'number', 'number']);
    this._renderAllWithMeta = this.Module.cwrap('marsin_render_all_with_meta', null, ['number', 'number', 'number', 'number', 'number']);
    this._renderAllWithMeta6ch = this.Module.cwrap('marsin_render_all_with_meta_6ch', null, ['number', 'number', 'number', 'number', 'number']);
    this._setControl = this.Module.cwrap('marsin_set_control', null, ['number', 'number', 'number', 'number', 'number']);
    this._getExportsJson = this.Module.cwrap('marsin_get_exports_json', 'string', ['number']);
    this._renderBlend6ch = this.Module.cwrap('marsin_render_blend_6ch', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']);

    // Allocate shared input buffers
    const coordBufSize = this.pixelCount * 3 * 4;
    this.coordPtr = this.Module._malloc(coordBufSize);
    this.coordView = new Float32Array(this.Module.HEAPF32.buffer, this.coordPtr, this.pixelCount * 3);
  }

  setMaskConstants(constants) {
    this.maskConstants = constants || {};
  }

  // Every compile path (boot pattern, mixer channels, live-edit API,
  // blends/transitions) funnels through here, so MASK_* name resolution
  // is uniform: referenced-but-undeclared constants are prepended as
  // integer `var` declarations, unknown names fail the compile loudly.
  compile(code) {
    let source;
    try {
      source = injectMaskConstants(code, this.maskConstants);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    const handle = this._compile(source);
    if (handle === 0) {
      return { ok: false, error: this._getError() };
    }
    return { ok: true, handle };
  }

  destroy(handle) {
    if (handle) {
      this._destroyVm(handle);
    }
  }

  beginFrame(handle, elapsedSeconds) {
    if (handle) {
      this._beginFrame(handle, elapsedSeconds);
    }
  }

  renderAll6ch(handle, outBuffer = null) {
    if (!handle) {
      if (outBuffer) {
        outBuffer.fill(0);
        return outBuffer;
      }
      return new Uint8Array(this.pixelCount * 6);
    }

    const outBuf6chSize = this.pixelCount * 6;
    const outPtr6ch = this.Module._malloc(outBuf6chSize);

    this._renderAllWithMeta6ch(handle, outPtr6ch, this.pixelCount, this.coordPtr, this.metaPtr || 0);
    
    const result = new Uint8Array(this.Module.HEAPU8.buffer, outPtr6ch, outBuf6chSize).slice();
    this.Module._free(outPtr6ch);

    if (outBuffer) {
      outBuffer.set(result);
      return outBuffer;
    }
    return result;
  }

  setControl(handle, id, v0 = 0.0, v1 = 0.0, v2 = 0.0) {
    if (handle) {
      this._setControl(handle, id, v0, v1, v2);
    }
  }

  getExports(handle) {
    if (!handle) return [];
    try {
      return JSON.parse(this._getExportsJson(handle) || '[]');
    } catch (_) {
      return [];
    }
  }

  setCoords(pixels) {
    // Cache an unscaled copy alongside the live coord buffer so the
    // engine's global "size" rescale can rebuild the scaled view
    // without re-reading the model. See applySizeScale() below.
    if (!this._originalCoords || this._originalCoords.length !== this.pixelCount * 3) {
      this._originalCoords = new Float32Array(this.pixelCount * 3);
    }
    for (let i = 0; i < this.pixelCount && i < pixels.length; i++) {
      const nx = pixels[i].nx || 0;
      const ny = pixels[i].ny || 0;
      const nz = pixels[i].nz || 0;
      this._originalCoords[i * 3]     = nx;
      this._originalCoords[i * 3 + 1] = ny;
      this._originalCoords[i * 3 + 2] = nz;
      this.coordView[i * 3] = nx;
      this.coordView[i * 3 + 1] = ny;
      this.coordView[i * 3 + 2] = nz;
    }
    this._lastSizeScale = 1.0;
  }

  /**
   * Rebuild the live coord buffer from the cached originals with a
   * uniform spatial multiplier. The convention is "size = how big the
   * pattern features appear":
   *
   *   size = 1.0  → 1×   (untouched coords, pattern looks unchanged)
   *   size = 2.0 → 2×   (features appear twice as large because the
   *                       pattern samples from half the coord range)
   *   size = 0.5 → 0.5× (features look smaller / more densely tiled)
   *
   * Wall-cheap: we no-op when the scale didn't change vs. the previous
   * frame, which is the common case while the operator isn't dragging
   * the SIZE fader. WASM never needed to know about this — patterns
   * just receive whatever coords are in `coordPtr`.
   */
  applySizeScale(sizeMultiplier) {
    if (!this.coordView || !this._originalCoords) return;
    const m = Number.isFinite(sizeMultiplier) && sizeMultiplier > 0
      ? sizeMultiplier
      : 1.0;
    if (m === this._lastSizeScale) return;
    // Pattern features scale UP when m > 1, which means we sample
    // from a smaller coord window → divide originals by m.
    const inv = 1.0 / m;
    const src = this._originalCoords;
    const dst = this.coordView;
    const n = src.length;
    for (let i = 0; i < n; i++) {
      dst[i] = src[i] * inv;
    }
    this._lastSizeScale = m;
  }

  renderBlend6ch(blendHandle, pixelCount, fromBuffer, toBuffer, progress) {
    if (!blendHandle) return fromBuffer;

    const bufSize = pixelCount * 6;
    const outPtr = this.Module._malloc(bufSize);
    const fromPtr = this.Module._malloc(bufSize);
    const toPtr = this.Module._malloc(bufSize);

    this.Module.HEAPU8.set(fromBuffer.subarray(0, bufSize), fromPtr);
    this.Module.HEAPU8.set(toBuffer.subarray(0, bufSize), toPtr);

    this._renderBlend6ch(blendHandle, outPtr, pixelCount,
                         this.coordPtr, this.metaPtr || 0,
                         fromPtr, toPtr, progress);

    const result = new Uint8Array(this.Module.HEAPU8.buffer, outPtr, bufSize).slice();
    this.Module._free(outPtr);
    this.Module._free(fromPtr);
    this.Module._free(toPtr);

    return result;
  }

  setPixelMeta(metaArray) {
    if (!metaArray) {
      if (this.metaPtr) {
        this.Module._free(this.metaPtr);
        this.metaPtr = 0;
        this.metaView = null;
      }
      return;
    }

    if (!this.metaPtr) {
      const metaBufSize = this.pixelCount * 4 * 4;
      this.metaPtr = this.Module._malloc(metaBufSize);
      this.metaView = new Int32Array(this.Module.HEAP32.buffer, this.metaPtr, this.pixelCount * 4);
    }

    for (let i = 0; i < this.pixelCount && i < metaArray.length; i++) {
      const m = metaArray[i] || {};
      this.metaView[i * 4] = m.controllerId || 0;
      this.metaView[i * 4 + 1] = m.sectionId || 0;
      this.metaView[i * 4 + 2] = m.fixtureId || 0;
      this.metaView[i * 4 + 3] = m.viewMask || 0;
    }
  }

  shutdown() {
    if (this.coordPtr) this.Module._free(this.coordPtr);
    if (this.metaPtr) this.Module._free(this.metaPtr);
  }
}
