/**
 * zoom_logic — PURE derivations for the TIMELINE ZOOM ladder (reports _94/_95).
 *
 * Everything here is a total function over wire data: the phase-band geometry
 * the DAY view draws, the resolved-ribbon rows, and the ZOOM BANNER's copy. No
 * React, no react-native, no fetch — so it runs in the plain-node vitest suite
 * and the banner copy the operator reads at 3 am is pinned by tests.
 *
 * Type-only imports (erased at build) keep this module free of the RN-flavoured
 * module graph `utils/timelineApi.ts` sits in.
 */
import type {
  OverviewPhase,
  OverviewSegment,
  TimelineZoom,
  TimelineZoomPendingDeferred,
} from '../../utils/timelineApi';

/** Minutes in a day. The ribbon's last segment ends at the literal 24:00. */
export const DAY_MINUTES = 1440;

/**
 * Parse an overview "HH:MM" into minutes-of-day, admitting the ribbon's literal
 * terminator "24:00" → 1440 (_95 §3.1: a 24 h column needs 1440, not a next-day
 * "00:00"). Returns null on anything malformed — the caller must then say so,
 * never guess a time.
 */
export function localToMinutes(v: string | null | undefined): number | null {
  if (!v || typeof v !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (mm > 59) return null;
  if (hh === 24) return mm === 0 ? DAY_MINUTES : null;
  if (hh > 23) return null;
  return hh * 60 + mm;
}

/**
 * Snap for a bare-calendar tap (minutes). At day scale (~30 px/hour) a finger
 * is worth ±5 min anyway; a 15-minute grid is the honest resolution, and it
 * matches how the operator thinks about "that empty slot before sunset".
 */
export const TRAVEL_TAP_SNAP_MIN = 15;

/**
 * Convert a tap on the 24 h day chart into a time-travel target "HH:MM".
 *
 * `y` is the chart-relative tap offset, `height` the chart's pixel height.
 * The ratio is clamped into the day and snapped to TRAVEL_TAP_SNAP_MIN. A snap
 * that lands on 24:00 is pulled back one notch — "24:00" is the ribbon's
 * TERMINATOR, not a targetable instant. Returns null (caller opens nothing)
 * when the geometry is unusable — never a guessed time.
 */
export function chartTapToLocal(
  y: number,
  height: number,
  snapMin: number = TRAVEL_TAP_SNAP_MIN,
): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) return null;
  if (!Number.isFinite(snapMin) || snapMin <= 0) return null;
  const ratio = Math.min(1, Math.max(0, y / height));
  let mins = Math.round((ratio * DAY_MINUTES) / snapMin) * snapMin;
  if (mins >= DAY_MINUTES) mins = DAY_MINUTES - snapMin;
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ── Phase bands ─────────────────────────────────────────────────────────

export interface PhaseBand {
  /** Phase name (repeated on both pieces of a midnight-wrapping band). */
  name: string;
  fromMin: number;
  toMin: number;
  /** True when this piece is half of a band that wraps midnight. */
  wrapped: boolean;
  /** Plan order of the source phase — the draw/priority order. NEVER sorted. */
  order: number;
}

/**
 * Geometry for ONE phase band on a 0..1440 day column.
 *
 * Two contract rules from _95 §3.1 live here:
 *   • an anchor the day doesn't have (polar / missing sun event) is `null` —
 *     the band is NOT drawn and NOT guessed at; it returns [].
 *   • `endLocal` < `startLocal` WRAPS MIDNIGHT (that is how `party_night`
 *     works), so the band becomes TWO pieces: [start, 24:00) and [00:00, end).
 *     Drawing it as one inverted rectangle is what makes a night look empty.
 * A zero-length band (start === end) yields nothing.
 */
