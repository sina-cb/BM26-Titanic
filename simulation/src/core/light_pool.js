/**
 * light_pool.js — Fixed SpotLight Object Pool for WebGPU stability.
 *
 * Pre-allocates a fixed number of THREE.SpotLight objects at boot time and
 * adds them to the scene exactly ONCE. This ensures the WebGPU shader compiles
 * with a known NUM_SPOT_LIGHTS and never recompiles.
 *
 * Each frame, the orchestrator assigns pool slots to the highest-priority
 * pixels (closest to camera, within frustum). Unassigned slots are zeroed out.
 */
import * as THREE from 'three';
import { scene, camera, modelRadius, renderer, params } from './state.js';
import { getProfileDef } from './profile_registry.js';
import { isEffectsOnlyFixture, fixtureInView } from '../dmx/view_registry.js';
import { emitsVisibleLight } from './analytic_light_gate.js';
import {
  DEFAULT_SPOTLIGHT_SAMPLING_MODE,
  assertSpotlightSamplingMode,
  createSpotlightPlanner,
  isLegacySpotlightSamplingMode,
  resolveSpotlightSamplingMode,
} from './spotlight_sampling.js';

// ── Pool Configuration ──────────────────────────────────────────────────
// The pool is sized from the RESOLVED boot value of `params.maxSpotlights`
// (scene YAML → applyBootUrlOverrides(?spotlights=N) → here). There is no
// module-load URL read and no module-load default: whatever the operator is
// actually running is what gets allocated, so the "Max Spotlights" slider and
// the saved scene value are both truthful. See src/core/url_overrides.js.
export const MAX_SPOTLIGHT_POOL_SIZE = 200; // Manual hard cap for ?spotlights=N and pool allocation

// The absolute allocation bound. `?spotlights=N` above the hard cap can be
// raised for ONE session by an explicit operator confirm (see url_overrides.js
// → buildSpotlightOverCapPrompt), but never above this line.
//
// Why 2000: a pooled SpotLight costs ~GPU_SAFE_VECTORS_PER_SPOTLIGHT (16)
// fragment-uniform vectors, so 2000 lights want ~32,000 — an order of magnitude
// past any real GPU's budget, and ~12× the ~160 count where Mac WebGPU already
// renders the scene solid white or black. It is far enough above any budget an
// operator could sanely want that everything beyond it is a typo by
// construction (`?spotlights=999999`), and low enough that the allocation loop
// stays a few thousand small JS objects — a wedged tab, not an out-of-memory
// browser. Above it we refuse loudly and never prompt: there is nothing to
// consent to.
export const SPOTLIGHT_ABSOLUTE_CEILING = 2000;

const SPOTLIGHT_SAMPLING_BUCKET_MIN = 2;
const SPOTLIGHT_SAMPLING_BUCKET_MAX = 20;
const DEFAULT_SPOTLIGHT_SAMPLING_BUCKET_DISTANCE = 10;
const GPU_SAFE_FRAGMENT_VECTOR_RESERVE = 64;
const GPU_SAFE_VECTORS_PER_SPOTLIGHT = 16;
const SPOTLIGHT_INTENSITY_SCALE_PER_RADIUS = 0.04;
const MIN_SPOTLIGHT_INTENSITY_SCALE = 0.75;

// User-visible thresholds for the spotlight count warning banner.
//   CAUTION: above this, frame rate often drops materially on consumer GPUs.
//   CRITICAL: above this, WebGPU shaders can break and render scenes entirely
//             white or black on some drivers (especially Mac Metal/WebGPU).
const SPOTLIGHT_WARN_CAUTION_COUNT = 100;
const SPOTLIGHT_WARN_CRITICAL_COUNT = 160;

// ── Pool State ──────────────────────────────────────────────────────────
let _pool = [];           // Array of { light: THREE.SpotLight, target: THREE.Object3D, active: bool }
let _initialized = false;
// How many pixels the last collect pass skipped as dark. Diagnostic only — it
// is the number the 20260725_82 leak would have shown as wasted pool slots.
let _lastSkippedDark = 0;
let _requestedPoolSize = 0;
let _effectivePoolSize = 0;
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _tmpVec = new THREE.Vector3();

// ── Per-frame scratch (allocation-free steady state) ────────────────────
// _collectLightRequests used to allocate, PER PIXEL PER FRAME, a cloned
// worldPos Vector3, a fresh `new Vector3(0,0,-1)` direction, a cloned Color and
// a fresh object literal. On the titanic scene that is thousands of objects
// every frame at 40-60 fps — pure GC pressure for values that are consumed and
// dropped inside the same function call. The request objects are now pooled and
// mutated in place, with a fixed shape (monomorphic for the JIT).
//
// The pooled objects are FRAME-LOCAL by contract: they are filled by
// _collectLightRequests and consumed by updateLightPool in the same synchronous
// call, before anything can rewrite a pixel colour. Nothing outside this module
// may retain one. The assignment planner enforces that on its side by
// snapshotting into slot-owned buffers whenever it needs a request to survive a
// frame boundary (a fading-out light).
const REQUEST_KEY_STRIDE = 100000;
const _requestPool = [];
const _requests = [];
const _visible = [];
const _fixtureKeyBases = new WeakMap();
const _fallbackColors = new WeakMap();
let _nextFixtureKeyBase = 1;
const _planner = createSpotlightPlanner();

