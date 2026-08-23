// auto_views.js — derive the whole-ship host-side (Tier-A) view catalog.
//
// This GENERALIZES lib/strand_views.js (LED-strand-only LEFT/RIGHT +
// per-strand) into a whole-ship auto-view generator. Every entry it emits
// is a TIER-A mask: pure per-pixel membership, `bit:0`, ZERO viewMask-bit
// cost (report 20260618_2 §3.3). They ride the SAME `viewMasks` array the
// mixer's MaskRegistry (lib/mask_registry.js) consumes, so they become
// selectable by name through /model/view-selection-options `namedViews`
// for CaptainPad / the mixer WITHOUT ever touching the 31-bit (Tier-C: 62)
// in-VM budget. They are NOT for in-pattern `viewMask & MASK` reads —
// reserve in-VM bits for those.
//
// View families generated (all derived from metadata the model ALREADY
// carries — group names, fixtureType, and per-pixel world coords — so they
// can never go stale vs. the pixels, and need no exporter/WASM change):
//
//   Spatial whole-ship (report 20260804_145 — operator terminology):
//     LEFT / RIGHT       — EXHAUSTIVE halves from the pixel's world X.
//                          A Left_*/Right_* group token must AGREE with the
//                          x-sign; a disagreement THROWS.
//     FRONT / BACK       — Front/Back token in the group name.
//   Structural bands:
//     WALLS / DECKS / CHIMNEYS — group-name token.
//     AUDITORIUM               — PAR pixels in groups carrying the semantic
//                                `Auditorium` token, plus every FIX_TE_SIGN
//                                pixel. An Auditorium-named non-PAR throws.
//     NOTE: a structural band whose pixel set is byte-identical to an
//     already-authored view is RETIRED at registration in favour of the
//     authored name — operator ruling, report 20260804_148. That rule lives
//     in lib/view_catalog.js `appendAutoViews` (the shared engine+tools
//     path), NOT here, so this module stays a pure derivation of what the
//     model's metadata says exists. On titanic it drops WALLS (≡ the
//     authored `Hull Canvas`); on a scene with no authored twin the band
//     still registers.
//   Typed views (fixtureType → FIX_* role, report 20260618_1 §5.2):
//     one view per fixture ROLE present on the model. Roles the operator
//     named read as that name (`Strands`, `TE Signs`); the rest keep the
//     '@' prefix (`@PAR` / `@BAR` / `@VINTAGE`), which is RESERVED for
//     typed views (report 20260618_2 §4.1) so they never collide with an
//     authored or group name.
//   Per-controller (only once a model is patched, i.e. cId != 0):
//     CTRL_<cId> — every pixel on that controller, for strike/debug.
//
// REMOVED by operator ruling (report 20260804_145): PORT / STARBOARD (LEFT
// and RIGHT are the operator's terminology), FORE / AFT (renamed FRONT /
// BACK), the vertical BAND_LOW / BAND_MID / BAND_HIGH family, and the
// symmetric `<base>_BOTH` family — none of them earned their row in the
// operator's picker. They are hard-gone: selecting one now fails loudly as
// an unknown view, it does not resolve to something approximate.
//
// CODEX P0 — NO SILENT EMPTY MASKS. A family with zero members registers
// NOTHING (an empty mask that looks valid is a fallback). A genuine model
// CONTRADICTION (a group-prefix side that disagrees with the pixel's
// world-coord sign) THROWS loudly — that is a broken model, not a view to
// paper over.

import { fixtureTypeId, roleForId } from './fixture_type_constants.js';
import { deriveStrandViews } from './strand_views.js';

// '@' prefix reserved for typed (fixtureType) views that carry no operator
// name — never collides with an authored/group name (report 20260618_2 §4.1).
const TYPE_PREFIX = '@';

// Operator-facing names for fixture ROLES the operator named directly
// (report 20260804_145 §3). A role listed here takes its name VERBATIM
// instead of the '@'-prefixed stem, which means it no longer enjoys the
// '@' collision immunity — so `typedEntry` refuses loudly on a clash
// rather than silently dropping the view.
const TYPE_VIEW_NAMES = {
  FIX_RAW_LED: 'Strands',
  FIX_TE_SIGN: 'TE Signs',
};

