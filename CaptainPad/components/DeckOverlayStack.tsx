// DeckOverlayStack — UI for DECK DYNAMIC VIEW OVERRIDES (engine
// #deck-overlays). Renders BELOW the main deck surface on the Deck tab:
//
//   • a single SHARED auto-cycle header for the WHOLE overlay group (the
//     engine's overlay autopilot timer is unison, NOT per-overlay), plus a
//     "+ ADD OVERLAY" affordance that picks a VIEW (required, never "all")
//     and a playlist, then POSTs /deck/overlays. The add affordance hides at
//     the 4-overlay cap with a hint.
//   • one CLEAN, self-contained, color-tagged card per overlay. Collapsed by
//     default to a ONE-LINE header (accent chip + view label + blend mode +
//     fader readout). Tap to expand: its own PlaylistPanel + transport, a
//     blend-mode selector, the VIEW picker (reuse of the mixer's
//     view-selection modal pattern), a fader, reorder up/down, and a remove
//     (×) with a confirm sheet.
//
// The operator is sensitive to UI clutter (we just decluttered the mixer), so
// each card is border/header accent-colored by overlay.color and stays
// collapsed until tapped — no cramped sprawl. The operator must instantly
// read "overlay 2 (orange) on the bow group, screen blend".
//
// Live state rides the existing `deck` WS message (the parent index.tsx reads
// overlays[] + overlayAutopilot off it and passes them down); these are the
// source of truth. We optimistic-flip where safe and reconcile from the next
// broadcast. Codex P0 — fail loud: every write surfaces the engine's error
// (incl. the 4xx `code`) as a friendly Alert; no silent fallback.

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation';
import { opError, opWarn } from '@/utils/op_dialog';
import { usePalette } from '@/hooks/use-theme';
import { accentWash, glowFor, identityDot, useGlobalStyles } from '@/styles/globalStyles';
import { Radius, Type } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { AutopilotTimerPills } from '@/components/DeckTransitionControls';
import { ViewSelectionPicker } from '@/components/ViewSelectionPicker';
import { type NamedView } from '@/components/view_selection_picker_logic';
import { fetchViewSelectionOptions } from '@/utils/api';
import { usePerfLock } from '@/hooks/usePerformanceMode';
import {
  addDeckOverlay,
  patchDeckOverlay,
  deleteDeckOverlay,
  reorderDeckOverlays,
  setDeckOverlayAutopilot,
  DECK_OVERLAY_MAX,
  DECK_OVERLAY_BLEND_MODES,
  type DeckOverlay,
  type DeckOverlayAutopilot,
  type DeckOverlaySourceMode,
  type ViewSelection,
} from '@/utils/deckOverlaysApi';
import {
  hexToHue,
  hueToHex,
  overlaySourceMode,
} from '@/components/deck/overlay_source_logic';

// ── View-selection helpers ─────────────────────────────────────────────────

// Human label for a viewSelection, mirroring the mixer strip's inline logic.
// Prefixed with the kind so the operator reads "GROUP: bow" / "MASK: starboard"
// at a glance in the collapsed header.
function viewSelectionLabel(v: ViewSelection | null | undefined): string {
  if (!v || v.type === 'all') return 'ALL';
  if (v.type === 'group') return `GROUP: ${String(v.target || '').toUpperCase()}`;
  if (v.type === 'viewMask') {
    return `MASK: ${typeof v.target === 'string'
      ? v.target.toUpperCase()
      : `0x${(Number(v.target) || 0).toString(16).toUpperCase()}`}`;
  }
  if (v.type === 'section') return `SECTION: ${v.target}`;
  if (v.type === 'fixture') return `FIXTURE: ${v.target}`;
  return String(v.type).toUpperCase();
}

function blendLabel(mode: string | undefined): string {
  return (mode || 'blend_screen').replace(/^(blend_|trans_)/, '').toUpperCase();
}

// The overlay view picker is the shared <ViewSelectionPicker> (includeAll
// omitted): a deck overlay MUST target a specific view — the engine refuses
// {type:'all'} with DECK_OVERLAY_VIEW_REQUIRED, and an all-view overlay
// defeats the never-dark feature.

