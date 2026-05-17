import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Colors } from '@/constants/theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { setMixerChannelControl, sendControl } from '@/utils/api';
import { ToggleButton, MomentaryButton } from '@/components/ui/ToggleButton';
import { MiniFader } from '@/components/ui/MiniFader';
import { useChannelExports, useEngineState, MixerChannelExport } from '@/hooks/useEngineState';

const C = Colors.light;

export const GlobalParams = ({ variant = 'deck', channelId, exports }: { variant?: 'deck' | 'mixer', channelId?: string, exports?: any[], wsRef?: unknown }) => {
  // Always read from the centralized engine-state hook so external
  // writers (PortWatch over LoRa, scripts hitting /control directly,
  // …) flow through to the UI without depending on per-tab WS state.
  // The `exports` prop is kept as a fallback for callers that don't
  // know the channelId yet (transient UI states during channel add).
  const { mixerChannels } = useEngineState();
  const liveDeckExports = useChannelExports(channelId);
  const baseChannelId = mixerChannels[0]?.id;
  const liveBaseExports = useChannelExports(baseChannelId);

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
                label={exp.name.replace(/_v\d+$/, '').replace(/^(slider|toggle|trigger|hsvPicker)/i, '').replace(/([A-Z])/g, ' $1').trim().toUpperCase().substring(0, 15)}
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
  const sliders = exps.filter((e: MixerChannelExport) => e.kind === 1);
  const toggles = exps.filter((e: MixerChannelExport) => e.kind === 2);
  const triggers = exps.filter((e: MixerChannelExport) => e.kind === 3);
  const colorPickers = exps.filter((e: MixerChannelExport) => e.kind === 6);

  if (exps.length === 0) return (
    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10 }}>NO EXPORTS</Text>
  );

  return (
    <View style={{ gap: 12 }}>
      {sliders.map((e: any) => (
        <View key={`slider-${e.id}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, textTransform: 'uppercase' }}>{e.name.replace(/^(slider|toggle|trigger|hsvPicker)/i, '').replace(/([A-Z])/g, ' $1').trim().substring(0, 15)}</Text>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text }}>{(e.v0 ?? 0.5).toFixed(2)}</Text>
          </View>
          <HorizontalFader
            value={e.v0 ?? 0.5}
            onChange={(val: number) => channelId && setMixerChannelControl(channelId, e.id, val)}
            trackStyle={{ height: 24, backgroundColor: C.surfaceContainerHigh, borderRadius: 12, justifyContent: 'center' }}
            fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primary, borderRadius: 12 }}
          />
        </View>
      ))}
      {colorPickers.map((e: any) => (
        <View key={`color-${e.id}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, textTransform: 'uppercase' }}>HUE</Text>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text }}>{(e.v0 ?? 0).toFixed(2)}</Text>
          </View>
          <HorizontalFader
            value={e.v0 ?? 0}
            onChange={(val: number) => channelId && setMixerChannelControl(channelId, e.id, val, e.v1, e.v2)}
            trackStyle={{ height: 8, backgroundColor: C.surfaceContainerHigh, borderRadius: 4, justifyContent: 'center' }}
            fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primaryFixedDim, borderRadius: 4 }}
            thumbStyle={{ position: 'absolute', width: 14, height: 18, backgroundColor: C.surfaceContainerLowest, borderRadius: 4, borderWidth: 1, borderColor: C.ghostBorder, transform: [{ translateX: -7 }] }}
          />
        </View>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 16, gap: 8 }}>
        {toggles.map((e: any) => (
          <ToggleButton key={`toggle-${e.id}`} id={e.id} name={e.name} initialValue={e.v0 ?? 0} onChange={(id: number, v: number) => channelId && setMixerChannelControl(channelId, id, v)} />
        ))}
        {triggers.map((e: any) => (
          <MomentaryButton key={`trigger-${e.id}`} id={e.id} name={e.name} onChange={(id: number, v: number) => channelId && setMixerChannelControl(channelId, id, v)} />
        ))}
      </View>
    </View>
  );
};
