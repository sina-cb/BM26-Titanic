# WebGPU/WebGL SpotLight Rendering Failure — Debug Report

**Date:** 2026-04-24  
**Reporter:** Antigravity Agent  
**Severity:** P0 — Scene completely unlit, ship invisible  
**Affected Profiles:** All profiles when `light_pool.js` is active (pool adds SpotLights to scene regardless of profile)

---

## Symptom

When loading the Titanic simulation with the `full` lighting profile, the ship hull (`MeshStandardMaterial`) renders as **completely black**. Only `MeshBasicMaterial` objects (LED pixel dots, star field) remain visible. The moonlight (`DirectionalLight`, intensity 0.5) and hemisphere light (`HemisphereLight`, intensity 0.3) have **no visible effect** on the hull.

Switching to other profiles (`emissive`, `edit`) does **not** restore visibility — the ship remains black in all modes.

## Environment

- **Renderer:** `THREE.WebGPURenderer` with `forceWebGL: true` (URL param `renderer=webgl`)
- **Backend:** WebGL2 (log shows `[WebGPU] Renderer initialized: TN` — TN = ThreeNodeBackend, the WebGL fallback)
- **Three.js:** v0.177.0 via CDN (`three.webgpu.min.js`)
- **Model:** Titanic FBX — 511 meshes, `modelRadius ≈ 52.7`
- **Fixture count:** 61 fixtures (each with multiple pixels, totaling ~480 pixel entries)

## Root Cause Analysis

### The Shader Uniform Overflow Hypothesis

The most likely cause is **silent WebGL shader compilation failure** due to exceeding `MAX_FRAGMENT_UNIFORM_VECTORS`.

#### How WebGL handles lights

When Three.js renders a `MeshStandardMaterial`, it compiles a GLSL shader that includes uniform arrays sized to the number of lights in the scene:

```glsl
uniform SpotLight spotLights[NUM_SPOT_LIGHTS];  // Each SpotLight ≈ 12-16 uniform vectors
uniform DirectionalLight directionalLights[NUM_DIR_LIGHTS];
```

The WebGL2 spec guarantees a **minimum** of 256 `MAX_FRAGMENT_UNIFORM_VECTORS`. Each `SpotLight` consumes approximately **12-16 uniform vectors** (position, direction, color, distance, decay, coneCos, penumbraCos, shadow params).

#### Current light count

From the diagnostic log:
```
[LightPool] Scene light census: 50 Spot, 1 Dir, 0 Point, 1 Hemi, 0 Other
```

**50 SpotLights × ~16 vectors = ~800 vectors** — this massively exceeds the 256 minimum and likely exceeds most desktop GPUs' 512-1024 limit.

#### Why the shader fails silently

Three.js's `WebGPURenderer` (in WebGL fallback mode) does **not** surface shader compilation errors to the JavaScript console. When the shader fails to link, the material simply renders as black. There is no error, no warning, no fallback. The moonlight and hemisphere light are part of the **same shader** — when it fails to compile, ALL lighting is lost, not just the SpotLights.

### Evidence

| Pool Size | Ship Visible? | Notes |
|-----------|--------------|-------|
| 0 (pre-pool, no SpotLights) | ✅ Yes | Moonlight + hemisphere visible |
| 10 (per-fixture cap) | ✅ Yes | Confirmed working by user |
| 50 (current default) | ❌ No | All black |
| 100 (previous attempt) | ❌ No | All black |

The threshold is somewhere between 10 and 50. This is consistent with a GPU that has `MAX_FRAGMENT_UNIFORM_VECTORS ≈ 256-512`.

## Architecture Context

### Current Architecture: SpotLight Object Pool (`light_pool.js`)

The pool was designed to solve the problem of WebGPU shader **recompilation crashes** caused by adding/removing SpotLights dynamically. The architecture:

1. **`initLightPool()`** — Called from `setupLighting()` in `environment.js`, after moonlight + hemisphere are added. Pre-allocates `POOL_SIZE` SpotLights with `intensity=0`.
2. **`updateLightPool()`** — Called every frame from `animate()`. Frustum-culls all fixture pixels, distance-sorts them, assigns the N closest to the pool.
3. **`dmx_fixture_runtime.js`** — Fixtures no longer create ANY `THREE.SpotLight` or `THREE.PointLight` objects. They only maintain visual geometry (bulbs, halos, beams).

### Key Files

