/**
 * PixelViewBand — the simulation's 2D ship, on a mixer channel strip and on
 * the master (docs/58; operator order: "in the mixer, please add the top down
 * view on the channels and add one for the master").
 *
 * ── WHAT IT IS ──────────────────────────────────────────────────────────────
 *
 * The deck's PIXELS window, folded into a 28 px header + a fixed-height
 * canvas. Same artifact, same geometry, same colour arithmetic, same honesty
 * caption — `pixel_view_logic` and `pixel_view_paint` are imported, never
 * re-implemented. What is NEW here is only placement: nine of these can be on
 * screen at once, on a surface whose primary job is dragging faders.
 *
 * ── THE TWO RULES THAT SHAPE EVERY LINE BELOW ───────────────────────────────
 *
 * 1. **A vis frame never touches React.** The band self-subscribes to
 *    `engineVizEvents` (the `ChannelVizStrip` idiom), writes the decoded
 *    buffer into a ref, and asks the shared paint scheduler for a turn. React
 *    re-renders on view switch, collapse, artifact load, error and mode flip —
 *    never at 5 Hz, and `MixerScreen` keeps its deliberate non-subscription to
 *    the viz bus.
 *
 * 2. **The canvas is gesture-dead.** `pointerEvents: none` on the canvas
 *    wrapper, all interaction on ≥44 pt header chips. A drag that starts on
 *    the ship pans the horizontal strip row exactly like any inert card area,
 *    so the `HorizontalFader`s' capture-claimed drags never meet a competing
 *    responder and no same-axis scroll is nested (docs/58 §4.1).
 *
 * ── NATIVE FIRST, THEN THE BROWSER ──────────────────────────────────────────
 *
 * Nine of these used to render nine "NEEDS A BROWSER" boxes on the iPad, since
 * painting needed a 2D drawing context (report _243's disclosure). Report _252
 * made the refusal untrue instead of quieter: `paintPixelView` now emits into a
 * platform-neutral `PixelPaintTarget`, and `PixelSurface` fulfils it with a
 * `<canvas>` in the browser and with Skia on the iPad. Same artifact, same
 * geometry, same colour arithmetic, same honesty caption, same scheduler.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';

import { Palette, Radius, Space, Type } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { identityDot } from '@/styles/design_recipes';
import { engineVizEvents } from '@/utils/engineVizEvents';
import type { EngineMessage } from '@/utils/engineEvents';
import { usePixelViewArtifact } from '@/hooks/use_pixel_view_artifact';
import {
  BYTES_PER_SAMPLE,
  PIXEL_STAGE_BG,
  PIXEL_VIS_SOURCES,
  artifactModelMismatch,
  atobToBytes,
  buildSampleLookup,
  decodeVisSamples,
  flattenView,
  type FlatPixelView,
} from '@/components/deck/pixel_view_logic';
import {
  paintPixelView,
  type PixelPaintTarget,
  type PixelViewDrawState,
} from '@/components/deck/pixel_view_paint';
import { PixelSurface } from '@/components/deck/pixel_surface';
import { isPixelSurfaceHostVisible } from '@/components/deck/pixel_surface_visibility';
import { sharedPixelPaintScheduler } from '@/components/mixer/pixel_paint_scheduler';
import {
  BAND_HEADER_HEIGHT,
  DOMINANT_BAND_MIN_HEIGHT,
  bandCapHeight,
  bandHonestySentence,
  bandRatioCaption,
  bandViewChipLabel,
  computeBandCanvasSize,
  getBandSession,
  resolveBandViewId,
  setBandView,
  subscribeBandSession,
  type BandCanvasSize,
} from '@/components/mixer/pixel_view_band_logic';
import { initBandSessionPersistence } from '@/components/mixer/pixel_view_band_store';

// ── The band ────────────────────────────────────────────────────────────────
//
// The shared ResizeObserver / IntersectionObserver that used to live here moved
// into `pixel_surface.web.tsx` with the element they watch (report _252) — the
// element and its per-element signals belong to the same platform file, and the
// deck window now shares that one observer pair too. The process-wide "is the
// host being looked at" question moved to `pixel_surface_visibility`, which
// answers `document.visibilityState` on the web and `AppState` on the iPad.

// docs/69 W3 MISS 2: the picture box's own border, named once so the style
// below and the size compensation further down (`pictureStyle`) can never
// drift apart. See that computation's comment for the full mechanism.
const PICTURE_BORDER_WIDTH = 1;

export interface PixelViewBandProps {
  /** Key into the engine's `vis` map — a channel id, or `preDimmer` for the
   *  master. Also the session-store key for this band's view + collapse. */
  visKey: string;
  /** The parent's own visibility. A band whose card is hidden keeps its
   *  subscription but paints nothing — it is mounted, not working. */
  open?: boolean;
  /** Master only: the deck window's SHOW / RIG source chips, inline in the
   *  header. A channel band has exactly ONE real buffer (its channel key), so
   *  offering a toggle there would be pretending otherwise. */
  showSourceChips?: boolean;
  /** Whether to render the chevron affordance at all. Edit mode only —
   *  performance mode passes `false` (no inline toggle while the band is
   *  forced open; the workspace bar / ⋮ menu remain the way back). */
  allowCollapse?: boolean;
  /**
   * docs/64 §3.1 (W4): whether this band's PICTURE should render — the
   * caller's own workspace-store fact (`sec/<channelId>/pixels` for a
   * channel, `citizen/masterBand` for the master), not a state this
   * component owns. Replaces the old session-local `collapsed` boolean
   * entirely: the HEADER always renders regardless of this value (the 28 px
   * stub docs/53 §3.1 requires — no unreachable state), only the stage
   * below it is gated. Defaults `true` so a caller that doesn't yet
   * participate in the workspace store (there is none left after this wave,
   * but the default keeps the component safe or a future test fixture)
   * reproduces today's "always open" screen.
   */
  sectionOpen?: boolean;
  /** Fires when the chevron is pressed. Required whenever `allowCollapse`
   *  is true — the chevron has nothing of its own to toggle since W4 moved
   *  that decision into the caller's workspace store; a caller that renders
   *  the chevron without wiring this is a coding bug (codex P0 — fail loud
   *  rather than render a dead control). */
  onToggleSection?: () => void;
  /**
   * Performance mode: render open regardless of `sectionOpen`, which is
   * READ and left exactly as the operator folded it. This is ALSO the
   * band's sole perf-cap signal for §3.2 sizing (docs/64 W5 retired the old
   * `canvasHeight === null` sentinel — every current call site in
   * `mixer.tsx` sets this true exactly when perf mode applies to it, and a
   * channel band never needs a second, redundant way to say the same
   * thing). Distinct from `sectionOpen`: this is perf's forced-open fact,
   * that is the operator's stored preference — never conflate the two.
   */
  forceExpanded?: boolean;
  /**
   * Which height-cap token this band's placement uses
   * (`CHANNEL_EDIT_CAP_HEIGHT` / `MASTER_EDIT_CAP_HEIGHT` /
   * `MASTER_PERF_CAP_HEIGHT`, `pixel_view_band_logic`) — docs/64 §3.2.
   * REQUIRED: every call site (docs/64 W5, `mixer.tsx`) states its
   * placement explicitly now; the old `showSourceChips`-inference fallback
   * is retired along with the deprecated fixed-height constants.
   */
  placement: 'channel' | 'master';
  /**
   * docs/69 W3 MISS 1: while the section is COLLAPSED, drop the view-picker
   * chip and the honesty ratio from the header — neither is load-bearing
   * with the picture folded away (there is no active view to switch, no
   * frame to report a ratio for), and together they are what makes the
   * closed header 247.64 px wide (measured), wider than the LANDSCAPE EDIT
   * media column needs to hug. The chevron (the only way back per docs/64
   * §3.1) and the title are NEVER gated by this — only the two optional
   * chrome pieces. `false` by default, so every existing mount (portrait
   * channel bands, both dominant-fill perf bands, and the MASTER band at
   * `mixer.tsx`'s `masterBandShown` site) renders byte-identically; only
   * the LANDSCAPE EDIT media-column call site opts in.
   */
  compactWhenCollapsed?: boolean;
}

