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
//   Spatial whole-ship (group-name prefix, cross-checked by world coord):
//     PORT / STARBOARD   — Left_*/Right_* prefix; x-sign must AGREE.
//     FORE / AFT         — Front/Back token;     z-sign must AGREE.
//   Structural bands (group-name token):
//     WALLS / DECKS / CHIMNEYS / AUDITORIUM
//   Typed views (fixtureType → FIX_* role, report 20260618_1 §5.2):
//     @PAR / @BAR / @VINTAGE / @RAW — the '@' prefix is RESERVED for typed
//     views (report 20260618_2 §4.1) so they never collide with authored
//     or group names.
//   Spatial vertical bands (world Y quantized into thirds of the model's
//   own Y extent — model-agnostic, not hard-coded thresholds):
//     BAND_LOW / BAND_MID / BAND_HIGH
//   Symmetric L/R composites:
//     <base>_BOTH — union of a Left/Right group pair sharing a base name.
//   Per-controller (only once a model is patched, i.e. cId != 0):
//     CTRL_<cId> — every pixel on that controller, for strike/debug.
//
// CODEX P0 — NO SILENT EMPTY MASKS. A family with zero members registers
// NOTHING (an empty mask that looks valid is a fallback). A genuine model
// CONTRADICTION (a group-prefix side that disagrees with the pixel's
// world-coord sign) THROWS loudly — that is a broken model, not a view to
// paper over.

import { fixtureTypeId, roleForId } from './fixture_type_constants.js';
import { deriveStrandViews } from './strand_views.js';

// '@' prefix reserved for typed (fixtureType) views — never collides with
// an authored/group name (report 20260618_2 §4.1).
const TYPE_PREFIX = '@';

// ── Token / side parsing ────────────────────────────────────────────────

// Left_*/Small_Left_*/'Left …' → 'port'; Right_* → 'starboard'; else null.
// Whole-ship (DMX + LED), unlike strand_views which gates on type==='led'.
function sideFromGroupName(name) {
  if (typeof name !== 'string') return null;
  if (/^(Small_)?Left_/.test(name) || /^Left[ _]/.test(name)) return 'port';
  if (/^(Small_)?Right_/.test(name) || /^Right[ _]/.test(name)) return 'starboard';
  return null;
}

// Fore/aft token in a group name. 'Front'→'fore', 'Back'→'aft', else null.
function foreAftFromGroupName(name) {
  if (typeof name !== 'string') return null;
  if (/(^|[ _])Front([ _]|$)/.test(name)) return 'fore';
  if (/(^|[ _])Back([ _]|$)/.test(name)) return 'aft';
  return null;
}

// Structural band token. One pixel can match exactly one structural band.
function bandFromGroupName(name) {
  if (typeof name !== 'string') return null;
  if (/(^|[ _])Wall([ _]|$)/.test(name)) return 'WALLS';
  if (/(^|[ _])Deck([ _]|$)/.test(name)) return 'DECKS';
  if (/(^|[ _])Chimney([ _]|$)/.test(name)) return 'CHIMNEYS';
  if (/(^|[ _])Auditorium([ _]|$)/.test(name)) return 'AUDITORIUM';
  return null;
}

// Strip the leading Left/Right side token from a group name so a Left/Right
// pair collapses to one base name for `_BOTH` pairing. Returns null when
// the name has no recognizable side token.
function baseNameForPairing(name) {
  if (typeof name !== 'string') return null;
  if (/^Small_(Left|Right)_/.test(name)) return name.replace(/^Small_(Left|Right)_/, 'Small_');
  if (/^(Left|Right)_/.test(name)) return name.replace(/^(Left|Right)_/, '');
  if (/^(Left|Right) /.test(name)) return name.replace(/^(Left|Right) /, '');
  return null;
}

// ── Entry helpers ───────────────────────────────────────────────────────

