/*
  trans_color_burst.js — Color Burst Transition
  Like trans_flash but bursts through a saturated color (default deep
  amber) instead of white — evokes a flare or signal lamp on a ship.
  First half: from -> burst color. Second half: burst color -> to.
  Tunable hue/sat via the standard hsvPicker convention so CaptainPad
  can wire it into a color slot.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

// Default burst: deep amber/orange. Operator can override via CPC.
export var burstH = 0.08;
export var burstS = 1.0;
export var burstV = 1.0;
export function hsvPickerBurst(h, s, v) { burstH = h; burstS = s; burstV = v; }

// Cached RGB conversion of the burst color, recomputed each frame.
var bR = 1.0, bG = 0.4, bB = 0.0;
function _burstHsvToRgb() {
  var hv = burstH - floor(burstH); if (hv < 0) hv += 1.0;
  var iv = floor(hv * 6.0) % 6;
  var fv = hv * 6.0 - floor(hv * 6.0);
  var pv = burstV * (1.0 - burstS);
  var qv = burstV * (1.0 - fv * burstS);
  var tv = burstV * (1.0 - (1.0 - fv) * burstS);
  if      (iv == 0) { bR = burstV; bG = tv;     bB = pv;     }
  else if (iv == 1) { bR = qv;     bG = burstV; bB = pv;     }
  else if (iv == 2) { bR = pv;     bG = burstV; bB = tv;     }
  else if (iv == 3) { bR = pv;     bG = qv;     bB = burstV; }
  else if (iv == 4) { bR = tv;     bG = pv;     bB = burstV; }
  else              { bR = burstV; bG = pv;     bB = qv;     }
}

export function beforeRender(delta) {
  _burstHsvToRgb();
}

export function render(index, x, y, z) {
  if (progress < 0.5) {
    // from -> burst color
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
    // burst color -> to
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
