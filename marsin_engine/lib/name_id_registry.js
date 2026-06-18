// name_id_registry.js — the shared compile-time name → id substrate.
//
// The repo already shipped one working "names at author time, integers
// at runtime" bridge for view masks (view_mask_constants.js): the model
// declares human names, and WasmHost.compile() prepends
// `var MASK_X = <bit>;` for every MASK_* a pattern references, failing
// loudly on an unknown name. Reports 20260618_2 and _3 call for ONE
// such substrate that BOTH masks (MASK_*) and fixture types (FIX_*)
// register onto, so there is exactly one interner, one injector, and
// one loud-unknown-name path — not parallel copies.
//
// This module is that substrate. It is intentionally tiny and
// prefix-agnostic:
//   - sanitizeName(prefix, name) → 'PREFIX_BODY' (camelCase split,
//     non-alphanumerics collapsed to underscores).
//   - buildConstantTable(prefix, entries) → { PREFIX_NAME: value }, with
//     sanitized-name collisions to DIFFERENT values throwing.
//   - injectConstants(source, table, prefix) → source with referenced
//     `var PREFIX_X = <value>;` prepended; an unknown PREFIX_* reference
//     that the pattern does not declare itself is a loud compile error
//     naming the known constants (codex P0 — never a silent zero).
//
// "id" here is whatever stable integer the caller interns a name to: a
// view-mask bit for masks, a fixtureTypeId for fixture types. The
// substrate does not care which — it only guarantees deterministic,
// collision-checked, reference-driven injection with loud failures.

// PREFIX_ + name, camelCase boundaries split, runs of non-alphanumerics
// collapsed to a single underscore, leading/trailing underscores
// trimmed: ('MASK', 'RedwoodPARs') → 'MASK_REDWOOD_PARS',
// ('FIX', 'BarLights 18') → 'FIX_BAR_LIGHTS_18'.
export function sanitizeName(prefix, name) {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new Error(`Constant prefix must be a non-empty string, got ${JSON.stringify(prefix)}`);
  }
  const body = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (body.length === 0) {
    throw new Error(`${prefix} name '${name}' sanitizes to an empty constant name`);
  }
  return `${prefix}_${body}`;
}

/**
 * Build a { PREFIX_NAME: value } table from `[{name, value}, ...]`
 * entries. Two entries whose names sanitize to the same constant but
 * carry DIFFERENT values throw — that would make pattern code
 * ambiguous. Same name + same value is idempotent (deduped).
 *
 * @param {string} prefix    e.g. 'MASK' or 'FIX'
 * @param {Array<{name: string, value: number, origin?: string}>} entries
 * @returns {Object<string, number>}
 */
export function buildConstantTable(prefix, entries) {
  const table = {};
  const origins = {};
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || !Number.isInteger(entry.value)) continue;
    const constName = sanitizeName(prefix, entry.name);
    const origin = entry.origin ? `${entry.origin} '${entry.name}'` : `'${entry.name}'`;
    if (table[constName] !== undefined && table[constName] !== entry.value) {
      throw new Error(`${prefix}_ constant collision: ${origin} and ${origins[constName]} ` +
        `both sanitize to ${constName} with different values`);
    }
    table[constName] = entry.value;
    origins[constName] = origin;
  }
  return table;
}

// MarsinScript comment stripper (// line and /* block */). Reference
// scanning and declaration detection both run on stripped source so a
// commented-out PREFIX_FOO neither injects an unused constant nor fails
// the compile with an unknown-name error.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

/**
 * Prepend `var PREFIX_X = <value>;` for every PREFIX_* identifier the
 * source references and the table knows. Returns the source unchanged
 * when nothing is injected (so compile-error line numbers only shift by
 * one line for patterns that opt in).
 *
 * Table names are injected UNCONDITIONALLY: duplicate `var` declarations
 * are legal in MarsinScript and the later one wins, so a pattern's own
 * `var PREFIX_X = ...` still overrides the injected value.
 *
 * Throws on a referenced PREFIX_* name that is neither in the table nor
 * declared by the pattern, naming the known constants so a typo is a
 * one-glance fix (codex P0 — never a silent zero).
 *
 * @param {string} source
 * @param {Object<string, number>} table   { PREFIX_NAME: value }
 * @param {string} prefix                   e.g. 'MASK' or 'FIX'
 */
export function injectConstants(source, table, prefix) {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new Error(`injectConstants requires a non-empty prefix, got ${JSON.stringify(prefix)}`);
  }
  const refRe = new RegExp(`\\b${prefix}_[A-Z0-9_]+\\b`, 'g');
  const code = stripComments(source);
  const referenced = new Set(code.match(refRe) || []);
  if (referenced.size === 0) return source;

  const decls = [];
  const unknown = [];
  for (const name of referenced) {
    if (table && table[name] !== undefined) {
      decls.push(`var ${name} = ${table[name]};`);
    } else if (!new RegExp(`\\bvar\\s[^;{}]*\\b${name}\\b`).test(code)) {
      unknown.push(name);
    }
  }
  if (unknown.length > 0) {
    const known = Object.keys(table || {});
    throw new Error(`Pattern references unknown ${prefix}_ constant(s): ${unknown.join(', ')}. ` +
      `Known ${prefix}_ constants for this model: ${known.length > 0 ? known.join(', ') : '(none)'}`);
  }
  if (decls.length === 0) return source;
  return `${decls.join(' ')}\n${source}`;
}
