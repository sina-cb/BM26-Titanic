/**
 * led_wire.js — LED-STRAND wire math (RGBWAU render lanes → RGBW wire bytes)
 *
 * SCOPE: LED STRANDS ONLY (`patch.led === true`). DMX fixtures (pars, bars)
 * never enter this file — their channel bytes stay exactly as they were.
 *
 * ── Why this module exists ─────────────────────────────────────────────
 * The LED controller does its own white processing on every pixel it
 * receives: it first FOLDS the wire W byte into R,G,B (each channel
 * saturating at 255) and then RE-EXTRACTS white as W = min(R,G,B),
 * subtracting it from the RGB residual. Two consequences drive everything
 * below:
 *
 *   1. The only thing that survives to the emitters is the per-channel
 *      COMPOSITE  C = min(255, wireRGB + wireW).  How the host splits a
 *      given composite between the RGB bytes and the W byte is irrelevant
 *      to the output — the controller re-derives the split itself.
 *   2. If any channel's (RGB + W) exceeds 255 the composite CLIPS, and
 *      clipping is per-channel, so it destroys the RATIO between channels.
 *      That is the white bug: a warm white sent as (255,173,82,W=255)
 *      clips all three channels to 255 and arrives as NEUTRAL white — the
 *      tungsten tint is gone, and the harder the operator pushes the
 *      level, the more neutral it gets.
 *
 * The fix is to make clipping structurally impossible: fold the amber
 * lane into RGB (strands have no amber emitter), then JOINTLY PRE-SCALE
 * the whole RGBW quad by ONE factor so that every channel's composite
 * (RGB + W) fits under 255. One shared factor means every ratio — the
 * hue, and the colour-vs-white balance the pattern authored — survives
 * exactly; the picture just gets dimmer instead of getting distorted.
 *
 * The wire therefore carries TRUE RGBW: the pattern's own white lane in
 * the W byte, not a host-invented one, and not white smuggled inside RGB.
 * That is deliberate, because the emitted result must be right under BOTH
 * controller behaviours:
 *   - fold/extract (what the fleet runs today): the fold cannot clip, so
 *     the composite arrives undistorted; the controller then re-derives
 *     its own W = min(RGB) split. Tint intact.
 *   - wire-exact pass-through (a controller-side change in flight): the W
 *     byte lights the dedicated white emitter and the RGB residual stacks
 *     on top - full fidelity and more output. An encode that had hidden
 *     the white inside RGB (W = 0) would render white RGB-only there and
 *     lose the white emitter entirely.
 * Which behaviour the preview models is ONE per-controller switch
 * (`controllerWhite`), so flipping a controller after it is updated is a
 * config change, not a code change.
 *
 * UV: an RGBW strand has no UV emitter, so the UV lane is intentionally
 * DROPPED here (there is nothing on the strand that could render it).
 * Amber, by contrast, IS representable as an RGB mix and is folded in.
 *
 * ── GAMMA LIVES IN EXACTLY ONE PLACE: THE LED CONTROLLER ───────────────
 * The controller applies configurable per-channel gamma correction to its
 * own output. This mapper therefore emits LINEAR bytes and applies NO
 * gamma of its own — a second curve here would compound with the
 * controller's into a crushed, over-saturated strand. The `controllerGamma`
 * block below is a MIRROR of what is configured on the controller, used
 * ONLY to make the sim preview show what the strand will actually emit.
 * It never touches a wire byte.
 *
 * All exported helpers take/return 0..1 floats except `ledWireBytes`,
 * which returns integer 0..255 wire bytes.
 */

/**
 * Amber → RGB contribution used when folding the amber lane into the
 * strand composite. These are the sim's own preview weights (the amber
 * term of `blendRgbwau`), so the wire and the screen agree on what
 * "amber" looks like by construction.
 */
export const LED_AMBER_RGB = Object.freeze([0.9, 0.6, 0.0]);

/**
 * The per-channel gamma correction the LED controller applies to its own
 * output. THIS IS A MIRROR, not a setting: the value here must match what
 * is actually configured on the hardware, because the sim preview uses it
 * to show what the strand will emit. It never touches a wire byte.
 *
 * Default = 1.0 across the board, i.e. gamma OFF, which is how the
 * controllers ship. Tuning it is a TWO-LINE operation, both documented in
 * report 20260725_25:
 *   1. push the curve to the controller (agent_tools/led_gamma_push.cjs),
 *   2. mirror the same numbers in the scene's controllers.yaml under
 *      `led.wire.controllerGamma` so the preview follows.
 * Per-controller, so two controllers may legitimately differ.
 */
export const LED_CONTROLLER_GAMMA = Object.freeze({ r: 1.0, g: 1.0, b: 1.0, w: 1.0 });

