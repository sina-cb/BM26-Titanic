import { AudioBindings } from './audio_bindings.js';
import {
  GlobalEffectSlotManager,
  DEFAULT_SLOT_CONFIG,
  resolveSlotBinding,
} from './global_effect_slot_manager.js';
import { GlobalEffectsController } from './global_effects_controller.js';
import { GLOBAL_EFFECT_LIBRARY } from './global_effect_library.js';
import { LiveTouchOverlayPattern } from './live_touch_overlay_pattern.js';
import { ParamCenter } from './param_center.js';

const OWNER_HEADER = 'x-touch-control-owner';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MAX_PREPARE_OPERATIONS = 128;
const PREPARE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Performance is action-only, so the browser cannot safely construct this
// layout on ARM. These are the approved Live Touch keys (slots 9..24) and are
// session-private: they never replace the global Deck/VSN1 bank or persist to
// disk. Effect identity, label, and behavior come from the executable catalog
// and fail at module load if the catalog no longer provides a listed key.
const LIVE_TOUCH_PERFORMANCE_BINDINGS = Object.freeze([
  ['movementTrace', 'pulse_slow_fade'],
  ['movementTrace', 'every_other_repeat'],
  ['movementTrace', 'every_other_reverse'],
  ['movementTrace', 'every_other_two_tone'],
  ['movementTrace', 'one_per_color_repeat'],
  ['movementTrace', 'one_per_color_reverse'],
  ['movementTrace', 'one_per_color_double'],
  ['movementTrace', 'whole_group_repeat'],
  ['movementTrace', 'whole_group_reverse'],
  ['strobe', 'sync_4hz'],
  ['beatPump', 'soft'],
  ['breath', 'calm'],
  ['feedbackTrails', 'soft_afterimage'],
  ['feedbackTrails', 'ghost_ship'],
  ['waterlineSweep', 'shadow_pass'],
  ['freeze', 'hold'],
]);

export function buildLiveTouchPerformanceSlots(library = GLOBAL_EFFECT_LIBRARY) {
  const sessionSlots = DEFAULT_SLOT_CONFIG
    .filter(slot => slot.slotId < 9 || slot.slotId > 24)
    .map(slot => ({ ...slot, paramsOverride: { ...(slot.paramsOverride || {}) } }));
  const keys = LIVE_TOUCH_PERFORMANCE_BINDINGS.map(([effectId, presetId], index) => {
    const effect = library[effectId];
    const preset = effect && effect.presets && effect.presets[presetId];
    if (!effect || !preset || typeof preset.defaultBehavior !== 'string') {
      throw new Error(
        `Live Touch Performance seed requires catalog binding '${effectId}|${presetId}'`,
      );
    }
    if (!effect.behaviorTypes.includes(preset.defaultBehavior)) {
      throw new Error(
        `Live Touch Performance seed '${effectId}|${presetId}' has unsupported `
          + `default behavior '${preset.defaultBehavior}'`,
      );
    }
    return {
      slotId: index + 9,
      enabled: true,
      label: preset.label,
      effectId,
      presetId,
      behavior: preset.defaultBehavior,
      // Palette-follow and browser-specific overrides are configuration. The
      // action-only Performance seed intentionally uses only catalog params.
      paramsOverride: {},
    };
  });
  return [...sessionSlots, ...keys].sort((a, b) => a.slotId - b.slotId);
}

export const LIVE_TOUCH_PERFORMANCE_SLOT_CONFIG = Object.freeze(
  buildLiveTouchPerformanceSlots().map(slot => Object.freeze({
    ...slot,
    paramsOverride: Object.freeze({ ...slot.paramsOverride }),
  })),
);

const ROUTED_EXACT_PATHS = new Set([
  '/param-center',
  '/param-center/schema',
  '/effect-groups',
  '/parked-groups',
  '/group-fixed-colors',
  '/spatial-paint',
  '/strobe-rate',
  '/movement-rate',
  '/global-effect',
  '/global-effect-slots',
  '/global-effect-slots/status',
  '/global-effects/disable-all',
  '/audio-bindings',
  '/audio-bindings/clear',
  '/globals',
  '/mixer',
  '/mixer/tempo',
  '/mixer/tempo/source',
  '/layers/live_touch/palette',
]);

/**
 * Owner-scoped, in-memory creative state for the Live Touch setting.
 *
 * The public HTTP paths intentionally stay compatible with the existing
 * control surface. api_server delegates an owner-tagged request here before
 * its durable/global handlers. Consequently Live can use the familiar CPC,
 * GEM, paint and audio APIs without touching Deck/Mixer state or any state
 * file. Untagged requests still reach the durable controllers.
 */
export class LiveTouchSessionContext {
  constructor({ mixer, wasmHost, model, fps = 40, paramCenterOptions = {} }) {
    if (!mixer || !wasmHost || !model || !Array.isArray(model.pixels)) {
      throw new Error('LiveTouchSessionContext requires mixer, wasmHost and model pixels');
    }
    this.mixer = mixer;
    this.wasmHost = wasmHost;
    this.model = model;
    this.fps = fps;
    this.paramCenterOptions = paramCenterOptions;
    this.ownerId = null;
    this.revision = 0;
    this._replaceTransientState();
  }

