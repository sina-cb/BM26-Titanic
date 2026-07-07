// strand_views.js — derive host-side (Tier-A) view masks for LED strands.
//
// LED-strand parity (report 20260618_6 §D.5) gives the operator the same
// view targeting on strands that DMX fixtures already have: one view per
// strand `group`, plus LEFT / RIGHT composites grouped by the strand
// group-name prefix. These are TIER-A masks — pure per-pixel membership,
// ZERO viewMask-bit cost (report 20260618_2 §3.3) — so they never compete
// with a model's group-bit budget (titanic already spends 28 of 31 bits).
//
// They are emitted as viewMask-shaped entries ({ name, groups:[...],
// bit:0 }) so the existing buildMaskRegistry path interns them with
// members computed from the same group-name match the rest of the engine
// uses. A per-strand entry whose name already equals a base group is
// dropped here (the base group already owns that name in the registry).
//
// Left/Right derivation uses the GROUP-NAME PREFIX (robust to model
// re-centring), with an x-sign fallback ONLY for strands lacking the
// Left_/Right_ convention — and that fallback is logged loudly.

// A strand is a pixel exported with type 'led' (FIX_RAW_LED). We key off
// that so DMX fixture groups never leak into LEFT/RIGHT.
function isStrandPixel(px) {
  return !!px && px.type === 'led';
}

// Left_*/Small_Left_* → 'left'; Right_*/Small_Right_* → 'right'; else null.
function sideFromGroupName(name) {
  if (typeof name !== 'string') return null;
  if (/^(Small_)?Left_/.test(name) || /^Left[ _]/.test(name)) return 'left';
  if (/^(Small_)?Right_/.test(name) || /^Right[ _]/.test(name)) return 'right';
  return null;
}

/**
 * Derive the strand view entries for a model's pixels.
 *
 * @param {Array} pixels - resolved model pixels (each with type/group/x)
 * @param {Set<string>} existingMaskNames - names already owned by base
 *        groups / declared presets, to avoid duplicate registration
 * @returns {{ entries: Array<{name,groups?,pixelIndices?,bit:number,_strandView:boolean}>,
 *            perStrand: string[], left: string[], right: string[], warnings: string[] }}
 */
export function deriveStrandViews(pixels, existingMaskNames = new Set()) {
  const entries = [];
  const warnings = [];
  const perStrand = [];

  // Collect distinct strand groups (in first-appearance order) and the
  // pixel indices each side owns.
  const strandGroups = [];
  const seenGroup = new Set();
  const leftIdx = [];
  const rightIdx = [];
  const leftGroups = new Set();
  const rightGroups = new Set();

  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!isStrandPixel(px)) continue;
    const group = typeof px.group === 'string' ? px.group : '';
    if (group.length > 0 && !seenGroup.has(group)) {
      seenGroup.add(group);
      strandGroups.push(group);
    }
    // Side: group-name prefix first; x-sign fallback (loud) otherwise.
    let side = sideFromGroupName(group);
    if (side === null) {
      const x = Number(px.x);
      if (Number.isFinite(x) && x !== 0) {
        side = x < 0 ? 'left' : 'right';
        warnings.push(`strand pixel ${i} (group '${group}') has no Left_/Right_ prefix — ` +
          `assigned ${side.toUpperCase()} from x-sign (${x}); rename the group to make it robust`);
      }
    }
    if (side === 'left') {
      leftIdx.push(i);
      if (group) leftGroups.add(group);
    } else if (side === 'right') {
      rightIdx.push(i);
      if (group) rightGroups.add(group);
    }
  }

  // One Tier-A view per strand group (skip names a base group/preset owns).
  for (const group of strandGroups) {
    if (existingMaskNames.has(group)) continue;
    entries.push({ name: group, groups: [group], bit: 0, _strandView: true });
    perStrand.push(group);
  }

  // LEFT / RIGHT composites (only when that side has strands). Built from
  // pixelIndices so the x-sign fallback members survive even if a strand
  // group name didn't match a prefix.
  if (leftIdx.length > 0 && !existingMaskNames.has('LEFT')) {
    entries.push({ name: 'LEFT', pixelIndices: leftIdx, bit: 0, _strandView: true });
  }
  if (rightIdx.length > 0 && !existingMaskNames.has('RIGHT')) {
    entries.push({ name: 'RIGHT', pixelIndices: rightIdx, bit: 0, _strandView: true });
  }

  return {
    entries,
    perStrand,
    left: [...leftGroups],
    right: [...rightGroups],
    warnings,
  };
}
