# Authoritative Live Touch pixel views and BM-readiness rebase plan

**Status:** Pixel-view pipeline implemented and verified; feature commits and
the completed implementation are rebased onto local `feat/bm_readiness` in the
review worktree `live_touch_bm_readiness_rebase`
**Operator request:** Inspect the current Front, Top-Down, Strands, and TE Sign
2D pixel views in the main checkout without modifying the main checkout; use
that authority to fix Live Touch's top view; plan a safe BM-readiness rebase.

## Why

The Live Control spatial chart says it matches the simulation, but it now draws
a different fixture set through a separate projection. An operator aiming at a
map that disagrees with the rig is worse than having no map. The simulation's
current tuned views must become the only geometry authority, with stale data
refusing spatial control loudly. The rebase must also preserve substantial
uncommitted operator work in both checkouts.

## What exists in the main checkout

The main directory is currently checked out on `feat/bm_audio_tuning`, not
`feat/bm_readiness`. Both local refs and `origin/feat/bm_readiness` point to
committed SHA `9e8b23b81d`, but the main checkout contains substantial
uncommitted pixel-map work. Therefore:

- `9e8b23b81d` is the current committed rebase target.
- The operator's main checkout is the visually authoritative working copy
  today.
- Rebasing onto the branch ref alone cannot include those uncommitted visual
  improvements. They must first become an intentional checkpoint, or be
  ported as a separate reviewed slice.
- Both existing checkouts are dirty; neither is a safe place for an in-place
  rebase.

The main checkout remained read-only. Its current pixel-view sidecar and the
resolver/layout capabilities required by that sidecar were ported into this
feature worktree and are now covered by deterministic parity tests.

## The authoritative 2D pipeline

```text
scene pixel_map_views.yaml
          |
          v
pixel_map_store.js -- validate/resolve --> pixel_map_views.js
          |                                  |
          |                                  v
          +--------------------------> pixel_map_layout.js
                                             |
                                             v
                                resolved panels + glyphs
                                             |
                         +-------------------+-------------------+
                         v                                       v
              pixel_map_pane_view.js                  pixel_map_renderer.js
                         |
                         v
                    operator's 2D pane
```

For Live Touch, that same resolver now has one additional deterministic output:

```text
pixel_map_views.yaml + Titanic model + resolver source
                          |
                          v
 export_touch_control_pixel_views.mjs -- resolve --> generated JSON artifact
                                                        |
                                     source/resolver/model fingerprints
                                                        |
                                                        v
                              touch_control_pixel_views.js
                                   |              |
                        final viewport fit    exact pixel identity
                                   |              |
                                   +------> Live Touch pad
```

The source-of-truth set in the main working copy is:

- `simulation/scenes/titanic/pixel_map_views.yaml`
- `simulation/src/gui/pixel_map/pixel_map_views.js`
- `simulation/src/gui/pixel_map/pixel_map_layout.js`
- `simulation/src/gui/pixel_map/pixel_map_store.js`
- `simulation/src/gui/pixel_map/pixel_map_pane_view.js`
- `simulation/src/gui/pixel_map/pixel_map_renderer.js`
- `simulation/src/gui/pixel_map/pixel_map_interaction.js`
- `simulation/src/gui/pixel_map/pixel_map_view_defaults.js`
- `simulation/src/gui/modern/pixel_map_panel.js`
- `simulation/src/gui/modern/pixel_map_multiview_panel.js`

`simulation/main.js` loads and validates the scene sidecar. The store seeds
defaults only when no saved views exist; the sidecar wins. The view resolver
validates membership and options, then the layout produces the resolved glyph
geometry before the pane paints anything. Optional tuning remains available for
other views, but the shipped Top view is a pure, uniformly scaled x/z
orthographic projection with no offsets, compression, pitch stretch, or framing.

Current resolved contracts:

