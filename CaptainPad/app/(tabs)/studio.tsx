import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { fetchPatterns, fetchPatternCode, savePatternCode } from '@/utils/api';

export default function StudioScreen() {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string>('');
  const [code, setCode] = useState<string>('// Select a pattern to edit');
  const [logs, setLogs] = useState<string>('> Compiler ready.\n> Waiting for file selection...');

  useEffect(() => {
    loadPatterns();
  }, []);

  const loadPatterns = async () => {
    const data = await fetchPatterns();
    if (Array.isArray(data)) {
      setPatterns(data);
      if (data.length > 0 && !activeFile) {
        handleSelectFile(data[0]);
      }
    }
  };

  const handleSelectFile = async (name: string) => {
    setActiveFile(name);
    setLogs(`> Fetching ${name}...`);
    const fetchedCode = await fetchPatternCode(name);
    if (fetchedCode) {
      setCode(fetchedCode);
      setLogs(`> Loaded ${name} (${fetchedCode.length} bytes)\n> Awaiting compilation...`);
    } else {
      setLogs(`> Error: Failed to load ${name}`);
    }
  };

  const handleSave = async () => {
    if (!activeFile) return;
    setLogs(`> Compiling via WASM VM...\n> Saving to ${activeFile}...`);
    const result = await savePatternCode(activeFile, code);
    if (result && !result.error) {
      setLogs(prev => prev + `\n> SUCCESS. Broadcasted state to swarm.`);
    } else {
      setLogs(prev => prev + `\n> ERROR: ${result?.error || 'Unknown error during save'}`);
    }
  };

  return (
    <View style={globalStyles.container}>
      {/* Left Pane - File Explorer */}
      <View style={globalStyles.leftPane}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <Text style={globalStyles.headline}>Files</Text>
          <IconSymbol name="curlybraces" size={24} color={Colors.light.secondary} />
        </View>

        <ScrollView contentContainerStyle={{ gap: 16 }}>
          {patterns.map((ptn) => (
            <TouchableOpacity key={ptn} onPress={() => handleSelectFile(ptn)}>
              <View style={[
                  globalStyles.card, 
                  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                  activeFile === ptn ? { borderColor: Colors.light.primary, borderWidth: 2 } : {}
              ]}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', color: activeFile === ptn ? Colors.light.primary : Colors.light.text }}>{ptn}</Text>
                <IconSymbol name="chevron.right" size={20} color={activeFile === ptn ? Colors.light.primary : Colors.light.icon} />
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity onPress={loadPatterns} style={{ marginTop: 32, padding: 16, alignItems: 'center', ...globalStyles.surfaceLowest, ...globalStyles.ambientShadow }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.primary }}>REFRESH DISK</Text>
        </TouchableOpacity>
      </View>

      {/* Right Pane - Code Editor */}
      <View style={[globalStyles.rightPane, { marginTop: 20 }]}>
        
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24 }}>{activeFile || 'No file selected'}</Text>
          
          <TouchableOpacity onPress={handleSave} style={{ backgroundColor: Colors.light.primaryContainer, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, ...globalStyles.ambientShadow }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.text }}>SAVE & COMPILE</Text>
          </TouchableOpacity>
        </View>

        <View style={{ flex: 4, backgroundColor: Colors.light.surfaceContainerLowest, borderRadius: 16, padding: 24, ...globalStyles.ghostBorder, ...globalStyles.ambientShadow }}>
          <TextInput 
            multiline={true}
            value={code}
            onChangeText={setCode}
            style={{ fontFamily: 'Inter_400Regular', fontSize: 16, color: Colors.light.text, lineHeight: 24, flex: 1, textAlignVertical: 'top' }}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
        </View>

        <View style={{ flex: 1, backgroundColor: '#000', borderRadius: 16, marginTop: 16, padding: 20 }}>
          <ScrollView>
            <Text style={{ fontFamily: 'Inter_400Regular', color: '#00daf3', fontSize: 12 }}>
              {logs}
            </Text>
          </ScrollView>
        </View>

      </View>
    </View>
  );
}
