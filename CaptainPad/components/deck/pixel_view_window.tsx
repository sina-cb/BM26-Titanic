/**
 * PixelViewWindow — the Deck's PIXELS window: the simulation's own 2D pixel
 * map, lit by the engine's live output (operator order, report _225:
 * "add a new panel which is the 2d pixel view from the simulation style … make
 * sure the pixels look amazingly pixel arty and representative", and then
 * "simulation 2d pixels are the source of truth please").
 *
 * All the rules live next door in `pixel_view_logic.ts` (pure, unit-tested).
 * This file is the surface: fetch, canvas, paint, chrome.
 *
 * ── WHY A RAW CANVAS ────────────────────────────────────────────────────────
 *
 * 720 glyphs repainted at the engine's vis cadence. Every React-shaped option
 * loses here: an RN <View> per pixel is the exact pattern the engine's own vis
 * cap exists to prevent (see the comment at marsin_engine/engine.js ~750), and
 * 720 react-native-svg <Rect>es means 720 reconciled nodes per frame. So the
 * frame path touches React ZERO times: the subscriber writes into a ref and
 * calls an imperative draw against a 2D context. React re-renders this
 * component only when the artifact loads, the view changes, or an error does.
 *
 * Measured on the live rig (titanic, 720 glyphs, 5 Hz): see the report.
 *
 * ── NATIVE FIRST, THEN THE BROWSER ──────────────────────────────────────────
 *
 * This window used to render a named refusal off-web, because the 2D drawing
 * context it needs is a browser primitive. Report _252 fixed the truth instead
 * of the message: the drawing now goes through the platform-neutral
 * `PixelPaintTarget` seam, and `PixelSurface` fulfils it with a `<canvas>` in
 * the browser and with Skia on the iPad. The refusal is gone because the
 * refusal stopped being true — never the other way round (codex P0).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import { Palette, Radius, Space, Type } from '@/constants/theme';
import { engineVizEvents } from '@/utils/engineVizEvents';
import type { EngineMessage } from '@/utils/engineEvents';
import { usePixelViewArtifact } from '@/hooks/use_pixel_view_artifact';
import {
  BYTES_PER_SAMPLE,
  DEFAULT_VIS_SOURCE,
  PIXEL_STAGE_BG,
  PIXEL_VIS_SOURCES,
  artifactModelMismatch,
  atobToBytes,
  buildSampleLookup,
  decodeVisSamples,
  describeColourResolution,
  flattenView,
  pickDefaultView,
} from '@/components/deck/pixel_view_logic';
import {
  paintPixelView,
  type PixelPaintTarget,
  type PixelViewDrawState,
} from '@/components/deck/pixel_view_paint';
import { PixelSurface } from '@/components/deck/pixel_surface';

export interface PixelViewWindowProps {
  /** The workspace's open state. A hidden window keeps its subscription but
   *  does NO decode and NO paint — it is mounted, not working. */
  open: boolean;
}

