/**
 * pixel_view_band_logic — the rules of the mixer's pixel-view band
 * (docs/58 §2.1, §2.3, §3.3). Pure: no React, no canvas, no network, so
 * vitest pins every string and every height the band renders.
 *
 * The band's SURFACE lives next door in `pixel_view_band.tsx`. Its geometry,
 * colour and honesty captions are NOT re-implemented here — they are
 * `components/deck/pixel_view_logic`'s, imported verbatim. One ship, one
 * renderer, one caption arithmetic.
 */
import {
  arrangedDesignAspect,
  compositeAspectFor,
  describeColourResolution,
  pickDefaultView,
  type FlatPixelView,
  type PanelAxis,
  type PixelViewArtifact,
  type PixelViewDesign,
} from '@/components/deck/pixel_view_logic';

function fail(message: string): never {
  throw new Error(`[PixelViewBand] ${message}`);
}

// ── Band geometry (docs/58 §2.2 / §2.3) ─────────────────────────────────────

/** Header row height. 28 px of chrome + the standard 8 pt hitSlop on every
 *  control = the 44 pt operator-safety floor. */
export const BAND_HEADER_HEIGHT = 28;

/**
 * Performance mode, per channel: the DOMINANT band fills the vacated LOCAL
 * PARAMS column (docs/58 §2.3), so it claims no fixed height at all — this is
 * only the FLOOR that stops a very short viewport collapsing it to nothing.
 *
 * Why the column and not "the edit band, taller" — measured, report _243:
 * a mixer strip card is `alignSelf:'stretch'` inside a horizontal ScrollView,
 * so its height is FIXED by the viewport and every pixel the band grows is a
 * pixel taken from something below it. On a 1440 × 900 landscape the card's
 * band region (~145 px) and its body (~85 px) are the whole budget; growing
 * the full-width band to 176 px pushed the PLAYLIST and the MUTE/SOLO/BUMP row
 * clean off the card (shot 06, second pass). Suppressing the edit band and
 * moving the view into the params column is not a compromise — it is the only
 * space that hiding the params actually frees. The design was right.
 *
 * What DID need correcting is the split: at the params column's 40 % the ship
 * is ~141 px wide and a ~3:1 top-down Titanic letterboxes into a smear. Perf
 * mode therefore gives the view the LARGER half of the body.
 */
export const DOMINANT_BAND_MIN_HEIGHT = 120;

/** Performance-mode body split: the view takes the larger share, the playlist
 *  keeps enough width for its entry names. Edit mode stays 60/40 the other
 *  way, because a column of sliders reads fine narrow and a ship does not. */
export const PERF_PIXEL_COLUMN_WIDTH = '55%';
export const PERF_PLAYLIST_COLUMN_WIDTH = '45%';

// ── Aspect-honest geometry (docs/64 §3.2 — the M1 kill) ─────────────────────
//
// The band stops naming a fixed canvas height that ignores the view's
// aspect. Given the slot width the band actually has and a height CEILING
// for its placement, the canvas is sized TO THE PICTURE:
//
//   aspect  = arrangedDesignAspect(flat, axis)         (pixel_view_logic)
//   canvasH = clamp(slotWidth / aspect, MIN_BAND_CANVAS_HEIGHT, capHeight)
//   canvasW = min(slotWidth, canvasH * aspect)
//
// — evaluated for every candidate axis a multi-panel view could arrange
// along, keeping whichever yields the larger LIT AREA. There are no more
// letterbox bars to paint black: the surface this sizes IS the picture, and
// any width or height left over in the slot is card ground, not canvas.

/** Absolute floor so a very narrow slot never collapses the canvas to
 *  nothing. Distinct from `DOMINANT_BAND_MIN_HEIGHT` above, which is the
 *  OUTER flex-fill floor for the perf-mode dominant band's slot — this is
 *  the INNER picture's own floor once that slot's real height is known. */
