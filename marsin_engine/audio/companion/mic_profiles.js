/*
 * mic_profiles.js — named MIC TUNE calibration profiles (report 20260621_8).
 *
 * A profile is a saved venue/condition state: per-band noise gates + global gate
 * + input gain, under a human name ("Quiet room", "Art car near", …). The
 * operator picks a profile, calibrates the noise floor INTO it, and applies it.
 * Profiles persist to `mic_profiles.yaml` next to the companion (companion-owned
 * convenience — the live tuning still flows to the engine via PATCH /audio/config
 * when a profile is applied).
 *
 * Codex P0 — NO FALLBACK: a MISSING file is the only non-error path (→ the
 * built-in default set, so the UI always has profiles). A present-but-malformed
 * file throws; we never silently drop a corrupt profile.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const PROFILES_FILE = 'mic_profiles.yaml';

// Seed set — the conditions the old hardcoded presets covered, now editable.
// Per-band null = "use the global gate for that band". inputGain 1.0 = unity.
export const DEFAULT_PROFILES = Object.freeze([
  { id: 'quiet_room',     name: 'Quiet room',     gates: { noiseGate: 0.04, lowGate: null, midGate: null, highGate: null }, inputGain: 1.0 },
  { id: 'quiet_night',    name: 'Quiet night',    gates: { noiseGate: 0.05, lowGate: 0.05, midGate: 0.07, highGate: 0.12 }, inputGain: 1.0 },
  { id: 'loud_day',       name: 'Loud day',       gates: { noiseGate: 0.06, lowGate: 0.06, midGate: 0.09, highGate: 0.18 }, inputGain: 1.0 },
  { id: 'windy',          name: 'Windy',          gates: { noiseGate: 0.05, lowGate: 0.10, midGate: 0.08, highGate: 0.16 }, inputGain: 1.0 },
  { id: 'neighbor_bleed', name: 'Neighbor bleed', gates: { noiseGate: 0.06, lowGate: 0.12, midGate: 0.10, highGate: 0.14 }, inputGain: 1.0 },
]);

/** Slug a profile name into an id; non-empty, filesystem/JSON-safe. */
export function slugify(name) {
  const s = String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return s || 'profile';
}

/** A unique id from `name` not colliding with `existingIds` (Set). */
export function uniqueProfileId(name, existingIds) {
  const base = slugify(name);
  if (!existingIds.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const cand = `${base}_${i}`;
    if (!existingIds.has(cand)) return cand;
  }
  throw new Error(`mic_profiles: cannot allocate a unique id for "${name}"`);
}

function _gateField(v, label) {
  if (v === null || v === undefined) return null;
  const n = +v;
  if (!Number.isFinite(n) || n < 0 || n >= 1) throw new Error(`mic_profiles: ${label} must be null or in [0, 1); got ${v}`);
  return n;
}

/**
 * Validate + normalize one profile. Throws on anything malformed (codex P0).
 * Returns a fresh normalized object (gates clamped to the known fields).
 */
export function validateProfile(p) {
  if (!p || typeof p !== 'object') throw new Error('mic_profiles: profile must be an object');
  if (typeof p.name !== 'string' || !p.name.trim()) throw new Error('mic_profiles: profile.name must be a non-empty string');
  const g = p.gates && typeof p.gates === 'object' ? p.gates : {};
  const noiseGate = _gateField(g.noiseGate, 'gates.noiseGate');
  if (noiseGate === null) throw new Error('mic_profiles: gates.noiseGate is required (in [0, 1))');
  let inputGain = 1.0;
  if (p.inputGain !== undefined) {
    inputGain = +p.inputGain;
    if (!Number.isFinite(inputGain) || inputGain < 0 || inputGain > 64) {
      throw new Error(`mic_profiles: inputGain must be in [0, 64]; got ${p.inputGain}`);
    }
  }
  return {
    id: (typeof p.id === 'string' && p.id.trim()) ? p.id.trim() : slugify(p.name),
    name: p.name.trim(),
    gates: {
      noiseGate,
      lowGate:  _gateField(g.lowGate,  'gates.lowGate'),
      midGate:  _gateField(g.midGate,  'gates.midGate'),
      highGate: _gateField(g.highGate, 'gates.highGate'),
    },
    inputGain,
  };
}

/** Validate a whole list; reject duplicate ids (codex P0 — no silent collapse). */
export function validateProfiles(list) {
  if (!Array.isArray(list)) throw new Error('mic_profiles: top level must be an array of profiles');
  if (list.length === 0) throw new Error('mic_profiles: at least one profile is required');
  const out = [];
  const ids = new Set();
  for (const p of list) {
    const norm = validateProfile(p);
    if (ids.has(norm.id)) throw new Error(`mic_profiles: duplicate profile id "${norm.id}"`);
    ids.add(norm.id);
    out.push(norm);
  }
  return out;
}

function profilesPath(dir) { return path.join(dir, PROFILES_FILE); }

/**
 * Load profiles from `<dir>/mic_profiles.yaml`. Missing file → the default set
 * (a deep clone, so callers can mutate freely). Present-but-broken → throws.
 */
export function loadMicProfiles(dir) {
  const p = profilesPath(dir);
  let text;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return validateProfiles(DEFAULT_PROFILES.map((x) => ({ ...x, gates: { ...x.gates } })));
    throw new Error(`mic_profiles: read failed (${p}): ${err.message}`);
  }
  let parsed;
  try { parsed = yaml.load(text); }
  catch (err) { throw new Error(`mic_profiles: parse failed (${p}): ${err.message}`); }
  const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.profiles) ? parsed.profiles : null);
  if (!arr) throw new Error(`mic_profiles: ${PROFILES_FILE} must be a list of profiles (or { profiles: [...] })`);
  return validateProfiles(arr);
}

/** Atomically write the profiles list (validates first). */
export function saveMicProfiles(dir, profiles) {
  const norm = validateProfiles(profiles);
  const p = profilesPath(dir);
  const tmp = `${p}.tmp`;
  const header = '# MIC TUNE calibration profiles — written by the Audio Companion.\n' +
                 '# Each profile: { id, name, gates: { noiseGate, lowGate, midGate, highGate }, inputGain }.\n' +
                 '# Per-band gate null = use the global noiseGate for that band.\n';
  fs.writeFileSync(tmp, header + yaml.dump({ profiles: norm }, { sortKeys: false }));
  fs.renameSync(tmp, p);
  return norm;
}
