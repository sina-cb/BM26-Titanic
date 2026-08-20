# 20260725_89 — the test bench becomes a WINDOW ONTO THE SHIP

**Author:** developer (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-31
**Operator order:** *"set up test bench to show part of the titanic scene for me —
led bars, par lights and vintage lights! LED strings too."*

The engine runs the **titanic** model. The bench boxes now show exactly the bytes
that named titanic fixtures are being sent, so titanic patterns can be previewed
on the desk. **Nothing on the hardware changes** — no fixture is re-addressed, no
gateway port is re-bound, no controller push is required.

Per `security_privacy.md` every IP here is redacted as `10.x.x.NNN`; the real
values live in the functional scene YAML. Zero writes to `simulation/scenes/titanic/**`
or to any model export (verified against `git status` after the browser session).

---

## 0. TL;DR

| | |
|---|---|
| **Design** | A **bench mirror**: a bridge-side re-address stage, configured by a `test_bench` scene sidecar. Sources are read off the wire, re-addressed, composed into the universes the bench boxes ALREADY listen on, and unicast to them. |
| **Why not pure config** | Only the pars line up. Bars and vintage do not, and the DMX start address lives in the physical fixture. |
| **Slice shown** | The ship's **left front** — 2 wall bars, 2 deck rails, 4 auditorium pars, 2 port ropes. One region, so spatial patterns read correctly. |
| **Operator steps** | **Zero device pushes.** One launcher restart to pick up the code, and run the sim pinned `--scene test_bench` while the engine is on titanic. |
| **Tests** | Sim suite 1452 → **1482** (+30), fail **10 → 10**, byte-identical failing list. New file 30/30. |

---

## 1. The measurement that decided the design

Both scenes use the same three DMX fixture families, so the only question was
whether the **start addresses** line up. They mostly do not:

| family | footprint | titanic start addresses | bench start addresses | verdict |
|---|---|---|---|---|
| `UkingPar` | 10 | 1, 11, 21, 31 (on U6, U8, U12, U13, U14, U19, U21, U25, U26, U27) | 1, 11, 21, 31 | **exact match** |
| `VintageLed` | 33 | 1, 34, 67, 100 (U5, U7, U18, U20) | 41, 74 | no alignment anywhere |
| `ShehdsBar` | 119 | 1, 120 (U2, U3, U4, U9, U10, U11, U15, U16, U17, U22, U23, U24) | 107, 226 | no alignment anywhere |

So **candidate 1 (pure config) solves exactly one third of the mission.** The par
port could be pointed at any titanic par universe and would be byte-for-byte
correct; there is no titanic bar starting at 107 or 226 and no titanic vintage
starting at 41 or 74, in any universe, so those bytes have to be MOVED. The brief
forbids assuming the operator can re-address bench hardware, and re-addressing
would also break the bench for ordinary bench work.

**The LED half needed neither.** A MarsinLED output is an independent receiver on
its own `{universe, startAddress: 1}` (memory `marsinled-controller-onboarding`,
docs/41 §3) — there is no address to line up, only a universe. That made a pure
re-point possible… but see §3 for why it was still routed through the mirror.

### What actually reaches the bench, and from where

Worth stating because it is the load-bearing fact: the engine unicasts every
model universe to `127.0.0.1`; the sim's **sACN bridge** is what forwards a
universe to a controller, and its relay table is derived from the ACTIVE SCENES'
`patches.yaml` — not from the engine. So the bench's own scene is already the
routing authority for the bench hardware, and the bridge is the one component
that (a) sees every titanic universe, (b) already owns "what reaches which box",
and (c) lives in files this mission is allowed to edit. The engine was the other
candidate and was rejected: its mirror map would have to live in
`marsin_engine/config.yaml`, which is operator-WIP, or in the model export, which
is operator-owned.

## 2. Chosen design — the bench mirror

```
engine (titanic model) ──unicast──▶ sACN bridge ──┬── ordinary relay  (unchanged)
                                                  │
                                                  └── BENCH MIRROR
                                                        splice slices into a
                                                        persistent 512-byte
                                                        buffer per destination,
                                                        unicast to the bench box
```

A mirror declares, per destination universe, a list of **slices**: *copy `length`
channels from `source_addr` on `source_universe` to `dest_addr`*. The destination
universes are the ones the bench boxes already listen on, which is why there is
nothing to reconfigure on the hardware.

### The slice — the ship's left front

| bench fixture | @ | ← titanic fixture | from | ship controller |
|---|---|---|---|---|
| Par 1-4 | 1, 11, 21, 31 | Left Auditorium 5, 6, 7, 8 | U6 ch 1-40 | LeftFrontDeck |
| Vintage Left | 41 | Left Front Rails 1 | U5 ch 1-33 | LeftFrontDeck |
| Vintage Right | 74 | Left Front Rails 2 | U5 ch 34-66 | LeftFrontDeck |
| Bar Left | 107 | Left Front Wall 1 | U2 ch 1-119 | LeftFrontWall |
| Bar Right | 226 | Left Front Wall 2 | U2 ch 120-238 | LeftFrontWall |
| LED_0 | U10 | Left_Front_Left px 1-20 | U30 ch 1-80 | LeftLeftRopes |
| LED_1 | U12 | Left_Back_Left px 1-20 | U31 ch 1-80 | LeftLeftRopes |

92 model pixels, centroid `(-22.8, 7.6, 12.4)` — one contiguous neighbourhood
(see §7). Composed bench U2 occupies channels 1-344 of 512, no overlaps.

Every source is a fixture with a **record in `titanic/patches.yaml`**, deliberately.
Six of the eight titanic ropes are patched in `controllers.yaml` but have no patch
record (they are part of the standing stale-model failure set); mirroring one of
those would go dark the moment the operator re-exports. `Left_Front_Right` (U32)
would have been the tighter spatial pick for LED_1 and is a one-line change in the
YAML if he patches it.

### Why the bars/vintage/pars all go through the mirror even though the pars align

Because mixing would cost a gateway edit and buy nothing: pointing port 1 at U6
means opening the box's own config, and ports 2 and 3 would still need the mirror.
One mechanism, zero device edits, one thing to explain. The par slice is
nonetheless a pure identity copy (`U6 ch1-40 → U2 ch1-40`), which is the alignment
finding put to work rather than thrown away.

## 3. Why the LEDs are mirrored instead of re-pointed

The `.60` box could simply be pushed onto U30/U31 and driven by the titanic
scene's own relay — indeed the operator already bound it in the titanic scene as
`LeftLeftRopes` and his last push there reads `outcome: needs-reboot`. Rejected,
because a device has ONE config: on U30/U31 the bench scene's own LED work goes
dark, and it costs a push. Mirroring into the bench's existing U10/U12 keeps both
modes alive and costs nothing.

**Consequence, and the one thing to check:** the box must be on **U10/U12** (its
bench binding). If that `needs-reboot` push from the titanic scene landed, it is
on U30/U31 and the bench strands will be dark. See §6.

Two honest caveats:
- **20 px vs 40 px.** The bench scene declares 20 px per strand; the titanic ropes
  are 40. The mirror copies the first 20 pixels. If the physical strands are
  really 40 (open item O8, report `_37` §7.6), fix the **bench scene** and change
  `length: 80` → `160`.
- **Gamma/wire treatment.** The bench scene's `led.wire` block (foldAmber, gamma
  2.2) is applied at model-export time; titanic's ropes carry no such block. The
  bench strands therefore show titanic's bytes verbatim, which may read slightly
  differently from the same pattern under the bench model. Correct for a
  stand-in; noted so it is not mistaken for a bug.

