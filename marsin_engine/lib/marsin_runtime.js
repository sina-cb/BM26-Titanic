/**
 * pb_runtime.js — Pure-JS Pixelblaze-compatible runtime for Node.js
 *
 * Provides the standard Pixelblaze API functions so that patterns
 * written for Pixelblaze hardware can run on a standard JS engine.
 *
 * Usage:
 *   const rt = createRuntime(pixelCount);
 *   rt.compile(patternCode);
 *   rt.beginFrame(elapsedSeconds);
 *   for (let i = 0; i < pixelCount; i++) {
 *     const { r, g, b } = rt.renderPixel(i, nx, ny, nz);
 *   }
 */

// ── Simplex noise (compact 2D/3D) ─────────────────────────────────────────
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const _grad3 = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
const _perm = new Uint8Array(512);
for (let i = 0; i < 256; i++) _perm[i] = _perm[i + 256] = (i * 167 + 13) & 255;

function dot3(g, x, y, z) { return g[0]*x + g[1]*y + g[2]*z; }

function simplex3(x, y, z) {
  const F3 = 1/3, G3 = 1/6;
  const s = (x+y+z)*F3;
  const i = Math.floor(x+s), j = Math.floor(y+s), k = Math.floor(z+s);
  const t = (i+j+k)*G3;
  const X0 = i-t, Y0 = j-t, Z0 = k-t;
  const x0 = x-X0, y0 = y-Y0, z0 = z-Z0;
  let i1,j1,k1,i2,j2,k2;
  if(x0>=y0){if(y0>=z0){i1=1;j1=0;k1=0;i2=1;j2=1;k2=0;}else if(x0>=z0){i1=1;j1=0;k1=0;i2=1;j2=0;k2=1;}else{i1=0;j1=0;k1=1;i2=1;j2=0;k2=1;}}
  else{if(y0<z0){i1=0;j1=0;k1=1;i2=0;j2=1;k2=1;}else if(x0<z0){i1=0;j1=1;k1=0;i2=0;j2=1;k2=1;}else{i1=0;j1=1;k1=0;i2=1;j2=1;k2=0;}}
  const x1=x0-i1+G3,y1=y0-j1+G3,z1=z0-k1+G3;
  const x2=x0-i2+2*G3,y2=y0-j2+2*G3,z2=z0-k2+2*G3;
  const x3=x0-1+3*G3,y3=y0-1+3*G3,z3=z0-1+3*G3;
  const ii=i&255,jj=j&255,kk=k&255;
  let n0=0,n1=0,n2=0,n3=0;
  let t0=0.6-x0*x0-y0*y0-z0*z0; if(t0>0){t0*=t0;n0=t0*t0*dot3(_grad3[_perm[ii+_perm[jj+_perm[kk]]]%12],x0,y0,z0);}
  let t1=0.6-x1*x1-y1*y1-z1*z1; if(t1>0){t1*=t1;n1=t1*t1*dot3(_grad3[_perm[ii+i1+_perm[jj+j1+_perm[kk+k1]]]%12],x1,y1,z1);}
  let t2=0.6-x2*x2-y2*y2-z2*z2; if(t2>0){t2*=t2;n2=t2*t2*dot3(_grad3[_perm[ii+i2+_perm[jj+j2+_perm[kk+k2]]]%12],x2,y2,z2);}
  let t3=0.6-x3*x3-y3*y3-z3*z3; if(t3>0){t3*=t3;n3=t3*t3*dot3(_grad3[_perm[ii+1+_perm[jj+1+_perm[kk+1]]]%12],x3,y3,z3);}
  return 32*(n0+n1+n2+n3); // [-1, 1]
}

