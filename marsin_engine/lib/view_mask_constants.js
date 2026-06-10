// view_mask_constants.js — MASK_* constants for MarsinScript patterns
//
// Patterns can only see view masks as integers (`viewMask` arrives in the
// WASM VM as one Int32 per pixel), so pattern authors historically
// hardcoded magic numbers like `viewMask & 64`. This module turns the
// model's resolved group/preset bit table into named constants
// (`MASK_REDWOOD_PARS`, `MASK_BERG_ALPHA`, ...) that WasmHost injects
// into pattern source at compile time. The VM and the MarsinScript
// language stay untouched — names are resolved to integer literals
// before the compiler ever sees the code.
//
// Injection is reference-driven: only constants the pattern actually
// uses are prepended (keeps VM globals lean), and a pattern that
// declares its own `var MASK_X = ...` wins (the injector skips it), so
// pre-existing patterns keep working unchanged. A MASK_* reference that
// matches nothing in the model's table is a loud compile-stage error —
// never a silent zero (codex P0).

// MASK_ + name with camelCase boundaries split, non-alphanumerics
// collapsed to underscores: 'RedwoodPARs' → MASK_REDWOOD_PARS,
// 'DJ Lights' → MASK_DJ_LIGHTS, 'Berg Alpha' → MASK_BERG_ALPHA.
export function maskConstantName(name) {
  const body = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (body.length === 0) {
    throw new Error(`View-mask name '${name}' sanitizes to an empty constant name`);
  }
  return `MASK_${body}`;
}

/**
 * Build the {MASK_NAME: bit} table for a loaded model from its base
 * group bits and resolved view-mask presets. Sanitized-name collisions
 * throw — two sources mapping to the same constant would make pattern
 * code ambiguous.
 */
export function buildMaskConstants({ groupBits = {}, viewMasks = [] }) {
  const constants = {};
  const origins = {};
  const add = (name, bit, origin) => {
    const constName = maskConstantName(name);
    if (constants[constName] !== undefined && constants[constName] !== bit) {
      throw new Error(`View-mask constant collision: ${origin} '${name}' and ${origins[constName]} ` +
        `both sanitize to ${constName} with different bits`);
    }
    constants[constName] = bit;
    origins[constName] = `${origin} '${name}'`;
  };

  for (const [group, bit] of Object.entries(groupBits)) add(group, bit, 'group');
  for (const vm of viewMasks) {
    if (vm && typeof vm.name === 'string' && Number.isInteger(vm.bit)) add(vm.name, vm.bit, 'preset');
  }
  return constants;
}

const MASK_REF_RE = /\bMASK_[A-Z0-9_]+\b/g;

// MarsinScript comment stripper (// line and /* block */). Reference
// scanning and declaration detection both run on stripped source so a
// commented-out `MASK_FOO` neither injects an unused constant nor
// fails the compile with an unknown-name error. String literals are
// rare in MarsinScript and never legitimately contain MASK_* tokens,
// so they are not special-cased.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

/**
 * Prepend `var MASK_X = <bit>;` declarations for every MASK_* identifier
 * the source references and the model's table knows. Returns the source
 * unchanged when there is nothing to inject (so compile-error line
 * numbers only shift — by exactly one line — for patterns that opt in).
 *
 * Table names are injected UNCONDITIONALLY: duplicate `var` declarations
 * are legal in MarsinScript and the later one wins (probed empirically
 * against the real compiler), so a pattern's own `var MASK_X = ...`
 * still overrides the injected value. This keeps the decision rule free
 * of declaration-detection heuristics for the common case — references
 * inside `var` initializers, function args, etc. all just work.
 *
 * Throws on a referenced MASK_* name that is neither in the table nor
 * declared by the pattern: the compiler would fail with "Undefined var"
 * anyway, but this error names the known constants so a typo is a
 * one-glance fix. The declaration check here is a coarse regex; a false
 * positive only downgrades the friendly error to the compiler's own
 * "Undefined var" — still loud, never silent.
 */
export function injectMaskConstants(source, constants) {
  const code = stripComments(source);
  const referenced = new Set(code.match(MASK_REF_RE) || []);
  if (referenced.size === 0) return source;

  const decls = [];
  const unknown = [];
  for (const name of referenced) {
    if (constants && constants[name] !== undefined) {
      decls.push(`var ${name} = ${constants[name]};`);
    } else if (!new RegExp(`\\bvar\\s[^;{}]*\\b${name}\\b`).test(code)) {
      unknown.push(name);
    }
  }
  if (unknown.length > 0) {
    const known = Object.keys(constants || {});
    throw new Error(`Pattern references unknown view-mask constant(s): ${unknown.join(', ')}. ` +
      `Known constants for this model: ${known.length > 0 ? known.join(', ') : '(none)'}`);
  }
  if (decls.length === 0) return source;
  return `${decls.join(' ')}\n${source}`;
}
