export class PatternChannel {
  constructor({ id, name, pattern, handle = 0, mode = 'blend_screen', fader = 1.0, enabled = true, locked = false, transitionMode = 'trans_crossfade', transitionTime = 1.0 }) {
    this.id = id;
    this.name = name;
    this.pattern = pattern;
    this.handle = handle;
    this.mode = mode; // 'blend_screen', 'blend_crossfade', 'blend_add', 'blend_over'
    this.fader = fader;
    this.enabled = enabled;
    this.locked = locked;
    this.transitionMode = transitionMode;
    this.transitionTime = transitionTime;
    
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