## 4. Safety — three preconditions and one ownership rule

**Activation requires ALL THREE** (`isMirrorActive`), and each is a declared
precondition, never a fallback:

1. `enabled: true` in the file.
2. **The ENGINE is on `source_scene`.** The map re-addresses by POSITION in a
   specific model's universes; running it against `test_bench` bytes would splice
   par data into a bar's control channels. Wrong model ⇒ inert, and the ordinary
   relay is not suppressed, so the bench behaves exactly as it always has.
3. **The spec's own scene is active** (CLI pin / engine / a connected client).
   This is the **deployment guard**: the file rides along in a `robocopy /MIR`
   deploy, and on the show server the launcher is pinned to `titanic` with no
   bench window open — so the mirror stays inert and the ship's real gateway on
   the same address keeps its ordinary relay. Verified by harness (§5).

**One writer per (universe, controller)** — the standing law from `20260724_15`.
While active, the mirror OWNS its destination pairs: they are removed from the
relay route set *before* the sender diff, each with a named log line. Without that,
raw titanic U2 and the composed bench U2 would both land on the box.

Remaining hazard, unchanged and pre-existing: a sim window in **sACN-OUT** mode is
an independent priority-150 writer and outranks the mirror at the box (open item
"writer #2", `20260724_15` §2.3). Do not run one against the bench while
previewing. The capture tool written for this report holds `__readonlyMode` for
exactly that reason.