// A Tier-A entry from explicit pixel indices. Registers NOTHING (returns
// null) when the index list is empty — no silent empty mask (codex P0).
function indexEntry(name, indices, existing) {
  if (existing.has(name) || indices.length === 0) return null;
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
 * Keeps lib/strand_views.js behavior intact (per-strand groups + the
 * LED-strand LEFT/RIGHT composites) by composing it, then adds the
 * whole-ship families above. All entries are Tier-A (`bit:0`).
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
    strand: [],
    spatial: [],
    structural: [],
    typed: [],
    band: [],
    paired: [],
    controller: [],
  };

  const push = (entry, family) => {
    if (!entry) return;
    entries.push(entry);
    existing.add(entry.name);
    families[family].push(entry.name);
  };

  // ── 1. Strand views (unchanged behavior) ──────────────────────────────
  // Per-strand groups + the LED-strand LEFT/RIGHT composites. Composing the
  // shipped derivation guarantees its exact prior output and warnings.
  const strand = deriveStrandViews(pixels, existing);
  for (const w of strand.warnings) warnings.push(w);
  for (const e of strand.entries) push({ ...e, _autoView: true }, 'strand');

  // ── 2. PORT / STARBOARD + FORE / AFT (whole ship) ─────────────────────
  // Group-name prefix is authoritative; the world-coord SIGN must AGREE.
  // A disagreement is a broken model → throw loudly (codex P0), never a
  // silently-misassigned pixel.
  const portIdx = [];
  const starboardIdx = [];
  const foreIdx = [];
  const aftIdx = [];
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!px) continue;
    const group = typeof px.group === 'string' ? px.group : '';

    const side = sideFromGroupName(group);
    if (side !== null) {
      const x = Number(px.x);
      if (Number.isFinite(x) && x !== 0) {
        const xSide = x < 0 ? 'port' : 'starboard';
        if (xSide !== side) {
          throw new Error(`deriveAutoViews: pixel ${i} group '${group}' implies ${side} ` +
            `but world x=${x} implies ${xSide} — model side/geometry disagree; ` +
            `fix the group name or the geometry before deriving PORT/STARBOARD`);
        }
      }
      if (side === 'port') portIdx.push(i);
      else starboardIdx.push(i);
    }

    const fa = foreAftFromGroupName(group);
    if (fa !== null) {
      if (fa === 'fore') foreIdx.push(i);
      else aftIdx.push(i);
    }
  }
  push(indexEntry('PORT', portIdx, existing), 'spatial');
  push(indexEntry('STARBOARD', starboardIdx, existing), 'spatial');
  push(indexEntry('FORE', foreIdx, existing), 'spatial');
  push(indexEntry('AFT', aftIdx, existing), 'spatial');

  // ── 3. Structural band views (WALLS/DECKS/CHIMNEYS/AUDITORIUM) ─────────
  const bandGroups = { WALLS: new Set(), DECKS: new Set(), CHIMNEYS: new Set(), AUDITORIUM: new Set() };
  for (const px of pixels) {
    if (!px || typeof px.group !== 'string' || px.group.length === 0) continue;
    const band = bandFromGroupName(px.group);
    if (band) bandGroups[band].add(px.group);
  }
  for (const name of ['WALLS', 'DECKS', 'CHIMNEYS', 'AUDITORIUM']) {
    push(groupsEntry(name, [...bandGroups[name]], existing), 'structural');
  }

  // ── 4. Typed views (@PAR / @BAR / @VINTAGE / @RAW) ────────────────────
  // One mask per fixtureType PRESENT on the model, keyed by its canonical
  // FIX_* role (so a future brand swap keeps the view name). UNTYPED
  // pixels (id 0) are not a type and get no view.
  const typeIdx = new Map(); // typeViewName → indices[]
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (!px) continue;
    const id = fixtureTypeId(px.fixtureType);
    if (id === 0) continue;
    const role = roleForId(id); // e.g. 'FIX_BAR_18'
    if (!role) continue;
    // FIX_RAW_LED → @RAW, FIX_PAR → @PAR, FIX_VINTAGE_6 → @VINTAGE,
    // FIX_BAR_18 → @BAR: drop the FIX_ prefix and the count suffix, then
    // the trailing _LED qualifier so the raw-strand role reads as @RAW.
    const word = role
      .replace(/^FIX_/, '')
      .replace(/_\d+$/, '')
      .replace(/_LED$/, '');
    const viewName = `${TYPE_PREFIX}${word}`;
    if (!typeIdx.has(viewName)) typeIdx.set(viewName, []);
    typeIdx.get(viewName).push(i);
  }
  for (const [name, indices] of typeIdx) {
    push(indexEntry(name, indices, existing), 'typed');
  }

  // ── 5. Spatial vertical bands (BAND_LOW/MID/HIGH by world Y) ───────────
  // Quantize each pixel into a third of the model's OWN Y extent (not a
  // hard-coded threshold), so the bands are model-agnostic. A degenerate
  // (flat) model where every pixel shares one Y registers nothing.
  let minY = Infinity;
  let maxY = -Infinity;
  for (const px of pixels) {
    if (!px) continue;
    const y = Number(px.y);
    if (!Number.isFinite(y)) continue;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (Number.isFinite(minY) && maxY > minY) {
    const span = maxY - minY;
    const lowIdx = [];
    const midIdx = [];
    const highIdx = [];
    for (let i = 0; i < pixels.length; i++) {
      const px = pixels[i];
      if (!px) continue;
      const y = Number(px.y);
      if (!Number.isFinite(y)) continue;
      const t = (y - minY) / span; // [0,1]
      if (t < 1 / 3) lowIdx.push(i);
      else if (t < 2 / 3) midIdx.push(i);
      else highIdx.push(i);
    }
    push(indexEntry('BAND_LOW', lowIdx, existing), 'band');
    push(indexEntry('BAND_MID', midIdx, existing), 'band');
    push(indexEntry('BAND_HIGH', highIdx, existing), 'band');
  }

  // ── 6. Symmetric L/R `_BOTH` composites ───────────────────────────────
  // Collect each base name's Left and Right groups; emit <base>_BOTH only
  // when BOTH sides exist (a one-sided base is not a symmetric pair).
  const pairBase = new Map(); // base → { left:Set, right:Set }
  for (const px of pixels) {
    if (!px || typeof px.group !== 'string' || px.group.length === 0) continue;
    const side = sideFromGroupName(px.group);
    if (side === null) continue;
    const base = baseNameForPairing(px.group);
    if (base === null) continue;
    if (!pairBase.has(base)) pairBase.set(base, { left: new Set(), right: new Set() });
    const slot = pairBase.get(base);
    if (side === 'port') slot.left.add(px.group);
    else slot.right.add(px.group);
  }
  for (const [base, slot] of pairBase) {
    if (slot.left.size === 0 || slot.right.size === 0) continue;
    const name = `${base}_BOTH`;
    const groups = [...slot.left, ...slot.right];
    push(groupsEntry(name, groups, existing), 'paired');
  }

  // ── 7. Per-controller views (CTRL_<cId>) — only when patched ──────────
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
