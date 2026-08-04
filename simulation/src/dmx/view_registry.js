/**
 * view_registry.js — scene-owned view-mask registry.
 *
 * The simulation is the source of truth for the group→bit contract and
 * for named custom views (docs/13 §4.5). This registry lives in the
 * scene's `views.yaml`, rides the config tree through save/load, and is
 * exported to `marsin_engine/models/<scene>.viewmasks.js` together with
 * the model so the sidecar can never go stale relative to the pixels.
 *
 * Shape (mirrors views.yaml):
 *   {
 *     groupBits: { '<group name>': <power-of-two bit>, ... },
 *     custom: [ { name, bit, groups: ['<group>', ...] }, ... ],
 *   }
 *
 * Base group views are auto-managed: `reconcileGroupBits` keeps existing
 * assignments stable across saves, assigns the lowest free bit to new
 * groups, and drops groups that left the scene. Custom views hold an
 * explicit single bit (reserved against group assignment) and define
 * membership by group names and/or per-fixture view-mask bits.
 *
 * PER-FIXTURE MEMBERSHIP IS TWO-WORD. A fixture/strand config carries one
 * mask field PER VIEW WORD — `viewMask` (word 0) and `viewMaskHi` (word 1) —
 * and a view's bit is only ever read from/written to the field of its OWN
 * word. The exporter mirrors the pair onto every pixel as `vMask` / `vMaskHi`
 * (the lane names `engine.js` and the WASM meta ABI use), so a word-1 view
 * populated by clicking fixtures resolves exactly like a word-0 one.
 * `fixtureMaskField` / `pixelMaskField` are the ONLY places that mapping is
 * written down — never index the fields by hand.
 *
 * vMask is Int32 across the WASM boundary — bit 30 (0x40000000) is the
 * highest safe bit, 31 bits per word. Tier-C (ABI 20260619_1) adds a
 * SECOND view word `viewMaskHi`, lifting the ceiling 31 → 62: views 0..30
 * live in word 0 (`viewMask`, bit 1<<view), views 31..61 in word 1
 * (`viewMaskHi`, bit 1<<(view-31)).
 *
 * ALLOCATION POLICY (word 0 is reserved for base groups). Base group bits
 * can ONLY live in word 0 — that is a hard constraint here
 * (`reconcileGroupBits` → `nextFreeBit`) and mirrored in the engine's
 * `assignGroupBits`. Custom views work identically in either word (they
 * resolve by NAME at model load), so word 0 is the scarce single-consumer
 * resource and word 1 is the abundant one. `nextFreeSlot` therefore fills
 * word 1 FIRST for custom views and only spills into word 0 once word 1 is
 * full — the total capacity stays 62 while base groups keep maximum
 * headroom. Running out of all 62 slots throws (no fallbacks — codex P0).
 *
 * Allocation policy applies to NEW slots only: every already-pinned
 * (word, bit) in views.yaml is preserved verbatim by `createViewRegistry`,
 * so changing the policy never renumbers an existing scene.
 */

export const MAX_BIT = 0x40000000;

// Two-word scheme: 31 usable bits per word (bits 0..30), 62 total.
export const SLOTS_PER_WORD = 31;
export const MAX_VIEW_SLOTS = SLOTS_PER_WORD * 2; // 62

/**
 * Word-preference order for NEW custom-view allocations. Word 1 first:
 * base groups are hard-pinned to word 0, custom views are word-agnostic,
 * so spending word 0 on a view starves the only consumer that cannot go
 * anywhere else. Word 0 stays in the list as the spill target so total
 * capacity is still MAX_VIEW_SLOTS.
 */
export const CUSTOM_VIEW_WORD_ORDER = [1, 0];

/**
 * Effects-only fixture types (foggers/hazers/horns/fire) never become
 * pixels — the exporter routes them to the `.effects.js` companion —
 * so they neither consume view bits nor participate in view isolation.
 * Mirrors the exporter's routing predicate; configs may carry the type
 * under `type` or `fixtureType` depending on origin.
 */
