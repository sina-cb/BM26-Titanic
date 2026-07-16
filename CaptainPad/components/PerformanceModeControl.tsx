import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { ExitPerformanceSheet } from '@/components/ExitPerformanceSheet';
import {
  usePerformanceMode,
  subscribePerformanceDialogSummon,
  refreshPerformanceMode,
} from '@/hooks/usePerformanceMode';
import { usePerformanceDialogButton } from '@/hooks/useMidiControl';
import { setPerformanceMode, type PerformanceExitAction } from '@/utils/api';
import {
  ENTER_CONFIRM_TITLE,
  ENTER_CONFIRM_MESSAGE,
  ENTER_CONFIRM_LABEL,
  performanceModeLabel,
  performanceSummonOutcome,
  pressAgainToGoLiveLabel,
  exitChoiceControllerHint,
} from '@/components/performance_mode_logic';

// Idle chip: plan-lock amber outline (the "arm the show" affordance reads in
// the same visual language as the rest of the soft-lock chrome).
export const PERFORMANCE_AMBER = '#F5A623';
// Active button: RED (operator ruling 2026-07-13). While the show is live the
// button names the mode you switch BACK to — it reads "EDIT" on a red fill.
export const PERFORMANCE_RED = '#D32F2F';

// ── PerformanceModeControl ─────────────────────────────────────────────────
// ONE shared control mounted in BOTH the deck and mixer headers. Idle: an
// amber outline PERFORMANCE chip → ConfirmSheet → GO LIVE. Active: a filled
// RED "EDIT" button → ExitPerformanceSheet (KEEP / RESTORE / CANCEL).
//
// NO optimistic flip: the engine's `performanceMode` WS broadcast is the single
// source of truth (usePerformanceMode reconciles it). We only drive the POST
// and show a brief pending spinner; the button itself flips when the echo lands.
//
// APC SOLO summon: the APC mini's SOLO pad drives the SAME guarded flows as a
// tap on this control — it summons the state-appropriate sheet via the
// performance-dialog summon bus (subscribePerformanceDialogSummon). Only ONE
// mounted control claims the summon (the bus notifies the first subscriber), so
// deck+mixer both mounting this never stacks two modals. Press semantics live
// in performanceSummonOutcome (operator ruling 2026-07-13 round 2): a second
// SOLO press while the ENTER sheet is open CONFIRMS (GO LIVE) — the sheet shows
// a "PRESS SOLO AGAIN TO GO LIVE" row when such a controller is connected. On
// the EXIT sheet a single button cannot pick KEEP vs RESTORE, so a second press
// only CLOSES the sheet (safe + reversible) and the sheet hints that the choice
// is made here on the iPad.

interface Props {
  /** Compact layout for the narrow portrait header. */
  isPortrait?: boolean;
}

