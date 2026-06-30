// timelineTemplate — client-side helpers for the Timeline maker.
//
// docs/38 §15.3: "Best-practice starter template prefilled for BRC
// (sunrise shows + nightly autopilot + party-night) so the operator edits
// rather than starts blank." This module owns:
//   - the v2 BRC seed plan ("New from template"),
//   - stable client-side cue id generation,
//   - kind→colour mapping for the overview markers / chips,
//   - small "HH:MM" ↔ minutes helpers shared across maker components.
//
// The engine is the schema validator of record (Codex P0: fail loud
// there). This template is shaped to PASS validateShowPlan so a fresh
// draft previews + saves without edits.

import { Palette } from '@/constants/theme';
import {
  ShowPlan,
  PlanCue,
  CueKind,
  CueTrigger,
  CueAction,
  SunEvent,
  DECK_TRANSITION_MODE_LABEL,
} from '@/utils/timelineApi';

// Black Rock City coordinates (matches the existing playa_default plan).
export const BRC_LOCATION = {
  lat: 40.7864,
  lon: -119.2065,
  tz: 'America/Los_Angeles',
  elevationM: 1190,
};

// BM 2026 runs Aug 30 – Sep 7 (Sun before Labor Day → Labor Day). 8 days.
export const BRC_FESTIVAL = { startDate: '2026-08-30', days: 8 };

// ── Kind palette (overview markers + cue chips) ─────────────────────────
// program = amber, mood = cyan, ambient = grey (per the deliverable brief).
// We derive amber/cyan from fixed hexes (not palette tokens) so the marker
// colour reads as "cue kind", independent of the active theme accent — but
// ambient borrows the theme's muted icon colour so it recedes.
export const KIND_COLORS: Record<CueKind, string> = {
  program: '#f5a623', // amber
  mood: '#22c1d6',    // cyan
  ambient: '#9aa3a8', // grey (overridden to C.icon where a palette is handy)
};

export function kindColor(kind: CueKind, C: Palette): string {
  if (kind === 'ambient') return C.icon;
  return KIND_COLORS[kind];
}

export const KIND_LABEL: Record<CueKind, string> = {
  program: 'PROGRAM',
  mood: 'MOOD',
  ambient: 'AMBIENT',
};

// ── Sun event metadata (dropdowns + arc rendering) ──────────────────────
export const SUN_EVENT_OPTIONS: { id: SunEvent; label: string }[] = [
  { id: 'sunrise', label: 'Sunrise' },
  { id: 'goldenHourEnd', label: 'Golden hour end' },
  { id: 'solarNoon', label: 'Solar noon' },
  { id: 'goldenHourStart', label: 'Golden hour start' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'civilDusk', label: 'Civil dusk' },
  { id: 'civilDawn', label: 'Civil dawn' },
  { id: 'nauticalDusk', label: 'Nautical dusk' },
  { id: 'nauticalDawn', label: 'Nautical dawn' },
];

export const MOOD_VALUES = ['calm', 'party'];

// ── "HH:MM" helpers ─────────────────────────────────────────────────────

