import { PatternChannel } from './pattern_channel.js';
import fs from 'fs';
import path from 'path';

export class PatternMixer {
  constructor({ wasmHost, pixelCount, maxChannels }) {
    this.wasmHost = wasmHost;
    this.pixelCount = pixelCount;
    this.channels = [];
    this.master = 1.0;
    this.baseChannelId = null;
    this.deckFocusChannelId = null; // When set, deck view renders this channel instead of baseChannelId
    // maxChannels comes from config.yaml `mixer.maxChannels`. Default 3 — the
    // CaptainPad iPad strip layout doesn't fit more than that without
    // horizontal scroll / clipping. Keep total channel count (incl. the
    // base deck channel) ≤ this value.
    this.maxChannels = Number.isFinite(maxChannels) && maxChannels >= 1
      ? Math.floor(maxChannels)
      : 3;

    // View crossfade state (0.0 = deck exclusively, 1.0 = mixer exclusively)
    this.viewFader = 0.0;
    this.targetViewFader = 0.0;

    // Buffer for compositing output
    this.outputBuffer = new Uint8Array(this.pixelCount * 6);
    // Buffer for individual channel output
    this.channelBuffer = new Uint8Array(this.pixelCount * 6);
    
    this.transitions = []; // Active per-channel fader transitions
    this.blendHandles = {}; // Cache: blendName -> WASM handle
    this.patternsDir = null; // Set by caller after construction
    this.onChannelRemoved = null; // Callback: (channelId) => void

    // Group-transition machinery — when a triggerMixerTransition arrives
    // via the API, we register one transitionGroupId on every per-channel
    // fader transition. updateTransitions() fires progress / complete
    // callbacks at the group boundary, so the API layer can broadcast a
    // single throttled mixer-state instead of one per channel.
    this.transitionGroupCounter = 0;
    this.activeTransitionGroupId = null;
    // When a scripted transition is in flight, this is the target channel
    // id. renderAll6ch() promotes that channel to render LAST so its
    // trans_* blend script overlays every other (fading-out) overlay.
    // Without this the visual effect would be obscured by losers higher
    // up in the channels[] array. Cleared when the transition completes.
    this.scriptedTransitionTargetId = null;
    this.onTransitionProgress = null; // Callback: (groupId) => void — every frame an active transition is in flight
    this.onTransitionComplete = null; // Callback: (groupId) => void — fired once when the LAST channel in the group lands

    // ── Deck pattern-swap state (hidden double-buffer for deck transitions) ──
    // The deck channel (baseChannelId) renders one pattern at a time.
    // To get a SMOOTH switch from pattern A to pattern B we need both
    // running simultaneously for the duration of the transition. This
    // shadow channel does exactly that: it sits OUTSIDE this.channels
    // (so it doesn't count toward maxChannels or show up in /mixer),
    // gets ticked + rendered every frame, and composites ON TOP of the
    // deckBuffer using its fader (driven by _swapTransition) and a
    // blend script (trans_crossfade / trans_flash / trans_dissolve /
    // trans_wipe_*). When the transition lands, its handle is moved
    // onto the base channel (atomic swap) and the shadow is cleared.
    this._swapChannel = null;
    this._swapTransition = null;
    this.onDeckSwapComplete = null; // Callback: ({ pattern, transitionId }) => void
  }

  getChannel(channelId) {
    return this.channels.find(c => c.id === channelId);
  }

  addChannel(channelConfig) {
    if (this.channels.length >= this.maxChannels) {
      throw new Error(`Maximum of ${this.maxChannels} channels allowed`);
    }
    const channel = new PatternChannel(channelConfig);
    this.channels.push(channel);
    if (!this.baseChannelId) {
      this.baseChannelId = channel.id;
    }
    return channel;
  }

  removeChannel(channelId) {
    const index = this.channels.findIndex(c => c.id === channelId);
    if (index !== -1) {
      const channel = this.channels[index];
      if (this.onChannelRemoved) this.onChannelRemoved(channelId);
      channel.destroy(this.wasmHost);
      this.channels.splice(index, 1);
      if (this.baseChannelId === channelId) {
        this.baseChannelId = this.channels.length > 0 ? this.channels[0].id : null;
      }
    }
  }

  setMaster(value) {
    this.master = Math.max(0, Math.min(1, value));
  }

  async transitionBaseTo(patternName, options = {}) {
    const { durationMs = 500, mode = 'blend_screen', loadPatternFn } = options;
    // Note: loadPatternFn should be an async function that returns the compiled handle, exports, etc.
    // However, the mixer operates on handles. The caller should compile and pass the handle.
    // For simplicity, let's assume the caller adds the new channel and sets up a transition here.
    // We will automate the fade.
  }

