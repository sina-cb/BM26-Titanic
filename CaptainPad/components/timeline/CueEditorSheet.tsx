/**
 * CueEditorSheet — themed modal to add / edit a single cue (docs/38 §15.3).
 *
 * Pure pill / stepper / segmented / dropdown inputs — NO keyboard walls.
 * Operates on a LOCAL working copy of a PlanCue; commits via onSave (the
 * parent inserts/replaces in the draft plan and fires a debounced preview).
 *
 *   CUE NAME  text input  the operator-facing label for this cue
 *   KIND      segmented   program | mood | ambient
 *   TRIGGER   segmented   clock | sun | phase | mood | manual
 *               clock → HH:MM stepper
 *               sun   → event dropdown + offset ±min stepper
 *               phase → phase dropdown
 *               mood  → from/to segmented + dwell/cooldown steppers + whenPhase
 *   ACTION    segmented   playlist | look       (scene removed — see below)
 *               playlist → dropdown (GET /playlists) + target (deck|mixer) + autopilot
 *               look     → dropdown of plan.looks
 *   HOLD      none | minutes stepper            (programs only)
 *   DAYS      This day | All days | Pick…       (Pick = day-index toggles)
 *
 * PLAYLIST is the primary/default action (the simple path). LOOK is the
 * optional bundle (playlist + palette + globals, defined in plan.looks).
 * The `scene` action is deliberately NOT authored here: a scene switch
 * restarts the engine — dangerous + irrelevant inside the maker.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, Pressable, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import {
  PlanCue, CueKind, CueTrigger, CueAction, SunEvent, CueDays, ShowPlan,
} from '@/utils/timelineApi';
import {
  hhmmToMinutes, minutesToHHMM, SUN_EVENT_OPTIONS, MOOD_VALUES,
} from './timelineTemplate';
import { Segmented, Stepper, Dropdown, ToggleChip, FieldLabel } from './makerControls';

// Playlist target channels the maker offers. DECK or MIXER only — `all` is a
// hand-authored escape hatch the engine still validates, but it's removed from
// the maker UI (a mixer target additionally needs a channel id; see below).
const TARGET_OPTIONS: { id: 'deck' | 'mixer'; label: string }[] = [
  { id: 'deck', label: 'Deck' },
  { id: 'mixer', label: 'Mixer' },
];

function defaultTrigger(type: CueTrigger['type']): CueTrigger {
  switch (type) {
    case 'clock': return { type: 'clock', at: '20:00' };
    case 'sun': return { type: 'sun', event: 'sunset', offsetMin: 0 };
    case 'phase': return { type: 'phase', phase: '' };
    case 'mood': return { type: 'mood', from: 'calm', to: 'party', minDwellSec: 30, cooldownSec: 300 };
    case 'manual': return { type: 'manual' };
  }
}

function defaultAction(type: CueAction['type'], firstLook: string | null): CueAction {
  switch (type) {
    case 'playlist': return { type: 'playlist', name: 'default', target: { channel: 'deck', id: null } };
    case 'look': return { type: 'look', look: firstLook || '' };
    case 'globals': return { type: 'globals', set: {} };
  }
}

export function CueEditorSheet({
  visible, initialCue, plan, playlists, dayIndex, onSave, onDelete, onClose,
}: {
  visible: boolean;
  /** null = adding a new cue. */
  initialCue: PlanCue | null;
  plan: ShowPlan;
  playlists: string[];
  /** The day the editor was opened from — seeds DAYS "This day". */
  dayIndex: number;
  onSave: (cue: PlanCue) => void;
  onDelete: (() => void) | null;
  onClose: () => void;
}) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);

  const lookNames = Object.keys(plan.looks);
  const phaseNames = Object.keys(plan.phases);

  type DaysMode = 'all' | 'this' | 'pick';

  // Classify a saved `days` value into an initial segmented mode. A date-string
  // array (e.g. ['2026-08-31']) has no grid representation, so we surface it as
  // 'pick' (read-only) rather than clobbering it.
  const initialDaysMode = (d: CueDays | undefined): DaysMode => {
    if (d === 'all' || d === undefined) return 'all';
    if (Array.isArray(d) && d.length === 1 && d[0] === dayIndex) return 'this';
    return 'pick';
  };

  // Working copy. Re-seeded each time the sheet opens with a different cue.
  const [kind, setKind] = useState<CueKind>('program');
  const [label, setLabel] = useState<string>('');
  const [trigger, setTrigger] = useState<CueTrigger>(defaultTrigger('clock'));
  const [action, setAction] = useState<CueAction>(defaultAction('playlist', lookNames[0] || null));
  const [holdMin, setHoldMin] = useState<number | null>(null);
  const [days, setDays] = useState<CueDays>('all');
  // DAYS mode is EXPLICIT state, driven by the segmented control — NOT derived
  // from `days` on every render (deriving made "Pick…" snap back to "This day").
  const [daysMode, setDaysModeState] = useState<DaysMode>('all');
  const [seedKey, setSeedKey] = useState<string>('');

  // Seed when the sheet opens / target cue changes. We key on cue id +
  // visibility so re-opening the SAME cue after an external edit re-seeds.
  const wantKey = `${visible ? 'v' : 'h'}:${initialCue?.id ?? 'new'}:${dayIndex}`;
  if (visible && wantKey !== seedKey) {
    setSeedKey(wantKey);
    if (initialCue) {
      setKind(initialCue.kind || (initialCue.trigger.type === 'mood' ? 'mood' : 'program'));
      setLabel(initialCue.label || '');
      setTrigger(initialCue.trigger);
      setAction(initialCue.action);
      setHoldMin(initialCue.hold && 'min' in initialCue.hold ? initialCue.hold.min : null);
      setDays(initialCue.days ?? 'all');
      setDaysModeState(initialDaysMode(initialCue.days));
    } else {
      setKind('program');
      setLabel('');
      setTrigger(defaultTrigger('clock'));
      setAction(defaultAction('playlist', lookNames[0] || null));
      setHoldMin(null);
      setDays([dayIndex]); // new cue defaults to "this day"
      setDaysModeState('this');
    }
  }

  // True when `days` holds date strings (no grid representation; read-only).
  const isDateStringDays = Array.isArray(days) && days.some((d) => typeof d === 'string');

  const setDaysMode = (mode: DaysMode) => {
    setDaysModeState(mode);
    if (mode === 'all') setDays('all');
    else if (mode === 'this') setDays([dayIndex]);
    else {
      // entering "pick": keep an existing numeric/date selection; otherwise
      // seed from this day so the grid opens with something selected.
      if (Array.isArray(days) && days.length > 0) return; // preserve as-is
      setDays([dayIndex]);
    }
  };

  const togglePickDay = (idx: number) => {
    // Toggling is only meaningful for numeric (grid) selections; a date-string
    // array is shown read-only and left untouched.
    if (isDateStringDays) return;
    const cur = Array.isArray(days) && days.every((d) => typeof d === 'number') ? (days as number[]) : [];
    const next = cur.includes(idx) ? cur.filter((d) => d !== idx) : [...cur, idx].sort((a, b) => a - b);
    setDays(next.length ? next : [dayIndex]);
  };

  const festivalDays = plan.festival?.days ?? 8;

  const buildCue = (): PlanCue => {
    // Spread the ORIGINAL cue first so fields the editor doesn't surface
    // (e.g. `catchUp`, and any future/unknown keys) survive a round-trip;
    // then overlay only what the editor manages.
    const cue: PlanCue = {
      ...(initialCue ?? {}),
      id: initialCue?.id ?? '', // parent mints id for new cues
      kind,
      trigger,
      action,
      days,
    };
    if (label.trim()) cue.label = label.trim();
    else delete cue.label;
    if (kind === 'program' && holdMin && holdMin > 0) cue.hold = { min: holdMin };
    else delete cue.hold;
    return cue;
  };

  // ── Trigger sub-editors ──
  const renderTriggerBody = () => {
    if (trigger.type === 'clock') {
      const mins = hhmmToMinutes(trigger.at) ?? 1200;
      return (
        <View style={styles.subBlock}>
          <FieldLabel>TIME (HH:MM)</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Stepper
                value={Math.floor(mins / 60)}
                onChange={(h) => setTrigger({ type: 'clock', at: minutesToHHMM(h * 60 + (mins % 60)) })}
                min={0} max={23} wrap
                format={(h) => `${String(h).padStart(2, '0')}h`}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Stepper
                value={mins % 60}
                step={5}
                onChange={(m) => setTrigger({ type: 'clock', at: minutesToHHMM(Math.floor(mins / 60) * 60 + m) })}
                min={0} max={55} wrap
                format={(m) => `${String(m).padStart(2, '0')}m`}
              />
            </View>
          </View>
        </View>
      );
    }
    if (trigger.type === 'sun') {
      return (
        <View style={styles.subBlock}>
          <FieldLabel>SUN EVENT</FieldLabel>
          <Dropdown
            value={trigger.event}
            options={SUN_EVENT_OPTIONS.map((s) => ({ id: s.id, label: s.label }))}
            onSelect={(id) => setTrigger({ ...trigger, event: id as SunEvent })}
          />
          <View style={{ height: 8 }} />
          <FieldLabel>OFFSET (MIN)</FieldLabel>
          <Stepper
            value={trigger.offsetMin ?? 0}
            step={5}
            onChange={(v) => setTrigger({ ...trigger, offsetMin: v })}
            min={-180} max={180}
            format={(v) => `${v > 0 ? '+' : ''}${v} min`}
          />
        </View>
      );
    }
    if (trigger.type === 'phase') {
      return (
        <View style={styles.subBlock}>
          <FieldLabel>PHASE</FieldLabel>
          <Dropdown
            value={trigger.phase || null}
            options={phaseNames.map((p) => ({ id: p, label: p }))}
            onSelect={(id) => setTrigger({ type: 'phase', phase: id })}
            placeholder="Pick a phase…"
            emptyHint="This plan defines no phases."
          />
        </View>
      );
    }
    if (trigger.type === 'mood') {
      return (
        <View style={styles.subBlock}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <FieldLabel>FROM</FieldLabel>
              <Segmented
                options={MOOD_VALUES.map((m) => ({ id: m, label: m }))}
                value={trigger.from}
                onChange={(v) => setTrigger({ ...trigger, from: v })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <FieldLabel>TO</FieldLabel>
              <Segmented
                options={MOOD_VALUES.map((m) => ({ id: m, label: m }))}
                value={trigger.to}
                onChange={(v) => setTrigger({ ...trigger, to: v })}
              />
            </View>
          </View>
          <View style={{ height: 8 }} />
          <FieldLabel>MIN DWELL (SEC)</FieldLabel>
          <Stepper
            value={trigger.minDwellSec ?? 0}
            step={10}
            onChange={(v) => setTrigger({ ...trigger, minDwellSec: v })}
            min={0} max={600}
            format={(v) => `${v}s`}
          />
          <View style={{ height: 8 }} />
          <FieldLabel>COOLDOWN (SEC)</FieldLabel>
          <Stepper
            value={trigger.cooldownSec ?? 0}
            step={30}
            onChange={(v) => setTrigger({ ...trigger, cooldownSec: v })}
            min={0} max={3600}
            format={(v) => `${v}s`}
          />
          <View style={{ height: 8 }} />
          <FieldLabel>WHEN PHASE (OPTIONAL)</FieldLabel>
          <Dropdown
            value={trigger.whenPhase ?? null}
            options={[{ id: '', label: '— any phase —' }, ...phaseNames.map((p) => ({ id: p, label: p }))]}
            onSelect={(id) => setTrigger({ ...trigger, whenPhase: id || undefined })}
            placeholder="— any phase —"
          />
        </View>
      );
    }
    return (
      <View style={styles.subBlock}>
        <Text style={styles.hint}>Manual cues fire only when the operator taps FIRE.</Text>
      </View>
    );
  };

  // ── Action sub-editors ──
  const renderActionBody = () => {
    if (action.type === 'playlist') {
      const ap = action.autopilot ?? {};
      const target = action.target ?? { channel: 'deck' as const, id: null };
      return (
        <View style={styles.subBlock}>
          <FieldLabel>PLAYLIST</FieldLabel>
          <Dropdown
            value={action.name || null}
            options={playlists.map((p) => ({ id: p, label: p }))}
            onSelect={(id) => setAction({ ...action, name: id })}
            placeholder="Pick a playlist…"
            emptyHint="Engine reports no playlists."
          />
          <View style={{ height: 8 }} />
          <FieldLabel>TARGET</FieldLabel>
          <Segmented
            options={TARGET_OPTIONS}
            value={target.channel === 'mixer' ? 'mixer' : 'deck'}
            onChange={(ch) => setAction({
              ...action,
              // Deck targets the main deck (id always null); mixer needs a
              // channel id (preserve any typed id when re-selecting mixer).
              target: ch === 'mixer' ? { channel: 'mixer', id: target.id } : { channel: 'deck', id: null },
            })}
          />
          {target.channel === 'mixer' ? (
            <>
              <View style={{ height: 8 }} />
              <FieldLabel>MIXER CHANNEL ID</FieldLabel>
              <TextInput
                value={target.id ?? ''}
                onChangeText={(t) => setAction({ ...action, target: { channel: 'mixer', id: t.trim() || null } })}
                placeholder="e.g. ch_1"
                placeholderTextColor={C.icon}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.textInput}
                accessibilityLabel="Mixer channel id"
              />
            </>
          ) : null}
          <View style={{ height: 8 }} />
          <ToggleChip
            on={!!ap.active}
            onToggle={() => setAction({ ...action, autopilot: { ...ap, active: !ap.active } })}
            label={ap.active ? 'AUTOPILOT ON' : 'AUTOPILOT OFF'}
          />
          {ap.active ? (
            <>
              <View style={{ height: 8 }} />
              <FieldLabel>AUTOPILOT DELAY (SEC)</FieldLabel>
              <Stepper
                value={ap.delay_s ?? 30}
                step={5}
                onChange={(v) => setAction({ ...action, autopilot: { ...ap, delay_s: v } })}
                min={5} max={600}
                format={(v) => `${v}s`}
              />
              <View style={{ height: 8 }} />
              <ToggleChip
                on={!!ap.shuffle}
                onToggle={() => setAction({ ...action, autopilot: { ...ap, shuffle: !ap.shuffle } })}
                label={ap.shuffle ? 'SHUFFLE ON' : 'SHUFFLE OFF'}
              />
            </>
          ) : null}
        </View>
      );
    }
    if (action.type === 'look') {
      return (
        <View style={styles.subBlock}>
          <FieldLabel>LOOK</FieldLabel>
          <Dropdown
            value={action.look || null}
            options={lookNames.map((l) => ({ id: l, label: l }))}
            onSelect={(id) => setAction({ type: 'look', look: id })}
            placeholder="Pick a look…"
            emptyHint="This plan defines no looks."
          />
          <Text style={[styles.hint, { marginTop: 8 }]}>
            A look = a playlist + its palette/brightness, reused by cues.
          </Text>
        </View>
      );
    }
    return null;
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '90%' }}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{initialCue ? 'EDIT CUE' : 'ADD CUE'}</Text>
              {onDelete ? (
                <TouchableOpacity onPress={onDelete} style={styles.trashBtn} accessibilityLabel="Delete cue">
                  <Text style={styles.trashLabel}>DELETE</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* paddingBottom clears the sticky footer (≈48pt button + 16pt
                margin + slack) so the last DAYS / SHUFFLE controls aren't
                hidden behind it. */}
            <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
              {/* CUE NAME — the operator-facing label (engine cue.label, optional). */}
              <FieldLabel>CUE NAME</FieldLabel>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="Name this cue…"
                placeholderTextColor={C.icon}
                autoCapitalize="sentences"
                autoCorrect={false}
                style={styles.textInput}
                accessibilityLabel="Cue name"
              />

              {/* KIND */}
              <View style={{ height: 14 }} />
              <FieldLabel>KIND</FieldLabel>
              <Segmented
                options={[
                  { id: 'program', label: 'Program' },
                  { id: 'mood', label: 'Mood' },
                  { id: 'ambient', label: 'Ambient' },
                ]}
                value={kind}
                onChange={(v) => setKind(v as CueKind)}
              />

              {/* TRIGGER */}
              <View style={{ height: 14 }} />
              <FieldLabel>TRIGGER</FieldLabel>
              <Segmented
                options={[
                  { id: 'clock', label: 'Clock' },
                  { id: 'sun', label: 'Sun' },
                  { id: 'phase', label: 'Phase' },
                  { id: 'mood', label: 'Mood' },
                  { id: 'manual', label: 'Manual' },
                ]}
                value={trigger.type}
                onChange={(v) => setTrigger(defaultTrigger(v as CueTrigger['type']))}
              />
              {renderTriggerBody()}

              {/* ACTION */}
              <View style={{ height: 14 }} />
              <FieldLabel>ACTION</FieldLabel>
              <Segmented
                options={[
                  { id: 'playlist', label: 'Playlist' },
                  { id: 'look', label: 'Look' },
                ]}
                value={action.type === 'globals' ? 'playlist' : action.type}
                onChange={(v) => {
                  // Only reset to a default when the action TYPE actually
                  // changes — re-tapping the current segment must not clobber
                  // the edited action (e.g. a configured playlist/target).
                  if (v !== action.type) setAction(defaultAction(v as CueAction['type'], lookNames[0] || null));
                }}
              />
              {renderActionBody()}

              {/* HOLD (programs only) */}
              {kind === 'program' ? (
                <>
                  <View style={{ height: 14 }} />
                  <FieldLabel>HOLD</FieldLabel>
                  <Segmented
                    options={[{ id: 'none', label: 'None' }, { id: 'min', label: 'Minutes' }]}
                    value={holdMin && holdMin > 0 ? 'min' : 'none'}
                    onChange={(v) => setHoldMin(v === 'min' ? (holdMin || 30) : null)}
                  />
                  {holdMin && holdMin > 0 ? (
                    <View style={{ marginTop: 8 }}>
                      <Stepper
                        value={holdMin}
                        step={15}
                        onChange={setHoldMin}
                        min={5} max={480}
                        format={(v) => `${v} min`}
                      />
                    </View>
                  ) : null}
                </>
              ) : null}

              {/* DAYS */}
              <View style={{ height: 14 }} />
              <FieldLabel>DAYS</FieldLabel>
              <Segmented
                options={[
                  { id: 'this', label: 'This day' },
                  { id: 'all', label: 'All days' },
                  { id: 'pick', label: 'Pick…' },
                ]}
                value={daysMode}
                onChange={(v) => setDaysMode(v as 'all' | 'this' | 'pick')}
              />
              {daysMode === 'pick' && isDateStringDays ? (
                // Saved as explicit date strings — no grid representation.
                // Show read-only so we never clobber the operator's dates.
                <View style={styles.subBlock}>
                  <Text style={styles.hint}>
                    {`Specific dates: ${(days as string[]).join(', ')} (edit dates in the plan file).`}
                  </Text>
                </View>
              ) : daysMode === 'pick' ? (
                <View style={styles.pickRow}>
                  {Array.from({ length: festivalDays }, (_, i) => i).map((i) => {
                    const sel = Array.isArray(days) && (days as number[]).includes(i);
                    return (
                      <TouchableOpacity
                        key={i}
                        onPress={() => togglePickDay(i)}
                        style={[styles.dayPill, sel && { backgroundColor: C.primary, borderColor: C.primary }]}
                        accessibilityLabel={`Day ${i + 1}`}
                        accessibilityState={{ selected: sel }}
                      >
                        <Text style={[styles.dayPillText, sel && { color: C.onPrimary }]}>{`D${i + 1}`}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              <TouchableOpacity onPress={onClose} style={[styles.footerBtn, styles.footerCancel]} accessibilityLabel="Cancel">
                <Text style={[styles.footerBtnText, { color: C.text }]}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onSave(buildCue())}
                style={[styles.footerBtn, { backgroundColor: C.primary }]}
                accessibilityLabel="Save cue"
              >
                <Text style={[styles.footerBtnText, { color: C.onPrimary }]}>{initialCue ? 'SAVE CUE' : 'ADD CUE'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}


function makeStyles(C: Palette) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: C.surfaceContainerLow,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 20,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    sheetTitle: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 15,
      letterSpacing: 1,
      color: C.text,
      textTransform: 'uppercase',
    },
    trashBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.error,
    },
    trashLabel: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.6,
      color: C.error,
    },
    subBlock: {
      marginTop: 10,
      padding: 12,
      borderRadius: 10,
      backgroundColor: C.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    hint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: C.secondary,
    },
    textInput: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      color: C.text,
      minHeight: 44,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
    },
    pickRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
    dayPill: {
      minWidth: 44,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayPillText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      color: C.text,
    },
    footer: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
    },
    footerBtn: {
      flex: 1,
      minHeight: 48,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    footerCancel: {
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: 'transparent',
    },
    footerBtnText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      letterSpacing: 0.8,
    },
  });
}
