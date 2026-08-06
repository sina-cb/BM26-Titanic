# 20260805_172 — Wave oversight sweep: cross-cutting review of `_153`–`_171`

**Agent:** oversight sweep `_172` (Fable, operator-requested) · **Branch:** `feat/bm_readiness`.
**Scope:** the whole wave — reports `_153`–`_171` + tracker tail. READ-ONLY on production
code; no git writes, no ports, no packets. This is the cross-cutting pass no single
reviewer had: contradictions between reports, unclosed loops, late-wave concurrent-edit
interactions (`_167`–`_171`), final-state suite/security verification, and a smell check
on the two unreviewed catalogs (`_161`/`_162`). Scratch: `~/tmp/sweep_172/`. IPs redacted.

---

## (a) VERDICT: **ISSUES (ranked) — none in the landed code itself**

The landed code is coherent: both suites reproduce their documented baselines byte-for-name,
security is at baseline, all six concurrent late-wave slices verifiably co-exist without
clobbering each other, and nothing dangling references the deleted browser transmit path or
gate. The issues are (1) operator-action items left open — above all the **T2 dimmer retune
that `_160` said must ship WITH the D1 wire fix and did not** — (2) one genuinely new
residue finding (`dirty_probe.yaml` inside the tracked titanic scene), (3) one correction
that was never propagated (`_162` N-2), and (4) the `_157` hardening slices and review
fix-lists that remain unpicked. Standing **NOT SHIP** verdict unchanged and correct.

### Ranked issues

1. **T2 is still open and D1 landed alone.** `marsin_engine/states/titanic/globals_state.yaml`
   still persists ship dimmers at ~0.03–0.32. `_160` §4.2 was explicit: "the D1 slice must
   ship WITH the dimmer reset … never D1 alone." `_170` (the D1 fix) landed alone —
   operator-authorized, and §7 warns loudly — but the compensating action (retune via the
   dimmer rack / `_168` master slider AFTER the next restart) is now the single most
   consequential outstanding operator step. Until it happens, the next titanic boot renders
   the ship at roughly the persisted 3–18 % **without** the old 2.55× crutch: near-dark.
2. **NEW — test residue in a tracked operator scene dir:**
   `simulation/scenes/titanic/playlists/dirty_probe.yaml` (untracked) was written by
   `marsin_engine/tests/mixer/performance_mode.test.js` (POST `/playlists` name
   `dirty_probe`) through a spawned engine that persisted into the real titanic playlists
   dir. It is a junk playlist that would ship via `robocopy /MIR` and appear in playlist
   pickers on playa. The `scene_data_lint` residue tripwire does not catch it (it matched
   only `patches.yaml.original`). Actions: delete the file; widen the residue tripwire
   beyond `*.original`; give `performance_mode.test.js` an isolated playlist root.
3. **`_162` §6 N-2 stale claim never corrected.** `_162` still says the top-level
   `playlist:` config block has "zero consumers"; `_164`/`_166` both proved it is LIVE via
   `lib/autopilot.js`, and `_166` §9 explicitly asked for a correction note in `_162`.
   Not added. An implementer trusting `_162` alone could delete a live config block.
4. **`_166` D-2 still open:** `simulation/tests/engine_bridge_contract.test.js:99` still
   hardcodes a real controller address as `RELAY_HOST` (plus header mentions), contradicting
   `_164`'s "no real controller IP literal in any new test" claim. Unfixed.
5. **`_157` S-D5 (receiver drop listeners) still unimplemented** — grep confirms zero
   `PacketOutOfOrder`/`PacketCorruption` listeners in `sacn_bridge.js` (only `_170`'s
   comment mentions the event). `_160` called this "the cheapest real safety win, land
   first"; it is what makes any future two-writer night diagnosable. S-D4 (per-universe
   arbitration) and S-D3 (per-role CIDs — mirror has `MIRROR_CID`, engine + relay still
   share the vendored default) are also unpicked, though `_171`'s deletion of the browser
   writer removed the most likely trigger.

