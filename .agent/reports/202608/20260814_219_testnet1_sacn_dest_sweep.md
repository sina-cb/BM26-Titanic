# _219 — TEST-NET-1 sACN black hole: sweeping the fake loopback "black hole" out of the engine tests

Date: 2026-08-14 · Agent `_219` (Opus, implementation) · Branch
`feat/bm_audio_tuning` (shared tree) · Closes the follow-up disclosed in `_173`
§6 and re-disclosed in `_211`.

---

## 1. The flaw

Every engine-spawning test in this repo pointed its sACN output at a loopback
address and called the output "black-holed". It was not.

The simulation's sACN receiver **binds `0.0.0.0`**, so it accepts datagrams
addressed to *any* local address — and the whole of `127.0.0.0/8` is local. A
frame a test engine sent to `127.0.0.9:5568` was **received by the operator's
live sim bridge and relayed onward to the rig**, exactly as if it had been
addressed to `127.0.0.1`. Every suite that spawned an engine was therefore
capable of driving the live show for as long as it ran.

This is the same measurement that already forced the TEST-NET-1
`BLACK_HOLE_HOST` in `tests/helpers/companion_isolation.mjs` (`_173`) — the fix
was applied to the *companion* endpoints and never carried across to the sACN
destination.

## 2. The fix

**TEST-NET-1 — the `192.0.2.x` block (RFC 5737), host `.9`.** Reserved for
documentation, never routed, nothing local ever binds it, so a UDP datagram to
it can only be dropped. Every sACN destination in every engine test/harness now
uses it.

## 3. Sites converted

**48 literal occurrences across 22 files** — 45 under `marsin_engine/tests/`
(21 files) plus 3 in `simulation/agent_tools/live_touch_arm_lifecycle_test.cjs`
— covering both the `--dest` CLI values / `sacn.destinations` config values and
the surrounding comments, which now say TEST-NET-1 / RFC 5737 **and state why a
loopback address is not a black hole**, so the next reader doesn't re-derive
the wrong answer.

