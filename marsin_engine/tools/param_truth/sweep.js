// sweep.js — orchestrate the parameter truth sweep.
//
// Per pattern:
//   1. compile it and read its declared controls;
//   2. render a BASELINE (every slider at its resolved default) twice, so the
//      per-feature noise floor is measured rather than assumed;
//   3. for each slider, render the sweep points with that ONE slider moved and
//      every other slider held at baseline;
//   4. measure each render, classify the parameter against its name's claim.
//
// Frozen-baseline second pass
// ───────────────────────────
// A `sliderDirection` conventionally maps v→(2v-1), so its default of 0.5
// FREEZES the pattern (documented in docs/MARSIN_ENGINE_PATTERNS.md). In that
// state every other slider's temporal evidence is meaningless — a real speed
// knob measures as DEAD because nothing is moving to speed up. When the
// baseline renders no motion AND the pattern has a direction-family slider,
// the whole pattern is re-swept in the `motion` context with direction sliders
// pinned to 1.0. Both contexts are rendered and the one that gives a parameter
// its best verdict is reported, WITH the context recorded on every row — this
// is a second measurement, not a silent retry.

import {
  createRenderContext, readPatternSource, baselineControls, isBlendPattern,
  KIND_SLIDER, KIND_TOGGLE, KIND_HSV_PICKER, PATTERNS_DIR,
} from './render_context.js';
import { discoverPatterns } from './pattern_discovery.js';
import {
  buildAxisBins, measure, rankMovers, FEATURE_NAMES, normalisedChange,
} from './metrics.js';
import {
  claimOf, FAMILY, SWEEP_POINTS, MEASURE_FRAMES, WARMUP_FRAMES, LAUNCH_FRAMES,
  PULSE_PERIOD_FRAMES, THRESHOLDS,
} from './claims.js';
import { classify, VERDICT } from './classify.js';

/** Verdict ranking, best first — used to pick between measurement contexts. */
const VERDICT_RANK = {
  [VERDICT.TRUE]: 0,
  [VERDICT.WEAK]: 1,
  [VERDICT.UNKNOWN_CLAIM]: 2,
  [VERDICT.WRONG]: 3,
  [VERDICT.DEAD]: 4,
};

/**
 * Baseline temporalRate below this counts as a frozen pattern. A pattern that
 * is actually animating measures 0.005–0.05 here; 0.002 sits well below that
 * and well above the 0 of a genuinely still frame.
 */
const FROZEN_RATE = 0.002;


