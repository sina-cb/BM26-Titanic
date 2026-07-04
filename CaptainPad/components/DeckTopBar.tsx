// Deck top bar.
//
// Visual parity with the Marsin Mixer header (`app/(tabs)/mixer.tsx`
// ~line 615): brand title on the left, connection-status badge, and
// the global master fader on the right. The deck deliberately does
// NOT show the "+ DEFAULT" / "+ FROM PLAYLIST" channel-add buttons —
// channel management is a mixer-tab responsibility; the deck is the
// "performance" surface.
//
// Master is read from the shared `useEngineState()` cache (populated
// by the mixer WS broadcast) so the deck mirrors any change made
// from the mixer tab, PortWatch, or HTTP without owning its own
// WS binding. Writes go through `updateMixerMaster` and are
// throttled to ~30 Hz to keep slow Wi-Fi from queueing PATCHes.
//
// MASTER FADE (docs/39 §8.2 — F-B): a small FADE affordance next to
// MASTER fires the engine's timed grand-master fade
// (`POST /mixer/master/fade` via utils/masterApi.fadeMaster). Pick a
// duration pill (1/3/5/10 s), then "TO BLACK" (target 0) or "UP"
// (target 1). An in-flight fade — reported on the SAME `mixer`/`deck`
// control-bus broadcasts that feed the master value (no new polling
// path) — shows a "FADING…" hint and tints the master bar; the bar
// animates because `master` itself ticks toward the target on each
// broadcast. The hint renders NOTHING when idle, so there is no
// layout shift in the resting state.

import React, { useMemo, useRef } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { HealthChip } from '@/components/ui/HealthChip';
import { MasterFadeGroup } from '@/components/MasterFadeGroup';
import { useMaster, useActiveModel } from '@/hooks/useEngineState';
import { useMasterFade } from '@/hooks/use_master_fade';
import { updateMixerMaster } from '@/utils/api';

interface Props {
  /** Connection state passed in from the deck screen. */
  isConnected: boolean | null;
  /** Optional display title — defaults to "Marsin Deck". */
  title?: string;
  /** Soft PLAN lock gate (planLocked && !leaseHeld). When true the MASTER
   *  fader and the FADE group (TO BLACK / UP / duration pills) are disabled —
   *  dimmed, handlers blocked — until the operator takes over. Status chrome
   *  (connection pill, model chip, health chip, readout) stays live. Default
   *  false so existing call sites are unchanged. */
  disabled?: boolean;
}

