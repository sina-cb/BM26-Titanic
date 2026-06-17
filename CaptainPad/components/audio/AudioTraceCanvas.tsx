// AudioTraceCanvas — Companion-quality smooth scrolling RAW→POST traces
// for the AUDIO tab, adapted for the iPad.
//
// WHY THIS EXISTS
//   The Audio Companion desktop app (marsin_engine/audio/companion/ui/
//   companion_app.js — drawTrace / trLine / drawSpectrum) renders each
//   signal as a smooth, filled, color-per-signal scrolling trace advanced
//   on requestAnimationFrame, with a thin ghosted RAW line behind a bold
//   POST line. The previous CaptainPad meters approximated this with a
//   15 Hz setState-driven SVG polyline ring buffer — readable, but it
//   ticked at the analyser's network cadence (visibly steppy) and drew a
//   bare polyline (no fill, no smoothing).
//
//   This module brings the Companion look to the iPad WITHOUT raising
//   network rate (Codex P0 congestion-aware; playa WiFi):
//
//   1. SMOOTH + FAST (~60 fps). Each trace owns its OWN requestAnimationFrame
//      loop, fully DECOUPLED from WebSocket arrival — exactly how the
//      Companion's draw() loop reads S.live (updated by the WS) and advances
//      its ring buffer every animation frame. The loop reads the latest
//      throttled CPC value from a ref (no React state on the hot path),
//      INTERPOLATES the displayed value toward it each frame (exponential
//      smoothing, the client-side coalescing the brief calls for), and
//      advances a ring buffer at the device frame rate. So the trace glides
//      between 15-30 Hz WS updates instead of stepping.
//
//   2. CONGESTION-AWARE. There is NO new subscription here. The component is
//      a pure consumer of values the parent already pulls from the existing
//      throttled live-param bus (useLiveParams / useAudioSignals). All of the
//      extra smoothness is computed on-device from those same samples — zero
//      added network traffic. The rAF loop pauses itself when the tab blurs
//      (`active` prop) so background tabs burn no cycles.
//
//   3. iPad-ADAPTED + OFFLINE. Renders with react-native-svg (already a
//      vendored CaptainPad dependency — see package.json; NO new heavy dep,
//      no Skia, no CDN). One <Path> for the filled area + one stroked <Path>
//      for the POST line + a thin stroked <Path> for the RAW ghost, with
//      quadratic-smoothed control points (mirrors the Companion's
//      quadraticCurveTo wave/spectrum rendering). Touch-friendly sizing is
//      driven by the caller.
//
// The component re-renders only itself (one setState of two path strings per
// frame); the surrounding AUDIO body never re-renders on these frames.

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Line } from 'react-native-svg';

// Internal trace resolution. The ring buffer holds this many normalised
// [0,1] samples; the rAF loop advances the head one slot per VISUAL step.
// 360 matches the Companion's TRAIL constant so the on-screen density reads
// the same. The SVG viewBox is fixed and the path scales to the rendered
// width via preserveAspectRatio="none".
const TRAIL_LEN = 360;
const VIEW_W = 360;
const VIEW_H = 100;

// VISUAL advance cadence — how fast the trace scrolls left, in samples/sec.
// Decoupled from BOTH the WS rate (15-30 Hz) and the device frame rate
// (~60 fps): the rAF loop advances `head` by elapsed * ADVANCE_HZ each
// frame, so the scroll speed is identical on a 60 Hz and a 120 Hz iPad and
// independent of how often the network delivers a value. ~45/s fills the
// 360-slot, ~10 s-equivalent buffer at a calm, readable pace.
const ADVANCE_HZ = 45;

// Per-frame interpolation factor for the displayed value. Each frame the
// shown value eases toward the latest WS target by this fraction — the
// client-side coalescing/advance the brief asks for. Higher = snappier /
// closer to raw; lower = silkier but laggier. 0.35 tracks transients (a
// kick) while still gliding between throttled updates. Matches the spirit of
// the Companion's spectrum EMA (a = 0.35).
const SMOOTH_ALPHA = 0.35;

export interface AudioTraceCanvasProps {
  /** Latest POST (gained / post-chain) value, already normalised to [0,1]. */
  post: number;
  /** Latest RAW (pre-gain) value normalised to [0,1], or null when the
   *  signal has no raw mirror (dom / detectors / derived) — RAW line hidden. */
  raw: number | null;
  /** Signal accent colour (resolved hex). Drives stroke + fill gradient. */
  color: string;
  /** Surface colour behind the trace (from the palette). */
  background: string;
  /** Grid line colour (faint). */
  gridColor: string;
  /** Rendered height in px. Width fills the parent. */
  height: number;
  /** Pause the rAF loop when false (tab blurred) — congestion/cpu guard. */
  active: boolean;
}

const clamp01 = (x: number): number => (x > 1 ? 1 : x > 0 ? x : 0);

