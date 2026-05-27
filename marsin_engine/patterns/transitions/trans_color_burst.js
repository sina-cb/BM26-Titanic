/*
  trans_color_burst.js — Color Burst Transition
  Like trans_flash but bursts through a saturated color (default deep
  amber) instead of pure white — evokes a flare or signal lamp on a
  ship. First half: FROM -> burst color. Second half: burst color -> TO.

  Tunable hue/sat/value via the standard hsvPicker convention so
  CaptainPad can wire it into a color slot.

  Pixel-perfect endpoints — at progress=0 every pixel reads FROM (the
  first-half amt formula collapses to 0); at progress=1 every pixel
  reads TO (the second-half amt collapses to 1).

  Implementation note: the HSV→RGB conversion is inlined inside
  render() rather than cached in beforeRender(). Transitions are
  loaded through marsin_render_blend_6ch, which does NOT invoke
  beforeRender() — every per-pixel call is the first call the script
  sees within the frame. Caching the burst color across pixels would
  produce stale bytes (the previous frame's color, or worse, the VM's
  zero-initialized default which renders as pure red, masking the
  burst entirely).

  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

// Burst color (HSV). Default: deep amber/orange.
//
// Why no `export function hsvPickerBurst`: the WASM VM treats any
// `export function hsvPicker<Name>(h,s,v)` as a UI control and invokes
// it at compile/init with (0, 0, 0), which would clobber our defaults
// (H=0,S=0,V=0 -> pure red flash, no orange). Transitions are loaded
// through getBlendHandle and are not channel-wired by CPC anyway, so
// the export buys us nothing today. To make the burst color
// operator-tunable in the future, either (a) extend the engine to
// pass the picker default through to the WASM control init, or
// (b) add a per-transition param channel that writes burstH/S/V via
// setControl using a non-hsvPicker-prefixed setter. For now the
// defaults below are the canonical "amber flare" burst color.
export var burstH = 0.08;
export var burstS = 1.0;
export var burstV = 1.0;

export function render(index, x, y, z) {
  // Inline HSV → RGB (Pixelblaze HSV is hue in turns; burstH ∈ [0, 1)).
  var hv = burstH - floor(burstH);
  if (hv < 0) hv = hv + 1.0;
  var iv = floor(hv * 6.0);
  var fv = hv * 6.0 - iv;
  var pv = burstV * (1.0 - burstS);
  var qv = burstV * (1.0 - fv * burstS);
  var tv = burstV * (1.0 - (1.0 - fv) * burstS);
  var bR; var bG; var bB;
  if      (iv == 0) { bR = burstV; bG = tv;     bB = pv;     }
  else if (iv == 1) { bR = qv;     bG = burstV; bB = pv;     }
  else if (iv == 2) { bR = pv;     bG = burstV; bB = tv;     }
  else if (iv == 3) { bR = pv;     bG = qv;     bB = burstV; }
  else if (iv == 4) { bR = tv;     bG = pv;     bB = burstV; }
  else              { bR = burstV; bG = pv;     bB = qv;     }

  if (progress < 0.5) {
    // FROM -> burst color. amt ramps 0 -> 1 with a sqrt ease (rapid
    // attack so the burst flares quickly, matching a flare-bulb feel).
    var amt = progress * 2.0;
    amt = pow(amt, 0.5);
    rgbwau(
      mix(fromR, bR, amt),
      mix(fromG, bG, amt),
      mix(fromB, bB, amt),
      fromW * (1.0 - amt),
      fromA * (1.0 - amt),
      fromU * (1.0 - amt)
    );
  } else {
    // Burst color -> TO. amt^2 ease (slow start, fast finish) so the
    // burst lingers visually before resolving on the new pattern.
    var amt = (progress - 0.5) * 2.0;
    amt = pow(amt, 2.0);
    rgbwau(
      mix(bR, toR, amt),
      mix(bG, toG, amt),
      mix(bB, toB, amt),
      toW * amt,
      toA * amt,
      toU * amt
    );
  }
}
