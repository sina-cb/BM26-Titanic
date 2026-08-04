// model_loader.js — VM-only model loader for tools + tests.
//
// The full engine `loadModel()` (engine.js) is coupled to sACN, audio,
// param-center and the rest of the runtime. The perf gauge and the
// mask/fixture-type unit tests need ONLY the parts that reach the VM:
//   - the pixel array (coords + per-pixel meta),
//   - the resolved group → bit table and view-mask presets,
//   - the per-pixel viewMask after group + preset merge,
//   - the metaArray the host packs into WASM.
//
// This module reproduces engine.js's group-bit assignment + preset
// merge faithfully so the gauge sees the same vMask/fId the engine
// produces, WITHOUT pulling in ws/sacn/js-yaml (codex offline rule —
// the gauge must run on a bare checkout). engine.js remains the
// authoritative loader for the live runtime; keep the two in sync when
// the bit-assignment contract changes.

import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

import { buildFixtureTypeIds, fixtureTypeId } from './fixture_type_constants.js';
import { derivePixelLocalIndices } from './pixel_local_index.js';
import { ViewBitAllocator, MAX_WORD_BIT, MAX_VIEW_SLOTS } from './view_word.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODELS_DIR = path.resolve(__dirname, '..', 'models');

const MAX_BIT = MAX_WORD_BIT; // bit 30 — highest safe signed-Int32 view-mask bit (per word)

async function importModel(modelName) {
  const modelPath = path.join(MODELS_DIR, `${modelName}.js`);
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Model not found: ${modelPath}`);
  }
  const mod = await import(`file://${modelPath}`);
  if (!Array.isArray(mod.pixels)) {
    throw new Error(`Model ${modelName} must export a pixels array`);
  }
  // The imported module is a cached singleton; bit assignment + fixture-
  // bit merge MUTATE per-pixel vMask in place. Clone the pixels (and zero
  // vMask/viewMask) so repeated loads of the same model are independent
  // and idempotent — otherwise usedMask would accumulate across loads
  // and eventually overflow the bit budget. The engine's own loadModel
  // re-imports with a cache-buster for the same reason.
  return {
    pixelCount: mod.pixelCount,
    pixels: mod.pixels.map((px) => (px ? { ...px, vMask: 0, viewMask: 0, vMaskHi: 0 } : px)),
    viewMasks: mod.viewMasks,
    groupBits: mod.groupBits,
  };
}

async function importViewMaskSidecar(modelName, mod) {
  const sidecarPath = path.join(MODELS_DIR, `${modelName}.viewmasks.js`);
  if (fs.existsSync(sidecarPath)) {
    const vm = await import(`file://${sidecarPath}`);
    if (!Array.isArray(vm.viewMasks)) {
      throw new Error(`Viewmasks sidecar ${sidecarPath} must export a viewMasks array`);
    }
    return { declaredViewMasks: vm.viewMasks, declaredGroupBits: vm.groupBits ?? null };
  }
  if (Array.isArray(mod.viewMasks)) {
    return { declaredViewMasks: mod.viewMasks, declaredGroupBits: mod.groupBits ?? null };
  }
  return { declaredViewMasks: [], declaredGroupBits: null };
}

function isPowerOfTwoBit(bit) {
  return Number.isInteger(bit) && bit > 0 && bit <= MAX_BIT && (bit & (bit - 1)) === 0;
}

// Reserve explicit preset bits, mirroring engine.js validation.
//
// Tier-C: word 0 (`viewMask`) and word 1 (`viewMaskHi`) are INDEPENDENT bit
// spaces — a word-1 preset pinned to 0x10 does NOT collide with a word-0
// group or preset also using 0x10. So the reservation is tracked PER WORD,
// exactly as engine.js does. Collapsing the two into one flat mask made
// every word-1 preset bit look like a word-0 collision and wedged the
// loader on titanic (10 views pinned into word 1 at 0x1..0x200).
//
// @returns {{reservedMask: number, reservedMaskHi: number}} word-0 / word-1
//          reservations. Group-bit assignment consults ONLY `reservedMask`
//          (groups live in word 0).
//
// Exported (with assignGroupBits) so the word-space contract is directly
// testable — see tests/mixer/model_loader_word_aware.test.js.
export function reserveExplicitBits(declaredViewMasks) {
  let reservedMask = 0;
  let reservedMaskHi = 0;
  const seen = new Set();
  for (const entry of declaredViewMasks) {
    if (!entry || typeof entry.name !== 'string' || entry.name.length === 0) {
      throw new Error(`viewMasks entry without a name: ${JSON.stringify(entry)}`);
    }
    if (seen.has(entry.name)) throw new Error(`Duplicate viewMasks entry name '${entry.name}'`);
    seen.add(entry.name);
    if (entry.word !== undefined && entry.word !== 0 && entry.word !== 1) {
      throw new Error(`viewMasks entry '${entry.name}': word must be 0 or 1, got ${entry.word}`);
    }
    const word = entry.word === 1 ? 1 : 0;
    if (word === 1 && entry.bit === undefined) {
      throw new Error(`viewMasks entry '${entry.name}' declares word:1 (viewMaskHi) and therefore ` +
        `needs an explicit single-bit value`);
    }
    if (entry.bit !== undefined) {
      if (!isPowerOfTwoBit(entry.bit)) {
        throw new Error(`viewMasks entry '${entry.name}': bit must be a power of two ≤ 0x40000000`);
      }
      if (word === 1) {
        if ((reservedMaskHi & entry.bit) !== 0) {
          throw new Error(`viewMasks entry '${entry.name}' reuses viewMaskHi bit ` +
            `0x${entry.bit.toString(16)}`);
        }
        reservedMaskHi |= entry.bit;
      } else {
        if ((reservedMask & entry.bit) !== 0) {
          throw new Error(`viewMasks entry '${entry.name}' reuses bit 0x${entry.bit.toString(16)}`);
        }
        reservedMask |= entry.bit;
      }
    }
  }
  return { reservedMask, reservedMaskHi };
}

