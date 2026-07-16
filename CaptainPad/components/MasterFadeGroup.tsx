// MasterFadeGroup — the timed grand-master FADE affordance (docs/39 §8.2 — F-B),
// shared by the deck top bar (DeckTopBar) and the mixer header
// (app/(tabs)/mixer.tsx). Pick a duration pill (1/3/5/10 s), then "TO BLACK"
// (target 0) or "UP" (target 1); the engine runs the timed fade via
// POST /mixer/master/fade (utils/masterApi.fadeMaster).
//
// This was deck-only and inlined in DeckTopBar; it was extracted here when the
// mixer gained the same control so the two surfaces share ONE implementation —
// same pills, same behaviour, no duplicated fade UI to drift apart.
//
// Responsive, exactly as the deck header was: landscape shows the full
// duration-pill row; portrait collapses the pills into one compact button that
// CYCLES through FADE_SECONDS on tap (a dropdown would need a new menu surface
// and more width than the narrow header has), keeping FADE + TO BLACK + UP
// reachable in both orientations (QA round 8 fix #2).

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { fadeMaster } from '@/utils/masterApi';
import { updateMixerMaster } from '@/utils/api';

// Duration choices for the timed fade, in seconds. `0` = INSTANT (operator
// request 2026-06-30): a snap to black / full with no ramp. Kept short
// otherwise — the operator can always drag the master directly for anything
// bespoke. NOTE: 0 can't go through the timed-fade route (the engine's
// startMasterFade requires durationMs > 0); runFade() routes 0 to the instant
// PATCH /mixer {master} (updateMixerMaster) instead.
export const FADE_SECONDS = [0, 1, 3, 5, 10] as const;
const DEFAULT_FADE_SECONDS = 3;

// ── Shared selected-duration store ──────────────────────────────────────────
// The selected fade duration used to be per-instance React state, so the deck
// top bar and the mixer header each held their OWN pill selection — and it was
// invisible to any non-React caller. The APC "stop_all_clips → master fade"
// button (utils/midi) must fade over the CURRENTLY-SELECTED duration, not a
// hardcoded one, so the selection is lifted into a module store: both on-screen
// instances read/write it (staying in lockstep) and the MIDI layer reads it via
// `getSelectedFadeSeconds()`. Mirrors the useMidiWindow module-store pattern.
let _selectedFadeSeconds: number = DEFAULT_FADE_SECONDS;
const _fadeSecondsListeners = new Set<(s: number) => void>();

/** The currently-selected master-fade duration in seconds (one of FADE_SECONDS).
 *  Read by the APC master-fade toggle so it fades over the duration the operator
 *  picked on-screen — never a hardcoded value. */
export function getSelectedFadeSeconds(): number {
  return _selectedFadeSeconds;
}

/** Set the selected fade duration and fan out to every subscriber (both
 *  MasterFadeGroup instances). No churn when unchanged. */
export function setSelectedFadeSeconds(seconds: number): void {
  if (seconds === _selectedFadeSeconds) return;
  _selectedFadeSeconds = seconds;
  _fadeSecondsListeners.forEach((cb) => { try { cb(seconds); } catch { /* one bad subscriber must not break the rest */ } });
}

/** Subscribe a component to the shared selected duration (re-renders on change).
 *  The pills read + write through this so the two surfaces never diverge. */
function useSelectedFadeSeconds(): number {
  const [s, setS] = useState(_selectedFadeSeconds);
  useEffect(() => {
    _fadeSecondsListeners.add(setS);
    setS(_selectedFadeSeconds);
    return () => { _fadeSecondsListeners.delete(setS); };
  }, []);
  return s;
}

interface Props {
  /** Compact (portrait) layout when true — pills collapse to a cycler. */
  isPortrait: boolean;
  /** Soft PLAN lock gate (planLocked && !leaseHeld). When true the whole FADE
   *  cluster (duration pills / cycler, TO BLACK, UP) is disabled — dimmed,
   *  handlers blocked — until the operator takes over. Default false so the
   *  existing call sites are unchanged. */
  disabled?: boolean;
}

