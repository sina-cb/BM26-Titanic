/**
 * Timeline tab — operator surface for the Timeline / Show Director
 * companion (docs/38 §8). The companion is a server-side, engine-
 * supervised process on its OWN port (6965) that fires playlists / looks
 * / scenes off wall-clock, sun events, named phases, and music mood. This
 * tab is a THIN mirror, exactly like scheduler.tsx is for the engine's
 * scheduled tasks: the companion owns the schedule, the sun math, and the
 * dispatch; CaptainPad renders state and sends taps.
 *
 * Layout (docs/38 §8):
 *   - Header: plan + scene, mode pill (ARMED/PAUSED/HOLDING/OVERRIDDEN),
 *     engine-connected dot, mood pill (● CALM / ● PARTY), next-cue
 *     countdown ("next in M:SS · <label>" or "no upcoming cue").
 *   - Controls: PAUSE/RESUME toggle, HOLD 30m, plan picker.
 *   - Day ribbon: sun events + phase bands + a NOW marker, time-ordered.
 *   - Cue list: label + trigger + countdown + FIRE; error cues in red.
 *   - Recent fires log.
 *   - "Timeline companion offline" banner when the WS / GET /state are
 *     unreachable — fail loud, never show stale (Codex P0).
 *
 * Zero required keyboard input — pill / stepper / button idioms only,
 * matching scheduler.tsx.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, FlatList, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { useGlobalStyles, GlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTimeline } from '@/hooks/useTimeline';
import { fetchTimelinePlans, TimelineState, TimelineCue, TimelineRecentFire } from '@/utils/timelineApi';

const HOLD_MINUTES = 30;

// ── Time helpers ────────────────────────────────────────────────────────

function formatCountdown(sec: number | null): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return '—';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// "HH:MM" → minutes since midnight, for ordering the ribbon. Returns null
// for malformed strings so they sort to the end rather than crashing.
function hhmmToMinutes(v: string | undefined): number | null {
  if (!v || typeof v !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

// ── Ribbon model ────────────────────────────────────────────────────────

interface RibbonItem {
  key: string;
  minutes: number | null;
  time: string;
  kind: 'sun' | 'phaseStart' | 'phaseEnd' | 'now';
  label: string;
  icon: 'sun.max' | 'sunrise' | 'sunset' | 'moon.stars' | 'clock';
}

// Sun events we surface, in the doc's order, with a friendly label + icon.
const SUN_EVENTS: { key: string; label: string; icon: RibbonItem['icon'] }[] = [
  { key: 'sunrise',         label: 'Sunrise',          icon: 'sunrise' },
  { key: 'goldenHourEnd',   label: 'Golden hour end',  icon: 'sun.max' },
  { key: 'solarNoon',       label: 'Solar noon',       icon: 'sun.max' },
  { key: 'goldenHourStart', label: 'Golden hour',      icon: 'sun.max' },
  { key: 'sunset',          label: 'Sunset',           icon: 'sunset' },
  { key: 'civilDusk',       label: 'Civil dusk',       icon: 'moon.stars' },
];

function buildRibbon(state: TimelineState): RibbonItem[] {
  const items: RibbonItem[] = [];

  for (const ev of SUN_EVENTS) {
    const t = state.sun?.[ev.key];
    if (!t) continue;
    items.push({
      key: `sun:${ev.key}`,
      minutes: hhmmToMinutes(t),
      time: t,
      kind: 'sun',
      label: ev.label,
      icon: ev.icon,
    });
  }

  const phases = state.phases || {};
  for (const name of Object.keys(phases)) {
    const w = phases[name];
    if (w?.start) {
      items.push({
        key: `phaseStart:${name}`,
        minutes: hhmmToMinutes(w.start),
        time: w.start,
        kind: 'phaseStart',
        label: `${name} starts`,
        icon: 'clock',
      });
    }
    if (w?.end) {
      items.push({
        key: `phaseEnd:${name}`,
        minutes: hhmmToMinutes(w.end),
        time: w.end,
        kind: 'phaseEnd',
        label: `${name} ends`,
        icon: 'clock',
      });
    }
  }

  const nowStr = nowHHMM();
  items.push({
    key: 'now',
    minutes: hhmmToMinutes(nowStr),
    time: nowStr,
    kind: 'now',
    label: 'NOW',
    icon: 'clock',
  });

  // Order by time; null-minute (malformed) rows sink to the bottom.
  items.sort((a, b) => {
    if (a.minutes === null && b.minutes === null) return 0;
    if (a.minutes === null) return 1;
    if (b.minutes === null) return -1;
    return a.minutes - b.minutes;
  });
  return items;
}

// ── Offline banner ──────────────────────────────────────────────────────
// The companion can be down even when the engine is up — it's a separate
// process on :6965. Fail loud: tell the operator the companion is offline,
// never render stale schedule data.
function OfflineBanner({ error, styles, C }: { error: string | null; styles: Styles; C: Palette }) {
  return (
    <View style={styles.offlineBanner}>
      <IconSymbol name="wifi.slash" size={24} color={C.error} />
      <View style={{ flex: 1 }}>
        <Text style={styles.offlineTitle}>TIMELINE COMPANION OFFLINE</Text>
        <Text style={styles.offlineBody}>
          {error || 'CaptainPad cannot reach the Timeline Companion on :6965. The companion fires cues on its own; reconnecting…'}
        </Text>
      </View>
    </View>
  );
}

// ── Mode pill ───────────────────────────────────────────────────────────
function ModePill({ mode, styles, C }: { mode: TimelineState['mode']; styles: Styles; C: Palette }) {
  const map: Record<TimelineState['mode'], { label: string; color: string }> = {
    armed:      { label: 'ARMED',      color: C.tertiary },
    paused:     { label: 'PAUSED',     color: C.secondary },
    holding:    { label: 'HOLDING',    color: C.primary },
    overridden: { label: 'OVERRIDDEN', color: C.error },
  };
  const m = map[mode] || { label: String(mode).toUpperCase(), color: C.secondary };
  return (
    <View style={[styles.pill, { borderColor: m.color }]}>
      <Text style={[styles.pillText, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

// ── Mood pill ───────────────────────────────────────────────────────────
function MoodPill({ party, mood, styles, C }: { party: boolean; mood: string | null; styles: Styles; C: Palette }) {
  const color = party ? C.error : C.tertiary;
  const label = party ? 'PARTY' : (mood ? mood.toUpperCase() : 'CALM');
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{`● ${label}`}</Text>
    </View>
  );
}

// ── Plan picker modal ───────────────────────────────────────────────────
function PlanPicker({
  visible, plans, active, onPick, onClose, styles, C,
}: {
  visible: boolean;
  plans: string[];
  active: string | null;
  onPick: (name: string) => void;
  onClose: () => void;
  styles: Styles;
  C: Palette;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>ACTIVATE PLAN</Text>
          {plans.length === 0 ? (
            <Text style={styles.modalEmpty}>No plans reported by the companion.</Text>
          ) : (
            <FlatList
              data={plans}
              keyExtractor={(p) => p}
              renderItem={({ item }) => {
                const isActive = item === active;
                return (
                  <TouchableOpacity
                    onPress={() => { onPick(item); onClose(); }}
                    style={[styles.planRow, isActive && { borderColor: C.primary, backgroundColor: C.sidebarActiveBackground }]}
                  >
                    <Text style={[styles.planRowText, isActive && { color: C.primary }]}>{item}</Text>
                    {isActive ? <IconSymbol name="checkmark.circle.fill" size={20} color={C.primary} /> : null}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

export default function TimelineScreen() {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);
  const { state, connected, error, activatePlan, setMode, hold, resume, fireCue } = useTimeline();

  const [plans, setPlans] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // One 1 s ticker drives the NOW marker / live "current time" read. The
  // server-supplied countdowns (nextInSec) refresh on each WS push; this
  // tick keeps the ribbon NOW row honest between pushes.
  const [, setNowTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Plans list — fetched on mount and after each activate so the picker
  // reflects what the companion actually has.
  const refreshPlans = useCallback(() => {
    fetchTimelinePlans().then((r) => {
      if (r.ok && r.data && Array.isArray(r.data.plans)) setPlans(r.data.plans);
    });
  }, []);
  useEffect(() => { refreshPlans(); }, [refreshPlans]);

  const handlePickPlan = useCallback(async (name: string) => {
    const ok = await activatePlan(name);
    if (ok) refreshPlans();
  }, [activatePlan, refreshPlans]);

  // "Offline" = no live socket AND no seeded state. A socket that's up but
  // hasn't pushed yet still shows whatever the REST seed gave us.
  const isOffline = !connected && !state;

  const ribbon = useMemo(() => (state ? buildRibbon(state) : []), [state]);

  const nextCueLabel = useMemo(() => {
    if (!state) return '';
    if (state.nextCue) {
      return `next in ${formatCountdown(state.nextCue.inSec)} · ${state.nextCue.label}`;
    }
    return 'no upcoming cue';
  }, [state]);

  const mode = state?.mode ?? 'armed';
  const isPaused = mode === 'paused';

  const handlePauseResume = useCallback(() => {
    if (isPaused) { resume(); } else { setMode('paused'); }
  }, [isPaused, resume, setMode]);

  return (
    <View style={styles.container}>
      <View style={styles.surface}>
        {/* ── Header ── */}
        <View style={styles.headerRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <IconSymbol name="sun.max" size={28} color={C.primary} />
            <View style={{ minWidth: 0 }}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {state?.activePlan ? `TIMELINE — ${state.activePlan}` : 'TIMELINE'}
              </Text>
              {state?.scene ? <Text style={styles.headerScene} numberOfLines={1}>{`scene · ${state.scene}`}</Text> : null}
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {state ? <ModePill mode={state.mode} styles={styles} C={C} /> : null}
            {state ? <MoodPill party={!!state.party} mood={state.currentMood} styles={styles} C={C} /> : null}
            <View style={styles.engineDotWrap}>
              <View style={[styles.engineDot, { backgroundColor: state?.engineConnected ? C.tertiary : C.error }]} />
              <Text style={styles.engineDotLabel}>{state?.engineConnected ? 'ENGINE' : 'NO ENGINE'}</Text>
            </View>
          </View>
        </View>

        {/* Next-cue countdown line */}
        {state ? (
          <View style={styles.nextCueRow}>
            <IconSymbol name="clock" size={16} color={C.secondary} />
            <Text style={styles.nextCueText} numberOfLines={1}>{nextCueLabel}</Text>
            {state.currentPhase ? (
              <Text style={styles.phaseChip}>{`phase · ${state.currentPhase}`}</Text>
            ) : null}
          </View>
        ) : null}

        {isOffline ? <OfflineBanner error={error} styles={styles} C={C} /> : null}
        {!isOffline && error ? (
          <View style={styles.actionErrorBanner}>
            <Text style={styles.actionErrorText} numberOfLines={2}>{error}</Text>
          </View>
        ) : null}
        {state?.lastError ? (
          <View style={styles.actionErrorBanner}>
            <Text style={styles.actionErrorText} numberOfLines={2}>{state.lastError}</Text>
          </View>
        ) : null}

        {/* ── Controls row ── */}
        <View style={styles.controlsRow}>
          <TouchableOpacity
            onPress={handlePauseResume}
            disabled={!state}
            style={[styles.controlButton, isPaused ? { backgroundColor: C.tertiary } : { backgroundColor: C.surfaceContainerHigh, borderColor: C.ghostBorder, borderWidth: 1 }]}
            accessibilityRole="button"
            accessibilityLabel={isPaused ? 'Resume timeline' : 'Pause timeline'}
          >
            <IconSymbol name={isPaused ? 'play.fill' : 'pause.fill'} size={16} color={isPaused ? '#FFF' : C.text} />
            <Text style={[styles.controlLabel, { color: isPaused ? '#FFF' : C.text }]}>{isPaused ? 'RESUME' : 'PAUSE'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => hold(HOLD_MINUTES)}
            disabled={!state}
            style={[styles.controlButton, { backgroundColor: C.surfaceContainerHigh, borderColor: C.ghostBorder, borderWidth: 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`Hold current look for ${HOLD_MINUTES} minutes`}
          >
            <IconSymbol name="pin.fill" size={16} color={C.text} />
            <Text style={[styles.controlLabel, { color: C.text }]}>{`HOLD ${HOLD_MINUTES}m`}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { refreshPlans(); setPickerOpen(true); }}
            disabled={!state}
            style={[styles.controlButton, { backgroundColor: C.surfaceContainerHigh, borderColor: C.ghostBorder, borderWidth: 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Pick show plan"
          >
            <IconSymbol name="calendar.badge.clock" size={16} color={C.text} />
            <Text style={[styles.controlLabel, { color: C.text }]} numberOfLines={1}>
              {state?.activePlan ? state.activePlan.toUpperCase() : 'PLAN ▾'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Body ── */}
        {state ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
            {/* Day ribbon */}
            <Text style={styles.sectionLabel}>DAY RIBBON</Text>
            <View style={styles.ribbonWrap}>
              {ribbon.length === 0 ? (
                <Text style={styles.emptyHint}>No sun events or phases reported yet.</Text>
              ) : (
                ribbon.map((it) => (
                  <View
                    key={it.key}
                    style={[
                      styles.ribbonRow,
                      it.kind === 'now' && { backgroundColor: C.sidebarActiveBackground, borderColor: C.primary },
                    ]}
                  >
                    <Text style={[styles.ribbonTime, it.kind === 'now' && { color: C.primary }]}>{it.time}</Text>
                    <IconSymbol
                      name={it.icon}
                      size={18}
                      color={it.kind === 'now' ? C.primary : it.kind === 'sun' ? C.primary : C.secondary}
                    />
                    <Text
                      style={[
                        styles.ribbonLabel,
                        it.kind === 'now' && { color: C.primary, fontFamily: 'SpaceGrotesk_700Bold' },
                        (it.kind === 'phaseStart' || it.kind === 'phaseEnd') && { color: C.secondary },
                      ]}
                      numberOfLines={1}
                    >
                      {it.kind === 'now' ? '► NOW' : it.label}
                    </Text>
                  </View>
                ))
              )}
            </View>

            {/* Cue list */}
            <Text style={styles.sectionLabel}>CUES</Text>
            <View>
              {state.cues.length === 0 ? (
                <Text style={styles.emptyHint}>This plan has no cues.</Text>
              ) : (
                state.cues.map((cue) => (
                  <CueRow key={cue.id} cue={cue} onFire={fireCue} styles={styles} C={C} />
                ))
              )}
            </View>

            {/* Recent fires */}
            <Text style={styles.sectionLabel}>RECENT FIRES</Text>
            <View>
              {(!state.recentFires || state.recentFires.length === 0) ? (
                <Text style={styles.emptyHint}>No cues fired yet.</Text>
              ) : (
                state.recentFires.map((f, i) => (
                  <RecentFireRow key={`${f.cueId}:${f.atMs}:${i}`} fire={f} styles={styles} />
                ))
              )}
            </View>
          </ScrollView>
        ) : !isOffline ? (
          <View style={styles.loadingWrap}>
            <Text style={styles.loadingText}>Loading timeline…</Text>
          </View>
        ) : null}

        <PlanPicker
          visible={pickerOpen}
          plans={plans}
          active={state?.activePlan ?? null}
          onPick={handlePickPlan}
          onClose={() => setPickerOpen(false)}
          styles={styles}
          C={C}
        />
      </View>
    </View>
  );
}

// ── Cue row ─────────────────────────────────────────────────────────────
function CueRow({
  cue, onFire, styles, C,
}: {
  cue: TimelineCue;
  onFire: (id: string) => void;
  styles: Styles;
  C: Palette;
}) {
  const hasError = !!cue.lastError;
  return (
    <View style={[styles.cueRow, hasError && { borderColor: C.error, backgroundColor: C.errorContainer }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.cueLabel, hasError && { color: C.error }]} numberOfLines={1}>{cue.label}</Text>
        <Text style={styles.cueTrigger} numberOfLines={1}>{cue.trigger}</Text>
        {hasError ? <Text style={styles.cueError} numberOfLines={2}>{cue.lastError}</Text> : null}
      </View>
      <Text style={[styles.cueCountdown, !cue.enabled && { color: C.icon }]}>
        {cue.enabled ? formatCountdown(cue.nextInSec) : 'off'}
      </Text>
      <TouchableOpacity
        onPress={() => onFire(cue.id)}
        style={styles.fireButton}
        accessibilityRole="button"
        accessibilityLabel={`Fire cue ${cue.label}`}
      >
        <Text style={styles.fireButtonLabel}>FIRE</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Recent-fire row ─────────────────────────────────────────────────────
function RecentFireRow({ fire, styles }: { fire: TimelineRecentFire; styles: Styles }) {
  const t = new Date(fire.atMs);
  const time = Number.isFinite(fire.atMs)
    ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`
    : '—';
  return (
    <View style={styles.fireLogRow}>
      <Text style={styles.fireLogCue} numberOfLines={1}>{fire.cueId}</Text>
      <Text style={styles.fireLogReason} numberOfLines={1}>{fire.reason}</Text>
      <Text style={styles.fireLogTime}>{time}</Text>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(C: Palette, globalStyles: GlobalStyles) {
  return StyleSheet.create({
    container: {
      ...globalStyles.container,
      padding: 24,
      flexDirection: 'column',
    },
    surface: {
      flex: 1,
      ...globalStyles.surfaceLow,
      padding: 24,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
      gap: 12,
    },
    headerTitle: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 16,
      color: C.text,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    headerScene: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color: C.secondary,
      marginTop: 2,
    },
    pill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1.5,
      minHeight: 30,
      justifyContent: 'center',
    },
    pillText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.8,
    },
    engineDotWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    engineDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    engineDotLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 9,
      letterSpacing: 0.8,
      color: C.secondary,
    },
    nextCueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 16,
      flexWrap: 'wrap',
    },
    nextCueText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 13,
      color: C.text,
      flexShrink: 1,
    },
    phaseChip: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.6,
      color: C.primary,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    controlsRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 20,
      flexWrap: 'wrap',
    },
    controlButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 8,
      minHeight: 44,
      justifyContent: 'center',
    },
    controlLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      letterSpacing: 0.8,
    },
    sectionLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      color: C.icon,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      marginTop: 8,
      marginBottom: 10,
    },
    ribbonWrap: {
      marginBottom: 12,
      gap: 4,
    },
    ribbonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    ribbonTime: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      color: C.text,
      width: 52,
    },
    ribbonLabel: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: C.text,
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
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerLowest,
      marginBottom: 8,
    },
    cueLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      color: C.text,
    },
    cueTrigger: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.secondary,
      marginTop: 2,
    },
    cueError: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color: C.error,
      marginTop: 4,
    },
    cueCountdown: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      color: C.text,
      minWidth: 56,
      textAlign: 'right',
    },
    fireButton: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: C.primary,
      minHeight: 40,
      minWidth: 64,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fireButtonLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      color: C.onPrimary,
      letterSpacing: 0.8,
    },
    fireLogRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: C.surfaceContainerLowest,
      marginBottom: 4,
    },
    fireLogCue: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      color: C.text,
      flex: 1,
    },
    fireLogReason: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.secondary,
      flex: 1,
    },
    fireLogTime: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.icon,
    },
    emptyHint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.secondary,
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    loadingWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    },
    loadingText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: C.secondary,
    },
    offlineBanner: {
      backgroundColor: C.errorContainer,
      borderColor: C.error,
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    offlineTitle: {
      fontFamily: 'SpaceGrotesk_700Bold',
      color: C.error,
      fontSize: 14,
      letterSpacing: 0.8,
    },
    offlineBody: {
      fontFamily: 'Inter_400Regular',
      color: C.error,
      fontSize: 12,
      marginTop: 4,
    },
    actionErrorBanner: {
      backgroundColor: C.errorContainer,
      borderColor: C.error,
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      marginBottom: 12,
    },
    actionErrorText: {
      fontFamily: 'Inter_400Regular',
      color: C.error,
      fontSize: 12,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    modalCard: {
      width: '100%',
      maxWidth: 420,
      maxHeight: '70%',
      backgroundColor: C.surfaceContainerLow,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 20,
    },
    modalTitle: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      color: C.text,
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginBottom: 12,
    },
    modalEmpty: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: C.secondary,
      paddingVertical: 16,
    },
    planRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      marginBottom: 8,
    },
    planRowText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      color: C.text,
    },
  });
}
