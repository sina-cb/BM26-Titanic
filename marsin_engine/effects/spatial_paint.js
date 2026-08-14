/*
  spatial_paint.js — "Spatial Paint" as a GLOBAL EFFECT.

  WHAT IT IS: the operator drags a point on a top-down map of the hull and the
  pixels under that point light up, leaving a trail that cools behind them.

  WHY IT IS AN EFFECT AND NOT A PATTERN (this is the whole reason the file
  exists). The same idea already exists as pattern 130_spatial_paint, riding that
  pattern's own local sliders — because, as its header says, "the engine exposes
  NO positional parameter; its spatial concept is view/group masks, not
  Cartesian space". That works, and it is dead on all 200+ other patterns, and
  it dies mid-show the moment the autopilot cycles the deck (MEASURED: the deck
  drifted to summer_camp/53_shadow_eclipse and the position sliders simply
  vanished from /exports). The operator's requirement is that drawing works on
  EVERY pattern, so the position has to live above the pattern layer.
  A global effect runs on the COMPOSED pixel buffer after the deck has rendered,
  and it receives px.nx/ny/nz — e2_waterline_sweep is already "a spatial band
  across nx/ny/nz" on exactly this footing. So this belongs here.

  HEIGHT IS IGNORED ON PURPOSE. The operator is aiming at a PLACE on the ship,
  not an altitude; including ny would make a deck light and the rail above it
  respond differently to the same touch, which reads as the surface being
  broken. Distance is measured in the nx/nz plane only — the same choice
  130_spatial_paint made and for the same reason.

  SQUARED DISTANCE, NO sqrt. Measured previously on this rig: the sqrt version
  never lit the pool at any radius. Compare d2 against r2 instead.

  ERASE GOES ALL THE WAY OFF (operator ruling) so the stroke can be used for
  wipes and swipes across the map. That is deliberately NOT a breach of the
  never-black invariant, which is about the ship going dark by ACCIDENT: this
  darkening is local to the brush, clears on the selected FADE duration with no
  further input, and only exists while a panel is armed. See ERASE_FLOOR.

  THE STROKE CARRIES ITS OWN HOT CORE, and this is the difference between the
  feature working and the operator reporting "spatial mode does not work".
  The panel's default palette scheme is `master`, which makes all five colour
  slots the IDENTICAL base colour; arming paints every group that colour; and
  the ink is read from that same palette. So the operator draws violet on a
  violet hull, purely additively, with blue already clamped at 255 — MEASURED:
  the hull sat at bytes 90/13/255 and the stroke took it to 181/26/255, blue
  never moving. Rendered, that is a faint global lightening with no edge: at a
  large radius it is a vague tint over half the ship, and at a small radius it
  is invisible. Both were captured from the sim this session.
  Adding an unsaturated core on the WHITE channel gives the stroke luminance
  contrast that does not depend on the operator having picked a colour
  different from the one already on the hull. It is also exactly what the pad
  itself draws under the finger — a white hot core inside a dark halo — so the
  ship now matches the gesture the operator can see on the glass.
  Squared so it is a CORE, not a wash: it falls off far faster than the colour.

  THE HEAT BUFFER is owned by the CALLER (the controller), not by this module —
  same as e2_waterline_sweep's head position. This file stays a pure function
  over (pixels, heat) so it is testable without an engine.
*/

/** Modes the stroke can drive. Kept as strings so the library presets read. */
export const SPATIAL_MODES = Object.freeze(['pool', 'trail', 'erase', 'ignite']);
export const SPATIAL_AXIS_PAIRS = Object.freeze(['nx:nz', 'nx:ny', 'ny:nz', 'nz:ny']);
export const SPATIAL_FADE_SECONDS = Object.freeze([0.1, 0.5, 1, 1.5]);

/**
 * Strength of the unsaturated core the stroke adds on the WHITE channel — the
 * luminance contrast that makes a stroke visible on a hull already painted the
 * same colour (see the header note). Squared falloff keeps it a core rather
 * than a wash. Turn this to 0 to get the old purely-additive behaviour back.
 */