export function phaseBands(phase: OverviewPhase, order: number): PhaseBand[] {
  const from = localToMinutes(phase.startLocal);
  const to = localToMinutes(phase.endLocal);
  if (from === null || to === null) return [];
  if (from === to) return [];
  if (to > from) return [{ name: phase.name, fromMin: from, toMin: to, wrapped: false, order }];
  return [
    { name: phase.name, fromMin: from, toMin: DAY_MINUTES, wrapped: true, order },
    { name: phase.name, fromMin: 0, toMin: to, wrapped: true, order },
  ];
}

/** All bands for a day, in PLAN ORDER (overlap resolves first-in-plan-order). */
export function allPhaseBands(phases: OverviewPhase[] | undefined): PhaseBand[] {
  if (!Array.isArray(phases)) return [];
  const out: PhaseBand[] = [];
  phases.forEach((p, i) => { out.push(...phaseBands(p, i)); });
  return out;
}

// ── The resolved ribbon ─────────────────────────────────────────────────

export interface RibbonRow {
  key: string;
  fromMin: number;
  toMin: number;
  fromLocal: string;
  toLocal: string;
  /** Who owns the deck: the cue's label, or the fallback's. */
  ownerLabel: string;
  ownerKind: OverviewSegment['owner']['kind'];
  ownerCueId: string | null;
  playlist: string | null;
  palette: string | null;
  controller: OverviewSegment['controller'];
  source: OverviewSegment['source'];
  /**
   * The _91 G1 truth: the cue still holds the ownership latch but the AUTOPILOT
   * BASELINE playlist is what actually plays (and the palette is never reset).
   * Rendered distinctly — it is the single most surprising thing the shipped
   * plan does, and the ribbon exists to stop it hiding.
   */
  warn: boolean;
}

/**
 * Ribbon rows for a day. The engine guarantees the segments tile [00:00, 24:00)
 * with no gaps and no overlaps, so this is a straight projection — but a segment
 * whose times don't parse is DROPPED rather than silently placed at 00:00.
 */
export function ribbonRows(segments: OverviewSegment[] | undefined): RibbonRow[] {
  if (!Array.isArray(segments)) return [];
  const out: RibbonRow[] = [];
  segments.forEach((s, i) => {
    const fromMin = localToMinutes(s.fromLocal);
    const toMin = localToMinutes(s.toLocal);
    if (fromMin === null || toMin === null || toMin <= fromMin) return;
    out.push({
      key: `${s.fromLocal}-${s.toLocal}-${i}`,
      fromMin,
      toMin,
      fromLocal: s.fromLocal,
      toLocal: s.toLocal,
      ownerLabel: s.owner?.label ?? '—',
      ownerKind: s.owner?.kind ?? 'baseline',
      ownerCueId: s.owner?.cueId ?? null,
      playlist: s.playlist,
      palette: s.palette,
      controller: s.controller,
      source: s.source,
      warn: s.source === 'hold-expired-baseline',
    });
  });
  return out;
}

/**
 * One-line explanation of WHY a ribbon segment plays what it plays. This is the
 * review honesty layer — it names the mechanism, it does not editorialise.
 */
export function ribbonSourceNote(row: RibbonRow): string {
  switch (row.source) {
    case 'cue':
      return 'the cue owns the deck';
    case 'hold-expired-baseline':
      return 'hold expired — the autopilot baseline plays under the cue';
    case 'default-cue':
      return 'gap — the plan default cue';
    case 'autopilot-baseline':
      return 'no cue, no default cue — the autopilot baseline';
    default:
      return String(row.source);
  }
}

// ── The zoom banner ─────────────────────────────────────────────────────

export type ZoomBannerTone = 'perform' | 'travel';

export interface ZoomBannerModel {
  tone: ZoomBannerTone;
  /** Short all-caps headline. */
  title: string;
  /** The one-line context after the headline. */
  detail: string;
  /** Only TRAVEL offers the prev/next event steppers (D4 static snapshot). */
  showSteppers: boolean;
  /** The D3 deferred-show line, or null. */
  deferredText: string | null;
}

