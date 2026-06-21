export class PatternChannel {
  constructor({ id, name, pattern, handle = 0, mode = 'blend_screen', fader = 1.0, enabled = true, locked = false, faderLocked = false, transitionMode = 'trans_crossfade', transitionTime = 1.0, viewSelection = null, faderMax = 1.0, color = null, mixGroupId = null, soloSafe = false, hue = 0, invert = false, speed = 1.0, phaseOffsetMs = 0, followsTempo = false, followLeaderId = null, followScale = 1.0 }) {
    this.id = id;
    this.name = name;
    this.pattern = pattern;
    this.handle = handle;
    this.mode = mode; // 'blend_screen', 'blend_crossfade', 'blend_add', 'blend_over'
    this.fader = fader;
    this.enabled = enabled;
    // Per-channel intensity clamp (F-C). A hard ceiling on this channel's
    // OWN contribution to the composite, applied as Math.min(effectiveFader,
    // faderMax) at blend time in pattern_mixer. The fader/transition can
    // never push the channel above faderMax — the clamp is the last word on
    // a channel's own output. Default 1.0 = no clamp (absent field in an old
    // state file restores to this safe default, NOT a silent fallback: it is
    // the documented schema default). Constrained to [0,1] at the API
    // boundary (validateFader) and defensively here.
    this.faderMax = (typeof faderMax === 'number' && Number.isFinite(faderMax))
      ? Math.max(0, Math.min(1, faderMax))
      : 1.0;
    // Per-channel color tag (F-D). Pure operator-facing METADATA (e.g. a hex
    // string for the CaptainPad channel strip accent) — it has NO effect on
    // rendering. Default null = "no color assigned". An old state file
    // without this field restores to null (documented schema default).
    this.color = (typeof color === 'string') ? color : null;
    this.locked = locked;
    // Fader-lock (independent of `locked`): when true, the channel's
    // fader value is frozen against scripted transitions and solo
    // gestures. See slot 5 / fader_lock for the four semantic rules:
    //   1. Manual fader writes (PATCH / WS) are rejected at the engine
    //      boundary — the operator's slider tap no-ops on a locked
    //      channel, and the iPad re-syncs to the engine value on the
    //      next broadcast.
    //   2. triggerMixerTransition skips fader-locked channels entirely
    //      (no force-enable, no fade scheduled, fader stays where it
    //      is). Pattern content swaps still work.
    //   3. Solo (implemented client-side in CaptainPad mixer.tsx) skips
    //      fader-locked channels: a sibling channel's solo does NOT
    //      mute this one, and un-solo does NOT restore it.
    //   4. Explicit mute (enabled=false) still works — fader-lock does
    //      NOT override an operator-chosen mute on this same channel.
    // `locked` (playlist/pattern lock) is unrelated and can be on/off
    // independently of `faderLocked`.
    this.faderLocked = faderLocked;

    // ── Channel-group membership (WAVE 15, gang-faders) ──────────────────
    // A single-membership pointer to a MixGroup id (`mg_*`) on the
    // PatternMixer, or null = "not in any group". The group applies a gang
    // fader / mute that SCALES this channel's contribution at composite time
    // (see PatternMixer._effFader). Persisted so the operator's grouping
    // survives an engine restart. Membership is modelled as a channel→group
    // POINTER (not a group→members array) so removing a channel can never
    // leave a dangling member reference. Default null = no group (an old
    // state file without this field restores to null — documented schema
    // default, not a silent fallback).
    this.mixGroupId = (typeof mixGroupId === 'string' && mixGroupId.length > 0)
      ? mixGroupId
      : null;

    // ── Solo-safe (WAVE 15) ──────────────────────────────────────────────
    // Rig-config flag: when true this channel is NEVER gated off by ANOTHER
    // channel's solo. It protects the mission-critical exterior — soloing an
    // interior layer must not drop the exterior into darkness. soloSafe
    // survives a solo, but it does NOT escape an explicit mute (enabled=false)
    // or a group-mute (structural kills win). Persisted like faderLocked.
    // Default false (an old state file restores to false — documented
    // schema default).
    this.soloSafe = !!soloSafe;

    // ── Per-channel Hue shift (docs/39 §F-hue) ───────────────────────────
    // Rotates THIS channel's RGB hue (W/A/UV untouched) BEFORE it is
    // blended into the composite — so the operator can recolor one layer
    // without touching the rest of the mix. Applied on the interleaved
    // RGBWAU channelBuffer in pattern_mixer (applyHueShift6chU8), gated on
    // a non-zero value so the default channel pays nothing. Stacks
    // ADDITIVELY with the GLOBAL hue (which rotates the whole buffer
    // post-composite). Normalized into [0,360) — an old state file without
    // this field restores to 0 (documented schema default, not a silent
    // fallback). Constrained at the API boundary (validateHue) and
    // defensively here.
    this.hue = (typeof hue === 'number' && Number.isFinite(hue))
      ? ((hue % 360) + 360) % 360
      : 0;

    // ── Per-channel color INVERT (docs/39 §F-invert) ─────────────────────
    // Inverts THIS channel's RGB output (255 - v per byte) BEFORE it is
    // blended into the composite — a per-channel chroma op, structurally a
    // sibling of `hue`. Leaves W/A/UV BYTE-FOR-BYTE untouched (the
    // mission-critical exterior whites carry no color concept and must never
    // be flipped/dimmed). Applied on the interleaved RGBWAU channelBuffer in
    // pattern_mixer (applyInvert6chU8), gated on the flag so the default
    // channel pays nothing. When BOTH hue and invert are set the IMPLEMENTED
    // buffer-order composition is HUE-THEN-INVERT (hue rotates first, then the
    // rotated RGB is flipped); the two ops commute within rounding, so the
    // output is order-independent — see pattern_mixer for the rationale. Pure
    // boolean (coerced via !! like soloSafe/followsTempo). An old state file
    // without this field restores to false (documented schema default, not a
    // silent fallback).
    this.invert = !!invert;

    // ── Per-channel phase clock (docs/39 §F-phase: #3 speed / #4 tap-tempo
    //    / #11 chase) ──────────────────────────────────────────────────
    // The VM consumes ABSOLUTE per-handle time (wasm_host.beginFrame).
    // The engine already accumulates one GLOBAL scaled phase (engine.js
    // patternClockSeconds) and fans the SAME `elapsed` to every channel.
    // We give each channel its OWN accumulated phase derived from that
    // same global elapsed DELTA, scaled by this channel's effectiveSpeed.
    // CRITICAL: we ACCUMULATE (never re-scale a raw dt at the call site)
    // so an absolute-time pattern never JUMPS when the operator changes
    // speed mid-show — the accumulator stays continuous across the change.
    //
    //   speed         per-channel time multiplier. Default 1.0 = run at
    //                 the global clock rate. Clamped [0.05, 8] — a 0 or
    //                 negative would FREEZE the pattern (frozen = broken),
    //                 which the codex forbids as a silent failure, so the
    //                 floor is 0.05 (visibly-slow, not dead).
    //   phaseOffsetMs constant phase shift in ms added on top of the
    //                 accumulator. Default 0. Clamped [-10000, 10000].
    //                 Same-pattern channels with staggered offsets produce
    //                 chase / ripple (#11). A change is an intended
    //                 one-frame step, not a glitch.
    //   followsTempo  opt-in: when true this channel's effectiveSpeed is
    //                 multiplied by the mixer's tap-tempo multiplier (#4).
    //                 Default false so the mission-critical exterior is
    //                 immune to a tempo tap unless the operator opts in.
    //
    // An old state file without these fields restores to the documented
    // schema defaults (1.0 / 0 / false) — NOT a silent fallback.
    this.speed = (typeof speed === 'number' && Number.isFinite(speed))
      ? Math.max(0.05, Math.min(8, speed))
      : 1.0;
    this.phaseOffsetMs = (typeof phaseOffsetMs === 'number' && Number.isFinite(phaseOffsetMs))
      ? Math.max(-10000, Math.min(10000, phaseOffsetMs))
      : 0;
    this.followsTempo = !!followsTempo;

    // ── Channel FOLLOW / LINK (round-2 #6, docs/39 §F-follow) ────────────
    // When `followLeaderId` is set to another channel's id (the "leader"),
    // THIS channel (the "follower") stops using its own manual `fader` as
    // its composite INPUT and instead tracks the leader's EFFECTIVE level
    // (the value the leader actually renders at, post group/solo/faderMax/
    // bump) times this follower's own `followScale`. Everything else about
    // the follower stays independent: its own pattern/hue/invert/group/solo
    // and — critically — its OWN faderMax ceiling, solo gate, enabled gate,
    // and bump are STILL applied on top of the followed input. i.e. follow
    // replaces only the follower's manual fader INPUT; it never escapes the
    // follower's own safety caps. Following only ever affects the FOLLOWER's
    // level — it can NEVER alter the leader (a follower can never force a
    // mission-critical leader dark). See PatternMixer._effFader for the exact
    // precedence and the previous-frame resolution.
    //
    //   followLeaderId  id of the leader channel, or null = "not following"
    //                   (the follower uses its own manual fader). Cycle/self
    //                   rejection lives at the API boundary (validateFollow,
    //                   400 FOLLOW_CYCLE). On leader DELETE the api_server
    //                   clears this on every follower so a dangling reference
    //                   can never render unpredictably (fail safe → revert to
    //                   own fader, NOT dark, NOT silent). Default null
    //                   (documented schema default — an old state file without
    //                   this field restores to null, not a silent fallback).
    //   followScale     multiplier applied to the leader's effective level
    //                   before the follower's own caps. Default 1.0 = track
    //                   the leader 1:1. Clamped to [0,2] (defensively here and
    //                   at the API boundary via validateFollowScale) — a
    //                   non-finite value restores to 1.0 (documented default).
    this.followLeaderId = (typeof followLeaderId === 'string' && followLeaderId.length > 0)
      ? followLeaderId
      : null;
    this.followScale = (typeof followScale === 'number' && Number.isFinite(followScale))
      ? Math.max(0, Math.min(2, followScale))
      : 1.0;

    // TRANSIENT phase-clock accumulator state — NEVER serialized (the
    // accumulator is rebuilt from zero on boot; persisting it would pin a
    // stale absolute time that means nothing after a restart). _phaseSeconds
    // is the running per-channel phase; _lastPhaseElapsed is the previous
    // global elapsed we differenced against (null = first frame ⇒ dt 0).
    this._phaseSeconds = 0;
    this._lastPhaseElapsed = null;

    // TRANSIENT auto-cycle anchor (round-2 #2 AUTO-CYCLE, docs/39 §auto-cycle)
    // — NEVER serialized. Wall-clock ms (Date.now) of the last auto-advance
    // for this channel's playlist. null = "not yet seeded": the first frame on
    // which autopilot.active is true SEEDS this to now and does NOT advance, so
    // the first auto-advance lands a full delay_s after activation (and after a
    // boot, since the field re-seeds to now). The tick measures wall-clock
    // deltas against this anchor (self-correcting, no accumulated drift). A
    // manual entry tap (loadPlaylistEntry) RESETS this to null so the next
    // tick measures from the manual change, not the stale pre-tap baseline.
    // Persisting it would pin a stale absolute time that means nothing after a
    // restart — hence transient, like _phaseSeconds.
    this._autoCycleLastAdvanceMs = null;

    this.transitionMode = transitionMode;
    this.transitionTime = transitionTime;

    // Engine-side view selection: restricts which model pixels this
    // channel paints into the composed mixerBuffer / deckBuffer. See
    // docs/27_[todo]_mixer_layer_view_selection.md for the full design.
    //
    //   viewSelection.type   : 'all' | 'group' | 'section' | 'fixture' | 'viewMask'
    //   viewSelection.target : null (for 'all'), string (for 'group'),
    //                          integer (section/fixture/viewMask)
    //   viewSelection.invert : optional bool; if true, mask is negated
    //                          ("paint everything EXCEPT the target").
    //
    // `compiledPixelMask` is the transient Uint8Array lookup the render
    // loop reads each frame. `null` means "all pixels selected" — the
    // fast path skips per-pixel mask checks entirely.
    this.viewSelection = viewSelection || { type: 'all', target: null, invert: false };
    this.compiledPixelMask = null;
    
    // Exports from WASM
    this.localExports = [];
    
    // Control state. Per docs/19_playlists.md the playlist entry's
    // `defaults` field is the canonical per-slot store; `localControls`
    // tracks live values for the current entry.
    this.localControls = {}; // controlId -> {v0, v1, v2}

    // Shared parameter bindings
    this.sharedBindings = {};

    // Playlist assignment for this channel — { name, activeEntryId, cursor, autopilot }.
    // Every channel is conceptually in playlist mode (default playlist
    // covers the "I haven't customized this yet" case).
    this.playlist = null;
  }

  beginFrame(wasmHost, elapsedSeconds, forceRender = false, effectiveSpeed = 1) {
    // Advance the per-channel phase accumulator from the GLOBAL elapsed
    // delta. `elapsedSeconds` is the engine's already-global-speed-scaled
    // patternClockSeconds (do NOT re-apply the global speed here — that
    // would double-count it). We difference consecutive globals to get the
    // global dt, scale by THIS channel's effectiveSpeed, and accumulate.
    //
    // First frame: _lastPhaseElapsed is null ⇒ dt = 0 (no spurious jump
    // from a cold accumulator). A negative dt (clock went backwards — e.g.
    // the engine reset patternClockSeconds) is floored to 0 rather than
    // rewinding the phase. NO modulo: f64 has ample precision for a
    // multi-day show, and wrapping would visibly glitch an absolute-time
    // pattern. We accumulate every frame the handle exists so a muted /
    // inactive channel's pattern stays time-synced (vis previews + ping-
    // pong smoothness), mirroring the existing forceRender contract.
    if (this.handle) {
      const dt = this._lastPhaseElapsed === null
        ? 0
        : Math.max(0, elapsedSeconds - this._lastPhaseElapsed);
      this._lastPhaseElapsed = elapsedSeconds;
      this._phaseSeconds += dt * effectiveSpeed;
    }
    if ((this.enabled || forceRender) && this.handle) {
      const phase = this._phaseSeconds + this.phaseOffsetMs / 1000;
      wasmHost.beginFrame(this.handle, phase);
    }
  }

  renderInto(wasmHost, buffer, forceRender = false) {
    if ((this.enabled || forceRender) && this.handle) {
      wasmHost.renderAll6ch(this.handle, buffer);
    }
  }

  setControl(wasmHost, id, v0, v1, v2) {
    this.localControls[id] = { v0, v1, v2 };
    if (this.handle) {
      wasmHost.setControl(this.handle, id, v0, v1, v2);
    }
  }

  destroy(wasmHost) {
    if (this.handle) {
      wasmHost.destroy(this.handle);
      this.handle = 0;
    }
  }
}
