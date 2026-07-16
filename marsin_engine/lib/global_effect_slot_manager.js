/**
 * lib/global_effect_slot_manager.js
 *
 * Six performance slots binding a library effect + preset to a UI
 * button. Resolution / dispatch logic per docs/28 §4.4-§4.5.
 *
 * State ownership:
 *   - `this.slots` is the persistent binding config (slot 1..6).
 *   - All ACTIVE runtime state (which strobe preset is currently
 *     running, which wash is up, etc.) lives in GlobalEffectsController.
 */
import {
  GLOBAL_EFFECT_LIBRARY,
  SAFETY_TIERS,
  MAX_BURST_MS,
  validateParams,
  getPrimaryIntensity,
  map01ToPrimary,
  mapPrimaryTo01,
  getPrimaryMode,
  modeIndexOf,
  nextModeValue,
} from './global_effect_library.js';

/**
 * Default slot layout. Expanded to 10 slots in May 2026 so the migrated
 * legacy rig-globals (Vintage Wht / Blast Wht / UV Blast / Fogger) sit
 * inside the unified Global Effect Macros grid instead of a separate
 * RigGlobals strip. Slot count is no longer fixed at 6 — see
 * MIN_SLOTS / MAX_SLOTS below.
 */
export const DEFAULT_SLOT_CONFIG = [
  // Slots 1..6 — unchanged from docs/28 §4.3 (pre-existing tests +
  // operator muscle memory depend on these indices).
  { slotId: 1,  enabled: true, label: '4 Hz Sync',      effectId: 'strobe',         presetId: 'sync_4hz',        behavior: 'toggle',  paramsOverride: {} },
  { slotId: 2,  enabled: true, label: 'White Drop',     effectId: 'dropHit',        presetId: 'white_drop',      behavior: 'trigger', paramsOverride: {} },
  { slotId: 3,  enabled: true, label: 'Ocean Wash',     effectId: 'colorWash',      presetId: 'ocean_blue',      behavior: 'toggle',  paramsOverride: {} },
  { slotId: 4,  enabled: true, label: 'Ghost Trails',   effectId: 'feedbackTrails', presetId: 'ghost_ship',      behavior: 'toggle',  paramsOverride: {} },
  { slotId: 5,  enabled: true, label: 'Iceberg Flash',  effectId: 'dropHit',        presetId: 'iceberg_flash',   behavior: 'trigger', paramsOverride: {} },
  { slotId: 6,  enabled: true, label: '20 Hz Max',      effectId: 'strobe',         presetId: 'max_20hz',        behavior: 'toggle',  paramsOverride: {} },
  // Slots 7..10 — legacy RigGlobals migrated into the GEM grid
  // (May 2026). These route through controller.setEffect(...) so the
  // existing dimmer-aware pixel + DMX paths keep working.
  { slotId: 7,  enabled: true, label: 'Vintage Wht',    effectId: 'vintageWhite',   presetId: 'default',         behavior: 'toggle',  paramsOverride: {} },
  { slotId: 8,  enabled: true, label: 'Blast Wht',      effectId: 'blastWhite',     presetId: 'default',         behavior: 'toggle',  paramsOverride: {} },
  // Slot 9 — global color Invert, now an ASSIGNABLE slot effect
  // (channels-optimization campaign, June 2026). It used to be a
  // dedicated fixed InvertButton in GlobalEffectMacros; it now lives
  // in a swappable slot inside the visible 1..9 range so it still
  // works out of the box but can be re-bound like any other slot.
  { slotId: 9,  enabled: true, label: 'Invert',         effectId: 'invert',         presetId: 'default',         behavior: 'toggle',  paramsOverride: {} },
  { slotId: 10, enabled: true, label: 'UV Blast',       effectId: 'uvBlast',        presetId: 'default',         behavior: 'toggle',  paramsOverride: {} },
  { slotId: 11, enabled: true, label: 'Fogger',         effectId: 'fogger',         presetId: 'default',         behavior: 'toggle',  paramsOverride: {} },
  { slotId: 12, enabled: true, label: 'Long Trails',    effectId: 'feedbackTrails', presetId: 'long_afterimage', behavior: 'toggle',  paramsOverride: {} },
  { slotId: 13, enabled: true, label: 'Cosmic Trails',  effectId: 'feedbackTrails', presetId: 'cosmic_trails',   behavior: 'toggle',  paramsOverride: {} },
];

/**
 * Named effect BANKS (v3). A bank is an INDEPENDENT set of global-effect slots
 * with a stable string `id` (never an index) and a display `name`. Banks form
 * an ORDERED list, cycled by the VSN1 sb_2 side button (POST .../banks/next),
 * and there is ALWAYS >= 1 bank. Migrated legacy files keep the ids
 * 'edit'/'play'; banks created at runtime get 'bank_<n>' (first free integer).
 * The engine owns the active-bank pointer (`activeBankId`); switching it swaps
 * the LIVE slot set (see setActiveBank). An unknown id fails loud (Codex P0, no
 * silent fallback).
 */

// The bank a fresh manager (no persisted file) seeds — ONE bank holding the
// default slot config. Migration keeps legacy ids ('edit'/'play'); this is the
// from-code seed only.
export const DEFAULT_BANK_ID = 'edit';
export const DEFAULT_BANK_NAME = 'Edit';

// A zero-banks file recovers to this bank (D7), with a loud log.
export const FALLBACK_BANK_ID = 'default';
export const FALLBACK_BANK_NAME = 'Default';

// A bank's slot array may be EMPTY (0 slots) — banks are allowed to be empty
// (D7). The per-bank UPPER bound is still MAX_SLOTS.
export const MIN_SLOTS = 0;
// Effects v2 (project effects_v2_midi_layout): the GEM grid is now 4 pages
// of 8 slots = 32 flat slots, IDs 1..32. Page p (0..3) is a VIEW over slots
// `8p+1 .. 8p+8`; the flat slot IDs and their semantics are unchanged —
// paging only changes which 8 the surfaces render. Raised from 16.
export const MAX_SLOTS = 32;

// Paging geometry. A page is a fixed window of SLOTS_PER_PAGE flat slots.
export const SLOTS_PER_PAGE = 8;
export const PAGE_COUNT = MAX_SLOTS / SLOTS_PER_PAGE; // 4
export const MIN_PAGE = 0;
export const MAX_PAGE = PAGE_COUNT - 1; // 3
// Every page index [0..MAX_PAGE] — used to mark a whole-config replace as
// affecting all pages (so the deploy hook flashes all four).
export const ALL_PAGES = Array.from({ length: PAGE_COUNT }, (_, i) => i);

/**
 * The inclusive flat-slot ID range [firstSlotId, lastSlotId] a page views.
 * Page p → slots 8p+1 .. 8p+8. Pure geometry; no slot needs to exist yet.
 * @throws when `page` is not an integer in [0..MAX_PAGE].
 */
export function pageSlotRange(page) {
  if (!Number.isInteger(page) || page < MIN_PAGE || page > MAX_PAGE) {
    throw new Error(`page must be an integer in [${MIN_PAGE}..${MAX_PAGE}] (got ${page})`);
  }
  const first = page * SLOTS_PER_PAGE + 1;
  return { firstSlotId: first, lastSlotId: first + SLOTS_PER_PAGE - 1 };
}

/** Which page a flat slotId belongs to (inverse of pageSlotRange). */
export function pageOfSlot(slotId) {
  return Math.floor((slotId - 1) / SLOTS_PER_PAGE);
}

/**
 * Normalize an affected-pages list for the layout-changed event: coerce to a
 * sorted, de-duped array of in-range integer page indices. Garbage in (null,
 * out-of-range, non-integer) is dropped rather than crashing — the deploy hook
 * treats an empty list as "nothing to flash" (a caller that means ALL passes
 * ALL_PAGES explicitly). Kept pure so tests can assert it directly.
 */