  _replaceTransientState({ performanceModeActive = false } = {}) {
    this.effectsController = new GlobalEffectsController({
      engine: { fps: this.fps },
      modelPixelCount: this.model.pixels.length,
    });
    this.effectsController.initFromModel(this.model.specialEffects || this.model.pixels);
    this.slotManager = new GlobalEffectSlotManager(
      this.effectsController,
      performanceModeActive ? LIVE_TOUCH_PERFORMANCE_SLOT_CONFIG : DEFAULT_SLOT_CONFIG,
    );
    this.performanceModeActive = performanceModeActive;
    this.audioBindings = new AudioBindings();
    this.effectsController.audioBindings = this.audioBindings;
    this.paramCenter = new ParamCenter(null, this.paramCenterOptions);
    this.colorPalette = null;
    this.overlayPattern = new LiveTouchOverlayPattern(this.model.pixels, {
      getTwoColorPalette: () => [
        this.paramCenter.get('colorPalette1'),
        this.paramCenter.get('colorPalette2'),
      ],
    });
    this.paramRouter = null;
    this.tempoBpm = 120;
    this.tempoSourcePref = 'manual';
  }

  begin(ownerId, sharedParamCenter, {
    applyToLiveChannel = true,
    performanceModeActive = false,
  } = {}) {
    assertOwnerId(ownerId);
    if (this.ownerId && this.ownerId !== ownerId) {
      throw new Error(`Live Touch session is already owned by '${this.ownerId}'`);
    }
    if (this.ownerId === ownerId) return this.syncPerformanceMode(performanceModeActive);

    this._replaceTransientState({ performanceModeActive });
    this.ownerId = ownerId;
    this.revision++;
    this.tempoBpm = typeof this.mixer.tempoBpm === 'number'
      && Number.isFinite(this.mixer.tempoBpm)
      ? this.mixer.tempoBpm
      : 120;
    this.tempoSourcePref = this.mixer.tempoSourcePref === 'osc' ? 'osc' : 'manual';

    // Begin from the look the operator was already viewing, but only in this
    // private store. Live writes never fan back into the shared CPC and this
    // ParamCenter has no saveHook/state path.
    if (sharedParamCenter) {
      const snapshot = sharedParamCenter.getAll();
      const writes = Object.entries(snapshot).map(([key, value]) => ({
        kind: 'scalar', key, value,
      }));
      this.paramCenter.setMany(writes, 'live_touch_seed', ownerId);
    }

    const live = this.mixer.getLiveTouchChannel();
    if (live && live.handle) this.registerLiveChannel(live, { apply: applyToLiveChannel });
    return this.getState();
  }

  /** Reseed only the transient action bank when the engine mode changes. */
  syncPerformanceMode(active) {
    if (typeof active !== 'boolean') {
      throw new Error('Live Touch Performance mode must be a boolean');
    }
    if (!this.ownerId) {
      throw new Error('Live Touch Performance mode sync requires an active owner session');
    }
    if (this.performanceModeActive === active) return this.getState();

    const replacement = new GlobalEffectSlotManager(
      this.effectsController,
      active ? LIVE_TOUCH_PERFORMANCE_SLOT_CONFIG : DEFAULT_SLOT_CONFIG,
    );
    const actionNowMs = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    this.slotManager.disableAll({ nowMs: actionNowMs });
    this.overlayPattern.dispatch({
      slotId: this.overlayPattern.selectedSlotId,
      presetId: this.overlayPattern.presetId,
      params: this.overlayPattern.params || {},
      action: 'deactivate',
      behavior: 'toggle',
      nowMs: actionNowMs,
    });
    this.slotManager = replacement;
    this.performanceModeActive = active;
    this.revision += 1;
    return this.getState();
  }

  end(ownerId) {
    if (!this.ownerId) return false;
    if (ownerId !== this.ownerId) {
      throw new Error(`Live Touch session is owned by '${this.ownerId}', not '${ownerId}'`);
    }
    this.ownerId = null;
    this.revision++;
    this._replaceTransientState();
    return true;
  }

  /** Refresh model-derived fixture metadata without replacing Live state. */
  refreshModel(model) {
    if (!model || !Array.isArray(model.pixels)) {
      throw new Error('Live Touch model refresh requires model pixels');
    }
    this.model = model;
    this.effectsController.initFromModel(model.specialEffects || model.pixels);
    this.overlayPattern.setModelPixels(model.pixels);
  }

  getState() {
    return {
      ownerId: this.ownerId,
      revision: this.revision,
      active: this.ownerId !== null,
      performanceModeActive: this.performanceModeActive,
      tempoBpm: this.tempoBpm,
      tempoSourcePref: this.tempoSourcePref,
    };
  }

  notePatternStaged() {
    if (this.ownerId) this.revision += 1;
    return this.getState();
  }

