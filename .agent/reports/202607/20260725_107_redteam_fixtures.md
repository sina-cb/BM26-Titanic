# 20260725_107 — Red-team: fixture / model / patch layer

**Report-only.** Adversarial hunt across the LED-vs-DMX classification, the
exporter, `scene_model_parity`, orphan detection, the TE-sign RGBW generator,
and the 2D pixel-map view defaults. **Zero source edits. Zero writes to
`scenes/**`, `models/**`, or `dmx/fixtures/**`** — the generator was run only
with `--dry-run` (or `--out-dir` into `~/tmp`), the parity gate is read-only,
and every mutate-and-check used fabricated inputs to the pure parity lib.
Repro harnesses: `~/tmp/redteam_fixtures/` (gitignored scratch).

Baseline: `node simulation/tools/scene_model_parity.cjs titanic` → 4 errors
(the four `unmapped_fixture` TE-sign rows, in-progress by design) + 11 info.

**Score: 2 HIGH, 2 MED, 2 LOW. No CRITICAL.** The generator and orphan modules
are hard. The two HIGHs are both in the parity gate's LED lane — it is blind to
two silent-dark / silent-mispatch classes that its DMX lane already catches.

---

## HIGH-1 — RGBW LED-bus fixture on an RGB-order controller passes `--strict` clean
**Category: silent-mispatch + parity-blind-spot.** This is the `_92` RGB↔RGBW
error class, re-openable through controller configuration and invisible to the
gate that was built to catch it.

**Repro:** `~/tmp/redteam_fixtures/h2_control.cjs`
```
order=RGBW modelStride=4 -> errors 0            (correct config)
order=RGB  modelStride=3 -> errors 0            (BUG: silent)
order=RGB  modelStride=4 -> errors 2: strand_stride_mismatch,strand_channel_map_mismatch
```

