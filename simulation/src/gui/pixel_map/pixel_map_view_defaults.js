/**
 * pixel_map_view_defaults.js — the four shipped default views for the 2D
 * Pixel Map multiview, expressed purely as data (design report 20260724_9
 * §2.2). Seeded into `params.pixelMapViews` on first open of a scene that has
 * none; from there they are ordinary, editable views.
 *
 * The selectors are keyed on the titanic scene's real fixture vocabulary,
 * verified against `scenes/titanic/scene_config.yaml`:
 *   ShehdsBar ×25, VintageLed ×16, UkingPar ×47, the TE Sign V3 pair
 *   (TeSignV3A40 + TeSignV3B34, group 'TE Sign', 74 px), plus the 8 LED strands
 *   (kind: 'led'). NOTE (operator ruling, 2026-07-24): the TE sign is DMX-wired
 *   but classified as an LED fixture, so its cluster `kind` is 'led' too. To
 *   keep membership to spec, top_down + strands EXCLUDE fixtureTypes
 *   'TeSignV3A40'/'TeSignV3B34' (they live in the te_sign view).
 *
 * ⚠ EVERY group named here is a HARDCODED NAME, so a group rename in the editor
 * silently drops that group out of the view that named it — a selector matching
 * zero clusters just renders nothing. This has now bitten THREE TIMES:
 *
 *   `_46`  'Right Top Chimney Generator' → 'Right SmokeStacks'   (right ring lost)
 *   `_48`  'Left Front Wall Generator'   → 'Left Front Wall'     (caught by test)
 *   `_48`  'Left Top Chimney Generator'  → 'Left SmokeStack'     (left ring lost)
 *   add.2  'Left Front Deck Generator'   → 'Left Front Rails'    (left vintage lost)
 *
 * Every constant below is asserted against the live scene by
 * `tests/pixel_map_view_defaults.test.js`, so a rename is a red test naming the
 * group rather than a quietly empty panel — that is what caught the last two.
 * A rename can NEVER repair these automatically: `renameGroupInViews` re-points
 * `{group: …}` selectors in the operator's SAVED views only, and these are
 * source constants no rename can reach.
 *
 * The durable fixes (live-derived defaults, an alias layer, or a load-time
 * banner listing every stale name) are designed and costed in report
 * `20260725_48` addendum 2 and are the OPERATOR's call — nothing here
 * auto-migrates a name, because loud is the house rule.
 */

import { createViewsContainer, addView } from './pixel_map_views.js';

// The two chimney par rings that crown the big smoke stacks. NOTE: the scene
// has TWO chimney par groups, NOT one "8 pars in a circle".
//
// RENAME LOG — this constant has now gone stale THREE times (see the header):
//   'Right Top Chimney Generator' → 'Right SmokeStacks'  (repaired in `_46`)
//   'Left Top Chimney Generator'  → 'Left SmokeStack'    (repaired in `_48` add. 2)
export const CHIMNEY_GROUPS = [
  'Left SmokeStack',
  'Right SmokeStacks',
];

// The two SMALL smoke stacks — 4 pars each, sitting on a ~1-unit-radius ring, so
// each reads as one small circle of dots on the Top-Down view. They stand well
// outboard of the hull (left x ≈ −46, right x ≈ +42, against a hull spanning
// −31…+34), which is exactly where they physically are; adding them widens the
// Top-Down projection and therefore shrinks everything else a little. That is
// the honest cost of showing them in the same TRUE projection rather than
// parking them in a side panel that lies about their position (the mistake
// report 20260725_40 removed).
export const SMALL_SMOKESTACK_GROUPS = [
  'Left Small SmokeStack',
  'Right Small SmokeStack',
];

// The high auditorium uplights belong in the main orthographic Top view. They
// remain at their real x/z positions rather than being parked in an auxiliary
// panel, so their relationship to the walls and strands matches the Aerial 3D
// view and the Live Touch brush surface exactly.
export const AUDITORIUM_GROUPS = [
  'Left Auditorium',
  'Right Auditorium',
];