| View | Resolved content | Important tuned behavior |
|---|---:|---|
| Top-Down | 720 pixels / 18 groups | bars, strands, large/small stack PARs, and both 8-light auditorium rows; exact Aerial orientation; no geometric distortion |
| Front | 396 pixels / 2 panels | front bars, vintage fixtures, front ropes and stack PARs; wash angles and upwash styling; no saved offsets |
| Strands | 320 pixels | LED strands without TE signs |
| TE Sign | 148 pixels / 2 panels | independently fitted planar signs, rotated 90 degrees |

The saved Top-Down sidecar and seeded default both specify a Uking PAR glyph
size of 13. Artistic glyph sizing remains view-local; it does not move a pixel
away from its authoritative orthographic position.

## Root cause and correction of the Live top-view mismatch

The previous `docs/ui/touch_control.html` did not consume the pipeline above.
It embedded:

- a 964-point `PIXMAP` string;
- a parallel `PIXMAP_WORLD` string;
- 24 baked group names;
- hand-measured hull rotation, centroid, and axis spans;
- its own independent axis stretch, point deduplication, and inverse mapping.

It did not consume view membership/exclusions, the saved sidecar, resolver,
fit, rotation, wash styling, or glyph semantics. Its independent coordinates
could therefore flip one hull while the other looked correct. The generated
artifact now includes the simulator's exact resolved glyph positions and a
source/resolver fingerprint, so geometry drift fails closed.

`GET /model/pixel-layout` returns raw engine geometry and identities. That is
necessary for spatial targeting, but insufficient to reconstruct the tuned
simulation view.

That alternate geometry is now deleted. Live Touch loads only the generated
resolved artifact, verifies it against the authored source and resolver, then
verifies every engine pixel identity and coordinate before ARM is allowed.

## Implementation: one resolved artifact, no alternate geometry

The deterministic build-time exporter is:

`simulation/tools/export_touch_control_pixel_views.mjs`

It imports and runs the same resolver/layout implementation used by the
simulation against the Titanic scene, then atomically writes:

`docs/ui/touch_control_pixel_views.json`

The artifact is local and same-origin on the simulation server, preserving
offline readiness. It contains no hand-copied geometry. `npm run
pixel-views:export` regenerates it; `npm run pixel-views:check` fails when the
checked-in artifact differs byte-for-byte from a fresh resolution.

```json
{
  "schemaVersion": 1,
  "source": {
    "scene": "titanic",
    "modelFingerprint": "...",
    "modelSourceFingerprint": "...",
    "viewsFingerprint": "...",
    "resolverFingerprint": "...",
    "resolvedFingerprint": "..."
  },
  "modelPixelCount": 964,
  "design": { "width": 900, "height": 520, "panelGap": 8 },
  "views": [
    {
      "id": "top_down",
      "framing": { "zoom": 0.892857, "panX": -243.632, "panY": 60.747 },
      "panels": [
        {
          "id": "main",
          "glyphs": [
            {
              "pixelIndex": 0,
              "fixtureKey": "stable fixture identity",
              "group": "Left Front Wall",
              "fixtureType": "ShehdsBar",
              "x": 123.4,
              "y": 210.2,
              "sizeX": 14,
              "sizeY": 14,
              "rotation": 0,
              "shape": "square",
              "effect": null,
              "world": { "nx": 0.1234, "ny": 0.5, "nz": 0.6789 }
            }
          ]
        }
      ]
    }
  ]
}
```

All fields are validated. Unknown schema versions, missing/empty views,
duplicate or out-of-range pixel indices, invalid shapes/effects, non-finite
coordinates, count mismatches, or fingerprint mismatches refuse the
visualization and disable spatial painting with a visible error. The former
embedded maps are deleted; they are not kept as a fallback.

Live Touch loads the Top-Down view by ID and paints its resolved glyphs.
Future view selection may expose Front, Strands, and TE Sign from the same
artifact without another renderer. The first slice changes only the Top-Down
chart and preserves Misha's panel geometry.

