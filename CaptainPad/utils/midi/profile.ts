// Controller profile — the data-not-code mapping for one MIDI device.
//
// A profile is authored as YAML (CaptainPad/midi_profiles/<device>.yaml),
// imported through the existing yaml-transformer path (same mechanism as
// config.yaml), and validated at load. The validator is PURE and THROWS on
// any structural problem with the offending control id in the message —
// codex P0: no partial profiles, fail loudly. Multiple profiles can be loaded
// at once (one per attached controller) — the manager runs them concurrently,
// which is how "APC mini first, MFT second" stays a data change, not a rewrite.

export type Range = readonly [number, number];

/** How an inbound message is matched to a control. */
export type ControlMatch =
  // `relative: true` marks an endless-encoder CC (MIDI Fighter Twister): the CC
  // VALUE is a signed relative-delta code (decoded via mft/messages), not an
  // absolute 0-127 position. The resolver decodes it to a delta action; an
  // unknown code resolves to null (loud silence). Absolute faders omit it.
  | { type: 'cc'; channel: number; cc: number; relative?: boolean }
  // `notes`: length 1 = a single note; length 2 = inclusive [lo, hi] range
  // (e.g. a pad row). The matched note's offset from lo becomes the action
  // index (used by patternBank to pick which pattern within the bank).
  | { type: 'note'; channel: number; notes: number[] }
  // A strided grid COLUMN: APC pad note = row*8 + column (row 0 = bottom).
  // Matches pads in `column` whose row is in [fromRow, toRow]; the matched
  // pad's index becomes the action index. Used by the per-layer playlist
  // window browser and the colour-pair pads. `reverse: true` flips the index
  // so the TOP pad is index 0 — the APC grid runs bottom→up, but the playlist
  // UI runs top→down, so the window browser reverses to stay visually aligned.
  | { type: 'column'; channel: number; column: number; fromRow: number; toRow: number; reverse?: boolean };

/** What a matched control does. Maps 1:1 onto utils/api.ts dispatch fns. */
export type ProfileAction =
  | { kind: 'paramCenter'; key: string; range: Range }
  | { kind: 'master' }
  | { kind: 'pattern'; name: string }
  | { kind: 'patternBank'; bank: number }
  | { kind: 'blackoutToggle' }
  | { kind: 'globalEffect'; effect: string }
  | { kind: 'sectionBrightness'; sectionId: number; range: Range }
  | { kind: 'groupFixedColor'; group: string; color: number[]; brightness: number }
  // ── Operator-mapping kinds (Stage 1) ──
  // A mixer "layer" = the Nth mixer channel by order (0-based). Inert when no
  // such channel exists (and its pad column stays dark).
  | { kind: 'mixerLayerFader'; layer: number; range: Range }
  // Focus the Nth layer (Mixer tab) so the learnable param faders (4-6) drive
  // its active pattern's MIDI bindings. Controller/UI state, not an engine call.
  | { kind: 'focusChannel'; layer: number }
  // Global-effect slot (1-based, matches CaptainPad GEM); toggles the slot.
  | { kind: 'globalEffectSlot'; slot: number }
  // ── Stage 2 ──
  // Per-layer playlist window browser: scroll the 6-entry window up/down…
  | { kind: 'playlistScroll'; layer: number; dir: 'up' | 'down' }
  // …and select within the window (the matched pad's row index = window slot).
  | { kind: 'playlistWindowSelect'; layer: number }
  // Colour-pair pads: apply a curated palette pair; `bank`*8 + index = palette.
  | { kind: 'colorPalettePair'; bank: number }
  // ── Driver #2 — MIDI Fighter Twister (relative-encoder) kinds ──
  // Endless knob `index` (0-15) drives the FOCUSED channel's active-pattern
  // export at that ordered position. `steps` = the three ascending per-tick
  // magnitudes for delta codes ±1/±2/±3 (default [0.005, 0.02, 0.06] of full
  // range). A relative match feeds this; the runtime accumulates the deltas.
  | { kind: 'focusedParamKnob'; index: number; steps: [number, number, number] }
  // Encoder push → reset the focused param at `index` to the entry's saved
  // default (handled app-side).
  | { kind: 'focusedParamReset'; index: number }
  // A relative knob driving a CPC global param by key (bank-2 rings). Same
  // step semantics as focusedParamKnob.
  | { kind: 'paramCenterRelative'; key: string; steps: [number, number, number] }
  // Side-button focus move: prev/next within the existing layers, or the deck
  // (layer 0). A secondary focus path so the MFT is self-sufficient.
  | { kind: 'focusStep'; dir: 'prev' | 'next' | 'deck' };