export const MIN_BAND_CANVAS_HEIGHT = 72;

/** Channel, edit mode: the height ceiling the aspect-honest picture may
 *  grow to before the caller centres it as ground. Measured against the
 *  real shipped artifact (docs/64 §3.3): at a 2-visible-channel card width
 *  (~620 px slot) the top-down ship lands at ~329×176 — the number in the
 *  design doc. */
export const CHANNEL_EDIT_CAP_HEIGHT = 176;

/** Master, edit mode: a shorter ceiling — the master band sits above the
 *  channel row rather than owning it, docs/64 §3.2. */
export const MASTER_EDIT_CAP_HEIGHT = 120;

/** Master, performance mode: forced open and given the same ceiling as a
 *  channel edit band — the composition is the thing being watched, and its
 *  reclaimed width becomes the workspace bar's rail (docs/64 §3.2). */
export const MASTER_PERF_CAP_HEIGHT = 176;

/**
 * The height ceiling for one band's placement. A channel band in
 * performance mode is the one case with NO fixed ceiling of its own — it
 * fills the vacated LOCAL PARAMS column, so its cap is that column's own
 * measured height, supplied by the caller (`pixel_view_band.tsx` reads it
 * off the flex-filled slot via layout, exactly as `bandCanvasHeight` used to
 * return `null` for the same case).
 */
export function bandCapHeight(
  placement: 'channel' | 'master',
  perfActive: boolean,
  dominantColumnHeight?: number,
): number {
  if (placement === 'master') {
    return perfActive ? MASTER_PERF_CAP_HEIGHT : MASTER_EDIT_CAP_HEIGHT;
  }
  if (perfActive) {
    if (!(typeof dominantColumnHeight === 'number' && dominantColumnHeight > 0)) {
      fail(
        'a channel band in performance mode fills the vacated params column — ' +
        `its cap must be that column's real measured height, got ${dominantColumnHeight}`,
      );
    }
    return dominantColumnHeight;
  }
  return CHANNEL_EDIT_CAP_HEIGHT;
}

function clampBandDimension(value: number, min: number, max: number): number {
  // Standard clamp, but deliberately max-priority when min > max (a caller
  // handed a cap ceiling narrower than the floor — e.g. a squeezed perf
  // column): never exceed the space that actually exists.
  return Math.min(Math.max(value, min), max);
}

/** The §3.2 formula for ONE candidate axis's aspect: the canvas box that
 *  aspect produces inside (slotWidth, capHeight), floored at
 *  `MIN_BAND_CANVAS_HEIGHT` and ceilinged at `capHeight`. */
export function bandCanvasSizeForAspect(
  aspect: number,
  slotWidth: number,
  capHeight: number,
): { width: number; height: number } {
  if (!(aspect > 0)) fail(`aspect must be positive, got ${aspect}`);
  if (!(slotWidth > 0)) fail(`slotWidth must be positive, got ${slotWidth}`);
  if (!(capHeight > 0)) fail(`capHeight must be positive, got ${capHeight}`);
  const height = clampBandDimension(slotWidth / aspect, MIN_BAND_CANVAS_HEIGHT, capHeight);
  const width = Math.min(slotWidth, height * aspect);
  return { width, height };
}

/** The chosen canvas box for a resolved view: `width`/`height` are the
 *  picture's own on-screen size (what the caller sizes its canvas element
 *  to — no letterbox to paint), `axis` and `aspect` are which arrangement
 *  won, for the loop-closure check against `panelAxisFor`. */
export interface BandCanvasSize {
  width: number;
  height: number;
  axis: PanelAxis;
  aspect: number;
}