### Runtime verification gates

The surface must pass all of these gates before it can ARM:

1. Load and structurally validate schema version 1 of the artifact.
2. SHA-256 the current `pixel_map_views.yaml` and both resolver modules and
   compare them to the artifact. Line endings are canonicalized so Windows and
   Linux checkouts verify the same source.
3. SHA-256 the complete resolved design/panel/glyph payload. This catches a
   modified or truncated artifact even when its source metadata remains intact.
4. Fetch `GET /model/pixel-layout`, require the Titanic scene and all 964
   pixels, then compare the ordered topology fingerprint.
5. Re-check every resolved glyph's `pixelIndex` against the live pixel's
   normalized world coordinate.

Any failed gate paints a red error over the pad, blocks pad pointer events, and
keeps `TouchPixelViews.canArm()` false. There is no raw-coordinate fallback.

### Deterministic final reprojection

The artifact preserves simulation design-space coordinates and saved framing.
At resize, the browser repeats only the pane's pure panel subdivision and
letterboxed panel transform into the actual canvas. It never re-resolves
fixture membership or invents geometry. `pixelIndex` and `{nx,ny,nz}` remain
unchanged through resize, making final viewport reprojection deterministic and
identity-preserving.

## Spatial aiming contract

The display point and spatial target remain paired by `pixelIndex` and world
coordinates. Pointer targeting chooses through the displayed resolved points,
not through a second analytic projection.

Compression and manually moved fixtures mean a decorative screen-space circle
cannot automatically equal a world-space ellipse. The preview highlights the
exact resolved glyphs selected by the same world-space ellipse and swept-segment
distance calculation implemented by `marsin_engine/effects/spatial_paint.js`.
The circle remains a reach hint; selected-glyph highlighting is the truthful
contract.

Acceptance is set equality, not visual resemblance: for each sampled touch,
the glyphs highlighted on glass must equal the engine pixels affected by the
spatial effect.

## Implemented evidence

| Contract | Evidence |
|---|---|
| Deterministic generated artifact | Two resolutions serialize byte-identically; `pixel-views:check` passes |
| Current authoritative view census | Top-Down 720 pixels / 18 groups; Front 396; Strands 320; TE Sign 148 |
| Top membership | No TE-sign or VintageLed glyph is present; both auditorium groups contribute eight pixels |
| Shared geometry | Every exported glyph equals the simulator resolver's `gi/cx/cy/size/rotation` result exactly |
| Front additions | Eight Uking PAR glyphs resolve with `upwash` and saved -30/33 degree wash angles |
| Identity-preserving reprojection | Viewport projection retains the exact sorted `pixelIndex` set and is deterministic |
| Fail-closed validation | Tests reject malformed identities and tampered resolved geometry |
| Engine topology parity | Node exporter and browser reader produce the same SHA-256 topology fingerprint |
| Brush parity | Focused test pins the exact ellipse and swept-segment selected-pixel set |
| Existing pixel-map regression suite | 200 relevant schema/layout/pane/edit/frame-source tests pass |

The focused artifact suite includes a strict simulator-to-Live geometry
equality gate, the 720-pixel auditorium census, Aerial `+Z` down-screen
orientation, centered fitting, and brush/mask parity. Titanic scene-model
parity passes. The repository-wide simulation suite remains baseline-red in
unrelated `bench_section_sync` expectations and the already-reported
`summer_camp_dome/patches.yaml.original` residue; those operator-owned issues
are reported, not hidden or rewritten by this slice.

## Rebase design

Current topology:

```text
feat/bm_readiness                         9e8b23b81d
feat/bm_audio_tuning                      9e8b23b81d + dirty main work
feat/mishas_live_control_panel_sina_changes_some  6b734262 + dirty review work
merge base                               86f6ee4d
```

### Preconditions

1. Decide the actual base. If the rebase must include today's authoritative
   views, first checkpoint the intended main-checkout work onto the appropriate
   durable readiness branch. A dirty working copy is not a base.