**Fail loud on the spec.** Unknown key, missing key, wrong version, non-integer,
a range that walks past channel 512, two slices claiming one destination channel,
a destination declared twice, or a `dest_host` the relay would refuse — each
THROWS with the offending YAML path named, and the bridge refuses that whole spec
with one warning rather than applying it partially. A half-right re-address map is
wrong fixtures with a green log.

## 5. Verification

### 5.1 The real bridge, driven with fake `sacn` / `ws`

The operator's stack owns 6967-6972 and 5568 and was never touched: no port bound,
no multicast group joined, no datagram sent. The REAL `sacn_bridge.js` was loaded
in a throwaway process with the two packages replaced by fakes and `fetch` stubbed
to report an engine scene.

*Scenario 1 — engine `titanic`, pin `test_bench` (the intended shape):*

```
🪞 BENCH MIRROR ACTIVE — scene 'test_bench' is showing 'titanic' fixtures.
🪞   composes U2  → 10.x.x.10 (5 slice(s), 344 ch, from U6+U5+U2)
🪞   composes U10 → 10.x.x.60 (1 slice(s), 80 ch, from U30)
🪞   composes U12 → 10.x.x.60 (1 slice(s), 80 ch, from U31)
🚫 Relay suppressed: U2  → 10.x.x.10 — the BENCH MIRROR composes this universe …
🚫 Relay suppressed: U10 → 10.x.x.60 — … (declared by scenes: test_bench)
🚫 Relay suppressed: U12 → 10.x.x.60 — … (declared by scenes: test_bench)
```

Five distinguishable ramps injected on U6/U5/U2/U30/U31 produced ONE composed
frame per destination (`setImmediate` coalescing, §5.3) with:

```
ch1=1 ch40=40 | ch41=101 ch73=133 | ch74=134 ch106=166 | ch107=201 ch225=63
| ch226=64 ch344=182 | ch345=0        ✅ composed bytes correct
                                      ✅ raw U2 relay suppressed
LED: U10 ch1=51 ch80=130 ch81=0 · U12 ch1=71 ch80=150 ch81=0
```

Every byte lands where the table in §2 says. `ch345`/`ch81` are 0: a full
512-channel frame is always sent, so a channel the map never writes cannot hold
whatever the box last had.

*Scenario 2 — engine on `test_bench` (wrong model):* no mirror, no suppression,
`U2 → 10.x.x.10` relayed raw. *Scenario 3 — pin `titanic`, engine `titanic`, no
bench window (the show-server shape):* same — inert, raw relay intact, the ship's
gateway unaffected. Both are the deployment guard working.

### 5.2 Test suite (honest counts) — `cd simulation && npm test`

| | tests | pass | fail |
|---|---|---|---|
| Baseline (measured on this branch, before) | 1452 | 1442 | **10** |
| After | **1482** | **1472** | **10** |

**+30 tests, zero new failures, byte-identical failing list** — the known
pre-existing family (8 stale-model / real-scene-parity cases + the 2 operator
scene-drift pins). New file alone **30/30**.

