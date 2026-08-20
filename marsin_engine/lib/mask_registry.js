// mask_registry.js — model-level named-mask registry (Tier A).
//
// A view mask was historically ONE bit in a single per-pixel Int32
// (`viewMask`), so a model supported at most 31 masks total — base
// groups AND named composites sharing one budget (report 20260618_2).
// That bit is needed only for IN-PATTERN access (`viewMask & MASK_X`
// inside the VM). HOST-SIDE / live selection — the mixer's per-channel
// view masking, isolation, CaptainPad region picks — never enters the
// VM: it already builds a per-pixel `Uint8Array` membership mask. So it
// does NOT need a bit at all.
//
// This registry makes that explicit. It interns every named mask to a
// stable small id at model load and stores its canonical per-pixel
// `members` (Uint8Array, 1 = in the mask). A mask MAY also carry a
// `bit` (when it is resident in the 31-bit viewMask cache for in-pattern
// use), but membership is the source of truth. Live selection reads
// `members[]` directly, so the number of NAMED masks usable for host-
// side selection is unbounded — the 31-cap only ever applied to the
// in-VM bit cache, which is untouched here (back-compat).
//
// Deterministic: ids are assigned in declaration order (groups first,
// then presets), exactly like the existing first-appearance group-bit
// discipline — no persisted id, no new staleness class.

/**
 * @typedef {Object} MaskEntry
 * @property {number} id        dense small int (intern id, == array index)
 * @property {string} name      human-readable, authored
 * @property {'group'|'composite'|'pixelSet'} kind
 * @property {Uint8Array} members  per-pixel membership (the truth)
 * @property {number} bit       viewMask bit if resident in the 31-bit
 *                              cache, else 0 (host-only / Tier A)
 */

export class MaskRegistry {
  constructor() {
    /** @type {Map<string, number>} name → id */
    this.byName = new Map();
    /** @type {MaskEntry[]} dense, id == index */
    this.byId = [];
  }

  has(name) {
    return this.byName.has(name);
  }

  /** @returns {MaskEntry|null} */
  get(name) {
    const id = this.byName.get(name);
    return id === undefined ? null : this.byId[id];
  }

  /** @returns {string[]} all registered mask names */
  names() {
    return [...this.byName.keys()];
  }

  _add(name, kind, members, bit) {
    if (this.byName.has(name)) {
      throw new Error(`MaskRegistry: duplicate mask name '${name}'`);
    }
    const id = this.byId.length;
    const entry = { id, name, kind, members, bit: bit || 0 };
    this.byId.push(entry);
    this.byName.set(name, id);
    return entry;
  }
}

function emptyMembers(pixelCount) {
  return new Uint8Array(pixelCount);
}

/**
 * Build the model's MaskRegistry from its resolved pixels, group→bit
 * table, and view-mask presets. Computes canonical per-pixel `members`
 * for every base group and every named preset, from the SAME membership
 * source the engine used (group name match / pixelIndices), so the
 * registry never diverges from the bit-merged `viewMask`.
 *
 * Bit-backed masks keep their `bit` (so `viewMask & MASK_X` in-pattern
 * access is unchanged); bit-less masks get bit 0 and are host-side-only.
 *
 * @param {{pixels: Array, pixelCount?: number, groupBits?: Object,
 *          viewMasks?: Array}} model
 * @returns {MaskRegistry}
 */
export function buildMaskRegistry({ pixels, pixelCount, groupBits = {}, viewMasks = [] }) {
  if (!Array.isArray(pixels)) {
    throw new Error('buildMaskRegistry requires a pixels array');
  }
  const count = Number.isInteger(pixelCount) ? pixelCount : pixels.length;
  const registry = new MaskRegistry();

  // Base groups first (id order = declaration order in groupBits).
  for (const [group, bit] of Object.entries(groupBits)) {
    const members = emptyMembers(count);
    for (let i = 0; i < count; i++) {
      if (pixels[i] && pixels[i].group === group) members[i] = 1;
    }
    registry._add(group, 'group', members, bit);
  }

  // Named presets next. A preset declares membership by `groups:[...]`
  // (union of base groups) or `pixelIndices:[...]`. Composites that
  // collide with a base-group name are skipped (the group already owns
  // that name); a genuinely distinct composite name registers fresh.
  for (const vm of viewMasks) {
    if (!vm || typeof vm.name !== 'string' || vm.name.length === 0) continue;
    if (registry.has(vm.name)) continue;
    const members = emptyMembers(count);
    const bit = Number.isInteger(vm.bit) ? vm.bit : 0;
    if (Array.isArray(vm.groups) && vm.groups.length > 0) {
      const groupSet = new Set(vm.groups);
      for (let i = 0; i < count; i++) {
        if (pixels[i] && groupSet.has(pixels[i].group)) members[i] = 1;
      }
      registry._add(vm.name, 'composite', members, bit);
    } else if (Array.isArray(vm.pixelIndices) && vm.pixelIndices.length > 0) {
      for (const idx of vm.pixelIndices) {
        if (Number.isInteger(idx) && idx >= 0 && idx < count) members[idx] = 1;
      }
      registry._add(vm.name, 'pixelSet', members, bit);
    } else if (bit !== 0) {
      // Bit-only preset: membership is implicit — whichever pixels carry
      // the bit in the preset's OWN word. Word 0 and word 1 are independent
      // bit spaces (Tier-C), so a word-1 bit read out of `vMask` would match
      // whatever word-0 group/preset shares the value instead of the
      // preset's real members. Unreachable from a sidecar load (the engine
      // requires groups OR pixelIndices there), kept for back-compat with
      // models / tests that declare named masks by bit alone.
      const hiWord = vm.word === 1;
      for (let i = 0; i < count; i++) {
        const px = pixels[i];
        const word = !px ? 0 : (hiWord
          ? (px.vMaskHi ?? 0)
          : (px.vMask ?? px.viewMask ?? 0));
        if ((word & bit) !== 0) members[i] = 1;
      }
      registry._add(vm.name, 'composite', members, bit);
    }
  }

  return registry;
}
