/*
  09_cyclone.js
  Confetti Cyclone
*/

export var localSpeed = 0.5;
export var density = 30;
export var particleSize = 0.5;

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0; // Red default
export var cp2H = 0.33, cp2S = 1.0, cp2V = 1.0; // Green default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderDensity(v) { density = 5.0 + v * 50.0; }
export function sliderParticleSize(v) { particleSize = 0.1 + v * 0.8; }

var t1;
export function beforeRender(delta) {
  var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  t1 = time(0.6 / localMultiplier);
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);

  var pos = (t1 * density - pct * density) % 1.0;
  if (pos < 0.0) pos += 1.0;

  var colorIdx = index % 3;
  var h = cp1H;
  var s = cp1S;
  var maxVal = cp1V;

  var dh = cp2H - cp1H;
  if (dh > 0.5) dh -= 1.0;
  else if (dh < -0.5) dh += 1.0;

  if (colorIdx == 1) {
     h = cp2H;
     s = cp2S;
     maxVal = cp2V;
  } else if (colorIdx == 2) {
     h = cp1H + dh * 0.5; 
     s = 0.5 * (cp1S + cp2S);
     maxVal = 0.5 * (cp1V + cp2V);
  }

  var v = 0.1;

  if (pos < particleSize) {
      var particleB = 1.0 - (pos / particleSize);
      particleB = particleB * particleB;
      v = max(v, particleB);
  }

  // Sparkle overlay
  var starTimer = (index * 23.3) + time(0.3);
  var star = pow(triangle(starTimer), 20.0);

  if (star > 0.1) {
      var sparkleB = star * 0.5;
      if (sparkleB > v) {
          h = cp1H + dh * 0.5; 
          s = 0.5 * (cp1S + cp2S) * 0.3; // desaturate for sparkle glow
          v = sparkleB * (0.5 * (cp1V + cp2V));
      }
  }

  hsv(h - floor(h), s, v * maxVal);
}