export function hhmmToMinutes(v: string | null | undefined): number | null {
  if (!v || typeof v !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

export function minutesToHHMM(mins: number): string {
  const norm = ((mins % 1440) + 1440) % 1440;
  const hh = Math.floor(norm / 60);
  const mm = norm % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Fraction [0,1] of where a minutes-of-day value sits across a 24h span,
// used to place markers along a day column / arc.
export function dayFraction(mins: number | null): number | null {
  if (mins === null) return null;
  return Math.max(0, Math.min(1, mins / 1440));
}

// ── Stable cue id ───────────────────────────────────────────────────────
// Engine requires a slug: /^[a-z0-9][a-z0-9_-]{0,63}$/ and unique within
// the plan. We mint `c_<base36 time>_<rand>` which always satisfies it.
export function makeCueId(existing: Set<string>): string {
  for (let i = 0; i < 50; i += 1) {
    const id = `c_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
    if (!existing.has(id)) return id;
  }
  // Defensive — astronomically unlikely. Append a counter.
  let n = 0;
  while (existing.has(`c_x${n}`)) n += 1;
  return `c_x${n}`;
}

// ── Trigger / action summaries (compact, for cue rows) ──────────────────

export function triggerSummary(t: CueTrigger): string {
  switch (t.type) {
    case 'clock':
      return `clock · ${t.at}`;
    case 'sun': {
      const off = t.offsetMin ? ` ${t.offsetMin > 0 ? '+' : ''}${t.offsetMin}m` : '';
      return `${t.event}${off}`;
    }
    case 'phase':
      return `phase · ${t.phase}`;
    case 'mood':
      return `mood ${t.from}→${t.to}`;
    case 'manual':
      return 'manual';
    default:
      return 'cue';
  }
}

export function actionSummary(a: CueAction): string {
  switch (a.type) {
    case 'look':
      return `look · ${a.look}`;
    case 'playlist': {
      // Compact deck extras: transition mode (or `default` when inheriting) and
      // overlay state, only shown when set — e.g. `playlist · default · flash · ovl-off`.
      const parts = [`playlist · ${a.name}`];
      parts.push(a.transition ? DECK_TRANSITION_MODE_LABEL[a.transition.mode].toLowerCase() : 'default');
      if (a.overlays) parts.push(a.overlays === 'disable' ? 'ovl-off' : 'ovl-on');
      return parts.join(' · ');
    }
    case 'globals':
      return 'globals';
    default:
      return 'action';
  }
}

// ── BRC starter template ────────────────────────────────────────────────
// Sunrise shows + nightly autopilot baseline + a party-night cue. Shaped to
// pass validateShowPlan: phases referenced by cues exist; looks referenced
// by actions exist; cue ids unique.
export function brcStarterPlan(name = 'brc_2026'): ShowPlan {
  const cues: PlanCue[] = [
    {
      id: 'c_sunrise_show',
      label: 'Sunrise show',
      kind: 'program',
      trigger: { type: 'sun', event: 'sunrise', offsetMin: -30 },
      action: { type: 'look', look: 'sunrise' },
      hold: { min: 90 },
      days: 'all',
    },
    {
      id: 'c_visibility_on',
      label: 'Exterior up at golden hour',
      kind: 'program',
      trigger: { type: 'sun', event: 'sunset', offsetMin: -45 },
      action: { type: 'look', look: 'philharmonic' },
      days: 'all',
    },
    {
      id: 'c_party_ramp',
      label: 'Party night ramp',
      kind: 'mood',
      trigger: { type: 'mood', from: 'calm', to: 'party', minDwellSec: 30, cooldownSec: 300 },
      action: { type: 'look', look: 'party' },
      days: 'all',
    },
    {
      id: 'c_daytime_ambient',
      label: 'Daytime ambient',
      kind: 'ambient',
      trigger: { type: 'sun', event: 'sunrise', offsetMin: 120 },
      action: { type: 'look', look: 'daytime' },
      days: 'all',
    },
  ];

  return {
    schemaVersion: 2,
    name,
    location: { ...BRC_LOCATION },
    festival: { ...BRC_FESTIVAL },
    autopilot: {
      enabled: true,
      playlist: 'default',
      delay_s: 60,
      shuffle: false,
      target: { channel: 'deck', id: null },
      mood: true,
    },
    looks: {
      daytime: {
        playlist: 'default',
        palette: 'deep_sea',
        globals: { master: 0.5 },
        target: { channel: 'deck', id: null },
      },
      philharmonic: {
        playlist: 'default',
        autopilot: { active: true, delay_s: 90, shuffle: false },
        palette: 'sunset_coral',
        target: { channel: 'deck', id: null },
      },
      party: {
        playlist: 'default',
        autopilot: { active: true, delay_s: 30, shuffle: true },
        palette: 'bass_drop',
        target: { channel: 'deck', id: null },
      },
      sunrise: {
        playlist: 'default',
        palette: 'aurora',
        globals: { master: 0.6 },
        target: { channel: 'deck', id: null },
      },
    },
    phases: {
      philharmonic: {
        start: { sun: 'sunset', offsetMin: -30 },
        end: { sun: 'sunset', offsetMin: 60 },
      },
      party_night: {
        start: { sun: 'sunset', offsetMin: 120 },
        end: { sun: 'sunrise', offsetMin: -60 },
      },
      sunrise_set: {
        start: { sun: 'sunrise', offsetMin: -30 },
        end: { sun: 'sunrise', offsetMin: 90 },
      },
    },
    cues,
  };
}

// Deep-ish clone for safe local editing of a fetched plan. Plans are plain
// JSON (engine serialises YAML→JSON), so structuredClone-via-JSON is exact.
export function clonePlan(plan: ShowPlan): ShowPlan {
  return JSON.parse(JSON.stringify(plan)) as ShowPlan;
}

// Duplicate a plan under a new slug name (for the plan picker's "duplicate").
export function duplicatePlan(plan: ShowPlan, newName: string): ShowPlan {
  const copy = clonePlan(plan);
  copy.name = newName;
  return copy;
}
