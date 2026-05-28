# Debug Pollution Scan: dev/summer_camp_readiness vs main
_Generated 2026-05-27_

## Summary
- Files added on this branch: 211 (of 341 changed total)
- Findings: 6 (3 deletion candidates, 3 need-judgment items)
- Stray `console.log` / `debugger` / `TODO` in production source: effectively **zero new pollution**; the few `console.log` additions in `marsin_engine/engine.js` and `marsin_engine/lib/api_server.js` are operator-facing boot banners (out of scope), and the only `TODO` added is inside a docs file as an example snippet.
- **Top recommendation**: delete the two `.original` files and the one-shot `marsin_engine/models/apply_patches.js` patcher script (it has already done its job and now lives in a production model directory). Decide whether the half-scaffolded `summer_camp_logsville` scene ships or moves to a feature branch.

## Deletion candidates (high confidence — safe to remove)

- **Path**: `marsin_engine/models/summer_camp_dome.js.original`
- **Why it's pollution**: Backup of the pre-patch dome model. Already flagged in `20260527_1_code_review.md`; including here for completeness.
- **Suggested action**: delete. Git is the backup.

- **Path**: `simulation/scenes/summer_camp_dome/patches.yaml.original`
- **Why it's pollution**: Pre-patch backup of the dome patches. Same story as above; already flagged in the code review.
- **Suggested action**: delete.

- **Path**: `marsin_engine/models/apply_patches.js`
- **Why it's pollution**: One-shot mutation script that rewrites `simulation/scenes/summer_camp_dome/patches.yaml` in place, ending with `console.log('Successfully patched summer_camp_dome fixtures!');`. It lives in `marsin_engine/models/` (a directory that the engine scans for model exports) but it is not an ES module export — it is a side-effect script that was clearly run once to produce the committed `patches.yaml`. Leaving it in `models/` means a future `import * from './models/...'` or eager-loader could re-execute it. It also embeds the test-bench DMX mapping (`10.1.1.102`, hand-written universe/address assignments) which is now redundant with the YAML it produced.
- **Suggested action**: delete. If you want to preserve the mapping logic for repeatability, move it to `marsin_engine/tools/` (next to `list_audio_devices.js`) and rename to something like `repatch_summer_camp_dome.js`.

## Needs judgment (medium confidence — please review)

- **Path**: `marsin_engine/models/summer_camp_logsville.js` and `marsin_engine/models/summer_camp_logsville.effects.js`
- **Why it's questionable**: Both files are auto-generated stubs dated `2026-05-27T03:12:55.037Z` with `pixelCount = 0` and `export const pixels = []`. Yet `summer_camp_logsville.viewmasks.js` (also new) references pixel ranges 144-221 as if the model were populated. Nothing outside the scene's own files imports the logsville model. The companion `simulation/scenes/summer_camp_logsville/patches.yaml` is similarly stubbed — every fixture has `controllerIp: ''`, `dmxUniverse: 0`, `dmxAddress: 0`.
- **Suggested action**: confirm whether logsville is intended to ship for summer camp or whether this scaffold should move to a feature branch / be deleted. As-is it is dead code that compiles but produces no output.

- **Path**: `states/test_bench/globals_state.yaml` (top-level, NOT under `marsin_engine/states/`)
- **Why it's questionable**: 126-byte runtime state dump (`blackout: false`, `effects: {}`, `params: {}`, three dimmer values). The engine constructs its `stateDir` as `path.join(patternsDir, '..', 'states', opts.modelName)` (see `marsin_engine/lib/api_server.js:225`), so it writes to `marsin_engine/states/<model>/` — NOT to a top-level `states/` directory. A few HIL tests do touch a top-level `states/` via their own pathing, which probably explains how this file got created locally, but the production engine never reads it. There is no other content under the top-level `states/` tree.
- **Suggested action**: delete the file (and the empty top-level `states/` directory it leaves behind). If a HIL test truly needs it, the test should write it under a tmp dir or under `marsin_engine/states/test_bench/` (where `audio_state.yaml` and `global_effect_slots.yaml` already live).

- **Path**: `.agent/02_reports/202605/20260526_3_ipad_discovery_debug.md`
- **Why it's questionable**: Filename literally contains `_debug`. It is in `.agent/` which is documented as intentionally out of scope, so I'm raising this only as a courtesy — if the file is a finished investigation report, keep it; if it was a scratchpad while debugging iPad discovery, consider renaming it (`_ipad_discovery_findings.md`) or pruning. No action required.
- **Suggested action**: glance at it and decide. Safe to keep.

## Stray debug statements

