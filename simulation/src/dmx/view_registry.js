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
 * membership by group names and/or per-fixture viewMask bits (the
 * fixture's `viewMask` field in patches.yaml carries custom-view bits).
 *
 * vMask is Int32 across the WASM boundary — bit 30 (0x40000000) is the
 * highest safe bit, 31 bits total. Running out throws (no fallbacks).
 */

export const MAX_BIT = 0x40000000;

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
      registry.custom.push({
        name: v.name,
        bit: v.bit,
        groups: Array.isArray(v.groups) ? v.groups.filter(g => typeof g === 'string' && g.length > 0) : [],
      });
    }
  }
  return registry;
}

/** Every bit currently taken (groups + custom views). */
export function usedBitsMask(registry) {
  let mask = 0;
  for (const bit of Object.values(registry.groupBits)) mask |= bit;
  for (const v of registry.custom) mask |= v.bit;
  return mask;
}

/** Lowest free power-of-two bit, or 0 when all 31 are taken. */
export function nextFreeBit(registry) {
  const used = usedBitsMask(registry);
  for (let bit = 1; bit <= MAX_BIT; bit *= 2) {
    if ((used & bit) === 0) return bit;
  }
  return 0;
}

/**
 * Distinct non-empty group names from exported pixels, in
 * first-appearance order. Pixels — not fixture configs — are the
 * ground truth: effects-only fixtures (foggers, horns) never become
 * pixels and must not consume bits, while LED strands and icebergs DO
 * become pixels (their name is their group) and must get bits. The
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
        `a scene supports at most 31 distinct group/view bits`);
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
 * Create a custom view with the lowest free bit. Throws on an invalid
 * or colliding name and on bit exhaustion — a view that can't get a
 * bit must not be half-created.
 */
export function addCustomView(registry, name) {
  const trimmed = String(name || '').trim();
  if (trimmed.length === 0) throw new Error('[Views] View name must not be empty');
  validateViewName(registry, trimmed);
  const bit = nextFreeBit(registry);
  if (bit === 0) {
    throw new Error('[Views] Out of view-mask bits — a scene supports at most 31 distinct group/view bits');
  }
  const view = { name: trimmed, bit, groups: [] };
  registry.custom.push(view);
  return view;
}

/**
 * Change a custom view's bit. Validates power-of-two and collisions.
 * Returns the old bit so the caller can migrate per-fixture masks.
 */
export function setCustomViewBit(registry, view, newBit) {
  if (!isPowerOfTwoBit(newBit)) {
    throw new Error(`[Views] Bit must be a power of two between 0x1 and 0x${MAX_BIT.toString(16)}`);
  }
  const oldBit = view.bit;
  if (newBit === oldBit) return oldBit;
  if ((usedBitsMask(registry) & ~oldBit & newBit) !== 0) {
    throw new Error(`[Views] Bit 0x${newBit.toString(16)} is already taken by another group or view`);
  }
  view.bit = newBit;
  return oldBit;
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
    if (view.groups.length > 0) {
      for (const g of view.groups) {
        if (registry.groupBits[g] === undefined) {
          throw new Error(`[Views] Custom view '${view.name}' references group '${g}', which has ` +
            `no pixels in the exported model — the engine would refuse to load this sidecar. ` +
            `Remove the group from the view in the Views panel, or restore fixtures to that group.`);
        }
      }
      const groupList = view.groups.map(g => `'${jsStr(g)}'`).join(', ');
      lines.push(`  { name: '${safeName}', bit: 0x${view.bit.toString(16).padStart(4, '0')}, groups: [${groupList}] },`);
      continue;
    }
    const memberIndices = [];
    (pixels || []).forEach((p, i) => {
      if (p && ((p.vMask || 0) & view.bit) !== 0) memberIndices.push(i);
    });
    if (memberIndices.length === 0) {
      console.warn(`[Views] Custom view '${view.name}' has no members — skipped in sidecar export. ` +
        'Assign fixtures or groups to it in the Views panel.');
      continue;
    }
    lines.push(`  { name: '${safeName}', bit: 0x${view.bit.toString(16).padStart(4, '0')}, pixelIndices: [${memberIndices.join(', ')}] },`);
  }

  lines.push('];');
  lines.push('');
  return lines.join('\n');
}