  /**
   * Validate a complete owner-scoped Live look against a private candidate.
   * No current Live controller or WASM value is mutated. The caller may run
   * additional authority validation (brightness revision, etc.) before the
   * matching commit, giving the HTTP prepare route all-or-nothing semantics.
   */
  buildPreparedReplacement(ownerId, operations, dependencies = {}) {
    assertOwnerId(ownerId);
    if (this.ownerId !== ownerId) {
      throw prepareError(`Live Touch session is owned by '${this.ownerId}'`, -1);
    }
    if (!Array.isArray(operations) || operations.length === 0
        || operations.length > MAX_PREPARE_OPERATIONS) {
      throw prepareError(
        `operations must contain 1..${MAX_PREPARE_OPERATIONS} mutating requests`,
        -1,
      );
    }
    const live = this.mixer.getLiveTouchChannel();
    if (!live || !live.handle) {
      throw prepareError('Live Touch has no staged pattern', -1, 'LIVE_TOUCH_NOT_READY');
    }

    const candidate = new LiveTouchSessionContext({
      mixer: this.mixer,
      wasmHost: this.wasmHost,
      model: this.model,
      fps: this.fps,
      paramCenterOptions: this.paramCenterOptions,
    });
    candidate.begin(ownerId, this.paramCenter, {
      applyToLiveChannel: false,
      performanceModeActive: dependencies.performanceModeActive === true,
    });
    candidate.tempoBpm = this.tempoBpm;
    candidate.tempoSourcePref = this.tempoSourcePref;
    if (this.colorPalette) candidate.setPalette(this.colorPalette);
    const localControls = [];

    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index];
      try {
        validatePrepareOperation(operation);
        if (operation.path === '/layers/live_touch/control') {
          if (operation.method !== 'POST') {
            throw new Error('/layers/live_touch/control prepare operation must use POST');
          }
          const body = operation.body || {};
          const control = normalizePreparedControl(candidate, live, body);
          localControls.push(control);
          continue;
        }
        candidate._applyPreparedHttpOperation(operation, dependencies);
      } catch (error) {
        const preparedError = prepareError(
          `operation ${index} ${operation && operation.method} `
            + `${operation && operation.path} failed: ${error.message}`,
          index,
          error && error.code ? error.code : undefined,
        );
        if (Number.isInteger(error && error.status)) preparedError.status = error.status;
        throw preparedError;
      }
    }
    return { candidate, localControls, operationCount: operations.length, ownerId };
  }

  commitPreparedReplacement(ownerId, prepared) {
    if (this.ownerId !== ownerId || !prepared || prepared.ownerId !== ownerId) {
      throw new Error('Live Touch prepare owner changed before commit');
    }
    const live = this.mixer.getLiveTouchChannel();
    if (!live || !live.handle) {
      throw new Error('Live Touch staged pattern disappeared before commit');
    }

    const candidate = prepared.candidate;
    const previous = {
      effectsController: this.effectsController,
      slotManager: this.slotManager,
      audioBindings: this.audioBindings,
      paramCenter: this.paramCenter,
      paramRouter: this.paramRouter,
      tempoBpm: this.tempoBpm,
      tempoSourcePref: this.tempoSourcePref,
      colorPalette: this.colorPalette,
      overlayPattern: this.overlayPattern,
      performanceModeActive: this.performanceModeActive,
      revision: this.revision,
      localControls: Object.fromEntries(
        Object.entries(live.localControls || {}).map(([id, values]) => [id, { ...values }]),
      ),
    };

    try {
      this.effectsController = candidate.effectsController;
      this.slotManager = candidate.slotManager;
      this.audioBindings = candidate.audioBindings;
      this.paramCenter = candidate.paramCenter;
      this.paramRouter = candidate.paramRouter;
      this.tempoBpm = candidate.tempoBpm;
      this.tempoSourcePref = candidate.tempoSourcePref;
      this.colorPalette = candidate.colorPalette;
      this.overlayPattern = candidate.overlayPattern;
      this.performanceModeActive = candidate.performanceModeActive;

      // One event-loop turn is the transaction boundary. Apply the complete
      // CPC snapshot and then pattern-local controls before a render timer can
      // run. Revision advances only after every WASM write succeeds.
      this.paramCenter.applySnapshot(this.wasmHost);
      for (const control of prepared.localControls) {
        live.setControl(
          this.wasmHost,
          control.id,
          control.v0,
          control.v1,
          control.v2,
        );
      }
      this.revision += 1;
      return this.getState();
    } catch (error) {
      this.effectsController = previous.effectsController;
      this.slotManager = previous.slotManager;
      this.audioBindings = previous.audioBindings;
      this.paramCenter = previous.paramCenter;
      this.paramRouter = previous.paramRouter;
      this.tempoBpm = previous.tempoBpm;
      this.tempoSourcePref = previous.tempoSourcePref;
      this.colorPalette = previous.colorPalette;
      this.overlayPattern = previous.overlayPattern;
      this.performanceModeActive = previous.performanceModeActive;
      this.revision = previous.revision;
      live.localControls = previous.localControls;
      try {
        this.paramCenter.applySnapshot(this.wasmHost);
        for (const [id, control] of Object.entries(previous.localControls)) {
          this.wasmHost.setControl(
            live.handle,
            Number(id),
            control.v0,
            control.v1,
            control.v2,
          );
        }
      } catch (rollbackError) {
        const failed = new Error(
          `Live Touch prepare commit failed (${error.message}) and rollback failed `
            + `(${rollbackError.message})`,
        );
        failed.code = 'LIVE_TOUCH_PREPARE_ROLLBACK_FAILED';
        throw failed;
      }
      const failed = new Error(
        `Live Touch prepare commit failed and was rolled back: ${error.message}`,
      );
      failed.code = 'LIVE_TOUCH_PREPARE_COMMIT_FAILED';
      throw failed;
    }
  }

  _applyPreparedHttpOperation(operation, dependencies) {
    let status = null;
    let responseBody = null;
    const req = {
      method: operation.method,
      url: operation.path,
      headers: { [OWNER_HEADER]: this.ownerId },
    };
    const res = {
      headersSent: false,
      writeHead(nextStatus) {
        status = nextStatus;
        this.headersSent = true;
      },
      end(raw = '') {
        if (!raw) responseBody = null;
        else {
          try { responseBody = JSON.parse(raw); }
          catch { responseBody = String(raw); }
        }
      },
    };
    const handled = this.handleHttp({
      req,
      res,
      readBody: callback => callback(operation.body || {}),
      listModelGroups: dependencies.listModelGroups,
      getFrameIndex: dependencies.getFrameIndex,
      sharedGlobals: dependencies.sharedGlobals,
      serializeMixerState: dependencies.serializeMixerState,
      performanceModeActive: dependencies.performanceModeActive === true,
    });
    if (!handled || status === null) {
      throw new Error('path is not supported by the Live prepare transaction');
    }
    if (status < 200 || status >= 300) {
      const detail = responseBody && responseBody.error
        ? responseBody.error
        : `HTTP ${status}`;
      const error = new Error(detail);
      error.status = status;
      if (responseBody && responseBody.code) error.code = responseBody.code;
      throw error;
    }
    if (responseBody && responseBody.status === 'partial') {
      const ignored = Array.isArray(responseBody.ignored)
        ? responseBody.ignored.map(item => item && item.key).filter(Boolean)
        : [];
      const detail = ignored.length > 0
        ? `prepared mutation ignored fields: ${ignored.join(', ')}`
        : 'prepared mutation was only partially applied';
      throw new Error(detail);
    }
  }

  ownsRequest(req) {
    if (!this.ownerId || !req || !req.headers) return false;
    const raw = req.headers[OWNER_HEADER];
    const owner = Array.isArray(raw) ? raw[0] : raw;
    return owner === this.ownerId;
  }

  routesRequest(req) {
    if (!this.ownsRequest(req)) return false;
    const url = requestPath(req.url);
    return ROUTED_EXACT_PATHS.has(url)
      || /^\/group-fixed-colors\/.+/.test(url)
      || /^\/global-effect-slots\/\d+$/.test(url)
      || /^\/global-effect-slots\/\d+\/movement-rate$/.test(url)
      || /^\/global-effect-slots\/\d+\/intensity(?:\/reset)?$/.test(url)
      || /^\/global-effect-slots\/\d+\/mode(?:\/cycle)?$/.test(url)
      || /^\/global-effect-slots\/\d+\/(press|activate|deactivate|trigger|toggle|down|up)$/
        .test(url)
      || /^\/audio-bindings\/(effects|groups)\/.+/.test(url);
  }

  registerLiveChannel(channel, { apply = true } = {}) {
    if (!channel || channel.id !== 'live_touch' || !channel.handle) {
      throw new Error('registerLiveChannel requires the compiled live_touch channel');
    }
    this.paramCenter.registerChannel(
      channel.id,
      channel.handle,
      this.wasmHost.getExports(channel.handle),
    );
    if (apply) {
      this.wasmHost.beginFrame(channel.handle, 0);
      this.paramCenter.applyToChannel(this.wasmHost, channel.id);
    }
  }

  unregisterLiveChannel() {
    this.paramCenter.unregisterChannel('live_touch');
  }

  tickParams(nowMs) {
    if (!this.ownerId) return;
    this.paramCenter.tickColorTransitions(nowMs);
    this.paramCenter.flushDirty(this.wasmHost);
  }

  speedMultiplier() {
    const speed = this.paramCenter.get('speed');
    const clamped = Math.max(0, Math.min(1, speed));
    return 0.25 * Math.pow(16, clamped);
  }

  tempoMultiplier() {
    return Math.max(0.05, Math.min(8, this.tempoBpm / 120));
  }

  setPalette(colorPalette) {
    this.colorPalette = this.overlayPattern.setPalette(colorPalette);
    return this.getPalette();
  }

  getPalette() {
    return this.colorPalette ? this.colorPalette.map(color => ({ ...color })) : null;
  }

  _syncSelectedOverlayFromSlot() {
    const slotId = this.overlayPattern.selectedSlotId;
    if (!Number.isInteger(slotId)) return;
    const slot = this.slotManager.getSlot(slotId);
    if (!slot || slot.effectId !== 'movementTrace') return;
    const resolved = resolveSlotBinding({ slot });
    this.overlayPattern.updateParams(stripMovementColorOverrides(resolved.params));
  }

  setLiveControl(channel, controlId, v0, v1, v2) {
    const validation = this.validateLiveControl(channel, controlId);
    if (validation.status !== 'ok') return validation;
    channel.setControl(this.wasmHost, controlId, v0, v1, v2);
    return { status: 'ok' };
  }

  validateLiveControl(channel, controlId) {
    if (this.paramCenter.isSharedControlId(channel.id, controlId)) {
      return { status: 'ignored', reason: 'shared_ownership' };
    }
    if (this.paramCenter.getBlockedIds(channel.id).has(controlId)) {
      return { status: 'ignored', reason: 'blocked_by_shared' };
    }
    const exp = this.wasmHost.getExports(channel.handle).find(entry => entry.id === controlId);
    if (!exp || !new Set([1, 2, 3, 6]).has(exp.kind)) {
      return { status: 'ignored', reason: 'not_local_control' };
    }
    return { status: 'ok' };
  }

  updateAudioGains(sourceValues, nowMs) {
    const table = this.audioBindings.getAll();
    const anyBound = Object.keys(table.effects).length > 0
      || Object.keys(table.groups).length > 0;
    if (!anyBound) {
      this.effectsController.setAudioGains(null);
      return;
    }
    const dtMs = this.audioBindings._lastMs ? nowMs - this.audioBindings._lastMs : 0;
    this.audioBindings._lastMs = nowMs;
    this.effectsController.setAudioGains(
      this.audioBindings.evaluate(sourceValues, nowMs, dtMs),
    );
  }

  /**
   * Handle one owner-tagged compatibility request. Returns true iff handled.
   * readBody is api_server's bounded/validated JSON parser.
   */
  handleHttp({
    req, res, readBody, listModelGroups, getFrameIndex, sharedGlobals,
    serializeMixerState, performanceModeActive = false,
  }) {
    if (!this.routesRequest(req)) return false;
    const method = req.method;
    const url = requestPath(req.url);
    const controller = this.effectsController;
    const slots = this.slotManager;
    const send = (status, body) => {
      res.writeHead(status, JSON_HEADERS);
      res.end(JSON.stringify(body));
    };
    const fail = error => send(Number.isInteger(error && error.status) ? error.status : 400, {
      error: String(error && error.message ? error.message : error),
      ...(error && error.code ? { code: error.code } : {}),
    });
    const withBody = fn => readBody(data => {
      try { fn(data || {}); } catch (error) { fail(error); }
    });
    const nowMs = () => (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    const frameIndex = () => (typeof getFrameIndex === 'function' ? getFrameIndex() : 0);
    const rejectPerformanceEffectConfiguration = () => {
      if (!performanceModeActive) return false;
      send(409, {
        error: 'performance mode is active — effect configuration is locked; use an effect action',
        code: 'PERFORMANCE_MODE',
      });
      return true;
    };

    if (url === '/layers/live_touch/palette') {
      if (method === 'GET') {
        send(200, { colorPalette: this.getPalette() });
        return true;
      }
      if (method === 'POST') {
        withBody(data => {
          if (!Object.hasOwn(data, 'colorPalette')) {
            throw new Error('body must include colorPalette: exactly five HSV colors');
          }
          send(200, { status: 'ok', colorPalette: this.setPalette(data.colorPalette) });
        });
        return true;
      }
      return false;
    }

    if (method === 'GET' && url === '/param-center/schema') {
      send(200, this.paramCenter.getSchema());
      return true;
    }
    if (method === 'GET' && url === '/param-center') {
      send(200, this.paramCenter.getCanonicalState());
      return true;
    }
    if (method === 'POST' && url === '/param-center') {
      withBody(data => {
        let revision = 0;
        const ignored = [];
        for (const [key, value] of Object.entries(data)) {
          const result = this.paramCenter.set(key, value, 'api', this.ownerId);
          if (result.status === 'ok') revision = result.revision;
          else ignored.push({ key, reason: result.reason || result.status });
        }
        send(200, ignored.length
          ? { status: 'partial', revision, ignored }
          : { status: 'ok', revision });
      });
      return true;
    }

    if (method === 'GET' && url === '/mixer') {
      const shared = typeof serializeMixerState === 'function'
        ? serializeMixerState()
        : {};
      send(200, {
        ...shared,
        tempoBpm: this.tempoBpm,
        tempoSource: this.tempoSourcePref === 'osc' ? 'held' : 'manual',
        tempoSourcePref: this.tempoSourcePref === 'osc' ? 'osc' : 'tap',
        oscTempoBpm: null,
      });
      return true;
    }
    if (method === 'POST' && url === '/mixer/tempo') {
      withBody(data => {
        const bpm = typeof data.bpm === 'number' ? data.bpm : Number(data.bpm);
        if (data.bpm === null || data.bpm === undefined || typeof data.bpm === 'boolean'
            || (typeof data.bpm === 'string' && data.bpm.trim() === '')
            || !Number.isFinite(bpm) || bpm < 20 || bpm > 400) {
          throw new Error(`bpm must be a finite number in [20,400], got '${data.bpm}'`);
        }
        this.tempoBpm = bpm;
        this.tempoSourcePref = 'manual';
        send(200, {
          status: 'ok',
          tempoBpm: this.tempoBpm,
          tempoMultiplier: this.tempoMultiplier(),
          tempoSource: 'manual',
          tempoSourcePref: 'tap',
        });
      });
      return true;
    }
    if (method === 'POST' && url === '/mixer/tempo/source') {
      withBody(data => {
        if (data.source !== 'osc' && data.source !== 'tap') {
          throw new Error(`source must be 'osc' | 'tap', got '${data.source}'`);
        }
        // A Live session deliberately has no independent OSC lease. Selecting
        // OSC records the preference and holds the current local BPM; it never
        // reaches into the shared arbiter or changes Deck/Mixer tempo.
        this.tempoSourcePref = data.source === 'osc' ? 'osc' : 'manual';
        send(200, {
          status: 'ok',
          tempoBpm: this.tempoBpm,
          tempoSource: this.tempoSourcePref === 'osc' ? 'held' : 'manual',
          tempoSourcePref: data.source,
          oscTempoBpm: null,
        });
      });
      return true;
    }

    if (url === '/effect-groups' || url === '/parked-groups') {
      const parked = url === '/parked-groups';
      if (method === 'GET') {
        const mask = parked ? controller.parkedGroupMask : controller.effectGroupMask;
        send(200, { groups: mask ? [...mask] : null });
        return true;
      }
      if (method === 'PUT') {
        withBody(data => {
          const wanted = data.groups === undefined ? null : data.groups;
          validateGroupList(wanted, listModelGroups());
          if (parked) controller.setParkedGroups(wanted);
          else controller.setEffectGroups(wanted);
          const mask = parked ? controller.parkedGroupMask : controller.effectGroupMask;
          send(200, { status: 'ok', groups: mask ? [...mask] : null });
        });
        return true;
      }
    }

    if (method === 'GET' && url === '/group-fixed-colors') {
      send(200, { groups: listModelGroups(), overrides: controller.groupFixedColors });
      return true;
    }
    const groupMatch = url.match(/^\/group-fixed-colors\/(.+)$/);
    if (groupMatch && (method === 'PUT' || method === 'DELETE')) {
      let group;
      try { group = decodeURIComponent(groupMatch[1]); } catch (error) { fail(error); return true; }
      if (method === 'DELETE') {
        send(200, { status: 'ok', group, removed: controller.clearGroupFixedColor(group) });
        return true;
      }
      withBody(data => {
        const known = listModelGroups();
        if (!known.includes(group)) throw new Error(`unknown group '${group}'`);
        controller.setGroupFixedColor(group, data.color, data.brightness, data.colors);
        send(200, {
          status: 'ok', group, override: controller.groupFixedColors[group],
          leased: true, leaseMs: null,
        });
      });
      return true;
    }

    if (url === '/spatial-paint') {
      if (method === 'GET') send(200, controller.getSpatialPaint());
      else if (method === 'POST') withBody(data => send(200, {
        status: 'ok', ...controller.setSpatialPaint(data),
      }));
      else return false;
      return true;
    }

    if (url === '/strobe-rate') {
      if (method === 'GET') {
        const config = controller.strobeConfig || {};
        send(200, {
          active: !!controller.strobeActive,
          hz: config.hz ?? null,
          actualHz: config.actualHz ?? null,
          duty: config.duty ?? null,
          intensity: config.intensity ?? null,
          presetId: config.presetId ?? null,
        });
      } else if (method === 'POST') {
        withBody(data => {
          const active = !!data.active;
          const hz = strictNumber(data.hz, 0.2, 25, 6, 'strobe-rate hz');
          const duty = strictNumber(data.duty, 0.02, 0.98, 0.5, 'strobe-rate duty');
          const intensity = strictNumber(data.intensity, 0.02, 1, 1, 'strobe-rate intensity');
          if (active) {
            controller.setStrobe(true, hz, duty, intensity, frameIndex(), {
              presetId: 'xy_pad', slotId: null,
            });
          } else {
            controller.stopStrobe({});
          }
          send(200, { status: 'ok', active: !!controller.strobeActive, hz, duty, intensity });
        });
      } else return false;
      return true;
    }

    if (url === '/movement-rate') {
      if (method === 'GET') {
        const movement = this.overlayPattern.params || {};
        const status = this.overlayPattern.getStatus(nowMs());
        send(200, {
          active: status.active,
          mode: movement.mode,
          pixelsPerSecond: movement.pixelsPerSecond,
          amount: movement.amount,
        });
      } else if (method === 'POST') {
        if (rejectPerformanceEffectConfiguration()) return true;
        send(409, {
          error: 'movement-rate is retired for Live Touch; use an authoritative overlay slot action',
          code: 'LIVE_TOUCH_OVERLAY_ACTION_REQUIRED',
        });
      } else return false;
      return true;
    }

    if (method === 'POST' && url === '/global-effect') {
      withBody(data => {
        if (typeof data.effect !== 'string' || typeof data.state !== 'boolean') {
          throw new Error('effect string and state boolean required');
        }
        controller.setEffect(data.effect, data.state);
        send(200, { status: 'ok', effect: data.effect, state: data.state });
      });
      return true;
    }

    if (method === 'GET' && url === '/global-effect-slots') {
      send(200, { slots: slots.getSlots() });
      return true;
    }
    if (method === 'GET' && url === '/global-effect-slots/status') {
      const overlayNowMs = nowMs();
      send(200, {
        slots: slots.getStatus().map(slot => {
          if (slot.effectId !== 'movementTrace') return slot;
          return {
            ...slot,
            // Slot state is logical operator intent, not emitted brightness.
            // During the physical one-second envelope alpha can be zero on
            // activation or nonzero on fade-out; tying reconciliation to it
            // would make an honest GET look like a missed press.
            active: this.overlayPattern.selectedSlotId === slot.slotId
              && this.overlayPattern.requestedActive,
          };
        }),
        effectsPage: slots.getEffectsPage(),
        controller: controller.getStatus(),
        liveTouchOverlayPattern: this.overlayPattern.getStatus(overlayNowMs),
      });
      return true;
    }
    if (method === 'PATCH' && url === '/global-effect-slots') {
      if (rejectPerformanceEffectConfiguration()) return true;
      withBody(data => {
        if (!Array.isArray(data.slots)) {
          throw new Error('body must include slots: array');
        }
        validateMovementPaletteOverrides(data.slots);
        // This manager is session-local. A Live Touch layout edit must never
        // deploy or persist a shared Deck/Mixer effect layout.
        slots.setSlots(data.slots, { emitLayout: false });
        this._syncSelectedOverlayFromSlot();
        send(200, { slots: slots.getSlots() });
      });
      return true;
    }
    const slotPatch = url.match(/^\/global-effect-slots\/(\d+)$/);
    if (method === 'PATCH' && slotPatch) {
      if (rejectPerformanceEffectConfiguration()) return true;
      withBody(data => {
        const slotId = Number(slotPatch[1]);
        validateMovementPaletteOverride(data, slots.getSlot(slotId));
        const slot = slots.patchSlot(slotId, data);
        this._syncSelectedOverlayFromSlot();
        send(200, { slot });
      });
      return true;
    }
    const movementRateMatch = url.match(/^\/global-effect-slots\/(\d+)\/movement-rate$/);
    if (method === 'POST' && movementRateMatch) {
      withBody(data => {
        const slotId = Number(movementRateMatch[1]);
        const slot = slots.getSlot(slotId);
        if (!slot) throw new Error(`Invalid slotId: ${slotId}`);
        if (slot.effectId !== 'movementTrace') {
          const error = new Error(`Slot ${slotId} is not a movement effect`);
          error.code = 'LIVE_TOUCH_MOVEMENT_SLOT_REQUIRED';
          error.status = 409;
          throw error;
        }
        const active = data.active !== false;
        const actionNowMs = nowMs();
        const resolved = resolveSlotBinding({ slot });
        const params = stripMovementColorOverrides(resolved.params);
        if (active) {
          if (!Object.hasOwn(data, 'pixelsPerSecond')) {
            throw new Error('body must include pixelsPerSecond while movement is active');
          }
          params.pixelsPerSecond = strictNumber(
            data.pixelsPerSecond, 0.05, 120, null, 'movement slot pixelsPerSecond',
          );
          if (this.overlayPattern.selectedSlotId === slotId
              && this.overlayPattern.requestedActive) {
            this.overlayPattern.updateParams(params);
          } else {
            this.overlayPattern.dispatch({
              slotId,
              presetId: resolved.presetId,
              params,
              action: 'activate',
              behavior: resolved.behavior,
              nowMs: actionNowMs,
            });
          }
        } else {
          this.overlayPattern.dispatch({
            slotId,
            presetId: resolved.presetId,
            params,
            action: 'deactivate',
            behavior: resolved.behavior,
            nowMs: actionNowMs,
          });
        }
        send(200, {
          status: 'ok',
          slotId,
          active,
          pixelsPerSecond: active ? params.pixelsPerSecond : null,
          liveTouchOverlayPattern: this.overlayPattern.getStatus(actionNowMs),
        });
      });
      return true;
    }
    const intensityMatch = url.match(/^\/global-effect-slots\/(\d+)\/intensity(?:\/(reset))?$/);
    if (method === 'POST' && intensityMatch) {
      if (rejectPerformanceEffectConfiguration()) return true;
      const slotId = Number(intensityMatch[1]);
      const reset = intensityMatch[2] === 'reset';
      if (reset) {
        try {
          const result = slots.resetSlotIntensity(slotId, {
            frameIndex: frameIndex(), nowMs: nowMs(),
          });
          this._syncSelectedOverlayFromSlot();
          send(200, {
            status: 'ok', slotId, intensity: result.intensity, applied: result.applied,
          });
        } catch (error) {
          fail(error);
        }
      } else {
        withBody(data => {
          if (typeof data.value !== 'number' || !Number.isFinite(data.value)) {
            throw new Error('body must include value: a finite number in [0..1]');
          }
          const result = slots.setSlotIntensity(slotId, data.value, {
            frameIndex: frameIndex(), nowMs: nowMs(),
          });
          this._syncSelectedOverlayFromSlot();
          send(200, {
            status: 'ok', slotId, intensity: result.intensity,
            paramValue: result.paramValue, applied: result.applied,
          });
        });
      }
      return true;
    }
    const modeMatch = url.match(/^\/global-effect-slots\/(\d+)\/mode(?:\/(cycle))?$/);
    if (method === 'POST' && modeMatch) {
      if (rejectPerformanceEffectConfiguration()) return true;
      const slotId = Number(modeMatch[1]);
      const cycle = modeMatch[2] === 'cycle';
      if (cycle) {
        try {
          const result = slots.cycleSlotMode(slotId, {
            frameIndex: frameIndex(), nowMs: nowMs(),
          });
          send(200, {
            status: 'ok', slotId, mode: result.mode, modeIndex: result.modeIndex,
            applied: result.applied,
          });
        } catch (error) {
          fail(error);
        }
      } else {
        withBody(data => {
          if (!Object.prototype.hasOwnProperty.call(data, 'value')) {
            throw new Error('body must include value (a member of the effect mode values list)');
          }
          const result = slots.setSlotMode(slotId, data.value, {
            frameIndex: frameIndex(), nowMs: nowMs(),
          });
          send(200, {
            status: 'ok', slotId, mode: result.mode, modeIndex: result.modeIndex,
            applied: result.applied,
          });
        });
      }
      return true;
    }
    const slotAction = url.match(
      /^\/global-effect-slots\/(\d+)\/(press|activate|deactivate|trigger|toggle|down|up)$/,
    );
    if (method === 'POST' && slotAction) {
      try {
        const slotId = Number(slotAction[1]);
        const action = slotAction[2];
        const slot = slots.getSlot(slotId);
        if (!slot) throw new Error(`Invalid slotId: ${slotId}`);
        const actionNowMs = nowMs();
        if (slot.effectId === 'movementTrace') {
          const resolved = resolveSlotBinding({ slot });
          this.overlayPattern.dispatch({
            slotId,
            presetId: resolved.presetId,
            params: stripMovementColorOverrides(resolved.params),
            action,
            behavior: resolved.behavior,
            nowMs: actionNowMs,
          });
        } else {
          slots.dispatchSlotAction({
            slotId, action, frameIndex: frameIndex(), nowMs: actionNowMs,
          });
        }
        send(200, {
          status: 'ok', slotId, action, controller: controller.getStatus(),
          liveTouchOverlayPattern: this.overlayPattern.getStatus(actionNowMs),
        });
      } catch (error) { fail(error); }
      return true;
    }
    if (method === 'POST' && url === '/global-effects/disable-all') {
      try {
        const actionNowMs = nowMs();
        const result = slots.disableAll({ frameIndex: frameIndex(), nowMs: actionNowMs });
        this.overlayPattern.dispatch({
          slotId: this.overlayPattern.selectedSlotId,
          presetId: this.overlayPattern.presetId,
          params: this.overlayPattern.params || {},
          action: 'deactivate',
          behavior: 'toggle',
          nowMs: actionNowMs,
        });
        send(200, {
          status: 'ok', disabled: result.disabled,
          liveTouchOverlayPattern: this.overlayPattern.getStatus(actionNowMs),
        });
      } catch (error) { fail(error); }
      return true;
    }

    if (method === 'GET' && url === '/audio-bindings') {
      send(200, {
        bindings: this.audioBindings.getAll(),
        gains: controller._audioGains || { effects: {}, groups: {} },
        missing: this.audioBindings.missingSources,
      });
      return true;
    }
    const bindingMatch = url.match(/^\/audio-bindings\/(effects|groups)\/(.+)$/);
    if (method === 'PUT' && bindingMatch) {
      if (rejectPerformanceEffectConfiguration()) return true;
      let id;
      try { id = decodeURIComponent(bindingMatch[2]); } catch (error) { fail(error); return true; }
      withBody(data => {
        const hasOne = typeof data.source === 'string' && data.source.length > 0;
        const hasMany = Array.isArray(data.sources) && data.sources.length > 0;
        const binding = this.audioBindings.set(
          bindingMatch[1], id, (hasOne || hasMany) ? data : null,
        );
        send(200, { ok: true, scope: bindingMatch[1], id, binding });
      });
      return true;
    }
    if (method === 'POST' && url === '/audio-bindings/clear') {
      if (rejectPerformanceEffectConfiguration()) return true;
      this.audioBindings.clearAll();
      send(200, { ok: true });
      return true;
    }

    if (method === 'GET' && url === '/globals') {
      send(200, { ...(sharedGlobals || {}), effects: { ...controller.effects } });
      return true;
    }

    return false;
  }
}

