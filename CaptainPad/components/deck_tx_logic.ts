/**
 * deck_tx_logic — PURE UI-state derivations for the DECK TX panel
 * (components/DeckTransitionControls.tsx). No React / react-native imports so
 * vitest can pin the logic in plain Node (same posture as utils/midi/*).
 *
 * Extracted 2026-07-07 for the operator bug "the deck TX is not allowing me
 * to change the blending mode …": the transition-STYLE picker's disabled
 * state was derived inline as `shuffle || !enabled`, coupling the operator's
 * ability to change the blend mode to the SHUFFLE STYLE toggle. The blend
 * mode must be settable at ANY time; only a fully disabled DECK TX (enabled
 * === false, where swaps are instant loads and no blend runs at all) greys
 * the picker.
 */

/** The two DECK TX config fields the picker derivations read. */
export interface DeckTxPickerState {
  /** DECK TX master toggle — false means instant loads, no transition. */
  enabled: boolean;
  /** SHUFFLE STYLE — engine rolls a random trans_* per swap while true. */
  shuffle: boolean;
}

/**
 * Whether the TransitionStylePicker is greyed out / untappable.
 *
 * The blend mode is settable regardless of shuffle state (operator bug
 * 2026-07-07). Only DECK TX OFF disables it — with transitions disabled the
 * mode is moot until the operator turns the panel back on.
 */
export function isTransitionStylePickerDisabled({ enabled }: DeckTxPickerState): boolean {
  return !enabled;
}

/**
 * The config patch to POST when the operator explicitly picks a transition
 * style. While SHUFFLE STYLE is on, the engine rolls a random style per swap
 * and IGNORES the configured mode — so an explicit pick must also switch
 * shuffle off in the same atomic patch, otherwise the pick would have no
 * effect on the next transition (it would sit latent behind the shuffle).
 * With shuffle already off, the patch is just the mode.
 */
export function buildTransitionModePatch(
  mode: string,
  currentShuffle: boolean,
): { mode: string; shuffle?: boolean } {
  return currentShuffle ? { mode, shuffle: false } : { mode };
}