// `computeBandCanvasSize`'s real-geometry refinement (below): `panelGap` is
// real viewport pixels, so it is NOT negligible at the small sizes this band
// actually paints at (a 120–176 px cap makes an 8 px gap a multi-percent
// term) — `arrangedDesignAspect`'s asymptotic value alone leaves 3–5 %
// measured residual void at real band sizes. This loop asks the REAL
// `arrangePanels` (via `compositeAspectFor`, imported verbatim — never
// reimplemented) what it actually draws at each candidate box, and nudges
// the aspect toward self-consistency: the box whose OWN aspect matches what
// `arrangePanels` really produces when handed that exact box.
const REFINE_TOLERANCE = 0.005; // 0.5% — inside the docs/64 W7 "<1% void" gate.
const REFINE_DAMPING = 0.5;
const REFINE_MAX_ITERATIONS = 40;

function refineCanvasSize(
  flat: FlatPixelView,
  design: PixelViewDesign,
  axis: PanelAxis,
  slotWidth: number,
  capHeight: number,
  initialAspect: number,
): BandCanvasSize {
  let aspect = initialAspect;
  let box = bandCanvasSizeForAspect(aspect, slotWidth, capHeight);
  for (let i = 0; i < REFINE_MAX_ITERATIONS; i += 1) {
    const boxAspect = box.width / box.height;
    const realAspect = compositeAspectFor(flat, design, box.width, box.height, axis);
    const relativeGap = Math.abs(realAspect - boxAspect) / boxAspect;
    if (relativeGap < REFINE_TOLERANCE) {
      return { width: box.width, height: box.height, axis, aspect: boxAspect };
    }
    aspect += REFINE_DAMPING * (realAspect - aspect);
    const next = bandCanvasSizeForAspect(aspect, slotWidth, capHeight);
    if (next.width === box.width && next.height === box.height) {
      // BOUND-PINNED fixed point: the box sits on a clamp (the
      // MIN_BAND_CANVAS_HEIGHT floor, or the slot/cap ceiling) and no aspect
      // movement can change it — e.g. the Back view's ~4.3 composite aspect
      // wants a shallower box than the 72 px floor permits at narrow slots.
      // The box genuinely cannot move, so this IS the settled answer of the
      // constrained system; the residual letterbox inside it is the floor's
      // doing — declared geometry, not an unverified guess.
      return { width: box.width, height: box.height, axis, aspect: boxAspect };
    }
    box = next;
  }
  fail(
    `computeBandCanvasSize('${flat.id}', '${axis}'): the real-geometry refinement did not settle ` +
    `within ${REFINE_MAX_ITERATIONS} iterations at slotWidth=${slotWidth}, capHeight=${capHeight} — ` +
    'refusing to ship an unverified box rather than paint a silent residual void (codex P0).',
  );
}

/**
 * The band's whole sizing decision: evaluate every candidate panel axis
 * (`columns`, and `rows` too for a multi-panel view) via
 * `arrangedDesignAspect` — a cheap, viewport-free estimate — and keep
 * whichever LIT AREA is larger, the same "measured, never named" rule
 * `layoutView`/`panelAxisFor` already use at paint time. The WINNING axis is
 * then refined (`refineCanvasSize`, above) against the REAL `panelGap` at
 * the REAL (slotWidth, capHeight) box — only the winner, since the loser's
 * exact size never reaches the screen and refining it would only risk a
 * spurious non-convergence on a box nobody paints.
 */
export function computeBandCanvasSize(
  flat: FlatPixelView,
  design: PixelViewDesign,
  slotWidth: number,
  capHeight: number,
): BandCanvasSize {
  const axes: PanelAxis[] = flat.panels.length > 1 ? ['columns', 'rows'] : ['columns'];
  let bestAxis: PanelAxis = 'columns';
  let bestAspect = 0;
  let bestArea = -1;
  for (const axis of axes) {
    const aspect = arrangedDesignAspect(flat, axis);
    const { width, height } = bandCanvasSizeForAspect(aspect, slotWidth, capHeight);
    if (width * height > bestArea) {
      bestArea = width * height;
      bestAxis = axis;
      bestAspect = aspect;
    }
  }
  // Single-panel views are exact by construction (uniform scale, no gap —
  // `flattenView`'s single-panel branch never invokes the gap term at all)
  // — no refinement pass, no extra `arrangePanels` call, matching
  // `arrangedDesignAspect`'s own "no iteration" guarantee for this case.
  if (flat.panels.length <= 1) {
    return { ...bandCanvasSizeForAspect(bestAspect, slotWidth, capHeight), axis: bestAxis, aspect: bestAspect };
  }
  return refineCanvasSize(flat, design, bestAxis, slotWidth, capHeight, bestAspect);
}