function requestPath(url) {
  return String(url || '').split('?')[0];
}

function assertOwnerId(ownerId) {
  if (typeof ownerId !== 'string' || ownerId.length === 0) {
    throw new Error('Live Touch ownerId must be a non-empty string');
  }
}

function prepareError(message, operationIndex, code = 'LIVE_TOUCH_PREPARE_INVALID') {
  const error = new Error(message);
  error.code = code;
  error.operationIndex = operationIndex;
  return error;
}

function validatePrepareOperation(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new Error('operation must be an object');
  }
  if (!PREPARE_METHODS.has(operation.method)) {
    throw new Error('method must be POST, PUT, PATCH, or DELETE');
  }
  if (typeof operation.path !== 'string' || !operation.path.startsWith('/')
      || operation.path.includes('?') || operation.path.includes('#')) {
    throw new Error('path must be an exact absolute API path without query or fragment');
  }
  if (operation.body !== undefined
      && (!operation.body || typeof operation.body !== 'object' || Array.isArray(operation.body))) {
    throw new Error('body must be an object when supplied');
  }
}

function normalizePreparedControl(context, channel, body) {
  if (!Number.isInteger(body.id)) throw new Error('Live control id must be an integer');
  const values = ['v0', 'v1', 'v2'].map(key => {
    const value = body[key] === undefined ? 0 : body[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${key} must be a finite number`);
    }
    return value;
  });
  const validation = context.validateLiveControl(channel, body.id);
  if (validation.status !== 'ok') {
    throw new Error(validation.reason || 'Live control is not pattern-local');
  }
  return { id: body.id, v0: values[0], v1: values[1], v2: values[2] };
}

function validateGroupList(groups, knownGroups) {
  if (groups === null) return;
  if (!Array.isArray(groups)) throw new Error('groups must be an array or null');
  const bad = groups.filter(group => !knownGroups.includes(group));
  if (bad.length > 0) throw new Error(`unknown group(s): ${bad.join(', ')}`);
}

function strictNumber(value, min, max, defaultValue, label) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number in ${min}..${max}`);
  }
  return value;
}

function validateColors(colors, label) {
  if (!Array.isArray(colors) || colors.length === 0) {
    throw new Error(`${label}: colors must be a non-empty array`);
  }
  let peak = 0;
  for (const color of colors) {
    if (!Array.isArray(color) || color.length < 6
        || color.some(value => typeof value !== 'number'
          || !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`${label}: every color must be 6 finite numbers in 0..1`);
    }
    for (const value of color) peak = Math.max(peak, value);
  }
  if (peak < 0.05) throw new Error(`${label}: an all-black palette is refused`);
}

function stripMovementColorOverrides(params) {
  const { colors, ...withoutColors } = params;
  return withoutColors;
}

function validateMovementPaletteOverrides(slot) {
  if (!slot || typeof slot !== 'object') return;
  if (slot.effectId === 'movementTrace') validateMovementPaletteOverride(slot);
}

function validateMovementPaletteOverride(slotPatch, existingSlot = null) {
  const isMovement = (slotPatch && slotPatch.effectId === 'movementTrace')
    || (existingSlot && existingSlot.effectId === 'movementTrace');
  const override = slotPatch && slotPatch.paramsOverride;
  if (isMovement && override && Object.hasOwn(override, 'colors')) {
    const error = new Error(
      'movementTrace colors are session-owned; stage the exact five-colour Live Touch palette instead',
    );
    error.code = 'LIVE_TOUCH_OVERLAY_PALETTE_REQUIRED';
    error.status = 409;
    throw error;
  }
}
