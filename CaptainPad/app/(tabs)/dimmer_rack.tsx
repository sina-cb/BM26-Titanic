import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, AppState, Modal, ScrollView } from 'react-native';
import { useGlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { NauticalFader } from '@/components/NauticalFader';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import {
  setSectionBrightness, fetchDimmers, fetchDimmerGroups,
  fetchGroupFixedColors, setGroupFixedColor, clearGroupFixedColor,
  GroupFixedColorOverride,
} from '@/utils/api';
import { RigContext } from '@/components/RigGlobals';
import { engineEvents } from '@/utils/engineEvents';

const BypassCheckbox = ({ effectId, label }: { effectId: string, label: string }) => {
  const C = usePalette();
  const { effects, toggleEffect } = useContext(RigContext);
  const isOn = !!effects[effectId];
  return (
    <TouchableOpacity onPress={() => toggleEffect(effectId, false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: isOn ? C.primary : C.ghostBorder, backgroundColor: isOn ? C.primary : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
        {isOn && <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>✓</Text>}
      </View>
      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: C.secondary }}>{label}</Text>
    </TouchableOpacity>
  );
};

/** Convert group name to a human-readable label */
function groupLabel(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toUpperCase();
}

// ── Fixed-color helpers (docs/32) ───────────────────────────────────────
// House picker policy (see ColorPickerModal): hue-only, S/V pinned to
// 100%. The engine API is full RGBWAU; the rack writes pure-hue RGB
// with W/A/U at 0 and a separate brightness.

function hueToRgb(h: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;
  switch (i % 6) {
    case 0: r = 1; g = f; b = 0; break;
    case 1: r = q; g = 1; b = 0; break;
    case 2: r = 0; g = 1; b = f; break;
    case 3: r = 0; g = q; b = 1; break;
    case 4: r = f; g = 0; b = 1; break;
    case 5: r = 1; g = 0; b = q; break;
  }
  return [r, g, b];
}

/** Inverse of hueToRgb for re-opening the editor on a stored override. */
function rgbToHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  return h < 0 ? h + 1 : h;
}

