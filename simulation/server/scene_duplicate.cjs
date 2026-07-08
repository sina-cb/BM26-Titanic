/**
 * scene_duplicate.cjs — pure, testable helpers for the save-server's
 * /scene/duplicate endpoint (Duplicate the current scene to a new name).
 *
 * Kept in its own CommonJS module (not inline in save-server.js) so the
 * pure logic — name validation, manifest insertion, self-reference
 * rewriting, and the atomic recursive copy — can be unit-tested without
 * standing up the HTTP server. The Node test runner imports this via an
 * ESM default import (ESM can require CJS).
 *
 * The scene-name grammar here is the SINGLE SOURCE OF TRUTH shared with
 * the client. The client duplicate action in
 * simulation/src/gui/scene_manager.js MUST keep its regex identical to
 * SCENE_NAME_RE below — see the comment there.
 */

const fs = require('fs');
const path = require('path');

// A scene name must be a single safe path segment: starts with an
// alphanumeric, then allows alphanumerics, underscore and hyphen. We
// REJECT anything else rather than rewriting it (codex P0: fail loud, no
// silent fallback). This mirrors save-server.js's isValidSceneName and
// scene_manager.js's client-side check — keep all three in lockstep.
const SCENE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isValidSceneName(name) {
  return typeof name === 'string' && SCENE_NAME_RE.test(name);
}

/**
 * Insert newName into the scene manifest list, preserving the existing
 * convention: a sorted, de-duplicated array (listScenes() sorts, and the
 * committed manifest is alphabetical). Returns a NEW array; never mutates
 * the input.
 */
function updateManifest(scenes, newName) {
  if (!Array.isArray(scenes)) {
    throw new TypeError('scenes must be an array');
  }
  if (!isValidSceneName(newName)) {
    throw new Error(`Invalid scene name: ${JSON.stringify(newName)}`);
  }
  const next = new Set(scenes);
  next.add(newName);
  return [...next].sort();
}

/**
 * Rewrite whole-word occurrences of the source scene name to the new
 * scene name in a copied scene file's text. Scenes today do NOT embed
 * their own directory name (verified: the only "titanic" hits inside
 * scenes/ are PATTERN names like 48_titanic_sos_beacon, which must be
 * preserved verbatim), so this is a safety net for any future file that
 * legitimately self-references the scene by name as a standalone token.
 *
 * Word-boundary matching (\b) deliberately does NOT rewrite a scene name
 * that appears as a substring of a longer identifier (e.g. the pattern
 * token 48_titanic_sos_beacon is left untouched because `titanic` there
 * is flanked by `_`, and \b sits between _ and a word char — so we guard
 * additionally by requiring the match not be adjacent to `_`). Returns
 * the possibly-rewritten text.
 */
function rewriteSelfReferences(text, sourceName, newName) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  if (!isValidSceneName(sourceName) || !isValidSceneName(newName)) {
    throw new Error('rewriteSelfReferences requires valid scene names');
  }
  if (sourceName === newName) return text;
  const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the source name only when it is NOT flanked by an identifier
  // character (letter, digit, or underscore). This keeps pattern tokens
  // like `48_titanic_sos_beacon` and `my_titanic_v2` intact while still
  // rewriting a bare, standalone `titanic` token.
  const re = new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'g');
  return text.replace(re, (match, pre) => `${pre}${newName}`);
}

// Text file extensions whose contents we scan for self-references. Binary
// assets (STL, images) are copied byte-for-byte and never rewritten.
const TEXT_EXTS = new Set(['.yaml', '.yml', '.json', '.js', '.md', '.txt']);

/**
 * Recursively copy the source scene directory to the destination, then
 * rewrite scene-name self-references in text files. Atomic-ish: if any
 * step throws, the partially-created destination is removed before
 * rethrowing so a half-scene never lingers.
 *
 * Fails loud if source is missing or destination already exists.
 */
function duplicateSceneDir(srcDir, destDir, sourceName, newName) {
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    throw new Error(`Source scene directory not found: ${srcDir}`);
  }
  if (fs.existsSync(destDir)) {
    throw new Error(`Destination already exists: ${destDir}`);
  }
  try {
    fs.cpSync(srcDir, destDir, { recursive: true });
    rewriteSelfReferencesInTree(destDir, sourceName, newName);
  } catch (err) {
    // Clean up the partial copy so we never leave a broken scene behind.
    fs.rmSync(destDir, { recursive: true, force: true });
    throw err;
  }
}

/** Walk a copied scene tree and rewrite self-references in text files. */
function rewriteSelfReferencesInTree(dir, sourceName, newName) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteSelfReferencesInTree(full, sourceName, newName);
    } else if (entry.isFile() && TEXT_EXTS.has(path.extname(entry.name).toLowerCase())) {
      const original = fs.readFileSync(full, 'utf8');
      const rewritten = rewriteSelfReferences(original, sourceName, newName);
      if (rewritten !== original) {
        fs.writeFileSync(full, rewritten);
      }
    }
  }
}

module.exports = {
  SCENE_NAME_RE,
  isValidSceneName,
  updateManifest,
  rewriteSelfReferences,
  rewriteSelfReferencesInTree,
  duplicateSceneDir,
  TEXT_EXTS,
};
