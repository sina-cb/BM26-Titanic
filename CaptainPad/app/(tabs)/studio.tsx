import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Modal, KeyboardAvoidingView, Platform, SafeAreaView, useWindowDimensions } from 'react-native';
import { globalStyles } from '@/styles/globalStyles';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { fetchPatterns, fetchPatternCode, savePatternCode } from '@/utils/api';

export default function StudioScreen() {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string>('');
  const [code, setCode] = useState<string>('// Select a pattern to edit');
  const [logs, setLogs] = useState<string>('> Compiler ready.\n> Waiting for file selection...');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{title: string, message: string, type: 'success' | 'error'} | null>(null);

  const { width, height } = useWindowDimensions();
  const isPortrait = height > width;

  const showToast = (title: string, message: string, type: 'success'|'error') => {
    setToastMessage({ title, message, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

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
      showToast('COMPILED SUCCESSFULLY', `Loaded ${activeFile} into VM engine`, 'success');
    } else {
      setLogs(prev => prev + `\n> ERROR: ${result?.error || 'Unknown error during save'}`);
      showToast('COMPILATION ERROR', result?.error || 'Unknown error during compilation', 'error');
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
          <Text 
            numberOfLines={1} 
            ellipsizeMode="middle" 
            style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, flexShrink: 1, marginRight: 16 }}
          >
            {activeFile || 'No file selected'}
          </Text>
          
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <TouchableOpacity onPress={() => handleSave()} style={{ backgroundColor: Colors.light.primaryContainer, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, ...globalStyles.ambientShadow }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.text }}>RUN</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsEditing(true)} disabled={!activeFile} style={{ backgroundColor: activeFile ? '#00daf3' : Colors.light.surfaceContainerHigh, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, ...globalStyles.ambientShadow }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: activeFile ? '#FFF' : Colors.light.secondary }}>EDIT</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Custom Syntax Highlighted Render (Read-Only Preview) */}
        <View style={{ flex: 4, backgroundColor: '#1E1E1E', borderRadius: 12, padding: 16, ...globalStyles.ghostBorder, ...globalStyles.ambientShadow }}>
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={true}>
              <Text style={{ fontFamily: 'Courier', fontSize: 13, lineHeight: 18 }}>
                {code.split(/(\b(?:function|var|let|const|if|else|return|for|while|import|export)\b|\/\*[\s\S]*?\*\/|\/\/.*|'.*?'|".*?"|\b\d+(?:\.\d+)?\b|[{}()\[\]=+\-/*<>!&|]+)/g).map((token, i) => {
                  if (!token) return null;
                  if (token.startsWith('//') || token.startsWith('/*')) return <Text key={i} style={{color: '#6A9955'}}>{token}</Text>;
                  if (/^(?:function|var|let|const|if|else|return|for|while|import|export)$/.test(token)) return <Text key={i} style={{color: '#569CD6', fontWeight: 'bold'}}>{token}</Text>;
                  if (/^\d+(?:\.\d+)?$/.test(token)) return <Text key={i} style={{color: '#B5CEA8'}}>{token}</Text>;
                  if (token.startsWith("'") || token.startsWith('"')) return <Text key={i} style={{color: '#CE9178'}}>{token}</Text>;
                  if (/^[{}()\[\]=+\-/*<>!&|]+$/.test(token)) return <Text key={i} style={{color: '#D4D4D4'}}>{token}</Text>;
                  if (/^(?:time|wave|sin|cos|rgb|hsv|rgbwau|triangle|square|max|min|abs|floor|pow|random)\b/.test(token)) return <Text key={i} style={{color: '#DCDCAA'}}>{token}</Text>;
                  if (/^(?:beforeRender|render3D)\b/.test(token)) return <Text key={i} style={{color: '#4EC9B0', fontWeight: 'bold'}}>{token}</Text>;
                  return <Text key={i} style={{color: '#9CDCFE'}}>{token}</Text>;
                })}
              </Text>
          </ScrollView>
        </View>

      </View>

      {/* Fullscreen Editor Modal */}
      <Modal visible={isEditing} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: '#0A0A0A' }}>
          <SafeAreaView style={{ flex: 1 }}>
            
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16, backgroundColor: '#191C1D' }}>
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                 <IconSymbol name="curlybraces" size={24} color="#00daf3" />
                 <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#00daf3' }}>{activeFile}</Text>
               </View>

               <View style={{ flexDirection: 'row', gap: 16 }}>
                 <TouchableOpacity onPress={() => setIsEditing(false)} style={{ backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}>
                   <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#FFF' }}>CLOSE</Text>
                 </TouchableOpacity>
                 <TouchableOpacity onPress={() => handleSave()} style={{ backgroundColor: '#00daf3', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}>
                   <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000' }}>SAVE & COMPILE</Text>
                 </TouchableOpacity>
               </View>
            </View>

            {/* Split Screen Responsive Modal Layout */}
            <View style={{ flex: 1, flexDirection: isPortrait ? 'column' : 'row', backgroundColor: '#000' }}>
              
              {/* Left/Top Column - Full Code IDE */}
              <View style={{ flex: isPortrait ? 3 : 13, backgroundColor: '#1E1E1E', margin: 16, marginBottom: isPortrait ? 8 : 16, borderRadius: 12, overflow: 'hidden' }}>
                <ScrollView showsVerticalScrollIndicator={true} style={{ flex: 1 }}>
                   <View style={{ position: 'relative' }}>
                      
                      {/* Sub-Layer: Syntax Display (Provides height natively) */}
                      <Text style={{ 
                          fontFamily: 'Courier', 
                          fontSize: 14, 
                          lineHeight: 20, 
                          color: '#d4d4d4',
                          padding: 24,
                          margin: 0
                      }}>
                        {code.split(/(\b(?:function|var|let|const|if|else|return|for|while|import|export)\b|\/\*[\s\S]*?\*\/|\/\/.*|'.*?'|".*?"|\b\d+(?:\.\d+)?\b|[{}()\[\]=+\-/*<>!&|]+)/g).map((token, i) => {
                          if (!token) return null;
                          if (token.startsWith('//') || token.startsWith('/*')) return <Text key={i} style={{color: '#6A9955'}}>{token}</Text>;
                          if (/^(?:function|var|let|const|if|else|return|for|while|import|export)$/.test(token)) return <Text key={i} style={{color: '#569CD6', fontWeight: 'bold'}}>{token}</Text>;
                          if (/^\d+(?:\.\d+)?$/.test(token)) return <Text key={i} style={{color: '#B5CEA8'}}>{token}</Text>;
                          if (token.startsWith("'") || token.startsWith('"')) return <Text key={i} style={{color: '#CE9178'}}>{token}</Text>;
                          if (/^[{}()\[\]=+\-/*<>!&|]+$/.test(token)) return <Text key={i} style={{color: '#D4D4D4'}}>{token}</Text>;
                          if (/^(?:time|wave|sin|cos|rgb|hsv|rgbwau|triangle|square|max|min|abs|floor|pow|random)\b/.test(token)) return <Text key={i} style={{color: '#DCDCAA'}}>{token}</Text>;
                          if (/^(?:beforeRender|render3D)\b/.test(token)) return <Text key={i} style={{color: '#4EC9B0', fontWeight: 'bold'}}>{token}</Text>;
                          return <Text key={i} style={{color: '#9CDCFE'}}>{token}</Text>;
                        })}
                      </Text>

                      {/* Top-Layer: Transparent Interactive Input (Overlays perfectly) */}
                      <TextInput 
                        multiline={true}
                        value={code}
                        onChangeText={setCode}
                        style={{ 
                          position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
                          fontFamily: 'Courier', 
                          fontSize: 14, 
                          lineHeight: 20, 
                          color: 'rgba(255, 255, 255, 0)',
                          padding: 24,
                          margin: 0,
                          textAlignVertical: 'top',
                          zIndex: 10
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        spellCheck={false}
                        keyboardType="ascii-capable"
                        selectionColor="#00daf3"
                      />

                   </View>
                </ScrollView>
              </View>

              {/* Right/Bottom Column - Compiler Logs */}
              <View style={{ flex: isPortrait ? 1 : 10, backgroundColor: '#111', margin: 16, marginTop: isPortrait ? 8 : 16, marginLeft: isPortrait ? 16 : 0, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#333', overflow: 'hidden' }}>
                 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                   <IconSymbol name="terminal" size={16} color={Colors.light.secondary} />
                   <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: Colors.light.secondary, fontSize: 13 }}>COMPILER LOGS</Text>
                 </View>
                 <ScrollView>
                   <Text style={{ fontFamily: 'Courier', color: '#00daf3', fontSize: 12, lineHeight: 18 }}>
                     {logs}
                   </Text>
                 </ScrollView>
              </View>

            </View>
            
          </SafeAreaView>
          
          {/* Editor Toast Notification Overlay */}
          {toastMessage && (
            <View style={{
               position: 'absolute', top: Platform.OS === 'ios' ? 60 : 40, left: 32, right: 32, 
               backgroundColor: toastMessage.type === 'error' ? 'rgba(255, 50, 50, 0.95)' : 'rgba(0, 218, 243, 0.95)',
               padding: 20, borderRadius: 12, alignItems: 'center', zIndex: 9999,
               borderWidth: 1, borderColor: toastMessage.type === 'error' ? '#FF8888' : '#FFFFFF',
               shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 10
            }}>
               <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000', fontSize: 16 }}>{toastMessage.title}</Text>
               <Text style={{ fontFamily: 'Courier', color: '#000', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{toastMessage.message}</Text>
            </View>
          )}

        </KeyboardAvoidingView>
      </Modal>

      {/* Main View Toast Notification Overlay */}
      {toastMessage && !isEditing && (
        <View style={{
           position: 'absolute', bottom: 40, left: '30%', right: '30%', 
           backgroundColor: toastMessage.type === 'error' ? 'rgba(255, 50, 50, 0.95)' : 'rgba(0, 218, 243, 0.95)',
           padding: 20, borderRadius: 12, alignItems: 'center', zIndex: 9999,
           borderWidth: 1, borderColor: toastMessage.type === 'error' ? '#FF8888' : '#FFFFFF',
           shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 10
        }}>
           <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000', fontSize: 16 }}>{toastMessage.title}</Text>
           <Text style={{ fontFamily: 'Courier', color: '#000', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{toastMessage.message}</Text>
        </View>
      )}

    </View>
  );
}
