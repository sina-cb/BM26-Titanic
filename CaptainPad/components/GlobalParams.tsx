import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { setDeckChannelControl, sendControl } from '@/utils/api';
import { ToggleButton, MomentaryButton } from '@/components/ui/ToggleButton';
import { MiniFader } from '@/components/ui/MiniFader';
import { useChannelExports, useDeckChannel, MixerChannelExport } from '@/hooks/useEngineState';
import { ModulatedSlider, useEntryModulations, useModulationState, prettySliderName } from '@/components/Modulation';
import { useEntryMidiMappings } from '@/components/MidiMap';
import { engineEvents } from '@/utils/engineEvents';
import { isDeckSaveConfirmation } from '@/components/deck_saved_logic';
import { deriveKnobOrder, type Export } from '@/utils/midi/knob_order';
import { knobBadgeFor } from '@/utils/midi/knob_badge';
import { KnobPill } from '@/components/ui/knob_pill';

export const GlobalParams = ({ variant = 'deck', channelId, exports }: { variant?: 'deck' | 'mixer', channelId?: string, exports?: any[], wsRef?: unknown }) => {
  const C = usePalette();
  // Always read from the centralized engine-state hook so external
  // writers (PortWatch over LoRa, scripts hitting /control directly,
  // …) flow through to the UI without depending on per-tab WS state.
  // The `exports` prop is kept as a fallback for callers that don't
  // know the channelId yet (transient UI states during channel add).
  //
  // Post-channel-split (May 2026): the deck channel is no longer
  // sneakily indexed off `mixerChannels[0]` — it has its own field
  // on the engine-state hook. The BASE PARAMS strip in the mixer
  // variant reads from `deckChannel` directly so we can't
  // accidentally show a mixer overlay's exports there.
  const deckChannel = useDeckChannel();
  const liveDeckExports = useChannelExports(channelId);
  const baseChannelId = deckChannel?.id;
  const liveBaseExports = useChannelExports(baseChannelId);

  // Modulation context for the deck variant. Hooks must run on every
  // render path (mixer + deck), so they live ABOVE the variant
  // branch even though only the deck variant uses the result.
  const deckPlaylist = deckChannel?.playlist as { name?: string; activeEntryId?: string } | undefined;
  const deckPlaylistName = deckPlaylist?.name ?? null;
  const deckEntryId = deckPlaylist?.activeEntryId ?? null;
  const { mappings: entryMappings, refresh: refreshMappings } = useEntryModulations(deckPlaylistName, deckEntryId);
  const { mappings: midiMappings, refresh: refreshMidi } = useEntryMidiMappings(deckPlaylistName, deckEntryId);
  const modulationLive = useModulationState();
  const mappingByTarget: Record<string, any> = {};
  for (const m of entryMappings) mappingByTarget[m.target.parameter] = m;
  const midiByTarget: Record<string, any> = {};
  for (const m of midiMappings) midiByTarget[m.target.parameter] = m;

  if (variant === 'mixer') {
    // BASE-PARAMS strip = the deck base channel's live exports. We
    // intentionally use the WS-driven `mixerChannels` array (not the
    // older one-shot /exports fetch) so changes from PortWatch /
    // CaptainPad's deck tab show up here in real time.
    const baseSliders = liveBaseExports.filter((e: MixerChannelExport) => e.kind === 1);
    if (baseSliders.length === 0) return null;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surfaceContainerLowest, padding: 12, borderBottomWidth: 1, borderBottomColor: C.ghostBorder }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, marginRight: 16, textTransform: 'uppercase' }}>BASE PARAMS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 24, paddingRight: 16 }}>
          {baseSliders.map((exp: MixerChannelExport) => (
            <View key={exp.id} style={{ width: 180 }}>
              <MiniFader
                label={prettySliderName(exp.name)}
                value={exp.v0 !== undefined ? exp.v0 : 0.5}
                onChange={(v: number) => {
                  // Legacy /control endpoint targets the deck base
                  // channel; the engine's broadcast then echoes the
                  // new v0 back so the slider stays in sync without
                  // local optimistic state.
                  sendControl(exp.id, v);
                }}
              />
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // Deck variant — prefer live exports for the given channelId; fall
  // back to the `exports` prop so the component still shows something
  // useful in the brief window between an "add channel" action and the
  // engine's first mixer broadcast.
  const exps: MixerChannelExport[] = liveDeckExports.length > 0 ? liveDeckExports : ((exports as MixerChannelExport[] | undefined) ?? []);
  // #1: render the kind-1 sliders from THE knob order, not a private filter, so
  // the on-screen order IS the physical MFT knob order by construction. Each row
  // carries its physical knob number (or the reason it's excluded), painted as a
  // small badge so the operator can see which encoder drives which slider.
  const sliderRows = deriveKnobOrder(exps as unknown as Export[]).rows;
  const toggles = exps.filter((e: MixerChannelExport) => e.kind === 2);
  const triggers = exps.filter((e: MixerChannelExport) => e.kind === 3);
  const colorPickers = exps.filter((e: MixerChannelExport) => e.kind === 6);

  // Deck local-control writes MUST route through `/deck/channel/control`,
  // not `/mixer/channels/<deckId>/control`. Post-channel-split the
  // engine returns 400 WRONG_ROLE for the latter, so writes silently
  // fail — which is why playlist `defaults` stayed `{}` no matter how
  // much an operator tuned a slider. See `rejectIfWrongRole` in
  // api_server.js.
  const writeLocal = (controlId: number, v0: number, v1?: number, v2?: number) => {
    setDeckChannelControl(controlId, v0, v1, v2);
  };

  if (exps.length === 0) return (
    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10 }}>NO EXPORTS</Text>
  );

  return (
    <View style={{ gap: 12 }}>
      {/* The row-0 GLOBAL knobs (1 SPEED, 2 HUE) are NOT re-legended here —
          their canonical UI elements wear the KNOB badges directly: the
          GLOBALS row SPEED fader (CPCControls) and the deck's DeckHueRow
          (the DECK CHANNEL's per-channel hue — the global shifter is gone).
          (The old read-only MftGlobalsRow duplicate was removed 2026-07 per
          operator request — no duplicate speed/hue UI.) */}
      {/* Saved indicator moved to the deck channel card header (next
          to the ◎ ALL pill) in `app/(tabs)/index.tsx` so it never
          reflows the slider stack when it appears/disappears. The
          `DeckSavedFlash` component is exported from this file. */}
      {sliderRows.map((row) => {
        const e = row.export as any;
        const badge = knobBadgeFor(row);
        // Excluded rows (matched / no-v0) render visually distinct (dimmed) and
        // non-interactive, and — by construction — carry NO knob number, so the
        // operator can see they don't consume a physical encoder. CPC-matched
        // exports were hidden through May 2026; now they're surfaced disabled
        // with a "MATCHED · LABEL" badge. A no-v0 row (rare; the engine now
        // serializes a real v0 for local kinds) shows a subtle "—" not-knob-
        // mapped marker rather than fabricating a 0.5 anchor.
        // 'overflow' (v2 layout: more sliders than the 12 physical local knobs)
        // is NOT in this branch — those rows stay fully TOUCH-editable below,
        // they just render without a KNOB badge.
        if (badge.excludedReason === 'matched' || badge.excludedReason === 'no-v0') {
          const niceName = e.name.replace(/^(slider|toggle|trigger|hsvPicker)/i, '').replace(/([A-Z])/g, ' $1').trim().substring(0, 15);
          return (
            <View key={`slider-${e.id}`} style={{ opacity: 0.5 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, textTransform: 'uppercase' }}>{niceName}</Text>
                  {badge.excludedReason === 'matched'
                    ? <MatchedBadge cpcLabel={e.cpcLabel} />
                    : <NotKnobMappedBadge />}
                </View>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text }}>{(e.v0 ?? 0.5).toFixed(2)}</Text>
              </View>
              <HorizontalFader
                value={e.v0 ?? 0.5}
                onChange={() => {}}
                trackStyle={{ height: 24, backgroundColor: C.surfaceContainerHigh, borderRadius: 12, justifyContent: 'center' }}
                fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.secondary, borderRadius: 12 }}
              />
            </View>
          );
        }
        // Knob-mapped (or knob-less overflow): the ModulatedSlider as before,
        // with a "KNOB N" badge naming the physical encoder when one drives it.
        return (
          <View key={`slider-${e.id}`}>
            {badge.knobNumber !== null
              ? <KnobPill knobNumber={badge.knobNumber} style={{ alignSelf: 'flex-start', marginBottom: 3 }} />
              : null}
            <ModulatedSlider
              exportItem={{ id: e.id, name: e.name, v0: e.v0 }}
              onChangeBase={(val: number) => writeLocal(e.id, val)}
              playlistName={deckPlaylistName}
              entryId={deckEntryId}
              mapping={mappingByTarget[e.name] ?? null}
              live={modulationLive[e.name] ?? null}
              onChanged={refreshMappings}
              midiMapping={midiByTarget[e.name] ?? null}
              onMidiChanged={refreshMidi}
            />
          </View>
        );
      })}
      {colorPickers.map((e: any) => {
        const matched = !!e.cpcOwned;
        return (
          <View key={`color-${e.id}`} style={{ opacity: matched ? 0.5 : 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, textTransform: 'uppercase' }}>HUE</Text>
                {matched ? <MatchedBadge cpcLabel={e.cpcLabel} /> : null}
              </View>
              {/* QA round8 #3: HUE is an angle — show it in degrees ("°")
                  to match the deck HUE row + ColorPickerModal (Math.round(v*360)°)
                  instead of a bare normalized 0.00–1.00, which reads as a
                  cryptic fraction next to the rest of the app's "°" hues. */}
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text }}>{Math.round((e.v0 ?? 0) * 360)}°</Text>
            </View>
            <HorizontalFader
              value={e.v0 ?? 0}
              onChange={matched ? (() => {}) : ((val: number) => writeLocal(e.id, val, e.v1, e.v2))}
              trackStyle={{ height: 8, backgroundColor: C.surfaceContainerHigh, borderRadius: 4, justifyContent: 'center' }}
              fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primaryFixedDim, borderRadius: 4 }}
              thumbStyle={{ position: 'absolute', width: 14, height: 18, backgroundColor: C.surfaceContainerLowest, borderRadius: 4, borderWidth: 1, borderColor: C.ghostBorder, transform: [{ translateX: -7 }] }}
            />
          </View>
        );
      })}
      {/* Only render the toggle/trigger strip when there's something to
          show. An always-present empty flex-wrap row (with its 16px top
          margin) otherwise reserves dead vertical space inside the DECK
          MAIN PARAMETERS card on a slider-only channel (QA round10). */}
      {(toggles.length > 0 || triggers.length > 0) ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 16, gap: 8 }}>
          {toggles.map((e: any) => (
            e.cpcOwned
              ? <MatchedButton key={`toggle-${e.id}`} name={e.name} cpcLabel={e.cpcLabel} />
              : <ToggleButton key={`toggle-${e.id}`} id={e.id} name={e.name} initialValue={e.v0 ?? 0} onChange={(id: number, v: number) => writeLocal(id, v)} />
          ))}
          {triggers.map((e: any) => (
            e.cpcOwned
              ? <MatchedButton key={`trigger-${e.id}`} name={e.name} cpcLabel={e.cpcLabel} />
              : <MomentaryButton key={`trigger-${e.id}`} id={e.id} name={e.name} onChange={(id: number, v: number) => writeLocal(id, v)} />
          ))}
        </View>
      ) : null}
    </View>
  );
};

