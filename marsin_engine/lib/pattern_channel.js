// Pixelblaze local-control defaults for an UNTOUCHED control (the value the
// physical Pixelblaze UI shows before the operator ever moves it). The WASM
// VM does NOT expose a per-control read-back — `getExports()` returns only
// {id, kind, name} — so these canonical defaults are the ONLY obtainable real
// value for a control that has neither been `setControl`-ed nor had a saved
// playlist default applied. Seeding them (see PatternChannel.seedLocalControlDefaults)
// makes the engine broadcast each slider's REAL starting value instead of
// dropping it, which is what keeps MIDI knob indices aligned with on-screen
// slider order (docs/34 §#1). Kinds:
//   1 = slider   → 0.5 (Pixelblaze slider midpoint default)
//   2 = toggle   → 0.0 (off)
//   6 = hsvPicker → h:0, s:1, v:1 (Pixelblaze color-picker default)
// Kind 3 (trigger) is momentary and carries NO persistent value, so it is
// intentionally NOT seeded (mirrors PlaylistManager.captureDefaults, which
// only persists kinds {1,2,6}).
const PIXELBLAZE_SEEDABLE_KINDS = new Set([1, 2, 6]);
const PIXELBLAZE_SLIDER_DEFAULT = 0.5;

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

  /**
   * Seed `localControls` with the Pixelblaze default for every local-control
   * export that has NOT already been given a value (via setControl or a
   * restored saved default). Call this ONCE at pattern load — after the
   * handle is installed and beginFrame(0) has run — and BEFORE
   * applyEntryDefaults, so a saved default cleanly overrides the seed.
   *
   * Root fix for docs/34 §#1: the serializer only attaches `v0` to an export
   * when `localControls[id]` exists. Without seeding, an untouched slider on
   * an entry with no saved default broadcasts NO v0 and the client drops it
   * from the knob-mapped list, throwing MIDI knob indices off-by-k. We APPLY
   * the default to the VM too (not just record it) so the broadcast value is
   * the TRUE running value, never a fabricated one.
   *
   * Fails loud (throws) if a seedable export somehow has no resolvable
   * default — there is no silent 0.5 fallback for an unknown kind.
   *
   * @param {WasmHost} wasmHost
   * @returns {number} count of exports newly seeded
   */
  seedLocalControlDefaults(wasmHost) {
    if (!this.handle) return 0;
    const exports = wasmHost.getExports(this.handle) || [];
    let seeded = 0;
    for (const exp of exports) {
      if (!PIXELBLAZE_SEEDABLE_KINDS.has(exp.kind)) continue;
      if (this.localControls[exp.id]) continue; // already has a live value
      let v0, v1, v2;
      if (exp.kind === 6) {
        v0 = 0.0; v1 = 1.0; v2 = 1.0; // hsvPicker: h=0, s=1, v=1
      } else if (exp.kind === 1) {
        v0 = PIXELBLAZE_SLIDER_DEFAULT; v1 = 0.0; v2 = 0.0;
      } else if (exp.kind === 2) {
        v0 = 0.0; v1 = 0.0; v2 = 0.0; // toggle: off
      } else {
        // Unreachable given PIXELBLAZE_SEEDABLE_KINDS, but fail loud rather
        // than silently seed a bogus value (Codex P0: no fallback behavior).
        throw new Error(
          `seedLocalControlDefaults: no default for export '${exp.name}' (id ${exp.id}, kind ${exp.kind})`,
        );
      }
      this.setControl(wasmHost, exp.id, v0, v1, v2);
      seeded++;
    }
    return seeded;
  }

  destroy(wasmHost) {
    if (this.handle) {
      wasmHost.destroy(this.handle);
      this.handle = 0;
    }
  }
}