None added to production source paths on this branch. For the record, every new `console.log` in `marsin_engine/engine.js` (lines ~17267–18240 of the diff) and `marsin_engine/lib/api_server.js` (~18641, ~21109–21111) is an operator-facing boot or status banner (audio analysis status, OSC listener address, global-effect slot restore count, reachable URLs). These are intentional per the brief's "operator-facing logging is in scope to keep" rule.

The single `console.log` outside that pattern is in `marsin_engine/models/apply_patches.js` (the success message) — handled by the deletion candidate above.

`marsin_pb/wasm/marsin-engine.cjs` and `marsin_pb/wasm/marsin-engine.js` contain lots of `console.log` calls, but those files are generated Emscripten output, not handwritten — skipped.

## Stray TODO/FIXME added on this branch

None in source code. The only matches:
- Filename pattern `docs/29_[todo]_*` and `docs/30_[todo]_*` follow the project's pre-existing `[todo]` doc-naming convention (already used by `docs/20_[todo]_*` and `docs/23_[todo]_*` on `main`). Not pollution.
- One `// TODO (After v1 lands): reduce duplicate renders ...` inside `docs/27_mixer_layer_view_selection.md` is a *code example inside a markdown doc*, not a real source TODO. Not pollution.

## Other observations

- **Hardcoded LAN IPs**: All `10.1.1.x`, `10.0.0.x`, `192.168.x.x`, and `127.0.0.1` mentions added on the branch are in legitimate contexts — default config values, docs/examples, OSC allowlist test descriptions, or the `apply_patches.js` patcher (which is itself a deletion candidate). No personal hostnames or leaked tokens spotted.
- **Secrets**: `.ssh.secret` and `marsin_engine/secret.yaml` are referenced extensively in newly added docs (`control_podium/server_bridge/README.md`, deploy guides), but they are gitignored and only example files (`.ssh.secret.example`) are present. Clean.
- **`.gitignore` updates** look correct (add `CaptainPad/ios/`, `CaptainPad/android/`, `bin/`, `marsin_engine/bin/`) — no accidental ignoring of real source.
- **No `.bak`, `.old`, `.tmp`, `.swp`, `.DS_Store`, screenshot, or `Copy of *` files** committed on this branch.
- **HIL playlists** (`hil_deck_swap.yaml`, `hil_deck_swap_warmth.yaml`, `hil_transition_pixel_perfect.yaml`, `hil_tx_smooth.yaml`) are all referenced by HIL tests under `marsin_engine/tests/hil/` — not pollution.
- The `simulation/debug_fog.js` UTF-16 issue is already separately tracked, per the brief; not re-flagged here.

## Methodology

1. Enumerated the 211 added files via `git diff --name-status main...dev/summer_camp_readiness` and filtered to non-test, non-docs source paths to focus the scan.
2. Ran `git diff main...dev/summer_camp_readiness` with excludes for `.agent/`, `docs/`, `**/node_modules/**`, `marsin_pb/wasm/*`, `*.test.*`, `**/tests/**`, and `CaptainPad/package-lock.json`, then grepped the unified diff for `console.(log|debug)`, `debugger`, `print(`, `TODO`, `FIXME`, `XXX`, `HACK`. Mapped each hit back to its source file with an awk pass over the `+++ b/...` headers. Resulting findings: ~15 `console.log` additions, all in `marsin_engine/engine.js`, `marsin_engine/lib/api_server.js`, and `marsin_engine/models/apply_patches.js`. The first two are operator-facing banners (out of scope per brief); the third is the deletion candidate.
3. Listed every added file by size (`git show ...:path | wc -c`) and inspected the smallest ones — that's how the empty `summer_camp_logsville` model and the stray top-level `states/test_bench/globals_state.yaml` surfaced.
4. Used `file -b` on each added file to look for unexpected binary/HTML payloads. All "HTML/Java/Nim/Python source" labels turned out to be `file`'s usual misclassification of TypeScript/JS/markdown — no actual binary, image, or HTML pollution committed.
5. Searched specifically for hardcoded localhost/LAN IPs, `secret`, `password`, `api_key`, `sk-` patterns in the additions and skimmed the hits. All in legitimate config/docs/test contexts.
6. Spot-checked the modified files reported in the current `git status` (`CaptainPad/app/(tabs)/osc.tsx`, `CaptainPad/components/EntryLabelEditor.tsx`, `CaptainPad/components/GlobalEffectMacros.tsx`) — only `Alert.alert(...)` additions for user-facing errors, no debug `console.log`.
7. Verified the engine's runtime state directory resolution (`marsin_engine/lib/api_server.js:225-226` + `StateManager`) to confirm the top-level `states/` directory is not on the production read path before flagging it.