/** LED feedback spec. RGB pads use { active, idle } colour velocities (with
 *  optional `channel` for brightness/behaviour, default 6 = solid 100%).
 *  Single-colour buttons use { on, off } velocities (0x00 off / 0x01 on).
 *  `flash` is the velocity a single-colour button emits while its focused
 *  channel is pickup-LOCKED (APC single-colour blink = velocity 2); the
 *  projector falls back to `on` when a control has no flash velocity. */
export interface LedSpec {
  active?: number;
  idle?: number;
  on?: number;
  off?: number;
  flash?: number;
  channel?: number;
}

export interface ControlDef {
  id: string;
  match: ControlMatch;
  action: ProfileAction;
  led?: LedSpec;
}

export interface DeviceDef {
  /** Stable driver id, e.g. "apc_mini_mk2". */
  id: string;
  label: string;
  /** Substring matched against the endpoint name. */
  nameContains: string;
  /** OPTIONAL exact-name pin. When present, endpoint selection requires an
   *  EXACT name match (===), not just a `nameContains` substring — so a spare
   *  identical unit whose near-name ("MIDIIN2 (APC mini mk2)") would otherwise
   *  satisfy `nameContains` and shift portIndex 0 onto the wrong device is
   *  rejected. Backward-compatible: absent → `nameContains` matching unchanged. */
  nameEquals?: string;
  /** Which port (by index among same-name matches) carries input. */
  sourcePort: number;
  /** Which port receives LED feedback. */
  destinationPort: number;
  /** When true, the runtime pushes a sysex config frame set on connect (the
   *  MIDI Fighter Twister: forces its 64 encoders into the relative-mode layout
   *  this driver assumes). Requires a transport that can send sysex; if it can't
   *  the controller goes RED with the reason (never runs against unknown encoder
   *  modes — docs/34 §5.3). Default false (the APC needs no config push). */
  configureOnConnect?: boolean;
}

export interface ControllerProfile {
  device: DeviceDef;
  /** Default control set — equals contexts.deck, or the first context, or the
   *  flat `controls:` list. Used when no active context is supplied. */
  controls: ControlDef[];
  /** Per-tab (context) control sets, e.g. { deck: [...], mixer: [...] }. The
   *  active CaptainPad tab selects one; the SAME physical control can map to
   *  different actions per context. A flat `controls:` profile becomes
   *  { default: controls }. Always populated. */
  contexts: Record<string, ControlDef[]>;
}

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileValidationError';
  }
}

const ACTION_KINDS = new Set([
  'paramCenter', 'master', 'pattern', 'patternBank',
  'blackoutToggle', 'globalEffect', 'sectionBrightness', 'groupFixedColor',
  'mixerLayerFader', 'focusChannel', 'globalEffectSlot',
  'playlistScroll', 'playlistWindowSelect', 'colorPalettePair',
  'focusedParamKnob', 'focusedParamReset', 'paramCenterRelative', 'focusStep',
]);

/** Default per-tick step magnitudes for a relative encoder: the three ascending
 *  deltas that codes ±1/±2/±3 map to (fraction of full range per detent). */
export const DEFAULT_RELATIVE_STEPS: [number, number, number] = [0.005, 0.02, 0.06];

/** Validate a relative-encoder `steps` triple: exactly three positive, strictly
 *  ascending magnitudes (coarse control must not be finer than normal). Absent
 *  → the default triple. */