export function isEffectsOnlyFixture(config) {
  const t = String((config && (config.type || config.fixtureType)) || '');
  return t.includes('Fog') || t === 'ChauvetHaze4D' || t.includes('Horn') || t.includes('Fire');
}

export function isPowerOfTwoBit(bit) {
  return Number.isInteger(bit) && bit > 0 && bit <= MAX_BIT && (bit & (bit - 1)) === 0;
}

/**
 * Normalize a parsed views.yaml tree (or undefined) into a registry.
 * THROWS on any invalid entry instead of skipping it: an entry dropped
 * here would be silently deleted from views.yaml on the next save and
 * its bit re-assigned — destroying the group→bit contract patterns
 * compile against. A missing tree (new scene) is fine; a broken one is
 * a hard stop (codex P0: fail loudly, no fallbacks).
 */
export function createViewRegistry(viewsTree) {
  const src = (viewsTree && typeof viewsTree === 'object') ? viewsTree : {};
  const registry = { groupBits: {}, custom: [] };

  if (src.groupBits && typeof src.groupBits === 'object') {
    for (const [group, bit] of Object.entries(src.groupBits)) {
      if (!isPowerOfTwoBit(bit)) {
        throw new Error(`[Views] Invalid groupBits['${group}'] = ${bit} in views.yaml — ` +
          `must be a power of two between 0x1 and 0x${MAX_BIT.toString(16)}`);
      }
      registry.groupBits[group] = bit;
    }
  }
  if (Array.isArray(src.custom)) {
    for (const v of src.custom) {
      if (!v || typeof v.name !== 'string' || v.name.length === 0 || !isPowerOfTwoBit(v.bit)) {
        throw new Error(`[Views] Invalid custom view in views.yaml: ${JSON.stringify(v)} — ` +
          `needs a non-empty name and a power-of-two bit ≤ 0x${MAX_BIT.toString(16)}`);
      }
      // word: 0 (legacy `viewMask`) or 1 (`viewMaskHi`). Absent ⇒ 0 for
      // back-compat with pre-Tier-C views.yaml files.
      if (v.word !== undefined && v.word !== 0 && v.word !== 1) {
        throw new Error(`[Views] Invalid custom view '${v.name}' in views.yaml: word must be 0 or 1, ` +
          `got ${v.word}`);
      }
      registry.custom.push({
        name: v.name,
        bit: v.bit,
        word: v.word === 1 ? 1 : 0,
        groups: Array.isArray(v.groups) ? v.groups.filter(g => typeof g === 'string' && g.length > 0) : [],
      });
    }
  }
  return registry;
}

/** The view word a custom view lives in (default 0 — legacy). */
export function viewWord(v) {
  return v && v.word === 1 ? 1 : 0;
}

/**
 * The two per-word mask fields, indexed BY WORD. Fixture/strand configs use
 * the long names (they ride views.yaml-adjacent scene state: patches.yaml for
 * DMX fixtures, scene_config.yaml for LED things); exported pixels use the
 * abbreviated lane names the engine and the WASM meta ABI read.
 */
export const FIXTURE_MASK_FIELDS = ['viewMask', 'viewMaskHi'];
export const PIXEL_MASK_FIELDS = ['vMask', 'vMaskHi'];

/** Config field carrying per-fixture membership for `view`'s word. */
export function fixtureMaskField(view) {
  return FIXTURE_MASK_FIELDS[viewWord(view)];
}

/** Exported-pixel field carrying per-fixture membership for `view`'s word. */
export function pixelMaskField(view) {
  return PIXEL_MASK_FIELDS[viewWord(view)];
}

/**
 * True when a fixture/strand config carries `view`'s bit — read from the
 * view's OWN word. Word 0 and word 1 are independent bit spaces, so testing
 * a word-1 view against `viewMask` would both miss its real members and
 * falsely match whatever group bit happens to share the value.
 */
export function fixtureInView(config, view) {
  if (!config || !view) return false;
  return ((config[fixtureMaskField(view)] || 0) & view.bit) !== 0;
}

