# `_220` — companion suites hermeticity (closes `_214` follow-up 1)

**Date:** 2026-08-14
**Thread:** fix agent `_220` (audio-closure campaign; closes `_214` follow-up 1)
**Branch:** `feat/bm_audio_tuning` (shared tree; other sessions editing
concurrently — nothing under `CaptainPad/**`, `lib/color_autopilot.js` or
`lib/api_server.js` was touched)
**Scope held:** test seam only. No engine, Companion or analyzer source
changed; no threshold, gate or tolerance moved. No git operations. Live stack
never touched — no mic opened, no operator port bound, no `states/**` or
`simulation/scenes/**` write from anything I ran.

---

## 1. The leak, measured

`_214` closed the state-root hole in `isolatedCompanionEnv()` but three
companion suites never adopted the helper: `companion_new_signals`,
`companion_osc_accounting` and `companion_live_edit_collisions` spawned the
real Companion with only `--no-mic`, `--source test` and ephemeral ports. With
no `MARSIN_STATE_DIR`, `companion_server.js`'s
`loadEffectiveAudioAnalysisConfig({modelName:'test_bench'})` merged the
operator's live `states/test_bench/audio_state.yaml` over `config.yaml`, so the
analyzer under test ran on whatever knob the rig had last been turned to.

Reproduced on this box with a scratch probe (`~/tmp`-class scratchpad, the real
server, ephemeral ports, `--no-mic --source test`), booting the Companion
exactly the way these suites do — once with the pre-`_220` env, once with
`isolatedCompanionEnv()`:

```
PRE  (no state/config redirect): inputGain=8.83  gates={noiseGate:0.06, low:0.12, mid:0.1, high:0.14}
POST (isolatedCompanionEnv)    : inputGain=1     gates={noiseGate:0.04, low:null, mid:null, high:null}
```

Both runs `engineLink.connected=false`. The full tracked-vs-effective delta on
`test_bench`: `bands.inputGain` 1 → 8.83, `bands.noiseGate` 0.04 → 0.06,
`bands.{low,mid,high}Gate` absent → 0.12 / 0.10 / 0.14, `fftSize` 2048 → 1024,
`enabled` false → true, plus the operator's capture device.

(Note on the CONFIG half: under `npm test` these suites already inherited
`setup_config_guard.mjs`'s scratch **copy** of the tracked `config.yaml`, so
config values were never the leak — the scene-state overlay was. Adopting the
full helper also black-holes the configured Companion endpoints, which the
explicit port flags were the only thing guarding before.)

---

## 2. Per-suite adoption + assertion review

Every assertion in all three suites was read individually against the tracked
config. **No expectation was widened, no tolerance moved, no fallback added.**

### `companion_new_signals.test.js`

`isolatedCompanionEnv('new_signals')` → `env` on the spawn, `cleanup()` in the
`finally`.

| assertion class | verdict under tracked config | why |
|---|---|---|
| `hello.mode/micDisabled/derivedConfig.trackChange` | unchanged | set by CLI flags + config shape, not by gain |
| every `NEW_FRAME_KEYS` key `in derived`, `typeof === 'number'`, finite | unchanged | the server publishes each key on **every** analysis frame, value 0 when idle — presence and finiteness are structural, not level-dependent |
| `derivedMetrics.partyLoudness / silenceLoudness` finite | unchanged | same — a scalar per frame |
| pre-existing keys still present | unchanged | structural |
| CSS/theme + UI-source tests | untouched | never spawn anything |

**Added, not widened:** `assertEngineLinkDown(hello, assert.ok)` and two
tracked-config locks (`hello.inputGain`, `hello.gates.noiseGate` vs
`loadTrackedAudioAnalysisConfig`). Rationale in §4.

### `companion_osc_accounting.test.js`

`isolatedCompanionEnv('osc_accounting')` inside `withCompanion` (both booting
tests). `withCompanion` now also captures the `hello` frame so it can carry the
tracked-config lock.

