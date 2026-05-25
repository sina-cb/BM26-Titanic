export class PatternChannel {
  constructor({ id, name, pattern, handle = 0, mode = 'blend_screen', fader = 1.0, enabled = true, locked = false, faderLocked = false, transitionMode = 'trans_crossfade', transitionTime = 1.0, viewSelection = null }) {
    this.id = id;
    this.name = name;
    this.pattern = pattern;
    this.handle = handle;
    this.mode = mode; // 'blend_screen', 'blend_crossfade', 'blend_add', 'blend_over'
    this.fader = fader;
    this.enabled = enabled;
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

  beginFrame(wasmHost, elapsedSeconds, forceRender = false) {
    if ((this.enabled || forceRender) && this.handle) {
      wasmHost.beginFrame(this.handle, elapsedSeconds);
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
