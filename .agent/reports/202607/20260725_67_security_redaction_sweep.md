# 20260725_67 — Security redaction sweep of the uncommitted `.agent/` wave

Unblocks the next commit: `python scripts/security_check.py --all` was
reporting 56 findings, 50 of them in uncommitted `.agent/` files from the
BM readiness wave. The pre-commit hook (and the Claude Code PreToolUse gate)
scans staged **and** tracked-unstaged changes, so every one of those would
have blocked the commit.

Spec enforced: `.agent/os/security_privacy.md` — "no IP of any kind goes in
`.agent/`", redact in prose as `10.x.x.NNN` keeping the last octet.

**Redaction only.** No factual claim, measurement, log line, verdict or
surrounding technical content was changed — only the identifier inside it.
No code edits, no git operations.

---

## TL;DR

| | before | after |
|---|---|---|
| Total findings (`--all`) | 56 | 6 |
| `.agent/` findings (`bm26-report-ip`) | 50 | **0** |
| `simulation/.scene_backups/` (`bm26-mac-address`) | 6 | 6 (left in place — see §4) |

---

## 1. Redaction rules applied

| Class | Rule | Example |
|---|---|---|
| Internal RFC1918 IP in prose / URL / log paste | keep the last octet, `x` out the middle so it no longer parses as an IP | show machine → `10.x.x.151`; the gamma testbench controller → `10.x.x.60`; the dead sACN unicast target → `10.x.x.202`; synthetic rename-probe → `10.x.x.1` |
| URL with an IP host | same, port and path untouched | `http://10.x.x.151:6968/audio/config` |
| UNC path embedding the show host | host replaced with a name, share + path untouched | `\\<show-machine>\titanic\logs\boot_server_…log` |

Device MACs: none were found in `.agent/` — the only MAC findings in the tree
are in the gitignored scene-backup snapshots (§4).

## 2. Files touched (15)

All were uncommitted at the time of the sweep — 13 untracked reports plus the
locally-modified tracker and the untracked project dossier. No
committed-and-unmodified file was edited.

| File | IPs redacted | UNC paths redacted |
|---|---|---|
| `.agent/reports/202607/20260725_4_tesign_testbench_pattern_debug.md` | 1 | 0 |
| `.agent/reports/202607/20260725_8_audio_tab_native_fix.md` | 5 | 0 |
| `.agent/reports/202607/20260725_11_captainpad_live_ui_wave.md` | 3 | 0 |
| `.agent/reports/202607/20260725_12_party_detection_build.md` | 2 | 0 |
| `.agent/reports/202607/20260725_13_specialty_patterns_playlists.md` | 3 | 0 |
| `.agent/reports/202607/20260725_14_pattern_switch_lag_debug.md` | 1 | 0 |
| `.agent/reports/202607/20260725_16_deck_swap_wedge_validation.md` | 4 | 1 |
| `.agent/reports/202607/20260725_17_sacn_log_throttle_transition_id.md` | 2 | 0 |
| `.agent/reports/202607/20260725_18_remove_monitor_tab.md` | 6 | 0 |
| `.agent/reports/202607/20260725_19_companion_party_tab.md` | 2 | 0 |
| `.agent/reports/202607/20260725_20_party_timeline_validation.md` | 1 | 0 |
| `.agent/reports/202607/20260725_26_white_amber_lane_matching.md` | 1 | 1 |
| `.agent/reports/202607/20260725_47_rename_hygiene.md` | 10 | 0 |
| `.agent/memory/bm_readiness_thread_tracker.md` | 5 | 0 |
| `.agent/projects/bm26_show_readiness.md` | 2 | 0 |
| **Total** | **48** | **2** |

Note `_47`'s ten hits are the synthetic `ZZ Probe DMX` harness address, not a
real device — but the `bm26-report-ip` rule is deliberately "ANY IP under
`.agent/`", so it is redacted like the rest rather than allowlisted.

Line endings and file bytes are otherwise byte-preserved (read and written
with newline translation disabled), so the diffs are the substitutions only.

## 3. Before / after

```text
before:  leaks found: 56   (50 bm26-report-ip in .agent/, 6 bm26-mac-address)
after:   leaks found: 6    (0  bm26-report-ip anywhere, 6 bm26-mac-address)
```

Every remaining finding is outside the commit path (§4), so the next
`git commit` of this wave will not be blocked.

## 4. Findings deliberately left in place

Six `bm26-mac-address` findings, all the same controller MAC
(`3C:84:27:…`, vendor prefix only here) at line 36 of
`scenes/studiodj/controllers.yaml` inside six operator-owned scene-backup
snapshots under `simulation/.scene_backups/…`.

Left alone because:

- the directory is **gitignored** (`.gitignore:10 → simulation/.scene_backups/`),
  so it can never be staged and never blocks a commit;
- it is **operator-owned** snapshot data written by the sim's own save flow —
  rewriting it would corrupt restore points;
- `security_privacy.md` already documents whole-directory `--all` mode
  surfacing gitignored residue as an intentional tripwire: CI and the
  pre-commit gate scan **commits**, so these stay silent unless someone
  actually tries to commit the overlay — which is exactly when the alarm
  should fire.

No committed-and-unmodified report was edited: none of them were flagged. The
`docs/41_led_controller_onboarding.md` full IPs (that doc's established
functional-config convention) were not flagged and were not touched, and
`.agent/codex.md` was not touched.

## 5. Verification

```bash
python scripts/security_check.py --all
# → leaks found: 6, all under simulation/.scene_backups/
```

This report contains no IPs, no MACs, no hostnames, and no future dates.
