# 2026-07-10 — LED Slice L3: segment persistence, subscription, spill reservation, UI

**Plan:** `.agent/plans/20260710_2_led_universe_layout.md` → Slice L3.
**Branch/worktree:** `feat/led_integration` (`kind-banach-95157b`). No git ops.
**Consumes L1 API** (`led_patch_projection.js`, already shipped):
`projectLedStrandSegments`, `computeLedStrandPatches().fields[*].segments/endUniverse/endChannel`,
`computeLedUniverseClaims`.

## What changed, per gap

**G1 — per-segment persistence.**
- `simulation/main.js` `projectLedStrandPatches`: copies `segments`,
  `endUniverse`, `endChannel` from the L1 record onto each strand + into
  `window.__globalPatchTree` (patched case rides `{...rec}`, which already
  carries them); clears all three in the unpatched branch (loud-clear contract).
- `simulation/server/save-server.js` strand extraction: emits `endUniverse`,
  `endChannel`, and a normalized `segments` list into the patches.yaml strand
  record, and adds all three to the structural-strip list so scene_config.yaml
  stays clean. Additive — start fields (`dmxUniverse`/`dmxAddress`) unchanged;
  old files without segments still load.

**G2 — spill-universe subscription.**
- `simulation/src/dmx/patch_manager.js` `deriveSubscribedUniverses`: for LED
  strands, subscribes to **every** `segments[].universe` (start + spills).
  Legacy records with no `segments` field fall back to the start universe only
  — identical to prior behavior, never a silent drop.

**G4 — spill reservation.**
- `simulation/src/gui/controller_map_editor.js` `recomputeAndMark`: after
  `projectLedStrandPatches`, walks `computeLedUniverseClaims` and
  `noteUniverseUsed(registry, u)` for every claimed universe — mutation-time
  reservation mirroring the DMX high-water contract, so a later `addPort`'s
  `nextFreeUniverse` skips LED spill universes. `makeAllocator` (DMX channel
  allocation) is untouched, per the plan's explicit warn-never-block decision.
  New helper `ledUniverseClaims()` builds the claim map (bound via
  `computeLedStrandPatches`; unbound via `computeLedProjection`, de-duped so a
  bound strand claims once).

**G5 — UI occupancy.**
- Strand chips (`controller_map_editor.js`): render the full span —
  `💡 LED_X U6:1 → U7:288 ×200px` for a spill, `U6:1–160` for a single
  universe — via new pure exports `ledStrandSpanText` / `ledStrandSpanTooltip`
  and `strandSegmentsFor` (walks unbound START-only records to segments).
- Universe bars (`controller_map_editor.js`): LED claims for a DMX port's
  universe render as a distinct amber sub-bar (`cm-occ-led`), so a DMX port
  sharing a universe with an LED stream is visible. `lastLedClaims` computed
  once per `render()`.
- `simulation/style.css`: `.cm-occ-seg.cm-occ-led` token (lower-half amber tint).
- `simulation/src/gui/gui_builder.js` strand folder: read-only patch line
  `📡 U6:1 → U7:288 · 200px · 2 universes` (or `📡 unpatched`), sourced from
  the persisted `strand.segments`.

## Tests

New `simulation/tests/led_segments_persistence.test.js` — 9 tests, all pass:
G1 spanning strand persists both segments + the 9-field patches.yaml record
shape + single-universe case; G2 subscription returns `[6,7]` + legacy
fallback `[6]`; G4 claim map exposes `{6,7}` and `noteUniverseUsed` pushes
`nextUniverse ≥ 8` (next port lands U8); G5 span strings.

Run: `node --test tests/led_segments_persistence.test.js` → 9/9.
Regression sweep (touched surfaces): `led_patch_projection.test.js`,
`patch_manager_subscribe.test.js`, `led_controller_ui_round2.test.js` →
38/38. `node --check` clean on all five edited JS files. (Did not run full
`npm test` — coordinator owns it; did not boot the sim — shared stack.)

Note: `controller_map_editor.js` pulls GUI modules that assign `window` at
load, so the test imports it (and `patch_manager.js`) dynamically after a
`globalThis.window` stub.

## Out-of-zone needs hit

- **Docs (plan L3 step 6):** `docs/41 §5` (segments shape) and a `docs/33` LED
  universe-parity note were NOT edited — `docs/` is outside the enumerated L3
  file zone. Recommend the L4 integration pass or a follow-up handle them.
- **`led_controller_ui_round2.test.js` (plan L3 "Owns: extend"):** not in the
  task's enumerated zone, so left untouched; the equivalent UI-seam assertions
  (chip span, per-universe claims, `noteUniverseUsed` reservation) live in the
  new `led_segments_persistence.test.js` instead.
- No `controller_registry.js` change was required for G4 — reservation works
  entirely through the existing `noteUniverseUsed` export on the mutation path.