  /**
   * Cancel any in-flight transition for `channelId`. Returns the number
   * of transitions cancelled (0 or 1 in practice). Call this before any
   * manual fader write so the server-side animation can't fight the
   * operator's hand.
   *
   * Also restores the channel's saved blend mode if the cancelled
   * transition had swapped it to a trans_* script. Without this restore,
   * a user dragging the slider mid-flash would leave the channel stuck
   * rendering `trans_flash` as its steady-state blend mode.
   */
  cancelChannelTransition(channelId) {
    const before = this.transitions.length;
    const cancelled = this.transitions.filter(t => t.channelId === channelId);
    this.transitions = this.transitions.filter(t => t.channelId !== channelId);
    const channel = this.getChannel(channelId);

    // Restore the saved blend mode ONLY if we actually cancelled
    // something. Without this guard we'd undo a brand-new `_savedMode`
    // assignment in cases where the caller (typically fadeChannel)
    // pre-set `_savedMode` and `channel.mode` just before pushing the
    // transition — the cancellation pass would race the trigger and
    // silently snap the blend mode back, killing scripted transitions
    // (trans_flash etc.) the instant they're scheduled.
    if (channel && channel._savedMode && cancelled.length > 0) {
      const restoreMode = cancelled.find(t => t.restoreMode)?.restoreMode || channel._savedMode;
      channel.mode = restoreMode;
      delete channel._savedMode;
      // Pre-compile so the first post-cancel frame doesn't drop the blend.
      this.getBlendHandle(restoreMode);
    }
    // Same reasoning: only clear the scripted-target render-order flag
    // when we actually cancelled a transition for the same channel.
    // Otherwise a fresh trigger would un-promote its own target on the
    // very first fadeChannel call.
    if (cancelled.length > 0 && this.scriptedTransitionTargetId === channelId) {
      this.scriptedTransitionTargetId = null;
    }
    return before - this.transitions.length;
  }

  fadeChannel(channelId, targetFader, durationMs, options = {}) {
    const channel = this.getChannel(channelId);
    if (!channel) return false;

    // Last-write-wins: cancel any existing transition for this channel
    // before pushing the new one. Two stacked fadeChannel calls without
    // this guard would produce visibly jittery faders as updateTransitions
    // ran both lerps against the same channel.fader slot.
    this.cancelChannelTransition(channelId);

    const safeDurationMs = Math.max(1, Number(durationMs) || 1);
    const clampedTarget = Math.max(0, Math.min(1, targetFader));

    this.transitions.push({
      channelId,
      startFader: channel.fader,
      targetFader: clampedTarget,
      startTime: performance.now(),
      durationMs: safeDurationMs,
      destroyOnComplete: options.destroyOnComplete || false,
      isBaseTransition: options.isBaseTransition || false,
      newBaseId: options.newBaseId || null,
      groupId: options.groupId || null,
      curve: options.curve || 'smoothstep',
      // If set, channel.mode is reverted to this string when the
      // transition lands. Used by scripted transitions (trans_flash etc.)
      // to restore the target's steady-state blend mode after the fade.
      restoreMode: options.restoreMode || null,
    });
    return true;
  }

