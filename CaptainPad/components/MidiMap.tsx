// MIDI-map UI (docs/34) — binds a physical fader to a pattern's LOCAL param.
//
// Deliberately mirrors components/Modulation.tsx so the two per-param
// affordances read as a pair: modulation is the GREEN ◎ badge (audio drives the
// value), MIDI-map is the VIOLET ⊞ badge (a fader sets the static value). Where
// the modulation popover picks an audio SOURCE, this one LEARNS a control —
// arm, move a fader, and the next inbound control binds (per Sina: "like the
// modulator"). Bindings are stored per playlist entry (engine-side) and applied
// by the MIDI manager; the engine render loop never reads them.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { engineEvents } from '@/utils/engineEvents';
import { armMidiLearn } from '@/hooks/useMidiControl';
import { describeControlRef, MidiControlRef } from '@/utils/midi';
import {
  deleteMidiMapping, fetchPlaylist, MidiMapping, MIDI_RANGE_LIMIT,
  patchMidiMapping, putMidiMapping,
} from '@/utils/api';

// Violet accent — distinct from modulation's green (◎) and the primary blue
// (interactive control), so "this param is MIDI-mapped" scans at a glance.
const MIDI_VIOLET = '#7c5cff';

function clampRange(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < -MIDI_RANGE_LIMIT) return -MIDI_RANGE_LIMIT;
  if (x > MIDI_RANGE_LIMIT) return MIDI_RANGE_LIMIT;
  return x;
}

// ── per-entry binding fetch (mirror useEntryModulations) ────────────────────

export function useEntryMidiMappings(
  playlistName: string | null | undefined,
  entryId: string | null | undefined,
): { mappings: MidiMapping[]; refresh: () => void } {
  const [mappings, setMappings] = useState<MidiMapping[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!playlistName || !entryId) { setMappings([]); return; }
    let cancelled = false;
    fetchPlaylist(playlistName).then((r) => {
      if (cancelled) return;
      if (!r.ok || !r.data) { setMappings([]); return; }
      const entries = r.data.entries as { id?: string; midiMappings?: MidiMapping[] }[] | undefined;
      const entry = Array.isArray(entries) ? entries.find((e) => e && e.id === entryId) : null;
      setMappings(Array.isArray(entry?.midiMappings) ? entry!.midiMappings! : []);
    });
    return () => { cancelled = true; };
  }, [playlistName, entryId, tick]);

  // Re-fetch on playlistSaved so a learn from another surface / client shows up.
  useEffect(() => {
    return engineEvents.subscribe((m: { type?: string; name?: string }) => {
      if (m && m.type === 'playlistSaved' && m.name === playlistName) refresh();
    });
  }, [playlistName, refresh]);

  return { mappings, refresh };
}

// ── MidiMapBadge — the ⊞ pill in a slider header ────────────────────────────

export function MidiMapBadge({
  mapping, editable, onEdit,
}: {
  mapping: MidiMapping | null;
  editable: boolean;
  onEdit?: () => void;
}) {
  const C = usePalette();
  const hasMapping = !!mapping;
  const canEdit = editable && !!onEdit;
  const label = hasMapping ? describeControlRef(mapping!.control) : '⊞ MIDI';
  const bg = hasMapping ? MIDI_VIOLET : 'transparent';
  const border = hasMapping ? MIDI_VIOLET : C.ghostBorder;
  const fg = hasMapping ? '#fff' : C.secondary;
  // On a read-only surface (mixer) with no mapping there's nothing to show.
  if (!hasMapping && !editable) return null;
  return (
    <TouchableOpacity
      onPress={canEdit ? onEdit : undefined}
      disabled={!canEdit}
      activeOpacity={canEdit ? 0.7 : 1}
      style={{
        paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6,
        backgroundColor: bg, borderWidth: 1, borderColor: border,
        transitionDuration: '0s',
      } as any}
      accessibilityLabel={hasMapping ? 'Edit MIDI mapping' : 'Add MIDI mapping'}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: fg, letterSpacing: 0.5 }}>
        {hasMapping ? `⊞ ${label}` : '⊞ MIDI'}
      </Text>
    </TouchableOpacity>
  );
}

// ── MidiMapPopover — the learn flow editor ──────────────────────────────────

type PopoverProps = {
  paramName: string;
  targetParameter: string;
  playlistName: string;
  entryId: string;
  existing: MidiMapping | null;
  onClose: () => void;
  onChanged: () => void;
};

