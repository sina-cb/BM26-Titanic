// AllModulationsPanel — floating "ALL MODULATIONS" overview for the
// deck's currently-loaded playlist.
//
// Spec (D6, May 2026):
//   - Modal overlay with backdrop-tap close.
//   - Scrollable body using FlatList so 50+ entries × 5+ mappings each
//     render smoothly.
//   - Per-entry section: pattern name + ACTIVE marker + ● LIVE dot if
//     the entry is currently active AND modulationState has a non-
//     empty parameters map.
//   - Per-mapping row: ◎ filled/hollow, target ← source short names,
//     mode/polarity badge, range readout, curve name.
//   - Long-press row → enable/disable toggle via patchModulation.
//   - Trash icon → delete with confirm.
//   - Tap row → navigate the deck to that entry AND open the
//     ModulationPopover for that target. Uses option (a) from the
//     brief: render the popover here in the panel.
//   - Empty entry: "(no modulations)"; empty playlist: large empty
//     state with hint.
//
// Data source: fetchPlaylistByName(deckPlaylist.name) on open, plus a
// playlistSaved WS re-fetch filter. The live dot uses useModulationState().

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  deleteModulation, fetchPlaylistByName, migrateModulationMode, ModulationMapping, patchModulation,
  setChannelPlaylistEntry,
} from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';
import {
  ModulationPopover, MOD_GREEN, useModulationState,
} from '@/components/Modulation';

type Props = {
  visible: boolean;
  onClose: () => void;
  playlistName: string | null;
  activeEntryId: string | null;
};

type Entry = {
  id: string;
  pattern: string;
  label: string | null;
  modulations?: ModulationMapping[];
};

type EditTarget = {
  entryId: string;
  mapping: ModulationMapping;
};