/** True when two frame sequences are byte-identical. */
function framesIdentical(a, b) {
  if (a.length !== b.length) return false;
  for (let f = 0; f < a.length; f++) {
    const x = a[f];
    const y = b[f];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

/**
 * Measure the per-feature noise floor from two identical-input renders.
 *
 * @param {Record<string, number>} v1
 * @param {Record<string, number>} v2
 * @returns {Record<string, number>}
 */
function noiseFloor(v1, v2) {
  const noise = {};
  for (const f of FEATURE_NAMES) noise[f] = normalisedChange(f, [v1, v2]);
  return noise;
}

/**
 * Ask whether a control that is dead when HELD responds when PULSED.
 *
 * Renders the pattern twice: once with the control pinned at 0, once with it
 * driven as a 0↔1 square wave. Any difference above the dead threshold means
 * the control is read on its edges — which is a working control, not a dead
 * one, and a completely different thing to tell the curator.
 *
 * @returns {{ responds: boolean, feature: string, change: number }}
 */
function triggerProbe(ctx, axisBins, source, baseControls, pulseId, noise) {
  const still = ctx.renderPulsed(source, baseControls, null,
    MEASURE_FRAMES, WARMUP_FRAMES, PULSE_PERIOD_FRAMES);
  const pulsed = ctx.renderPulsed(source, baseControls, pulseId,
    MEASURE_FRAMES, WARMUP_FRAMES, PULSE_PERIOD_FRAMES);
  if (!still.ok || !pulsed.ok) {
    throw new Error(`trigger probe render failed: ${still.error || pulsed.error}`);
  }
  const vectors = [
    measure(still.frames, ctx.pixelCount, axisBins),
    measure(pulsed.frames, ctx.pixelCount, axisBins),
  ];
  const top = rankMovers(vectors, noise)[0];
  return {
    responds: top.change >= THRESHOLDS.weak,
    feature: top.feature,
    change: top.change,
  };
}

/**
 * Ask whether a control that is dead at the pattern's DEFAULTS is alive when
 * the rest of the pattern is set mid-range.
 *
 * A shipped default at full scale can saturate the signal path and swallow a
 * perfectly good control. Holding every OTHER slider at 0.5 and re-sweeping
 * separates "this control is wired to nothing" from "this control is buried by
 * a default", which need different fixes.
 *
 * @returns {{ responds: boolean, feature: string, change: number }}
 */
function midrangeProbe(ctx, axisBins, source, sliders, target, noise, doRender) {
  const vectors = [];
  for (const p of SWEEP_POINTS) {
    const m = new Map();
    for (const s of sliders) m.set(s.id, [s.id === target.id ? p : 0.5, 0, 0]);
    const r = doRender(m, MEASURE_FRAMES, WARMUP_FRAMES);
    if (!r.ok) throw new Error(`midrange probe render failed: ${r.error}`);
    vectors.push(measure(r.frames, ctx.pixelCount, axisBins));
  }
  const top = rankMovers(vectors, noise)[0];
  return { responds: top.change >= THRESHOLDS.weak, feature: top.feature, change: top.change };
}

/**
 * Sweep every slider of one pattern in one measurement context.
 *
 * @returns {{ rows: object[], baseline: object, frozen: boolean }}
 */
function sweepContext(ctx, axisBins, source, sliders, contextName, pinned, only = null) {
  // A blend/transition script never runs `renderAll` — the mixer drives it
  // through `renderBlend6ch` with two source buffers and a progress fader.
  // Measuring it any other way pins progress at 0 and reports every edge
  // control as dead.
  const blend = isBlendPattern(source);
  const doRender = (controls, frames, warmup) => (blend
    ? ctx.renderBlend(source, controls, frames)
    : ctx.render(source, controls, frames, warmup));

  const controlsAt = (overrideId, value) => {
    const m = new Map();
    for (const s of sliders) {
      let v = s.defaultValue;
      if (pinned.has(s.id)) v = pinned.get(s.id);
      if (s.id === overrideId) v = value;
      m.set(s.id, [v, 0, 0]);
    }
    return m;
  };

  const baseA = doRender(controlsAt(null, 0), MEASURE_FRAMES, WARMUP_FRAMES);
  if (!baseA.ok) throw new Error(`baseline render failed: ${baseA.error}`);
  const baseB = doRender(controlsAt(null, 0), MEASURE_FRAMES, WARMUP_FRAMES);
  const vecA = measure(baseA.frames, ctx.pixelCount, axisBins);
  const vecB = measure(baseB.frames, ctx.pixelCount, axisBins);
  const noise = noiseFloor(vecA, vecB);
  const deterministic = framesIdentical(baseA.frames, baseB.frames);

  const rows = [];
  for (const s of sliders) {
    // `only` narrows which sliders are SWEPT, never which are present: every
    // other slider still sits at its baseline value in the control map, so a
    // narrowed re-run measures the same thing the full run did.
    if (only && !only.has(s.name)) continue;
    // A direction slider pinned for this context is still swept normally —
    // the pin only applies to the OTHER sliders' renders.
    const vectors = [];
    const framesPerPoint = [];
    for (const p of SWEEP_POINTS) {
      const r = doRender(controlsAt(s.id, p), MEASURE_FRAMES, WARMUP_FRAMES);
      if (!r.ok) throw new Error(`sweep render failed for ${s.name}: ${r.error}`);
      framesPerPoint.push(r.frames);
      vectors.push(measure(r.frames, ctx.pixelCount, axisBins));
    }
    let identical = true;
    for (let i = 1; i < framesPerPoint.length && identical; i++) {
      identical = framesIdentical(framesPerPoint[0], framesPerPoint[i]);
    }

    const claim = claimOf(s.name);

    // Direction is judged on which way the pattern SETS OFF from t=0 — a
    // ping-pong sweep nets to zero drift over a long window. Only rendered for
    // the family that needs it, so the sweep stays affordable.
    let launchVectors = null;
    if (claim.family === FAMILY.DIRECTION) {
      launchVectors = [];
      for (const p of SWEEP_POINTS) {
        const r = doRender(controlsAt(s.id, p), LAUNCH_FRAMES, 0);
        if (!r.ok) throw new Error(`launch render failed for ${s.name}: ${r.error}`);
        launchVectors.push(measure(r.frames, ctx.pixelCount, axisBins));
      }
    }

    const verdict = classify({
      control: s.name,
      family: claim.family,
      vectors,
      noise,
      identical,
      launchVectors,
    });

    // A control that measured DEAD held STILL may simply be edge-triggered —
    // it listens for a rising edge, not for a level (29_kick_shockwave arms on
    // `kick >= 0.5 && prevKick < 0.5`). Ask the dynamic question before
    // reporting it as wired to nothing. Only DEAD rows pay for this.
    if (verdict.verdict === VERDICT.DEAD && !blend) {
      const probe = triggerProbe(ctx, axisBins, source, controlsAt(s.id, 0), s.id, noise);
      if (probe.responds) {
        verdict.verdict = VERDICT.TRUE;
        verdict.reason = 'responds_to_edges_not_to_level';
        verdict.detail = `held static the control does nothing, but pulsed 0↔1 at `
          + `${PULSE_PERIOD_FRAMES} frames it moves ${probe.feature} by `
          + `${probe.change.toFixed(4)} — this is an edge-triggered control, meant `
          + 'to be driven by a modulation mapping rather than parked at a value';
        verdict.effectScore = Number(probe.change.toFixed(5));
        verdict.edgeTriggered = true;
      } else {
        verdict.edgeTriggered = false;
        // Not edge-triggered either. Before calling the control unwired, ask
        // whether it is dead only AT THE PATTERN'S SHIPPED DEFAULTS.
        // 12_breathing declares `level = 1.0`, which drives its brightness gain
        // to 2.32 and saturates `bri` for every pixel — its `kick` is provably
        // alive at level 0.5 and provably invisible at the default. That is a
        // defaults bug, not a wiring bug, and the fix is a different one.
        const mid = midrangeProbe(ctx, axisBins, source, sliders, s, noise, doRender);
        if (mid.responds) {
          verdict.reason = 'dead_at_declared_defaults_alive_at_midrange';
          verdict.detail = 'inert across its whole range at this pattern\'s declared '
            + `defaults, but with every other slider at 0.5 it moves ${mid.feature} `
            + `by ${mid.change.toFixed(4)}. The control is wired — a shipped default `
            + '(usually a gain at full scale) is swallowing it.';
          verdict.deadAtDefaultsOnly = true;
        }
      }
    }
    rows.push({
      ...verdict,
      claimToken: claim.token,
      defaultValue: s.defaultValue,
      defaultSource: s.defaultSource,
      context: contextName,
      sweepPoints: SWEEP_POINTS,
      // Raw series are kept only where they are evidence for something the
      // curator has to act on. Carrying them for all 500+ passing rows would
      // triple the results file and bury real changes in diff noise.
      series: verdict.verdict === VERDICT.TRUE ? null : {
        temporalRate: vectors.map(v => Number(v.temporalRate.toFixed(5))),
        lumaMean: vectors.map(v => Number(v.lumaMean.toFixed(5))),
        driftX: vectors.map(v => Number(v.driftX.toFixed(5))),
        driftY: vectors.map(v => Number(v.driftY.toFixed(5))),
        driftZ: vectors.map(v => Number(v.driftZ.toFixed(5))),
        launchDriftX: launchVectors ? launchVectors.map(v => Number(v.driftX.toFixed(5))) : null,
        launchDriftY: launchVectors ? launchVectors.map(v => Number(v.driftY.toFixed(5))) : null,
        launchDriftZ: launchVectors ? launchVectors.map(v => Number(v.driftZ.toFixed(5))) : null,
      },
    });
  }

  return {
    rows,
    blend,
    baseline: {
      temporalRate: Number(vecA.temporalRate.toFixed(6)),
      lumaMean: Number(vecA.lumaMean.toFixed(6)),
      litFraction: Number(vecA.litFraction.toFixed(6)),
      clippedFraction: Number(vecA.clippedFraction.toFixed(6)),
      deterministic,
    },
    frozen: vecA.temporalRate < FROZEN_RATE,
  };
}

/**
 * Sweep one pattern.
 *
 * @param {object} ctx — render context.
 * @param {object} axisBins
 * @param {string} id — pattern id.
 * @returns {object} pattern result record.
 */
export function sweepPattern(ctx, axisBins, id, only = null) {
  const source = readPatternSource(id);
  const inspected = ctx.inspect(source);
  if (!inspected.ok) {
    return {
      pattern: id,
      model: ctx.modelName,
      status: 'COMPILE_ERROR',
      error: inspected.error,
      params: {},
    };
  }

  const { sliders } = baselineControls(inspected.exports, source);
  const hsvPickers = inspected.exports
    .filter(e => e.kind === KIND_HSV_PICKER).map(e => e.name);
  const toggles = inspected.exports.filter(e => e.kind === KIND_TOGGLE).map(e => e.name);

  if (sliders.length === 0) {
    return {
      pattern: id,
      model: ctx.modelName,
      status: 'NO_PARAMS',
      sliderCount: 0,
      hsvPickers,
      toggles,
      params: {},
    };
  }

  const first = sweepContext(ctx, axisBins, source, sliders, 'default', new Map(), only);
  let chosen = first.rows;
  let secondBaseline = null;

  const directionSliders = sliders.filter(s => claimOf(s.name).family === FAMILY.DIRECTION);
  if (first.frozen && directionSliders.length > 0) {
    const pinned = new Map(directionSliders.map(s => [s.id, 1.0]));
    const second = sweepContext(ctx, axisBins, source, sliders, 'motion', pinned, only);
    secondBaseline = second.baseline;
    chosen = first.rows.map((row, i) => {
      const alt = second.rows[i];
      return VERDICT_RANK[alt.verdict] < VERDICT_RANK[row.verdict] ? alt : row;
    });
  }

  const params = {};
  for (const row of chosen) params[row.control] = row;

  return {
    pattern: id,
    model: ctx.modelName,
    status: 'OK',
    sliderCount: sliders.length,
    hsvPickers,
    toggles,
    blend: first.blend,
    baseline: first.baseline,
    baselineFrozen: first.frozen,
    motionBaseline: secondBaseline,
    params,
  };
}

/**
 * Run the sweep across a set of patterns.
 *
 * @param {object} options
 * @param {string} options.model — model stem to render on.
 * @param {string[]} [options.patterns] — explicit ids; defaults to full disk
 *   discovery under patterns/.
 * @param {(msg: string) => void} [options.onProgress]
 * @returns {Promise<object>} results document.
 */
export async function runSweep({ model = 'titanic', patterns = null, onProgress = null } = {}) {
  const ids = patterns || discoverPatterns(PATTERNS_DIR);
  const ctx = await createRenderContext(model);
  const axisBins = buildAxisBins(ctx.coords);

  const results = [];
  try {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (onProgress) onProgress(`[${i + 1}/${ids.length}] ${id}`);
      results.push(sweepPattern(ctx, axisBins, id));
    }
  } finally {
    ctx.close();
  }

  return {
    harness: 'param_truth',
    schemaVersion: 1,
    model,
    pixelCount: ctx.pixelCount,
    frames: MEASURE_FRAMES,
    warmupFrames: WARMUP_FRAMES,
    sweepPoints: SWEEP_POINTS,
    thresholds: THRESHOLDS,
    patternCount: ids.length,
    patterns: results,
  };
}

/**
 * Re-measure every DEAD parameter on a SECOND model and annotate the result.
 *
 * A control can be perfectly alive and still render byte-identical on the show
 * model, because the code path it feeds is gated on hardware the model does not
 * carry — 01_cylon_sweep's blinder white is behind `sectionId == 2`, and every
 * titanic pixel reports section 0. That is a genuine and urgent finding ("this
 * knob does nothing on the ship"), but it is a DIFFERENT finding from "this
 * knob is wired to nothing", and the punch-list has to tell them apart.
 *
 * Only DEAD params are re-run, so the second pass costs a fraction of the first.
 *
 * @param {object} doc — primary results document (mutated in place).
 * @param {string} crossModel — second model to re-measure on.
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<object>} the same document.
 */
export async function reconcileAcrossModel(doc, crossModel, onProgress = null) {
  const targets = [];
  for (const p of doc.patterns) {
    if (p.status !== 'OK') continue;
    const dead = Object.keys(p.params).filter(n => p.params[n].verdict === VERDICT.DEAD);
    if (dead.length > 0) targets.push({ pattern: p, controls: new Set(dead) });
  }
  if (targets.length === 0) {
    doc.crossModel = { model: crossModel, patternsRechecked: 0, aliveElsewhere: 0 };
    return doc;
  }

  const ctx = await createRenderContext(crossModel);
  const axisBins = buildAxisBins(ctx.coords);
  let aliveElsewhere = 0;
  try {
    for (let i = 0; i < targets.length; i++) {
      const { pattern, controls } = targets[i];
      if (onProgress) onProgress(`[${i + 1}/${targets.length}] ${pattern.pattern}`);
      const alt = sweepPattern(ctx, axisBins, pattern.pattern, controls);
      if (alt.status !== 'OK') {
        for (const name of controls) {
          pattern.params[name].crossModel = {
            model: crossModel, status: alt.status, error: alt.error || null,
          };
        }
        continue;
      }
      for (const name of controls) {
        const other = alt.params[name];
        if (!other) continue;
        pattern.params[name].crossModel = {
          model: crossModel,
          verdict: other.verdict,
          reason: other.reason,
          effectScore: other.effectScore,
          topMovers: other.topMovers,
          // Carried across so a control that is merely buried by a shipped
          // default on the OTHER model is not filed as unwired here. Without
          // this, 17_rolling_color_dunes' `whiteKick` reads as hard dead when
          // in fact it is gated behind `kick`, which ships at 0.
          deadAtDefaultsOnly: other.deadAtDefaultsOnly === true,
          edgeTriggered: other.edgeTriggered === true,
        };
        if (other.verdict === VERDICT.DEAD && other.deadAtDefaultsOnly) {
          pattern.params[name].deadAtDefaultsOnly = true;
          pattern.params[name].reason = 'dead_at_declared_defaults_alive_at_midrange';
          pattern.params[name].detail =
            `inert at this pattern's declared defaults on both ${doc.model} and `
            + `${crossModel}, but alive on ${crossModel} with the other sliders at `
            + '0.5. The control is wired — a shipped default is swallowing it.';
          continue;
        }
        if (other.verdict !== VERDICT.DEAD) {
          aliveElsewhere++;
          pattern.params[name].reason =
            `dead_on_${doc.model}_but_alive_on_${crossModel}`;
          pattern.params[name].detail =
            `byte-identical on ${doc.model}; on ${crossModel} it measures `
            + `${other.verdict} (effect ${other.effectScore}, top mover `
            + `${other.topMovers[0].feature}). The control works — the code path `
            + `it drives is not reachable on ${doc.model}.`;
        }
      }
    }
  } finally {
    ctx.close();
  }

  doc.crossModel = {
    model: crossModel,
    patternsRechecked: targets.length,
    aliveElsewhere,
  };
  return doc;
}

/**
 * Tally verdicts across a results document.
 *
 * @param {object} doc
 * @returns {Record<string, number>}
 */
export function tally(doc) {
  const counts = {
    TRUE: 0, WEAK: 0, WRONG: 0, DEAD: 0, UNKNOWN_CLAIM: 0,
    deadButAliveOnCrossModel: 0,
    patternsOk: 0, patternsCompileError: 0, patternsNoParams: 0, paramTotal: 0,
  };
  for (const p of doc.patterns) {
    if (p.status === 'COMPILE_ERROR') { counts.patternsCompileError++; continue; }
    if (p.status === 'NO_PARAMS') { counts.patternsNoParams++; continue; }
    counts.patternsOk++;
    for (const name of Object.keys(p.params)) {
      const row = p.params[name];
      counts.paramTotal++;
      counts[row.verdict]++;
      if (row.verdict === VERDICT.DEAD && row.crossModel
        && row.crossModel.verdict && row.crossModel.verdict !== VERDICT.DEAD) {
        counts.deadButAliveOnCrossModel++;
      }
    }
  }
  return counts;
}

export { VERDICT, SWEEP_POINTS, KIND_SLIDER };
