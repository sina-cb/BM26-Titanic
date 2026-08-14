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
  Modal, Pressable, ScrollView, Text, TouchableOpacity, View,
} from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { engineEvents } from '@/utils/engineEvents';
import { armMidiLearn, midiControlConflict, midiControlLearnedConflict } from '@/hooks/useMidiControl';
import { usePerfLock } from '@/hooks/usePerformanceMode';
import { describeControlRef, MidiControlRef } from '@/utils/midi';
import {
  clampToRangeLimit, deleteMidiMapping, fetchPlaylist, MidiMapping,
  patchMidiMapping, putMidiMapping,
} from '@/utils/api';
import { SectionLabel, Chip, NumberInput } from '@/components/ui/PopoverKit';
import { ParamChip, useParamRowMetrics } from '@/components/ui/param_chips';

// Violet accent — distinct from modulation's green (◎) and the primary blue
// (interactive control), so "this param is MIDI-mapped" scans at a glance.
const MIDI_VIOLET = '#7c5cff';

// ── shared per-entry binding fetch ──────────────────────────────────────────
//
// Modulations and MIDI mappings are stored the same way (a per-entry array on
// the playlist) and fetched the same way, so both share this generic hook.
// `pluck` selects the array off an entry; `transform` optionally maps each
// loaded item (modulations use it for the legacy mode migration).

export function useEntryBindings<T>(
  playlistName: string | null | undefined,
  entryId: string | null | undefined,
  pluck: (entry: Record<string, unknown>) => T[] | undefined,
  transform?: (item: T) => T,
): { items: T[]; refresh: () => void } {
  const [items, setItems] = useState<T[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!playlistName || !entryId) { setItems([]); return; }
    let cancelled = false;
    // Use the cached `fetchPlaylist` (5 s TTL, deduped, primed by engine WS
    // broadcasts) — this hook may be called from N mixer channel strips
    // simultaneously, so an uncached fetch per strip would hammer the engine on
    // channel-add bursts.
    fetchPlaylist(playlistName).then((r) => {
      if (cancelled) return;
      if (!r.ok || !r.data) { setItems([]); return; }
      const entries = r.data.entries as unknown as Record<string, unknown>[] | undefined;
      const entry = Array.isArray(entries) ? entries.find((e) => e && e.id === entryId) : null;
      const loaded = entry ? (pluck(entry) ?? []) : [];
      setItems(transform ? loaded.map(transform) : loaded);
    });
    return () => { cancelled = true; };
    // pluck / transform are defined inline by callers; keep the dep list on the
    // primitive inputs so the caller needn't memoise them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistName, entryId, tick]);

  // Re-fetch on playlistSaved for our playlist so external mutations (other
  // CaptainPad sessions, PortWatch, REST) update the panel.
  useEffect(() => {
    return engineEvents.subscribe((m: { type?: string; name?: string }) => {
      if (m && m.type === 'playlistSaved' && m.name === playlistName) refresh();
    });
  }, [playlistName, refresh]);

  return { items, refresh };
}

export function useEntryMidiMappings(
  playlistName: string | null | undefined,
  entryId: string | null | undefined,
): { mappings: MidiMapping[]; refresh: () => void } {
  const { items, refresh } = useEntryBindings<MidiMapping>(
    playlistName, entryId,
    (entry) => entry.midiMappings as MidiMapping[] | undefined,
  );
  return { mappings: items, refresh };
}

// ── MidiMapBadge — the ⊞ pill in a slider header ────────────────────────────

