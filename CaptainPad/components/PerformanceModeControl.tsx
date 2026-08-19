import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { opError, opWarn } from '@/utils/op_dialog';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { ExitPerformanceSheet } from '@/components/ExitPerformanceSheet';
import { PrivilegedAuthSheet } from '@/components/privileged_auth_sheet';
import {
  usePerformanceMode,
  usePerformanceModeReady,
  subscribePerformanceDialogSummon,
  refreshPerformanceMode,
  applyPerformanceModeResponse,
  setLocalPerformanceView,
} from '@/hooks/usePerformanceMode';
import { usePerformanceDialogButton } from '@/hooks/useMidiControl';
import { useCaptainPadAccess } from '@/hooks/use_captainpad_access';
import { setPerformanceMode, type PerformanceExitAction } from '@/utils/api';
import type { OperatorAuthSendInput } from '@/utils/takeover_passcode';
import { performanceExitFailureMessage } from '@/utils/edit_session';
import {
  performanceEditRoute,
  performancePrimaryAction,
} from '@/utils/captainpad_access_logic';
import {
  ENTER_CONFIRM_TITLE,
  ENTER_CONFIRM_MESSAGE,
  ENTER_CONFIRM_LABEL,
  ENGINE_OFFLINE_BADGE,
  LOCAL_VIEW_BADGE,
  localViewChipAccessibilityLabel,
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
// ONE app-wide control mounted in the sidebar. Idle: an amber PERFORMANCE chip
// enters the engine-global lock. Active unauthenticated devices show EDIT and
// authenticate locally; privileged devices get separate LOCK THIS DEVICE and
// END GLOBAL actions so one iPad never silently unlocks another.
//
// NO optimistic flip: the engine's accepted POST response (and then its normal
// REST/WS reconciliation) is authoritative. The control never changes mode
// from an unacknowledged tap.
//
// APC SOLO summon: the APC mini's SOLO pad drives the SAME guarded flows as a
// tap on this control — it summons the state-appropriate sheet via the
// performance-dialog summon bus (subscribePerformanceDialogSummon). Only ONE
// mounted control claims the summon (the bus notifies the first subscriber).
// Press semantics live
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
  // `active` is the EFFECTIVE face (override-aware while the engine is down);
  // `localOverride` / `engineOffline` drive the offline affordance below.
  const {
    active, dirtyCount, dirtyEntries, authRequired, localOverride, engineOffline,
  } = usePerformanceMode();
  const performanceModeReady = usePerformanceModeReady();
  const { session, loading: accessLoading, authenticate, lock } = useCaptainPadAccess();
  const privileged = !!session && !accessLoading;
  // "SOLO" when an APC (or any profile binding performanceDialog) is
  // CONNECTED; null otherwise → the sheets render without controller copy.
  const midiButton = usePerformanceDialogButton();

  const [confirmEnter, setConfirmEnter] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [lockPending, setLockPending] = useState(false);
  // The engine's refusal for the last exit attempt (docs/56 D2/D7): a bad
  // passcode, a rate-limit lockout, or a sailor picking KEEP & SAVE. Rendered
  // in the exit sheet's own error box so the sheet stays open and the operator
  // can retry without losing the dirty summary they were reading.
  const [exitError, setExitError] = useState<string | null>(null);
  const engineBusy = pending || authPending || lockPending || accessLoading || !performanceModeReady;
  // OFFLINE (report `_250`): the chip drives a purely LOCAL view toggle — no
  // request is in flight and there is no engine answer to wait for, so it must
  // never sit spinning and disabled. That spinner-forever state (readiness is
  // false while the bus is down) WAS the stuck locked face the operator hit.
  const busy = engineOffline ? false : engineBusy;

  // Opening the exit sheet pulls the freshest dirty summary (the engine only
  // broadcasts performanceMode on enter/exit, so tuning done mid-show isn't
  // pushed until we ask). Reused by the tap handler AND the APC-summon path so
  // both open with an accurate save-ask.
  const openExitSheet = () => {
    // docs/56 D2: the exit sheet itself owns any required passcode. An
    // auth-disabled development engine renders the same choices with no
    // passcode field; it has no privileged-login endpoint to call first.
    refreshPerformanceMode();
    setExitError(null);
    setExitOpen(true);
  };
  const openExitSheetRef = useRef(openExitSheet);
  openExitSheetRef.current = openExitSheet;

  // Refs mirror the state for the summon handler (registered once).
  const stateRef = useRef({
    active, privileged, authRequired, confirmEnter, exitOpen, authOpen,
    pending: busy, engineOffline,
  });
  stateRef.current = {
    active, privileged, authRequired, confirmEnter, exitOpen, authOpen,
    pending: busy, engineOffline,
  };

  // The OFFLINE mode switch (report `_250`). Local presentation only: no
  // request, no passcode, nothing persisted, discarded on reconnect — the
  // whole contract lives in setLocalPerformanceView / resolveLocalViewOverride.
  const toggleLocalView = () => { setLocalPerformanceView(!stateRef.current.active); };
  const toggleLocalViewRef = useRef(toggleLocalView);
  toggleLocalViewRef.current = toggleLocalView;

  // A connection drop while a sheet is open would leave an engine dialog on
  // screen that can only POST into the void. Close them (and clear their
  // errors) the moment the bus goes down, so the offline chip is the ONLY
  // mode affordance while the engine is unreachable.
  useEffect(() => {
    if (!engineOffline) return;
    setConfirmEnter(false);
    setExitOpen(false);
    setAuthOpen(false);
    setAuthError(null);
    setExitError(null);
  }, [engineOffline]);

  // An engine restart can change the authoritative auth capability while this
  // sheet is open. Never leave a stale passphrase prompt over an auth-disabled
  // development session.
  useEffect(() => {
    if (authRequired || !authOpen) return;
    setAuthOpen(false);
    setAuthError(null);
  }, [authRequired, authOpen]);

  const doEnter = async () => {
    setConfirmEnter(false);
    setPending(true);
    try {
      const result = await setPerformanceMode({ active: true });
      if (!result.ok || !applyPerformanceModeResponse(result.data)) {
        opError('Performance mode failed', result.error || 'The engine rejected the request.');
      } else {
        // The response carries active/enteredAt. Re-seed for the complete
        // dirty summary even if this browser missed the control-bus broadcast.
        refreshPerformanceMode();
      }
    } catch {
      opError('Performance mode failed', 'The engine did not accept the request.');
    } finally {
      setPending(false);
    }
  };
  const doEnterRef = useRef(doEnter);
  doEnterRef.current = doEnter;

  useEffect(() => {
    // Claimed by the FIRST mounted control (bus notifies one subscriber).
    // Press semantics = performanceSummonOutcome (pure, vitest-pinned):
    // second press on the ENTER sheet CONFIRMS; on the EXIT sheet it closes.
    return subscribePerformanceDialogSummon(() => {
      const s = stateRef.current;
      // OFFLINE (report `_250`): every sheet this bus can open ends in a POST,
      // so with the engine unreachable the physical button does the same thing
      // the chip does — flip THIS pad's local view.
      if (s.engineOffline) {
        toggleLocalViewRef.current();
        return;
      }
      if (s.active && !s.privileged) {
        if (performanceEditRoute(s.authRequired, true) === 'exit-sheet') {
          openExitSheetRef.current();
          return;
        }
        if (s.authOpen) setAuthOpen(false);
        else {
          setAuthError(null);
          setAuthOpen(true);
        }
        return;
      }
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

  // The passcode arrives from the sheet on the SAME call as the choice, rides
  // this one request's header, and is never stored anywhere (docs/56 D2).
  //
  // EVERY outcome resolves visibly (report `_236`). This handler used to route
  // any failure outside the four edit-session codes to `Alert.alert` — a literal
  // no-op stub on react-native-web — so a 400 / 423 / 500 / timeout left the
  // sheet sitting open with no message and no mode change: the operator's "the
  // buttons aren't making progress anymore". There is no longer a branch that
  // can end without a sentence:
  //   • accepted  → the sheet closes and the engine state re-seeds;
  //   • refused   → performanceExitFailureMessage() ALWAYS yields copy, and it
  //                 lands in the sheet's own error box (persistent, and where
  //                 the operator is already looking) rather than a toast that
  //                 self-dismisses mid-cue;
  //   • threw     → the same box, naming the connection.
  // The sheet deliberately stays OPEN on a refusal so the dirty summary and the
  // retry are still in front of the operator.
  const doExit = async (action: PerformanceExitAction, auth: OperatorAuthSendInput) => {
    setPending(true);
    setExitError(null);
    try {
      const result = await setPerformanceMode(
        { active: false, exitAction: action },
        auth,
      );
      if (result.ok && applyPerformanceModeResponse(result.data)) {
        setExitOpen(false);
        refreshPerformanceMode();
        return;
      }
      // A 200 whose body this pad cannot read is a REFUSAL as far as the
      // operator is concerned: we did not change mode, so say so.
      setExitError(performanceExitFailureMessage(
        result.ok ? { ok: false, code: 'INVALID_BODY' } : result,
      ));
      // Re-seed: the engine may have moved even though this attempt failed
      // (another pad exited first), and the sheet's copy tells the operator so.
      refreshPerformanceMode();
    } catch {
      setExitError(performanceExitFailureMessage({ ok: false }));
    } finally {
      setPending(false);
    }
  };

  const openAuthentication = () => {
    setAuthError(null);
    setAuthOpen(true);
  };

  const doAuthenticate = async (passphrase: string, remember30: boolean) => {
    setAuthPending(true);
    setAuthError(null);
    try {
      await authenticate(passphrase, remember30);
      setAuthOpen(false);
      refreshPerformanceMode();
      setExitOpen(true);
    } catch (error) {
      setAuthError(error instanceof Error
        ? error.message
        : 'Edit authentication could not be completed. Check the engine connection and try again.');
    } finally {
      setAuthPending(false);
    }
  };

  const doLocalLock = async () => {
    setLockPending(true);
    try {
      await lock();
    } catch {
      opWarn(
        'Locked locally',
        'This CaptainPad is locked for this session, but the engine token or remembered access could not be fully cleared. Retry LOCK before reloading this device.',
      );
    } finally {
      setLockPending(false);
    }
  };

  return (
    <>
      <View style={styles.controlGroup}>
        <TouchableOpacity
          style={[
            styles.chip,
            active ? (privileged ? styles.chipPrivileged : styles.chipActive) : styles.chipIdle,
            isPortrait && styles.chipPortrait,
          ]}
          onPress={() => {
            // OFFLINE: a purely local view flip (report `_250`). No passcode
            // is asked for because nothing can be verified without the engine
            // and nothing engine-side can be affected — every real gate
            // (docs/56 D2/D3/D6) is enforced per request, engine-side.
            if (engineOffline) { toggleLocalView(); return; }
            switch (performancePrimaryAction(active, privileged)) {
              case 'enter-global':
                setConfirmEnter(true);
                return;
              case 'authenticate':
                if (performanceEditRoute(authRequired, false) === 'exit-sheet') {
                  openExitSheet();
                  return;
                }
                openAuthentication();
                return;
              case 'local-lock':
                void doLocalLock();
                return;
            }
          }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={engineOffline
            ? localViewChipAccessibilityLabel(active)
            : (active
              ? (privileged
                ? 'Lock this CaptainPad in Performance view'
                : (authRequired
                  ? 'Leave performance mode — an operator passcode is required'
                    : 'Leave performance mode — no passcode is required'))
              : 'Enter performance mode')}
          accessibilityState={{ disabled: busy }}
        >
          {busy ? (
            <ActivityIndicator size="small" color={active && !privileged ? '#FFF' : PERFORMANCE_AMBER} />
          ) : (
            <Text
              style={[
                styles.chipText,
                active && !privileged ? styles.chipTextActive : styles.chipTextIdle,
                active && privileged && styles.chipTextPrivileged,
                isPortrait && styles.chipTextPortrait,
              ]}
              numberOfLines={1}
            >
              {/* Offline the chip always names the view you switch TO. LOCK
                  (a device-local lock for a privileged pad) is suppressed:
                  with the engine down the one thing this chip must offer is
                  the way back to CONFIG. */}
              {active
                ? ((privileged && !engineOffline) ? 'LOCK' : performanceModeLabel(true))
                : (isPortrait ? 'PERF' : performanceModeLabel(false))}
            </Text>
          )}
        </TouchableOpacity>
        {/* END GLOBAL posts to the engine — hidden while it is unreachable. */}
        {active && privileged && !engineOffline ? (
          <TouchableOpacity
            style={styles.endGlobalButton}
            onPress={openExitSheet}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="End global Performance mode"
            accessibilityState={{ disabled: busy }}
          >
            <Text style={styles.endGlobalText}>END GLOBAL</Text>
          </TouchableOpacity>
        ) : null}
        {/* The standing offline caption. Two lines so they read together as
            "ENGINE OFFLINE — LOCAL VIEW" once a local view is taken, and so
            the first line alone is honest before the operator taps. */}
        {engineOffline ? (
          <View style={styles.offlineNote} accessibilityRole="text">
            <Text style={styles.offlineNoteText} numberOfLines={1}>{ENGINE_OFFLINE_BADGE}</Text>
            {localOverride ? (
              <Text style={styles.offlineNoteStrong} numberOfLines={1}>{LOCAL_VIEW_BADGE}</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* All three sheets end in an engine request, so none of them may be on
          screen while the engine is unreachable (report `_250`). The `visible`
          guards cover the frame the bus drops on; the effect above clears the
          state so nothing pops back up on reconnect. */}
      <ConfirmSheet
        visible={confirmEnter && !engineOffline}
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
        visible={exitOpen && !engineOffline}
        pending={pending}
        // Dirty-aware save-ask: when the operator tuned patterns mid-show the
        // sheet summarizes them and offers DISCARD vs SAVE CHANGES; a clean
        // session renders the same two-choice sheet with different hints.
        dirtyCount={dirtyCount}
        dirtyEntries={dirtyEntries}
        // One physical button can't choose between the exits — a second press
        // only closes this sheet; the hint says the choice is made here.
        controllerHint={midiButton ? exitChoiceControllerHint(midiButton) : null}
        passcodeRequired={authRequired}
        error={exitError}
        onChoose={doExit}
        onCancel={() => { setExitOpen(false); setExitError(null); }}
      />
      <PrivilegedAuthSheet
        visible={authOpen && !engineOffline}
        pending={authPending}
        error={authError}
        onSubmit={(passphrase, remember30) => { void doAuthenticate(passphrase, remember30); }}
        onCancel={() => {
          setAuthOpen(false);
          setAuthError(null);
        }}
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
      width: '100%' as const,
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
    chipPrivileged: {
      borderColor: C.tertiary,
      backgroundColor: C.surfaceContainerHigh,
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
    chipTextPrivileged: {
      color: C.tertiary,
    },
    controlGroup: {
      width: '100%' as const,
      alignItems: 'stretch' as const,
      gap: 6,
    },
    endGlobalButton: {
      minHeight: 32,
      width: '100%' as const,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: PERFORMANCE_RED,
      backgroundColor: 'transparent',
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: 6,
    },
    endGlobalText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 9,
      letterSpacing: 0.3,
      color: PERFORMANCE_RED,
    },
    // OFFLINE caption under the chip (report `_250`). Deliberately quiet — it
    // is a standing statement of fact, not an alarm; the header already owns
    // the connection pill. Amber (the plan-lock family) marks the LOCAL VIEW
    // line so "what you see is this iPad's own choice" reads at a glance.
    offlineNote: {
      alignItems: 'center' as const,
      gap: 1,
    },
    offlineNoteText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 8,
      letterSpacing: 0.2,
      color: C.secondary,
    },
    offlineNoteStrong: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 8,
      letterSpacing: 0.2,
      color: PERFORMANCE_AMBER,
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
