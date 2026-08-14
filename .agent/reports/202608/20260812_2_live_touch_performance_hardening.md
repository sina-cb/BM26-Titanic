# Live Touch performance hardening handoff

**Date:** 2026-08-12
**Worktree:** `live_touch_bm_readiness_rebase`
**Branch:** `dev/live_touch_bm_readiness_rebase` (local only)
**State:** implemented and locally proven; physical iPad review remains

## Outcome

- Deck, Mixer, and Live Touch share the same 100 ms linear Layers transaction.
- Mixer activation fails loudly when no configured contributor can render.
- Live ARM setup is an atomic owner-scoped prepare operation instead of a long
  chain of client round trips.
- Non-Layers navigation preserves armed Live Touch; Deck/Mixer handoff and
  background/deadman paths still disarm authoritatively.
- Top-Down, Front, LED Strands, and TE Sign use canonical generated simulator
  geometry, explicit axes, exact pixel masks, centered fit, and display-only pan.
- Top-Down is now a single shared simulator/Live orthographic projection. The
  authored view has no per-fixture offsets, gap compression, pitch stretching,
  framing, or perspective; Live serializes the simulator resolver's exact glyph
  coordinates instead of applying a second normalization. The Aerial camera
  source is fingerprinted, `Z+ SHIP FORWARD` is down-screen on both surfaces,
  and neither hull can acquire an independent visual flip.
- Both auditorium rows are part of the main Top view: eight Left Auditorium and
  eight Right Auditorium pixels, increasing the authoritative census from 704
  pixels / 16 groups to 720 pixels / 18 groups.
- Front displays 396 Front pixels but paints an exact 792-identity Front+Back
  mask, so one screen stroke mirrors across both model faces.
- TE Sign uses its true rotated projection `(nz, ny)` and a per-sign local
  world/pixel scale. At XS the measured center footprint is 7 LEDs, all inside
  the visible circle and confined to the touched sign panel.
- Spatial paint is rAF-coalesced and caches its static map/projection. Fade is
  exact linear time-to-zero at 0.1, 0.5, 1.0, or 1.5 seconds in the UI,
  controller, and pattern 130.
- Group brightness uses a horizontally scrollable bank with fader-vs-rail
  gesture arbitration, rAF value coalescing, one bounded request in flight,
  and a final release flush.
- Groups now offer three state-preserving profiles: 24 individual groups;
  five authored instrument views; and four Front/Back performance planes.
  Each reduced profile is compiled from exact live MaskRegistry membership,
  must partition all 24 groups without overlap or partial membership, and
  writes only the existing rack-subordinate Live group factors.

## Measured proof

- Combined engine/client regression: 63/63.
- Canonical pixel artifact and projection tests: 15/15; combined resolver,
  defaults, layout, and Live projection gate: 110/110.
- Spatial controller/wire hardening: 45/45, including the reversed TE axes,
  Front view mask, fade, ARM lifecycle, and stale-touch cleanup.
- Group profile/model catalog gates: 6/6 focused HTTP/compiler tests; browser
  selector/visibility/level-preservation proof had zero page errors. Armed
  Identity at 40% changed exactly `TE Sign` and `TE Sign 2` to 0.40, then clean
  disarm returned Layers to Deck with no owner lease.
- CaptainPad focused tests: 16/16 plus TypeScript.
- Brush gate: 1,200 inputs, 599 preview composites/600 rAF ticks, 240 retained
  ink stamps, zero static rebuild/reproject/resize operations, zero long tasks,
  and no ink or scheduled frame remaining after the 1.5 second maximum fade.
- Responsive containment: document width matched 640, 768, 1024, and 1366 px;
  the 1,628 px group bank remained internally scrollable.
- Real lifecycle: Live ARM landed; Dimmer Rack retained the same owner; Mixer
  landed and released ARM.
- Full stack: sim, engine, save, both sACN bridges, and CaptainPad static export
  healthy; approximately 7,448 sACN packets per five seconds.
- Visual proof: simulator `orthographic_shared_top_down.png` and
  `orthographic_shared_front.png`; Live `orthographic_live_touch_top_down.png`;
  fresh read-only 3D reference `1786600798_aerial.png`.

## Operational notes

The saved Titanic Mixer currently has one active Stacks-focused channel. That
channel renders correctly; other surface groups will not show Mixer output
until the operator broadens its view or adds more Mixer layers.

The worktree shares `CaptainPad/node_modules` through a junction to the older
feature worktree. Expo dev-server entry URLs therefore resolve outside the
current project root. The production static export is correct and is what the
current review server uses. A normal checkout with local dependencies can use
`node launcher.js dev-lite`; this worktree's review stack intentionally uses
the static export.

No changes were staged, committed, rebased again, or pushed. Runtime residue
was reported and not silently reverted.

The repository-wide simulation suite remains baseline-red in unrelated
`bench_section_sync` expectations and the known
`summer_camp_dome/patches.yaml.original` operator residue. The Titanic
scene-model parity gate passes with zero errors and zero warnings.
