# PR #11 review → fixes: views contract can no longer be silently corrupted

- **Date**: 2026-06-11
- **Branch**: `claude/zen-shannon-2hgj02` (PR #11)
- **Author**: agent (review by a dedicated reviewer sub-agent; fixes verified
  through the real UI)

## What happened

Before pushing PR #11 for human review, a reviewer sub-agent audited the full
branch diff against `main` (42 files) against the codex, style guides, and the
offline rule. Verdict: architecture and engine-side validation sound, **but
1 blocker + 7 majors** — all variations of one theme: *ordinary operator
actions or a corrupt file could silently rewrite or invalidate the group→bit
contract this PR exists to protect.* All blocker/major findings are fixed;
verdict-relevant minors too.

## Fixes (all in one commit)

| Severity | Finding | Fix |
|---|---|---|
| BLOCKER | Corrupt `views.yaml` → silent empty registry → next auto-save renumbers all bits and deletes custom views | views.yaml parsing moved OUT of the forgiving scene-config try/catch (`main.js`); any parse/validation failure paints a fullscreen `⛔ SIM BOOT HALTED` banner and refuses to boot (bootstrap catch no longer falls back to blank `init()`); `createViewRegistry` now throws on invalid entries instead of skip-and-log |
| MAJOR | `views.yaml` serialized before `saveModelJS()` reconciled — crash between writes splits contract | `exportConfig` runs `saveModelJS()` (which reconciles) FIRST; any export throw aborts the whole save with a `⚠ EXPORT FAILED — NOTHING SAVED` toast |
| MAJOR | `renameGroup` merge branch stranded stale group refs in custom views → engine refuses model | custom-view rewrite loop now runs in both branches |
| MAJOR | "+ custom group…" let views reference pixel-less groups → engine refuses model at next load | option removed (only real pixel groups attachable); `buildViewmasksSidecarJS` throws as backstop when a view references a group absent from `groupBits` |
| MAJOR | Engine preset `bit` validation missed the `> 0x40000000` cap (0x80000000 ORs negative, 2³² merges as zero) | cap added (`engine.js`), matching the groupBits check |
| MAJOR | View names interpolated into `innerHTML` (HUD, group rows) — DOM/markup breakage on free text | both rebuilt with `createElement`/`textContent` |
| MAJOR | No name hygiene; sidecar escaping incomplete (`\`, newlines) | `validateViewName` in the registry: charset `[A-Za-z0-9][A-Za-z0-9 _-]*`, duplicate check, MASK_* constant-collision check vs groups AND views (mirrors `maskConstantName`, keep-in-sync noted); enforced on create and rename; sidecar uses `jsStr()` escaping backslash→quote→newline |
| MAJOR | `/save-model` path traversal via raw `scene` query param | sanitized like `/save` (`[^a-z0-9_-] → _`); probe `scene=../../x` verified contained |
| MINOR | `catch(_) {}` ×3 swallowed panel-refresh errors | redundant inline loops deleted (markChanged already refreshes); remaining catch logs |
| MINOR | `writeFileAtomic` left tmp residue on failure, no fsync | try/finally + `rmSync(force)` on error, fsync before rename (generator power cuts); `*.tmp-*` gitignored |
| MINOR | `window.__activeScene \|\| 'titanic'` could stamp a wrong scene into a generated header | `'(unknown scene)'` — can't masquerade as real |
| MINOR | Titanic at 30/31 bits with no visibility | Views panel CUSTOM VIEWS title shows `· N bit(s) free`; exporter now builds the sidecar BEFORE any POST, so a sidecar failure aborts the model write too (no split) |

## Verification

- Engine: `node --check engine.js`, dry-run `test_const`/`test_bench` ✅ and
  `test_const`/`titanic` (976 px, 30-group sidecar) ✅; unit tests 20/20.
- Sim: `npm run check` ✅; real-UI puppeteer suite (`~/tmp/review_fixes_test.cjs`)
  13/13 — invalid/markup/colliding names rejected at create AND rename with the
  exact error surfaced in the modal, foot-gun dropdown option gone, bit budget
  rendered, save round-trip (views.yaml + importable sidecar) clean, and the
  corrupt-views.yaml scenario: banner shown, sim does not boot, **file not
  overwritten** after 6 s of would-be autosave window.
- Path-traversal probe via `curl` contained to `models/`.

## Deferred / disclosed

- Committed camera-position churn in `common.yaml` from earlier sessions stays
  (operator state, possibly Sina's own).
- Pre-existing model/effects exporter quote-escaping → task
  `013_normal_model-exporter-name-escaping.md`.
- Reviewer NOTES (hot-reload stale MASK values until recompile; beacon flushes
  config only) accepted as documented behavior.

## Residue handling

E2E saves persisted the URL `renderer=webgl` override into `common.yaml` and
bumped generated-model header timestamps; both hand-restored before commit
(no `git checkout --`, per codex).

## Continuation: engine hot-reload now refreshes mixer view state

User report: changing views while the engine runs "doesn't reload correctly",
and CaptainPad didn't get the new views.

Root cause: the model hot-reload (engine.js `fs.watch`) updated the `model`
object in place — so `GET /model/view-selection-options` (CaptainPad's picker
source) was already fresh — but **PatternMixer snapshots the view-mask
dictionary at construction and bakes per-channel `compiledPixelMask`s**, and
the reload touched neither. Consequences: running channels kept painting the
OLD membership after a sim save, and selecting a view created after engine
start compiled against the stale dictionary → "Unknown viewMask … no pixels
will match" → channel paints nothing.

Fix:
- `PatternMixer.setModelViewMasks(viewMasks)` (pattern_mixer.js): refreshes
  the dictionary (constructor filtering) and recompiles every channel's mask
  (deck + mixer overlays); a selection that no longer resolves keeps its
  previous mask and logs loudly — the show keeps rendering on playa.
- engine.js hot-reload calls it after the in-place model update
  (`mixer.pixels === model.pixels`, so recompile sees fresh vMasks), then
  pushes `broadcastMixerState()` (newly exposed on the api_server return) so
  already-connected CaptainPads re-sync without a manual reload.

Verified against a LIVE engine (test_bench + 01_cylon_sweep): baseline views →
sidecar hot-edited to add `HotProbe` → reload fired, endpoint listed it,
`PATCH /deck/channel` selecting it returned 200 and stuck → view deleted
while in use → engine survived, logged `Unknown viewMask name 'HotProbe' …
Known viewMasks: [ParsBars, ParsVintages]`, API stayed 200, selection
preserved for re-picking → sidecar restored. Regression: engine dry-run,
view_mask_constants 20/20, pattern_mixer_masking 33/33.

Residue: `marsin_engine/states/test_bench/deck_state.yaml` churn from the
live run left uncommitted per CLAUDE.md (my test's `viewSelection:
HotProbe` was hand-reset to the prior `type: all`; the pattern/param cursor
churn remains as expected engine residue).