  /**
   * Server-driven group transition. Fades `targetChannelId` to 1.0 and
   * every other overlay channel to 0.0 over `durationMs`. The base/deck
   * channel is never touched. All overlays are force-enabled first
   * (transition wins over mute/solo). Returns the assigned `transitionId`
   * or `null` if nothing was scheduled (no overlays / missing or invalid
   * target).
   *
   * Honors `transitionMode` — the user-selected `trans_*` blend script
   * that drives the visual effect:
   *
   *   - 'trans_crossfade' (default): no blend swap. Faders ramp smoothly
   *     and the existing `blend_screen` (or whatever) modes do the
   *     compositing. Cheapest, no script overhead, perceptually identical
   *     to a real crossfade for two-overlay setups.
   *
   *   - 'trans_flash' / 'trans_dissolve' / 'trans_iris' / 'trans_wipe_*':
   *     the target channel's `mode` is temporarily swapped to the
   *     selected trans_* script for the duration of the fade. The
   *     channel.fader is ramped 0 → 1, and that value is passed straight
   *     into the WASM blend as `progress`, so the script's visual effect
   *     (flash white, random pixel dissolve, iris open, wipe edge, …)
   *     unfolds across the requested durationMs. On completion the saved
   *     blend mode is restored automatically (see updateTransitions).
   *
   * Losers always fade their faders smoothstep 1 → 0 on their existing
   * blend mode — no script swap — so they smoothly drop out of the mix.
   *
   * Why server-side instead of letting the iPad rAF-drive the fades:
   *   - The engine renders at 40 Hz and applies `channel.fader` on every
   *     tick inside updateTransitions(), so DMX/sACN output updates at
   *     full engine framerate with zero network jitter — no rAF stepping,
   *     no WS throttle dead-zones.
   *   - The client sends ONE WS message instead of a 30 Hz storm of
   *     setChannelFader updates that get throttled, dropped, or coalesced
   *     into visible "dead zones" + sudden jumps. See agent diagnostic
   *     "Mixer Transition Behavior Analysis" (May 2026) §1 / §2.
   *
   * @param {Object} opts
   * @param {string} opts.targetChannelId  Channel that fades to 1.0
   * @param {number} opts.durationMs       Animation length (1–30000 ms)
   * @param {string} [opts.curve]          'smoothstep' (default) or 'linear'
   * @param {string} [opts.mode]           Only 'exclusiveOverlays' supported today
   * @param {string} [opts.transitionMode] 'trans_crossfade' (default) | 'trans_flash' | …
   * @param {string} [opts.transitionId]   Caller-supplied id for round-trip
   */
  triggerMixerTransition({ targetChannelId, durationMs, curve = 'smoothstep', mode = 'exclusiveOverlays', transitionMode = 'trans_crossfade', transitionId = null } = {}) {
    if (mode !== 'exclusiveOverlays') {
      console.warn(`[Mixer] Unsupported mixer transition mode: ${mode}`);
      return null;
    }
    const overlays = this.channels.filter(c => c.id !== this.baseChannelId);
    if (overlays.length === 0) return null;
    if (!overlays.find(c => c.id === targetChannelId)) return null;

    // Validate transitionMode: must be a string starting with 'trans_'.
    // Fall back to crossfade if we can't even load the blend script —
    // better to do a clean crossfade than throw on the operator's tap.
    let resolvedTransMode = (typeof transitionMode === 'string' && transitionMode.startsWith('trans_'))
      ? transitionMode
      : 'trans_crossfade';
    if (resolvedTransMode !== 'trans_crossfade') {
      const handle = this.getBlendHandle(resolvedTransMode);
      if (!handle) {
        console.warn(`[Mixer] transitionMode '${resolvedTransMode}' could not be compiled; falling back to trans_crossfade.`);
        resolvedTransMode = 'trans_crossfade';
      }
    }
    const useScriptedTransition = resolvedTransMode !== 'trans_crossfade';

    // Before scheduling: restore any in-flight saved modes from a
    // previous (still-running) scripted transition. Without this, a
    // back-to-back trigger could snapshot trans_flash as the "saved"
    // mode and never get back to blend_screen.
    for (const c of overlays) {
      if (c._savedMode) {
        c.mode = c._savedMode;
        delete c._savedMode;
      }
    }

    const id = transitionId || `g_${++this.transitionGroupCounter}_${Date.now()}`;
    this.activeTransitionGroupId = id;
    this.scriptedTransitionTargetId = useScriptedTransition ? targetChannelId : null;

    for (const c of overlays) {
      // Force-enable + anchor at the *visible* contribution. A channel
      // that's currently muted is rendering at 0; treating its start as
      // the stored fader would make it snap to that value the moment we
      // enable it. Anchoring to 0 keeps it fading in cleanly.
      const visibleStart = c.enabled ? c.fader : 0;
      c.enabled = true;
      c.fader = visibleStart;

      const isTarget = c.id === targetChannelId;
      if (isTarget && useScriptedTransition) {
        // Save the steady-state mode so updateTransitions can revert
        // on completion. Anchor fader to 0 so the blend script's
        // progress starts at 0 (== "show from unchanged"); the
        // smoothstep ramp will drive it to 1 by transition end.
        c._savedMode = c.mode;
        c.mode = resolvedTransMode;
        // Force above the renderAll6ch skip threshold (0.001) so the
        // blend script runs on EVERY frame of the transition, including
        // the very first tick. Without this nudge the target's blend
        // would be skipped during the initial ~25 ms while smoothstep
        // is still below 0.001, producing a tiny "pop" at start.
        c.fader = 0.002;
        this.fadeChannel(c.id, 1.0, durationMs, {
          groupId: id,
          curve,
          restoreMode: c._savedMode,
        });
      } else {
        const targetFader = isTarget ? 1.0 : 0.0;
        this.fadeChannel(c.id, targetFader, durationMs, { groupId: id, curve });
      }
    }
    return id;
  }

  // Back-compat shim — old name. Prefer `triggerMixerTransition`.
  transitionTo(targetChannelId, durationMs) {
    return this.triggerMixerTransition({ targetChannelId, durationMs });
  }

