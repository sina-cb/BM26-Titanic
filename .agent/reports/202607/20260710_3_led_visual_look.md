# 2026-07-10 — LED pixel visual look (Slice S1, Requirement A)

**Branch:** `feat/led_integration` (worktree `kind-banach-95157b`).
**Plan:** `.agent/plans/20260710_1_led_patching_grouping_look.md` → Requirement A / Slice S1.
**Owner zone (exclusive):** `simulation/src/fixtures/led_strand.js`,
`simulation/tests/led_strand_visuals.test.js` (new). No other files touched.
**Status:** implemented + unit-tested green. **Needs an operator sim-visual
check** — I cannot run the sim (renderer/bloom look is judged by eye).

## What changed

`led_strand.js` — the per-LED render was rebuilt to match the DMX pixel look:

1. **Dark hexagonal housing deleted entirely.** The old
   `CylinderGeometry(...,6)` + `MeshStandardMaterial(0x222222)` — the black core
   the operator saw through the transparent bulb — is gone. No replacement mesh.
2. **Pixels are now two `THREE.InstancedMesh`es per strand** (bulb + halo),
   sharing a module-level unit low-poly sphere `SphereGeometry(1, 6, 4)` (same
   FPS rationale as the DMX runtime's cached spheres):
   - **Bulb:** `MeshBasicMaterial({ color: 0xffffff, toneMapped: false })` —
     **opaque**, full-bright, skips ACES tone-mapping so a lit pixel punches
     through exposure 0.55 and crosses the 0.92 bloom threshold (the crisp LED
     point-source core). Per-instance scale `LED_BULB_RADIUS = 0.05`.
   - **Halo:** the DMX halo recipe byte-for-byte — additive, `opacity 0.2`,
     `depthWrite:false`, `side: THREE.BackSide` (soft rim, no hard front edge).
     Per-instance scale `LED_HALO_RADIUS(0.14) × params.globalHaloScale`.
   - The three tunables (`LED_BULB_RADIUS`, `LED_HALO_RADIUS`,
     `LED_HALO_OPACITY`) are named constants at the top of the file for the
     artist to adjust.
3. **Color path rewritten off child-index arithmetic.** `setLedColorRGB` now
   calls `setColorAt(index, …)` on the bulb + halo InstancedMeshes and marks
   `instanceColor.needsUpdate`. This **fixes the latent zero-length-strand bug**
   (`ledStartIdx = 2` assumed a wire + tube that a degenerate strand never
   builds). `setLedColorRGBWAU` is unchanged (mixes then delegates). The call
   contract used by `animate.js` and the exporter's `apply` closures is
   identical.
4. **Guides out of the beauty render.** `_guidesVisible` now defaults **false**;
   `_applyVisibility` shows the wire + endpoint handles only when guides are on
   **OR the strand is selected**, and the glow tube only when selected. Handles
   shrunk `0.3 → 0.12` and idle opacity `0.7 → 0.45` so they stop swallowing
   short strands; they stay in `interactiveObjects` permanently.
5. **Dispose correctness.** New `_clearGroup()` disposes per-child geometry +
   material but never the shared module sphere; `destroy()` also disposes the
   cloned handle materials. Instanced meshes have `frustumCulled = false` (their
   unit-sphere bounding volume at the group origin would otherwise cull the
   spread-out pixels incorrectly).

**Preview-only:** zero contact with pixel data, patch fields, colors sent,
export, or config — only the visual meshes/materials.

## Tests

`simulation/tests/led_strand_visuals.test.js` (new, 10 cases) — **all pass**
via `node --test tests/led_strand_visuals.test.js`:
no MeshStandardMaterial/housing; exactly 2 InstancedMeshes with
`count === ledCount`; bulb opaque + `toneMapped:false`; halo additive/BackSide;
`setLedColorRGB(3,1,0,0)` lands red on bulb + halo instance 3; RGBWAU white mix
matches `mixRgbwauToRgb`; guides hidden by default, `setSelected(true)` shows
handles/wire/tube, the global toggle force-shows; zero-length strand builds and
recolors without throwing; `destroy()` cleans scene + `interactiveObjects`.

(Did not run the full `npm test` per the coordinator's instruction — the
authoritative suite runs after all slices land.)

## Notes / follow-ups for the coordinator

- **Hidden handles remain raycast-pickable.** `interaction.js:368` uses
  `intersectObjects(interactiveObjects, false)`, which (per its own comment at
  line 372) does **not** honor `.visible`. The plan permitted a one-line
  `handle.visible` gate there for S1, but that file is **outside my assigned
  zone**, so I left it untouched. This is a pre-existing condition (handles are
  already hidden-but-pickable today whenever "Show Guides" is off) and my change
  does not worsen the default running state. Recommended fix (whoever owns
  `interaction.js`): after the trace filter, add
  `intersects = intersects.filter(i => !(i.object.userData.isLedStrand && !i.object.visible));`
- **Beauty-hidden-by-default depends on a gui_builder default I don't own.**
  I set `_guidesVisible = false` in the constructor per the plan, but
  `gui_builder.js:4044,4059` initialises `params.ledGuidesVisible = true` and
  calls `setGuidesVisible(true)` right after each strand is built, so guides
  still show globally by default at runtime. To make the beauty render
  guide-free by default, flip that gui_builder default (S2's zone). The plan
  also wants `window.openStrandFolder` (gui_builder.js:4078) to call
  `setSelected(true)` so picking a strand from the GUI force-shows its handles —
  the `setSelected` logic is in place on my side and ready for that wiring.

## Operator checkpoint (sim-visual, no device)

Run a pattern on `LED_0` and eyeball a close-up + distance screenshot: pixels
should read as clean glowing point sources with a soft halo and **no dark
core**. Approve or tune the three constants (`LED_BULB_RADIUS`,
`LED_HALO_RADIUS`, `LED_HALO_OPACITY`) in `led_strand.js`.
