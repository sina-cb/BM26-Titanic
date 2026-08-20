import { describe, expect, it, vi } from 'vitest';

import {
  describeTimelineDraftSaveFailure,
  TimelineDraftSaver,
  type TimelineDraftSaveEvent,
  type TimelineDraftSaveResult,
} from './timeline_draft_saver';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('TimelineDraftSaver', () => {
  it('serializes overlapping saves and only reports the newest acknowledged version as saved', async () => {
    const first = deferred<TimelineDraftSaveResult>();
    const second = deferred<TimelineDraftSaveResult>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const events: TimelineDraftSaveEvent[] = [];
    const saver = new TimelineDraftSaver<{ label: string }>(save, (event) => events.push(event));

    saver.enqueue(1, { label: 'old' });
    const flushing = saver.flush();
    saver.enqueue(2, { label: 'new' });
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);

    first.resolve({ ok: true, status: 200 });
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ label: 'new' });
    expect(events).not.toContainEqual({ phase: 'saved', version: 1 });

    second.resolve({ ok: true, status: 200 });
    await flushing;
    expect(events.at(-1)).toEqual({ phase: 'saved', version: 2 });
    expect(saver.hasPending()).toBe(false);
  });

  it('keeps a rejected draft pending and retries that exact latest version', async () => {
    const save = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 423, error: 'held' })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const events: TimelineDraftSaveEvent[] = [];
    const saver = new TimelineDraftSaver<{ value: number }>(save, (event) => events.push(event));

    saver.enqueue(7, { value: 42 });
    await saver.flush();
    expect(saver.hasPending()).toBe(true);
    expect(events.at(-1)).toMatchObject({ phase: 'error', version: 7 });

    await saver.retry();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ value: 42 });
    expect(events.at(-1)).toEqual({ phase: 'saved', version: 7 });
  });

  it('does not re-save an engine-acknowledged initial version', async () => {
    const save = vi.fn();
    const saver = new TimelineDraftSaver<object>(save, () => undefined);
    saver.markSaved(4);
    saver.enqueue(4, {});
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('discards an older queued version when the current draft becomes invalid', async () => {
    const save = vi.fn();
    const saver = new TimelineDraftSaver<object>(save, () => undefined);
    saver.enqueue(8, { valid: true });
    saver.discardPending(8);

    await saver.retry();

    expect(save).not.toHaveBeenCalled();
    expect(saver.hasPending()).toBe(false);
  });

  it('ignores an older completion after a newer loaded plan is acknowledged', async () => {
    const first = deferred<TimelineDraftSaveResult>();
    const events: TimelineDraftSaveEvent[] = [];
    const saver = new TimelineDraftSaver<object>(() => first.promise, (event) => events.push(event));
    saver.enqueue(1, { old: true });
    const flushing = saver.flush();

    saver.markSaved(2);
    first.resolve({ ok: true, status: 200 });
    await flushing;

    expect(events).toContainEqual({ phase: 'saved', version: 2 });
    expect(events).not.toContainEqual({ phase: 'saved', version: 1 });
    expect(saver.hasPending()).toBe(false);
  });

  it('remembers a DISARM retry that arrives before the held request finishes', async () => {
    const first = deferred<TimelineDraftSaveResult>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const events: TimelineDraftSaveEvent[] = [];
    const saver = new TimelineDraftSaver<object>(save, (event) => events.push(event));
    saver.enqueue(3, { retained: true });
    const flushing = saver.flush();

    await saver.retry();
    first.resolve({ ok: false, status: 423, error: 'held' });
    await flushing;

    expect(save).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toEqual({ phase: 'saved', version: 3 });
    expect(saver.hasPending()).toBe(false);
  });
});

describe('describeTimelineDraftSaveFailure', () => {
  it('turns an armed Live Touch refusal into truthful retained-draft guidance', () => {
    expect(describeTimelineDraftSaveFailure({
      ok: false,
      status: 423,
      error: "touch control is armed by 'live_owner'",
      data: { code: 'TOUCH_CONTROL_LEASE_HELD', heldBy: 'live_owner' },
    })).toEqual({
      kind: 'live_touch_held',
      title: 'NOT SAVED — LIVE TOUCH IS ARMED',
      detail: "Live Touch owner 'live_owner' has the rig. Your draft is kept on this pad and will retry after DISARM.",
    });
  });

  it('distinguishes stale owner, invalid plan, and transport failure', () => {
    expect(describeTimelineDraftSaveFailure({
      ok: false,
      status: 409,
      data: { code: 'TOUCH_CONTROL_LEASE_INACTIVE' },
    }).kind).toBe('stale_owner');
    expect(describeTimelineDraftSaveFailure({
      ok: false,
      status: 400,
      error: 'cue id duplicated',
    })).toMatchObject({ kind: 'invalid', detail: 'cue id duplicated' });
    expect(describeTimelineDraftSaveFailure({
      ok: false,
      error: 'Engine unreachable',
    })).toMatchObject({ kind: 'transport', title: 'NOT SAVED' });
  });

  it('reports a failed priority handoff without claiming the draft was applied', () => {
    expect(describeTimelineDraftSaveFailure({
      ok: false,
      status: 503,
      error: 'Live Touch release was not confirmed',
      data: { code: 'TIMELINE_LIVE_TOUCH_PREEMPT_FAILED' },
    })).toEqual({
      kind: 'priority_handoff',
      title: 'NOT SAVED — TIMELINE PRIORITY FAILED',
      detail: 'Live Touch release was not confirmed The draft is still on this pad and was not applied; retry after resolving the engine error.',
    });
  });
});
