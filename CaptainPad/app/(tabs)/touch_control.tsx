// TOUCH CONTROL tab — hosts the operator touch panel.
//
// The panel itself is NOT React Native. It is a self-contained page served by
// the simulation's HTTP server at :6969/docs/ui/touch_control.html, wired
// straight to the engine's REST API. This tab embeds it so the operator reaches
// it from the same CaptainPad tab bar as everything else, instead of having to
// remember a URL.
//
// WHY AN IFRAME AND NOT react-native-webview:
// the dependency is installed, but it ships no web build — package.json has no
// `browser` field and only WebView.android/.ios variants. CaptainPad is used as
// a WEB app (the launcher opens http://localhost:6967/ and that is what runs on
// the iPad), so importing it here would break the bundle this tab actually runs
// in. On web an iframe is the native answer.
//
// On a NATIVE build this tab says so plainly and shows the URL rather than
// rendering an empty box — a surface that silently shows nothing is worse than
// one that tells you where to go (codex: no fallback behaviours).

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Platform, ActivityIndicator } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { getApiBaseAsync } from '@/utils/api';

/** The panel lives on the SIM server, one port below the engine. */
const SIM_PORT = '6969';
const PANEL_PATH = '/docs/ui/touch_control.html';

/**
 * Work out where the panel is served from.
 *
 * `pageHost` WINS when present, and that is the whole point: config.yaml ships
 * `api_base: http://127.0.0.1:6968`, which is correct for the show machine and
 * WRONG for every other device. An iPad that loads CaptainPad from
 * 192.168.50.4:6967 and then asks 127.0.0.1:6969 for the panel is asking
 * ITSELF, and gets nothing. The host the operator actually reached CaptainPad
 * on is the host that can serve the panel.
 *
 * The api_base port/scheme is still the fallback, for a native build where
 * there is no page host to read.
 */
export function resolvePanelUrl(apiBase: string, pageHost?: string | null): string {
  const u = new URL(apiBase);
  if (pageHost) u.hostname = pageHost;
  u.port = SIM_PORT;
  u.pathname = PANEL_PATH;
  u.search = '';
  u.hash = '';
  return u.toString();
}

export default function TouchControlScreen() {
  const palette = usePalette();
  const [apiBase, setApiBase] = useState<string | null>(null);
  const [pageHost, setPageHost] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    getApiBaseAsync().then(base => { if (alive) setApiBase(base); });
    return () => { alive = false; };
  }, []);

  /* Read the host in an EFFECT, not during render. expo-router server-renders
     this route, and on the server `window` does not exist — computing it inline
     silently produced the config.yaml host (127.0.0.1) and kept it after
     hydration. An effect only ever runs on the client, so this is the value the
     device actually loaded the app from. */
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      setPageHost(window.location.hostname);
    }
  }, []);

  const url = useMemo(
    () => (apiBase ? resolvePanelUrl(apiBase, pageHost) : null),
    [apiBase, pageHost],
  );

  if (!url) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background }}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  if (Platform.OS !== 'web') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: palette.background }}>
        <Text style={{ color: palette.text, fontSize: 16, fontWeight: '800', marginBottom: 8 }}>
          Touch Control runs in the browser
        </Text>
        <Text style={{ color: palette.icon, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
          This tab embeds the panel on web builds. On a native build, open it directly:
        </Text>
        <Text selectable style={{ color: palette.tint, fontSize: 13, marginTop: 10 }}>{url}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#070b14' }}>
      {/* The panel carries its own RELOAD button in its header now, so the
          floating overlay that used to sit over the groups bank is gone. */}
      {/* react-native-web passes an unknown string tag through as a real DOM
          element, which is how the iframe gets rendered from RN code. */}
      {React.createElement('iframe', {
        key: reloadKey,
        /* RELOAD PANEL must fetch the page again, not re-show a cached copy.
           Re-mounting the iframe with the same URL let the browser serve both
           the page and its script from memory, so a reload could leave the
           operator on stale logic. The counter in the query forces a real GET. */
        src: url + (url.indexOf('?') === -1 ? '?' : '&') + 'r=' + reloadKey,
        title: 'Touch Control',
        style: { border: 'none', width: '100%', height: '100%', display: 'block' },
        allow: 'fullscreen',
      })}
    </View>
  );
}
