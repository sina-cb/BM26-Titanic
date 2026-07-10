/**
 * effects/e3_kick_punch.js — E3 Kick Punch (report 20260708_2 Table 2)
 *
 * NOT a per-pixel effect. A controller-level TRIGGER ROUTER: when the live
 * audio kick/onset signal crosses a threshold (with a minimum gap since the
 * last fire), it fires the EXISTING dropHit envelope. All pixel work is the
 * existing dropHit apply path — this module adds zero per-pixel cost.
 *
 * Signal source (report §"signals bag"): prefer `audioDropPulse` (already
 * onset-shaped) and fall back to `micKick`. When audio is absent both read
 * 0, so the router is inert — never fires — which is the desired behavior
 * with the Companion off (no fallback flashing).
 *
 * Stateless: the controller owns `lastFireMs` (the min-gap clock). This
 * module is the pure decision function.
 */

/**
 * Decide whether the kick router should fire this frame.
 *
 * @param {object} args
 * @param {number} args.signalValue  Kick/onset value in [0..1] (0 when audio off).
 * @param {number} args.threshold    Fire when signalValue > threshold.
 * @param {number} args.nowMs        Current time (ms).
 * @param {number} args.lastFireMs   Time of last fire (ms); -Infinity if never.
 * @param {number} args.minGapMs     Minimum ms between fires (rate limit).
 * @returns {boolean} true when a dropHit should be triggered now.
 */
export function shouldFireKick({ signalValue, threshold, nowMs, lastFireMs, minGapMs }) {
  if (!(signalValue > threshold)) return false;
  if (nowMs - lastFireMs < minGapMs) return false;
  return true;
}

/**
 * Map a kick signal value to a dropHit intensity in [floor..ceil].
 * A stronger kick punches harder. Clamped so a stuck/over-unity signal
 * can't exceed the ceiling. When floor===ceil this is a constant.
 *
 * @param {object} args
 * @param {number} args.signalValue  Kick value in [0..1].
 * @param {number} args.floor        Min intensity (default 0.6).
 * @param {number} args.ceil         Max intensity (default 1.0).
 * @returns {number} intensity in [floor..ceil].
 */
export function kickIntensity({ signalValue, floor = 0.6, ceil = 1.0 }) {
  const v = signalValue < 0 ? 0 : (signalValue > 1 ? 1 : signalValue);
  return floor + (ceil - floor) * v;
}

export const kickPunchEffect = {
  shouldFire: shouldFireKick,
  intensity: kickIntensity,
  // Primary intensity: the punch strength — the ceiling intensity of the
  // dropHit fired on a hard kick (0 = no punch, 1 = full-force hit). The
  // router maps a kick's magnitude onto [floor..ceil]; this knob drives the
  // ceiling, so a higher value hits harder. Normalized 0..1 maps straight
  // onto the `intensityCeil` param.
  primaryIntensity: { label: 'Punch Strength', param: 'intensityCeil', default: 1.0, min: 0, max: 1 },
  // Primary mode: the signal the router listens to — auto (onset-shaped
  // dropPulse, falling back to raw kick), the dropPulse only, or the raw
  // kick only. The VSN1 encoder press cycles these; writes the `source` param.
  primaryMode: { label: 'Source', param: 'source', values: ['auto', 'dropPulse', 'kick'], default: 'auto' },
};
