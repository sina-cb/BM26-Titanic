/**
 * url_overrides.js — Authoritative boot-time URL parameter overrides.
 *
 * The launcher (and operators) drive the sim's boot configuration through
 * query params: `?profile=`, `?lighting_mode=`, `?renderer=`, `?spotlights=`.
 * These MUST win over whatever the scene/common YAML or any persisted state
 * put into the config tree, and they must win BEFORE any boot consumer reads
 * them.
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
import {
  MAX_SPOTLIGHT_POOL_SIZE,
  SPOTLIGHT_ABSOLUTE_CEILING,
  clearSpotlightSessionCeiling,
  raiseSpotlightSessionCeiling,
  showSpotlightCapToast,
} from "./light_pool.js";

const VALID_LIGHTING_MODES = ["gradient", "pixelblaze", "sacn_in"];
const VALID_RENDERER_MODES = ["webgpu", "webgl"];
// `?spotlights=` accepts an integer literal only. "80px", "8e1" and "" are
// operator typos, not budgets, and are refused loudly rather than coerced.
const INTEGER_LITERAL = /^[+-]?\d+$/;

/**
 * Resolve the boot SpotLight budget from a raw `?spotlights=` string.
 * Pure — no params/DOM writes — so the precedence chain is unit-testable.
 *
 * Three outcomes:
 *   • `0..MAX_SPOTLIGHT_POOL_SIZE`  → applied as-is, no prompt.
 *   • over the cap, up to `SPOTLIGHT_ABSOLUTE_CEILING` → `needsConfirm: true`.
 *     `value` carries the DECLINE outcome (the hard cap), so a caller that
 *     never asks, or asks and is told no, keeps exactly the old behaviour.
 *   • above the absolute ceiling, negative, or not an integer → refused. There
 *     is nothing to consent to: `?spotlights=999999` is a typo, not a budget.
 *
 * @param {string} raw the raw query-param value
 * @returns {{ok: boolean, value?: number, requested?: number, capped?: boolean,
 *            needsConfirm?: boolean, reason?: string}}
 */
export function resolveSpotlightsUrlValue(raw) {
  const text = String(raw).trim();
  if (!INTEGER_LITERAL.test(text)) {
    return { ok: false, reason: `not an integer (expected 0..${MAX_SPOTLIGHT_POOL_SIZE})` };
  }
  const requested = Number.parseInt(text, 10);
  if (requested < 0) {
    return { ok: false, requested, reason: `negative (expected 0..${MAX_SPOTLIGHT_POOL_SIZE})` };
  }
  if (requested > SPOTLIGHT_ABSOLUTE_CEILING) {
    return {
      ok: false,
      requested,
      reason: `above the absolute ceiling (${SPOTLIGHT_ABSOLUTE_CEILING}) — that many ` +
        'SpotLights cannot render on any GPU, so this is a typo, not a budget',
    };
  }
  if (requested > MAX_SPOTLIGHT_POOL_SIZE) {
    return { ok: true, value: MAX_SPOTLIGHT_POOL_SIZE, requested, capped: true, needsConfirm: true };
  }
  return { ok: true, value: requested, requested, capped: false };
}

/**
 * The text of the over-cap boot prompt. Exported so tests pin the wording the
 * operator is actually asked to consent to.
 *
 * @param {number} requested
 * @returns {string}
 */
export function buildSpotlightOverCapPrompt(requested) {
  return (
    `URL requests ${requested} spotlights, above the safe cap of ${MAX_SPOTLIGHT_POOL_SIZE}.\n\n` +
    'Running this many can white- or black-screen the GPU (the threshold is ~160 on some ' +
    'machines — Mac WebGPU especially) and costs frame rate everywhere else.\n\n' +
    `Accept ${requested} for THIS SESSION ONLY?\n\n` +
    `OK — allocate ${requested} SpotLights now. Nothing is saved: the scene file still ` +
    `records at most ${MAX_SPOTLIGHT_POOL_SIZE}, and the next boot asks again.\n` +
    `Cancel — use ${MAX_SPOTLIGHT_POOL_SIZE} (the normal clamp).`
  );
}

/**
 * Production wiring of the over-cap prompt: the browser's own blocking
 * confirm(). It has to block, because the answer decides how many SpotLights
 * initLightPool() allocates a few synchronous steps later — the themed
 * showModal() in scene_manager.js is Promise-based and its overlay does not
 * exist this early in boot, so it cannot gate a synchronous boot step.
 *
 * No dialog available (headless render tools, a stripped embed) means no
 * consent, which means DECLINE — loudly. There is no timeout that auto-accepts
 * and no remembered answer: every over-cap session asks again.
 */
