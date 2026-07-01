/**
 * DayEditor — full-screen modal for the selected festival day (docs/38 §15.3).
 *
 * Shows that day's vertical timeline: sun events + the day's cues, time-
 * ordered. Each cue row → tap to edit (opens CueEditorSheet), trash to
 * delete. A ＋ adds a cue seeded to "this day". The day's resolved cue
 * times come from the live overview (server truth); edits mutate the DRAFT
 * plan and the parent re-previews (debounced) so the strip + this list
 * reflect the change.
 *
 * This component is presentational over (overviewDay, draftPlan): it reads
 * resolved times from overviewDay and the editable cue objects from the
 * draft. The actual cue CRUD lives in the parent (timeline.tsx) so the
 * single debounced preview loop stays there.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { OverviewDay, PlanCue, ShowPlan } from '@/utils/timelineApi';
import {
  hhmmToMinutes, hhmmTo12h, minutesTo12h, kindColor, KIND_LABEL, triggerSummary, actionSummary,
} from './timelineTemplate';

interface SunRow {
  sortMins: number;
  time: string;
  label: string;
}

const SUN_ROW_DEFS: { key: string; label: string }[] = [
  { key: 'sunrise', label: 'Sunrise' },
  { key: 'goldenHourEnd', label: 'Golden hour end' },
  { key: 'solarNoon', label: 'Solar noon' },
  { key: 'goldenHourStart', label: 'Golden hour' },
  { key: 'sunset', label: 'Sunset' },
  { key: 'civilDusk', label: 'Civil dusk' },
];

export function DayEditor({
  visible, day, plan, nowMinutes, onAddCue, onEditCue, onDeleteCue, onClose,
}: {
  visible: boolean;
  /** Overview for the selected day (resolved sun + cue times). null while loading. */
  day: OverviewDay | null;
  /** Draft plan (source of editable cue objects). */
  plan: ShowPlan;
  /**
   * Minutes-of-day for the live NOW playhead, in the plan tz — non-null ONLY
   * when this editor is showing TODAY. A NOW marker row is then woven into the
   * time-ordered list at the current time (top=earlier, bottom=later), the same
   * vertical ordering the strip column uses.
   */
  nowMinutes: number | null;
  onAddCue: () => void;
  onEditCue: (cue: PlanCue) => void;
  onDeleteCue: (cueId: string) => void;
  onClose: () => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  // Sun rows from the day's resolved events.
  const sunRows: SunRow[] = useMemo(() => {
    if (!day) return [];
    const rows: SunRow[] = [];
    for (const def of SUN_ROW_DEFS) {
      const t = day.sun[def.key];
      const mins = hhmmToMinutes(t ?? null);
      if (t && mins !== null) rows.push({ sortMins: mins, time: t, label: def.label });
    }
    return rows;
  }, [day]);

  // Map overview cue id → resolved atLocal for this day.
  const atLocalById = useMemo(() => {
    const m = new Map<string, string | null>();
    if (day) for (const c of day.cues) m.set(c.id, c.atLocal);
    return m;
  }, [day]);

  // The DRAFT cues that apply on this day. The overview (server truth) tells
  // us which cues it resolved for this day by id — but a cue JUST added/edited
  // in the draft won't be in the overview until the debounced preview returns
  // (and never if that preview 400s). So we UNION the overview's ids with a
  // client-side day-applicability check over the draft, so new/edited cues
  // appear immediately ("pending" until the overview resolves their time).
  const dayCueIds = useMemo(() => new Set((day?.cues ?? []).map((c) => c.id)), [day]);

  const appliesToDay = (cue: PlanCue): boolean => {
    const d = cue.days;
    if (d === undefined || d === 'all') return true;
    if (!Array.isArray(d)) return false;
    if (!day) return false;
    // Numeric day-index array vs. explicit date-string array.
    if (d.some((v) => typeof v === 'number')) return (d as number[]).includes(day.index);
    return (d as string[]).includes(day.date);
  };

  const draftCuesForDay = useMemo(
    () => plan.cues.filter((c) => dayCueIds.has(c.id) || appliesToDay(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan.cues, dayCueIds, day],
  );

  // Merge sun rows + cue rows, time-ordered. Time-less cues sink to bottom.
  // When viewing TODAY, a NOW marker is woven in at the current minute so the
  // operator sees the live playhead within the day's vertical timeline.
  type Item =
    | { type: 'sun'; key: string; sortMins: number; row: SunRow }
    | { type: 'cue'; key: string; sortMins: number; cue: PlanCue }
    | { type: 'now'; key: string; sortMins: number };

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    for (const r of sunRows) out.push({ type: 'sun', key: `sun:${r.label}`, sortMins: r.sortMins, row: r });
    for (const cue of draftCuesForDay) {
      const at = atLocalById.get(cue.id) ?? null;
      const mins = hhmmToMinutes(at);
      out.push({ type: 'cue', key: `cue:${cue.id}`, sortMins: mins === null ? 100000 : mins, cue });
    }
    if (nowMinutes !== null) {
      // Stable tiebreak (+0.5) keeps NOW just *below* an event at the same
      // minute, reading as "we've reached/passed it".
      out.push({ type: 'now', key: 'now-playhead', sortMins: nowMinutes + 0.5 });
    }
    out.sort((a, b) => a.sortMins - b.sortMins);
    return out;
  }, [sunRows, draftCuesForDay, atLocalById, nowMinutes]);

  const nowLabel = nowMinutes !== null ? minutesTo12h(nowMinutes) : '';

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>
                {day ? `DAY ${day.index + 1} · ${day.weekday.toUpperCase()}` : 'DAY'}
              </Text>
              {day ? <Text style={styles.subtitle}>{day.date}</Text> : null}
            </View>
            <TouchableOpacity onPress={onAddCue} style={styles.addBtn} accessibilityLabel="Add cue to this day">
              <Text style={styles.addBtnText}>＋ ADD CUE</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close day editor">
              <Text style={styles.closeBtnText}>DONE</Text>
            </TouchableOpacity>
          </View>

          {!day ? (
            <View style={styles.loadingWrap}>
              <Text style={styles.loadingText}>Resolving day…</Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
              {items.length === 0 ? (
                <Text style={styles.empty}>No sun events or cues for this day yet. Tap ＋ ADD CUE.</Text>
              ) : (
                items.map((it) => {
                  if (it.type === 'now') {
                    return (
                      <View key={it.key} style={styles.nowRow}>
                        <Text style={[styles.nowTime, { color: C.error }]}>{nowLabel}</Text>
                        <View style={[styles.nowLine, { backgroundColor: C.error }]} />
                        <View style={[styles.nowDot, { backgroundColor: C.error }]} />
                        <Text style={[styles.nowLabel, { color: C.error }]}>NOW</Text>
                      </View>
                    );
                  }
                  if (it.type === 'sun') {
                    return (
                      <View key={it.key} style={styles.sunRow}>
                        <Text style={styles.sunTime}>{hhmmTo12h(it.row.time, it.row.time)}</Text>
                        <IconSymbol name="sun.max" size={16} color={C.secondary} />
                        <Text style={styles.sunLabel}>{it.row.label}</Text>
                      </View>
                    );
                  }
                  const cue = it.cue;
                  const at = atLocalById.get(cue.id) ?? null;
                  // A cue in the draft but not yet in the overview is "pending":
                  // the debounced preview hasn't resolved its time yet.
                  const pending = !dayCueIds.has(cue.id);
                  const kind = cue.kind || (cue.trigger.type === 'mood' ? 'mood' : 'program');
                  const col = kindColor(kind, C);
                  return (
                    <TouchableOpacity
                      key={it.key}
                      onPress={() => onEditCue(cue)}
                      activeOpacity={0.85}
                      style={[styles.cueRow, { borderLeftColor: col }, pending && { opacity: 0.7 }]}
                      accessibilityLabel={`Edit cue ${cue.label || cue.id}`}
                    >
                      <View style={styles.cueTimeCol}>
                        <Text style={styles.cueTime}>{hhmmTo12h(at, pending ? '···' : '—')}</Text>
                        <View style={[styles.kindDot, { backgroundColor: col }]} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.cueLabel} numberOfLines={1}>
                          {cue.label || cue.id}{pending ? '  · pending…' : ''}
                        </Text>
                        <Text style={styles.cueMeta} numberOfLines={1}>
                          {`${KIND_LABEL[kind]} · ${triggerSummary(cue.trigger)} · ${actionSummary(cue.action)}${
                            typeof cue.durationMin === 'number' && cue.durationMin > 0 ? ` · ${cue.durationMin}m block` : ''
                          }`}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => onDeleteCue(cue.id)}
                        style={styles.cueTrash}
                        accessibilityLabel={`Delete cue ${cue.label || cue.id}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <IconSymbol name="trash" size={16} color={C.error} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}


function makeStyles(C: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      height: '88%',
      backgroundColor: C.surfaceContainerLow,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 24,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 16,
    },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 16,
      letterSpacing: 1,
      color: C.text,
      textTransform: 'uppercase',
    },
    subtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.secondary,
      marginTop: 2,
    },
    addBtn: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 44,
      borderRadius: 8,
      backgroundColor: C.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.6,
      color: C.onPrimary,
    },
    closeBtn: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 44,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.6,
      color: C.text,
    },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: C.secondary },
    empty: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: C.secondary,
      paddingVertical: 16,
    },
    sunRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      opacity: 0.75,
    },
    sunTime: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      color: C.secondary,
      width: 72,
    },
    sunLabel: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: C.secondary,
      flex: 1,
    },
    cueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderLeftWidth: 4,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerLowest,
      marginBottom: 8,
    },
    cueTimeCol: {
      alignItems: 'center',
      width: 72,
      gap: 4,
    },
    cueTime: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      color: C.text,
    },
    kindDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    cueLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      color: C.text,
    },
    cueMeta: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color: C.secondary,
      marginTop: 3,
    },
    cueTrash: {
      width: 40,
      height: 40,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      paddingHorizontal: 12,
      marginVertical: 2,
    },
    nowTime: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      width: 72,
    },
    nowDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    nowLine: {
      flex: 1,
      height: 2,
      borderRadius: 1,
    },
    nowLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 1,
    },
  });
}