/** Same test against an EXPORTED PIXEL (`vMask` / `vMaskHi`). */
export function pixelInView(pixel, view) {
  if (!pixel || !view) return false;
  return ((pixel[pixelMaskField(view)] || 0) & view.bit) !== 0;
}

/** Add (`member`) or remove `view`'s bit on a config, in the view's word. */
export function setFixtureInView(config, view, member) {
  if (!config || !view) return;
  const field = fixtureMaskField(view);
  const cur = config[field] || 0;
  config[field] = member ? (cur | view.bit) : (cur & ~view.bit);
}

/**
 * Bits taken in a given word: word 0 = group bits + word-0 custom views;
 * word 1 = word-1 custom views only (groups are always word 0).
 */
export function usedBitsMask(registry, word = 0) {
  let mask = 0;
  if (word === 0) {
    for (const bit of Object.values(registry.groupBits)) mask |= bit;
  }
  for (const v of registry.custom) {
    if (viewWord(v) === word) mask |= v.bit;
  }
  return mask;
}

/**
 * Lowest free power-of-two bit in word 0, or 0 when all 31 are taken.
 * Kept for back-compat (group reconciliation and word-0 callers).
 */
export function nextFreeBit(registry) {
  const used = usedBitsMask(registry, 0);
  for (let bit = 1; bit <= MAX_BIT; bit *= 2) {
    if ((used & bit) === 0) return bit;
  }
  return 0;
}

/**
 * Lowest free (word, bit) slot for a NEW custom view, walking the words in
 * `CUSTOM_VIEW_WORD_ORDER` — word 1 (`viewMaskHi`) first, word 0 (legacy
 * `viewMask`) only as the spill target. Word 0 is the sole home of base
 * group bits, so leaving it to the groups is what keeps a scene able to
 * grow fixtures. Returns null when all 62 slots are taken (caller throws
 * loudly — codex P0, no silent degradation).
 *
 * @param {object} registry view registry
 * @param {number[]} wordOrder words to try, in preference order
 * @returns {{word: number, bit: number}|null}
 */
export function nextFreeSlot(registry, wordOrder = CUSTOM_VIEW_WORD_ORDER) {
  for (const word of wordOrder) {
    const used = usedBitsMask(registry, word);
    for (let bit = 1; bit <= MAX_BIT; bit *= 2) {
      if ((used & bit) === 0) return { word, bit };
    }
  }
  return null;
}

/**
 * Free-slot counts per word, for operator-facing budget readouts. Word 0's
 * free count IS the base-group headroom (how many new fixture groups the
 * scene can still take); word 1's is custom-view headroom.
 */
export function freeSlotCounts(registry) {
  const countFree = (word) => {
    const used = usedBitsMask(registry, word);
    let free = 0;
    for (let bit = 1; bit <= MAX_BIT; bit *= 2) {
      if ((used & bit) === 0) free++;
    }
    return free;
  };
  return { word0: countFree(0), word1: countFree(1) };
}

/**
 * Distinct non-empty group names from exported pixels, in
 * first-appearance order. Pixels — not fixture configs — are the
 * ground truth: effects-only fixtures (foggers, horns) never become
 * pixels and must not consume bits, while LED strands DO become
 * pixels (their name is their group) and must get bits. The
 * engine validates groupBits against exactly this set.
 */
export function listPixelGroups(pixels) {
  const seen = new Set();
  for (const p of pixels || []) {
    if (p && typeof p.group === 'string' && p.group.length > 0) seen.add(p.group);
  }
  return [...seen];
}

/**
 * Sync registry.groupBits with the scene's actual pixel groups.
 * Existing assignments are never renumbered; new groups get the lowest
 * free bit; groups that left the scene are dropped (their bit frees
 * up). Mutates the registry in place (it is the live configTree.views
 * object) and returns { added, removed } for logging/UI.
 */