export function DeckTopBar({ isConnected, title = 'Marsin Deck', disabled = false }: Props) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
  const master = useMaster();
  const masterFade = useMasterFade();
  const fading = masterFade?.active === true;
  // Active model name (GET /status → activeModel). Null until the first
  // probe lands / while offline — we hide the chip in that case, same
  // graceful-degrade posture as the OFFLINE status pill.
  const activeModel = useActiveModel();
  // Throttle PATCH writes to ~30 Hz — same cadence as the mixer
  // header, keeps the engine from being PATCH-spammed while still
  // letting the slider feel live.
  const lastWriteRef = useRef(0);

  // NOTE: tap tempo + tempo arbitration (TAP / BPM / SYNC) live in the GLOBALS
  // bar (CPCControls), which renders on BOTH the deck and mixer tabs. The
  // DeckTopBar header used to carry a second TAP pill — a duplicate stacked a
  // few px above the globals tile, and (worse) it once mis-read the master
  // level instead of the tempo. It was removed (2026-06-22 QA finding #4): one
  // canonical tempo readout (`useTempoState().bpm` in the globals BpmTile) and
  // one SYNC affordance, no redundant header control. The header keeps the
  // MASTER fader + its readout; tempo belongs to the globals cluster.

  const handleMasterChange = (val: number) => {
    // Soft PLAN lock — the fader is also pointerEvents-blocked below; this is
    // the belt-and-suspenders write-path gate.
    if (disabled) return;
    const now = Date.now();
    if (now - lastWriteRef.current > 33) {
      lastWriteRef.current = now;
      // A direct master write cancels any in-flight fade engine-side —
      // the operator's hand wins (docs/39 §8.2). Surface a real failure
      // rather than swallowing (the catch keeps a transient drag from
      // spamming Alerts; the fade buttons below Alert on failure).
      updateMixerMaster(val).catch(() => undefined);
    }
  };

  return (
    <View style={[styles.header, isPortrait && { paddingHorizontal: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 8 : 16 }}>
        <Text style={[styles.brandText, isPortrait && { fontSize: 16 }]}>{title}</Text>
        <View style={[styles.statusBadge, isPortrait && { paddingHorizontal: 8, paddingVertical: 4 }]}>
          <View style={[styles.statusDot, !isConnected && { backgroundColor: palette.error }]} />
          {/* Connection label — ALWAYS rendered (both orientations). A bare
              dot is not an acceptable disconnect indicator: the OFFLINE state
              especially must read as text, never a single red pixel (QA round 8
              fix #3). '#00a86b' (MOD_GREEN) is the hardcoded "connected/ok"
              green — reads as success on both light and dark surfaces. */}
          <Text style={[styles.labelCaps, { color: isConnected ? '#00a86b' : palette.error }]}>
            {isConnected ? 'CONNECTED' : 'OFFLINE'}
          </Text>
        </View>
        {/* Active model chip — secondary status, after the connection
            pill. Hidden only until the /status probe resolves (null while
            offline / before first probe). Rendered in BOTH orientations for
            consistency (QA round 8 fix #4); it's a dev-fixture name, so it's
            kept visually subordinate (the MODEL caps label is dropped in
            portrait to save width — the name alone is enough). */}
        {activeModel ? (
          <View style={styles.modelChip}>
            {!isPortrait && <Text style={styles.labelCaps}>MODEL</Text>}
            <Text style={styles.modelName} numberOfLines={1}>{activeModel}</Text>
          </View>
        ) : null}
        {/* Engine-health warning — renders NOTHING when healthy (no layout
            shift); shows an amber "⚠ DEGRADED" chip only when the engine
            reports a degrade on /status. See HealthChip / useEngineHealth. */}
        <HealthChip compact={isPortrait} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 4 : 12 }}>
        {/* FADE affordance — the GENTLE path down (and back up) must be
            reachable in BOTH orientations (QA round 8 fix #2): without it,
            portrait left only the HARD blackout cut as a way down. Shared
            MasterFadeGroup (same control the mixer header uses — one
            implementation, no drift). */}
        <MasterFadeGroup isPortrait={isPortrait} disabled={disabled} />
        {/* MASTER label — ALWAYS rendered (both orientations). Portrait used
            to drop it, leaving the fader as an unlabeled bare strip
            (QA round 8 BLOCKER #1). */}
        <Text style={styles.labelCaps}>MASTER</Text>
        {/* Soft PLAN lock: pointerEvents 'none' blocks the fader's
            PanResponder entirely (a gated onChange alone would still let the
            thumb track the finger locally — a visual lie); the dim marks it
            disabled. The fade animation / broadcast sync stay live so the
            operator still SEES plan-driven master moves. */}
        <View
          pointerEvents={disabled ? 'none' : 'auto'}
          style={disabled ? { opacity: 0.45 } : null}
        >
          <HorizontalFader
            value={master}
            onChange={handleMasterChange}
            // During a timed fade, animate the slider smoothly toward the target
            // instead of snapping to each broadcast value (the "didn't animate"
            // bug). null when idle ⇒ normal external sync.
            fadingTarget={fading ? masterFade?.to : null}
            fadingDurationMs={masterFade?.remainingMs}
            trackStyle={[styles.faderTrack, { width: isPortrait ? 120 : 180 }]}
            fillStyle={[styles.faderFill, fading && styles.faderFillFading]}
            // Visible, grabbable THUMB (QA round 8 BLOCKER #1) — same pattern as
            // the global hue fader. Without it the master is a full-width hot
            // strip: a stray graze anywhere on the bar writes master and can
            // drive the whole rig toward 0. The thumb gives the operator a
            // deliberate handle to aim for.
            thumbStyle={styles.faderThumb}
          />
        </View>
        {/* FADING… hint — renders ONLY while a fade is in flight so the
            resting header has no layout shift. The master readout sits in
            a fixed-width slot, so swapping its text for the hint keeps the
            row geometry stable either way. */}
        {fading ? (
          <Text style={styles.fadingHint}>FADING…</Text>
        ) : (
          <Text style={[
            styles.displayMono,
            // marginLeft keeps the readout off the slider track/thumb so the
            // leading digit never reads as touching the bar (QA round 10
            // fix #2) — the resting-row `gap` (4pt in portrait) was too tight
            // against the thumb. Matches the mixer-landscape master spacing.
            { fontSize: 16, width: 36, textAlign: 'right', marginLeft: 8 },
            isPortrait && { fontSize: 14, width: 28 },
          ]}>
            {Math.round(master * 100)}
          </Text>
        )}
      </View>
    </View>
  );
}

