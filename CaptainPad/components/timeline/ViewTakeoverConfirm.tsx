// ── ViewTakeoverConfirm ─────────────────────────────────────────────────
// CP-VIEWSWITCH confirm overlay. When a plan is active AND forcing the output
// to the DECK (`forcingDeckView`), and the operator manually switches the view
// to the MIXER tab, we do NOT silently steal the output from the running plan.
// Instead we ask: "A plan is driving the DECK. Take over and switch to the
// mixer?" — with an explicit TAKE OVER vs STAY ON PLAN choice and a visible
// 1-minute countdown.
//
// Operator's exact intent (the answer to "what should happen when the operator
// switches to mixer while the plan forces the deck?"): "ask a question to
// switch, if not answered within 1m switch to deck." So:
//   • TAKE OVER  → switch output to mixer + engage the operator lease.
//   • STAY ON PLAN / Cancel / 1:00 elapsed with no answer → revert to the deck
//     output and navigate back to the DECK tab; the plan keeps running.
//
// This component is PURELY presentational — it owns no timer and no engine
// calls. The mixer screen owns the 60s timer and the TAKE OVER / STAY actions
// (so the timer is cleared deterministically on unmount / on any answer). We
// only render the countdown the parent feeds us and report the operator's tap.
//
// Why an in-app Modal and not Alert.alert: CaptainPad ships a web build and
// RN-web drops Alert.alert button callbacks (same note as ConfirmSheet /
// PlaylistPanel's modals), so the buttons would never resolve on the podium's
// web client. The backdrop pattern mirrors ConfirmSheet: the outer
// TouchableOpacity is a CANCEL (= STAY ON PLAN), the inner swallows taps so the
// card stays opaque to dismissal.
//
// Codex P0 — NO fallback behaviors: onTakeOver / onStay are invoked verbatim;
// this component never swallows or substitutes the caller's action.

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';

// Timeline accent (cyan) — matches PlanIndicatorPill's "plan is live" tile so
// the confirm reads as part of the same timeline-takeover system.
const PLAN_CYAN = '#22c1d6';

// Buttons render ≥44pt (see `btn` style) but an 8pt hitSlop guarantees the
// interactive zone clears 44pt and gives margin for error on a moving show
// surface — same posture as ConfirmSheet.
const BTN_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

// "M:SS" — clamps at 0:00, never negative.
function formatMSS(sec: number): string {
  const total = Number.isFinite(sec) ? Math.max(0, Math.round(sec)) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface ViewTakeoverConfirmProps {
  visible: boolean;
  /** Seconds remaining before the auto-return-to-deck fires. Drives the
   *  "auto-returns to deck in M:SS" countdown. */
  remainingSec: number;
  /** Operator chose TAKE OVER → switch output to mixer + engage the lease. */
  onTakeOver: () => void;
  /** Operator chose STAY ON PLAN / Cancel / backdrop / hardware-back → revert
   *  to the deck and navigate back. Same action the 1:00 timeout fires. */
  onStay: () => void;
}

export const ViewTakeoverConfirm: React.FC<ViewTakeoverConfirmProps> = ({
  visible,
  remainingSec,
  onTakeOver,
  onStay,
}) => {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onStay}>
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onStay}
        accessibilityLabel="Stay on plan"
      >
        {/* Inner wrapper swallows taps so the card stays open. */}
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
            <View style={styles.titleRow}>
              <IconSymbol name="exclamationmark.triangle.fill" size={18} color={PLAN_CYAN} />
              <Text style={styles.title}>Plan is driving the deck</Text>
            </View>
            <Text style={styles.message}>
              A plan is driving the DECK. Take over and switch to the mixer?
            </Text>
            <Text style={styles.countdown}>
              {`Auto-returns to deck in ${formatMSS(remainingSec)}`}
            </Text>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={onStay}
                hitSlop={BTN_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Stay on plan — return to the deck"
              >
                <Text style={[styles.btnText, { color: C.text }]}>STAY ON PLAN</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.confirmBtn]}
                onPress={onTakeOver}
                hitSlop={BTN_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel="Take over and switch to the mixer"
              >
                <Text style={[styles.btnText, { color: '#FFF' }]}>TAKE OVER</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

function makeStyles(C: Palette) {
  return {
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    card: {
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: 16,
      padding: 24,
      minWidth: 320,
      maxWidth: 440,
      borderWidth: 1,
      borderColor: PLAN_CYAN,
    },
    titleRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      marginBottom: 10,
    },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      letterSpacing: 0.5,
      color: C.text,
      textTransform: 'uppercase' as const,
    },
    message: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 20,
      color: C.secondary,
      marginBottom: 12,
    },
    countdown: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.5,
      color: PLAN_CYAN,
      textTransform: 'uppercase' as const,
      marginBottom: 20,
    },
    btnRow: {
      flexDirection: 'row' as const,
      justifyContent: 'flex-end' as const,
      gap: 10,
    },
    // 44pt minimum touch target per the production-console safety bar.
    btn: {
      minHeight: 44,
      minWidth: 96,
      paddingHorizontal: 18,
      borderRadius: 10,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    cancelBtn: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
    },
    confirmBtn: {
      backgroundColor: PLAN_CYAN,
    },
    btnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.5,
    },
  };
}