function validateSteps(where: string, s: unknown): [number, number, number] {
  if (s === undefined || s === null) return [...DEFAULT_RELATIVE_STEPS];
  if (!Array.isArray(s) || s.length !== 3 || !s.every((n) => typeof n === 'number' && n > 0)) {
    fail(`${where}: steps must be three positive numbers [normal, fast, veryFast]`);
  }
  const [a, b, c] = s as [number, number, number];
  if (!(a < b && b < c)) fail(`${where}: steps must be strictly ascending [normal < fast < veryFast]`);
  return [a, b, c];
}

function isByte(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 127;
}

function fail(msg: string): never {
  throw new ProfileValidationError(msg);
}

function validateRange(where: string, r: unknown): Range {
  if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== 'number' || typeof r[1] !== 'number') {
    fail(`${where}: range must be [min, max] numbers`);
  }
  const range = r as [number, number];
  if (range[0] === range[1]) fail(`${where}: range min and max must differ`);
  return range;
}

function validateMatch(where: string, m: any): ControlMatch {
  if (!m || typeof m !== 'object') fail(`${where}: missing match`);
  if (typeof m.channel !== 'number' || m.channel < 0 || m.channel > 15) {
    fail(`${where}: match.channel must be 0-15`);
  }
  if (m.type === 'cc') {
    if (!isByte(m.cc)) fail(`${where}: match.cc must be 0-127`);
    if (m.relative !== undefined && typeof m.relative !== 'boolean') fail(`${where}: match.relative must be a boolean`);
    return { type: 'cc', channel: m.channel, cc: m.cc, relative: m.relative === true };
  }
  if (m.type === 'note') {
    if (!Array.isArray(m.notes) || (m.notes.length !== 1 && m.notes.length !== 2)) {
      fail(`${where}: match.notes must be [n] (single) or [lo, hi] (inclusive range)`);
    }
    if (!m.notes.every(isByte)) fail(`${where}: match.notes values must be 0-127`);
    if (m.notes.length === 2 && m.notes[0] > m.notes[1]) {
      fail(`${where}: match.notes range lo must be <= hi`);
    }
    return { type: 'note', channel: m.channel, notes: [...m.notes] };
  }
  if (m.type === 'column') {
    if (typeof m.column !== 'number' || m.column < 0 || m.column > 7) fail(`${where}: match.column must be 0-7`);
    if (typeof m.fromRow !== 'number' || m.fromRow < 0 || m.fromRow > 7) fail(`${where}: match.fromRow must be 0-7`);
    if (typeof m.toRow !== 'number' || m.toRow < 0 || m.toRow > 7) fail(`${where}: match.toRow must be 0-7`);
    if (m.fromRow > m.toRow) fail(`${where}: match.fromRow must be <= toRow`);
    if (m.reverse !== undefined && typeof m.reverse !== 'boolean') fail(`${where}: match.reverse must be a boolean`);
    return { type: 'column', channel: m.channel, column: m.column, fromRow: m.fromRow, toRow: m.toRow, reverse: m.reverse === true };
  }
  return fail(`${where}: match.type must be 'cc', 'note', or 'column'`);
}

