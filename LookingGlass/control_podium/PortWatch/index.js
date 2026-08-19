// Explicit entry — keeps Expo's virtual-metro-entry from auto-picking
// `expo-router/entry` (which it would do if it ever sees expo-router
// resolvable from anywhere in the resolution chain).
//
// We deliberately don't use expo-router for this app — the UI is a
// simple stack rendered by App.tsx and that's it.

import React from "react";
import { registerRootComponent } from "expo";
// SafeAreaProvider must wrap the whole tree so any SafeAreaView /
// useSafeAreaInsets call can read real device insets (notch, home
// bar). Without it the new react-native-safe-area-context components
// silently fall back to zero insets, which manifests as content
// drawing under the notch on a notched iPhone.
import { SafeAreaProvider } from "react-native-safe-area-context";
import App from "./App";

function Root() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}

registerRootComponent(Root);
