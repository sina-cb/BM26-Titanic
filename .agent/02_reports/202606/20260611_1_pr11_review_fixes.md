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
