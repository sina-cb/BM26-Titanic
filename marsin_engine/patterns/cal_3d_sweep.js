export function beforeRender(delta) {
  // Sweeps from 0.0 to 1.0 (normalized spatial bounds) back and forth
  pos = wave(time(0.05))
}

// Ensure the engine is using normalized coordinates (nx, ny, nz) 
// If it uses raw dimensions, pos needs to scale by world bounding box
export function render3D(index, x, y, z) {
  // Check planar distance along the X axis
  d = abs(x - pos)
  
  // Creates a sharp 10% slice scanner
  v = clamp(1 - (d * 10), 0, 1)
  
  // High contrast white blade scanner
  hsv(0.0, 0.0, v)
}
