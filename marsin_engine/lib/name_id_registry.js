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
//
// Tier-C (viewMaskHi) adds an INLINE injection mode. A table value may be
// a bare number (the legacy `var PREFIX_X = <n>;` declaration form) OR an
// object `{ value, inline: true }`. An inline entry is NOT declared as a
// `var`; instead every `PREFIX_X` token in the source is textually
// replaced by the literal `value`. This exists for high-word view masks:
// the MarsinScript compiler requires the mask in `(viewMaskHi & MASK)` to
// be a COMPILE-TIME-CONSTANT single-bit literal, so a `var MASK_X = (1<<k)`
// (a runtime value) is rejected — the literal must be inlined directly,
// e.g. `(viewMaskHi & 1073741824)`. Low-word masks and FIX_* ids keep the
// `var` form unchanged (back-compat, byte-identical injection).

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
 * An entry may set `inline: true` to mark the constant for inline literal
 * substitution at injection time (see injectConstants) instead of a `var`
 * declaration. The table then stores `{ value, inline: true }` for that
 * name; bare-number entries are stored as plain numbers (legacy). Two
 * entries that sanitize to the same name must agree on BOTH value and
 * inline mode.
 *
 * @param {string} prefix    e.g. 'MASK' or 'FIX'
 * @param {Array<{name: string, value: number, inline?: boolean, origin?: string}>} entries
 * @returns {Object<string, (number|{value: number, inline: true})>}
 */
export function buildConstantTable(prefix, entries) {
  const table = {};
  const origins = {};
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || !Number.isInteger(entry.value)) continue;
    const constName = sanitizeName(prefix, entry.name);
    const origin = entry.origin ? `${entry.origin} '${entry.name}'` : `'${entry.name}'`;
    const existing = table[constName];
    if (existing !== undefined) {
      const existingValue = constantValue(existing);
      const existingInline = constantIsInline(existing);
      if (existingValue !== entry.value || existingInline !== Boolean(entry.inline)) {
        throw new Error(`${prefix}_ constant collision: ${origin} and ${origins[constName]} ` +
          `both sanitize to ${constName} with different values`);
      }
    }
    table[constName] = entry.inline ? { value: entry.value, inline: true } : entry.value;
    origins[constName] = origin;
  }
  return table;
}

// A table value is either a bare number (legacy `var` form) or
// `{ value, inline: true }` (inline literal substitution). These two
// helpers normalize access so injectConstants and callers never branch
// on the shape inline.
export function constantValue(entry) {
  return (entry && typeof entry === 'object') ? entry.value : entry;
}

export function constantIsInline(entry) {
  return Boolean(entry && typeof entry === 'object' && entry.inline);
}

// MarsinScript comment stripper (// line and /* block */). Reference
// scanning and declaration detection both run on stripped source so a
// commented-out PREFIX_FOO neither injects an unused constant nor fails
// the compile with an unknown-name error.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

/**
 * Resolve referenced PREFIX_* identifiers against the model's table.
 *
 * Two injection modes per the table value's shape:
 *   - LEGACY (bare number): prepend `var PREFIX_X = <value>;`. Duplicate
 *     `var` declarations are legal in MarsinScript and the later one
 *     wins, so a pattern's own `var PREFIX_X = ...` still overrides the
 *     injected value.
 *   - INLINE (`{ value, inline: true }`): textually replace every
 *     PREFIX_X token with the literal `value` — NO `var` is emitted. This
 *     is the high-word view-mask path: `(viewMaskHi & MASK_X)` must carry
 *     a compile-time-constant single-bit LITERAL, so the name is inlined
 *     to e.g. `(viewMaskHi & 1073741824)`. A pattern that self-declares
 *     `var PREFIX_X` for an inline name keeps its own declaration (it is
 *     not substituted) and the compiler rejects the var-mask use loudly —
 *     never silently mis-substituted.
 *
 * Returns the source unchanged when nothing is injected. Throws on a
 * referenced PREFIX_* name that is neither in the table nor declared by
 * the pattern, naming the known constants (codex P0 — never a silent zero).
 *
 * @param {string} source
 * @param {Object<string, (number|{value: number, inline: true})>} table
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
  const inlineNames = [];
  const unknown = [];
  for (const name of referenced) {
    const entry = table ? table[name] : undefined;
    // A name is "self-declared" only when it is a DECLARATION TARGET in a
    // `var` statement — i.e. preceded by `var ` or a `,` (var-list) AND
    // followed by `=`, `,` or `;`. The looser "appears anywhere after var"
    // form false-positives on a name used in another declarator's
    // initializer (`var on = (viewMaskHi & MASK_X)`), which would wrongly
    // suppress inline substitution. (codex P0: never silently mis-resolve.)
    const selfDeclared = new RegExp(`(?:\\bvar\\s+|,\\s*)${name}\\s*(?:=|,|;)`).test(code);
    if (entry !== undefined && constantIsInline(entry) && !selfDeclared) {
      inlineNames.push(name);
    } else if (entry !== undefined) {
      decls.push(`var ${name} = ${constantValue(entry)};`);
    } else if (!selfDeclared) {
      unknown.push(name);
    }
  }
  if (unknown.length > 0) {
    const known = Object.keys(table || {});
    throw new Error(`Pattern references unknown ${prefix}_ constant(s): ${unknown.join(', ')}. ` +
      `Known ${prefix}_ constants for this model: ${known.length > 0 ? known.join(', ') : '(none)'}`);
  }

  // Inline substitution rewrites the source body in place (whole-token,
  // longest-name-first so PREFIX_A never clobbers PREFIX_AB).
  let out = source;
  for (const name of inlineNames.sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\b${name}\\b`, 'g'), String(constantValue(table[name])));
  }
  if (decls.length === 0) return out;
  return `${decls.join(' ')}\n${out}`;
}