const CORE_WHITE = 0.75;

/**
 * How dark ERASE is allowed to take a pixel, as a fraction of what was there.
 *
 * OPERATOR RULING: ZERO — erase takes the light all the way off, so the stroke
 * can be used for wipes and swipes across the map. It went 0.75 -> 0.25 -> 0.02
 * -> 0 as the operator worked with it; anything above zero leaves a grey smear
 * where a clean wipe should be, which is not the gesture they are after.
 *
 * WHY THIS DOES NOT BREAK THE NEVER-BLACK INVARIANT. That rule exists to stop
 * the ship going dark AS A SIDE EFFECT — a disarm, a crash, a stranded arm
 * envelope, a persisted zero master. This is none of those. It is safe because
 * it is all three of:
 *   LOCAL      — bounded by the brush radius; pixels outside it are untouched.
 *   TRANSIENT  — driven by heat, which reaches zero on the FADE duration, so the
 *                hull comes back on its own with no further input.
 *   OWNED      — it only runs while a panel is armed, and disarm clears the
 *                stroke and its heat (see releaseControl in the wire).
 * All three are pinned by tests in tests/effects/spatial_paint_order.test.js.
 * If any of them ever stops being true, this constant has to go back up.
 */
const ERASE_FLOOR = 0;

/**
 * Advance and apply the spatial paint.
 *
 * @param {object}       args
 * @param {Array}        args.pixels    Post-mixer model.pixels (with nx/nz).
 * @param {Float32Array} args.heat      Per-pixel heat, length >= pixels.length.
 *                                      Mutated in place; persists across frames.
 * @param {number}       args.targetX   Pool centre, WORLD nx (0..1).
 * @param {number}       args.targetY   Pool centre, WORLD nz (0..1).
 * @param {number}      [args.prevX]    Previous centre nx — the brush paints the
 *                                      SEGMENT prev->target, not just the point.
 * @param {number}      [args.prevY]    Previous centre nz.
 * @param {Array}       [args.strokes]  Active independent brush segments. Each
 *                                      item carries targetX/targetY and optional
 *                                      prevX/prevY/color/colorAlt. When present,
 *                                      these replace the legacy single segment.
 * @param {number}       args.radius    Pool radius in normalised units, >0.
 * @param {number}       args.amount    0..1 overall strength.
 * @param {boolean}      args.touch     True while the finger is DOWN (painting).
 * @param {string}       args.mode      One of SPATIAL_MODES.
 * @param {number[]}     args.color6    RGBWAU 6-tuple the stroke is painted in.
 * @param {number[]}    [args.colorAlt] CONTRASTING 6-tuple (the opposite hue).
 *                                      POOL paints in this instead of color6,
 *                                      and IGNITE lifts the hull in it, so both
 *                                      read against a hull already wearing the
 *                                      operator's own colour. Falls back to
 *                                      color6 when absent.
 * @param {number}       args.fadeStep  Linear heat removed this frame (dt / seconds).
 * @returns {number} mean heat this frame — the caller uses it for IGNITE.
 */