/**
 * The curve we recommend pushing (and the push tool's default).
 *
 * R/G/B 2.2: strand PWM is linear in the byte, so an authored mid-level
 * lands at half the photons instead of half the perceived brightness —
 * mids and pastels read washed-out next to the DMX pars, which run their
 * own dimming curves. 2.2 is the standard display-referred exponent and
 * matches what the preview screen does, so screen and strand agree.
 *
 * W 1.0 is deliberate and NOT a typo: the controller extracts the white
 * channel AFTER its R/G/B curve has already been applied, so the white it
 * emits has ALREADY been gamma-corrected once. Giving W its own exponent
 * on top of that compounds the two (a 1.8 there would put whites and
 * pastels on an effective ~4.0 curve and crush them — the opposite of the
 * goal). Keep W at 1.0 unless the white emitter is measured to need its
 * own trim, and then trim it relative to 1.0.
 */
export const RECOMMENDED_CONTROLLER_GAMMA = Object.freeze({ r: 2.2, g: 2.2, b: 2.2, w: 1.0 });

/** Display transfer exponent — what the operator's screen does to a value. */
const DISPLAY_GAMMA = 2.2;

export const LED_WIRE_DEFAULTS = Object.freeze({
  // Fold the amber render lane into the strand composite (strands have no
  // amber emitter; without this the white/warm pattern family reads cool
  // and thin on strands next to the pars, which do get the amber lane).
  foldAmber: true,
  amberRgb: LED_AMBER_RGB,
  controllerGamma: LED_CONTROLLER_GAMMA,
  // Which white behaviour the controller runs - the ONE switch the
  // preview (and any future wire tuning) keys off. 'fold_extract' is what
  // the fleet runs today; flip a controller to 'passthrough' in its scene
  // config once it has a wire-exact white path.
  controllerWhite: 'fold_extract',
});

export const LED_CONTROLLER_WHITE_MODES = ['fold_extract', 'passthrough'];

// Mirrors the controller's own accepted range — a mirrored value the
// hardware would reject is a config bug, so it must fail here too.
const GAMMA_MIN = 1.0;
const GAMMA_MAX = 3.0;

function badConfig(label, msg) {
  throw new Error(`[LedWire] ${label}: ${msg}`);
}

/**
 * Validate + complete an LED wire config. Every problem THROWS (codex P0:
 * no silent fallbacks) — a scene that mis-spells a key must hard-stop the
 * boot, not quietly paint the wrong photons on the playa.
 *
 * @param {Object|undefined} raw - the scene/controller LED wire config
 * @param {string} label - controller/scene name for the error message
 */
export function normalizeLedWireConfig(raw, label = 'LED') {
  if (raw !== undefined && raw !== null && typeof raw !== 'object') {
    badConfig(label, `wire config must be an object (got ${typeof raw})`);
  }
  const src = raw || {};

  if (src.gamma !== undefined) {
    badConfig(label, 'gamma is NOT a mapper setting — the LED controller owns gamma correction ' +
      '(exactly one curve in the chain). Mirror the configured values under `controllerGamma` ' +
      'if you need the sim preview to match.');
  }

  if (src.foldAmber !== undefined && typeof src.foldAmber !== 'boolean') {
    badConfig(label, `foldAmber ${JSON.stringify(src.foldAmber)} must be a boolean`);
  }
  const foldAmber = src.foldAmber === undefined ? LED_WIRE_DEFAULTS.foldAmber : src.foldAmber;

  let amberRgb = LED_WIRE_DEFAULTS.amberRgb;
  if (src.amberRgb !== undefined) {
    const arr = src.amberRgb;
    if (!Array.isArray(arr) || arr.length !== 3) {
      badConfig(label, 'amberRgb must be a 3-element [r,g,b] array of 0..1 weights');
    }
    const nums = arr.map(Number);
    for (const n of nums) {
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        badConfig(label, `amberRgb ${JSON.stringify(arr)} entries must be numbers in 0..1`);
      }
    }
    amberRgb = Object.freeze(nums);
  }

  let controllerGamma = LED_WIRE_DEFAULTS.controllerGamma;
  if (src.controllerGamma !== undefined) {
    const cg = src.controllerGamma;
    if (!cg || typeof cg !== 'object' || Array.isArray(cg)) {
      badConfig(label, 'controllerGamma must be an object with r/g/b/w exponents');
    }
    const out = {};
    for (const k of ['r', 'g', 'b', 'w']) {
      const v = cg[k] === undefined ? LED_CONTROLLER_GAMMA[k] : Number(cg[k]);
      if (!Number.isFinite(v) || v < GAMMA_MIN || v > GAMMA_MAX) {
        badConfig(label, `controllerGamma.${k} ${JSON.stringify(cg[k])} must be a number in ` +
          `${GAMMA_MIN}–${GAMMA_MAX} (1.0 = off), matching what the LED controller accepts`);
      }
      out[k] = v;
    }
    for (const k of Object.keys(cg)) {
      if (!['r', 'g', 'b', 'w'].includes(k)) {
        badConfig(label, `controllerGamma has unknown key '${k}' (expected r, g, b, w)`);
      }
    }
    controllerGamma = Object.freeze(out);
  }

  let controllerWhite = LED_WIRE_DEFAULTS.controllerWhite;
  if (src.controllerWhite !== undefined) {
    controllerWhite = src.controllerWhite;
    if (!LED_CONTROLLER_WHITE_MODES.includes(controllerWhite)) {
      badConfig(label, `controllerWhite '${controllerWhite}' must be one of ` +
        LED_CONTROLLER_WHITE_MODES.join(', '));
    }
  }

  return Object.freeze({ foldAmber, amberRgb, controllerGamma, controllerWhite });
}

