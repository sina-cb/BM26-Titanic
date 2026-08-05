/*
  inview_demo.js — demonstrates the compile-time inView("Name") intrinsic.

  `inView("ViewName")` tests whether the pixel being rendered belongs to a
  named in-VM view. The name is resolved (and, for a bit-free Tier-A view,
  PROMOTED to an in-VM bit) at COMPILE TIME by the host's injector, then
  folded to the exact bitwise membership test:

      inView("X")  ->  ((viewMask   & <bit>)     != 0)   // low-word view
      inView("X")  ->  ((viewMaskHi & <literal>) != 0)   // high-word view

  No MASK_* identifier convention, no knowing which word the bit lives in —
  just the authored view name (the same string the Views panel / CaptainPad
  use). An unknown name is a LOUD compile error (codex P0), never a silent
  constant-false test.

  This example lights the named view solid red and everything else off, so
  it renders to EXACTLY that view's pixels. Swap the literal below for any
  view your model carries (e.g. "LEFT", "FRONT", "@BAR", "Strands",
  "Hull Canvas").

  NOTE: this is an EXAMPLE, not a playlist pattern — it is deliberately not
  registered in patterns/manifest.json. Point it at a view your loaded model
  actually has, or it will (correctly) fail to compile.
*/

export function render3D(index, x, y, z) {
  if (inView("LEFT")) {
    rgb(1, 0, 0);   // member of the named view → solid red
  } else {
    rgb(0, 0, 0);   // everything else → off
  }
}
