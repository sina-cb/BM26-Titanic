/**
 * EventSheet — the EVENT rung of the zoom ladder (report _94 §3.1).
 *
 * One sheet, ONE primary action, and the branch is chosen by the ENGINE's own
 * state — is this cue the live deck owner right now (`state.activeCue`)?
 *
 *   LIVE  → 🎚 PERFORM          take the deck; the plan holds
 *   else  → 🕰 TIME TRAVEL HERE  show the ship what this moment looks like
 *
 * Both land in the same place — the DECK tab under a full-width banner — and
 * both exit the same way. One mental model: zooming into an event hands YOU the
 * deck; zooming out hands it back to the plan.
 *
 * The context block is fed by the read-only `GET /timeline/resolve` peek, which
 * has ZERO side effects. Its 400s (out-of-window target, unresolvable cue) are
 * surfaced VERBATIM — the sheet never invents a preview.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { OverviewCue, TimelineResolve } from '@/utils/timelineApi';
import { hhmmTo12h, kindColor, KIND_LABEL, triggerSummary, actionSummary } from './timelineTemplate';
import {
  eventZoomMode, canPerform, ribbonSourceNote,
  type EventZoomMode, type RibbonRow,
} from './zoom_logic';

const GREEN = '#00a86b';
const PURPLE = '#8b5cf6';

export function EventSheet({
  cue, dayDate, activeCueId, planActive, inFestivalWindow,
  resolve, resolveError, resolvePending, busy, actionError, canEdit,
  onPerform, onTravel, onEdit, onClose,
}: {
  /**
   * The event being zoomed into (resolved overview cue). The host mounts this
   * component ONLY while an event is selected — there is no "no event" state to
   * render, and nothing lingers after the sheet is dismissed.
   */
  cue: OverviewCue;
  /** The calendar date (plan tz) of the day this event was tapped on. */
  dayDate: string | null;
  /** The cue the engine says owns the deck right now. */
  activeCueId: string | null;
  planActive: boolean | undefined;
  inFestivalWindow: boolean | undefined;
  /** The read-only resolver peek for this event's instant. */
  resolve: TimelineResolve | null;
  /** The engine's verbatim 400 for the peek, if it failed. */
  resolveError: string | null;
  resolvePending: boolean;
  /** True while a perform/travel request is in flight. */
  busy: boolean;
  /** The engine's verbatim error from the last perform/travel attempt. */
  actionError: string | null;
  canEdit: boolean;
  onPerform: () => void;
  onTravel: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  const mode: EventZoomMode = cue
    ? eventZoomMode({ cueId: cue.id, activeCueId })
    : 'travel';
  const performOffered = cue
    ? canPerform({ mode, planActive, inFestivalWindow })
    : false;

  // The resolver's answer rendered with the SAME vocabulary the day ribbon uses,
  // so "what plays here" reads identically in both places.
  const resolvedNote = useMemo(() => {
    if (!resolve) return null;
    const row = {
      source: resolve.source === 'dormant' ? 'autopilot-baseline' : resolve.source,
    } as RibbonRow;
    return resolve.source === 'dormant'
      ? 'the plan is dormant at this instant'
      : ribbonSourceNote(row);
  }, [resolve]);

  // animationType="none": the sheet is mounted only while an event is selected,
  // so there is nothing to animate OUT, and a fade IN just delays the one
  // decision the operator came here to make.
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* ── Header ── */}
            <View style={styles.header}>
              <View style={[styles.kindDot, { backgroundColor: kindColor(cue.kind, C) }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title} numberOfLines={1}>{cue.label || cue.id}</Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {`${KIND_LABEL[cue.kind]} · ${triggerSummary(cue.trigger)} · ${hhmmTo12h(cue.atLocal, 'no fixed time')}`}
                </Text>
              </View>
              {mode === 'perform' ? (
                <View style={[styles.liveChip, { borderColor: GREEN }]}>
                  <Text style={[styles.liveChipText, { color: GREEN }]}>● LIVE NOW</Text>
                </View>
              ) : null}
            </View>

            {/* ── Context: the plan's own words + the resolver's answer ── */}
            <View style={styles.contextCard}>
              <Text style={styles.contextRow} numberOfLines={2}>
                {`action · ${actionSummary(cue.action)}`}
              </Text>
              {dayDate ? <Text style={styles.contextRow}>{`day · ${dayDate}`}</Text> : null}
              {typeof cue.durationMin === 'number' && cue.durationMin > 0 ? (
                <Text style={styles.contextRow}>{`owns the deck · ${cue.durationMin} min`}</Text>
              ) : (
                <Text style={styles.contextRow}>owns the deck · until the next cue</Text>
              )}
            </View>

            <Text style={styles.sectionLabel}>WHAT PLAYS AT THIS MOMENT</Text>
            {resolvePending ? (
              <Text style={styles.muted}>Resolving…</Text>
            ) : resolveError ? (
              // Codex P0 — the engine's message, verbatim, never softened.
              <Text style={styles.errorText}>{resolveError}</Text>
            ) : resolve ? (
              <View style={styles.contextCard}>
                <Text style={styles.resolveMain} numberOfLines={1}>
                  {`▸ ${resolve.playlist ?? '—'}${resolve.palette ? ` · ${resolve.palette}` : ''}`}
                </Text>
                <Text style={styles.contextRow} numberOfLines={1}>
                  {`owner · ${resolve.owner?.label ?? '—'} (${resolve.owner?.kind ?? 'baseline'})`}
                </Text>
                <Text style={styles.contextRow} numberOfLines={1}>
                  {`${resolve.atLocal} · phase ${resolve.phase ?? '—'} · ${resolve.controller}`}
                </Text>
                {resolvedNote ? (
                  <Text style={[styles.contextRow, resolve.source === 'hold-expired-baseline' && styles.warnText]} numberOfLines={2}>
                    {`${resolve.source === 'hold-expired-baseline' ? '⚠ ' : ''}${resolvedNote}`}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.muted}>No resolver answer.</Text>
            )}

            {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

            {/* ── The one primary action ── */}
            <View style={styles.actionRow}>
              {performOffered ? (
                <TouchableOpacity
                  onPress={onPerform}
                  disabled={busy}
                  style={[styles.bigBtn, { backgroundColor: GREEN }, busy && { opacity: 0.5 }]}
                  accessibilityLabel="Perform this live event — take the deck"
                >
                  <Text style={styles.bigBtnTitle}>🎚 PERFORM</Text>
                  <Text style={styles.bigBtnSub}>take the deck — the plan holds</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={onTravel}
                  disabled={busy}
                  style={[styles.bigBtn, { backgroundColor: PURPLE }, busy && { opacity: 0.5 }]}
                  accessibilityLabel="Time travel to this event"
                >
                  <Text style={styles.bigBtnTitle}>🕰 TIME TRAVEL HERE</Text>
                  <Text style={styles.bigBtnSub}>show the ship what this moment looks like</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* PERFORM is impossible out of the festival window — the engine's
                takeover() refuses to arm there. Say why, rather than offering
                a button that can only 400. */}
            {mode === 'perform' && !performOffered ? (
              <Text style={styles.muted}>
                This event reads as live, but the plan is not driving the rig in-window —
                only time travel is available.
              </Text>
            ) : null}

            <View style={styles.footerRow}>
              {canEdit ? (
                <TouchableOpacity onPress={onEdit} style={styles.ghostBtn} accessibilityLabel="Edit this cue">
                  <Text style={styles.ghostBtnText}>✎ EDIT CUE</Text>
                </TouchableOpacity>
              ) : null}
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={onClose} style={styles.ghostBtn} accessibilityLabel="Close">
                <Text style={styles.ghostBtnText}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(C: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    sheet: {
      width: '100%',
      maxWidth: 560,
      maxHeight: '86%',
      backgroundColor: C.surfaceContainerLow,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 22,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
    kindDot: { width: 12, height: 12, borderRadius: 6 },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 17, color: C.text, letterSpacing: 0.4,
    },
    subtitle: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: C.secondary, marginTop: 3 },
    liveChip: {
      borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    },
    liveChipText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.8 },
    contextCard: {
      borderRadius: 10, borderWidth: 1, borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerLowest, padding: 12, gap: 3,
    },
    contextRow: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary },
    resolveMain: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.primary },
    warnText: { color: '#f5a623' },
    sectionLabel: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9.5, letterSpacing: 1.3,
      color: C.secondary, textTransform: 'uppercase', marginTop: 14, marginBottom: 6,
    },
    muted: { fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary, marginTop: 6 },
    errorText: {
      fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.error,
      borderWidth: 1, borderColor: C.errorContainerBorder, backgroundColor: C.errorContainer,
      borderRadius: 8, padding: 10, marginTop: 8,
    },
    actionRow: { marginTop: 16 },
    bigBtn: {
      borderRadius: 14, paddingVertical: 16, paddingHorizontal: 18,
      alignItems: 'center', justifyContent: 'center', minHeight: 72,
    },
    bigBtnTitle: {
      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, letterSpacing: 1, color: '#FFFFFF',
    },
    bigBtnSub: {
      fontFamily: 'Inter_400Regular', fontSize: 11.5, color: 'rgba(255,255,255,0.88)', marginTop: 4,
    },
    footerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
    ghostBtn: {
      paddingHorizontal: 14, paddingVertical: 10, minHeight: 44,
      borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
      alignItems: 'center', justifyContent: 'center',
    },
    ghostBtnText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11.5, letterSpacing: 0.6, color: C.text },
  });
}