// ── CPC-matched indicator subcomponents ────────────────────────────────
//
// When a pattern's local export aliases a global (e.g. `sliderSize`
// matches CPC `size`), we surface the export anyway — disabled, with a
// "MATCHED · SIZE" pill — so operators can see what the pattern
// actually declares. The decision to show-instead-of-hide came from the
// May 2026 operator review: hiding silently was confusing because
// patterns *looked* identical even when they declared different sets
// of locals.

// ── Knob-mapping indicators (#1) ────────────────────────────────────────
//
// The on-screen slider order is derived from `deriveKnobOrder` so it IS the
// physical MFT bank-1 knob order. These tiny badges make that visible: a
// "KNOB N" pill (violet, matching the MIDI accent) names the encoder that
// drives a learnable slider; a "—" marker flags a kind-1 export that is NOT
// knob-mapped (no numeric v0), so the operator sees it doesn't consume a knob.

// The "KNOB N" pill itself is the SHARED components/ui/knob_pill.tsx (one
// paint, app-wide) — this file only decides WHICH rows get one (knobBadgeFor).

function NotKnobMappedBadge() {
  const C = usePalette();
  return (
    <View style={{
      paddingHorizontal: 6, paddingVertical: 1,
      borderRadius: 4, backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1, borderColor: C.ghostBorder,
    }}>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8,
        color: C.secondary, letterSpacing: 0.5,
      }} numberOfLines={1}>—</Text>
    </View>
  );
}