// ── Session-only over-cap ceiling ───────────────────────────────────────
// When the operator explicitly accepts an over-cap `?spotlights=N` at boot,
// the ceiling that bounds the pool is raised to N *for that session*.
//
// It is stored on `params` — deliberately, and NOT in the config tree, not in
// localStorage, not on a module-level variable:
//   • the config tree is what gets serialized into scene_config.yaml, so a
//     value living there would persist the raise. It must never survive a
//     reload (clampPersistedSpotlightBudget enforces the other half of that).
//   • `params` is the one object every boot step (extractParams →
//     applyBootUrlOverrides → initLightPool → the GUI) shares, so the ceiling
//     is visible to all of them without a new module. `reconstructYAML` walks
//     the config TREE, not `params`, so this key can never reach a file.
// The key is `__`-prefixed for the same reason `__controllerRegistrySnapshot`
// in undo.js is: it is machinery riding on `params`, never a config key.
const SESSION_CEILING_PARAM_KEY = '__spotlightSessionCeiling';

function assertValidSessionCeiling(value, context) {
  if (
    !Number.isInteger(value)
    || value <= MAX_SPOTLIGHT_POOL_SIZE
    || value > SPOTLIGHT_ABSOLUTE_CEILING
  ) {
    throw new RangeError(
      `[LightPool] ${context}: an over-cap session ceiling must be an integer in ` +
      `${MAX_SPOTLIGHT_POOL_SIZE + 1}..${SPOTLIGHT_ABSOLUTE_CEILING} ` +
      `(got ${JSON.stringify(value)}).`
    );
  }
}

/**
 * Drop any over-cap ceiling. Called at the top of every
 * applyBootUrlOverrides() — a boot always starts at the hard cap, and only
 * that boot's own accepted prompt may raise it again.
 */
export function clearSpotlightSessionCeiling() {
  delete params[SESSION_CEILING_PARAM_KEY];
}

/**
 * Grant an over-cap SpotLight budget for THIS SESSION ONLY. The single caller
 * is the accepted branch of the `?spotlights=` over-cap prompt.
 *
 * @param {number} acceptedSize integer in (MAX_SPOTLIGHT_POOL_SIZE, SPOTLIGHT_ABSOLUTE_CEILING]
 * @throws {RangeError} on anything else — a raise is an explicit, bounded act.
 */
export function raiseSpotlightSessionCeiling(acceptedSize) {
  assertValidSessionCeiling(acceptedSize, 'raiseSpotlightSessionCeiling');
  params[SESSION_CEILING_PARAM_KEY] = acceptedSize;
}

/**
 * The ceiling that bounds the pool right now: the hard cap, unless the
 * operator accepted an over-cap budget at boot.
 *
 * @returns {number}
 * @throws {RangeError} if the session key holds something that is not a valid
 *   raise — codex P0: garbage in the ceiling is a loud failure, never a quiet
 *   fall back to the hard cap (that would hide whoever wrote the garbage).
 */
export function getSpotlightSessionCeiling() {
  const raised = params[SESSION_CEILING_PARAM_KEY];
  if (raised === undefined) return MAX_SPOTLIGHT_POOL_SIZE;
  assertValidSessionCeiling(raised, `params.${SESSION_CEILING_PARAM_KEY}`);
  return raised;
}

/** True while this session runs an operator-accepted over-cap budget. */
export function isSpotlightSessionCeilingRaised() {
  return getSpotlightSessionCeiling() > MAX_SPOTLIGHT_POOL_SIZE;
}

/**
 * The persistence boundary for the SpotLight budget.
 *
 * `reconstructYAML` copies `params.maxSpotlights` straight into the config
 * tree entry on every save, so a session running an accepted over-cap budget
 * would otherwise write that budget into scene_config.yaml and resurrect it on
 * the next plain boot — with no prompt and no consent. Call this immediately
 * after every `reconstructYAML(configTree)` (explicit save, auto-save, and the
 * unload beacon) to clamp the value that reaches disk back to the hard cap.
 *
 * The clamp is unconditional rather than raised-session-only: a scene file may
 * never declare more SpotLights than the GPU-safe cap, however the number got
 * there (hand-edited YAML included). Slider positions inside 1..cap persist
 * exactly as before — only the over-cap part is dropped.
 *
 * @param {Object} tree the live config tree
 * @returns {number|null} the value that was clamped away, or null for a no-op
 */
export function clampPersistedSpotlightBudget(tree) {
  const entry = tree && tree.parLights && tree.parLights.maxSpotlights;
  if (!entry || typeof entry !== 'object') return null;
  const stored = Number(entry.value);
  if (!Number.isFinite(stored) || stored <= MAX_SPOTLIGHT_POOL_SIZE) return null;

  entry.value = MAX_SPOTLIGHT_POOL_SIZE;
  console.warn(
    `[LightPool] Save: maxSpotlights ${stored} is above the hard cap — writing ` +
    `${MAX_SPOTLIGHT_POOL_SIZE} to the scene file. An over-cap budget is session-only; ` +
    `boot with ?spotlights=${stored} and accept the prompt to get it back.`
  );
  return stored;
}