## (b) THE LEFTOVER LIST — every open item across the wave

Severity: B=blocker-class before show, H=high, M=medium, L=low.

| # | Item | Sev | Source | Suggested owner-action |
|---|---|---|---|---|
| 1 | T2: persisted titanic dimmers 3–32 %; D1 fix makes this the real look at next boot | **B** | `_160`, `_170` §7 | Operator: restart stack, then retune ship levels (dimmer rack + `_168` master); or reset `globals_state.yaml` dimmers first |
| 2 | Bench-mirror physical smoke + `_170` A/B look check never run on hardware | **B** | `_158`, `_170` §6 | Operator: run `_170` §6 recipe (BEFORE capture on the still-running old stack, then restart) |
| 3 | T9: tree uncommitted; tracked code imports untracked `lib/output_config_guard.js`; whole test wave untracked — clean checkout cannot boot | **H** | `_160` | Operator: authorize commit of the wave (security gate will run) |
| 4 | T7: `states/titanic/audio_state.yaml` `capture.device: test` — all audio modulation dead at boot | **H** | `_160` | Pin the real mic on the show box |
| 5 | T6: 45 of 72 `playlists/default.yaml` entries name nonexistent patterns | **H** | `_160` | Repair/regenerate the titanic default playlist |
| 6 | T8: 3 LED controllers `provisional`, 1 bound to the test-bench board | **H** | `_160` | Meet the boards; rebind by controllerId |
| 7 | `dirty_probe.yaml` residue in `scenes/titanic/playlists/` + tripwire blind spot + `performance_mode.test.js` isolation gap | **M** | `_172` (new) | Delete file; widen `scene_data_lint` residue pattern; isolate the test's playlist root |
| 8 | Fog: `POST /fog` never physically tested; titanic scene patches no fog/haze fixture at all | **M** | `_171` | If the ship carries foggers: patch them into titanic + press the button on hardware |
| 9 | S-D5: no `PacketOutOfOrder`/`PacketCorruption` listeners — silent drops invisible | **M** | `_157`, `_160` T12 | Small slice; land first per `_157` §11 |
| 10 | S-D4: arbitration dead by config AND global across universes (lockout trap) | **M** | `_157`, `_160` T10 | Per-universe state + threshold raise slice |
| 11 | S-D8: no `'error'` listener on any Sender dgram socket — process-death class | **M** | `_157`, `_160` T13 | 4-site helper + the §8 live check |
| 12 | S-D3: engine + relay senders still share the vendored default CID (mirror fixed) | M→L | `_157`, `_160` T4 note | Per-role CIDs slice (main trigger deleted by `_171`) |
| 13 | D10: shutdown blackout sent 1× vs the 3× convention — one lost datagram = frozen bright at exit | M | `_157`, `_169` §6 | Cheap: repeat blackout 3× in `engine.js` shutdown |
| 14 | T11/S-D7 remainder: multicast accepted from any source (relay-to-hardware amplifier); OSC `:10000` empty allowlist; `:6969` serves repo root w/ CORS; F9 tshark sweep never run | M | `_157` D7, `_160` T11 | Expected-source warn post-CID; playa tshark sweep in runbook |
| 15 | NEEDS-RULING ×2: ffmpeg silent explicit-path discard (P0); N-1 silent state-limp `/status.stateRestoreDegraded` | M | `_164`, `_166` | Operator rulings, then fix slices |
| 16 | `dev_test_bench` model cannot boot (viewmasks out of sync) | M | `_164` | Fix sidecar or mark model scratch-only |
| 17 | `SIM_SAVE_SERVER_ROOT` does not redirect `ENGINE_ROOT` (shared OS-temp writes); `/save-cameras` `\|\| 'titanic'` at **five** call sites | M | `_163`, `_165` §6 | One-line prod fix + refusal on missing `?scene=` |
| 18 | `_162` §6 N-2/N-3 correction note (playlist block is LIVE via autopilot) | M | `_166` §9 | Operator/curator: annotate `_162` |
| 19 | `_166` D-2: real IP literal in `engine_bridge_contract.test.js:99` | M | `_166` | Derive from scene data like `ALL_SOURCES` |
| 20 | `_166` D-1/D-5/D-6: vacuous strobe test; non-object-body skip-list not a pin; brittle live-config value asserts | M | `_166` | Test-side fixes as specified |
| 21 | `_165` D-165-1/2/3/4: G2 heartbeat unasserted; 4 missing G15 port-guess pins; G8 overlap implementable today (model optional); `_163` G7 wording | L | `_165` | Test-side follow-up slice |
| 22 | `_167` tier-2: 23 remaining `catch { writeHead }` arms → `sendJsonError` mechanical conversion | L | `_167` §3.3 | Structural close-out of the crash class |
| 23 | G-13 applyDmx tests (cheap, ~60-80 lines); G16 sidecar dedup (needs `BM26_SIM_SCENES_ROOT` prod hook) | L | `_164`, `_163` | First pickups of a test slice |
| 24 | `summer_camp_dome/patches.yaml.original` residue (test.todo firing since `_161`) | L | `_161`/`_163` | Operator: delete or archive |
| 25 | N-4 `loadConfig` default-path silent continue; N-5 `path.basename` slug mangling (pinned) | L | `_162`/`_164` | Fix wave |
| 26 | `_168`: dimmer mean doesn't live-track external writers (no `dimmers` WS broadcast) | L | `_168` | Optional WS mirror follow-up |
| 27 | `_169` cosmetics: `deploy/README.md` could carry the BLACKOUT-warning line; misleading "engine exited unexpectedly" teardown log during stop | L | `_169` | Wording-only |
| 28 | `_159` live checks owed: disarmed Ctrl-C drill; FIPS/MD5 probe on the show box; OBS-7 page-global note | L | `_159` §4 | Show-server runbook items |
| 29 | S-D9 (optional): sequence persistence across sender re-creation; S-D11 universe range checks; S-D12 falsy-default cleanup | L | `_157` | Hardening batch when convenient |
| 30 | `_153` §4 F4 text ("ship U10/U12 dark") unannotated after `_157` D6 refuted it | L | `_157` D6 | Doc-only; surface itself deleted by operator ruling 4, both claims now moot |

