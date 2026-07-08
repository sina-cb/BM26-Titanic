/**
 * effects/freeze_frame.js — E4 Freeze Frame
 *
 * One toggle freezes the entire rig's current frame: on engage the live
 * pixel buffer is captured into a lazy Float32Array; while held, the
 * output is that captured frame scaled by a hold-fade envelope. Motion
 * halts mid-flight; release resumes (docs report-1 §E4).
 *
 * Placed FIRST in applyMacros (step 0, before wash) so wash/sweep/strobe
 * still animate ON TOP of the frozen base — the rig is frozen but the
 * operator is not disarmed.
 *
 * This is a brightness/replace GATE: it overwrites all 6 channels
 * (R/G/B/W/A/U) with the frozen snapshot × fade. Freezing must preserve
 * the exact composited look, so — unlike chroma ops — W/A/U ARE part of
 * the snapshot (we are replaying the real frame, not recoloring it).
 *
 * STATE: this effect is stateful (a captured buffer + engage timestamp).
 * Because the effect modules must not import the controller, state lives
 * in an explicit object created by `createFreezeState()`. Builder A holds
 * one such object on the controller and passes it in each frame, mirroring
 * how feedbackTrails' Float32 buffer and dropHit's envelope list are
 * controller-owned. The buffer is lazily (re)allocated on first capture
 * and whenever the pixel count changes.
 *
 * GATING (Codex P0, zero-cost default): when not active the caller MUST
 * skip this stage. `applyFreezeFrame` also early-returns when `active` is
 * false (and clears any prior capture) so a direct call is a safe no-op.
 *
 * Per-frame cost:
 *   - capture frame (first active frame only): 6 writes/px.
 *   - held frames: 6 reads + up to 6 mul/px (fade), or 6 copies when
 *     fade == 1 (holdFadeMs == 0, freeze forever).
 * Allocation-free once the buffer exists; one lazy Float32Array(px*6).
 */

/**
 * Create the explicit per-effect state holder. The controller owns one of
 * these and passes it into every applyFreezeFrame call.
 */
export function createFreezeState() {
  return {
    buffer: null,        // Float32Array(pixelCount*6), lazy
    pixelCount: 0,       // guards reallocation on model change
    captured: false,     // has the current freeze captured a frame yet?
    engagedAtMs: 0,      // nowMs when the capture happened (for fade)
  };
}

function ensureBuffer(state, pixelCount) {
  if (!state.buffer || state.pixelCount !== pixelCount) {
    state.buffer = new Float32Array(pixelCount * 6);
    state.pixelCount = pixelCount;
    // A resized model invalidates any in-flight capture.
    state.captured = false;
  }
}

/**
 * Freeze-frame apply. Captures on the first active frame, then replays.
 *
 * @param {object}  args
 * @param {Array}   args.pixels      Post-mixer model.pixels.
 * @param {object}  args.state       From createFreezeState() — MUST persist across frames.
 * @param {boolean} args.active      Is the freeze engaged this frame?
 * @param {number}  args.nowMs       Monotonic clock (ms).
 * @param {number}  [args.holdFadeMs=0]  0 = hold forever; else fade the frozen frame to black over this many ms.
 */
export function applyFreezeFrame({ pixels, state, active, nowMs, holdFadeMs = 0 }) {
  if (!Array.isArray(pixels)) {
    throw new Error('applyFreezeFrame: pixels array is required');
  }
  if (!state || typeof state !== 'object') {
    throw new Error('applyFreezeFrame: state object is required (createFreezeState())');
  }

  // Not engaged: release the freeze so the next engage re-captures.
  if (!active) {
    state.captured = false;
    return;
  }

  const pixelCount = pixels.length;
  ensureBuffer(state, pixelCount);
  const buf = state.buffer;

  // First active frame: snapshot the live composited frame, then output it.
  if (!state.captured) {
    for (let i = 0; i < pixelCount; i++) {
      const px = pixels[i];
      const off = i * 6;
      buf[off + 0] = px.r;
      buf[off + 1] = px.g;
      buf[off + 2] = px.b;
      buf[off + 3] = px.w;
      buf[off + 4] = px.a;
      buf[off + 5] = px.u;
    }
    state.captured = true;
    state.engagedAtMs = nowMs;
    // Freshly captured frame is the current frame — nothing to overwrite yet,
    // but fall through so a holdFadeMs==0 held frame is byte-identical.
  }

  // Held frame: replay the snapshot × fade. holdFadeMs==0 ⇒ fade stays 1.
  let fade = 1;
  if (holdFadeMs > 0) {
    const elapsed = nowMs - state.engagedAtMs;
    fade = 1 - elapsed / holdFadeMs;
    if (fade < 0) fade = 0;
    else if (fade > 1) fade = 1;
  }

  for (let i = 0; i < pixelCount; i++) {
    const px = pixels[i];
    const off = i * 6;
    px.r = buf[off + 0] * fade;
    px.g = buf[off + 1] * fade;
    px.b = buf[off + 2] * fade;
    px.w = buf[off + 3] * fade;
    px.a = buf[off + 4] * fade;
    px.u = buf[off + 5] * fade;
  }
}

export const freezeFrameEffect = {
  apply: applyFreezeFrame,
  createState: createFreezeState,
};
