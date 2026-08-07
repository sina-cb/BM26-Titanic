/**
 * bench_mirror_picker.js — pure state for the BENCH MIRROR source picker
 * (report 20260805_155 §8.3, extended by design report 20260806_174 §3.6).
 *
 * ONE ROW PER BENCH SLOT: one dropdown, and — on multi-pixel rows only — one
 * `⇄ Reverse Pixels` toggle with a visible NORMAL / REVERSED badge. No presets,
 * no scene picker (operator ruling 2026-08-05): the source scene is whatever the
 * ENGINE is running, and the only decisions left are "which fixture of that
 * scene feeds this bench fixture" — including `none`, which holds the fixture
 * dark — and "does this bench fixture run the same way round as its source".
 *
 * WHAT REVERSED MEANS, IN OPERATOR LANGUAGE. Set it exactly when the two
 * physical fixtures' pixel-0→N directions disagree. It is pure RELATIVE
 * orientation between the source fixture and the bench fixture, and it is
 * independent of any scene-level pixel-order correction either scene carries:
 * each scene's own correction is already inside its wire stream before the
 * mirror copies a byte (design 20260806_174 §4). Today's rig: the ship walls run
 * toward increasing X and the bench bars toward decreasing X, so Wall→Bar wants
 * REVERSED.
 *
 * SINGLE-PIXEL ROWS NEVER SEE THE CONTROL. `reverseApplicable` comes from the
 * bridge (destination pixel count > 1 and a definition whose per-pixel channel
 * maps validate), so a par row cannot even express the idea — and if one ever
 * arrives with `reverse: true` anyway, the bridge refuses it by name rather than
 * ignoring it.
 *
 * DOM-FREE on purpose, like `bench_mirror_control.js`: the panel that renders
 * this is a Preact/htm module whose dependencies are vendored for the browser
 * only and cannot be imported by a Node test. Every decision — what is
 * pre-selected, which rows can be reversed, what a zero-candidate row says,
 * which sources are used twice, what a stale remembered row shows — lives here
 * where it is unit-testable.
 *
 * NOTHING HERE IS TRUSTED BY THE BRIDGE. This is advisory data for a human; the
 * ARM re-resolves the whole mapping from disk in the same pass that arms, so a
 * scene edit between "picker opened" and "ARM clicked" is refused there by name
 * rather than assumed away here.
 */

/** The dropdown entry that holds a bench fixture dark. */
export const NONE_OPTION = { value: null, label: '— none (held dark) —' };

/** One selection entry, in the shape the WS ARM message carries. */
function entry(source, reverse) {
  return { source: source === undefined ? null : source, reverse: reverse === true };
}

/**
 * The pre-selection for one slot, before any operator draft.
 *
 * Precedence: the REMEMBERED choice beats the sidecar default. Both are only
 * offered when they are actually in this slot's candidate list for the CURRENT
 * source scene — the bridge has already validated the remembered one and
 * reports `staleReason` instead when it no longer resolves, so a stale entry
 * pre-selects NOTHING rather than silently swapping in something else.
 */
function preselect(slot) {
  const names = new Set((slot.candidates || []).map(c => c.name));
  const applicable = slot.reverseApplicable === true;
  const stale = typeof slot.staleReason === 'string' && slot.staleReason !== '';
  // A row the bridge flagged stale pre-fills NOTHING — not the source and not
  // the pixel order. The bridge already clears `reverse` in that case; stating
  // it here too means the rule survives a payload that ever disagrees.
  const reverse = applicable && !stale && slot.reverse === true;
  if (slot.storedSource !== null && slot.storedSource !== undefined) {
    if (names.has(slot.storedSource)) return entry(slot.storedSource, reverse);
  } else if (slot.stored !== null && slot.stored !== undefined && slot.staleReason === null) {
    // A remembered `none` is a real remembered choice, not an absence.
    return entry(null, reverse);
  }
  if (slot.defaultSource && names.has(slot.defaultSource)) {
    return entry(slot.defaultSource, reverse);
  }
  return entry(null, reverse);
}

/**
 * Build the picker's render state.
 *
 * @param {Object|null} options the bridge's `benchMirrorOptions` reply
 * @param {Object|null} draft   the operator's in-progress choices
 *        (`{ slotId: {source, reverse} }`); absent slots fall back to the
 *        pre-selection
 * @returns {{ok:boolean, refusal:(string|null), title:string, subtitle:string,
 *            warnings:string[], rows:Array<Object>, selection:Object,
 *            canConfirm:boolean, confirmLabel:string}}
 */
