import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, useWindowDimensions } from 'react-native';
import { Colors } from '@/constants/theme';
import { updateParamCenter } from '@/utils/api';
import { MiniFader } from '@/components/ui/MiniFader';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { useSharedParamValues } from '@/hooks/useEngineState';

const C = Colors.light;

function hsvToRgbString(h: number, s: number, v: number) {
  let r, g, b, i, f, p, q, t;
  i = Math.floor(h * 6);
  f = h * 6 - i;
  p = v * (1 - s);
  q = v * (1 - f * s);
  t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v, g = t, b = p; break;
    case 1: r = q, g = v, b = p; break;
    case 2: r = p, g = v, b = t; break;
    case 3: r = p, g = q, b = v; break;
    case 4: r = t, g = p, b = v; break;
    case 5: r = v, g = p, b = q; break;
    default: r = 0, g = 0, b = 0;
  }
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

// Note: the `wsRef` prop is accepted for backward-compat with the
// existing tab files but no longer required — live state now flows
// through the module-level `useEngineState` subscription, which means
// PortWatch / scripts / any future external writer ends up reflected
// here automatically.
export const CPCControls = ({ wsRef: _wsRef }: { wsRef?: unknown } = {}) => {
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
  const defaultParams = useMemo(() => ({
    speed: 0.5,
    direction: 1.0,
    count: 0.5,
    size: 0.5,
    rotate: 0,
    colorPalette1: { h: 0, s: 1, v: 1 },
    colorPalette2: { h: 0.5, s: 1, v: 1 }
  }), []);

  // Live shared-param values. Every sharedParams broadcast (whether it
  // originated from this UI, PortWatch over LoRa, or any script) flows
  // through the engineEvents bus → useSharedParamValues → here, so the
  // sliders/colour swatches always show the canonical engine state.
  const params = useSharedParamValues(defaultParams) as typeof defaultParams;
  const [pickerModal, setPickerModal] = useState<{ visible: boolean, key: string, h: number, s: number, v: number }>({ visible: false, key: '', h: 0, s: 1, v: 1 });

  // Writers post to /param-center. The engine's POST handler
  // broadcasts a fresh sharedParams to every subscriber (including us),
  // so we don't need a separate optimistic local-state path — the
  // broadcast round-trip is already sub-second on Wi-Fi.
  const update = (key: string, val: any) => {
    updateParamCenter({ [key]: val });
  };

  const updateColor = (key: string, h: number, s: number, v: number) => {
    updateParamCenter({ [key]: { h, s, v } });
  };

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', backgroundColor: C.surfaceContainerLowest, padding: isPortrait ? 8 : 12, borderBottomWidth: 1, borderBottomColor: C.ghostBorder }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: isPortrait ? 9 : 10, color: C.secondary, marginRight: isPortrait ? 8 : 16, textTransform: 'uppercase' }}>{isPortrait ? 'GLOBALS' : 'GLOBAL PARAMS'}</Text>
      
      <View style={{ flexDirection: 'row', flexWrap: 'nowrap', gap: isPortrait ? 8 : 24, paddingRight: isPortrait ? 4 : 16, flex: 1 }}>
        
        <View style={{ flex: 1, maxWidth: isPortrait ? 90 : 140 }}>
          <MiniFader label="SPEED" value={params.speed ?? 0.5} onChange={(v) => update('speed', v)} />
        </View>

        <View style={{ flex: 1, maxWidth: isPortrait ? 90 : 140 }}>
          <MiniFader label="SIZE" value={params.size ?? 0.5} onChange={(v) => update('size', v)} />
        </View>

        <View style={{ flex: 1, maxWidth: isPortrait ? 90 : 140 }}>
          <MiniFader label="COUNT" value={params.count ?? 0.5} onChange={(v) => update('count', v)} />
        </View>

        <View style={{ flex: 1, maxWidth: isPortrait ? 90 : 140 }}>
          {/* DIR: 0=REV, 0.5=STOP, 1.0=FWD */}
          <MiniFader label={isPortrait ? "DIR" : "DIR (R/S/F)"} value={params.direction ?? 1.0} onChange={(v) => update('direction', v)} />
        </View>

        <View style={{ flexDirection: 'row', gap: isPortrait ? 6 : 12, alignItems: 'center' }}>
          <View>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, textTransform: 'uppercase', marginBottom: 2 }}>C1</Text>
            <TouchableOpacity 
              onPress={() => setPickerModal({ visible: true, key: 'colorPalette1', h: params.colorPalette1?.h ?? 0, s: params.colorPalette1?.s ?? 1, v: params.colorPalette1?.v ?? 1 })}
              style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: C.ghostBorder, backgroundColor: hsvToRgbString(params.colorPalette1?.h ?? 0, params.colorPalette1?.s ?? 1, params.colorPalette1?.v ?? 1) }} 
            />
          </View>

          <View>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary, textTransform: 'uppercase', marginBottom: 2 }}>C2</Text>
            <TouchableOpacity 
              onPress={() => setPickerModal({ visible: true, key: 'colorPalette2', h: params.colorPalette2?.h ?? 0, s: params.colorPalette2?.s ?? 1, v: params.colorPalette2?.v ?? 1 })}
              style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: C.ghostBorder, backgroundColor: hsvToRgbString(params.colorPalette2?.h ?? 0, params.colorPalette2?.s ?? 1, params.colorPalette2?.v ?? 1) }} 
            />
          </View>
        </View>
      </View>

      {/* Color Picker Modal */}
      <Modal visible={pickerModal.visible} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}>
           <View style={{ width: 300, backgroundColor: C.surfaceContainerLowest, padding: 24, borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder }}>
             <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, marginBottom: 16 }}>{pickerModal.key === 'colorPalette1' ? 'COLOR 1' : 'COLOR 2'}</Text>
             
             <View style={{ marginBottom: 24 }}>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                 <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10 }}>HUE</Text>
                 <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10 }}>{Math.round(pickerModal.h * 360)}°</Text>
               </View>
               <HorizontalFader 
                 value={pickerModal.h} 
                 onChange={(v: number) => setPickerModal(p => ({ ...p, h: v }))}
                 trackStyle={{ height: 24, backgroundColor: C.surfaceContainerHigh, borderRadius: 12 }} 
                 fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: hsvToRgbString(pickerModal.h, 1, 1), borderRadius: 12 }} 
               />
             </View>

             <View style={{ marginBottom: 24 }}>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                 <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10 }}>SATURATION</Text>
                 <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10 }}>{Math.round(pickerModal.s * 100)}%</Text>
               </View>
               <HorizontalFader 
                 value={pickerModal.s} 
                 onChange={(v: number) => setPickerModal(p => ({ ...p, s: v }))}
                 trackStyle={{ height: 24, backgroundColor: C.surfaceContainerHigh, borderRadius: 12 }} 
                 fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primaryFixedDim, borderRadius: 12 }} 
               />
             </View>

             <View style={{ marginBottom: 32 }}>
               <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                 <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10 }}>VALUE / BRIGHTNESS</Text>
                 <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10 }}>{Math.round(pickerModal.v * 100)}%</Text>
               </View>
               <HorizontalFader 
                 value={pickerModal.v} 
                 onChange={(v: number) => setPickerModal(p => ({ ...p, v: v }))}
                 trackStyle={{ height: 24, backgroundColor: C.surfaceContainerHigh, borderRadius: 12 }} 
                 fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primaryFixedDim, borderRadius: 12 }} 
               />
             </View>

             <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
               <TouchableOpacity onPress={() => setPickerModal(p => ({ ...p, visible: false }))} style={{ padding: 12 }}>
                 <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary }}>CANCEL</Text>
               </TouchableOpacity>
               <TouchableOpacity 
                 onPress={() => {
                   updateColor(pickerModal.key, pickerModal.h, pickerModal.s, pickerModal.v);
                   setPickerModal(p => ({ ...p, visible: false }));
                 }} 
                 style={{ backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
               >
                 <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000' }}>APPLY</Text>
               </TouchableOpacity>
             </View>
           </View>
        </View>
      </Modal>

    </View>
  );
};