// `reservedMask` is the WORD-0 reservation only — group bits live in word 0,
// so a word-1 preset bit must never constrain them.
export function assignGroupBits(mod, declaredGroupBits, reservedMask) {
  const modelGroups = [];
  for (const px of mod.pixels) {
    if (!px) continue;
    px.vMask = px.vMask ?? 0;
    px.viewMask = px.viewMask ?? 0;
    px.vMaskHi = px.vMaskHi ?? 0; // Tier-C high view word (views 31..61)
    if (typeof px.group === 'string' && px.group.length > 0 && !modelGroups.includes(px.group)) {
      modelGroups.push(px.group);
    }
  }

  if (declaredGroupBits !== null) {
    let usedMask = reservedMask;
    for (const [group, bit] of Object.entries(declaredGroupBits)) {
      if (!isPowerOfTwoBit(bit)) {
        throw new Error(`groupBits['${group}'] must be a power of two ≤ 0x40000000, got ${bit}`);
      }
      if ((usedMask & bit) !== 0) {
        throw new Error(`groupBits['${group}'] reuses bit 0x${bit.toString(16)}`);
      }
      usedMask |= bit;
    }
    const missing = modelGroups.filter((g) => declaredGroupBits[g] === undefined);
    const stale = Object.keys(declaredGroupBits).filter((g) => !modelGroups.includes(g));
    if (missing.length > 0 || stale.length > 0) {
      throw new Error(`groupBits out of sync with model — missing: [${missing.join(', ')}] stale: [${stale.join(', ')}]`);
    }
    return { ...declaredGroupBits };
  }

  const groupBits = {};
  let nextBit = 1;
  for (const group of modelGroups) {
    while ((nextBit & reservedMask) !== 0) nextBit *= 2;
    if (nextBit > MAX_BIT) {
      throw new Error(`Out of view-mask bits assigning group '${group}'`);
    }
    groupBits[group] = nextBit;
    nextBit *= 2;
  }
  return groupBits;
}

function mergeGroupBits(mod, groupBits) {
  for (const px of mod.pixels) {
    if (!px || typeof px.group !== 'string' || px.group.length === 0) continue;
    px.vMask |= groupBits[px.group];
    px.viewMask = px.vMask;
  }
}

// Resolve declared presets into { name, bit, word, ... } view entries,
// merging each pixel-set / explicit-bit preset's bit into the per-pixel
// word it lives in. Word 0 → px.vMask (lane 3, legacy `viewMask`); word 1
// → px.vMaskHi (lane 6, the Tier-C `viewMaskHi`, 31 more bits).
//
// `alloc` is a shared two-word ViewBitAllocator (groups already claimed in
// word 0). A preset that needs a NEW single bit (an explicit pixelIndices
// set without a declared bit) draws the lowest free slot, filling word 0
// before word 1 — so the first 31 views stay byte-identical to the legacy
// single-word layout, and only the 32nd+ spills into viewMaskHi.
function resolvePresets(mod, declaredViewMasks, groupBits, alloc) {
  const mergeWordBit = (px, word, bit) => {
    if (word === 1) {
      px.vMaskHi = (px.vMaskHi ?? 0) | bit;
    } else {
      const cur = (px.vMask ?? px.viewMask ?? 0) | bit;
      px.vMask = cur;
      px.viewMask = cur;
    }
  };
  return declaredViewMasks.map((entry) => {
    if (Array.isArray(entry.groups) && entry.groups.length > 0) {
      const groupSet = new Set(entry.groups);
      for (const g of groupSet) {
        if (groupBits[g] === undefined) {
          throw new Error(`viewMasks entry '${entry.name}' references unknown group '${g}'`);
        }
      }
      if (entry.bit !== undefined) {
        const word = entry.word === 1 ? 1 : 0;
        for (const px of mod.pixels) if (px && groupSet.has(px.group)) mergeWordBit(px, word, entry.bit);
        return { name: entry.name, bit: entry.bit, word, groups: [...groupSet] };
      }
      // Computed composite: ORs base-group bits (always word 0 — groups
      // are word-0 only). Not merged into pixels (the base bits already are).
      let bit = 0;
      for (const g of groupSet) bit |= groupBits[g];
      return { name: entry.name, bit, word: 0, groups: [...groupSet] };
    }
    // pixelIndices preset. An explicit bit pins its (word=entry.word||0,
    // bit); otherwise the allocator hands out the lowest free slot, which
    // spills into word 1 (viewMaskHi) past the 31st view.
    let word;
    let bit;
    if (entry.bit !== undefined) {
      word = entry.word === 1 ? 1 : 0;
      bit = entry.bit;
    } else {
      ({ word, bit } = alloc.next(`viewMasks entry '${entry.name}'`));
    }
    for (const idx of entry.pixelIndices || []) {
      const px = mod.pixels[idx];
      if (px) mergeWordBit(px, word, bit);
    }
    return { name: entry.name, bit, word, pixelIndices: [...(entry.pixelIndices || [])] };
  });
}