// ── Blend-mode picker modal (only steady channel-blend modes) ──────────────
const BlendPickerModal: React.FC<{
  visible: boolean;
  current: string | undefined;
  onSelect: (m: string) => void;
  onClose: () => void;
}> = ({ visible, current, onSelect, onClose }) => {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const on = accentWash(C.primary);
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}>
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={[globalStyles.panel, { width: '100%', maxWidth: 320, padding: 16 }]}>
          <Text style={{ ...Type.labelCaps, textTransform: 'uppercase', fontSize: 11, color: C.secondary, marginBottom: 12 }}>BLEND MODE</Text>
          {DECK_OVERLAY_BLEND_MODES.map((m) => {
            const active = m === (current || 'blend_screen');
            return (
              <TouchableOpacity
                key={m}
                style={{ paddingVertical: 12, paddingHorizontal: 8, borderRadius: Radius.control, backgroundColor: active ? on.backgroundColor : 'transparent' }}
                onPress={() => { onSelect(m); onClose(); }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: active ? on.color : C.text }}>{blendLabel(m)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

// ── One self-contained overlay card ─────────────────────────────────────────
const OverlayCard: React.FC<{
  overlay: DeckOverlay;
  index: number;
  count: number;
  expanded: boolean;
  onToggleExpand: () => void;
  namedViews: NamedView[] | undefined;
  playlistLibrary: string[];
  disabled: boolean;
  onReorder: (id: string, direction: -1 | 1) => void;
}> = ({ overlay, index, count, expanded, onToggleExpand, namedViews, playlistLibrary, disabled, onReorder }) => {
  const C = usePalette();
  // PERFORMANCE MODE: overlay STRUCTURE (remove, reorder, view re-target) is
  // 409-gated while a show is live. Runtime controls (enable eye, blend mode,
  // fader, playlist entry taps) stay live.
  const perfLocked = usePerfLock();
  const accent = (typeof overlay.color === 'string' && overlay.color) || C.primary;
  const [showBlendPicker, setShowBlendPicker] = useState(false);
  const [showViewPicker, setShowViewPicker] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Local fader mirror for instant drag feedback; reconciled by the WS deck
  // broadcast (the parent re-renders this card with the engine value).
  const [faderLocal, setFaderLocal] = useState<number>(typeof overlay.fader === 'number' ? overlay.fader : 1);
  const sourceMode = overlaySourceMode(overlay);
  const [tintHueLocal, setTintHueLocal] = useState(hexToHue(overlay.playlistTint));
  const [solidHueLocal, setSolidHueLocal] = useState(hexToHue(overlay.solidColor || '#FFFFFF'));
  useEffect(() => {
    if (typeof overlay.fader === 'number') setFaderLocal(overlay.fader);
  }, [overlay.fader]);
  useEffect(() => {
    if (overlay.playlistTint) setTintHueLocal(hexToHue(overlay.playlistTint));
  }, [overlay.playlistTint]);
  useEffect(() => {
    setSolidHueLocal(hexToHue(overlay.solidColor || '#FFFFFF'));
  }, [overlay.solidColor]);

  const enabled = overlay.enabled !== false;
  const viewLabel = viewSelectionLabel(overlay.viewSelection);
  const faderTrackStyle = {
    height: 18,
    borderRadius: 9,
    backgroundColor: C.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: C.ghostBorder,
  };
  const faderThumbStyle = {
    width: 12,
    height: 22,
    borderRadius: 6,
    marginLeft: -6,
    marginTop: -3,
    backgroundColor: C.surfaceContainerLowest,
    borderWidth: 2,
    borderColor: C.borderStrong,
  };

  const onPatch = useCallback(async (fields: Parameters<typeof patchDeckOverlay>[1], failTitle: string) => {
    const res = await patchDeckOverlay(overlay.id, fields);
    if (!res.ok) {
      const code = (res.data && res.data.code) as string | undefined;
      if (code === 'DECK_OVERLAY_VIEW_TAKEN') {
        opWarn('View already in use', 'That view already has an overlay. Pick a different view.');
      } else {
        opError(failTitle, res.error || 'Unknown error');
      }
    }
  }, [overlay.id]);

  const onRemove = useCallback(async () => {
    setConfirmRemove(false);
    const res = await deleteDeckOverlay(overlay.id);
    if (!res.ok) opError('Remove failed', res.error || 'Unknown error');
  }, [overlay.id]);

  return (
    <View
      style={{
        width: '100%',
        minWidth: 0,
        backgroundColor: C.surfaceContainerLowest,
        // `cardOnPanel` radius (docs/54 row 15) — the overlay cards are the
        // same kind of object as the DECK MAIN / autopilot cards.
        borderRadius: Radius.card,
        // QA round8 #5: the full-perimeter border previously took the
        // overlay's accent color. With a red accent that read as an
        // error/alarm. Reserve red for destructive/error — keep the
        // perimeter NEUTRAL (ghostBorder) and carry the accent ONLY on the
        // left edge stripe (the established at-a-glance identification cue).
        borderWidth: 1,
        borderColor: C.ghostBorder,
        borderLeftWidth: 4,
        borderLeftColor: enabled ? accent : C.ghostBorder,
        marginBottom: 8,
        opacity: enabled ? 1 : 0.65,
        overflow: 'hidden',
      }}
    >
      {/* Header controls are SIBLINGS, never nested touchables. The old
          one-line layout put title, blend, level, eye, remove and chevron in
          one unshrinkable row; narrow iPad columns clipped the destructive
          control first. This two-row header reserves fixed 36pt hit targets
          for eye/remove/expand and lets only the title truncate. */}
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 4, minWidth: 0 }}>
          <TouchableOpacity
            onPress={onToggleExpand}
            activeOpacity={0.7}
            style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 }}
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${viewLabel} overlay`}
          >
            <View style={identityDot(accent, 10)} />
            <Text
              style={{ ...Type.labelCaps, textTransform: 'uppercase', fontSize: 11, color: C.text, flex: 1, minWidth: 0 }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {viewLabel}
            </Text>
          </TouchableOpacity>
          {/* Enable toggle (eye) — quick on/off without expanding. */}
          <TouchableOpacity
            onPress={() => onPatch({ enabled: !enabled }, 'Toggle failed')}
            disabled={disabled}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : 1 }}
            accessibilityLabel={enabled ? 'Disable overlay' : 'Enable overlay'}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
          >
            <IconSymbol name={enabled ? 'eye' : 'eye.slash'} size={16} color={enabled ? accent : C.icon} />
          </TouchableOpacity>
          {/* REMOVE owns a permanent, fixed-width seat. */}
          <TouchableOpacity
            onPress={() => setConfirmRemove(true)}
            disabled={disabled || perfLocked}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: (disabled || perfLocked) ? 0.45 : 1 }}
            accessibilityLabel="Remove overlay"
            accessibilityRole="button"
            accessibilityState={{ disabled: disabled || perfLocked }}
          >
            <IconSymbol name="trash" size={16} color={C.error} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onToggleExpand}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
            accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} overlay controls`}
            accessibilityRole="button"
          >
            <IconSymbol name={expanded ? 'chevron.up' : 'chevron.down'} size={14} color={C.icon} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={onToggleExpand}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 8, minWidth: 0 }}
        >
          <View style={{ flexShrink: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.chip, backgroundColor: C.surfaceContainerHigh }}>
            <Text numberOfLines={1} style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8.5, letterSpacing: 0.4, color: C.secondary }}>
              {sourceMode.toUpperCase()}
            </Text>
          </View>
          <View style={{ flexShrink: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.chip, backgroundColor: C.surfaceContainerHigh }}>
            <Text numberOfLines={1} style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8.5, letterSpacing: 0.4, color: C.secondary }}>
              {blendLabel(overlay.mode)}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary }}>
            {sourceMode === 'solid' ? 'BRIGHTNESS' : 'LEVEL'} {Math.round(faderLocal * 100)}%
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Expanded body ──────────────────────────────────────────────── */}
      {expanded && (
        <View style={{ width: '100%', minWidth: 0, paddingHorizontal: 10, paddingBottom: 10, gap: 8, borderTopWidth: 1, borderTopColor: C.ghostBorder }}>
          {/* View gets its own full-width row: long named views may truncate,
              but can never push blend/reorder outside the card. */}
          <TouchableOpacity
            onPress={() => setShowViewPicker(true)}
            disabled={disabled || perfLocked}
            style={{
              marginTop: 8,
              minWidth: 0,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: Radius.control,
              borderWidth: 1,
              borderColor: C.ghostBorder,
              backgroundColor: C.surfaceContainerHigh,
              opacity: perfLocked ? 0.45 : 1,
            }}
            accessibilityState={{ disabled: disabled || perfLocked }}
          >
            <Text numberOfLines={1} ellipsizeMode="tail" style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text }}>
              VIEW · {viewLabel} ▾
            </Text>
          </TouchableOpacity>
          {/* Blend and layer-order controls share a bounded row. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <TouchableOpacity
              onPress={() => setShowBlendPicker(true)}
              disabled={disabled}
              style={{ flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8, borderRadius: Radius.control, borderWidth: 1, borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerHigh }}
            >
              <Text numberOfLines={1} style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.text }}>
                BLEND · {blendLabel(overlay.mode)} ▾
              </Text>
            </TouchableOpacity>
            {/* Reorder up (toward top) / down (toward bottom). order[0]=bottom,
                last=top — "up" in the visual stack means toward the TOP layer.
                Reorder is handled by the parent (it owns the full ordered list). */}
            <TouchableOpacity
              onPress={() => onReorder(overlay.id, -1)}
              disabled={disabled || perfLocked || index === count - 1}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: (index === count - 1 || perfLocked) ? 0.3 : 1 }}
              accessibilityLabel="Move overlay up"
            >
              <IconSymbol name="arrow.up" size={16} color={C.text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onReorder(overlay.id, 1)}
              disabled={disabled || perfLocked || index === 0}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: (index === 0 || perfLocked) ? 0.3 : 1 }}
              accessibilityLabel="Move overlay down"
            >
              <IconSymbol name="arrow.down" size={16} color={C.text} />
            </TouchableOpacity>
          </View>

          {/* Explicit source selector. Switching to SOLID preserves the
              playlist/entry/handle engine-side; switching back restores it. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ ...Type.labelCaps, textTransform: 'uppercase', color: C.secondary, width: 54 }}>
              SOURCE
            </Text>
            {(['playlist', 'solid'] as DeckOverlaySourceMode[]).map((mode) => {
              const active = sourceMode === mode;
              const activeTone = accentWash(active ? accent : C.primary);
              return (
                <TouchableOpacity
                  key={mode}
                  onPress={() => onPatch({ sourceMode: mode }, 'Set source failed')}
                  disabled={disabled || active}
                  style={{
                    paddingHorizontal: 11,
                    paddingVertical: 7,
                    borderRadius: Radius.control,
                    borderWidth: 1,
                    borderColor: active ? activeTone.borderColor : C.ghostBorder,
                    backgroundColor: active ? activeTone.backgroundColor : C.surfaceContainerHigh,
                    opacity: disabled ? 0.5 : 1,
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: disabled || active }}
                >
                  <Text style={{ ...Type.microCaps, textTransform: 'uppercase', color: active ? activeTone.color : C.text }}>
                    {mode}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Existing overlay fader is the source brightness in SOLID mode and
              the blend level in PLAYLIST mode. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ ...Type.labelCaps, textTransform: 'uppercase', color: C.secondary, width: 72 }}>
              {sourceMode === 'solid' ? 'BRIGHTNESS' : 'LEVEL'}
            </Text>
            <View style={{ flex: 1 }}>
              <HorizontalFader
                value={faderLocal}
                onChange={(v: number) => setFaderLocal(v)}
                onRelease={(v: number) => { setFaderLocal(v); onPatch({ fader: v }, 'Set level failed'); }}
                trackStyle={faderTrackStyle}
                fillStyle={{ height: '100%', borderRadius: 9, backgroundColor: accent }}
                thumbStyle={faderThumbStyle}
              />
            </View>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text, width: 40, textAlign: 'right' }}>{Math.round(faderLocal * 100)}%</Text>
          </View>

          {sourceMode === 'solid' ? (
            <View style={{ gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Text style={{ ...Type.labelCaps, textTransform: 'uppercase', color: C.secondary }}>
                  SOLID HUE
                </Text>
                <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: hueToHex(solidHueLocal), borderWidth: 1, borderColor: C.borderStrong }} />
                <View style={{ flex: 1 }} />
                <Text numberOfLines={1} style={{ ...Type.microCaps, color: C.secondary }}>
                  {hueToHex(solidHueLocal)}
                </Text>
              </View>
              <HorizontalFader
                value={solidHueLocal}
                onChange={setSolidHueLocal}
                onRelease={(hue: number) => {
                  setSolidHueLocal(hue);
                  onPatch({ solidColor: hueToHex(hue) }, 'Set solid color failed');
                }}
                trackStyle={faderTrackStyle}
                fillStyle={{ height: '100%', borderRadius: 9, backgroundColor: hueToHex(solidHueLocal) }}
                thumbStyle={faderThumbStyle}
              />
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 9.5, lineHeight: 13, color: C.secondary }}>
                Solid replaces the main Deck only inside this overlay&apos;s selected view. Its playlist stays parked.
              </Text>
            </View>
          ) : (
            <>
              {/* Overlay-only playlist colorization. NATIVE / CLEAR removes
                  entry metadata, so the pattern renders its authored colors. */}
              <View style={{ gap: 5 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Text style={{ ...Type.labelCaps, textTransform: 'uppercase', color: C.secondary }}>
                    COLOR
                  </Text>
                  <View style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: overlay.playlistTint || C.surfaceContainerHigh,
                    borderWidth: 1,
                    borderColor: C.borderStrong,
                  }} />
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity
                    onPress={() => onPatch({ playlistTint: null }, 'Clear overlay color failed')}
                    disabled={disabled || overlay.playlistTint === null}
                    style={{
                      flexShrink: 1,
                      paddingHorizontal: 8,
                      paddingVertical: 7,
                      borderRadius: Radius.control,
                      borderWidth: 1,
                      borderColor: C.ghostBorder,
                      opacity: disabled || overlay.playlistTint === null ? 0.45 : 1,
                    }}
                  >
                    <Text numberOfLines={1} style={{ ...Type.microCaps, color: C.text }}>NATIVE / CLEAR</Text>
                  </TouchableOpacity>
                </View>
                <HorizontalFader
                  value={tintHueLocal}
                  onChange={setTintHueLocal}
                  onRelease={(hue: number) => {
                    setTintHueLocal(hue);
                    onPatch({ playlistTint: hueToHex(hue) }, 'Set overlay color failed');
                  }}
                  trackStyle={faderTrackStyle}
                  fillStyle={{ height: '100%', borderRadius: 9, backgroundColor: hueToHex(tintHueLocal) }}
                  thumbStyle={faderThumbStyle}
                />
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 9.5, lineHeight: 13, color: C.secondary }}>
                  Color is saved on this active playlist entry and affects Deck overlays only.
                </Text>
              </View>

              {/* The overlay's own playlist + transport. */}
              <View style={{ height: 230 }}>
                <PlaylistPanel
                  channelId={overlay.id}
                  role="deckOverlay"
                  channelLabel={`OVERLAY · ${viewLabel}`}
                  compact
                  disabled={disabled}
                  initialAssignment={overlay.playlist || null}
                  playlistLibrary={playlistLibrary}
                />
              </View>
            </>
          )}
          {/* Redundant destructive affordance at the natural end of the edit
              form. The fixed header seat remains available while scrolling;
              this labeled button makes the action unmistakable in expanded
              mode and cannot be clipped by a long view/playlist label. */}
          <TouchableOpacity
            onPress={() => setConfirmRemove(true)}
            disabled={disabled || perfLocked}
            style={{
              minHeight: 40,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              borderRadius: Radius.control,
              borderWidth: 1,
              borderColor: C.error,
              opacity: (disabled || perfLocked) ? 0.45 : 1,
            }}
            accessibilityLabel="Remove overlay"
            accessibilityRole="button"
            accessibilityState={{ disabled: disabled || perfLocked }}
          >
            <IconSymbol name="trash" size={15} color={C.error} />
            <Text style={{ ...Type.labelCaps, textTransform: 'uppercase', color: C.error }}>REMOVE OVERLAY</Text>
          </TouchableOpacity>
        </View>
      )}

      <ViewSelectionPicker
        visible={showViewPicker}
        namedViews={namedViews}
        current={overlay.viewSelection || null}
        title="OVERLAY VIEW"
        onSelect={(v) => onPatch({ viewSelection: v }, 'Set view failed')}
        onClose={() => setShowViewPicker(false)}
      />
      <BlendPickerModal
        visible={showBlendPicker}
        current={overlay.mode}
        onSelect={(m) => onPatch({ mode: m }, 'Set blend failed')}
        onClose={() => setShowBlendPicker(false)}
      />
      <ConfirmSheet
        visible={confirmRemove}
        title="Remove overlay?"
        message={`Remove the ${viewLabel} overlay (${blendLabel(overlay.mode)} blend)? The main deck stays lit.`}
        confirmLabel="REMOVE"
        onConfirm={onRemove}
        onCancel={() => setConfirmRemove(false)}
      />
    </View>
  );
};

