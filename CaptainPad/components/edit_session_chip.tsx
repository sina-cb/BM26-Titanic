// EditSessionChip — the persistent amber "this session is NOT being saved"
// badge, mounted in the sidebar beside PerformanceModeControl (docs/56 D8).
//
// WHY IT EXISTS. Since docs/56 the engine decides persistence by IDENTITY, not
// just by mode: the principal who typed a passcode to leave performance mode
// owns the edit session, and only the captain's session may write rig state to
// disk. A sailor can drive every fader and param live — that is deliberate —
// but nothing they do reaches a file. That is a big, invisible difference, and
// the codex forbids quiet behaviour changes. This chip is how it stays loud.
//
// LOUD, NOT SPAMMY. It renders NOTHING in the three cases where nothing needs
// saying (owner session, show lock on, auth-disabled bench) — see
// editSessionChip() in performance_mode_logic.ts, which owns that decision and
// the copy so vitest can pin both. Normal is silent; a chip on every ordinary
// edit would train the eye to ignore it.
//
// TAPPING IT ESCALATES. The chip opens the same passcode idiom the timeline
// takeover uses (TakeoverPasscodeSheet — one useState, wiped on submit and on
// close, no remember affordance, nothing stored; storage audit in
// utils/takeover_passcode.ts). It deliberately is NOT PrivilegedAuthSheet,
// which mints the 30-minute session this whole flow is built to ignore.
// The sheet's copy states the consequence plainly: asserting the captain's
// code starts auto-saving the CURRENT live tuning, including whatever the
// sailor changed earlier in this session (docs/56 D4).
//
// The engine is the enforcement layer. This component only tells the truth
// about what the engine is doing; hiding it would not stop a single write.

import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { TakeoverPasscodeSheet } from '@/components/takeover_passcode_sheet';
import {
  ESCALATE_SHEET_DETAIL,
  ESCALATE_SHEET_TITLE,
  editSessionChip,
} from '@/components/performance_mode_logic';
import { Radius, Type, type Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import {
  refreshPerformanceMode,
  usePerformanceMode,
  usePerformanceModeReady,
} from '@/hooks/usePerformanceMode';
import { assertEditSession } from '@/utils/api';
import { editSessionRefusalMessage } from '@/utils/edit_session';

export function EditSessionChip() {
  const { active, editPrincipal, authRequired } = usePerformanceMode();
  const ready = usePerformanceModeReady();
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Until the engine has answered, say nothing — the same default-quiet posture
  // DEFAULT_PERFORMANCE_MODE takes. A warning we cannot yet justify is noise.
  const chip = ready ? editSessionChip(editPrincipal, active, authRequired) : null;

  const submit = async (passcode: string) => {
    setPending(true);
    setError(null);
    try {
      const result = await assertEditSession(passcode);
      if (result.ok) {
        setSheetOpen(false);
        // The POST response is authoritative, but re-seed so the dirty summary
        // and every other field land together (same posture as the exit flow).
        refreshPerformanceMode();
      } else {
        setError(editSessionRefusalMessage(result));
      }
    } catch {
      setError('The engine did not accept the request. Check the connection and try again.');
    } finally {
      setPending(false);
    }
  };

  if (!chip) return null;

  return (
    <View>
      <Pressable
        onPress={() => { setError(null); setSheetOpen(true); }}
        style={styles.chip}
        accessibilityRole="button"
        accessibilityLabel={`${chip.label}. ${chip.detail}`}
      >
        {/* The chip lives in the 80pt sidebar column, so the label wraps to
            four or five short lines. It must NEVER truncate: "NOT SAVING" is
            the half that matters, and clipping it would leave a warning that
            says only "SAILOR SESSION — LIVE…". */}
        <Text style={styles.label} numberOfLines={6}>{'⚠'} {chip.label}</Text>
      </Pressable>
      <TakeoverPasscodeSheet
        visible={sheetOpen}
        pending={pending}
        error={error}
        title={ESCALATE_SHEET_TITLE}
        detail={ESCALATE_SHEET_DETAIL}
        submitLabel="START SAVING"
        footnote="Verified every time — this passcode is never stored on this CaptainPad."
        onSubmit={submit}
        onCancel={() => { setSheetOpen(false); setError(null); }}
      />
    </View>
  );
}

function makeStyles(C: Palette) {
  return {
    chip: {
      // Comfortably over the 44pt touch floor even in the 80pt sidebar column,
      // where the label wraps to two or three lines.
      minHeight: 44,
      paddingHorizontal: 6,
      paddingVertical: 6,
      borderRadius: Radius.control,
      borderWidth: 1,
      backgroundColor: C.warningContainer,
      borderColor: C.warningContainerBorder,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    label: {
      ...Type.labelCaps,
      textTransform: Type.labelCaps.textTransform as 'uppercase',
      fontSize: 8,
      lineHeight: 10,
      letterSpacing: 0.2,
      textAlign: 'center' as const,
      color: C.warning,
    },
  };
}