function defaultSpotlightOverCapConfirm(requested) {
  if (typeof globalThis.confirm !== "function") {
    console.error(
      `[url_overrides] ?spotlights=${requested} is over the cap but this context has no ` +
      `confirm() dialog — DECLINING and using ${MAX_SPOTLIGHT_POOL_SIZE}. An over-cap ` +
      'SpotLight budget requires an explicit operator yes.'
    );
    return false;
  }
  return globalThis.confirm(buildSpotlightOverCapPrompt(requested)) === true;
}

/**
 * Ask, and turn anything ambiguous into a decline. A prompt that throws or
 * answers with a non-boolean has not produced consent, and consent is the only
 * thing that may raise the cap.
 */
function askSpotlightOverCap(requested, ask) {
  let answer;
  try {
    answer = ask(requested);
  } catch (err) {
    console.error(
      `[url_overrides] the over-cap ?spotlights=${requested} prompt threw ` +
      `(${err && err.message}) — DECLINING.`
    );
    return false;
  }
  if (typeof answer !== "boolean") {
    console.error(
      `[url_overrides] the over-cap ?spotlights=${requested} prompt answered ` +
      `${JSON.stringify(answer)} — expected a boolean. DECLINING.`
    );
    return false;
  }
  return answer;
}

/**
 * Apply all boot-time URL overrides to the live `params` and to the config
 * tree (so the GUI controllers, which bind to either, render the final value).
 * Call this exactly once, immediately after extractParams() during bootstrap.
 *
 * @param {URLSearchParams} urlParams
 * @param {{confirmSpotlightOverCap?: (requested: number) => boolean}} [deps]
 *   injection seam for the over-cap prompt, so the boot gate is testable
 *   headless. Production uses the browser confirm() by default.
 */
export function applyBootUrlOverrides(urlParams, deps = {}) {
  const confirmSpotlightOverCap = deps.confirmSpotlightOverCap || defaultSpotlightOverCapConfirm;
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

  // ── SpotLight budget ──
  // `?spotlights=N` sets `params.maxSpotlights`, and initLightPool() sizes the
  // pre-allocated SpotLight pool from that resolved value — so this single
  // number decides both how many SpotLights exist and how many may be lit at
  // once. Handled here (not at light_pool module load) so the override is
  // applied in one place, before setupLighting(), and lands in BOTH params and
  // the config tree like every other override.
  //
  // Over the cap, the operator is ASKED (blocking, before the pool is
  // allocated) whether to run the requested count anyway. Accepting raises the
  // ceiling for this session only — nothing about that answer is remembered:
  // no localStorage, and clampPersistedSpotlightBudget() keeps the raise out of
  // scene_config.yaml on save. Declining is the old behaviour exactly: clamp to
  // the cap, loudly, with the toast.
  const spotlightsOverride = urlParams.get("spotlights");
  // Every boot starts at the hard cap. Only this boot's own accepted prompt
  // may raise it — never a saved value, never the previous session.
  clearSpotlightSessionCeiling();
  if (spotlightsOverride !== null) {
    const resolved = resolveSpotlightsUrlValue(spotlightsOverride);
    if (!resolved.ok) {
      console.error(
        `[url_overrides] Ignoring invalid ?spotlights='${spotlightsOverride}' — ${resolved.reason}. ` +
        `Keeping config value '${params.maxSpotlights}'.`
      );
    } else {
      let applied = resolved.value;
      if (resolved.needsConfirm && askSpotlightOverCap(resolved.requested, confirmSpotlightOverCap)) {
        raiseSpotlightSessionCeiling(resolved.requested);
        applied = resolved.requested;
        console.warn(
          `[url_overrides] over-cap ?spotlights=${applied} ACCEPTED by the operator — running ` +
          `${applied} SpotLights for THIS SESSION ONLY (hard cap ${MAX_SPOTLIGHT_POOL_SIZE}). ` +
          'Not saved, not remembered: the next boot asks again.'
        );
      } else if (resolved.capped) {
        console.error(
          `[url_overrides] ?spotlights=${resolved.requested} exceeds the preview pool cap ` +
          `(${MAX_SPOTLIGHT_POOL_SIZE}). Using ${resolved.value}.`
        );
        showSpotlightCapToast(resolved.requested, resolved.value);
      }
      params.maxSpotlights = applied;
      if (configTree && configTree.parLights && configTree.parLights.maxSpotlights) {
        configTree.parLights.maxSpotlights.value = applied;
      }
      console.log(`[url_overrides] maxSpotlights → ${applied} (URL wins over config/saved state)`);
    }
  }
}
