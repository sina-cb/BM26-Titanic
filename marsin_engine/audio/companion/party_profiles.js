/*
 * party_profiles.js — named, persisted Audio Companion PARTY detector profiles.
 *
 * Profiles are convenience snapshots for runtime detector tuning. Loading one
 * applies it live; it does NOT overwrite config.yaml. The existing explicit
 * PERSIST action remains the only way to change config.yaml's `party:` block.
 *
 * Codex P0: only a missing file seeds defaults. A present malformed file throws.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { PARTY_TUNABLES, PARTY_TUNABLE_KEYS } from './party_tuning.js';

const PROFILES_FILE = 'party_profiles.yaml';
const SPEC_BY_KEY = new Map(PARTY_TUNABLES.map((spec) => [spec.key, spec]));

const PLAYA_PARAMS = Object.freeze({
  ambientFloor: 0.09,
  marginX: 2.5,
  kickRateMin: 1.2,
  kickRateMax: 3.8,
  kickRegMin: 0.45,
  requireBpmLock: true,
  shapeLowMin: 0.2,
  shapeHighMin: 0.12,
  silenceMax: 0.5,
  onSustainMs: 20000,
  offConfirmMs: 30000,
});

const HOME_PARAMS = Object.freeze({
  ambientFloor: 0.08,
  marginX: 2.0,
  kickRateMin: 1.0,
  kickRateMax: 4.2,
  kickRegMin: 0.35,
  requireBpmLock: true,
  shapeLowMin: 0.16,
  shapeHighMin: 0.09,
  silenceMax: 0.6,
  onSustainMs: 15000,
  offConfirmMs: 30000,
});

export const DEFAULT_PARTY_PROFILES = Object.freeze([
  { id: 'playa', name: 'Playa', params: PLAYA_PARAMS },
  { id: 'home', name: 'Home', params: HOME_PARAMS },
]);

export function slugifyPartyProfile(name) {
  const slug = String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug || 'profile';
}

export function uniquePartyProfileId(name, existingIds) {
  const base = slugifyPartyProfile(name);
  if (!existingIds.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  throw new Error(`party_profiles: cannot allocate a unique id for "${name}"`);
}

function normalizeParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('party_profiles: profile.params must be an object');
  }
  const keys = Object.keys(params);
  const unknown = keys.filter((key) => !PARTY_TUNABLE_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`party_profiles: unknown params: ${unknown.join(', ')}`);
  }
  const missing = PARTY_TUNABLE_KEYS.filter((key) => params[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`party_profiles: missing params: ${missing.join(', ')}`);
  }
  const out = {};
  for (const key of PARTY_TUNABLE_KEYS) {
    const spec = SPEC_BY_KEY.get(key);
    const value = params[key];
    if (spec.kind === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new Error(`party_profiles: params.${key} must be a boolean, got ${JSON.stringify(value)}`);
      }
    } else if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
      throw new Error(
        `party_profiles: params.${key} must be finite in [${spec.min}, ${spec.max}], `
        + `got ${JSON.stringify(value)}`,
      );
    }
    out[key] = value;
  }
  if (out.kickRateMin > out.kickRateMax) {
    throw new Error(
      `party_profiles: kickRateMin ${out.kickRateMin} exceeds kickRateMax ${out.kickRateMax}`,
    );
  }
  return out;
}

export function validatePartyProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('party_profiles: profile must be an object');
  }
  if (typeof profile.name !== 'string' || !profile.name.trim()) {
    throw new Error('party_profiles: profile.name must be a non-empty string');
  }
  return {
    id: typeof profile.id === 'string' && profile.id.trim()
      ? profile.id.trim()
      : slugifyPartyProfile(profile.name),
    name: profile.name.trim(),
    params: normalizeParams(profile.params),
  };
}

export function validatePartyProfiles(profiles, activeId) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error('party_profiles: at least one profile is required');
  }
  const normalized = profiles.map(validatePartyProfile);
  const ids = new Set();
  for (const profile of normalized) {
    if (ids.has(profile.id)) {
      throw new Error(`party_profiles: duplicate profile id "${profile.id}"`);
    }
    ids.add(profile.id);
  }
  if (typeof activeId !== 'string' || !ids.has(activeId)) {
    throw new Error(`party_profiles: activeId must identify a profile, got ${JSON.stringify(activeId)}`);
  }
  return { profiles: normalized, activeId };
}

function profilesPath(dir) {
  return path.join(dir, PROFILES_FILE);
}

export function loadPartyProfiles(dir) {
  const filePath = profilesPath(dir);
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return validatePartyProfiles(
        DEFAULT_PARTY_PROFILES.map((profile) => ({
          ...profile,
          params: { ...profile.params },
        })),
        'home',
      );
    }
    throw new Error(`party_profiles: read failed (${filePath}): ${error.message}`);
  }
  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (error) {
    throw new Error(`party_profiles: parse failed (${filePath}): ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`party_profiles: ${PROFILES_FILE} must contain { activeId, profiles }`);
  }
  return validatePartyProfiles(parsed.profiles, parsed.activeId);
}

export function savePartyProfiles(dir, profiles, activeId) {
  const normalized = validatePartyProfiles(profiles, activeId);
  const filePath = profilesPath(dir);
  const tempPath = `${filePath}.tmp`;
  const header = '# PARTY detector profiles — written by the Audio Companion.\n'
    + '# Loading a profile applies it at runtime; config.yaml changes only via explicit PERSIST.\n';
  fs.writeFileSync(
    tempPath,
    header + yaml.dump(normalized, { sortKeys: false }),
    'utf8',
  );
  fs.renameSync(tempPath, filePath);
  return normalized;
}