// ─── The FRONT of the ship ─────────────────────────────────────────────────
// Operator spec (his Front-view review, report 20260725_48 + the 2026-07-29
// correction): the Front view is the front lights ONLY — the front LED bars, the
// front vintage lights, and **the four front smoke-stack ropes, two per side**.
// Classified from the live scene, not from the names alone.
//
// "Forward" is NOT a single world axis here: the titanic's two halves are
// rotated relative to each other, so each side has its OWN forward direction,
// taken as (that side's front wall centroid − its back wall centroid) in the
// x/z plane:
//
//              forward axis (x, z)   front bars → back bars
//   left       (−0.018, +1.000)      z +16.1  vs  z +1.1
//   right      (+0.615, +0.789)      diagonal, not axis-aligned
//
// RENAME LOG: 'Left Front Deck Generator' → 'Left Front Rails' (`_48` add. 2).
//
// Projecting every strand's midpoint onto its side's forward axis separates the
// ropes with a wide margin — front 10.5…12.3, back 4.3…6.3 — on BOTH sides:
//
//   LEFT   Left_Front_Left  12.31 │ Left_Front_Right 12.10 ║ Left_Back_Left  6.28 │ Left_Back_Right  5.80
//   RIGHT  Right_Front_Left 10.63 │ Right_Front_Right 10.48 ║ Right_Back_Right 4.50 │ Right_Back_Left  4.31
//
// The pair on each side is NOT two of a kind: one is the HULL DROP (y 2.1 → 12.6,
// hanging down the front face) and one is the DECK ROPE (y 12.4 → 14.8, running
// inboard from the stack top to the deck edge over 7-12 world units). Both read
// as lines in a front elevation, and both are smoke-stack ropes — which is what
// the operator asked to see. `tests/pixel_map_view_defaults.test.js` re-derives
// the whole classification from the forward-axis projection, so a re-point at a
// back rope is a red test, not a quietly wrong picture.
export const FRONT_BAR_GROUPS = ['Left Front Wall', 'Right Front Wall'];
export const FRONT_VINTAGE_GROUPS = ['Left Front Rails', 'Right Front Rails'];
// Per side: [hull drop, deck rope]. Index 0 = left/port, 1 = right/starboard,
// matching FRONT_BAR_GROUPS / FRONT_VINTAGE_GROUPS.
export const FRONT_STRAND_GROUPS = [
  ['Left_Front_Left', 'Left_Front_Right'],
  ['Right_Front_Right', 'Right_Front_Left'],
];

// ─── Orphans ───────────────────────────────────────────────────────────────
// Groups that exist in the scene but NO generator trace owns — coordinate-exact
// ghost duplicates of a real group, which double a row's pixel count and make it
// look pre-overlapped. The views only decline to DRAW them; deleting them is the
// operator's call and his alone.
//
// ⚠ THIS LIST IS KEYED ON THE NAME, NOT ON ORPHAN-NESS — so a group that stops
// being an orphan MUST be removed from it, or the real fixtures inherit the
// exclusion and vanish. That is not hypothetical: report `20260725_51` §4 (Trap
// 3) predicted it, and it happened on 2026-07-30. The scene then held BOTH a
// ghost 'Left Back Wall' (5 bars, no trace) and the real 'Left Back Wall
// Generator' (5 bars, traced); the operator deleted the ghosts and renamed the
// generator to 'Left Back Wall', so the very name listed here became his REAL
// back wall. Entry dropped the same day.
//
// `tests/pixel_map_view_defaults.test.js` now closes the trap generally: it
// fails if ANY default view excludes a trace-backed group, so the next time an
// orphan name is reused by a real group it is a red test, not a missing row.
//
// 2026-07-30 (later): 'Left Center Auditorium' removed too — the operator
// deleted the last of its ghosts himself (first by hand at 14:28, the rest via
// the `_76` orphan-removal UI), so the group no longer exists in the scene and
// the exists-tripwire in the test went red exactly as designed. The list is
// empty until a new ghost family appears.
export const ORPHAN_GROUPS = [];

