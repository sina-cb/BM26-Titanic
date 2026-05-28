/*
  10_chasers.js
  Life-Cycle Chasers
*/

export var localSpeed = 0.5;
export var particleCount = 5.0;
export var tailLength = 0.15; 

export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0; // Lead (Red default)
export var cp2H = 0.15, cp2S = 1.0, cp2V = 1.0; // Tail (Orange/Yellow default)
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

export function sliderLocalSpeed(v) { localSpeed = v; }
export function sliderParticleCount(v) { particleCount = 1.0 + floor(v * 20.0); }
export function sliderTailLength(v) { tailLength = 0.02 + v * 0.3; }

var localMultiplier = 1.0;

export function beforeRender(delta) {
  localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0);
  // Per-particle time() bases are created in render (need speedVar); no
  // shared t1 anymore — it produced position teleports on each wrap.
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);
  
  var finalV = 0.0;
  var finalHue = cp1H;
  var finalSat = cp1S;
  
  for (var p = 0; p < particleCount; p++) {
     var pSeed = p * 137.5; 
     
     var dir = sin(pSeed * 3.1) > 0.0 ? 1.0 : -1.0;
     var speedVar = 0.5 + ((sin(pSeed * 7.9) * 0.5 + 0.5) * 1.0);
     var randomStart = sin(pSeed * 11.3) * 0.5 + 0.5;
     // Continuity: per-particle time() wraps at integer position boundaries
     // (currentPos folds via wrappedDist below). Old form (t1 * dir * speedVar
     // * 2) jumped by 2*speedVar (non-integer) every wrap of the shared t1 →
     // particles teleported every ~3 s.
     var posPhase = time((0.05 / localMultiplier) / (2.0 * speedVar)) * dir;
     var currentPos = randomStart + posPhase;
     
     var lifeSpeed = (0.03 + (sin(pSeed * 17.1) * 0.5 + 0.5) * 0.04) / localMultiplier;
     var lifePhase = time(lifeSpeed) + (p * 0.1234);
     var particleBrightness = wave(lifePhase); 
     
     var rawDist = currentPos - pct;
     var wrappedDist = rawDist - floor(rawDist + 0.5);
     var tailDist = wrappedDist * dir;
     
     var v = 0.0;
     var pTailHue = cp1H;
     var pTailSat = cp1S;
     var pTailVal = cp1V;
     
     if (tailDist >= 0.0 && tailDist < tailLength) {
          var tailBlend = tailDist / tailLength;
          v = 1.0 - tailBlend;
          v = pow(v, 2.0); 
          
          var dh = cp2H - cp1H;
          if (dh > 0.5) dh -= 1.0;
          else if (dh < -0.5) dh += 1.0;
          
          pTailHue = cp1H + (dh * tailBlend);
          pTailSat = cp1S + (cp2S - cp1S) * tailBlend;
          pTailVal = cp1V + (cp2V - cp1V) * tailBlend;
     }
     
     v *= particleBrightness;
     var finalPVal = v * pTailVal;
     
     if (finalPVal > finalV) {
        finalV = finalPVal;
        finalHue = pTailHue;
        finalSat = pTailSat;
     }
  }
  
  hsv(finalHue - floor(finalHue), finalSat, finalV);
}