const DEFAULT_CONFIG = normalizeLedWireConfig(null, 'LED');

/**
 * Resolve the wire config for a render-list entry. Entries carry an
 * optional `ledWire` block (attached by the model exporter ONLY when the
 * scene overrides a default, so model files stay small). An invalid block
 * throws through normalizeLedWireConfig — never silently ignored.
 */
export function resolveLedWireConfig(entry) {
  if (!entry || !entry.ledWire) return DEFAULT_CONFIG;
  if (entry._ledWireCfg && entry._ledWireCfgSrc === entry.ledWire) return entry._ledWireCfg;
  const cfg = normalizeLedWireConfig(entry.ledWire, `LED pixel '${entry.name || entry.i}'`);
  entry._ledWireCfg = cfg;
  entry._ledWireCfgSrc = entry.ledWire;
  return cfg;
}

function unit(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;
}

/**
 * Render lanes -> the strand's intended RGBW, jointly pre-scaled so no
 * channel's composite (RGB + W) can exceed full scale.
 *
 * Amber is folded into RGB (config; no amber emitter on a strand), UV is
 * dropped (no UV emitter either), and the single scale factor keeps every
 * ratio the pattern authored - hue AND the colour/white balance.
 *
 * @returns {{rgb: number[], w: number, composite: number[]}} all 0..1
 */
export function ledCompositeTarget(r, g, b, w = 0, a = 0, cfg = DEFAULT_CONFIG) {
  const wl = unit(w);
  const al = unit(a);
  const amber = cfg.amberRgb;
  let cr = unit(r) + (cfg.foldAmber ? al * amber[0] : 0);
  let cg = unit(g) + (cfg.foldAmber ? al * amber[1] : 0);
  let cb = unit(b) + (cfg.foldAmber ? al * amber[2] : 0);
  let wOut = wl;
  const peak = Math.max(cr + wOut, cg + wOut, cb + wOut);
  if (peak > 1) {
    const s = 1 / peak;
    cr *= s; cg *= s; cb *= s; wOut *= s;
  }
  return { rgb: [cr, cg, cb], w: wOut, composite: [cr + wOut, cg + wOut, cb + wOut] };
}

/**
 * Target -> the four wire bytes. The COMPOSITE is what the emitters
 * reproduce, so it is quantized first and the RGB bytes are derived as
 * (composite - W): that way rounding can never push RGB + W over 255, and
 * the byte the strand ends up showing is the byte we intended.
 *
 * `whiteMode` picks how much of the composite rides the W byte:
 *   'native' (default) - exactly the pattern's white lane. A plain rgb()
 *      pattern keeps W = 0 and stays pure colour on the wire.
 *   'synth' - top the white byte up to the shared floor min(composite),
 *      i.e. push as much light as possible onto the (more efficient,
 *      fixed-temperature) white emitter. Identical output on a
 *      fold/extract controller, brighter/whiter on a pass-through one.
 * No gamma here - the LED controller owns the only gamma curve.
 */
export function ledCompositeToBytes(target, whiteMode = 'native') {
  const Cr = Math.round(Math.min(1, target.composite[0]) * 255);
  const Cg = Math.round(Math.min(1, target.composite[1]) * 255);
  const Cb = Math.round(Math.min(1, target.composite[2]) * 255);
  const floor = Math.min(Cr, Cg, Cb);
  let W = whiteMode === 'synth' ? floor : Math.round(target.w * 255);
  // The white byte can never exceed the shared floor (W is part of every
  // channel's composite). Clamping absorbs the half-byte rounding case;
  // the inequality itself holds mathematically before quantization.
  if (W > floor) W = floor;
  if (W < 0) W = 0;
  return { r: Cr - W, g: Cg - W, b: Cb - W, w: W };
}

/** Render lanes -> wire bytes (the full LED-strand encode). */
export function ledWireBytes(r, g, b, w = 0, a = 0, cfg = DEFAULT_CONFIG, whiteMode = 'native') {
  return ledCompositeToBytes(ledCompositeTarget(r, g, b, w, a, cfg), whiteMode);
}