  /**
   * Soft-swap the deck base channel's pattern using a hidden double-buffer.
   *
   * Concept (see also `_swapChannel` docstring in the constructor):
   *   1. The new pattern's compiled WASM handle comes in via `newHandle`.
   *   2. We allocate a hidden shadow channel that wraps that handle.
   *   3. A server-side fader transition ramps the shadow from 0 → 1 with
   *      the chosen `transitionMode` (a `trans_*` blend script — see
   *      patterns/transitions/*.js). During the ramp, `renderAll6ch()`
   *      composites the shadow ON TOP of the deck buffer using that
   *      blend script, so the visual effect (crossfade, flash, dissolve,
   *      wipe, etc.) plays out smoothly.
   *   4. On completion, the new handle is moved onto the base channel
   *      (atomic), the OLD base handle is destroyed, and the shadow is
   *      torn down. From the operator's POV the deck now "is" the new
   *      pattern, with no visible glitch.
   *
   * Why we don't reuse `triggerMixerTransition`:
   *   - That routine fades EVERY overlay (winners up, losers down),
   *     which would clobber any user-added mixer overlays on the deck
   *     swap path. Worse, the deck base is explicitly excluded from
   *     that fade. We need a single dedicated target that lives outside
   *     `this.channels` to keep mixer state untouched.
   *
   * Caller contract:
   *   - `newHandle` ownership transfers to the mixer. Whether the swap
   *     succeeds, falls back, or is replaced by another swap mid-flight,
   *     the mixer is responsible for destroying it (avoids the caller
   *     having to track a half-installed handle).
   *   - `onComplete` fires AFTER the handle has been moved onto the
   *     base channel. The api_server uses it to re-register CPC, apply
   *     entry defaults, save state, and broadcast — all the bookkeeping
   *     that `loadPlaylistEntry` would normally do synchronously.
   *
   * @param {Object} opts
   * @param {Object} opts.newHandle        Compiled WASM handle (required)
   * @param {string} opts.patternName      Pattern name (for channel.pattern)
   * @param {number} [opts.durationMs=1000]
   * @param {string} [opts.transitionMode='trans_crossfade']
   * @param {string} [opts.steadyMode='blend_screen'] Blend mode used during a
   *   crossfade transition (when transitionMode === 'trans_crossfade'). Has
   *   no effect for scripted transitions because the script IS the blend.
   * @param {Function} [opts.onComplete]   Called once the handle is installed
   * @returns {string|null}  Transition id, or null if swap was rejected.
   */
  triggerDeckPatternSwap({
    newHandle,
    patternName,
    durationMs = 1000,
    transitionMode = 'trans_crossfade',
    steadyMode = 'blend_screen',
    onComplete = null,
  } = {}) {
    if (!newHandle) return null;
    if (!this.baseChannelId || !this.getChannel(this.baseChannelId)) {
      // No deck to swap onto — refuse and destroy the incoming handle
      // so the caller doesn't leak the freshly compiled VM.
      try { this.wasmHost.destroy(newHandle); } catch (_) {}
      return null;
    }

    // If a prior swap is mid-flight, tear it down before installing the
    // new one. Operator spamming pattern picks must always converge on
    // the LAST pick; older handles get destroyed.
    if (this._swapChannel) {
      if (this._swapChannel.handle) {
        try { this.wasmHost.destroy(this._swapChannel.handle); } catch (_) {}
      }
      this._swapChannel = null;
      this._swapTransition = null;
    }

    // Resolve transition mode. Fall back to plain crossfade if the
    // requested blend script can't compile — a clean fade beats an
    // operator-tap error every time.
    let resolved = (typeof transitionMode === 'string' && transitionMode.startsWith('trans_'))
      ? transitionMode
      : 'trans_crossfade';
    if (resolved !== 'trans_crossfade') {
      const h = this.getBlendHandle(resolved);
      if (!h) {
        console.warn(`[Mixer] deck-swap transitionMode '${resolved}' could not be compiled; falling back to trans_crossfade.`);
        resolved = 'trans_crossfade';
      }
    }
    const useScripted = resolved !== 'trans_crossfade';

    // Allocate the shadow channel. Hidden flag is informational — the
    // shadow lives OUTSIDE `this.channels`, so any iteration over
    // mixer state naturally skips it (no need for filter calls).
    this._swapChannel = new PatternChannel({
      id: '__deck_swap__',
      name: 'Deck Swap',
      pattern: patternName,
      handle: newHandle,
      mode: useScripted ? resolved : steadyMode,
      // Nudge above the 0.001 render threshold so the blend script
      // runs on the very first tick of the transition. Without this
      // the first ~25 ms would skip compositing and produce a "pop".
      fader: 0.002,
      enabled: true,
    });
    this._swapChannel._hidden = true;

    const id = `deck_${++this.transitionGroupCounter}_${Date.now()}`;
    this._swapTransition = {
      id,
      startFader: 0,
      targetFader: 1.0,
      startTime: performance.now(),
      durationMs: Math.max(1, Number(durationMs) || 1),
      onComplete,
    };
    return id;
  }

