import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { useDeckGlobalStatusFrame } from '@/hooks/useEngineState';
import { usePalette } from '@/hooks/use-theme';
import { requestDeckWindow } from '@/utils/deck_window_requests';
import { Radius, Type } from '@/constants/theme';
import { accentWash } from '@/styles/design_recipes';
import {
  deckGlobalStatusChips,
  type DeckGlobalStatusChip,
  type DeckGlobalStatusTone,
} from './deck_global_status_logic';

const CHIP_HEIGHT = 46;
const CHIP_GAP = 5;
const PAGE_HOLD_MS = 3500;
const PAGE_SCROLL_MS = 450;

interface DeckGlobalStatusProps {
  leading?: React.ReactNode;
  leadingKey?: string;
  maxRows?: number;
}

type StatusItem =
  | { kind: 'chip'; key: string; chip: DeckGlobalStatusChip }
  | { kind: 'custom'; key: string; node: React.ReactNode };

export function DeckGlobalStatus({
  leading = null,
  leadingKey = 'leading',
  maxRows = 2,
}: DeckGlobalStatusProps) {
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error(`DeckGlobalStatus maxRows must be a positive integer, got ${JSON.stringify(maxRows)}`);
  }
  const frame = useDeckGlobalStatusFrame();
  const chips = useMemo(() => deckGlobalStatusChips(frame), [frame]);
  const items: StatusItem[] = [
    ...chips.map((chip): StatusItem => ({ kind: 'chip', key: chip.id, chip })),
    ...(leading ? [{ kind: 'custom' as const, key: leadingKey, node: leading }] : []),
  ];
  const pages: StatusItem[][] = [];
  for (let index = 0; index < items.length; index += maxRows) {
    pages.push(items.slice(index, index + maxRows));
  }
  const pageHeight = CHIP_HEIGHT * maxRows + CHIP_GAP * Math.max(0, maxRows - 1);
  const pageKey = `${chips.map((chip) => chip.id).join('|')}|${leading ? leadingKey : ''}|${maxRows}`;
  const [pageIndex, setPageIndex] = useState(0);
  const pageIndexRef = useRef(0);
  const translateY = useRef(new Animated.Value(0)).current;
  const C = usePalette();

  useEffect(() => {
    pageIndexRef.current = 0;
    setPageIndex(0);
    translateY.setValue(0);
  }, [pageKey, translateY]);

  useEffect(() => {
    if (pages.length <= 1) return;
    const timer = setInterval(() => {
      const nextPage = pageIndexRef.current + 1;
      Animated.timing(translateY, {
        toValue: -nextPage * pageHeight,
        duration: PAGE_SCROLL_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        if (nextPage >= pages.length) {
          pageIndexRef.current = 0;
          setPageIndex(0);
          translateY.setValue(0);
        } else {
          pageIndexRef.current = nextPage;
          setPageIndex(nextPage);
        }
      });
    }, PAGE_HOLD_MS);
    return () => {
      clearInterval(timer);
      translateY.stopAnimation();
    };
  }, [pageHeight, pages.length, translateY]);

  if (items.length === 0) return null;

  const toneFor = (tone: DeckGlobalStatusTone) => {
    if (tone === 'danger') return accentWash(C.error);
    if (tone === 'warning') return accentWash(C.warning);
    if (tone === 'auto') return accentWash(C.tertiary);
    return accentWash(C.primary);
  };

  const renderChip = (chip: DeckGlobalStatusChip, hidden: boolean, key: string) => {
    const tone = toneFor(chip.tone);
    return (
      <Pressable
        key={key}
        onPress={() => {
          router.push('/');
          if (chip.target === 'colors' || chip.target === 'overlays') {
            requestDeckWindow(chip.target);
          }
        }}
        style={{
          height: CHIP_HEIGHT,
          borderRadius: Radius.control,
          borderWidth: 1,
          borderColor: tone.borderColor,
          backgroundColor: tone.backgroundColor,
          paddingHorizontal: 4,
          paddingVertical: 4,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        accessibilityRole="button"
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
        accessibilityLabel={`${chip.label.replace(/\n/g, ' ')}. Open Deck.`}
      >
        <Text
          style={{
            ...Type.labelCaps,
            textTransform: 'uppercase',
            color: tone.color,
            fontSize: 7.5,
            lineHeight: 9,
            letterSpacing: 0.15,
            textAlign: 'center',
          }}
          numberOfLines={3}
        >
          {chip.label}
        </Text>
      </Pressable>
    );
  };

  const renderPage = (page: StatusItem[], index: number, duplicate: boolean) => (
    <View
      key={`${duplicate ? 'duplicate' : 'page'}-${index}`}
      style={{ height: pageHeight, gap: CHIP_GAP }}
      accessibilityElementsHidden={duplicate || index !== pageIndex}
      importantForAccessibility={duplicate || index !== pageIndex ? 'no-hide-descendants' : 'auto'}
    >
      {page.map((item) => (
        item.kind === 'chip'
          ? renderChip(item.chip, duplicate || index !== pageIndex, `${duplicate ? 'duplicate' : 'page'}-${index}-${item.key}`)
          : (
              <View
                key={`page-${index}-${item.key}`}
                style={{ height: CHIP_HEIGHT, justifyContent: 'center' }}
              >
                {item.node}
              </View>
            )
      ))}
    </View>
  );

  return (
    <View
      style={{ height: pageHeight, overflow: 'hidden' }}
      testID="deck-global-status"
    >
      <Animated.View style={{ transform: [{ translateY }] }}>
        {pages.map((page, index) => renderPage(page, index, false))}
        {pages.length > 1 ? renderPage(pages[0], pages.length, true) : null}
      </Animated.View>
    </View>
  );
}