/** The controller's video-clamped gamma curve: a non-zero input never goes black. */
function gammaByte(v, exponent) {
  if (v <= 0) return 0;
  if (exponent === 1) return v;
  const out = Math.round(Math.pow(v / 255, exponent) * 255);
  return Math.min(255, Math.max(1, out));
}

/**
 * Simulate ONE LED controller's output processing on a set of wire bytes
 * and return the LINEAR light each channel ends up emitting (0..1).
 *
 * This is the ONLY place controller behaviour is modeled, so a controller
 * that gets a wire-exact white path later flips with one config key
 * (`controllerWhite: 'passthrough'`) and nothing else moves.
 *
 * 'fold_extract' (what the fleet runs today):
 *   fold the wire W into RGB (saturating) -> per-channel gamma on R,G,B ->
 *   extract W = min(R,G,B) and subtract -> gamma on the extracted W.
 * 'passthrough':
 *   the wire W drives the white emitter directly; RGB stays the residual.
 *   Both get their own gamma curve, no extraction.
 *
 * The white emitter is modeled as neutral; its true correlated colour
 * temperature is a hardware measurement we have not taken yet (follow-up:
 * per-controller white point), and neutral is the honest, un-tuned default.
 */
export function simulateLedEmitters(bytes, cfg = DEFAULT_CONFIG, whiteEmitterRgb = [1, 1, 1]) {
  const cg = cfg.controllerGamma;
  const wb = bytes.w || 0;
  let rr, rg, rb, wOut;
  if (cfg.controllerWhite === 'passthrough') {
    rr = gammaByte(bytes.r || 0, cg.r);
    rg = gammaByte(bytes.g || 0, cg.g);
    rb = gammaByte(bytes.b || 0, cg.b);
    wOut = gammaByte(wb, cg.w);
  } else {
    // Step 1 - controller folds the wire white into RGB, saturating at 255.
    let fr = Math.min(255, (bytes.r || 0) + wb);
    let fg = Math.min(255, (bytes.g || 0) + wb);
    let fb = Math.min(255, (bytes.b || 0) + wb);
    // Step 2 - per-channel gamma, BEFORE white extraction.
    fr = gammaByte(fr, cg.r);
    fg = gammaByte(fg, cg.g);
    fb = gammaByte(fb, cg.b);
    // Step 3 - extract the shared floor onto the white emitter, curve it.
    const wo = Math.min(fr, fg, fb);
    rr = fr - wo; rg = fg - wo; rb = fb - wo;
    wOut = gammaByte(wo, cg.w);
  }
  // Emitted light = RGB residual + the white emitter's own contribution.
  return [
    Math.min(1, (rr + wOut * whiteEmitterRgb[0]) / 255),
    Math.min(1, (rg + wOut * whiteEmitterRgb[1]) / 255),
    Math.min(1, (rb + wOut * whiteEmitterRgb[2]) / 255),
  ];
}

/**
 * Linear emitted light → screen RGB. Strand PWM is linear in the byte the
 * controller packs, while the display is gamma-encoded, so the emitted
 * light has to be re-encoded for the screen to show the same PERCEIVED
 * colour the strand shows. With the controller's default curve this makes
 * the preview an exact round trip of the wire: screen = strand.
 */
export function ledEmittersToDisplay(linear) {
  const inv = 1 / DISPLAY_GAMMA;
  return [
    Math.pow(Math.min(1, Math.max(0, linear[0])), inv),
    Math.pow(Math.min(1, Math.max(0, linear[1])), inv),
    Math.pow(Math.min(1, Math.max(0, linear[2])), inv),
  ];
}

/** Wire bytes → screen RGB (used by the sACN-IN preview, which HAS bytes). */
export function ledPreviewRgbFromBytes(bytes, cfg = DEFAULT_CONFIG) {
  return ledEmittersToDisplay(simulateLedEmitters(bytes, cfg));
}

/**
 * Render lanes → screen RGB for a strand pixel: encode exactly as the
 * wire does, then run the controller's own processing on those bytes.
 * The preview therefore inherits every property of the wire — amber
 * folded in, UV dropped, no clipping, controller gamma — instead of the
 * old optimistic blend that advertised amber and UV the strand never gets.
 */
export function ledPreviewRgb(r, g, b, w = 0, a = 0, cfg = DEFAULT_CONFIG, whiteMode = 'native') {
  return ledPreviewRgbFromBytes(ledWireBytes(r, g, b, w, a, cfg, whiteMode), cfg);
}

/** True when a render-list entry is an LED-strand pixel (never a DMX fixture). */
export function isLedEntry(entry) {
  return !!(entry && (entry.type === 'led' || (entry.patch && entry.patch.led)));
}
