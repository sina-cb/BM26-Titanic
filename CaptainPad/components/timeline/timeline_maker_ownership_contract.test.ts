import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'app', '(tabs)', 'timeline.tsx'),
  'utf8',
);
const prioritySource = fs.readFileSync(
  path.join(process.cwd(), 'utils', 'timeline_priority_feedback.ts'),
  'utf8',
);
const hookSource = fs.readFileSync(
  path.join(process.cwd(), 'hooks', 'useTimeline.ts'),
  'utf8',
);

describe('Timeline maker ownership contract', () => {
  it('keeps preview read-only while Timeline mutations take priority', () => {
    // Preview transport failures surface through the operator alert line, kept
    // separate from save status (legacy banner removed with the dead edit body).
    expect(source).toContain('saveError: saveFailure?.detail ?? previewTransportError,');
    expect(source).not.toContain('(a valid draft still auto-saves)');
    expect(source).not.toContain('PREEMPT LIVE TOUCH + RETRY');
    expect(prioritySource).toContain('PREEMPTING LIVE TOUCH');
    expect(prioritySource).toContain('TIMELINE TOOK PRIORITY — LIVE TOUCH');
    expect(source).not.toContain('WAITING FOR DISARM');
    expect(source).not.toContain('blocked until DISARM');
    expect(source).toContain('setDraftOverview(null);');
    expect(source).toContain('setPreviewError(null);');
    expect(source).toContain('setPreviewTransportError(null);');
    expect(source).not.toContain('the last good preview (if any) stays on screen');
  });

  it('uses shared layer-settings truth and requests authoritative preemption', () => {
    expect(source).toContain("message.type !== 'layerSettings'");
    expect(source).toContain('fetchLayerSettingsState()');
    expect(source).toContain('if (!active || observedWsOwnership) return;');
    expect(source).toContain('observedWsOwnership = true;');
    expect(source).toContain('parseLayerSettingsState(message).liveTouch');
    expect(source).toContain("beginPriorityHandoff('SAVE PLAN')");
    expect(source).toContain('finishPriorityHandoff(priorityAttempt, r.ok, r.error ?? null)');
  });

  it('never marks an unacknowledged version saved', () => {
    expect(source).toContain("event.phase === 'saved'");
    expect(source).toContain('lastSavedVersionRef.current = event.version');
    expect(source).toContain("if (autoSaveEvent.phase === 'saved') return '✓ SAVED'");
  });

  it('reconciles a refused live action without erasing its ownership error', () => {
    expect(hookSource).toContain('await _reseedAfterAction({ preserveError: true });');
    expect(hookSource).toContain('error: preserveError ? _cached.error : null');
  });
});
