/**
 * url_overrides.js — Authoritative boot-time URL parameter overrides.
 *
 * The launcher (and operators) drive the sim's boot configuration through
 * query params: `?profile=`, `?lighting_mode=`, `?renderer=`. These MUST win
 * over whatever the scene/common YAML or any persisted state put into the
 * config tree, and they must win BEFORE any boot consumer reads them.
 *
 * Why this module exists (root cause of the prod-profile bug):
 *   The old `?profile=` handling lived deep inside setupGUI() — the very last
 *   step of onModelLoaded(). By then setupLighting() had already built the
 *   heavy analytic SpotLight rig from the stale `full` value extracted from
 *   common.yaml, and the late override only partially unwound it. Applying the
 *   overrides here, immediately after extractParams(), makes the override
 *   deterministic and order-independent: setupLighting, the light pool,
 *   rebuildParLights, and BOTH the legacy and modern UIs all see the final
 *   value from the start.
 *
 * Codex P0: no fallbacks. An explicitly-supplied but invalid value is a loud
 * error (we keep the YAML value and log), never a silent substitution.
 */
import { params, configTree } from "./state.js";
import { LIGHTING_PROFILES } from "./profile_registry.js";

const VALID_LIGHTING_MODES = ["gradient", "pixelblaze", "sacn_in"];
const VALID_RENDERER_MODES = ["webgpu", "webgl"];

/**
 * Apply all boot-time URL overrides to the live `params` and to the config
 * tree (so the GUI controllers, which bind to either, render the final value).
 * Call this exactly once, immediately after extractParams() during bootstrap.
 *
 * @param {URLSearchParams} urlParams
 */
export function applyBootUrlOverrides(urlParams) {
  // ── Lighting profile (the prod-profile bug) ──
  const profileOverride = urlParams.get("profile");
  if (profileOverride !== null) {
    if (LIGHTING_PROFILES[profileOverride]) {
      params.lightingProfile = profileOverride;
      if (configTree && configTree.options && configTree.options.lightingProfile) {
        configTree.options.lightingProfile.value = profileOverride;
      }
      console.log(`[url_overrides] lightingProfile → '${profileOverride}' (URL wins over config/saved state)`);
    } else {
      console.error(
        `[url_overrides] Ignoring invalid ?profile='${profileOverride}' ` +
        `(valid: ${Object.keys(LIGHTING_PROFILES).join(", ")}). Keeping config value '${params.lightingProfile}'.`
      );
    }
  }

  // ── Lighting mode ──
  const lightingModeOverride = urlParams.get("lighting_mode");
  if (lightingModeOverride !== null) {
    if (VALID_LIGHTING_MODES.includes(lightingModeOverride)) {
      params.lightingMode = lightingModeOverride;
      if (configTree && configTree.colorWave && configTree.colorWave.lightingMode) {
        configTree.colorWave.lightingMode.value = lightingModeOverride;
      }
      console.log(`[url_overrides] lightingMode → '${lightingModeOverride}'`);
    } else {
      console.error(
        `[url_overrides] Ignoring invalid ?lighting_mode='${lightingModeOverride}' ` +
        `(valid: ${VALID_LIGHTING_MODES.join(", ")}).`
      );
    }
  }

  // ── Renderer mode ──
  // main.js#getRequestedRendererMode() already reads ?renderer= when creating
  // the renderer; this only syncs params + config so the GUI shows the truth.
  const rendererOverride = urlParams.get("renderer");
  if (rendererOverride !== null) {
    if (VALID_RENDERER_MODES.includes(rendererOverride)) {
      params.rendererMode = rendererOverride;
      if (configTree && configTree.options && configTree.options.rendererMode) {
        configTree.options.rendererMode.value = rendererOverride;
      }
      console.log(`[url_overrides] rendererMode → '${rendererOverride}'`);
    } else {
      console.error(
        `[url_overrides] Ignoring invalid ?renderer='${rendererOverride}' ` +
        `(valid: ${VALID_RENDERER_MODES.join(", ")}).`
      );
    }
  }
}
