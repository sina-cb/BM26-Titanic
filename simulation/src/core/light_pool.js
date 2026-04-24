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

// ── Pool Configuration ──────────────────────────────────────────────────
const _urlParams = new URLSearchParams(window.location.search);
const DEFAULT_POOL_SIZE = 150;
export const MAX_SPOTLIGHT_POOL_SIZE = 200; // Manual hard cap for ?spotlights=N and pool allocation
const DEFAULT_SPOTLIGHT_SAMPLING_MODE = 'closest';
const SPOTLIGHT_SAMPLING_BUCKET_MIN = 2;
const SPOTLIGHT_SAMPLING_BUCKET_MAX = 20;
const DEFAULT_SPOTLIGHT_SAMPLING_BUCKET_DISTANCE = 10;
const GPU_SAFE_FRAGMENT_VECTOR_RESERVE = 64;
const GPU_SAFE_VECTORS_PER_SPOTLIGHT = 16;
const SPOTLIGHT_INTENSITY_SCALE_PER_RADIUS = 0.04;
const MIN_SPOTLIGHT_INTENSITY_SCALE = 0.75;
const _requestedPoolSizeRaw = Number.parseInt(_urlParams.get('spotlights') || `${DEFAULT_POOL_SIZE}`, 10);
const REQUESTED_POOL_SIZE = Number.isFinite(_requestedPoolSizeRaw)
  ? Math.max(0, _requestedPoolSizeRaw)
  : DEFAULT_POOL_SIZE;

// ── Pool State ──────────────────────────────────────────────────────────
let _pool = [];           // Array of { light: THREE.SpotLight, target: THREE.Object3D, active: bool }
let _initialized = false;
let _effectivePoolSize = REQUESTED_POOL_SIZE;
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _tmpVec = new THREE.Vector3();

