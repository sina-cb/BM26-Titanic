import React, { useEffect, useRef, useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
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

const REDRAW_MIN_INTERVAL_MS = 200; // 5 Hz cap, matches the prior screen-level throttle.

export const ChannelVizStrip = React.memo(function ChannelVizStrip({
  vizKey,
  height = 14,
  style,
}: {
  /** Key into the engine's `vis` map. Channel id for overlays, or
   *  'master' for the master output strip. */
  vizKey: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [data, setData] = useState<string | null>(null);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    const unsub = engineVizEvents.subscribe((msg: EngineMessage) => {
      if (msg.type !== 'vis') return;
      const vis = (msg.vis as { [key: string]: string | null }) || {};
      const next = vizKey in vis ? vis[vizKey] : null;
      const now = Date.now();
      if (now - lastUpdateRef.current < REDRAW_MIN_INTERVAL_MS) return;
      lastUpdateRef.current = now;
      setData(next);
    });
    return unsub;
  }, [vizKey]);

  return <PixelStrip base64Data={data} height={height} style={style} />;
});