// ── HSV → RGB conversion ──────────────────────────────────────────────────
function hsvToRgb(h, s, v) {
  h = ((h % 1) + 1) % 1; // wrap to [0,1)
  s = Math.max(0, Math.min(1, s));
  v = Math.max(0, Math.min(1, v));
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// ── Runtime Factory ───────────────────────────────────────────────────────
export function createRuntime(pixelCount) {
  let _beforeRender = null;
  let _render = null;
  let _render2D = null;
  let _render3D = null;

  // Current pixel output (set by hsv/rgb calls during render)
  let _currentColor = { r: 0, g: 0, b: 0 };

  // Internal clock (seconds since start)
  let _elapsedSeconds = 0;
  let _lastFrameTime = 0;

  // ── Pixelblaze API ──────────────────────────────────────────────────────
  const api = {
    pixelCount,
    PI: Math.PI,
    PI2: Math.PI * 2,
    E: Math.E,

    // Time function — wrapping sawtooth [0, 1) with configurable period
    time(interval) {
      // interval is in 65.536s units on real PB, we approximate
      const period = interval * 65.536;
      if (period <= 0) return 0;
      return ((_elapsedSeconds / period) % 1 + 1) % 1;
    },

    // Wave functions
    wave(x)            { return (1 + Math.sin(x * Math.PI * 2)) / 2; },
    triangle(x)        { x = ((x % 1) + 1) % 1; return x < 0.5 ? x * 2 : 2 - x * 2; },
    square(x, duty)    { duty = duty ?? 0.5; return ((x % 1 + 1) % 1) < duty ? 1 : 0; },

    // Math
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
    sqrt: Math.sqrt,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    log: Math.log,
    log2: Math.log2,
    exp: Math.exp,
    random: Math.random,

    clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },
    mod(a, b)        { return ((a % b) + b) % b; },
    frac(x)          { return x - Math.floor(x); },
    hypot: Math.hypot,
    atan2: Math.atan2,

    // Noise
    perlin(x, y, z, lacunarity, detail) {
      x = x || 0; y = y || 0; z = z || 0;
      lacunarity = lacunarity || 2;
      detail = detail || 1;
      let val = 0, amp = 1, totalAmp = 0;
      for (let o = 0; o < detail; o++) {
        val += simplex3(x, y, z) * amp;
        totalAmp += amp;
        amp *= 0.5;
        x *= lacunarity;
        y *= lacunarity;
        z *= lacunarity;
      }
      return (val / totalAmp + 1) / 2; // normalize to [0, 1]
    },

    // Color output — sets current pixel
    hsv(h, s, v) {
      _currentColor = hsvToRgb(h, s, v);
    },
    rgb(r, g, b) {
      _currentColor = {
        r: Math.round(Math.max(0, Math.min(1, r)) * 255),
        g: Math.round(Math.max(0, Math.min(1, g)) * 255),
        b: Math.round(Math.max(0, Math.min(1, b)) * 255),
      };
    },
    // 6-channel RGBWAU output — downmixes to RGB for v1
    rgbwau(r, g, b, w, a, u) {
      w = w || 0; a = a || 0; u = u || 0;
      _currentColor = {
        r: Math.round(Math.min(1, Math.max(0, r) + w * 0.8 + a * 0.9 + u * 0.4) * 255),
        g: Math.round(Math.min(1, Math.max(0, g) + w * 0.8 + a * 0.6) * 255),
        b: Math.round(Math.min(1, Math.max(0, b) + w * 0.8 + u * 0.7) * 255),
      };
    },
  };

  // ── Compile pattern ─────────────────────────────────────────────────────
  function compile(code) {
    // Strip ES module syntax
    let src = code
      .replace(/export\s+function\s+/g, 'function ')
      .replace(/export\s+/g, '');

    // Build function that injects the PB API as local variables
    const apiNames = Object.keys(api);
    const apiArgs = apiNames.join(', ');

    // Execute pattern code in a function scope with API injected
    const wrappedCode = `
      return function(__api) {
        const { ${apiArgs} } = __api;
        // Allow pattern to declare globals via var/let
        ${src}
        return {
          beforeRender: (typeof beforeRender !== 'undefined') ? beforeRender : null,
          render:       (typeof render !== 'undefined') ? render : null,
          render2D:     (typeof render2D !== 'undefined') ? render2D : null,
          render3D:     (typeof render3D !== 'undefined') ? render3D : null,
        };
      };
    `;

    try {
      const factory = new Function(wrappedCode)();
      const fns = factory(api);
      _beforeRender = fns.beforeRender;
      _render = fns.render;
      _render2D = fns.render2D;
      _render3D = fns.render3D;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // ── Frame rendering ─────────────────────────────────────────────────────
  function beginFrame(elapsedSeconds) {
    const delta = elapsedSeconds - _lastFrameTime;
    _elapsedSeconds = elapsedSeconds;
    _lastFrameTime = elapsedSeconds;
    if (_beforeRender) {
      _beforeRender(delta);
    }
  }

  function renderPixel(index, x = 0, y = 0, z = 0) {
    _currentColor = { r: 0, g: 0, b: 0 };

    if (_render3D) {
      _render3D(index, x, y, z);
    } else if (_render2D) {
      _render2D(index, x, y);
    } else if (_render) {
      _render(index);
    }

    return { ...(_currentColor) };
  }

  return { compile, beginFrame, renderPixel, api };
}
