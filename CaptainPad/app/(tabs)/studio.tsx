import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Modal, KeyboardAvoidingView, Platform, SafeAreaView, useWindowDimensions, type TextStyle } from 'react-native';
import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation';
import { useGlobalStyles, shadow } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { CodeHighlight } from '@/components/code_highlight';
import { caretScrollTarget, TAB_INSERTION } from '@/components/studio_editor_logic';
import { fetchPatterns, fetchPatternCode, savePatternCode, setActivePattern, getApiBaseAsync } from '@/utils/api';
import { PerformanceRouteGuard } from '@/components/performance_route_guard';
import { ConfigSubviewFrame } from '@/components/config_subview_frame';

// ---------------------------------------------------------------------------
// Editor geometry constants. The highlight sub-layer and the transparent
// <textarea> laid over it MUST use byte-identical metrics or their soft-wrap
// points diverge, the textarea grows taller than the glyphs you can see, and
// every tap lands on the wrong line (debug report 20260725_27, D2/D3).
// Change these ONLY in pairs.
const EDITOR_FONT_FAMILY = 'Courier';
const EDITOR_FONT_SIZE = 14;
const EDITOR_LINE_HEIGHT = 20;
const EDITOR_PADDING = 24;
// Keep the caret this far from the top/bottom edge while typing (A5).
const CARET_SCROLL_MARGIN = 60;

// Web-only CSS the RN style types don't model:
//   caretColor  — react-native-web 0.21 DROPS the `selectionColor` prop
//                 entirely, so with transparent text the caret inherits
//                 `currentColor` = fully transparent. This single line is the
//                 headline "cursor is broken" fix (D1).
//   overflow    — kills the textarea's internal scrollbar: the ~15px it stole
//                 from the wrap width is what desynced the two layers, and an
//                 internally scrollable textarea is what permanently broke the
//                 editor after one trip to EOF (D2/D3).
const WEB_EDITOR_INPUT_STYLE = (Platform.OS === 'web'
  ? { caretColor: '#00daf3', overflow: 'hidden' }
  : null) as TextStyle | null;

// STUDIO is a CONFIG sub-view (operator ruling 2026-08-15) — same route,
// same screen, just reached from a card in CONFIG instead of a rail slot.
export default function StudioScreen() {
  return (
    <PerformanceRouteGuard routeName="studio">
      <ConfigSubviewFrame routeName="studio">
        <StudioScreenContent />
      </ConfigSubviewFrame>
    </PerformanceRouteGuard>
  );
}

