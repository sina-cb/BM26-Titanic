import { PatternChannel } from './pattern_channel.js';
import fs from 'fs';
import path from 'path';

// ── View-selection masking ─────────────────────────────────────────────
// See docs/27_[todo]_mixer_layer_view_selection.md §4.
//
// `compileViewSelectionMask` turns the per-channel viewSelection config
// into a fast Uint8Array lookup: mask[i] === 1 means "this channel's
// output may be committed to pixel i", 0 means "ignore". We return null
// as the cheap-path sentinel meaning "ALL pixels selected", so the hot
// render loop can short-circuit the per-pixel check entirely.
//
// IMPORTANT: callers MUST validate viewSelection shape (see
// validateViewSelection in api_server.js) before passing it in here.
// This function does not throw on bad shapes — it logs and returns null
// (fall back to ALL) so the render loop never hangs on a malformed
// config, but the upstream API path should refuse the write so the
// operator sees the error immediately.
//
// `viewMasks` (optional) is the model's named-view-mask dictionary:
//   [{ name: 'MainShow', bit: 2 }, ...]
// When viewSelection.type === 'viewMask' and target is a string, we
// resolve the bit by name lookup. If target is a positive integer the
// legacy bitmask path is used (also handy when no named dictionary is
// available, e.g. in unit tests). An unresolvable name produces a
// fully-zero mask (no pixels selected) rather than falling back to ALL
// — masking nothing would be the silent black-out that §3.1 calls out
// against. The API validator should have caught the name typo upstream.
export function compileViewSelectionMask({ pixels, pixelCount, viewSelection, viewMasks = [] }) {
  if (!viewSelection || viewSelection.type === 'all') return null;
  if (!Array.isArray(pixels) || pixels.length === 0) return null;

  const mask = new Uint8Array(pixelCount);
  const target = viewSelection.target;
  const invert = !!viewSelection.invert;

  // Resolve a viewMask string target (e.g. 'MainShow') to its bit value
  // BEFORE entering the per-pixel loop so the hot path stays integer-only.
  // A missing name resolves to 0 — the mask will be all-zero for the
  // selected region (or all-one inverted), which is visibly wrong and
  // therefore catches typos at smoke-check time instead of hiding them.
  let resolvedViewMaskBit = null;
  if (viewSelection.type === 'viewMask') {
    if (typeof target === 'number' && Number.isInteger(target)) {
      resolvedViewMaskBit = target;
    } else if (typeof target === 'string') {
      const entry = Array.isArray(viewMasks)
        ? viewMasks.find(vm => vm && vm.name === target)
        : null;
      if (!entry) {
        console.warn(`[PatternMixer] Unknown viewMask name '${target}' — no pixels will match. ` +
          `Known viewMasks: [${(viewMasks || []).map(v => v && v.name).filter(Boolean).join(', ')}]`);
      }
      resolvedViewMaskBit = entry && Number.isInteger(entry.bit) ? entry.bit : 0;
    } else {
      console.warn(`[PatternMixer] viewMask target must be string or integer, got ${typeof target}`);
      resolvedViewMaskBit = 0;
    }
  }

  for (let i = 0; i < pixelCount; i++) {
    const px = pixels[i] || {};
    let match = false;
    switch (viewSelection.type) {
      case 'group':
        match = px.group === target;
        break;
      case 'section': {
        const sectionId = px.sId ?? px.sectionId;
        match = sectionId === target;
        break;
      }
      case 'fixture': {
        const fixtureId = px.fId ?? px.fixtureId;
        match = fixtureId === target;
        break;
      }
      case 'viewMask': {
        const viewMask = px.vMask ?? px.viewMask ?? 0;
        match = resolvedViewMaskBit !== 0 && (viewMask & resolvedViewMaskBit) !== 0;
        break;
      }
      default:
        // Unknown type: surface noise once and treat as ALL so we never
        // silently mask the whole rig to black. The API validator should
        // have caught this; if we got here something is wrong upstream.
        console.warn(`[PatternMixer] Unknown viewSelection type '${viewSelection.type}'; treating as ALL`);
        return null;
    }
    mask[i] = invert ? (match ? 0 : 1) : (match ? 1 : 0);
  }
  return mask;
}

// Copy one 6ch pixel (RGBWAU) from src into dst at the given index.
// Inlined-by-hand on purpose — V8 won't inline through Uint8Array views
// reliably at 40 Hz × ~50–5000 pixel counts, and a tight 6-byte copy
// avoids the overhead of Uint8Array.prototype.set sliced views.
function copyPixel6(dst, src, pixelIndex) {
  const o = pixelIndex * 6;
  dst[o + 0] = src[o + 0];
  dst[o + 1] = src[o + 1];
  dst[o + 2] = src[o + 2];
  dst[o + 3] = src[o + 3];
  dst[o + 4] = src[o + 4];
  dst[o + 5] = src[o + 5];
}

// Commit a blended-layer result onto mixerBuffer ONLY at selected pixels.
// The unselected pixels keep whatever the previous layer painted, which
// is the whole point of view-selection: it lets a sparkle pattern on
// CH2 (masked to "Wall") overlay on top of a bioluminescence wash on
// the base channel without zeroing out the rest of the ship.
function commitBlendedLayerWithMask(mixerBuffer, blendedBuffer, pixelMask, pixelCount) {
  if (!pixelMask) {
    // Fast path: "all pixels selected" — straight buffer set, no per-pixel
    // branch. This is also the only path when viewSelection.type === 'all'.
    mixerBuffer.set(blendedBuffer);
    return;
  }
  for (let i = 0; i < pixelCount; i++) {
    if (pixelMask[i]) copyPixel6(mixerBuffer, blendedBuffer, i);
  }
}

