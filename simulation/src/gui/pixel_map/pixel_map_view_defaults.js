/**
 * pixel_map_view_defaults.js — the four shipped default views for the 2D
 * Pixel Map multiview, expressed purely as data (design report 20260724_9
 * §2.2). Seeded into `params.pixelMapViews` on first open of a scene that has
 * none; from there they are ordinary, editable views.
 *
 * The selectors are keyed on the titanic scene's real fixture vocabulary,
 * verified against `scenes/titanic/scene_config.yaml`:
 *   ShehdsBar ×24, VintageLed ×20, UkingPar ×38, the TE Sign V3 pair
 *   (TeSignV3A40 + TeSignV3B34, group 'TE Sign', 74 px), plus the LED strands
 *   (kind: 'led'). NOTE (operator ruling, 2026-07-24): the TE sign is DMX-wired
 *   but classified as an LED fixture, so its cluster `kind` is 'led' too. To
 *   keep membership to spec, top_down + strands EXCLUDE fixtureTypes
 *   'TeSignV3A40'/'TeSignV3B34' (they live in the te_sign view). The two chimney
 *   par rings are the groups
 *   'Left Top Chimney Generator' and 'Right Top Chimney Generator'
 *   (UkingPar ×10 each) — see the smoke-stack note below.
 */

import { createViewsContainer, addView } from './pixel_map_views.js';

// The exact group names of the two chimney par rings in the titanic scene.
// NOTE: the scene has TWO 10-par chimney groups, NOT one "8 pars in a circle".
// The top-down `stacks` panel therefore selects BOTH groups and lays each out
// as its own radial ring (the `radial` layout draws one ring per group). This
// is fully data-driven: to focus a single stack, edit the panel's `select`.
export const CHIMNEY_GROUPS = [
  'Left Top Chimney Generator',
  'Right Top Chimney Generator',
];

// ─── The four default views ────────────────────────────────────────────────
export const DEFAULT_VIEWS = [
  // 1) TOP-DOWN — LED bars + strands seen true top-down, plus a separate
  //    smoke-stack section showing the two chimney par rings.
  {
    id: 'top_down',
    label: 'Top-Down',
    panels: [
      {
        id: 'main',
        label: 'Bars + Strands',
        select: [
          { fixtureType: 'ShehdsBar' },
          { kind: 'led' },
        ],
        // The TE Sign V3 halves are LED-CLASS by ruling (kind: 'led') but belong
        // to the te_sign view, NOT here — exclude them so `{kind:'led'}` stays
        // "LED bars + strands" (operator spec, 2026-07-24).
        exclude: [{ fixtureType: 'TeSignV3A40' }, { fixtureType: 'TeSignV3B34' }],
        projection: 'top',
        layout: 'spatial',
        weight: 3,
      },
      {
        id: 'stacks',
        label: 'Smoke Stacks',
        select: [
          { group: CHIMNEY_GROUPS[0] },
          { group: CHIMNEY_GROUPS[1] },
        ],
        layout: 'radial',
        weight: 1,
      },
    ],
  },

  // 2) FRONT — the front-facing fixtures: bars + vintage lights.
  {
    id: 'front',
    label: 'Front',
    panels: [
      {
        id: 'main',
        select: [
          { fixtureType: 'ShehdsBar' },
          { fixtureType: 'VintageLed' },
        ],
        projection: 'front',
        layout: 'spatial',
      },
    ],
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
        exclude: [{ fixtureType: 'TeSignV3A40' }, { fixtureType: 'TeSignV3B34' }],
        projection: 'top',
        layout: 'spatial',
      },
    ],
  },

  // 4) TE SIGN — the real TE Sign V3 pair (two interlocking logo halves,
  //    74 px total) projected from their real per-pixel dots via `planar`.
  {
    id: 'te_sign',
    label: 'TE Sign',
    panels: [
      {
        id: 'main',
        select: [{ fixtureType: 'TeSignV3A40' }, { fixtureType: 'TeSignV3B34' }],
        layout: 'planar',
      },
    ],
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
