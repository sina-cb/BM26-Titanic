import { describe, expect, it } from 'vitest';

import {
  channelSaveFailureMessage,
  channelSaveFeedback,
} from './channel_save_feedback_logic';

const CHANNEL = 'ch_layer_1';

describe('channelSaveFeedback', () => {
  it('accepts every authoritative persisted-state acknowledgement', () => {
    expect(channelSaveFeedback({ type: 'deckParamsSaved', channelId: CHANNEL }, CHANNEL)).toBe('saved');
    expect(channelSaveFeedback({ type: 'playlistEntryCaptured', channelId: CHANNEL }, CHANNEL)).toBe('saved');
    expect(channelSaveFeedback({ type: 'channelParamsSaved', channelId: CHANNEL }, CHANNEL)).toBe('saved');
  });

  it('classifies a strict mixer-state write failure without claiming success', () => {
    expect(channelSaveFeedback({ type: 'channelParamsSaveFailed', channelId: CHANNEL }, CHANNEL)).toBe('failed');
  });

  it('ignores state echoes, suppressed persistence, and other channels', () => {
    expect(channelSaveFeedback({ type: 'mixer', channelId: CHANNEL }, CHANNEL)).toBeNull();
    expect(channelSaveFeedback({ type: 'channelParamsSaved', channelId: 'other' }, CHANNEL)).toBeNull();
    expect(channelSaveFeedback(null, CHANNEL)).toBeNull();
  });

  it('uses the engine error when present and a loud generic message otherwise', () => {
    expect(channelSaveFailureMessage({ error: 'Disk unavailable.' })).toBe('Disk unavailable.');
    expect(channelSaveFailureMessage({})).toMatch(/not saved/i);
  });
});