  /**
   * Cancel any in-flight deck swap. Destroys the shadow handle without
   * promoting it onto the base. Useful when the operator triggers a new
   * swap before the previous one has landed, or when the engine shuts
   * down mid-fade.
   */
  cancelDeckPatternSwap() {
    if (!this._swapChannel && !this._swapTransition) return false;
    if (this._swapChannel && this._swapChannel.handle) {
      try { this.wasmHost.destroy(this._swapChannel.handle); } catch (_) {}
    }
    this._swapChannel = null;
    this._swapTransition = null;
    return true;
  }

  /**
   * True iff a deck pattern swap is currently animating. Used by the
   * API layer to refuse new manual taps (the operator asked for taps
   * during an in-flight swap to be IGNORED, not queued) and to short-
   * circuit redundant "finish now" calls.
   */
  isDeckSwapInFlight() {
    return !!(this._swapTransition && this._swapChannel);
  }

  /**
   * Force the current deck swap to land NOW: jumps the fader to 1.0,
   * runs the same atomic handle promotion + onComplete callback that
   * `updateDeckSwapTransition` would on normal completion, then returns.
   *
   * Used when the operator navigates away from the deck tab mid-fade
   * (CaptainPad → mixer view): they expect the deck to be "settled" on
   * the destination pattern by the time they come back. Snap-to-end is
   * cleaner than letting a half-blended deck buffer hang around invisibly
   * while the user is in the mixer view.
   *
   * Idempotent: returns false if no swap is in flight.
   */
  finishDeckSwapNow() {
    if (!this.isDeckSwapInFlight()) return false;
    // Trick updateDeckSwapTransition into running its "linear >= 1"
    // branch by rewinding startTime far enough back that elapsed
    // exceeds durationMs. This keeps the SAME completion path — atomic
    // handle promotion, onComplete callback, scriptedTransitionTargetId
    // cleanup if applicable — without us reimplementing it here and
    // drifting from the normal flow.
    this._swapTransition.startTime = performance.now() - this._swapTransition.durationMs - 1;
    this.updateDeckSwapTransition(performance.now());
    return true;
  }

  /**
   * Tick the deck-swap transition one frame. Called from beginFrame().
   * Handles fader ramp, atomic handle promotion on completion, and the
   * `onComplete` callback.
   */
  updateDeckSwapTransition(now = performance.now()) {
    if (!this._swapTransition || !this._swapChannel) return;
    const t = this._swapTransition;
    const elapsed = now - t.startTime;
    let linear = t.durationMs > 0 ? elapsed / t.durationMs : 1;
    if (linear >= 1) linear = 1;
    // Same smoothstep ease as updateTransitions for visual consistency.
    const eased = linear * linear * (3 - 2 * linear);
    this._swapChannel.fader = t.startFader + (t.targetFader - t.startFader) * eased;

    if (linear >= 1) {
      // Snap exactly so floating-point drift can't strand us at 0.9999.
      this._swapChannel.fader = 1.0;
      const base = this.getChannel(this.baseChannelId);
      const finishedId = t.id;
      const finishedCb = t.onComplete;
      const finishedPattern = this._swapChannel.pattern;
      const newHandle = this._swapChannel.handle;
      // Mark the shadow as ownership-transferred BEFORE running any
      // callbacks so any re-entrant trigger inside the callback doesn't
      // try to free the handle we just promoted.
      this._swapChannel.handle = null;
      const oldHandle = base ? base.handle : null;
      if (base) {
        base.handle = newHandle;
        base.pattern = finishedPattern;
      }
      this._swapChannel = null;
      this._swapTransition = null;
      // Destroy the old base handle AFTER the swap so the renderer
      // never reads from a freed handle on the boundary tick.
      if (oldHandle && oldHandle !== newHandle) {
        try { this.wasmHost.destroy(oldHandle); } catch (_) {}
      }
      if (finishedCb) {
        try {
          finishedCb({ pattern: finishedPattern, transitionId: finishedId });
        } catch (e) {
          console.warn('[Mixer] deck-swap onComplete threw:', e.message);
        }
      }
      if (this.onDeckSwapComplete) {
        try {
          this.onDeckSwapComplete({ pattern: finishedPattern, transitionId: finishedId });
        } catch (e) {
          console.warn('[Mixer] onDeckSwapComplete threw:', e.message);
        }
      }
    }
  }

