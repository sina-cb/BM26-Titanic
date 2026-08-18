/**
 * pixel_view_logic — the PURE brain of the Deck PIXELS window (report _225).
 *
 * ZERO react / react-native imports on purpose: the vitest config only admits
 * pure `.ts` under `components/**`, so every rule below is unit-testable in
 * plain Node. `pixel_view_window.tsx` may only ASK this module questions — it
 * never re-derives a geometry or colour fact of its own.
 *
 * ── WHERE THE PICTURE COMES FROM ────────────────────────────────────────────
 *
 * GEOMETRY is the SIMULATION's, not ours and not the engine's (operator, this
 * session: "simulation 2d pixels are the source of truth please"). The sim's
 * 2D Pixel Map resolver (`simulation/src/gui/pixel_map/pixel_map_layout.js` +
 * `pixel_map_views.js`) is run offline over the operator's authored
 * `simulation/scenes/titanic/pixel_map_views.yaml` by
 * `simulation/tools/export_touch_control_pixel_views.mjs`, and the RESOLVED
 * result — every pixel's design-space x/y, its size, its shape — is serialized
 * to `docs/ui/touch_control_pixel_views.json`. The simulation's own HTTP
 * server (:6969) serves the repo root, so that artifact is a plain read-only
 * GET away (see `utils/simulation_url.ts`).
 *
 * We therefore consume the SIM RESOLVER'S OUTPUT verbatim. We do not project,
 * we do not fit world coordinates, we do not re-implement the operator's
 * `compress` / `expandPitch` / `rotate` departures — every one of those already
 * happened inside the sim before the artifact was written. Reproducing that
 * math here would be a second implementation to drift; the whole point of the
 * artifact is that there is only ever one.
 *
 * COLOUR is the engine's existing `/ws/viz` broadcast (`utils/engineVizEvents`)
 * — the same `vis` frame the mixer's PixelStrip and the deck's master strip
 * already paint from. No new WS type, no new socket, read-only.
 *
 * ── PANELS ARE SEPARATE CANVASES, NOT ONE SHARED SPACE (fixed in _239) ──────
 *
 * A view's panels each carry glyph coordinates in the SIM's FULL design space
 * (900×520) — the sim's exporter lays every panel out against the whole canvas
 * independently and expects the consumer to give each one its own sub-rect.
 * `front` is LEFT-front + RIGHT-front; `te_sign` is sign 1 + sign 2. Merging
 * their coordinate spaces — which _225 did, on the mistaken note that "the
 * shipped Titanic views are single-panel" — draws the two halves of the ship
 * ON TOP OF EACH OTHER. That is exactly what the operator saw: FRONT squeezed
 * into a band, TE SIGN a meaningless cloud of dots.
 *
 * `layoutView()` delegates to `shared/pixel_view_projection.js`, the one final
 * viewport projection executed by Deck and Live Touch. It splits the viewport
 * into weighted strips, letterboxes the shared glyph bounds, fits the composite
 * at `FIT_FILL`, and chooses the axis that measures larger. The two surfaces
 * therefore cannot drift into different panel layouts.
 *
 * The one thing deliberately NOT ported is `view.framing` (zoom / panX / panY).
 * Those are the operator's framing of the LIVE TOUCH PAD, in that surface's
 * pixels — `top_down` carries panY −118, which is a sensible nudge on a
 * full-screen pad and a third of the picture off-screen in a deck window. The
 * per-view auto-fit here is measured from the glyphs themselves, so it holds at
 * any window size and for any view added later.
 *
 * ── THE RESOLUTION SEAM (read this before "fixing" any banding) ─────────────
 *
 * The engine subsamples its vis broadcast, and since _239 it does so PER KEY
 * (`marsin_engine/lib/vis_budget.js`): per-channel keys stay capped at
 * `vis.maxPixels` (100) because each one costs an RN <View> per sample in
 * `ChannelVizStrip`, while the whole-rig composites this window reads —
 * `rig` and `preDimmer` — ship at `full` rate, because a canvas costs per
 * pixel DRAWN, not per sample received.
 *
 * So on the shipped config this window gets 964 samples for a 964-pixel model
 * and every drawn pixel carries its OWN colour: `buildSampleLookup()` returns
 * `null`, the upsampling path is not merely an identity but is not walked at
 * all, and the caption says so.
 *
 * The capped path is kept, exact and tested, because it is still reachable —
 * an operator may lower `keyMaxPixels` to save WiFi, and an older engine has
 * no per-key caps at all. On that path this module does the honest thing and
 * says so out loud:
 *   • it draws EVERY mapped pixel at its true sim position (the shape of the
 *     ship is exact — that is what "representative" means here), and
 *   • it colours each one from the NEAREST TRANSMITTED SAMPLE, which because
 *     model indices run contiguously along a strand is a ~10-pixel colour band
 *     travelling along that strand — a resolution statement, not an invention,
 *   • and `describeColourResolution()` puts the real numbers on screen so the
 *     operator can SEE the ratio he is looking at.
 *
 * That last bullet is the codex P0 clause being honoured: the approximation is
 * declared, never silent. Nothing here fabricates a colour for a pixel the
 * engine said nothing about — every pixel's colour is a real byte the engine
 * really sent, at worst shared with its neighbours.
 */

