/**
 * MarsinEngine.js — Thin wrapper around the MarsinScript WASM module.
 *
 * This file is the ONLY integration point with a pre-built WASM binary.
 * No MarsinLED C++ source code is present or required.
 *
 * Usage:
 *   import { MarsinEngine } from './MarsinEngine.js';
 *   const engine = new MarsinEngine();
 *   await engine.init();
 *   engine.compile('export function render(index) { hsv(index/10, 1, 1) }');
 *   engine.beginFrame(elapsed);
 *   const { r, g, b } = engine.renderPixel(0, 0.5, 0, 0);
 */

export class MarsinEngine {
  constructor() {
    this._module = null;
    this._handle = 0;
    this._ready = false;

    // Bound C functions (set in init)
    this._compile = null;
    this._beginFrame = null;
    this._renderPixel = null;
    this._renderPixel6ch = null;
    this._renderAll = null;
    this._renderAll6ch = null;
    this._destroyVm = null;
    this._getError = null;
    
    this._pixelBufPtr = 0;
  }

  /**
   * Initialize the WASM engine.
   * @param {string} wasmDir - Path to directory containing marsin-engine.js + .wasm
   */
  async init(wasmDir = './lib/marsin-engine') {
    try {
      const moduleUrl = `${wasmDir}/marsin-engine.js`;
      let factoryFn;

      // Inject interception to capture WebAssembly exports safely
      const originalInstantiate = WebAssembly.instantiate;
      const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
      let capturedMemory = null;

      function captureFromInstance(result) {
        const instance = result.instance || result;
        if (instance && instance.exports && instance.exports.memory) {
          capturedMemory = instance.exports.memory;
        }
        return result;
      }

      WebAssembly.instantiate = async function(...args) {
        const result = await originalInstantiate.apply(this, args);
        return captureFromInstance(result);
      };

      if (originalInstantiateStreaming) {
        WebAssembly.instantiateStreaming = async function(...args) {
          const result = await originalInstantiateStreaming.apply(this, args);
          return captureFromInstance(result);
        };
      }

      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = moduleUrl;
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load ' + moduleUrl));
          document.head.appendChild(script);
        });
        factoryFn = window.MarsinEngineModule;
      } else {
        let mUrl = moduleUrl;
        if (typeof process !== 'undefined' && process.platform === 'win32' && /^[a-zA-Z]:/.test(mUrl)) {
          mUrl = 'file:///' + mUrl.replace(/\\/g, '/');
        }
        const factory = await import(mUrl);
        factoryFn = factory.default || factory;
      }

      if (typeof factoryFn !== 'function') {
        throw new TypeError('MarsinEngineModule is not a function');
      }

      this._module = await factoryFn({
        locateFile: (path) => {
          if (path.endsWith('.wasm')) {
            return `${wasmDir}/marsin-engine.wasm`;
          }
          return path;
        }
      });

      WebAssembly.instantiate = originalInstantiate; // restore
      if (originalInstantiateStreaming) {
        WebAssembly.instantiateStreaming = originalInstantiateStreaming;
      }

      // Attempt to find memory: either captured, or exposed by module
      this._wasmMemory = capturedMemory || this._module.wasmMemory || (this._module.asm && this._module.asm.memory);
      
      if (!this._wasmMemory) {
         console.warn("[MarsinEngine] Warning: Could not capture wasmMemory!");
      }

      // Bind exported C functions via cwrap
      this._compile = this._module.cwrap('marsin_compile', 'number', ['string']);
      this._beginFrame = this._module.cwrap('marsin_begin_frame', null, ['number', 'number']);
      this._renderPixel = this._module.cwrap('marsin_render_pixel', 'number',
        ['number', 'number', 'number', 'number', 'number']);
      this._renderPixel6ch = this._module.cwrap('marsin_render_pixel_6ch', null, 
        ['number', 'number', 'number', 'number', 'number', 'number']);
      this._renderAll = this._module.cwrap('marsin_render_all', null,
        ['number', 'number', 'number', 'number']);
      this._renderAll6ch = this._module.cwrap('marsin_render_all_6ch', null, 
        ['number', 'number', 'number', 'number']);
      this._destroyVm = this._module.cwrap('marsin_destroy_vm', null, ['number']);
      this._getError = this._module.cwrap('marsin_get_error', 'string', []);

      this._ready = true;
      console.log('[MarsinEngine] WASM module loaded');
    } catch (err) {
      console.error('[MarsinEngine] Failed to load WASM module:', err);
      console.error('[MarsinEngine] Place marsin-engine.js + .wasm in', wasmDir);
      this._ready = false;
    }
  }

  /** @returns {boolean} Whether the engine is initialized */
  get ready() { return this._ready; }

  /**
   * Compile a MarsinScript pattern.
   * @param {string} sourceCode - MarsinScript source code
   * @returns {boolean} true on success
   */
  compile(sourceCode) {
    if (!this._ready) return false;

    // Destroy previous instance
    if (this._handle) {
      this._destroyVm(this._handle);
      this._handle = 0;
    }

    this._handle = this._compile(sourceCode);
    if (this._handle === 0) {
      console.error('[MarsinEngine] Compile error:', this._getError());
      return false;
    }
    return true;
  }

  /**
   * Get the last compile error message.
   * @returns {string} Error message or empty string
   */
  getError() {
    return this._ready ? this._getError() : 'Engine not initialized';
  }

  /**
   * Begin a new animation frame. Runs beforeRender(delta).
   * Call once per frame before any renderPixel calls.
   * @param {number} timeSeconds - Elapsed time in seconds
   */
  beginFrame(timeSeconds) {
    if (this._handle) this._beginFrame(this._handle, timeSeconds);
  }

  /**
   * Render a single pixel.
   * @param {number} index - Pixel index (0..N-1)
   * @param {number} x - Normalized X coordinate (0..1)
   * @param {number} y - Normalized Y coordinate (0..1)
   * @param {number} z - Normalized Z coordinate (0..1)
   * @returns {{r: number, g: number, b: number}} RGB values (0-255)
   */
  renderPixel(index, x = 0, y = 0, z = 0) {
    if (!this._handle) return { r: 0, g: 0, b: 0 };
    const packed = this._renderPixel(this._handle, index, x, y, z);
    return {
      r: (packed >> 16) & 0xFF,
      g: (packed >> 8) & 0xFF,
      b: packed & 0xFF,
    };
  }

  /**
   * Render a single pixel with 6-channel output (RGBWAU).
   * @param {number} index - Pixel index (0..N-1)
   * @param {number} x - Normalized X coordinate (0..1)
   * @param {number} y - Normalized Y coordinate (0..1)
   * @param {number} z - Normalized Z coordinate (0..1)
   * @returns {{r: number, g: number, b: number, w: number, a: number, u: number}}
   */
  /** Lazily resolve the WASM memory view (called once, then cached) */
  _getMemView() {
    if (this._cachedMemView) return this._cachedMemView;
    // Try all known Emscripten memory access patterns
    const view = this._module.HEAPU8
      || (this._wasmMemory && new Uint8Array(this._wasmMemory.buffer))
      || (this._module.asm && this._module.asm.memory && new Uint8Array(this._module.asm.memory.buffer))
      || (this._module.wasmMemory && new Uint8Array(this._module.wasmMemory.buffer));
    if (view) {
      this._cachedMemView = view;
      console.log('[MarsinEngine] Memory view resolved, 6ch enabled');
    }
    return view || null;
  }

  renderPixel6ch(index, x = 0, y = 0, z = 0) {
    // Fast path: if we've already determined 6ch is unavailable, return null immediately
    if (this._6ch_unavailable) return null;
    if (!this._handle || !this._renderPixel6ch) return null;

    try {
      if (!this._pixelBufPtr) {
        this._pixelBufPtr = this._module._malloc(6);
      }

      this._renderPixel6ch(this._handle, this._pixelBufPtr, index, x, y, z);
      
      const memView = this._getMemView();
      if (!memView) {
        console.warn('[MarsinEngine] No memory view available for 6ch, disabling');
        this._6ch_unavailable = true;
        return null;
      }

      return {
        r: memView[this._pixelBufPtr],
        g: memView[this._pixelBufPtr + 1],
        b: memView[this._pixelBufPtr + 2],
        w: memView[this._pixelBufPtr + 3],
        a: memView[this._pixelBufPtr + 4],
        u: memView[this._pixelBufPtr + 5]
      };
    } catch (e) {
      // WASM function doesn't actually exist — disable 6ch permanently
      console.warn('[MarsinEngine] renderPixel6ch failed, falling back to 3ch:', e.message);
      this._6ch_unavailable = true;
      return null;
    }
  }

  /**
   * Render all pixels at once (batch — more efficient than N renderPixel calls).
   * @param {number} pixelCount - Number of pixels
   * @param {Float32Array|null} coords - Coordinate buffer (3 floats per pixel: x,y,z)
   *                                      or null for linear mapping
   * @returns {Uint8Array} RGB buffer (3 bytes per pixel)
   */
  renderAll(pixelCount, coords = null) {
    if (!this._handle || !this._ready) return new Uint8Array(pixelCount * 3);

    const outSize = pixelCount * 3;
    const outPtr = this._module._malloc(outSize);

    let coordPtr = 0;
    if (coords) {
      const coordSize = pixelCount * 3 * 4; // 3 floats * 4 bytes
      coordPtr = this._module._malloc(coordSize);
      this._module.HEAPF32.set(coords, coordPtr >> 2);
    }

    this._renderAll(this._handle, outPtr, pixelCount, coordPtr);

    const memView = this._getMemView();
    const result = new Uint8Array(outSize);
    if (memView) {
      result.set(memView.subarray(outPtr, outPtr + outSize));
    } else {
      console.warn('[MarsinEngine] No memory view available in renderAll');
    }

    this._module._free(outPtr);
    if (coordPtr) this._module._free(coordPtr);

    return result;
  }

  /**
   * Clean up and destroy the engine instance.
   */
  destroy() {
    if (this._handle) {
      this._destroyVm(this._handle);
      this._handle = 0;
    }
    if (this._pixelBufPtr) {
      this._module._free(this._pixelBufPtr);
      this._pixelBufPtr = 0;
    }
  }
}
