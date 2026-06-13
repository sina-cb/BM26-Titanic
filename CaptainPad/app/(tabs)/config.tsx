import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Linking, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGlobalStyles, shadow } from '@/styles/globalStyles';
import { usePalette, useTheme, ThemeMode } from '@/hooks/use-theme';
import { THEMES, THEME_ORDER } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getApiBase, getApiBaseAsync, getDefaultApiBase, setApiBase, testConnection, ConnectionResult } from '@/utils/api';
import { useServerDiscovery, DiscoveredServer, normalizeSubnetPrefix } from '@/hooks/useServerDiscovery';

// AsyncStorage key for the operator-picked subnet prefix (e.g. "10.1.1").
// iOS getIpAddressAsync() is unreliable when multiple interfaces are
// active (USB tether, link-local 169.254) and frequently returns the
// wrong one — see hooks/useServerDiscovery.ts. Persisting the operator's
// last working subnet means they don't have to retype it every cold
// launch, especially on the rig where the show network is fixed.
const SUBNET_OVERRIDE_KEY = '@CaptainPad:subnetOverride';

export default function ConfigScreen() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const [ip, setIp] = useState('');
  const [saved, setSaved] = useState(false);
  const [connResult, setConnResult] = useState<ConnectionResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [subnetInput, setSubnetInput] = useState('');

  const discovery = useServerDiscovery();

  // Wait for async resolution before displaying anything
  useEffect(() => {
    getApiBaseAsync().then(base => {
      setIp(base);
    });
  }, []);

  // Hydrate the operator-picked subnet override from disk so a cold
  // launch on the rig's known network doesn't require retyping.
  useEffect(() => {
    AsyncStorage.getItem(SUBNET_OVERRIDE_KEY).then(stored => {
      if (stored && normalizeSubnetPrefix(stored)) {
        setSubnetInput(stored);
      }
    }).catch(() => undefined);
  }, []);

  // Auto-test connection on mount
  useEffect(() => {
    if (ip) {
      handleTestConnection();
    }
  }, []);

  // Kick off a scan using the operator's override (if any). Persists
  // the value to AsyncStorage on every successful scan-start so the
  // next cold launch can re-use it. Empty input falls through to
  // OS auto-detect inside the hook.
  const handleScan = useCallback(async () => {
    if (discovery.scanning) {
      discovery.cancel();
      return;
    }
    const normalized = normalizeSubnetPrefix(subnetInput);
    if (subnetInput.trim() && !normalized) {
      // Don't start a doomed scan — surface the format error to the
      // input field by clearing the persisted value.
      return;
    }
    if (normalized) {
      AsyncStorage.setItem(SUBNET_OVERRIDE_KEY, normalized).catch(() => undefined);
    } else {
      AsyncStorage.removeItem(SUBNET_OVERRIDE_KEY).catch(() => undefined);
    }
    discovery.scan(normalized);
  }, [subnetInput, discovery]);

  // "Auto" button: pre-fill the input with whatever the OS sees right
  // now (typically the wrong interface on iOS — but useful as a starting
  // point the operator can edit to the correct prefix).
  const handleAutoFillSubnet = useCallback(() => {
    if (discovery.autoDetectedIp) {
      const parts = discovery.autoDetectedIp.split('.');
      if (parts.length === 4) setSubnetInput(parts.slice(0, 3).join('.'));
    }
  }, [discovery.autoDetectedIp]);

  // Show inline validation hint when the field is non-empty but malformed.
  const subnetInputValid = !subnetInput.trim() || !!normalizeSubnetPrefix(subnetInput);

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
    ? C.icon
    : connResult.ok 
      ? '#34C759' 
      : C.error;

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
           <IconSymbol name="gear" size={32} color={C.primary} />
           <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 32, color: C.text, letterSpacing: 2 }}>
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
                boxShadow: shadow(0, 0, 6, statusColor, connResult?.ok ? 0.8 : 0),
              }} />
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: statusColor }}>
                {statusLabel}
              </Text>
            </View>
            {connResult?.ok && connResult.latencyMs !== undefined && (
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary }}>
                {connResult.latencyMs}ms
              </Text>
            )}
          </View>

          {/* Show server details if connected */}
          {connResult?.ok && connResult.data && (
            <View style={{ 
              backgroundColor: C.surfaceContainerLow, 
              borderRadius: 8, padding: 12, gap: 4,
              borderWidth: 1, borderColor: C.ghostBorder 
            }}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary }}>
                Pattern: <Text style={{ color: C.primary, fontFamily: 'Inter_600SemiBold' }}>{connResult.data.activePattern || '—'}</Text>
              </Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary }}>
                Model: <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold' }}>{connResult.data.activeModel || '—'}</Text>
              </Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary }}>
                Scene: <Text style={{ color: C.text, fontFamily: 'Inter_600SemiBold' }}>{connResult.data.activeScene || '—'}</Text>
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
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.error }}>
                {connResult.error}
              </Text>
            </View>
          )}

          <TouchableOpacity 
            onPress={handleTestConnection}
            disabled={isTesting}
            style={{
              marginTop: 16,
              backgroundColor: isTesting ? C.surfaceContainerHigh : C.primaryContainer,
              paddingVertical: 14,
              paddingHorizontal: 24,
              borderRadius: 10,
              alignItems: 'center',
              ...globalStyles.ambientShadow
            }}
          >
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text }}>
              {isTesting ? 'TESTING...' : 'TEST CONNECTION'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Section 1b: Appearance (dark / light / system) ────────────── */}
        <AppearancePicker />

        {/* ── Section 2: Network Discovery ──────────────────────────────── */}
        <View style={[globalStyles.card, { alignSelf: 'stretch', padding: 24, marginBottom: 24 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconSymbol name="antenna.radiowaves.left.and.right" size={24} color={C.primary} />
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text }}>
                NETWORK DISCOVERY
              </Text>
            </View>
          </View>

          {/* Subnet override input — iOS getIpAddressAsync often picks
              a link-local 169.254.x interface when USB or other
              interfaces are active, so the operator needs a way to
              point the scan at the real show subnet (e.g. "10.1.1"). */}
          <View style={{ marginBottom: 12 }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary, marginBottom: 6, letterSpacing: 0.6 }}>
              SUBNET (/24 PREFIX) — leave blank to auto-detect
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={subnetInput}
                onChangeText={setSubnetInput}
                placeholder="e.g. 10.1.1"
                placeholderTextColor={C.icon}
                editable={!discovery.scanning}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                style={{
                  flex: 1,
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 14,
                  color: C.text,
                  paddingHorizontal: 12, paddingVertical: 10,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: subnetInputValid ? C.ghostBorder : C.error,
                  backgroundColor: C.surfaceContainerLowest,
                }}
              />
              <TouchableOpacity
                onPress={handleAutoFillSubnet}
                disabled={discovery.scanning || !discovery.autoDetectedIp}
                style={{
                  paddingHorizontal: 12, paddingVertical: 10,
                  borderRadius: 8, borderWidth: 1,
                  borderColor: C.ghostBorder,
                  opacity: (discovery.scanning || !discovery.autoDetectedIp) ? 0.4 : 1,
                }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary, letterSpacing: 0.6 }}>
                  AUTO
                </Text>
              </TouchableOpacity>
            </View>
            {!subnetInputValid ? (
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.error, marginTop: 4 }}>
                Invalid — use three octets, e.g. 10.1.1
              </Text>
            ) : discovery.autoDetectedIp ? (
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon, marginTop: 4 }}>
                iOS sees this iPad as {discovery.autoDetectedIp}
              </Text>
            ) : null}
          </View>

          {/* Scan Button */}
          <TouchableOpacity
            onPress={handleScan}
            disabled={!subnetInputValid && !discovery.scanning}
            style={{
              backgroundColor: discovery.scanning ? C.error : C.primary,
              paddingVertical: 14,
              paddingHorizontal: 24,
              borderRadius: 10,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 10,
              opacity: (!subnetInputValid && !discovery.scanning) ? 0.5 : 1,
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
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary, marginBottom: 8 }}>
                Scanning {discovery.subnet ? `${discovery.subnet}.0/24` : 'subnet'}... ({scanProgressPercent}%)
              </Text>
              <View style={{ 
                height: 6, 
                backgroundColor: C.surfaceContainerHigh, 
                borderRadius: 3, 
                overflow: 'hidden' 
              }}>
                <View style={{ 
                  height: '100%', 
                  width: `${scanProgressPercent}%`, 
                  backgroundColor: C.primary, 
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
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.error }}>
                {discovery.error}
              </Text>
            </View>
          )}

          {/* Scan Complete - No Results */}
          {!discovery.scanning && discovery.progress === 1 && discovery.servers.length === 0 && !discovery.error && (
            <View style={{ marginTop: 12, padding: 12 }}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary, textAlign: 'center' }}>
                No MarsinEngine instances found on {discovery.subnet ? `${discovery.subnet}.0/24` : 'subnet'}.
              </Text>
            </View>
          )}

          {/* Discovered Server Cards */}
          {discovery.servers.length > 0 && (
            <View style={{ marginTop: 16, gap: 12 }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.secondary }}>
                DISCOVERED ({discovery.servers.length})
              </Text>
              {discovery.servers.map(server => {
                const isCurrentServer = ip === server.url;
                return (
                  <TouchableOpacity
                    key={server.ip}
                    onPress={() => handleSelectServer(server)}
                    style={{
                      backgroundColor: isCurrentServer ? 'rgba(0, 99, 155, 0.08)' : C.surfaceContainerLow,
                      borderRadius: 12,
                      padding: 16,
                      borderWidth: isCurrentServer ? 2 : 1,
                      borderColor: isCurrentServer ? C.primary : C.ghostBorder,
                      ...globalStyles.ambientShadow
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ 
                          width: 10, height: 10, borderRadius: 5, 
                          backgroundColor: '#34C759',
                          boxShadow: shadow(0, 0, 4, '#34C759', 0.8),
                        }} />
                        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: C.text }}>
                          {server.name}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary }}>
                        {server.latencyMs}ms
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: C.primary }}>
                        {server.ip}:{6968}
                      </Text>
                      {isCurrentServer && (
                        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.primary }}>
                          ACTIVE
                        </Text>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
                      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary }}>
                        Pattern: <Text style={{ color: C.text }}>{server.activePattern}</Text>
                      </Text>
                      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary }}>
                        Model: <Text style={{ color: C.text }}>{server.activeModel}</Text>
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
           <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.secondary, marginBottom: 4 }}>
             ENGINE API BASE URL
           </Text>
           <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon, marginBottom: 16 }}>
             Currently resolved: {getApiBase()}
           </Text>
           
           <TextInput
             style={{
               width: '100%',
               backgroundColor: C.surfaceContainerLowest,
               color: C.text,
               height: 56,
               borderRadius: 12,
               paddingHorizontal: 16,
               fontFamily: 'Inter_400Regular',
               fontSize: 18,
               borderWidth: 1,
               borderColor: C.ghostBorder,
               marginBottom: 24
             }}
             value={ip}
             onChangeText={setIp}
             autoCapitalize="none"
             autoCorrect={false}
             placeholder={getDefaultApiBase()}
             placeholderTextColor={C.icon}
           />

           <View style={{ flexDirection: 'row', gap: 16 }}>
             <TouchableOpacity 
               onPress={handleSave}
               style={{
                 backgroundColor: C.primary,
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
                 borderColor: C.primary,
                 paddingVertical: 16,
                 paddingHorizontal: 32,
                 borderRadius: 12,
               }}
             >
               <Text style={{ color: C.primary, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16 }}>
                 RESET TO YAML
               </Text>
             </TouchableOpacity>
           </View>
        </View>

        {/* ── Section 4: iPad Local Network Guidance ────────────────────── */}
        <View style={[globalStyles.card, { alignSelf: 'stretch', padding: 24 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <IconSymbol name="exclamationmark.triangle.fill" size={20} color="#FF9500" />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text }}>
              iPAD LOCAL NETWORK PERMISSION
            </Text>
          </View>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary, lineHeight: 20, marginBottom: 16 }}>
            If you see &quot;UNREACHABLE&quot; but the server is running, your iPad may have denied Local Network access. 
            Go to <Text style={{ fontFamily: 'Inter_600SemiBold', color: C.text }}>Settings → Privacy & Security → Local Network</Text> and 
            ensure <Text style={{ fontFamily: 'Inter_600SemiBold', color: C.primary }}>CaptainPad</Text> is toggled ON.
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary, lineHeight: 20 }}>
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