export function MidiMapBadge({
  mapping, editable, onEdit,
}: {
  mapping: MidiMapping | null;
  editable: boolean;
  onEdit?: () => void;
}) {
  // PERFORMANCE MODE: MIDI mappings live in the playlist file — creating or
  // editing one is a 409-gated route (PUT/PATCH .../midi-mappings/:id) while a
  // show is live. The violet mapped pill keeps reading as "mapped"; the edit
  // affordance goes inert. Shared component — gated by performance-mode state.
  const perfLocked = usePerfLock();
  // Row metrics (hooks run on every path, before the early return below).
  const m = useParamRowMetrics();
  const hasMapping = !!mapping;
  const effEditable = editable && !perfLocked;
  const canEdit = effEditable && !!onEdit;
  // On a read-only surface (mixer, or ANY surface while performance mode is
  // live) with no mapping there's nothing to show — hide the add affordance
  // rather than render an inert pill that doesn't read as locked. A MAPPED
  // pill stays visible (it's live status), just not editable.
  if (!hasMapping && !effEditable) return null;
  // The UNMAPPED add-hint is the glyph alone. It used to read '⊞ MIDI', which
  // cost ~25 px of a ~244 px deck row for a word that says nothing the glyph
  // and the accessibility label don't — and the row's job is to leave that
  // space to the parameter's NAME (_190).
  const label = hasMapping ? `⊞ ${describeControlRef(mapping!.control)}` : '⊞';
  return (
    <ParamChip
      label={label}
      accent={MIDI_VIOLET}
      // A MAPPED chip is live status → filled violet. The add-hint stays quiet:
      // it must not compete with the ♪ suggestion chip beside it.
      tone={hasMapping ? 'live' : 'quiet'}
      onPress={canEdit ? onEdit : undefined}
      accessibilityLabel={hasMapping
        ? `Edit MIDI mapping — ${describeControlRef(mapping!.control)}`
        : 'Add MIDI mapping'}
      style={m.compact && hasMapping ? { maxWidth: 62 } : undefined}
    />
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
  // Holds the in-flight learn's cancel fn so unmount / re-arm can cancel it
  // cleanly (scoped so a stale arm can't cancel a newer one — see LearnController).
  const cancelLearnRef = useRef<(() => void) | null>(null);

  const isExisting = existing !== null;
  // One binding per param → derive a stable id from the target so re-learning
  // the same param overwrites cleanly (PUT replaces by id).
  const mappingId = useMemo(() => existing?.id ?? `midi_${targetParameter}`, [existing, targetParameter]);

  useEffect(() => () => { cancelLearnRef.current?.(); }, []);

  const startLearn = useCallback(() => {
    cancelLearnRef.current?.();
    setError(null);
    setListening(true);
    // armMidiLearn fires ONCE with { ref } (captured) or { error } (control is
    // already mapped to a profile action, or MIDI unavailable). The popover
    // owns cancellation, so there is no timeout.
    cancelLearnRef.current = armMidiLearn((r) => {
      setListening(false);
      cancelLearnRef.current = null;
      if ('ref' in r) setControl(r.ref);
      else setError(r.error);
    });
  }, []);

  const stopLearn = useCallback(() => {
    cancelLearnRef.current?.();
    cancelLearnRef.current = null;
    setListening(false);
  }, []);

  const save = async () => {
    if (busy) return;
    if (!control) { setError('Move a fader to bind a control first.'); return; }
    // Belt-and-braces (plan §1.1): refuse to persist a control that already
    // resolves to a static profile action, in case a stale captured ref slipped
    // through the runtime's capture-time rejection.
    const conflict = midiControlConflict(control);
    if (conflict) { setError(conflict); return; }
    // One-per-control (P2-2, save side): refuse to persist a control that another
    // ENABLED learned binding already owns (bound to a DIFFERENT param) — else one
    // fader would silently drive two params. Re-learning THIS param is a clean
    // replace and is excluded. The sibling runtime enforces the same at capture.
    const learnedConflict = midiControlLearnedConflict(control, targetParameter);
    if (learnedConflict) { setError(learnedConflict); return; }
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
      range: [clampToRangeLimit(lo), clampToRangeLimit(hi)],
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
                  <Chip active accent={MIDI_VIOLET} onPress={stopLearn}>CANCEL LISTENING</Chip>
                </>
              ) : (
                <Chip active={false} accent={MIDI_VIOLET} onPress={startLearn}>
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
              <Chip active={enabled} accent={MIDI_VIOLET} onPress={() => setEnabled(!enabled)}>
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