export function MidiMapPopover({
  paramName, targetParameter, playlistName, entryId, existing, onClose, onChanged,
}: PopoverProps) {
  const C = usePalette();
  const [control, setControl] = useState<MidiControlRef | null>(existing?.control ?? null);
  const [rangeMin, setRangeMin] = useState<string>(String(existing?.range[0] ?? 0));
  const [rangeMax, setRangeMax] = useState<string>(String(existing?.range[1] ?? 1));
  const [enabled, setEnabled] = useState<boolean>(existing?.enabled ?? true);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Holds the in-flight learn so unmount / re-arm can cancel it cleanly.
  const learnRef = useRef<{ cancel: () => void } | null>(null);

  const isExisting = existing !== null;
  // One binding per param → derive a stable id from the target so re-learning
  // the same param overwrites cleanly (PUT replaces by id).
  const mappingId = useMemo(() => existing?.id ?? `midi_${targetParameter}`, [existing, targetParameter]);

  useEffect(() => () => { learnRef.current?.cancel(); }, []);

  const startLearn = useCallback(() => {
    learnRef.current?.cancel();
    setError(null);
    setListening(true);
    const handle = armMidiLearn();
    learnRef.current = handle;
    handle.promise.then((captured) => {
      setListening(false);
      learnRef.current = null;
      if (captured) setControl(captured);
    });
  }, []);

  const stopLearn = useCallback(() => {
    learnRef.current?.cancel();
    learnRef.current = null;
    setListening(false);
  }, []);

  const save = async () => {
    if (busy) return;
    if (!control) { setError('Move a fader to bind a control first.'); return; }
    const lo = Number(rangeMin); const hi = Number(rangeMax);
    if (!Number.isFinite(lo) || rangeMin.trim() === '' || !Number.isFinite(hi) || rangeMax.trim() === '') {
      setError('Enter a numeric range before saving.');
      return;
    }
    if (lo === hi) { setError('Range min and max must differ.'); return; }
    setBusy(true); setError(null);
    const mapping: MidiMapping = {
      id: mappingId,
      enabled,
      control,
      target: { scope: 'pattern', parameter: targetParameter },
      range: [clampRange(lo), clampRange(hi)],
    };
    try {
      const r = isExisting
        ? await patchMidiMapping(playlistName, entryId, mappingId, mapping)
        : await putMidiMapping(playlistName, entryId, mapping);
      if (!r.ok) { setError(r.error || 'unknown error'); return; }
      onChanged();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    if (!isExisting) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const r = await deleteMidiMapping(playlistName, entryId, mappingId);
      if (!r.ok) { setError(r.error || 'unknown error'); return; }
      onChanged();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            width: 420, maxHeight: '90%',
            backgroundColor: C.surfaceContainerLowest,
            borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder,
          }}
        >
          <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.ghostBorder }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: MIDI_VIOLET, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>
              ⊞ MAP {paramName} TO MIDI
            </Text>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* ── CONTROL · learn ─────────────────────────────────────── */}
            <SectionLabel accent={MIDI_VIOLET}>CONTROL</SectionLabel>
            <View style={{
              borderRadius: 8, borderWidth: 1,
              borderColor: listening ? MIDI_VIOLET : C.ghostBorder,
              backgroundColor: C.surfaceContainerLowest, padding: 14, gap: 10, alignItems: 'center',
            }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, color: control ? MIDI_VIOLET : C.icon }}>
                {control ? describeControlRef(control) : '— no control —'}
              </Text>
              {listening ? (
                <>
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: MIDI_VIOLET, textAlign: 'center' }}>
                    ◉ Listening — move a fader (4-6 or 8) or press a pad…
                  </Text>
                  <Chip active onPress={stopLearn}>CANCEL LISTENING</Chip>
                </>
              ) : (
                <Chip active={false} onPress={startLearn}>
                  {control ? 'RE-LEARN' : 'LEARN — MOVE A FADER'}
                </Chip>
              )}
            </View>

            {/* ── RANGE ───────────────────────────────────────────────── */}
            <SectionLabel accent={C.primary}>RANGE</SectionLabel>
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, width: 70 }}>MIN → MAX</Text>
                <NumberInput value={rangeMin} onChange={setRangeMin} placeholder="0" />
                <Text style={{ color: C.secondary }}>→</Text>
                <NumberInput value={rangeMax} onChange={setRangeMax} placeholder="1" />
              </View>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 9, color: C.icon, marginLeft: 78 }}>
                fader 0→127 maps across this range. Invert with min &gt; max. [-4, 4]
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Chip active={enabled} onPress={() => setEnabled(!enabled)}>
                {enabled ? 'ENABLED' : 'DISABLED'}
              </Chip>
            </View>

            {error ? (
              <Text style={{ color: '#c44', fontFamily: 'Inter_400Regular', fontSize: 11 }}>{error}</Text>
            ) : null}
          </ScrollView>

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: C.ghostBorder }}>
            {isExisting ? (
              <TouchableOpacity onPress={remove} disabled={busy} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#c44', opacity: busy ? 0.5 : 1 }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#c44', fontSize: 11 }}>REMOVE</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onClose} disabled={busy} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder, opacity: busy ? 0.5 : 1 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 11 }}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} disabled={busy || !control} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: MIDI_VIOLET, opacity: (busy || !control) ? 0.5 : 1 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#fff', fontSize: 11 }}>SAVE</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export { MIDI_VIOLET };

// ── tiny shared bits (kept local to avoid coupling to Modulation.tsx) ───────

function SectionLabel({ accent, children }: { accent: string; children: React.ReactNode }) {
  const C = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: accent }} />
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text, textTransform: 'uppercase', letterSpacing: 1.2 }}>
        {children}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.ghostBorder }} />
    </View>
  );
}

function Chip({ active, onPress, children }: { active: boolean; onPress: () => void; children: React.ReactNode }) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6,
        backgroundColor: active ? MIDI_VIOLET : 'transparent',
        borderWidth: 1, borderColor: active ? MIDI_VIOLET : C.ghostBorder,
      }}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: active ? '#fff' : C.text, letterSpacing: 0.5 }}>
        {children}
      </Text>
    </TouchableOpacity>
  );
}

function NumberInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const C = usePalette();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={C.secondary}
      keyboardType="numbers-and-punctuation"
      style={{
        flex: 1, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6,
        borderWidth: 1, borderColor: C.ghostBorder, color: C.text,
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12,
      }}
    />
  );
}