  updateTransitions(now = performance.now()) {
    if (this.transitions.length === 0) return false;

    // Snapshot of groups in-flight before this tick — used to fire
    // onTransitionComplete EXACTLY once per group, even if N channels
    // in the same group finish on the same tick. Without this guard the
    // API layer would call saveAllState() once per channel (N writes
    // per transition completion).
    const groupsBefore = new Set();
    for (const t of this.transitions) if (t.groupId) groupsBefore.add(t.groupId);

    for (let i = this.transitions.length - 1; i >= 0; i--) {
      const t = this.transitions[i];
      const elapsed = now - t.startTime;
      let linear = t.durationMs > 0 ? elapsed / t.durationMs : 1;
      if (linear >= 1) linear = 1;
      // Smooth-step ease: derivative is 0 at both endpoints. Winner
      // (start→1) and losers (start→0) ride the SAME curve in their
      // respective directions, so brightness is symmetric across the
      // transition — no "fast at one end, frozen at the other"
      // artifacts that the previous sin/cos pair produced.
      // Agent review (May 2026) §1.
      let eased;
      if (t.curve === 'linear') {
        eased = linear;
      } else {
        eased = linear * linear * (3 - 2 * linear); // smoothstep default
      }

      const channel = this.getChannel(t.channelId);
      if (channel) {
        channel.fader = t.startFader + (t.targetFader - t.startFader) * eased;
      }

      if (linear >= 1) {
        // Snap exactly to target so floating-point drift never strands
        // the final fader at 0.9999 or 0.0001.
        if (channel) channel.fader = t.targetFader;
        // Restore the saved blend mode for scripted transitions
        // (trans_flash etc.). After this the channel goes back to
        // compositing normally with blend_screen / etc.
        if (t.restoreMode && channel) {
          channel.mode = t.restoreMode;
          delete channel._savedMode;
          // Pre-compile so the very next frame doesn't drop the blend
          // while the WASM handle is lazily loaded.
          this.getBlendHandle(t.restoreMode);
        }
        if (t.destroyOnComplete && channel) {
          this.removeChannel(t.channelId);
        }
        if (t.isBaseTransition && t.newBaseId) {
          this.baseChannelId = t.newBaseId;
        }
        this.transitions.splice(i, 1);
      }
    }

    // After-tick group accounting
    const groupsAfter = new Set();
    for (const t of this.transitions) if (t.groupId) groupsAfter.add(t.groupId);

    // Clear the scripted-target render-order flag when its group lands.
    if (this.scriptedTransitionTargetId &&
        !this.transitions.some(t => t.channelId === this.scriptedTransitionTargetId)) {
      this.scriptedTransitionTargetId = null;
    }

    if (this.onTransitionProgress) {
      try { this.onTransitionProgress({ transitionId: this.activeTransitionGroupId, active: this.transitions.length > 0 }); }
      catch (e) { console.warn('[Mixer] onTransitionProgress threw:', e.message); }
    }

    for (const gid of groupsBefore) {
      if (!groupsAfter.has(gid)) {
        if (gid === this.activeTransitionGroupId) this.activeTransitionGroupId = null;
        if (this.onTransitionComplete) {
          try { this.onTransitionComplete({ transitionId: gid }); }
          catch (e) { console.warn('[Mixer] onTransitionComplete threw:', e.message); }
        }
      }
    }
    return true;
  }

  beginFrame(elapsedSeconds) {
    const now = performance.now();
    this.updateTransitions(now);
    // Deck-swap shadow runs on the same clock so its fader animation
    // visibly matches the existing overlay-fade animations.
    this.updateDeckSwapTransition(now);
    for (const channel of this.channels) {
      // Always tick all channels so muted patterns keep animating (for vis)
      channel.beginFrame(this.wasmHost, elapsedSeconds, true);
    }
    // Tick the shadow too so its pattern advances time alongside the
    // base channel — without this the new pattern would be frozen at
    // its first frame for the whole transition.
    if (this._swapChannel && this._swapChannel.handle) {
      this._swapChannel.beginFrame(this.wasmHost, elapsedSeconds, true);
    }
  }