**Mechanism.** A TE sign definition declares its PHYSICAL format as ground
truth: `type: rgbw`, `channel_mode: 160`, 4 bytes/pixel (the generator hardcodes
`BYTES_PER_PIXEL = 4` and comments that this "keeps the generated definition
honest about the hardware"). But at export/patch time the owning controller's
`led.order` is taken as the SOLE authority — identical to a rope strand, which
has no declared physical truth. So if the operator chains an RGBW sign onto a
MarsinLED output configured `order: RGB` (a legitimate order for RGB ropes,
accepted by `normalizeLedConfig`):
- the exporter emits **stride-3, white-less** pixels (`pixelblaze_model_exporter.js`
  LED-bus branch: `footprint: ledProj.stride`, `channels: LED_CHANNEL_ORDERS[order]`);
- `scene_model_parity` **discards the definition's channel map** for LED-bus
  fixtures (`buildExpectedRoster`: `channels: ledBus ? undefined`) and never
  compares `channel_mode` against `stride × pixelCount`, so it has no
  independent truth to object with.

Result: on RGBW pucks the whole chain is byte-shifted (each puck addressed 3
bytes apart instead of 4) and every white LED is dead — a scrambled, dim sign —
and BOTH the sim export and `--strict` accept it. Parity only fires when the
model and the controller DISAGREE (row 3 above); when the operator sets the
wrong order and re-exports, they agree on the wrong value and it goes silent.

**Observed:** 0 errors under `--strict`.
**Expected:** an error — an LED-bus fixture whose definition declares N
bytes/pixel is chained on an output whose order implies a different stride.

**Hardening:** cross-check the LED-bus fixture DEFINITION's declared footprint
against the owning controller's order at parity time (and ideally warn in the
sim's controller-map pane on push). Concretely: in `checkLedStrandPatch`, for an
`ledFixture` owner, assert `stride === maxChannel(def.pixels[0].channels)` (=4
for the signs) and that `def.channel_mode === stride × owner.count`. This is the
one place the sign's physical truth is available and currently thrown away.

---

## HIGH-2 — Dark rope: strand/LED-bus fixture on an UNBOUND LED controller passes clean
**Category: parity-blind-spot (silent-dark).** The `_92` "patched but
unroutable" class. Parity trusts `patches.yaml` as LED binding truth and never
re-derives the LED binding GRADE from `controllers.yaml`.

**Repro:** `~/tmp/redteam_fixtures/h_unbound_darkrope.cjs` → 0 errors, `--strict`.

**Mechanism.** The sim projects LED patches only for `isBoundLedController`
(controller has a `device:` block — verified OR provisional; `_96`). An unbound
LED controller → no `patches.yaml` record → the exporter marks its strands
UNPATCHED. But `scene_model_parity` never reads `controller.device` (grepped:
the module touches `controller.led` only, never `.device`). For an LED
strand/fixture its checks key off whether a `patches.yaml` record EXISTS:
- `checkLedStrandPatch`: record present + model patched → validate the walk →
  consistent (both stale together) → PASS;
- there is **no LED equivalent of DMX's `patch_record_disagrees_with_chains`**
  (that loop returns `null` early for LED via `expectedRecordFor`).

So a scene whose `device:` block was removed (unbind) after the last export,
without regenerating, keeps a stale patched record + stale patched model. A
FRESH export would drop the record and render the rope dark; parity reports it
green. This is exactly the mission-critical failure mode — an exterior rope that
looks fine in the gate and is dark on playa. (The "no chain at all" case IS
caught by `unmapped_strand`; the hole is specifically *chained on a controller
that is now unbound*.)

**Observed:** 0 errors. **Expected:** the strand should be flagged unpatched
(the fresh-export truth), or a `led_record_without_binding` error.

**Hardening:** re-derive LED binding grade in `buildWiring` (does the LED
controller carry a `device:` block?) and add the LED analogue of
`patch_record_disagrees_with_chains`: a patched `patches.yaml` LED record whose
owning controller is unbound is stale — error.

---

## MED-1 — Address-hygiene models an LED-bus fixture as one DMX block, ignoring `segments`
**Category: stride-error + parity-blind-spot.** Harmless for today's 160/136-ch
single-universe signs; a latent trap for the extensible LED-bus fixture kind.

**Repro:** `~/tmp/redteam_fixtures/h_ledfixture_hygiene.cjs` (200-px RGBW LED-bus
fixture, U5 spill):
```
spill segments: U5:1-512x128, U6:1-288x72
errors: 1
  error address_hygiene/patch_address_out_of_range :: fixture 'Big'
        (…spanning ch 1–800 with its 800-channel footprint…)
```

**Mechanism.** `checkAddressHygiene` claims a fixture's channels as one
contiguous block `[dmxAddress, dmxAddress + def.footprint - 1]`. For STRANDS it
correctly uses `record.segments`; for LED-bus FIXTURES it does not (no
`isLedBusDef` branch). So a spilling LED-bus fixture:
- **false-positives `patch_address_out_of_range`** (footprint 800 > 512) even
  though `checkLedStrandPatch` validated the same no-straddle walk as CORRECT —
  the gate contradicts itself; and
- its true occupancy on the spill universe (U6) is **never pushed to `claims`**,
  so a genuine cross-fixture collision on U6 would be MISSED.

Also under HIGH-1's misconfig (stride 3, def.footprint 160) the block OVERSTATES
occupancy by 40 bytes → possible false `duplicate_address` against a legitimate
neighbor.

**Hardening:** in `checkAddressHygiene`, treat an LED-bus fixture like a strand —
push its `record.segments`, not a `def.footprint` block.

---

## MED-2 — `ledStride()` accepts a sub-minimum stride the sim would refuse to boot on
**Category: quirk (diagnostic gap).** `scene_model_parity`'s `ledStride()`
returns any positive `led.stride` without enforcing `stride ≥ minStride(order)`.
The sim's `normalizeLedConfig` HARD-THROWS on this (order RGBW needs stride ≥ 4),
so a hand-edited `controllers.yaml` with `order: RGBW, stride: 3` never boots —
but parity accepts the config and, against a stale RGBW/stride-4 model, reports a
misleading `strand_stride_mismatch` ("re-export the model") instead of naming the
impossible controller config. Not silent data loss; wrong diagnosis on a config
the sim already rejects.

**Hardening:** in `ledStride()`, if an explicit `led.stride` is below
`max(order channels)`, emit a dedicated `led_stride_below_order` error rather than
silently using it.

---

## LOW-1 — te_sign generator: cosmetic
`SHARED_PANEL` lists each shared panel once per occurrence (`sharedPanels` is not
deduped) — the error can be 40 items long. And a panel that reappears within one
side (P1…P2…P1) is not flagged; the `start/mid/end` role annotation is counted
over ALL rows of a panel regardless of contiguity, so the generated comment can
mislabel roles. Comment-only; no addressing impact.

## LOW-2 — LED-bus fixture footprint never cross-checked (root hook for HIGH-1)
Recorded separately as the concrete fix hook: nothing at scene / patch / parity
time validates an LED-bus definition's declared `channel_mode` / pixel `type`
against the stride the controller actually drives it with. The generator asserts
count↔footprint at BUILD time; downstream, that truth is dropped.

---

## What HELD (attacked, did not break)

**`gen_te_sign_fixture.js` — bulletproof.** Every malformed CSV fails loud
(verified `--dry-run`): bad/missing header column, duplicate `wire_order`, gap /
non-monotonic wire, extra row, short row, empty file, header-only file, duplicate
coordinate (per side), shared panel across sides. The degenerate all-same-coord
side is caught by the duplicate-point guard BEFORE normalization, so the
divide-by-zero / NaN path in `sharedNormalisation` is unreachable. Unicode panel
names are accepted — correct (panels are free-text labels). The pixel count is
locked at 40/34, so a redesigned sign fails loud rather than drifting.

**`orphan_fixtures.js` — no guessing.** Provenance is strict `=== true`;
ownership keyed on `groupName || name` (rename-safe); THROWS on a non-array trace
list, an unreadable trace, or a fixture with no name (delete refused, not blind);
group `''` → orphan; both buses scanned. The false-positive it must never make
(deleting a hand-placed fixture) is structurally prevented.

**`scene_model_parity` DMX lane + structure.** Catches the genuine RGB↔RGBW
disagreement (model vs controller), DMX `duplicate_address`,
`patch_record_disagrees_with_chains` (DMX staleness), `unmapped_fixture/strand`
(the 4 live signs), section/fixture-id DMX↔LED collisions, group↔bit sync,
sidecar drift, `chainSplits` cover-exactly-once, `pixel_count_export_mismatch`,
bench parity, effects sidecar. The pure re-statement (imports nothing from
`src/`) is intact.

**Pixel-map name-drift (`_48` recurrences + `TE Sign 2` swallow).**
`tests/pixel_map_view_defaults.test.js` closes both generally: it fails if any
default view excludes a trace-backed group, and asserts "every TE sign group
exists and each gets its own planar panel" (a third sign → red test naming it).
Note this is a TEST gate over the SHIPPED defaults only — it does not cover an
operator's persisted `pixel_map_views.yaml`, and a new sign added after views are
saved gets no panel until re-seeded. Recorded, not a defect.

---

## Recommendations (operator/coordinator call — report-only)
1. **HIGH-2 first** — one focused fix (re-derive LED binding grade + an LED
   `patch_record_disagrees_with_chains`) closes the silent-dark rope class the
   gate exists to prevent.
2. **HIGH-1** — cross-check the LED-bus fixture definition footprint against the
   controller order in `checkLedStrandPatch`; the sign's physical truth is right
   there and currently discarded.
3. **MED-1** — use `record.segments` for LED-bus fixtures in `checkAddressHygiene`
   (delete the block model). Pre-empts the extensibility trap.
4. MED-2 / LOW-1 — small loud-diagnostic tightenings.