function StudioScreenContent() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const [patterns, setPatterns] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string>('');
  const [code, setCode] = useState<string>('// Select a pattern to edit');
  const [logs, setLogs] = useState<string>('> Compiler ready.\n> Waiting for file selection...');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{title: string, message: string, type: 'success' | 'error'} | null>(null);

  const { width, height } = useWindowDimensions();
  const isPortrait = height > width;

  // --- Editor plumbing (web DOM; no-ops on native) -------------------------
  const inputRef = useRef<TextInput>(null);
  const editorScrollRef = useRef<ScrollView>(null);
  const caretMirrorRef = useRef<HTMLDivElement | null>(null);
  const caretRafRef = useRef<number | null>(null);
  // A4: react-native-web's KeyboardAvoidingView is a literal no-op
  // (onKeyboardChange() {}), so the iPad's on-screen keyboard used to cover
  // ~40-60% of the modal with zero relayout. visualViewport.height is the
  // only truthful "space left above the keyboard" signal on web.
  const [webViewportHeight, setWebViewportHeight] = useState<number | null>(null);

  const getTextArea = useCallback((): HTMLTextAreaElement | null => {
    if (Platform.OS !== 'web') return null;
    return (inputRef.current as unknown as HTMLTextAreaElement | null);
  }, []);

  const getScrollNode = useCallback((): HTMLElement | null => {
    if (Platform.OS !== 'web') return null;
    const sv = editorScrollRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null;
    if (!sv) return null;
    if (typeof sv.getScrollableNode !== 'function') {
      // Loud, not silent: caret-follow depends on this RNW API.
      console.error('[studio] ScrollView.getScrollableNode() missing — caret follow disabled (RNW API changed).');
      return null;
    }
    return sv.getScrollableNode();
  }, []);

  // A5: caret-follow. The textarea can no longer scroll itself (A2 pins it),
  // and the browser never scrolls the OUTER RN ScrollView, so we measure the
  // caret's Y with a hidden mirror div (valid only because A2 guarantees the
  // mirror, the textarea and the highlight all wrap identically) and scroll
  // the outer scroller ourselves.
  const syncCaretIntoView = useCallback(() => {
    const ta = getTextArea();
    const scroller = getScrollNode();
    if (!ta || !scroller) return;

    let mirror = caretMirrorRef.current;
    if (!mirror) {
      mirror = document.createElement('div');
      mirror.setAttribute('aria-hidden', 'true');
      document.body.appendChild(mirror);
      caretMirrorRef.current = mirror;
    }
    const cs = window.getComputedStyle(ta);
    mirror.style.cssText = [
      'position:absolute', 'top:0', 'left:-99999px', 'visibility:hidden',
      'box-sizing:border-box', 'white-space:pre-wrap',
      'overflow-wrap:break-word', 'word-wrap:break-word',
      `width:${ta.clientWidth}px`,
      `font-family:${cs.fontFamily}`, `font-size:${cs.fontSize}`,
      `line-height:${cs.lineHeight}`, `letter-spacing:${cs.letterSpacing}`,
      `padding:${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      `tab-size:${cs.tabSize}`,
    ].join(';');

    const caretIndex = ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd;
    mirror.textContent = ta.value.slice(0, caretIndex);
    const marker = document.createElement('span');
    marker.textContent = String.fromCharCode(0x200b); // zero-width space probe
    mirror.appendChild(marker);

    const next = caretScrollTarget({
      caretTop: marker.offsetTop,
      caretHeight: EDITOR_LINE_HEIGHT,
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
      margin: CARET_SCROLL_MARGIN,
      contentHeight: scroller.scrollHeight,
    });
    if (next != null) editorScrollRef.current?.scrollTo({ y: next, animated: false });
  }, [getScrollNode, getTextArea]);

  const scheduleCaretSync = useCallback(() => {
    if (Platform.OS !== 'web') return;
    if (caretRafRef.current != null) return;
    caretRafRef.current = window.requestAnimationFrame(() => {
      caretRafRef.current = null;
      syncCaretIntoView();
    });
  }, [syncCaretIntoView]);

  // A6 (Tab -> 2 spaces, keeping the native undo stack) + A5 listeners.
  useEffect(() => {
    if (Platform.OS !== 'web' || !isEditing) return;
    const ta = getTextArea();
    if (!ta) {
      console.error('[studio] editor textarea ref missing — Tab key + caret follow inactive.');
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      // execCommand('insertText') is the ONLY insert that preserves the
      // browser's native undo stack — a setState value splice destroys it.
      document.execCommand('insertText', false, TAB_INSERTION);
    };
    const onCaretEvent = () => scheduleCaretSync();
    ta.addEventListener('keydown', onKeyDown);
    ta.addEventListener('input', onCaretEvent);
    ta.addEventListener('keyup', onCaretEvent);
    ta.addEventListener('click', onCaretEvent);
    ta.addEventListener('select', onCaretEvent);
    return () => {
      ta.removeEventListener('keydown', onKeyDown);
      ta.removeEventListener('input', onCaretEvent);
      ta.removeEventListener('keyup', onCaretEvent);
      ta.removeEventListener('click', onCaretEvent);
      ta.removeEventListener('select', onCaretEvent);
      if (caretRafRef.current != null) {
        window.cancelAnimationFrame(caretRafRef.current);
        caretRafRef.current = null;
      }
    };
  }, [isEditing, getTextArea, scheduleCaretSync]);

  // A4: track the space left above the on-screen keyboard while the modal is open.
  useEffect(() => {
    if (Platform.OS !== 'web' || !isEditing) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setWebViewportHeight(vv.height);
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setWebViewportHeight(null);
    };
  }, [isEditing]);

  // Drop the caret mirror when the screen unmounts.
  useEffect(() => () => {
    const mirror = caretMirrorRef.current;
    if (mirror && mirror.parentNode) mirror.parentNode.removeChild(mirror);
    caretMirrorRef.current = null;
  }, []);

  const showToast = (title: string, message: string, type: 'success'|'error') => {
    setToastMessage({ title, message, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  useEffect(() => {
    loadPatterns();
  }, []);

  const loadPatterns = async () => {
    // Operator bug May 26 2026: studio tab loaded blank on a cold app
    // start because fetchPatterns() runs against the module-level
    // api_base which is still the YAML default until getApiBaseAsync
    // resolves AsyncStorage. Other tabs (deck/mixer) await this in
    // their connectToEngine paths; studio never did, so its first
    // GET went to the wrong host. Awaiting here makes the studio
    // self-sufficient — no dependency on tab-mount ordering.
    await getApiBaseAsync().catch(() => undefined);
    const result = await fetchPatterns();
    if (result.ok && result.data && Array.isArray(result.data)) {
      setPatterns(result.data);
      if (result.data.length > 0 && !activeFile) {
        handleSelectFile(result.data[0]);
      } else if (result.data.length === 0) {
        setLogs('> No pattern files found. Check engine connectivity.');
      }
    } else {
      setLogs(`> Error loading pattern list: ${result.error || 'unknown'}`);
    }
  };

  const handleSelectFile = async (name: string) => {
    setActiveFile(name);
    setLogs(`> Fetching ${name}...`);
    const result = await fetchPatternCode(name);
    if (result.ok && result.data) {
      setCode(result.data);
      setLogs(`> Loaded ${name} (${result.data.length} bytes)\n> Awaiting compilation...`);
    } else {
      setLogs(`> Error: ${result.error || 'Failed to load ' + name}`);
    }
  };

  // In-flight guard so a fast double-tap on RUN / SAVE & COMPILE
  // can't fire two overlapping save+set-pattern chains. Operator bug
  // May 26 2026: "sometimes it works, mostly it doesn't" was tracing
  // to this — the engine would respond to the first request mid-way
  // through, the second request would race the deck handle swap, and
  // the deck either ended up on the OLD pattern or threw a 409 we
  // were silently swallowing.
  const runInFlightRef = React.useRef(false);
  const [runBusy, setRunBusy] = useState(false);

  const handleSave = async () => {
    if (runInFlightRef.current) {
      setLogs(prev => prev + `\n> Run already in progress — ignoring tap.`);
      return;
    }
    if (!activeFile) {
      setLogs(`> No pattern selected. Tap a file on the left first.`);
      showToast('NO FILE SELECTED', 'Pick a pattern file before pressing RUN', 'error');
      return;
    }
    runInFlightRef.current = true;
    setRunBusy(true);
    setLogs(`> Compiling via WASM VM...\n> Saving to ${activeFile}...`);
    try {
      // Make sure api_base is resolved (cold-start safety — see loadPatterns).
      await getApiBaseAsync().catch(() => undefined);

      const result = await savePatternCode(activeFile, code);
      if (!result.ok || !result.data || result.data.error) {
        const errMsg = result.data?.error || result.error || 'Unknown error during save';
        setLogs(prev => prev + `\n> ERROR: ${errMsg}`);
        showToast('COMPILATION ERROR', errMsg, 'error');
        return;
      }
      setLogs(prev => prev + `\n> SAVED + compiled OK. Switching deck channel...`);

      const ptnName = activeFile.replace(/\.js$/, '');
      const setRes = await setActivePattern(ptnName);
      if (setRes.ok && setRes.data && !setRes.data.error) {
        setLogs(prev => prev + `\n> SUCCESS — deck is now running ${ptnName}.`);
        showToast('COMPILED SUCCESSFULLY', `Loaded ${activeFile} into VM engine`, 'success');
      } else {
        const errMsg = setRes.data?.error || setRes.error || 'engine did not switch deck';
        setLogs(prev => prev + `\n> WARN: save OK but deck switch failed: ${errMsg}`);
        showToast('COMPILED · DECK NOT SWITCHED', errMsg, 'error');
      }
    } finally {
      runInFlightRef.current = false;
      setRunBusy(false);
    }
  };

  return (
    <View style={globalStyles.container}>
      {/* Left Pane - File Explorer */}
      <View style={globalStyles.leftPane}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <Text style={globalStyles.headline}>Files</Text>
          <IconSymbol name="curlybraces" size={24} color={C.secondary} />
        </View>

        <ScrollView contentContainerStyle={{ gap: 16 }}>
          {patterns.map((ptn) => (
            <TouchableOpacity key={ptn} onPress={() => handleSelectFile(ptn)}>
              <View style={[
                  globalStyles.card, 
                  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                  activeFile === ptn ? { borderColor: C.primary, borderWidth: 2 } : {}
              ]}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', color: activeFile === ptn ? C.primary : C.text }}>{ptn}</Text>
                <IconSymbol name="chevron.right" size={20} color={activeFile === ptn ? C.primary : C.icon} />
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity onPress={loadPatterns} style={{ marginTop: 32, padding: 16, alignItems: 'center', ...globalStyles.surfaceLowest, ...globalStyles.ambientShadow }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary }}>REFRESH DISK</Text>
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
            <TouchableOpacity
              onPress={() => handleSave()}
              disabled={runBusy || !activeFile}
              style={{
                backgroundColor: (!activeFile || runBusy) ? C.surfaceContainerHigh : C.primaryContainer,
                paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8,
                opacity: (!activeFile || runBusy) ? 0.55 : 1,
                ...globalStyles.ambientShadow,
              }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text }}>{runBusy ? 'RUNNING…' : 'RUN'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsEditing(true)} disabled={!activeFile} style={{ backgroundColor: activeFile ? '#00daf3' : C.surfaceContainerHigh, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, ...globalStyles.ambientShadow }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: activeFile ? '#FFF' : C.secondary }}>EDIT</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Custom Syntax Highlighted Render (Read-Only Preview).
            A7: tapping it opens the editor — you no longer have to hunt for
            the EDIT button. A3: it is NOT rendered while the modal is open;
            it is fully covered anyway and re-tokenizing the whole file a
            second time on every keystroke was half the typing latency. */}
        <TouchableOpacity
          activeOpacity={activeFile ? 0.85 : 1}
          disabled={!activeFile}
          onPress={() => setIsEditing(true)}
          style={{ flex: 4 }}
        >
          <View style={{ flex: 1, backgroundColor: '#1E1E1E', borderRadius: 12, padding: 16, ...globalStyles.ghostBorder, ...globalStyles.ambientShadow }}>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={true}>
              {!isEditing && <CodeHighlight code={code} fontSize={13} lineHeight={18} />}
            </ScrollView>
          </View>
        </TouchableOpacity>

      </View>

      {/* Fullscreen Editor Modal */}
      <Modal visible={isEditing} animationType="slide" presentationStyle="pageSheet"
      supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}
    >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={webViewportHeight != null
            ? { height: webViewportHeight, backgroundColor: '#0A0A0A' }
            : { flex: 1, backgroundColor: '#0A0A0A' }}
        >
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
                 <TouchableOpacity
                   onPress={() => handleSave()}
                   disabled={runBusy || !activeFile}
                   style={{
                     backgroundColor: '#00daf3', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
                     opacity: (runBusy || !activeFile) ? 0.55 : 1,
                   }}>
                   <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000' }}>{runBusy ? 'COMPILING…' : 'SAVE & COMPILE'}</Text>
                 </TouchableOpacity>
               </View>
            </View>

            {/* Split Screen Responsive Modal Layout */}
            <View style={{ flex: 1, flexDirection: isPortrait ? 'column' : 'row', backgroundColor: '#000' }}>
              
              {/* Left/Top Column - Full Code IDE */}
              <View style={{ flex: isPortrait ? 3 : 13, backgroundColor: '#1E1E1E', margin: 16, marginBottom: isPortrait ? 8 : 16, borderRadius: 12, overflow: 'hidden' }}>
                <ScrollView ref={editorScrollRef} showsVerticalScrollIndicator={true} style={{ flex: 1 }}>
                   <View style={{ position: 'relative' }}>

                      {/* Sub-Layer: Syntax Display (Provides height natively).
                          Per-line memoized — a keystroke re-tokenizes ONE line. */}
                      <CodeHighlight
                        code={code}
                        fontFamily={EDITOR_FONT_FAMILY}
                        fontSize={EDITOR_FONT_SIZE}
                        lineHeight={EDITOR_LINE_HEIGHT}
                        padding={EDITOR_PADDING}
                        color="#d4d4d4"
                      />

                      {/* Top-Layer: Transparent Interactive Input (Overlays perfectly).
                          Metrics MUST stay byte-identical to CodeHighlight above. */}
                      <TextInput
                        ref={inputRef}
                        multiline={true}
                        value={code}
                        onChangeText={setCode}
                        scrollEnabled={false}
                        onSelectionChange={scheduleCaretSync}
                        style={[{
                          position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
                          fontFamily: EDITOR_FONT_FAMILY,
                          fontSize: EDITOR_FONT_SIZE,
                          lineHeight: EDITOR_LINE_HEIGHT,
                          color: 'rgba(255, 255, 255, 0)',
                          padding: EDITOR_PADDING,
                          margin: 0,
                          textAlignVertical: 'top',
                          zIndex: 10,
                        }, WEB_EDITOR_INPUT_STYLE]}
                        autoCapitalize="none"
                        autoComplete="off"
                        autoCorrect={false}
                        spellCheck={false}
                        smartInsertDelete={false}
                        textContentType="none"
                        keyboardType="ascii-capable"
                        selectionColor="#00daf3"
                      />

                   </View>
                </ScrollView>
              </View>

              {/* Right/Bottom Column - Compiler Logs */}
              <View style={{ flex: isPortrait ? 1 : 10, backgroundColor: '#111', margin: 16, marginTop: isPortrait ? 8 : 16, marginLeft: isPortrait ? 16 : 0, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#333', overflow: 'hidden' }}>
                 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                   <IconSymbol name="terminal" size={16} color={C.secondary} />
                   <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 13 }}>COMPILER LOGS</Text>
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
               boxShadow: shadow(0, 10, 20, '#000', 0.5), elevation: 10
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
           boxShadow: shadow(0, 10, 20, '#000', 0.5), elevation: 10
        }}>
           <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000', fontSize: 16 }}>{toastMessage.title}</Text>
           <Text style={{ fontFamily: 'Courier', color: '#000', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{toastMessage.message}</Text>
        </View>
      )}

    </View>
  );
}
