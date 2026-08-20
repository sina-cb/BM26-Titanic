/**
 * low_fps_alarm.js — "this has been slow for a while" latch for the render loop.
 *
 * Feeds off the once-per-second frame count the FPS badge already computes.
 * When the sim stays under the threshold for a sustained run of seconds, the
 * animation loop escalates ONCE with a console.error that NAMES the GPU
 * adapter — the missing signal in report `20260725_38`, where a sustained
 * 10 FPS looked like a code regression for a full session.
 *
 * Catches two distinct failures with one rule:
 *   • the wrong adapter (integrated GPU) — the banner covers that too;
 *   • the RIGHT adapter, contended — e.g. leftover probe browser windows
 *     stealing the dGPU (documented in the sim-perf memory), where the
 *     adapter string looks perfect and the FPS still floors.
 *
 * A latch, not a behaviour: nothing throttles, downgrades or falls back.
 * Pure and DOM-free so Node tests can drive it (`low_fps_alarm.test.js`).
 */

// Thresholds from `20260725_38` §4.3: the healthy scene sits at 59.9 FPS and
// the iGPU repro sits at 10-20, so <20 is unambiguously wrong. Ten consecutive
// seconds keeps a hitch (scene rebuild, model load, a dragged slider) quiet.
export const LOW_FPS_THRESHOLD = 20;
export const LOW_FPS_SUSTAIN_SECONDS = 10;

/**
 * Create a fire-once sustained-low-FPS latch.
 * @param {number} thresholdFps — samples strictly BELOW this count as low.
 * @param {number} sustainSeconds — consecutive low samples required to fire.
 * @returns {{ sample: (fps: number) => boolean, lowSeconds: number, fired: boolean }}
 *          `sample` returns true EXACTLY once, on the sample that completes the
 *          sustained run. A recovery resets the run but never re-arms the fire:
 *          the operator only needs to be told once per page.
 */
export function createLowFpsAlarm(thresholdFps, sustainSeconds) {
  if (!Number.isFinite(thresholdFps) || thresholdFps <= 0) {
    throw new Error(`[LowFpsAlarm] thresholdFps must be a positive number, got ${thresholdFps}`);
  }
  if (!Number.isInteger(sustainSeconds) || sustainSeconds <= 0) {
    throw new Error(`[LowFpsAlarm] sustainSeconds must be a positive integer, got ${sustainSeconds}`);
  }

  let lowSeconds = 0;
  let fired = false;

  return {
    sample(fps) {
      if (!Number.isFinite(fps)) {
        throw new Error(`[LowFpsAlarm] fps sample must be a finite number, got ${fps}`);
      }
      if (fps >= thresholdFps) {
        lowSeconds = 0;
        return false;
      }
      lowSeconds += 1;
      if (fired || lowSeconds < sustainSeconds) return false;
      fired = true;
      return true;
    },
    get lowSeconds() { return lowSeconds; },
    get fired() { return fired; },
  };
}