export function benchMirrorPickerState(options, draft) {
  if (!options) {
    return {
      ok: false,
      refusal: 'The bridge has not answered the picker request yet.',
      title: '🪞 BENCH MIRROR — choose sources',
      subtitle: '',
      warnings: [],
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
      warnings: Array.isArray(options.warnings) ? options.warnings : [],
      rows: [],
      selection: {},
      canConfirm: false,
      confirmLabel: 'ARM',
    };
  }

  const slots = Array.isArray(options.slots) ? options.slots : [];
  const chosen = {};
  for (const slot of slots) {
    const drafted = draft && Object.prototype.hasOwnProperty.call(draft, slot.slot)
      ? draft[slot.slot] : null;
    const base = drafted !== null ? entry(drafted.source, drafted.reverse) : preselect(slot);
    // A row that cannot be reversed can never CARRY a reverse, whatever the
    // draft or the remembered state says. The bridge would refuse it by name;
    // never offering it is the same rule stated one step earlier.
    chosen[slot.slot] = entry(base.source, slot.reverseApplicable === true && base.reverse);
  }

  const useCount = new Map();
  for (const sel of Object.values(chosen)) {
    if (sel.source === null) continue;
    useCount.set(sel.source, (useCount.get(sel.source) || 0) + 1);
  }

  const rows = slots.map((slot) => {
    const candidates = slot.candidates || [];
    const sel = chosen[slot.slot];
    const profile = slot.kind === 'dmx' || slot.kind === 'led_fixture'
      ? `${slot.fixtureType}·${slot.footprintCh}ch`
      : `${slot.pixelCount}px`;
    const stale = (typeof slot.staleReason === 'string' && slot.staleReason)
      ? slot.staleReason : null;
    return {
      slot: slot.slot,
      benchFixture: slot.benchFixture,
      profile,
      dest: slot.dest,
      value: sel.source,
      reverse: sel.reverse,
      reverseApplicable: slot.reverseApplicable === true,
      // The badge is shown on EVERY applicable row, reversed or not: "which way
      // round is this running" must be readable without clicking anything.
      reverseLabel: slot.reverseApplicable === true ? (sel.reverse ? 'REVERSED' : 'NORMAL') : '',
      reverseTitle: slot.reverseApplicable === true
        ? 'Pixel order relative to the source fixture. REVERSED = the two physical fixtures ' +
          'run opposite ways (bench pixel 1 shows the source\'s LAST pixel). Verify with ' +
          'calibration pattern 71.'
        : 'This bench fixture has a single pixel — there is no pixel order to reverse.',
      // `none` is always offered: holding a fixture dark is a choice.
      choices: [NONE_OPTION, ...candidates.map(c => ({
        value: c.name,
        label: `${c.name} (U${c.universe}/${c.addr})`,
        note: c.note || '',
      }))],
      // A source feeding two slots is legal and useful (side-by-side compare) —
      // badge it, never warn about it: the destination pairs stay disjoint, so
      // the one-writer law is untouched.
      duplicate: sel.source !== null && (useCount.get(sel.source) || 0) > 1,
      empty: candidates.length === 0,
      emptyNote: candidates.length === 0
        ? `no compatible fixture in '${options.sourceScene}' — this bench slot is a ` +
          `${slot.fixtureType || slot.kind} and profiles must match exactly`
        : '',
      // What was remembered, and why it was not applied. Shown verbatim: a
      // remembered choice that silently vanished is the failure mode persistence
      // was supposed to remove, not introduce.
      stored: slot.stored || null,
      staleReason: stale,
      staleNote: stale === null ? '' : (slot.stored
        ? `remembered: ${slot.stored.source === null ? 'none' : slot.stored.source}` +
          `${slot.stored.reverse ? ' · REVERSED' : ''} — ${stale}`
        : stale),
    };
  });

  return {
    ok: true,
    refusal: null,
    title: '🪞 BENCH MIRROR — choose sources',
    subtitle: `${options.sourceScene} → ${options.scene} · ${options.label}`,
    warnings: Array.isArray(options.warnings) ? options.warnings : [],
    rows,
    selection: chosen,
    // Confirm is always allowed once the options resolved: an all-`none` arm is
    // a legitimate gesture (own the bench, hold it dark) and every real refusal
    // belongs to the bridge, which re-resolves anyway.
    canConfirm: rows.length > 0,
    confirmLabel: `🪞 ARM — ${rows.filter(r => r.value !== null).length}/${rows.length} slots`,
  };
}

/**
 * Set one row's SOURCE, keeping its pixel order. Pure — returns a new draft.
 *
 * @param {Object} selection the current full selection (from the state above)
 * @param {string} slot
 * @param {string|null} source
 */
export function pickerSetSource(selection, slot, source) {
  const prev = selection[slot] || entry(null, false);
  return { ...selection, [slot]: entry(source === '' ? null : source, prev.reverse) };
}

/**
 * Flip one row's PIXEL ORDER, keeping its source. Pure — returns a new draft.
 * `applicable: false` is a no-op returning the same selection: the control is
 * not rendered on those rows, so reaching here means a caller bug, and inventing
 * a reverse for a par is exactly what the bridge would refuse.
 */
export function pickerSetReverse(selection, slot, reverse, applicable) {
  if (applicable !== true) return selection;
  const prev = selection[slot] || entry(null, false);
  return { ...selection, [slot]: entry(prev.source, reverse) };
}

/**
 * Reset every slot to the SCENE DEFAULTS: the sidecar's `default_source` and
 * NORMAL pixel order everywhere (the `↺ scene defaults` button).
 *
 * This is the explicit "forget what I armed last time" gesture. It is a STAGING
 * action only — it writes nothing. The remembered file is replaced by the next
 * successful ARM, which is the one moment a selection is proven.
 */
export function pickerDefaults(options) {
  const out = {};
  for (const slot of (options && options.slots) || []) {
    const names = new Set((slot.candidates || []).map(c => c.name));
    const source = (slot.defaultSource && names.has(slot.defaultSource))
      ? slot.defaultSource : null;
    out[slot.slot] = entry(source, false);
  }
  return out;
}
