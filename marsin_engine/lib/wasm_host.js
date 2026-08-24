import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

import { injectMaskConstants } from './view_mask_constants.js';
import { injectFixtureConstants } from './fixture_type_constants.js';
import { injectInViewIntrinsic } from './in_view_intrinsic.js';
import { META_LANES, VIEW_MASK_HI_ENABLED } from './meta_abi.js';

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

    // Model-derived {FIX_ROLE: bit} table for Tier-A fixture-type
    // targeting (see fixture_type_constants.js). Empty when the model's
    // fixture types do not fit the viewMask bit budget (Tier B owns that
    // model's fixture-typing — see engine loadModel). Injected into
    // pattern source alongside maskConstants at compile time.
    this.fixtureConstants = {};

    // Model-derived AUTHORED-name -> { bit, word } table for the
    // `inView("Name")` compile-time intrinsic (see in_view_intrinsic.js).
    // Set by the engine after loadModel and refreshed on model hot-reload.
    this.viewTable = {};

    // Optional host hook that allocates an in-VM bit for a bit-free
    // (Tier-A) view ON DEMAND when `inView` first tests it, sets the bit
    // on the view's member pixels, and returns { bit, word }. When a
    // promotion mutates the pixel meta, `metaDirty` is raised so the
    // caller re-packs the meta buffer (see setPixelMeta) before rendering.
    this.bitFreeViewPromoter = null;
    this.metaDirty = false;

    // Pointers and Views
    this.coordPtr = 0;
    this.coordView = null;
    this.metaPtr = 0;
    this.metaView = null;
    this.blendScratchCapacity = 0;
    this.blendOutPtr = 0;
    this.blendFromPtr = 0;
    this.blendToPtr = 0;

    // Reusable 6ch render output block (see renderAll6ch). Allocated
    // once and grown on demand instead of malloc/free per channel per
    // frame, so the 40 Hz path does no allocator work at all.
    this.renderScratchCapacity = 0;
    this.renderScratchPtr = 0;

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

  setFixtureConstants(constants) {
    this.fixtureConstants = constants || {};
  }

  // AUTHORED-name -> { bit, word } table for the inView("Name") intrinsic.
  setViewTable(table) {
    this.viewTable = table || {};
  }

  // Wire the on-demand bit-free-view promoter (engine.js owns the model
  // pixels + allocator). `fn(name) -> { bit, word }`; it must set the bit
  // on the view's member pixels and may flip metaDirty on the host so the
  // caller re-packs meta. Pass null to clear (no promotion available).
  setBitFreeViewPromoter(fn) {
    this.bitFreeViewPromoter = typeof fn === 'function' ? fn : null;
  }

  // Every compile path (boot pattern, mixer channels, live-edit API,
  // blends/transitions) funnels through here, so MASK_*/FIX_* name
  // resolution is uniform: referenced-but-undeclared constants are
  // prepended as integer `var` declarations, unknown names fail the
  // compile loudly. The two injectors are prefix-isolated, so a pattern
  // may freely mix MASK_* and FIX_*.
  compile(code) {
    let source;
    try {
      // `inView("Name")` folds FIRST (it may promote a bit-free view to an
      // in-VM bit on demand) so its emitted `(viewMask & <bit>)` /
      // `(viewMaskHi & <literal>)` test rides the same compiler the MASK_*
      // and FIX_* injections feed. An unknown name / un-promotable bit-free
      // view throws here — caught below as a loud compile error (codex P0).
      source = injectInViewIntrinsic(code, this.viewTable, this.bitFreeViewPromoter);
      source = injectMaskConstants(source, this.maskConstants);
      source = injectFixtureConstants(source, this.fixtureConstants);
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
    const outPtr6ch = this._ensureRenderScratch(outBuf6chSize);

    // ZERO FIRST — this is not defensive tidying, it is the output
    // contract (report `_361` MAJOR 1). The VM does NOT promise to write
    // every pixel: overrunning the per-pixel instruction budget truncates
    // the render SILENTLY (red-team `_112` F9/F2), and no C source is
    // vendored, so that promise is unverifiable from this repo. Whatever
    // the VM skips is copied out verbatim below, so an un-zeroed block
    // emits the PREVIOUS frame's / another channel's pixels as colour —
    // partial corruption that trips no detector (the never-black enforcer
    // only flags a UNIFORMLY black or red composite). A skipped pixel must
    // be BLACK. Pixels the VM does write are unaffected — it overwrites
    // the zeroes. One memset on a reused block also costs less than the
    // per-frame malloc/free/slice it replaces.
    this.Module.HEAPU8.fill(0, outPtr6ch, outPtr6ch + outBuf6chSize);

    this._renderAllWithMeta6ch(handle, outPtr6ch, this.pixelCount, this.coordPtr, this.metaPtr || 0);

    // HEAPU8 is read fresh every call (the view detaches if WASM memory
    // grows) and windowed to the exact size — the scratch block may be
    // larger than this model needs.
    const result = new Uint8Array(this.Module.HEAPU8.buffer, outPtr6ch, outBuf6chSize);

    if (outBuffer) {
      outBuffer.set(result);
      return outBuffer;
    }
    return result.slice();
  }

  /**
   * The 6ch render output block, allocated ONCE and grown on demand.
   *
   * This used to be a `_malloc`/`_free` pair per channel per frame — at
   * 40 fps across every mixer channel, thousands of allocator round-trips
   * a second whose only effect was to hand the VM a block still holding
   * the last render's pixels (dlmalloc returns the most recently freed
   * same-size block). Reusing one block makes the residue deterministic
   * AND removes the churn; renderAll6ch zeroes it before every render.
   *
   * @param {number} bufSize bytes needed this frame
   * @returns {number} pointer to a block of at least `bufSize` bytes
   */
  _ensureRenderScratch(bufSize) {
    if (this.renderScratchCapacity >= bufSize && this.renderScratchPtr) {
      return this.renderScratchPtr;
    }
    const nextPtr = this.Module._malloc(bufSize);
    if (!nextPtr) {
      throw new Error(`failed to allocate ${bufSize} bytes of 6ch render scratch memory`);
    }
    if (this.renderScratchPtr) this.Module._free(this.renderScratchPtr);
    this.renderScratchPtr = nextPtr;
    this.renderScratchCapacity = bufSize;
    return nextPtr;
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

  renderBlend6ch(blendHandle, pixelCount, fromBuffer, toBuffer, progress, outBuffer = null) {
    if (!blendHandle) throw new Error('renderBlend6ch requires a compiled blend handle');
    if (!Number.isInteger(pixelCount) || pixelCount <= 0) {
      throw new Error(`renderBlend6ch pixelCount must be a positive integer, got '${pixelCount}'`);
    }
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
      throw new Error(`renderBlend6ch progress must be finite in [0,1], got '${progress}'`);
    }
    const bufSize = pixelCount * 6;
    if (!fromBuffer || fromBuffer.length < bufSize || !toBuffer || toBuffer.length < bufSize) {
      throw new Error(`renderBlend6ch requires ${bufSize}-byte FROM and TO buffers`);
    }
    if (outBuffer && outBuffer.length < bufSize) {
      throw new Error(`renderBlend6ch output buffer must hold ${bufSize} bytes`);
    }

    // The endpoint contract is exact and does not enter the VM. Besides
    // avoiding float/byte round-trip residue, this removes three WASM copies
    // on the two most safety-critical frames.
    if (progress === 0 || progress === 1) {
      const endpoint = progress === 0 ? fromBuffer : toBuffer;
      if (outBuffer) {
        outBuffer.set(endpoint.subarray(0, bufSize));
        return outBuffer;
      }
      return endpoint.slice(0, bufSize);
    }

    this._ensureBlendScratch(bufSize);

    this.Module.HEAPU8.set(fromBuffer.subarray(0, bufSize), this.blendFromPtr);
    this.Module.HEAPU8.set(toBuffer.subarray(0, bufSize), this.blendToPtr);

    // Same contract as renderAll6ch: the blend VM is not promised to write
    // every pixel, and blendOutPtr is a REUSED block, so an unwritten slot
    // would emit the previous transition's pixels. Zero it so a skipped
    // pixel is black (report `_361` MAJOR 1); this runs only while a
    // transition is in flight, never on the steady-state path.
    this.Module.HEAPU8.fill(0, this.blendOutPtr, this.blendOutPtr + bufSize);

    this._renderBlend6ch(blendHandle, this.blendOutPtr, pixelCount,
                         this.coordPtr, this.metaPtr || 0,
                         this.blendFromPtr, this.blendToPtr, progress);

    const result = new Uint8Array(this.Module.HEAPU8.buffer, this.blendOutPtr, bufSize);
    if (outBuffer) {
      outBuffer.set(result);
      return outBuffer;
    }
    return result.slice();
  }

  _ensureBlendScratch(bufSize) {
    if (this.blendScratchCapacity >= bufSize) return;
    const nextOutPtr = this.Module._malloc(bufSize);
    const nextFromPtr = this.Module._malloc(bufSize);
    const nextToPtr = this.Module._malloc(bufSize);
    if (!nextOutPtr || !nextFromPtr || !nextToPtr) {
      if (nextOutPtr) this.Module._free(nextOutPtr);
      if (nextFromPtr) this.Module._free(nextFromPtr);
      if (nextToPtr) this.Module._free(nextToPtr);
      throw new Error(`failed to allocate ${bufSize * 3} bytes of blend scratch memory`);
    }
    if (this.blendOutPtr) this.Module._free(this.blendOutPtr);
    if (this.blendFromPtr) this.Module._free(this.blendFromPtr);
    if (this.blendToPtr) this.Module._free(this.blendToPtr);
    this.blendOutPtr = nextOutPtr;
    this.blendFromPtr = nextFromPtr;
    this.blendToPtr = nextToPtr;
    this.blendScratchCapacity = bufSize;
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
      // Stride is META_LANES int32/pixel (ABI lanes: [ctrl, sec, fix, view,
      // fixtureTypeId, localIndex] + optional [viewMaskHi] — see meta_abi.js).
      // The stride is gated by VIEW_MASK_HI_ENABLED so the host keeps the
      // current 6-int pack until the 7-lane WASM is vendored at integration.
      const metaBufSize = this.pixelCount * META_LANES * 4;
      this.metaPtr = this.Module._malloc(metaBufSize);
      this.metaView = new Int32Array(this.Module.HEAP32.buffer, this.metaPtr, this.pixelCount * META_LANES);
    }

    const stride = META_LANES;
    for (let i = 0; i < this.pixelCount && i < metaArray.length; i++) {
      const m = metaArray[i] || {};
      const base = i * stride;
      this.metaView[base] = m.controllerId || 0;
      this.metaView[base + 1] = m.sectionId || 0;
      this.metaView[base + 2] = m.fixtureId || 0;
      this.metaView[base + 3] = m.viewMask || 0;
      this.metaView[base + 4] = m.fixtureTypeId || 0;   // canonical FIX_* id
      this.metaView[base + 5] = m.pixelLocalIndex || 0; // 0-based index within fixture
      if (VIEW_MASK_HI_ENABLED) {
        this.metaView[base + 6] = m.viewMaskHi || 0;    // second view word (Tier C)
      }
    }
  }

  shutdown() {
    if (this.blendOutPtr) this.Module._free(this.blendOutPtr);
    if (this.blendFromPtr) this.Module._free(this.blendFromPtr);
    if (this.blendToPtr) this.Module._free(this.blendToPtr);
    if (this.coordPtr) this.Module._free(this.coordPtr);
    if (this.metaPtr) this.Module._free(this.metaPtr);
    this.blendOutPtr = 0;
    this.blendFromPtr = 0;
    this.blendToPtr = 0;
    this.blendScratchCapacity = 0;
  }
}
