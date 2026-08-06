// pattern_list — the scrollable PATTERNS sheet on the TOUCH CONTROL tab.
//
// Lets the operator browse every pattern the engine has loaded, read a one
// line description of what it does, and load one so the tab's colour dots
// paint it. TOUCH CONTROL ONLY: no other tab imports this.
//
// ── Why a sheet and not a third column ───────────────────────────────────
// The tab is already colour panel | motion panel with the effects row beneath.
// A third column would squeeze both pads on an iPad. The sheet overlays the
// panels, gets the full height for scrolling, and leaves the existing layout
// exactly as it was.
//
// ── Honesty rules this component follows (codex P0) ──────────────────────
// - The ENGINE decides what exists. Rows come from `GET /list-patterns`; a
//   pattern with no catalog entry is still listed and says so, rather than
//   being hidden or given an invented description.
// - Every row states how many of the five colour dots it can actually take,
//   so the operator is never surprised that dots 3-5 did nothing.
// - Loading a pattern is a WRITE to the rig, so it obeys the same ARM gate as
//   every other control here. Unarmed, the rows are inert and say why.
// - A refused load (the engine returns 409 while a show is live) surfaces as
//   an error; the row never flips to "active" on its own.

import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import {
  buildPatternRows,
  filterPatternRows,
  groupPatternRows,
  colorSupportNote,
  COLOR_LABELS,
  type PatternRow,
} from './pattern_catalog';

export interface PatternListProps {
  /** Pattern ids exactly as the engine reported them. */
  names: string[];
  /** The engine's current pattern, from `/status`. Null until first read. */
  activePattern: string | null;
  /** A pattern whose load is in flight — the row shows LOADING, not ACTIVE. */
  pendingPattern: string | null;
  /** True while the pattern list itself is being fetched. */
  loading: boolean;
  /** Fetch or load failure, shown verbatim. Null when healthy. */
  error: string | null;
  /** Same gate as the rest of the tab: unarmed or locked ⇒ rows are inert. */
  disabled: boolean;
  onSelect: (name: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

function ColorBadge({ row }: { row: PatternRow }) {
  const C = usePalette();
  // An uncatalogued pattern gets no badge at all — we do not know what it
  // takes, and a guessed badge is worse than none.
  if (row.colors === null) return null;
  const strong = row.colors === 'five';
  const none = row.colors === 'fixed';
  return (
    <View
      style={{
        paddingVertical: 2,
        paddingHorizontal: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: none ? C.ghostBorder : strong ? C.tertiary : C.secondary,
      }}
    >
      <Text
        style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 9,
          letterSpacing: 0.8,
          color: none ? C.icon : strong ? C.tertiary : C.secondary,
        }}
      >
        {COLOR_LABELS[row.colors]}
      </Text>
    </View>
  );
}

function PatternRowView({
  row,
  active,
  pending,
  disabled,
  onPress,
}: {
  row: PatternRow;
  active: boolean;
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Load pattern ${row.title}`}
      accessibilityState={{ selected: active, disabled }}
      style={{
        minHeight: 64,
        paddingVertical: 10,
        paddingHorizontal: 14,
        marginBottom: 6,
        borderRadius: 12,
        borderWidth: active ? 2 : 1,
        borderColor: active ? C.tertiary : C.ghostBorder,
        backgroundColor: active ? C.surfaceContainerHigh : C.surfaceContainerLowest,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 14,
            letterSpacing: 0.5,
            color: active ? C.tertiary : C.text,
            flexShrink: 1,
          }}
        >
          {row.title}
        </Text>
        <View style={{ flex: 1 }} />
        {pending && <ActivityIndicator size="small" color={C.secondary} />}
        {active && !pending && (
          <Text
            style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 10,
              letterSpacing: 1,
              color: C.tertiary,
            }}
          >
            ● PLAYING
          </Text>
        )}
        <ColorBadge row={row} />
      </View>

      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 11,
          lineHeight: 15,
          color: row.known ? C.icon : C.secondary,
          marginTop: 4,
        }}
      >
        {row.known ? row.blurb : 'No description on file for this pattern.'}
      </Text>

      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 9,
          color: C.ghostBorder,
          marginTop: 3,
        }}
      >
        {row.name}
      </Text>
    </TouchableOpacity>
  );
}

export function PatternList({
  names,
  activePattern,
  pendingPattern,
  loading,
  error,
  disabled,
  onSelect,
  onRefresh,
  onClose,
}: PatternListProps) {
  const C = usePalette();
  const [query, setQuery] = useState('');

  const groups = useMemo(
    () => groupPatternRows(filterPatternRows(buildPatternRows(names), query)),
    [names, query],
  );
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);

  const activeNote = activePattern
    ? colorSupportNote(buildPatternRows([activePattern])[0].colors)
    : null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: C.surface,
        zIndex: 20,
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 20,
          paddingTop: 14,
          paddingBottom: 8,
        }}
      >
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 18,
            letterSpacing: 2,
            color: C.text,
          }}
        >
          PATTERNS
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon }}>
          {shown} of {names.length}
        </Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={onRefresh}
          accessibilityRole="button"
          accessibilityLabel="Refresh pattern list"
          style={{
            minHeight: 44,
            paddingHorizontal: 16,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: C.ghostBorder,
          }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text }}>
            REFRESH
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close pattern list"
          style={{
            minHeight: 44,
            paddingHorizontal: 18,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: C.primary,
            backgroundColor: C.primary,
          }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.onPrimary }}>
            DONE
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search patterns"
          placeholderTextColor={C.ghostBorder}
          accessibilityLabel="Search patterns"
          style={{
            minHeight: 44,
            paddingHorizontal: 14,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: C.ghostBorder,
            backgroundColor: C.surfaceContainerLowest,
            color: C.text,
            fontFamily: 'Inter_400Regular',
            fontSize: 13,
          }}
        />
      </View>

      {disabled && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.secondary }}>
            TOUCH CONTROL IS OFF — you can browse, but loading a pattern is a write to
            the rig. Tap TAKE CONTROL first.
          </Text>
        </View>
      )}

      {error !== null && (
        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 8,
            padding: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: C.error,
            backgroundColor: C.errorContainer,
          }}
        >
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: C.error }}>
            {error}
          </Text>
        </View>
      )}

      {activeNote !== null && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon }}>
            Playing now: {activeNote}
          </Text>
        </View>
      )}

      {loading && names.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.primary} />
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon, marginTop: 8 }}>
            Loading patterns from the engine…
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        >
          {shown === 0 && (
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                fontSize: 12,
                color: C.icon,
                marginTop: 24,
                textAlign: 'center',
              }}
            >
              {names.length === 0
                ? 'The engine reported no patterns.'
                : `Nothing matches "${query}".`}
            </Text>
          )}

          {groups.map((group) => (
            <View key={group.family} style={{ marginTop: 14 }}>
              <Text
                style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 11,
                  letterSpacing: 2,
                  color: C.secondary,
                  marginBottom: 6,
                }}
              >
                {group.label}
              </Text>
              {group.rows.map((row) => (
                <PatternRowView
                  key={row.name}
                  row={row}
                  active={row.name === activePattern}
                  pending={row.name === pendingPattern}
                  disabled={disabled}
                  onPress={() => onSelect(row.name)}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
