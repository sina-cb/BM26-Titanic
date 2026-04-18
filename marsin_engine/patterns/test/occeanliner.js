/*
  Ocean Liner Nocturne
  Brighter + slightly faster + parameterized
*/

// ===== Parameters =====
export var pulseSpeed = 0.03        // overall breathing speed
export var shimmerSpeed = 0.18      // motion speed of shimmer/windows
export var gain = 2.8               // overall brightness

export var baseR = 0.03             // deep blue base color
export var baseG = 0.07
export var baseB = 0.24

export var pulseMin = 0.75          // minimum overall brightness pulse
export var pulseAmt = 0.35          // how much it pulses

export var shimmerMin = 0.88        // base shimmer floor
export var shimmerAmt = 0.18        // shimmer variation amount
export var shimmerStretch = 2.0     // shimmer spread across strip

export var windowCount = 8          // repeating warm window groups
export var windowThreshold = 0.80   // higher = fewer/smaller windows
export var windowSharpness = 6.0    // higher = brighter/tighter windows

export var windowR = 0.28           // warm window glow
export var windowG = 0.18
export var windowB = 0.05

// ===== Runtime =====
export function beforeRender(delta) {
  t1 = time(pulseSpeed)
  t2 = time(shimmerSpeed)

  pulse = pulseMin + pulseAmt * wave(t1)
}

export function render(index) {
  pct = index / pixelCount

  // soft motion across ship
  shimmer = shimmerMin + shimmerAmt * wave(t2 + pct * shimmerStretch)

  // repeating warm windows
  w = triangle((pct * windowCount + t2) % 1)
  windows = w > windowThreshold ? (w - windowThreshold) * windowSharpness : 0

  // base ship glow
  r = baseR * pulse * shimmer
  g = baseG * pulse * shimmer
  b = baseB * pulse * shimmer

  // warm interior/window glow
  r += windowR * windows
  g += windowG * windows
  b += windowB * windows

  rgb(r * gain, g * gain, b * gain)
}