// Style tokens lifted from mixer.tsx so the two tabs match pixel-for-pixel.
function makeStyles(C: Palette) {
  return {
    header: {
      height: 64,
      backgroundColor: C.surfaceContainerLow,
      borderBottomWidth: 1,
      borderBottomColor: C.ghostBorder,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingHorizontal: 24,
    },
    brandText: {
      color: C.primary,
      fontSize: 20,
      fontFamily: 'SpaceGrotesk_700Bold',
      letterSpacing: -0.5,
    },
    statusBadge: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    statusDot: {
      width: 8, height: 8, borderRadius: 4,
      // '#00a86b' MOD_GREEN — works on both themes (matches the connected label).
      backgroundColor: '#00a86b',
    },
    // Secondary "active model" chip. Same surface/border geometry as the
    // status badge so the two read as one toolbar; slightly tighter
    // padding to keep it visually subordinate to the connection pill.
    modelChip: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 6,
      maxWidth: 200,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    modelName: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.4,
      color: C.primary,
      flexShrink: 1,
    },
    labelCaps: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 1.2,
      color: C.secondary,
      textTransform: 'uppercase' as const,
    },
    displayMono: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 18,
      color: C.primary,
    },
    faderTrack: {
      height: 16,
      backgroundColor: C.surfaceContainerHigh,
      borderRadius: 4,
    },
    faderFill: {
      position: 'absolute' as const,
      left: 0, top: 0, bottom: 0,
      backgroundColor: C.primaryFixedDim,
      borderRadius: 4,
    },
    // Grabbable master THUMB (QA round 8 BLOCKER #1) — same visual language
    // as the global hue fader's thumb (lowest-surface block, ghost border).
    // Sized to the 16pt track height so it isn't clipped by the track's
    // overflow:hidden, and centred on the fill edge via translateX:-7.
    faderThumb: {
      position: 'absolute' as const,
      top: 0, bottom: 0,
      width: 14,
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: C.primary,
      transform: [{ translateX: -7 }],
    },
    // While a timed fade is animating, tint the fill so the operator can
    // tell the bar is moving on its own (engine-driven) vs. their drag.
    faderFillFading: {
      backgroundColor: C.tertiary,
    },
    // (The FADE pill / TO BLACK / UP styles moved to MasterFadeGroup, the
    // shared component the deck + mixer both render.)
    // Same fixed 36pt slot as the master readout so swapping in the hint
    // keeps the row width stable — no layout shift when a fade starts.
    fadingHint: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
      color: C.tertiary,
      width: 44,
      textAlign: 'right' as const,
      // Match the readout's left gap (fix #2) so swapping hint↔value keeps
      // the same separation from the slider and the row geometry stays put.
      marginLeft: 8,
    },
  };
}