// Pretty label for a modulation source key. The audio source family is
// dynamic (the Companion routes its own set into the CPC), so we derive a
// readable label from the key shape rather than a hand-listed switch (which
// drifted — it still named the retired stems). `micLow` → `MIC LOW`,
// `audioEnergyRatio` → `AUDIO ENERGY RATIO`, etc.
function shortSource(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function shortTarget(name: string): string {
  return name
    .replace(/^(slider|toggle|trigger|hsvPicker)/i, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toUpperCase()
    .substring(0, 20);
}

function rangeReadout(m: ModulationMapping): string {
  // The ± collapse only makes sense for BIPOLAR OFFSET — polarity has no
  // effect on multiply/override (the engine ignores it), so those always
  // show the literal [min → max] window.
  if (m.mode === 'offset' && m.polarity === 'bipolar') {
    const mag = Math.max(Math.abs(m.range[0]), Math.abs(m.range[1]));
    return `[±${mag.toFixed(2)}]`;
  }
  return `[${m.range[0].toFixed(2)} → ${m.range[1].toFixed(2)}]`;
}

export const AllModulationsPanel: React.FC<Props> = ({
  visible, onClose, playlistName, activeEntryId,
}) => {
  const C = usePalette();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tick, setTick] = useState(0);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const modulationLive = useModulationState();
  const liveActive = Object.keys(modulationLive).length > 0;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Initial / on-tick fetch.
  useEffect(() => {
    if (!visible || !playlistName) { setEntries([]); return; }
    let cancelled = false;
    fetchPlaylistByName(playlistName).then((r) => {
      if (cancelled) return;
      if (!r.ok || !r.data) { setEntries([]); return; }
      const raw = (r.data.entries || []) as any[];
      setEntries(raw.map((e) => ({
        id: e.id,
        pattern: e.pattern,
        label: e.label ?? null,
        // Migrate the legacy 'scale' mode → 'multiply' on read (mirrors the
        // engine + the deck popover) so the readout never shows a dead mode.
        modulations: Array.isArray(e.modulations)
          ? e.modulations.map((m: ModulationMapping) => ({ ...m, mode: migrateModulationMode(m.mode) }))
          : [],
      })));
    });
    return () => { cancelled = true; };
  }, [visible, playlistName, tick]);

  // Re-fetch on playlistSaved for our playlist (engine broadcasts
  // every CRUD round-trip and every disk save).
  useEffect(() => {
    if (!visible || !playlistName) return;
    return engineEvents.subscribe((m) => {
      if (m && m.type === 'playlistSaved' && m.name === playlistName) refresh();
    });
  }, [visible, playlistName, refresh]);

  // Hide playlist entries that have no modulations — operator wants the
  // panel to be a focused index of what's actually wired up, not a
  // mirror of the whole playlist. Footer totals reflect this filtered
  // view so the count matches what's on screen.
  const visibleEntries = useMemo(
    () => entries.filter((e) => Array.isArray(e.modulations) && e.modulations.length > 0),
    [entries],
  );

  const totals = useMemo(() => {
    let mappings = 0;
    let live = 0;
    for (const e of visibleEntries) {
      const mods = e.modulations || [];
      mappings += mods.length;
      if (e.id === activeEntryId && liveActive) {
        live += mods.filter((m) => m.enabled).length;
      }
    }
    return { entries: visibleEntries.length, mappings, live };
  }, [visibleEntries, activeEntryId, liveActive]);

  const navigateToEntry = useCallback(async (entryId: string) => {
    if (!playlistName) return;
    await setChannelPlaylistEntry('deck', '', entryId);
    // playlistSaved is not what fires here — the engine emits a deck
    // event. The popover will still work because it operates against
    // playlist disk state, which is unchanged by the navigation.
  }, [playlistName]);

  const handleRowTap = useCallback((entry: Entry, m: ModulationMapping) => {
    // Navigate the deck to this entry, then open the popover. The
    // engine accepts the popover edit even if the deck is mid-
    // transition; the worst case is that the operator sees the
    // popover open before the deck visually lands on the entry.
    navigateToEntry(entry.id);
    setEditTarget({ entryId: entry.id, mapping: m });
  }, [navigateToEntry]);

  const handleToggle = useCallback(async (entryId: string, m: ModulationMapping) => {
    if (!playlistName) return;
    await patchModulation(playlistName, entryId, m.id, { enabled: !m.enabled });
    refresh();
  }, [playlistName, refresh]);

  // No confirmation dialog — operator can quickly trim mappings during
  // a set. A wrongly-deleted mapping is one tap on the slider's ◎ to
  // recreate; the friction of a modal dialog was not worth the safety.
  const handleDelete = useCallback(async (entryId: string, m: ModulationMapping) => {
    if (!playlistName) return;
    await deleteModulation(playlistName, entryId, m.id);
    refresh();
  }, [playlistName, refresh]);

  // Bulk-clear all mappings on an entry. The engine exposes no bulk
  // DELETE endpoint (see api_server.js: only /modulations/:mappingId
  // is wired), so we fan out one DELETE per mapping in parallel.
  // Same no-confirm convention as handleDelete — accidentally clearing
  // is recoverable by tapping the per-slider ◎ to recreate.
  const handleClearAll = useCallback(async (entryId: string, mappings: ModulationMapping[]) => {
    if (!playlistName || mappings.length === 0) return;
    await Promise.all(
      mappings.map((m) => deleteModulation(playlistName, entryId, m.id)),
    );
    refresh();
  }, [playlistName, refresh]);

  const renderEntry = useCallback(({ item: entry }: { item: Entry }) => {
    const mods = entry.modulations || [];
    const isActive = entry.id === activeEntryId;
    return (
      <View style={{
        marginBottom: 10,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: isActive ? MOD_GREEN : C.ghostBorder,
        backgroundColor: C.surfaceContainerHigh,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text,
            textTransform: 'uppercase', letterSpacing: 0.5, flex: 1,
          }} numberOfLines={1}>
            {entry.label || entry.pattern}
            {entry.label ? (
              <Text style={{ color: C.secondary, fontSize: 10 }}>  · {entry.pattern}</Text>
            ) : null}
          </Text>
          {isActive ? (
            <View style={{
              paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4,
              backgroundColor: MOD_GREEN,
            }}>
              <Text style={{ color: '#fff', fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 0.5 }}>ACTIVE</Text>
            </View>
          ) : null}
          {isActive && liveActive ? (
            <View style={{
              width: 8, height: 8, borderRadius: 4, backgroundColor: MOD_GREEN,
            }} />
          ) : null}
          {/* CLEAR ALL is always shown for visible entries — the panel
              filter upstream guarantees mods.length > 0 here. */}
          <TouchableOpacity
            onPress={() => handleClearAll(entry.id, mods)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityLabel={`Clear all modulations on ${entry.label || entry.pattern}`}
            style={{
              paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
              borderWidth: 1, borderColor: C.error,
              backgroundColor: 'transparent',
            }}
          >
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.error,
              letterSpacing: 0.6,
            }}>
              CLEAR ALL
            </Text>
          </TouchableOpacity>
        </View>

        {mods.map((m) => (
          <ModulationRow
            key={m.id}
            mapping={m}
            onTap={() => handleRowTap(entry, m)}
            onToggle={() => handleToggle(entry.id, m)}
            onDelete={() => handleDelete(entry.id, m)}
          />
        ))}
      </View>
    );
  }, [activeEntryId, liveActive, handleRowTap, handleToggle, handleDelete, handleClearAll]);

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}
      >
        {/* Backdrop layer — sibling, BEHIND the panel via render order.
            Tapping anywhere outside the panel closes the modal. Tapping
            on the panel View doesn't reach this because the panel is a
            later sibling drawn on top and is opaque. Keeping the panel
            as a plain View (not Pressable) avoids RN's Pressable
            claiming the responder up-front and starving the inner
            FlatList of pan-scroll gestures. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close all-modulations panel (backdrop)"
        />
        <View
          style={{
            width: 700,
            maxWidth: '95%',
            // Definite height (not maxHeight) so the body FlatList has
            // a measurable parent to `flex: 1` into. With only maxHeight,
            // the column shrinks to fit its children and a flex:1 child
            // collapses to ~0px — visible as "the list is empty even
            // though entries exist".
            height: '80%',
            backgroundColor: C.surfaceContainerLowest,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: C.ghostBorder,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 16, paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: C.ghostBorder,
          }}>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', color: MOD_GREEN, fontSize: 14,
              letterSpacing: 1, flex: 1,
            }} numberOfLines={1}>
              ◎ ALL MODULATIONS{playlistName ? ` — ${playlistName.toUpperCase()}` : ''}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Close all-modulations panel"
              style={{
                paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
                borderWidth: 1, borderColor: C.ghostBorder,
              }}
            >
              <Text style={{ color: C.text, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11 }}>CLOSE</Text>
            </TouchableOpacity>
          </View>

          {/* Body */}
          {!playlistName ? (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.secondary,
                textAlign: 'center',
              }}>
                No playlist loaded on the deck.
              </Text>
            </View>
          ) : totals.mappings === 0 ? (
            <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text,
                textAlign: 'center',
              }}>
                No modulations in this playlist.
              </Text>
              <Text style={{
                fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary,
                textAlign: 'center',
              }}>
                Pick a slider on the deck and tap ◎ to add one.
              </Text>
            </View>
          ) : (
            <FlatList
              data={visibleEntries}
              keyExtractor={(item) => item.id}
              renderItem={renderEntry}
              // `flex: 1` is load-bearing: the outer panel is sized via
              // `maxHeight: '80%'` and `overflow: 'hidden'`, so without
              // an explicit `flex` on the body the FlatList expands to
              // its intrinsic content height and gets clipped instead
              // of scrolling within the panel.
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 12 }}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              removeClippedSubviews
              nestedScrollEnabled
            />
          )}

          {/* Footer */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 16, paddingVertical: 10,
            borderTopWidth: 1, borderTopColor: C.ghostBorder,
            backgroundColor: C.surfaceContainerHigh,
          }}>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary,
              letterSpacing: 0.8, flex: 1,
            }}>
              {totals.entries} ENTRIES · {totals.mappings} MAPPINGS · {totals.live} LIVE
            </Text>
          </View>
        </View>
      </View>

      {/* Nested popover when editing a row. Re-uses the same component
          as the deck so behaviour stays in lock-step. */}
      {editTarget && playlistName ? (
        <ModulationPopover
          paramName={shortTarget(editTarget.mapping.target.parameter)}
          targetParameter={editTarget.mapping.target.parameter}
          playlistName={playlistName}
          entryId={editTarget.entryId}
          existing={editTarget.mapping}
          onClose={() => setEditTarget(null)}
          onChanged={refresh}
        />
      ) : null}
    </Modal>
  );
};

