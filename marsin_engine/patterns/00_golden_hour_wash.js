/*
  00_golden_hour_wash.js
  Extremely warm, ambient, shifting sunset lighting.
*/

// ── MASTER PATTERN TEMPLATE ────────────────────────────────────────────
// Every pattern in this folder should follow this shape. See
// docs/MARSIN_ENGINE_PATTERNS.md (and 20260508_1 report §3/§4/§5)
// for the rationale.
//
// What the engine owns globally (do NOT redeclare):
//   • speed → engine accumulates a scaled pattern clock; `delta`
//             arriving in beforeRender is already speed-scaled.
//   • size  → engine rescales the (x,y,z) coords passed to render3D.
//             Pattern features grow/shrink automatically — no per-
//             pattern math required.
//
// What the pattern owns:
//   • sliderLocalSpeed — local trim on top of the engine's clock,
//                        v=0.5 = 1×, v=1 ≈ 4×, v=0 ≈ 0.25×.
//   • colorPalette1/2  — both global colours always come through cp1
//                        and cp2; render outputs only the cp1↔cp2
//                        gradient (no third hues, no rainbow drift).

export var localSpeed = 0.5;
export var noiseScale = 0.5;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;
export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0; // Sunset orange default cp2
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderNoiseScale(v) { noiseScale = 0.1 + (v * 0.8); }

var tPhase = 0.0;

export function beforeRender(delta) {
  // Engine already scaled `delta` by the global SPEED knob, so we
  // only apply the local trim here. v=0.5 → 1×, exponential so the
  // fader feels consistent across its travel.
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);

  // Base loop duration at normal speed is 1310.72ms
  tPhase = (tPhase + (delta / 1310.72) * localMult) % 1.0;
  if (tPhase < 0.0) tPhase += 1.0;
}

export function render3D(index, x, y, z) {
  var v = (x * noiseScale) + (y * noiseScale * 0.5) - (z * noiseScale * 0.5) + tPhase;
  var noise = wave(v);
  noise = noise * noise * noise;
  
  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;
  var h = cp1H + dh * noise;
  var s = cp1S + (cp2S - cp1S) * noise;
  var val = (cp1V + (cp2V - cp1V) * noise) * noise;
  
  // Custom hsv to rgb
  h = abs(h - floor(h));
  var iObj = floor(h * 6);
  var fObj = h * 6 - iObj;
  var pObj = val * (1.0 - s);
  var qObj = val * (1.0 - fObj * s);
  var tObj = val * (1.0 - (1.0 - fObj) * s);
  var r = 0, g = 0, b = 0;
  iObj = iObj % 6;
  if (iObj == 0)      { r = val; g = tObj; b = pObj; }
  else if (iObj == 1) { r = qObj; g = val; b = pObj; }
  else if (iObj == 2) { r = pObj; g = val; b = tObj; }
  else if (iObj == 3) { r = pObj; g = qObj; b = val; }
  else if (iObj == 4) { r = tObj; g = pObj; b = val; }
  else                { r = val; g = pObj; b = qObj; }

  var w = 0.0;
  var a = 0.0;
  
  if (y > 0.8 || z > 0.8) {
    w = noise * 2.5;
    if (w > 1.0) w = 1.0;
  }

  rgbwau(r, g, b, w, a, 0.0);
}