| File | Sites |
|---|---|
| `marsin_engine/tests/e2e/audio_suggestion_api.test.js` | 1 |
| `marsin_engine/tests/e2e/http_malformed_sweep.test.js` | 2 (code + header) |
| `marsin_engine/tests/e2e/pattern_dirs_crash_pin.test.js` | 1 |
| `marsin_engine/tests/e2e/picker_catalog_contract.test.js` | 2 |
| `marsin_engine/tests/e2e/save_now_honesty_e2e.test.js` | 1 |
| `marsin_engine/tests/e2e/timeline_e2e_harness.mjs` | 2 (`BLACKHOLE_HOST` + header) |
| `marsin_engine/tests/e2e/ws_connect_replay.test.js` | 1 |
| `marsin_engine/tests/effects/arm_lease_revert.test.js` | 2 |
| `marsin_engine/tests/effects/effect_scope_groups.test.js` | 2 |
| `marsin_engine/tests/effects/layer_settings_api.test.js` | 1 |
| `marsin_engine/tests/effects/live_touch_session_isolation_api.test.js` | 1 |
| `marsin_engine/tests/effects/revert_clears_spatial.test.js` | 2 |
| `marsin_engine/tests/effects/touch_brightness_authority_api.test.js` | 1 |
| `marsin_engine/tests/effects/touch_paint_lease.test.js` | 2 |
| `marsin_engine/tests/helpers/spawn_engine.mjs` | 1 (the doc-comment that TEACHES the flag) |
| `marsin_engine/tests/integration/endpoint_validation.test.js` | 1 |
| `marsin_engine/tests/security/captainpad_auth_api.test.js` | 1 |
| `marsin_engine/tests/special_events/special_events_api.test.js` | 2 |
| `marsin_engine/tests/state/config_boot_matrix.test.js` | 13 (6 `--dest`, 4 YAML fixtures, 3 comments) |
| `marsin_engine/tests/state/scene_reload_api.test.js` | 2 |
| `marsin_engine/tests/state/shutdown_api.test.js` | 2 |
| `simulation/agent_tools/live_touch_arm_lifecycle_test.cjs` | 3 (new `BLACKHOLE_HOST` const + config write + the self-assert that the config can't reach a controller) |

`marsin_engine/tests/effects/color_window_engine_api.test.js` was already
converted by a concurrent agent — left alone.

**Deliberately NOT changed:** the two remaining hits under
`marsin_engine/tests/` are in `tests/helpers/companion_isolation.mjs`, whose
doc-comment names the loopback address as the *counter-example* ("NOT
`127.0.0.9` — measured `_173` …"). That prose is the explanation of the flaw;
rewriting it would delete the evidence.

## 4. Docs updated so the flaw isn't re-taught

- `.agent/memory/spawning_a_test_engine.md` — new section "The black hole must
  NOT be a loopback address", the `--dest` line de-hardcoded, and the harness
  recipe's `sacn.destinations` now prescribes TEST-NET-1.
- `.agent/ops/timeline_e2e_tests.md` — safety wall 1 now prescribes TEST-NET-1
  and says why loopback fails.
- `marsin_engine/tests/helpers/spawn_engine.mjs` — the `extraArgs` example that
  every new suite copies.

Historical reports and the tracker's landed blocks are records of what was
done at the time and were **not** rewritten.

**Note for the operator — a `.gitleaks.toml` asymmetry, NOT changed by me.**
`bm26-public-ip` allowlists the RFC 5737 documentation ranges; its stricter
sibling `bm26-report-ip` (which covers `.agent/**`) does **not**, though it
does allowlist loopback. So the black hole we now prescribe cannot be written
as a literal quad in any `.agent/` doc without failing the commit gate — the
docs above say `192.0.2.x` instead, which the placeholder allowlist accepts.
Adding the RFC 5737 line to `bm26-report-ip` would be the tidy fix (a
documentation-reserved address can never be anyone's PII), but loosening a
privacy rule is an operator call, so I left it alone.
`security_check.py --all` = **6 findings, exactly the `_204`/`_207`/`_214`
baseline** (pre-existing MACs in the gitignored `.scene_backups/`).

## 5. Grep proof

```
$ grep -rn "127\.0\.0\.9" marsin_engine/tests/
marsin_engine/tests/helpers/companion_isolation.mjs:47: * NOT `127.0.0.9` — measured 2026-08-05 (report _173): the engine binds its API
marsin_engine/tests/helpers/companion_isolation.mjs:49: * 127.0.0.0/8 is local. A companion pointed at `127.0.0.9:6968` connected
```

Zero remaining as a *destination*; the two hits are the counter-example prose
of §3.

## 6. Verification

`npm test` in `marsin_engine`: **3360 tests, 3353 pass, 7 fail** (184 s).

Failing list vs the known baseline:

| Failing test | Status |
|---|---|
| `tests/mixer/all_models_load_lint.test.js` — 5× `dev_test_bench` groupBits drift | pre-existing baseline |
| `tests/patterns/playlist_gallery_tool.test.mjs` — "split baby galleries expose the outcome-blind tease and manual answers" | pre-existing baseline |
| `tests/patterns/party_dancers.test.js` — "party_dancers contains only the baseline with complete DOM wiring" (0.7625 vs 0.75) | **FOREIGN** — see below |

**No new failure in any file I touched.** Every one of the 21 converted suites
passes, including the eleven that spawn a real engine, which is the real
regression signal here: the engines still boot, still open their sACN sender,
and still serve their APIs with the destination changed.

**Foreign delta:** `marsin_engine/tests/patterns/party_dancers.test.js` is
**untracked** (`??` in `git status`) — a brand-new suite a concurrent agent is
mid-way through writing, asserting an expected `0.75` against an actual
`0.7625`. Nothing in my change touches patterns; not chased.

**Residue:** `marsin_engine/states/titanic/{audio,deck,globals,mixer}_state.yaml`
were modified by the operator's LIVE engine autosaving (newest write timestamped
before my suite started); `states/test_bench/globals_state.yaml` is stat-dirty
with an empty content diff. Nothing I ran wrote `states/**` or
`simulation/scenes/**`. No git operations, no port in the pinned band bound.