/**
 * The one place the boot SpotLight budget becomes a pool size.
 *
 * @param {number} requestedValue resolved `params.maxSpotlights`
 * @returns {number} integer in 0..getSpotlightSessionCeiling()
 * @throws {TypeError} if the value is not a finite number — codex P0: a
 *   malformed budget is a loud failure, never a silent default pool. (`null`
 *   and `undefined` numify to 0 / NaN, which would look like "pool disabled"
 *   — a missing scene key must not be able to blackout the analytic rig.)
 */
export function resolveBootPoolSize(requestedValue) {
  if (typeof requestedValue !== 'number' || !Number.isFinite(requestedValue)) {
    throw new TypeError(
      `[LightPool] params.maxSpotlights is not a finite number (got ${JSON.stringify(requestedValue)}). ` +
      'Every scene_config.yaml must declare parLights.maxSpotlights.'
    );
  }
  return THREE.MathUtils.clamp(Math.floor(requestedValue), 0, getSpotlightSessionCeiling());
}

/**
 * Loud, operator-visible notice that `?spotlights=N` asked for more SpotLights
 * than the hard cap allows. Called from applyBootUrlOverrides() — the single
 * place the URL budget is resolved. Headless (no DOM) is a no-op.
 */
export function showSpotlightCapToast(requestedSize, cappedSize) {
  if (typeof document === 'undefined') return;

  const renderToast = () => {
    let toast = document.getElementById('spotlight-cap-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'spotlight-cap-toast';
      toast.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:color-mix(in srgb, var(--error) 18%, var(--surface));border:1px solid var(--error-container-border);color:var(--error);padding:10px 24px;border-radius:8px;font-family:var(--font-body);font-size:13px;white-space:pre-line;pointer-events:none;z-index:999;opacity:0;transition:opacity 0.3s;max-width:560px;';
      document.body.appendChild(toast);
    }
    toast.textContent = `spotlights=${requestedSize} exceeds the preview pool cap (${MAX_SPOTLIGHT_POOL_SIZE}). Using ${cappedSize}.`;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 8000);
  };

  if (document.body) {
    renderToast();
    return;
  }

  window.addEventListener('DOMContentLoaded', renderToast, { once: true });
}

// Internal state for the warning banner's auto-hide timer.
const SPOTLIGHT_WARN_AUTO_HIDE_MS = 30_000;
let _spotlightWarnHideTimer = null;

function _hideSpotlightWarning() {
  if (_spotlightWarnHideTimer !== null) {
    clearTimeout(_spotlightWarnHideTimer);
    _spotlightWarnHideTimer = null;
  }
  const el = document.getElementById('spotlight-warning');
  if (!el) return;
  el.classList.add('hidden');
  el.removeAttribute('data-severity');
  el.innerHTML = '';
}

/**
 * Show / update / hide the persistent bottom-center banner that warns users
 * when the SpotLight count crosses performance- and stability-critical
 * thresholds. Safe to call repeatedly (e.g. on every slider tick).
 *
 *   • count > 160 → "critical" red banner: warns about all-white or all-black
 *     scenes from GPU shader limits (notably Mac WebGPU above ~160 lights).
 *   • count > 100 → "caution" amber banner: warns that high SpotLight counts
 *     reduce FPS and suggests lowering the slider.
 *   • count ≤ 100 → banner is hidden.
 *
 * The banner auto-dismisses after SPOTLIGHT_WARN_AUTO_HIDE_MS (30 s) and
 * carries an inline close button so the user can dismiss it sooner. Each
 * call resets the auto-hide timer so updates from slider drags keep the
 * latest state visible for a full 30 seconds.
 *
 * Renders into a lazily-created `#spotlight-warning` div so callers don't
 * need to mutate index.html. Styled in style.css.
 */
