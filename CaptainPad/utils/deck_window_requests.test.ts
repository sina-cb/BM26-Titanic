import { describe, it, expect, vi } from 'vitest';

import { requestDeckWindow, subscribeDeckWindowRequests } from './deck_window_requests';

describe('deck_window_requests — a hint broker, not a command queue', () => {
  it('delivers a request to a subscriber', () => {
    const fn = vi.fn();
    const unsubscribe = subscribeDeckWindowRequests(fn);
    requestDeckWindow('colors');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('colors');
    unsubscribe();
  });

  it('delivers to MULTIPLE subscribers, all of them, in order', () => {
    const calls: string[] = [];
    const unsubA = subscribeDeckWindowRequests(() => calls.push('a'));
    const unsubB = subscribeDeckWindowRequests(() => calls.push('b'));
    requestDeckWindow('colors');
    expect(calls).toEqual(['a', 'b']);
    unsubA();
    unsubB();
  });

  it('unsubscribe stops delivery to that listener only', () => {
    const fnA = vi.fn();
    const fnB = vi.fn();
    const unsubA = subscribeDeckWindowRequests(fnA);
    const unsubB = subscribeDeckWindowRequests(fnB);
    unsubA();
    requestDeckWindow('colors');
    expect(fnA).not.toHaveBeenCalled();
    expect(fnB).toHaveBeenCalledTimes(1);
    unsubB();
  });

  it('a request with no subscriber is a silent no-op — a UI hint, not a command', () => {
    expect(() => requestDeckWindow('colors')).not.toThrow();
  });

  it('calling the returned unsubscribe twice is harmless', () => {
    const fn = vi.fn();
    const unsubscribe = subscribeDeckWindowRequests(fn);
    unsubscribe();
    unsubscribe();
    requestDeckWindow('colors');
    expect(fn).not.toHaveBeenCalled();
  });
});