## (c) Contradictions checked

- **`_153` F4 vs `_157` D6** — real contradiction, correction ADOPTED downstream (the
  `controllers:` block, `output_dispatch.js`, `artnet_output.js` all deleted under operator
  ruling 4; tracker records "D6 correction adopted"; breadcrumbs scrubbed incl. `docs/41`).
  Only `_153`'s own §4 text is unannotated (item 30). No implementer can act on the stale
  claim — the config surface it describes no longer exists and `output_config_guard.js`
  refuses it by name.
- **`_162` N-2 vs `_164`/`_166`** — correction NOT propagated into `_162` (item 18). The
  truth is pinned in `config_boot_matrix.test.js`, so code is safe; the report is the risk.
- **`_164` "no real controller IP" vs `_166` D-2** — `_166` is right; the literal is still
  there (item 19).
- **`_163` "documentation range" wording** — `_165` corrected (RFC 1918, not RFC 5737);
  cosmetic, the material claim (zero overlap with live addresses in the new files) holds.
- **Suite-count spread across `_167`–`_171`** (sim 2008→2024→2007; engine 2769→2797) — not
  contradictions: the tree moved under six concurrent agents and every report discloses it.
  The settled sim tree reproduces `_171`'s exact final numbers today (§d).
- **`_169` "G-7 unblocked" vs `_166` "G-7 stays open"** — consistent in sequence:
  `_169`'s `shutdown_api.test.js` now does what `_166` said needed a route (real spawn,
  confirmed 400/200, engine exits 0, the 15th frame IS the blackout). G-7's live half is
  substantially closed; the 1×→3× blackout (D10) is the remaining piece.

