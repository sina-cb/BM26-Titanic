import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { SpaceGrotesk_400Regular, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';

import { ThemeProvider, useTheme } from '@/hooks/use-theme';
import { DayFrameProvider } from '@/hooks/use_day_frame';
import { warmColorPalettesCache } from '@/utils/api';
import { useMidiControl } from '@/hooks/useMidiControl';
import { CaptainPadAccessProvider } from '@/hooks/use_captainpad_access';
import { lockCaptainPadOrientation } from '@/utils/app_orientation';

export const unstable_settings = {
  anchor: '(tabs)',
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Inner shell — needs to live below <ThemeProvider> so it can call useTheme().
function RootShell() {
  const { scheme } = useTheme();
  // Drive the direct-MIDI lifecycle once, app-wide (same altitude as the
  // engine buses). No-op on platforms without Web MIDI / a native module.
  useMidiControl();

  return (
    <NavThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack initialRouteName="(tabs)">
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  const nativeOrientationRequired = Platform.OS !== 'web';
  const [orientationReady, setOrientationReady] = useState(!nativeOrientationRequired);
  const [orientationError, setOrientationError] = useState<Error | null>(null);
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    if (!nativeOrientationRequired) return;

    let mounted = true;
    lockCaptainPadOrientation()
      .then(() => {
        if (mounted) setOrientationReady(true);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        const failure = error instanceof Error
          ? error
          : new Error(`[CaptainPad] landscape orientation lock failed: ${String(error)}`);
        console.error(failure.message, failure);
        setOrientationError(failure);
      });

    return () => {
      mounted = false;
    };
  }, [nativeOrientationRequired]);

  useEffect(() => {
    if (loaded && orientationReady) {
      SplashScreen.hideAsync();
      // Pre-warm the color palette cache so the COLORS picker can render
      // presets instantly the first time the operator opens it — the
      // previous per-open fetch would intermittently land on a flaky
      // engine boot window and the modal would show an empty Presets tab.
      // Best-effort: a failed warm just leaves the cache empty and the
      // modal's own re-fetch fallback takes over.
      warmColorPalettesCache().catch(() => {});
    }
  }, [loaded, orientationReady]);

  // A native operator console in an unknown orientation is unsafe: surface
  // the module failure through React's error boundary instead of silently
  // continuing into the portrait composition.
  if (orientationError) throw orientationError;

  // Expo Router requires the root navigator to mount on the first render.
  // Returning null here while fonts load leaves direct route guards without a
  // navigation container, so a safe Performance-mode redirect throws instead
  // of taking the operator back to Deck. The splash remains visible until the
  // effect above hides it after the fonts are ready, so this does not expose an
  // unstyled intermediate screen.
  return (
    <ThemeProvider>
      <DayFrameProvider>
        <CaptainPadAccessProvider>
          <RootShell />
        </CaptainPadAccessProvider>
      </DayFrameProvider>
    </ThemeProvider>
  );
}
