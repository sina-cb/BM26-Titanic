/*
 * actions.js — execute ONE cue action against the engine via the EngineLink.
 * The Timeline Companion decides WHEN (triggers.js, pure); this is the WHEN→
 * WHAT bridge: it translates a validated action object (docs/38 §3.2) into the
 * engine's existing REST surface. It never renders, never owns the CPC — it
 * only loads playlists, flips autopilot, pushes palettes/globals, switches
 * scenes, and toggles scheduled tasks (docs/38 §2.1: companion = driver).
 *
 * Codex P0 — FAIL LOUD: every engine call is awaited and any rejection
 * propagates. A cue pointing at a missing look / palette / playlist throws so
 * the server records it as a per-cue error (red in the UI), never a silent
 * skip. `applyAction` returns { steps:[...] } describing exactly what ran so
 * the operator can see the dispatch in the recent-fires log.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Default config.yaml path (engine root). Callers may override via configPath.
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', 'config.yaml');

/**
 * Resolve an action `target` into a concrete channel list.
 *   { channel:'deck' }       → [{ kind:'deck' }]
 *   { channel:'mixer', id }  → [{ kind:'mixer', id }]
 *   { channel:'all' }        → deck + every mixer channel id (from the engine)
 * Default target is the deck. Throws if a mixer target omits its id.
 */
export async function resolveTargets(target, engineLink) {
  const t = target || { channel: 'deck', id: null };
  if (t.channel === 'deck') return [{ kind: 'deck' }];
  if (t.channel === 'mixer') {
    if (!t.id) throw new Error('action target channel "mixer" requires an id');
    return [{ kind: 'mixer', id: t.id }];
  }
  if (t.channel === 'all') {
    const mixer = await engineLink.getMixer();
    const channels = Array.isArray(mixer && mixer.channels) ? mixer.channels : [];
    const out = [{ kind: 'deck' }];
    for (const ch of channels) {
      if (ch && ch.id !== undefined && ch.id !== null) out.push({ kind: 'mixer', id: ch.id });
    }
    return out;
  }
  throw new Error(`unknown action target channel "${t.channel}"`);
}

/**
 * Resolve a colorPalette id from config.yaml → a setParamCenter body that sets
 * both palette slots from the palette's c1/c2 hues. Throws if the id is not
 * found (a cue referencing a missing palette must fail loud).
 */
export function resolvePalette(id, configPath = DEFAULT_CONFIG_PATH) {
  const text = fs.readFileSync(configPath, 'utf8');
  const cfg = yaml.load(text);
  const palettes = cfg && Array.isArray(cfg.colorPalettes) ? cfg.colorPalettes : [];
  const entry = palettes.find((p) => p && p.id === id);
  if (!entry) throw new Error(`palette "${id}" not found in ${configPath}`);
  return {
    colorPalette1: { h: entry.c1, s: 1, v: 1 },
    colorPalette2: { h: entry.c2, s: 1, v: 1 },
  };
}

// Load a playlist onto a single resolved target.
async function loadPlaylistOnTarget(target, name, engineLink) {
  if (target.kind === 'deck') {
    await engineLink.loadDeckPlaylist(name);
    return `deck ← playlist "${name}"`;
  }
  await engineLink.loadMixerPlaylist(target.id, name);
  return `mixer:${target.id} ← playlist "${name}"`;
}

// Set autopilot on a single resolved target.
async function setAutopilotOnTarget(target, autopilot, engineLink) {
  if (target.kind === 'deck') {
    await engineLink.setDeckAutopilot(autopilot);
    return `deck ← autopilot ${JSON.stringify(autopilot)}`;
  }
  await engineLink.setMixerAutopilot(target.id, autopilot);
  return `mixer:${target.id} ← autopilot ${JSON.stringify(autopilot)}`;
}

async function applyTaskToggles(enable, disable, engineLink, steps) {
  for (const id of enable || []) {
    await engineLink.patchScheduledTask(id, { enabled: true });
    steps.push(`task ${id} ← enabled`);
  }
  for (const id of disable || []) {
    await engineLink.patchScheduledTask(id, { enabled: false });
    steps.push(`task ${id} ← disabled`);
  }
}

/**
 * Execute a 'look' bundle (docs/38 §3.3): palette → globals → playlist →
 * autopilot → tasks, applying only the sub-parts the look carries. A look that
 * only carries palette+autopilot (no playlist) is valid — skip the missing
 * parts (don't fabricate a default playlist).
 */