export function PerformanceModeControl({ isPortrait = false }: Props) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const { active, dirtyCount, dirtyEntries } = usePerformanceMode();
  // "SOLO" when an APC (or any profile binding performanceDialog) is
  // CONNECTED; null otherwise → the sheets render without controller copy.
  const midiButton = usePerformanceDialogButton();

  const [confirmEnter, setConfirmEnter] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [pending, setPending] = useState(false);

  // Opening the exit sheet pulls the freshest dirty summary (the engine only
  // broadcasts performanceMode on enter/exit, so tuning done mid-show isn't
  // pushed until we ask). Reused by the tap handler AND the APC-summon path so
  // both open with an accurate save-ask.
  const openExitSheet = () => {
    refreshPerformanceMode();
    setExitOpen(true);
  };
  const openExitSheetRef = useRef(openExitSheet);
  openExitSheetRef.current = openExitSheet;

  // Refs mirror the state for the summon handler (registered once).
  const stateRef = useRef({ active, confirmEnter, exitOpen, pending });
  stateRef.current = { active, confirmEnter, exitOpen, pending };

  const doEnter = () => {
    setConfirmEnter(false);
    setPending(true);
    setPerformanceMode({ active: true })
      .finally(() => setPending(false));
    // The button flips on the WS echo, not here (no optimistic flip).
  };
  const doEnterRef = useRef(doEnter);
  doEnterRef.current = doEnter;

  useEffect(() => {
    // Claimed by the FIRST mounted control (bus notifies one subscriber).
    // Press semantics = performanceSummonOutcome (pure, vitest-pinned):
    // second press on the ENTER sheet CONFIRMS; on the EXIT sheet it closes.
    return subscribePerformanceDialogSummon(() => {
      const s = stateRef.current;
      switch (performanceSummonOutcome({
        active: s.active,
        enterConfirmOpen: s.confirmEnter,
        exitSheetOpen: s.exitOpen,
        pending: s.pending,
      })) {
        case 'confirmEnter':
          doEnterRef.current();
          return;
        case 'closeExitSheet':
          setExitOpen(false);
          return;
        case 'openExitSheet':
          openExitSheetRef.current();
          return;
        case 'openEnterConfirm':
          setConfirmEnter(true);
          return;
        case 'none':
          return;
      }
    });
  }, []);

  const doExit = (action: PerformanceExitAction) => {
    setPending(true);
    setPerformanceMode({ active: false, exitAction: action })
      .finally(() => {
        setPending(false);
        setExitOpen(false);
      });
  };

  return (
    <>
      <TouchableOpacity
        style={[
          styles.chip,
          active ? styles.chipActive : styles.chipIdle,
          isPortrait && styles.chipPortrait,
        ]}
        onPress={() => (active ? openExitSheet() : setConfirmEnter(true))}
        disabled={pending}
        accessibilityRole="button"
        accessibilityLabel={active ? 'Performance mode active — exit to edit mode' : 'Enter performance mode'}
        accessibilityState={{ disabled: pending }}
      >
        {pending ? (
          <ActivityIndicator size="small" color={active ? '#FFF' : PERFORMANCE_AMBER} />
        ) : (
          <Text
            style={[
              styles.chipText,
              active ? styles.chipTextActive : styles.chipTextIdle,
              isPortrait && styles.chipTextPortrait,
            ]}
            numberOfLines={1}
          >
            {active ? performanceModeLabel(true) : (isPortrait ? 'PERF' : performanceModeLabel(false))}
          </Text>
        )}
      </TouchableOpacity>

      <ConfirmSheet
        visible={confirmEnter}
        title={ENTER_CONFIRM_TITLE}
        message={ENTER_CONFIRM_MESSAGE}
        confirmLabel={ENTER_CONFIRM_LABEL}
        // MIDI affordance: when a controller binding performanceDialog is
        // CONNECTED, tell the operator the same physical button confirms —
        // a second SOLO press IS the GO LIVE (performanceSummonOutcome).
        extra={midiButton ? (
          <View style={styles.pressAgainRow} accessibilityRole="text">
            <Text style={styles.pressAgainText}>{pressAgainToGoLiveLabel(midiButton)}</Text>
          </View>
        ) : undefined}
        onConfirm={doEnter}
        onCancel={() => setConfirmEnter(false)}
      />
      <ExitPerformanceSheet
        visible={exitOpen}
        pending={pending}
        // Dirty-aware save-ask: when the operator tuned patterns mid-show the
        // sheet summarizes them and offers KEEP & SAVE / KEEP WITHOUT SAVING;
        // a clean session renders the original two-choice sheet.
        dirtyCount={dirtyCount}
        dirtyEntries={dirtyEntries}
        // One physical button can't choose between the exits — a second press
        // only closes this sheet; the hint says the choice is made here.
        controllerHint={midiButton ? exitChoiceControllerHint(midiButton) : null}
        onChoose={doExit}
        onCancel={() => setExitOpen(false)}
      />
    </>
  );
}

function makeStyles(C: Palette) {
  return {
    chip: {
      minHeight: 32,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1,
    },
    chipPortrait: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      minHeight: 28,
    },
    chipIdle: {
      borderColor: PERFORMANCE_AMBER,
      backgroundColor: 'transparent',
    },
    chipActive: {
      borderColor: PERFORMANCE_RED,
      backgroundColor: PERFORMANCE_RED,
    },
    chipText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.5,
    },
    chipTextPortrait: {
      fontSize: 10,
    },
    chipTextIdle: {
      color: PERFORMANCE_AMBER,
    },
    chipTextActive: {
      color: '#FFF',
    },
    // "PRESS SOLO AGAIN TO GO LIVE" row on the enter-confirm sheet — amber
    // outline in the plan-lock family so it reads as a hardware affordance,
    // visually distinct from the on-screen GO LIVE button.
    pressAgainRow: {
      borderWidth: 1,
      borderColor: PERFORMANCE_AMBER,
      backgroundColor: 'rgba(245,166,35,0.08)',
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 14,
      marginBottom: 16,
      alignItems: 'center' as const,
    },
    pressAgainText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.6,
      color: '#8a6a1f',
    },
  };
}
