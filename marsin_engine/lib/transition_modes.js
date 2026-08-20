// Canonical executable Deck-transition catalog.
//
// Keep this list explicit: a transition enters operator shuffle and Timeline
// authoring only after its script has passed the endpoint/full-rig oracle.
// Consumers must reject names outside this set instead of guessing a fallback.
export const DECK_TRANSITION_MODES = Object.freeze([
  'trans_crossfade',
  'trans_flash',
  'trans_color_burst',
  'trans_dissolve',
  'trans_wipe_right',
  'trans_wipe_left',
  'trans_wipe_down',
  'trans_diagonal_wipe',
  'trans_wave_sweep',
  'trans_iris',
  'trans_iris_close',
  'trans_diamond_wipe',
  'trans_split_horizontal',
  'trans_split_vertical',
  'trans_ripple_in',
]);

const DECK_TRANSITION_MODE_SET = new Set(DECK_TRANSITION_MODES);

export function isDeckTransitionMode(mode) {
  return typeof mode === 'string' && DECK_TRANSITION_MODE_SET.has(mode);
}

export function pickDeckTransitionMode(randomValue = Math.random()) {
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new Error(`transition shuffle random value must be finite in [0,1), got '${randomValue}'`);
  }
  return DECK_TRANSITION_MODES[Math.floor(randomValue * DECK_TRANSITION_MODES.length)];
}