export function reconcileGroupBits(registry, groups) {
  const groupSet = new Set(groups);

  const removed = Object.keys(registry.groupBits).filter(g => !groupSet.has(g));
  for (const g of removed) delete registry.groupBits[g];

  const added = [];
  for (const g of groups) {
    if (registry.groupBits[g] !== undefined) continue;
    const bit = nextFreeBit(registry);
    if (bit === 0) {
      throw new Error(`[Views] Out of view-mask bits while assigning group '${g}' — ` +
        `base group bits live in word 0 only, which holds at most ${SLOTS_PER_WORD} bits and is ` +
        `full. (The scene as a whole supports ${MAX_VIEW_SLOTS} slots; the rest are word-1 ` +
        `custom-view slots, which groups cannot use.) Free a word-0 bit by moving a custom view ` +
        `to word 1 or by removing an unused group.`);
    }
    registry.groupBits[g] = bit;
    added.push(g);
  }
  if (added.length > 0 || removed.length > 0) {
    console.log(`[Views] Group bits reconciled (+${added.length} −${removed.length}):`,
      { added, removed });
  }
  return { added, removed };
}

/** Transfer a group's bit across a rename so patterns stay stable. */
export function renameGroup(registry, oldName, newName) {
  if (registry.groupBits[oldName] === undefined || oldName === newName) return;
  if (registry.groupBits[newName] !== undefined) {
    // Merge into an existing group: the old bit is simply freed.
    delete registry.groupBits[oldName];
  } else {
    registry.groupBits[newName] = registry.groupBits[oldName];
    delete registry.groupBits[oldName];
  }
  // Rewrite custom-view references in BOTH branches — a view left
  // pointing at the vanished old name would export a sidecar the
  // engine refuses to load (unknown group).
  for (const v of registry.custom) {
    const i = v.groups.indexOf(oldName);
    if (i < 0) continue;
    if (v.groups.includes(newName)) v.groups.splice(i, 1);
    else v.groups[i] = newName;
  }
}

// Mirror of maskConstantName() in marsin_engine/lib/view_mask_constants.js
// (keep in sync): the MASK_* constant a name compiles to in pattern code.
// Duplicated because the browser bundle must work offline/static-hosted
// without reaching into the engine package; the engine re-validates at
// model load as the backstop.
export function viewConstantName(name) {
  const body = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (body.length === 0) {
    throw new Error(`[Views] Name '${name}' sanitizes to an empty MASK_* constant`);
  }
  return `MASK_${body}`;
}

// Names feed three generated artifacts (views.yaml, the sidecar JS, and
// injected MASK_* constants), so the charset is locked down here — at
// creation/rename time, where a rejection costs one retype — instead of
// at engine load, where it costs a dead model on playa.
const VIEW_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

/**
 * Validate a custom-view name: charset, uniqueness, and MASK_* constant
 * collisions against groups and other views (two names that sanitize to
 * the same constant would make pattern code ambiguous — the engine
 * throws on it at load). Throws with an operator-readable message.
 */
export function validateViewName(registry, name, excludeView = null) {
  if (!VIEW_NAME_RE.test(name)) {
    throw new Error(`[Views] Invalid view name '${name}' — use letters, digits, spaces, ` +
      `underscores or dashes, starting with a letter or digit`);
  }
  if (registry.custom.some(v => v !== excludeView && v.name === name)) {
    throw new Error(`[Views] A view named '${name}' already exists`);
  }
  const constName = viewConstantName(name);
  for (const g of Object.keys(registry.groupBits)) {
    if (viewConstantName(g) === constName) {
      throw new Error(`[Views] View name '${name}' collides with group '${g}' — ` +
        `both become the pattern constant ${constName}`);
    }
  }
  for (const v of registry.custom) {
    if (v !== excludeView && viewConstantName(v.name) === constName) {
      throw new Error(`[Views] View name '${name}' collides with view '${v.name}' — ` +
        `both become the pattern constant ${constName}`);
    }
  }
}

/**
 * Create a custom view with the lowest free (word, bit) slot under the
 * group-headroom policy: word 1 (`viewMaskHi`) first, word 0 (`viewMask`)
 * only once word 1 is full. Throws on an invalid or colliding name and on
 * slot exhaustion (all 62 taken) — a view that can't get a slot must not
 * be half-created.
 */
