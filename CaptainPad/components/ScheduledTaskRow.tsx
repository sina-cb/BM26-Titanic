/**
 * ScheduledTaskRow — single row in the Scheduler tab.
 *
 * Visual density matches the deck's autopilot card / mixer transitionBar:
 * a surfaceContainerHigh-backed cell with 8px horizontal padding and 6px
 * vertical padding per row, gap 6. Three rows: control header, ON
 * DURATION pill bar, INTERVAL pill bar. No spacing values outside the
 * 4/8/12/16 grid.
 *
 * Status pill mirrors the autopilot row's PLAY / SHUFFLE chips: a small
 * cap-label that flips colour + content based on `task.status`:
 *   - 'armed'    → "NEXT 47s" (icon: secondary)
 *   - 'firing'   → "FIRING — 4s" (primary)
 *   - 'disabled' → "DISABLED" (icon)
 *   - 'error'    → "ERROR: <message>" (error)
 *
 * Countdowns are computed from server-provided `nextFireAtMs` and
 * `firingUntilMs` against `nowMs` (passed in from the tab — ONE
 * setInterval(250 ms) re-renders the whole list, not one per row).
 *
 * Mutations are optimistic: the parent invokes the relevant
 * `applyOptimisticTask*` helper alongside the PATCH so the operator
 * sees instant feedback. The WS broadcast / PATCH response reconciles.
 *
 * All taps go through 44pt touch targets (operator is in the dark).
 */
import React, { useMemo } from 'react';
import { Palette } from '@/constants/theme';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { TimerPillBar } from '@/components/DeckTransitionControls';
import { ScheduledTask } from '@/utils/api';

interface Props {
  task: ScheduledTask;
  // Behavior of the bound effect/preset. Drives whether ON DURATION
  // is rendered: trigger/burst effects self-terminate, so the duration
  // is meaningless (no OFF dispatch; the row just flips back to armed
  // immediately on the next tick). null = library not loaded yet OR
  // effect missing from library; we render conservatively (show
  // duration, the engine will surface any real mismatch via lastError).
  behavior: string | null;
  onDurationPresets: number[];
  intervalPresets: number[];
  nowMs: number;
  onToggleEnabled: (task: ScheduledTask) => void;
  onPickLibrary: (task: ScheduledTask) => void;
  onChangeOnDuration: (task: ScheduledTask, ms: number) => void;
  onChangeInterval: (task: ScheduledTask, ms: number) => void;
  onFireNow: (task: ScheduledTask) => void;
  onStop: (task: ScheduledTask) => void;
  onDelete: (task: ScheduledTask) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m${r}s`;
}

function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return '0s';
  const s = Math.ceil(remainingMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m${r}s`;
}

// Derive the row's label from the binding. Server defaults to
// "<effectId> / <presetId>" (docs/31 §"Defaults") — we honour that
// shape so a freshly-created row reads naturally even before the
// operator picks a different effect via the library modal.
function deriveLabel(task: ScheduledTask): string {
  if (task.label && task.label.trim().length > 0) return task.label;
  return `${task.effectId} / ${task.presetId}`;
}

