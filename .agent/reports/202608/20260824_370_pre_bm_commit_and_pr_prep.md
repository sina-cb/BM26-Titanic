# 370 — Pre-BM review, six readiness commits, and the PR prep

Fable review-and-release pass, operator-ordered: review the whole
`feat/bm_readiness` working-tree delta (weeks of readiness work + the
`_362`–`_369` LED controller wave), commit it in logical groups, and prepare
the pre-Burning-Man PR to `main` for the operator to push and open. **Nothing
was pushed, no PR was created, no device was contacted, no live-stack port was
bound, and `npm run check` (sim) was not run** — all operator gates respected.

---

## 1. Scope of the delta

166 dirty paths: 123 tracked modifications/deletions + 43 untracked files.
Last commit before this pass: `800806da`. Merge-base with `origin/main` is
`f502141b` (PR #54 merge) — a real common ancestor, so no stale-clone /
history-rewrite hazard on push.

## 2. Security & privacy review (every decision)

Method: full-diff sweep + untracked-file sweep for MAC addresses, IPv4s,
secret keywords (password/passphrase/token/api key/ssid/secret), personal
emails, private-firmware-repo mentions, and future-date scheduling; then
`python scripts/security_check.py --staged` (gitleaks 8.28.0) before every
commit, with the `.githooks/pre-commit` hook running it again at commit time.

| Finding | Decision |
|---|---|
| One MAC-shaped string in the diff: `AA:BB:CC:00:00:60` in `simulation/tests/per_output_push.test.js` | Obvious test placeholder; committed. Scanner PASS. |
| IPv4s in the diff: `10.0.0.x` / `10.x.x.201`–`.202` / `192.0.2.x` in sim test fixtures only | Private/documentation-range test fixtures — the accepted class. Committed. |
| `127.0.0.1` + `192.0.2.9` in `.agent/os/multi_agent.md` and reports `_360`/`_361` | Both allowlisted in the `bm26-report-ip` rule (loopback pre-existing; RFC 5737 ranges added by this branch's `.gitleaks.toml` change, committed together). |
| `docs/MARSINLED_API.md` (untracked → tracked) | Reviewed all 512 lines' sweep: one documentation-range IP, no firmware-repo paths or private source names — it documents the HTTP contract only. Committed. |
| `OPERATIONS_HANDBOOK.md`, `deploy/README_TEST_FLIGHT.md` | Read in full / swept: explicitly keep machine facts in `$BM26_MACHINES`/`$BM26_SECRETS`, no credentials, no UDIDs, no personal emails, no future dates. Committed. |
| Private-firmware-repo confidentiality grep (`firmware.*repo/source/private`, `github.com`) over the whole delta | Zero hits beyond behavioral prose ("the firmware reports…"). Clean. |
| `.env` | Ignored by `.gitignore` (pre-existing rule), not present in status. Nothing staged. |
| `simulation/.scene_backups/` | Ignored (pre-existing rule), not in status. |
| `marsin_engine/config.bike_color_share_runtime.yaml` (untracked) | **NOT committed.** Runtime file written by `lib/bike_color_share.js`, carries real show-LAN bike IPs (`10.x.x.230` / `10.x.x.231`). **GITIGNORE GAP** — the autopilot-runtime split files have ignore rules, this one does not. Suggested line: `marsin_engine/*.bike_color_share_runtime.yaml`. Reported, not fixed (brief: report only). |
| `marsin_engine/states/test_bench/.globals_state.yaml.44748.1.tmp` + `.mixer_state.yaml.20756.4.tmp` (untracked) | **NOT committed.** Atomic-write crash residue; the existing `*.tmp-*` rule does not match the `.<name>.yaml.<pid>.<n>.tmp` shape. **Second GITIGNORE GAP**; suggested `marsin_engine/states/**/*.tmp`. |
| Serial/HIL logging | `hil_serial_tail.py` writes raw logs (which name WiFi SSIDs) only to gitignored `~/tmp/hil_serial/`; tracked files carry paths + verdicts. Verified in the file header. Committed. |
| Future dates / schedules in tracked files | None found. `test_week.yaml`'s `startDate` is functional timeline test data (same class as tracked `playa_default.yaml`), not schedule planning. |

## 3. Correctness spot-checks

- `node --check` on every changed/new tracked `.js/.mjs/.cjs`: all pass.
- Smokestack removal is complete: zero remaining references to
  `smokestack_mode/panel/cli_service/status_service` anywhere in
  `simulation/`; the surviving "smokestack" hits are the physical fixture
  group names in `pixel_map_view_defaults.js`/`analytic_light_gate.js`.
- Added `console.log`s in non-test source are deliberate operator-facing
  boot/shutdown status lines in the house style (companion party source,
  engine blackout confirmation, controller-registry retirement notice) — not
  debug spam.
- `git diff --check origin/main..HEAD`: clean (one EOF blank line in
  `docs/MARSINLED_API.md` found and fixed before committing).

## 4. Verification (suite results)

| Suite | Result |
|---|---|
| CaptainPad `npx tsc --noEmit` | exit 0 |
| CaptainPad `npm run lint` | 0 errors, 13 warnings (pre-existing classes; `_360` recorded "no new warnings") |
| CaptainPad `npm test` (vitest) | **3066 passed / 6 skipped**, 177 files |
| Simulation targeted LED suites (`_369` gate list + regression fences + `hil_push_check`, `device_config_mapper`, `controller_probe_service`) | **516 / 516** |
| Marsin engine full `npm test` (sACN-walled, no live ports) | **4156 / 4162** |
| Scene↔model parity (`tools/scene_model_parity.cjs`, default mode) | titanic **PASS**, titanic_interior **PASS**, test_bench **FAIL** (2 errors: unmapped `TE Sign V3 A/B` — the never-pushed `.63`/`.64` signs; known open item, pre-dates this pass) |

The 6 engine failures, individually accounted (none indicts committed code):

1–3. `specialty_white_uv` ×3 — caused by the **uncommitted working-tree
   deletion of `simulation/scenes/titanic/playlists/uv_test.yaml`**
   (`_360` §6.1, operator decision pending). The deletion was deliberately
   NOT committed, so the committed tree keeps the file and passes.
4–5. `ambient_playlist_derivation` ×2 — the known pre-existing pins
   (`_360` §4), untouched by this branch.
6. `live_touch_base_swap` crossfade — fails under `--test-concurrency=4`,
   **passes 6/6 in isolation** (re-run this session): concurrency flake,
   not a regression.

## 5. Commits (in order)

| Hash | Subject |
|---|---|
| `88ed3f59` | feat: CaptainPad timeline day frames, party controls, and EAS iPad build prep |
| `ffd20861` | feat: engine timeline/party readiness, shutdown blackout, and sACN test wall |
| `ad7d88fa` | feat: remove the smokestack DMX/swarm switch surface from the sim |
| `01da56cd` | feat: LED controller narrowed config push, DMX toggle, push-only gamma, verify retry |
| `aec5c8d3` | feat: HIL push-check tooling for MarsinLED boards |
| `8eea4af7` | docs: BM-readiness reports _356-_369, MarsinLED API contract, ops handbook, sACN isolation spec |

`scripts/security_check.py --staged` PASSED before each; the pre-commit hook
re-ran it at commit time. (A stale 0-byte `.git/index.lock` from 09:05 with no
running git process was removed to unblock staging.)

Grouping notes: `save-server.js` interleaves the smokestack route removal
with the gamma pull-route retirement, so it rides in `ad7d88fa` with the
message saying so. Scene YAML (`controllers/patches/pixel_map_views/
scene_config/common`) lands with the LED commit since `controllers.yaml`
(the authoring surface) is where that wave's provenance lives; regenerated
`patches.yaml` and the engine model exports are included in the same branch
per the generated-files rule. `test_week.yaml` and the regenerated titanic
models ride with the engine commit that consumes them.

## 6. Deliberately left uncommitted (and why)

| Path | Why |
|---|---|
| `marsin_engine/states/titanic/*.yaml` (5 modified) + deleted `snapshots/performance-preshow.yaml` | Engine runtime state — the `_360` "expected residue: report, don't commit" ruling. The `settings_state.yaml` change (`autoSave: false`, `bootMode: performance`) is operator runtime state via `POST /settings`, not code. |
| `marsin_engine/audio/companion/party_profiles.yaml` | Same residue ruling, named explicitly in `_360` §5. |
| `simulation/scenes/test_bench/bench_mirror_state.yaml` | Same residue ruling. |
| `simulation/scenes/titanic/playlists/uv_test.yaml` (deletion) | Unresolved operator decision (`_360` §6.1); committing the deletion would break the `specialty_white_uv` contract tests in the committed tree. |
| `marsin_engine/states/titanic_interior/` (untracked dir) | Runtime state dump from running the interior scene (revision counters, bpm-sync provenance) — residue, not a curated baseline. |
| `marsin_engine/config.bike_color_share_runtime.yaml` | Runtime split file with real bike IPs; gitignore gap (see §2). |
| `states/test_bench/.{globals,mixer}_state.yaml.*.tmp` | Crash residue; gitignore gap (see §2). |

## 7. PR prep

Title + body written to `C:\Users\Titanic's End\tmp\bm26_pre_bm_pr.md`
(operator-gated: push + `gh pr create` are the operator's commands, listed at
the bottom of that file). Body covers the six areas, the four-board live
validation evidence, the suite totals above, and the open items (firmware
ledger `.66` reboot / `.62` truncated response, TE Signs `.63`/`.64` never
pushed, `--strict` parity pending, `uv_test.yaml` decision, extras-slice
leftovers, residue list, gitignore gaps).

## 8. Open gaps

1. The two `.gitignore` lines from §2 (bike-color-share runtime, state `.tmp`
   residue) — one-line follow-up, needs no code.
2. `uv_test.yaml`: restore vs. update the contract test (operator).
3. `live_touch_base_swap` crossfade test is concurrency-flaky — worth a look
   at its clock injection before it burns someone else's full-suite run.
4. `test_bench` parity errors clear once the TE Signs are mapped/pushed.