// ── The stack: shared autopilot header + add affordance + cards ────────────
export const DeckOverlayStack: React.FC<{
  overlays: DeckOverlay[];
  overlayAutopilot: DeckOverlayAutopilot;
  playlistLibrary: string[];
  disabled?: boolean;
}> = ({ overlays, overlayAutopilot, playlistLibrary, disabled = false }) => {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  // Same on-state / live-state pair as the two autopilot cards next door.
  const on = accentWash(C.primary);
  const live = accentWash(C.tertiary);
  // PERFORMANCE MODE: adding an overlay is structural (engine 409s
  // POST /deck/overlays while a show is live). The shared AUTO/SHUFFLE/timer
  // controls are runtime (allowed) and stay live.
  const perfLocked = usePerfLock();
  // The engine's full named-view catalog (groups + composites + Tier-A
  // auto-views). `undefined` until the fetch lands / when the payload omits it
  // — the shared picker fails LOUD on a missing catalog (codex P0).
  const [namedViews, setNamedViews] = useState<NamedView[] | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Add flow: pick a view (required) then a playlist, then POST.
  const [showAdd, setShowAdd] = useState(false);
  const [addView, setAddView] = useState<ViewSelection | null>(null);
  const [addSource, setAddSource] = useState<DeckOverlaySourceMode>('playlist');
  const [showAddViewPicker, setShowAddViewPicker] = useState(false);

  // Fetch the model's view options once (the picker reuses the same endpoint
  // the mixer view selector uses). Pure read — safe on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchViewSelectionOptions();
      if (cancelled || !res.ok || !res.data) return;
      // Pass through as-is (possibly undefined on a stale engine); the picker
      // surfaces a missing catalog loudly rather than us masking it here.
      setNamedViews(res.data.namedViews as NamedView[] | undefined);
    })();
    return () => { cancelled = true; };
  }, []);

  const atCap = overlays.length >= DECK_OVERLAY_MAX;

  // Reorder: the parent owns the ordered list (order[0]=bottom … last=top),
  // so reorder lives here and is passed to each card as a prop. `direction`
  // is the VISUAL move: -1 = up (toward the top layer = a HIGHER array index),
  // +1 = down (toward the bottom = a LOWER array index).
  const handleReorder = useCallback(async (id: string, direction: -1 | 1) => {
    const ids = overlays.map((o) => o.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    const to = from - direction; // visual up (-1) ⇒ +1 array index ⇒ toward top
    if (to < 0 || to >= ids.length) return;
    const next = ids.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const res = await reorderDeckOverlays(next);
    if (!res.ok) opError('Reorder failed', res.error || 'Unknown error');
  }, [overlays]);

  // Shared autopilot writes (the ONE unison cadence for all overlays).
  const setAuto = useCallback(async (fields: { active?: boolean; delay_s?: number; shuffle?: boolean }) => {
    const res = await setDeckOverlayAutopilot(fields);
    if (!res.ok) {
      const code = (res.data && res.data.code) as string | undefined;
      if (code === 'AUTOCYCLE_BAD_DELAY') {
        opWarn('Bad delay', 'Auto-cycle delay must be at least 1 second.');
      } else {
        opError('Auto-cycle failed', res.error || 'Unknown error');
      }
    }
  }, []);

  // Add an overlay with the chosen view + playlist (or default playlist).
  const handleAdd = useCallback(async (playlist?: string) => {
    if (!addView) {
      opWarn('Pick a view', 'An overlay needs a specific view (a group or view mask) — it cannot target the whole rig.');
      return;
    }
    // Default new overlays to OVER blend (operator request 2026-06-29): an
    // overlay laid OVER the deck should, by default, replace what's under it
    // within its view rather than screen-brighten it. The operator can still
    // switch to SCREEN/ADD per overlay via the blend picker.
    const res = await addDeckOverlay({
      viewSelection: addView,
      sourceMode: addSource,
      // A SOLID overlay parks the default playlist underneath so the operator
      // can switch back to PLAYLIST without losing/reconstructing its source.
      playlist: playlist || 'default',
      mode: 'blend_over',
      solidColor: '#FFFFFF',
    });
    if (!res.ok) {
      const code = (res.data && res.data.code) as string | undefined;
      if (code === 'DECK_OVERLAY_VIEW_REQUIRED') {
        opWarn('View required', 'Pick a specific view for the overlay (not the whole rig).');
      } else if (code === 'DECK_OVERLAY_VIEW_TAKEN') {
        opWarn('View already in use', 'That view already has an overlay. Pick a different view.');
      } else if (code === 'DECK_OVERLAY_OVER_CAP') {
        opWarn('Overlay limit reached', `You can have at most ${DECK_OVERLAY_MAX} deck overlays.`);
      } else {
        opError('Add overlay failed', res.error || 'Unknown error');
      }
      return;
    }
    // Success: close the sheet, reset the draft, expand the new overlay so the
    // operator can wire its playlist. The WS broadcast reconciles the list.
    const newId = (res.data && res.data.overlayId) as string | undefined;
    setShowAdd(false);
    setAddView(null);
    setAddSource('playlist');
    if (newId) setExpandedId(newId);
  }, [addSource, addView]);

  // The shared caps recipe (docs/54 §1.1) — this file used to restate it.
  const labelCaps = { ...Type.labelCaps, textTransform: 'uppercase' as const, color: C.secondary };

  return (
    <View style={{ width: '100%', minWidth: 0, marginBottom: 12 }}>
      {/* ── Shared header: OVERLAYS title + shared AUTO cadence + ADD ────── */}
      <View style={{ paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8, borderRadius: Radius.card, backgroundColor: C.surfaceContainerLowest, borderWidth: 1, borderColor: C.ghostBorder, gap: 6, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <View style={identityDot(C.tertiary)} />
          <Text style={labelCaps}>OVERLAYS</Text>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.secondary }}>{overlays.length}/{DECK_OVERLAY_MAX}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 6, minWidth: 0 }}>
          {/* SHARED auto-cycle (one unison clock for ALL overlays). */}
          <TouchableOpacity
            onPress={() => setAuto({ active: !overlayAutopilot.active })}
            disabled={disabled}
            style={[
              { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: overlayAutopilot.active ? live.backgroundColor : 'transparent', paddingHorizontal: 8, paddingVertical: 7, borderRadius: Radius.control, borderWidth: 1, borderColor: overlayAutopilot.active ? live.borderColor : C.ghostBorder },
              overlayAutopilot.active && { boxShadow: glowFor(C.tertiary) },
            ]}
          >
            <IconSymbol name={overlayAutopilot.active ? 'pause.fill' : 'play.fill'} size={14} color={overlayAutopilot.active ? live.color : C.text} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: overlayAutopilot.active ? live.color : C.text }}>
              AUTO (ALL)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setAuto({ shuffle: !overlayAutopilot.shuffle })}
            disabled={disabled}
            style={{
              flex: 1, minWidth: 0, justifyContent: 'center',
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 8, paddingVertical: 7,
              borderRadius: Radius.control, borderWidth: 1,
              borderColor: overlayAutopilot.shuffle ? on.borderColor : 'transparent',
              backgroundColor: overlayAutopilot.shuffle ? on.backgroundColor : 'transparent',
            }}
          >
            <IconSymbol name="shuffle" size={14} color={overlayAutopilot.shuffle ? on.color : C.icon} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: overlayAutopilot.shuffle ? on.color : C.icon, letterSpacing: 0.5 }}>SHUFFLE</Text>
          </TouchableOpacity>
        </View>
        {/* Shared cadence timer pills (one unison clock for ALL overlays).
            QA round8 #4: the "advance together every Ns" prose duplicated the
            selected pill right below it, so it was dropped — the one-line hint
            now lives only in the empty (no-overlay) state below. */}
        <AutopilotTimerPills
          value={overlayAutopilot.delay_s || 30}
          onChange={(v: number) => setAuto({ delay_s: v })}
        />
      </View>

      {/* ── Overlay cards ─────────────────────────────────────────────── */}
      {overlays.length === 0 ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, fontStyle: 'italic', paddingHorizontal: 8, paddingBottom: 8 }}>
          No deck overlays. Add one to layer a view-scoped look over the main deck. When AUTO is on, all overlays share one cadence and advance together.
        </Text>
      ) : (
        // Render top layer first so the visual stack reads top→bottom (the
        // array is bottom→top; reverse for display).
        overlays
          .map((o, i) => ({ o, i }))
          .reverse()
          .map(({ o, i }) => (
            <OverlayCard
              key={o.id}
              overlay={o}
              index={i}
              count={overlays.length}
              expanded={expandedId === o.id}
              onToggleExpand={() => setExpandedId((cur) => (cur === o.id ? null : o.id))}
              namedViews={namedViews}
              playlistLibrary={playlistLibrary}
              disabled={disabled}
              onReorder={handleReorder}
            />
          ))
      )}

      {/* ── + ADD OVERLAY (hidden at cap with a hint) ─────────────────── */}
      {atCap ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary, fontStyle: 'italic', paddingHorizontal: 8, paddingTop: 4 }}>
          Overlay limit reached ({DECK_OVERLAY_MAX}). Remove one to add another.
        </Text>
      ) : (
        <TouchableOpacity
          onPress={() => { setAddView(null); setAddSource('playlist'); setShowAdd(true); }}
          disabled={disabled || perfLocked}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderRadius: Radius.control, borderWidth: 1, borderStyle: 'dashed', borderColor: C.ghostBorder, opacity: (disabled || perfLocked) ? 0.5 : 1 }}
          accessibilityState={{ disabled: disabled || perfLocked }}
        >
          <IconSymbol name="plus" size={16} color={C.primary} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, letterSpacing: 0.5, color: C.primary }}>ADD OVERLAY</Text>
        </TouchableOpacity>
      )}

      {/* ── Add overlay sheet: view (required) + playlist ─────────────── */}
      <Modal transparent visible={showAdd} animationType="fade" onRequestClose={() => setShowAdd(false)} supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
          activeOpacity={1}
          onPress={() => setShowAdd(false)}
        >
          <TouchableOpacity activeOpacity={1} style={[globalStyles.panel, { width: '100%', maxWidth: 420, padding: 16, gap: 12 }]}>
            <Text style={labelCaps}>ADD OVERLAY</Text>
            {/* Step 1: required view */}
            <TouchableOpacity
              onPress={() => setShowAddViewPicker(true)}
              style={{ paddingHorizontal: 12, paddingVertical: 11, borderRadius: Radius.control, borderWidth: 1, borderColor: addView ? C.borderStrong : C.ghostBorder, backgroundColor: C.surfaceContainerHigh }}
            >
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: addView ? C.primary : C.text }}>
                {addView ? `VIEW: ${viewSelectionLabel(addView)}` : 'PICK A VIEW (required) ▾'}
              </Text>
            </TouchableOpacity>
            {/* Step 2: source. Solid needs no sacrificial pattern; playlist
                mode keeps the existing playlist picker. */}
            <Text style={[labelCaps, { fontSize: 9, marginTop: 4 }]}>SOURCE</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['playlist', 'solid'] as DeckOverlaySourceMode[]).map((mode) => {
                const active = addSource === mode;
                return (
                  <TouchableOpacity
                    key={mode}
                    onPress={() => setAddSource(mode)}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingVertical: 10,
                      borderRadius: Radius.control,
                      borderWidth: 1,
                      borderColor: active ? C.primary : C.ghostBorder,
                      backgroundColor: active ? on.backgroundColor : C.surfaceContainerHigh,
                    }}
                  >
                    <Text style={{ ...Type.labelCaps, textTransform: 'uppercase', color: active ? on.color : C.text }}>
                      {mode}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {addSource === 'solid' ? (
              <TouchableOpacity
                onPress={() => handleAdd()}
                disabled={!addView}
                style={{
                  alignItems: 'center',
                  paddingVertical: 12,
                  borderRadius: Radius.control,
                  borderWidth: 1,
                  borderColor: C.primary,
                  backgroundColor: on.backgroundColor,
                  opacity: addView ? 1 : 0.4,
                }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: on.color }}>
                  ADD SOLID OVERLAY
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <Text style={[labelCaps, { fontSize: 9, marginTop: 4 }]}>PLAYLIST</Text>
                <ScrollView style={{ maxHeight: 220 }}>
                  <TouchableOpacity
                    onPress={() => handleAdd(undefined)}
                    disabled={!addView}
                    style={{ paddingVertical: 11, paddingHorizontal: 8, borderRadius: Radius.control, opacity: addView ? 1 : 0.4 }}
                  >
                    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.text }}>DEFAULT</Text>
                  </TouchableOpacity>
                  {playlistLibrary
                    .filter((name) => name.toLowerCase() !== 'default')
                    .map((name) => (
                    <TouchableOpacity
                      key={name}
                      onPress={() => handleAdd(name)}
                      disabled={!addView}
                      style={{ paddingVertical: 11, paddingHorizontal: 8, borderRadius: Radius.control, opacity: addView ? 1 : 0.4 }}
                    >
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.text }}>{name.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ViewSelectionPicker
        visible={showAddViewPicker}
        namedViews={namedViews}
        current={addView}
        title="OVERLAY VIEW"
        onSelect={(v) => setAddView(v)}
        onClose={() => setShowAddViewPicker(false)}
      />
    </View>
  );
};