export const ScheduledTaskRow: React.FC<Props> = React.memo(({
  task,
  behavior,
  onDurationPresets,
  intervalPresets,
  nowMs,
  onToggleEnabled,
  onPickLibrary,
  onChangeOnDuration,
  onChangeInterval,
  onFireNow,
  onStop,
  onDelete,
}) => {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const isSelfTerminating = behavior === 'trigger' || behavior === 'burst';
  const label = deriveLabel(task);

  // Status pill content + colour. Derived from server-authoritative
  // status + countdown deltas; the 250 ms tick from the parent tab
  // is what advances the displayed seconds.
  const status = useMemo(() => {
    if (task.status === 'error') {
      return {
        text: task.lastError ? `ERROR: ${task.lastError}` : 'ERROR',
        color: C.error,
      };
    }
    if (task.status === 'disabled' || !task.enabled) {
      return { text: 'DISABLED', color: C.icon };
    }
    if (task.status === 'firing' && task.firingUntilMs != null) {
      const remain = task.firingUntilMs - nowMs;
      return {
        text: `FIRING — ${formatCountdown(remain)} LEFT`,
        color: C.primary,
      };
    }
    if (task.nextFireAtMs != null) {
      const remain = task.nextFireAtMs - nowMs;
      return {
        text: `NEXT ${formatCountdown(remain)}`,
        color: C.secondary,
      };
    }
    return { text: 'ARMED', color: C.secondary };
  }, [task.status, task.enabled, task.firingUntilMs, task.nextFireAtMs, task.lastError, nowMs]);

  const isFiring = task.status === 'firing';

  return (
    <View style={styles.card}>
      {/* Row 1: enable | label | library picker | status | fire/stop | trash */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => onToggleEnabled(task)}
          accessibilityRole="switch"
          accessibilityLabel={task.enabled ? `Disable ${label}` : `Enable ${label}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[
            styles.enableButton,
            task.enabled ? styles.enableButtonOn : styles.enableButtonOff,
          ]}
        >
          <IconSymbol
            name={task.enabled ? 'checkmark.circle.fill' : 'circle'}
            size={18}
            color={task.enabled ? '#FFF' : C.icon}
          />
        </TouchableOpacity>

        {/* Library picker chip — tap → modal. Visual recipe matches the
            TransitionStylePicker chip (primary border + chevron). */}
        <TouchableOpacity
          onPress={() => onPickLibrary(task)}
          accessibilityRole="button"
          accessibilityLabel={`Pick effect, current ${label}`}
          style={styles.libraryChip}
        >
          <Text style={styles.libraryChipLabel} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.libraryChipChevron}>▾</Text>
        </TouchableOpacity>

        {/* Status pill — colour-coded per server status */}
        <View style={styles.statusPill}>
          <Text
            style={[styles.statusText, { color: status.color }]}
            numberOfLines={1}
          >
            {status.text}
          </Text>
        </View>

        {/* FIRE NOW / STOP — single icon button that flips. Stop is
            offered while firing (matches `stop` endpoint contract:
            force-closes the in-flight ON window). */}
        <TouchableOpacity
          onPress={() => (isFiring ? onStop(task) : onFireNow(task))}
          accessibilityRole="button"
          accessibilityLabel={isFiring ? `Stop ${label}` : `Fire ${label} now`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[
            styles.iconButton,
            isFiring ? styles.iconButtonFiring : styles.iconButtonNeutral,
          ]}
        >
          <IconSymbol
            name={isFiring ? 'stop.fill' : 'play.fill'}
            size={16}
            color={isFiring ? '#FFF' : C.primary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => onDelete(task)}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${label}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[styles.iconButton, styles.iconButtonDelete]}
        >
          <IconSymbol name="trash" size={16} color={C.error} />
        </TouchableOpacity>
      </View>

      {/* Row 2: ON DURATION pill bar — hidden for trigger/burst
          effects, which self-terminate (no OFF dispatch; the duration
          would only affect the UI countdown, which is misleading). */}
      {!isSelfTerminating && (
        <TimerPillBar
          label={`ON DURATION  (${formatDuration(task.onDurationMs)})`}
          presets={onDurationPresets}
          value={task.onDurationMs}
          onChange={(v) => onChangeOnDuration(task, v)}
          formatter={formatDuration}
          compact
        />
      )}

      {/* Row 3: INTERVAL pill bar */}
      <TimerPillBar
        label={`INTERVAL  (${formatDuration(task.intervalMs)})`}
        presets={intervalPresets}
        value={task.intervalMs}
        onChange={(v) => onChangeInterval(task, v)}
        formatter={formatDuration}
        compact
      />
    </View>
  );
});

ScheduledTaskRow.displayName = 'ScheduledTaskRow';


function makeStyles(C: Palette) {
  return StyleSheet.create({
  card: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    borderRadius: 8,
    gap: 8,
    backgroundColor: C.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
  },
  enableButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enableButtonOn: {
    backgroundColor: C.primary,
    borderColor: 'transparent',
  },
  enableButtonOff: {
    backgroundColor: 'transparent',
    borderColor: C.ghostBorder,
  },
  libraryChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.primary,
    backgroundColor: 'rgba(0, 104, 117, 0.08)',
    minHeight: 44,
  },
  libraryChipLabel: {
    flex: 1,
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 12,
    color: C.primary,
    letterSpacing: 0.5,
  },
  libraryChipChevron: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 12,
    color: C.primary,
  },
  statusPill: {
    minWidth: 96,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  statusText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconButtonNeutral: {
    backgroundColor: 'transparent',
    borderColor: C.primary,
  },
  iconButtonFiring: {
    backgroundColor: C.primary,
    borderColor: 'transparent',
  },
  iconButtonDelete: {
    backgroundColor: 'transparent',
    borderColor: C.ghostBorder,
  },
});
}
