import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_DIMMER_LEVEL,
  uniqueSectionIds,
  masterLevel,
  applyMasterLevel,
  createCoalescedSender,
} from './master_dimmer_logic';

// Contract under test (Dimmer Rack MASTER fader, report 20260805_168):
// section-id space, mean readout, absolute apply, latest-wins backpressure.

describe('uniqueSectionIds', () => {
  it('returns the distinct section ids, ascending', () => {
    expect(uniqueSectionIds({ bow: 3, stern: 1, mast: 2 })).toEqual([1, 2, 3]);
  });

  it('collapses aliased groups that share one physical section', () => {
    expect(uniqueSectionIds({ bowPort: 5, bowStbd: 5, stern: 6 })).toEqual([5, 6]);
  });

  it('is empty for an empty group map', () => {
    expect(uniqueSectionIds({})).toEqual([]);
  });
});

describe('masterLevel', () => {
  it('is the mean of the section levels', () => {
    expect(masterLevel({ '1': 0.5, '2': 1.0 }, [1, 2])).toBeCloseTo(0.75, 6);
  });

  it('treats a section with no stored level as the rack default', () => {
    expect(masterLevel({ '1': 0.0 }, [1, 2])).toBeCloseTo(DEFAULT_DIMMER_LEVEL / 2, 6);
  });

  it('counts an aliased section once (ids are already deduped)', () => {
    const groups = { a: 4, b: 4, c: 8 };
    expect(masterLevel({ '4': 0.2, '8': 0.8 }, uniqueSectionIds(groups))).toBeCloseTo(0.5, 6);
  });

  it('ignores state keys that are not owned sections (engine orphan keys)', () => {
    expect(masterLevel({ '1': 0.4, staleGroupName: 0.0 }, [1])).toBeCloseTo(0.4, 6);
  });

  it('falls back to the rack default with no sections at all', () => {
    expect(masterLevel({}, [])).toBe(DEFAULT_DIMMER_LEVEL);
  });
});

describe('applyMasterLevel', () => {
  it('sets every owned section to the master value, absolutely', () => {
    expect(applyMasterLevel({ '1': 0.1, '2': 0.9 }, [1, 2], 0.35)).toEqual({ '1': 0.35, '2': 0.35 });
  });

  it('does not scale by the previous value (no ratio mode)', () => {
    const out = applyMasterLevel({ '1': 0.0, '2': 1.0 }, [1, 2], 0.5);
    expect(out['1']).toBe(0.5);
    expect(out['2']).toBe(0.5);
  });

  it('preserves unowned keys and does not mutate the input', () => {
    const prev = { '1': 0.1, orphanGroup: 0.7 };
    const out = applyMasterLevel(prev, [1], 1.0);
    expect(out).toEqual({ '1': 1.0, orphanGroup: 0.7 });
    expect(prev['1']).toBe(0.1);
  });

  it('adds sections that had no stored level yet', () => {
    expect(applyMasterLevel({}, [7], 0.25)).toEqual({ '7': 0.25 });
  });
});

describe('createCoalescedSender', () => {
  /** A send whose resolution the test controls. */
  function deferredSend() {
    const calls: number[] = [];
    let release: ((err: string | null) => void) | null = null;
    const send = (level: number) => {
      calls.push(level);
      return new Promise<string | null>((resolve) => { release = resolve; });
    };
    return {
      calls,
      send,
      finish(err: string | null = null) {
        if (!release) throw new Error('nothing in flight');
        const r = release;
        release = null;
        r(err);
      },
    };
  }

  it('sends the first request immediately', async () => {
    const d = deferredSend();
    const sender = createCoalescedSender(d.send, () => {});
    sender.request(0.5);
    expect(d.calls).toEqual([0.5]);
    expect(sender.isBusy()).toBe(true);
    d.finish();
  });

  it('drops intermediate values and sends only the latest after the batch lands', async () => {
    const d = deferredSend();
    const sender = createCoalescedSender(d.send, () => {});
    sender.request(0.9);
    sender.request(0.6);
    sender.request(0.3); // final drag value
    expect(d.calls).toEqual([0.9]);
    d.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(d.calls).toEqual([0.9, 0.3]);
  });

  it('goes idle once the queue drains', async () => {
    const d = deferredSend();
    const sender = createCoalescedSender(d.send, () => {});
    sender.request(0.4);
    d.finish();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sender.isBusy()).toBe(false);
    expect(d.calls).toEqual([0.4]);
  });

  it('reports every batch result, failures included', async () => {
    const results: (string | null)[] = [];
    const send = vi.fn()
      .mockResolvedValueOnce('engine offline')
      .mockResolvedValueOnce(null);
    const sender = createCoalescedSender(send, (e) => results.push(e));
    sender.request(0.2);
    await vi.waitFor(() => expect(results).toEqual(['engine offline']));
    sender.request(0.8);
    await vi.waitFor(() => expect(results).toEqual(['engine offline', null]));
  });

  it('surfaces a rejected batch as an error result and stays usable', async () => {
    const results: (string | null)[] = [];
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(null);
    const sender = createCoalescedSender(send, (e) => results.push(e));
    sender.request(0.1);
    await vi.waitFor(() => expect(results).toEqual(['Network request failed']));
    expect(sender.isBusy()).toBe(false);
    sender.request(0.7);
    await vi.waitFor(() => expect(results).toEqual(['Network request failed', null]));
  });
});