Coverage: every refusal falsified once (unknown top-level and slice keys, version,
non-boolean `enabled`, missing `source_scene`, empty mirrors/slices, non-integer
and out-of-range numbers, source and destination overruns, overlapping destination
channels, duplicate destination, and each refused `dest_host` class); adjacent
slices accepted; all three activation preconditions; byte-exact composition;
**buffer persistence** (a destination fed by two sources is never half-blank when
only one source arrives); a channel dropped from the payload becomes 0 rather than
stale; a null payload zeroes rather than throws; an unknown destination throws.

Six **live-map** tests read the committed spec against the real scenes and the
real generated models, so the map cannot rot silently:
- every DMX slice is a run of **whole titanic fixtures starting exactly on a
  fixture boundary** (anything else shifts pixel data into control channels);
- every slice lands on a bench fixture of the **same footprint**;
- LED slices equal `pixelCount × 4` and start at the strand's own channel;
- every mirrored source universe is one the titanic model actually sends;
- every destination is a port the bench hardware really listens on.

Two wiring tests read `sacn_bridge.js` and pin that suppression happens before the
sender diff and that subscription happens before senders are built.

### 5.3 Design notes worth keeping

- **Coalescing.** A destination fed by three sources would otherwise be sent three
  times per engine frame, twice with a partially-updated buffer. The splice marks
  the destination dirty and a `setImmediate` flush runs after the poll phase that
  delivered the whole burst — one engine frame, one composed send.
- **Priority is carried, not invented.** The composed frame goes out at the
  priority of the source that last fed it.
- **No cache.** The sidecar is re-read on every route recompute, same doctrine as
  `_87`: edit the map, save, next recompute picks it up. Composed buffers are
  reused while the file is byte-identical, so a recompute never blanks a frame.
- **Refactor that rode along:** the relay's per-target error dedup was extracted to
  `sendVia()` and is now shared by the relay and the mirror — one implementation,
  not two that drift.

### 5.4 Gates

- `git diff --check -- simulation` — clean.
- `node --check` on all four touched/added files — clean.
- `node tools/scene_model_parity.cjs test_bench` — 4 errors, **all pre-existing**
  (`TE Sign V3 A/B` unmapped + metadata drift); no scene YAML that the validator
  reads was touched, and the sidecar is not part of the parity contract.
- `python scripts/security_check.py --all` — 6 findings, all a MAC in gitignored
  `simulation/.scene_backups/studiodj/**`, pre-existing and untouched. **Nothing in
  any file this slice touched.**
- `git status` after the browser session: `scenes/titanic/**` and
  `marsin_engine/models/**` unmodified.

## 6. What the operator has to do

**No controller pushes.** The whole point of composing into the universes the
boxes already use is that neither box is reconfigured. Concretely:

| # | Step | What to expect |
|---|---|---|
| 1 | **Restart the launcher** once so the bridge runs this code | The banner prints; the mirror is still inert until step 2 |
| 2 | Run the sim/launcher **pinned to the bench**: `npm start -- --scene test_bench` (or just open a `test_bench` sim window), while the **engine runs `titanic`** | `🪞 BENCH MIRROR ACTIVE — scene 'test_bench' is showing 'titanic' fixtures`, then three `composes …` lines and three `🚫 Relay suppressed …` lines, in the launcher terminal and the sim's 📡 sACN-IN monitor |
| 3 | Watch the bench | Pars, both vintage heads, both bars and both strands play the ship's left front. Fog/haze (port 4, U1) is untouched and simply idle — titanic has nothing on U1 |
| 4 | **Only if the strands stay dark:** the `.60` box is on U30/U31 from the titanic-scene push whose receipt still reads `needs-reboot`. Open the **test_bench** scene's controller pane, review the `Titanic_202` card, press **Push** once, let it reboot | Restores its bench binding (U10/U12 · startAddress 1). This is the ONLY push in the whole change, and it is a revert, not a new mapping |

To go back to an ordinary bench: put the engine on `test_bench`, or pin the sim to
`titanic`, or set `enabled: false`. Any one of the three, no restart needed for the
last (it is re-read on the next recompute).

**Before deploying to the show server** nothing is required — the guard in §4.3
covers it — but `enabled: false` is the belt-and-braces move if he wants the file
to be unambiguously dormant out there.