function validateAction(where: string, a: any): ProfileAction {
  if (!a || typeof a !== 'object') fail(`${where}: missing action`);
  if (!ACTION_KINDS.has(a.kind)) {
    fail(`${where}: unknown action.kind '${a.kind}' (expected one of ${[...ACTION_KINDS].join(', ')})`);
  }
  switch (a.kind) {
    case 'paramCenter':
      if (typeof a.key !== 'string' || !a.key) fail(`${where}: paramCenter requires a string 'key'`);
      return { kind: 'paramCenter', key: a.key, range: validateRange(where, a.range) };
    case 'master':
      return { kind: 'master' };
    case 'pattern':
      if (typeof a.name !== 'string' || !a.name) fail(`${where}: pattern requires a string 'name'`);
      return { kind: 'pattern', name: a.name };
    case 'patternBank':
      if (typeof a.bank !== 'number' || a.bank < 0) fail(`${where}: patternBank requires a non-negative 'bank'`);
      return { kind: 'patternBank', bank: a.bank };
    case 'blackoutToggle':
      return { kind: 'blackoutToggle' };
    case 'globalEffect':
      if (typeof a.effect !== 'string' || !a.effect) fail(`${where}: globalEffect requires a string 'effect'`);
      return { kind: 'globalEffect', effect: a.effect };
    case 'sectionBrightness':
      if (typeof a.sectionId !== 'number') fail(`${where}: sectionBrightness requires a numeric 'sectionId'`);
      return { kind: 'sectionBrightness', sectionId: a.sectionId, range: validateRange(where, a.range) };
    case 'groupFixedColor':
      if (typeof a.group !== 'string' || !a.group) fail(`${where}: groupFixedColor requires a string 'group'`);
      if (!Array.isArray(a.color) || !a.color.every((c: unknown) => typeof c === 'number')) {
        fail(`${where}: groupFixedColor requires a numeric 'color' array`);
      }
      if (typeof a.brightness !== 'number') fail(`${where}: groupFixedColor requires a numeric 'brightness'`);
      return { kind: 'groupFixedColor', group: a.group, color: [...a.color], brightness: a.brightness };
    case 'mixerLayerFader':
      if (typeof a.layer !== 'number' || a.layer < 0 || !Number.isInteger(a.layer)) {
        fail(`${where}: mixerLayerFader requires a non-negative integer 'layer'`);
      }
      return { kind: 'mixerLayerFader', layer: a.layer, range: a.range ? validateRange(where, a.range) : [0, 1] };
    case 'focusChannel':
      if (typeof a.layer !== 'number' || a.layer < 0 || !Number.isInteger(a.layer)) {
        fail(`${where}: focusChannel requires a non-negative integer 'layer'`);
      }
      return { kind: 'focusChannel', layer: a.layer };
    case 'globalEffectSlot':
      if (typeof a.slot !== 'number' || a.slot < 1 || !Number.isInteger(a.slot)) {
        fail(`${where}: globalEffectSlot requires a positive integer 'slot' (1-based)`);
      }
      return { kind: 'globalEffectSlot', slot: a.slot };
    case 'playlistScroll':
      if (typeof a.layer !== 'number' || a.layer < 0 || !Number.isInteger(a.layer)) {
        fail(`${where}: playlistScroll requires a non-negative integer 'layer'`);
      }
      if (a.dir !== 'up' && a.dir !== 'down') fail(`${where}: playlistScroll dir must be 'up' or 'down'`);
      return { kind: 'playlistScroll', layer: a.layer, dir: a.dir };
    case 'playlistWindowSelect':
      if (typeof a.layer !== 'number' || a.layer < 0 || !Number.isInteger(a.layer)) {
        fail(`${where}: playlistWindowSelect requires a non-negative integer 'layer'`);
      }
      return { kind: 'playlistWindowSelect', layer: a.layer };
    case 'colorPalettePair':
      if (typeof a.bank !== 'number' || a.bank < 0 || !Number.isInteger(a.bank)) {
        fail(`${where}: colorPalettePair requires a non-negative integer 'bank'`);
      }
      return { kind: 'colorPalettePair', bank: a.bank };
    case 'focusedParamKnob':
      if (typeof a.index !== 'number' || a.index < 0 || !Number.isInteger(a.index)) {
        fail(`${where}: focusedParamKnob requires a non-negative integer 'index'`);
      }
      return { kind: 'focusedParamKnob', index: a.index, steps: validateSteps(where, a.steps) };
    case 'focusedParamReset':
      if (typeof a.index !== 'number' || a.index < 0 || !Number.isInteger(a.index)) {
        fail(`${where}: focusedParamReset requires a non-negative integer 'index'`);
      }
      return { kind: 'focusedParamReset', index: a.index };
    case 'paramCenterRelative':
      if (typeof a.key !== 'string' || !a.key) fail(`${where}: paramCenterRelative requires a string 'key'`);
      return { kind: 'paramCenterRelative', key: a.key, steps: validateSteps(where, a.steps) };
    case 'focusStep':
      if (a.dir !== 'prev' && a.dir !== 'next' && a.dir !== 'deck') {
        fail(`${where}: focusStep dir must be 'prev', 'next', or 'deck'`);
      }
      return { kind: 'focusStep', dir: a.dir };
    default:
      return fail(`${where}: unhandled action.kind`);
  }
}