// ─── The TE signs ──────────────────────────────────────────────────────────
// The operator added a SECOND sign ('TE Sign 2', a full TeSignV3A40+B34 pair at
// x ≈ +17.9, z ≈ −4.3) in his 16:38:58 save on 2026-07-29. The te_sign view had
// selected purely by fixtureType, so it silently swallowed both — and because
// `planar` scales by true world CELL size (not fit-to-canvas), two signs 34
// world units apart blew the panel to 2.7× the canvas width and 11× its height:
// the view rendered almost entirely off-screen. One panel PER SIGN restores the
// true, readable cell scale for each and shows both (report 20260725_48 add. 2).
export const TE_SIGN_GROUPS = ['TE Sign', 'TE Sign 2'];
export const TE_SIGN_TYPES = ['TeSignV3A40', 'TeSignV3B34'];

// ─── Vintage LED pitch (Front view) ────────────────────────────────────────
// Operator, 2026-07-30: "resize the vintage pixels to 6 circles that are a bit
// bigger." A VintageLed fixture really IS 6 LEDs — verified against the live
// model, every VintageLed cluster carries exactly 6 pixels, so "6 circles" is
// one circle per LED and not a magic number — but they sit inside a ~0.38-unit
// diagonal, a pitch of 0.075 world units. At the Front view's whole-side scale
// (~37 design units per world unit) that is 2.8 design units between centres,
// so six 15-unit discs fuse into the capsule he circled. Six visible circles is
// therefore impossible from glyph sizing alone — at a size that would separate
// them they would be ~2 design units, i.e. invisible.
//
// 0.6 world units of pitch renders as ~22 design units on both Front panels, so
// six 16-unit discs sit with a ~6-unit gap. Chosen to fit INSIDE the existing
// panel bounds (the stretched fixtures stay within the bars' and ropes' extents
// on both sides), so the panel's fit box — and therefore every other fixture's
// size and position — is completely unchanged.
export const VINTAGE_LED_PITCH = { VintageLed: 0.6 };

const ORPHAN_EXCLUDE = ORPHAN_GROUPS.map((group) => ({ group }));
// Keyed on fixtureType, so it keeps EVERY sign out of top_down/strands — the
// second sign was excluded correctly from day one, unlike the te_sign view.
const TE_SIGN_EXCLUDE = TE_SIGN_TYPES.map((fixtureType) => ({ fixtureType }));

