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

  loadMixerState() {
    return this.load('mixer_state.yaml', { master: 1.0, channels: [], patternControls: {} });
  }

  loadDeckState() {
    return this.load('deck_state.yaml', { channel: null });
  }

  loadGlobalsState() {
    return this.load('globals_state.yaml', { blackout: false, effects: {}, params: {} });
  }

  loadDimmerState() {
    return this.load('dimmer_state.yaml', {});
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
  }

  applyDimmerState(dimmerState, intensityController) {
    if (dimmerState && intensityController) {
      for (const [sId, bright] of Object.entries(dimmerState)) {
        intensityController.setSectionBrightness(parseInt(sId, 10), bright);
      }
    }
  }

  saveMixerState(mixer) {
    const state = {
      master: mixer.master,
      channels: mixer.channels.filter(c => c.id !== mixer.baseChannelId).map(c => ({
        id: c.id,
        name: c.name,
        pattern: c.pattern,
        mode: c.mode,
        fader: c.fader,
        enabled: c.enabled,
        localControls: c.localControls,
        patternCache: c.patternCache || {}
      }))
    };
    this.save('mixer_state.yaml', state);
  }

  saveDeckState(mixer) {
    const baseCh = mixer.getChannel(mixer.baseChannelId);
    if (!baseCh) return;
    const state = {
      channel: {
        id: baseCh.id,
        name: baseCh.name,
        pattern: baseCh.pattern,
        mode: baseCh.mode,
        fader: baseCh.fader,
        enabled: baseCh.enabled,
        localControls: baseCh.localControls,
        patternCache: baseCh.patternCache || {}
      }
    };
    this.save('deck_state.yaml', state);
  }

  saveGlobalsState(globalsState, paramCenter) {
    if (paramCenter) globalsState.params = paramCenter.getCanonicalState();
    this.save('globals_state.yaml', globalsState);
  }

  saveDimmerState(dimmerState) {
    this.save('dimmer_state.yaml', dimmerState);
  }
}