export function showSpotlightCountWarning(count) {
  const render = () => {
    const safe = Number.isFinite(count) ? Math.floor(count) : 0;
    let el = document.getElementById('spotlight-warning');
    if (!el) {
      el = document.createElement('div');
      el.id = 'spotlight-warning';
      el.className = 'hidden';
      document.body.appendChild(el);
    }

    let bodyHtml = null;
    let severity = null;
    if (safe > SPOTLIGHT_WARN_CRITICAL_COUNT) {
      severity = 'critical';
      bodyHtml =
        '<div class="sw-title">Critical · GPU light limit</div>' +
        `With <span class="sw-count">${safe}</span> SpotLights, the scene may render entirely ` +
        `<strong>white</strong> or <strong>black</strong> on some GPUs — Mac WebGPU ` +
        `in particular tends to break above ~${SPOTLIGHT_WARN_CRITICAL_COUNT} lights. ` +
        'Lower the <code>Max Spotlights</code> slider in the Lighting panel to recover.' +
        (isSpotlightSessionCeilingRaised()
          ? ` This session runs an <strong>accepted over-cap budget</strong> ` +
            `(${getSpotlightSessionCeiling()}, above the ${MAX_SPOTLIGHT_POOL_SIZE} cap). ` +
            'It is not saved — reload without <code>?spotlights=</code> to return to the cap.'
          : '');
    } else if (safe > SPOTLIGHT_WARN_CAUTION_COUNT) {
      severity = 'caution';
      bodyHtml =
        '<div class="sw-title">Performance · High SpotLight count</div>' +
        `Using <span class="sw-count">${safe}</span> SpotLights. If FPS feels low, ` +
        'lower the <code>Max Spotlights</code> slider in the Lighting panel, or switch ' +
        'to a lighter profile (e.g. <code>?profile=emissive</code> in the URL).';
    }

    if (severity === null) {
      _hideSpotlightWarning();
      return;
    }

    el.setAttribute('data-severity', severity);
    el.innerHTML =
      '<span class="sw-icon" aria-hidden="true">⚠</span>' +
      `<div class="sw-body">${bodyHtml}</div>` +
      '<button class="sw-close" type="button" title="Dismiss" aria-label="Dismiss warning">✕</button>';
    el.classList.remove('hidden');

    const closeBtn = el.querySelector('.sw-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', _hideSpotlightWarning);
    }

    if (_spotlightWarnHideTimer !== null) clearTimeout(_spotlightWarnHideTimer);
    _spotlightWarnHideTimer = setTimeout(_hideSpotlightWarning, SPOTLIGHT_WARN_AUTO_HIDE_MS);
  };

  if (typeof document === 'undefined') return;
  if (document.body) {
    render();
  } else {
    window.addEventListener('DOMContentLoaded', render, { once: true });
  }
}

function resolveEffectivePoolSize(requestedPoolSize) {
  const backendName = renderer?.backend?.constructor?.name || 'unknown';
  // The hard cap, unless the operator accepted an over-cap budget for this
  // session at the boot prompt.
  const manualCap = getSpotlightSessionCeiling();
  const cappedRequested = Math.min(requestedPoolSize, manualCap);

  if (!renderer || typeof renderer.getContext !== 'function') {
    return {
      backendName,
      manualCap,
      reason: 'renderer context unavailable',
      requested: requestedPoolSize,
      size: cappedRequested,
    };
  }

  try {
    const context = renderer.getContext();
    const isWebGLContext = !!context
      && typeof context.getParameter === 'function'
      && Number.isInteger(context.MAX_FRAGMENT_UNIFORM_VECTORS);

    if (!isWebGLContext) {
      return {
        backendName,
        manualCap,
        reason: 'native WebGPU or non-WebGL backend',
        requested: requestedPoolSize,
        size: cappedRequested,
      };
    }

    const maxVectors = context.getParameter(context.MAX_FRAGMENT_UNIFORM_VECTORS);
    const safeSpotLights = Math.max(
      0,
      Math.floor((maxVectors - GPU_SAFE_FRAGMENT_VECTOR_RESERVE) / GPU_SAFE_VECTORS_PER_SPOTLIGHT)
    );

    // We do NOT auto-clamp to safeSpotLights. The user owns the SpotLight
    // budget via the `Max Spotlights` GUI slider (1..MAX_SPOTLIGHT_POOL_SIZE)
    // and `?spotlights=N`. We just emit a console warning below if the
    // requested pool size exceeds what the WebGL fragment-uniform budget can
    // hold without spilling — that's a perf hint, not a hard ceiling.
    return {
      backendName,
      manualCap,
      maxVectors,
      requested: requestedPoolSize,
      safeSpotLights,
      size: cappedRequested,
      overSafeBudget: cappedRequested > safeSpotLights,
    };
  } catch (err) {
    console.warn('[LightPool] Failed to inspect GPU uniform limits. Falling back to requested pool size.', err);
    return {
      backendName,
      manualCap,
      reason: err?.message || 'uniform query failed',
      requested: requestedPoolSize,
      size: cappedRequested,
    };
  }
}

/**
 * The colour a request carries.
 *
 * Returns the LIVE colour object when it is well-formed — no clone. A request
 * is frame-local (see the scratch block above) and every consumer copies out of
 * it (`light.color.copy`, the planner's snapshot), so cloning per pixel per
 * frame was allocating thousands of Colors to hand each one to a `.copy()`.
 *
 * The config fallback still needs a real Color object, so it is memoised per
 * fixture config and rebuilt whenever the operator changes that config's
 * colour — a cached fallback that went stale would silently paint the old hue.
 */
function getSafeLightColor(sourceColor, config) {
  if (
    sourceColor
    && Number.isFinite(sourceColor.r)
    && Number.isFinite(sourceColor.g)
    && Number.isFinite(sourceColor.b)
  ) {
    return sourceColor;
  }

  const source = (config && config.color) || '#ffaa44';
  let cached = _fallbackColors.get(config);
  if (cached === undefined || cached.source !== source) {
    cached = { source, color: new THREE.Color(source) };
    _fallbackColors.set(config, cached);
  }
  return cached.color;
}