export function addCustomView(registry, name) {
  const trimmed = String(name || '').trim();
  if (trimmed.length === 0) throw new Error('[Views] View name must not be empty');
  validateViewName(registry, trimmed);
  const slot = nextFreeSlot(registry);
  if (slot === null) {
    throw new Error(`[Views] Out of view-mask slots — a scene supports at most ${MAX_VIEW_SLOTS} ` +
      `distinct group/view slots across both words (viewMask + viewMaskHi)`);
  }
  const view = { name: trimmed, bit: slot.bit, word: slot.word, groups: [] };
  registry.custom.push(view);
  return view;
}

/**
 * Relocate a custom view to an explicit (word, bit) slot — the canonical
 * way to free word-0 group headroom by moving views into `viewMaskHi`.
 *
 * CROSS-WORD MOVES MIGRATE PER-FIXTURE MEMBERSHIP, ATOMICALLY. Since fixture
 * configs carry BOTH words (`viewMask` + `viewMaskHi`), a per-fixture view is
 * no longer stuck in word 0 — but its bits must move WITH it or the scene
 * corrupts two ways at once: the view exports empty from its new word, and
 * the bit left behind in the old word aliases whatever group/view owns that
 * value there (in word 0 that is a base group bit, so the orphaned fixture
 * would silently join that group's view). So `fixtures` — the scene's
 * complete fixture + strand config list — is REQUIRED for every cross-word
 * move and the migration happens inside this call. Omitting it throws; it is
 * never assumed empty (codex P0 — no silent skip).
 *
 * Same-word moves do NOT touch fixtures: the bit changes but the word does
 * not, and `setCustomViewBit`'s callers already migrate from the returned
 * old bit. That contract is unchanged.
 *
 * @param {object} registry view registry
 * @param {object} view the custom view to relocate
 * @param {number} newWord 0 or 1
 * @param {number} newBit power-of-two bit within `newWord`
 * @param {Array<object>|null} fixtures every fixture/strand config in the
 *   scene — required when `newWord` differs from the view's current word
 * @returns {{word: number, bit: number}} the previous slot
 */
export function setCustomViewSlot(registry, view, newWord, newBit, fixtures = null) {
  if (newWord !== 0 && newWord !== 1) {
    throw new Error(`[Views] View word must be 0 or 1, got ${newWord}`);
  }
  if (!isPowerOfTwoBit(newBit)) {
    throw new Error(`[Views] Bit must be a power of two between 0x1 and 0x${MAX_BIT.toString(16)}`);
  }
  const oldWord = viewWord(view);
  const oldBit = view.bit;
  if (newWord === oldWord && newBit === oldBit) return { word: oldWord, bit: oldBit };
  const crossWord = newWord !== oldWord;
  if (crossWord && !Array.isArray(fixtures)) {
    throw new Error(`[Views] Moving view '${view.name}' from word ${oldWord} to word ${newWord} ` +
      `must migrate its per-fixture membership between the '${FIXTURE_MASK_FIELDS[oldWord]}' and ` +
      `'${FIXTURE_MASK_FIELDS[newWord]}' fields — pass the scene's fixture + strand config list as ` +
      `the 5th argument. Refusing to move the view and strand its members.`);
  }
  // Collision is checked WITHIN the destination word (word 0 and word 1 are
  // independent bit spaces); the view's own current bit only excuses a
  // collision when it is staying in the same word.
  const selfBit = crossWord ? 0 : oldBit;
  if ((usedBitsMask(registry, newWord) & ~selfBit & newBit) !== 0) {
    throw new Error(`[Views] Bit 0x${newBit.toString(16)} is already taken by another group or view ` +
      `in word ${newWord}`);
  }
  if (crossWord) {
    const oldField = FIXTURE_MASK_FIELDS[oldWord];
    const newField = FIXTURE_MASK_FIELDS[newWord];
    for (const config of fixtures) {
      if (!config || ((config[oldField] || 0) & oldBit) === 0) continue;
      config[oldField] = (config[oldField] || 0) & ~oldBit;
      config[newField] = (config[newField] || 0) | newBit;
    }
  }
  view.word = newWord;
  view.bit = newBit;
  return { word: oldWord, bit: oldBit };
}

