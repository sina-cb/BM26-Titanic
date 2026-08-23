// view_catalog.js — the ONE place a model's named-view catalog is assembled.
//
// A model's `inView("Name")` world is built in exactly two steps, and both
// of them used to live inline in `engine.js` (lines 560-575 and 622-634):
//
//   1. APPEND the Tier-A auto-views (lib/auto_views.js `deriveAutoViews`) to
//      the resolved `viewMasks` array, with `existingMaskNames` seeded from
//      the base group names + the already-resolved preset names so an
//      auto-view never shadows an authored one — minus the structural
//      duplicates the operator retired (see the dedup note below).
//   2. BUILD the AUTHORED-name -> { bit, word } table the `inView()` intrinsic
//      (lib/in_view_intrinsic.js) resolves against: base groups are word-0
//      views; presets/auto-views carry their own bit + word; a bit-free
//      (Tier-A) auto-view lands with `bit: 0` and is PROMOTABLE on demand
//      rather than unknown.
//
// The offline tools (`tools/pattern_audio_harness.mjs`,
// `tools/pattern_derived_harness.mjs`, `tools/param_truth/render_context.js`)
// hand-mirrored step 2 and skipped step 1 entirely — `loadModelForGauge()`
// does not derive auto-views — so an offline table held 31 names on titanic
// where the engine held its whole catalog (60 then, 59 after the `_148`
// structural dedup below), and `inView("LEFT")` was a COMPILE_FAIL offline
// and a perfectly good view on the rig (report 20260804_146 §4). Reports
// `_140`/`_142` killed exactly that class of bug for the injection PASSES; a
// fourth hand-written copy of the catalog sequence would have recreated it.
//
// So the sequence lives here, engine.js calls it, and the three tools call
// the composed `buildViewCatalog()` — which is literally these same two
// primitives in the same order. Parity is structural, not a promise.
//
// codex P0 — no fallbacks. `deriveAutoViews` throws on a contradictory model
// and returns warnings for a non-exhaustive catalog; NOTHING here swallows
// either. The caller decides how to surface `result.warnings` (the engine
// and the harnesses both print them), but they are never dropped silently.
//
// ── STRUCTURAL DEDUPLICATION (operator ruling, report 20260804_148) ──────
//
// Report `_145` §5.2 measured the catalog's exact-membership alias map and
// left the call to the operator. The ruling retired derived STRUCTURAL views
// that duplicate authored composites. `WALLS` remains byte-identical to
// `Hull Canvas`, so the authored name wins. `AUDITORIUM` combines the
// authored auditorium PAR subset and every TE sign, so it remains distinct
// from the authored PAR-only `Auditoriums` composite. `@BAR`
// stays (fixture-capability targeting), as do `Strands` / `TE Signs` — the
// operator's typed handles.
//
// The rule is therefore scoped to the STRUCTURAL family, and it is
// membership-driven rather than name-driven, so it applies to every scene
// automatically: a structural band whose pixel set exactly equals an
// already-authored view's is not registered; one that has no authored twin
// (test_bench, studio_top_loft, a future scene) still registers. It is NOT
// applied to the other families, and that is deliberate — measured on the
// real models, a global rule would also retire:
//
//   typed      titanic `@BAR`==`Hull Canvas`, `@PAR`==`Organs`,
//              `@VINTAGE`==`Jewelry`, `Strands`==`Silhouette`,
//              `TE Signs`==`Identity`; test_bench/studio_top_loft `@BAR`,
//              `@PAR`, `@VINTAGE`  — all of which the operator keeps, because
//              a fixture-CAPABILITY handle meaning the same pixels as a
//              SEMANTIC instrument today is the point, not a duplicate.
//   controller titanic `CTRL_1`==`Left Front Wall` and nine more — a
//              controller that happens to own exactly one group is still the
//              strike/debug unit and must stay addressable by controller.
//   spatial    studiodj `FRONT`==group `Front` — LEFT/RIGHT/FRONT/BACK are
//              the operator's own terminology (report `_145`); a scene that
//              happens to name a group the same way must not cost the
//              operator their primary handle.
//
// Structural view names (`WALLS`/`DECKS`/`CHIMNEYS`/`AUDITORIUM`) are the one
// family that is purely generated, which is exactly why an authored name that
// means the same pixels wins over it.
//
// Every drop is REPORTED, never silent: it is appended to `result.warnings`,
// which all four callers already print to stderr — so stdout stays byte-stable
// for `tools/gallery/gen_variations.mjs` and the harness captures.

