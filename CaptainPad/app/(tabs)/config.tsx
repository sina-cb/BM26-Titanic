import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Linking, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getApiBase, getApiBaseAsync, getDefaultApiBase, setApiBase, testConnection, ConnectionResult } from '@/utils/api';
import { useServerDiscovery, DiscoveredServer } from '@/hooks/useServerDiscovery';


export default function ConfigScreen() {
  const [ip, setIp] = useState('');
  const [saved, setSaved] = useState(false);
  const [connResult, setConnResult] = useState<ConnectionResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const discovery = useServerDiscovery();

  // Wait for async resolution before displaying anything
  useEffect(() => {
    getApiBaseAsync().then(base => {
      setIp(base);
    });
  }, []);

  // Auto-test connection on mount
  useEffect(() => {
    if (ip) {
      handleTestConnection();
    }
  }, []);

  const handleSave = async () => {
    await setApiBase(ip);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    handleTestConnection();
  };

  const handleReset = async () => {
    const def = getDefaultApiBase();
    setIp(def);
    await setApiBase(def);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    const result = await testConnection(def);
    setConnResult(result);
  };

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    const result = await testConnection(ip || getApiBase());
    setConnResult(result);
    setIsTesting(false);
  }, [ip]);

  const handleSelectServer = async (server: DiscoveredServer) => {
    const newBase = server.url;
    setIp(newBase);
    await setApiBase(newBase);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    // Immediately test the selected server
    const result = await testConnection(newBase);
    setConnResult(result);
  };

  const statusColor = connResult === null 
    ? Colors.light.icon
    : connResult.ok 
      ? '#34C759' 
      : Colors.light.error;

  const statusLabel = connResult === null 
    ? 'NOT TESTED'
    : connResult.ok 
      ? 'CONNECTED' 
      : 'UNREACHABLE';

  const scanProgressPercent = Math.round(discovery.progress * 100);

  return (
    <View style={globalStyles.container}>
      <ScrollView contentContainerStyle={{ padding: 48, alignItems: 'center' }} style={{ flex: 1 }}>
        
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 48, gap: 16 }}>
           <IconSymbol name="gear" size={32} color={Colors.light.primary} />
           <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 32, color: Colors.light.text, letterSpacing: 2 }}>
             CONFIGURATION
           </Text>
        </View>

        {/* ── Section 1: Connection Status ──────────────────────────────── */}
        <View style={[globalStyles.card, { alignSelf: 'stretch', padding: 24, marginBottom: 24 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ 
                width: 14, height: 14, borderRadius: 7, 
                backgroundColor: statusColor,
                shadowColor: statusColor,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: connResult?.ok ? 0.8 : 0,
                shadowRadius: 6,
              }} />
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: statusColor }}>
                {statusLabel}
              </Text>
            </View>
            {connResult?.ok && connResult.latencyMs !== undefined && (
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.light.secondary }}>
                {connResult.latencyMs}ms
              </Text>
            )}
          </View>

          {/* Show server details if connected */}
          {connResult?.ok && connResult.data && (
            <View style={{ 
              backgroundColor: Colors.light.surfaceContainerLow, 
              borderRadius: 8, padding: 12, gap: 4,
              borderWidth: 1, borderColor: Colors.light.ghostBorder 
            }}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.light.secondary }}>
                Pattern: <Text style={{ color: Colors.light.primary, fontFamily: 'Inter_600SemiBold' }}>{connResult.data.activePattern || '—'}</Text>
              </Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.light.secondary }}>
                Model: <Text style={{ color: Colors.light.text, fontFamily: 'Inter_600SemiBold' }}>{connResult.data.activeModel || '—'}</Text>
              </Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.light.secondary }}>
                Scene: <Text style={{ color: Colors.light.text, fontFamily: 'Inter_600SemiBold' }}>{connResult.data.activeScene || '—'}</Text>
              </Text>
            </View>
          )}

          {/* Show error details if connection failed */}
          {connResult && !connResult.ok && (
            <View style={{ 
              backgroundColor: 'rgba(186, 26, 26, 0.08)', 
              borderRadius: 8, padding: 12, 
              borderWidth: 1, borderColor: 'rgba(186, 26, 26, 0.3)' 
            }}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.light.error }}>
                {connResult.error}
              </Text>
            </View>
          )}

          <TouchableOpacity 
            onPress={handleTestConnection}
            disabled={isTesting}
            style={{
              marginTop: 16,
              backgroundColor: isTesting ? Colors.light.surfaceContainerHigh : Colors.light.primaryContainer,
              paddingVertical: 14,
              paddingHorizontal: 24,
              borderRadius: 10,
              alignItems: 'center',
              ...globalStyles.ambientShadow
            }}
          >
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: Colors.light.text }}>
              {isTesting ? 'TESTING...' : 'TEST CONNECTION'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Section 2: Network Discovery ──────────────────────────────── */}
        <View style={[globalStyles.card, { alignSelf: 'stretch', padding: 24, marginBottom: 24 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconSymbol name="antenna.radiowaves.left.and.right" size={24} color={Colors.light.primary} />
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: Colors.light.text }}>
                NETWORK DISCOVERY
              </Text>
            </View>
          </View>

          {/* Scan Button */}
          <TouchableOpacity
            onPress={discovery.scanning ? discovery.cancel : discovery.scan}
            style={{
              backgroundColor: discovery.scanning ? Colors.light.error : Colors.light.primary,
              paddingVertical: 14,
              paddingHorizontal: 24,
              borderRadius: 10,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 10,
              ...globalStyles.ambientShadow
            }}
          >
            {discovery.scanning && <ActivityIndicator size="small" color="#FFF" />}
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: '#FFF' }}>
              {discovery.scanning ? 'CANCEL SCAN' : 'SCAN NETWORK'}
            </Text>
          </TouchableOpacity>

          {/* Scan Progress */}
          {discovery.scanning && (
            <View style={{ marginTop: 16 }}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.light.secondary, marginBottom: 8 }}>
                Scanning {discovery.subnet ? `${discovery.subnet}.0/24` : 'subnet'}... ({scanProgressPercent}%)
              </Text>
              <View style={{ 
                height: 6, 
                backgroundColor: Colors.light.surfaceContainerHigh, 
                borderRadius: 3, 
                overflow: 'hidden' 
              }}>
                <View style={{ 
                  height: '100%', 
                  width: `${scanProgressPercent}%`, 
                  backgroundColor: Colors.light.primary, 
                  borderRadius: 3 
                }} />
              </View>
            </View>
          )}

          {/* Scan Error */}
          {discovery.error && (
            <View style={{ 
              marginTop: 12,
              backgroundColor: 'rgba(186, 26, 26, 0.08)', 
              borderRadius: 8, padding: 12, 
              borderWidth: 1, borderColor: 'rgba(186, 26, 26, 0.3)' 
            }}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.light.error }}>
                {discovery.error}
              </Text>
            </View>
          )}

          {/* Scan Complete - No Results */}
          {!discovery.scanning && discovery.progress === 1 && discovery.servers.length === 0 && !discovery.error && (
            <View style={{ marginTop: 12, padding: 12 }}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.light.secondary, textAlign: 'center' }}>
                No MarsinEngine instances found on {discovery.subnet ? `${discovery.subnet}.0/24` : 'subnet'}.
              </Text>
            </View>
          )}

          {/* Discovered Server Cards */}
          {discovery.servers.length > 0 && (
            <View style={{ marginTop: 16, gap: 12 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: Colors.light.secondary }}>
                DISCOVERED ({discovery.servers.length})
              </Text>
              {discovery.servers.map(server => {
                const isCurrentServer = ip === server.url;
                return (
                  <TouchableOpacity
                    key={server.ip}
                    onPress={() => handleSelectServer(server)}
                    style={{
                      backgroundColor: isCurrentServer ? 'rgba(0, 99, 155, 0.08)' : Colors.light.surfaceContainerLow,
                      borderRadius: 12,
                      padding: 16,
                      borderWidth: isCurrentServer ? 2 : 1,
                      borderColor: isCurrentServer ? Colors.light.primary : Colors.light.ghostBorder,
                      ...globalStyles.ambientShadow
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ 
                          width: 10, height: 10, borderRadius: 5, 
                          backgroundColor: '#34C759',
                          shadowColor: '#34C759',
                          shadowOffset: { width: 0, height: 0 },
                          shadowOpacity: 0.8,
                          shadowRadius: 4,
                        }} />
                        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: Colors.light.text }}>
                          {server.name}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.light.secondary }}>
                        {server.latencyMs}ms
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: Colors.light.primary }}>
                        {server.ip}:{6968}
                      </Text>
                      {isCurrentServer && (
                        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: Colors.light.primary }}>
                          ACTIVE
                        </Text>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
                      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.light.secondary }}>
                        Pattern: <Text style={{ color: Colors.light.text }}>{server.activePattern}</Text>
                      </Text>
                      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.light.secondary }}>
                        Model: <Text style={{ color: Colors.light.text }}>{server.activeModel}</Text>
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Section 3: Engine API Base URL ────────────────────────────── */}
        <View style={[globalStyles.card, { alignSelf: 'stretch', alignItems: 'flex-start', padding: 32, marginBottom: 24 }]}>
           <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: Colors.light.secondary, marginBottom: 4 }}>
             ENGINE API BASE URL
           </Text>
           <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.light.icon, marginBottom: 16 }}>
             Currently resolved: {getApiBase()}
           </Text>
           
           <TextInput
             style={{
               width: '100%',
               backgroundColor: Colors.light.surfaceContainerLowest,
               color: Colors.light.text,
               height: 56,
               borderRadius: 12,
               paddingHorizontal: 16,
               fontFamily: 'Inter_400Regular',
               fontSize: 18,
               borderWidth: 1,
               borderColor: Colors.light.ghostBorder,
               marginBottom: 24
             }}
             value={ip}
             onChangeText={setIp}
             autoCapitalize="none"
             autoCorrect={false}
             placeholder={getDefaultApiBase()}
             placeholderTextColor={Colors.light.icon}
           />

           <View style={{ flexDirection: 'row', gap: 16 }}>
             <TouchableOpacity 
               onPress={handleSave}
               style={{
                 backgroundColor: Colors.light.primary,
                 paddingVertical: 16,
                 paddingHorizontal: 32,
                 borderRadius: 12,
                 ...globalStyles.ambientShadow
               }}
             >
               <Text style={{ color: 'white', fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16 }}>
                 {saved ? 'SAVED ✓' : 'SAVE CONFIG'}
               </Text>
             </TouchableOpacity>

             <TouchableOpacity 
               onPress={handleReset}
               style={{
                 backgroundColor: 'transparent',
                 borderWidth: 1,
                 borderColor: Colors.light.primary,
                 paddingVertical: 16,
                 paddingHorizontal: 32,
                 borderRadius: 12,
               }}
             >
               <Text style={{ color: Colors.light.primary, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16 }}>
                 RESET TO YAML
               </Text>
             </TouchableOpacity>
           </View>
        </View>

        {/* ── Section 4: iPad Local Network Guidance ────────────────────── */}
        <View style={[globalStyles.card, { alignSelf: 'stretch', padding: 24 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <IconSymbol name="exclamationmark.triangle.fill" size={20} color="#FF9500" />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: Colors.light.text }}>
              iPAD LOCAL NETWORK PERMISSION
            </Text>
          </View>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.light.secondary, lineHeight: 20, marginBottom: 16 }}>
            If you see &quot;UNREACHABLE&quot; but the server is running, your iPad may have denied Local Network access. 
            Go to <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.light.text }}>Settings → Privacy & Security → Local Network</Text> and 
            ensure <Text style={{ fontFamily: 'Inter_600SemiBold', color: Colors.light.primary }}>CaptainPad</Text> is toggled ON.
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.light.secondary, lineHeight: 20 }}>
            On first launch after a fresh install, iOS will show a permission dialog — tap &quot;Allow&quot; to enable local network communication.
            If you previously denied it, delete and reinstall the app to reset the permission, or enable it manually in Settings.
          </Text>
          <TouchableOpacity 
            onPress={() => Linking.openURL('App-Prefs:PRIVACY&path=LOCAL_NETWORK')}
            style={{
              marginTop: 16,
              backgroundColor: 'transparent',
              borderWidth: 1,
              borderColor: '#FF9500',
              paddingVertical: 12,
              paddingHorizontal: 24,
              borderRadius: 10,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: '#FF9500' }}>
              OPEN iPAD SETTINGS
            </Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}
