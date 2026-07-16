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
  // Playlist reorder (slot 5, May 2026): up/down nudges on each entry row.
  'chevron.up': 'keyboard-arrow-up',
  'chevron.down': 'keyboard-arrow-down',
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
  // Scheduler tab (docs/31): sidebar icon + per-row controls. The
  // calendar+clock pairing reads as "this fires later, automatically".
  'calendar.badge.clock': 'event',
  // Timeline / Show Director tab (docs/38): sidebar icon + day-ribbon
  // sun-event glyphs. `sun.max` reads as "the sky drives this".
  'sun.max': 'wb-sunny',
  'sunrise': 'wb-twilight',
  'sunset': 'wb-twilight',
  'clock': 'schedule',
  'moon.stars': 'nights-stay',
  'play.fill': 'play-arrow',
  'pause.fill': 'pause',
  'stop.fill': 'stop',
  'circle': 'radio-button-unchecked',
  'checkmark.circle.fill': 'check-circle',
  'wifi.slash': 'wifi-off',
  'shuffle': 'shuffle',
  // Autopilot pattern-group locality (feat/optimize_channels): the GROUP
  // toggle next to SHUFFLE. A 2x2 grid reads as "dwell within a window of
  // adjacent patterns".
  'square.grid.2x2': 'grid-view',
  // "Load directory" (bulk-add a patterns/ sub-folder into a playlist).
  'folder.fill': 'folder',
  // Deck overlay stack (feat/optimize_channels): each overlay card header has
  // an eye (enable toggle) and an ✕ (remove); the expanded body has up/down
  // reorder arrows, and the ADD OVERLAY button uses a plain plus. These had no
  // Material-Icon fallback, so on web (and Android) IconSymbol rendered a blank
  // 0×0 glyph — the ✕ was "nowhere to be found" because it was literally
  // invisible and un-tappable. Map them so the overlay controls render on web.
  'xmark': 'close',
  'eye': 'visibility',
  'eye.slash': 'visibility-off',
  'plus': 'add',
  'arrow.up': 'arrow-upward',
  'arrow.down': 'arrow-downward',
  // Studio console + config split-screen toggle, likewise unmapped on web.
  'terminal': 'terminal',
  'circle.lefthalf.filled': 'contrast',
  // Engine AUTO-SAVE card (config tab): a disk-with-check reads as
  // "your show state is being written to disk".
  'externaldrive.fill.badge.checkmark': 'save',
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