function hueToRgbString(h: number): string {
  const [r, g, b] = hueToRgb(h);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

/** CSS color for a stored override's RGB channels (chip swatch dots). */
function overrideRgbString(color: number[]): string {
  return `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
}

/**
 * Editor modal for one group's fixed-color override. Engine truth flows
 * back via the `groupFixedColors` WS broadcast after APPLY/CLEAR — the
 * modal itself never mutates the parent's table optimistically.
 */
function GroupFixedColorModal({ group, override, onClose }: {
  group: string;
  override: GroupFixedColorOverride | null;
  onClose: () => void;
}) {
  const C = usePalette();
  const [hue, setHue] = useState(() => (override ? rgbToHue(override.color[0], override.color[1], override.color[2]) : 0.9));
  const [brightness, setBrightness] = useState(() => (override ? override.brightness : 0.5));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    setBusy(true);
    const [r, g, b] = hueToRgb(hue);
    const res = await setGroupFixedColor(group, [r, g, b, 0, 0, 0], brightness);
    setBusy(false);
    if (!res.ok) { setError(res.error || 'Apply failed'); return; }
    onClose();
  };

  const clear = async () => {
    setBusy(true);
    const res = await clearGroupFixedColor(group);
    setBusy(false);
    if (!res.ok) { setError(res.error || 'Clear failed'); return; }
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: 380, backgroundColor: C.surfaceContainerLowest, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder }}>
          {/* Header: group name + live preview swatch */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 14, textTransform: 'uppercase' }}>
              {groupLabel(group)} — FIXED COLOR
            </Text>
            <View style={{
              width: 44, height: 44, borderRadius: 22,
              borderWidth: 2, borderColor: C.ghostBorder,
              backgroundColor: hueToRgbString(hue),
              opacity: 0.25 + brightness * 0.75,
            }} />
          </View>

          {/* Hue slider */}
          <View style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10, textTransform: 'uppercase' }}>Colour</Text>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10 }}>{Math.round(hue * 360)}°</Text>
            </View>
            <HorizontalFader
              value={hue}
              onChange={(v: number) => setHue(v)}
              trackStyle={{ height: 24, backgroundColor: C.surfaceContainerHigh, borderRadius: 12 }}
              fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: hueToRgbString(hue), borderRadius: 12 }}
            />
          </View>

          {/* Brightness slider */}
          <View style={{ marginBottom: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10, textTransform: 'uppercase' }}>Brightness</Text>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10 }}>{Math.round(brightness * 100)}%</Text>
            </View>
            <HorizontalFader
              value={brightness}
              onChange={(v: number) => setBrightness(v)}
              trackStyle={{ height: 24, backgroundColor: C.surfaceContainerHigh, borderRadius: 12 }}
              fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primary, borderRadius: 12 }}
            />
          </View>

          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon, marginBottom: 4 }}>
            Locks this group to the chosen colour. Section faders and blackout still apply on top.
          </Text>

          {error ? (
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.error, marginTop: 4 }} numberOfLines={3}>
              {error}
            </Text>
          ) : null}

          {/* Footer actions */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, alignItems: 'center' }}>
            <TouchableOpacity onPress={onClose} style={{ padding: 12 }} disabled={busy}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary }}>CANCEL</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              {override ? (
                <TouchableOpacity
                  onPress={clear}
                  disabled={busy}
                  style={{ paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: C.error }}
                >
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error }}>CLEAR</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={apply}
                disabled={busy}
                style={{ backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, opacity: busy ? 0.5 : 1 }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000' }}>APPLY</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function DimmerRackScreen() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const { blackout: isBlackout, toggleBlackout } = useContext(RigContext);
  const [dimmerStates, setDimmerStates] = useState<Record<string, number>>({});
  const [groups, setGroups] = useState<Record<string, number>>({});
  // Tri-state: 'loading' on first attempt, 'ready' after any response
  // (success OR failure), 'error' when the engine is offline so the
  // operator gets a Retry button instead of a stuck spinner. Earlier
  // we used a plain boolean and forgot to flip it inside a try/finally,
  // which meant any rejected promise (e.g. engine offline at app boot)
  // left the rack permanently stuck on "Loading dimmer groups…".
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [lastError, setLastError] = useState<string>('');

  // ── Group fixed colors (docs/32 §2.6) ────────────────────────────────
  // Chip strip state. `fcGroups` is the model's group list (picker
  // source, from GET /group-fixed-colors); `fcOverrides` is engine
  // truth for the active locks — updated by the `groupFixedColors` WS
  // broadcast and by explicit refetches, never optimistically.
  const [fcGroups, setFcGroups] = useState<string[]>([]);
  const [fcOverrides, setFcOverrides] = useState<Record<string, GroupFixedColorOverride>>({});
  const [fcEditing, setFcEditing] = useState<string | null>(null);

  const refreshFixedColors = useCallback(async () => {
    const res = await fetchGroupFixedColors();
    if (res.ok && res.data) {
      setFcGroups(res.data.groups);
      setFcOverrides(res.data.overrides);
    }
  }, []);

  // Live mirror: every PUT/DELETE on any CaptainPad makes the engine
  // broadcast the whole table on /ws/control.
  useEffect(() => {
    const unsub = engineEvents.subscribe((msg) => {
      if (msg.type === 'groupFixedColors' && msg.overrides && typeof msg.overrides === 'object') {
        setFcOverrides(msg.overrides as Record<string, GroupFixedColorOverride>);
      }
    });
    return unsub;
  }, []);

  const refreshGroups = useCallback(async () => {
    let okAny = false;
    let err = '';
    try {
      const [groupsResult, dimmersResult] = await Promise.all([
        fetchDimmerGroups(),
        fetchDimmers(),
      ]);
      if (groupsResult.ok && groupsResult.data) {
        setGroups(groupsResult.data);
        okAny = true;
      } else if (groupsResult.error) {
        err = groupsResult.error;
      }
      if (dimmersResult.ok && dimmersResult.data) {
        setDimmerStates(dimmersResult.data);
        okAny = true;
      } else if (dimmersResult.error && !err) {
        err = dimmersResult.error;
      }
    } catch (e: any) {
      // Belt-and-braces: api helpers already swallow errors, but if
      // anything ever throws here we must still flip out of 'loading'.
      err = e?.message || String(e);
    } finally {
      setLastError(err);
      setLoadState(okAny ? 'ready' : 'error');
    }
  }, []);

  useEffect(() => {
    refreshGroups();
    refreshFixedColors();

    // Refresh when app/tab comes to foreground
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { refreshGroups(); refreshFixedColors(); }
    });

    return () => sub.remove();
  }, [refreshGroups, refreshFixedColors]);
  
  const handleDimmerChange = (id: number, val: number) => {
    setSectionBrightness(id, val);
  };

  const groupEntries = Object.entries(groups);

  // Build sectionId -> [groupNames] so we can flag faders that share a section.
  // Multiple group names mapping to the same sectionId is a real (if rare)
  // outcome of the engine's /dimmer-groups endpoint, which dedupes by group
  // name but not by section. Each such fader still controls its section, so we
  // render all of them and mark them as linked to their siblings.
  const sectionIdToNames: Record<number, string[]> = {};
  for (const [name, sectionId] of groupEntries) {
    if (!sectionIdToNames[sectionId]) sectionIdToNames[sectionId] = [];
    sectionIdToNames[sectionId].push(name);
  }

  return (
    <View style={[globalStyles.container, { padding: 32, flexDirection: 'column' }]}>
        
      {/* Header */}
      <View style={{ alignItems: 'center', marginBottom: 24, gap: 8 }}>
         <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
           <IconSymbol name="lightbulb.fill" size={36} color={C.primary} />
           <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 32, color: C.text, letterSpacing: 2 }}>
             DIMMER RACK
           </Text>
         </View>
         <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: C.secondary, textAlign: 'center' }}>
           GLOBAL SECTION CONTROL AND PATTERN SCALING
         </Text>
      </View>
         
      {/* Global Blackout */}
      <TouchableOpacity 
         onPress={toggleBlackout} 
         style={{ 
           alignSelf: 'stretch',
           backgroundColor: isBlackout ? C.surfaceContainerHigh : C.error, 
           height: 64, 
           borderRadius: 16, 
           justifyContent: 'center', 
           alignItems: 'center', 
           marginBottom: 24,
           borderWidth: isBlackout ? 1 : 0,
           borderColor: isBlackout ? C.ghostBorder : 'transparent',
           ...globalStyles.ambientShadow 
         }}
      >
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, color: isBlackout ? C.text : '#FFF', letterSpacing: 2 }}>
          {isBlackout ? 'RESTORE RIG' : 'GLOBAL BLACKOUT'}
        </Text>
      </TouchableOpacity>

      {/* Bypass Toggles */}
      <View style={{ flexDirection: 'row', gap: 32, marginBottom: 24, paddingHorizontal: 16 }}>
        <BypassCheckbox effectId="uvBlastBypassDimmer" label="UV BLAST BYPASS" />
        <BypassCheckbox effectId="vintageWhiteBypassDimmer" label="VINTAGE WHT BYPASS" />
        <BypassCheckbox effectId="blastWhiteBypassDimmer" label="BLAST WHT BYPASS" />
      </View>

      {/* Fixed Colors strip (docs/32 §2.6) — one chip per model group.
          Active chips carry a swatch dot in the locked color; tapping
          any chip opens the editor modal. */}
      {fcGroups.length > 0 && (
        <View style={{ marginBottom: 24, paddingHorizontal: 16 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary, letterSpacing: 1.5, marginBottom: 8 }}>
            FIXED COLORS
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {fcGroups.map((name) => {
              const ov = fcOverrides[name];
              const active = !!ov;
              return (
                <TouchableOpacity
                  key={name}
                  onPress={() => setFcEditing(name)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 8,
                    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18,
                    borderWidth: 1,
                    borderColor: active ? overrideRgbString(ov.color) : C.ghostBorder,
                    backgroundColor: active ? C.surfaceContainerHigh : 'transparent',
                    opacity: active ? 1 : 0.55,
                  }}
                >
                  <View style={{
                    width: 14, height: 14, borderRadius: 7,
                    borderWidth: 1, borderColor: C.ghostBorder,
                    backgroundColor: active ? overrideRgbString(ov.color) : 'transparent',
                    opacity: active ? 0.25 + ov.brightness * 0.75 : 1,
                  }} />
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: active ? C.text : C.secondary, letterSpacing: 0.5 }}>
                    {groupLabel(name)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Main Fader Area (Takes remaining space) */}
      <View style={[globalStyles.card, { flex: 1, padding: 32, justifyContent: 'center' }]}>
        {loadState === 'loading' && (
          <View style={{ alignItems: 'center', gap: 16 }}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 16, color: C.secondary }}>
              Loading dimmer groups...
            </Text>
          </View>
        )}

        {loadState === 'error' && (
          <View style={{ alignItems: 'center', gap: 16 }}>
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 20, color: C.error }}>
              Engine offline
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary, textAlign: 'center', opacity: 0.7, maxWidth: 400 }}>
              {lastError || 'Could not reach the engine to load dimmer groups.'}
            </Text>
            <TouchableOpacity
              onPress={() => { setLoadState('loading'); refreshGroups(); }}
              style={{ marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder }}
            >
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 12, letterSpacing: 1 }}>RETRY</Text>
            </TouchableOpacity>
          </View>
        )}

        {loadState === 'ready' && groupEntries.length === 0 && (
          <View style={{ alignItems: 'center', gap: 16 }}>
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 20, color: C.secondary }}>
              No Dimmer Groups Found
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: C.secondary, textAlign: 'center', opacity: 0.7, maxWidth: 400 }}>
              Auto-patch your fixtures in the simulation to generate section groups, then re-export the model.
            </Text>
          </View>
        )}

        {loadState === 'ready' && groupEntries.length > 0 && (
          <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', flexWrap: 'wrap', gap: 32 }}>
            {groupEntries.map(([name, sectionId]) => {
              const siblings = (sectionIdToNames[sectionId] || []).filter((n) => n !== name);
              const isLinked = siblings.length > 0;
              return (
                // Key by group name (always unique — it's the object key) instead
                // of sectionId. Multiple group-name aliases can legitimately point
                // at the same physical section in the model, which collides on
                // key={sectionId} and produces React duplicate-key warnings.
                <View
                  key={name}
                  style={{
                    alignItems: 'center',
                    paddingHorizontal: isLinked ? 12 : 0,
                    paddingVertical: isLinked ? 8 : 0,
                    borderRadius: isLinked ? 12 : 0,
                    borderWidth: isLinked ? 1 : 0,
                    borderColor: isLinked ? C.primary : 'transparent',
                    borderStyle: 'dashed',
                    backgroundColor: isLinked ? C.surfaceContainerHigh : 'transparent',
                  }}
                >
                  <NauticalFader
                    id={sectionId}
                    label={groupLabel(name)}
                    initialValue={dimmerStates[String(sectionId)] ?? 1.0}
                    min={0}
                    max={1.0}
                    onChange={handleDimmerChange}
                  />
                  {isLinked && (
                    <View style={{ marginTop: 8, alignItems: 'center', maxWidth: 140 }}>
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.primary, letterSpacing: 1 }}>
                        {`\u{1F517} SHARES SECTION ${sectionId}`}
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={{ marginTop: 2, fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary, textAlign: 'center', opacity: 0.85 }}
                      >
                        {siblings.map(groupLabel).join(', ')}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Fixed-color editor — engine truth comes back via the WS
          broadcast; the close-time refetch converges the chips even
          when /ws/control is down (still engine truth, not optimism). */}
      {fcEditing !== null && (
        <GroupFixedColorModal
          group={fcEditing}
          override={fcOverrides[fcEditing] ?? null}
          onClose={() => { setFcEditing(null); refreshFixedColors(); }}
        />
      )}

    </View>
  );
}