// Zero out unselected pixels in the deck/PFL preview buffer. PFL is a
// strict "show me what THIS channel covers" view, so unselected pixels
// must read as black. (Mixer overlays do the opposite — they preserve
// the background; see commitBlendedLayerWithMask above.)
function applyPreviewMaskBlackout(buffer, pixelMask, pixelCount) {
  if (!pixelMask) return;
  for (let i = 0; i < pixelCount; i++) {
    if (!pixelMask[i]) {
      const o = i * 6;
      buffer[o + 0] = 0;
      buffer[o + 1] = 0;
      buffer[o + 2] = 0;
      buffer[o + 3] = 0;
      buffer[o + 4] = 0;
      buffer[o + 5] = 0;
    }
  }
}

export class PatternMixer {
  constructor({ wasmHost, pixelCount, maxChannels, pixels = [], viewMasks = [] }) {
    this.wasmHost = wasmHost;
    this.pixelCount = pixelCount;
    // ── Channel split (May 2026) ─────────────────────────────────────
    // Pre-split: a single `this.channels[]` held the deck channel at
    // index 0 followed by the mixer overlays. That coupling caused
    // a continuous stream of bugs where mixer-side code paths leaked
    // the deck channel into the mixer view (and vice versa) every
    // time someone forgot to filter on `baseChannelId`.
    //
    // Post-split: the deck channel and the mixer overlay stack are
    // explicitly separate fields with their own APIs:
    //
    //   - `deckChannel` (singleton) — the PFL preview channel that
    //     drives the deck buffer. Owned by /deck/* routes.
    //   - `mixerChannels[]` — the live composition stack. Owned by
    //     /mixer/* routes.
    //
    // Compatibility getters (`channels`, `baseChannelId`) are kept
    // around so legacy iteration / vis code keeps working while we
    // migrate call sites. The legacy `addChannel`/`removeChannel`/
    // `getChannel` facades route to the correct collection based on
    // current state (first add becomes the deck channel; later adds
    // become mixer channels) so internal callers don't break.
    this.deckChannel = null;
    this.mixerChannels = [];
    this.master = 1.0;
    this.deckFocusChannelId = null; // When set, deck view renders this channel instead of the deck channel
    // maxChannels comes from config.yaml `mixer.maxChannels`. Default 3 — the
    // CaptainPad iPad strip layout doesn't fit more than that without
    // horizontal scroll / clipping. Caps `mixerChannels.length` only —
    // the deck channel does NOT count toward this limit, since it is
    // owned by a separate route tree.
    this.maxChannels = Number.isFinite(maxChannels) && maxChannels >= 1
      ? Math.floor(maxChannels)
      : 3;

    // Model pixel mapping reference. Required for view-selection mask
    // compilation. Guarded by an alignment check: if pixels[i].i is set,
    // it MUST equal i. Out-of-order or missing indices would silently
    // mis-map the mask and paint the wrong fixtures, so we fail loudly
    // at boot rather than at first paint. See docs/27 §5 "Rigorous
    // Index Validation".
    this.pixels = Array.isArray(pixels) ? pixels : [];
    if (this.pixels.length > 0) {
      if (this.pixels.length !== this.pixelCount) {
        throw new Error(`[PatternMixer] pixels length (${this.pixels.length}) must match pixelCount (${this.pixelCount})`);
      }
      for (let i = 0; i < this.pixels.length; i++) {
        const idx = this.pixels[i] && this.pixels[i].i;
        if (idx !== undefined && idx !== i) {
          throw new Error(`[PatternMixer] Model pixel index alignment corrupted: pixels[${i}].i = ${idx}, expected ${i}`);
        }
      }
    }

    // Named view-mask dictionary from the active model:
    //   [{ name: 'MainShow', bit: 2 }, ...]
    // Used by compileViewSelectionMask to resolve viewSelection
    // { type: 'viewMask', target: '<name>' } payloads to their bit
    // value at mask-compile time. Empty array is fine — the engine
    // just won't enumerate any named view masks in
    // /model/view-selection-options and the picker will hide that
    // section in CaptainPad. Validation is defensive: drops entries
    // missing a string name or integer bit instead of throwing, so a
    // model author typo doesn't block boot.
    this.viewMasks = Array.isArray(viewMasks)
      ? viewMasks.filter(vm => vm && typeof vm.name === 'string' && vm.name.length > 0 && Number.isInteger(vm.bit))
      : [];

    // View crossfade state (0.0 = deck exclusively, 1.0 = mixer exclusively).
    // Default to mixer view per docs/27 §2 — at engine startup the live output
    // is the composed mixerBuffer; the CaptainPad Deck tab POSTs view='deck'
    // to crossfade down to the PFL preview.
    this.viewFader = 1.0;
    this.targetViewFader = 1.0;
    // Time-based crossfade ramp (units per second). 1.0/s = a full
    // deck↔mixer swap in 1 second, matching the iPad operator's
    // mental model when they swipe between tabs (May 2026 task 5).
    // Frame-rate independent so changing config.fps doesn't break
    // the perceived ramp duration.
    this.viewFaderRampPerSec = 1.0;
    this._lastViewFaderTickMs = null;

    // Buffer for compositing output
    this.outputBuffer = new Uint8Array(this.pixelCount * 6);
    // Buffer for individual channel output
    this.channelBuffer = new Uint8Array(this.pixelCount * 6);
    // Reusable scratch buffer for view-selection masked layer commits.
    // Pre-allocated once here so the 40 Hz render loop never triggers
    // GC for new Uint8Arrays. `blendedScratch` holds the result of a
    // host-side blend fallback (or a WASM blend copy if we ever needed
    // to mutate it). See docs/27 §4.2.
    this.blendedScratch = new Uint8Array(this.pixelCount * 6);
    
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

    // ── Deck pattern-swap state (ping-pong handle warm-keeper) ──────────
    // The deck renders one pattern at a time, but to get a SMOOTH switch
    // from pattern A to pattern B we need both running simultaneously
    // for the duration of the transition. The operator's mental model
    // (May 2026):
    //
    //   "the deck has 2 channels, 1 active, 1 inactive.
    //    on selecting a new pattern, we set the pattern in the inactive
    //    channel to the newly selected pattern. we transition from active
    //    to inactive channel with the settings we have for the transition
    //    and the transition mode selected. we swap the active inactive
    //    pointers."
    //
    // Implementation: `deckChannel` is the PERSISTENT ACTIVE deck channel
    // (the IDENTITY container — id, localControls, playlist, viewSelection
    // all live here forever). `_inactiveDeckChannel` is a hidden sibling
    // PatternChannel whose sole job is to keep a SECOND WASM handle warm —
    // it lives OUTSIDE this.channels / mixerChannels so it doesn't show
    // up in /mixer or count toward maxChannels. Each frame, the inactive
    // sibling is ticked (beginFrame) so its pattern stays time-synced
    // with the active. During a swap it composites ON TOP of deckBuffer
    // via its `fader` (driven by `_swapTransition`) and its `mode`
    // (a trans_* blend script, or steady blend_screen for a crossfade).
    //
    // On swap completion we SWAP HANDLES (not pointers) — `deckChannel`
    // keeps its id and all its operator-visible state intact; only its
    // `.handle` and `.pattern` get rebound to the newly-active pattern.
    // The OLD active handle moves into the inactive slot for warmth, so
    // a ping-pong back to the previous pattern is a zero-compile reuse.
    // The previous design (`_swapChannel`) allocated a fresh PatternChannel
    // + compiled a fresh WASM handle + destroyed both on EVERY swap,
    // making A→B→A→B fade latency dominated by recompile time.
    //
    // Handle reuse contract: callers (api_server.loadPlaylistEntryWith
    // Transition) MUST check `getInactiveDeckPattern()` BEFORE
    // compiling — if the inactive slot already holds the requested
    // pattern name (typical for ping-pong), they pass `newHandle: null`
    // to triggerDeckPatternSwap and the existing warm handle is reused.
    // If the inactive slot is empty or holds a different pattern, the
    // caller compiles a fresh handle, the old inactive handle (if any)
    // gets destroyed, and the new handle takes over the inactive slot.
    this._inactiveDeckChannel = null;
    this._swapTransition = null;
    this.onDeckSwapComplete = null; // Callback: ({ pattern, transitionId }) => void
  }

