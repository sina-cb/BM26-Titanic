// view_mask_constants.js — MASK_* constants for MarsinScript patterns
//
// Patterns can only see view masks as integers (`viewMask` arrives in the
// WASM VM as one Int32 per pixel), so pattern authors historically
// hardcoded magic numbers like `viewMask & 64`. This module turns the
// model's resolved group/preset bit table into named constants
// (`MASK_REDWOOD_PARS`, `MASK_DJ_LIGHTS`, ...) that WasmHost injects
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
//
// As of the views-rehaul (Phase 1, report 20260618_2/_3) the
// sanitization, table-building and injection MECHANISM lives in the
// shared `name_id_registry.js` substrate so masks (MASK_*) and fixture
// types (FIX_*) share one interner / one injector / one loud-unknown
// path. This module is the MASK_-specific facade over that substrate and
// keeps its long-standing public API intact.

import { sanitizeName, buildConstantTable, injectConstants } from './name_id_registry.js';

const MASK_PREFIX = 'MASK';

// MASK_ + name with camelCase boundaries split, non-alphanumerics
// collapsed to underscores: 'RedwoodPARs' → MASK_REDWOOD_PARS,
// 'DJ Lights' → MASK_DJ_LIGHTS.
export function maskConstantName(name) {
  return sanitizeName(MASK_PREFIX, name);
}

/**
 * Build the {MASK_NAME: bit} table for a loaded model from its base
 * group bits and resolved view-mask presets. Sanitized-name collisions
 * throw — two sources mapping to the same constant would make pattern
 * code ambiguous.
 */
export function buildMaskConstants({ groupBits = {}, viewMasks = [] }) {
  const entries = [];
  for (const [group, bit] of Object.entries(groupBits)) {
    entries.push({ name: group, value: bit, origin: 'group' });
  }
  for (const vm of viewMasks) {
    if (vm && typeof vm.name === 'string' && Number.isInteger(vm.bit)) {
      entries.push({ name: vm.name, value: vm.bit, origin: 'preset' });
    }
  }
  return buildConstantTable(MASK_PREFIX, entries);
}

/**
 * Prepend `var MASK_X = <bit>;` declarations for every MASK_* identifier
 * the source references and the model's table knows. Returns the source
 * unchanged when there is nothing to inject. A referenced MASK_* name
 * that is neither in the table nor declared by the pattern throws,
 * naming the known constants (codex P0 — never a silent zero).
 */
export function injectMaskConstants(source, constants) {
  return injectConstants(source, constants, MASK_PREFIX);
}
