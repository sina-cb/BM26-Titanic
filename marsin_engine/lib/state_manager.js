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
    // ── Additive fields (groups + solo wave, WAVE 15, 2026-06) ────────
    // Appended AFTER faderMax/color so earlier on-disk key order is
    // unchanged — an old state file (no mixGroupId/soloSafe) loads and
    // restores to the documented defaults (null / false). mixGroupId:
    // gang-fader group membership pointer (F-group). soloSafe: rig-config
    // never-gated-by-others flag (F-solo). soloedChannelIds is TRANSIENT
    // and deliberately NOT persisted on the channel — it lives on the
    // mixer and is cleared on restart.
    mixGroupId: (typeof ch.mixGroupId === 'string' && ch.mixGroupId.length > 0) ? ch.mixGroupId : null,
    soloSafe: !!ch.soloSafe,
    // ── Additive field (hue shifter wave, 2026-06) ────────────────────
    // Appended AFTER mixGroupId/soloSafe so earlier on-disk key order is
    // unchanged — an old state file (no hue) loads and restores to the
    // documented default (0 = no shift). Per-channel hue rotation in
    // degrees [0,360) (F-hue, docs/39).
    hue: (typeof ch.hue === 'number' && Number.isFinite(ch.hue))
      ? ((ch.hue % 360) + 360) % 360
      : 0,
    // ── Additive field (phase-clock wave, 2026-06) ────────────────────
    // Appended AFTER hue so earlier on-disk key order is unchanged — an
    // old state file (no followsTempo) loads and restores to the documented
    // default (false). Per-channel TAP-TEMPO opt-in (F-phase #4, docs/39):
    // followsTempo channels run at the global tap-tempo multiplier. The
    // TRANSIENT _phaseSeconds accumulator is deliberately NEVER persisted —
    // it is rebuilt from 0 on boot.
    followsTempo: !!ch.followsTempo,
    // ── Additive fields (follow/link wave, round-2 #6, 2026-06) ───────
    // Appended AFTER the phase-clock fields so earlier on-disk key order is
    // unchanged — an old state file (no followLeaderId/followScale) loads and
    // restores to the documented defaults (null = not following; 1.0). Channel
    // FOLLOW/LINK (F-follow, docs/39): the follower tracks the leader's
    // effective level × followScale. followLeaderId is a channel→leader
    // POINTER; if the leader is gone on reload _effFader fails safe (reads 0,
    // never crashes). The TRANSIENT prev-frame effective cache is never
    // persisted — it is rebuilt frame-by-frame from 0 on boot.
    followLeaderId: (typeof ch.followLeaderId === 'string' && ch.followLeaderId.length > 0) ? ch.followLeaderId : null,
    followScale: (typeof ch.followScale === 'number' && Number.isFinite(ch.followScale))
      ? Math.max(0, Math.min(2, ch.followScale))
      : 1.0,
  };
}