function validateLed(where: string, led: any): LedSpec | undefined {
  if (led === undefined || led === null) return undefined;
  if (typeof led !== 'object') fail(`${where}: led must be an object`);
  for (const k of ['active', 'idle', 'on', 'off', 'flash', 'channel'] as const) {
    if (led[k] !== undefined && !isByte(led[k])) fail(`${where}: led.${k} must be 0-127`);
  }
  return {
    active: led.active, idle: led.idle, on: led.on, off: led.off, flash: led.flash, channel: led.channel,
  };
}

/** Expand a match into the concrete (channel, kind, number) keys it occupies,
 *  so we can detect two controls claiming the same message. */
function matchKeys(m: ControlMatch): string[] {
  if (m.type === 'cc') return [`cc:${m.channel}:${m.cc}`];
  if (m.type === 'column') {
    const keys: string[] = [];
    for (let row = m.fromRow; row <= m.toRow; row++) keys.push(`note:${m.channel}:${row * 8 + m.column}`);
    return keys;
  }
  if (m.notes.length === 1) return [`note:${m.channel}:${m.notes[0]}`];
  const keys: string[] = [];
  for (let n = m.notes[0]; n <= m.notes[1]; n++) keys.push(`note:${m.channel}:${n}`);
  return keys;
}

/**
 * Validate + normalise a raw imported profile object. THROWS
 * ProfileValidationError on any structural problem (bad shape, unknown action
 * kind, out-of-range note/led byte, overlapping matches). Returns a typed,
 * frozen-shape ControllerProfile. Param-key validity against the live engine
 * schema is a separate, runtime check — see validateProfileParams().
 */
export function validateProfile(raw: any, profilePath = '<profile>'): ControllerProfile {
  if (!raw || typeof raw !== 'object') fail(`${profilePath}: profile must be an object`);
  const dev = raw.device;
  if (!dev || typeof dev !== 'object') fail(`${profilePath}: missing 'device'`);
  for (const k of ['id', 'label', 'nameContains'] as const) {
    if (typeof dev[k] !== 'string' || !dev[k]) fail(`${profilePath}: device.${k} must be a non-empty string`);
  }
  // Optional exact-name pin: absent → undefined; present must be a non-empty
  // string (an empty pin would match nothing). Fail-loud with YAML path context.
  if (dev.nameEquals !== undefined && (typeof dev.nameEquals !== 'string' || !dev.nameEquals)) {
    fail(`${profilePath}: device.nameEquals must be a non-empty string when present`);
  }
  for (const k of ['sourcePort', 'destinationPort'] as const) {
    if (typeof dev[k] !== 'number' || dev[k] < 0 || !Number.isInteger(dev[k])) {
      fail(`${profilePath}: device.${k} must be a non-negative integer`);
    }
  }
  if (dev.configureOnConnect !== undefined && typeof dev.configureOnConnect !== 'boolean') {
    fail(`${profilePath}: device.configureOnConnect must be a boolean`);
  }
  // A profile carries EITHER a flat `controls:` list (single context) OR a
  // `contexts:` map of per-tab lists (deck / mixer / …). At least one.
  const contexts: Record<string, ControlDef[]> = {};
  if (raw.contexts && typeof raw.contexts === 'object') {
    const names = Object.keys(raw.contexts);
    if (names.length === 0) fail(`${profilePath}: 'contexts' must have at least one entry`);
    for (const name of names) {
      contexts[name] = validateControlList(`${profilePath} context '${name}'`, raw.contexts[name]);
    }
  } else if (Array.isArray(raw.controls)) {
    contexts.default = validateControlList(profilePath, raw.controls);
  } else {
    fail(`${profilePath}: profile needs a 'controls' array or a 'contexts' map`);
  }

  // Default fallback list when no active context is supplied: prefer 'deck',
  // else 'default', else the first declared context.
  const controls = contexts.deck ?? contexts.default ?? contexts[Object.keys(contexts)[0]];

  return {
    device: {
      id: dev.id, label: dev.label, nameContains: dev.nameContains,
      // Only carry nameEquals when the profile pinned it — absent stays absent
      // so `'nameEquals' in device` cleanly distinguishes pinned from unpinned.
      ...(dev.nameEquals !== undefined ? { nameEquals: dev.nameEquals } : {}),
      sourcePort: dev.sourcePort, destinationPort: dev.destinationPort,
      configureOnConnect: dev.configureOnConnect === true,
    },
    controls,
    contexts,
  };
}

