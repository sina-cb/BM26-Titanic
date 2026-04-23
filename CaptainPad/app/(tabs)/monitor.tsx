import React, { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { getApiBase } from '@/utils/api';

export default function MonitorScreen() {
  const [activePattern, setActivePattern] = useState<string>('...');
  const [sceneName, setSceneName] = useState<string>('Loading...');
  const [unrealState, setUnrealState] = useState<string>('offline');

  const apiBaseStr = getApiBase();
  const engineHost = apiBaseStr.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
  const SIMULATION_PORT = 6969;
  const PIXEL_STREAM_PORT = 80;

  useEffect(() => {
    // Poll status initially
    fetch(`${getApiBase()}/status`)
      .then(res => res.json())
      .then(data => {
        setSceneName(data.activeScene);
        setActivePattern(data.activePattern);
        setUnrealState(data.unrealState);
      })
      .catch(() => {});

    // WebSockets
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`ws://${engineHost}:${getApiBase().split(':').pop()}`);
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
    return () => { if (ws) ws.close(); };
  }, []);

  const STREAM_URL = unrealState === 'streaming' 
    ? `http://${engineHost}:${PIXEL_STREAM_PORT}/`
    : `http://${engineHost}:${SIMULATION_PORT}/simulation/?scene=${sceneName}&readonly=1`;

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
           {unrealState === 'streaming' ? 'UNREAL MONITOR' : 'SIMULATION MONITOR'}
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.secondary, fontSize: 12, marginTop: 4 }}>Scene: {sceneName}</Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.primaryFixedDim, fontSize: 12, marginTop: 2 }}>Pattern: {activePattern}</Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: unrealState === 'streaming' ? 'green' : 'orange', fontSize: 12, marginTop: 2 }}>
            Engine: {unrealState.toUpperCase()}
        </Text>
      </View>

      <WebView 
        source={{ uri: STREAM_URL }} 
        style={{ flex: 1, backgroundColor: Colors.light.surface }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        renderError={() => (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.surface }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.error, fontSize: 24 }}>STREAM OFFLINE</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.secondary, marginTop: 8 }}>
              Ensure {unrealState === 'streaming' ? 'Pixel Streaming' : 'WebGL Simulation'} is running.
            </Text>
          </View>
        )}
      />
    </View>
  );
}