/**
 * Change a custom view's bit within its current word. Validates
 * power-of-two and collisions. Returns the old bit so the caller can
 * migrate per-fixture masks.
 */
export function setCustomViewBit(registry, view, newBit) {
  return setCustomViewSlot(registry, view, viewWord(view), newBit).bit;
}

export function removeCustomView(registry, view) {
  const i = registry.custom.indexOf(view);
  if (i >= 0) registry.custom.splice(i, 1);
}

// Escape a name for a single-quoted JS string literal in the generated
// sidecar. Backslashes first, then quotes, then any stray newlines —
// an unescaped one of any of these yields a sidecar the engine cannot
// even import.
function jsStr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
}

/**
 * Render the engine sidecar (`<scene>.viewmasks.js`) from the registry
 * and the exported pixels. Custom views are emitted with their explicit
 * bit and membership: `groups` when the view is group-based, otherwise
 * the pixel indices whose vMask carries the bit. Views with no members
 * at all are skipped (the engine rejects empty presets) and logged.
 * THROWS when a view references a group absent from `groupBits` (i.e.
 * a group with no pixels in this export) — the engine would refuse the
 * whole model at load, so the export must fail here, loudly, instead.
 */
export function buildViewmasksSidecarJS(registry, pixels, sceneName) {
  const lines = [
    `// Auto-generated view-mask sidecar for the ${sceneName} model — do not edit manually.`,
    '// Source of truth: the simulation scene (Views panel → scenes/' + sceneName + '/views.yaml).',
    '// Updated: ' + new Date().toISOString(),
    '//',
    '// `groupBits` pins the base group → bit contract pattern code compiles',
    '// against; the engine validates it against the loaded model and fails',
    '// loudly on drift (docs/13 §4.5.1).',
    '',
    'export const groupBits = {',
  ];
  for (const [group, bit] of Object.entries(registry.groupBits)) {
    lines.push(`  '${jsStr(group)}': 0x${bit.toString(16).padStart(8, '0')},`);
  }
  lines.push('};');
  lines.push('');
  lines.push('export const viewMasks = [');

  for (const view of registry.custom) {
    const safeName = jsStr(view.name);
    // word:1 views land in `viewMaskHi`; emit `word: 1` so the engine
    // routes the bit into the high word (lane 6) and the named-mask
    // injector inlines it as `(viewMaskHi & <literal>)`. word:0 stays the
    // legacy form (no `word` key) so pre-Tier-C sidecars are byte-identical.
    const wordField = view.word === 1 ? ', word: 1' : '';
    if (view.groups.length > 0) {
      for (const g of view.groups) {
        if (registry.groupBits[g] === undefined) {
          throw new Error(`[Views] Custom view '${view.name}' references group '${g}', which has ` +
            `no pixels in the exported model — the engine would refuse to load this sidecar. ` +
            `Remove the group from the view in the Views panel, or restore fixtures to that group.`);
        }
      }
      const groupList = view.groups.map(g => `'${jsStr(g)}'`).join(', ');
      lines.push(`  { name: '${safeName}', bit: 0x${view.bit.toString(16).padStart(4, '0')}${wordField}, groups: [${groupList}] },`);
      continue;
    }
    // Per-fixture membership: read the pixel field of the view's OWN word
    // (`vMask` for word 0, `vMaskHi` for word 1). The exporter carries both
    // words onto every pixel, so a word-1 view finds its clicked fixtures.
    const memberIndices = [];
    (pixels || []).forEach((p, i) => {
      if (pixelInView(p, view)) memberIndices.push(i);
    });
    if (memberIndices.length === 0) {
      console.warn(`[Views] Custom view '${view.name}' has no members — skipped in sidecar export. ` +
        'Assign fixtures or groups to it in the Views panel.');
      continue;
    }
    lines.push(`  { name: '${safeName}', bit: 0x${view.bit.toString(16).padStart(4, '0')}${wordField}, pixelIndices: [${memberIndices.join(', ')}] },`);
  }

  lines.push('];');
  lines.push('');
  return lines.join('\n');
}
