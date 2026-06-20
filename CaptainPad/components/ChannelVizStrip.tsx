import React, { useEffect, useRef, useState } from 'react';
import { StyleProp, ViewStyle, View, Text, StyleSheet } from 'react-native';
import { PixelStrip } from '@/components/ui/PixelStrip';
import { engineVizEvents } from '@/utils/engineVizEvents';
import type { EngineMessage } from '@/utils/engineEvents';

// ── ChannelVizStrip ─────────────────────────────────────────────────────
// Self-contained, per-id pixel-viz subscriber.
//
// The problem it solves (slice item 2): previously the deck/mixer screens
// held all channels' pixel data in a single `visDataRef` and bumped a
// screen-level `setVisVersion` on every viz frame (~5 Hz after the client
// cap). That re-rendered the WHOLE screen — the mixer then re-mapped its
// channel array and handed each ChannelStrip a fresh `visData` prop, which
// defeated ChannelStrip's React.memo (the prop changed every tick) and
// reconciled every strip's playlist panel + local-param faders + chrome
// 5×/sec. That was a measurable chunk of the "mixer feels laggy with 3
// channels" complaint.
//
// Here each strip subscribes to the viz bus itself and keeps ONLY its own
// channel's base64 frame in local state. A new frame re-renders just this
// tiny component (a single <PixelStrip>), never the parent screen and
// never the sibling strips. ChannelStrip can now hold its memo because it
// no longer receives a per-tick `visData` prop.
//
// The 5 Hz client redraw cap is preserved per-strip (lastUpdateRef), so
// the iPad stays cool even when the engine emits viz faster.
//
// Codex P0 — no fallback: a missing key yields `null`, which PixelStrip
// already renders as an empty (off) strip. That is the real "no data yet"
// state, not a substituted value.
//
// ── Output METER (channel metering) ─────────────────────────────────────
// Alongside the pixel frame, the engine ships a `levels` sidecar on the
// SAME vis message: { <visKey>: number(0..1) } — the channel's effective
// post-fader/clamp/group/solo output (what actually reaches the mix). We
// read THIS strip's own level off that map (still self-subscribed; no new
// prop, no coupling to mixer.tsx) and render a thin bar + percent. It tells
// the operator which layer is actually contributing light vs. sitting dark
// (faded out, muted group, solo-gated, or made invisible by a blend mode).
//
// Codex P0 — no silent fallback: if the engine omits `levels` (an older
// engine, or this key absent), `level` stays `null` and NO meter renders.
// The pixel strip layout is unchanged in that case (no layout shift). A
// `null` is the documented "no level reported" default — never a fabricated 0.

const REDRAW_MIN_INTERVAL_MS = 200; // 5 Hz cap, matches the prior screen-level throttle.

// Bar fill color ramps green→amber→red as a layer pushes more light, so a
// dark-but-armed layer (low bar) reads differently at a glance from a layer
// slamming the rig (full bar). Purely cosmetic; the numeric percent is truth.
function levelColor(level: number): string {
  if (level >= 0.66) return '#ff5a4d'; // hot
  if (level >= 0.33) return '#f5c542'; // warm
  return '#4dd06a'; // calm green
}

export const ChannelVizStrip = React.memo(function ChannelVizStrip({
  vizKey,
  height = 14,
  style,
  showMeter = true,
}: {
  /** Key into the engine's `vis` map. Channel id for overlays, or
   *  'master' for the master output strip. */
  vizKey: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** Render the effective-output meter under the pixel strip (default on).
   *  Set false where vertical space is tight and only the pixels matter. */
  showMeter?: boolean;
}) {
  const [data, setData] = useState<string | null>(null);
  // null = engine reported no level for this key (older engine / absent).
  // A number in [0,1] = the channel's effective output this frame.
  const [level, setLevel] = useState<number | null>(null);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    const unsub = engineVizEvents.subscribe((msg: EngineMessage) => {
      if (msg.type !== 'vis') return;
      const vis = (msg.vis as { [key: string]: string | null }) || {};
      const next = vizKey in vis ? vis[vizKey] : null;
      // Read the matching meter level from the sidecar. Only a real finite
      // number counts — anything else (absent key, older engine with no
      // `levels` field) is `null`, which renders NO meter (fail-loud default).
      const levels = msg.levels as { [key: string]: number } | undefined;
      const rawLevel = levels && vizKey in levels ? levels[vizKey] : undefined;
      const nextLevel = typeof rawLevel === 'number' && Number.isFinite(rawLevel)
        ? Math.max(0, Math.min(1, rawLevel))
        : null;
      const now = Date.now();
      if (now - lastUpdateRef.current < REDRAW_MIN_INTERVAL_MS) return;
      lastUpdateRef.current = now;
      setData(next);
      setLevel(nextLevel);
    });
    return unsub;
  }, [vizKey]);

  const pixelStrip = <PixelStrip base64Data={data} height={height} style={style} />;

  // No meter when disabled, or when the engine reported no level (fail-loud
  // schema default — absent ⇒ nothing rendered, never a fabricated 0). No
  // layout shift relative to the pre-metering strip in this case.
  if (!showMeter || level === null) {
    return pixelStrip;
  }

  const pct = Math.round(level * 100);
  return (
    <View>
      {pixelStrip}
      <View style={styles.meterRow}>
        <View
          accessibilityLabel={`Output level ${pct} percent`}
          style={styles.meterTrack}
        >
          <View
            style={[
              styles.meterFill,
              { width: `${pct}%`, backgroundColor: levelColor(level) },
            ]}
          />
        </View>
        <Text style={styles.meterLabel}>{pct}%</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  meterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  meterTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    borderRadius: 2,
  },
  meterLabel: {
    marginLeft: 6,
    width: 34,
    textAlign: 'right',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    color: 'rgba(255,255,255,0.55)',
  },
});
