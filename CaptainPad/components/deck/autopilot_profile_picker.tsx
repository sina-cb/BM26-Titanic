/**
 * autopilot_profile_picker — the DECK "AUTOPILOT PATTERNS" profile dropdown.
 *
 * The deck autopilot is a set of named PROFILES (engine `playlist.autopilot.
 * profile`): `random` (today's shuffle/sequential cycling) and `audio_reactive`
 * (pattern/color/tempo driven by the Audio Companion). This control lets the
 * operator pick the active profile.
 *
 * Cloned from the `TransitionStylePicker` idiom in DeckTransitionControls.tsx
 * (the deck's only true dropdown: a tap-to-open <Modal transparent> list with * label+hint rows, current-item highlight, `▾` trigger). Two deliberate * departures from that source: * 1. Colours come from usePalette() tokens ONLY — the source hard-coded * `rgba(95,35,199,…)` washes; per .agent/os/ui_design.md we never copy * hex literals. Since docs/54 both surfaces now use the SHARED * `accentWash(primary)` on-state, so the two dropdowns are one control * with two lists rather than two look-alikes. * 2. The trigger is `minHeight:44` (the deck's 44pt touch floor). * * Presentational only — props in, `onSelect(id)` out. The parent (index.tsx) * owns the live `profile`/`profiles` state (reconciled off the `autopilot` WS * broadcast) and does the optimistic POST + rollback. */ import React, { useState } from 'react'; import { Text, TouchableOpacity, ScrollView, Modal, Pressable } from 'react-native'; import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation'; import { usePalette } from '@/hooks/use-theme'; import { accentWash, useGlobalStyles } from '@/styles/globalStyles'; import { Radius } from '@/constants/theme'; /** Per-profile display metadata. Keyed by the engine profile id. An id that is * NOT in this table renders as its raw uppercased id (deterministic — NOT a * silent fallback: the operator sees exactly the id the engine sent). */ const PROFILE_META: Record<string, { label: string; hint: string }> = { random: { label: 'RANDOM', hint: 'Shuffle / sequential cycling (today)' }, audio_reactive: { label: 'AUDIO REACTIVE', hint: 'Pick driven by live audio' }, }; function metaFor(id: string): { label: string; hint: string } { return PROFILE_META[id] ?? { label: id.toUpperCase(), hint: '' }; } export function AutopilotProfilePicker({ profile, profiles, onSelect, disabled, }: { /** Active profile id (engine `playlist.autopilot.profile`). */ profile: string; /** The set of selectable profile ids (engine `AUTOPILOT_PROFILES`). */ profiles: string[]; onSelect: (id: string) => void; disabled?: boolean; }) { const C = usePalette(); const globalStyles = useGlobalStyles(); const [open, setOpen] = useState(false); const currentMeta = metaFor(profile); const on = accentWash(C.primary); return ( <> <TouchableOpacity onPress={() => !disabled && setOpen(true)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Autopilot profile: ${currentMeta.label}`} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, borderRadius: Radius.control, borderWidth: 1, borderColor: disabled ? C.ghostBorder : on.borderColor, backgroundColor: disabled ? 'transparent' : on.backgroundColor, opacity: disabled ? 0.4 : 1, flex: 1, }} > <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: disabled ? C.icon : on.color, letterSpacing: 0.8, flex: 1, }}> {currentMeta.label} </Text> <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: disabled ? C.icon : on.color, }}>▾</Text> </TouchableOpacity> <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)} supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}
          onPress={() => setOpen(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            // The shared `panel` recipe — same modal surface as every other
            // overlay on the deck (docs/54 row 19).
            style={[globalStyles.panel, { width: 320, maxHeight: '80%', padding: 20 }]}
          >
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 14,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14,
            }}>
              Autopilot Profile
            </Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {profiles.map((id) => {
                const active = id === profile;
                const meta = metaFor(id);
                return (
                  <TouchableOpacity
                    key={id}
                    onPress={() => { onSelect(id); setOpen(false); }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 12,
                      minHeight: 44, justifyContent: 'center',
                      borderRadius: Radius.control, marginBottom: 6,
                      backgroundColor: active ? on.backgroundColor : 'transparent',
                      borderWidth: 1, borderColor: active ? C.borderStrong : C.ghostBorder,
                    }}
                  >
                    <Text style={{
                      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13,
                      color: active ? on.color : C.text, letterSpacing: 0.8,
                    }}>
                      {meta.label}
                    </Text>
                    {meta.hint ? (
                      <Text style={{
                        fontFamily: 'Inter_400Regular', fontSize: 11,
                        color: C.secondary, marginTop: 2,
                      }}>
                        {meta.hint}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