  // ── Channel split: canonical accessors ─────────────────────────────
  // Use these. `channels`/`addChannel`/`removeChannel`/`getChannel`
  // are kept below as compatibility facades for legacy code paths.

  /** Compatibility getter: deck id (or null). Replaces the old field. */
  get baseChannelId() {
    return this.deckChannel ? this.deckChannel.id : null;
  }
  set baseChannelId(id) {
    // The only legitimate legacy writer is updateTransitions promoting
    // a transitioned overlay onto the deck. If `id` already names the
    // deck channel this is a no-op. Otherwise we re-home the matching
    // mixer overlay onto the deck slot — that's what the pre-split
    // behaviour did.
    if (!id || (this.deckChannel && this.deckChannel.id === id)) return;
    const idx = this.mixerChannels.findIndex(c => c.id === id);
    if (idx === -1) {
      console.warn(`[Mixer] baseChannelId set to '${id}' which is neither deck nor a mixer channel; ignoring`);
      return;
    }
    const promoted = this.mixerChannels.splice(idx, 1)[0];
    const demoted = this.deckChannel;
    this.deckChannel = promoted;
    if (demoted) {
      // Demote the old deck back into the mixer stack so we don't lose
      // its handle. Operators who hit this path are mid-transition.
      this.mixerChannels.unshift(demoted);
    }
  }

  /**
   * Compatibility getter: combined view of [deckChannel, ...mixerChannels].
   * Internal rendering / vis code reads this. External callers should
   * prefer `getDeckChannel()` + `getMixerChannels()` so the deck-vs-
   * mixer intent is explicit at the call site.
   */
  get channels() {
    if (this.deckChannel) return [this.deckChannel, ...this.mixerChannels];
    return [...this.mixerChannels];
  }

  /** Direct accessor for the deck channel (or null). */
  getDeckChannel() {
    return this.deckChannel;
  }

  /** Returns the LIVE mixer overlay array. Do not mutate; use add/remove APIs. */
  getMixerChannels() {
    return this.mixerChannels;
  }

  /** Get a mixer overlay by id. Rejects the deck channel id explicitly. */
  getMixerChannel(channelId) {
    if (this.deckChannel && channelId === this.deckChannel.id) return null;
    return this.mixerChannels.find(c => c.id === channelId);
  }

  /**
   * Install (or replace) the deck channel. The deck does NOT count
   * toward `maxChannels`. If a deck channel already exists, the caller
   * is responsible for destroying its WASM handle BEFORE invoking this
   * — the mixer doesn't free it for them, because most callers want
   * to keep using the same handle and only swap metadata.
   */
  setDeckChannel(channelConfig) {
    const channel = new PatternChannel(channelConfig);
    this.deckChannel = channel;
    // Compile the initial view-selection mask. The default
    // {type:'all'} compiles to null (full-rig fast path), so the
    // common case stays zero-cost.
    this.recompileChannelMask(channel);
    return channel;
  }

  /**
   * Recompile a channel's view-selection mask from its current
   * `channel.viewSelection`. Call this whenever viewSelection is set
   * or replaced — the API handler (PATCH /mixer/channels/:id and
   * PATCH /deck/channel) does this when an operator changes the
   * channel's view selection.
   *
   * Cheap: O(pixelCount) once at config time. The 40 Hz render loop
   * only reads `channel.compiledPixelMask` and never recomputes.
   */
  recompileChannelMask(channel) {
    if (!channel) return;
    channel.compiledPixelMask = compileViewSelectionMask({
      pixels: this.pixels,
      pixelCount: this.pixelCount,
      viewSelection: channel.viewSelection,
      viewMasks: this.viewMasks,
    });
  }

