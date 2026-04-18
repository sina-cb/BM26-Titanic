import React, { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { getApiBase } from '@/utils/api';

export default function MonitorScreen() {
  const [activePattern, setActivePattern] = useState<string>('...');

  // The simulation server runs on port 6969 on the same host as the engine API.
  // Extract the host from API_BASE so we only configure it in one place.
  const apiBaseStr = getApiBase();
  const engineHost = apiBaseStr.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
  const SIMULATION_PORT = 6969;

  // The engine CLI uses --model <name> which maps 1:1 to scenes/<name> in the simulation.
  // Since the engine is running with '--model test_bench', we match that scene.
  // TODO: Query a /status endpoint on the engine to get this dynamically when available.
  const SCENE_NAME = 'test_bench';

  const SIMULATION_URL = `http://${engineHost}:${SIMULATION_PORT}/simulation/?scene=${SCENE_NAME}&readonly=1`;

  // Connect to the engine WebSocket to get live pattern info
  useEffect(() => {
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
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.text, fontSize: 16 }}>SIMULATION MONITOR</Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.secondary, fontSize: 12, marginTop: 4 }}>Scene: {SCENE_NAME}</Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.primaryFixedDim, fontSize: 12, marginTop: 2 }}>Pattern: {activePattern}</Text>
      </View>

      <WebView 
        source={{ uri: SIMULATION_URL }} 
        style={{ flex: 1, backgroundColor: Colors.light.surface }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        renderError={() => (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.surface }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.error, fontSize: 24 }}>SIMULATION OFFLINE</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', color: Colors.light.secondary, marginTop: 8 }}>
              Ensure simulation is running at {SIMULATION_URL}
            </Text>
          </View>
        )}
      />
    </View>
  );
}