/** Validate one control list (a single context). IDs + matches must be unique
 *  WITHIN the list; different contexts may freely reuse a note/CC for a
 *  different action — that is the point of per-tab mapping. */
function validateControlList(where: string, arr: unknown): ControlDef[] {
  if (!Array.isArray(arr) || arr.length === 0) {
    fail(`${where}: control list must be a non-empty array`);
  }
  const seenIds = new Set<string>();
  const seenMatches = new Map<string, string>();
  return (arr as any[]).map((c: any, i: number) => {
    if (!c || typeof c !== 'object') fail(`${where} control[${i}]: must be an object`);
    if (typeof c.id !== 'string' || !c.id) fail(`${where} control[${i}]: missing string 'id'`);
    const w = `${where} control '${c.id}'`;
    if (seenIds.has(c.id)) fail(`${w}: duplicate control id`);
    seenIds.add(c.id);
    const match = validateMatch(w, c.match);
    const action = validateAction(w, c.action);
    const led = validateLed(w, c.led);
    for (const key of matchKeys(match)) {
      const owner = seenMatches.get(key);
      if (owner) fail(`${w}: match overlaps control '${owner}' on ${key}`);
      seenMatches.set(key, c.id);
    }
    return { id: c.id, match, action, led };
  });
}

export interface ParamKeyError {
  controlId: string;
  key: string;
}

/**
 * Cross-check every param-key-bearing control's `key` against the live engine
 * CPC schema keys. BOTH `paramCenter` (absolute APC fader) AND
 * `paramCenterRelative` (MFT bank-2 relative knob) carry a CPC key that must
 * exist in the schema — a typo in EITHER dies silently at runtime, so both are
 * validated against the same allowed-key list (`schemaKeys`). Returns the list
 * of offending controls (for the Config tab's aggregate banner — other controls
 * keep working, per docs/34 failure table). Pass { strict: true } to instead
 * THROW on the first unknown key (codex P0 "fail loudly"; used where a profile
 * must be wholly valid before it runs).
 */
export function validateProfileParams(
  profile: ControllerProfile,
  schemaKeys: ReadonlySet<string>,
  opts: { strict?: boolean } = {},
): ParamKeyError[] {
  const errors: ParamKeyError[] = [];
  const seen = new Set<string>();
  // Check every control across every context (a key is bad regardless of which
  // tab it lives under). Dedup so a key reused across contexts reports once.
  for (const controls of Object.values(profile.contexts)) {
    for (const c of controls) {
      // Both kinds resolve to a CPC paramCenter write, so both keys are held to
      // the SAME schema. Name the offending kind in the throw for a precise cue.
      const a = c.action;
      if (a.kind !== 'paramCenter' && a.kind !== 'paramCenterRelative') continue;
      if (schemaKeys.has(a.key)) continue;
      const dedupKey = `${c.id}:${a.key}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      if (opts.strict) {
        fail(`control '${c.id}': ${a.kind} key '${a.key}' is not in the engine CPC schema`);
      }
      errors.push({ controlId: c.id, key: a.key });
    }
  }
  return errors;
}