export function applySpatialPaint({
  pixels, heat, ink, targetX, targetY, prevX, prevY, radius, radiusY, amount,
  touch, strokes, mode, color6, colorAlt, fadeStep, axisX, axisY, pixelMask,
}) {
  if (!Array.isArray(pixels)) throw new Error('applySpatialPaint: pixels array is required');
  if (!(heat instanceof Float32Array)) throw new Error('applySpatialPaint: heat must be a Float32Array');
  if (heat.length < pixels.length) {
    throw new Error(`applySpatialPaint: heat too small (${heat.length} < ${pixels.length})`);
  }
  if (SPATIAL_MODES.indexOf(mode) === -1) {
    throw new Error(`applySpatialPaint: mode '${mode}' must be one of ${SPATIAL_MODES.join('|')}`);
  }
  if (!Array.isArray(color6) || color6.length < 6) {
    throw new Error('applySpatialPaint: color6 must be a 6-element array');
  }
  if (SPATIAL_AXIS_PAIRS.indexOf(`${axisX}:${axisY}`) === -1) {
    throw new Error(`applySpatialPaint: unsupported axis pair '${axisX}:${axisY}'`);
  }
  if (pixelMask !== undefined &&
      (!(pixelMask instanceof Uint8Array) || pixelMask.length < pixels.length)) {
    throw new Error('applySpatialPaint: pixelMask must cover every model pixel');
  }
  /* POWER CAN OVERDRIVE PAST 100% — operator ruling: "the effects dont hit hard
     enough". It was capped at 1, so the strongest stroke available could only
     just reach the colour it was painting; on a hull already carrying a bright
     show that lands as a nudge. Above 1 the COVERAGE is already total, so the
     extra goes into GAIN — the colour itself is driven up and clamped per
     channel, which is what turns a mid-brightness pick into a full-force hit.
     Capped at 3: beyond that every colour has saturated to white and the
     control would be lying about doing anything more. */
  const amt = amount < 0 ? 0 : (amount > 3 ? 3 : amount);
  if (amt <= 0) return 0;

  /* THE BRUSH IS AN ELLIPSE IN WORLD SPACE SO IT IS A CIRCLE ON THE PAD.
     Operator ruling: "the circle is not a circle its an oval". It was drawn as
     an oval because a circle of one WORLD radius genuinely is an oval on a pad
     that is wider than it is tall — but that is solving it at the wrong end.
     The operator is drawing on a chart; the brush should be round on the chart,
     and the ship's aspect ratio is the maths' problem, not theirs. The panel
     sends a separate radius per axis (rx from the pad's width, ry from its
     height) and the distance test below is normalised per axis. With
     radiusY absent this reduces exactly to the old circular brush. */
  const rx = radius > 0 ? radius : 0.0001;
  const ry = (typeof radiusY === 'number' && radiusY > 0) ? radiusY : rx;
  const fade = Number.isFinite(fadeStep) ? Math.max(0, fadeStep) : 0;
  if (strokes !== undefined && !Array.isArray(strokes)) {
    throw new Error('applySpatialPaint: strokes must be an array when supplied');
  }
  if (Array.isArray(strokes) && strokes.length > 10) {
    throw new Error('applySpatialPaint: strokes supports at most 10 simultaneous touches');
  }

  const isErase = mode === 'erase';
  const keepsTrail = mode !== 'pool';   // pool shows only the live brush

  /* WHICH COLOUR EACH MODE PAINTS IN — operator ruling.
     POOL paints the OPPOSITE colour, not the ink. Painting the ink was the
     mode's whole problem: arming paints the hull in the operator's palette and
     the ink comes from that same palette, so POOL was laying a colour on top of
     itself and reading as nothing. The opposite hue is the one colour that is
     guaranteed to show against what the operator has already chosen.
     TRAIL and ERASE keep the ink (ERASE ignores colour entirely). */
  const defaultAlt = (Array.isArray(colorAlt) && colorAlt.length >= 6) ? colorAlt : color6;

  /* PER-PIXEL COLOUR MEMORY — what makes the trail COLOUR-RELATED.
     The operator wanted to change colour BY PAINTING, so the stroke walks the
     chosen palette as the finger travels. With a single stroke colour that is
     impossible to see: every heated pixel is re-rendered from the one current
     colour every frame, so the ENTIRE trail changes hue at once instead of
     laying down bands. Remembering the colour each pixel was painted with makes
     the trail a record of the gesture — draw through five colours and five
     colours are on the hull at once, each cooling on its own.
     Optional: with no buffer the old single-colour behaviour is unchanged. */
  const hasInk = (ink instanceof Float32Array) && ink.length >= pixels.length * 3;

  /* TRAIL ASSERTS, IT DOES NOT ONLY ADD — operator ruling: the lights should go
     ON where the stroke is and OFF again in step with the trail fading on the
     pad. Purely additive light can only ever brighten, so a cooling trail never
     read as switching anything off; it just stopped adding. Blending toward the
     colour by the same heat that drives the pad's ink means the ship follows the
     pad's trail in lockstep — both use the identical linear time-to-zero curve. */
  const asserts = (mode === 'trail');

  // ── THE BRUSH IS A SEGMENT, NOT A POINT ─────────────────────────────────
  // A finger moves further between two samples than the panel can report. The
  // pad coalesces to ~10 samples/sec and the network adds its own gaps, so
  // stamping a disc at each sample paints a DOTTED line: measured on this rig,
  // a 1.3s drag delivered a single sample, which as a point-brush is one blob
  // instead of a stroke. Sweeping the disc along prev->target instead makes the
  // trail continuous at ANY sample rate, including one sample per stroke, and
  // costs one dot product per pixel rather than a loop of sub-steps.
  const sourceStrokes = Array.isArray(strokes)
    ? strokes
    : [{ targetX, targetY, prevX, prevY, color: color6, colorAlt: defaultAlt }];
  const painting = !!touch && sourceStrokes.length > 0;
  const brushSegments = painting ? sourceStrokes.map((stroke, index) => {
    if (!stroke || typeof stroke !== 'object') {
      throw new Error(`applySpatialPaint: strokes[${index}] must be an object`);
    }
    const sxTarget = stroke.targetX;
    const syTarget = stroke.targetY;
    if (!Number.isFinite(sxTarget) || sxTarget < 0 || sxTarget > 1 ||
        !Number.isFinite(syTarget) || syTarget < 0 || syTarget > 1) {
      throw new Error(`applySpatialPaint: strokes[${index}] target must be within [0,1]`);
    }
    const hasPrevX = typeof stroke.prevX === 'number' && Number.isFinite(stroke.prevX);
    const hasPrevY = typeof stroke.prevY === 'number' && Number.isFinite(stroke.prevY);
    if (hasPrevX !== hasPrevY ||
        (hasPrevX && (!Number.isFinite(stroke.prevX) || stroke.prevX < 0 || stroke.prevX > 1 ||
                      !Number.isFinite(stroke.prevY) || stroke.prevY < 0 || stroke.prevY > 1))) {
      throw new Error(`applySpatialPaint: strokes[${index}] previous target is invalid`);
    }
    const strokeColor = Array.isArray(stroke.color) && stroke.color.length >= 6
      ? stroke.color : color6;
    const strokeAlt = Array.isArray(stroke.colorAlt) && stroke.colorAlt.length >= 6
      ? stroke.colorAlt : defaultAlt;
    const tx = sxTarget;
    const ty = syTarget;
    const ax = hasPrevX ? stroke.prevX : tx;
    const ay = hasPrevY ? stroke.prevY : ty;
    /* Normalise BOTH the segment and the pixel offsets by the per-axis radius,
       so distance is measured in brush-radii. Each finger owns one segment;
       no segment is ever synthesized between two fingers. */
    const sx = (tx - ax) / rx;
    const sy = (ty - ay) / ry;
    return {
      ax, ay, sx, sy, segLen2: sx * sx + sy * sy,
      paintCol: mode === 'pool' ? strokeAlt : strokeColor,
    };
  }) : [];

  let sum = 0;
  const n = pixels.length;
  for (let i = 0; i < n; i++) {
    if (pixelMask && pixelMask[i] !== 1) {
      heat[i] = 0;
      continue;
    }
    const px = pixels[i];

    // ── how strongly is this pixel under the brush RIGHT NOW ──────────────
    // Distance to the nearest point of the swept segment. With segLen2 == 0
    // this reduces exactly to the old point-distance, so a stationary finger
    // behaves as before.
    const pxn = px[axisX] ?? 0;
    const pyn = px[axisY] ?? 0;
    let brush = 0;
    let paintCol = color6;
    for (let strokeIndex = 0; strokeIndex < brushSegments.length; strokeIndex++) {
      const segment = brushSegments[strokeIndex];
      let dx = (pxn - segment.ax) / rx;
      let dy = (pyn - segment.ay) / ry;
      if (segment.segLen2 > 0) {
        let t = (dx * segment.sx + dy * segment.sy) / segment.segLen2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        dx -= segment.sx * t;
        dy -= segment.sy * t;
      }
      if (dx * dx + dy * dy < 1) {
        brush = 1;
        /* Last item wins only where heads overlap. Input order is stable, so
           overlap colour is deterministic while disjoint fingers stay wholly
           independent. */
        paintCol = segment.paintCol;
      }
    }
    // HARD EDGE, BY OPERATOR RULING: "the ring around the dot should affect any
    // led inside the ring". It used to fall off as f*f, so only the exact centre
    // ever reached full strength and the ring drawn on the pad was a promise the
    // rig did not keep — an erase inside the ring only half-erased, and a stroke
    // inside it only half-lit. Inside is inside.
    // Everything within one brush-radius on both axes: inside is inside.
    // ── heat: decay first, then stamp, so a pixel under the finger is full
    //    even on the frame it is painted ────────────────────────────────────
    let h = Math.max(0, heat[i] - fade);
    const restamped = painting && brush > h;
    if (restamped) h = brush;
    heat[i] = h;
    sum += h;

    // The pixel keeps the colour it was painted with, and only takes a new one
    // when the brush actually re-stamps it — that is what lays down BANDS as
    // the operator paints through the palette instead of recolouring the whole
    // trail at once.
    if (hasInk && restamped) {
      const o = i * 3;
      ink[o] = paintCol[0]; ink[o + 1] = paintCol[1]; ink[o + 2] = paintCol[2];
    }

    // POOL ignores the trail entirely and shows only the live brush, so the
    // original behaviour is still available unchanged.
    const level = keepsTrail ? (h > brush ? h : brush) : brush;
    if (level <= 0) continue;

    // Remembered colour for the cooling trail; the LIVE brush always paints in
    // the current colour so the head of the stroke follows the operator's hand.
    let cr = paintCol[0], cg = paintCol[1], cb = paintCol[2];
    if (hasInk && !restamped && brush <= 0) {
      const o = i * 3;
      cr = ink[o]; cg = ink[o + 1]; cb = ink[o + 2];
    }

    /* COVERAGE vs GAIN. Coverage is how completely the stroke owns the pixel and
       can never exceed 1 — a blend weight above 1 would start SUBTRACTING the
       show, which reads as a hole, not as power. Gain is how hard the colour
       itself is driven, and that is what POWER past 100% buys. */
    const s = Math.min(1, level * amt);
    const gain = amt;
    if (isErase) {
      // Take light AWAY. At full POWER this reaches zero — a clean wipe, by
      // operator ruling; see the ERASE_FLOOR note for why that is safe here.
      const k = ERASE_FLOOR + (1 - ERASE_FLOOR) * (1 - s);
      px.r *= k; px.g *= k; px.b *= k;
      px.w *= k; px.a *= k; px.u *= k;
    } else if (asserts) {
      /* TRAIL: THE LIGHT IS THE TRAIL — same shade, same brightness, all the
         way down. Operator: "as long as the fade trail is on a light the light
         matches that brightness and shade till it fades out".

         It used to drive the pixel toward the colour by COVERAGE alone, and
         coverage saturates: at POWER 90% (amt 1.8) everything from heat 1.00
         down to 0.55 came out as the ink at FULL brightness, so the first half
         of every trail's life had no fade in it at all — the light sat on, then
         let go. That is why FADE appeared to do nothing to the light.

         Two separate jobs now:
           lum  = the heat itself — the trail's own brightness, which is the
                  SAME 0.5^(dt/halfLife) curve the pad draws its ink alpha with,
                  so the glass and the hull dim in step.
           cov  = how much of the show the stroke displaces.
         The colour is scaled by lum, so a cooling trail visibly dims instead of
         merely blending back into whatever the deck happens to be doing. */
      /* NO OVERDRIVE ON THE COLOUR HERE. gain is what POWER buys elsewhere, but
         multiplying the colour by 1.8 clips it: MEASURED, the light stayed at
         full red for the first ~1.5 s of every trail before it started moving,
         which is the flat top the operator was seeing. In TRAIL, POWER means
         how fully the stroke TAKES OVER (that is what the panel's help says),
         not how bright it is — brightness belongs to the trail, and the trail's
         brightness is lum. Want a brighter stroke? Raise the colour's value. */
      const lum = level;
      const keep = 1 - s;
      px.r = Math.min(1, px.r * keep + cr * lum * s);
      px.g = Math.min(1, px.g * keep + cg * lum * s);
      px.b = Math.min(1, px.b * keep + cb * lum * s);
      px.a = Math.min(1, px.a * keep + paintCol[4] * lum * s);
      px.u = Math.min(1, px.u * keep + paintCol[5] * lum * s);
      px.w = Math.min(1, px.w * keep + paintCol[3] * lum * s
                        + lum * lum * CORE_WHITE);
    } else {
      px.r = Math.min(1, px.r + cr * gain * s);
      px.g = Math.min(1, px.g + cg * gain * s);
      px.b = Math.min(1, px.b + cb * gain * s);
      px.a = Math.min(1, px.a + paintCol[4] * gain * s);
      px.u = Math.min(1, px.u + paintCol[5] * gain * s);
      // White = whatever the operator's colour asked for, PLUS the hot core
      // that makes the stroke legible on a hull already wearing that colour.
      px.w = Math.min(1, px.w + paintCol[3] * gain * s + s * s * CORE_WHITE);
    }
  }

  return n > 0 ? sum / n : 0;
}