## Late-wave interaction verification (the six concurrent slices)

- **`_171` deletion vs `_170` fix:** verified in source — `useRawDmxValues: true` present on
  the engine sender (`marsin_engine/lib/sacn_output.js:52` block), the bridge relay sender
  and the mirror sender (with `cid: MIRROR_CID`) in `sacn_bridge.js`. The only lane that
  lost it no longer exists. `_170`'s R-D1 proofs and `_171`'s absence tests are both in the
  green settled suite. `sacn_output_client_frames.test.js` deleted WITH its subject and
  replaced by `browser_transmit_absence.test.js` (exists, 11 tests) — no coverage lost.
- **`_167` + `_169` in `api_server.js`:** both landed, no clobber — `sendJsonError` (:416),
  `POST /shutdown` (:5553), `POST /fog` (:5621, `_171`), `engine.js:2569` hook.
- **Dangling references:** repo grep for `sacn_output_client` / `benchMirrorGate` /
  `proveOutputGateHeld` / `setOutputGate` / `releaseGateIfHeldBy` finds only explanatory
  comments and the absence-asserting tests. Clean.
- **All claimed new files exist** (`master_dimmer_logic.ts(+test)`, `shutdown_api.test.js`,
  `fog_endpoint.test.js`, `browser_transmit_absence.test.js`, `launcher_supervision`
  additions, harness, all 16+13 wave test files).
- **`_161`/`_162` smell check:** every factual error in the two Fable catalogs was caught
  and corrected downstream (`_161`'s priority-0 example and unexportable-poll assumption by
  `_163`+`_165`; `_162`'s N-2/N-3 and G-9/G-10 spec text by `_164`+`_166`). No implemented
  test rests on an uncorrected wrong premise. The only residue is documentary (item 18).

## (d) Final state, measured fresh by this sweep

| Check | Result | Verdict |
|---|---|---|
| `cd simulation && npm test` (solo run) | **2007 / 2000 / 6 fail / 1 todo** — failing names byte-match the documented six (dock, orphan-patch, titanic collisions, 2× parity CLI, compression headroom) | ✅ = `_171` final |
| `cd marsin_engine && npm test` (solo run) | **2796 / 2789 / 7 fail** — exactly the documented baseline list: 5× `audio_capture` (no pinned mic), 1× `osc_listener` EADDRINUSE→EACCES, 1× `effects_v2_mode_page_layout` file-level IPC | ✅ zero new |
| (first, parallel-contended engine run) | `pattern_dirs_crash_pin` red — my own three concurrent suite runs; solo re-run green, consistent with its documented contention-flakiness | noted, not a regression |
| `python scripts/security_check.py --all` | **6 findings**, all gitignored `simulation/.scene_backups/studiodj/**` MACs | ✅ baseline |
| `git status` deletions | `output_dispatch.js`, `artnet_output.js` + their 2 test files — all covered by operator ruling 4 (tracker) with guard + breadcrumb scrub; no unexpected operator-file deletions | ✅ |
| `git status` untracked | wave reports/tests as disclosed, PLUS `scenes/titanic/playlists/dirty_probe.yaml` (issue 2) | ⚠ one new finding |

## Hygiene

Read-only on production and test code; zero edits outside this report and the tracker
block. No git operations, no port bound, no packet, no process signalled beyond the three
suite/security runs (documented residue class per AGENTS.md). Scratch:
`~/tmp/sweep_172/{sim_suite.log, engine_suite.log}`. IPs redacted throughout (the D-2
defect is cited by file and line only, per `_166`'s own convention). No future dates.

**Standing verdict unchanged: NOT SHIP** — blockers 1–2 of the leftover list are the gate.