// ── Captions ────────────────────────────────────────────────────────────────

/**
 * The compact honesty ratio printed in the band header — the short form of
 * the deck window's full sentence, which the view picker's footer still
 * prints in full (`describeColourResolution`).
 *
 * Both forms carry the ARITHMETIC, never a bare adjective: `100/964` says
 * exactly how much of the colour on this canvas is real, and `964/964 FULL`
 * says the cap has stopped binding. A claim you can check.
 */
export function bandRatioCaption(sampleCount: number, modelCount: number): string {
  if (!(sampleCount > 0) || !(modelCount > 0)) {
    throw new Error(
      `[PixelViewBand] ratio caption needs positive counts, got ${sampleCount}/${modelCount}`,
    );
  }
  if (sampleCount >= modelCount) return `${modelCount}/${modelCount} FULL`;
  return `${sampleCount}/${modelCount}`;
}

/** The full sentence for the picker footer — the deck window's, unchanged. */
export function bandHonestySentence(
  drawnPixels: number,
  sampleCount: number,
  modelCount: number,
): string {
  return describeColourResolution(drawnPixels, sampleCount, modelCount);
}

/** The view chip's label: `TOP-DOWN ▾`. Underscores read as hyphens because
 *  the artifact's ids are snake_case and the chip is micro-caps chrome. */
export function bandViewChipLabel(label: string): string {
  const text = label.trim().length > 0 ? label.trim() : 'VIEW';
  return `${text.replace(/[_\s]+/g, '-').toUpperCase()} ▾`;
}

// ── Session store (docs/58 §3.3, narrowed by docs/64 §3.1, persisted per D7) ─

/**
 * Per-surface view choice, keyed by vis key, held in a MODULE-LEVEL map: it
 * survives tab switches (the mixer screen unmounts on every tab change) and,
 * per docs/64 §7 D7, now survives a reload too.
 *
 * This is still client UI state — which picture of the ship the operator has
 * up on a strip — not rig state, so docs/56's persistence gates and the
 * edit-principal question are not in play; D7 only asked whether that choice
 * should outlive a reload, and the ruling was yes. It is also still what
 * makes the performance-mode overlay a pure DERIVATION: perf mode READS this
 * store and never writes it (`setBandView` is the only write path, and perf
 * never calls it), so entering and leaving a show returns every band to
 * exactly the state it was folded into (the `_217` contract, asserted in the
 * round-trip test) — persistence riding along on real writes changes nothing
 * about that guarantee.
 *
 * docs/64 §3.1 (W4): this store used to also hold `collapsed` — whether the
 * band's picture was folded away. That decision is the mixer WORKSPACE
 * store's job (`sec/<channelId>/pixels`, `citizen/masterBand` —
 * `mixer_workspace_layout.ts`): persisted, known-set governed, and reachable
 * from both the band's own chevron and the channel's ⋮ menu. `viewId` stays
 * here, on its OWN persistence — a per-band picture choice is a different
 * KIND of fact than section membership, so it does not become a fourth
 * `mixer_workspace_layout.ts` action or a `views` map bolted onto that
 * store's pinned three-action shape (docs/64 §2.2); it gets its own small,
 * versioned key instead, exactly as this file already keeps its own geometry
 * and captions apart from the workspace store's membership concern.
 *
 * ── The persistence seam ─────────────────────────────────────────────────
 * This module stays React/RN-free on purpose (file header, top of file) so
 * vitest can drive it in plain Node. Storage I/O therefore does NOT live
 * here — `pixel_view_band_store.ts` (imported only by `pixel_view_band.tsx`,
 * component code — never by this file, never by a test) owns the
 * AsyncStorage side and talks to this store through exactly three seams:
 *   - `serializeBandSessions()`             — what to write
 *   - `hydrateBandSessions(raw)`            — apply a stored blob, ONCE
 *   - `setBandSessionPersistListener(fn)`   — notified on every REAL write
 * `subscribeBandSession(visKey, fn)` is the fourth seam, but it runs the
 * other direction: it lets an already-mounted band re-sync its own
 * `useState` mirror of `viewId` when a hydrate resolves after mount (the
 * AsyncStorage read is async; the component's mount-time read of this store
 * is not) — the same "hydrate updates React state without a persistence
 * write" split `use_mixer_workspace.ts`'s `onChange`/`onPersist` pair uses.
 */