  /**
   * Replace a channel's view selection and recompile its mask. Returns
   * true on success, false on unknown channel id. The viewSelection
   * shape MUST be pre-validated by the API layer (validateViewSelection
   * in api_server.js) before reaching this method. Works for both the
   * deck channel and any mixer overlay.
   */
  setChannelViewSelection(channelId, viewSelection) {
    const channel = this.getChannel(channelId);
    if (!channel) return false;
    channel.viewSelection = viewSelection || { type: 'all', target: null, invert: false };
    this.recompileChannelMask(channel);
    return true;
  }

  /**
   * Add a mixer overlay. Throws if the cap is reached. Refuses to use
   * the deck channel's id (defensive — the API layer should be enforcing
   * this, but the mixer enforces it too so a buggy callsite can't sneak
   * a duplicate id through). Also compiles the channel's initial
   * view-selection mask so the render loop can apply it on the first
   * frame.
   */
  addMixerChannel(channelConfig) {
    if (this.mixerChannels.length >= this.maxChannels) {
      throw new Error(`Maximum of ${this.maxChannels} mixer channels allowed`);
    }
    if (this.deckChannel && channelConfig && channelConfig.id === this.deckChannel.id) {
      throw new Error(`Channel id '${channelConfig.id}' is reserved for the deck channel`);
    }
    const channel = new PatternChannel(channelConfig);
    this.mixerChannels.push(channel);
    this.recompileChannelMask(channel);
    return channel;
  }

  /** Remove a mixer overlay by id. Returns true iff something was removed. */
  removeMixerChannel(channelId) {
    if (this.deckChannel && channelId === this.deckChannel.id) {
      console.warn(`[Mixer] refusing to remove deck channel via removeMixerChannel('${channelId}')`);
      return false;
    }
    const index = this.mixerChannels.findIndex(c => c.id === channelId);
    if (index === -1) return false;
    const channel = this.mixerChannels[index];
    if (this.onChannelRemoved) this.onChannelRemoved(channelId);
    channel.destroy(this.wasmHost);
    this.mixerChannels.splice(index, 1);
    return true;
  }

  /** Destroy the deck channel's WASM handle and clear the slot.
   *  Also tears down the inactive deck sibling (its handle would
   *  otherwise be orphaned — nothing else holds a reference to it). */
  removeDeckChannel() {
    if (!this.deckChannel) return false;
    const id = this.deckChannel.id;
    if (this.onChannelRemoved) this.onChannelRemoved(id);
    this.deckChannel.destroy(this.wasmHost);
    this.deckChannel = null;
    // Cancel any in-flight swap and tear down the warm inactive — once
    // there is no active deck, the inactive has nothing to ping-pong
    // back to. Caller (engine.js boot reload, /deck/channel replace)
    // will install a fresh deck via setDeckChannel + first swap.
    this._swapTransition = null;
    if (this._inactiveDeckChannel && this._inactiveDeckChannel.handle) {
      try { this.wasmHost.destroy(this._inactiveDeckChannel.handle); } catch (_) {}
    }
    this._inactiveDeckChannel = null;
    return true;
  }

  // ── Legacy facades ─────────────────────────────────────────────────
  // Existing code paths (api_server.js, engine.js boot, HIL tests)
  // call these. They route by current state: first add becomes the
  // deck channel; subsequent adds become mixer channels. Look up by
  // id checks both collections.

  getChannel(channelId) {
    if (this.deckChannel && this.deckChannel.id === channelId) return this.deckChannel;
    return this.mixerChannels.find(c => c.id === channelId);
  }

  addChannel(channelConfig) {
    if (!this.deckChannel) {
      return this.setDeckChannel(channelConfig);
    }
    return this.addMixerChannel(channelConfig);
  }