2. Inventory the feature work into intended source/docs/tests versus existing
   runtime residue. Do not stash, reset, or clean unrelated operator state.
3. Run security and subsystem preflight before any future commit.

### Safe execution shape

1. Export the intended Live hardening patch to `~/tmp/`, explicitly listing
   files and excluding runtime state.
2. Create a new clean sibling worktree on a local `dev/` branch from the chosen
   BM-readiness checkpoint.
3. Replay/rebase Misha's non-merge commits there. Do not rebase either dirty
   checkout in place.
4. Resolve conflicts semantically, then apply the reviewed hardening patch.
5. Run `git range-diff` from the pre-rebase series to the rebased series so a
   skipped or rewritten behavior is visible.
6. Only after tests and operator review, promote the clean result back to the
   durable feature branch using the repo's branch-lifecycle rules.

### Known semantic conflict: pattern IDs

BM readiness owns calibration pattern IDs 66-73. Live Control currently owns
`128_five_colour_prism`, `129_five_colour_stations`, and `130_spatial_paint`
after the required readiness collision migration.
Choosing either manifest wholesale would silently discard real content.

Preserve the calibration patterns and renumber the three Live patterns to the
next verified-free contiguous range. IDs 128-130 appear free in today's dirty
main checkout, but they must be rechecked after the readiness checkpoint is
frozen. Rename files and update manifest, catalog/descriptions, tests, preset
references, docs, and any state keys atomically. Unknown or duplicate IDs fail
the migration; there is no alias fallback.

If the dirty main work lands first, expect semantic conflict review in:

- `marsin_engine/lib/api_server.js`, `engine.js`, effects, state, ParamCenter,
  and mixer modules;
- `CaptainPad/utils/api.ts` and `CaptainPad/app/(tabs)/_layout.tsx`;
- `simulation/scenes/titanic/pixel_map_views.yaml` and the pixel-map stack.

For pixel views, the checkpointed main definitions win. The review worktree's
current sidecar carries older framing and must not overwrite the tuned main
view merely because YAML merged without syntax conflict.

## Acceptance criteria

1. Generated Top-Down resolves exactly 720 pixels / 18 groups, includes both
   auditorium rows, and excludes TE signs and vintage rails.
2. Front, Strands, and TE Sign resolve 396, 320, and 148 pixels respectively.
3. Generated glyphs match the simulation resolver exactly at the same design
   canvas; no independent Live geometry normalization is permitted.
4. Brush preview and engine affected-pixel sets match at center and edge, with
   the same orientation and pixel mask used by the simulator.
5. Missing/stale/malformed artifact disables spatial painting visibly.
6. Regenerating from unchanged source produces a byte-identical artifact.
7. Every manifest ID is unique and every renamed Live pattern loads.
8. `git range-diff` accounts for every replayed Live commit.
9. `git diff --check`, CaptainPad checks, targeted Live safety tests, and all
   pixel-map schema/layout/default/edit tests pass.
10. Approved screenshots of all four views are captured through
    `.agent/skills/see_the_world.md`; no built-in web viewer is used.

## What this deliberately is not

- Rebase execution/status is owned by the coordinator; this document does not
  infer or overwrite that status.
- It does not make raw `/model/pixel-layout` the visual authority.
- It does not retain the baked 964-point chart as a fallback.
- It does not add a second editable copy of pixel-view configuration.

## Maintenance workflow

1. Edit the authoritative simulation sidecar/resolver, never the generated JSON.
2. Run `npm run pixel-views:export` from `simulation/` and review the resolved
   census/geometry change.
3. Run `npm run pixel-views:check` plus the focused and pixel-map regression
   tests before merge.
4. Runtime keeps the surface disabled until both static-source and live-engine
   verification pass.
5. Rebase and branch-lifecycle work remains with the coordinator, including
   pattern-ID range-diff and final operator review.
