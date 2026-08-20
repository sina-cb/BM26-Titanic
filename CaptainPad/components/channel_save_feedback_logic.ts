import { isDeckSaveConfirmation, type SaveConfirmMessage } from './deck_saved_logic';

export type ChannelSaveFeedback = 'saved' | 'failed' | null;

export interface ChannelSaveMessage extends SaveConfirmMessage {
  error?: unknown;
}

/**
 * Classify only channel-scoped, engine-authoritative persistence results.
 * A mixer/deck state broadcast is not a save acknowledgement; Performance
 * mode and auto-save-off intentionally produce no matching message.
 */
export function channelSaveFeedback(
  message: ChannelSaveMessage | null | undefined,
  channelId: string | null | undefined,
): ChannelSaveFeedback {
  if (!message || !channelId || message.channelId !== channelId) return null;
  if (isDeckSaveConfirmation(message, channelId)) return 'saved';
  if (message.type === 'channelParamsSaved') return 'saved';
  if (message.type === 'channelParamsSaveFailed') return 'failed';
  return null;
}

export function channelSaveFailureMessage(message: ChannelSaveMessage): string {
  return typeof message.error === 'string' && message.error.trim().length > 0
    ? message.error
    : 'The live value was applied, but its channel state was not saved.';
}