// ── Mapping row ────────────────────────────────────────────────────

function ModulationRow({
  mapping, onTap, onToggle, onDelete,
}: {
  mapping: ModulationMapping;
  onTap: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const C = usePalette();
  const enabled = !!mapping.enabled;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingVertical: 6, paddingHorizontal: 4,
      borderTopWidth: 1, borderTopColor: C.ghostBorder,
    }}>
      <TouchableOpacity
        onPress={onTap}
        onLongPress={onToggle}
        delayLongPress={400}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
        accessibilityLabel={`Edit modulation ${mapping.target.parameter}`}
      >
        <View style={{
          width: 14, height: 14, borderRadius: 7,
          backgroundColor: enabled ? MOD_GREEN : 'transparent',
          borderWidth: 1, borderColor: MOD_GREEN,
          alignItems: 'center', justifyContent: 'center',
        }}>
          {enabled ? (
            <Text style={{ color: '#fff', fontSize: 8, lineHeight: 8 }}>●</Text>
          ) : null}
        </View>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text,
          minWidth: 110,
        }} numberOfLines={1}>
          {shortTarget(mapping.target.parameter)}
        </Text>
        <Text style={{ color: C.secondary, fontSize: 11 }}>←</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text,
          minWidth: 90,
        }} numberOfLines={1}>
          {shortSource(mapping.source.key)}
        </Text>
        <View style={{
          paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4,
          // OVERRIDE replaces the static value — call it out with the green
          // `!` styling, same family as the deck's OverrideBadge.
          backgroundColor: mapping.mode === 'override' ? '#00a86b' : C.surfaceContainerLow,
          borderWidth: 1, borderColor: mapping.mode === 'override' ? '#00a86b' : C.ghostBorder,
        }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
            color: mapping.mode === 'override' ? '#fff' : C.secondary,
            letterSpacing: 0.4,
          }}>
            {mapping.mode === 'override'
              ? '! override'
              : mapping.mode === 'multiply'
                ? 'multiply'
                : `offset/${mapping.polarity === 'bipolar' ? 'bip' : 'uni'}`}
          </Text>
        </View>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary,
        }}>
          {rangeReadout(mapping)}
        </Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary,
          letterSpacing: 0.4,
        }}>
          {mapping.curve.toUpperCase()}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onDelete}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityLabel="Delete modulation"
        style={{
          paddingHorizontal: 6, paddingVertical: 4, borderRadius: 4,
          borderWidth: 1, borderColor: C.ghostBorder,
        }}
      >
        <IconSymbol name="trash" size={12} color={C.secondary} />
      </TouchableOpacity>
    </View>
  );
}