  removeChannel(channelId) {
    if (this.deckChannel && this.deckChannel.id === channelId) {
      this.removeDeckChannel();
      // Pre-split behaviour: when the deck went away we promoted the
      // first remaining overlay onto the deck slot. Preserve that so
      // legacy callers that do `removeChannel(baseChannelId)` and then
      // expect a new base to exist still work.
      if (this.mixerChannels.length > 0) {
        const promoted = this.mixerChannels.shift();
        this.deckChannel = promoted;
      }
      return;
    }
    this.removeMixerChannel(channelId);
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

    // Fader-lock: a fader-locked channel's value is frozen against
    // scripted transitions. Refuse to schedule the fade — the caller
    // (typically triggerMixerTransition) should skip the channel
    // upstream so the transition group accounting stays consistent,
    // but this is the final belt-and-suspenders guarantee that no
    // server-side animation can ever drive a locked fader. See the
    // PatternChannel.faderLocked docstring for the full semantics.
    if (channel.faderLocked) return false;

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
    // Mixer transitions only affect the overlay stack — the deck
    // channel is never touched (this is enforced both here and by the
    // /mixer routes that reject deck-channel ids upstream).
    const overlays = this.mixerChannels;
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
      // Fader-lock: skip locked channels entirely. We do NOT force-
      // enable them, do NOT touch their fader, and do NOT schedule a
      // fade. This implements the "transitions don't affect this
      // layer" rule literally — a locked channel keeps whatever fader
      // value the operator parked it at, regardless of what the rest
      // of the mix is doing. The transition group accounting still
      // works because fadeChannel() is never invoked for this id.
      // Note: this applies even if `c.id === targetChannelId`. If the
      // operator picks a locked channel as a transition target, the
      // transition for everyone else still runs, but the locked
      // target's fader stays put. Pattern content swaps (which go
      // through loadPlaylistEntry) are still permitted — only the
      // fader value is frozen.
      if (c.faderLocked) continue;

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
   * Returns the pattern name currently held in the inactive deck slot,
   * or null if there isn't one. The api_server calls this BEFORE
   * compiling a new handle on a deck-swap request — if the inactive
   * slot already holds the requested pattern (the typical "ping-pong"
   * case where the operator just toggled B→A and is now toggling back
   * A→B, leaving the previous A handle warm in the inactive slot), the
   * caller skips the compile entirely and passes `newHandle: null` to
   * `triggerDeckPatternSwap` so the warm handle is reused.
   */
  getInactiveDeckPattern() {
    return this._inactiveDeckChannel ? this._inactiveDeckChannel.pattern : null;
  }

  /**
   * Returns the live inactive deck channel (or null). Internal helper
   * used by the api_server to apply per-entry defaults and pre-register
   * CPC against the inactive handle BEFORE the fade lands. Do not
   * mutate from outside the mixer.
   */
  getInactiveDeckChannel() {
    return this._inactiveDeckChannel;
  }

  /**
   * Soft-swap the deck active channel's pattern using a ping-pong
   * inactive sibling.
   *
   * Concept (see also `_inactiveDeckChannel` docstring in the constructor):
   *   1. Install the next pattern into the inactive deck channel. Either
   *      reuse the existing warm handle (when caller signals
   *      `newHandle:null` + `getInactiveDeckPattern() === patternName`)
   *      or replace it with the caller's freshly compiled `newHandle`,
   *      destroying whatever the inactive slot previously held.
   *   2. A server-side fader transition ramps the inactive channel
   *      from 0 → 1 with the chosen `transitionMode` (a `trans_*`
   *      blend script — see patterns/transitions/*.js). During the
   *      ramp, `renderAll6ch()` composites the inactive channel ON
   *      TOP of the deck buffer using that blend script, so the
   *      visual effect (crossfade, flash, dissolve, wipe, etc.) plays
   *      out smoothly.
   *   3. On completion, the WASM HANDLES SWAP. `deckChannel` keeps its
   *      id / playlist / localControls / viewSelection intact — only
   *      its `.handle` and `.pattern` get rebound to the newly-active
   *      pattern. The OLD active handle moves into the inactive slot
   *      for warmth — a ping-pong back to the previous pattern is a
   *      zero-compile reuse. From the operator's POV the deck now
   *      "is" the new pattern, with no visible glitch.
   *
   * Why we don't reuse `triggerMixerTransition`:
   *   - That routine fades EVERY overlay (winners up, losers down),
   *     which would clobber any user-added mixer overlays on the deck
   *     swap path. Worse, the deck active is explicitly excluded from
   *     that fade. We need a single dedicated target that lives outside
   *     `this.channels` to keep mixer state untouched.
   *
   * Caller contract:
   *   - When `newHandle` is non-null, ownership transfers to the mixer.
   *     Whether the swap succeeds, falls back, or is replaced by
   *     another swap mid-flight, the mixer is responsible for
   *     destroying it (avoids the caller having to track a
   *     half-installed handle).
   *   - When `newHandle` is null, the caller is asserting that the
   *     warm inactive handle already represents `patternName` — the
   *     mixer verifies this and refuses the swap if it can't.
   *   - `onComplete` fires AFTER the handle swap — i.e. once
   *     `deckChannel.handle` is the new active. The api_server uses
   *     it to re-register CPC, apply entry defaults, save state, and
   *     broadcast — all the bookkeeping that `loadPlaylistEntry`
   *     would normally do synchronously.
   *
   * @param {Object} opts
   * @param {Object|null} opts.newHandle   Compiled WASM handle, or null
   *   to reuse the warm inactive handle (caller pre-checked
   *   `getInactiveDeckPattern() === patternName`).
   * @param {string} opts.patternName      Pattern name (for channel.pattern)
   * @param {number} [opts.durationMs=1000]
   * @param {string} [opts.transitionMode='trans_crossfade']
   * @param {string} [opts.steadyMode='blend_screen'] Blend mode used during a
   *   crossfade transition (when transitionMode === 'trans_crossfade'). Has
   *   no effect for scripted transitions because the script IS the blend.
   * @param {Function} [opts.onComplete]   Called once the swap completes
   * @returns {string|null}  Transition id, or null if swap was rejected.
   */
  triggerDeckPatternSwap({
    newHandle = null,
    patternName,
    durationMs = 1000,
    transitionMode = 'trans_crossfade',
    steadyMode = 'blend_screen',
    onComplete = null,
  } = {}) {
    if (!this.deckChannel) {
      // No active deck to swap onto — refuse and destroy the incoming
      // handle so the caller doesn't leak the freshly compiled VM.
      if (newHandle) {
        try { this.wasmHost.destroy(newHandle); } catch (_) {}
      }
      return null;
    }

    // Reuse-vs-replace path on the inactive slot:
    //
    //   newHandle=null  → caller asserts the warm inactive already IS
    //                     patternName. Verify; refuse if mismatched.
    //   newHandle set   → take ownership. If inactive already exists,
    //                     destroy its handle and re-bind to newHandle.
    if (!newHandle) {
      if (!this._inactiveDeckChannel || this._inactiveDeckChannel.pattern !== patternName) {
        console.warn(`[Mixer] triggerDeckPatternSwap(newHandle:null) requested for '${patternName}' ` +
          `but inactive deck slot holds '${this._inactiveDeckChannel?.pattern ?? 'nothing'}'. Refusing.`);
        return null;
      }
      // Reuse path: nothing to install. _inactiveDeckChannel already
      // has the right handle + pattern. Just reset its render state.
    }

    // If a prior swap is mid-flight, drop the in-flight transition
    // BEFORE re-binding the inactive slot. Operator spamming pattern
    // picks must always converge on the LAST pick — the new pick takes
    // over the inactive slot. We deliberately keep the inactive channel
    // object alive; its handle will be replaced below if newHandle is
    // non-null.
    if (this._swapTransition) {
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
    const inactiveMode = useScripted ? resolved : steadyMode;

    if (newHandle) {
      // Replace path. Re-bind inactive to the freshly compiled handle.
      if (this._inactiveDeckChannel) {
        // Free the OLD warm handle — caller is bringing a different
        // pattern. Guard against double-free if the same handle pointer
        // somehow flowed through twice.
        const oldHandle = this._inactiveDeckChannel.handle;
        if (oldHandle && oldHandle !== newHandle) {
          try { this.wasmHost.destroy(oldHandle); } catch (_) {}
        }
        this._inactiveDeckChannel.handle = newHandle;
        this._inactiveDeckChannel.pattern = patternName;
      } else {
        // First-ever swap: allocate the inactive sibling. Persistent
        // for the engine's lifetime — subsequent swaps just rebind
        // .handle / .pattern in place.
        this._inactiveDeckChannel = new PatternChannel({
          id: '__deck_inactive__',
          name: 'Deck Inactive',
          pattern: patternName,
          handle: newHandle,
          mode: inactiveMode,
          enabled: true,
        });
        this._inactiveDeckChannel._hidden = true;
      }
    }

    // Set up the transition. Anchor fader at 0.002 so the blend script
    // runs on the very first tick (above the 0.001 render skip
    // threshold; otherwise the first ~25 ms would skip compositing
    // and produce a visible "pop").
    this._inactiveDeckChannel.mode = inactiveMode;
    this._inactiveDeckChannel.fader = 0.002;
    this._inactiveDeckChannel.enabled = true;
    // Defensive: ensure pattern name is in sync (reuse path passes
    // newHandle=null but the caller still tells us the patternName).
    this._inactiveDeckChannel.pattern = patternName;

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
   * Cancel any in-flight deck swap. Does NOT destroy the inactive
   * handle (the inactive slot is persistent across swaps) — just drops
   * the in-flight transition and parks the inactive fader at 0.
   * Useful when the operator triggers a new swap before the previous
   * one has landed, or when the engine shuts down mid-fade.
   */
  cancelDeckPatternSwap() {
    if (!this._swapTransition) return false;
    this._swapTransition = null;
    if (this._inactiveDeckChannel) {
      // Reset render state so a stale fader doesn't leak into the next
      // render frame.
      this._inactiveDeckChannel.fader = 0;
    }
    return true;
  }

  /**
   * True iff a deck pattern swap is currently animating. Used by the
   * API layer to refuse new manual taps (the operator asked for taps
   * during an in-flight swap to be IGNORED, not queued) and to short-
   * circuit redundant "finish now" calls.
   */
  isDeckSwapInFlight() {
    return !!(this._swapTransition && this._inactiveDeckChannel);
  }

  /**
   * Force the current deck swap to land NOW: jumps the fader to 1.0,
   * runs the same atomic handle swap + onComplete callback that
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
    // handle swap, onComplete callback, scriptedTransitionTargetId
    // cleanup if applicable — without us reimplementing it here and
    // drifting from the normal flow.
    this._swapTransition.startTime = performance.now() - this._swapTransition.durationMs - 1;
    this.updateDeckSwapTransition(performance.now());
    return true;
  }

  /**
   * Tick the deck-swap transition one frame. Called from beginFrame().
   * Handles fader ramp, ATOMIC HANDLE SWAP on completion, and the
   * `onComplete` callback.
   *
   * Handle-swap semantics: on completion, the WASM handles inside
   * `deckChannel` and `_inactiveDeckChannel` SWAP. The persistent deck
   * identity (`deckChannel.id`, `.localControls`, `.playlist`, etc.) is
   * preserved — only `.handle` and `.pattern` change. The OLD active
   * handle moves into the inactive slot, where it stays warm (advanced
   * each frame via beginFrame() with fader=0) so a ping-pong back to
   * the previous pattern can reuse it without paying the WASM compile
   * cost. The old `_swapChannel` design freed the previous handle on
   * every swap; this design keeps it alive in the inactive slot until
   * the NEXT swap brings a different pattern.
   *
   * Why not swap whole channel POINTERS (operator's literal phrasing)?
   * `deckChannel` is the IDENTITY container — id, playlist state,
   * localControls, viewSelection. Swapping the pointer would change
   * the deck's id under the API layer's feet and orphan
   * localControls/playlist on the demoted sibling. The handle swap
   * gives the operator the same end-result (warm second pattern, no
   * recompile on ping-pong) while preserving identity.
   */
  updateDeckSwapTransition(now = performance.now()) {
    if (!this._swapTransition || !this._inactiveDeckChannel) return;
    const t = this._swapTransition;
    const elapsed = now - t.startTime;
    let linear = t.durationMs > 0 ? elapsed / t.durationMs : 1;
    if (linear >= 1) linear = 1;
    // Same smoothstep ease as updateTransitions for visual consistency.
    const eased = linear * linear * (3 - 2 * linear);
    this._inactiveDeckChannel.fader = t.startFader + (t.targetFader - t.startFader) * eased;

    if (linear >= 1) {
      // Snap exactly so floating-point drift can't strand us at 0.9999.
      this._inactiveDeckChannel.fader = 1.0;
      const base = this.deckChannel;
      const inactiveCh = this._inactiveDeckChannel;
      const finishedId = t.id;
      const finishedCb = t.onComplete;
      const finishedPattern = inactiveCh.pattern;

      // Atomic HANDLE SWAP. `deckChannel` keeps its id / playlist /
      // localControls / viewSelection intact — only its .handle and
      // .pattern get rebound to the newly-active pattern. The old
      // active handle moves into the inactive slot for warmth (so a
      // ping-pong back is a zero-compile reuse). No handle gets
      // destroyed here — both stay alive across the swap.
      const newActiveHandle = inactiveCh.handle;
      const newActivePattern = inactiveCh.pattern;
      const oldActiveHandle = base.handle;
      const oldActivePattern = base.pattern;

      // Promote on the base channel object.
      base.handle = newActiveHandle;
      base.pattern = newActivePattern;
      // Demote into the warm inactive slot. Fader resets to 0 so we
      // don't paint into deckBuffer outside of an active transition.
      inactiveCh.handle = oldActiveHandle;
      inactiveCh.pattern = oldActivePattern;
      inactiveCh.fader = 0;

      // Clear in-flight bookkeeping BEFORE the onComplete callback so
      // a re-entrant trigger inside the callback sees a clean state.
      this._swapTransition = null;

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
          // Re-home a mixer overlay onto the deck slot — see
          // `set baseChannelId` for the migration semantics.
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
    // Tick both deck and mixer overlays — muted patterns still need to
    // advance their internal time so vis previews stay live.
    if (this.deckChannel) this.deckChannel.beginFrame(this.wasmHost, elapsedSeconds, true);
    for (const channel of this.mixerChannels) {
      channel.beginFrame(this.wasmHost, elapsedSeconds, true);
    }
    // Tick the inactive deck sibling too so its pattern stays warm —
    // its time advances alongside the active channel even when its
    // fader is 0. This is what makes ping-pong "smoothness" work: the
    // moment we promote it, its pattern is already on the same time
    // base as the active. Without this, the new pattern would freeze
    // at its first frame whenever it wasn't being faded in.
    if (this._inactiveDeckChannel && this._inactiveDeckChannel.handle) {
      this._inactiveDeckChannel.beginFrame(this.wasmHost, elapsedSeconds, true);
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

    // Smooth view crossfade (0 = deck, 1 = mixer). Time-based ramp so
    // the perceived duration stays at viewFaderRampPerSec regardless
    // of the engine's render fps. dt is clamped so a frame stall
    // (GC pause, sACN backpressure) doesn't fast-forward the fade.
    {
      const nowMs = Date.now();
      const last = this._lastViewFaderTickMs;
      this._lastViewFaderTickMs = nowMs;
      if (this.viewFader !== this.targetViewFader && last !== null) {
        const dt = Math.max(0, Math.min(0.25, (nowMs - last) / 1000));
        const step = this.viewFaderRampPerSec * dt;
        if (this.viewFader < this.targetViewFader) {
          this.viewFader = Math.min(this.targetViewFader, this.viewFader + step);
        } else {
          this.viewFader = Math.max(this.targetViewFader, this.viewFader - step);
        }
      }
    }

    // 1. Render ALL channels for vis data (every channel always gets fresh
    //    vis on vis-broadcast frames). Skipped on non-broadcast frames per
    //    the OPTIMIZATION note above.
    if (wantVis) {
      if (this.deckChannel) {
        this.channelBuffer.fill(0);
        this.deckChannel.renderInto(this.wasmHost, this.channelBuffer, true);
        this._visData[this.deckChannel.id] = this._extractVis(this.channelBuffer);
      }
      for (const channel of this.mixerChannels) {
        this.channelBuffer.fill(0);
        channel.renderInto(this.wasmHost, this.channelBuffer, true);
        this._visData[channel.id] = this._extractVis(this.channelBuffer);
      }
    }

    // 2. Render Deck (focused channel or deck channel → deckBuffer)
    //
    // `deckFocusChannelId` is a debug/preview affordance — if set, the
    // deck buffer renders THAT channel instead of the canonical deck
    // channel. It can reference EITHER a mixer overlay or the deck
    // itself; getChannel() handles both. With nothing set, we render
    // the deck channel as PFL (Pre-Fade Listen, always 100%).
    const deck = this.deckFocusChannelId
      ? this.getChannel(this.deckFocusChannelId)
      : this.deckChannel;
    if (deck) {
      this.channelBuffer.fill(0);
      deck.renderInto(this.wasmHost, this.deckBuffer, true);

      // View-selection blackout for the deck preview. PFL means "show
      // me exactly what THIS channel covers" — unselected pixels go
      // black so the operator can see at a glance which fixtures the
      // channel will affect. (Live mixer overlays do the opposite —
      // they preserve the background; see the mixer compositing loop.)
      // See docs/27 §2 / §4.2 applyPreviewMaskBlackout.
      if (deck.compiledPixelMask) {
        applyPreviewMaskBlackout(this.deckBuffer, deck.compiledPixelMask, this.pixelCount);
      }
    }

    // 2b. Deck pattern-swap inactive sibling — composite ON TOP of
    // deck buffer using the inactive channel's blend mode + fader.
    // Only runs while a deck swap transition is in flight; outside of
    // a transition the inactive's fader sits at 0 and the cheap-skip
    // gate below prevents any render work. The mixer compositing loop
    // below does NOT see the inactive deck channel because it lives
    // outside `mixerChannels`.
    if (this._inactiveDeckChannel && this._inactiveDeckChannel.handle && this._inactiveDeckChannel.fader > 0.001) {
      this.channelBuffer.fill(0);
      this._inactiveDeckChannel.renderInto(this.wasmHost, this.channelBuffer, true);
      // Operator review May 2026 #15 — TRANSITION END FLICKER.
      // For the default 'trans_crossfade' path (steadyMode='blend_screen')
      // the OLD pattern (deckBuffer) was always rendered at full
      // strength and the NEW pattern (channelBuffer) was screen-blended
      // on top scaled by fader. As fader → 1 the visible output is
      // `1 - (1-old)*(1-new)` — OLD still contributes at the last
      // mid-transition frame. Then handle-swap fires on the next
      // beginFrame() and the renderer cuts to `deckBuffer = new
      // pattern alone`. That's the visible "pop" at the tail.
      //
      // Fix: in the LAST ~3% of the transition force a direct replace
      // (deckBuffer := channelBuffer). The new pattern is already at
      // full opacity, so this is visually identical to the screen-
      // blended version EXCEPT without the old pattern's residual
      // contribution. Post-swap renders are pixel-identical to this
      // tail window — zero discontinuity.
      const TAIL_REPLACE_THRESHOLD = 0.97;
      if (this._inactiveDeckChannel.fader >= TAIL_REPLACE_THRESHOLD) {
        this.deckBuffer.set(this.channelBuffer);
      } else {
        const blendHandle = this.getBlendHandle(this._inactiveDeckChannel.mode);
        if (blendHandle) {
          const result = this.wasmHost.renderBlend6ch(
            blendHandle, this.pixelCount,
            this.deckBuffer, this.channelBuffer, this._inactiveDeckChannel.fader
          );
          this.deckBuffer.set(result);
        } else {
          // Last-resort linear crossfade if the blend script can't load.
          // Keeps the swap visible-but-ugly rather than invisible.
          const f = this._inactiveDeckChannel.fader;
          const iv = 1 - f;
          for (let i = 0; i < this.deckBuffer.length; i++) {
            this.deckBuffer[i] = Math.round(this.deckBuffer[i] * iv + this.channelBuffer[i] * f);
          }
        }
      }
      // Expose the inactive channel's vis under a stable id so anyone
      // debugging can see what's coming next. Backward-compat alias
      // '__deck_swap__' kept for any consumer that pinned the old
      // name; the canonical id is '__deck_inactive__'. Only on
      // vis-broadcast frames — see the OPTIMIZATION note in the
      // pre-pass section.
      if (wantVis) {
        const vis = this._extractVis(this.channelBuffer);
        this._visData['__deck_inactive__'] = vis;
        this._visData['__deck_swap__'] = vis;
      }
    }

    // 3. Render Mixer layers (all enabled mixer overlays, composited
    //    bottom-to-top → mixerBuffer). The deck channel is NEVER part
    //    of this loop — it lives in `this.deckChannel`, outside the
    //    overlay stack. That structural separation is what makes the
    //    deck-vs-mixer isolation bulletproof: there's no `if (id ===
    //    baseChannelId) continue` to forget anymore.
    //
    //    Per-channel view-selection masking still applies inside the
    //    overlay loop: `channel.compiledPixelMask` is consulted by
    //    `commitBlendedLayerWithMask` so an overlay restricted to a
    //    section/group/fixture keeps the rest of mixerBuffer untouched.
    //
    // When a scripted transition is in flight, promote the target
    // channel to render LAST. Its `mode` has been temporarily swapped
    // to a trans_* blend script (e.g. trans_flash) whose visual must
    // overlay every other (fading-out) overlay. Without this promotion,
    // a loser later in the mixerChannels[] array would composite ON TOP
    // of the flash and obscure it. The natural order is restored as
    // soon as the transition completes (scriptedTransitionTargetId is
    // cleared in updateTransitions).
    let renderOrder = this.mixerChannels;
    if (this.scriptedTransitionTargetId) {
      const tid = this.scriptedTransitionTargetId;
      const idx = this.mixerChannels.findIndex(c => c.id === tid);
      if (idx !== -1 && idx !== this.mixerChannels.length - 1) {
        renderOrder = [...this.mixerChannels.filter(c => c.id !== tid), this.mixerChannels[idx]];
      }
    }

    for (const channel of renderOrder) {
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

      // Re-render into channelBuffer for blend compositing.
      this.channelBuffer.fill(0);
      channel.renderInto(this.wasmHost, this.channelBuffer, true);

      // Blend (mixerBuffer + channelBuffer) → blended. We blend the
      // WHOLE buffer (no mask) so the blend mode sees the existing
      // background on unselected pixels too — this matters when the
      // blend mode is `multiply` or anything else that depends on the
      // bg value. The mask is applied at COMMIT time, not blend time;
      // unselected pixels of the blended result are discarded and the
      // existing mixerBuffer (background) is preserved.
      let blended;
      const blendHandle = this.getBlendHandle(channel.mode);
      if (blendHandle) {
        blended = this.wasmHost.renderBlend6ch(
          blendHandle, this.pixelCount,
          this.mixerBuffer, this.channelBuffer, channel.fader
        );
      } else {
        // Fallback: lerp(bg, fg, fader) into the pre-allocated scratch
        // buffer (no GC allocation). Mirrors the math the WASM
        // blend_normal script would produce so unknown blends still
        // composite sanely.
        blended = this.blendedScratch;
        for (let i = 0; i < blended.length; i++) {
          blended[i] = Math.round(this.mixerBuffer[i] + (this.channelBuffer[i] - this.mixerBuffer[i]) * channel.fader);
        }
      }

      commitBlendedLayerWithMask(this.mixerBuffer, blended, channel.compiledPixelMask, this.pixelCount);
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
    if (this.deckChannel) this.deckChannel.destroy(this.wasmHost);
    for (const channel of this.mixerChannels) {
      channel.destroy(this.wasmHost);
    }
    // Clean up the hidden inactive deck sibling too — without this a
    // warm inactive handle (kept alive across normal swap completions
    // for ping-pong reuse) would leak at engine shutdown.
    if (this._inactiveDeckChannel && this._inactiveDeckChannel.handle) {
      try { this.wasmHost.destroy(this._inactiveDeckChannel.handle); } catch (_) {}
    }
    this._inactiveDeckChannel = null;
    this._swapTransition = null;
    // Destroy blend handles
    for (const [name, handle] of Object.entries(this.blendHandles)) {
      if (handle) this.wasmHost.destroy(handle);
    }
    this.blendHandles = {};
    this.deckChannel = null;
    this.mixerChannels = [];
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
