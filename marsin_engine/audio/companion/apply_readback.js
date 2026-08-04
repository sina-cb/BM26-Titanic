/*
 * apply_readback.js — the shared vocabulary of the Audio Companion's VERIFIED
 * APPLY paths (MIC TUNE: noise floor + input gain).
 *
 * ░░ WHY ░░
 * Every operator-initiated "apply" in MIC TUNE follows the same contract
 * (report 202607/20260725_129):
 *
 *   apply locally → await the engine PATCH → read the AUTHORITATIVE post-apply
 *   state back → verify it against what was asked → say, in ONE line, what
 *   actually landed and WHERE that truth came from.
 *
 * The only thing genuinely shared between those paths is that last bit: the
 * word for WHERE the read-back came from. `engine` means the engine's own
 * post-PATCH config — the single source of truth, and the thing that persists.
 * `analyzer` means there was no engine to be authoritative, so the number is
 * the live analyzer's own and is labelled `local only` so the operator can
 * never mistake a local apply for a persisted one.
 *
 * An unknown source THROWS (codex P0): a confirmation line whose provenance we
 * cannot name must not be rendered at all.
 */

/** Read-back provenance → the operator-facing word for it. */
export const SOURCE_LABEL = Object.freeze({
  engine: 'engine',          // the engine's post-PATCH config (persisted)
  analyzer: 'local only',    // engine offline — the live analyzer is all we have
});

/**
 * The operator-facing label for a read-back source.
 *
 * @param {'engine'|'analyzer'} source
 * @param {string} context  caller name, so the thrown message names the culprit
 * @returns {string}
 */
export function sourceLabel(source, context) {
  const label = SOURCE_LABEL[source];
  if (!label) throw new Error(`${context}: unknown source "${source}"`);
  return label;
}
