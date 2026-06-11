# Model exporter doesn't escape quotes in fixture/group names

- **Priority**: normal
- **Filed**: 2026-06-11 (PR #11 code review follow-up)
- **Subsystem**: simulation (`src/dmx/pixelblaze_model_exporter.js`)

## Problem

`saveModelJS()` interpolates fixture `name`, `group`, and `fixtureType`
into single-quoted JS string literals in the generated
`marsin_engine/models/<scene>.js` and `<scene>.effects.js` **without any
escaping** (see the pixel line builder around
`pixelblaze_model_exporter.js:286` and the effects line builder). A
fixture named `Captain's Deck` produces a syntactically broken model file
that the engine fails to import.

The view-masks sidecar generator (`view_registry.js` → `jsStr()`) escapes
backslashes, quotes, and newlines — the model/effects exporter should use
the same helper (move `jsStr` somewhere shared, or duplicate with a
keep-in-sync note like `viewConstantName`).

Pre-existing (not introduced by PR #11); discovered during the PR #11
review. Failure is loud (engine import error), not silent, hence
normal priority.

## Done when

- Names in `<scene>.js` and `<scene>.effects.js` round-trip quotes,
  backslashes, and newlines safely (or such names are rejected at
  fixture-rename time, matching the Views panel approach).
- Engine dry-run passes against a scene containing a fixture named
  `O'Brien's "Test" \ Light`.