| assertion class | verdict under tracked config | why |
|---|---|---|
| accounting row shape (`address`, `cpcKey`, `count`, `rateHz`, `value`, `label`) | unchanged | shape, not level |
| the four named addresses present; BPM `cpcKey === 'audioBpm'` | unchanged | comes from the design + the built-in emit registry |
| `micLow.count > 0`, `micLow.rateHz > 0`, `totalSent > 0` | unchanged | **checked in source, not assumed**: `sendOsc()` emits on every send-frame regardless of value — there is no dead-band or change-gate that a quieter input could fall under. A band sitting at 0.0 still ships a packet |
| `snapshot.mode/micDisabled/engineLink.connected/targets` | unchanged | flags + ports |
| the seven diagnostic keys exposed and finite | unchanged | published every hop |
| `analyzerHops > 0`; `writes > 0`; `analyzerHops - lastWriteHop <= 2` | unchanged | raw mirrors and designed-chain production are written **every hop**, before the OSC rate gate. Lower gain does not skip a hop. (`fftSize` 2048 halves the hop rate vs the live 1024, so the recency window is if anything easier to satisfy in wall-clock terms — the assertion is in hops, so it is unaffected either way) |
| designed-chain `producer.designedWrites > 0`, `kinds` includes `designed_chain`, `transport.count/rateHz > 0` | unchanged | same path |
| stopped-stream decay: count frozen, `rateHz === 0` after the idle cutoff | unchanged | driven by `removeSignal` + the EWMA idle cutoff, not by level |
| `catalog.genreNames`, `missingCuratedOutputs`, theme CSS | unchanged | static/design |

Measured, not reasoned: both booting tests pass with the tracked config, and
`micLow.count`/`totalSent` are non-zero in every run.

### `companion_live_edit_collisions.test.js`

`isolatedCompanionEnv('live_edit_collisions')` inside `withCompanion`.

Every assertion here is structural — which signal publishes `micLow`, that a
rename onto a curated key is refused and names the owner, that the contested
OSC address keeps exactly one owner, that `missingCuratedOutputs` is empty.
None of it reads an analyzer level, so the tracked config moves nothing. What
it does change is meaning: "the shipped design" now really is the shipped
design rather than the design as assembled under the rig's live tuning.
**Added:** `assertEngineLinkDown` + one tracked-config lock (§4).

---

## 3. The one place the full env would be WRONG