  applyMaster(out, master) {
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.round(out[i] * master);
    }
  }

  renderAll6ch() {
    if (!this.deckBuffer) {
      this.deckBuffer = new Uint8Array(this.pixelCount * 6);
      this.mixerBuffer = new Uint8Array(this.pixelCount * 6);
    }
    
    this.deckBuffer.fill(0);
    this.mixerBuffer.fill(0);
    this.outputBuffer.fill(0);

    // Per-channel vis data (RGBWAU, 6 bytes per pixel).
    //
    // OPTIMIZATION (May 2026): we used to fully re-render every channel
    // on every frame here just to populate _visData. Patterns are not
    // cheap (custom WASM bytecode running per pixel), and the vis
    // broadcast on top of this fires at 10 Hz, not 40 Hz — so 3 out
    // of every 4 frames of work were thrown away. With 4 channels
    // (base + 3 overlays) on a hot mac that doubled the per-frame
    // cost. The fix is dead simple:
    //
    //   - Skip the per-channel pre-pass when wantVisThisFrame is false.
    //   - engine.js sets it to true only on frames where it will
    //     actually broadcast vis (every ~100 ms).
    //   - Compositing renders below still happen every frame (they
    //     drive the actual sACN output and the visible deck/mixer
    //     buffer), so the engine output is unaffected.
    //
    // Stale frames between broadcasts keep the previous _visData,
    // which is fine — nobody reads it on those ticks.
    const wantVis = this.wantVisThisFrame !== false;
    if (wantVis) this._visData = {};

    // Smooth view crossfade (0 = deck, 1 = mixer)
    if (this.viewFader < this.targetViewFader) {
      this.viewFader = Math.min(this.targetViewFader, this.viewFader + 0.05);
    } else if (this.viewFader > this.targetViewFader) {
      this.viewFader = Math.max(this.targetViewFader, this.viewFader - 0.05);
    }

    // 1. Render ALL channels for vis data (every channel always gets fresh
    //    vis on vis-broadcast frames). Skipped on non-broadcast frames per
    //    the OPTIMIZATION note above.
    if (wantVis) {
      for (const channel of this.channels) {
        this.channelBuffer.fill(0);
        channel.renderInto(this.wasmHost, this.channelBuffer, true);
        this._visData[channel.id] = this._extractVis(this.channelBuffer);
      }
    }

    // 2. Render Deck (focused channel or base channel → deckBuffer)
    const deckChannelId = this.deckFocusChannelId || this.baseChannelId;
    const deck = this.getChannel(deckChannelId);
    if (deck) {
      this.channelBuffer.fill(0);
      // Deck preview acts like a PFL (Pre-Fade Listen) — always output at 100%
      // ignoring the channel's live mixer mute or fader state.
      deck.renderInto(this.wasmHost, this.deckBuffer, true);
    }

    // 2b. Deck pattern-swap shadow — composite ON TOP of deck buffer
    // using the swap channel's blend mode + fader. Only runs while a
    // deck swap is in flight (otherwise _swapChannel is null). The
    // mixer compositing loop below does NOT see the swap channel
    // because it lives outside this.channels.
    if (this._swapChannel && this._swapChannel.handle && this._swapChannel.fader > 0.001) {
      this.channelBuffer.fill(0);
      this._swapChannel.renderInto(this.wasmHost, this.channelBuffer, true);
      const blendHandle = this.getBlendHandle(this._swapChannel.mode);
      if (blendHandle) {
        const result = this.wasmHost.renderBlend6ch(
          blendHandle, this.pixelCount,
          this.deckBuffer, this.channelBuffer, this._swapChannel.fader
        );
        this.deckBuffer.set(result);
      } else {
        // Last-resort linear crossfade if the blend script can't load.
        // Keeps the swap visible-but-ugly rather than invisible.
        const f = this._swapChannel.fader;
        const iv = 1 - f;
        for (let i = 0; i < this.deckBuffer.length; i++) {
          this.deckBuffer[i] = Math.round(this.deckBuffer[i] * iv + this.channelBuffer[i] * f);
        }
      }
      // Expose the swap channel's vis under a stable id so anyone
      // debugging can see what's coming next. Only on vis-broadcast
      // frames — see the OPTIMIZATION note in the pre-pass section.
      if (wantVis) {
        this._visData['__deck_swap__'] = this._extractVis(this.channelBuffer);
      }
    }

    // 3. Render Mixer layers (all enabled channels, composited bottom-to-top → mixerBuffer)
    //
    // When a scripted transition is in flight, promote the target channel
    // to render LAST. Its `mode` has been temporarily swapped to a
    // trans_* blend script (e.g. trans_flash) whose visual must overlay
    // every other (fading-out) overlay. Without this promotion, a loser
    // later in the channels[] array would composite ON TOP of the flash
    // and obscure it. The natural order is restored as soon as the
    // transition completes (scriptedTransitionTargetId is cleared in
    // updateTransitions).
    let renderOrder = this.channels;
    if (this.scriptedTransitionTargetId) {
      const tid = this.scriptedTransitionTargetId;
      const idx = this.channels.findIndex(c => c.id === tid);
      if (idx !== -1 && idx !== this.channels.length - 1) {
        renderOrder = [...this.channels.filter(c => c.id !== tid), this.channels[idx]];
      }
    }

    let firstLayer = true;
    for (const channel of renderOrder) {
      // Deck channel (baseChannelId) is isolated — only rendered into deckBuffer
      if (channel.id === this.baseChannelId) continue;
      // Skip dark channels EXCEPT the scripted-transition target, whose
      // blend script must run on every frame (its progress arg is the
      // channel.fader, and at the very start of a fade the value can sit
      // below 0.001 for a frame or two — skipping it would create a
      // visible "no transition yet" pop). The target is already nudged
      // to fader=0.002 in triggerMixerTransition, but this belt-and-
      // suspenders check keeps the invariant honest.
      const isScriptedTarget = channel.id === this.scriptedTransitionTargetId;
      if (!channel.enabled) continue;
      if (!isScriptedTarget && channel.fader <= 0.001) continue;

      // Re-render into channelBuffer for blend compositing
      this.channelBuffer.fill(0);
      channel.renderInto(this.wasmHost, this.channelBuffer, true);

      if (firstLayer) {
        const blendHandle = this.getBlendHandle(channel.mode);
        if (blendHandle) {
          const result = this.wasmHost.renderBlend6ch(
            blendHandle, this.pixelCount,
            this.mixerBuffer, this.channelBuffer, channel.fader
          );
          this.mixerBuffer.set(result);
        } else {
          this.mixerBuffer.set(this.channelBuffer);
          if (channel.fader < 1.0) this.applyMaster(this.mixerBuffer, channel.fader);
        }
        firstLayer = false;
      } else {
        const blendHandle = this.getBlendHandle(channel.mode);
        if (blendHandle) {
          const result = this.wasmHost.renderBlend6ch(
            blendHandle, this.pixelCount,
            this.mixerBuffer, this.channelBuffer, channel.fader
          );
          this.mixerBuffer.set(result);
        }
      }
    }

    // 3. Output: crossfade between deck and mixer based on viewFader
    if (this.viewFader <= 0.001) {
      this.outputBuffer.set(this.deckBuffer);
    } else if (this.viewFader >= 0.999) {
      this.outputBuffer.set(this.mixerBuffer);
    } else {
      const v = this.viewFader;
      const iv = 1 - v;
      for (let i = 0; i < this.outputBuffer.length; i++) {
        this.outputBuffer[i] = Math.round(this.deckBuffer[i] * iv + this.mixerBuffer[i] * v);
      }
    }

    if (this.master < 1.0) {
      this.applyMaster(this.outputBuffer, this.master);
    }

    // Capture master vis (final output). Master is always cheap (the
    // outputBuffer already exists), but we still gate on wantVis so
    // _visData['master'] doesn't leak between broadcasts (otherwise a
    // single broadcast could ship a master that's one frame older than
    // the per-channel vis, which is mildly confusing for debugging).
    if (wantVis) {
      this._visData['master'] = this._extractVis(this.outputBuffer);
    }

    return this.outputBuffer;
  }

  /**
   * Extract vis data from a 6ch buffer (full RGBWAU, 6 bytes per pixel).
   * Returns a copy of the buffer as Uint8Array.
   */
  _extractVis(buf6ch) {
    return new Uint8Array(buf6ch);
  }

  /**
   * Get per-channel and master vis data for streaming to clients.
   * Returns { channels: [{id, rgb: Uint8Array|null}, ...], master: Uint8Array }
   */
  getVisData() {
    return this._visData || {};
  }

  destroy() {
    for (const channel of this.channels) {
      channel.destroy(this.wasmHost);
    }
    // Clean up the hidden deck-swap shadow too — without this an
    // in-flight transition at shutdown would leak its WASM handle.
    if (this._swapChannel && this._swapChannel.handle) {
      try { this.wasmHost.destroy(this._swapChannel.handle); } catch (_) {}
    }
    this._swapChannel = null;
    this._swapTransition = null;
    // Destroy blend handles
    for (const [name, handle] of Object.entries(this.blendHandles)) {
      if (handle) this.wasmHost.destroy(handle);
    }
    this.blendHandles = {};
    this.channels = [];
  }

  getBlendHandle(blendName) {
    if (!blendName) return null;
    if (this.blendHandles[blendName] !== undefined) return this.blendHandles[blendName];
    // Lazy-compile the blend script
    this.blendHandles[blendName] = this._compileBlend(blendName);
    return this.blendHandles[blendName];
  }

  _compileBlend(blendName) {
    if (!this.patternsDir) return null;
    try {
      let blendPath = path.join(this.patternsDir, 'channel_blends', `${blendName}.js`);
      if (!fs.existsSync(blendPath)) {
        blendPath = path.join(this.patternsDir, 'transitions', `${blendName}.js`);
      }
      const code = fs.readFileSync(blendPath, 'utf8');
      const result = this.wasmHost.compile(code);
      if (result.ok) {
        console.log(`[Mixer] Compiled blend script: ${blendName}`);
        return result.handle;
      } else {
        console.warn(`[Mixer] Blend compile failed for ${blendName}: ${result.error}`);
        return null;
      }
    } catch (e) {
      console.warn(`[Mixer] Could not load blend script ${blendName}:`, e.message);
      return null;
    }
  }
}