import {
  FIT_FILL as SHARED_FIT_FILL,
  arrangePanels as arrangeSharedPixelPanels,
  layoutView as layoutSharedPixelView,
} from '@/shared/pixel_view_projection';

/** Schema version this module speaks. A mismatch is a HARD refusal: the
 *  artifact's shape is the contract, and rendering a v5 tree with v4 rules
 *  would silently draw the wrong ship. */
export const PIXEL_VIEW_SCHEMA_VERSION = 4;

/** Path of the sim-resolved artifact ON THE SIMULATION's HTTP server. */
export const PIXEL_VIEW_ARTIFACT_PATH = '/docs/ui/touch_control_pixel_views.json';

/** One pixel, exactly as the sim's resolver placed it (design-space units). */
export interface PixelGlyph {
  /** Index into the ENGINE model's pixel array — the join key to a vis frame. */
  pixelIndex: number;
  fixtureKey: string;
  fixtureType: string;
  kind: string;
  group: string;
  x: number;
  y: number;
  sizeX: number;
  sizeY: number;
  shape: string;
}

export interface PixelViewPanel {
  id: string;
  label: string;
  /** Share of the viewport's width this panel gets (see layoutView). */
  weight: number;
  glyphs: PixelGlyph[];
}

export interface PixelViewDef {
  id: string;
  label: string;
  panels: PixelViewPanel[];
}

/** The sim's fixed design space. EVERY panel's glyph x/y are in these units —
 *  panels do not share a space, they each fill this one (see layoutView). */
export interface PixelViewDesign {
  width: number;
  height: number;
  /** Gap between panel columns, in viewport px, when a view has >1 panel. */
  panelGap: number;
}

export interface PixelViewArtifact {
  schemaVersion: number;
  design: PixelViewDesign;
  /** Pixel count of the model the artifact was resolved against. */
  modelPixelCount: number;
  views: PixelViewDef[];
}

/** One panel's slice of a flattened view: a contiguous glyph range plus its
 *  own design-space bounds, because each panel is laid out separately. */
