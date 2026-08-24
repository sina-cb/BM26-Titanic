# 346 — Smokestack Swarm asset gate and operator test sheet

## Current verdict

**STOP at asset parity. Do not run physical DMX/SWARM mode writes yet.**

The final read-only census found all four intended controllers reachable,
registry-verified, on firmware 1.2.5, and in one healthy Swarm: exactly one
leader (`ss_left_right`) and three following controllers. No physical write,
firmware deployment, mapping change, or role change was made in this task.

The fleet is intentionally left in that unchanged Swarm state. The isolated
BM test services used by this task were stopped.

## Exact parity evidence

The fleet has two asset histories:

| Controller | Expected role | Active model evidence | Asset state |
|---|---|---|---|
| `ss_left_left` | follower | pushed-map token `1cfc9081` | broad legacy data image |
| `ss_left_right` | sole leader | pushed-map token `1cfc9081` | broad legacy data image |
| `ss_right_right` | follower | filtered rope-map token `683121a1` | frozen filtered release |
| `ss_right_left` | follower | filtered rope-map token `130aa205` | frozen filtered release |

The left pair received an application-only update followed by a mapping push;
that workflow preserved their older data assets. The right pair received the
full frozen release. This mismatch is expected and the guarded preflight is
correct to refuse it. Do not weaken this gate.

Canonical acceptance facts for the frozen 1.2.5 release:

- firmware release SHA: `e046e8842986`
- active pattern: `/patterns/titanic_swarm_pattern.js`
- active model: `/models/swarm_titanic_rop_b5fc8e9e.json`
- post-release device model token: `7caea9f2`
- `/models/pushed_map.json` absent
- all four live data fingerprints equal when read after deployment

## Minimum operator-gated remediation

This step requires Sina present and explicit approval. Connect only the two
already-bound left controllers over USB and use the private registry-locked
deployment workflow to install the full frozen 1.2.5 application, WWW, and
controller-filtered data release for:

- `ss_left_left`
- `ss_left_right`

Hard stops:

- never use a full allocation clean
- never use raw filesystem/data upload, generic OTA, or light-map mode for
  this repair
- refuse any identity/allocation, board-capacity, partition-layout, or release
  hash mismatch before writing
- snapshot identity, role, output mapping, DMX origins, current owner, active
  model/pattern, and asset listings before deployment

The immutable left mappings are:

- `ss_left_left`: follower; Output 1/2 = U30/U31, address 1, 40 RGBW; Output
  3/4 disabled
- `ss_left_right`: sole leader; Output 1/2 = U32/U33, address 1, 40 RGBW;
  Output 3/4 disabled

## Post-remediation preflight — every item must pass

- [ ] Four exact canonical controller identities, with registry identity
  verification; no extra target or scan.
- [ ] Firmware 1.2.5 and release SHA `e046e8842986` on all four.
- [ ] Active pattern and model match the canonical paths above.
- [ ] No pushed map or temporary/backup asset residue.
- [ ] Compiled pattern and model assets are ready and controller-filtered.
- [ ] All four live data fingerprints are equal.
- [ ] Each controller's active model token matches its source-proven expected
  value. Do not substitute list order or an unproven cross-controller
  equality rule.
- [ ] Exact output maps remain U30/U31, U32/U33, U36/U37, U34/U35; every
  output starts at address 1 with 40 RGBW pixels.
- [ ] Exactly one saved/live leader: `ss_left_right`; the other three are
  followers.
- [ ] Guarded exact-four dry-run exits cleanly, prints the exact no-write
  verdict, and supplies a lowercase SHA-256 plan fingerprint.
- [ ] BM apply remains bound to that reviewed fingerprint; any missing or
  changed fingerprint refuses the apply.

After those checks, use the guarded exact-four BM flow to establish a clean
DMX baseline before beginning the physical cycle matrix.

## Physical operator test sheet