// ── MixGroup serialization (WAVE 15) ────────────────────────────────────
// Persists a gang-fader group definition. Group fader/mute/color/name must
// survive an engine restart or every member's mixGroupId pointer would
// dangle on reload. Defensive clamps mirror the runtime setters. Exported
// for the same shape-pinning reason as serializeChannel.
export function serializeMixGroup(g) {
  return {
    id: g.id,
    name: (typeof g.name === 'string') ? g.name : null,
    fader: (typeof g.fader === 'number' && Number.isFinite(g.fader))
      ? Math.max(0, Math.min(1, g.fader))
      : 1.0,
    muted: !!g.muted,
    color: (typeof g.color === 'string') ? g.color : null,
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

  /**
   * Persist `state` to `filename` in the flat `stateDir`, crash-safe.
   *
   * BEST-EFFORT vs STRICT (L5, report _120). The ~80 render-adjacent AUTO-SAVE
   * triggers call this WITHOUT `strict` and MUST stay best-effort: a transient
   * disk blip (EBUSY/disk-full) during an auto-save is logged and swallowed so a
   * momentary write failure can never crash the engine (W1-1's process backstop
   * exits(1) on any surviving throw — a dark ship). This warn-only default is
   * the pre-existing behaviour, byte-unchanged.
   *
   * The EXPLICIT operator save (POST /settings/save-now) passes `{ strict:true }`
   * so the write failure PROPAGATES: the CaptainPad "✓ SAVED" badge reads that
   * endpoint's response, and a swallowed failure here made a failed write report
   * 200 {saved:true} — the badge lied (red-team _115 L5). Strict re-throws so the
   * save-now handler returns an honest non-200. `_writeFileAtomic` already
   * re-throws on failure; strict simply declines to swallow it in this wrapper.
   */
  save(filename, state, { strict = false } = {}) {
    const filePath = path.join(this.stateDir, filename);
    try {
      this._writeFileAtomic(filePath, yaml.dump(state));
    } catch (e) {
      if (strict) throw e;
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
    const raw = this.load('mixer_state.yaml', { master: 1.0, channels: [], patternControls: {}, mixGroups: [] });
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

  /**
   * Engine-wide settings (currently just `autoSave`). Persisted in its OWN
   * per-scene file so the toggle survives even when auto-save is OFF — the
   * setting that GATES the auto-persistence can never live in a file whose
   * writes it gates (that would make "turn auto-save off" un-persistable).
   *
   * DEFAULT autoSave = TRUE (auto-persist on, the pre-feature behaviour).
   * A missing file returns the default. A present-but-malformed `autoSave`
   * (hand-edited junk) coerces to TRUE, not false: the SAFE direction is
   * "keep saving the operator's work", never "silently stop persisting".
   */
  loadSettingsState() {
    const raw = this.load('settings_state.yaml', { autoSave: true });
    return { autoSave: typeof raw.autoSave === 'boolean' ? raw.autoSave : true };
  }

  saveSettingsState(settings) {
    this.save('settings_state.yaml', { autoSave: !!(settings && settings.autoSave) });
  }

  loadGlobalsState() {
    // invert (F-invert, docs/39): persistent global color-invert toggle.
    // Default false = no invert — an old file without the key loads to this
    // documented default.
    const state = this.load('globals_state.yaml', {
      blackout: false, effects: {}, params: {}, dimmers: {},
      invert: false,
    });
    // MIGRATION (2026-07, operator decision): the GLOBAL hue shifter was
    // removed — hue is per-channel only. A persisted `hueShift` from an
    // older session is DISCARDED here (never silently re-applied: it was
    // the invisible whole-rig tint that made every per-channel hue read 0
    // while the output was shifted). One loud log line, then the key is
    // dropped so the next save writes a clean file.
    if (state.hueShift !== undefined) {
      const deg = state.hueShift && typeof state.hueShift.degrees === 'number'
        ? state.hueShift.degrees : state.hueShift;
      console.warn(
        `[StateManager] globals_state.yaml carried a LEGACY global hueShift (degrees=${JSON.stringify(deg)}) — ` +
        'the global hue shifter was removed (hue is per-channel only); discarding it.');
      delete state.hueShift;
    }
    return state;
  }

  /**
   * One-time forward migration (2026-08, dimmer stable keys): persisted
   * per-group dimmer state used to be keyed by NUMERIC section id. Section
   * ids are minted by the simulation's controller registry ("next free id"
   * per group, floored over the DMX ∪ LED union) and are RE-MINTED whenever
   * the operator regenerates the scene/model — which orphaned every saved
   * brightness (the Dimmer Rack fell back to its 1.0 default). Group NAMES
   * are the stable identity across regenerations, so dimmer state is keyed
   * by group name from now on.
   *
   * `groupToSectionId` is the CURRENT model's { groupName: sectionId } map
   * (api_server builds it from model.pixels — same source as
   * GET /dimmer-groups). Rules (codex P0 — loud, never lossy):
   *
   *  - a numeric key whose id maps to a current group is rewritten to that
   *    group's name;
   *  - if the name key ALREADY exists (file half-migrated), the name-keyed
   *    value wins — it is the newer format — and the numeric duplicate is
   *    dropped with a warning;
   *  - a numeric key that maps to NO current group is an ORPHAN: warned
   *    loudly, preserved in the file untouched (never silently deleted or
   *    defaulted);
   *  - a name key unknown to the current model (group renamed/removed in
   *    the scene) is likewise warned and preserved untouched.
   *
   * Mutates `globalsState.dimmers` in place; the next globals save persists
   * the migrated shape (same precedent as the legacy hueShift discard in
   * loadGlobalsState — no forced write, so the auto-save gate is honored).
   * Idempotent: a second run over migrated state changes nothing.
   * Returns { migrated, orphaned } for logging/tests.
   */
  migrateDimmersToGroupKeys(globalsState, groupToSectionId) {
    const result = { migrated: 0, orphaned: [] };
    const dimmers = globalsState && globalsState.dimmers;
    if (!dimmers || typeof dimmers !== 'object') return result;
    const groups = groupToSectionId || {};
    const idToGroup = new Map();
    for (const [name, sId] of Object.entries(groups)) {
      if (!idToGroup.has(sId)) idToGroup.set(sId, name);
    }
    for (const key of Object.keys(dimmers)) {
      if (Object.prototype.hasOwnProperty.call(groups, key)) continue; // already name-keyed
      if (/^\d+$/.test(key)) {
        const name = idToGroup.get(parseInt(key, 10));
        if (name === undefined) {
          result.orphaned.push(key);
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(dimmers, name)) {
          console.warn(
            `[StateManager] dimmers migration: legacy id key '${key}' duplicates group ` +
            `'${name}' — keeping the name-keyed value ${dimmers[name]}, dropping legacy ${dimmers[key]}.`);
        } else {
          dimmers[name] = dimmers[key];
          result.migrated += 1;
        }
        delete dimmers[key];
      } else {
        result.orphaned.push(key);
      }
    }
    if (result.migrated > 0) {
      console.log(
        `[StateManager] dimmer state migrated to stable group-name keys: ` +
        `${result.migrated} entr${result.migrated === 1 ? 'y' : 'ies'} rewritten ` +
        '(persists on the next globals save).');
    }
    if (result.orphaned.length > 0) {
      console.warn(
        `[StateManager] dimmers: ${result.orphaned.length} orphaned key(s) match no group in the ` +
        `loaded model — [${result.orphaned.join(', ')}]. Likely saved against an older model ` +
        'generation (section ids re-minted / group renamed). Preserved on disk untouched; those ' +
        'groups run at the 1.0 default until set again.');
    }
    return result;
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

  /**
   * Persist the v3 global-effect-slots file: the ORDERED named BANKS, the
   * active bank id, and the engine-owned page VIEW (effects_v2). `banks` is the
   * on-disk shape `[{ id, name, slots:[…] }]` (straight from
   * GlobalEffectSlotManager.getBanks()). `effectsPage` is a single top-level
   * field (NOT per-bank).
   *
   *   version: 3
   *   activeBankId: <stable id>
   *   effectsPage: <0..3>
   *   banks: [ { id, name, slots }, … ]   # ordered, >= 1
   */
  saveGlobalEffectSlots({ banks, activeBankId, effectsPage = 0 }) {
    this.save('global_effect_slots.yaml', {
      version: 3,
      activeBankId,
      effectsPage,
      banks,
    });
  }

  applyGlobalsState(globalsState, paramCenter, intensityController, globalEffectsController,
                    groupToSectionId = null) {
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
      // Dimmer state is keyed by STABLE GROUP NAME (see
      // migrateDimmersToGroupKeys); resolve each name to the CURRENT model's
      // section id via `groupToSectionId`. Numeric keys are legacy section
      // ids (pre-migration file, or an old snapshot restored through this
      // same path) — applied verbatim, exactly the pre-fix behaviour: inert
      // when no pixel carries the id. A NAME key with no current mapping
      // (group renamed/removed, or the caller passed no map) is warned and
      // skipped — never silently guessed.
      const groups = groupToSectionId || {};
      for (const [key, bright] of Object.entries(globalsState.dimmers)) {
        if (Object.prototype.hasOwnProperty.call(groups, key)) {
          intensityController.setSectionBrightness(groups[key], bright);
        } else if (/^\d+$/.test(key)) {
          intensityController.setSectionBrightness(parseInt(key, 10), bright);
        } else {
          console.warn(
            `[StateManager] dimmers: group '${key}' is not in the loaded model — ` +
            `brightness ${bright} not applied (state preserved on disk).`);
        }
      }
    }
    // NOTE: the legacy global `hueShift` is NOT restored — the global hue
    // shifter was removed (2026-07, per-channel hue only). loadGlobalsState
    // discards a persisted key with a log line before we ever get here.
    if (globalEffectsController && globalsState.invert !== undefined) {
      // F-invert restore (docs/39): re-apply the persisted global invert
      // toggle through the coercing setter. A missing field stays at the
      // controller's false default (handled by loadGlobalsState's default).
      globalEffectsController.setInvert(globalsState.invert);
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

  saveMixerState(mixer, { strict = false } = {}) {
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
          // Mixer channel PARAMETERS are NEVER persisted (operator ruling,
          // 2026-07 auto-save wave): mixer overlays are ephemeral live
          // tweaks, not saved show state. We emit an EMPTY localControls map
          // (not core.localControls) so a restart restores the channel's
          // playlist-entry defaults only — the on-disk key + its position are
          // preserved for byte-shape compatibility, just always `{}`. The
          // restore path (buildChannelFromSaved) mirrors this by skipping the
          // localControls replay for the mixer role.
          localControls: {},
          playlist: core.playlist,
          viewSelection: core.viewSelection,
          // Additive (channel_features wave): persisted AFTER the existing
          // overlay fields so old files stay loadable. serializeChannel
          // already clamped/typed these — reuse its values verbatim.
          faderMax: core.faderMax,
          color: core.color,
          // Additive (WAVE 15 groups+solo): group membership + solo-safe
          // round-trip so a restart restores the operator's grouping and
          // rig-config. Solo itself is transient (mixer-level, not persisted).
          mixGroupId: core.mixGroupId,
          soloSafe: core.soloSafe,
          // Additive (hue shifter wave): per-channel hue round-trips so a
          // restart restores the operator's recolor. serializeChannel
          // already normalized it — reuse verbatim.
          hue: core.hue,
          // Additive (phase-clock wave): per-channel tap-tempo opt-in round-
          // trips so a restart restores the operator's clock. serializeChannel
          // already coerced it — reuse verbatim. The transient _phaseSeconds
          // accumulator is never persisted.
          followsTempo: core.followsTempo,
          // Additive (follow/link wave, round-2 #6): channel FOLLOW/LINK
          // round-trips so a restart restores the operator's link.
          // serializeChannel already typed/clamped these — reuse verbatim. The
          // transient prev-frame effective cache is never persisted.
          followLeaderId: core.followLeaderId,
          followScale: core.followScale,
        };
      }),
      // Group registry (WAVE 15). Persisted alongside master so member
      // pointers (mixGroupId) resolve on reload. Empty array on a rig with
      // no groups — an old file without this key loads to [] (default).
      mixGroups: Array.isArray(mixer.getMixGroups && mixer.getMixGroups())
        ? mixer.getMixGroups().map(serializeMixGroup)
        : [],
      // Global tap-tempo (phase-clock wave, F-phase #4). Persisted alongside
      // master so a restart restores the operator's tempo; the derived
      // _tempoMultiplier is recomputed from it on boot. null = no tempo set
      // (documented default — an old file without this key loads to null).
      tempoBpm: (typeof mixer.tempoBpm === 'number' && Number.isFinite(mixer.tempoBpm))
        ? mixer.tempoBpm
        : null,
      // STICKY tempo source selector position ('osc' | 'tap'), persisted so a
      // restart restores the operator's choice. Default 'osc' (an old file
      // without this key loads to 'osc').
      tempoSourcePref: mixer.tempoSourcePref === 'tap' ? 'tap' : 'osc',
    };
    this.save('mixer_state.yaml', state, { strict });
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
  saveDeckState(mixer, extras = null, { strict = false } = {}) {
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
    this.save('deck_state.yaml', state, { strict });
  }

  saveGlobalsState(globalsState, paramCenter, { strict = false } = {}) {
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
    this.save('globals_state.yaml', out, { strict });
  }
}
