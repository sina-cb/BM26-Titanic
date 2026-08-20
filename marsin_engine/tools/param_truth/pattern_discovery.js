// pattern_discovery.js — find every pattern on disk, always by walking the
// tree. NEVER a hardcoded list: the pattern set is actively being renamed and
// reorganised into themed subdirectories, and a sweep keyed to a frozen list
// would silently stop covering the files that moved.
//
// The returned id is the pattern's path RELATIVE to patterns/ without the .js
// extension (e.g. `01_cylon_sweep`, `summer_camp/113_tower_column_breath`).
// That id is the stable key in the results file, so a rename shows up as a
// removed key + an added key in the diff rather than as silent drift.

import fs from 'fs';
import path from 'path';

// Directories under patterns/ that hold no renderable pattern source.
// `gifs` and `catalog` are generated artefacts; everything else is swept.
export const NON_PATTERN_DIRS = new Set(['gifs', 'catalog']);

/**
 * Recursively collect every `.js` file under `dir`.
 *
 * @param {string} dir — absolute directory to walk.
 * @param {string} prefix — id prefix accumulated from parent directories.
 * @returns {string[]} pattern ids (unsorted).
 */
function walk(dir, prefix) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (NON_PATTERN_DIRS.has(entry.name)) continue;
      out.push(...walk(path.join(dir, entry.name), `${prefix}${entry.name}/`));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    out.push(`${prefix}${entry.name.slice(0, -3)}`);
  }
  return out;
}

/**
 * Discover every pattern id under `patternsDir`.
 *
 * @param {string} patternsDir — absolute path to marsin_engine/patterns.
 * @returns {string[]} sorted pattern ids.
 */
export function discoverPatterns(patternsDir) {
  if (!fs.existsSync(patternsDir)) {
    throw new Error(`pattern_discovery: patterns dir not found: ${patternsDir}`);
  }
  return walk(patternsDir, '').sort();
}

/**
 * Absolute source path for a pattern id.
 *
 * @param {string} patternsDir
 * @param {string} id
 * @returns {string}
 */
export function patternSourcePath(patternsDir, id) {
  return path.join(patternsDir, `${id}.js`);
}
