// deck_saved_logic — pure predicate for the deck's "✓ SAVED" flash trigger.
//
// The green flash confirms the deck's params were PERSISTED. Two engine events
// mean exactly that for the deck channel:
//   - `deckParamsSaved`      — a deck LOCAL-PARAM write hit deck_state.yaml
//                              (emitted only when auto-save is ON, so with
//                              auto-save OFF the flash honestly never fires —
//                              nothing was saved).
//   - `playlistEntryCaptured`— an explicit / on-switch capture wrote the deck's
//                              params into the active playlist entry's defaults.
// Both are addressed by `channelId`; the flash fires only for OUR deck channel.
// Kept dependency-free so the trigger is unit-testable without React.

export interface SaveConfirmMessage {
  type?: string;
  channelId?: string;
}

/** True when `msg` confirms a persisted save for `deckChannelId` — the signal
 *  the deck's "✓ SAVED" flash keys off. False for any other event, a missing
 *  channel id, or a save on a DIFFERENT channel. */
export function isDeckSaveConfirmation(
  msg: SaveConfirmMessage | null | undefined,
  deckChannelId: string | null | undefined,
): boolean {
  if (!msg || !deckChannelId) return false;
  if (msg.channelId !== deckChannelId) return false;
  return msg.type === 'deckParamsSaved' || msg.type === 'playlistEntryCaptured';
}