// ── Token / side parsing ────────────────────────────────────────────────

// Left_*/Small_Left_*/'Left …' → 'left'; Right_* → 'right'; else null.
// Whole-ship (DMX + LED), unlike strand_views which gates on type==='led'.
function sideFromGroupName(name) {
  if (typeof name !== 'string') return null;
  if (/^(Small_)?Left_/.test(name) || /^Left[ _]/.test(name)) return 'left';
  if (/^(Small_)?Right_/.test(name) || /^Right[ _]/.test(name)) return 'right';
  return null;
}

// Front/back token in a group name. 'Front'→'front', 'Back'→'back', else null.
function frontBackFromGroupName(name) {
  if (typeof name !== 'string') return null;
  if (/(^|[ _])Front([ _]|$)/.test(name)) return 'front';
  if (/(^|[ _])Back([ _]|$)/.test(name)) return 'back';
  return null;
}

// Structural band token. One pixel can match exactly one structural band.
function bandFromGroupName(name) {
  if (typeof name !== 'string') return null;
  if (/(^|[ _])Wall([ _]|$)/.test(name)) return 'WALLS';
  if (/(^|[ _])Deck([ _]|$)/.test(name)) return 'DECKS';
  if (/(^|[ _])Chimney([ _]|$)/.test(name)) return 'CHIMNEYS';
  return null;
}

// The Titanic scene catalog names its physical auditorium PAR groups
// `Left Auditorium` and `Right Auditorium`. Match the semantic token (not
// the generic PAR role), so PARs assigned to smokestacks remain excluded.
function isAuditoriumGroupName(name) {
  return typeof name === 'string' && /(^|[ _])Auditorium([ _]|$)/.test(name);
}

// ── Entry helpers ───────────────────────────────────────────────────────

// A Tier-A entry from explicit pixel indices. Registers NOTHING (returns
// null) when the index list is empty — no silent empty mask (codex P0).
function indexEntry(name, indices, existing) {
  if (existing.has(name) || indices.length === 0) return null;
  return { name, pixelIndices: indices, bit: 0, _autoView: true };
}

// A typed (fixtureType) entry. Same as indexEntry EXCEPT that a name the
// operator chose (no '@' immunity) may not be silently skipped on a
// collision: two different masks under one operator-facing name is exactly
// the ambiguity the '@' prefix exists to prevent, so it throws.
function typedEntry(name, indices, existing, operatorNamed) {
  if (existing.has(name)) {
    if (!operatorNamed) return null;
    throw new Error(`deriveAutoViews: the fixture-type view '${name}' collides with an existing ` +
      `group or preset of the same name — one operator-facing name cannot mean two different ` +
      `pixel sets. Rename the group/preset, or the operator-facing type name in ` +
      `lib/auto_views.js TYPE_VIEW_NAMES.`);
  }
  if (indices.length === 0) return null;
  return { name, pixelIndices: indices, bit: 0, _autoView: true };
}

// A Tier-A entry from a union of base groups (membership computed by the
// MaskRegistry from group names). Empty group list → null.
function groupsEntry(name, groups, existing) {
  if (existing.has(name) || groups.length === 0) return null;
  return { name, groups: [...groups], bit: 0, _autoView: true };
}

/**
 * Derive the whole-ship auto-view catalog for a model's pixels.
 *
 * Keeps lib/strand_views.js behavior intact for the PER-STRAND entries by
 * composing it; LEFT/RIGHT are claimed here first (whole-ship halves) so
 * the strand-scoped versions never register. All entries are Tier-A
 * (`bit:0`).
 *
 * @param {Array} pixels - resolved model pixels (type/group/fixtureType/x/y/z/cId)
 * @param {Set<string>} existingMaskNames - names already owned by base
 *        groups / declared presets, to avoid duplicate registration
 * @returns {{ entries: Array, families: Object<string,string[]>, warnings: string[] }}
 */