/**
 * A stable per-pixel identity, used by the stable sampling strategies to know
 * that the light in slot 7 this frame is the same fixture's pixel as last
 * frame. Fixture ids come from a WeakMap, so a profile rebuild (which replaces
 * every fixture object) simply produces new keys and the planner releases the
 * old ones — exactly the right behaviour, with no cleanup pass.
 */
function getRequestKey(fixture, pixelIndex) {
  let base = _fixtureKeyBases.get(fixture);
  if (base === undefined) {
    base = _nextFixtureKeyBase++ * REQUEST_KEY_STRIDE;
    _fixtureKeyBases.set(fixture, base);
  }
  return base + pixelIndex;
}

/** Take the next pooled request object, growing the pool on demand. */
function nextRequest() {
  let req = _requestPool[_requests.length];
  if (req === undefined) {
    req = {
      worldPos: new THREE.Vector3(),
      worldDir: new THREE.Vector3(),
      color: null,
      intensity: 5,
      angle: 20,
      penumbra: 0.5,
      fixture: null,
      key: 0,
      distSq: 0,
      score: 0,
    };
    _requestPool.push(req);
  }
  _requests.push(req);
  return req;
}

function getSafeMasterExposure() {
  const exposure = Number(params.masterExposure);
  if (!Number.isFinite(exposure)) return 0.2;
  return Math.max(0, exposure);
}

function getSafeActiveSpotlightLimit() {
  const configuredLimit = Number(params.maxSpotlights);
  if (!Number.isFinite(configuredLimit)) return _pool.length;
  return THREE.MathUtils.clamp(Math.floor(configuredLimit), 0, _pool.length);
}

function getSpotlightIntensityScale(radius) {
  return Math.max(MIN_SPOTLIGHT_INTENSITY_SCALE, radius * SPOTLIGHT_INTENSITY_SCALE_PER_RADIUS);
}

/**
 * The active sampling strategy — validated, never coerced.
 *
 * This used to accept only `closest_bucket` and `uniform` and silently return
 * `uniform` for everything else. Two consequences, both bugs:
 *   • `closest` is offered by the dropdown and has a branch in the selector,
 *     but could never be reached — picking it silently gave you `uniform`.
 *   • a typo in a scene file produced a strategy the operator never chose,
 *     with nothing on any channel saying so. Codex P0 forbids exactly that.
 * Unknown values now throw (see assertSpotlightSamplingMode). initLightPool
 * validates once at boot so a bad scene value fails there, loudly, rather than
 * on the first animation frame — and it is also where an ABSENT value is
 * resolved to the code default and written onto `params`, which is why this
 * per-frame reader is a bare assert with no default branch of its own.
 */
function getSpotlightSamplingMode() {
  return assertSpotlightSamplingMode(params.spotlightSamplingMode, 'params.spotlightSamplingMode');
}

function getSafeSpotlightSamplingBucketDistance() {
  const bucketDistance = Number(params.spotlightSamplingBucketDistance);
  if (!Number.isFinite(bucketDistance)) return DEFAULT_SPOTLIGHT_SAMPLING_BUCKET_DISTANCE;
  return THREE.MathUtils.clamp(
    bucketDistance,
    SPOTLIGHT_SAMPLING_BUCKET_MIN,
    SPOTLIGHT_SAMPLING_BUCKET_MAX
  );
}

// The selection strategies themselves live in ./spotlight_sampling.js — this
// module owns the THREE objects and executes the plan they produce.

/**
 * Initialize the SpotLight pool. Call ONCE after scene and camera are ready.
 * All lights start invisible (intensity=0) so they don't affect the scene
 * until the orchestrator assigns them.
 */