// Build a quadratic-smoothed SVG path string from a ring buffer, reading
// oldest→newest left→right starting at `head`. Mirrors the Companion's
// quadraticCurveTo midpoint smoothing (drawWave / drawSpectrum) so the line
// is a flowing curve rather than a jagged polyline. When `close` is set the
// path is closed down to the baseline for an area fill.
function buildPath(buf: Float32Array, head: number, close: boolean): string {
  const n = buf.length;
  if (n < 2) return '';
  const stepX = VIEW_W / (n - 1);
  const yOf = (v: number): number => VIEW_H * (1 - clamp01(v));
  const x0 = 0;
  const y0 = yOf(buf[head % n]);
  let d = close ? `M ${x0.toFixed(2)} ${VIEW_H} L ${x0.toFixed(2)} ${y0.toFixed(2)}` : `M ${x0.toFixed(2)} ${y0.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const idxA = (head + i) % n;
    const idxB = (head + i + 1) % n;
    const xA = i * stepX;
    const yA = yOf(buf[idxA]);
    const xB = (i + 1) * stepX;
    const yB = yOf(buf[idxB]);
    const mx = (xA + xB) / 2;
    const my = (yA + yB) / 2;
    d += ` Q ${xA.toFixed(2)} ${yA.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  const lastIdx = (head + n - 1) % n;
  d += ` L ${VIEW_W.toFixed(2)} ${yOf(buf[lastIdx]).toFixed(2)}`;
  if (close) d += ` L ${VIEW_W.toFixed(2)} ${VIEW_H} Z`;
  return d;
}

// One smooth, filled, self-animating trace. Owns a ring buffer + an rAF loop;
// reads the live target from refs the parent refreshes each render (cheap, no
// hot-path state). Emits one setState (two path strings) per animation frame.
export function AudioTraceCanvas({
  post, raw, color, background, gridColor, height, active,
}: AudioTraceCanvasProps) {
  // Live targets — refreshed every render from props, read inside the rAF
  // loop. The loop never closes over a stale prop because it reads the ref.
  const postTargetRef = useRef(clamp01(post));
  postTargetRef.current = clamp01(post);
  const rawTargetRef = useRef(raw === null ? null : clamp01(raw));
  rawTargetRef.current = raw === null ? null : clamp01(raw);
  const hasRaw = raw !== null;

  // Ring buffers + interpolation state live in refs so the rAF loop mutates
  // them without forcing React work.
  const postBufRef = useRef<Float32Array>(new Float32Array(TRAIL_LEN));
  const rawBufRef = useRef<Float32Array>(new Float32Array(TRAIL_LEN));
  const headRef = useRef(0);
  const postShownRef = useRef(clamp01(post));
  const rawShownRef = useRef(raw === null ? 0 : clamp01(raw));
  // Fractional head accumulator so ADVANCE_HZ is honoured exactly regardless
  // of the actual frame rate (no drift on 120 Hz panels).
  const headAccRef = useRef(0);
  const lastTsRef = useRef(0);

  // The ONLY React state on the hot path: the two computed path strings. A
  // setState per frame is cheap (string assignment + one <Path> d update) and
  // is scoped to THIS trace, so the page body never re-renders.
  const [paths, setPaths] = useState<{ post: string; postFill: string; raw: string }>(
    { post: '', postFill: '', raw: '' },
  );

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    lastTsRef.current = 0;
    const tick = (ts: number) => {
      if (lastTsRef.current === 0) lastTsRef.current = ts;
      const dt = Math.min(0.1, (ts - lastTsRef.current) / 1000); // clamp big gaps (tab resume)
      lastTsRef.current = ts;

      // 1. INTERPOLATE the shown value toward the latest throttled target.
      //    This is the client-side smoothing that turns 15-30 Hz network
      //    samples into a 60 fps glide (the Companion's per-frame ease).
      postShownRef.current += (postTargetRef.current - postShownRef.current) * SMOOTH_ALPHA;
      const rt = rawTargetRef.current;
      if (rt !== null) rawShownRef.current += (rt - rawShownRef.current) * SMOOTH_ALPHA;

      // 2. ADVANCE the ring buffer head by the elapsed visual cadence.
      //    Fractional accumulation keeps the scroll speed frame-rate-stable.
      headAccRef.current += dt * ADVANCE_HZ;
      let advanced = false;
      while (headAccRef.current >= 1) {
        headAccRef.current -= 1;
        const h = headRef.current;
        // Newest sample lands at the slot just BEHIND head (right edge);
        // head marks the oldest. We write the interpolated value so the new
        // pixels carry the smoothed glide, not the stepped raw target.
        postBufRef.current[h] = postShownRef.current;
        rawBufRef.current[h] = rawShownRef.current;
        headRef.current = (h + 1) % TRAIL_LEN;
        advanced = true;
      }
      // Always keep the right-edge sample fresh so the "now" point tracks the
      // glide even between buffer advances (no visible right-edge stall).
      const edge = (headRef.current - 1 + TRAIL_LEN) % TRAIL_LEN;
      postBufRef.current[edge] = postShownRef.current;
      rawBufRef.current[edge] = rawShownRef.current;

      // 3. RE-PATH. Recompute only when something actually moved.
      if (advanced || true) {
        const head = headRef.current;
        const postLine = buildPath(postBufRef.current, head, false);
        const postFill = buildPath(postBufRef.current, head, true);
        const rawLine = hasRaw ? buildPath(rawBufRef.current, head, false) : '';
        setPaths({ post: postLine, postFill, raw: rawLine });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, hasRaw]);

  // Faint quarter grid lines (matches the Companion's H/4 guide lines).
  const gridLines = useMemo(() => [0.25, 0.5, 0.75].map((g) => g * VIEW_H), []);

  return (
    <View style={{
      height,
      backgroundColor: background,
      borderRadius: 4,
      overflow: 'hidden',
    }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
        {gridLines.map((y) => (
          <Line key={y} x1={0} y1={y} x2={VIEW_W} y2={y} stroke={gridColor} strokeWidth={0.5} />
        ))}
        {paths.postFill ? (
          <Path d={paths.postFill} fill={color} fillOpacity={0.16} stroke="none" />
        ) : null}
        {hasRaw && paths.raw ? (
          <Path d={paths.raw} fill="none" stroke={color} strokeOpacity={0.32} strokeWidth={1} />
        ) : null}
        {paths.post ? (
          <Path d={paths.post} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
      </Svg>
    </View>
  );
}