export function deriveAutoViews(pixels, existingMaskNames = new Set()) {
  if (!Array.isArray(pixels)) {
    throw new Error('deriveAutoViews requires a pixels array');
  }
  const warnings = [];
  // `existing` grows as we register, so families never collide with each
  // other or with groups/presets the engine already declared.
  const existing = new Set(existingMaskNames);
  const entries = [];
  const families = {
    spatial: [],
    strand: [],
    structural: [],
    typed: [],
    controller: [],
  };

  const push = (entry, family) => {
    if (!entry) return;
    entries.push(entry);
    existing.add(entry.name);
    families[family].push(entry.name);
  };

  // ── 1. LEFT / RIGHT — EXHAUSTIVE whole-ship halves ────────────────────
  // The pixel's WORLD X is the assignment truth (physical/model truth, not
  // strand type, not fixture role): x < 0 ⇒ LEFT, x > 0 ⇒ RIGHT. A
  // Left_*/Right_* group token is a CROSS-CHECK, not the source: when it
  // disagrees with the geometry the model is broken and we throw (codex P0
  // — never silently pick a side for a fixture that spans the centerline).
  //
  // A pixel sitting EXACTLY on the centerline (x === 0) has no geometric
  // side. Its group-name token decides if it has one; otherwise it joins
  // NEITHER half and is reported loudly. That is the honest answer for a
  // centreline fixture — the halves stay exhaustive on every model whose
  // pixels are actually off-centre (titanic: 482 + 482 = 964).
  const leftIdx = [];
  const rightIdx = [];
  const unassigned = [];
  const controllerSides = new Map(); // cId → Set<'left'|'right'>
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!px) continue;
    const group = typeof px.group === 'string' ? px.group : '';
    const token = sideFromGroupName(group);
    const x = Number(px.x);
    const geometric = (Number.isFinite(x) && x !== 0) ? (x < 0 ? 'left' : 'right') : null;

    if (geometric !== null && token !== null && geometric !== token) {
      throw new Error(`deriveAutoViews: pixel ${i} group '${group}' implies ${token} ` +
        `but world x=${x} implies ${geometric} — model side/geometry disagree; ` +
        `fix the group name or the geometry before deriving LEFT/RIGHT`);
    }
    const side = geometric !== null ? geometric : token;
    if (side === null) {
      unassigned.push(i);
      continue;
    }
    if (side === 'left') leftIdx.push(i);
    else rightIdx.push(i);

    const cId = px.cId ?? px.controllerId;
    if (Number.isInteger(cId) && cId !== 0) {
      if (!controllerSides.has(cId)) controllerSides.set(cId, new Set());
      controllerSides.get(cId).add(side);
    }
  }
  if (unassigned.length > 0) {
    warnings.push(`${unassigned.length} pixel(s) sit on the centreline (x = 0) with no Left_/Right_ ` +
      `group token and therefore belong to NEITHER half — LEFT ∪ RIGHT is not exhaustive on this ` +
      `model. Pixel indices: ${unassigned.slice(0, 20).join(', ')}` +
      `${unassigned.length > 20 ? ', …' : ''}`);
  }
  // Controllers are the strike/debug unit; one spanning both halves means
  // a half cannot be powered down independently. Worth surfacing, not fatal.
  for (const [cId, sides] of controllerSides) {
    if (sides.size > 1) {
      warnings.push(`controller ${cId} has pixels on BOTH halves — LEFT/RIGHT cross its boundary`);
    }
  }
  push(indexEntry('LEFT', leftIdx, existing), 'spatial');
  push(indexEntry('RIGHT', rightIdx, existing), 'spatial');

  // ── 2. FRONT / BACK (whole ship, group-name token) ────────────────────
  const frontIdx = [];
  const backIdx = [];
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!px) continue;
    const fb = frontBackFromGroupName(typeof px.group === 'string' ? px.group : '');
    if (fb === 'front') frontIdx.push(i);
    else if (fb === 'back') backIdx.push(i);
  }
  push(indexEntry('FRONT', frontIdx, existing), 'spatial');
  push(indexEntry('BACK', backIdx, existing), 'spatial');

  // ── 3. Per-strand views (unchanged behavior) ──────────────────────────
  // One Tier-A view per LED strand group whose name no base group owns.
  // LEFT/RIGHT are already claimed above (whole-ship), so the strand-scoped
  // composites deriveStrandViews would emit are skipped by its own
  // existing-name guard — the module itself is untouched.
  const strand = deriveStrandViews(pixels, existing);
  for (const w of strand.warnings) warnings.push(w);
  for (const e of strand.entries) push({ ...e, _autoView: true }, 'strand');

  // ── 4. Structural views ─────────────────────────────────────────────────
  const bandGroups = { WALLS: new Set(), DECKS: new Set(), CHIMNEYS: new Set() };
  for (const px of pixels) {
    if (!px || typeof px.group !== 'string' || px.group.length === 0) continue;
    const band = bandFromGroupName(px.group);
    if (band) bandGroups[band].add(px.group);
  }
  for (const name of ['WALLS', 'DECKS', 'CHIMNEYS']) {
    push(groupsEntry(name, [...bandGroups[name]], existing), 'structural');
  }

  const auditoriumParIdx = [];
  const teSignIdx = [];
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!px) continue;
    const role = roleForId(fixtureTypeId(px.fixtureType));
    const auditoriumPar = isAuditoriumGroupName(px.group);
    if (auditoriumPar && role !== 'FIX_PAR') {
      throw new Error(`deriveAutoViews: pixel ${i} group '${px.group}' is marked Auditorium ` +
        `but fixtureType '${px.fixtureType}' resolves to '${role ?? 'no canonical role'}', not ` +
        `FIX_PAR — auditorium fixture identity is ambiguous; fix the scene metadata`);
    }
    if (auditoriumPar) auditoriumParIdx.push(i);
    if (role === 'FIX_TE_SIGN') teSignIdx.push(i);
  }
  // A scene with signs but no semantically identified auditorium PARs does
  // not acquire a sign-only structural view. That would invent auditorium
  // membership from fixture capability alone.
  if (auditoriumParIdx.length > 0) {
    push(indexEntry('AUDITORIUM', [...auditoriumParIdx, ...teSignIdx], existing), 'structural');
  }

  // ── 5. Typed views (Strands / TE Signs / @PAR / @BAR / @VINTAGE) ──────
  // One mask per fixtureType PRESENT on the model, keyed by its canonical
  // FIX_* role (so a future brand swap keeps the view name). UNTYPED
  // pixels (id 0) are not a type and get no view.
  const typeIdx = new Map(); // typeViewName → { indices[], operatorNamed }
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!px) continue;
    const id = fixtureTypeId(px.fixtureType);
    if (id === 0) continue;
    const role = roleForId(id); // e.g. 'FIX_BAR_18'
    if (!role) continue;
    // A role the operator named reads as that name; otherwise drop the
    // FIX_ prefix and the count suffix, then the trailing _LED qualifier,
    // behind the reserved '@': FIX_PAR → @PAR, FIX_VINTAGE_6 → @VINTAGE,
    // FIX_BAR_18 → @BAR.
    const operatorName = TYPE_VIEW_NAMES[role];
    const viewName = operatorName !== undefined
      ? operatorName
      : `${TYPE_PREFIX}${role.replace(/^FIX_/, '').replace(/_\d+$/, '').replace(/_LED$/, '')}`;
    if (!typeIdx.has(viewName)) {
      typeIdx.set(viewName, { indices: [], operatorNamed: operatorName !== undefined });
    }
    typeIdx.get(viewName).indices.push(i);
  }
  for (const [name, { indices, operatorNamed }] of typeIdx) {
    push(typedEntry(name, indices, existing, operatorNamed), 'typed');
  }

  // ── 6. Per-controller views (CTRL_<cId>) — only when patched ──────────
  // cId is 0 on every pixel until the model is patched; an all-zero model
  // registers NOTHING here (no silent CTRL_0). Once controllers exist each
  // gets one Tier-A view for strike/debug isolation.
  const ctrlIdx = new Map(); // cId → indices[]
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!px) continue;
    const cId = px.cId ?? px.controllerId;
    if (!Number.isInteger(cId) || cId === 0) continue;
    if (!ctrlIdx.has(cId)) ctrlIdx.set(cId, []);
    ctrlIdx.get(cId).push(i);
  }
  for (const cId of [...ctrlIdx.keys()].sort((a, b) => a - b)) {
    push(indexEntry(`CTRL_${cId}`, ctrlIdx.get(cId), existing), 'controller');
  }

  return { entries, families, warnings };
}
