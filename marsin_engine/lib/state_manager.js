import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// ── Channel serialization (additive de-dup helper) ──────────────────────
// saveDeckState and saveMixerState both flatten a PatternChannel into the
// on-disk shape. They diverge slightly (the mixer file carries overlay-only
// fields like `transitionMode`/`transitionTime`), so this helper emits the
// COMMON core and each caller layers its extra fields on top. This keeps the
// byte-for-byte on-disk schema identical to the pre-refactor output — the
// fields below are exactly those the engine restores at boot.
//
// Exported (not just internal) so a unit test can pin the serialized shape
// against regressions without reaching into a save path that touches disk.
export function serializeChannel(ch) {
  return {
    id: ch.id,
    name: ch.name,
    pattern: ch.pattern,
    mode: ch.mode,
    fader: ch.fader,
    enabled: ch.enabled,
    // Lock flags (slot 5). `locked` is the mute/solo-style lock; `faderLocked`
    // freezes the fader against scripted transitions. Both round-trip so an
    // engine restart preserves the operator's lock decisions.
    locked: !!ch.locked,
    faderLocked: !!ch.faderLocked,
    localControls: ch.localControls,
    playlist: ch.playlist || null,
    // Per-channel view-selection so the engine boots back into the exact
    // mixer layout the operator left it in (docs/27).
    viewSelection: ch.viewSelection || { type: 'all', target: null, invert: false },
    // ── Additive fields (channel_features wave, 2026-06) ──────────────
    // Appended AFTER viewSelection so the pre-existing on-disk key order is
    // unchanged for all earlier fields — an old state file (no faderMax/
    // color) still loads and restores to the documented defaults (1.0 / null).
    // faderMax: per-channel intensity ceiling (F-C). color: metadata tag (F-D).
    faderMax: (typeof ch.faderMax === 'number' && Number.isFinite(ch.faderMax))
      ? Math.max(0, Math.min(1, ch.faderMax))
      : 1.0,
    color: (typeof ch.color === 'string') ? ch.color : null,
  };
}

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
      this._writeFileAtomic(filePath, yaml.dump(state));
    } catch (e) {
      console.warn(`Failed to save state to ${filename}:`, e);
    }
  }

  /**
   * Crash-safe write: serialize to a sibling temp file, fsync it, then
   * atomically rename over the destination. A crash (or a thrown error)
   * mid-write can leave a stray `.<name>.<pid>.<n>.tmp` behind, but it can
   * NEVER leave a half-written/corrupt `filename` on disk — the previous
   * good file stays intact until the rename swaps in the fully-written one.
   *
   * Rename within the same directory is atomic on POSIX and on NTFS
   * (ReplaceFile semantics via Node's fs.renameSync over an existing file),
   * so a reader either sees the old complete file or the new complete file.
   *
   * The temp file is written into the SAME directory as the destination so
   * the rename never crosses a filesystem boundary (a cross-device rename
   * is not atomic and would fall back to copy+unlink). On any failure we
   * best-effort unlink the temp file and re-throw so the caller's existing
   * try/catch logs it — we do not silently swallow the write error here.
   */
  /**
   * Public crash-safe write for callers that manage their own file paths
   * outside the StateManager's flat `stateDir` (e.g. SnapshotManager, which
   * writes into a `snapshots/` subdirectory). Delegates to the same atomic
   * temp+fsync+rename machinery as save() so snapshots get the identical
   * torn-write guarantee. Re-throws on failure (no silent swallow).
   */
  writeFileAtomic(filePath, data) {
    this._writeFileAtomic(filePath, data);
  }

  _writeFileAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    // Unique temp name: pid + monotonic counter avoids collisions between
    // concurrent saves of different files (and back-to-back saves of the
    // same file) in a single engine process.
    this._tmpCounter = (this._tmpCounter || 0) + 1;
    const tmpPath = path.join(dir, `.${base}.${process.pid}.${this._tmpCounter}.tmp`);
    let fd;
    try {
      fd = fs.openSync(tmpPath, 'w');
      fs.writeSync(fd, data);
      // Flush to the storage device before the rename so a power loss right
      // after the rename can't leave the new inode pointing at empty data.
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch (_) { /* fd already gone */ }
      }
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch (_) { /* best-effort temp cleanup */ }
      throw err;
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
        // Bypass-dimmer flags are session-scoped — never restored from
        // disk. Otherwise the operator's mid-show "bypass dimmer for
        // this one cue" flag leaks into the next session, leading to
        // surprise dimmer-rack-ignored fires when the scheduler (or
        // anyone else) reactivates the effect. The dimmer-rack
        // BypassCheckbox is the live source of truth; if the operator
        // wants bypass at boot they tick it again.
        if (effect.endsWith('BypassDimmer')) continue;
        globalEffectsController.setEffect(effect, state);
      }
    }
    if (intensityController && globalsState.dimmers) {
      for (const [sId, bright] of Object.entries(globalsState.dimmers)) {
        intensityController.setSectionBrightness(parseInt(sId, 10), bright);
      }
    }
    if (globalEffectsController && globalsState.groupFixedColors) {
      // Route through the validating setter so a hand-edited bad YAML
      // entry fails loudly here (caught + logged by the boot caller)
      // instead of silently half-applying (docs/32 §2.5).
      for (const [group, ov] of Object.entries(globalsState.groupFixedColors)) {
        globalEffectsController.setGroupFixedColor(group, ov.color, ov.brightness);
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
      channels: overlays.map((c) => {
        // serializeChannel emits the common core (id..faderLocked,
        // localControls, playlist, viewSelection). The mixer file carries
        // two extra overlay-only fields (transitionMode/transitionTime)
        // and never persists a live trans_* mode (it would re-trigger a
        // scripted blend on reload), so we coerce that here. Key order is
        // preserved byte-for-byte vs the pre-refactor output: the trans_*
        // fields slot between faderLocked and localControls exactly as
        // before.
        const core = serializeChannel(c);
        return {
          id: core.id,
          name: core.name,
          pattern: core.pattern,
          mode: c.mode.startsWith('trans_') ? 'blend_screen' : core.mode,
          fader: core.fader,
          enabled: core.enabled,
          locked: core.locked,
          // Fader-lock (slot 5): independent of `locked`. Persisted so an
          // engine restart preserves the operator's frozen-fader decision.
          faderLocked: core.faderLocked,
          transitionMode: c.transitionMode || 'trans_crossfade',
          transitionTime: c.transitionTime || 1.0,
          localControls: core.localControls,
          playlist: core.playlist,
          viewSelection: core.viewSelection,
          // Additive (channel_features wave): persisted AFTER the existing
          // overlay fields so old files stay loadable. serializeChannel
          // already clamped/typed these — reuse its values verbatim.
          faderMax: core.faderMax,
          color: core.color,
        };
      }),
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
    // The deck file's channel shape is exactly serializeChannel's core
    // (id..faderLocked, localControls, playlist, viewSelection) with no
    // overlay-only extras, so we emit it directly. Byte-compatible with
    // the pre-refactor output, including both lock flags round-tripping.
    const state = {
      channel: serializeChannel(baseCh),
    };
    if (extras && typeof extras === 'object') {
      Object.assign(state, extras);
    }
    this.save('deck_state.yaml', state);
  }

  saveGlobalsState(globalsState, paramCenter) {
    if (paramCenter) globalsState.params = paramCenter.getCanonicalState();
    // Strip session-scoped bypass-dimmer flags before write — they
    // must not survive restarts (see applyGlobalsState for rationale).
    // We clone the effects map so we don't mutate the live in-memory
    // state the operator is currently looking at.
    const out = { ...globalsState };
    if (out.effects && typeof out.effects === 'object') {
      const filtered = {};
      for (const [k, v] of Object.entries(out.effects)) {
        if (k.endsWith('BypassDimmer')) continue;
        filtered[k] = v;
      }
      out.effects = filtered;
    }
    this.save('globals_state.yaml', out);
  }
}