async function applyLook(look, name, engineLink, configPath, steps) {
  // (1) palette → param-center.
  if (look.palette) {
    await engineLink.setParamCenter(resolvePalette(look.palette, configPath));
    steps.push(`look "${name}" palette "${look.palette}"`);
  }
  // (2) globals → param-center as-is.
  if (look.globals) {
    await engineLink.setParamCenter(look.globals);
    steps.push(`look "${name}" globals ${JSON.stringify(look.globals)}`);
  }
  // (3) + (4) playlist + autopilot on the look's target (default deck).
  const targets = await resolveTargets(look.target, engineLink);
  if (look.playlist) {
    for (const target of targets) {
      steps.push(await loadPlaylistOnTarget(target, look.playlist, engineLink));
    }
  }
  if (look.autopilot) {
    for (const target of targets) {
      steps.push(await setAutopilotOnTarget(target, look.autopilot, engineLink));
    }
  }
  // (5) tasks.
  if (look.tasks) {
    await applyTaskToggles(look.tasks.enable, look.tasks.disable, engineLink, steps);
  }
}

/**
 * Establish the AUTOPILOT baseline (docs/38 §14): load the plan-level autopilot
 * playlist on its target and turn engine autopilot ON with the configured
 * delay/shuffle. This is the "regular programming" layer the server re-applies
 * on boot, on POST /autopilot {enabled:true}, and when a program ends. Returns
 * { steps:[...] }; THROWS (fail loud) if any engine call rejects. A baseline
 * with no playlist still flips autopilot on (skips the missing load).
 *
 * @param {object} plan validated show plan (carries plan.autopilot)
 * @param {object} engineLink
 */
export async function applyAutopilotBaseline(plan, engineLink) {
  const ap = plan && plan.autopilot ? plan.autopilot : null;
  if (!ap) throw new Error('applyAutopilotBaseline: plan.autopilot missing');
  const steps = [];
  const targets = await resolveTargets(ap.target, engineLink);
  if (ap.playlist) {
    for (const target of targets) {
      steps.push(await loadPlaylistOnTarget(target, ap.playlist, engineLink));
    }
  }
  const autopilot = { active: true, delay_s: ap.delay_s, shuffle: ap.shuffle };
  for (const target of targets) {
    steps.push(await setAutopilotOnTarget(target, autopilot, engineLink));
  }
  return { steps };
}

/**
 * Execute one cue action. Returns { steps:[...] }. THROWS (fail loud) if any
 * engine call rejects.
 *
 * @param {{ action, plan, engineLink, configPath }} args
 */
export async function applyAction({ action, plan, engineLink, configPath = DEFAULT_CONFIG_PATH }) {
  if (!action || typeof action !== 'object') throw new Error('applyAction: action must be an object');
  const steps = [];

  switch (action.type) {
    case 'playlist': {
      const targets = await resolveTargets(action.target, engineLink);
      for (const target of targets) {
        steps.push(await loadPlaylistOnTarget(target, action.name, engineLink));
      }
      if (action.autopilot) {
        for (const target of targets) {
          steps.push(await setAutopilotOnTarget(target, action.autopilot, engineLink));
        }
      }
      break;
    }
    case 'look': {
      const look = plan && plan.looks ? plan.looks[action.look] : undefined;
      if (!look) throw new Error(`look "${action.look}" not defined in plan`);
      await applyLook(look, action.look, engineLink, configPath, steps);
      break;
    }
    case 'scene': {
      await engineLink.requestScene(action.scene);
      steps.push(`scene ← "${action.scene}"`);
      break;
    }
    case 'globals': {
      // Globals are CPC-global; target is informational. One setParamCenter.
      await engineLink.setParamCenter(action.set);
      steps.push(`globals ${JSON.stringify(action.set)}`);
      break;
    }
    case 'tasks': {
      await applyTaskToggles(action.enable, action.disable, engineLink, steps);
      break;
    }
    case 'effect': {
      // v1: effectId is interpreted as a scheduled-task id; params are noted
      // but not yet dispatched (docs/38 §3.2 effect row).
      await engineLink.fireScheduledTask(action.effectId);
      steps.push(`effect fire scheduled-task "${action.effectId}"`);
      if (action.params) steps.push(`effect params ignored in v1: ${JSON.stringify(action.params)}`);
      break;
    }
    default:
      throw new Error(`applyAction: unknown action type "${action.type}"`);
  }

  return { steps };
}
