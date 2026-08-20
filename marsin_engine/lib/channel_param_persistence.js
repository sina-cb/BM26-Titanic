/**
 * Persist a channel parameter state change and emit an acknowledgement only
 * after the strict write completes. Persistence-disabled callers intentionally
 * emit nothing: a live-only value must never be presented as saved.
 */
export function persistChannelParamState({
  enabled,
  channelId,
  save,
  emit,
  successType,
  failureMessage,
  logFailure,
}) {
  if (!enabled) return { attempted: false, saved: false, error: null };

  try {
    save();
    emit({ type: successType, channelId });
    return { attempted: true, saved: true, error: null };
  } catch (error) {
    logFailure(error);
    emit({ type: 'channelParamsSaveFailed', channelId, error: failureMessage });
    return { attempted: true, saved: false, error: failureMessage };
  }
}