import { deriveAutoViews } from './auto_views.js';

// The auto-view families an exact-membership duplicate may retire. See the
// header note for why this is not every family.
const DEDUPABLE_FAMILIES = new Set(['structural']);

/**
 * Resolve an entry's membership to a sorted, de-duplicated pixel-index array,
 * by the SAME two rules `lib/mask_registry.js` `buildMaskRegistry()` uses
 * (`groups:[…]` union / explicit `pixelIndices:[…]`) so a "byte-identical"
 * verdict here means byte-identical `members[]` there.
 *
 * Returns null when membership is not resolvable from the entry alone — the
 * bit-only preset form, whose members depend on a merged per-pixel word.
 * `buildMaskRegistry` documents it as unreachable from a sidecar load (the
 * engine requires groups OR pixelIndices there) and back-compat only. Such a
 * preset is simply not a dedup SOURCE; nothing is dropped against it.
 *
 * @param {Array<object>} pixels resolved model pixels
 * @param {object} entry a viewMask preset or an auto-view entry
 * @returns {number[]|null}
 */
function resolveMembers(pixels, entry) {
  const count = pixels.length;
  if (Array.isArray(entry.groups) && entry.groups.length > 0) {
    const groupSet = new Set(entry.groups);
    const members = [];
    for (let i = 0; i < count; i++) {
      const px = pixels[i];
      if (px && groupSet.has(px.group)) members.push(i);
    }
    return members;
  }
  if (Array.isArray(entry.pixelIndices) && entry.pixelIndices.length > 0) {
    const seen = new Set();
    for (const idx of entry.pixelIndices) {
      if (Number.isInteger(idx) && idx >= 0 && idx < count) seen.add(idx);
    }
    return [...seen].sort((a, b) => a - b);
  }
  return null;
}

/**
 * membership key -> the AUTHORED name that owns it, for every name the model
 * carries before any auto-view is appended: base groups first, then declared
 * presets — the same order `buildMaskRegistry` interns them, so the first
 * (lowest-id) owner of a pixel set wins the attribution.
 */
function authoredMembershipIndex(pixels, viewMasks, groupBits) {
  const byKey = new Map();
  const remember = (name, members) => {
    if (members === null || members.length === 0) return;
    const key = members.join(',');
    if (!byKey.has(key)) byKey.set(key, name);
  };
  for (const group of Object.keys(groupBits)) {
    remember(group, resolveMembers(pixels, { groups: [group] }));
  }
  for (const vm of viewMasks) {
    if (!vm || typeof vm.name !== 'string' || vm.name.length === 0) continue;
    remember(vm.name, resolveMembers(pixels, vm));
  }
  return byKey;
}

/**
 * Derive the Tier-A auto-views for `pixels` and APPEND them, in order, to the
 * model's resolved `viewMasks` array (mutated in place, exactly as engine.js
 * did inline).
 *
 * Structural auto-views whose membership exactly equals an already-authored
 * view's are dropped in favour of the authored name (see the header note) and
 * reported in `warnings` + `deduped`.
 *
 * @param {Array<object>} pixels resolved model pixels
 * @param {Array<object>} viewMasks resolved preset entries — MUTATED (appended)
 * @param {Object<string, number>} groupBits base group -> bit
 * @returns {{ entries: Array, families: Object<string,string[]>, warnings: string[],
 *             deduped: Array<{name: string, family: string, twin: string, pixels: number}> }}
 *          the `deriveAutoViews` result minus the retired duplicates, so the
 *          caller can log its warnings + family summary.
 */
