/*
 * timeline_config.js — the Timeline Companion's PROCESS config (NOT the show
 * plan). Mirrors companion_config.js: loadTimelineConfig returns the built-in
 * default ONLY on ENOENT; any other read/parse error THROWS (codex P0).
 * validateTimelineConfig THROWS on any invalid field and returns a normalized
 * object. The starter `timeline_config.yaml` sibling holds the defaults.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TIMELINE_CONFIG_PATH = path.join(__dirname, 'timeline_config.yaml');

const MOOD_SOURCES = Object.freeze(['engine']);

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function assertInt(value, label, lo, hi) {
  if (!Number.isInteger(value) || value < lo || value > hi) {
    throw new Error(`${label} must be an integer in [${lo}, ${hi}], got ${JSON.stringify(value)}`);
  }
  return value;
}

/** Built-in default process config. */
export function defaultTimelineConfig() {
  return {
    engine: { host: '127.0.0.1', port: 6968 },
    port: 6965,
    activePlan: 'playa_default',
    mood: { source: 'engine', key: 'audioParty', partyThreshold: 0.5 },
    tickMs: 1000,
  };
}

/** Validate a process config. THROWS on any invalid field; returns normalized. */
export function validateTimelineConfig(cfg) {
  if (!isPlainObject(cfg)) throw new Error('timeline config must be an object');

  const d = defaultTimelineConfig();

  const engineIn = cfg.engine !== undefined ? cfg.engine : {};
  if (!isPlainObject(engineIn)) throw new Error('timeline config.engine must be an object { host, port }');
  const host = engineIn.host !== undefined ? engineIn.host : d.engine.host;
  if (typeof host !== 'string' || !host.trim()) {
    throw new Error('timeline config.engine.host must be a non-empty string');
  }
  const enginePort = engineIn.port !== undefined ? engineIn.port : d.engine.port;
  assertInt(enginePort, 'timeline config.engine.port', 1, 65535);

  const port = cfg.port !== undefined ? cfg.port : d.port;
  assertInt(port, 'timeline config.port', 1, 65535);

  const activePlan = cfg.activePlan !== undefined ? cfg.activePlan : d.activePlan;
  if (typeof activePlan !== 'string' || !activePlan.trim()) {
    throw new Error('timeline config.activePlan must be a non-empty string');
  }

  const moodIn = cfg.mood !== undefined ? cfg.mood : {};
  if (!isPlainObject(moodIn)) throw new Error('timeline config.mood must be an object');
  const moodSource = moodIn.source !== undefined ? moodIn.source : d.mood.source;
  if (!MOOD_SOURCES.includes(moodSource)) {
    throw new Error(`timeline config.mood.source must be one of ${MOOD_SOURCES.join(', ')}, got ${JSON.stringify(moodSource)}`);
  }
  const moodKey = moodIn.key !== undefined ? moodIn.key : d.mood.key;
  if (typeof moodKey !== 'string' || !moodKey.trim()) {
    throw new Error('timeline config.mood.key must be a non-empty string');
  }
  const partyThreshold = moodIn.partyThreshold !== undefined ? moodIn.partyThreshold : d.mood.partyThreshold;
  if (typeof partyThreshold !== 'number' || Number.isNaN(partyThreshold)) {
    throw new Error('timeline config.mood.partyThreshold must be a number');
  }

  const tickMs = cfg.tickMs !== undefined ? cfg.tickMs : d.tickMs;
  assertInt(tickMs, 'timeline config.tickMs', 1, 3600000);

  return {
    engine: { host, port: enginePort },
    port,
    activePlan,
    mood: { source: moodSource, key: moodKey, partyThreshold },
    tickMs,
  };
}

/**
 * Load the process config. A MISSING file → the built-in default. Any
 * present-but-broken file THROWS (codex P0).
 */
export function loadTimelineConfig(filePath = TIMELINE_CONFIG_PATH) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return validateTimelineConfig(defaultTimelineConfig());
    throw new Error(`timeline config read failed (${filePath}): ${err.message}`);
  }
  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (err) {
    throw new Error(`timeline config parse failed (${filePath}): ${err.message}`);
  }
  return validateTimelineConfig(parsed);
}

/** Validate-then-write the process config. */
export function saveTimelineConfig(cfg, filePath = TIMELINE_CONFIG_PATH) {
  const normalized = validateTimelineConfig(cfg);
  fs.writeFileSync(filePath, dumpTimelineConfig(normalized), 'utf8');
  return normalized;
}

/** Serialize the (validated) process config to YAML text. */
export function dumpTimelineConfig(cfg) {
  const normalized = validateTimelineConfig(cfg);
  return yaml.dump(normalized, { lineWidth: 100, noRefs: true });
}
