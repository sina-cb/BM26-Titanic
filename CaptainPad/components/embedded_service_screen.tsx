import { useIsFocused } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import EmbeddedLocalSurface from '@/components/embedded_local_surface';
import type { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { getApiBaseAsync } from '@/utils/api';
import { shouldMountEmbeddedSurface } from '@/components/embedded_surface_lifecycle';

const LOAD_TIMEOUT_MS = 15_000;

interface EmbeddedServiceScreenProps {
  title: string;
  description: string;
  resolveUrl: (apiBase: string) => string;
  onExit?: () => void;
  exitLabel?: string;
}

/**
 * Shared full-tab shell for launcher-supervised local web surfaces.
 *
 * Tabs remain mounted in CaptainPad. The expensive iframe/WebView is therefore
 * rendered only while focused, so background tabs do not keep an analyzer or
 * simulator render loop alive on the iPad.
 */
export function EmbeddedServiceScreen({
  title,
  description,
  resolveUrl,
  onExit,
  exitLabel = 'BACK',
}: EmbeddedServiceScreenProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const isFocused = useIsFocused();
  const [url, setUrl] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [resolveToken, setResolveToken] = useState(0);

  useEffect(() => {
    let active = true;
    setResolveError(null);
    setUrl(null);

    void getApiBaseAsync()
      .then((base) => resolveUrl(base))
      .then((nextUrl) => {
        if (!active) return;
        setUrl(nextUrl);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setResolveError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      active = false;
    };
  }, [resolveToken, resolveUrl]);

  useEffect(() => {
    if (!isFocused || !url) return;
    setLoading(true);
    setLoadError(null);
  }, [isFocused, reloadToken, url]);

  useEffect(() => {
    if (!isFocused || !url || !loading) return;
    const timer = setTimeout(() => {
      setLoading(false);
      setLoadError(`${title} did not finish loading within 15 seconds`);
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isFocused, loading, title, url]);

  const handleLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const handleLoadError = useCallback((message: string) => {
    setLoading(false);
    setLoadError(message);
  }, []);

  const reload = useCallback(() => {
    setLoadError(null);
    setLoading(true);
    if (url) {
      setReloadToken((current) => current + 1);
    } else {
      setResolveToken((current) => current + 1);
    }
  }, [url]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headingCopy}>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
          <Text numberOfLines={1} style={styles.description}>
            {url ?? description}
          </Text>
        </View>
        <View style={styles.headerActions}>
          {onExit ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={exitLabel}
              activeOpacity={0.72}
              onPress={onExit}
              style={styles.reloadButton}
            >
              <Text style={styles.reloadLabel}>{exitLabel}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Reload ${title}`}
            activeOpacity={0.72}
            onPress={reload}
            style={styles.reloadButton}
          >
            <Text style={styles.reloadLabel}>RELOAD</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.viewport}>
        {shouldMountEmbeddedSurface(isFocused, url, resolveError) ? (
          <EmbeddedLocalSurface
            title={title}
            url={url!}
            reloadToken={reloadToken}
            onLoad={handleLoad}
            onError={handleLoadError}
          />
        ) : null}

        {isFocused && loading && url && !loadError ? (
          <View pointerEvents="none" style={styles.statusOverlay}>
            <ActivityIndicator color={C.primary} size="large" />
            <Text style={styles.statusText}>CONNECTING TO {title}</Text>
          </View>
        ) : null}

        {resolveError || loadError ? (
          <View style={styles.errorPanel}>
            <Text style={styles.errorTitle}>{title} UNAVAILABLE</Text>
            <Text selectable style={styles.errorBody}>
              {resolveError ?? loadError}
            </Text>
            <Text selectable style={styles.errorUrl}>{url ?? description}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Retry ${title}`}
              activeOpacity={0.72}
              onPress={reload}
              style={styles.retryButton}
            >
              <Text style={styles.retryLabel}>RETRY</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(C: Palette) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: C.background,
    },
    header: {
      minHeight: 48,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerLow,
    },
    headingCopy: {
      flex: 1,
      minWidth: 0,
    },
    headerActions: {
      flexDirection: 'row',
      gap: 8,
    },
    title: {
      color: C.text,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 14,
      letterSpacing: 0.8,
    },
    description: {
      color: C.secondary,
      fontFamily: 'Inter_400Regular',
      fontSize: 10,
      marginTop: 1,
    },
    reloadButton: {
      minWidth: 72,
      minHeight: 36,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerLowest,
    },
    reloadLabel: {
      color: C.primary,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 0.8,
    },
    viewport: {
      flex: 1,
      minHeight: 0,
      backgroundColor: C.surfaceContainerLowest,
    },
    statusOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      backgroundColor: C.surfaceContainerLowest,
    },
    statusText: {
      color: C.secondary,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.8,
    },
    errorPanel: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: C.errorContainer,
    },
    errorTitle: {
      color: C.error,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 16,
      letterSpacing: 0.8,
    },
    errorBody: {
      maxWidth: 680,
      marginTop: 8,
      color: C.text,
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
    },
    errorUrl: {
      maxWidth: 680,
      marginTop: 8,
      color: C.secondary,
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      textAlign: 'center',
    },
    retryButton: {
      minWidth: 96,
      minHeight: 42,
      marginTop: 16,
      paddingHorizontal: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      backgroundColor: C.primary,
    },
    retryLabel: {
      color: C.onPrimary,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.9,
    },
  });
}
