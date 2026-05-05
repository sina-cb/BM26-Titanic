import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Colors } from '@/constants/theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { fetchExports, setMixerChannelControl } from '@/utils/api';
import { ToggleButton, MomentaryButton } from '@/components/ui/ToggleButton';
import { MiniFader } from '@/components/ui/MiniFader';

const C = Colors.light;

export const GlobalParams = ({ variant = 'deck', channelId, exports, wsRef }: { variant?: 'deck' | 'mixer', channelId?: string, exports?: any[], wsRef?: any }) => {
  const [globalExports, setGlobalExports] = useState<any[]>([]);

  const fetchGlobalExports = useCallback(() => {
    fetchExports().then(r => {
      if (r.ok && r.data) setGlobalExports(r.data);
    });
  }, []);

  useEffect(() => {
    if (variant === 'mixer') {
      fetchGlobalExports();
    }
  }, [variant, fetchGlobalExports]);

  if (variant === 'mixer') {
    if (!globalExports || globalExports.length === 0) return null;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surfaceContainerLowest, padding: 12, borderBottomWidth: 1, borderBottomColor: C.ghostBorder }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, marginRight: 16, textTransform: 'uppercase' }}>BASE PARAMS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 24, paddingRight: 16 }}>
          {globalExports.filter(e => e.kind === 1).map((exp: any) => (
            <View key={exp.id} style={{ width: 180 }}>
              <MiniFader
                label={exp.name.replace(/_v\d+$/, '').toUpperCase().substring(0, 10)}
                value={exp.v0 !== undefined ? exp.v0 : 0.5}
                onChange={(v: number) => {
                  setGlobalExports(exs => exs.map(e => e.id === exp.id ? { ...e, v0: v } : e));
                  if (wsRef && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: 'setControl', id: exp.id, v0: v, v1: 0, v2: 0 }));
                  }
                }}
              />
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // Deck variant uses the channel exports passed in
  const exps = exports || [];
  const sliders = exps.filter((e: any) => e.kind === 1);
  const toggles = exps.filter((e: any) => e.kind === 2);
  const triggers = exps.filter((e: any) => e.kind === 3);
  const colorPickers = exps.filter((e: any) => e.kind === 6);

  if (exps.length === 0) return (
    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10 }}>NO EXPORTS</Text>
  );

  return (
    <View style={{ gap: 12 }}>
      {sliders.map((e: any) => (
        <View key={`slider-${e.id}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, textTransform: 'uppercase' }}>{e.name.replace('slider', '').substring(0, 10)}</Text>
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
