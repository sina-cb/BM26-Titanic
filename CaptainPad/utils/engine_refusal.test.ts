// engine_refusal — the SPECIAL_EVENT detector behind the operator's screenshot.

import { describe, expect, it } from 'vitest';

import { specialEventRefusal, SPECIAL_EVENT_REFUSAL } from '@/utils/engine_refusal';

// The exact body marsin_engine/lib/api_server.js rejectIfSpecialEventHoldsRig()
// writes. Kept verbatim so a change on the engine side breaks this test rather
// than quietly turning the operator's dialog into "Unknown error".
const ENGINE_SENTENCE =
  'special event "baby_reveal" is running and owns the deck — '
  + 'end or abort it from the Events tab first';

describe('specialEventRefusal', () => {
  it('returns the engine sentence VERBATIM for a flattened envelope', () => {
    expect(specialEventRefusal({
      ok: false,
      status: 409,
      code: SPECIAL_EVENT_REFUSAL,
      error: ENGINE_SENTENCE,
    })).toBe(ENGINE_SENTENCE);
  });

  it('reads the code and message out of a nested body too', () => {
    // Which shape arrives depends on the transport helper that made the call.
    expect(specialEventRefusal({
      ok: false,
      status: 409,
      data: { code: SPECIAL_EVENT_REFUSAL, error: ENGINE_SENTENCE },
    })).toBe(ENGINE_SENTENCE);
  });

  it('names the show, so the operator knows what to go end', () => {
    const message = specialEventRefusal({
      ok: false, code: SPECIAL_EVENT_REFUSAL, error: ENGINE_SENTENCE,
    });
    expect(message).toContain('baby_reveal');
    expect(message).toContain('Events tab');
  });

  it('is null for a successful result', () => {
    expect(specialEventRefusal({ ok: true })).toBeNull();
  });

  it('is null for every OTHER refusal — those stay plain toasts', () => {
    expect(specialEventRefusal({ ok: false, code: 'EBUSY', error: 'swap in flight' })).toBeNull();
    expect(specialEventRefusal({ ok: false, status: 500, error: 'boom' })).toBeNull();
    expect(specialEventRefusal({ ok: false })).toBeNull();
    expect(specialEventRefusal({ ok: false, data: { code: 'TAKEOVER_AUTH_REQUIRED' } })).toBeNull();
  });

  it('is null when the body is not an object', () => {
    expect(specialEventRefusal({ ok: false, data: 'nope' })).toBeNull();
    expect(specialEventRefusal({ ok: false, data: null })).toBeNull();
  });

  it('THROWS on a SPECIAL_EVENT code with no reason — no invented sentence', () => {
    // Codex P0: an engine contract break must surface as one, not as a
    // plausible-looking message this client made up.
    expect(() => specialEventRefusal({ ok: false, code: SPECIAL_EVENT_REFUSAL }))
      .toThrow(/no error message/);
  });
});
