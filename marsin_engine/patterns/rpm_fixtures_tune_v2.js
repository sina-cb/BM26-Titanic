// RPM Fixtures Tune V2 — Metadata-aware diagnostic pattern
// Uses Model V2 built-in variables: controllerId, sectionId, fixtureId, viewMask
//
// Each controller renders a unique hue based on its controllerId.
// Brightness pulses to confirm the pixel is alive.
// sectionId adds a subtle hue shift within each controller.
//
// Deploy: mass_deploy.py rpm_shop_sign (pattern auto-deployed from deployment.yaml)

export var t1

export function beforeRender(delta) {
  t1 = time(0.05)
}

export function render(index) {
  // Base hue from controller identity (each controller = distinct color)
  var hue = controllerId / 10

  // Subtle hue offset from section within this controller
  hue = hue + sectionId / 100

  // Fixture-based saturation (fixture 0 = white diagnostic, others = full color)
  // Fixture-based saturation (fixture 0 = white diagnostic, others = full color)
  var sat = 1
  if (fixtureId == 0) {
    sat = 0.3
  }
  
  var VIEW_M = 8 // From v2_rpm_meta_02_view_bits
  if (viewMask & VIEW_M) {
    hue = hue + 0.5 // Invert hue for RPM_M specifically
  }

  // Breathing brightness (proves rendering is alive)
  var br = 0.3 + 0.7 * wave(t1 + index / 100)

  // viewMask diagnostic: if viewMask bit 1 is set (VIEW_ALL), boost brightness
  if (viewMask & 1) {
    br = min(1, br * 1.2)
  }

  hsv(hue, sat, br)
}
