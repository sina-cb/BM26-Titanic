import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';

import { kindColor } from './timelineTemplate';

export function CalendarLegend() {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  return (
    <View style={styles.row} accessibilityLabel="Calendar legend">
      <LegendItem symbol="☀" label="SUNRISE" color="#f5a623" styles={styles} />
      <LegendItem symbol="☾" label="NIGHT" color="#5b6cf5" styles={styles} />
      <LegendItem symbol="●" label="PROGRAM" color={kindColor('program', C)} styles={styles} />
      <LegendItem symbol="▮" label="PARTY WINDOW" color="#b56dff" styles={styles} />
      <LegendItem symbol="●" label="AMBIENT" color={kindColor('ambient', C)} styles={styles} />
    </View>
  );
}

function LegendItem({
  symbol,
  label,
  color,
  styles,
}: {
  symbol: string;
  label: string;
  color: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.item}>
      <Text style={[styles.symbol, { color }]}>{symbol}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

function makeStyles(C: Palette) {
  return StyleSheet.create({
    row: {
      minHeight: 24,
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 12,
      paddingHorizontal: 2,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    symbol: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      lineHeight: 15,
    },
    label: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      lineHeight: 12,
      letterSpacing: 0.7,
      color: C.secondary,
    },
  });
}