export function normalizePages(pages) {
  if (!Array.isArray(pages)) return [];
  const seen = new Set();
  for (const p of pages) {
    if (Number.isInteger(p) && p >= MIN_PAGE && p <= MAX_PAGE) seen.add(p);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Validate that a slot points at a real (effectId, presetId) pair
 * and that the chosen behavior is supported.
 *
 * Throws on any mismatch — callers (boot loader, PATCH endpoint)
 * convert to either a hard crash (boot) or a 400 (API).
 *
 * Returns the resolved descriptor with merged params (preset
 * defaults overlaid with `slot.paramsOverride`).
 */
export function resolveSlotBinding({ slot, library = GLOBAL_EFFECT_LIBRARY }) {
  if (!slot || typeof slot !== 'object') {
    throw new Error('resolveSlotBinding: slot is required');
  }
  if (!slot.enabled) {
    throw new Error(`Slot ${slot.slotId} is disabled`);
  }
  const effect = library[slot.effectId];
  if (!effect) {
    throw new Error(`Unknown effectId: ${slot.effectId}`);
  }
  let preset = effect.presets && effect.presets[slot.presetId];
  if (!preset) {
    // Forward-compat: presets removed between engine versions (e.g.
    // the May 2026 legacy-effect collapse that dropped `bypass_dimmer`)
    // should not brick the saved YAML. Fall back to `default` if the
    // effect has one; otherwise pick the first declared preset. Warn
    // so the operator notices and re-binds via the swap sheet.
    const fallbackId = effect.presets && effect.presets.default
      ? 'default'
      : (effect.presets ? Object.keys(effect.presets)[0] : null);
    if (fallbackId) {
      console.warn(
        `[GEM] slot ${slot.slotId}: preset '${slot.presetId}' missing from effect '${slot.effectId}'; ` +
        `falling back to '${fallbackId}'. Re-bind via the swap sheet to silence this.`
      );
      preset = effect.presets[fallbackId];
      slot.presetId = fallbackId; // canonicalize so the next save persists the right id
    } else {
      throw new Error(`Unknown presetId '${slot.presetId}' for effect '${slot.effectId}'`);
    }
  }

  const overrides = slot.paramsOverride || {};
  // Validate (and silently clamp) overrides before merging.
  const sanitized = validateParams(slot.effectId, overrides);
  const params = { ...preset.params, ...sanitized };

  const behavior = slot.behavior || preset.defaultBehavior;
  if (!effect.behaviorTypes.includes(behavior)) {
    throw new Error(`Effect '${slot.effectId}' does not support behavior '${behavior}'`);
  }

  const safetyTier = preset.safetyTier || SAFETY_TIERS.NORMAL;

  // Operator review May 2026 #10: the legacy HOLD_ONLY / EXPERT_BURST
  // behavior gates are dropped. Hold isn't supported anywhere in the
  // app and operators want toggle-only operation even for the fast
  // strobes. The safety tier is still surfaced via the slot status'
  // `safetyTier` field (used by HIL tests + telemetry); the UI
  // intentionally no longer renders any per-tier badge.

  return {
    slotId: slot.slotId,
    effectId: slot.effectId,
    presetId: slot.presetId,
    label: slot.label || preset.label,
    behavior,
    params,
    safetyTier,
  };
}

/**
 * Validate an entire slot array — used at boot (must throw on any
 * invalid binding) AND when PATCH replaces the whole config.
 */
export function validateSlotsConfig(slotsConfig, library = GLOBAL_EFFECT_LIBRARY) {
  if (!Array.isArray(slotsConfig)) {
    throw new Error('slotsConfig must be an array');
  }
  if (slotsConfig.length < MIN_SLOTS || slotsConfig.length > MAX_SLOTS) {
    throw new Error(`slotsConfig must have between ${MIN_SLOTS} and ${MAX_SLOTS} entries (got ${slotsConfig.length})`);
  }
  const seenIds = new Set();
  for (const slot of slotsConfig) {
    if (!Number.isInteger(slot.slotId) || slot.slotId < 1 || slot.slotId > MAX_SLOTS) {
      throw new Error(`Invalid slotId: ${slot.slotId} (must be 1..${MAX_SLOTS})`);
    }
    if (seenIds.has(slot.slotId)) {
      throw new Error(`Duplicate slotId: ${slot.slotId}`);
    }
    seenIds.add(slot.slotId);
    if (slot.enabled) {
      // resolveSlotBinding will throw if effect/preset/behavior bad.
      resolveSlotBinding({ slot, library });
    }
  }
}

/**
 * Migrate a raw parsed global_effect_slots file to the canonical v3 (named
 * BANKS) shape. Pure (no I/O) so it is unit-testable and reusable by the boot
 * layer.
 *
 *   v1  — top-level `slots: []`, no `version`. The single legacy slot set is
 *         promoted into ONE bank `{ id:'edit', name:'Edit' }` (active). NO
 *         phantom second bank (D6). `effectsPage` is carried through. One loud
 *         log line records the migration — no silent data loss.
 *   v2  — `{ version:2, activeProfile, effectsPage, profiles:{edit,play} }`.
 *         Becomes banks `[{id:edit,name:Edit,slots},{id:play,name:Play,slots}]`
 *         with `activeBankId` = activeProfile. VALIDATED (both profile banks
 *         present with array `slots`; activeProfile in [edit,play]) → else THROW.
 *   v3  — already `{ version:3, activeBankId, effectsPage, banks:[…] }`.
 *         VALIDATED (banks is an array; each bank has a string id + name + array
 *         slots; ids unique; activeBankId names a real bank) and returned
 *         unchanged. A ZERO-banks file recovers to a single Default bank (D7,
 *         loud log) rather than throwing. Any other malformation → THROW.
 *   anything else — unknown/garbage version → THROW.
 *
 * @param {object} raw  parsed YAML (StateManager.loadGlobalEffectSlots()).
 * @returns {{version:3, activeBankId:string, effectsPage:number, banks:Array}}
 */
export function migrateSlotFile(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('migrateSlotFile: raw must be a parsed object');
  }

  // ── v3: validate + pass through (with zero-banks recovery) ───────────
  if (raw.version === 3) {
    if (!Array.isArray(raw.banks)) {
      throw new Error('v3 global_effect_slots: `banks` must be an array');
    }
    const effectsPage = Number.isInteger(raw.effectsPage) ? raw.effectsPage : 0;
    // D7: a zero-banks file is recoverable (never fail-loud) — the engine seeds
    // a single Default bank so the >= 1 invariant holds. Loud so it's noticed.
    if (raw.banks.length === 0) {
      console.warn(
        '[GEM] v3 global_effect_slots carried ZERO banks — seeding a single ' +
        `'${FALLBACK_BANK_ID}' bank (${FALLBACK_BANK_NAME}) to satisfy the >=1 invariant.`
      );
      return {
        version: 3,
        activeBankId: FALLBACK_BANK_ID,
        effectsPage,
        banks: [{ id: FALLBACK_BANK_ID, name: FALLBACK_BANK_NAME, slots: [] }],
      };
    }
    const seenIds = new Set();
    for (const bank of raw.banks) {
      if (!bank || typeof bank !== 'object') {
        throw new Error('v3 global_effect_slots: every bank must be an object');
      }
      if (typeof bank.id !== 'string' || bank.id.length === 0) {
        throw new Error('v3 global_effect_slots: every bank needs a non-empty string id');
      }
      if (seenIds.has(bank.id)) {
        throw new Error(`v3 global_effect_slots: duplicate bank id '${bank.id}'`);
      }
      seenIds.add(bank.id);
      if (typeof bank.name !== 'string' || bank.name.length === 0) {
        throw new Error(`v3 global_effect_slots: bank '${bank.id}' needs a non-empty string name`);
      }
      if (!Array.isArray(bank.slots)) {
        throw new Error(`v3 global_effect_slots: bank '${bank.id}' must carry a slots array`);
      }
    }
    if (!seenIds.has(raw.activeBankId)) {
      throw new Error(
        `v3 global_effect_slots: activeBankId ${JSON.stringify(raw.activeBankId)} ` +
        `names no bank (have ${JSON.stringify([...seenIds])})`
      );
    }
    return { version: 3, activeBankId: raw.activeBankId, effectsPage, banks: raw.banks };
  }

  // ── v2: per-profile PLAY/EDIT banks → named banks ────────────────────
  if (raw.version === 2) {
    if (!raw.profiles || typeof raw.profiles !== 'object') {
      throw new Error('v2 global_effect_slots: missing `profiles` object');
    }
    const V2_PROFILES = [
      { id: 'edit', name: 'Edit' },
      { id: 'play', name: 'Play' },
    ];
    for (const { id } of V2_PROFILES) {
      const bank = raw.profiles[id];
      if (!bank || !Array.isArray(bank.slots)) {
        throw new Error(`v2 global_effect_slots: profile '${id}' must carry a slots array`);
      }
    }
    if (raw.activeProfile !== 'edit' && raw.activeProfile !== 'play') {
      throw new Error(
        'v2 global_effect_slots: activeProfile must be one of ["edit","play"] ' +
        `(got ${JSON.stringify(raw.activeProfile)})`
      );
    }
    const banks = V2_PROFILES.map(({ id, name }) => ({
      id, name, slots: JSON.parse(JSON.stringify(raw.profiles[id].slots)),
    }));
    console.log(
      `[GEM] migrated global_effect_slots v2 → v3: profiles [edit, play] became named banks; ` +
      `active bank '${raw.activeProfile}'.`
    );
    return {
      version: 3,
      activeBankId: raw.activeProfile,
      effectsPage: Number.isInteger(raw.effectsPage) ? raw.effectsPage : 0,
      banks,
    };
  }

  // ── v1: top-level slots[], no version → ONE named bank (D6) ──────────
  if (raw.version === undefined && Array.isArray(raw.slots)) {
    console.log(
      `[GEM] migrated global_effect_slots v1 → v3: ${raw.slots.length} slots promoted into a ` +
      `single '${DEFAULT_BANK_ID}' bank (${DEFAULT_BANK_NAME}) — no phantom second bank.`
    );
    return {
      version: 3,
      activeBankId: DEFAULT_BANK_ID,
      effectsPage: raw.effectsPage ?? 0,
      banks: [
        { id: DEFAULT_BANK_ID, name: DEFAULT_BANK_NAME, slots: raw.slots },
      ],
    };
  }

  throw new Error(
    `migrateSlotFile: unrecognized global_effect_slots shape ` +
    `(version=${JSON.stringify(raw.version)})`
  );
}

export class GlobalEffectSlotManager {
  /**
   * @param {object} controller  GlobalEffectsController.
   * @param {Array}  [slotsConfig=DEFAULT_SLOT_CONFIG]  Persistent slot bindings.
   * @param {object} [opts]
   * @param {(evt:object)=>void} [opts.onLayoutChanged]  Invoked with the
   *   serialized layout whenever a LAYOUT change lands (slot assign/clear/
   *   rename/color/reorder or a whole-config replace). NOT fired for
   *   value/mode/active changes — those are runtime MIDI feedback, never a
   *   layout deploy (project contract). Kept mockable so the test suite never
   *   spawns the real VSN1 deploy child process.
   */
  constructor(controller, slotsConfig = DEFAULT_SLOT_CONFIG, opts = {}) {
    this.controller = controller;
    // Engine-owned page VIEW (0..3). Single source of truth — CaptainPad and
    // the VSN1 both follow + write this through the engine so no surface keeps
    // a private page (project "Locked design" §Slot model).
    this.effectsPage = MIN_PAGE;
    // Layout-changed hook (deploy trigger). Default is a no-op so unit tests
    // and the boot path never spawn a child process; the API layer wires the
    // real deploy hook in.
    this._onLayoutChanged = typeof opts.onLayoutChanged === 'function'
      ? opts.onLayoutChanged
      : null;
    // Engine-owned named BANKS (v3). A fresh manager (no persisted file) seeds
    // ONE bank holding the default slot config; boot-restore replaces this with
    // setBanks() when a file exists. Ordered list, always >= 1 bank. Validate
    // the seed once.
    validateSlotsConfig(slotsConfig);
    this.banks = [{
      id: DEFAULT_BANK_ID,
      name: DEFAULT_BANK_NAME,
      slots: JSON.parse(JSON.stringify(slotsConfig)),
    }];
    // Engine-owned ACTIVE BANK pointer (stable id, never an index). Switching it
    // swaps the LIVE slot set (see setActiveBank). CaptainPad + the VSN1 both
    // follow + write this through the engine (mirrors effectsPage).
    this.activeBankId = DEFAULT_BANK_ID;
    // `this.slots` ALIASES the active bank's slot array (same array reference) —
    // every method that reads/mutates `this.slots` (patchSlot, setSlotIntensity/
    // Mode, resetAllToDefault, disableAll, getStatus, getLayout,
    // dispatchSlotAction…) then operates on the active bank unchanged.
    this.slots = this._activeBank().slots;
  }

  /** The active bank object `{ id, name, slots }` (fail-loud if it vanished). */
  _activeBank() {
    const bank = this.banks.find(b => b.id === this.activeBankId);
    if (!bank) {
      throw new Error(
        `GlobalEffectSlotManager: activeBankId '${this.activeBankId}' names no bank ` +
        `(have ${JSON.stringify(this.banks.map(b => b.id))})`
      );
    }
    return bank;
  }

  // ── Page view (engine = source of truth) ────────────────────────────

  /** The current page VIEW index (0..MAX_PAGE). */
  getEffectsPage() {
    return this.effectsPage;
  }

  /**
   * Set the page VIEW. Validates the range (loud on garbage — Codex P0).
   * Paging is a pure view change: it does NOT touch slot bindings, active
   * state, or the layout, so it never triggers a layout deploy. Returns the
   * resolved page.
   */
  setEffectsPage(page) {
    if (!Number.isInteger(page) || page < MIN_PAGE || page > MAX_PAGE) {
      throw new Error(`effectsPage must be an integer in [${MIN_PAGE}..${MAX_PAGE}] (got ${page})`);
    }
    this.effectsPage = page;
    return this.effectsPage;
  }

  /** The { firstSlotId, lastSlotId } range the current page views. */
  currentPageRange() {
    return pageSlotRange(this.effectsPage);
  }

  // ── Named banks (engine = source of truth) ──────────────────────────

  /** The active bank id (stable string, never an index). */
  getActiveBankId() {
    return this.activeBankId;
  }

  /**
   * Bank metadata for the API GET surface: the ordered list of
   * `{ id, name, slotCount }` plus the active id. No slot contents.
   */
  getBanksMeta() {
    return {
      banks: this.banks.map(b => ({ id: b.id, name: b.name, slotCount: b.slots.length })),
      activeBankId: this.activeBankId,
    };
  }

  /**
   * SWAP the active bank by stable id. Fail-loud on an unknown id (Codex P0, no
   * silent fallback), points `activeBankId` at it, and re-aliases `this.slots`
   * to that bank's array so every slot method now reads/writes the new set.
   * This does NOT itself emit a layout change: the API layer runs
   * requestFullDeploy AFTER the swap to re-flash the device (the swap MUST
   * precede that call, and it does). Returns the resolved bank id.
   */
  setActiveBank(id) {
    if (!this.banks.some(b => b.id === id)) {
      throw new Error(
        `setActiveBank: unknown bank id ${JSON.stringify(id)} ` +
        `(have ${JSON.stringify(this.banks.map(b => b.id))})`
      );
    }
    this.activeBankId = id;
    this.slots = this._activeBank().slots;
    return this.activeBankId;
  }

  /**
   * Cycle to the NEXT bank in order, wrapping around (the VSN1 sb_2 gesture). A
   * single-bank list is a clean no-op (stays on the only bank). Re-aliases
   * `this.slots`. Returns `{ activeBankId, bankName, index, count }`.
   */
  nextBank() {
    const idx = this.banks.findIndex(b => b.id === this.activeBankId);
    const nextIdx = (idx + 1) % this.banks.length;
    this.setActiveBank(this.banks[nextIdx].id);
    return {
      activeBankId: this.activeBankId,
      bankName: this.banks[nextIdx].name,
      index: nextIdx,
      count: this.banks.length,
    };
  }

  /**
   * Create a new EMPTY bank at the end of the order. `id` is the first free
   * `bank_<n>` integer; `name` defaults to `Bank <n>` (D4 auto-name) unless the
   * caller supplies one. Does NOT change the active bank. Returns the new bank
   * `{ id, name, slotCount:0 }`.
   */
  createBank(name) {
    let n = 1;
    while (this.banks.some(b => b.id === `bank_${n}`)) n += 1;
    const id = `bank_${n}`;
    const resolvedName = (typeof name === 'string' && name.trim().length > 0)
      ? name.trim()
      : `Bank ${n}`;
    this.banks.push({ id, name: resolvedName, slots: [] });
    return { id, name: resolvedName, slotCount: 0 };
  }

  /**
   * Delete a bank by id. Enforces the >= 1 invariant: deleting the LAST bank
   * throws (the API converts to a 409/400). If the DELETED bank was active, the
   * NEXT bank in order becomes active (re-aliasing `this.slots`) so a live
   * surface never dangles. Returns `{ deletedId, activeBankId }` (activeBankId
   * unchanged unless the active bank was the one removed).
   */
  deleteBank(id) {
    const idx = this.banks.findIndex(b => b.id === id);
    if (idx === -1) {
      throw new Error(
        `deleteBank: unknown bank id ${JSON.stringify(id)} ` +
        `(have ${JSON.stringify(this.banks.map(b => b.id))})`
      );
    }
    if (this.banks.length <= 1) {
      throw new Error('deleteBank: cannot delete the last bank (>= 1 bank required)');
    }
    const wasActive = this.activeBankId === id;
    this.banks.splice(idx, 1);
    if (wasActive) {
      // The removed bank's slot: the next bank in order (wrapping to index 0 if
      // the last was removed) becomes active.
      const nextActive = this.banks[idx % this.banks.length];
      this.setActiveBank(nextActive.id);
    }
    return { deletedId: id, activeBankId: this.activeBankId };
  }

  /**
   * Rename a bank by id. Fail-loud on an unknown id or an empty name. Returns
   * the resolved `{ id, name }`.
   */
  renameBank(id, name) {
    const bank = this.banks.find(b => b.id === id);
    if (!bank) {
      throw new Error(
        `renameBank: unknown bank id ${JSON.stringify(id)} ` +
        `(have ${JSON.stringify(this.banks.map(b => b.id))})`
      );
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('renameBank: name must be a non-empty string');
    }
    bank.name = name.trim();
    return { id: bank.id, name: bank.name };
  }

  /**
   * Restore ALL banks at once (boot restore). `banks` is the ordered on-disk /
   * migrated shape `[{ id, name, slots:[…] }]`. Validates EVERY bank's slots
   * with validateSlotsConfig (per-bank fail-loud — Codex P0), checks unique ids
   * and that `activeBankId` names a real bank, deep-clones each into an
   * independent array, sets the active pointer, and re-aliases `this.slots`.
   * NEVER emits a layout change (boot is deploy-silent — the explicit boot
   * deploy is a separate step).
   */
  setBanks(banks, activeBankId) {
    if (!Array.isArray(banks) || banks.length === 0) {
      throw new Error('setBanks: banks must be a non-empty array');
    }
    const seen = new Set();
    const next = [];
    for (const bank of banks) {
      if (!bank || typeof bank !== 'object') {
        throw new Error('setBanks: every bank must be an object');
      }
      if (typeof bank.id !== 'string' || bank.id.length === 0) {
        throw new Error('setBanks: every bank needs a non-empty string id');
      }
      if (seen.has(bank.id)) {
        throw new Error(`setBanks: duplicate bank id '${bank.id}'`);
      }
      seen.add(bank.id);
      if (typeof bank.name !== 'string' || bank.name.length === 0) {
        throw new Error(`setBanks: bank '${bank.id}' needs a non-empty string name`);
      }
      if (!Array.isArray(bank.slots)) {
        throw new Error(`setBanks: bank '${bank.id}' must carry a slots array`);
      }
      validateSlotsConfig(bank.slots);
      next.push({ id: bank.id, name: bank.name, slots: JSON.parse(JSON.stringify(bank.slots)) });
    }
    if (!seen.has(activeBankId)) {
      throw new Error(
        `setBanks: activeBankId ${JSON.stringify(activeBankId)} names no bank ` +
        `(have ${JSON.stringify([...seen])})`
      );
    }
    this.banks = next;
    this.activeBankId = activeBankId;
    this.slots = this._activeBank().slots;
  }

  /**
   * Deep-cloned ordered list of ALL banks in the on-disk shape
   * `[{ id, name, slots:[…] }]` — for persistence.
   */
  getBanks() {
    return this.banks.map(b => ({
      id: b.id,
      name: b.name,
      slots: JSON.parse(JSON.stringify(b.slots)),
    }));
  }

  /**
   * Replace the whole slot config. This is a LAYOUT change (a fresh 32-slot
   * assignment), so it fires the layout-changed hook — EXCEPT during initial
   * construction and boot-restore, where `emitLayout` is passed false so the
   * engine doesn't deploy on every startup. The API PATCH path passes true.
   */
  setSlots(slotsConfig, { emitLayout = false } = {}) {
    validateSlotsConfig(slotsConfig);
    // Replace ONLY the active bank's slot array, then re-point the alias so
    // `this.slots` still references the live active array. Deep clone so
    // external mutations to the input array don't bleed.
    const bank = this._activeBank();
    bank.slots = JSON.parse(JSON.stringify(slotsConfig));
    this.slots = bank.slots;
    // A whole-config replace can touch ANY page, so it deploys every page.
    if (emitLayout) this._emitLayoutChanged({ pages: ALL_PAGES });
  }

  getSlots() {
    return JSON.parse(JSON.stringify(this.slots));
  }

  getSlot(slotId) {
    return this.slots.find(s => s.slotId === slotId);
  }

  patchSlot(slotId, patch) {
    let slot = this.getSlot(slotId);
    if (!slot) {
      // Create-on-patch (June 2026): an operator can assign an effect
      // to ANY slot in 1..MAX_SLOTS, including ones that were never
      // pre-seeded in DEFAULT_SLOT_CONFIG (previously slots 7/8/9...
      // could not be populated because patchSlot threw here). The new
      // slot starts as a disabled placeholder; the patch below fills it
      // in and is validated through resolveSlotBinding when enabled.
      // Slot IDs are 1..MAX_SLOTS. (This is distinct from MIN_SLOTS, which is
      // the minimum NUMBER of slots in a bank — 0, i.e. empty banks allowed.)
      if (!Number.isInteger(slotId) || slotId < 1 || slotId > MAX_SLOTS) {
        throw new Error(`Invalid slotId: ${slotId} (must be 1..${MAX_SLOTS})`);
      }
      slot = {
        slotId,
        enabled: false,
        label: `Slot ${slotId}`,
        effectId: null,
        presetId: null,
        behavior: 'toggle',
        paramsOverride: {},
        intensity: null, // untouched → the bound effect's default applies
        mode: null,      // untouched → the bound effect's default mode applies
        color: null,     // layout display color (VSN1 key LED / UI tint)
      };
      this.slots.push(slot);
    }
    const next = { ...slot, ...patch };
    if (patch.paramsOverride !== undefined) {
      next.paramsOverride = { ...patch.paramsOverride };
    }
    // Swapping the bound effect drops any touched primary intensity/mode: both
    // were scaled/enumerated against the OLD effect and must not leak onto the
    // new effect. The caller can re-set them after the swap; until then the
    // new effect's own defaults apply. (An explicit value in the patch still
    // wins — the guard below only defaults it away when absent.)
    const effectChanged = patch.effectId !== undefined && patch.effectId !== slot.effectId;
    if (effectChanged && patch.intensity === undefined) next.intensity = null;
    if (effectChanged && patch.mode === undefined) {
      next.mode = null;
      // Also drop a stale mode param override so the new effect's default
      // mode value governs (mirrors the intensity-swap drop above).
      const oldModeParam = this._modeParamOf(slot.effectId);
      if (oldModeParam && next.paramsOverride &&
          Object.prototype.hasOwnProperty.call(next.paramsOverride, oldModeParam)) {
        const cleaned = { ...next.paramsOverride };
        delete cleaned[oldModeParam];
        next.paramsOverride = cleaned;
      }
    }
    // Round-trip through resolveSlotBinding (only if enabled) for full
    // validation including safety tier policy.
    if (next.enabled) {
      resolveSlotBinding({ slot: next });
    }
    Object.assign(slot, next);

    // LAYOUT-change detection (deploy trigger). A change to the slot's
    // assignment (effect/preset/behavior/label/color/enabled) is a LAYOUT
    // change → fire the hook. A pure intensity/mode/paramsOverride patch is
    // runtime feedback, NOT a layout change (project contract), so it does
    // NOT deploy. `patch` is the caller's intent, so we key off its keys.
    // Only the ONE page this slot sits on changed, so the deploy hook can
    // re-flash just that page (project brief §incremental deploy).
    if (this._patchTouchesLayout(patch)) {
      this._emitLayoutChanged({ pages: [pageOfSlot(slotId)] });
    }
    return slot;
  }

  /** The effect's mode param name, or null when it has no mode / no effect. */
  _modeParamOf(effectId) {
    if (!effectId) return null;
    let d;
    try { d = getPrimaryMode(effectId); } catch { return null; }
    return d ? d.param : null;
  }

  /**
   * Does a patch blob touch a LAYOUT field (assignment/display), as opposed
   * to pure runtime feedback (intensity/mode/paramsOverride)? Layout fields:
   * effectId, presetId, behavior, label, color, enabled.
   */
  _patchTouchesLayout(patch) {
    if (!patch || typeof patch !== 'object') return false;
    const LAYOUT_KEYS = ['effectId', 'presetId', 'behavior', 'label', 'color', 'enabled'];
    return LAYOUT_KEYS.some(k => Object.prototype.hasOwnProperty.call(patch, k));
  }

  /**
   * Set a slot's primary intensity from a normalized 0..1 value (docs/42
   * VSN1 jog-wheel). Maps the value onto the effect's real primary-param
   * range, writes it into `slot.paramsOverride[param]`, records the
   * normalized value on `slot.intensity` (so it survives a preset swap and
   * persists), and — when the slot's effect is CURRENTLY RUNNING —
   * re-dispatches so the change applies live to the rig.
   *
   * @param {number} slotId
   * @param {number} value       normalized 0..1 (clamped)
   * @param {object} [opts]
   * @param {number} [opts.frameIndex]  needed to re-dispatch a live strobe
   * @param {number} [opts.nowMs]       needed to re-dispatch a live effect
   * @returns {object} { slot, intensity, paramValue, applied }
   * @throws when the slot/effect is invalid or the effect has no primary
   *   (callers convert to a 400).
   */
  setSlotIntensity(slotId, value, { frameIndex = 0, nowMs = 0 } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`intensity value must be a finite number (got ${value})`);
    }
    const slot = this.getSlot(slotId);
    if (!slot) throw new Error(`Invalid slotId: ${slotId}`);
    if (!slot.effectId) throw new Error(`Slot ${slotId} has no effect bound`);
    const desc = getPrimaryIntensity(slot.effectId); // throws on unknown effect
    if (!desc) {
      throw new Error(`Effect '${slot.effectId}' has no primary intensity (slot ${slotId})`);
    }
    const v01 = value < 0 ? 0 : value > 1 ? 1 : value;
    const paramValue = map01ToPrimary(slot.effectId, v01);

    slot.intensity = v01;
    slot.paramsOverride = { ...(slot.paramsOverride || {}), [desc.param]: paramValue };
    // Round-trip validate the new override (throws on a bad shape). This also
    // silently clamps where the effect's validator clamps (e.g. strobe duty).
    if (slot.enabled) resolveSlotBinding({ slot });

    const applied = this._reapplyIfActive(slot, { frameIndex, nowMs });
    return { slot, intensity: v01, paramValue, applied };
  }

  /**
   * Reset a slot's primary intensity back to the effect default. Clears the
   * touched `slot.intensity` AND removes the intensity param from
   * `paramsOverride` (so the preset/default value takes over again), then
   * re-dispatches if the effect is running.
   *
   * @returns {object} { slot, intensity, applied } — intensity is the
   *   effect default normalized to 0..1.
   */
  resetSlotIntensity(slotId, { frameIndex = 0, nowMs = 0 } = {}) {
    const slot = this.getSlot(slotId);
    if (!slot) throw new Error(`Invalid slotId: ${slotId}`);
    if (!slot.effectId) throw new Error(`Slot ${slotId} has no effect bound`);
    const desc = getPrimaryIntensity(slot.effectId);
    if (!desc) {
      throw new Error(`Effect '${slot.effectId}' has no primary intensity (slot ${slotId})`);
    }
    slot.intensity = null;
    if (slot.paramsOverride && Object.prototype.hasOwnProperty.call(slot.paramsOverride, desc.param)) {
      const next = { ...slot.paramsOverride };
      delete next[desc.param];
      slot.paramsOverride = next;
    }
    if (slot.enabled) resolveSlotBinding({ slot });
    const applied = this._reapplyIfActive(slot, { frameIndex, nowMs });
    return { slot, intensity: mapPrimaryTo01(slot.effectId, desc.default), applied };
  }

  // ── Primary MODE (docs/42 VSN1 encoder press) ───────────────────────
  // The discrete secondary control. Persists per slot on `slot.mode`, is
  // written into `slot.paramsOverride[modeParam]` so it flows through the
  // same resolve/merge path the intensity uses (and thus applies LIVE when
  // the effect is running), and is surfaced in slot status. A mode change is
  // RUNTIME FEEDBACK — it never triggers a layout deploy (project contract).

  /**
   * The effect default mode value for a slot (or null when no mode/effect).
   */
  _defaultModeValue(slot) {
    if (!slot || !slot.effectId) return null;
    let d;
    try { d = getPrimaryMode(slot.effectId); } catch { return null; }
    return d ? d.default : null;
  }

  /** The slot's CURRENT mode value: the touched one, else the effect default. */
  _currentModeValue(slot) {
    const touched = slot ? slot.mode : undefined;
    if (touched !== undefined && touched !== null) return touched;
    return this._defaultModeValue(slot);
  }

  /**
   * Write a slot's mode to an explicit value. The value MUST be a member of
   * the effect's mode `values` list (loud on a stranger — Codex P0). Records
   * it on `slot.mode`, writes the mode param into `paramsOverride`, and
   * re-dispatches live when the effect is running.
   *
   * @returns {object} { slot, mode, modeIndex, applied }
   */
  setSlotMode(slotId, value, { frameIndex = 0, nowMs = 0 } = {}) {
    const slot = this.getSlot(slotId);
    if (!slot) throw new Error(`Invalid slotId: ${slotId}`);
    if (!slot.effectId) throw new Error(`Slot ${slotId} has no effect bound`);
    const desc = getPrimaryMode(slot.effectId); // throws on unknown effect
    if (!desc) {
      throw new Error(`Effect '${slot.effectId}' has no primary mode (slot ${slotId})`);
    }
    if (!desc.values.some(x => x === value)) {
      throw new Error(
        `mode value ${JSON.stringify(value)} is not valid for '${slot.effectId}' ` +
        `(allowed: ${JSON.stringify(desc.values)})`
      );
    }
    slot.mode = value;
    slot.paramsOverride = { ...(slot.paramsOverride || {}), [desc.param]: value };
    if (slot.enabled) resolveSlotBinding({ slot });
    const applied = this._reapplyIfActive(slot, { frameIndex, nowMs });
    return { slot, mode: value, modeIndex: modeIndexOf(slot.effectId, value), applied };
  }

  /**
   * Cycle a slot's mode to the NEXT value in its effect's `values` list,
   * wrapping around (the encoder-press gesture). Starts from the current
   * touched value, or the effect default when untouched. Applies live.
   *
   * @returns {object} { slot, mode, modeIndex, applied }
   */
  cycleSlotMode(slotId, { frameIndex = 0, nowMs = 0 } = {}) {
    const slot = this.getSlot(slotId);
    if (!slot) throw new Error(`Invalid slotId: ${slotId}`);
    if (!slot.effectId) throw new Error(`Slot ${slotId} has no effect bound`);
    const desc = getPrimaryMode(slot.effectId);
    if (!desc) {
      throw new Error(`Effect '${slot.effectId}' has no primary mode (slot ${slotId})`);
    }
    const next = nextModeValue(slot.effectId, this._currentModeValue(slot));
    return this.setSlotMode(slotId, next, { frameIndex, nowMs });
  }

  // ── Global actions across ALL slots (VSN1 side-buttons) ─────────────
  // Two whole-grid operations bound to the VSN1 side buttons (and reused by
  // the CaptainPad UI). They act on ALL MAX_SLOTS across every page, NOT just
  // the visible page. Both are RUNTIME operations — they never change slot
  // bindings, so they NEVER trigger a layout deploy (the API layer broadcasts
  // the same runtime-status WS topic the per-slot ops use so surfaces re-sync).

  /**
   * Reset EVERY slot's primary intensity AND primary mode back to its bound
   * effect's registry default — a values-only reset. This clears each slot's
   * touched intensity/mode and drops the corresponding param overrides so the
   * preset/default value governs again, then re-dispatches any RUNNING effect
   * so the reset applies live (mirrors per-slot intensity/mode reset).
   *
   * It does NOT touch enabled/active state or the effect assignment — a slot
   * that is currently rendering keeps rendering, just with default params.
   * Slots with no effect bound, or whose effect declares no primary/no mode,
   * are simply left untouched on that dimension (not an error — reset-all spans
   * the whole heterogeneous grid). Idempotent: resetting an all-default grid is
   * a clean no-op (reset count 0), not a silent wrong result.
   *
   * @param {object} [opts]
   * @param {number} [opts.frameIndex=0]  needed to re-dispatch a live effect
   * @param {number} [opts.nowMs=0]       needed to re-dispatch a live effect
   * @returns {{ slotsReset:number[], intensityReset:number[], modeReset:number[],
   *   reapplied:number[] }} slotIds touched on each dimension (a slot appears in
   *   `slotsReset` if either intensity or mode actually changed).
   */
  resetAllToDefault({ frameIndex = 0, nowMs = 0 } = {}) {
    const slotsReset = [];
    const intensityReset = [];
    const modeReset = [];
    const reapplied = [];
    for (const slot of this.slots) {
      if (!slot.effectId) continue; // empty slot — nothing to reset
      let changed = false;

      // Intensity dimension — only when the effect declares a primary.
      const intDesc = this._safePrimaryIntensity(slot.effectId);
      if (intDesc) {
        const hadOverride = slot.paramsOverride &&
          Object.prototype.hasOwnProperty.call(slot.paramsOverride, intDesc.param);
        const hadTouched = slot.intensity !== null && slot.intensity !== undefined;
        if (hadOverride || hadTouched) {
          slot.intensity = null;
          if (hadOverride) {
            const next = { ...slot.paramsOverride };
            delete next[intDesc.param];
            slot.paramsOverride = next;
          }
          changed = true;
          intensityReset.push(slot.slotId);
        }
      }

      // Mode dimension — only when the effect declares a primary mode.
      const modeDesc = this._safePrimaryMode(slot.effectId);
      if (modeDesc) {
        const hadOverride = slot.paramsOverride &&
          Object.prototype.hasOwnProperty.call(slot.paramsOverride, modeDesc.param);
        const hadTouched = slot.mode !== null && slot.mode !== undefined;
        if (hadOverride || hadTouched) {
          slot.mode = null;
          if (hadOverride) {
            const next = { ...slot.paramsOverride };
            delete next[modeDesc.param];
            slot.paramsOverride = next;
          }
          changed = true;
          modeReset.push(slot.slotId);
        }
      }

      if (!changed) continue;
      // Re-validate the now-default override shape (throws loud on corruption).
      if (slot.enabled) resolveSlotBinding({ slot });
      slotsReset.push(slot.slotId);
      if (this._reapplyIfActive(slot, { frameIndex, nowMs })) reapplied.push(slot.slotId);
    }
    return { slotsReset, intensityReset, modeReset, reapplied };
  }

  /**
   * Disable (blackout) EVERY currently-active effect: stop anything rendering
   * so the grid goes dark, while LEAVING all slot bindings intact (effectId /
   * presetId / label / color / intensity / mode all stay — this is "stop all",
   * not "clear the layout"). Behavior-aware, so it works across the whole grid:
   *   - toggle / hold effects  → dispatched `deactivate` (their normal off path)
   *   - trigger effects (dropHit) that are RINGING OUT → their live voices are
   *     cleared so the ring stops immediately (a trigger has no `deactivate`
   *     action of its own, so we stop it at the controller's voice pool).
   *   - the auto kick router (kickPunch/toggle) → disarmed via `deactivate`.
   * Only ACTIVE slots are touched; an already-off slot is skipped. Idempotent:
   * disabling an all-off grid is a clean no-op (disabled count 0), not an error.
   *
   * @param {object} [opts]
   * @param {number} [opts.frameIndex=0]
   * @param {number} [opts.nowMs=0]
   * @returns {{ disabled:number[] }} slotIds that were active and got turned off.
   */
  disableAll({ frameIndex = 0, nowMs = 0 } = {}) {
    const disabled = [];
    for (const slot of this.slots) {
      if (!slot.enabled || !slot.effectId) continue;
      if (!this._isSlotActive(slot)) continue; // already off — skip (idempotent)
      // dropHit is a trigger with no `deactivate` action — a ringing hit is
      // stopped by clearing its live voices directly. Every other effect stops
      // cleanly through its normal deactivate dispatch path (preset/binding kept).
      if (slot.effectId === 'dropHit') {
        this.controller.clearDropHits();
      } else {
        this.dispatchSlotAction({ slotId: slot.slotId, action: 'deactivate', frameIndex, nowMs });
      }
      disabled.push(slot.slotId);
    }
    return { disabled };
  }

  /** getPrimaryIntensity for reset-all sweeps: null for "no primary" (normal),
   *  but a genuine lookup failure (unknown/corrupt effect id) is LOGGED, not
   *  silently swallowed (fail-loud P0) — the sweep still continues so one bad
   *  slot can't abort resetting the rest. */
  _safePrimaryIntensity(effectId) {
    if (!effectId) return null;
    try {
      return getPrimaryIntensity(effectId) || null;
    } catch (e) {
      console.warn(`[GlobalEffectSlots] primary-intensity lookup failed for effect '${effectId}': ${e.message}`);
      return null;
    }
  }

  /** getPrimaryMode for reset-all sweeps: null for "no mode" (normal), but a
   *  genuine lookup failure is LOGGED, not silently swallowed (fail-loud P0). */
  _safePrimaryMode(effectId) {
    if (!effectId) return null;
    try {
      return getPrimaryMode(effectId) || null;
    } catch (e) {
      console.warn(`[GlobalEffectSlots] primary-mode lookup failed for effect '${effectId}': ${e.message}`);
      return null;
    }
  }

  /**
   * Resolve the { mode, modeValues, modeLabel, modeIndex } surface for a slot,
   * mirroring _resolveIntensityInfo. All null when the effect is unknown,
   * unset, or declares no mode.
   */
  _resolveModeInfo(slot) {
    const none = { mode: null, modeValues: null, modeLabel: null, modeIndex: null };
    if (!slot || !slot.effectId) return none;
    let desc;
    try { desc = getPrimaryMode(slot.effectId); } catch { return none; }
    if (!desc) return none;
    const value = this._currentModeValue(slot);
    return {
      mode: value,
      modeValues: [...desc.values],
      modeLabel: desc.label,
      modeIndex: modeIndexOf(slot.effectId, value),
    };
  }

  /**
   * Re-dispatch a slot's effect so a just-changed intensity applies live to
   * the running rig. Only fires when the slot is currently active AND the
   * effect is one that holds continuous state we can re-set (strobe / wash /
   * trails and the party gate/overlay effects). Trigger effects (dropHit,
   * kick router) have nothing running to update — their NEXT fire picks up
   * the new params, so this is a no-op for them (returns false).
   */
  _reapplyIfActive(slot, { frameIndex, nowMs }) {
    if (!slot.enabled || !this._isSlotActive(slot)) return false;
    // 'activate' re-runs setStrobe / setColorWash / setFeedbackTrails (and the
    // party effect setters) with the merged (new-intensity) params for the
    // live toggle effects. Trigger effects have nothing running to update —
    // re-activating dropHit would fire a spurious hit, and kickPunch in
    // trigger behavior has no lasting state — so skip both. (kickPunch in
    // toggle behavior IS the armed auto router; re-activating it just re-arms
    // with the new ceil, no spurious fire, so it is allowed through.)
    if (slot.effectId === 'dropHit') return false;
    if (slot.effectId === 'kickPunch' && (slot.behavior || '') !== 'toggle') return false;
    this.dispatchSlotAction({ slotId: slot.slotId, action: 'activate', frameIndex, nowMs });
    return true;
  }

  /**
   * Slot status (active flag + resolved descriptor) for
   * GET /global-effect-slots/status.
   */
  getStatus() {
    return this.slots.map(slot => {
      let resolved = null;
      let resolveError = null;
      try {
        if (slot.enabled) {
          resolved = resolveSlotBinding({ slot });
        }
      } catch (err) {
        resolveError = err.message;
      }
      // Per-slot primary-intensity fields (docs/42 VSN1 jog-wheel):
      //   - intensityLabel   operator-facing knob name, or null (no primary).
      //   - intensityDefault the effect's default, normalized to 0..1.
      //   - intensity        the CURRENT normalized value: the operator's
      //                      touched value when set, else the default.
      // All three are null when the bound effect declares no primary (invert,
      // legacy slams) or when the effect is unknown to the registry.
      const intInfo = this._resolveIntensityInfo(slot);
      // Per-slot primary-MODE fields (docs/42 VSN1 encoder press):
      //   - modeLabel   operator-facing mode-wheel name, or null (no mode).
      //   - modeValues  the ordered discrete list the encoder cycles.
      //   - mode        the CURRENT value: the touched one, else the default.
      //   - modeIndex   the current value's index in modeValues.
      // All null when the bound effect declares no mode / is unknown.
      const modeInfo = this._resolveModeInfo(slot);
      // Declarative value-encoder flag (docs/42 VSN1 jog-wheel): an effect
      // may opt out of the value encoder entirely by declaring
      // `valueParam: 'none'` on its library def (e.g. fogger — a bare
      // on/off haze with no magnitude). Surfaced verbatim so the UI can
      // grey out the encoder; null when the effect declares nothing.
      const effectDef = slot.effectId ? GLOBAL_EFFECT_LIBRARY[slot.effectId] : null;
      const valueParam = effectDef && effectDef.valueParam !== undefined
        ? effectDef.valueParam
        : null;
      return {
        slotId: slot.slotId,
        enabled: slot.enabled,
        label: slot.label,
        effectId: slot.effectId,
        presetId: slot.presetId,
        behavior: slot.behavior,
        color: slot.color ?? null,
        page: pageOfSlot(slot.slotId),
        valueParam,
        paramsOverride: { ...(slot.paramsOverride || {}) },
        safetyTier: resolved ? resolved.safetyTier : null,
        active: this._isSlotActive(slot),
        intensity: intInfo.intensity,
        intensityDefault: intInfo.intensityDefault,
        intensityLabel: intInfo.intensityLabel,
        mode: modeInfo.mode,
        modeValues: modeInfo.modeValues,
        modeLabel: modeInfo.modeLabel,
        modeIndex: modeInfo.modeIndex,
        resolveError,
      };
    });
  }

  // ── Layout model (engine-owned, serializable → deploy) ──────────────
  //
  // The LAYOUT is the 32-slot ASSIGNMENT: for each populated slot, which
  // effect sits there, its display name, and its color, plus the page it
  // falls on. This is what the VSN1 device is flashed with (Track T's
  // deploy_layout.cjs turns it into per-element Lua). It is DISTINCT from
  // runtime feedback (intensity/mode/active) — those ride live MIDI and never
  // re-flash. `getLayout()` is JSON/YAML-serializable (no fn refs).

  /**
   * Serialize the current 32-slot layout. Includes every ENABLED slot with a
   * bound effect (disabled/empty slots are omitted — the device renders them
   * dark). Pure data: effectId, display name, color, page, slot id.
   *
   * @returns {{version, slotsPerPage, slots: Array}}
   */
  getLayout() {
    const slots = this.slots
      .filter(s => s.enabled && s.effectId)
      .sort((a, b) => a.slotId - b.slotId)
      .map(s => ({
        slotId: s.slotId,
        page: pageOfSlot(s.slotId),
        effectId: s.effectId,
        presetId: s.presetId ?? null,
        name: s.label ?? s.effectId,
        color: s.color ?? null,
      }));
    // pageCount was removed (D8, zero readers) — per-slot page geometry stays.
    return {
      version: 1,
      slotsPerPage: SLOTS_PER_PAGE,
      slots,
    };
  }

  /**
   * Build the layout-changed event payload (the serialized layout plus a
   * monotonic-ish revision so consumers can dedupe). Kept separate from the
   * hook invocation so tests can assert the shape without a hook.
   *
   * `pages` is the sorted, de-duped, in-range list of page indices whose
   * slots this change touched — the deploy hook re-flashes only these pages
   * (project brief §incremental deploy). A slot patch touches one page; a
   * whole-config replace touches ALL_PAGES.
   *
   * @param {number[]} [pages=ALL_PAGES]  Affected page indices.
   */
  _layoutChangedEvent(pages = ALL_PAGES) {
    this._layoutRevision = (this._layoutRevision || 0) + 1;
    return {
      type: 'layout-changed',
      revision: this._layoutRevision,
      pages: normalizePages(pages),
      layout: this.getLayout(),
    };
  }

  /**
   * Fire the layout-changed hook (deploy trigger) if one is wired. No-op when
   * the hook is absent (default) — so unit tests and boot never spawn the real
   * VSN1 deploy child process. Any error thrown by the hook is the caller's
   * concern (the API layer catches + surfaces it); we do NOT swallow it.
   *
   * @param {object} [opts]
   * @param {number[]} [opts.pages=ALL_PAGES]  Affected page indices.
   */
  _emitLayoutChanged({ pages = ALL_PAGES } = {}) {
    if (!this._onLayoutChanged) return;
    this._onLayoutChanged(this._layoutChangedEvent(pages));
  }

  /** Install/replace the layout-changed hook after construction. */
  setLayoutChangedHook(fn) {
    this._onLayoutChanged = typeof fn === 'function' ? fn : null;
  }

  /**
   * Sorted, de-duped page indices that currently hold at least one populated
   * slot — the pages that actually have names/colors to show on the VSN1.
   */
  populatedPages() {
    const set = new Set();
    for (const s of this.getLayout().slots) {
      if (Number.isInteger(s.page)) set.add(s.page);
    }
    return [...set].sort((a, b) => a - b);
  }

  /**
   * Force a layout deploy of the currently-populated pages — the "sync the
   * VSN1 to the current layout" action, used on engine boot (deploy-on-load)
   * and by POST /global-effects/deploy. This is NOT a slot mutation; it just
   * re-emits the CURRENT layout so the deploy hook re-flashes the device to
   * match. No-op (returns []) when nothing is populated or no hook is wired.
   * The hook itself decides whether deploy is enabled + coalesces/serializes.
   *
   * @returns {number[]} the pages emitted for (empty if none / no hook).
   *
   * OWN-PAGE RETIREMENT (effects_v2, 2026-07): the VSN1 is a fixed PAGE-0
   * surface now, so a full re-sync only ever emits PAGE 0 (iff it's populated).
   * This kills the multi-page boot flash BURST that could wedge the device's
   * pad scan (docs/42 initial-load wedge) — the pad-wedge trigger becomes
   * unreachable, though the soft_reset mitigation stays in the deploy hook as a
   * belt-and-braces guard. Logical pages 1-3 still live in engine state
   * (effectsPage plumbing); they simply never reach the device.
   */
  requestFullDeploy() {
    if (!this._onLayoutChanged) return [];
    const pages = this.populatedPages().includes(0) ? [0] : [];
    if (pages.length > 0) this._emitLayoutChanged({ pages });
    return pages;
  }

  /**
   * Resolve the { intensity, intensityDefault, intensityLabel } triple for a
   * slot. Returns all-null when the effect is unknown, unset, or declares no
   * primary. `slot.intensity` (0..1) is the operator's touched value; when it
   * is null/undefined the effect's default (normalized to 0..1) is reported.
   */
  _resolveIntensityInfo(slot) {
    const none = { intensity: null, intensityDefault: null, intensityLabel: null };
    if (!slot || !slot.effectId) return none;
    let desc;
    try {
      desc = getPrimaryIntensity(slot.effectId);
    } catch {
      return none; // unknown effect → no intensity surface
    }
    if (!desc) return none; // effect declares no primary
    const intensityDefault = mapPrimaryTo01(slot.effectId, desc.default);
    const touched = slot.intensity;
    const intensity = (typeof touched === 'number' && Number.isFinite(touched))
      ? (touched < 0 ? 0 : touched > 1 ? 1 : touched)
      : intensityDefault;
    return { intensity, intensityDefault, intensityLabel: desc.label };
  }

  _isSlotActive(slot) {
    if (!slot.enabled) return false;
    const c = this.controller;
    switch (slot.effectId) {
      case 'strobe':
        return c.strobeActive && c.activeStrobePresetId === slot.presetId;
      case 'colorWash': {
        // MULTI-INSTANCE (RCA 2026-07-13): each slot owns its OWN wash entry,
        // keyed `slot:${slotId}`, so this slot reports its own truth — two
        // colorWash slots (Ocean / Emergency) no longer share one flag.
        const w = c.colorWashes.get(`slot:${slot.slotId}`);
        return !!(w && w.enabled && w.preset === slot.presetId);
      }
      case 'feedbackTrails':
        return !!c.feedbackTrailsConfig.enabled && c.feedbackTrailsConfig.preset === slot.presetId;
      case 'dropHit':
        return c.dropHitActive;
      // ── Party effects (report 20260708_7) ────────────────────────────
      // PRESET-AWARE (RCA: Hi-Hat↔Blizzard pad crosstalk). These are
      // singleton effects with MULTIPLE presets; the controller already
      // stamps the running preset id on enable, so two slots bound to
      // DIFFERENT presets of the same effect must NOT both report active.
      // Mirror the strobe/colorWash/feedbackTrails preset guard above.
      case 'beatPump':
        return !!c.beatPump.enabled && c.beatPump.presetId === slot.presetId;
      case 'waterlineSweep':
        return !!c.sweep.enabled && c.sweep.presetId === slot.presetId;
      // Kick Punch: the AUTO router is the toggle-able state. The one-shot
      // trigger fires a dropHit and holds no lasting state of its own, so
      // active-ness tracks the armed router — but the router now stamps the
      // firing preset id, so two kickPunch slots (punch vs ice_punch) don't
      // both light.
      case 'kickPunch':
        return !!c.kickRouter.enabled && c.kickRouter.presetId === slot.presetId;
      case 'freeze':
        return !!c.freeze.active && c.freeze.presetId === slot.presetId;
      case 'crush':
        return !!c.crush.enabled && c.crush.presetId === slot.presetId;
      case 'breath':
        return !!c.breath.enabled && c.breath.presetId === slot.presetId;
      case 'sparkle':
        return !!c.sparkle.enabled && c.sparkle.presetId === slot.presetId;
      // Global color Invert (June 2026): now an assignable slot effect
      // routed through controller.invert. Singleton boolean, no preset
      // distinction.
      case 'invert':
        return !!c.invert;
      // Legacy effects: just look up the boolean toggle on
      // controller.effects, since they're singletons (no preset
      // distinction in the legacy path beyond the bypassDimmer twin).
      case 'vintageWhite':
        return !!c.effects.vintageWhite;
      case 'blastWhite':
        return !!c.effects.blastWhite;
      case 'uvBlast':
        return !!c.effects.uvBlast;
      case 'fogger':
        return !!c.effects.fogger;
      default:
        return false;
    }
  }

  /**
   * Route a UI/API action to the controller.
   * @param {object} args
   * @param {number} args.slotId      1..6
   * @param {string} args.action      'press' | 'activate' | 'deactivate' | 'trigger' | 'toggle' | 'down' | 'up'
   *   `press` is behavior-resolved server-side (trigger→fire, toggle→flip,
   *   hold→down) — see `_dispatchResolved`.
   * @param {number} args.frameIndex
   * @param {number} args.nowMs
   */
  dispatchSlotAction({ slotId, action, frameIndex, nowMs }) {
    const slot = this.getSlot(slotId);
    if (!slot) throw new Error(`Invalid slotId: ${slotId}`);
    const resolved = resolveSlotBinding({ slot });
    this._dispatchResolved({ resolved, action, frameIndex, nowMs, slotIdForError: slotId });
  }

  /**
   * Slot-less dispatch surface used by the engine-owned scheduler
   * (docs/31_scheduled_tasks.md v3). Resolves the effectId/presetId
   * against the library directly — no GEM slot involved — merges
   * `params` over the preset's defaults, and routes through the
   * same `_dispatch*` helpers as the slot path so behavior parity
   * is guaranteed.
   *
   * Throws if the effectId or presetId is missing in the library, if
   * the requested behavior isn't supported, or if a safety-tier guard
   * trips. Callers catch and surface to the operator.
   *
   * @param {object} args
   * @param {string} args.effectId
   * @param {string} args.presetId
   * @param {string} args.action      'activate'|'deactivate'|'trigger'|'down'|'up'
   * @param {Record<string,any>} [args.params] — per-call overrides; merged over preset defaults
   * @param {number} args.frameIndex
   * @param {number} args.nowMs
   * @param {string} [args.behavior]  — override resolution (defaults to preset.defaultBehavior)
   */
  dispatchEffectAction({ effectId, presetId, action, params = {}, frameIndex, nowMs, behavior }) {
    const effect = GLOBAL_EFFECT_LIBRARY[effectId];
    if (!effect) throw new Error(`Unknown effectId: ${effectId}`);
    const preset = effect.presets && effect.presets[presetId];
    if (!preset) throw new Error(`Unknown presetId '${presetId}' for effect '${effectId}'`);

    // Validate overrides through the same gate slot resolution uses,
    // then merge so task.params wins over preset defaults (docs/31 §"Scheduler tick").
    const sanitized = validateParams(effectId, params || {});
    const mergedParams = { ...preset.params, ...sanitized };

    const chosenBehavior = behavior || preset.defaultBehavior;
    if (!effect.behaviorTypes.includes(chosenBehavior)) {
      throw new Error(`Effect '${effectId}' does not support behavior '${chosenBehavior}'`);
    }

    const safetyTier = preset.safetyTier || SAFETY_TIERS.NORMAL;

    // Build a resolved descriptor shaped like the one resolveSlotBinding
    // produces, so the existing _dispatch* helpers (which read .slotId,
    // .presetId, .params, .behavior off the resolved object) work
    // unchanged. slotId=null because there is no slot.
    const resolved = {
      slotId: null,
      effectId,
      presetId,
      label: preset.label || effectId,
      behavior: chosenBehavior,
      params: mergedParams,
      safetyTier,
    };
    this._dispatchResolved({ resolved, action, frameIndex, nowMs, slotIdForError: 'scheduler' });
  }

  _dispatchResolved({ resolved, action, frameIndex, nowMs, slotIdForError }) {
    // Behavior-resolved `press` (RCA 20260709_7 fix spec #1): a physical key
    // press should do the RIGHT thing per the slot's own behavior, decided
    // SERVER-side where the resolved behavior is always known — so a stale or
    // missing host-side behavior snapshot can never mis-route a press (e.g.
    // turn a trigger key into a dead `toggle` no-op). The host sends `press`
    // whenever it would otherwise have to guess; the engine translates it:
    //   trigger → fire (single-shot, re-fires every press)
    //   toggle  → flip
    //   hold    → down (press-and-hold entry; the matching `up`/`release`
    //             still comes through as its own action)
    //   burst   → fire the burst
    // Anything else falls through as-is.
    if (action === 'press') {
      switch (resolved.behavior) {
        case 'trigger': action = 'trigger'; break;
        case 'toggle':  action = 'toggle';  break;
        case 'hold':    action = 'down';    break;
        case 'burst':   action = 'trigger'; break;
        default:
          throw new Error(
            `Slot ${slotIdForError} has unknown behavior '${resolved.behavior}'; ` +
            `cannot resolve a 'press' action`
          );
      }
    }

    // Hard server-side guard: expert_burst can ONLY be 'trigger' / 'burst'-equivalent.
    if (resolved.safetyTier === SAFETY_TIERS.EXPERT_BURST && (action === 'toggle' || action === 'hold')) {
      throw new Error(
        `Slot ${slotIdForError} preset '${resolved.presetId}' is safety tier 'expert_burst'; ` +
        `action '${action}' is not allowed`
      );
    }

    switch (resolved.effectId) {
      case 'strobe':
        this._dispatchStrobe({ resolved, action, frameIndex, nowMs });
        return;
      // dropHit is a TRIGGER-only (momentary) effect — the hand-drummed
      // Iceberg-Flash path. A `press` (behavior-resolved) or an explicit
      // firing action fires ONE voice. Any NON-firing action (`toggle`,
      // `hold`, `up`, `deactivate`) is a category error for a trigger slot:
      // previously it fell through here and the route still replied 200-ok,
      // so a mis-routed toggle on a trigger key was a SILENT no-op that hid
      // the whole trigger bug (RCA 20260709_7 T2). Codex P0 = no silent
      // fallbacks: reject loudly so the caller surfaces the failure.
      case 'dropHit':
        if (['press', 'trigger', 'activate', 'down'].includes(action)) {
          this.controller.triggerDropHit(resolved.params, nowMs);
          return;
        }
        throw new Error(
          `Slot ${slotIdForError} effect 'dropHit' has behavior 'trigger'; ` +
          `action '${action}' is not a firing action ` +
          `(use press/trigger). A trigger slot cannot be toggled or held.`
        );
      case 'colorWash':
        this._dispatchColorWash({ resolved, action, nowMs });
        return;
      case 'feedbackTrails':
        this._dispatchFeedbackTrails({ resolved, action, nowMs });
        return;
      // Global color Invert (June 2026): assignable slot effect routed
      // through controller.setInvert. activate/down → on, deactivate/up
      // → off, toggle (or bare) → flip. The legacy POST
      // /global-effect-invert route still drives the same setInvert.
      case 'invert':
        this._dispatchInvert({ action });
        return;
      // Legacy rig-globals (migrated May 2026): the slot dispatcher
      // routes through `controller.setEffect(...)` so the existing
      // dimmer-aware pixel pipeline / DMX writers keep working.
      case 'vintageWhite':
      case 'blastWhite':
      case 'uvBlast':
      case 'fogger':
        this._dispatchLegacy({ resolved, action });
        return;
      // ── Party effects (report 20260708_7) ────────────────────────────
      case 'beatPump':
        this._dispatchToggleEffect({ resolved, action, on: 'setBeatPump' });
        return;
      case 'waterlineSweep':
        this._dispatchToggleEffect({ resolved, action, on: 'setWaterlineSweep' });
        return;
      case 'kickPunch':
        this._dispatchKickPunch({ resolved, action, nowMs });
        return;
      case 'freeze':
        this._dispatchFreeze({ resolved, action });
        return;
      case 'crush':
        this._dispatchToggleEffect({ resolved, action, on: 'setPaletteCrush' });
        return;
      case 'breath':
        this._dispatchToggleEffect({ resolved, action, on: 'setOceanBreath' });
        return;
      case 'sparkle':
        this._dispatchToggleEffect({ resolved, action, on: 'setFrostSparkle' });
        return;
      default:
        this.controller.triggerGenericMacro({
          effectId: resolved.effectId,
          params: resolved.params,
          action, frameIndex, nowMs,
        });
    }
  }

  _dispatchLegacy({ resolved, action }) {
    const c = this.controller;
    const effectId = resolved.effectId;
    const isOn = !!c.effects[effectId];
    let next;
    if (action === 'deactivate' || action === 'up') next = false;
    else if (action === 'activate' || action === 'down' || action === 'trigger') next = true;
    else if (action === 'toggle' || action === undefined) next = !isOn;
    else next = !isOn;
    c.setEffect(effectId, next);
    // bypassDimmer is OWNED by the dimmer rack's BypassCheckbox now
    // (operator review May 2026). Pre-May-2026 each legacy effect
    // had two presets (`default` + `bypass_dimmer`) which set this
    // flag at slot-dispatch time and stomped over the dimmer rack's
    // setting. That double-source-of-truth caused operators to find
    // their bypass flag flipping unexpectedly when they activated
    // a slot. Now: the slot dispatcher TOUCHES THE EFFECT TOGGLE
    // ONLY. The bypass flag stays exactly where the dimmer rack
    // last put it.
  }

  _dispatchInvert({ action }) {
    const c = this.controller;
    if (action === 'activate' || action === 'down') {
      c.setInvert(true);
    } else if (action === 'deactivate' || action === 'up') {
      c.setInvert(false);
    } else {
      // toggle / trigger / bare action: flip current state.
      c.setInvert(!c.invert);
    }
  }

  // ── Party effects (report 20260708_7) ──────────────────────────────
  // Generic toggle dispatcher for the singleton party effects that expose a
  // controller setter of the shape setX(enabled, params, meta). Covers E1
  // Beat Pump, E2 Waterline Sweep, E6 Palette Crush, E9 Ocean Breath, E10
  // Frost Sparkle — all toggle-only in the library.
  //   activate / down          → ON with resolved params
  //   deactivate / up          → OFF
  //   toggle / bare            → flip (preset-aware: re-toggling the SAME
  //                              running preset turns it off; a different
  //                              preset switches without an off flicker)
  _dispatchToggleEffect({ resolved, action, on }) {
    const c = this.controller;
    const meta = { presetId: resolved.presetId, slotId: resolved.slotId };
    if (action === 'deactivate' || action === 'up') {
      c[on](false, resolved.params, meta);
      return;
    }
    if (action === 'activate' || action === 'down') {
      c[on](true, resolved.params, meta);
      return;
    }
    // toggle / bare: preset-aware flip, mirroring the strobe/wash pattern.
    const active = this._isSlotActive({
      slotId: resolved.slotId, enabled: true,
      effectId: resolved.effectId, presetId: resolved.presetId,
    });
    const samePreset = active && this._activePresetMatches(resolved);
    if (samePreset) {
      c[on](false, resolved.params, meta);
    } else {
      c[on](true, resolved.params, meta);
    }
  }

  /**
   * Does the CURRENTLY-RUNNING instance of this singleton party effect use
   * the same preset the resolved slot points at? Used for preset-aware
   * toggling so switching presets on one running effect swaps in place
   * instead of turning it off. Legacy-style singletons (no preset id stored)
   * fall back to "any active === same" so a bare toggle still turns off.
   */
  _activePresetMatches(resolved) {
    const c = this.controller;
    switch (resolved.effectId) {
      case 'beatPump': return c.beatPump.presetId === resolved.presetId;
      case 'waterlineSweep': return c.sweep.presetId === resolved.presetId;
      case 'crush': return c.crush.presetId === resolved.presetId;
      case 'breath': return c.breath.presetId === resolved.presetId;
      case 'sparkle': return c.sparkle.presetId === resolved.presetId;
      case 'freeze': return c.freeze.presetId === resolved.presetId;
      case 'kickPunch': return c.kickRouter.presetId === resolved.presetId;
      default: return true;
    }
  }

  /**
   * E3 Kick Punch. Two behaviors (library declares both):
   *   - trigger (default): fire ONE dropHit right now (uses the ceil
   *     intensity as the punch strength). No lasting state.
   *   - toggle: arm/disarm the AUTO router that fires dropHits on live kicks.
   * activate/down arm the router (auto); deactivate/up disarm it.
   */
  _dispatchKickPunch({ resolved, action, nowMs }) {
    const c = this.controller;
    const p = resolved.params;
    if (resolved.behavior === 'trigger' || action === 'trigger') {
      // One-shot: fire the dropHit envelope directly at the punch ceiling.
      c.triggerDropHit({
        color: p.color,
        intensity: p.intensityCeil ?? 1.0,
        attackMs: p.attackMs, holdMs: p.holdMs, releaseMs: p.releaseMs,
        blendMode: p.blendMode || 'add',
      }, nowMs);
      return;
    }
    // toggle behavior → arm/disarm the auto router.
    const meta = { presetId: resolved.presetId, slotId: resolved.slotId };
    if (action === 'deactivate' || action === 'up') {
      c.setKickRouter(false, p, meta);
      return;
    }
    if (action === 'activate' || action === 'down') {
      c.setKickRouter(true, p, meta);
      return;
    }
    // bare toggle: flip the router.
    c.setKickRouter(!c.kickRouter.enabled, p, meta);
  }

  /**
   * E4 Freeze Frame. toggle | hold behaviors. activate/down engage;
   * deactivate/up release; bare toggle flips.
   */
  _dispatchFreeze({ resolved, action }) {
    const c = this.controller;
    const meta = { presetId: resolved.presetId, slotId: resolved.slotId };
    if (action === 'deactivate' || action === 'up') {
      c.setFreeze(false, resolved.params, meta);
      return;
    }
    if (action === 'activate' || action === 'down') {
      c.setFreeze(true, resolved.params, meta);
      return;
    }
    // bare toggle: flip.
    c.setFreeze(!c.freeze.active, resolved.params, meta);
  }

  _dispatchStrobe({ resolved, action, frameIndex, nowMs }) {
    const p = resolved.params;
    if (resolved.behavior === 'burst') {
      const dur = Math.min(MAX_BURST_MS, Math.max(0, p.durationMs ?? 1000));
      this.controller.triggerStrobeBurst(p.hz, dur, frameIndex, {
        presetId: resolved.presetId, slotId: resolved.slotId, fadeOutMs: p.fadeOutMs,
      });
      return;
    }
    if (resolved.behavior === 'hold') {
      if (action === 'down' || action === 'activate') {
        this.controller.setStrobe(true, p.hz, p.duty, p.intensity, frameIndex, {
          presetId: resolved.presetId, slotId: resolved.slotId, fadeOutMs: p.fadeOutMs,
        });
      } else if (action === 'up' || action === 'deactivate') {
        this.controller.stopStrobe({ nowMs });
      }
      return;
    }
    // toggle
    if (action === 'deactivate' || action === 'up') {
      this.controller.stopStrobe({ nowMs });
      return;
    }
    const sameStrobe = this.controller.strobeActive &&
      this.controller.activeStrobePresetId === resolved.presetId;
    if (sameStrobe && (action === 'toggle' || action === undefined)) {
      this.controller.stopStrobe({ nowMs });
    } else {
      this.controller.setStrobe(true, p.hz, p.duty, p.intensity, frameIndex, {
        presetId: resolved.presetId, slotId: resolved.slotId, fadeOutMs: p.fadeOutMs,
      });
    }
  }

  _dispatchColorWash({ resolved, action, nowMs }) {
    const p = resolved.params;
    // Target ONLY this slot's wash (multi-instance). Threading slotId+presetId
    // into the disable path fixes the latent untargeted-kill bug: the pre-fix
    // `setColorWash(false, null, ...)` cleared whatever single wash was up, so a
    // deactivate on slot A (API deactivate, or CaptainPad's pre-swap deactivate)
    // could kill slot B's wash. For a slotless scheduler dispatch resolved.slotId
    // is null, so the key falls back to `sched:${presetId}` — it disables only
    // its own entry.
    const targetMeta = { nowMs, slotId: resolved.slotId };
    if (action === 'deactivate' || action === 'up') {
      this.controller.setColorWash(false, resolved.presetId, 0, 'tint', targetMeta);
      return;
    }
    if (resolved.behavior === 'toggle') {
      const key = resolved.slotId != null ? `slot:${resolved.slotId}` : `sched:${resolved.presetId}`;
      const w = this.controller.colorWashes.get(key);
      const sameWash = !!(w && w.enabled && w.preset === resolved.presetId);
      if (sameWash && (action === 'toggle' || action === undefined)) {
        this.controller.setColorWash(false, resolved.presetId, 0, 'tint', targetMeta);
      } else {
        this.controller.setColorWash(true, resolved.presetId, p.amount, p.mode, {
          slotId: resolved.slotId,
        });
      }
    } else {
      this.controller.setColorWash(true, resolved.presetId, p.amount, p.mode, {
        slotId: resolved.slotId,
      });
    }
  }

  _dispatchFeedbackTrails({ resolved, action, nowMs }) {
    if (action === 'deactivate' || action === 'up') {
      this.controller.setFeedbackTrails(false, null, {}, { nowMs });
      return;
    }
    const same = this.controller.feedbackTrailsConfig.enabled &&
      this.controller.feedbackTrailsConfig.preset === resolved.presetId;
    if (same && (action === 'toggle' || action === undefined)) {
      this.controller.setFeedbackTrails(false, null, {}, { nowMs });
    } else {
      this.controller.setFeedbackTrails(true, resolved.presetId, resolved.params, {
        slotId: resolved.slotId,
      });
    }
  }
}
