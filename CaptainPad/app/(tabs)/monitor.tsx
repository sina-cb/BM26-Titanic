import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getApiBaseAsync, testConnection } from '@/utils/api';

export default function MonitorScreen() {
  const [activePattern, setActivePattern] = useState<string>('...');
  const [sceneName, setSceneName] = useState<string>('Loading...');
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string>('');
  const [apiBase, setApiBase] = useState<string>('');
  const [streamUrl, setStreamUrl] = useState<string>('');
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;

    (async () => {
      // 1. Wait for resolved API base
      const base = await getApiBaseAsync();
      setApiBase(base);

      // 2. Test connection
      const conn = await testConnection(base);
      setIsConnected(conn.ok);

      if (!conn.ok) {
        setConnectionError(conn.error || 'Cannot reach MarsinEngine');
        setSceneName('—');
        return;
      }

      // 3. Update state from /status
      if (conn.data) {
        setSceneName(conn.data.activeScene || 'unknown');
        setActivePattern(conn.data.activePattern || 'unknown');

        // 4. Compute stream URL after we have status data
        const engineHost = base.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
        const SIMULATION_PORT = 6969;
        const resolvedScene = conn.data.activeScene || 'unknown';

        const url = `http://${engineHost}:${SIMULATION_PORT}/simulation/?scene=${resolvedScene}&profile=edit&renderer=webgl&readonly=1`;
        setStreamUrl(url);
      }

      // 5. Connect WebSocket for live updates
      const engineHost = base.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
      const wsPort = base.split(':').pop();
      try {
        ws = new WebSocket(`ws://${engineHost}:${wsPort}`);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'pattern') {
              setActivePattern(msg.name);
            }
          } catch {}
        };
        ws.onerror = () => {};
      } catch {}
    })();

    return () => { if (ws) ws.close(); };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
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
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.text, fontSize: 16 }}>
           SIMULATION MONITOR
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.secondary, fontSize: 12, marginTop: 4 }}>Scene: {sceneName}</Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.primaryFixedDim, fontSize: 12, marginTop: 2 }}>Pattern: {activePattern}</Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: isConnected ? 'green' : 'red', fontSize: 12, marginTop: 2 }}>
            Engine: {isConnected === null ? 'CHECKING...' : (isConnected ? 'ONLINE' : 'OFFLINE')}
        </Text>
      </View>

      {/* Main Content */}
      {isConnected === false ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.surface, padding: 48 }}>
          <IconSymbol name="wifi.slash" size={48} color={Colors.light.error} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.error, fontSize: 24, marginTop: 24 }}>ENGINE OFFLINE</Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.secondary, marginTop: 12, textAlign: 'center', lineHeight: 22 }}>
            Cannot reach MarsinEngine at:{'\n'}
            <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.light.text }}>{apiBase || '(not configured)'}</Text>
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.secondary, marginTop: 8, textAlign: 'center', fontSize: 13 }}>
            {connectionError}
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.icon, marginTop: 24, textAlign: 'center', fontSize: 13 }}>
            Check the Config tab for IP settings and iPad Local Network permissions.
          </Text>
        </View>
      ) : streamUrl ? (
        <WebView 
          ref={webViewRef}
          source={{ uri: streamUrl }} 
          style={{ flex: 1, backgroundColor: Colors.light.surface }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback={true}
          renderError={() => (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.surface }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.error, fontSize: 24 }}>STREAM OFFLINE</Text>
              <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.secondary, marginTop: 8 }}>
                Ensure WebGL Simulation is running.
              </Text>
            </View>
          )}
        />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.surface }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.secondary, fontSize: 18 }}>CONNECTING...</Text>
        </View>
      )}
    </View>
  );
}