// ── AppearancePicker ──────────────────────────────────────────────────
// LIGHT / DARK / SYSTEM toggle. Persists to AsyncStorage via the
// ThemeProvider; takes effect across every tab the next paint and
// survives cold launches.
//
// Order intentionally matches the operator's mental model — LIGHT is
// the historical default, DARK is the late-night option Sina asked for
// (eye strain on the dim podium), SYSTEM is the "I trust iOS" option.
function AppearancePicker() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const { mode, scheme, setMode } = useTheme();

  // Source of truth for pickable themes is `THEMES` in theme.ts — add
  // a palette there and it shows up here automatically. SYSTEM is the
  // odd one out (not a theme, a delegation) and renders last.
  const themeOptions: { value: ThemeMode; label: string; hint: string }[] =
    THEME_ORDER.map((id) => ({ value: id, label: THEMES[id].label, hint: THEMES[id].hint }));
  const options: { value: ThemeMode; label: string; hint: string }[] = [
    ...themeOptions,
    { value: 'system', label: 'SYSTEM', hint: `Follow the iPad's setting (currently ${scheme}).` },
  ];

  return (
    <View style={[globalStyles.card, { alignSelf: 'stretch', padding: 24, marginBottom: 24 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <IconSymbol name="circle.lefthalf.filled" size={24} color={C.primary} />
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text, letterSpacing: 1 }}>
          APPEARANCE
        </Text>
      </View>

      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary, marginBottom: 16, lineHeight: 18 }}>
        Choose the theme for every CaptainPad surface. The preference is saved on this iPad and survives restarts.
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((opt) => {
          const active = opt.value === mode;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => setMode(opt.value)}
              accessibilityLabel={`Set appearance to ${opt.label}`}
              accessibilityRole="button"
              style={{
                // 5+ options no longer fit a single row across an iPad
                // Pro split-view; flex-wrap onto a second line and let
                // each pill be its content-width with a sensible min.
                minWidth: 110,
                flexGrow: 1,
                flexBasis: '18%',
                paddingVertical: 14,
                paddingHorizontal: 12,
                borderRadius: 10,
                borderWidth: active ? 2 : 1,
                borderColor: active ? C.primary : C.ghostBorder,
                backgroundColor: active ? C.primaryContainer : C.surfaceContainerLow,
                alignItems: 'center',
              }}
            >
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 13,
                color: active ? C.primary : C.text,
                letterSpacing: 1.2,
              }}>
                {opt.label}
              </Text>
              {active ? (
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.primary, marginTop: 4 }}>
                  ACTIVE
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Per-option hint for the currently-selected mode. Reads at a
          glance without making the operator chase tooltips. */}
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon, marginTop: 14 }}>
        {options.find((o) => o.value === mode)?.hint ?? ''}
      </Text>
    </View>
  );
}