export function initLightPool() {
  if (_initialized) return;

  const createdLights = [];

  // Resolve and validate the sampling strategy HERE, outside the try, so a
  // scene file (or a hand-edited common.yaml) naming a strategy that does not
  // exist fails at boot with the name and the roster in the message — rather
  // than throwing on the first animation frame, or, as before, silently running
  // `uniform`.
  //
  // The ONE thing that is not an error is the key being absent entirely: that
  // scene has recorded no opinion, so it gets the code default. Resolving it
  // once, here, and writing it back onto `params` keeps every later reader
  // (including the per-frame getSpotlightSamplingMode) a plain assert with no
  // branch, and makes the GUI dropdown show what is actually running. The
  // config-tree leaf that persists it is created by the GUI — see
  // ensureSpotlightSamplingEntry in gui_builder.js.
  if (params.spotlightSamplingMode === undefined) {
    params.spotlightSamplingMode = DEFAULT_SPOTLIGHT_SAMPLING_MODE;
    console.warn(
      `[LightPool] this scene records no options.spotlightSamplingMode — running the shipped ` +
      `default "${DEFAULT_SPOTLIGHT_SAMPLING_MODE}". Saving the scene records it in ` +
      'scenes/common.yaml, and a saved value always wins from then on.'
    );
  }
  resolveSpotlightSamplingMode(
    params.spotlightSamplingMode,
    'scenes/common.yaml → options.spotlightSamplingMode'
  );

  try {
    const radius = modelRadius || 50;
    // params is final by now: extractParams() → applyBootUrlOverrides() →
    // setupLighting() → here. Sizing from it (rather than from a module-load
    // constant) is what makes a saved maxSpotlights of 150 actually allocate
    // 150 slots, and what makes a ?spotlights= session round-trip on save.
    _requestedPoolSize = resolveBootPoolSize(params.maxSpotlights);
    const sizing = resolveEffectivePoolSize(_requestedPoolSize);
    _effectivePoolSize = sizing.size;

    // Surface the persistent banner if the boot-time count is already past
    // a threshold (handles both URL ?spotlights=N and scene-config defaults).
    const initialActiveLimit = Number.isFinite(params.maxSpotlights)
      ? Math.min(params.maxSpotlights, _effectivePoolSize)
      : _effectivePoolSize;
    showSpotlightCountWarning(initialActiveLimit);

    if (sizing.maxVectors !== undefined) {
      console.log(
        `[LightPool] WebGL uniform estimate: maxVectors=${sizing.maxVectors}, safeSpotLights=${sizing.safeSpotLights}, requested=${_requestedPoolSize}, manualCap=${sizing.manualCap}, using=${_effectivePoolSize}`
      );
      if (sizing.overSafeBudget) {
        console.warn(
          `[LightPool] Pool size (${_effectivePoolSize}) exceeds the WebGL fragment-uniform budget for this GPU (~${sizing.safeSpotLights} SpotLights). The shader may spill uniforms — expect lower FPS or, worst case, a black scene. Lower the GUI "Max Spotlights" slider or use ?renderer=webgpu to bypass the WebGL limit.`
        );
      }
    } else {
      console.log(
        `[LightPool] Pool sizing: requested=${_requestedPoolSize}, manualCap=${sizing.manualCap}, using=${_effectivePoolSize}, backend=${sizing.backendName}, reason=${sizing.reason}`
      );
    }

    if (_effectivePoolSize <= 0) {
      console.warn('[LightPool] Pool disabled because the requested SpotLight budget resolved to 0.');
      _initialized = true;
      return;
    }

    console.log(`[LightPool] Initializing pool: size=${_effectivePoolSize}, modelRadius=${radius}`);

    for (let i = 0; i < _effectivePoolSize; i++) {
      const light = new THREE.SpotLight(
        0xffffff,
        0,                           // Start dark
        radius * 3,                  // distance
        THREE.MathUtils.degToRad(20), // angle
        0.5,                         // penumbra
        0.1                          // decay
      );
      createdLights.push(light);
      light.castShadow = false;
      light.position.set(0, -9999, 0); // Park off-screen
      scene.add(light);
      scene.add(light.target);

      _pool.push({
        light,
        active: false,
      });
    }

    _initialized = true;

    // Diagnostic: count all lights in scene
    let spotCount = 0, dirCount = 0, pointCount = 0, hemiCount = 0, otherCount = 0;
    scene.traverse(obj => {
      if (obj.isSpotLight) spotCount++;
      else if (obj.isDirectionalLight) dirCount++;
      else if (obj.isPointLight) pointCount++;
      else if (obj.isHemisphereLight) hemiCount++;
      else if (obj.isLight) otherCount++;
    });
    console.log(`[LightPool] ✅ Initialized ${_effectivePoolSize} pooled SpotLights`);
    console.log(`[LightPool] Scene light census: ${spotCount} Spot, ${dirCount} Dir, ${pointCount} Point, ${hemiCount} Hemi, ${otherCount} Other`);
  } catch (err) {
    console.error(`[LightPool] ❌ FAILED to initialize pool:`, err);
    for (const light of createdLights) {
      light.removeFromParent();
      light.target.removeFromParent();
    }
    _pool.length = 0;
    _requestedPoolSize = 0;
    _effectivePoolSize = 0;
    _initialized = false;
    throw err;
  }
}

/**
 * Collect all pixels that want analytic lighting from all fixtures.
 * Returns an array of { worldPos: Vector3, worldDir: Vector3, color, intensity, angle, penumbra, fixture }
 */
