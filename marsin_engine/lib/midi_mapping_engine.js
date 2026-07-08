// MIDI mapping — binds a physical MIDI control to a pattern's LOCAL parameter.
//
// Stored per playlist entry, MIRRORING the modulation system (docs/26 + docs/34):
// the same per-entry array, CRUD endpoints, lenient-load / strict-save coercion,
// and `playlistSaved` broadcast — so bindings are persisted with the pattern and
// stay in sync across every connected client (multiclient, like modulations).
//
// UNLIKE modulations, midiMappings are PURE METADATA for the engine: the render
// loop never reads or applies them. CaptainPad consumes them — when the bound
// MIDI control moves, CaptainPad writes the param's STATIC value through the
// existing control path (setDeck/MixerChannelControl); audio modulators stay
// layered on top untouched.
//
// Shape:
//   { id, enabled, control: { type:'cc'|'note', channel, number },
//     target: { scope:'pattern', parameter }, range: [min, max] }

const VALID_CONTROL_TYPES = new Set(['cc', 'note']);
const VALID_TARGET_SCOPES = new Set(['pattern']);
// Same bounds as modulation ranges — local params live in [0,1] but a learned
// fader may scale/invert, so allow the same generous window.
const RANGE_MIN = -4;
const RANGE_MAX = 4;

/**
 * Validate (and narrow) one MIDI mapping. Throws on the first problem with the
 * mapping id in the message — codex P0: no partial mappings, fail loudly.
 * @param {unknown} m
 * @returns {object} the input, narrowed
 */
export function validateMidiMapping(m) {
  if (!m || typeof m !== 'object') {
    throw new Error('MidiMapping: must be an object');
  }
  const map = /** @type {Record<string, any>} */ (m);
  if (typeof map.id !== 'string' || map.id.length === 0) {
    throw new Error('MidiMapping: id must be a non-empty string');
  }
  if (typeof map.enabled !== 'boolean') {
    throw new Error(`MidiMapping ${map.id}: enabled must be boolean`);
  }
  const ctl = map.control;
  if (!ctl || typeof ctl !== 'object') {
    throw new Error(`MidiMapping ${map.id}: control required`);
  }
  if (!VALID_CONTROL_TYPES.has(ctl.type)) {
    throw new Error(`MidiMapping ${map.id}: control.type must be 'cc' or 'note'`);
  }
  if (!Number.isInteger(ctl.channel) || ctl.channel < 0 || ctl.channel > 15) {
    throw new Error(`MidiMapping ${map.id}: control.channel must be an integer 0-15`);
  }
  if (!Number.isInteger(ctl.number) || ctl.number < 0 || ctl.number > 127) {
    throw new Error(`MidiMapping ${map.id}: control.number must be an integer 0-127`);
  }
  const tgt = map.target;
  if (!tgt || typeof tgt !== 'object') {
    throw new Error(`MidiMapping ${map.id}: target required`);
  }
  if (!VALID_TARGET_SCOPES.has(tgt.scope)) {
    throw new Error(`MidiMapping ${map.id}: target.scope must be 'pattern'`);
  }
  if (typeof tgt.parameter !== 'string' || tgt.parameter.length === 0) {
    throw new Error(`MidiMapping ${map.id}: target.parameter must be a non-empty string`);
  }
  if (!Array.isArray(map.range) || map.range.length !== 2
      || !Number.isFinite(map.range[0]) || !Number.isFinite(map.range[1])) {
    throw new Error(`MidiMapping ${map.id}: range must be [min, max] of finite numbers`);
  }
  const [lo, hi] = map.range;
  if (lo < RANGE_MIN || lo > RANGE_MAX || hi < RANGE_MIN || hi > RANGE_MAX) {
    throw new Error(`MidiMapping ${map.id}: range values must be within [${RANGE_MIN}, ${RANGE_MAX}]`);
  }
  return map;
}
