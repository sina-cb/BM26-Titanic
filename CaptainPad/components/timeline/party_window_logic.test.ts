import { describe, expect, it } from 'vitest';

import type { ActionPlaylist, PlanCue, ShowPlan } from '../../utils/timelineApi';
import {
  partyWindowBaselineCueId,
  partyWindowPhaseId,
  partyWindowSeed,
  planWithPartyWindow,
  planWithoutPartyWindow,
} from './party_window_logic';

const playlist = (name: string): ActionPlaylist => ({
  type: 'playlist',
  name,
  target: { channel: 'deck', id: null },
});

const plan: ShowPlan = {
  schemaVersion: 2,
  name: 'party_test',
  location: { lat: 0, lon: 0, tz: 'UTC' },
  festival: { startDate: '2026-08-30', days: 2 },
  autopilot: { enabled: true, delay_s: 30, shuffle: false },
  defaultCue: { label: 'Normal night', action: playlist('default') },
  phases: {},
  looks: {},
  cues: [],
};

const cue: PlanCue = {
  id: 'c_party_window',
  label: 'Party hours',
  enabled: true,
  kind: 'mood',
  trigger: { type: 'mood', from: 'calm', to: 'party' },
  action: playlist('party_high'),
  days: 'all',
};

describe('Party Window plan authoring', () => {
  it('compiles one operator Party Window into the existing phase-gated engine contract', () => {
    const out = planWithPartyWindow(plan, cue, {
      startAt: '21:00',
      windowDurationMin: 480,
      baselineAction: playlist('ambient'),
      partyAction: {
        ...playlist('party_high'),
        autopilot: { active: true, delay_s: 15, shuffle: true },
        transition: { enabled: true, mode: 'trans_flash', durationMs: 400, shuffle: false },
        globals: { speed: 0.25, bpmSpeedSync: 0 },
        overlays: 'disable',
      },
      minDwellSec: 90,
      sessionDurationMin: 12,
      cooldownSec: 300,
    });
    const phaseId = partyWindowPhaseId(cue.id);
    const baselineId = partyWindowBaselineCueId(cue.id);

    expect(out.phases[phaseId]).toEqual({
      start: { clock: '21:00' },
      end: { clock: '05:00' },
    });
    expect(out.cues.find((candidate) => candidate.id === baselineId)).toMatchObject({
      kind: 'ambient',
      trigger: { type: 'phase', phase: phaseId },
      action: { type: 'playlist', name: 'ambient' },
    });
    expect(out.cues.find((candidate) => candidate.id === 'pwe_c_party_window')).toMatchObject({
      kind: 'ambient',
      trigger: { type: 'clock', at: '05:00' },
      action: { type: 'playlist', name: 'default' },
    });
    expect(out.cues.find((candidate) => candidate.id === cue.id)).toMatchObject({
      kind: 'mood',
      trigger: {
        type: 'mood',
        from: 'calm',
        to: 'party',
        whenPhase: phaseId,
        minDwellSec: 90,
        cooldownSec: 300,
      },
      action: {
        type: 'playlist',
        name: 'party_high',
        autopilot: { active: true, delay_s: 15, shuffle: true },
        transition: { mode: 'trans_flash', durationMs: 400 },
        globals: { speed: 0.25, bpmSpeedSync: 0 },
        overlays: 'disable',
      },
      durationMin: 12,
    });
    expect(partyWindowSeed(out, out.cues.find((candidate) => candidate.id === cue.id) ?? null))
      .toMatchObject({
        startAt: '21:00',
        windowDurationMin: 480,
        partyAction: { name: 'party_high' },
        sessionDurationMin: 12,
      });
  });

  it('removes the internal baseline and phase with the operator Party Window', () => {
    const authored = planWithPartyWindow(plan, cue, {
      startAt: '22:00',
      windowDurationMin: 360,
      baselineAction: playlist('default'),
      partyAction: playlist('party_high'),
      minDwellSec: 30,
      sessionDurationMin: 10,
      cooldownSec: 120,
    });
    const removed = planWithoutPartyWindow(authored, cue.id);

    expect(removed.cues).toEqual([]);
    expect(removed.phases).toEqual({});
  });

  it('removes the legacy party phase baseline when migrating an old mood cue', () => {
    const legacy: ShowPlan = {
      ...plan,
      phases: {
        party_night: { start: { clock: '20:00' }, end: { clock: '02:00' } },
      },
      cues: [
        {
          id: 'c_party_start',
          label: 'Party night ramp',
          kind: 'ambient',
          trigger: { type: 'phase', phase: 'party_night' },
          action: playlist('ambient'),
        },
        cue,
      ],
    };
    const migrated = planWithPartyWindow(legacy, cue, {
      startAt: '21:00',
      windowDurationMin: 240,
      baselineAction: playlist('ambient'),
      partyAction: playlist('party_high'),
      minDwellSec: 60,
      sessionDurationMin: 12,
      cooldownSec: 120,
    });

    expect(migrated.cues.some((candidate) => candidate.id === 'c_party_start')).toBe(false);
    expect(migrated.phases.party_night).toBeUndefined();
  });
});
