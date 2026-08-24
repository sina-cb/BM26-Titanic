import { describe, expect, it } from 'vitest';

import {
  primaryTimelineAlert,
  timelineEditHeaderHelper,
  TIMELINE_STALE_AFTER_MS,
  type TimelineAlertInputs,
} from './timeline_alert_model';

const NOW = 100_000;

function healthy(overrides: Partial<TimelineAlertInputs> = {}): TimelineAlertInputs {
  return {
    connected: true,
    receivedAtMs: NOW,
    nowMs: NOW,
    ...overrides,
  };
}

describe('primaryTimelineAlert', () => {
  it('gives offline and stale truth precedence over lower-priority notices', () => {
    expect(primaryTimelineAlert(healthy({
      connected: false,
      receivedAtMs: NOW,
      nowMs: NOW,
      timelineError: 'lower priority',
      zoomActive: true,
    }))?.key).toBe('offline');

    expect(primaryTimelineAlert(healthy({
      receivedAtMs: NOW - TIMELINE_STALE_AFTER_MS - 1,
      timelineError: 'lower priority',
    }))?.key).toBe('stale');
  });

  it('reports rejected actions before handoff and active zoom', () => {
    expect(primaryTimelineAlert(healthy({
      actionError: 'engine said no',
      priorityMessage: 'handoff',
      zoomActive: true,
    }))).toMatchObject({
      key: 'rejected',
      detail: 'engine said no',
    });
  });

  it('keeps one visible alert for each safety state', () => {
    expect(primaryTimelineAlert(healthy({ planWarnings: ['invalid owner'] }))?.key)
      .toBe('invalid-plan');
    expect(primaryTimelineAlert(healthy({ liveTouchActive: true }))?.key)
      .toBe('live-touch');
    expect(primaryTimelineAlert(healthy({ performanceViewOnly: true }))?.key)
      .toBe('performance-view-only');
    expect(primaryTimelineAlert(healthy({ zoomActive: true, zoomScope: 'travel' }))?.key)
      .toBe('zoom');
    expect(primaryTimelineAlert(healthy({ activePlanHotReload: true }))).toMatchObject({
      key: 'hot-reload',
      title: 'EDITING THE LIVE PLAN',
      detail: 'Every valid change is saved and applied to the ship immediately.',
    });
    expect(primaryTimelineAlert(healthy())).toBeNull();
  });

  // _359 §D.9 (T-08/T-13): a save that FAILED is news; "you are editing the
  // live plan" is a standing condition. The failure must win.
  it('ranks a save error above the live-plan hot-reload notice', () => {
    expect(primaryTimelineAlert(healthy({
      activePlanHotReload: true,
      saveError: 'engine refused the draft',
    }))).toMatchObject({
      key: 'save-error',
      title: 'DRAFT NOT SAVED',
      detail: 'engine refused the draft',
    });
    expect(primaryTimelineAlert(healthy({ saveError: 'engine refused the draft' }))?.key)
      .toBe('save-error');
  });

  it('names the CONSEQUENCE of saving in the EDIT PLAN header', () => {
    expect(timelineEditHeaderHelper({ draftName: 'playa_default', activePlan: 'playa_default' }))
      .toBe('EDITING THE LIVE SHOW — saves apply immediately.');
    expect(timelineEditHeaderHelper({ draftName: 'copy_of_playa', activePlan: 'playa_default' }))
      .toBe('Editing a saved copy. Activate it from PLANS to run it.');
    expect(timelineEditHeaderHelper({ draftName: null, activePlan: 'playa_default' }))
      .toBe('Open PLANS to load or create a draft.');
  });

  it('renders structured engine plan warnings as safe text', () => {
    const alert = primaryTimelineAlert(healthy({
      planWarnings: [{
        code: 'NON_CYCLING_PROGRAM',
        severity: 'error',
        cueId: 'dusk_ignition',
        look: 'titanic_night_arc',
        message: 'Dusk Ignition does not cycle its playlist.',
      }],
    }));

    expect(alert).toMatchObject({
      key: 'invalid-plan',
      detail: 'Dusk Ignition does not cycle its playlist.',
    });
    expect(typeof alert?.detail).toBe('string');
  });
});
