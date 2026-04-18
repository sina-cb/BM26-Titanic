/*
  10_chasers.js
  Life-Cycle Chasers
  Generates multiple distinct trailing particles throughout the spatial array 
  that individually breathe to life, transit, and fade out smoothly over dynamic lifespans!
*/

export var speed = 0.05;
export var particleCount = 5.0; // Total count of active segments in transit
export var tailLength = 0.15; 
export var baseHue = 0.0;
export var tailHue = 0.15; // Secondary Color for the fading tail!

export function sliderSpeed(v) { speed = 0.01 + v * 0.2; }
export function sliderParticleCount(v) { particleCount = 1.0 + floor(v * 20.0); }
export function sliderTailLength(v) { tailLength = 0.02 + v * 0.3; }
export function hsvPickerColor(h,s,v) { baseHue = h; }
export function hsvPickerTailColor(h,s,v) { tailHue = h; } // Independent secondary target

var t1;
export function beforeRender(delta) {
  t1 = time(speed);
}

export function render(index) {
  var pct = index / (pixelCount > 0 ? pixelCount : 144);
  
  var finalV = 0.0;
  var finalHue = baseHue;
  
  // Explicitly simulate independent particle entities!
  for (var p = 0; p < particleCount; p++) {
     // Generate stateless pseudo-random attributes for THIS specific particle "p"
     var pSeed = p * 137.5; 
     
     // 1. Random Direction: 50/50 chance of 1 or -1
     var dir = sin(pSeed * 3.1) > 0.0 ? 1.0 : -1.0;
     
     // 2. Random Speed Variance: between 0.5x and 1.5x the global speed
     var speedVar = 0.5 + ((sin(pSeed * 7.9) * 0.5 + 0.5) * 1.0);
     
     // 3. Independent Spatial Position
     // We assign a random starting position on the track, and apply the unique speed/dir vector
     var randomStart = sin(pSeed * 11.3) * 0.5 + 0.5;
     var currentPos = randomStart + (t1 * dir * speedVar * 2.0);
     
     // 4. Decoupled Lifespan Fading
     // Because speed and life are completely detached, every time it "breathes to life", 
     // it will appear in a totally random, organic spot on the strip!
     var lifeSpeed = 0.03 + (sin(pSeed * 17.1) * 0.5 + 0.5) * 0.04;
     var lifePhase = time(lifeSpeed) + (p * 0.1234);
     var particleBrightness = wave(lifePhase); 
     
     // --- GEOMETRIC TAIL SCALING ---
     // Find the raw Euclidean distance from pixel to the particle head
     var rawDist = currentPos - pct;
     // Wrap securely to the shortest path across the 0..1 boundary (handles looping seamlessly)
     var wrappedDist = rawDist - floor(rawDist + 0.5);
     
     // Align the comet tail structure perfectly opposite to whichever direction it is flying
     var tailDist = wrappedDist * dir;
     
     var v = 0.0;
     var pTailHue = baseHue;
     
     if (tailDist >= 0.0 && tailDist < tailLength) {
         // Establish gradient interpolation ratio (0.0 = Head, 1.0 = End of Tail)
         var tailBlend = tailDist / tailLength;
         
         // Shape the structural gradient into a burning comet head tapering off cleanly
         v = 1.0 - tailBlend;
         v = pow(v, 2.0); 
         
         // Dynamically shift hue toward the secondary tail color natively
         var dh = tailHue - baseHue;
         // Ensure we take the shortest path across the HSV wheel!
         if (dh > 0.5) dh -= 1.0;
         else if (dh < -0.5) dh += 1.0;
         
         pTailHue = baseHue + (dh * tailBlend);
     }
     
     // Combine geometry with the lifespan envelope
     v *= particleBrightness;
     
     // If this overlaps another particle, take the absolute brightest crest structure!
     if (v > finalV) {
        finalV = v;
        finalHue = pTailHue; // Apply the calculated secondary hue gradient explicitly 
     }
  }
  
  finalHue = finalHue - floor(finalHue); // Fallback compiler bounding
  hsv(finalHue, 1.0, finalV);
}