export interface BandSession {
  /** null = "no explicit choice yet" ⇒ the artifact's default view. */
  viewId: string | null;
}

/** AsyncStorage key — version lives IN the key (house convention; same shape
 *  as `MIXER_WORKSPACE_LAYOUT_KEY` in `mixer_workspace_layout.ts`). */
export const BAND_VIEW_STORAGE_KEY = 'mixer_band_views_v1';

const DEFAULT_SESSION: BandSession = { viewId: null };

const _sessions = new Map<string, BandSession>();

/** Vis keys `setBandView` has touched live. Once a real operator gesture has
 *  named a key, a hydrate that resolves afterward must never clobber it —
 *  the same "a live gesture beats a slow hydrate" rule
 *  `createMixerWorkspaceEngine.hydrate` follows in `use_mixer_workspace.ts`. */
const _touchedKeys = new Set<string>();

type BandSessionPersistListener = () => void;
let _persistListener: BandSessionPersistListener | null = null;

type BandSessionChangeListener = (viewId: string | null) => void;
const _keyListeners = new Map<string, Set<BandSessionChangeListener>>();

function notifyKey(visKey: string, viewId: string | null): void {
  const set = _keyListeners.get(visKey);
  if (!set) return;
  for (const listener of set) listener(viewId);
}

export function getBandSession(visKey: string): BandSession {
  const found = _sessions.get(visKey);
  return found ? { ...found } : { ...DEFAULT_SESSION };
}

/**
 * The operator picked a view. Writes the map, marks the key touched (so a
 * still-pending hydrate can no longer overwrite it), notifies this key's
 * subscribers, and — ONLY on an actual change — tells the persist listener
 * to save. Re-picking the view already showing is a legitimate UI action
 * (tapping the already-active row in the picker) but not a STORE change, so
 * it neither notifies nor persists: "write only on a real change" (docs/64
 * §7 D7) means exactly this.
 */
export function setBandView(visKey: string, viewId: string): void {
  _touchedKeys.add(visKey);
  const current = getBandSession(visKey);
  if (current.viewId === viewId) return;
  _sessions.set(visKey, { ...current, viewId });
  notifyKey(visKey, viewId);
  if (_persistListener) _persistListener();
}

/** A stable, comparable snapshot of the whole store — the round-trip proof
 *  that performance mode wrote nothing. */
export function snapshotBandSessions(): string {
  const keys = Array.from(_sessions.keys()).sort();
  return JSON.stringify(keys.map((k) => [k, _sessions.get(k)]));
}

/** Test seam: forget every band's session state, including touched-keys
 *  tracking and any attached persistence listener — full isolation between
 *  tests (key-change subscriptions are left alone: those model a live
 *  component's own lifecycle, not store state to forget). */
export function resetBandSessions(): void {
  _sessions.clear();
  _touchedKeys.clear();
  _persistListener = null;
}