function MatchedBadge({ cpcLabel }: { cpcLabel?: string }) {
  const C = usePalette();
  return (
    <View style={{
      paddingHorizontal: 6, paddingVertical: 1,
      borderRadius: 4, backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1, borderColor: C.ghostBorder,
    }}>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8,
        color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.5,
      }} numberOfLines={1}>
        MATCHED{cpcLabel ? ` · ${cpcLabel}` : ''}
      </Text>
    </View>
  );
}

// ── Saved flash (deck-only) ─────────────────────────────────────────
//
// Tiny ✓ SAVED pill that briefly appears whenever the deck's params are
// PERSISTED. Two engine events mean that (see isDeckSaveConfirmation):
//   - `deckParamsSaved` — a deck LOCAL-PARAM write hit deck_state.yaml. Emitted
//     by the deck control-write paths ONLY when auto-save is ON, so with
//     auto-save OFF the flash honestly never fires (nothing was saved). This is
//     the signal for the operator's day-to-day "I moved a slider" confirmation
//     (the debounced auto-capture that used to drive it was retired 2026-07-07;
//     the honest persistence signal is now the deck save itself).
//   - `playlistEntryCaptured` — an explicit / on-switch capture wrote the deck's
//     params into the active playlist entry's defaults.
// Mirrors the "✓ SAVED" badge in PlaylistPanel so operators get the same signal
// no matter which pane they were watching.

