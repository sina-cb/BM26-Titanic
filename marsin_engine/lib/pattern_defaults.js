/**
 * pattern_defaults.js — parse MarsinScript pattern source for slider code
 * defaults.
 *
 * The WASM VM's getExports() returns only { id, kind, name } and there is no
 * get_var cwrap, so neither host (engine or sim) can read a pattern's declared
 * `export var x = <default>` value at runtime. Both hosts therefore seed
 * slider controls to a hardcoded value (engine 0.5, sim 0), clobbering the
 * pattern author's intent.
 *
 * This module is the SINGLE source of truth for resolving those defaults from
 * the pattern TEXT. It is Node + browser safe (no imports, no Node built-ins),
 * so the sim can import it verbatim over HTTP and the engine can require/import
 * it server-side.
 *
 * Convention (see e.g. patterns/27_swipe.js):
 *
 *     export var shimmer = 0.3;
 *     export function sliderShimmer(v) { shimmer = v; }
 *
 * The var `shimmer` maps to the SLIDER control `sliderShimmer` (the control
 * name is the setter function name; Cap = first letter of the var uppercased).
 * A default is emitted ONLY for a var that
 *   1. is declared `export var <name> = <numericLiteral>`, AND
 *   2. has a matching `export function slider<Cap>(v){ <name> = v }` setter.
 *
 * colorPalette H/S/V vars (cp1H/cp1S/.../cp2V) and any export without a
 * `slider*` setter are ignored — they are not slider controls. A var whose
 * default is a non-numeric (computed) expression is reported via the
 * `computed` list and intentionally NOT emitted (Codex P0: never invent a
 * value — fail visible, let the caller log + fall back loudly).
 */

// `export var name = <literal>` — captures ONE declaration. We deliberately
// match a single var per statement (the comma-separated multi-var form is only
// ever used by the cp*H/cp*S/cp*V palette vars, which have no slider setter and
// are skipped anyway). The RHS is captured up to the first comma / semicolon /
// line-comment so we can decide literal-vs-computed ourselves.
const EXPORT_VAR_RE = /export\s+var\s+([A-Za-z_$][\w$]*)\s*=\s*([^,;\n]+)/g;

// `export function sliderXxx(arg) { <var> = arg }` — links a slider setter to
// the var it assigns. We capture the control name (sliderXxx) and the assigned
// var so we can pair setter→var without relying purely on the name convention
// (the body assignment is authoritative; the name convention is the fallback
// key the hosts actually index controls by).
const SLIDER_SETTER_RE =
  /export\s+function\s+(slider[A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{([^}]*)\}/g;

// A numeric literal: optional sign, digits with optional fraction/exponent, or
// a leading-dot fraction. No identifiers, no operators — those are "computed".
const NUMERIC_LITERAL_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * @typedef {Object} PatternDefaultsResult
 * @property {Record<string, number>} defaults
 *   Map of slider CONTROL name (e.g. "sliderShimmer") → numeric code default.
 *   This key is exactly what wasmHost.getExports() reports as the kind-1
 *   (SLIDER) export `name`, so callers index it directly by `exp.name`.
 * @property {Array<{ control: string, varName: string, raw: string }>} computed
 *   Slider-linked vars whose declared default is a non-numeric expression.
 *   The caller MUST log these and fall back loudly — we never guess a value.
 */

/**
 * Parse a pattern's source string for slider code defaults.
 *
 * @param {string} source — full MarsinScript pattern text.
 * @returns {PatternDefaultsResult}
 */
export function parsePatternDefaults(source) {
  const defaults = {};
  const computed = [];
  if (typeof source !== 'string' || source.length === 0) {
    return { defaults, computed };
  }

  // 1. Collect every `export var name = <raw>` declaration.
  const varRaw = {};
  EXPORT_VAR_RE.lastIndex = 0;
  let m;
  while ((m = EXPORT_VAR_RE.exec(source)) !== null) {
    const name = m[1];
    const raw = m[2].trim();
    // First declaration wins (a var is only declared once in these patterns).
    if (!(name in varRaw)) varRaw[name] = raw;
  }

  // 2. Walk slider setters and pair each with the var it assigns. The assigned
  //    var is read from the body (`<var> = <arg>`); if the body doesn't make
  //    that obvious we fall back to the name convention (sliderShimmer→shimmer).
  SLIDER_SETTER_RE.lastIndex = 0;
  while ((m = SLIDER_SETTER_RE.exec(source)) !== null) {
    const control = m[1];   // e.g. "sliderShimmer"
    const arg = m[2];       // setter parameter name (e.g. "v")
    const body = m[3];      // setter body
    const varName = _resolveAssignedVar(body, arg, control);
    if (!varName || !(varName in varRaw)) continue;

    const raw = varRaw[varName];
    if (NUMERIC_LITERAL_RE.test(raw)) {
      defaults[control] = Number(raw);
    } else {
      computed.push({ control, varName, raw });
    }
  }

  return { defaults, computed };
}

/**
 * Decide which var a slider setter assigns. Authoritative source is the body
 * (`<var> = <arg>`); the name convention is the fallback. Returns null if no
 * single assignment target can be determined.
 *
 * @param {string} body — setter function body.
 * @param {string} arg — setter parameter name.
 * @param {string} control — control name (sliderXxx) for the convention fallback.
 * @returns {string | null}
 * @private
 */
function _resolveAssignedVar(body, arg, control) {
  // Body assignment: `<var> = <arg>` (the canonical idiom). Escape the arg so a
  // weird parameter name can't break the regex.
  const argEsc = arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const assignRe = new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*${argEsc}\\b`);
  const bm = assignRe.exec(body);
  if (bm) return bm[1];

  // Fallback: name convention sliderShimmer → shimmer (lowercase first char).
  const suffix = control.slice('slider'.length);
  if (suffix.length === 0) return null;
  return suffix.charAt(0).toLowerCase() + suffix.slice(1);
}
