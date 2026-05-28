/**
 * Per-token convenience reader that honors the operator's theme override
 * (light / dark / system). Use `useTheme()` directly when you need the
 * full palette; this hook is the legacy entry point for `<ThemedText>` /
 * `<ThemedView>` style components.
 */

import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  const { scheme } = useTheme();
  const colorFromProps = props[scheme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[scheme][colorName];
  }
}
