// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<SymbolViewProps['name'], ComponentProps<typeof MaterialIcons>['name']>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'slider.vertical.3': 'tune',
  'desktopcomputer': 'monitor',
  'shippingbox.fill': 'local-shipping',
  'curlybraces': 'code',
  'gear': 'settings',
  'lightbulb.fill': 'lightbulb',
  'arrow.clockwise': 'refresh',
  'exclamationmark.triangle.fill': 'warning',
  'slider.horizontal.3': 'tune',
  'lock.fill': 'lock',
  'lock.open.fill': 'lock-open',
  // Fader-lock (slot 5): distinct icon so operators can tell the
  // playlist/pattern lock (`lock.fill`) and the fader lock apart at
  // a glance. `pin.fill` reads as "pin this value" / "hold the fader
  // in place".
  'pin.fill': 'push-pin',
  'pin.slash.fill': 'location-off',
  'waveform': 'graphic-eq',
  'waveform.path.ecg': 'monitor-heart',
  'mic': 'mic',
  'power': 'power-settings-new',
  'metronome': 'music-note',
  'dot.radiowaves.left.and.right': 'graphic-eq',
  'antenna.radiowaves.left.and.right': 'cell-tower',
  'network': 'lan',
  'plus.circle': 'add-circle-outline',
  'trash': 'delete-outline',
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