/**
 * The D3 deferred-show banner copy, pinned verbatim by _95 §3.6:
 *   "Show due: {label} — starts when you exit"
 * The show is DEFERRED, never dismissed — ENABLE still starts it now, and the
 * zoom exit fires it via catchUp. The copy must never say "cancelled".
 */
export function deferredShowText(p: TimelineZoomPendingDeferred | null | undefined): string | null {
  if (!p) return null;
  const label = p.label || p.cueId;
  return `Show due: ${label} — starts when you exit`;
}

/**
 * Everything the ZoomBanner renders, derived from the engine's `zoom` field
 * alone. Returns null when no zoom is held (undefined from a pre-zoom engine is
 * treated exactly like null — no zoom, never an invented one).
 */
export function zoomBannerModel(zoom: TimelineZoom | null | undefined): ZoomBannerModel | null {
  if (!zoom) return null;
  const deferredText = deferredShowText(zoom.pendingDeferred);
  if (zoom.scope === 'perform') {
    const label = zoom.label || zoom.cueId || 'this event';
    return {
      tone: 'perform',
      title: 'PERFORMING',
      detail: `${label} · you have the deck — the plan is holding`,
      showSteppers: false,
      deferredText,
    };
  }
  // TRAVEL. Say plainly that this is the PLAN, not tonight — the 3 am test.
  const where = [zoom.targetDate, zoom.targetLocal].filter(Boolean).join(' · ');
  const preRoll = zoom.targetLeadSec && zoom.targetCueLabel
    ? ` · ${zoom.targetLeadSec} sec before ${zoom.targetCueLabel}`
    : '';
  const label = !preRoll && zoom.label ? ` · ${zoom.label}` : '';
  return {
    tone: 'travel',
    title: 'TIME TRAVELING',
    detail: `${where || 'target'}${preRoll}${label} · viewing the plan, not tonight`,
    showSteppers: true,
    deferredText,
  };
}

/**
 * Should the pad ANNOUNCE that the zoom ended?
 *
 * Only when the engine took it away without this client asking — lease expiry,
 * an engine restart, autopilot OFF, a maker auto-save. An operator-requested
 * exit (the banner's EXIT, or returning to the TIMELINE tab) must be silent.
 *
 * Both inputs are needed, and `ours` in particular is subtle: the engine clears
 * the zoom and broadcasts the new state on its own 1 s tick, which routinely
 * beats our own resume() response back to the app. The exit claim is therefore
 * staked BEFORE the request goes out, so a broadcast that arrives mid-flight is
 * still recognised as ours instead of raising a false alarm at the operator who
 * just asked to leave.
 */
export function shouldAnnounceZoomEnd(args: { ours: boolean; entered: boolean }): boolean {
  return !args.ours && args.entered;
}

// ── The event sheet ─────────────────────────────────────────────────────

export type EventZoomMode = 'perform' | 'travel';

/**
 * Which branch the EVENT sheet offers, decided by the ENGINE's own state — is
 * this cue the live deck owner right now? PERFORM is only offered for the live
 * event; everything else time-travels. One primary action, no operator guessing.
 */
export function eventZoomMode(args: {
  cueId: string;
  activeCueId: string | null | undefined;
}): EventZoomMode {
  return args.activeCueId && args.activeCueId === args.cueId ? 'perform' : 'travel';
}

/**
 * PERFORM is impossible out of the festival window — the engine's takeover()
 * refuses to arm anything there, so the sheet must not offer a button that can
 * only 400. TRAVEL stays available while dormant: that is exactly when the
 * operator rehearses (_95 §3.7).
 */
export function canPerform(args: {
  mode: EventZoomMode;
  planActive: boolean | undefined;
  inFestivalWindow: boolean | undefined;
}): boolean {
  return args.mode === 'perform' && args.planActive === true && args.inFestivalWindow === true;
}