function _collectLightRequests() {
  const requests = _requests;
  requests.length = 0;
  let skippedDark = 0;
  const profile = params.lightingProfile || 'edit';
  const profileDef = getProfileDef(profile);

  // Only collect if analytic lighting is enabled
  if (profileDef.render.analyticLightMode === 'none') return requests;

  const activeView = window.__activePreviewView;
  const parList = window.parFixtures || [];
  const dmxList = window.dmxSceneFixtures || [];
  const fixtureCount = parList.length + dmxList.length;
  for (let f = 0; f < fixtureCount; f++) {
    const fixture = f < parList.length ? parList[f] : dmxList[f - parList.length];
    if (!fixture || !fixture.group) continue;

    // Effects fixtures (fog/haze/horn/fire) are infrastructure — always
    // show their lights if any. The shared predicate covers both the
    // `type` and `fixtureType` config keys.
    const isFog = isEffectsOnlyFixture(fixture.config);

    if (activeView && !isFog) {
      // Word-aware: the bit is read from the view's own mask field
      // (`viewMask` for word 0, `viewMaskHi` for word 1) — see view_registry.
      const isBitMember = fixtureInView(fixture.config, activeView);
      const isGroupMember = activeView.groups && activeView.groups.includes(fixture.config.group);
      if (!isBitMember && !isGroupMember) continue;
    } else {
      if (!fixture.group.visible) continue;
    }
    if (!fixture.pixels || !Array.isArray(fixture.pixels)) continue;

    // Per-fixture On/Off override: a disabled (or zero-brightness) fixture
    // casts no analytic light, freeing its pooled SpotLight. Brightness
    // itself is carried by the (already-scaled) emitter color the requests
    // sample below, so intensity is left untouched — the gain applies once.
    if (typeof fixture.outputGain === 'function' && fixture.outputGain() <= 0) continue;

    const config = fixture.config;
    const intensity = config.intensity || 5;
    const angle = config.angle || 20;
    const penumbra = config.penumbra || 0.5;

    // The emission direction depends only on the FIXTURE's world matrix, so it
    // is the same vector for every pixel of the fixture. It used to be rebuilt
    // (allocation + transformDirection + normalize) once per pixel per frame.
    _tmpVec.set(0, 0, -1).transformDirection(fixture.group.matrixWorld).normalize();

    if (profileDef.render.analyticLightMode === 'pixel') {
      // One request per pixel — use live bulb color if available
      const pixels = fixture.pixels;
      for (let pi = 0; pi < pixels.length; pi++) {
        const p = pixels[pi];

        // Read live per-pixel color (set by the pattern engine each frame). The
        // emitter meshes are now instanced, so the per-pixel color lives on
        // p.color (the source of truth written by _writePixelColor), not a
        // per-pixel material.
        const liveColor = getSafeLightColor(p.color, config);

        // A black pixel casts no light — it must not hold a pool slot that a
        // pixel which IS emitting could use. Recomputed every frame, so the
        // instant this pixel lights up it competes again on distance as before.
        // Tested BEFORE the world transform now: a dark pixel is discarded
        // without ever paying for its matrix multiply.
        if (!emitsVisibleLight(liveColor)) { skippedDark++; continue; }

        const req = nextRequest();
        req.worldPos.copy(p.localPos).applyMatrix4(fixture.group.matrixWorld);
        req.worldDir.copy(_tmpVec);
        req.color = liveColor;
        req.intensity = intensity;
        req.angle = angle;
        req.penumbra = penumbra;
        req.fixture = fixture;
        req.key = getRequestKey(fixture, pi);
      }
    } else if (profileDef.render.analyticLightMode === 'fixture') {
      // One request per fixture — use first pixel's live color
      const firstPixel = fixture.pixels[0];
      const liveColor = getSafeLightColor(firstPixel && firstPixel.color, config);

      if (!emitsVisibleLight(liveColor)) { skippedDark++; continue; }

      const req = nextRequest();
      req.worldPos.setFromMatrixPosition(fixture.group.matrixWorld);
      req.worldDir.copy(_tmpVec);
      req.color = liveColor;
      req.intensity = intensity;
      req.angle = angle;
      req.penumbra = penumbra;
      req.fixture = fixture;
      req.key = getRequestKey(fixture, 0);
    }
  }

  _lastSkippedDark = skippedDark;
  return requests;
}

/**
 * Main orchestrator — call once per frame from animate().
 * Frustum-culls all light requests, distance-sorts the visible ones,
 * and assigns the closest active requests to the pre-allocated SpotLights.
 */
