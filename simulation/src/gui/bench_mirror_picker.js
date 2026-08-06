/**
 * bench_mirror_picker.js — pure state for the BENCH MIRROR source picker
 * (report 20260805_155 §8.3).
 *
 * ONE ROW PER BENCH SLOT, one dropdown each. No presets, no scene picker
 * (operator ruling 2026-08-05): the source scene is whatever the ENGINE is
 * running, and the only decision left is "which fixture of that scene feeds this
 * bench fixture" — including `none`, which holds the fixture dark.
 *
 * DOM-FREE on purpose, like `bench_mirror_control.js`: the panel that renders
 * this is a Preact/htm module whose dependencies are vendored for the browser
 * only and cannot be imported by a Node test. Every decision — what is
 * pre-selected, which rows can be confirmed, what a zero-candidate row says,
 * which sources are used twice — lives here where it is unit-testable.
 *
 * NOTHING HERE IS TRUSTED BY THE BRIDGE. This is advisory data for a human; the
 * ARM re-resolves the whole mapping from disk in the same pass that arms, so a
 * scene edit between "picker opened" and "ARM clicked" is refused there by name
 * rather than assumed away here.
 */

/** The dropdown entry that holds a bench fixture dark. */
export const NONE_OPTION = { value: null, label: '— none (held dark) —' };

/**
 * Build the picker's render state.
 *
 * @param {Object|null} options the bridge's `benchMirrorOptions` reply
 * @param {Object|null} draft   the operator's in-progress choices
 *        ({ slotId: name|null }); absent slots fall back to the pre-selection
 * @returns {{ok:boolean, refusal:(string|null), title:string, subtitle:string,
 *            rows:Array<Object>, selection:Object, canConfirm:boolean,
 *            confirmLabel:string}}
 */
export function benchMirrorPickerState(options, draft) {
  if (!options) {
    return {
      ok: false,
      refusal: 'The bridge has not answered the picker request yet.',
      title: '🪞 BENCH MIRROR — choose sources',
      subtitle: '',
      rows: [],
      selection: {},
      canConfirm: false,
      confirmLabel: 'ARM',
    };
  }
  if (options.ok !== true) {
    return {
      ok: false,
      // A resolution failure is readable AT THE POINT OF GESTURE, verbatim —
      // not buried in a log the operator has to go find.
      refusal: typeof options.refusal === 'string' && options.refusal
        ? options.refusal : 'The bridge refused to compute the mapping options.',
      title: '🪞 BENCH MIRROR — choose sources',
      subtitle: `${options.label || options.scene || ''}`,
      rows: [],
      selection: {},
      canConfirm: false,
      confirmLabel: 'ARM',
    };
  }

  const slots = Array.isArray(options.slots) ? options.slots : [];
  const chosen = {};
  for (const slot of slots) {
    if (draft && Object.prototype.hasOwnProperty.call(draft, slot.slot)) {
      chosen[slot.slot] = draft[slot.slot];
      continue;
    }
    // Pre-selection precedence: last-used beats the sidecar default. Both are
    // only offered when they are actually in this slot's candidate list for the
    // CURRENT source scene — a remembered choice from another scene, or a
    // default that scene does not carry, pre-selects NOTHING rather than
    // silently swapping in something else.
    const names = new Set((slot.candidates || []).map(c => c.name));
    if (slot.lastUsed && names.has(slot.lastUsed)) chosen[slot.slot] = slot.lastUsed;
    else if (slot.defaultSource && names.has(slot.defaultSource)) chosen[slot.slot] = slot.defaultSource;
    else chosen[slot.slot] = null;
  }

  const useCount = new Map();
  for (const name of Object.values(chosen)) {
    if (name === null) continue;
    useCount.set(name, (useCount.get(name) || 0) + 1);
  }

  const rows = slots.map((slot) => {
    const candidates = slot.candidates || [];
    const value = chosen[slot.slot];
    const profile = slot.kind === 'dmx' || slot.kind === 'led_fixture'
      ? `${slot.fixtureType}·${slot.footprintCh}ch`
      : `${slot.pixelCount}px`;
    return {
      slot: slot.slot,
      benchFixture: slot.benchFixture,
      profile,
      dest: slot.dest,
      value,
      // `none` is always offered: holding a fixture dark is a choice.
      choices: [NONE_OPTION, ...candidates.map(c => ({
        value: c.name,
        label: `${c.name} (U${c.universe}/${c.addr})`,
        note: c.note || '',
      }))],
      // A source feeding two slots is legal and useful (side-by-side compare) —
      // badge it, never warn about it: the destination pairs stay disjoint, so
      // the one-writer law is untouched.
      duplicate: value !== null && (useCount.get(value) || 0) > 1,
      empty: candidates.length === 0,
      emptyNote: candidates.length === 0
        ? `no compatible fixture in '${options.sourceScene}' — this bench slot is a ` +
          `${slot.fixtureType || slot.kind} and profiles must match exactly`
        : '',
    };
  });

  return {
    ok: true,
    refusal: null,
    title: '🪞 BENCH MIRROR — choose sources',
    subtitle: `${options.sourceScene} → ${options.scene} · ${options.label}`,
    rows,
    selection: chosen,
    // Confirm is always allowed once the options resolved: an all-`none` arm is
    // a legitimate gesture (own the bench, hold it dark) and every real refusal
    // belongs to the bridge, which re-resolves anyway.
    canConfirm: rows.length > 0,
    confirmLabel: `🪞 ARM — ${rows.filter(r => r.value !== null).length}/${rows.length} slots`,
  };
}

/** Reset every slot to its sidecar default (the `[↺ defaults]` button). */
export function pickerDefaults(options) {
  const out = {};
  for (const slot of (options && options.slots) || []) {
    const names = new Set((slot.candidates || []).map(c => c.name));
    out[slot.slot] = (slot.defaultSource && names.has(slot.defaultSource))
      ? slot.defaultSource : null;
  }
  return out;
}

/** Reset every slot to the last-used choice (the `[last used]` button). */
export function pickerLastUsed(options) {
  const out = {};
  for (const slot of (options && options.slots) || []) {
    const names = new Set((slot.candidates || []).map(c => c.name));
    out[slot.slot] = (slot.lastUsed && names.has(slot.lastUsed)) ? slot.lastUsed : null;
  }
  return out;
}