// ─── The four default views ────────────────────────────────────────────────
export const DEFAULT_VIEWS = [
  // 1) TOP-DOWN — ONE true top-down projection of the bars, strands, chimney
  //    rings, small smoke stacks, and both auditorium rows.
  //
  //    Operator ruling (Sina): the par rings must read AT THE CENTRE of the LED
  //    cluster they crown, not parked in a side panel. Physically they already
  //    are: each par ring sits on a smoke stack dead inside the strand fan that
  //    hangs off that same stack. The old layout split them into a weight-1
  //    `radial` "Smoke Stacks" panel, which re-normalised their world coords
  //    into that panel's own box and threw the two rings out to the far right of
  //    the pane — spatially a lie. `spatial` expands as a whole-panel TRUE world
  //    projection (projectedPanelPixels), so every par lands at its real
  //    top-down position with no per-fixture fudge to keep in sync.
  //
  //    Second operator pass (report 20260725_48) — three surgical changes, no
  //    restructuring ("the top view looks good"):
  //      (a) "make some room for the par lights to fit nicely in the middle of
  //          the LED strands" — the strand dots are shrunk on THIS VIEW ONLY
  //          (7 → 4 design units below), so a strand reads as a thin line
  //          instead of a 7-wide ribbon that fills the space the rings sit in.
  //          Nothing moves; the projection stays true.
  //      (b) "make the par light LEDs show individually and not overlap much" —
  //          each par is ONE pixel, and where a par sits on a strand in the
  //          top-down projection (some are within half a design unit — they are
  //          metres apart in Y, only the projection stacks them) the strand's
  //          40-pixel ribbon used to paint last and swallow it. `byPaintOrder`
  //          in pixel_map_layout now paints many-pixel runs first and sparse
  //          fixtures last, so every par in the ring reads as its own disc.
  //      (c) "add the two small smoke stacks … each as a small circle" —
  //          SMALL_SMOKESTACK_GROUPS, four pars each on a ~1-unit ring.
  //    Plus: the 12 orphan duplicates are excluded, so a bar row is 5 bars, not
  //    5 bars drawn twice.
  {
    id: 'top_down',
    label: 'Top-Down',
    panels: [
      {
        id: 'main',
        label: 'Bars + Strands + Stacks + Auditoriums',
        select: [
          { fixtureType: 'ShehdsBar' },
          { kind: 'led' },
          ...CHIMNEY_GROUPS.map((group) => ({ group })),
          ...SMALL_SMOKESTACK_GROUPS.map((group) => ({ group })),
          ...AUDITORIUM_GROUPS.map((group) => ({ group })),
        ],
        // The TE Sign V3 halves are LED-CLASS by ruling (kind: 'led') but belong
        // to the te_sign view, NOT here — exclude them so `{kind:'led'}` stays
        // "LED bars + strands" (operator spec, 2026-07-24).
        exclude: [...TE_SIGN_EXCLUDE, ...ORPHAN_EXCLUDE],
        projection: 'top',
        layout: 'spatial',
        // No offsets, pitch stretching, gap compression, or perspective. The
        // artistic treatment comes from the glyph styles below; geometry stays
        // an honest, uniformly scaled x/z orthographic projection.
      },
    ],
    // Per-VIEW type styles (the existing view.typeStyles affordance) — every
    // other view keeps the shipped glyph sizes.
    //   UkingPar 24 → 13: at whole-ship scale a par ring is only ~50 design
    //     units across, so the full-size par disc would fuse the ring into a
    //     solid donut.
    //   LedStrand 7 → 4: the operator's "make some room for the par lights"
    //     (a) above. A strand's pixels are ~1 design unit apart here, so at 4
    //     they still read as one continuous line — just a much thinner one.
    //   ShehdsBar 17 → 14: he circled each bar in the top and bottom rows
    //     INDIVIDUALLY and asked for distinct boxes with visible gaps "like the
    //     front view has" (2026-07-30). A bar's 18 LEDs span only 0.82 world
    //     units, so a bar draws as one blob whose length is (0.82 × scale) plus
    //     the glyph's end-caps; at the old 17 the blob nearly touched its
    //     neighbour 3.0 units away. Trimming the glyph shortens the end-caps
    //     while the positions retain their honest orthographic spacing. 14
    //     keeps them clearly beefier than the 13 they
    //     were before his earlier "a bit wider" ruling (report 20260725_40), and
    //     stays SQUARE so a bar reads the same at any rotation — the right-hand
    //     rows run diagonally.
    //   LedStrand 4 → 5: "the strands … keep, maybe slightly more prominent".
    //     Their pixels are ~1.3 design units apart here, so 5 is still a solid
    //     continuous line, just a slightly heavier one.
    typeStyles: {
      UkingPar: { sizeX: 13, sizeY: 13 },
      LedStrand: { sizeX: 5, sizeY: 5 },
      ShehdsBar: { sizeX: 14, sizeY: 14 },
    },
  },

  // 2) FRONT — the FRONT lights only, one panel per side of the ship.
  //
  //    Operator spec (report 20260725_48): "only the front lights: the LED bars,
  //    the vintage lights, plus 2 lines for the LED strings in the front … on
  //    each side" — i.e. TWO ropes per side, FOUR in total (his 2026-07-29
  //    correction: they are the front smoke-stack ropes) — then "optimize the
  //    view so I can see the pixels nicely".
  //
  //    Why TWO panels and not one. The two halves of the ship stand ~50 world
  //    units apart with nothing between them, and they are only ~10 units tall,
  //    so ONE front-elevation panel projects to a 60 × 9 sliver: `spatial` fits
  //    aspect-preserving (deliberately — it must not distort), which pinned the
  //    content to a 93 %-wide × 24 %-tall band with three quarters of the pane
  //    empty and the pixels tiny. That is exactly the picture the operator
  //    objected to. Each side on its own is 18.0 × 12.3 (port) and 14.1 × 12.5
  //    (starboard) — near the design canvas' own 900 × 520 aspect — so a panel
  //    per side lands 37.0 / 36.4 design units per world unit against the single
  //    panel's 13.9, i.e. ~2.7×. Each panel is still a TRUE, undistorted front
  //    elevation of that side; only the two sides' relative left/right offset is
  //    given up, and there was never anything drawn in that gap to lose.
  {
    id: 'front',
    label: 'Front',
    panels: [
      {
        id: 'left',
        label: 'Left Front',
        select: [
          { group: FRONT_BAR_GROUPS[0] },
          { group: FRONT_VINTAGE_GROUPS[0] },
          ...FRONT_STRAND_GROUPS[0].map((group) => ({ group })),
        ],
        projection: 'front',
        layout: 'spatial',
        expandPitch: VINTAGE_LED_PITCH,
      },
      {
        id: 'right',
        label: 'Right Front',
        select: [
          { group: FRONT_BAR_GROUPS[1] },
          { group: FRONT_VINTAGE_GROUPS[1] },
          ...FRONT_STRAND_GROUPS[1].map((group) => ({ group })),
        ],
        projection: 'front',
        layout: 'spatial',
        expandPitch: VINTAGE_LED_PITCH,
      },
    ],
    // "Resize the vintage pixels to 6 circles that are a bit bigger" (Sina,
    // 2026-07-30). 16 is a touch larger than the shipped 15 AND ~0.72 of the
    // stretched pitch below, so the six read as six circles with a clear gap
    // rather than fusing into a new sausage.
    typeStyles: { VintageLed: { sizeX: 16, sizeY: 16 } },
  },

  // 3) STRANDS — the LED strands on their own (spatial by default; the shell
  //    offers a one-click toggle to a `lanes` layout).
  {
    id: 'strands',
    label: 'LED Strands',
    panels: [
      {
        id: 'main',
        select: [{ kind: 'led' }],
        // Strands ALONE — the TE Sign V3 halves are LED-class (kind: 'led') but
        // are not strands; keep them out so this view is the strands only.
        exclude: [...TE_SIGN_EXCLUDE],
        projection: 'top',
        layout: 'spatial',
      },
    ],
  },

  // 4) TE SIGN — the real TE Sign V3 pair (two interlocking logo halves,
  //    74 px total) projected from their real per-pixel dots via `planar`.
  //
  //    ROTATED 90° CCW (operator, report 20260725_48: "the sign's 2D pixel
  //    layout is rotated wrong — rotate it 90 degrees counter-clockwise"). The
  //    sign hangs on a VERTICAL plane at x ≈ −15.5, so its two widest world axes
  //    are Y (2.16) and Z (1.59) — and `planar` picks the widest first, which
  //    put world UP along screen X and drew the logo lying on its side. The
  //    quarter turn puts world up back on screen up. It re-orients the whole
  //    projection; no pixel moves relative to another.
  //
  //    ONE PANEL PER SIGN. `planar` is a shared-frame layout scaled by true world
  //    CELL size, never fitted to the canvas — that is what makes a single logo
  //    render at honest size. Put two signs 34 world units apart in one panel and
  //    that same rule blows the content to 2.7 × the canvas width, which is
  //    exactly what happened the moment 'TE Sign 2' appeared. Per-sign panels keep
  //    each logo at its true cell scale AND keep the interlocking A/B halves of
  //    one sign in a shared frame, which is the whole reason `planar` exists.
  {
    id: 'te_sign',
    label: 'TE Sign',
    panels: TE_SIGN_GROUPS.map((group, i) => ({
      id: `sign_${i + 1}`,
      label: group,
      // group AND fixtureType (selector keys are ANDed), so neither a non-sign
      // fixture dropped into the group nor a third sign elsewhere can sneak in.
      select: TE_SIGN_TYPES.map((fixtureType) => ({ fixtureType, group })),
      layout: 'planar',
      rotate: 90,
    })),
  },
];

/** A fresh, validated container holding exactly the four default views. */
export function buildDefaultViews() {
  const container = createViewsContainer(undefined);
  for (const v of DEFAULT_VIEWS) addView(container, v);
  return container;
}

/**
 * Seed the four defaults into a container that has none. Returns true when it
 * seeded, false when the container already had views (no clobber). Used on
 * first open of a scene without a persisted `pixelMapViews`.
 */
export function seedDefaultViews(container) {
  if (!container || container.views.length > 0) return false;
  for (const v of DEFAULT_VIEWS) addView(container, v);
  return true;
}
