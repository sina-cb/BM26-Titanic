// view_word.js — the two-word view-mask bit-slot scheme (Tier C).
//
// A view mask reaches the VM as a per-pixel bit. Historically there was
// ONE word — a single Int32 `viewMask` — so a model supported at most 31
// in-VM masks (bits 0..30; bit 31 is unsafe across the JS↔WASM signed
// Int32 coercion). Report 20260618_2 §3.3 Tier C lifts that ceiling by
// adding a SECOND word, `viewMaskHi`, giving 62 in-VM masks total:
//
//   slot 0..30   → word 0 (`viewMask`),    bit 1<<slot
//   slot 31..61  → word 1 (`viewMaskHi`),  bit 1<<(slot-31)
//
// So each in-VM mask owns a global slot 0..61 that maps to a (word, bit)
// pair, where `bit` is ALWAYS a power of two ≤ 0x40000000 WITHIN its
// word. Word 0 is byte-for-byte the old scheme — the first 31 masks land
// exactly where they did before (back-compat), and only the 32nd+ spills
// into `viewMaskHi`. Past slot 61 the allocator throws LOUDLY (codex P0 —
// no fallback, no silent wrap into a negative bit).

// Highest safe per-word bit: bit 30. bit 31 (0x80000000) ORs in a
// NEGATIVE value via Int32 coercion, so it is never handed out.
export const MAX_WORD_BIT = 0x40000000;

// Slots per word (bits 0..30) and the total across both words.
export const SLOTS_PER_WORD = 31;
export const MAX_VIEW_SLOTS = SLOTS_PER_WORD * 2; // 62

/**
 * Map a global slot (0..61) to its (word, bit) pair.
 * @param {number} slot 0..61
 * @returns {{ word: 0|1, bit: number }}
 */
export function slotToWordBit(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_VIEW_SLOTS) {
    throw new Error(`view-mask slot ${slot} out of range — a model supports at most ` +
      `${MAX_VIEW_SLOTS} in-VM view-mask bits (two words: viewMask + viewMaskHi)`);
  }
  const word = slot < SLOTS_PER_WORD ? 0 : 1;
  const bit = 1 << (slot % SLOTS_PER_WORD);
  return { word, bit };
}

/**
 * A per-word power-of-two bit check (both words share the same 0..30
 * range, so the check is identical to the legacy single-word one).
 */
export function isPowerOfTwoBit(bit) {
  return Number.isInteger(bit) && bit > 0 && bit <= MAX_WORD_BIT && (bit & (bit - 1)) === 0;
}

/**
 * A small two-word bit allocator. `claim(word, bit)` reserves a specific
 * bit in a word (for explicitly-pinned sidecar masks); `next()` hands out
 * the lowest free slot, preferring word 0 so the first 31 masks stay
 * byte-identical to the legacy single-word layout. Past 62 it throws.
 */
export class ViewBitAllocator {
  constructor() {
    // used[0] = OR of reserved bits in viewMask, used[1] = in viewMaskHi.
    this.used = [0, 0];
  }

  /** Is this (word, bit) already taken? */
  isUsed(word, bit) {
    return (this.used[word] & bit) !== 0;
  }

  /**
   * Reserve a specific (word, bit). Throws on a reused bit so a sidecar
   * that pins two masks to the same slot fails loudly (codex P0).
   */
  claim(word, bit, label = 'mask') {
    if (word !== 0 && word !== 1) {
      throw new Error(`${label}: view word must be 0 or 1, got ${word}`);
    }
    if (!isPowerOfTwoBit(bit)) {
      throw new Error(`${label}: bit must be a power of two ≤ 0x${MAX_WORD_BIT.toString(16)}, got ${bit}`);
    }
    if (this.isUsed(word, bit)) {
      throw new Error(`${label}: reuses view word ${word} bit 0x${bit.toString(16)}`);
    }
    this.used[word] |= bit;
    return { word, bit };
  }

  /**
   * Hand out the lowest free slot as a (word, bit) pair, filling word 0
   * before word 1 (legacy-compatible ordering). Throws past slot 61.
   */
  next(label = 'mask') {
    for (let slot = 0; slot < MAX_VIEW_SLOTS; slot++) {
      const { word, bit } = slotToWordBit(slot);
      if (!this.isUsed(word, bit)) {
        this.used[word] |= bit;
        return { word, bit };
      }
    }
    throw new Error(`Out of view-mask bits assigning ${label} — a model supports at most ` +
      `${MAX_VIEW_SLOTS} in-VM view-mask bits (viewMask + viewMaskHi). Free a mask or move ` +
      `host-only selections off the in-VM bit cache.`);
  }
}