export interface FlatPixelPanel {
  id: string;
  label: string;
  weight: number;
  /** Half-open glyph range [start, end) into the view's parallel arrays. */
  start: number;
  end: number;
  /** Tight bounds of THIS panel's glyphs, in the sim's design space. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Flat, draw-ready form of one view: parallel typed arrays instead of an
 *  array of objects, so the render loop touches contiguous memory and never
 *  allocates. Built ONCE per view, reused for every frame. */
export interface FlatPixelView {
  id: string;
  label: string;
  count: number;
  /** Design-space centres. */
  xs: Float32Array;
  ys: Float32Array;
  /** Design-space glyph sizes. */
  ws: Float32Array;
  hs: Float32Array;
  /** 1 = circle, 0 = square/rect. */
  round: Uint8Array;
  /** Model pixel index per glyph — the join key into a vis frame. */
  modelIndex: Int32Array;
  /** The view's panels, in the operator's authored order. */
  panels: FlatPixelPanel[];
  /** UNION of every panel's bounds, in design space. Not a drawable region —
   *  the panels do not share a space — but the common box each panel is
   *  letterboxed through, so every panel draws at ONE scale and keeps its true
   *  position relative to the others. See layoutView. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

// ── Artifact validation (fail loud — codex P0) ─────────────────────────────

function fail(message: string): never {
  throw new Error(`[PixelView] ${message}`);
}

function num(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${where} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value as number;
}

function str(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${where} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value as string;
}

/**
 * Validate + narrow a raw artifact document. THROWS on anything unexpected —
 * an artifact we cannot read is a stale or wrong-scene deploy, and drawing a
 * partial ship from it would be worse than showing the operator the error.
 */
export function parsePixelViewArtifact(raw: unknown): PixelViewArtifact {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('artifact must be a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  const version = doc.schemaVersion;
  if (version !== PIXEL_VIEW_SCHEMA_VERSION) {
    fail(
      `artifact schemaVersion is ${JSON.stringify(version)} but this build speaks ` +
      `v${PIXEL_VIEW_SCHEMA_VERSION} — re-run simulation/tools/export_touch_control_pixel_views.mjs`,
    );
  }
  const design = doc.design;
  if (design === null || typeof design !== 'object' || Array.isArray(design)) {
    fail('artifact.design must be an object { width, height }');
  }
  const d = design as Record<string, unknown>;
  const width = num(d.width, 'design.width');
  const height = num(d.height, 'design.height');
  if (!(width > 0) || !(height > 0)) fail('design.width/height must be positive');
  // Required, not defaulted: a multi-panel view laid out with the WRONG gap is
  // a picture that is subtly and silently mis-framed, and the sim always
  // writes it (`export_touch_control_pixel_views.mjs`). An artifact without it
  // is an artifact from a different exporter than the one we speak.
  const panelGap = num(d.panelGap, 'design.panelGap');
  if (!(panelGap >= 0)) fail(`design.panelGap must be zero or positive, got ${panelGap}`);

  const modelPixelCount = num(doc.modelPixelCount, 'artifact.modelPixelCount');
  if (!(modelPixelCount > 0)) fail('artifact.modelPixelCount must be positive');

  if (!Array.isArray(doc.views) || doc.views.length === 0) {
    fail('artifact.views must be a non-empty array');
  }

  const views: PixelViewDef[] = doc.views.map((rawView, vi) => {
    if (rawView === null || typeof rawView !== 'object' || Array.isArray(rawView)) {
      fail(`views[${vi}] must be an object`);
    }
    const v = rawView as Record<string, unknown>;
    const id = str(v.id, `views[${vi}].id`);
    if (!Array.isArray(v.panels) || v.panels.length === 0) {
      fail(`view '${id}' has no panels`);
    }
    const panels: PixelViewPanel[] = v.panels.map((rawPanel, pi) => {
      if (rawPanel === null || typeof rawPanel !== 'object' || Array.isArray(rawPanel)) {
        fail(`view '${id}' panels[${pi}] must be an object`);
      }
      const p = rawPanel as Record<string, unknown>;
      const pid = str(p.id, `view '${id}' panels[${pi}].id`);
      const weight = num(p.weight, `view '${id}' panel '${pid}'.weight`);
      if (!(weight > 0)) {
        fail(`view '${id}' panel '${pid}'.weight must be positive, got ${weight}`);
      }
      if (!Array.isArray(p.glyphs)) {
        fail(`view '${id}' panel '${pid}' has no glyphs array`);
      }
      const glyphs: PixelGlyph[] = p.glyphs.map((rawGlyph, gi) => {
        if (rawGlyph === null || typeof rawGlyph !== 'object' || Array.isArray(rawGlyph)) {
          fail(`view '${id}' panel '${pid}' glyphs[${gi}] must be an object`);
        }
        const g = rawGlyph as Record<string, unknown>;
        const where = `view '${id}' panel '${pid}' glyphs[${gi}]`;
        const pixelIndex = num(g.pixelIndex, `${where}.pixelIndex`);
        if (!Number.isInteger(pixelIndex) || pixelIndex < 0) {
          fail(`${where}.pixelIndex must be a non-negative integer, got ${pixelIndex}`);
        }
        if (pixelIndex >= modelPixelCount) {
          fail(
            `${where}.pixelIndex ${pixelIndex} is outside the artifact's own ` +
            `modelPixelCount (${modelPixelCount}) — the artifact is internally inconsistent`,
          );
        }
        return {
          pixelIndex,
          fixtureKey: typeof g.fixtureKey === 'string' ? g.fixtureKey : '',
          fixtureType: typeof g.fixtureType === 'string' ? g.fixtureType : '',
          kind: typeof g.kind === 'string' ? g.kind : '',
          group: typeof g.group === 'string' ? g.group : '',
          x: num(g.x, `${where}.x`),
          y: num(g.y, `${where}.y`),
          sizeX: num(g.sizeX, `${where}.sizeX`),
          sizeY: num(g.sizeY, `${where}.sizeY`),
          shape: typeof g.shape === 'string' ? g.shape : 'square',
        };
      });
      return { id: pid, label: typeof p.label === 'string' ? p.label : pid, weight, glyphs };
    });
    return { id, label: typeof v.label === 'string' ? v.label : id, panels };
  });

  return {
    schemaVersion: PIXEL_VIEW_SCHEMA_VERSION,
    design: { width, height, panelGap },
    modelPixelCount,
    views,
  };
}

/**
 * The view to open on. The operator's own first authored view is the right
 * answer — the artifact preserves his ordering, and `top_down` (the Titanic
 * from above) is what "the 2D pixel view" means to him. Named lookup first so
 * a re-ordered artifact still opens on the ship rather than on the TE sign.
 */
export const PREFERRED_VIEW_ID = 'top_down';

export function pickDefaultView(artifact: PixelViewArtifact): PixelViewDef {
  const preferred = artifact.views.find((v) => v.id === PREFERRED_VIEW_ID);
  return preferred || artifact.views[0];
}

/**
 * Flatten a view's panels into one draw-ready set of typed arrays, keeping
 * each panel's glyph RANGE and its own design-space bounds.
 *
 * The glyphs go in one contiguous run (the hot loop is still a single pass),
 * but the panels are NOT merged into one coordinate space — every panel's
 * coordinates fill the sim's whole design rect, so each needs its own
 * transform at paint time. See layoutView(), and the header's PANELS section
 * for what merging them looked like on screen.
 */
export function flattenView(view: PixelViewDef): FlatPixelView {
  let count = 0;
  for (const panel of view.panels) count += panel.glyphs.length;
  if (count === 0) {
    fail(`view '${view.id}' resolved to zero glyphs — nothing to draw`);
  }

  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const ws = new Float32Array(count);
  const hs = new Float32Array(count);
  const round = new Uint8Array(count);
  const modelIndex = new Int32Array(count);
  const panels: FlatPixelPanel[] = [];

  let i = 0;
  for (const panel of view.panels) {
    const start = i;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const g of panel.glyphs) {
      xs[i] = g.x;
      ys[i] = g.y;
      ws[i] = g.sizeX;
      hs[i] = g.sizeY;
      round[i] = g.shape === 'circle' ? 1 : 0;
      modelIndex[i] = g.pixelIndex;
      const hw = g.sizeX / 2;
      const hh = g.sizeY / 2;
      if (g.x - hw < minX) minX = g.x - hw;
      if (g.y - hh < minY) minY = g.y - hh;
      if (g.x + hw > maxX) maxX = g.x + hw;
      if (g.y + hh > maxY) maxY = g.y + hh;
      i += 1;
    }
    if (i === start) {
      fail(`view '${view.id}' panel '${panel.id}' has no glyphs — nothing to lay out`);
    }
    panels.push({
      id: panel.id,
      label: panel.label,
      weight: panel.weight,
      start,
      end: i,
      bounds: { minX, minY, maxX, maxY },
    });
  }

  const bounds = {
    minX: Math.min(...panels.map((p) => p.bounds.minX)),
    minY: Math.min(...panels.map((p) => p.bounds.minY)),
    maxX: Math.max(...panels.map((p) => p.bounds.maxX)),
    maxY: Math.max(...panels.map((p) => p.bounds.maxY)),
  };

  return { id: view.id, label: view.label, count, xs, ys, ws, hs, round, modelIndex, panels, bounds };
}

// ── Viewport fit ───────────────────────────────────────────────────────────

/**
 * Fraction of the viewport the fitted picture fills, leaving a margin so the
 * outermost glyph's halo is not clipped by the canvas edge. The SIM's own
 * value (`docs/ui/touch_control_pixel_views.js` → `FIT_FILL`), so the deck
 * window and the Live Touch pad leave the same breathing room.
 */
export const FIT_FILL = SHARED_FIT_FILL;

export interface ViewTransform {
  /** design units → CSS px. */
  scale: number;
  /** CSS px offsets applied AFTER scaling. */
  offsetX: number;
  offsetY: number;
}

/**
 * How a view's panels are arranged. `columns` is the sim's own arrangement
 * (`panelSubRects` splits WIDTH); `rows` is the same construction on the other
 * axis, and exists because a deck window is not a full-screen pad.
 */
export type PanelAxis = 'columns' | 'rows';

/**
 * Arrange + fit a view along ONE axis. The executable arithmetic lives in the
 * shared Deck/Live projection module; this typed adapter preserves the Deck API:
 *
 *   1. Split the viewport into strips along `axis`, sized proportionally to
 *      panel weight and separated by `design.panelGap` (no gap for a single
 *      panel).
 *   2. Letterbox the view's COMMON BOX — `flat.bounds`, the union of every
 *      panel's own bounds — into each strip. This is what gives each panel its
 *      own space instead of stacking them on top of each other.
 *
 *      The sim's own consumer letterboxes the full 900×520 DESIGN RECT here.
 *      Same construction, but the design rect carries the empty margin the
 *      operator's authored views leave around their content, and on a
 *      deck-sized canvas that margin is charged TWICE — once per panel — so
 *      `te_sign`'s two signs ended up as small clusters with a chasm between
 *      them (measured, 618×463: scale 0.457 through the design rect, 0.837
 *      through the common box — the same signs, 1.8× larger, nothing moved
 *      relative to anything else). The union box trims the margin ONCE,
 *      uniformly, from a frame all
 *      panels share, so every panel still draws at one scale and keeps its true
 *      position relative to the others. Nothing authored is lost; only unused
 *      canvas is.
 *   3. Measure the resulting composite's real extents and scale/centre THAT to
 *      fill `FIT_FILL` of the viewport.
 *
 * Aspect is preserved throughout: one scalar scale, never two.
 */
export function arrangePanels(
  flat: FlatPixelView,
  design: PixelViewDesign,
  viewportW: number,
  viewportH: number,
  axis: PanelAxis,
): { transforms: ViewTransform[]; glyphScale: number } {
  return arrangeSharedPixelPanels(flat, design, viewportW, viewportH, axis);
}

/**
 * Lay a view out into a viewport: ONE transform per panel, in panel order.
 *
 * Multi-panel views are arranged along whichever axis MEASURES BIGGER — the
 * arrangement is tried both ways and the one that draws the pixels larger
 * wins, ties going to the sim's own `columns`.
 *
 * Why not just copy the sim's column split: the Live Touch pad is a wide,
 * full-screen surface, where two side-by-side panels is always right. A deck
 * window is a track in a row of five and can be almost any shape. `front` is
 * two ~1.5:1 panels — side by side that composite is ~2.9:1, and in the deck's
 * 618×463 canvas it fits at scale 0.433 with the ship reduced to a band across
 * the middle (measured; it is exactly what the operator reported). Stacked,
 * the same two panels fit at 0.494 — same window, same pixels, aspect
 * untouched. In the narrow 283×433 track the gap is far wider: 0.195 → 0.401.
 * Widen the window to 900×500 and `columns` wins on the same measurement,
 * which is the point of measuring rather than deciding.
 *
 * This is a fitting decision, not a geometry one: which pixel is where still
 * comes only from the sim's artifact. And it is measured, never named — no
 * view is special-cased, so a view authored tomorrow frames itself correctly
 * with no change here.
 */
export function layoutView(
  flat: FlatPixelView,
  design: PixelViewDesign,
  viewportW: number,
  viewportH: number,
): ViewTransform[] {
  return layoutSharedPixelView(flat, design, viewportW, viewportH);
}

/** One panel's own box aspect (width:height of its tight glyph bounds). */
function panelBoxAspect(panel: FlatPixelPanel): number {
  const w = panel.bounds.maxX - panel.bounds.minX;
  const h = Math.max(1e-6, panel.bounds.maxY - panel.bounds.minY);
  return w / h;
}

/**
 * The aspect (width:height) of what `arrangePanels` would ACTUALLY draw for
 * `flat` at a given viewport + axis — `arrangePanels` itself, not a
 * shortcut. Its returned `transforms` are already fit + centred by a single
 * uniform scalar (`layoutView`'s own `fit` step), which cannot change an
 * aspect ratio, so re-deriving each panel's drawn extents from the returned
 * transforms and measuring their union gives EXACTLY the composite's true
 * shape — the same number `panelAxisFor`'s own glyphScale comparison is
 * built on, just exposed as a ratio instead of a scale.
 */
export function compositeAspectFor(
  flat: FlatPixelView,
  design: PixelViewDesign,
  viewportW: number,
  viewportH: number,
  axis: PanelAxis,
): number {
  const { transforms } = arrangePanels(flat, design, viewportW, viewportH, axis);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  flat.panels.forEach((panel, i) => {
    const t = transforms[i];
    const x0 = panel.bounds.minX * t.scale + t.offsetX;
    const x1 = panel.bounds.maxX * t.scale + t.offsetX;
    const y0 = panel.bounds.minY * t.scale + t.offsetY;
    const y1 = panel.bounds.maxY * t.scale + t.offsetY;
    if (x0 < minX) minX = x0;
    if (x1 > maxX) maxX = x1;
    if (y0 < minY) minY = y0;
    if (y1 > maxY) maxY = y1;
  });
  return (maxX - minX) / Math.max(1e-6, maxY - minY);
}

/**
 * Reference scale for `arrangedDesignAspect`'s asymptotic probe: large
 * enough that `design.panelGap`'s absolute-pixel contribution is negligible
 * relative to it, so the bisection below converges to a value that does not
 * depend (to float precision) on which large scale was chosen.
 */
const ASYMPTOTIC_PROBE_SCALE = 1e9;
const ASYMPTOTIC_ASPECT_LO = 0.001;
const ASYMPTOTIC_ASPECT_HI = 1000;
const ASYMPTOTIC_BISECT_ITERATIONS = 60;

/** A view/axis pair arranged with no panel gap — the idealized composite
 *  `arrangedDesignAspect` measures. */
const GAP_FREE_DESIGN: PixelViewDesign = { width: 1, height: 1, panelGap: 0 };

/**
 * Bisect for `a` such that `f(a) === a` (a fixed point), given `f` is
 * continuous and `[lo, hi]` brackets a sign change of `f(a) - a`. A valid
 * bracket makes bisection converge UNCONDITIONALLY — each pass halves the
 * interval, so `iterations` of them shrink it to `(hi-lo)/2^iterations`
 * (≈ 1e-15 of the starting span at the 60 used below, far past float64
 * precision) regardless of how `f` behaves inside the bracket. The one way
 * this can go wrong, and the only thing it throws for (codex P0 — never
 * silently return a guess that skipped this check), is `[lo, hi]` not
 * actually bracketing a root in the first place.
 */
function bisectFixedPoint(
  f: (a: number) => number,
  lo: number,
  hi: number,
  iterations: number,
  where: string,
): number {
  let a = lo;
  let b = hi;
  let ga = f(a) - a;
  const gb = f(b) - b;
  if (ga === 0) return a;
  if (gb === 0) return b;
  if ((ga < 0) === (gb < 0)) {
    fail(`${where}: [${lo}, ${hi}] does not bracket a fixed point (both ends land on the same side)`);
  }
  for (let i = 0; i < iterations; i += 1) {
    const mid = (a + b) / 2;
    const gMid = f(mid) - mid;
    if (gMid === 0) return mid;
    if ((gMid < 0) === (ga < 0)) { a = mid; ga = gMid; } else { b = mid; }
  }
  return (a + b) / 2;
}

/**
 * The arranged DESIGN ASPECT of a view along ONE candidate panel axis — the
 * `aspect` input to docs/64 §3.2's mixer-band canvas sizing (`canvasH =
 * clamp(slotWidth / aspect, MIN_BAND_H, capH)`).
 *
 * The TRUE composite aspect is the fixed point of `compositeAspectFor
 * (viewport of aspect A) === A` — the shape at which the arrangement exactly
 * fills the box it is given, so sizing a canvas to it leaves no letterbox.
 * That true fixed point is scale-DEPENDENT (`design.panelGap` is real
 * viewport pixels, not a proportion), so a single (flat, axis) number can
 * only be the idealized, gap-negligible limit — found here by bisecting
 * `compositeAspectFor` itself (`arrangePanels`, never a hand-derived
 * shortcut: an earlier version of this function summed each panel's OWN box
 * aspect independently, which is wrong — `arrangePanels` positions every
 * panel relative to the view's COMMON box, `flat.bounds`, so panels that sit
 * at different heights within that common box are not independently
 * rescaled, and a formula that pretends they are undercounts the composite).
 *
 * `computeBandCanvasSize` (`pixel_view_band_logic`) treats this as a strong
 * INITIAL estimate and axis-preference signal, then refines it against the
 * REAL `panelGap` at the REAL canvas size it is actually sizing — that
 * second pass is where the <1% void guarantee at real (small) band sizes
 * actually comes from; gap is not negligible at a 120–176 px cap.
 *
 * A single-panel view collapses to its own box aspect on both axes, exactly
 * (no iteration: there is nothing else to arrange it against).
 */
export function arrangedDesignAspect(flat: FlatPixelView, axis: PanelAxis): number {
  if (flat.panels.length === 0) {
    fail(`view '${flat.id}' has no panels — nothing to measure an aspect from`);
  }
  if (flat.panels.length === 1) {
    return panelBoxAspect(flat.panels[0]);
  }
  const probe = (a: number): number => {
    const viewportW = axis === 'columns' ? a * ASYMPTOTIC_PROBE_SCALE : ASYMPTOTIC_PROBE_SCALE;
    const viewportH = axis === 'columns' ? ASYMPTOTIC_PROBE_SCALE : a * ASYMPTOTIC_PROBE_SCALE;
    return compositeAspectFor(flat, GAP_FREE_DESIGN, viewportW, viewportH, axis);
  };
  return bisectFixedPoint(
    probe,
    ASYMPTOTIC_ASPECT_LO,
    ASYMPTOTIC_ASPECT_HI,
    ASYMPTOTIC_BISECT_ITERATIONS,
    `arrangedDesignAspect('${flat.id}', '${axis}')`,
  );
}

/** Which axis `layoutView` would choose. Exported for tests and diagnostics —
 *  the window itself only ever needs the transforms. */
export function panelAxisFor(
  flat: FlatPixelView,
  design: PixelViewDesign,
  viewportW: number,
  viewportH: number,
): PanelAxis {
  if (!(viewportW > 0) || !(viewportH > 0)) {
    fail(`viewport must be positive, got ${viewportW}×${viewportH}`);
  }
  if (flat.panels.length < 2) return 'columns';
  const columns = arrangePanels(flat, design, viewportW, viewportH, 'columns');
  const rows = arrangePanels(flat, design, viewportW, viewportH, 'rows');
  return rows.glyphScale > columns.glyphScale ? 'rows' : 'columns';
}

// ── Vis frame decode ───────────────────────────────────────────────────────

/** RGBWAU — six bytes per transmitted sample. */
export const BYTES_PER_SAMPLE = 6;

/**
 * The stage ground — the SIMULATION's own `BG` constant
 * (`pixel_map_renderer.js`), and deliberately NOT a theme token.
 *
 * This is an identity colour in the exact sense `constants/identity.ts`
 * defines: it identifies something that exists OUTSIDE this app's theme. The
 * pixels here are LIGHT, and light is only legible against dark — on the light
 * palette `surfaceContainerLowest` is literally `#ffffff`, which turns a dimmed
 * rig into invisible smudges on white (observed, first screenshot pass of
 * _225). The night sky does not flip with the operator's theme, the sim's
 * pixel map has always been near-black, and a monitor that agrees with the sim
 * is the whole point of this window. The chrome AROUND the stage stays fully
 * themed.
 */
export const PIXEL_STAGE_BG = '#0b0d12';

/** An UNLIT pixel's ink on that fixed ground — same cool grey family as the
 *  sim's off-fixture bezels, at an alpha that reads as "there, but dark". */
export const PIXEL_GHOST_INK = 'rgba(150,170,205,0.20)';

/**
 * Which engine buffer lights the map.
 *
 * Both are REAL keys on the same `vis` frame — this is a choice between two
 * truths, not between truth and a flattering lie, which is why the window
 * offers both and labels them.
 *
 *   SHOW (`preDimmer`) — the composition after global FX but BEFORE the
 *     section dimmers and blackout. The DEFAULT, and the same buffer the
 *     deck's own master strip directly above this window already draws. The
 *     engine documents the reason at engine.js ~1300: the dimmers "would
 *     otherwise wash the UI preview out to near-black". Measured on the live
 *     rig this session, `rig` averaged 50/1530 against `preDimmer`'s 173 —
 *     92 % of samples under value 40, i.e. exactly that wash-out.
 *
 *   RIG (`rig`) — post-dimmer, post-blackout hardware truth: what the LEDs are
 *     actually emitting. One tap away, because a monitoring surface that
 *     cannot show you the real output is only half a monitor.
 */
export interface PixelVisSource {
  key: string;
  label: string;
}

export const PIXEL_VIS_SOURCES: readonly PixelVisSource[] = [
  { key: 'preDimmer', label: 'SHOW' },
  { key: 'rig', label: 'RIG' },
];

export const DEFAULT_VIS_SOURCE = 'preDimmer';

/**
 * Display contribution of the W / A / U emitters, IDENTICAL to
 * `components/ui/PixelStrip.tsx`. One rig, one colour story: a pixel that
 * reads warm-white on the mixer's strip must read warm-white here.
 */
const W_R = 200 / 255, W_G = 220 / 255, W_B = 255 / 255; // cool white
const A_R = 255 / 255, A_G = 200 / 255, A_B = 50 / 255;  // yellow amber
const U_R = 75 / 255, U_G = 0 / 255, U_B = 130 / 255;    // dark purple

/**
 * Decode a base64 RGBWAU buffer into raw bytes.
 *
 * `decodeBase64` is injected because `atob` is a browser global: the render
 * layer passes the platform's decoder, and the tests pass Node's Buffer. No
 * try/catch — a malformed frame is an engine or transport bug and must be
 * heard, not swallowed into a black rig.
 */
export function decodeVisSamples(
  base64: string,
  decodeBase64: (b64: string) => Uint8Array,
): Uint8Array {
  const bytes = decodeBase64(base64);
  if (bytes.length % BYTES_PER_SAMPLE !== 0) {
    fail(
      `vis frame is ${bytes.length} bytes, which is not a whole number of ` +
      `${BYTES_PER_SAMPLE}-byte RGBWAU samples`,
    );
  }
  return bytes;
}

/** Browser base64 → bytes, using the platform `atob`. */
export function atobToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * The simulation's PREVIEW-ONLY brightness lift, ported verbatim from
 * `simulation/src/gui/pixel_map/pixel_map_renderer.js` (`_previewBrighten`,
 * PREVIEW_GAMMA 0.6) — because the operator asked for the sim's picture, and
 * this is half of why the sim's picture is legible.
 *
 * A gamma on the pixel's VALUE (its max channel) lifts dim and dimmed lights so
 * they read on a screen, while a pixel already at full brightness is left
 * essentially unchanged. All three channels are scaled by the SAME factor, so
 * hue and saturation are untouched — this brightens, it never recolours.
 *
 * Why it is not optional: the `rig` buffer is POST-dimmer, and a rig running at
 * 30 % (a completely ordinary show state) lands every pixel under RGB 40. Drawn
 * literally that is a black rectangle with a faint smudge in it — measured on
 * the live rig this session, `rig` averaged 50/1530 against `master`'s 173. The
 * sim solved this years ago; copying its constant is how the two surfaces agree.
 *
 * This changes NOTHING about output — sACN still carries the true colour. It is
 * a display transform on a monitor, exactly as it is in the sim.
 */
export const PREVIEW_GAMMA = 0.6;

export function previewBrighten(out: { r: number; g: number; b: number }): void {
  const v = Math.max(out.r, out.g, out.b);
  if (v <= 0) return;
  const s = Math.pow(v / 255, PREVIEW_GAMMA) / (v / 255);
  out.r = Math.min(255, Math.round(out.r * s));
  out.g = Math.min(255, Math.round(out.g * s));
  out.b = Math.min(255, Math.round(out.b * s));
}

/**
 * Collapse one RGBWAU sample to a display RGB triple, writing into `out`.
 * Same arithmetic as PixelStrip, minus its per-pixel string allocation — this
 * runs `count` times per frame and must not produce garbage.
 */
export function sampleToDisplayRgb(
  bytes: Uint8Array,
  sampleIndex: number,
  out: { r: number; g: number; b: number },
): void {
  const off = sampleIndex * BYTES_PER_SAMPLE;
  const r = bytes[off];
  const g = bytes[off + 1];
  const b = bytes[off + 2];
  const w = bytes[off + 3];
  const a = bytes[off + 4];
  const u = bytes[off + 5];
  out.r = Math.min(255, Math.round(r + w * W_R + a * A_R + u * U_R));
  out.g = Math.min(255, Math.round(g + w * W_G + a * A_G + u * U_G));
  out.b = Math.min(255, Math.round(b + w * W_B + a * A_B + u * U_B));
}

// ── Model pixel → transmitted sample ───────────────────────────────────────

/**
 * Which transmitted sample carries the colour for model pixel `modelIndex`.
 *
 * The engine's table is `visSampleIdx[i] = floor(i * modelCount / sampleCount)`
 * (marsin_engine/engine.js), i.e. sample `i` was read from model pixel
 * `i * modelCount / sampleCount`. Inverting and rounding gives the sample whose
 * SOURCE PIXEL is nearest to the one we are drawing.
 *
 * When the engine sends the model verbatim (`sampleCount >= modelCount`, i.e.
 * a rig under the cap) this is the identity and every pixel gets its own true
 * colour — the banding below is strictly a consequence of the cap, and
 * disappears on its own if the cap ever stops binding.
 */
export function sampleIndexForModelPixel(
  modelIndex: number,
  modelCount: number,
  sampleCount: number,
): number {
  if (!(sampleCount > 0)) fail(`sampleCount must be positive, got ${sampleCount}`);
  if (!(modelCount > 0)) fail(`modelCount must be positive, got ${modelCount}`);
  if (sampleCount >= modelCount) {
    return Math.min(sampleCount - 1, Math.max(0, modelIndex));
  }
  const i = Math.round((modelIndex * sampleCount) / modelCount);
  return Math.min(sampleCount - 1, Math.max(0, i));
}

/**
 * Precompute the glyph → sample lookup for a whole view. Built once per
 * (view, sampleCount) pair; the per-frame loop is then a straight array read.
 *
 * Returns `null` when the engine sent the model VERBATIM (`sampleCount >=
 * modelCount`, the shipped `keyMaxPixels: {rig: full, preDimmer: full}` case).
 * A lookup would then be the identity on the model index — i.e. exactly
 * `flat.modelIndex`, which the caller already has — so the honest answer is
 * "there is no resampling here", not a duplicated array the render loop walks
 * as though there were. The caller reads `flat.modelIndex` directly.
 */
export function buildSampleLookup(
  flat: FlatPixelView,
  modelCount: number,
  sampleCount: number,
): Int32Array | null {
  if (!(sampleCount > 0)) fail(`sampleCount must be positive, got ${sampleCount}`);
  if (!(modelCount > 0)) fail(`modelCount must be positive, got ${modelCount}`);
  if (sampleCount >= modelCount) return null;
  const out = new Int32Array(flat.count);
  for (let i = 0; i < flat.count; i += 1) {
    out[i] = sampleIndexForModelPixel(flat.modelIndex[i], modelCount, sampleCount);
  }
  return out;
}

/**
 * The one-line truth the window prints under the canvas. The operator should
 * never have to wonder how much of what he sees is real — so the numbers are
 * printed on BOTH paths, and the full-rate line says the ratio out loud
 * (`964/964`) rather than only asserting quality. A claim with its arithmetic
 * attached is checkable; "FULL RATE" alone is just a word.
 */
export function describeColourResolution(
  drawnPixels: number,
  sampleCount: number,
  modelCount: number,
): string {
  if (sampleCount >= modelCount) {
    return `${drawnPixels} PX · ${modelCount}/${modelCount} COLOUR SAMPLES · FULL RATE`;
  }
  return `${drawnPixels} PX · ${sampleCount}/${modelCount} COLOUR SAMPLES`;
}

/**
 * Does the artifact describe the model the engine is actually running?
 *
 * A scene change (or a stale checked-in artifact) would otherwise paint last
 * week's ship with this week's colours and look completely plausible. Returns
 * a human sentence to show, or null when the two agree.
 */
export function artifactModelMismatch(
  artifactPixelCount: number,
  enginePixelCount: number | null,
): string | null {
  if (enginePixelCount === null) return null;
  if (artifactPixelCount === enginePixelCount) return null;
  return (
    `The simulation's pixel map was resolved for a ${artifactPixelCount}-pixel model, ` +
    `but the engine is running a ${enginePixelCount}-pixel model. Re-run ` +
    'simulation/tools/export_touch_control_pixel_views.mjs for the active scene.'
  );
}