export function MasterFadeGroup({ isPortrait, disabled = false }: Props) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  // Selected fade duration (seconds) — SHARED across both MasterFadeGroup
  // instances and readable by the MIDI layer via getSelectedFadeSeconds().
  const fadeSeconds = useSelectedFadeSeconds();
  const setFadeSeconds = setSelectedFadeSeconds;

  const runFade = async (target: number) => {
    // Soft PLAN lock — the buttons below are disabled too; this is the
    // belt-and-suspenders write-path gate.
    if (disabled) return;
    // 0s = INSTANT: the timed-fade route rejects durationMs<=0 (startMasterFade
    // needs >0), so a 0s "fade" is a direct master set that snaps immediately
    // (and cancels any in-flight fade). Anything >0 runs the timed fade.
    const res = fadeSeconds > 0
      ? await fadeMaster(target, fadeSeconds * 1000)
      : await updateMixerMaster(target);
    if (!res.ok) {
      // Codex P0 — fail loud: a rejected fade must be visible, not silently
      // dropped.
      const where = target <= 0 ? 'To Black' : 'Up';
      console.error(`Master ${where} failed:`, res.error);
      Alert.alert('Master fade failed', res.error || 'The engine rejected the request.');
    }
  };

  // "instantly" for the 0s preset, "over Ns" otherwise — keeps the spoken
  // labels honest now that 0s is a snap, not a ramp.
  const overPhrase = fadeSeconds > 0 ? `over ${fadeSeconds} seconds` : 'instantly';

  return (
    <View style={[styles.fadeGroup, disabled && { opacity: 0.45 }]}>
      <Text style={styles.labelCaps}>FADE</Text>
      {!isPortrait ? (
        <View style={styles.fadePills}>
          {FADE_SECONDS.map((s) => {
            const selected = s === fadeSeconds;
            return (
              <TouchableOpacity
                key={s}
                onPress={() => setFadeSeconds(s)}
                disabled={disabled}
                hitSlop={{ top: 14, bottom: 14, left: 6, right: 6 }}
                style={[styles.fadePill, selected && styles.fadePillSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled }}
                accessibilityLabel={`Fade duration ${s} seconds`}
              >
                <Text style={[styles.fadePillText, selected && styles.fadePillTextSelected]}>
                  {`${s}s`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        // Compact duration cycler: tap to advance to the next FADE_SECONDS value
        // (wraps). The trailing ▾ + the accessibilityHint listing every preset
        // make it read as a value picker rather than an opaque one-off chip
        // (QA round 10 fix #1).
        <TouchableOpacity
          onPress={() => {
            const i = FADE_SECONDS.indexOf(fadeSeconds as (typeof FADE_SECONDS)[number]);
            const next = FADE_SECONDS[(i + 1) % FADE_SECONDS.length];
            setFadeSeconds(next);
          }}
          disabled={disabled}
          hitSlop={{ top: 14, bottom: 14, left: 6, right: 6 }}
          style={[styles.fadePill, styles.fadePillSelected, styles.fadePillCycler]}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          accessibilityLabel={`Fade duration ${fadeSeconds} seconds`}
          accessibilityHint={`Tap to cycle through ${FADE_SECONDS.map((s) => `${s}s`).join(', ')}`}
        >
          <Text style={[styles.fadePillText, styles.fadePillTextSelected]}>
            {`${fadeSeconds}s`}
          </Text>
          <Text style={[styles.fadePillText, styles.fadePillTextSelected, styles.fadeCyclerCaret]}>
            ▾
          </Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity
        onPress={() => runFade(0)}
        disabled={disabled}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        style={[styles.fadeAction, styles.fadeActionBlack]}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={`Fade master to black ${overPhrase}`}
      >
        <Text style={styles.fadeActionText}>TO BLACK</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => runFade(1)}
        disabled={disabled}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        style={[styles.fadeAction, styles.fadeActionUp]}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={`Fade master up ${overPhrase}`}
      >
        <Text style={styles.fadeActionText}>UP</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(C: Palette) {
  return {
    labelCaps: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 1.2,
      color: C.secondary,
      textTransform: 'uppercase' as const,
    },
    fadeGroup: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
    },
    fadePills: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 4,
    },
    // Touch target: 28pt visible height + 14pt vertical hitSlop each side
    // ⇒ ≥44pt effective. Min width keeps the pills tappable.
    fadePill: {
      minWidth: 30,
      height: 28,
      paddingHorizontal: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    fadePillSelected: {
      backgroundColor: C.primary,
      borderColor: C.primary,
    },
    // Portrait cycler variant: lay the value + ▾ caret out in a row so the
    // chip reads as a value picker, not a one-off label.
    fadePillCycler: {
      flexDirection: 'row' as const,
      paddingHorizontal: 8,
    },
    // Small gap + slightly smaller caret so the ▾ trails the value cleanly.
    fadeCyclerCaret: {
      marginLeft: 3,
      fontSize: 9,
    },
    fadePillText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.4,
      color: C.secondary,
    },
    fadePillTextSelected: {
      color: C.onPrimary,
    },
    // Action buttons: 28pt visible height + 8pt vertical hitSlop ⇒ ≥44pt.
    fadeAction: {
      height: 28,
      paddingHorizontal: 10,
      borderRadius: 6,
      borderWidth: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    fadeActionBlack: {
      borderColor: C.error,
      backgroundColor: C.surfaceContainerHigh,
    },
    fadeActionUp: {
      borderColor: C.primary,
      backgroundColor: C.surfaceContainerHigh,
    },
    fadeActionText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 1.0,
      color: C.primary,
      textTransform: 'uppercase' as const,
    },
  };
}
