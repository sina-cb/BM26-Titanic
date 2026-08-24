/**
 * CalendarLegend — ONE legend, shared by the week strip and the DAY chart
 * (report _359 §D.2/§D.7).
 *
 * Every structural marker the calendars draw has a row here, in the order
 * `FRAME_LEGEND_IDS` fixes, and nothing is drawn that has no row. The previous
 * legend said "☾ NIGHT" for the sunset colour and gave SUNRISE the same amber
 * as PROGRAM cue blocks, while the strip quietly added golden-hour and
 * civil-dusk ticks that appeared nowhere (C-02).
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';

import {
  FRAME_LEGEND_IDS,
  FRAME_PARTY_COLOR,
  FRAME_SUN_COLORS,
  type FrameLegendId,
} from './day_frame_logic';
import { kindColor } from './timelineTemplate';

/** Row copy + glyph per legend id. Colours that depend on the palette resolve
 *  at render time (NOW rides `C.error` so it re-themes — §D.2). */
const LEGEND_ROWS: Record<FrameLegendId, { symbol: string; label: string }> = {
  now: { symbol: '—', label: 'NOW' },
  sunset: { symbol: '- -', label: 'SUNSET' },
  sunrise: { symbol: '- -', label: 'SUNRISE' },
  duskDawn: { symbol: '- -', label: 'DUSK / DAWN' },
  party: { symbol: '▮', label: 'PARTY WINDOW' },
  program: { symbol: '●', label: 'PROGRAM' },
  mood: { symbol: '●', label: 'MOOD' },
  ambient: { symbol: '●', label: 'AMBIENT' },
};

function legendColor(id: FrameLegendId, C: Palette): string {
  switch (id) {
    case 'now': return C.error;
    case 'sunset': return FRAME_SUN_COLORS.sunset;
    case 'sunrise': return FRAME_SUN_COLORS.sunrise;
    case 'duskDawn': return FRAME_SUN_COLORS.civilDusk;
    case 'party': return FRAME_PARTY_COLOR;
    case 'program': return kindColor('program', C);
    case 'mood': return kindColor('mood', C);
    case 'ambient': return kindColor('ambient', C);
    default: return C.secondary;
  }
}

export function CalendarLegend() {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  return (
    <View style={styles.row} accessibilityLabel="Calendar legend">
      {FRAME_LEGEND_IDS.map((id) => (
        <LegendItem
          key={id}
          symbol={LEGEND_ROWS[id].symbol}
          label={LEGEND_ROWS[id].label}
          color={legendColor(id, C)}
          styles={styles}
        />
      ))}
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