export function updateLightPool() {
  if (!_initialized || !camera) return;

  // One-shot diagnostic
  if (!window._lightPoolFirstLog) {
    window._lightPoolFirstLog = true;
    const profile = params.lightingProfile || 'edit';
    const profileDef = getProfileDef(profile);
    const fixtures = window.parFixtures || [];
    console.log(`[LightPool] First update: profile=${profile}, analyticLightMode=${profileDef.render.analyticLightMode}, fixtures=${fixtures.length}, poolSize=${_pool.length}, activeLimit=${getSafeActiveSpotlightLimit()}, samplingMode=${getSpotlightSamplingMode()}, bucketDistance=${getSafeSpotlightSamplingBucketDistance()}`);
  }

  const profile = params.lightingProfile || 'edit';
  const profileDef = getProfileDef(profile);

  // If analytic lighting is disabled, turn off all pool lights
  if (profileDef.render.analyticLightMode === 'none') {
    for (const slot of _pool) {
      if (slot.active) {
        slot.light.intensity = 0;
        slot.active = false;
      }
    }
    // The lights are being cut here regardless, so the stable strategies must
    // drop their assignments too — otherwise re-enabling the profile would
    // resume fading out fixtures that no longer exist, from stale positions.
    _planner.reset();
    return;
  }

  // 1. Update frustum from camera
  camera.updateMatrixWorld();
  _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreenMatrix);

  // 2. Collect all light requests
  const requests = _collectLightRequests();

  // 3. Frustum cull
  const camPos = camera.position;
  const visible = _visible;
  visible.length = 0;
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    if (_frustum.containsPoint(req.worldPos)) {
      // Calculate squared distance to camera for sorting
      req.distSq = req.worldPos.distanceToSquared(camPos);
      visible.push(req);
    }
  }

  // One-shot diagnostic for assignment
  if (!window._lightPoolAssignLog) {
    window._lightPoolAssignLog = true;
    const radius = modelRadius || 50;
    const iScale = getSpotlightIntensityScale(radius);
    console.log(`[LightPool] Requests: total=${requests.length}, visible=${visible.length}, skippedDark=${_lastSkippedDark}, intensityScale=${iScale.toFixed(2)}, activeLimit=${getSafeActiveSpotlightLimit()}, masterExposure=${getSafeMasterExposure().toFixed(2)}`);
    if (requests.length > 0) {
      const r = requests[0];
      console.log(`[LightPool] Sample request: pos=(${r.worldPos.x.toFixed(1)},${r.worldPos.y.toFixed(1)},${r.worldPos.z.toFixed(1)}), intensity=${r.intensity}, color=rgb(${r.color.r.toFixed(2)},${r.color.g.toFixed(2)},${r.color.b.toFixed(2)})`);
    }
    if (visible.length > 0) {
      const v = visible[0];
      console.log(`[LightPool] Closest visible: pos=(${v.worldPos.x.toFixed(1)},${v.worldPos.y.toFixed(1)},${v.worldPos.z.toFixed(1)}), dist=${Math.sqrt(v.distSq).toFixed(1)}`);
    }
    console.log(`[LightPool] Camera: pos=(${camPos.x.toFixed(1)},${camPos.y.toFixed(1)},${camPos.z.toFixed(1)})`);
  }

  // 4. Sort by distance (closest first).
  // ONLY the three positional strategies consume rank, and this O(V log V) sort
  // exists solely for them. The stable strategies score every request
  // independently and never look at list position, so for them the sort is pure
  // waste — skipping it is the largest single per-frame saving in this path.
  const samplingMode = getSpotlightSamplingMode();
  if (isLegacySpotlightSamplingMode(samplingMode)) {
    visible.sort((a, b) => a.distSq - b.distSq);
  }

  // 5. Assign pool slots
  const radius = modelRadius || 50;
  const intensityScale = getSpotlightIntensityScale(radius);
  const masterExposure = getSafeMasterExposure();
  const plan = _planner.plan({
    mode: samplingMode,
    visible,
    slotBudget: getSafeActiveSpotlightLimit(),
    poolSize: _pool.length,
    bucketDistance: getSafeSpotlightSamplingBucketDistance(),
    modelRadius: radius,
  });

  for (let i = 0; i < _pool.length; i++) {
    const slot = _pool[i];
    const entry = plan[i];

    // `gain` is the crossfade envelope: 1 for the positional strategies (they
    // have no transitions), and the ramp value for the stable ones. A slot at
    // gain 0 is off — mid-handoff, or just released.
    if (entry && entry.gain > 0) {
      const src = entry.source;
      const light = slot.light;

      // Position
      light.position.copy(src.worldPos);

      // Target (direction)
      light.target.position.copy(src.worldPos).addScaledVector(src.worldDir, 100);
      light.target.updateMatrixWorld();

      // Properties
      light.color.copy(src.color);
      light.intensity = src.intensity * intensityScale * masterExposure * entry.gain;
      light.angle = Math.min(THREE.MathUtils.degToRad(src.angle), Math.PI / 2 - 0.1);
      light.penumbra = src.penumbra;
      light.distance = radius * 3;

      slot.active = true;
    } else {
      // No pixel for this slot — turn it off
      if (slot.active) {
        slot.light.intensity = 0;
        slot.light.position.set(0, -9999, 0);
        slot.active = false;
      }
    }
  }
}

/**
 * Update pool light colors from the live pixel data.
 * Called after the pattern engine / DMX router has computed the current frame colors.
 */
export function syncPoolColors() {
  if (!_initialized) return;

  // The pool lights already track their assigned fixture's config color.
  // For dynamic per-pixel color (from Pixelblaze/sACN), we need to
  // re-read the fixture's current pixel colors.
  // This is handled automatically because updateLightPool reads config.color
  // each frame. For pattern-driven color, the fixture.setPixelColorRGB
  // updates the config in real-time.
}

/** Get the pool size for diagnostics */
export function getPoolSize() { return _effectivePoolSize; }
export function getRequestedPoolSize() { return _requestedPoolSize; }
export function getActiveCount() { return _pool.filter(s => s.active).length; }
export function getMaxSpotlightPoolSize() { return MAX_SPOTLIGHT_POOL_SIZE; }
export function isPoolInitialized() { return _initialized; }

/**
 * Upper bound for the GUI "Max Spotlights" slider.
 *
 * The pool is allocated once at boot and the per-frame active limit is clamped
 * to its length, so a slider that ranged past the pool would silently do
 * nothing above it — exactly the lie this module used to tell. Once the pool
 * exists the honest ceiling IS the pool. Before it exists (setupGUI is always
 * called after setupLighting, so this is the no-pool-yet case only) the hard
 * cap is the only bound that is known.
 */
export function getSpotlightSliderMax() {
  if (!_initialized) return getSpotlightSessionCeiling();
  return Math.max(1, _effectivePoolSize);
}
