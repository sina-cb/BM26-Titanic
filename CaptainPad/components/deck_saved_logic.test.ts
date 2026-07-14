import { describe, it, expect } from 'vitest';

import { isDeckSaveConfirmation } from './deck_saved_logic';

const DECK = 'deck_main';

describe('isDeckSaveConfirmation', () => {
  it('fires on a deckParamsSaved for our deck channel (local-param persist)', () => {
    expect(isDeckSaveConfirmation({ type: 'deckParamsSaved', channelId: DECK }, DECK)).toBe(true);
  });

  it('fires on a playlistEntryCaptured for our deck channel (explicit/on-switch capture)', () => {
    expect(isDeckSaveConfirmation({ type: 'playlistEntryCaptured', channelId: DECK }, DECK)).toBe(true);
  });

  it('ignores a save addressed to a DIFFERENT channel', () => {
    expect(isDeckSaveConfirmation({ type: 'deckParamsSaved', channelId: 'ch_other' }, DECK)).toBe(false);
    expect(isDeckSaveConfirmation({ type: 'playlistEntryCaptured', channelId: 'ch_other' }, DECK)).toBe(false);
  });

  it('ignores unrelated event types', () => {
    expect(isDeckSaveConfirmation({ type: 'deck', channelId: DECK }, DECK)).toBe(false);
    expect(isDeckSaveConfirmation({ type: 'mixer', channelId: DECK }, DECK)).toBe(false);
  });

  it('is false when there is no deck channel id yet, or a malformed message', () => {
    expect(isDeckSaveConfirmation({ type: 'deckParamsSaved', channelId: DECK }, undefined)).toBe(false);
    expect(isDeckSaveConfirmation({ type: 'deckParamsSaved' }, DECK)).toBe(false);
    expect(isDeckSaveConfirmation(null, DECK)).toBe(false);
  });
});