/** What actually goes into storage: only keys with an EXPLICIT (non-null)
 *  choice — a `null` entry is the artifact-default and needs no storage, the
 *  same "don't persist what a fresh read already implies" instinct
 *  `serializeLayout` follows for `known`. */
export function serializeBandSessions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, session] of _sessions.entries()) {
    if (session.viewId) out[key] = session.viewId;
  }
  return out;
}

/**
 * TOTAL normalizer for untrusted storage input — never throws (the same
 * discipline `mixer_workspace_layout.ts`'s `normalizeLayout` uses for its own
 * AsyncStorage hydrate). Anything that is not a `{[visKey]: viewId}` plain
 * object of non-empty strings is dropped rather than crashing the mixer over
 * a corrupt view-choice cookie — this is a view PREFERENCE, not rig state,
 * and a stale/unknown view id inside a well-shaped entry is still handled
 * downstream by `resolveBandViewId`'s own fallback, unweakened by this.
 */
export function normalizeBandSessions(raw: unknown): Record<string, string> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length > 0 && typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

/**
 * Applies a hydrated storage blob to the store — ONCE, at app startup,
 * before most operator gestures could plausibly have happened. Never calls
 * the persist listener: hydrate reads, it never writes (same rule
 * `createMixerWorkspaceEngine.hydrate` follows for the workspace layout
 * store) — that is the whole reason performance mode's "never writes"
 * guarantee and a real reload-hydrate can coexist in the same store. Skips
 * any key `setBandView` already touched live, and skips a write that would
 * be a no-op (same value already present) so re-hydrating twice (a caller
 * bug, or a second `initBandSessionPersistence()` guard slipping) can never
 * fire a spurious subscriber notification. Notifies per-key subscribers for
 * every key it does apply, so an already-mounted band's `useState` mirror
 * catches up to a hydrate that resolved after mount.
 */
export function hydrateBandSessions(raw: unknown): void {
  const normalized = normalizeBandSessions(raw);
  for (const [visKey, viewId] of Object.entries(normalized)) {
    if (_touchedKeys.has(visKey)) continue;
    const current = _sessions.get(visKey);
    if (current && current.viewId === viewId) continue;
    _sessions.set(visKey, { viewId });
    notifyKey(visKey, viewId);
  }
}

/** Test/app seam: the ONLY way persistence attaches to this store. `null`
 *  detaches. Called synchronously on every ACTUAL write `setBandView` makes
 *  — never on a read, never from `hydrateBandSessions`. */
export function setBandSessionPersistListener(listener: BandSessionPersistListener | null): void {
  _persistListener = listener;
}

/**
 * Lets a mounted band re-sync its own React state when this vis key's
 * session changes out from under it — today's only such case is a hydrate
 * resolving after the band already rendered its mount-time (pre-hydrate)
 * value. Also fires on this same key's own `setBandView` calls, which is
 * harmless (the caller already knows the value it just wrote). Returns an
 * unsubscribe.
 */
export function subscribeBandSession(visKey: string, listener: BandSessionChangeListener): () => void {
  let set = _keyListeners.get(visKey);
  if (!set) {
    set = new Set();
    _keyListeners.set(visKey, set);
  }
  set.add(listener);
  return () => {
    const s = _keyListeners.get(visKey);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) _keyListeners.delete(visKey);
  };
}

/**
 * Which view this band should draw.
 *
 * The session choice wins while it still names a view the artifact actually
 * has; a re-exported artifact that DROPPED that view falls to the artifact's
 * own default rather than to a blank canvas, because a view id is a pointer
 * into the operator's own authored list and the list is the authority.
 */
export function resolveBandViewId(
  artifact: PixelViewArtifact,
  sessionViewId: string | null,
): string {
  if (sessionViewId && artifact.views.some((v) => v.id === sessionViewId)) {
    return sessionViewId;
  }
  return pickDefaultView(artifact).id;
}
