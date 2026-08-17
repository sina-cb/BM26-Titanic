// pattern_manifest.cjs — the ONE definition of what goes into
// marsin_engine/patterns/manifest.json.
//
// The manifest is the operator-facing pattern list: the simulation client
// (pattern_editor.js) fetches it to populate the pattern picker, and the save
// server rewrites it at boot and after every mutation so the dev experience
// stays live. Because it is rewritten at boot, ANY id the generator cannot
// produce is deleted from git the next time the sim starts.
//
// That is exactly what happened to the subdirectory pattern families: the
// generator was a top-level-only `readdirSync`, so qualified ids such as
// `baby/01_tease_orbit_question` survived in the tracked manifest only until
// the next `npm start`, then vanished with no error. A silent truncation like
// that is the fallback behaviour `.agent/codex.md` forbids. The policy below is
// therefore EXPLICIT — every subdirectory is either registered or classified,
// and an unclassified one is a loud throw, never a silent omission.
//
// Kept as its own module (like scene_duplicate.cjs) so the save server and the
// test that guards the tracked manifest share one source of truth instead of
// drifting apart.

const fs = require('fs');
const path = require('path');

// Pattern families that live in a SUBDIRECTORY of patterns/ and are registered
// under their qualified `<dir>/<name>` id. The engine already speaks that id
// everywhere — api_server.js VALID_PATTERN_NAME and playlist_manager.js
// VALID_PATTERN both accept exactly one directory segment — and playlist
// entries reference it directly.
//
// `ambient_extra` is registered on the INCLUSIVE default: it holds full show
// patterns (currently headed "DRAFT — pending operator review"), and the cost
// of a draft being visible in the picker is far lower than the cost of a
// finished pattern being invisible. If the family turns out to be scratch, the
// reversible call is to move the name into NON_MANIFEST_PATTERN_DIRS below with
// its reason — nothing else changes.
const MANIFEST_PATTERN_DIRS = ['ambient_extra', 'baby', 'crisp', 'party_dancers'];

// Subdirectories that deliberately hold no operator-selectable pattern, each
// with the reason it is excluded.
const NON_MANIFEST_PATTERN_DIRS = {
  catalog: 'generated artefact directory',
  channel_blends: 'engine internals — pattern_mixer blend kernels, not selectable',
  examples: 'documentation example source, not a show pattern',
  gifs: 'generated artefact directory',
  // Its playlists still reference these patterns by their pre-move UNQUALIFIED
  // ids, so registering the qualified ids would not repair them. Left untouched
  // deliberately; repairing it means editing the summer_camp playlists.
  summer_camp: 'playlists still reference the unqualified pre-move ids',
  test: 'test fixtures — same intent as the test_* root-file exclusion',
  transitions: 'engine internals — pattern_mixer transition kernels, not selectable',
};

// Numbered ids sort by their leading integer, then lexically; unnumbered ids
// sort lexically after them. The same rule runs at every level so the manifest
// order is stable across regenerations.
function sortPatternIds(names) {
  const numbered = names.filter(n => /^\d/.test(n)).sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    return na - nb || a.localeCompare(b);
  });
  const named = names.filter(n => !/^\d/.test(n)).sort();
  return [...numbered, ...named];
}

function listPatternFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.js')
      && !e.name.startsWith('test_') && e.name !== 'test.js')
    .map(e => e.name.replace(/\.js$/, ''));
}

/**
 * Build the manifest id list for a patterns directory.
 *
 * @param {string} patternsDir — absolute path to marsin_engine/patterns.
 * @returns {string[]} root ids first (existing order), then qualified
 *   `<dir>/<name>` ids grouped by registered directory.
 * @throws if a subdirectory is neither registered nor classified, or if a
 *   registered directory is missing.
 */
function listPatterns(patternsDir) {
  if (!fs.existsSync(patternsDir)) return [];
  const entries = fs.readdirSync(patternsDir, { withFileTypes: true });

  const root = sortPatternIds(listPatternFiles(patternsDir));

  // A directory in NEITHER list is a new pattern family nobody taught this
  // module about. Throwing is the point: the caller logs it loudly and leaves
  // the tracked manifest ALONE, so the new family is reported rather than
  // quietly missing from the operator's pattern picker.
  const unknown = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => !MANIFEST_PATTERN_DIRS.includes(name)
      && !Object.prototype.hasOwnProperty.call(NON_MANIFEST_PATTERN_DIRS, name));
  if (unknown.length > 0) {
    throw new Error(
      `unclassified pattern subdirectory: ${unknown.join(', ')} — add it to ` +
      'MANIFEST_PATTERN_DIRS or NON_MANIFEST_PATTERN_DIRS in pattern_manifest.cjs');
  }

  const qualified = [];
  for (const dir of [...MANIFEST_PATTERN_DIRS].sort()) {
    const full = path.join(patternsDir, dir);
    if (!fs.existsSync(full)) {
      throw new Error(`registered pattern directory is missing: ${full}`);
    }
    qualified.push(...sortPatternIds(listPatternFiles(full)).map(name => `${dir}/${name}`));
  }

  return [...root, ...qualified];
}

module.exports = {
  MANIFEST_PATTERN_DIRS,
  NON_MANIFEST_PATTERN_DIRS,
  listPatterns,
  sortPatternIds,
};