## 7. Visual verification

`simulation/agent_tools/bench_mirror_slice_capture.cjs` derives its camera from
the mirror map itself (spec → source addresses → model pixels → centroid), so the
picture cannot drift away from the map it illustrates. It ran against his live
stack under four guards: `__readonlyMode` forced true as an accessor (no
priority-150 output client), the `:6972` socket refused at the WebSocket
constructor, **every non-GET to the save server aborted by request interception**
(`saveModelJS()` on boot would otherwise rewrite the operator-owned titanic model
export — 0 blocked writes were needed in the event, and `git status` confirms it),
and display-only page mutation.

```
🪞 mirrored source fixtures (92 px): Left Auditorium 5-8, Left Front Rails 1-2,
   Left Front Wall 1-2, Left_Back_Left, Left_Front_Left
   centroid: (-22.8, 7.6, 12.4)
🖥  GPU adapter: ANGLE (NVIDIA GeForce RTX 4090 Laptop GPU, D3D11) · integrated: false
🔒 GUARD 1 held: true · GUARD 3 blocked 0 write(s) to :6970
```

Both plates (`.agent_renders/*_bench_mirror_slice_wide.png`,
`*_bench_mirror_slice_close.png`) were inspected: WebGL rendered, the ship is
lit with live engine colour, and the ten mirrored fixtures sit in one contiguous
neighbourhood on the port bow — the two ropes climbing to the foremast, the wall
bars along the hull edge, the deck rails and the auditorium pars just inboard of
them. That is the design claim the slice rests on, and it holds.

**What the sim CANNOT show:** the mirror is a wire-side transform on the hardware
path. The 3D view renders the titanic scene either way; the composed bench frame
only exists between the bridge and the boxes. It is proven by §5.1 and §5.2, and
its final confirmation is the operator's own eyes on the bench at step 3.

## 8. Files

| File | Change |
|---|---|
| `simulation/lib/bench_mirror.cjs` | **new**, pure: `parseBenchMirrorSpec`, `isMirrorActive`, `mirrorSourceUniverses`, `mirrorDestPairs`, `createMirrorState`, `spliceMirrorFrame`, `mirrorPayload`, `describeMirror` |
| `simulation/scenes/test_bench/bench_mirror.yaml` | **new**: the map, with the address table and the switch-off instructions in its own header |
| `simulation/server/sacn_bridge.js` | `readBenchMirrorSpecs()` (fresh per recompute); mirror resolution + source subscription + destination suppression inside `recomputeRoutes`; a separate mirror sender map; `mirrorInbound`/`flushMirrors` on the packet path; `sendVia()` extracted and shared with the relay; conflict report no longer counts suppressed pairs |
| `simulation/tests/bench_mirror.test.js` | **new**, 30 tests |
| `simulation/agent_tools/bench_mirror_slice_capture.cjs` | **new**: guarded capture of the mirrored cluster, camera derived from the map |

No `scenes/titanic/**`, no `marsin_engine/**`, no device HTTP, no sACN
output-enable change, no server started or stopped, no git operation.

## 9. Not done / open

- **Inert until the launcher restarts** — the ordinary "code lands, restarts on
  next launch" cost, not a workflow step.
- **The `.60` universe question is genuinely two-sided** (§3). If the operator
  would rather the box live permanently on the ship's rope universes, delete the
  two LED mirrors from the sidecar and re-point the bench scene's strands to
  U30/U31 instead — but then the bench loses its own LED mode.
- **Strand length O8** (20 vs 40 px) is still unanswered and is a bench-scene fact,
  not a mirror fact.
- **Writer #2** (a sim window in sACN-OUT mode outranking the mirror at priority
  150) is the pre-existing open decision from `20260724_15` §2.3; the mirror does
  not change it and does not work around it.
- The mirror is DMX-byte-level by design: it copies what the pattern paints on the
  named titanic fixture. It does **not** re-render the pattern at the bench's own
  coordinates — that is the different design (bench-as-section, `_37`) the operator
  did not choose, and it would need titanic-side writes.