export const PixelViewWindow = React.memo(function PixelViewWindow({ open }: PixelViewWindowProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  // The artifact + the engine's pixel count come from the app-wide module
  // cache (`use_pixel_view_artifact`), so this window and the mixer's nine
  // pixel-view bands share ONE fetch of each between them (docs/58 §3.2).
  // Enabled unconditionally since _252: every platform draws this now.
  const { artifact, enginePixelCount, error: artifactError } = usePixelViewArtifact(true);
  const [viewId, setViewId] = useState<string | null>(null);
  /** Whatever the flatten refused, kept apart from the artifact-load error. */
  const [viewError, setViewError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<string | null>(null);
  /** Sample count of the most recent frame — drives the honesty caption. */
  const [sampleCount, setSampleCount] = useState<number | null>(null);
  /** Glyph count of the CURRENT view. State, not a read of `drawRef`, because
   *  the flatten happens in an effect: reading the ref during render made the
   *  caption show the PREVIOUS view's pixel count after every view switch
   *  (observed in the _239 capture — the whole point of the caption is that it
   *  is the number you can trust). */
  const [drawnCount, setDrawnCount] = useState(0);
  /** Which engine buffer lights the map (see PIXEL_VIS_SOURCES). */
  const [sourceKey, setSourceKey] = useState<string>(DEFAULT_VIS_SOURCE);
  const sourceKeyRef = useRef(sourceKey);
  sourceKeyRef.current = sourceKey;

  const targetRef = useRef<PixelPaintTarget | null>(null);
  const hostRef = useRef<View | null>(null);
  const drawRef = useRef<PixelViewDrawState | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // ── 1. Open on the operator's own default view once the artifact lands ───
  useEffect(() => {
    if (!artifact) return;
    setViewId((prev) => prev || pickDefaultView(artifact).id);
  }, [artifact]);

  const view = useMemo(
    () => (artifact && viewId ? artifact.views.find((v) => v.id === viewId) || null : null),
    [artifact, viewId],
  );

  useEffect(() => {
    if (!artifact) return;
    setMismatch(artifactModelMismatch(artifact.modelPixelCount, enginePixelCount));
  }, [artifact, enginePixelCount]);

  // ── 3. Flatten the chosen view into draw-ready arrays ────────────────────
  useEffect(() => {
    if (!view || !artifact) { drawRef.current = null; setDrawnCount(0); return; }
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
    } catch (err: unknown) {
      drawRef.current = null;
      setDrawnCount(0);
      setViewError(err instanceof Error ? err.message : String(err));
    }
  }, [view, artifact]);

  // ── 4. The imperative paint ──────────────────────────────────────────────
  // The drawing itself lives in `pixel_view_paint.ts`, shared verbatim with
  // the mixer's pixel-view bands (docs/58) — two surfaces showing the same
  // rig must never be two copies of the halo pass and the ghost ink.
  const paint = useCallback(() => {
    const target = targetRef.current;
    const state = drawRef.current;
    if (!target || !state || !openRef.current) return;
    paintPixelView(target, state);
  }, []);

  const attachTarget = useCallback((target: PixelPaintTarget | null) => {
    targetRef.current = target;
  }, []);

  // ── 5. Live frames ───────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = engineVizEvents.subscribe((msg: EngineMessage) => {
      if (msg.type !== 'vis') return;
      const state = drawRef.current;
      if (!state || !openRef.current) return;
      const vis = (msg.vis as { [key: string]: string | null }) || {};
      const key = sourceKeyRef.current;
      // Codex P0 — no substitution: if the engine did not send THIS buffer we
      // draw nothing new rather than quietly painting a different one.
      const frame = key in vis ? vis[key] : null;
      if (frame == null) return;

      const bytes = decodeVisSamples(frame, atobToBytes);
      const count = bytes.length / BYTES_PER_SAMPLE;
      if (count !== state.sampleCount || !state.lutReady) {
        // The sample count is fixed at engine boot, so this rebuild happens
        // once per session (and again only if the engine restarts differently).
        // `buildSampleLookup` returns null at full rate — that is the answer,
        // not a failure, so `lutReady` records that we asked.
        state.sampleCount = count;
        state.lut = buildSampleLookup(
          state.flat,
          artifact ? artifact.modelPixelCount : count,
          count,
        );
        state.lutReady = true;
        setSampleCount(count);
      }
      state.samples = bytes;
      paint();
    });
    return unsub;
  }, [paint, artifact]);

  // ── 6. Repaint on reopen / view switch ───────────────────────────────────
  // Size changes arrive through `PixelSurface`'s `onResize` (a shared
  // ResizeObserver on the web, `onLayout` on native).
  useEffect(() => {
    paint();
  }, [paint, open, view]);

  // ── Chrome ───────────────────────────────────────────────────────────────

  const caption = artifact && sampleCount !== null && drawnCount > 0
    ? describeColourResolution(drawnCount, sampleCount, artifact.modelPixelCount)
    : null;
  // A refused artifact and a refused flatten are both "the picture is wrong,
  // here is why" — shown in the same notice, neither ever swallowed.
  const error = viewError || artifactError;

  return (
    <View style={styles.host} ref={hostRef}>
      {/* View picker — the operator's OWN authored simulation views, in his
          own order. Not our taxonomy: whatever he adds to
          scenes/titanic/pixel_map_views.yaml shows up here after the next
          artifact export. */}
      {artifact && artifact.views.length > 1 ? (
        <View style={styles.viewRow}>
          {artifact.views.map((v) => {
            const active = v.id === viewId;
            return (
              <TouchableOpacity
                key={v.id}
                onPress={() => setViewId(v.id)}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Show the ${v.label} pixel view`}
                style={[
                  styles.viewChip,
                  {
                    borderColor: active ? C.borderStrong : C.ghostBorder,
                    backgroundColor: active ? C.surfaceContainerHigh : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.viewChipLabel, { color: active ? C.text : C.secondary }]}>
                  {v.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {/* The map. Ground is the SIM's own near-black on every theme — see
          PIXEL_STAGE_BG. The border stays themed: that is chrome. */}
      <View style={[styles.stage, { backgroundColor: PIXEL_STAGE_BG, borderColor: C.ghostBorder }]}>
        <PixelSurface onTarget={attachTarget} onResize={paint} />
      </View>

      {error ? (
        <View style={[styles.notice, { backgroundColor: C.errorContainer, borderColor: C.errorContainerBorder }]}>
          <Text style={[styles.noticeText, { color: C.error }]}>{error}</Text>
        </View>
      ) : null}

      {mismatch && !error ? (
        <View style={[styles.notice, { backgroundColor: C.warningContainer, borderColor: C.warningContainerBorder }]}>
          <Text style={[styles.noticeText, { color: C.warning }]}>{mismatch}</Text>
        </View>
      ) : null}

      {/* The honesty line, and the SOURCE toggle beside it. The engine
          subsamples its vis broadcast, so the operator is told exactly how
          many real colour samples are spread across how many drawn pixels —
          see pixel_view_logic's header. The toggle names which of the two real
          engine buffers he is looking at; neither is a flattering fiction. */}
      <View style={styles.footRow}>
        <Text style={[styles.foot, { color: C.icon }]}>
          {caption || (artifact ? 'WAITING FOR THE FIRST FRAME' : 'LOADING THE SIMULATION PIXEL MAP')}
        </Text>
        <View style={styles.sourceRow}>
          {PIXEL_VIS_SOURCES.map((s) => {
            const active = s.key === sourceKey;
            return (
              <TouchableOpacity
                key={s.key}
                onPress={() => setSourceKey(s.key)}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={s.key === 'rig'
                  ? 'Show the post-dimmer rig output'
                  : 'Show the pre-dimmer show composition'}
                style={[
                  styles.viewChip,
                  {
                    borderColor: active ? C.borderStrong : C.ghostBorder,
                    backgroundColor: active ? C.surfaceContainerHigh : 'transparent',
                  },
                ]}
              >
                <Text style={[styles.viewChipLabel, { color: active ? C.text : C.secondary }]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
});

function makeStyles(C: Palette) {
  return StyleSheet.create({
    host: {
      flex: 1,
      gap: Space.sm,
      minHeight: 0,
    },
    stage: {
      flex: 1,
      minHeight: 180,
      borderRadius: Radius.control,
      borderWidth: 1,
      overflow: 'hidden',
    },
    viewRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    viewChip: {
      minHeight: 24,
      paddingHorizontal: 8,
      justifyContent: 'center',
      borderRadius: Radius.control,
      borderWidth: 1,
    },
    viewChipLabel: {
      ...Type.microCaps,
      textTransform: 'uppercase',
    },
    notice: {
      padding: 8,
      borderRadius: Radius.control,
      borderWidth: 1,
    },
    noticeText: {
      ...Type.microCaps,
      textTransform: 'none',
    },
    footRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    sourceRow: {
      flexDirection: 'row',
      gap: 4,
    },
    foot: {
      ...Type.microCaps,
      textTransform: 'uppercase',
    },
  });
}