/**
 * Apply a model transform between group/preset resolution and meta
 * assembly. Phase 2 (fixture types) plugs its Tier-A bit merge in here
 * so model_loader stays free of feature-specific imports.
 *
 * @param {string} modelName
 * @param {(ctx: {mod: object, groupBits: object, viewMasks: Array}) => void} [transform]
 */
export async function loadModelForGauge(modelName, transform = null) {
  const mod = await importModel(modelName);
  const { declaredViewMasks, declaredGroupBits } = await importViewMaskSidecar(modelName, mod);

  // Word-0 and word-1 reservations are independent bit spaces; group bits
  // live in word 0, so only `reservedMask` constrains them.
  const { reservedMask } = reserveExplicitBits(declaredViewMasks);
  const groupBits = assignGroupBits(mod, declaredGroupBits, reservedMask);
  mergeGroupBits(mod, groupBits);

  // Two-word view-bit allocator (Tier-C). Word 0 = legacy `viewMask`,
  // word 1 = `viewMaskHi`. Every bit already taken in word 0 (group bits +
  // explicit reserved preset bits) is claimed so a NEW bit-less preset
  // draws the lowest free slot, filling word 0 first then spilling into
  // word 1 — keeping the first 31 views byte-identical to the legacy
  // single-word layout. Throws LOUDLY past slot 61 (62 total).
  const alloc = new ViewBitAllocator();
  for (const bit of Object.values(groupBits)) alloc.claim(0, bit, 'group');
  for (const entry of declaredViewMasks) {
    if (entry && entry.bit !== undefined && entry.word !== 1 && !alloc.isUsed(0, entry.bit)) {
      alloc.claim(0, entry.bit, `viewMasks entry '${entry.name}'`);
    } else if (entry && entry.bit !== undefined && entry.word === 1 && !alloc.isUsed(1, entry.bit)) {
      alloc.claim(1, entry.bit, `viewMasks entry '${entry.name}'`);
    }
  }
  const viewMasks = resolvePresets(mod, declaredViewMasks, groupBits, alloc);

  // Tier-B fixture-type ids, mirroring engine.js loadModel: the canonical
  // FIX_* id table is injected as integers (no viewMask-bit merge), and
  // the per-pixel fixtureTypeId + pixelLocalIndex lanes are packed into
  // the meta stride for the real `fixtureType` builtin. So the gauge/tests
  // see exactly the vMask + meta the live runtime produces.
  const fixtureConstants = buildFixtureTypeIds(mod.pixels);

  if (typeof transform === 'function') {
    transform({ mod, groupBits, viewMasks, fixtureConstants });
  }

  const localIndices = derivePixelLocalIndices(mod.pixels);
  const metaArray = mod.pixels.map((px, i) => ({
    controllerId: px.cId || 0,
    sectionId: px.sId || 0,
    fixtureId: px.fId || 0,
    viewMask: px.vMask || 0,
    fixtureTypeId: fixtureTypeId(px.fixtureType),
    pixelLocalIndex: localIndices[i],
    viewMaskHi: px.vMaskHi || 0, // lane 6 — Tier-C high view word (views 31..61)
  }));

  return {
    pixelCount: mod.pixelCount ?? mod.pixels.length,
    pixels: mod.pixels,
    groupBits,
    viewMasks,
    metaArray,
    fixtureConstants,
  };
}

// Bitwise-OR of every pixel's resolved viewMask — the set of bits the
// model already occupies. Phase 2 uses this to place fixture-type bits
// above the used range.
export function pixelsUsedMask(pixels) {
  let used = 0;
  for (const px of pixels) {
    if (px && Number.isInteger(px.vMask)) used |= px.vMask;
  }
  return used;
}
