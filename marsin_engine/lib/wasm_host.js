import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WasmHost {
  constructor() {
    this.Module = null;
    this.pixelCount = 0;

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

  compile(code) {
    const handle = this._compile(code);
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
    for (let i = 0; i < this.pixelCount && i < pixels.length; i++) {
      this.coordView[i * 3] = pixels[i].nx || 0;
      this.coordView[i * 3 + 1] = pixels[i].ny || 0;
      this.coordView[i * 3 + 2] = pixels[i].nz || 0;
    }
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
