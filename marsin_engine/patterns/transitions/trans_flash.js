/*
  trans_flash.js — Flash/Burn Transition
  Blasts to a (configurable) colour then reveals the incoming pattern.
  First half: from -> flash colour. Second half: flash colour -> to.

  Peak-window math (so the operator knows what to expect):
    The peak (amt > ~0.5 on both sides of midpoint) sits roughly across
    progress ∈ [0.35, 0.65] -> ~30% of the wall-clock duration. At
    durationMs=500 the white peak window is ~150 ms; at 1 s it is
    ~300 ms; at 2 s, ~600 ms. Operator-triggered, single peak per
    trigger — no in-script repeat.

  ─── Colour params (cross-cutting #4 fix) ───
  Defaults are pure white (`flashV=1, flashS=0`), independent of hue.
  Hue is honoured only when saturation > 0.

  Why no `export function hsvPickerFlash(h, s, v)`: the WASM VM treats
  any `export function hsvPicker<Name>(h,s,v)` as a UI control and
  invokes it at compile/init with `(0, 0, 0)` — which would clobber
  the defaults to (H=0, S=0, V=0) and produce a BLACK flash (i.e. no
  flash at all). This is the latent codex-P0 violation flagged in
  report 11.3 #4. We use the private-fn workaround documented in
  `trans_color_burst.js:28-38` and `trans_dissolve.js:42-50`: keep
  the var exported (so a future engine-level transition param API
  can poke it via setControl) but expose the setter as a private
  `_setFlashColor` rather than the magic `hsvPicker*` name.
  Hue/Sat/Val are still operator-tunable in the future — without
  the VM-init clobber.

  ─── Easing policy (cross-cutting #2 fix) ───
  The mixer fader smoothsteps `progress` over `durationMs` already
  (`pattern_mixer.js:594`). The previous implementation also applied
  `pow(amt, 0.5)` on the first half and `pow(amt, 2.0)` on the
  second — stacking with the fader's smoothstep yielded an effective
  ease of `pow(smoothstep, 0.5)` and `pow(smoothstep, 2)`. We keep
  the in-script `pow` curves because the gesture *wants* an asymmetric
  attack/decay (fast flare, slow resolve), but document that the
  net curve is the compose of fader-smoothstep with these pows. If
  the operator wants a linear time-base, call the transition with
  `curve: 'linear'` at the trigger layer.

  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

// Flash colour (HSV). Default: pure white (S=0 → hue is moot).
export var flashH = 0.0;
export var flashS = 0.0;
export var flashV = 1.0;

// Private setter; not invoked at VM init (no `slider*`/`hsvPicker*`
// magic prefix). Future engine API can poke values here via setControl.
function _setFlashColor(h, s, v) {
  flashH = h;
  flashS = s;
  flashV = v;
}

export function render(index, x, y, z) {
  // Inline HSV → RGB. `beforeRender()` is NOT invoked on blend scripts
  // (see report 11.0), so caching per-frame is impossible — every
  // pixel re-runs the branch. Mirrors `trans_color_burst.js:44-58`.
  var hv = flashH - floor(flashH);
  if (hv < 0) hv = hv + 1.0;
  var iv = floor(hv * 6.0);
  var fv = hv * 6.0 - iv;
  var pv = flashV * (1.0 - flashS);
  var qv = flashV * (1.0 - fv * flashS);
  var tv = flashV * (1.0 - (1.0 - fv) * flashS);
  var fR; var fG; var fB;
  if      (iv == 0) { fR = flashV; fG = tv;     fB = pv;     }
  else if (iv == 1) { fR = qv;     fG = flashV; fB = pv;     }
  else if (iv == 2) { fR = pv;     fG = flashV; fB = tv;     }
  else if (iv == 3) { fR = pv;     fG = qv;     fB = flashV; }
  else if (iv == 4) { fR = tv;     fG = pv;     fB = flashV; }
  else              { fR = flashV; fG = pv;     fB = qv;     }

  // White-channel peak intensity tracks flashV so a dim flash dims
  // the white channel proportionally (avoids "tinted body, full
  // white channel" mismatch on RGBW fixtures).
  var fW = flashV;

  if (progress < 0.5) {
    // First half: FROM -> flash. sqrt ease for rapid attack.
    var amt = progress * 2.0;
    amt = pow(amt, 0.5);
    rgbwau(
      mix(fromR, fR, amt),
      mix(fromG, fG, amt),
      mix(fromB, fB, amt),
      mix(fromW, fW, amt),
      fromA * (1.0 - amt),
      fromU * (1.0 - amt)
    );
  } else {
    // Second half: flash -> TO. amt^2 ease for slow→fast resolve.
    var amt = (progress - 0.5) * 2.0;
    amt = pow(amt, 2.0);
    rgbwau(
      mix(fR, toR, amt),
      mix(fG, toG, amt),
      mix(fB, toB, amt),
      mix(fW, toW, amt),
      toA * amt,
      toU * amt
    );
  }
}