/**
 * IGNITE: lift the WHOLE hull with the stroke and let it fall as the trail
 * cools. Separate from the per-pixel pass because it is driven by the MEAN heat
 * over the rig, which is only known once that pass has finished.
 *
 * THE LIFT IS IN A CONTRASTING COLOUR — operator ruling. Lifting the hull in
 * the same colour it is already wearing just makes it marginally brighter,
 * which is the same invisibility that made POOL useless; the whole point of
 * IGNITE is that the ship SWELLS, and a swell you cannot see is not a swell.
 * The caller passes the opposite hue, so the stroke stays the operator's colour
 * and the hull answers it in the contrasting one.
 */
export function applySpatialIgnite({ pixels, energy, color6, amount }) {
  if (!Array.isArray(pixels)) throw new Error('applySpatialIgnite: pixels array is required');
  const e = energy < 0 ? 0 : (energy > 1 ? 1 : energy);
  /* POWER CAN OVERDRIVE PAST 100% — operator ruling: "the effects dont hit hard
     enough". It was capped at 1, so the strongest stroke available could only
     just reach the colour it was painting; on a hull already carrying a bright
     show that lands as a nudge. Above 1 the COVERAGE is already total, so the
     extra goes into GAIN — the colour itself is driven up and clamped per
     channel, which is what turns a mid-brightness pick into a full-force hit.
     Capped at 3: beyond that every colour has saturated to white and the
     control would be lying about doing anything more. */
  const amt = amount < 0 ? 0 : (amount > 3 ? 3 : amount);
  const s = e * amt;
  if (s <= 0) return;
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    px.r = Math.min(1, px.r + color6[0] * s);
    px.g = Math.min(1, px.g + color6[1] * s);
    px.b = Math.min(1, px.b + color6[2] * s);
    px.w = Math.min(1, px.w + color6[3] * s);
    px.a = Math.min(1, px.a + color6[4] * s);
    px.u = Math.min(1, px.u + color6[5] * s);
  }
}

export const spatialPaintEffect = { applySpatialPaint, applySpatialIgnite, SPATIAL_MODES };
