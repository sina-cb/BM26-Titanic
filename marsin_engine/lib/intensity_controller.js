import { LiveBrightnessController } from './live_brightness_controller.js';

/**
 * IntensityController
 *
 * Isolates global brightness scaling and emergency blackout logic from the
 * main engine loop. Maps incoming REST commands (per section ID or global)
 * directly to the pixel state.
 */
// Bounds for the arm envelope. 10 s matches the range the transition params
// already accept (param_center.js) — long enough for a theatrical handover,
// short enough that a typo cannot park the ship mid-fade for a minute.
const ARM_FADE_MAX_MS = 10000;
// How long the envelope may stay below full before it releases ITSELF. Longer
// than any legitimate arm sequence (a fade, ~10 sequential round trips, the
// assertions and a fade back) and far shorter than "the rest of the night".
const ARM_FADE_HOLD_MAX_MS = 60000;

export class IntensityController {
  constructor() {
    this.sectionBrightness = {};
    this.blackoutActive = false;
    // THE ARM ENVELOPE. 1 = full level, 0 = black. TRANSIENT — never persisted,
    // always 1 on construction, so no restart can come back holding the ship
    // down. See startArmFade for what it is for.
    this.armFade = 1;
    this._armFadeRamp = null;
    // When the envelope first went below full, for the hold watchdog in
    // tickArmFade. null whenever it is at full.
    this._armFadeHeldSinceMs = null;
    this.liveBrightness = new LiveBrightnessController();
  }

  setSectionBrightness(sectionId, val) {
    this.sectionBrightness[sectionId] = Math.max(0.0, Math.min(1.0, val));
  }

  setBlackout(state) {
    this.blackoutActive = !!state;
  }

  /**
   * Apply transient Live Touch factors to the Live Touch surface buffer only.
   * The layer router calls this before its shared crossfade. The final apply()
   * below remains the one post-blend Dimmer Rack/blackout authority stage.
   */
  applyLiveBrightness(pixels) {
    this.liveBrightness.apply(pixels);
  }

  applyLiveBrightnessBuffer(buffer6ch, modelPixels) {
    this.liveBrightness.applyBuffer(buffer6ch, modelPixels);
  }