export function DeckSavedFlash({ deckChannelId }: { deckChannelId?: string }) {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!deckChannelId) return;
    return engineEvents.subscribe((m) => {
      if (isDeckSaveConfirmation(m, deckChannelId)) {
        setSavedAt(Date.now());
      }
    });
  }, [deckChannelId]);
  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 1400);
    return () => clearTimeout(t);
  }, [savedAt]);
  // Always render the same outer shape so siblings (EntryLabelEditor,
  // ◎ ALL pill) never re-flow when the flash toggles. The inner pill
  // is hidden via opacity rather than conditional render — same DOM,
  // same measured width/height regardless of state.
  const visible = savedAt !== null;
  return (
    <View
      style={{
        minWidth: 70,
        minHeight: 22,
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 4,
          backgroundColor: 'rgba(0,168,107,0.15)',
          opacity: visible ? 1 : 0,
        }}
      >
        <Text style={{ color: '#00a86b', fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 0.6 }}>
          ✓ SAVED
        </Text>
      </View>
    </View>
  );
}

function MatchedButton({ name, cpcLabel }: { name: string; cpcLabel?: string }) {
  const C = usePalette();
  const label = name.replace(/^(slider|toggle|trigger|hsvPicker)/i, '').replace(/([A-Z])/g, ' $1').trim().toUpperCase().substring(0, 12);
  return (
    <View style={{
      flexBasis: '30%', flexDirection: 'column', alignItems: 'center',
      paddingVertical: 8, paddingHorizontal: 6,
      borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      opacity: 0.55, gap: 2,
    }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text }} numberOfLines={1}>{label || '—'}</Text>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 7, color: C.secondary,
        textTransform: 'uppercase', letterSpacing: 0.4,
      }} numberOfLines={1}>
        MATCHED{cpcLabel ? ` · ${cpcLabel}` : ''}
      </Text>
    </View>
  );
}