`companion_osc_accounting`'s two `--no-mic rejects the explicit configured
production <engine|OSC> port` tests must **not** get the black-holed scratch
config. Their subject *is* the tracked `config.yaml`'s production endpoint:
`companion_server.js` refuses the boot via `targetsMatch(effective,
configured)`, which compares **host and port**. The scratch config rewrites the
configured Companion hosts to TEST-NET-1, so a loopback effective target would
stop matching, the refusal would never fire, and the test would go green having
proved nothing — the exact class of silent-pass this thread exists to kill.

They still must not read the operator's live overlay (they reach
`loadEffectiveAudioAnalysisConfig` before the interlock throws), so the helper
gained a second export:

- **`isolatedStateRoot(prefix)`** — the STATE half alone: fresh `mkdtemp`
  `MARSIN_STATE_DIR` seeded with the same two-key mic fixture per tracked scene
  name, `MARSIN_CONFIG_FILE` untouched. `isolatedCompanionEnv()` is now
  implemented **on top of it** (one fixture-seeding implementation, no copy),
  so everything `_214`'s `companion_isolation_state_root.test.js` asserts about
  the full env still holds byte-for-byte.

The other four refusal tests in that file (`--no-mic` without `--source`, and
the three missing-port-flag cases) get **no env at all, on purpose**: they die
inside CLI validation, which runs *before* `loadEffectiveAudioAnalysisConfig`
at module scope. They never open `config.yaml` and never touch `states/`, so an
isolation env there would imply a coupling that does not exist. A comment in
the file says so, and says which tests below it do reach the config read.

---

## 4. Green is not proof — the locks

Every assertion in these three suites is structural or a counter. That means a
future edit dropping `env: isolation.env` would leave the suite **fully green**
while silently returning it to the operator's live overlay — the failure mode
that let this leak survive `_173`, `_207` and `_214`. So each booting suite now
carries the cheapest possible witness:

```js
assert.equal(hello.inputGain, TRACKED_AUDIO_CONFIG.bands.inputGain, …);
assert.equal(hello.gates.noiseGate, TRACKED_AUDIO_CONFIG.bands.noiseGate, …);  // where hello.gates is read
```

The probe in §1 is the negative control: with the env dropped the Companion
reports 8.83 / 0.06, so the lock is red the moment isolation is lost. Both
booting suites also now assert `assertEngineLinkDown` (the `_173` guarantee,
asserted rather than assumed).

---

## 5. `companion_derived_patch_order.test.js` — the two `_214` missed

`_214` reported this file as the helper's sole consumer and green, but only
three of its five tests go through `bootCompanion()`. The other two
(*same-group derived edits persist serially…* and *a transport failure keeps
the latest derived edit pending…*) inline their own `spawn` and were still
booting on the live overlay — the same defect class, in the file the previous
report cited as the fixed one. Both now take
`isolatedCompanionEnv('derived_patch_order_<seq>')` with `cleanup()` in their
`finally`. Their assertions are all self-relative deltas (`original + 100`,
etc.) read back from the `hello` frame, so no expectation changed.

---

## 6. Verification — failing LISTS, before and after

Re-baselined on this tree first (it is shared and moving); both baselines match
`_214`.

| Suite | Before | After |
|---|---|---|
| `tests/companion/*.test.js` (`--test-concurrency=4`) | **214 / 214**, failing list EMPTY | **214 / 214**, failing list EMPTY |
| `tests/audio/*.test.{js,mjs}` | **641 / 641**, failing list EMPTY | **641 / 641**, failing list EMPTY |
| the four touched files alone | — | **20 / 20** |

**Failing-list delta: none, in either direction.** Totals are unchanged because
no test was added or removed — the new locks are assertions inside existing
tests. The companion suite was re-run three times (once more after a whole-file
renumber) to confirm stability; identical every time.

`python scripts/security_check.py --all` → **6 findings, identical to the
`_204` / `_207` / `_214` baseline**, all pre-existing MACs inside gitignored
`simulation/.scene_backups/`. None in my files. No IP literal, no date and no
secret was added by this thread.

### Residue

- **`marsin_engine/states/**` (41 files) SHA-256'd before the first run and
  after the last: only `states/titanic/{deck_state,globals_state}.yaml` moved.**
  All six `audio_state.yaml` files — the only state anything in my path reads —
  are byte-identical. Nothing I ran spawns an engine or writes deck/globals, and
  every companion I spawned had `MARSIN_STATE_DIR` pointed at a temp root. That
  is the operator's live engine autosaving the running show. **Reported, not
  reverted, not committed.**
- **Temp cleanup:** one concurrency-4 run left three `*_companion_state_*` temp
  dirs behind; a clean re-run left none. `cleanup()`'s `fs.rmSync` is
  best-effort by design (`_214`), and Windows occasionally refuses the recursive
  delete right after a `SIGKILL`. Cosmetic, transient, no test impact — noted as
  follow-up 3 rather than papered over.

### Files touched

- `marsin_engine/tests/helpers/companion_isolation.mjs` — new `isolatedStateRoot()` export; `isolatedCompanionEnv()` reimplemented on top of it; consumer list in the header corrected
- `marsin_engine/tests/companion/companion_new_signals.test.js` — isolated env + `assertEngineLinkDown` + 2 tracked-config locks
- `marsin_engine/tests/companion/companion_osc_accounting.test.js` — isolated env in `withCompanion` (+ `hello` capture and 2 locks); `isolatedStateRoot` for the two production-port tests; comment block explaining why the four arg-parse refusals take no env
- `marsin_engine/tests/companion/companion_live_edit_collisions.test.js` — isolated env + `assertEngineLinkDown` + 1 tracked-config lock
- `marsin_engine/tests/companion/companion_derived_patch_order.test.js` — isolated env for the two inline-spawn tests `_214` missed

---

## Follow-ups (not done here)

1. **The two production-port tests hardcode the show ports** (6968 / 10000)
   rather than reading them out of the tracked `config.yaml` they are asserting
   about. If those endpoints ever move, the tests keep passing while guarding
   the wrong thing. Reading `companion.engine.port` / `companion.osc.port` from
   the tracked config would make them self-updating — deliberately left alone
   here because it is an assertion-semantics change, not a hermeticity one.
2. **`tools/genre_eval.mjs`, `tools/signal_eval.mjs`,
   `tools/pattern_derived_harness.mjs`** still read the effective config
   (`_207` follow-up 2, `_214` follow-up 2 — unchanged). None is a gate today;
   `_214`'s gate/explore split is the template if that changes.
3. **`isolatedCompanionEnv().cleanup()` can lose the race with a just-killed
   child on Windows** and leave a temp state root behind (measured once under
   `--test-concurrency=4`, §6). A short retry around the `rmSync` would close
   it; left alone because best-effort cleanup is the helper's existing,
   deliberate contract and a hard failure there would be worse.
4. **`config.yaml` comments are still destroyed by any autopilot save**
   (`_204` follow-up 3, `_214` follow-up 4) — unchanged, and now slightly more
   load-bearing: the new locks read `config.yaml` directly through
   `loadTrackedAudioAnalysisConfig`, so an autopilot save racing a test run
   would make them fail loudly rather than silently. That is the correct
   direction, but it is one more reason the hazard is worth closing.
