# `_303` — Live Touch native ARM hidden-Spatial fix

**Date:** 2026-08-17 · **Phase:** implementation + offline validation ·
**Live rig:** untouched

## Outcome

The photographed native failure is fixed without weakening ARM or pixel-view
safety. A persisted workspace can restore SPATIAL as `display:none` before its
canvas ever has a measurable box. Artifact verification and the 964-pixel live
topology verification remain mandatory, while ARM's complete initial spatial
payload now obtains `radius` and `radiusY` from a deterministic canonical
projection rather than from rendered canvas glyphs.

The real pointer/stroke path is unchanged: it still uses the visible canvas
projection so the drawn ring and engine brush agree. Revealing SPATIAL also
explicitly schedules its first display projection, because a first
`display:none` → visible transition was not a reliable ResizeObserver signal in
the native lifecycle reproduction.

Root-cause evidence is in `_301`; this implementation independently reproduced
the same call chain before reading that report:

`initialSpatialPrepareBody` → `brushPatch` → `padBrushWorld` →
`padWorldPerPx` → `pixel view is not verified`.

At the throw, source verification was true, engine topology verification was
true, and `canArm()` was true; only `screenGlyphs` was empty because the canvas
had never been visible. The missing CaptainPad host diagnostic in the physical
screenshot is therefore expected: the native verifier had already succeeded,
and the later ARM staging exception existed only in the embedded surface.

## Exact implementation scope

- `docs/ui/touch_control_pixel_views.js`
  - Split source-verification failure from missing rendered projection.
  - Extracted shared world-per-pixel extent math.
  - Added `worldBrushRadii(fraction, target)`, which refuses separately unless
    both the source artifact and engine topology are verified, then derives
    complete brush geometry from the current canonical view without DOM size.
  - Added explicit display-projection state/refresh APIs.
- `docs/ui/touch_control.html`
  - Added `padBrushWorldCanonical` for ARM staging.
  - Explicitly refreshes the display projection when SPATIAL is restored from
    the HIDDEN rail.
- `docs/ui/touch_control_wire.js`
  - `initialSpatialPrepareBody` now requires canonical verified brush geometry
    and always sends both radii in the atomic prepare body.
  - Exposed that builder through the existing hermetic test hook.
- `simulation/tests/live_touch_ui_layout.test.js`
  - Added a real native-embed lifecycle regression with persisted SPATIAL hidden
    before first paint, document-correlated verifier start, live 964-pixel
    topology, hidden → visible → hidden transitions, and the negative
    pre-engine verification gate.
- `marsin_engine/tests/effects/touch_control_wire_layers_contract.test.js`
  - Pinned ARM staging to the canonical API and prohibited regression to
    `brushPatch()`/rendered-canvas dependency.

No CaptainPad product source, engine product source, patterns, playlists,
runtime state, launcher, services, or live ports were changed.

## Regression evidence

Before the fix, the new native lifecycle test failed at the photographed
predicate:

```text
actual:   pixel view is not verified
expected: null
```

After the fix, the same test proves:

1. SPATIAL is docked before its first animation-frame projection.
2. Static artifact verification is true while render count is zero.
3. Canonical radius refuses while live engine topology is unverified.
4. The document-scoped native verifier completes once against all 964 pixels.
5. `canArm()` is true and the complete hidden ARM body contains positive
   `radius` and `radiusY`.
6. The rendered-only helper reports `pixel view has no rendered display
   projection`, no longer falsely claiming verification failed.
7. Restoring SPATIAL builds a valid visible stroke projection.
8. Hiding it again does not reuse stale display geometry; ARM's canonical
   radii remain deterministic.

## Validation

- `node --check docs/ui/touch_control_wire.js` and
  `node --check docs/ui/touch_control_pixel_views.js` — PASS.
- `cd simulation && node --test tests/touch_control_pixel_views.test.js tests/touch_artifact_freshness.test.js tests/touch_control_embed_transport.test.js tests/live_touch_ui_layout.test.js`
  — **51 pass, 0 fail**.
- `cd marsin_engine && node --import ./tests/helpers/setup_config_guard.mjs --test tests/effects/touch_control_pixel_verification_singleflight_contract.test.js tests/effects/touch_control_wire_layers_contract.test.js`
  — **34 pass, 0 fail**.
- `cd CaptainPad && npx vitest run utils/live_touch_bridge.test.ts components/live_touch_ui_authority.test.ts components/live_touch_handoff_curtain.test.ts`
  — **28 pass, 0 fail**.
- `cd CaptainPad && npm run check` — PASS: TypeScript **0 errors**; ESLint
  **0 errors**, 10 unrelated existing warnings.
- `cd simulation && npm run check` — pixel artifact current; the final full
  test rerun has **1 unrelated shared-runtime residue failure**:
  `_176 §5.3: a TEST-CONTEXT write into the REPO's real scenes dir is REFUSED`
  because `simulation/scenes/test_bench/bench_mirror_state.yaml` already exists.
  It was not removed or altered.

No git command was run. No live stack or physical ARM action was attempted.

## Physical iPad retest

1. While DISARMED, use the Live Touch header RELOAD so the WebView loads the
   changed `docs/ui/*` assets. A CaptainPad rebuild is not required for this
   fix.
2. Leave SPATIAL in the HIDDEN rail, matching the photographed state.
3. Tap ARM. Expect ARMING → ARMED with no bottom red error. A brief
   pixel-verification WAITING/CHECKING banner may appear and must clear.
4. Confirm SPATIAL remains hidden; ARM must not mutate workspace layout.
5. DISARM. Restore SPATIAL from HIDDEN and confirm the pixel map appears.
6. If it is safe to write the rig, ARM and make one short stroke; confirm the
   visible ring and affected lights agree. Then DISARM.
7. Hide SPATIAL again and ARM once more; expect success with no stale-projection
   behavior. DISARM afterward.
8. While DISARMED, RELOAD with SPATIAL still hidden and repeat ARM once to cover
   a fresh native document identity.

Any failure should be captured with both the CaptainPad host diagnostic and the
embedded bottom error visible; do not retry around it or bypass verification.