  /**
   * Ramp the arm envelope to `target` over `durationMs`.
   *
   * WHY THIS EXISTS: arming the touch panel takes over the whole rig — it
   * source-locks the params, kills both autopilots, disables every effect and
   * snaps the overlay faders to zero — and every one of those lands as a hard
   * visual cut on a lit ship. The panel now fades the ship out, does the
   * takeover while nobody can see it, and fades back in on the finished look.
   * Disarm is the mirror. This scalar is that envelope.
   *
   * WHY ENGINE-SIDE and not a ramp of HTTP writes from the panel: writes from
   * the browser to this engine have been MEASURED to hang when fired
   * concurrently (see touch_control_wire.js), and a client-side ramp dies with
   * the tab — leaving the ship parked at whatever level it had reached, with
   * nothing left to finish the move. The low end of this ramp is BLACK, and a
   * stuck-at-black Titanic is the worst outcome there is. Ticked here, the
   * ramp always lands exactly on target even if the panel disappears mid-fade.
   *
   * THROWS rather than coercing: a silently clamped fade target is a silently
   * wrong house level, and this is the last thing between the patterns and the
   * wire.
   */
  startArmFade(target, durationMs) {
    if (typeof target !== 'number' || !Number.isFinite(target) || target < 0 || target > 1) {
      throw new Error(`startArmFade: target must be a finite number in [0,1], got ${target}`);
    }
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)
        || durationMs < 0 || durationMs > ARM_FADE_MAX_MS) {
      throw new Error(
        `startArmFade: durationMs must be a finite number in [0,${ARM_FADE_MAX_MS}], got ${durationMs}`);
    }
    if (durationMs === 0) {
      this._armFadeRamp = null;
      this.armFade = target;
      return { armFade: this.armFade, target, durationMs, completesAtMs: Date.now() };
    }
    const startedAtMs = Date.now();
    this._armFadeRamp = { from: this.armFade, to: target, startedAtMs, durationMs };
    return { armFade: this.armFade, target, durationMs, completesAtMs: startedAtMs + durationMs };
  }

  /**
   * Advance the arm envelope. Wall-clock, NOT frame-counted, so it is immune to
   * --fps and to the engine's 0.25x-4x speed multiplier: a house fade must take
   * the number of seconds it was asked for regardless of how the show is being
   * driven. Self-clears on arrival so the ramp can never sit half-applied.
   */
  tickArmFade() {
    // THE HOLD WATCHDOG. The envelope is raised by a single HTTP request from a
    // browser; if that request is dropped, 400s, or the tab dies between the
    // fade-down and the fade-up, nothing else in the engine ever raises it and
    // the rig sits attenuated indefinitely. Nothing should hold the house down
    // for minutes: after ARM_FADE_HOLD_MAX_MS with no new startArmFade the
    // envelope releases itself, loudly. This is a requested failsafe (the
    // operator's rule is that the ship is never dark as a side effect), so it
    // announces itself rather than healing quietly.
    if (this.armFade < 1) {
      if (this._armFadeHeldSinceMs === null) this._armFadeHeldSinceMs = Date.now();
      else if (Date.now() - this._armFadeHeldSinceMs > ARM_FADE_HOLD_MAX_MS) {
        console.warn(`  ⚠ [armFade] envelope held below full for more than ` +
          `${ARM_FADE_HOLD_MAX_MS} ms with no new request — releasing it. The surface that ` +
          'lowered it never raised it (dropped request, closed tab, or a failed arm).');
        this._armFadeRamp = null;
        this.armFade = 1;
        this._armFadeHeldSinceMs = null;
        return;
      }
    } else {
      this._armFadeHeldSinceMs = null;
    }

    const r = this._armFadeRamp;
    if (r === null) return;
    const elapsed = Date.now() - r.startedAtMs;
    if (elapsed >= r.durationMs) {
      this.armFade = r.to;
      this._armFadeRamp = null;
      return;
    }
    const t = elapsed / r.durationMs;
    // smoothstep — the same ease used elsewhere in the engine. Ease-in-out
    // reads as a deliberate house fade; linear reads as a mechanical wipe.
    this.armFade = r.from + (r.to - r.from) * (t * t * (3 - 2 * t));
  }

  getArmFade() {
    return { armFade: this.armFade, ramping: this._armFadeRamp !== null };
  }

  apply(pixels) {
    // FIRST, before the blackout early-return, so the envelope keeps advancing
    // underneath a blackout and its state stays coherent with wall-clock.
    this.tickArmFade();

    // 1. Hardware Blackout Override
    if (this.blackoutActive) {
      for (let i = 0; i < pixels.length; i++) {
        pixels[i].r = 0;
        pixels[i].g = 0;
        pixels[i].b = 0;
        pixels[i].w = 0;
        pixels[i].a = 0;
        pixels[i].u = 0;
      }
      return;
    }

    // Clamp the creative composite BEFORE authority scaling. Without this, an
    // additive layer at 2.0 multiplied by a 30% rack setting would emit 60%,
    // so the rack would be a multiplier rather than an absolute ceiling.
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      px.r = Math.max(0, Math.min(1, px.r));
      px.g = Math.max(0, Math.min(1, px.g));
      px.b = Math.max(0, Math.min(1, px.b));
      px.w = Math.max(0, Math.min(1, px.w));
      px.a = Math.max(0, Math.min(1, px.a));
      px.u = Math.max(0, Math.min(1, px.u));
    }

    // 2. THE ARM ENVELOPE.
    // MUST be above the section-brightness bail-out below: on the default path
    // nothing has ever set a section brightness, so that early return means
    // apply() touches no pixels at all — a multiply placed after it would
    // simply never run, and the fade would silently do nothing.
    //
    // Applied UNCONDITIONALLY, exactly like the blackout above:
    //  - it ignores the px.ignoreDimmerFor* bypass flags, because a bypassing
    //    effect (blastWhite, UV) would otherwise punch through at full level
    //    and flash a "fading" ship white;
    //  - it ignores parked (LOCK) groups. LOCK outranks the master, but the
    //    arm envelope is not a level control — it is the boundary of the panel
    //    session itself, the same category as blackout, which already overrides
    //    LOCK. A parked group left blazing while the rest of the ship faded out
    //    would defeat the entire point, which is that the takeover is invisible.
    if (this.armFade < 1) {
      const af = this.armFade;
      for (let i = 0; i < pixels.length; i++) {
        const px = pixels[i];
        px.r *= af;
        px.g *= af;
        px.b *= af;
        px.w *= af;
        px.a *= af;
        px.u *= af;
      }
    }

    // 3. Local Section Intensity Scaling
    // If no custom brightness values have been requested, bypass math completely
    if (Object.keys(this.sectionBrightness).length === 0) return;

    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      const sId = px.sId;
      
      if (sId !== undefined && this.sectionBrightness[sId] !== undefined) {
        const scale = this.sectionBrightness[sId];
        // Only trigger float multiplication if scale isn't native 100%
        if (scale < 1.0) {
          if (!px.ignoreDimmerForRGB) {
            px.r *= scale;
            px.g *= scale;
            px.b *= scale;
          }
          if (!px.ignoreDimmerForW) px.w *= scale;
          if (!px.ignoreDimmerForA) px.a *= scale;
          if (!px.ignoreDimmerForU) px.u *= scale;
        }
      }
    }
  }
}
