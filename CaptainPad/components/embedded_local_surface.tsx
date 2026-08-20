import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import WebView from 'react-native-webview';

import { EMBEDDED_SURFACE_TEARDOWN_SCRIPT } from '@/components/embedded_surface_lifecycle';

export interface EmbeddedLocalSurfaceProps {
  title: string;
  url: string;
  reloadToken: number;
  onLoad: () => void;
  onError: (message: string) => void;
}

/** Native iPad implementation. The web build resolves the `.web.tsx` peer. */
function EmbeddedLocalSurface({
  title,
  url,
  reloadToken,
  onLoad,
  onError,
}: EmbeddedLocalSurfaceProps) {
  const webViewRef = useRef<WebView>(null);

  useEffect(() => () => {
    webViewRef.current?.stopLoading();
    webViewRef.current?.injectJavaScript(EMBEDDED_SURFACE_TEARDOWN_SCRIPT);
  }, []);

  return (
    <WebView
      ref={webViewRef}
      key={`${url}:${reloadToken}`}
      source={{ uri: url }}
      style={styles.surface}
      originWhitelist={['http://*', 'https://*']}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      allowsInlineMediaPlayback
      startInLoadingState={false}
      onLoadEnd={onLoad}
      onError={(event) => {
        onError(`${title} could not load — ${event.nativeEvent.description}`);
      }}
      onHttpError={(event) => {
        onError(
          `${title} returned HTTP ${event.nativeEvent.statusCode} — ` +
          event.nativeEvent.description,
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  surface: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

export default memo(EmbeddedLocalSurface);
