import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { useGlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getApiBaseAsync, testConnection } from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';

export default function MonitorScreen() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const [activePattern, setActivePattern] = useState<string>('...');
  const [sceneName, setSceneName] = useState<string>('Loading...');
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string>('');
  const [apiBase, setApiBase] = useState<string>('');
  const [streamUrl, setStreamUrl] = useState<string>('');
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const base = await getApiBaseAsync();
      if (!alive) return;
      setApiBase(base);

      const conn = await testConnection(base);
      if (!alive) return;
      setIsConnected(conn.ok);

      if (!conn.ok) {
        setConnectionError(conn.error || 'Cannot reach MarsinEngine');
        setSceneName('—');
        return;
      }

      if (conn.data) {
        setSceneName(conn.data.activeScene || 'unknown');
        setActivePattern(conn.data.activePattern || 'unknown');

        const engineHost = base.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
        const SIMULATION_PORT = 6969;
        const resolvedScene = conn.data.activeScene || 'unknown';

        const url = `http://${engineHost}:${SIMULATION_PORT}/simulation/?scene=${resolvedScene}&profile=edit&renderer=webgl&readonly=1`;
        setStreamUrl(url);
      }
    })();

    // Pre-May-2026 we opened a raw WS just to watch `pattern` events.
    // After the topic split the engineEvents singleton already owns
    // ONE /ws/control socket for the whole app — we just subscribe.
    const unsub = engineEvents.subscribe((msg) => {
      if (msg.type === 'pattern' && typeof msg.name === 'string') {
        setActivePattern(msg.name);
      }
    });

    return () => { alive = false; unsub(); };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* HUD Overlay */}
      <View style={{
        position: 'absolute',
        top: 32,
        right: 32,
        zIndex: 10,
        padding: 16,
        backgroundColor: 'rgba(255,255,255,0.85)',
        borderRadius: 16,
        ...globalStyles.ambientShadow,
        ...globalStyles.ghostBorder
      }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 16 }}>
           SIMULATION MONITOR
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.secondary, fontSize: 12, marginTop: 4 }}>Scene: {sceneName}</Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.primaryFixedDim, fontSize: 12, marginTop: 2 }}>Pattern: {activePattern}</Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: isConnected ? 'green' : 'red', fontSize: 12, marginTop: 2 }}>
            Engine: {isConnected === null ? 'CHECKING...' : (isConnected ? 'ONLINE' : 'OFFLINE')}
        </Text>
      </View>

      {/* Main Content */}
      {isConnected === false ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.surface, padding: 48 }}>
          <IconSymbol name="wifi.slash" size={48} color={C.error} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 24, marginTop: 24 }}>ENGINE OFFLINE</Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.secondary, marginTop: 12, textAlign: 'center', lineHeight: 22 }}>
            Cannot reach MarsinEngine at:{'\n'}
            <Text style={{ fontFamily: 'Inter_600SemiBold', color: C.text }}>{apiBase || '(not configured)'}</Text>
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.secondary, marginTop: 8, textAlign: 'center', fontSize: 13 }}>
            {connectionError}
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, marginTop: 24, textAlign: 'center', fontSize: 13 }}>
            Check the Config tab for IP settings and iPad Local Network permissions.
          </Text>
        </View>
      ) : streamUrl ? (
        <WebView 
          ref={webViewRef}
          source={{ uri: streamUrl }} 
          style={{ flex: 1, backgroundColor: C.surface }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback={true}
          renderError={() => (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.surface }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 24 }}>STREAM OFFLINE</Text>
              <Text style={{ fontFamily: 'Inter_400Regular', color: C.secondary, marginTop: 8 }}>
                Ensure WebGL Simulation is running.
              </Text>
            </View>
          )}
        />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.surface }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 18 }}>CONNECTING...</Text>
        </View>
      )}
    </View>
  );
}