export function appendAutoViews(pixels, viewMasks, groupBits) {
  // Double application would register every auto-view twice and hand the
  // promoter two entries for one name. It cannot happen on a freshly loaded
  // model; if it ever does, it is a wiring bug, not something to tolerate.
  for (const vm of viewMasks) {
    if (vm && vm._autoView === true) {
      throw new Error(`appendAutoViews: viewMasks already carries auto-view '${vm.name}' — ` +
        `the catalog was assembled twice for this model.`);
    }
  }
  const existingMaskNames = new Set([
    ...Object.keys(groupBits),
    ...viewMasks.map(vm => vm.name),
  ]);
  // Built BEFORE the append, so only authored names (base groups + declared
  // presets) can ever be the surviving twin.
  const authored = authoredMembershipIndex(pixels, viewMasks, groupBits);
  const derived = deriveAutoViews(pixels, existingMaskNames);

  const familyOf = new Map();
  for (const [family, names] of Object.entries(derived.families)) {
    for (const name of names) familyOf.set(name, family);
  }
  const entries = [];
  const deduped = [];
  for (const entry of derived.entries) {
    const family = familyOf.get(entry.name);
    if (DEDUPABLE_FAMILIES.has(family)) {
      const members = resolveMembers(pixels, entry);
      const twin = members === null ? undefined : authored.get(members.join(','));
      if (twin !== undefined) {
        deduped.push({ name: entry.name, family, twin, pixels: members.length });
        continue;
      }
    }
    entries.push(entry);
  }
  const droppedNames = new Set(deduped.map(d => d.name));
  const families = {};
  for (const [family, names] of Object.entries(derived.families)) {
    families[family] = names.filter(name => !droppedNames.has(name));
  }
  // Never a silent drop: every caller already prints `warnings` to stderr.
  const warnings = [...derived.warnings, ...deduped.map(d =>
    `${d.family} view '${d.name}' (${d.pixels} px) is byte-identical to the authored view ` +
    `'${d.twin}' — NOT registered; select/target '${d.twin}' instead ` +
    `(operator ruling, report 20260804_148)`)];

  for (const e of entries) viewMasks.push(e);
  return { entries, families, warnings, deduped };
}

/**
 * Build the AUTHORED-name -> { bit, word } table for the `inView("Name")`
 * intrinsic. Every named in-VM view is included so an unknown name fails
 * loudly and a bit-free (Tier-A) view is recognized as PROMOTABLE (bit: 0)
 * rather than unknown. Base groups are word-0 views; presets/auto-views carry
 * their own bit + word. A later view name wins on a (legitimately impossible
 * — names are unique) collision.
 *
 * @param {{groupBits: Object<string, number>, viewMasks: Array<object>}} model
 * @returns {Object<string, {bit: number, word: 0|1}>}
 */
export function buildViewTable({ groupBits, viewMasks }) {
  const viewTable = {};
  for (const [group, bit] of Object.entries(groupBits)) {
    viewTable[group] = { bit, word: 0 };
  }
  for (const vm of viewMasks) {
    viewTable[vm.name] = { bit: Number.isInteger(vm.bit) ? vm.bit : 0, word: vm.word === 1 ? 1 : 0 };
  }
  return viewTable;
}

/**
 * Append the auto-views and build the `inView()` table in one call — the
 * offline tools' entry point. Identical, by construction, to what engine.js
 * does across its load sequence: the same two primitives, in the same order,
 * on the same inputs.
 *
 * @param {{pixels: Array, groupBits: Object, viewMasks: Array}} loaded
 *        a `loadModelForGauge()` result (its `viewMasks` array is MUTATED).
 * @returns {{ viewTable: Object, autoViews: object }}
 */
export function buildViewCatalog({ pixels, groupBits, viewMasks }) {
  const autoViews = appendAutoViews(pixels, viewMasks, groupBits);
  const viewTable = buildViewTable({ groupBits, viewMasks });
  return { viewTable, autoViews };
}
