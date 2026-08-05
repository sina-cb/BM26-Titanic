// ViewSelectionPicker.tsx — the shared, sectioned + searchable view picker
// used by BOTH the mixer channel strip and the deck-overlay stack (BM
// readiness W1). It surfaces the engine's full `namedViews` auto-view catalog
// (58 entries on the titanic model: LEFT/RIGHT/FRONT/BACK, Strands /
// TE Signs / @PAR / @BAR / @VINTAGE, CTRL_<n>, plus the 24 base groups &
// 7 semantic composites) — previously invisible on the iPad because
// CaptainPad ignored the field. Titanic offers no STRUCTURE rows: its
// WALLS/AUDITORIUM were exact duplicates of `Hull Canvas`/`Auditoriums` and
// were retired by operator ruling (report 20260804_148); other scenes can
// still send structural views, so the section is still rendered.
//
// Designed for gloved, sunlit playa use: big (≥52px) touch rows, high-contrast
// active state, family section headers, and a search box for the long catalog.
//
// All parsing/classification/apply-path logic lives in the PURE, unit-tested
// `view_selection_picker_logic.ts`; this file is the RN presentation only.

import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput } from 'react-native';

import { usePalette } from '@/hooks/use-theme';
import {
  NamedView,
  ViewSelectionValue,
  buildViewPickerSections,
  viewSelectionForNamedView,
  isNamedViewActive,
  isAllActive,
  namedViewMemberLabel,
  ALL_SELECTION,
} from './view_selection_picker_logic';

const CAPS = { fontFamily: 'SpaceGrotesk_700Bold' as const, letterSpacing: 1.2, textTransform: 'uppercase' as const };

export interface ViewSelectionPickerProps {
  visible: boolean;
  // The engine's namedViews array (from fetchViewSelectionOptions). `undefined`
  // means the field was absent from the payload — surfaced as a loud banner.
  namedViews: NamedView[] | null | undefined;
  current: ViewSelectionValue | null | undefined;
  // Whether to offer the "ALL PIXELS" row. Mixer channels: yes. Deck overlays:
  // no (the engine refuses an all-view overlay — DECK_OVERLAY_VIEW_REQUIRED).
  includeAll?: boolean;
  title?: string;
  onSelect: (sel: ViewSelectionValue) => void;
  onClose: () => void;
}

export const ViewSelectionPicker: React.FC<ViewSelectionPickerProps> = ({
  visible,
  namedViews,
  current,
  includeAll = false,
  title = 'VIEW SELECTION',
  onSelect,
  onClose,
}) => {
  const C = usePalette();
  const [query, setQuery] = useState('');

  const model = useMemo(() => buildViewPickerSections(namedViews, { query }), [namedViews, query]);

  const pick = (sel: ViewSelectionValue) => {
    onSelect(sel);
    setQuery('');
    onClose();
  };

  const close = () => {
    setQuery('');
    onClose();
  };

  const allActive = isAllActive(current);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={close}>
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
        activeOpacity={1}
        onPress={close}
      >
        {/* Inner card swallows taps so touching the list never dismisses. */}
        <TouchableOpacity
          activeOpacity={1}
          style={{ width: '100%', maxWidth: 460, maxHeight: '85%', backgroundColor: C.surfaceContainerLowest, borderRadius: 14, borderWidth: 1, borderColor: C.ghostBorder, padding: 16 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <Text style={[CAPS, { fontSize: 12, color: C.secondary, flex: 1 }]}>{title}</Text>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.icon }}>
              {model.totalCount}{model.query ? `/${model.totalUnfiltered}` : ''} VIEWS
            </Text>
          </View>

          {/* Search / filter — high-contrast, big enough to hit with gloves. */}
          <TextInput
            style={{
              height: 48,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: C.ghostBorder,
              backgroundColor: C.surfaceContainerHigh,
              color: C.text,
              paddingHorizontal: 14,
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 15,
              marginBottom: 12,
            }}
            value={query}
            onChangeText={setQuery}
            placeholder="Filter views…"
            placeholderTextColor={C.icon}
            autoCapitalize="characters"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />

          {/* Fail loud (codex P0): the engine payload had no namedViews array —
              the whole auto-view catalog is unreachable. Do NOT silently render
              an empty picker as if the model has no views. */}
          {model.missing && (
            <View style={{ backgroundColor: 'rgba(217,48,37,0.14)', borderColor: C.error, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <Text style={[CAPS, { fontSize: 11, color: C.error, marginBottom: 4 }]}>NO VIEW CATALOG</Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.text }}>
                The engine returned no namedViews list. Update / restart the engine — the view catalog is unavailable.
              </Text>
            </View>
          )}

          <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
            {/* ── ALL PIXELS (mixer only) ─────────────────────────────── */}
            {includeAll && (
              <TouchableOpacity
                style={{ minHeight: 52, justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, backgroundColor: allActive ? C.surfaceContainerHigh : 'transparent' }}
                onPress={() => pick(ALL_SELECTION)}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: allActive ? C.primary : C.text }}>ALL PIXELS</Text>
              </TouchableOpacity>
            )}

            {model.sections.map((section) => (
              <View key={section.key}>
                <Text style={[CAPS, { fontSize: 10, color: C.secondary, marginTop: 14, marginBottom: 4, paddingHorizontal: 12 }]}>{section.title}</Text>
                {section.entries.map((view: NamedView) => {
                  const active = isNamedViewActive(view, current);
                  const empty = view.memberCount <= 0;
                  return (
                    <TouchableOpacity
                      key={`${section.key}_${view.name}`}
                      style={{
                        minHeight: 52,
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        borderRadius: 10,
                        backgroundColor: active ? C.surfaceContainerHigh : 'transparent',
                        opacity: empty ? 0.5 : 1,
                      }}
                      onPress={() => pick(viewSelectionForNamedView(view))}
                    >
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15, color: active ? C.primary : C.text, flex: 1 }} numberOfLines={1}>
                        {view.name.toUpperCase()}
                      </Text>
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: empty ? C.error : C.icon, marginLeft: 10 }}>
                        {namedViewMemberLabel(view)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}

            {/* Present-but-empty states (NOT a contract failure). */}
            {!model.missing && model.totalUnfiltered === 0 && (
              <Text style={[CAPS, { fontSize: 11, color: C.secondary, textAlign: 'center', marginTop: 12 }]}>NO VIEWS IN MODEL</Text>
            )}
            {!model.missing && model.totalUnfiltered > 0 && model.totalCount === 0 && (
              <Text style={[CAPS, { fontSize: 11, color: C.secondary, textAlign: 'center', marginTop: 12 }]}>NO VIEWS MATCH “{query.toUpperCase()}”</Text>
            )}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};