export const PixelViewBand = React.memo(function PixelViewBand({
  visKey,
  open = true,
  showSourceChips = false,
  allowCollapse = true,
  sectionOpen = true,
  onToggleSection,
  forceExpanded = false,
  placement,
  compactWhenCollapsed = false,
}: PixelViewBandProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  if (allowCollapse && !onToggleSection) {
    // A chevron with nothing to toggle is a dead control, not a graceful
    // default (codex P0 — no fallback behaviors). Every real call site wires
    // this whenever it also sets `allowCollapse`.
    throw new Error('[PixelViewBand] allowCollapse is true but onToggleSection was not provided');
  }

  // Enabled unconditionally since _252: every platform draws this now.
  const { artifact, enginePixelCount, error } = usePixelViewArtifact(true);

  const session = getBandSession(visKey);
  const [viewId, setViewId] = useState<string | null>(session.viewId);
  const [pickerOpen, setPickerOpen] = useState(false);

  // docs/64 §7 D7: the band's chosen view now persists. `initBandSessionPersistence`
  // is idempotent (module-guarded — see `pixel_view_band_store.ts`), so every
  // band instance calling it on mount is safe; the AsyncStorage read it kicks
  // off is async, so `subscribeBandSession` catches this band up if a hydrate
  // resolves after this component's mount-time read (above) already ran.
  useEffect(() => {
    initBandSessionPersistence();
  }, []);
  useEffect(() => subscribeBandSession(visKey, setViewId), [visKey]);

  /** Master only. Both entries are REAL keys on the same vis frame — a choice
   *  between two truths, never between truth and a flattering fiction. */
  const [sourceKey, setSourceKey] = useState<string>(visKey);
  /** Sample count of the most recent frame — drives the honesty ratio. */
  const [sampleCount, setSampleCount] = useState<number | null>(null);
  /** Glyph count of the CURRENT view. State, not a read of `drawRef`: the
   *  flatten happens in an effect, so reading the ref during render showed the
   *  PREVIOUS view's count after every switch (the _239 finding). */
  const [drawnCount, setDrawnCount] = useState(0);
  /** Anything the flatten refused, kept apart from the artifact-load error. */
  const [viewError, setViewError] = useState<string | null>(null);
  /** The chosen view, flattened — mirrors `drawRef.current.flat` into state
   *  so §3.2 sizing (a RENDER-time computation) can read it without racing
   *  the ref (the same reason `drawnCount` exists as state, not a ref read). */
  const [flatForSizing, setFlatForSizing] = useState<FlatPixelView | null>(null);
  /** This band's own slot, measured off its outer stage container — the
   *  `slotWidth` §3.2 sizes against, and (only for the perf-mode dominant
   *  channel band) the height ceiling too, since that case has no fixed
   *  token: it fills whatever the card left. */
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
  const handleStageLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStageSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  // docs/64 §3.1 (W4): the workspace store's `sectionOpen` fact, not local
  // state, decides the stage — `forceExpanded` (perf mode) still wins over
  // it exactly as it used to win over the session-local `collapsed` (§3.2
  // geometry pin, untouched).
  const effectiveCollapsed = forceExpanded ? false : !sectionOpen;
  // docs/69 W3 MISS 1: the optional chrome (view-picker chip + ratio) drops
  // ONLY when both this band opted in (`compactWhenCollapsed`, the LANDSCAPE
  // EDIT media-column call site) AND the section is actually folded away —
  // an open band always shows its full header regardless of the prop.
  const hideOptionalChrome = compactWhenCollapsed && effectiveCollapsed;

  // ── §3.2 placement + cap (docs/64 W5) ────────────────────────────────────
  // `placement` is REQUIRED and explicit (every call site states it); the
  // old `showSourceChips`-inference fallback and the `canvasHeight === null`
  // dominant-fill sentinel are both retired — `forceExpanded` alone is the
  // perf-forced-open signal a channel band's dominant-fill case reads.
  const isDominantFill = placement === 'channel' && forceExpanded;
  // Non-dominant caps are constant tokens — resolvable immediately, no
  // layout wait, so an edit-mode band never flickers between an unsized and
  // a sized first paint.
  const fixedCapHeight = isDominantFill ? null : bandCapHeight(placement, forceExpanded);

  const targetRef = useRef<PixelPaintTarget | null>(null);
  const drawRef = useRef<PixelViewDrawState | null>(null);
  const visibleRef = useRef({ open, collapsed: effectiveCollapsed, onScreen: true });
  visibleRef.current.open = open;
  visibleRef.current.collapsed = effectiveCollapsed;

  const activeKey = showSourceChips ? sourceKey : visKey;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  const resolvedViewId = artifact ? resolveBandViewId(artifact, viewId) : null;
  const view = useMemo(
    () => (artifact && resolvedViewId
      ? artifact.views.find((v) => v.id === resolvedViewId) || null
      : null),
    [artifact, resolvedViewId],
  );

  const mismatch = artifact ? artifactModelMismatch(artifact.modelPixelCount, enginePixelCount) : null;

  // ── Flatten the chosen view into draw-ready arrays ──────────────────────
  useEffect(() => {
    if (!view || !artifact) { drawRef.current = null; setDrawnCount(0); setFlatForSizing(null); return; }
    try {
      const flat = flattenView(view);
      drawRef.current = {
        flat,
        design: artifact.design,
        lut: null,
        lutReady: false,
        samples: null,
        sampleCount: 0,
      };
      setDrawnCount(flat.count);
      setViewError(null);
      setFlatForSizing(flat);
    } catch (err: unknown) {
      drawRef.current = null;
      setDrawnCount(0);
      setFlatForSizing(null);
      setViewError(err instanceof Error ? err.message : String(err));
    }
  }, [view, artifact]);

  // ── §3.2 canvas size: the picture, not the letterbox ────────────────────
  // The dominant-fill cap has no fixed token — it IS this band's own slot
  // height, so it waits for the first layout pass; every other placement's
  // cap is a constant and only waits on the slot's WIDTH. Either way,
  // nothing paints until this resolves — one measured frame late, never a
  // guessed size.
  const capHeight = isDominantFill
    ? (stageSize && stageSize.height > 0 ? stageSize.height : null)
    : fixedCapHeight;
  const canvasSize: BandCanvasSize | null = useMemo(() => {
    if (!flatForSizing || !artifact) return null;
    if (!stageSize || !(stageSize.width > 0)) return null;
    if (capHeight == null || !(capHeight > 0)) return null;
    return computeBandCanvasSize(flatForSizing, artifact.design, stageSize.width, capHeight);
  }, [flatForSizing, artifact, stageSize, capHeight]);

  // ── Register with the ONE shared paint scheduler ────────────────────────
  //
  // The band never calls its own paint from a vis frame. It hands the
  // scheduler a closure and a visibility predicate; the scheduler decides
  // when (docs/58 §4.2 — 8 ms budget, round-robin, latest-buffer-wins).
  const requestPaintRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const scheduler = sharedPixelPaintScheduler();
    const handle = scheduler.subscribe({
      paint: () => {
        const target = targetRef.current;
        const state = drawRef.current;
        if (!target || !state) return;
        paintPixelView(target, state);
      },
      isVisible: () => {
        const v = visibleRef.current;
        return v.open && !v.collapsed && v.onScreen && isPixelSurfaceHostVisible()
          && targetRef.current !== null;
      },
    });
    requestPaintRef.current = handle.request;
    return () => {
      requestPaintRef.current = null;
      handle.release();
    };
  }, []);

  // ── Live frames ─────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = engineVizEvents.subscribe((msg: EngineMessage) => {
      if (msg.type !== 'vis') return;
      const state = drawRef.current;
      if (!state) return;
      const vis = (msg.vis as { [key: string]: string | null }) || {};
      const key = activeKeyRef.current;
      // Codex P0 — no substitution: if the engine did not send THIS buffer we
      // draw nothing new rather than quietly painting a different one.
      const frame = key in vis ? vis[key] : null;
      if (frame == null) return;

      const bytes = decodeVisSamples(frame, atobToBytes);
      const count = bytes.length / BYTES_PER_SAMPLE;
      if (count !== state.sampleCount || !state.lutReady) {
        // The sample count is fixed at engine boot, so this rebuild happens
        // once per session (and again only if the engine restarts differently,
        // or the master band is toggled onto a differently-budgeted buffer).
        state.sampleCount = count;
        state.lut = buildSampleLookup(
          state.flat,
          artifact ? artifact.modelPixelCount : count,
          count,
        );
        state.lutReady = true;
        setSampleCount(count);
      }
      // LATEST-BUFFER-WINS: the frame lands in the ref, the scheduler paints
      // whatever is in the ref when this band's turn comes up.
      state.samples = bytes;
      const request = requestPaintRef.current;
      if (request) request();
    });
    return unsub;
  }, [artifact]);

  // ── Repaint on resize / reopen / view switch ────────────────────────────
  // Size and on-screen changes arrive through `PixelSurface` (a shared
  // ResizeObserver + IntersectionObserver on the web, `onLayout` + screen focus
  // on native).
  const attachTarget = useCallback((target: PixelPaintTarget | null) => {
    targetRef.current = target;
  }, []);

  const requestPaint = useCallback(() => {
    const request = requestPaintRef.current;
    if (request) request();
  }, []);

  const handleVisibility = useCallback((onScreen: boolean) => {
    visibleRef.current.onScreen = onScreen;
    if (onScreen) requestPaint();
  }, [requestPaint]);

  useEffect(() => {
    if (effectiveCollapsed) return;
    // Re-open / re-mount / view switch: draw immediately rather than waiting
    // for the engine's next 200 ms vis tick.
    requestPaint();
  }, [effectiveCollapsed, open, view, requestPaint]);

  // ── Session writes (view + collapse) ────────────────────────────────────
  const chooseView = useCallback((id: string) => {
    setBandView(visKey, id);
    setViewId(id);
    setPickerOpen(false);
  }, [visKey]);

  const toggleCollapsed = useCallback(() => {
    // Nothing is computed here anymore — the workspace store IS the state;
    // this just relays the press. The `allowCollapse` guard above already
    // guarantees `onToggleSection` exists whenever this can be called.
    if (onToggleSection) onToggleSection();
  }, [onToggleSection]);

  // ── Chrome ──────────────────────────────────────────────────────────────

  const ratio = artifact && sampleCount !== null
    ? bandRatioCaption(sampleCount, artifact.modelPixelCount)
    : null;
  const honesty = artifact && sampleCount !== null && drawnCount > 0
    ? bandHonestySentence(drawnCount, sampleCount, artifact.modelPixelCount)
    : null;
  const chipLabel = view ? bandViewChipLabel(view.label) : 'VIEW ▾';
  const problem = viewError || error;

  const header = (
    <View style={styles.header}>
      <View style={identityDot(C.secondary, 8)} />
      <Text style={[styles.title, { color: C.secondary }]} numberOfLines={1}>PIXELS</Text>
      {/* docs/69 W3 MISS 1: the picker chip is a control for choosing a view
          to PAINT — with the section closed there is nothing painting, so
          the chip is dead chrome that only costs the collapsed stub width. */}
      {!hideOptionalChrome ? (
        <TouchableOpacity
          onPress={() => setPickerOpen(true)}
          disabled={!artifact}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel={`Pixel view: ${view ? view.label : 'loading'}. Choose another view.`}
          accessibilityState={{ disabled: !artifact }}
          style={[styles.chip, { borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerHigh }, !artifact && { opacity: 0.45 }]}
        >
          <Text style={[styles.chipLabel, { color: C.text }]} numberOfLines={1}>{chipLabel}</Text>
        </TouchableOpacity>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }} />
      {showSourceChips ? (
        <View style={styles.sourceRow}>
          {PIXEL_VIS_SOURCES.map((s) => {
            const active = s.key === sourceKey;
            return (
              <TouchableOpacity
                key={s.key}
                onPress={() => setSourceKey(s.key)}
                hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={s.key === 'rig'
                  ? 'Show the post-dimmer rig output'
                  : 'Show the pre-dimmer show composition'}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? C.borderStrong : C.ghostBorder,
                    backgroundColor: active ? C.surfaceContainerHigh : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.chipLabel, { color: active ? C.text : C.secondary }]}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
      {/* docs/69 W3 MISS 1: same reasoning as the chip — a ratio describing
          the last-painted frame is not honest chrome to show once painting
          has stopped. The chevron below is NEVER gated: it is the only way
          back (docs/64 §3.1) and must survive every collapse state. */}
      {ratio && !hideOptionalChrome ? (
        <Text style={[styles.ratio, { color: C.icon }]} numberOfLines={1}>{ratio}</Text>
      ) : null}
      {allowCollapse ? (
        <TouchableOpacity
          onPress={toggleCollapsed}
          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={effectiveCollapsed ? 'Show the pixel view' : 'Hide the pixel view'}
          accessibilityState={{ expanded: !effectiveCollapsed }}
          style={styles.chevron}
        >
          <Text style={[styles.chevronGlyph, { color: C.secondary }]}>
            {effectiveCollapsed ? '▸' : '⌄'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  // The SLOT: unchanged footprint logic (fixed cap height, or flex-fill for
  // the perf-mode dominant band) — this is what keeps mixer.tsx's existing
  // layout budget stable without touching that file. What moved is the
  // background/border, onto the picture box below.
  const outerStageStyle = isDominantFill
    ? [styles.stage, styles.stageDominant]
    // `fixedCapHeight` is always resolved to a number here — `bandCapHeight`
    // only needs (and only fails without) `dominantColumnHeight` on the
    // `isDominantFill` branch above. The `?? 0` is an unreachable, obvious-
    // over-silent fallback, never a real render.
    : [styles.stage, { height: fixedCapHeight ?? 0 }];
  // The PICTURE: §3.2's aspect-honest box, or nothing yet if the first
  // layout pass (which supplies slotWidth, and for the dominant case the
  // cap height too) hasn't landed.
  //
  // docs/69 W3 MISS 2: `canvasSize` is `computeBandCanvasSize`'s promise that
  // "the surface this sizes IS the picture" (§3.2 — no letterbox bars, no
  // slack). Both View (react-native-web `src/exports/View/index.js`) and
  // native Yoga size a bordered box so the SPECIFIED width/height already
  // INCLUDES the border (border-box) — so applying `canvasSize` directly to
  // a box that also carries `styles.picture`'s `borderWidth` silently ate
  // `2 * PICTURE_BORDER_WIDTH` off the actually-visible content on every
  // axis (measured: a floored 72 pt canvas rendered at 70 pt, 2 pt under
  // `MIN_BAND_CANVAS_HEIGHT` — exactly `2 * 1`). Inflating the APPLIED size
  // by the border allowance restores the promise without touching the
  // pinned math that produced `canvasSize` in the first place
  // (`bandCanvasSizeForAspect` / `MIN_BAND_CANVAS_HEIGHT`, both untouched) —
  // this is purely how that already-correct number gets laid onto a
  // bordered box.
  const pictureBorderAllowance = PICTURE_BORDER_WIDTH * 2;
  const pictureStyle = canvasSize
    ? [styles.picture, {
      width: canvasSize.width + pictureBorderAllowance,
      height: canvasSize.height + pictureBorderAllowance,
      backgroundColor: PIXEL_STAGE_BG,
      borderColor: C.ghostBorder,
    }]
    : null;

  return (
    <View style={[styles.host, isDominantFill && styles.hostDominant]}>
      {header}

      {effectiveCollapsed ? null : (
        <View style={outerStageStyle} onLayout={handleStageLayout}>
          {pictureStyle ? (
            <View style={pictureStyle}>
              {/* GESTURE-DEAD (docs/58 §4.1). A drag that starts here belongs
                  to the strip row's ScrollView, never to a competing
                  responder. */}
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <PixelSurface
                  onTarget={attachTarget}
                  onResize={requestPaint}
                  onVisibility={handleVisibility}
                />
              </View>
            </View>
          ) : null}
          {problem ? (
            <View style={[styles.notice, { backgroundColor: C.errorContainer, borderColor: C.errorContainerBorder }]}>
              <Text style={[styles.noticeText, { color: C.error }]} numberOfLines={4}>{problem}</Text>
            </View>
          ) : null}
          {mismatch && !problem ? (
            <View style={[styles.notice, { backgroundColor: C.warningContainer, borderColor: C.warningContainerBorder }]}>
              <Text style={[styles.noticeText, { color: C.warning }]} numberOfLines={4}>{mismatch}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* View picker — the mixer's own modal idiom (the SCREEN ▾ / TRANSITION ▾
          pattern), one ≥44 pt row per view the OPERATOR authored, in his own
          order. Whatever he adds to scenes/titanic/pixel_map_views.yaml shows
          up here after the next artifact export; this file names no views. */}
      <Modal transparent visible={pickerOpen} animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => undefined}>
            <View style={styles.modalContent}>
              <Text style={[styles.modalTitle, { color: C.secondary }]}>PIXEL VIEW</Text>
              {(artifact ? artifact.views : []).map((v) => {
                const active = v.id === resolvedViewId;
                return (
                  <TouchableOpacity
                    key={v.id}
                    onPress={() => chooseView(v.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.modalRow,
                      active
                        ? { backgroundColor: C.primary, borderColor: C.primary }
                        : { backgroundColor: C.surfaceContainerHigh, borderColor: C.ghostBorder },
                    ]}
                  >
                    <Text style={[styles.modalRowLabel, { color: active ? C.onPrimary : C.text }]}>
                      {v.label.toUpperCase()}
                    </Text>
                    {active ? <Text style={[styles.modalRowLabel, { color: C.onPrimary }]}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
              {/* The long form of the header's ratio — the compact number
                  always has its full sentence one tap away. */}
              <Text style={[styles.modalFoot, { color: C.icon }]}>
                {honesty || 'WAITING FOR THE FIRST FRAME'}
              </Text>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
});

function makeStyles(C: Palette) {
  return StyleSheet.create({
    host: {
      gap: 4,
    },
    hostDominant: {
      flex: 1,
      minHeight: 0,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: BAND_HEADER_HEIGHT,
    },
    title: {
      ...Type.microCaps,
      flexShrink: 1,
      minWidth: 0,
    },
    // The chip and the ratio never shrink; the PIXELS title does. On a narrow
    // strip something has to give, and the order is deliberate: the control
    // the operator taps and the number he checks stay legible, the label that
    // only repeats what the identity dot already says goes first.
    chip: {
      minHeight: 22,
      paddingHorizontal: 8,
      justifyContent: 'center',
      borderRadius: Radius.control,
      borderWidth: 1,
      flexShrink: 0,
    },
    chipLabel: {
      ...Type.microCaps,
    },
    sourceRow: {
      flexDirection: 'row',
      gap: 4,
    },
    ratio: {
      ...Type.microCaps,
      flexShrink: 0,
    },
    chevron: {
      width: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chevronGlyph: {
      ...Type.labelCaps,
      fontSize: 13,
    },
    stageDominant: {
      flex: 1,
      minHeight: DOMINANT_BAND_MIN_HEIGHT,
    },
    // LAYOUT ONLY — no border, no background. This is the slot; §3.2 sizes
    // the PICTURE inside it (see `picture` below), so any width or height
    // this box has that the picture doesn't fill is card ground, not canvas
    // (docs/64 M1: the old version painted this whole box stage-black,
    // which is the "~32-75% black void" bug).
    stage: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    // The picture itself, sized to computeBandCanvasSize's result. Only THIS
    // box carries the stage background/border — the letterbox bars this
    // replaces no longer exist to paint.
    picture: {
      borderRadius: Radius.control,
      borderWidth: PICTURE_BORDER_WIDTH,
      overflow: 'hidden',
    },
    notice: {
      position: 'absolute',
      left: Space.sm,
      right: Space.sm,
      bottom: Space.sm,
      padding: 6,
      borderRadius: Radius.control,
      borderWidth: 1,
    },
    noticeText: {
      ...Type.microCaps,
      textTransform: 'none',
    },
    modalOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: Space.xl,
      paddingHorizontal: Space.lg,
    },
    modalContent: {
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: Radius.panel,
      padding: Space.xl,
      minWidth: 240,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    modalTitle: {
      ...Type.labelCaps,
      marginBottom: Space.md,
    },
    modalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
      paddingVertical: Space.md,
      paddingHorizontal: Space.lg,
      borderRadius: Radius.control,
      borderWidth: 1,
      marginBottom: Space.xs,
    },
    modalRowLabel: {
      fontFamily: Type.labelCaps.fontFamily,
      fontSize: 13,
    },
    modalFoot: {
      ...Type.microCaps,
      marginTop: Space.sm,
    },
  });
}
