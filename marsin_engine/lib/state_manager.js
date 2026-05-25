import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export class StateManager {
  constructor(stateDir) {
    this.stateDir = stateDir;
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  load(filename, defaultState) {
    const filePath = path.join(this.stateDir, filename);
    try {
      if (fs.existsSync(filePath)) {
        return yaml.load(fs.readFileSync(filePath, 'utf8')) || defaultState;
      }
    } catch (err) {
      console.warn(`Failed to load state from ${filename}:`, err);
    }
    return defaultState;
  }

  save(filename, state) {
    const filePath = path.join(this.stateDir, filename);
    try {
      fs.writeFileSync(filePath, yaml.dump(state));
    } catch (e) {
      console.warn(`Failed to save state to ${filename}:`, e);
    }
  }

  /**
   * Load mixer (overlay-only) state.
   *
   * Migration (May 2026): pre-channel-split files might have stored the
   * deck channel in `mixer_state.yaml.channels[0]` because the previous
   * `PatternMixer` kept a single `channels[]` array. We detect that
   * shape and split it out so the deck channel is loaded from
   * `deck_state.yaml` (canonical) instead of leaking into the mixer
   * overlay stack.
   *
   * The migration is one-way (we emit a one-time log so the operator
   * knows it happened) and idempotent: subsequent boots that re-read
   * the already-split files don't trigger it.
   */
  loadMixerState() {
    const raw = this.load('mixer_state.yaml', { master: 1.0, channels: [], patternControls: {} });
    if (!Array.isArray(raw.channels) || raw.channels.length === 0) return raw;

    // Heuristic: in the legacy combined format the first channel was
    // ALWAYS the deck (id starts with `ch_base`). Newer split files
    // never contain such an entry — saveMixerState filters them out.
    const first = raw.channels[0];
    if (first && typeof first.id === 'string' && first.id.startsWith('ch_base')) {
      console.warn(`[StateManager] mixer_state.yaml contained legacy deck entry '${first.id}' — splitting it out. Future saves will write deck_state.yaml only.`);
      raw.channels = raw.channels.slice(1);
    }
    return raw;
  }

  loadDeckState() {
    return this.load('deck_state.yaml', { channel: null });
  }

  loadGlobalsState() {
    return this.load('globals_state.yaml', { blackout: false, effects: {}, params: {}, dimmers: {} });
  }

  /**
   * Global Effect Macro slot bindings (docs/28 §4.3).
   * Returns `null` when the file is missing so the caller can fall
   * back to the in-memory default config. Returning `null` rather
   * than a fake default keeps the "no slot references a future
   * effect" rule enforced at boot — the default config lives in code,
   * not on disk.
   */
  loadGlobalEffectSlots() {
    const filePath = path.join(this.stateDir, 'global_effect_slots.yaml');
    if (!fs.existsSync(filePath)) return null;
    try {
      return yaml.load(fs.readFileSync(filePath, 'utf8')) || null;
    } catch (err) {
      console.warn('Failed to load global_effect_slots.yaml:', err);
      return null;
    }
  }

  saveGlobalEffectSlots(slotsConfig) {
    this.save('global_effect_slots.yaml', { slots: slotsConfig });
  }

  applyGlobalsState(globalsState, paramCenter, intensityController, globalEffectsController) {
    if (paramCenter && globalsState.params) {
      // The saved canonical state is { revision, sourceLock, params: { speed: { value }, ... } }
      const paramData = globalsState.params.params || globalsState.params;
      for (const k in paramData) {
        const entry = paramData[k];
        // Extract the .value from canonical { value, lastSource, ... } wrappers
        const val = (entry && typeof entry === 'object' && entry.value !== undefined) ? entry.value : entry;
        paramCenter.set(k, val, 'init');
      }
    }
    if (intensityController && globalsState.blackout !== undefined) {
      intensityController.setBlackout(globalsState.blackout);
    }
    if (globalEffectsController && globalsState.effects) {
      for (const [effect, state] of Object.entries(globalsState.effects)) {
        globalEffectsController.setEffect(effect, state);
      }
    }
    if (intensityController && globalsState.dimmers) {
      for (const [sId, bright] of Object.entries(globalsState.dimmers)) {
        intensityController.setSectionBrightness(parseInt(sId, 10), bright);
      }
    }
  }

  saveMixerState(mixer) {
    // Mixer state file contains ONLY overlay channels. The deck channel
    // lives in deck_state.yaml — they are persisted separately, just as
    // they are owned separately at runtime. See the channel-split note
    // in pattern_mixer.js for context.
    const overlays = typeof mixer.getMixerChannels === 'function'
      ? mixer.getMixerChannels()
      : mixer.channels.filter(c => c.id !== mixer.baseChannelId);
    const state = {
      master: mixer.master,
      channels: overlays.map(c => ({
        id: c.id,
        name: c.name,
        pattern: c.pattern,
        mode: c.mode.startsWith('trans_') ? 'blend_screen' : c.mode,
        fader: c.fader,
        enabled: c.enabled,
        locked: !!c.locked,
        // Fader-lock (slot 5): independent of `locked`. Persisted so an
        // engine restart preserves the operator's frozen-fader
        // decision. See PatternChannel.faderLocked for semantics.
        faderLocked: !!c.faderLocked,
        transitionMode: c.transitionMode || 'trans_crossfade',
        transitionTime: c.transitionTime || 1.0,
        localControls: c.localControls,
        playlist: c.playlist || null,
        // Persist the per-channel view-selection so the engine boots
        // back into the exact mixer layout the operator left it in.
        // See docs/27_[todo]_mixer_layer_view_selection.md.
        viewSelection: c.viewSelection || { type: 'all', target: null, invert: false }
      }))
    };
    this.save('mixer_state.yaml', state);
  }

  /**
   * @param mixer            The PatternMixer instance
   * @param extras           Optional extra top-level fields to persist
   *                         alongside `channel:` (e.g. transitionConfig).
   *                         Lets api_server keep deck-wide UI prefs in the
   *                         same file as the deck's base channel without
   *                         adding new YAML files for one-shot operator
   *                         settings.
   */
  saveDeckState(mixer, extras = null) {
    const baseCh = typeof mixer.getDeckChannel === 'function'
      ? mixer.getDeckChannel()
      : mixer.getChannel(mixer.baseChannelId);
    if (!baseCh) return;
    const state = {
      channel: {
        id: baseCh.id,
        name: baseCh.name,
        pattern: baseCh.pattern,
        mode: baseCh.mode,
        fader: baseCh.fader,
        enabled: baseCh.enabled,
        // Lock flags (slot 5): mirror the mixer-side persistence so
        // the deck channel also survives restart in the same lock
        // state. `locked` was previously omitted from the deck save
        // path; including it alongside `faderLocked` so both round-
        // trip cleanly.
        locked: !!baseCh.locked,
        faderLocked: !!baseCh.faderLocked,
        localControls: baseCh.localControls,
        playlist: baseCh.playlist || null,
        viewSelection: baseCh.viewSelection || { type: 'all', target: null, invert: false }
      }
    };
    if (extras && typeof extras === 'object') {
      Object.assign(state, extras);
    }
    this.save('deck_state.yaml', state);
  }

  saveGlobalsState(globalsState, paramCenter) {
    if (paramCenter) globalsState.params = paramCenter.getCanonicalState();
    this.save('globals_state.yaml', globalsState);
  }
}
