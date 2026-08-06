import React, { useState, useRef, useEffect } from 'react';
import { View, Text, PanResponder, Animated } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { useGlobalStyles } from '@/styles/globalStyles';

interface Props {
  id: number;
  label: string;
  initialValue?: number;
  min?: number;
  max?: number;
  suffix?: string;
  isColor?: boolean;
  onChange: (id: number, val: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

function NauticalFaderImpl({ id, label, initialValue = 0, min = 0, max = 1, suffix = '', isColor = false, onChange, onDragStart, onDragEnd }: Props) {
  const palette = usePalette();
  const globalStyles = useGlobalStyles();
  const [value, setValue] = useState(initialValue);

  // Strict physical tracking bounds
  const trackHeight = 160;
  const handleHeight = 48;
  const maxTravel = trackHeight - handleHeight;

  const panY = useRef(new Animated.Value(0)).current;

  // True between grant and release/terminate — external syncs must never
  // yank the knob out from under the operator's finger (same idiom as
  // HorizontalFader's draggingRef).
  const draggingRef = useRef(false);

  // Sync BOTH the readout and the knob position from the owner's value.
  // The readout alone used to be synced here while the knob was positioned
  // once on mount, so a value pushed from outside (the MASTER fader) moved
  // the number and left the handle behind. Safe to write panY directly: a
  // finished drag flattens its offset back to 0, and a live drag is gated
  // by draggingRef above.
  useEffect(() => {
    if (draggingRef.current) return;
    setValue(initialValue);
    const ratio = (initialValue - min) / (max - min);
    panY.setValue(maxTravel * (1 - ratio));
  }, [initialValue, min, max, maxTravel, panY]);

  // The PanResponder is built ONCE (useRef), so its handlers would capture
  // the FIRST-render callbacks forever. Read them through refs refreshed on
  // every render — same stale-closure fix HorizontalFader documents.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const lastSendTime = useRef(0);
  const updateEngine = (val: number, force: boolean = false) => {
    const now = Date.now();
    if (force || now - lastSendTime.current > 100) {
      onChangeRef.current(id, val);
      lastSendTime.current = now;
    }
  };

  /** End-of-drag settle: flatten the offset, publish the final value, and
   *  reopen the fader to external (MASTER) syncs. Shared by release and
   *  terminate so both paths leave identical state behind. */
  const settleDrag = () => {
    panY.flattenOffset();
    const finalY = (panY as any)._value;
    const ratio = 1 - (finalY / maxTravel);
    const engineValue = min + ratio * (max - min);
    setValue(engineValue);
    updateEngine(engineValue, true);
    draggingRef.current = false;
    if (onDragEndRef.current) onDragEndRef.current();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        draggingRef.current = true;
        if (onDragStartRef.current) onDragStartRef.current();
        panY.extractOffset();
      },
      onPanResponderMove: (evt, gestureState) => {
        const currentOffset = (panY as any)._offset || 0;
        let newY = gestureState.dy;

        // Strict hard-stop clamping for the visual handle
        if (currentOffset + newY <= 0) {
          newY = -currentOffset; // Lock to top (max value)
        } else if (currentOffset + newY >= maxTravel) {
          newY = maxTravel - currentOffset; // Lock to bottom (min value)
        }

        panY.setValue(newY);

        const yOffset = currentOffset + newY;
        const ratio = 1 - (yOffset / maxTravel);
        const engineValue = min + ratio * (max - min);
        
        setValue(engineValue);
        updateEngine(engineValue);
      },
      onPanResponderRelease: () => {
        settleDrag();
      },
      // A cancelled gesture (browser pointercancel, focus loss) never fires
      // Release. Without this, draggingRef would stick ON — the fader would
      // stop accepting MASTER pushes for the rest of the session — and the
      // rack's scroll-gate would stay disabled. Mirror Release exactly.
      onPanResponderTerminate: () => {
        settleDrag();
      },
    })
  ).current;

  return (
    <View style={{ alignItems: 'center', gap: 24, width: 80 }}>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: palette.secondary }}>{label}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, color: palette.text }}>
          {value.toFixed(2)}{suffix}
        </Text>
      </View>
      
      {/* Track Background */}
      <View style={{ height: trackHeight, width: 32, backgroundColor: palette.surfaceContainerHigh, borderRadius: 16, alignItems: 'center' }}>
        {/* The Track Canvas */}
        <View style={{ height: trackHeight, width: '100%', alignItems: 'center' }}>
          <Animated.View
            {...panResponder.panHandlers}
            style={{
              position: 'absolute',
              top: 0,
              width: 64,
              height: handleHeight,
              backgroundColor: palette.faderKnob,
              borderWidth: 1,
              borderColor: palette.ghostBorder,
              borderRadius: 12,
              justifyContent: 'center',
              alignItems: 'center',
              ...globalStyles.ambientShadow,
              transform: [{ translateY: panY }],
            }}
          >
            <View style={{ 
               width: isColor ? 48 : 32, 
               height: isColor ? 16 : 4, 
               backgroundColor: isColor ? `hsl(${Math.round(((value - min) / (max - min)) * 360)}, 100%, 50%)` : palette.primaryFixedDim, 
               borderRadius: isColor ? 8 : 2 
            }} />
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

/**
 * Memoised: the Dimmer Rack now owns every fader's level in state, so a
 * single fader move (or a MASTER sweep) re-renders the rack ~10×/s. With
 * stable callbacks from the rack, memo keeps that to the faders whose value
 * actually changed instead of all 24.
 */
export const NauticalFader = React.memo(NauticalFaderImpl);
