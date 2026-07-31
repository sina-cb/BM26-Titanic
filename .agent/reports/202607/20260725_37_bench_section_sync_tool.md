# 20260725_37 — Phase A slice 4: bench-as-section sync tool + sentinel refusal

**Author:** developer (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-28
**Plan:** `20260725_33` §3 (option B) + §6 step 4 — `dev/bench_section_sync`.
**Scope:** the derivation tool and the placeholder-IP refusal. The block is
**NOT applied** to the titanic scene: that is plan step 6 (Phase B).
Per `security_privacy.md` IPs are redacted here as `10.x.x.NNN`; the real values
live in the functional scene YAML.

---

## 0. TL;DR

`test_bench` becomes a **derived, `TB `-prefixed copy** inside another scene,
produced by `simulation/tools/bench_section_sync.cjs` from the real bench scene,
which stays the **single source of truth**. The tool is offline, deterministic
and **byte-identical on re-run**; it **refuses** — with distinct exit codes and
named findings — on a bench that contradicts itself, on a target that cannot
legally accept the block, and on an already-applied block that anyone
hand-edited. Nothing is ever silently reconciled.

The sentinel half is done too, and the finding is that the old behaviour was
**worse than the plan assumed**: the bridge did not attempt a send to
`0.0.0.0` — it dropped it **in silence**, on one inline condition that also
swallowed loopback. Silence is the bug: an operator staring at dark hardware
could not distinguish "no controller declared" from "controller declared, route
discarded". Refusals are now classified, named and logged once each.

Two things Phase B must absorb, both discovered by building this:

1. **The titanic view-bit budget is nearly exhausted.** Applying the bench block
   takes the scene to **30 of 31** available view bits — and Phase B step 5 also
   wants to author named audit views, which consume the same bits. The tool
   reports the budget on every run and refuses when it would overflow.
2. **Negative zero is a real idempotency hazard** in this data (the bench stores
   `rotX: -0.0`). YAML keeps the sign, JSON/digest do not; unnormalized, two
   blocks can agree on their digest while emitting different bytes.

---

## 1. What was built

| Path | Role |
|---|---|
| `simulation/lib/bench_section.cjs` | Pure derivation, source-integrity checks, target-compatibility checks, invariant projection + parity comparison. Node built-ins only. |
| `simulation/tools/bench_section_sync.cjs` | CLI wrapper: scene I/O, deterministic YAML emission, exit-code contract. |
| `simulation/tests/bench_section_sync.test.js` | 39 tests. |
| `simulation/lib/bridge_routing.cjs` | **+** `classifyRouteIp` / `partitionRoutePairs` — the sentinel refusal, pure. |
| `simulation/server/sacn_bridge.js` | Uses them; one named warning per refused route, to console **and** the monitor panel. |
| `simulation/tests/bridge_routing.test.js` | **+** 6 tests (10 → 16). |

Nothing else was touched. The real `test_bench` scene was never written to; no
scene YAML, no model, and no engine/sim process was modified or started.

## 2. Tool contract

```text
node simulation/tools/bench_section_sync.cjs [options]

  --source <scene>    read-only source            (default: test_bench)
  --target <scene>    scene the block is for      (default: titanic)
  --prefix <str>      namespace prefix            (default: "TB ")
  --dock <x,y,z>      dock offset beside the ship (default: 45,0,0)
  --out <path>        write the block YAML        (default: stdout)
  --check             compare-only, emit nothing
  --require-applied   under --check, an ABSENT block is a failure (Phase B gate)
  --strict            placeholder sentinels become failures (hardware gate)
  --json / --quiet    machine-readable report / silence the human summary

exit 0  ok
exit 1  usage or IO error (incl. --apply, which is Phase B, and unknown flags)
exit 2  REFUSED — the source scene contradicts itself
exit 3  REFUSED — the applied block diverges from the source
exit 4  REFUSED — target collision (namespace, reserved universe, view budget)
exit 5  REFUSED — --strict and placeholder sentinels remain
```

### 2.1 The two field tiers — this is the whole design

Copying everything would make every operator nudge look like drift; copying too
little would let a rewire slip through. So the block splits fields:

- **INVARIANT** (parity-enforced, divergence ⇒ refusal) — exactly plan §3B's
  list: controller `ip`/`type`/`protocol`, port index, universe, `startAddress`,
  **chain order**, chain member names, DMX `at` addresses, the LED `led:` wire
  block, the `device:` binding, fixture identity (name/group/`fixtureType`),
  strand identity and **pixel counts**.
- **TARGET-LOCAL** (seeded, then owned by the operator, never a failure) —
  placement (position/rotation/scale) and sim-preview look (colour, intensity,
  brightness, enabled, diffusion…). The operator may re-dock or re-colour the
  bench inside titanic without tripping the gate.
- **STRIPPED** (never carried across) — `device.lastPush` (a timestamped push
  receipt), `sectionId`/`fixtureId`/`viewMask`/`controllerId`, and controller
  `id`. These are **re-derived by the registry in the target scene**; importing
  the bench's numbering would drag bench id collisions into titanic wholesale.
  This is the direct seam with slice 1 (`_34`): the bench strands carry
  `sId 5/6, fId 11/12` — precisely the ids that must not cross a scene boundary.

### 2.2 Output

Run of record against the real scenes: **2 controllers, 12 fixtures, 2 strands /
40 px, U[1,2,10,12]**, 7,911 bytes, digest `3610e53583fd…`, `parity=absent`
(nothing applied — the correct Phase A state). Groups become `TB ParLights`,
`TB BarLights`, `TB VintageLights`, `TB SpecialEffects`, `TB TE Sign`; strands
become `TB LED_0` / `TB LED_1`. The `TB ` prefix on the sign group matters:
titanic already owns a group literally named `TE Sign`, and the prefix is what
keeps the two distinct in sections and views.

Fixtures are docked at **x + 45**, clearing titanic's own maximum (x ≈ 33.7) —
asserted in a test against the live scene rather than eyeballed, so a future
titanic extension that grows past the dock fails loudly.

## 3. Idempotency — how it is proven, not asserted

Determinism comes from: canonical key ordering, name-sorted collections, no
timestamps, no volatile fields, and negative-zero normalization. Evidence:

- **Byte-identical re-run.** Two CLI runs to different files, `cmp` clean
  (7,911 bytes each).
- **Source key order is irrelevant.** A test reverses every fixture's key
  insertion order *and* the fixture array, and re-derives to the same bytes.
- **Digest tracks electrical truth only.** Recolouring a par leaves the digest
  unchanged; moving one chain address changes it. A `device.lastPush` update —
  which happens on every real LED push — does **not** move the digest and does
  **not** trip parity (dedicated test).
- **Negative zero.** Found by a failing test, not by inspection: the bench
  stores `rotX: -0.0`; YAML round-trips the sign, `JSON.stringify` (and so the
  digest) does not. Two blocks could therefore agree on their digest while
  emitting different bytes. `-0` is now normalized to `+0` at derivation —
  value-preserving for a rotation — and pinned by a test.

This matters because the sim **re-projects and re-saves scene YAML on every page
boot** (`main.js:718`); a copy that drifted a little per cycle would rot
invisibly. It cannot.

## 4. Divergence refusals — each falsified once

**Source integrity** (exit 2) — refuses to derive from a bench whose own layers
disagree, because the disagreement would be baked into the target:
chain references a nonexistent fixture · `controllers.yaml` address ≠
`patches.yaml` · universe mismatch · IP mismatch · a patched fixture no chain
reaches · one fixture chained off two ports · strand `ledCount` ≠ patch
`pixelCount` · LED segments not summing to the declared count · address outside
1..512 · no controllers at all. The real bench scene is **clean** on all of them.

**Target compatibility** (exit 4) — a `TB `-namespace squatter the block does not
own; a titanic fixture occupying a bench-reserved universe (U1/U2/U10/U12, the
O3 reservation); the view-bit budget overflowing 31.

**Applied-block parity** (exit 3) — a hand-edited chain address (reported as
`controllers[0].ports[0].chain[0].at: derived=1 target=250`), a changed
controller IP, a **dropped chain member** (silent unwiring), an edited `led:`
wire block. Conversely, target-local edits — position, colour, brightness, and
registry-assigned `sectionId`/`fixtureId` — are explicitly proven **not** to trip
the gate.

Degrees are honest: a `0.0.0.0` controller in the source **warns** and still
derives (the plan requires placeholders to unblock the sim audit) and only
**fails** under `--strict`, the hardware gate.

## 5. The sentinel refusal (`0.0.0.0`)

Plan §7 flagged this as UNVERIFIED. Verified now: `sacn_bridge.js:177` filtered
`0.0.0.0` inline, alongside `127.0.0.1` and `localhost`, and **said nothing**.
So the plan's "never an attempted send" already held; **"never a silent skip"
did not** — and that was the operationally dangerous half.

`classifyRouteIp` now returns a status + a reason for each refusal:
`sentinel` (`0.0.0.0` — placeholder, real IP not authored yet), `missing`
(patched to a universe but to no address), `broadcast` (`255.255.255.255` —
refusing to flood the LAN), `loopback` (the sim *is* this host; relaying would
echo into the bridge). The bridge logs **one named warning per (scene, universe,
ip)**, naming the fixtures that asked for the dead route, to the console and the
monitor panel.

The refusal set is deliberately **tight**: only those four cases are refused and
everything else is admitted exactly as before, including hostnames. Guessing at
"looks malformed" would risk silently dropping a working route — the very
failure mode this exists to end.

**No behaviour change on today's tree**, measured across all seven scenes with a
`patches.yaml`: identical route counts (studio 8, studiodj 10, summer_camp_dome
7, summer_camp_logsville 7, test_bench 4, titanic 0, studio_top_loft 0) and
**zero** refusals — no scene currently declares a sentinel or a loopback. The
loudness only appears when Phase B authors the first placeholder controller.

## 6. Relationship to the parity validator (slice 2)

Slice 2 landed during this slice and implemented its **own** check 6 rather than
consuming this library. The two were verified to agree rather than reconciled by
edit — the validator is a sibling's file and was not touched.

Cross-check, in memory, no scene on disk modified: applying this tool's derived
block to the titanic scene and running `checkSceneModelParity` yields **0
bench-parity findings**; mutating one chain address then produces exactly one
`bench_controller_drift` error — the same edit this tool refuses. Both use the
`TB ` prefix, both treat an absent block as not-applicable, both name
"re-run the sync tool" as the remedy.

They are not equivalent, though: `compareBenchSection` is the stricter superset
(it also covers `startAddress` and the `device:` binding, and reports **dotted
diff paths** rather than a joined string). **Recommended follow-up (Phase B, not
done here to respect slice boundaries):** have `checkBenchParity` in
`simulation/lib/scene_model_parity.cjs` delegate to

```js
const { deriveBenchSection, extractBenchSection, compareBenchSection }
  = require('./bench_section.cjs');
```

so there is one definition of "invariant" instead of two that must be kept in
step by hand.

## 7. What Phase B still has to do

1. **Free a view bit before applying.** Titanic sits at 23 group bits; the bench
   block adds 7 → **30/31, one spare**. Step 5 also wants named audit views
   (per-side, strands, sign, bench), each consuming a bit. Applying the bench
   block *and* authoring more than one custom view **overflows the 31-bit export
   ceiling**. Decide: fewer custom views, or fold the five `TB ` fixture groups
   into fewer bits (e.g. one `TB ` bit + custom views), or lift the ceiling.
   The tool refuses on overflow rather than letting the exporter throw later.
2. **Apply the block** (`--apply` is deliberately unimplemented here). This must
   run against the live sim so the registry re-projects patches, mints target
   ids and the browser exporter regenerates the model — there is no headless
   regen path.
3. **Assign controller ids** at apply time from the target registry
   (`nextControllerId`), and reserve U1/U2/U10/U12 in the O3 universe plan.
   The tool enforces the reservation but cannot author it.
4. **pixelCount grows** (~981 → ~1,021 with 40 bench px), so hot reload refuses
   and slice 3's `POST /scene/reload` is the apply path.
5. **Then gate with `--check --require-applied`** (exit 3 while unapplied) plus
   the sibling validator, and add both to the scene-change auto-checks.
6. **O8 remains open** — the bench strands are 20 px each here; if they are
   really 40, fix the *bench* scene and re-derive. Never the copy.

## 8. Verification + honesty notes

- **Sim suite: 698 pass / 0 fail.** My baseline at session start was 591; the
  final number includes two sibling slices that landed concurrently in the same
  working tree. **My own contribution is +45 tests** (39 new + 6 added to
  `bridge_routing.test.js`, 10 → 16), all passing, and the full suite is green
  with all four slices interleaved.
- `node --check` clean on all four touched/added modules, including
  `sacn_bridge.js` — which was edited but **not executed**: the operator owns the
  live stack (6966-6972, 5568) and nothing was started, restarted or probed. The
  bridge change is therefore proven by unit tests over the pure seam plus a
  scene-wide route-count comparison, **not** by a running bridge. A live
  confirmation belongs to the Phase C smoke.
- The tool has never been run in a mode that writes to a scene, because no such
  mode exists yet.
- **Untidy residue, disclosed:** an early run wrote the block via a `~/tmp/...`
  path that Git Bash expanded to `/c/...` and Node resolved to `C:\c\...`. The
  stray file and its subdirectories were removed; an **empty `C:\c` directory
  remains** because removing it is blocked as a protected system path. It is
  empty and outside the repo. The scratch outputs live in the session scratchpad.
- The view-bit arithmetic counts one bit per distinct fixture group plus one per
  strand (a strand with no group takes a bit under its own name), which matches
  the observed `groupBits` in both scenes' `views.yaml`. It is a projection of
  the exporter's behaviour, not a re-execution of it — the exporter is
  browser-only.
