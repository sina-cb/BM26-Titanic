import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_400Regular, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';

import { ThemeProvider, useTheme } from '@/hooks/use-theme';
import { warmColorPalettesCache } from '@/utils/api';

export const unstable_settings = {
  anchor: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Inner shell — needs to live below <ThemeProvider> so it can call useTheme().
function RootShell() {
  const { scheme } = useTheme();

  return (
    <NavThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
      // Pre-warm the color palette cache so the COLORS picker can render
      // presets instantly the first time the operator opens it — the
      // previous per-open fetch would intermittently land on a flaky
      // engine boot window and the modal would show an empty Presets tab.
      // Best-effort: a failed warm just leaves the cache empty and the
      // modal's own re-fetch fallback takes over.
      warmColorPalettesCache().catch(() => {});
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <ThemeProvider>
      <RootShell />
    </ThemeProvider>
  );
}