| File | Role |
|------|------|
| [`light_pool.js`](file:///c:/Users/sina_/workspace/BM26-Titanic/simulation/src/core/light_pool.js) | SpotLight pool init + per-frame orchestrator |
| [`dmx_fixture_runtime.js`](file:///c:/Users/sina_/workspace/BM26-Titanic/simulation/src/fixtures/dmx_fixture_runtime.js) | Fixture visual geometry (no lights) |
| [`environment.js`](file:///c:/Users/sina_/workspace/BM26-Titanic/simulation/src/core/environment.js) | Moonlight + hemisphere + calls `initLightPool()` |
| [`animate.js`](file:///c:/Users/sina_/workspace/BM26-Titanic/simulation/src/core/animate.js) | Render loop, calls `updateLightPool()` |
| [`profile_registry.js`](file:///c:/Users/sina_/workspace/BM26-Titanic/simulation/src/core/profile_registry.js) | Profile definitions (`analyticLightMode`) |
| [`main.js`](file:///c:/Users/sina_/workspace/BM26-Titanic/simulation/main.js) | Renderer init (`WebGPURenderer` + `forceWebGL`) |

### Relevant Code Snippets

**Pool initialization** (`light_pool.js:32-75`):
```javascript
export function initLightPool() {
  if (_initialized) return;
  try {
    const radius = modelRadius || 50;
    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new THREE.SpotLight(0xffffff, 0, radius * 3,
        THREE.MathUtils.degToRad(20), 0.5, 0.1);
      light.castShadow = false;
      light.position.set(0, -9999, 0);
      scene.add(light);
      scene.add(light.target);
      _pool.push({ light, active: false });
    }
    _initialized = true;
  } catch (err) {
    console.error(`[LightPool] FAILED:`, err);
  }
}
```

**Pool size from URL** (`light_pool.js:17-18`):
```javascript
const _urlParams = new URLSearchParams(window.location.search);
const POOL_SIZE = Math.max(1, parseInt(_urlParams.get('spotlights') || '50', 10));
```

**Renderer setup** (`main.js:42-46`):
```javascript
const renderer = new THREE.WebGPURenderer({
  powerPreference: "high-performance",
  forceWebGL: forceWebGL,  // true when ?renderer=webgl
});
await renderer.init();
```

**Hull material** (`environment.js:116-122`):
```javascript
structureMaterial = new THREE.MeshStandardMaterial({
  color: 0xd4c4a8,
  roughness: 0.72,
  metalness: 0.08,
  side: THREE.DoubleSide,
  flatShading: false,
});
```

## Diagnostic Logs (Working State)

```
[Lighting] setupLighting: modelSize.y=16.25, modelRadius=52.73
[Lighting] ✅ Moonlight added (intensity=0.5)
[Lighting] ✅ Hemisphere added (intensity=0.3)
[Lighting] Rebuilding par lights...
[fixtures] rebuildParLights: 61 fixtures, scene=true, liteMode=false
[Lighting] ✅ Par lights rebuilt
[LightPool] Initializing pool: size=50, modelRadius=52.73
[LightPool] ✅ Initialized 50 pooled SpotLights
[LightPool] Scene light census: 50 Spot, 1 Dir, 0 Point, 1 Hemi, 0 Other
[LightPool] First update: profile=full, analyticLightMode=pixel, fixtures=61, poolSize=50
```

No errors in console. Ship is completely black.

## Recommended Fix

### Option A: Detect GPU Uniform Limit (Recommended)

Query the GPU's actual uniform limit and cap the pool size accordingly:

```javascript
// In initLightPool(), after renderer is available:
const gl = renderer.getContext();
if (gl) {
  const maxVectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
  const safeSpotLights = Math.floor((maxVectors - 64) / 16); // Reserve 64 for other uniforms
  const effectivePoolSize = Math.min(POOL_SIZE, safeSpotLights);
  console.log(`[LightPool] GPU max vectors=${maxVectors}, safe SpotLights=${safeSpotLights}, using=${effectivePoolSize}`);
}
```

### Option B: Immediate — Lower Default to 10

Change the default pool size from 50 to 10 (the validated working value):

```javascript
const POOL_SIZE = Math.max(1, parseInt(_urlParams.get('spotlights') || '10', 10));
```

### Option C: WebGPU-Only Pooling

Only initialize the pool when using native WebGPU (not the WebGL fallback), since native WebGPU has no uniform vector limit:

```javascript
const isNativeWebGPU = renderer.backend?.constructor?.name !== 'TN';
if (isNativeWebGPU) {
  initLightPool();  // Full pool
} else {
  initLightPool(10);  // Capped for WebGL
}
```

## Questions for Expert

1. Should we query `MAX_FRAGMENT_UNIFORM_VECTORS` at runtime and auto-cap the pool? 
2. Is there a way to surface Three.js shader compilation errors when using `WebGPURenderer` in WebGL fallback mode?
3. Should the pool be completely skipped when `analyticLightMode === 'none'`, and only instantiated on the first profile switch to `full`? This would prevent shader bloat in non-lighting profiles.
4. For native WebGPU (not WebGL fallback), does the uniform limit still apply, or can we safely use 100+ SpotLights?
