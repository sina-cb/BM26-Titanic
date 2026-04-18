export var speed = 0.08
export var brightness = 1.0

// --- TUNABLES ---
export var beamSharpness = 20      
export var maskRadius = 0.5        
export var bulbStrength = 1.0      
export var bulbFalloff = 10.0      

export var redX = 0.15
export var redY = 0.40
export var blueX = 0.80
export var blueY = 0.40
export var phaseOffset = 0.5       // 0.5 = 180 degrees in Turns

export var bg = 0.00               // Keep background clean

// Fixed defaults
export var strobePeriod = 2.0      // Seconds between strobe bursts
export var strobeDuty = 0.15       // Duration of burst
export var strobeBoost = 2.0       // Multiplier (2x brightness), not additive
export var strobeBlueDim = 0.10    

// Using Turns (0..1 = 0..360 degrees)
var rotPhase1 = 0
var rotPhase2 = 0
var strobeActive = 0

function safeSpeed() {
  return max(0.001, speed) 
}

export function beforeRender(delta) {
  var sp = safeSpeed()

  // Rotation
  var tRot = time(0.12 * sp)

  // Strobe Logic
  // 1. We fix the frequency math.
  // 2. We add +0.5 to time() so it starts "halfway" through the cycle (OFF state).
  var hz = 1.0 / max(0.1, strobePeriod)
  var tStrobe = (time(hz * sp) + 0.5) % 1.0

  strobeActive = (tStrobe < strobeDuty) ? 1 : 0

  rotPhase1 = tRot
  rotPhase2 = tRot + phaseOffset
}

function getBeaconIntensity(px, py, centerX, centerY, rotationAngle) {
  var dx = px - centerX
  var dy = py - centerY

  // Angle Calculations
  var pixelAngle = atan2(dy, dx)
  var angleDiff = 0.5 + 0.5 * cos(pixelAngle - rotationAngle)

  // Beam Shape
  var sharp = max(1, beamSharpness)
  var beam = pow(angleDiff, sharp)

  // Distance & Housing
  var dist = sqrt(dx*dx + dy*dy)
  var r = max(0.001, maskRadius)
  
  // Smooth edges for housing
  var mask = clamp(1.0 - (dist / r), 0, 1)
  mask = pow(mask, 0.5) 

  // Bulb Center
  var bulb = clamp(1.0 - (dist * max(0.1, bulbFalloff)), 0, 1)
  bulb *= max(0, bulbStrength)

  return (beam * mask) + bulb
}

export function render3D(index, x, y, z) {
  var xx = x
  var yy = y

  // 1D guard
  if (yy != yy) yy = 0.5
  if (xx != xx) xx = index / max(1, pixelCount - 1)

  var vRed  = getBeaconIntensity(xx, yy, redX,  redY,  rotPhase1)
  var vBlue = getBeaconIntensity(xx, yy, blueX, blueY, rotPhase2)

  // --- GLITCH FIX ---
  // Instead of adding (vRed + boost), which lights up the black background,
  // we MULTIPLY. This makes the existing red light brighter, 
  // but leaves black pixels black.
  if (strobeActive) {
    vRed  = vRed * (1.0 + strobeBoost) // Boost brightness
    vBlue = vBlue * strobeBlueDim      // Dim blue
  }

  // Apply background floor
  var r = vRed + bg
  var b = vBlue + bg
  
  // Gamma correction for better color blending
  r = r * r
  b = b * b

  rgb(r * brightness, 0, b * brightness)
}