1. **Baseline DMX**
   - [ ] Switch the exact four to DMX through the BM UI.
   - [ ] Wait for independent four-controller readback; a CLI success alone
     is not a pass.
   - [ ] Verify all four report DMX ownership and expected sACN state.
   - [ ] Confirm mappings, identities, assets, and roles did not change.
   - [ ] Watch only Output 1 on `ss_left_left` and `ss_left_right`: both show
     the same low-output deterministic engine cue. The unlit pair remain
     healthy by API/readback.

2. **Enable Swarm**
   - [ ] Press the single fleet switch, review the zero-write plan, type
     `SWITCH`, then apply.
   - [ ] Do not accept green/safe until the independent four-controller
     readback completes.
   - [ ] Verify `ss_left_right` is the only leader and all other controllers
     are fresh followers in one topology.
   - [ ] Watch the two lit Output 1 strands: the selected Swarm pattern and
     palette must begin together, stay synchronized, and remain low/safe.
   - [ ] Confirm no split-brain, stale follower, unexpected output enablement,
     identity drift, or mapping drift.

3. **Return to DMX**
   - [ ] Use the same fleet switch and wait for exact-four readback.
   - [ ] Verify sACN resumes ownership and no local Swarm pattern remains.
   - [ ] Recheck the immutable mappings and assets.

4. **Five-cycle matrix**
   - [ ] Repeat DMX → Swarm → DMX five times.
   - [ ] Record each transition duration, retries/errors, exact final roles,
     mode, health, and the two lit strands' synchronization.
   - [ ] Re-read identity, version, model, pattern, role, owner, and output map
     after every mutation.

5. **Supported healing and idempotency**
   - [ ] Drift one follower to DMX; use explicit reconcile and prove the exact
     topology returns.
   - [ ] Put the sole leader into the documented safe inconsistent mode; prove
     repair returns exactly one leader.
   - [ ] From mixed state, DISABLE must return all four to DMX.
   - [ ] ENABLE an already-correct Swarm and DISABLE an already-correct DMX;
     both must be idempotent with unchanged maps/assets.
   - [ ] Use mocks, not a fabricated physical outage, for unreachable-board
     behavior.

6. **Final state**
   - [ ] End all four in verified DMX, Swarm disabled, mappings preserved.
   - [ ] Confirm the two lit Output 1 strands accept the deterministic engine
     cue again.
   - [ ] Stop the isolated BM UI/backend and prove its high ports are closed.

## BM implementation and validation

The BM switch path now:

- binds apply to the reviewed dry-run SHA-256 plan fingerprint
- rejects missing or changed fingerprint evidence
- evaluates board blockers before offering mixed-fleet recovery
- withholds a trusted/green apply verdict until independent exact-four
  readback verifies the requested state
- retains one-job-at-a-time, frozen repair targets, typed confirmation,
  rollback request, and fail-loud parity behavior

Focused checks passed: 100 Smokestack model/service/route/status tests, 43
controller UI/ergonomics tests, syntax checks, and Titanic scene/model parity
(zero errors or warnings). The physical five-cycle and healing matrix remains
blocked by the asset gate above; mock coverage is not a substitute for that
operator-gated validation.

## MAIN integration

The reviewed BM safety delta and its focused tests were selectively integrated
into the `feat/bm_readiness` working tree. Evidence-only browser helpers,
screenshots, generated artifacts, private paths, and runtime state were not
copied. No git operation or production restart was performed.

MAIN validation passed:

- 100/100 focused Smokestack tests
- 43/43 controller UI and ergonomics tests
- syntax checks for all three production modules
- Titanic scene/model parity in normal and strict modes, with zero errors and
  zero warnings

The broader simulator suite completed with 2,667 passes, 10 failures, and one
TODO. The failures are unrelated dirty-tree work in Live Touch multi-take,
MarsinLED client mapping-push expectations, pattern-manifest freshness, pixel
map geometry, and shared-address UI tests. None exercises the six selectively
integrated Smokestack production/test files; do not attribute those failures to
this change.