function showSpotlightCapToast(requestedSize, cappedSize) {
  const renderToast = () => {
    let toast = document.getElementById('spotlight-cap-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'spotlight-cap-toast';
      toast.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#3a1a1a;border:1px solid #f66;color:#ffb3b3;padding:10px 24px;border-radius:8px;font-family:Inter,sans-serif;font-size:13px;white-space:pre-line;pointer-events:none;z-index:999;opacity:0;transition:opacity 0.3s;max-width:560px;';
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

function resolveEffectivePoolSize() {
  const backendName = renderer?.backend?.constructor?.name || 'unknown';
  const manualCap = MAX_SPOTLIGHT_POOL_SIZE;
  const cappedRequested = Math.min(REQUESTED_POOL_SIZE, manualCap);

  if (!renderer || typeof renderer.getContext !== 'function') {
    return {
      backendName,
      manualCap,
      reason: 'renderer context unavailable',
      requested: REQUESTED_POOL_SIZE,
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
        requested: REQUESTED_POOL_SIZE,
        size: cappedRequested,
      };
    }

    const maxVectors = context.getParameter(context.MAX_FRAGMENT_UNIFORM_VECTORS);
    const safeSpotLights = Math.max(
      0,
      Math.floor((maxVectors - GPU_SAFE_FRAGMENT_VECTOR_RESERVE) / GPU_SAFE_VECTORS_PER_SPOTLIGHT)
    );

    return {
      backendName,
      manualCap,
      maxVectors,
      requested: REQUESTED_POOL_SIZE,
      safeSpotLights,
      size: cappedRequested,
    };
  } catch (err) {
    console.warn('[LightPool] Failed to inspect GPU uniform limits. Falling back to requested pool size.', err);
    return {
      backendName,
      manualCap,
      reason: err?.message || 'uniform query failed',
      requested: REQUESTED_POOL_SIZE,
      size: cappedRequested,
    };
  }
}

function getSafeLightColor(sourceColor, fallbackColor) {
  if (
    sourceColor
    && Number.isFinite(sourceColor.r)
    && Number.isFinite(sourceColor.g)
    && Number.isFinite(sourceColor.b)
  ) {
    return sourceColor.clone();
  }

  return new THREE.Color(fallbackColor || '#ffaa44');
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

function getSafeSpotlightSamplingMode() {
  return params.spotlightSamplingMode === 'closest_bucket'
    ? 'closest_bucket'
    : DEFAULT_SPOTLIGHT_SAMPLING_MODE;
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

function sampleUniformRequests(sortedRequests, sampleCount) {
  if (sampleCount <= 0 || sortedRequests.length === 0) return [];
  if (sortedRequests.length <= sampleCount) return sortedRequests;
  if (sampleCount === 1) return [sortedRequests[sortedRequests.length - 1]];

  const selected = [];
  for (let i = 0; i < sampleCount; i++) {
    const start = Math.floor((i * sortedRequests.length) / sampleCount);
    const end = Math.max(start, Math.floor(((i + 1) * sortedRequests.length) / sampleCount) - 1);
    const midpoint = Math.floor((start + end) / 2);
    selected.push(sortedRequests[midpoint]);
  }
  return selected;
}

function selectVisibleRequestsForSampling(visible, camPos, activeLimit) {
  if (activeLimit <= 0 || visible.length === 0) return [];

  const samplingMode = getSafeSpotlightSamplingMode();
  if (samplingMode === 'closest') {
    return visible.slice(0, activeLimit);
  }

  const closestRequest = visible[0];
  const closestDistance = Math.sqrt(closestRequest.distSq);
  if (closestDistance <= 0) {
    return visible.slice(0, activeLimit);
  }

  const bucketDistance = getSafeSpotlightSamplingBucketDistance();
  const bucketMin = closestDistance;
  const bucketMax = closestDistance + bucketDistance;

  const bucketRequests = [];
  for (const req of visible) {
    const distance = Math.sqrt(req.distSq);
    if (distance >= bucketMin && distance <= bucketMax) {
      req.bucketDepth = distance;
      bucketRequests.push(req);
    }
  }

  if (bucketRequests.length === 0) {
    return visible.slice(0, activeLimit);
  }

  bucketRequests.sort((a, b) => {
    if (a.bucketDepth !== b.bucketDepth) return a.bucketDepth - b.bucketDepth;
    return a.distSq - b.distSq;
  });

  return sampleUniformRequests(bucketRequests, Math.min(activeLimit, bucketRequests.length));
}

/**
 * Initialize the SpotLight pool. Call ONCE after scene and camera are ready.
 * All lights start invisible (intensity=0) so they don't affect the scene
 * until the orchestrator assigns them.
 */
export function initLightPool() {
  if (_initialized) return;

  try {
    const radius = modelRadius || 50;
    const sizing = resolveEffectivePoolSize();
    _effectivePoolSize = sizing.size;

    if (_urlParams.has('spotlights')) {
      params.maxSpotlights = _effectivePoolSize;
      if (Number.isFinite(_requestedPoolSizeRaw) && _requestedPoolSizeRaw > MAX_SPOTLIGHT_POOL_SIZE) {
        showSpotlightCapToast(_requestedPoolSizeRaw, _effectivePoolSize);
      }
    }

    if (sizing.maxVectors !== undefined) {
      console.log(
        `[LightPool] WebGL uniform estimate: maxVectors=${sizing.maxVectors}, safeSpotLights=${sizing.safeSpotLights}, requested=${REQUESTED_POOL_SIZE}, manualCap=${sizing.manualCap}, using=${_effectivePoolSize}`
      );
      if (_effectivePoolSize > sizing.safeSpotLights) {
        console.warn(
          `[LightPool] Manual cap exceeds the estimated WebGL-safe spotlight budget (${sizing.safeSpotLights}). If the scene goes black, lower ?spotlights= or MAX_SPOTLIGHT_POOL_SIZE.`
        );
      }
    } else {
      console.log(
        `[LightPool] Pool sizing: requested=${REQUESTED_POOL_SIZE}, manualCap=${sizing.manualCap}, using=${_effectivePoolSize}, backend=${sizing.backendName}, reason=${sizing.reason}`
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
  }
}

/**
 * Collect all pixels that want analytic lighting from all fixtures.
 * Returns an array of { worldPos: Vector3, worldDir: Vector3, color, intensity, angle, penumbra, fixture }
 */
function _collectLightRequests() {
  const requests = [];
  const profile = params.lightingProfile || 'edit';
  const profileDef = getProfileDef(profile);

  // Only collect if analytic lighting is enabled
  if (profileDef.render.analyticLightMode === 'none') return requests;

  const fixtureList = window.parFixtures || [];
  for (const fixture of fixtureList) {
    if (!fixture || !fixture.group || !fixture.group.visible) continue;
    if (!fixture.pixels || !Array.isArray(fixture.pixels)) continue;

    const config = fixture.config;
    const intensity = config.intensity || 5;
    const angle = config.angle || 20;
    const penumbra = config.penumbra || 0.5;

    if (profileDef.render.analyticLightMode === 'pixel') {
      // One request per pixel — use live bulb color if available
      for (const p of fixture.pixels) {
        const worldPos = p.localPos.clone().applyMatrix4(fixture.group.matrixWorld);
        const dirLocal = new THREE.Vector3(0, 0, -1);
        const worldDir = dirLocal.transformDirection(fixture.group.matrixWorld).normalize();

        // Read live color from bulb material (set by pattern engine each frame)
        const liveColor = getSafeLightColor(
          p.bulbMat && p.bulbMat.color,
          config.color
        );

        requests.push({
          worldPos,
          worldDir,
          color: liveColor,
          intensity,
          angle,
          penumbra,
          fixture,
        });
      }
    } else if (profileDef.render.analyticLightMode === 'fixture') {
      // One request per fixture — use first pixel's live color
      const worldPos = new THREE.Vector3().setFromMatrixPosition(fixture.group.matrixWorld);
      const dirLocal = new THREE.Vector3(0, 0, -1);
      const worldDir = dirLocal.transformDirection(fixture.group.matrixWorld).normalize();

      const firstPixel = fixture.pixels[0];
      const liveColor = getSafeLightColor(
        firstPixel && firstPixel.bulbMat && firstPixel.bulbMat.color,
        config.color
      );

      requests.push({
        worldPos,
        worldDir,
        color: liveColor,
        intensity,
        angle,
        penumbra,
        fixture,
      });
    }
  }

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
    console.log(`[LightPool] First update: profile=${profile}, analyticLightMode=${profileDef.render.analyticLightMode}, fixtures=${fixtures.length}, poolSize=${_pool.length}, activeLimit=${getSafeActiveSpotlightLimit()}, samplingMode=${getSafeSpotlightSamplingMode()}, bucketDistance=${getSafeSpotlightSamplingBucketDistance()}`);
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
  const visible = [];
  for (const req of requests) {
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
    console.log(`[LightPool] Requests: total=${requests.length}, visible=${visible.length}, intensityScale=${iScale.toFixed(2)}, activeLimit=${getSafeActiveSpotlightLimit()}, masterExposure=${getSafeMasterExposure().toFixed(2)}`);
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

  // 4. Sort by distance (closest first)
  visible.sort((a, b) => a.distSq - b.distSq);

  // 5. Assign pool slots
  const radius = modelRadius || 50;
  const intensityScale = getSpotlightIntensityScale(radius);
  const masterExposure = getSafeMasterExposure();
  const activeLimit = Math.min(visible.length, getSafeActiveSpotlightLimit());
  const sampledRequests = selectVisibleRequestsForSampling(visible, camPos, activeLimit);

  for (let i = 0; i < _pool.length; i++) {
    const slot = _pool[i];

    if (i < sampledRequests.length) {
      const req = sampledRequests[i];
      const light = slot.light;

      // Position
      light.position.copy(req.worldPos);

      // Target (direction)
      light.target.position.copy(req.worldPos).add(
        req.worldDir.clone().multiplyScalar(100)
      );
      light.target.updateMatrixWorld();

      // Properties
      light.color.copy(req.color);
      light.intensity = req.intensity * intensityScale * masterExposure;
      light.angle = Math.min(THREE.MathUtils.degToRad(req.angle), Math.PI / 2 - 0.1);
      light.penumbra = req.penumbra;
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
export function getRequestedPoolSize() { return REQUESTED_POOL_SIZE; }
export function getActiveCount() { return _pool.filter(s => s.active).length; }
export function getMaxSpotlightPoolSize() { return MAX_SPOTLIGHT_POOL_SIZE; }
