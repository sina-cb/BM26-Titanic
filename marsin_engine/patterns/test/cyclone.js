/*
  Christmas - Confetti Cyclone
  ----------------------------
  Fragmented pixels of Red, Green, and Gold flowing 
  upwards in a spiral, like blown confetti.
*/

export var speed = 0.6         // Fast upward movement looks best
export var density = 30         // How many "bands" of confetti (higher = more scattered)
export var particleSize = 0.5  // Length of confetti trails
export var bgBrightness = 0.1  // Dim background to see the tree shape

var goldHue = 0.12

// Color cycle array
var colors = [0.0, 0.33, goldHue]

export function render(index) {
    var pct = index / pixelCount

    // 1. MOVEMENT PHYSICS
    // Create upward spiral motion (sawtooth wave 0->1)
    // We subtract pct to move up the spiral
    var pos = (time(speed) * density - pct * density) % 1
    // Handle negative modulo result
    if (pos < 0) pos += 1

    // 2. FRAGMENTATION & COLOR ASSIGNMENT
    // Use the pixel index to determine which color this specific pixel should be.
    // This guarantees adjacent pixels are usually different colors (high pixelation).
    var colorIdx = index % 3
    var h = colors[colorIdx]
    var s = 1.0

    // If it's gold, lower saturation slightly for richness
    if (colorIdx == 2) s = 0.8

    var v = bgBrightness // Default background

    // 3. DRAW CONFETTI PARTICLE
    // If the position wave is near its start (0.0 to particleSize)
    if (pos < particleSize) {
        // Brightness fades from head to tail
        var particleB = 1.0 - (pos / particleSize)
        // Sharpen the particle
        particleB = particleB * particleB
        v = particleB
    }

    // 4. ADD THE SMOOTH SPARKLE OVERLAY (for extra glitz on top)
    var starTimer = (index * 23.3) + time(0.3)
    var star = triangle(starTimer)
    star = pow(star, 20)

    if (star > 0.1) {
        var sparkleB = star * 0.5 // Max sparkle brightness 0.5
        // If sparkle is brighter than current confetti piece, flash white/gold
        if (sparkleB > v) {
            h = goldHue; s = 0.3; v = sparkleB;
        }
    }

    hsv(h, s, v)
}