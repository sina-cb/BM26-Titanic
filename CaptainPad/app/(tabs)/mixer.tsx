import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Palette } from '@/constants/theme';
import { View, Text, TouchableOpacity, Pressable, ScrollView, StyleSheet, TextInput, Modal, useWindowDimensions, Alert } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { usePalette } from '@/hooks/use-theme';
import { useGlobalStyles, GlobalStyles } from '@/styles/globalStyles';
import { useFocusEffect } from 'expo-router';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { RigGlobals } from '@/components/RigGlobals';
import {
  fetchMixerState, updateMixerChannel, removeMixerChannel, setMixerChannelControl,
  addMixerChannel, updateMixerMaster,
  fetchChannelBlends, fetchTransitions, setMixerView,
  fetchPlaylists, fetchViewSelectionOptions,
  captureMixerChannelDefaults, discardMixerChannelDefaults,
  invalidatePlaylistsCache, invalidatePlaylistCache,
  type PlaylistData,
} from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';
import { useActiveModel } from '@/hooks/useEngineState';

import { CPCControls } from '@/components/CPCControls';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import { TRANSITION_DURATION_PRESETS_MS } from '@/components/DeckTransitionControls';
import { MiniFader } from '@/components/ui/MiniFader';
import { HealthChip } from '@/components/ui/HealthChip';
import { TimerWheel } from '@/components/ui/TimerWheel';
import { ChannelVizStrip } from '@/components/ChannelVizStrip';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { SnapshotBar } from '@/components/SnapshotBar';
import { setChannelColor, setChannelHue } from '@/utils/channelExtrasApi';
import { duplicateMixerChannel, reorderMixerChannels, panicMixer } from '@/utils/channelOpsApi';
import {
  type MixGroup,
  postSolo, deleteSolo, clearAllSolo, setChannelSoloSafe,
} from '@/utils/groupsSoloApi';
import { postBump } from '@/utils/bumpApi';
import { GroupRail } from '@/components/GroupRail';
import { useEngineConnection } from '@/hooks/useEngineConnection';
import type { EngineMessage, BusStatus } from '@/utils/engineEvents';
import {
  ModulationReadonlyBadge, useEntryModulations, useModulationState,
  GhostMarker, prettySliderName,
} from '@/components/Modulation';

// HorizontalFader moved to shared ui

// Production-console touch target: the title-bar icon buttons (refresh,
// lock, pin, delete) render as 28×28 squircles to keep the toolbar tidy,
// but a 28pt tap target is below the 44pt accessibility/operator-safety
// floor. An 8pt hitSlop on every edge expands the *interactive* area to
// 44×44 without changing the visual footprint (28 + 8 + 8 = 44).
const ICON_BTN_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

// Per-channel color accent palette (docs/39 §8.4 — channel `color` metadata,
// no render effect). A small fixed set of high-contrast hex accents so the
// operator can tint a strip for at-a-glance identification; the last option
// clears the accent (color = null). The engine accepts any string or null, so
// this curated list is purely the UI's tap-to-pick surface.
const CHANNEL_COLOR_SWATCHES: string[] = [
  '#E53935', // red
  '#FB8C00', // orange
  '#FDD835', // yellow
  '#43A047', // green
  '#00ACC1', // cyan
  '#1E88E5', // blue
  '#8E24AA', // purple
  '#EC407A', // pink
];

// ── Global Rig Buttons moved to RigGlobals ────────────────────────────

// Mini Fader moved to GlobalParams.tsx

// ── Blend Mode Picker Modal ────────────────────────────────────────────
const BlendModePicker = ({ visible, current, onSelect, onClose, blends, title }: any) => {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalContent}>
          <Text style={[styles.labelCaps, {marginBottom: 12}]}>{title || 'BLEND MODE'}</Text>
          {(blends || []).map((id: string) => (
            <TouchableOpacity key={id} style={[styles.modalRow, id === current && styles.modalRowActive]} onPress={() => { onSelect(id); onClose(); }}>
              <Text style={[styles.valueReadout, id === current && {color: C.onPrimary}]}>{id.replace(/^(blend_|trans_)/, '').toUpperCase()}</Text>
              {id === current ? <Text style={{ color: C.onPrimary, fontSize: 14, fontFamily: 'SpaceGrotesk_700Bold' }}>✓</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

// ── Mixer local-params (read-only modulation badge + live ghost) ───────
//
// Per-channel renderer for the LOCAL PARAMS card on a mixer strip.
// Pulls the active entry's modulations once (cached, deduped via
// fetchPlaylist) and overlays:
//
//   - a green ◎ ON badge next to any slider that has a saved mapping
//     on the channel's currently-active playlist entry. Read-only on
//     the mixer per design — edits stay on the deck so there's one
//     source of truth for modulation CRUD.
//   - a thin green vertical line on the slider track when the engine
//     is actively writing a modulated value for this target THIS
//     frame. Frames only arrive for the deck-active pattern, so this
//     overlay lights up when the mixer channel happens to be hosting
//     the same pattern the deck is playing.
function MixerLocalParams({ channel, onControlChange }: {
  channel: { id: string; exports?: any[]; playlist?: { name?: string; activeEntryId?: string } | null };
  onControlChange: (channelId: string, controlId: number, value: number) => void;
}) {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);
  const playlistName = channel.playlist?.name ?? null;
  const entryId = channel.playlist?.activeEntryId ?? null;
  const { mappings } = useEntryModulations(playlistName, entryId);
  const modulationLive = useModulationState();
  const mappingByTarget = React.useMemo(() => {
    const m: Record<string, any> = {};
    for (const x of mappings) m[x.target.parameter] = x;
    return m;
  }, [mappings]);

  const exps = channel.exports || [];
  if (exps.length === 0) {
    return <Text style={[styles.labelCaps, { textAlign: 'center', marginTop: 16 }]}>NO PARAMS</Text>;
  }
  return (
    <View style={{ gap: 4 }}>
      {exps.map((exp: any) => {
        const matched = !!exp.cpcOwned;
        const niceLabel = prettySliderName(exp.name);
        const hasMapping = !matched && !!mappingByTarget[exp.name];
        const live = !matched ? modulationLive[exp.name] : null;
        // When a modulation is live the engine writes the MODULATED value back
        // into exp.v0, so the true anchor is the modulationState frame's base
        // (operator's set value), not exp.v0 — else the live bar slides.
        const base = (live && typeof live.base === 'number')
          ? live.base
          : (exp.v0 !== undefined ? exp.v0 : 0.5);
        // Engine must report BOTH a defined base AND modulated, with
        // both diverging from the operator-set base, before we paint
        // a ghost. Prevents the "green box at left:0% on silence"
        // bug (see Modulation.tsx ModulatedSliderImpl for full notes).
        const ghost = live
          && live.modulated !== undefined
          && live.base !== undefined
          && Math.abs(live.modulated - live.base) >= 0.01
          && Math.abs(live.modulated - base) >= 0.01
          ? live.modulated : null;
        return (
          <View key={exp.id}>
            {/* When mapped, render the ◎ ON pill inline above the
                MiniFader so the slider row reads the same way on the
                deck and mixer. CPC-matched sliders still use the
                MiniFader's own `badge` prop because that's a
                different concept ("the global owns this"). */}
            {hasMapping ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 1 }}>
                <ModulationReadonlyBadge hasMapping={true} isOverride={mappingByTarget[exp.name]?.mode === 'override'} />
                {ghost !== null ? (
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: '#00a86b' }}>
                    →{ghost.toFixed(2)}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View style={{ position: 'relative' }}>
              <MiniFader
                label={niceLabel}
                value={base}
                onChange={(v: number) => onControlChange(channel.id, exp.id, v)}
                disabled={matched}
                badge={matched ? `MATCH${exp.cpcLabel ? `·${String(exp.cpcLabel).substring(0, 4).toUpperCase()}` : ''}` : undefined}
                fillColor={hasMapping ? undefined : undefined}
              />
              {/* Live modulation overlay — only paints when the engine
                  is currently writing a modulated value for this
                  slider on the deck-active pattern. */}
              {ghost !== null ? (
                <View style={{
                  position: 'absolute',
                  left: 0, right: 0,
                  // MiniFader track starts after the label row (~14 px
                  // total of label + 2 px margin). The track is 16 px
                  // tall, borderRadius 8. Position + size match so the
                  // green ghost fill aligns to the underlying track.
                  top: 14, height: 16,
                  pointerEvents: 'none',
                }}>
                  <GhostMarker ghost={ghost} base={base} borderRadius={8} />
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── Channel Strip ──────────────────────────────────────────────────────
// "1 list to rule them all": the strip's body shows the channel's PlaylistPanel
// as its ONLY pattern list. Tapping a row swaps the active playlist entry; +/-
// inside the panel add or remove entries; SAVE persists. No parallel "all
// patterns" column anymore.
// `initialPlaylist` is the inline `playlistData` payload from POST
// /mixer/channels (or POST /mixer/channels/:id/playlist), cached by the
// parent in `inlinePlaylistRef`. Forwarding it here gives the freshly-
// mounted PlaylistPanel synchronous entry-list content on first paint,
// so the operator doesn't have to re-pick from the dropdown when their
// iPad's wifi is too slow for refresh()'s GETs to land in time.
const ChannelStrip = React.memo(({ channel, index, blends, transitions, isSolo, soloActive, dimmedBySolo, isBumped, onBumpOn, onBumpOff, group, isDeck, playlistLibrary, initialPlaylist, cardStyle, onFaderChange, onColorChange, onHueChange, onMuteToggle, onSoloToggle, onSoloSafeToggle, onModeChange, onControlChange, onDelete, onDuplicate, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onLockToggle, onFaderLockToggle, onTransition, onTransitionSettingsChange, viewSelectionGroups, viewSelectionViewMasks, onViewSelectionChange }: any) => {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);
  // Orientation drives the strip body layout (QA round1 #2): in PORTRAIT the
  // playlist + LOCAL PARAMS stack vertically so the playlist (the primary
  // surface) gets the full strip width and track names stop being squeezed by
  // the side-by-side params column. Landscape keeps the side-by-side split.
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isPortrait = winWidth < winHeight;
  const [showBlendPicker, setShowBlendPicker] = useState(false);
  const [showTransPicker, setShowTransPicker] = useState(false);
  const [showViewPicker, setShowViewPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  // Transition duration is stored as ms-integers (matching the deck's
  // TRANSITION_DURATION_PRESETS_MS) so the wheel's centered-row preset
  // equality lights up consistently. Engine wire format is seconds
  // (float), converted at the boundary. Codex P0: if the engine ever
  // omits transitionTime we want to know — fail loudly rather than
  // silently substitute 1.0.
  if (typeof channel.transitionTime !== 'number' || !Number.isFinite(channel.transitionTime)) {
    throw new Error(`ChannelStrip: channel ${channel.id} missing numeric transitionTime (got ${channel.transitionTime})`);
  }
  const [transTimeMs, setTransTimeMs] = useState<number>(Math.round(channel.transitionTime * 1000));
  const [transMode, setTransMode] = useState(channel.transitionMode || "trans_crossfade");
  // Per-strip refresh nonce. Tapping the ↻ arrow on the channel name row
  // bumps this, which propagates to the PlaylistPanel via the
  // `refreshNonce` prop and forces it to re-fetch the playlist library +
  // this channel's playlist content (after busting both caches). This is
  // the operator's one-tap rescue for the "added a 3rd layer and patterns
  // aren't showing" failure mode — instead of having to delete and re-add
  // the channel, just tap the arrow next to the name.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const locked = !!channel.locked;
  // Fader-lock (slot 5, independent of `locked`): freezes the fader
  // against scripted transitions and client-side solo. Distinct icon
  // + colour so operators can tell the two locks apart at a glance:
  //   locked (playlist/pattern lock) → lock.fill, amber
  //   faderLocked                    → arrow.left.and.right circle-style, teal
  const faderLocked = !!channel.faderLocked;
  // Solo-safe (docs/39 §10): rig-config flag — this channel is never gated off
  // by ANOTHER channel's solo (protects the mission-critical exterior).
  // Server-authoritative (PATCH {soloSafe}); the engine broadcast is the truth.
  // fader-lock IMPLIES solo-safe on the engine, so the effective protection is
  // soloSafe || faderLocked.
  const soloSafe = !!channel.soloSafe;
  const soloProtected = soloSafe || faderLocked;

  // View-selection state read straight from the channel (engine is the
  // source of truth — broadcasts overwrite local state on every mixer
  // event). Supports ALL, GROUP (string name), and VIEW MASK (string
  // name resolved against the model's named-viewMask dictionary).
  // Section / fixture targets exist in the API but aren't surfaced in
  // the picker yet — they target by numeric id which isn't
  // operator-friendly.
  const viewSel = channel.viewSelection || { type: 'all', target: null, invert: false };
  let viewSelLabel: string;
  if (viewSel.type === 'all') {
    viewSelLabel = 'ALL';
  } else if (viewSel.type === 'group') {
    viewSelLabel = String(viewSel.target || '').toUpperCase();
  } else if (viewSel.type === 'viewMask') {
    // Named viewMask renders as its uppercased name; a raw bitmask
    // (legacy / programmatic clients) renders as MASK·0x<bits>.
    viewSelLabel = typeof viewSel.target === 'string'
      ? viewSel.target.toUpperCase()
      : `MASK·0x${(viewSel.target || 0).toString(16).toUpperCase()}`;
  } else {
    viewSelLabel = String(viewSel.type).toUpperCase();
  }
  return (
    <View style={[
      styles.channelCard,
      // Channel color accent (docs/39 §8.4): tint the card's left edge so
      // the operator can identify a strip at a glance. The lock border still
      // wins (operator-critical state) — only paint the color accent when the
      // channel isn't locked.
      !locked && channel.color ? { borderColor: channel.color, borderLeftWidth: 4 } : null,
      // Group tint (docs/39 §10): a member channel takes its group's color on
      // the left edge so grouped strips read together at a glance. The
      // channel's own color (above) wins if both are set; the lock border
      // (operator-critical) wins over both.
      !locked && !channel.color && group?.color ? { borderColor: group.color, borderLeftWidth: 4 } : null,
      locked && styles.channelCardLocked,
      // Solo dimming is DISPLAY-ONLY (docs/39 §10): when another channel is
      // soloed and this one isn't soloed / solo-safe / fader-locked, the
      // engine gates its contribution to 0. We mirror that visually by
      // dimming the strip — we NEVER mutate its enabled/fader.
      dimmedBySolo ? { opacity: 0.45 } : null,
      // Responsive width override (QA round1 #7): in landscape the parent
      // hands each strip a flex width so the cards fill the viewport instead
      // of hugging the left edge with a grey void to the right.
      cardStyle,
    ]}>
      <BlendModePicker visible={showBlendPicker} current={channel.mode} onSelect={(m: string) => onModeChange(channel.id, m)} onClose={() => setShowBlendPicker(false)} blends={blends} />
      <BlendModePicker visible={showTransPicker} current={transMode} onSelect={(m: string) => { setTransMode(m); onTransitionSettingsChange && onTransitionSettingsChange(channel.id, { transitionMode: m }); }} onClose={() => setShowTransPicker(false)} blends={transitions} title="TRANSITION STYLE" />
      {/* Channel color picker (docs/39 §8.4). A swatch grid + a "NO COLOR"
          clear option (color = null). Pure metadata — tints the strip for
          identification, no render effect. */}
      <Modal transparent visible={showColorPicker} animationType="fade" onRequestClose={() => setShowColorPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowColorPicker(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalContent}>
              <Text style={[styles.labelCaps, { marginBottom: 12 }]}>CHANNEL COLOR</Text>
              <View style={styles.swatchGrid}>
                {CHANNEL_COLOR_SWATCHES.map((hex) => {
                  const active = channel.color === hex;
                  return (
                    <TouchableOpacity
                      key={hex}
                      style={[
                        styles.swatch,
                        { backgroundColor: hex },
                        active && styles.swatchActive,
                      ]}
                      hitSlop={ICON_BTN_HIT_SLOP}
                      onPress={() => { onColorChange && onColorChange(channel.id, hex); setShowColorPicker(false); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Set channel color ${hex}`}
                      accessibilityState={{ selected: active }}
                    >
                      {active ? <Text style={styles.swatchCheck}>✓</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={styles.clearColorBtn}
                onPress={() => { onColorChange && onColorChange(channel.id, null); setShowColorPicker(false); }}
                accessibilityRole="button"
                accessibilityLabel="Clear channel color"
              >
                <Text style={[styles.valueReadout, { color: C.secondary }]}>NO COLOR</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      {/* Header — title bar buttons share one geometry (28×28 squircle,
          identical surface / border) so they read as a single toolbar.
          Pre-May-2026 refresh was 22×22 + pinned to the name, lock was
          28×28 + pinned to the right. Operator feedback "make them
          look exactly the same" drove this unification. */}
      <View style={styles.channelHeader}>
        {/* Name + badges claim the full first line (flexBasis 100%) so the
            control row below always gets the strip's full width to lay out
            its buttons without clipping. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexGrow: 1, flexBasis: '100%', minWidth: 0 }}>
          <View style={styles.channelBadge}>
            <Text style={[styles.valueReadout, { color: C.primary }]}>{index}</Text>
          </View>
          {/* Group badge (docs/39 §10): when this channel is a group member,
              show a small tinted chip with the group name so the operator can
              see the membership without opening the group rail. */}
          {group ? (
            <View style={[styles.groupBadge, group.color ? { borderColor: group.color } : null]}>
              <View style={[styles.groupBadgeDot, { backgroundColor: group.color || C.secondary }]} />
              <Text style={styles.groupBadgeText} numberOfLines={1}>
                {(group.name || 'GROUP').toUpperCase()}
              </Text>
            </View>
          ) : null}
          <TextInput
            style={[styles.headlineSm, { fontSize: 14, color: C.text, flex: 1, padding: 0 }]}
            defaultValue={channel.name || 'CH ' + index}
            onEndEditing={async (e) => {
              // Codex P0 — no silent swallow. Name is cosmetic (not
              // operator-critical), so a rejected rename is logged, not
              // alerted; the uncontrolled input keeps the typed text and
              // the next mixer broadcast re-syncs the committed value.
              const res = await updateMixerChannel(channel.id, { name: e.nativeEvent.text });
              if (!res.ok) console.error(`[Mixer] Channel rename rejected for ${channel.id}:`, res.error);
            }}
            placeholderTextColor={C.icon}
          />
        </View>
        {/* Channel-control button row. Wraps to a second line on narrow
            (phone) widths instead of cramming/clipping the 9 controls into one
            overflowing strip (2026-06-22 UI cleanup). `rowGap` keeps the
            wrapped second line clear of the first; the per-button 28pt
            squircles + their ICON_BTN_HIT_SLOP keep every target ≥44pt. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', flexBasis: '100%', flexShrink: 1, minWidth: 0, columnGap: 4, rowGap: 8, alignItems: 'center', justifyContent: 'flex-start' }}>
          {/* Color swatch (docs/39 §8.4) — taps open the accent picker.
              The swatch fill IS the channel's current color (or a neutral
              "no color" outline when null). Pure metadata; it tints the
              strip for at-a-glance identification, no render effect. */}
          <TouchableOpacity
            style={[
              styles.titleBtn,
              channel.color
                ? { backgroundColor: channel.color, borderColor: channel.color }
                : null,
            ]}
            hitSlop={ICON_BTN_HIT_SLOP}
            onPress={() => setShowColorPicker(true)}
            accessibilityLabel={channel.color ? `Channel color ${channel.color}` : 'Set channel color'}
            accessibilityRole="button"
          >
            {/* No tinted fill ⇒ a hollow ring reads as "no color set"; a
                filled swatch shows the chosen accent. A glyph (not an
                SF-symbol) keeps this within owned files. */}
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 13,
              color: channel.color ? '#FFFFFF' : C.secondary,
            }}>{channel.color ? '●' : '○'}</Text>
          </TouchableOpacity>
          {/* Refresh ↻ — operator's one-tap rescue for a panel that
              lost its entries to a transient WS / fetch race. Bumps
              `refreshNonce` so the PlaylistPanel does a hard cache-bust
              + refetch. With the May 2026 WS topic split this should
              rarely be needed (control events no longer compete with
              vis frame parsing), but keeping the button gives the
              operator a deterministic recovery path. */}
          <TouchableOpacity
            style={styles.titleBtn}
            hitSlop={ICON_BTN_HIT_SLOP}
            onPress={() => {
              invalidatePlaylistsCache();
              const curName = channel.playlist?.name;
              if (curName) invalidatePlaylistCache(curName);
              setRefreshNonce(n => n + 1);
            }}
            accessibilityLabel="Refresh this channel's playlist + patterns list"
            accessibilityRole="button"
          >
            <IconSymbol name="arrow.clockwise" size={14} color={C.secondary} />
          </TouchableOpacity>
          {/* Lock (playlist/pattern lock) — amber when engaged. */}
          <TouchableOpacity
            style={[styles.titleBtn, locked && styles.titleBtnAmberActive]}
            hitSlop={ICON_BTN_HIT_SLOP}
            onPress={() => onLockToggle(channel.id, !locked)}
            accessibilityLabel={locked ? 'Unlock channel' : 'Lock channel'}
            accessibilityRole="button"
          >
            <IconSymbol name={locked ? 'lock.fill' : 'lock.open.fill'} size={14} color={locked ? '#F5A623' : C.secondary} />
          </TouchableOpacity>
          {/* Pin (fader-lock, slot 5) — teal when engaged. When ON the
              engine ignores manual fader writes and skips scripted
              transitions on this channel; the client-side solo handler
              also skips it. Independent of the lock above so the two
              are visually unambiguous. */}
          {onFaderLockToggle && (
            <TouchableOpacity
              style={[styles.titleBtn, faderLocked && styles.titleBtnTealActive]}
              hitSlop={ICON_BTN_HIT_SLOP}
              onPress={() => onFaderLockToggle(channel.id, !faderLocked)}
              accessibilityLabel={faderLocked ? 'Unpin fader' : 'Pin fader'}
              accessibilityRole="button"
            >
              <IconSymbol
                name={faderLocked ? 'pin.fill' : 'pin.slash.fill'}
                size={14}
                color={faderLocked ? C.primary : C.secondary}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.modeDropdown}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            onPress={() => { if (!locked) setShowBlendPicker(true); }}
            activeOpacity={locked ? 1.0 : 0.2}
            accessibilityRole="button"
            accessibilityLabel={`Blend mode: ${(channel.mode || 'normal').replace('blend_', '')}`}
          >
            <Text style={[styles.valueReadout, { color: locked ? C.secondary : C.primary, fontSize: 11 }]}>{(channel.mode || 'normal').replace('blend_', '').toUpperCase()}{locked ? '' : ' ▾'}</Text>
          </TouchableOpacity>
          {/* Reorder chevrons (docs/39 §6b #7). Up = toward the TOP of the
              mix (last in the engine's overlay order); down = toward the
              bottom. Each tap recomputes the full id order locally and POSTs
              /mixer/channels/reorder; the `mixer` broadcast reconciles. The
              chevrons are disabled at the ends of the stack. A ≥44pt hitSlop
              keeps the 28×28 squircles within the operator-safety touch floor
              (28 + 8 + 8 = 44). Reorder is non-destructive and not gated by the
              channel lock — a locked layer can still be restacked. */}
          {onMoveUp && (
            <TouchableOpacity
              style={[styles.titleBtn, !canMoveUp && { opacity: 0.3 }]}
              hitSlop={ICON_BTN_HIT_SLOP}
              disabled={!canMoveUp}
              onPress={() => onMoveUp(channel.id)}
              accessibilityLabel="Move channel up (toward top of mix)"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canMoveUp }}
            >
              <IconSymbol name="chevron.up" size={14} color={C.secondary} />
            </TouchableOpacity>
          )}
          {onMoveDown && (
            <TouchableOpacity
              style={[styles.titleBtn, !canMoveDown && { opacity: 0.3 }]}
              hitSlop={ICON_BTN_HIT_SLOP}
              disabled={!canMoveDown}
              onPress={() => onMoveDown(channel.id)}
              accessibilityLabel="Move channel down (toward bottom of mix)"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canMoveDown }}
            >
              <IconSymbol name="chevron.down" size={14} color={C.secondary} />
            </TouchableOpacity>
          )}
          {/* Duplicate (docs/39 §6b #6) — clones this overlay onto the TOP of
              the stack. Non-destructive, so NO ConfirmSheet (matches the
              design doc). The new channel arrives via the `mixer` broadcast.
              An over-cap attempt surfaces the engine's 400 as an Alert in the
              parent handler. */}
          {onDuplicate && (
            <TouchableOpacity
              style={styles.titleBtn}
              hitSlop={ICON_BTN_HIT_SLOP}
              onPress={() => onDuplicate(channel.id)}
              accessibilityLabel="Duplicate channel"
              accessibilityRole="button"
            >
              {/* A glyph (not an SF-symbol) keeps this within owned files —
                  the shared icon-symbol mapping isn't this slice's to edit, so
                  no `plus.square.on.square` entry exists. "⧉" reads as
                  "duplicate / overlapping copy". */}
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.secondary }}>⧉</Text>
            </TouchableOpacity>
          )}
          {!locked && (
            <TouchableOpacity
              style={[styles.titleBtn, { borderColor: 'rgba(217, 48, 37, 0.4)' }]}
              hitSlop={ICON_BTN_HIT_SLOP}
              onPress={() => onDelete(channel.id)}
              accessibilityLabel="Delete channel"
              accessibilityRole="button"
            >
              <IconSymbol name="trash" size={14} color={C.error} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Pixel Visualization — self-subscribing per-channel strip so a
          new viz frame re-renders ONLY this tiny component, not the whole
          strip list (see ChannelVizStrip + the perf note on the mixer
          screen's viz handling). */}
      <ChannelVizStrip vizKey={channel.id} height={14} style={{ marginBottom: 6 }} />

      {/* Level Fader. `fader` is null-coalesced to 0 for display ONLY —
          a broadcast that omits it shows an empty fader rather than NaN%
          (which RN would render as the literal text "NaN"). The engine is
          the source of truth and normally always sends fader. */}
      <View style={styles.levelRow}>
        <Text style={[styles.labelCaps, { width: 36 }]}>LEVEL</Text>
        <HorizontalFader
          value={channel.fader ?? 0}
          onChange={(v: number) => onFaderChange(channel.id, v)}
          trackStyle={[styles.faderTrack, { flex: 1, marginHorizontal: 6 }]}
          fillStyle={styles.faderFill}
        />
        <Text style={[styles.displayMono, { width: 32, textAlign: 'right', fontSize: 13 }]}>
          {Math.round((channel.fader ?? 0) * 100)}
        </Text>
      </View>

      {/* Per-channel HUE (docs/39 §F-hue). A luminance-preserving RGB-only
          hue rotation applied PRE-blend on THIS channel's contribution —
          W/A/UV (mission-critical exterior whites) are never touched. The
          0-360° fader maps onto the engine's `hue` field (default 0 = no
          rotation, zero render cost). Same lock gate as the level row. The
          fader is normalized 0..1 (HorizontalFader's contract), so the
          display ×360 round-trips degrees. A small swatch on the left
          previews the rotation tint. Rendered unconditionally so the strip
          never shifts when hue returns to 0.
          DECLUTTER (mixer declutter, operator's marked-up screenshot): with
          CAP/SPEED/OFFSET/etc. gone, LEVEL + HUE are the only two faders on
          the strip. HUE is rendered SLIM (thin track + tight row + small
          swatch + 11pt label/readout) so LEVEL reads as the primary control
          and HUE as a clearly secondary trim. */}
      {onHueChange && (
        <View style={styles.hueRow}>
          <Text style={[styles.labelCaps, { width: 36, fontSize: 10 }]}>HUE</Text>
          <View
            style={[
              styles.hueSwatch,
              { backgroundColor: `hsl(${Math.round(channel.hue ?? 0)}, 80%, 55%)` },
            ]}
          />
          <HorizontalFader
            value={(channel.hue ?? 0) / 360}
            onChange={(v: number) => { if (!locked) onHueChange(channel.id, Math.round(v * 360)); }}
            trackStyle={[styles.hueTrack, { flex: 1, marginHorizontal: 6, opacity: locked ? 0.5 : 1 }]}
            fillStyle={styles.hueFill}
          />
          <Text style={[styles.displayMono, { width: 32, textAlign: 'right', fontSize: 11, color: C.secondary }]}>
            {Math.round(channel.hue ?? 0)}
          </Text>
        </View>
      )}

      <View style={[styles.channelBody, isPortrait && styles.channelBodyPortrait]}>
        {/* Left column = the playlist (this IS the pattern list — "1 list to
            rule them all"). Wider than the params column so long names fit.
            In PORTRAIT this stacks ABOVE the params and spans the full strip
            width so track names get the room the squeezed side-by-side layout
            denied them (QA round1 #2). */}
        <View style={[styles.patternListPanel, isPortrait && styles.patternListPanelPortrait]}>
          <PlaylistPanel
            channelId={channel.id}
            channelLabel={isDeck ? 'DECK MAIN' : `CH ${index}`}
            compact
            locked={locked}
            initialAssignment={channel.playlist || null}
            initialPlaylist={initialPlaylist || null}
            refreshNonce={refreshNonce}
            playlistLibrary={playlistLibrary}
          />
        </View>

        {/* Right column = live parameter sliders only. Mute/Solo and the
            transition controls have moved to full-column-width rows BELOW
            this body so they stretch the full strip width (item 1).
            The list is now wrapped in a bordered card so each channel's
            local params read as a discrete cluster (operator feedback
            2026-05-26: bare list felt visually merged with the strip
            chrome). The card also makes the "modulation active" green
            ring on individual rows pop against a neutral container. */}
        <View style={[styles.paramsPanel, isPortrait && styles.paramsPanelPortrait]}>
          <ScrollView nestedScrollEnabled style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ paddingBottom: 8 }}>
            <View style={styles.localParamsCard}>
              {/* numberOfLines + adjustsFontSizeToFit keep the header on one
                  line on the narrower 2nd strip instead of clipping (QA
                  round1 #22). */}
              <Text
                style={[styles.labelCaps, { marginBottom: 6, fontSize: 9, color: C.secondary }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >LOCAL PARAMS</Text>
              <MixerLocalParams channel={channel} onControlChange={onControlChange} />
            </View>
          </ScrollView>
        </View>
      </View>

      {/* ── Bottom action rows: full strip width ─────────────────────── */}
      <View style={styles.muteSoloRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, !channel.enabled && styles.toggleBtnMuted]}
          onPress={() => onMuteToggle(channel.id, !channel.enabled)}>
          <Text style={[styles.labelCaps, !channel.enabled && { color: '#FFF' }]}>Mute</Text>
        </TouchableOpacity>
        {/* SOLO (docs/39 §10) — server-authoritative. Tapping sends the WS
            setSolo (with a REST mirror); the engine's soloedChannelIds Set is
            the truth and the strip's lit/dimmed state reconciles from the
            broadcast. `isSolo` = this channel is in the soloed Set. We do NOT
            mutate sibling enabled/fader.
            C10 — solo state must not be color-only (accessibility): the
            ✓ glyph + accessibilityState carry the on/off state. */}
        <TouchableOpacity
          style={[styles.toggleBtn, isSolo && { backgroundColor: '#00a86b', borderColor: '#00a86b' }]}
          onPress={() => onSoloToggle(channel.id)}
          accessibilityRole="button"
          accessibilityLabel={isSolo ? 'Solo on' : 'Solo'}
          accessibilityState={{ selected: !!isSolo }}>
          <Text style={[styles.labelCaps, isSolo && { color: '#FFF' }]}>{isSolo ? 'Solo ✓' : 'Solo'}</Text>
        </TouchableOpacity>
        {/* FLASH / BUMP (docs/39 §10.7) — momentary "full while held" accent.
            HOLD the button → this channel slams to full output (capped by
            faderMax); RELEASE → snaps back to its parked level. Server-
            authoritative: onPressIn sends the WS bump (+ REST mirror + a hold-
            renew heartbeat so a dropped iPad can't pin it full); onPressOut
            releases. `isBumped` (held display) reconciles from the broadcast's
            bumpedChannelIds[]. A muted channel won't bump (engine enforces).
            44pt+ touch target via the 32pt button + 8pt hitSlop. Held state is
            not color-only: the ✓ glyph + accessibilityState carry it. */}
        {onBumpOn && (
          <Pressable
            style={[styles.toggleBtn, isBumped && styles.toggleBtnBump]}
            onPressIn={() => onBumpOn(channel.id)}
            onPressOut={() => onBumpOff(channel.id)}
            hitSlop={ICON_BTN_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={isBumped ? 'Bump held' : 'Bump (hold for full)'}
            accessibilityState={{ selected: !!isBumped }}>
            <Text style={[styles.labelCaps, isBumped && { color: '#1a1a1a' }]}>{isBumped ? 'Bump ✓' : 'Bump'}</Text>
          </Pressable>
        )}
        {/* SOLO-SAFE (docs/39 §10) — rig-config flag: protects this channel
            from being gated off by ANOTHER channel's solo (mission-critical
            exterior). When a solo is active the protected strip shows a teal
            "SAFE" lit state; fader-lock implies solo-safe so the toggle reads
            ON (and is non-destructive to toggle) when fader-locked. */}
        {onSoloSafeToggle && (
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              soloProtected && styles.toggleBtnSafe,
              soloActive && soloProtected && styles.toggleBtnSafeLit,
            ]}
            onPress={() => onSoloSafeToggle(channel.id, !soloSafe)}
            accessibilityRole="button"
            accessibilityLabel={soloProtected ? 'Solo-safe on' : 'Solo-safe'}
            accessibilityState={{ selected: soloProtected }}>
            <Text style={[styles.labelCaps, { fontSize: 9 }, soloProtected && { color: C.primary }]}>
              {soloProtected ? (faderLocked && !soloSafe ? 'SAFE (LOCK)' : 'SAFE ✓') : 'SAFE'}
            </Text>
          </TouchableOpacity>
        )}

        {/* View-selection picker. Three sections in the modal: ALL,
            GROUPS, and VIEW MASKS. Sections/fixtures are still routed
            via the REST API directly — they target by numeric id which
            isn't operator-friendly so we don't surface them in the
            picker. The VIEW MASKS section only appears when the model
            declared at least one named viewMask preset (via the inline
            `viewMasks` export). */}
        {!locked && onViewSelectionChange && (
          <>
            <TouchableOpacity
              style={[styles.toggleBtn, viewSel.type !== 'all' && { backgroundColor: C.primary, borderColor: C.primary }]}
              onPress={() => setShowViewPicker(true)}>
              <Text
                style={[styles.labelCaps, viewSel.type !== 'all' && { color: '#FFF' }, { fontSize: 9 }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                VIEW: {viewSelLabel}
              </Text>
            </TouchableOpacity>
            <Modal transparent visible={showViewPicker} animationType="fade" onRequestClose={() => setShowViewPicker(false)}>
              <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowViewPicker(false)}>
                <View style={styles.modalContent}>
                  <Text style={[styles.labelCaps, { marginBottom: 12 }]}>VIEW SELECTION</Text>
                  <ScrollView style={{ maxHeight: 420 }}>
                    {/* ── ALL ────────────────────────────────────── */}
                    <TouchableOpacity
                      style={[styles.modalRow, viewSel.type === 'all' && styles.modalRowActive]}
                      onPress={() => { onViewSelectionChange(channel.id, { type: 'all', target: null, invert: false }); setShowViewPicker(false); }}>
                      <Text style={[styles.valueReadout, viewSel.type === 'all' && { color: C.primary }]}>ALL PIXELS</Text>
                    </TouchableOpacity>

                    {/* ── GROUPS ─────────────────────────────────── */}
                    {(viewSelectionGroups || []).length > 0 && (
                      <Text style={[styles.labelCaps, { marginTop: 12, marginBottom: 4, paddingHorizontal: 16 }]}>GROUPS</Text>
                    )}
                    {(viewSelectionGroups || []).map((g: string) => {
                      const active = viewSel.type === 'group' && viewSel.target === g;
                      return (
                        <TouchableOpacity
                          key={`g_${g}`}
                          style={[styles.modalRow, active && styles.modalRowActive]}
                          onPress={() => { onViewSelectionChange(channel.id, { type: 'group', target: g, invert: false }); setShowViewPicker(false); }}>
                          <Text style={[styles.valueReadout, active && { color: C.primary }]}>GROUP · {g.toUpperCase()}</Text>
                        </TouchableOpacity>
                      );
                    })}

                    {/* ── VIEW MASKS ─────────────────────────────── */}
                    {(viewSelectionViewMasks || []).length > 0 && (
                      <Text style={[styles.labelCaps, { marginTop: 12, marginBottom: 4, paddingHorizontal: 16 }]}>VIEW MASKS</Text>
                    )}
                    {(viewSelectionViewMasks || []).map((vm: { name: string; bit: number; inUse: boolean }) => {
                      const active = viewSel.type === 'viewMask' && viewSel.target === vm.name;
                      // `inUse=false` presets are kept visible but
                      // dimmed — the operator may have just added the
                      // preset and not yet tagged any fixtures with the
                      // bit. Better to show "no pixels yet" than to
                      // hide the row entirely.
                      return (
                        <TouchableOpacity
                          key={`vm_${vm.name}`}
                          style={[styles.modalRow, active && styles.modalRowActive, !vm.inUse && { opacity: 0.5 }]}
                          onPress={() => { onViewSelectionChange(channel.id, { type: 'viewMask', target: vm.name, invert: false }); setShowViewPicker(false); }}>
                          <Text style={[styles.valueReadout, active && { color: C.primary }]}>MASK · {vm.name.toUpperCase()}{!vm.inUse ? ' (NO PIXELS)' : ''}</Text>
                        </TouchableOpacity>
                      );
                    })}

                    {(viewSelectionGroups || []).length === 0 && (viewSelectionViewMasks || []).length === 0 && (
                      <Text style={[styles.labelCaps, { textAlign: 'center', marginTop: 8 }]}>NO GROUPS OR VIEW MASKS IN MODEL</Text>
                    )}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>
          </>
        )}
      </View>

      {!isDeck && (
        <View style={styles.transitionBar}>
          <TouchableOpacity
            style={[styles.toggleBtn, styles.transitionBtn]}
            onPress={() => onTransition && onTransition(channel.id, transTimeMs / 1000, transMode, channel.mode)}>
            <Text style={[styles.labelCaps, { color: '#FFF' }]}>Transition</Text>
          </TouchableOpacity>
          <View style={[styles.transitionDetails, { flex: 1 }]}>
            <TouchableOpacity style={[styles.modeDropdown, { height: 32, justifyContent: 'center', minWidth: 88 }]} onPress={() => setShowTransPicker(true)}>
              <Text style={[styles.valueReadout, { color: C.primary, fontSize: 11 }]}>{transMode.replace('trans_', '').toUpperCase()} ▾</Text>
            </TouchableOpacity>
            {/* Touch-only duration picker: vertical wheel of preset
                durations, modeled after the iPhone alarm/clock time
                spinner. Selected preset sits in the highlighted center
                band; rows above/below dim. Snap-to-row with no
                free-form numeric entry — keyboard never opens.
                Operator brief 2026-05-27 round 2. */}
            <View style={{ flex: 1 }}>
              <TimerWheel
                presets={TRANSITION_DURATION_PRESETS_MS}
                value={transTimeMs}
                onChange={(ms) => {
                  setTransTimeMs(ms);
                  if (onTransitionSettingsChange) {
                    onTransitionSettingsChange(channel.id, { transitionTime: ms / 1000 });
                  }
                }}
                formatter={(ms) => (ms < 1000 ? `${ms}ms` : `${ms % 1000 === 0 ? ms / 1000 : (ms / 1000).toFixed(1)}s`)}
              />
            </View>
          </View>
        </View>
      )}
    </View>
  );
});
ChannelStrip.displayName = 'ChannelStrip';

// ── Main Mixer Screen ──────────────────────────────────────────────────
export default function MixerScreen() {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
  const [channels, setChannels] = useState<any[]>([]);
  const channelsRef = useRef<any[]>([]);
  // FLASH / BUMP renew timers (docs/39 §10.7) — per held channel. While a BUMP
  // button is held we re-send the WS `bump` every BUMP_RENEW_MS so the engine's
  // ~2 s disconnect lease never lapses under our finger; pressOut clears it.
  const bumpRenewTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Sync channels to ref
  useEffect(() => { channelsRef.current = channels; }, [channels]);

  const [master, setMaster] = useState(1.0);
  // Channel groups (gang-faders) + server-authoritative solo (docs/39 §10).
  // Both are reconciled DISPLAY-ONLY from the `mixer` broadcast's top-level
  // `mixGroups[]` + `soloedChannelIds[]` — the engine is the authority. The
  // soloed set is a Set<string> for O(1) per-strip membership checks; per-
  // channel `mixGroupId`/`soloSafe` ride on the channel objects themselves.
  const [mixGroups, setMixGroups] = useState<MixGroup[]>([]);
  const [soloedIds, setSoloedIds] = useState<Set<string>>(new Set());
  // FLASH / BUMP (round-2 #5, docs/39 §10.7) — momentary "full while held".
  // Reconciled DISPLAY-ONLY from the `mixer` broadcast's `bumpedChannelIds[]`
  // (the engine's transient Set is the authority). A Set<string> for O(1)
  // per-strip "held" lookup.
  const [bumpedIds, setBumpedIds] = useState<Set<string>>(new Set());
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  // Active model name (GET /status → activeModel), from the shared
  // engine-state cache. Null until the first /status probe lands /
  // while offline — we hide the chip then, matching the OFFLINE pill's
  // graceful-degrade behaviour.
  const activeModel = useActiveModel();
  const [blends, setBlends] = useState<string[]>([]);
  const [transitionsList, setTransitionsList] = useState<string[]>([]);
  // ─── Playlist library: parent-owned (May 2026 refactor) ───────────
  // Previously every PlaylistPanel fetched + cached + retried its own
  // copy of GET /playlists. Under load (3 channels added rapidly) the
  // 3rd panel's fetch could race the engine's directory-scan and
  // return [], leaving that one panel showing "no playlists yet".
  //
  // Now the mixer screen owns ONE list, fetches it once on mount, and
  // keeps it fresh from the engine's `playlistLibrary` WS event
  // (emitted on save/delete only — engine reads from its in-memory
  // list, not fs.readdirSync). Every ChannelStrip / PlaylistPanel
  // receives the list as a prop. No per-panel fetch, no per-panel
  // cache, no per-panel race.
  const [playlistLibrary, setPlaylistLibrary] = useState<string[]>([]);
  // Available view-selection groups (from /model/view-selection-options).
  // Used by the channel-strip view-selection picker. Sections /
  // fixtures stay backend-only (they target by numeric id which isn't
  // operator-friendly); view masks ship alongside groups now.
  const [viewSelectionGroups, setViewSelectionGroups] = useState<string[]>([]);
  // Named view-mask presets the model author declared (via an
  // inline `viewMasks` export).
  // The picker renders these in a "VIEW MASKS" section under groups;
  // the channel's viewSelection is then `{type:'viewMask', target:<name>}`.
  const [viewSelectionViewMasks, setViewSelectionViewMasks] = useState<{ name: string; bit: number; inUse: boolean }[]>([]);

  // Pre-May-2026 we owned a WebSocket per tab. The May 2026 topic
  // split moved that into singleton buses (utils/engineEvents +
  // utils/engineVizEvents + utils/engineParamsEvents), so this tab
  // just subscribes (via useEngineConnection) — no per-tab socket, no
  // double-parse of the mixer / vis firehose.
  // Per-channel inline playlist payload, populated synchronously from
  // the POST /mixer/channels response BEFORE the matching mixer WS event
  // mounts the PlaylistPanel. This is what makes "+ default" /
  // "+ from playlist" feel instant even on a laggy iPad wifi link —
  // the panel's first paint reads from this map and the entry list
  // shows up without a single follow-up GET. We also populate from
  // the WS `channelPlaylistData` event so a panel that re-mounts
  // later still hydrates instantly. Entries are GC'd when the engine
  // stops broadcasting the channel id. The Map is wrapped in a ref +
  // a version counter so the parent re-renders when contents change
  // but the strips that aren't affected don't.
  const inlinePlaylistRef = useRef<Map<string, PlaylistData>>(new Map());
  const [inlinePlaylistVersion, setInlinePlaylistVersion] = useState(0);
  const setInlinePlaylist = useCallback((channelId: string, pd: PlaylistData | null) => {
    const cur = inlinePlaylistRef.current.get(channelId) || null;
    if (!pd) {
      if (!cur) return;
      inlinePlaylistRef.current.delete(channelId);
    } else {
      if (cur && cur.name === pd.name && cur.entries.length === pd.entries.length) return;
      inlinePlaylistRef.current.set(channelId, pd);
    }
    setInlinePlaylistVersion(v => v + 1);
  }, []);
  // globalExports fetching moved to GlobalParams.tsx
  const throttleRef = useRef<{[key: string]: number}>({});
  // Per-channel pixel viz no longer lives at the screen level. Each
  // ChannelVizStrip (and the master strip) subscribes to the viz bus
  // itself and holds only its own frame, so a 5 Hz viz tick re-renders
  // one tiny <PixelStrip> instead of reconciling the whole strip list.
  // This is the perf fix that lets ChannelStrip's React.memo actually
  // hold — it no longer receives a per-tick `visData` prop.
  // Note: previous versions tracked an `transitionActiveRef` echo-lockout
  // and a `transitionGenRef` cancellation token here. Both are gone —
  // transitions are now driven server-side (see handleTransition), so the
  // client just trusts every incoming mixer broadcast and the engine
  // handles cancellation natively when a new triggerMixerTransition lands.
  //
  // Per-channel "I just wrote this locally" timestamps. When the user
  // drags a slider we stamp the channel; broadcasts arriving within
  // LOCAL_WRITE_HOLD_MS afterward keep the local fader value instead of
  // snapping back to the stale broadcast value. This protects the
  // operator's finger against in-flight 10 Hz progress broadcasts that
  // were emitted just before their drag cancelled the transition.
  // Agent review (May 2026) §5.
  const localFaderWriteRef = useRef<{[id: string]: number}>({});
  const LOCAL_WRITE_HOLD_MS = 400;
  // Canonical blend modes per channel — only updated by engine state or user mode changes.
  // Transitions never touch this, so it always reflects the "true" saved blend mode.
  const savedModesRef = useRef<{[id: string]: string}>({});
  // Engine's canonical base/deck channel id (e.g. ch_base_1778870620551). Used
  // by handleTransition to robustly identify the deck channel — string-prefix
  // matching against "ch_base" is the legacy fallback only.
  const baseChannelIdRef = useRef<string | null>(null);
  // Engine-reported max channel cap (mirror of mixer.maxChannels from
  // config.yaml). Surfaced in the Alert when the user hits the cap so they
  // see the real number, not a stale UI constant.
  const maxChannelsRef = useRef<number>(3);

  useFocusEffect(
    useCallback(() => {
      setMixerView('mixer');
    }, [])
  );

  // Control plane handler (consumed by useEngineConnection below): mixer
  // state, baseChannelId, maxChannels, in-flight add reconciliation. ALSO:
  // the playlist library list — engine emits `playlistLibrary` on every
  // save/delete (and on boot it seeds via the REST fetch below). Owning it
  // here means every ChannelStrip sees the same list via prop, not its own
  // fetch. (The viz plane is no longer subscribed at the screen level —
  // each ChannelVizStrip self-subscribes; see the perf note above.)
  const onControl = useCallback((msg: EngineMessage) => {
    {
      if (msg.type === 'playlistLibrary' && Array.isArray(msg.names)) {
        setPlaylistLibrary(msg.names as string[]);
      }
      // Capture inline playlist payloads BEFORE the matching mixer event
      // arrives. Engine guarantees `channelPlaylistData` lands first
      // (see broadcastChannelPlaylistData in api_server.js), so by the
      // time PlaylistPanel mounts off the mixer event below, the entry
      // list is already waiting in `inlinePlaylistRef`. Fixes the iPad
      // "+ default" / "+ from playlist" race where refresh() lost to
      // wifi latency on slow links.
      if (msg.type === 'channelPlaylistData' && msg.channelId && msg.playlistData && (msg.playlistData as PlaylistData).name) {
        setInlinePlaylist(msg.channelId as string, msg.playlistData as PlaylistData);
      }
      if (msg.type === 'mixer') {
        setMaster(msg.master as number);
        // Groups + solo (docs/39 §10) — reconcile DISPLAY state from the
        // authoritative broadcast on EVERY mixer event. The engine owns both;
        // these arrays survive a reconnect because they live server-side.
        if (Array.isArray(msg.mixGroups)) setMixGroups(msg.mixGroups as MixGroup[]);
        if (Array.isArray(msg.soloedChannelIds)) {
          setSoloedIds(new Set(msg.soloedChannelIds as string[]));
        }
        // FLASH / BUMP (docs/39 §10.7) — reconcile the "held" display from the
        // authoritative broadcast. The engine auto-releases a bump on the
        // holder's disconnect (lease / ws-close), so this also catches another
        // operator's release + our own lease lapse.
        if (Array.isArray(msg.bumpedChannelIds)) {
          setBumpedIds(new Set(msg.bumpedChannelIds as string[]));
        }
        if (msg.baseChannelId) baseChannelIdRef.current = msg.baseChannelId as string;
        if (typeof msg.maxChannels === 'number') maxChannelsRef.current = msg.maxChannels;
        // Always trust the engine: it owns transitions, mute/solo
        // bookkeeping, and saved state. The 10 Hz progress broadcasts
        // that arrive during a server-side transition animate the
        // slider UI smoothly.
        //
        // EXCEPTION: a channel the user just dragged (within
        // LOCAL_WRITE_HOLD_MS) keeps its local fader value. This
        // protects the slider from snapping back to a stale in-flight
        // broadcast that was emitted milliseconds before the drag
        // landed on the engine. The rest of the broadcast (enabled,
        // mode, exports, …) still applies normally.
        const incoming = (msg.channels as any[]) || [];
        const now = Date.now();
        setChannels(prev => {
          const prevById: { [id: string]: any } = {};
          for (const c of prev) prevById[c.id] = c;
          return incoming.map((ch: any) => {
            const localTs = localFaderWriteRef.current[ch.id] || 0;
            if (now - localTs < LOCAL_WRITE_HOLD_MS && prevById[ch.id]) {
              return { ...ch, fader: prevById[ch.id].fader };
            }
            return ch;
          });
        });
        for (const ch of incoming) {
          if (ch.id && ch.mode && !ch.mode.startsWith('trans_')) savedModesRef.current[ch.id] = ch.mode;
        }
        // GC inlinePlaylistRef: drop entries for channels the engine
        // no longer reports. Keeps the map bounded across long
        // sessions of add/remove churn.
        if (inlinePlaylistRef.current.size > 0) {
          const liveIds = new Set<string>();
          for (const ch of incoming) if (ch && ch.id) liveIds.add(ch.id);
          let dropped = false;
          for (const id of Array.from(inlinePlaylistRef.current.keys())) {
            if (!liveIds.has(id)) {
              inlinePlaylistRef.current.delete(id);
              dropped = true;
            }
          }
          if (dropped) setInlinePlaylistVersion(v => v + 1);
        }
        // ── WS-driven add button clear ──────────────────────────
        // If we're waiting on an in-flight add, check if the
        // broadcast contains an id we DIDN'T know about when
        // the user tapped. That id IS the newly-added channel
        // — the engine has confirmed the add, so the "ADDING…"
        // label can flip back to "+ DEFAULT" immediately
        // (typically before the HTTP POST response even
        // finishes parsing). This is what makes the button
        // feel instant under load.
        const pending = pendingAddRef.current;
        if (pending) {
          let newlyAdded = false;
          for (const ch of incoming) {
            if (ch.id && !pending.knownIds.has(ch.id)) {
              newlyAdded = true;
              break;
            }
          }
          if (newlyAdded) {
            pendingAddRef.current = null;
            addBusyRef.current = false;
            setAddBusy(false);
          }
        }
      } else if (msg.type === 'channelFaderRejected' || msg.type === 'channelModeRejected') {
        // Codex P0 — fail loud, don't drop. The engine rejected a WS
        // fader/mode write (non-finite fader, invalid blend mode) and
        // does NOT broadcast a fresh mixer state on that path, so our
        // optimistic local change would silently stick on a value the
        // engine never accepted. Re-sync the affected channel from the
        // authoritative mixer state. We clear the local-write hold first
        // so the re-fetch isn't suppressed by the fader drag guard.
        const channelId = msg.channelId as string | undefined;
        if (channelId) {
          delete localFaderWriteRef.current[channelId];
          // Throttle the log so a burst of rejections (e.g. a wedged
          // client spamming NaN) can't flood the console.
          const now = Date.now();
          const key = `reject_${channelId}`;
          if (now - (throttleRef.current[key] || 0) > 1000) {
            throttleRef.current[key] = now;
            const bad = msg.type === 'channelFaderRejected' ? msg.fader : msg.mode;
            console.error(
              `[Mixer] Engine rejected ${msg.type === 'channelFaderRejected' ? 'fader' : 'mode'} write on ${channelId} ` +
              `(value=${JSON.stringify(bad)}, reason=${JSON.stringify(msg.reason)}); reverting to engine truth.`,
            );
          }
          // Pull authoritative state and overwrite the rejected channel's
          // optimistic value. Other channels are left as-is.
          fetchMixerState().then((res) => {
            if (res.ok && res.data && Array.isArray(res.data.channels)) {
              const truth = res.data.channels.find((c: any) => c.id === channelId);
              if (truth) {
                setChannels(chs => chs.map(c => c.id === channelId ? { ...c, ...truth } : c));
              }
            }
          }).catch((err) => {
            console.error('[Mixer] Re-sync after rejection failed:', err);
          });
        }
      }
    }
  }, []);

  // Connection state pill (mirror status → setIsConnected). The shared
  // hook funnels BOTH the boot-time testConnection probe and live
  // subscribeStatus pushes through here, matching the prior behavior
  // where loadAll() and the status subscription both wrote isConnected.
  const onStatus = useCallback((s: BusStatus) => {
    setIsConnected(!!s.connected);
  }, []);

  const seed = useCallback(async (_base: string, connected: boolean) => {
    if (!connected) return;

    // Pre-May-2026 this was a 5-fetch serial waterfall — each request
    // waited on the previous, so the mixer's first paint after a tab
    // switch took ~5× the slowest hop. The fetches are independent
    // (different endpoints, no shared state), so Promise.all collapses
    // the wall-clock cost to max(hop_i) instead of sum(hop_i).
    const [bRes, tRes, vsRes, pLib, mRes] = await Promise.all([
      fetchChannelBlends(),
      fetchTransitions(),
      // View-selection options. Failure is non-fatal: the strip
      // falls back to a disabled picker that just shows "ALL" if the
      // engine can't enumerate. We pull both groups and named view-mask
      // presets — sections / fixtures stay backend-only (operator-
      // unfriendly numeric ids).
      fetchViewSelectionOptions(),
      // Parent-owned playlist library. The engine returns the current
      // names from its in-memory cache (cheap, deterministic). After
      // this, the library is kept in sync via the WS `playlistLibrary`
      // event the engine emits on every save/delete.
      fetchPlaylists(),
      fetchMixerState(),
    ]);

    if (bRes.ok && bRes.data) setBlends(bRes.data);
    if (tRes.ok && tRes.data) setTransitionsList(tRes.data);
    if (vsRes.ok && vsRes.data) {
      setViewSelectionGroups(vsRes.data.groups || []);
      setViewSelectionViewMasks(vsRes.data.viewMasks || []);
    }
    if (pLib.ok && pLib.data) setPlaylistLibrary(pLib.data);

    if (mRes.ok && mRes.data) {
      setMaster(mRes.data.master);
      // Seed groups + solo display state (docs/39 §10). GET /mixer carries the
      // same top-level mixGroups[] + soloedChannelIds[] as the WS broadcast.
      if (Array.isArray((mRes.data as any).mixGroups)) setMixGroups((mRes.data as any).mixGroups as MixGroup[]);
      if (Array.isArray((mRes.data as any).soloedChannelIds)) {
        setSoloedIds(new Set((mRes.data as any).soloedChannelIds as string[]));
      }
      // FLASH / BUMP seed (docs/39 §10.7). GET /mixer carries bumpedChannelIds[]
      // (transient — usually empty on a fresh connect, but seed it anyway so a
      // bump held by ANOTHER operator shows as held on this iPad immediately).
      if (Array.isArray((mRes.data as any).bumpedChannelIds)) {
        setBumpedIds(new Set((mRes.data as any).bumpedChannelIds as string[]));
      }
      if (mRes.data.baseChannelId) baseChannelIdRef.current = mRes.data.baseChannelId;
      if (typeof mRes.data.maxChannels === 'number') maxChannelsRef.current = mRes.data.maxChannels;
      setChannels(mRes.data.channels || []);
      for (const ch of (mRes.data.channels || [])) {
        if (ch.id && ch.mode && !ch.mode.startsWith('trans_')) savedModesRef.current[ch.id] = ch.mode;
      }
    }

  }, []);

  // Boot + subscription lifecycle is shared with the deck via
  // useEngineConnection: it resolves the API base, probes the connection
  // (→ onStatus), nudges the singleton WS buses to reconnect only when
  // they're DOWN (a forced reconnect on every focus would tear a live
  // socket apart and flash "Engine Offline"), re-runs `seed` on AppState
  // 'active', and owns the control/status subscribe + teardown. The viz
  // bus is intentionally NOT subscribed here — ChannelVizStrip does that
  // per-strip so a viz tick never reconciles this screen.
  useEngineConnection({ seed, onControl, onStatus });

  // ── Handlers ───────────────────────────────────────────────────────
  // (Pattern selection is handled by the per-channel PlaylistPanel, which talks
  //  to /mixer/channels/:id/playlist/entry directly. No more "swap pattern"
  //  button — every pattern lives in a playlist entry.)

  // All ChannelStrip-bound handlers are useCallback'd with empty deps
  // so React.memo() on ChannelStrip can actually short-circuit on a
  // MixerScreen re-render. Pre-fix (May 2026) every MixerScreen render
  // created fresh handler identities, bypassing memo and reconciling
  // every strip along with its CPC sliders, PixelStrip, and playlist
  // panel. That was a large chunk of the "mixer feels laggy with 3
  // channels" operator complaint. The other half of that complaint was
  // the 5 Hz screen-level viz re-render, now eliminated — viz lives in
  // the self-subscribing ChannelVizStrip, so a viz frame never reaches
  // this screen and the memo holds. Handler bodies reference only refs +
  // module-level event buses + the setState callbacks (which React
  // guarantees are stable), so the empty dep array is correct.
  const handleFaderChange = useCallback(async (channelId: string, level: number) => {
    // Stamp BEFORE the WS send so any racing broadcast that arrives
    // during the round-trip is held off the slider's last finger position.
    localFaderWriteRef.current[channelId] = Date.now();
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, fader: level } : c));
    // The engine's setChannelFader handler cancels any in-flight
    // transition for this channel automatically (see api_server.js),
    // so dragging a slider during a transition stops that channel's
    // server-side animation cleanly. engineEvents.send returns false
    // when the WS isn't OPEN (queued for next open); we fall back to
    // the throttled REST update below so the slider always lands.
    if (!engineEvents.send({ type: 'setChannelFader', channelId, fader: level })) {
      const now = Date.now();
      const key = `fader_${channelId}`;
      if (now - (throttleRef.current[key] || 0) > 100) {
        throttleRef.current[key] = now;
        // REST fallback for a fader write when the WS is down. Codex
        // P0 — no silent swallow: log the failure. We don't alert here
        // (fader drags fire continuously and the next mixer broadcast
        // re-syncs the slider), but the operator/devtools must see it.
        updateMixerChannel(channelId, { fader: level }).catch((err) => {
          console.error('[Mixer] Fader REST fallback failed:', err);
        });
      }
    }
  }, []);

  const handleMuteToggle = useCallback(async (channelId: string, enabled: boolean) => {
    // Mute remains interactive at all times — the operator must always be
    // able to drop a channel even during a transition. "Transitions take
    // precedence over mute/solo" is enforced at *transition start* time
    // (force-enable + clear solo); after that, the operator's manual
    // mute/solo input wins. Solo is now server-authoritative (docs/39 §10) —
    // un-muting a channel no longer needs to tear down any client-side solo
    // bookkeeping (there is none); the engine's precedence (explicit mute wins
    // over solo) handles the interaction.
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, enabled } : c));
    engineEvents.send({ type: 'setChannelEnabled', channelId, enabled });
    // Codex P0 — no silent swallow. Mute is operator-critical (drop a
    // channel mid-show), so a rejected REST mirror is surfaced. The WS
    // send above is the primary path; this PATCH is the durability
    // mirror, and a failure here means the mute may not persist.
    updateMixerChannel(channelId, { enabled }).catch((err) => {
      console.error('[Mixer] Mute PATCH failed:', err);
      Alert.alert('Mute may not have applied', `Could not confirm the mute change. ${err?.message || ''}`.trim());
    });
  }, []);

  // Solo (docs/39 §10) — SERVER-AUTHORITATIVE. The engine's
  // PatternMixer.soloedChannelIds Set is the SOLE source of truth. The old
  // client-side implementation (soloRef + preSoloStateRef destructive
  // save/restore that mutated every sibling's enabled+fader) is GONE — it was
  // structurally wrong (it clobbered parked levels and couldn't survive a
  // reconnect). Now:
  //   - Tapping SOLO toggles this channel in the engine's Set. We send the WS
  //     setSolo/clearSolo (low-latency mirror, same dual-path as mute) AND a
  //     REST mirror for durability. `additive:false` REPLACES the set so a
  //     single tap solos exactly one channel (the dominant operator gesture);
  //     tapping the already-soloed channel clears it.
  //   - We optimistically flip the local soloedIds Set for instant button
  //     feedback, but the engine broadcast (soloedChannelIds[]) is the truth
  //     and reconciles it. We NEVER mutate sibling enabled/fader — the strip
  //     dim/active state is purely DISPLAY, derived from soloedIds + soloSafe
  //     + faderLocked at render time.
  //   - fader-lock IMPLIES solo-safe on the engine, so a locked layer stays
  //     lit through a solo automatically (no client-side skip needed).
  const handleSoloToggle = useCallback(async (channelId: string) => {
    const alreadySolo = soloedIds.has(channelId);
    if (alreadySolo) {
      // Clear this channel's solo. Single-solo is the common case, so a tap on
      // the soloed channel clears it entirely; if multiple were additively
      // soloed this still un-solos just the tapped one (DELETE /mixer/solo/:id).
      setSoloedIds(prev => {
        const next = new Set(prev);
        next.delete(channelId);
        return next;
      });
      engineEvents.send({ type: 'clearSolo', channelId });
      // REST durability mirror (DELETE /mixer/solo/:channelId). Codex P0 —
      // fail loud: a rejected clear is logged (the next broadcast reconciles
      // the lit state regardless); an un-solo is less critical than a solo-on
      // so we don't Alert on a transport hiccup.
      deleteSolo(channelId).then((res) => {
        if (!res.ok) console.error(`[Mixer] Un-solo REST mirror rejected for ${channelId}:`, res.error);
      }).catch((err) => console.error(`[Mixer] Un-solo REST mirror failed for ${channelId}:`, err));
    } else {
      // Replace the set with just this channel (non-additive single solo).
      setSoloedIds(new Set([channelId]));
      engineEvents.send({ type: 'setSolo', channelId, additive: false });
      postSolo(channelId, false).then((res) => {
        if (!res.ok) {
          console.error(`[Mixer] Solo REST mirror rejected for ${channelId}:`, res.error);
          Alert.alert('Solo not applied', `The engine rejected this solo. ${res.error || ''}`.trim());
        }
      }).catch((err) => {
        console.error(`[Mixer] Solo REST mirror failed for ${channelId}:`, err);
      });
    }
  }, [soloedIds]);

  // Clear ALL solos (header button). Server-authoritative.
  const handleClearAllSolo = useCallback(async () => {
    setSoloedIds(new Set());
    engineEvents.send({ type: 'clearSolo' });
    const res = await clearAllSolo();
    if (!res.ok) {
      console.error('[Mixer] Clear-all-solo REST mirror rejected:', res.error);
    }
  }, []);

  // Solo-safe toggle (docs/39 §10) — rig-config flag protecting a channel from
  // being gated off by ANOTHER channel's solo. Server-authoritative via PATCH
  // {soloSafe}. Optimistic local flip + reconcile from the next broadcast;
  // fail-loud revert + Alert on rejection (same shape as faderMax/color).
  const handleSoloSafeToggle = useCallback(async (channelId: string, soloSafe: boolean) => {
    const prev = channelsRef.current.find(c => c.id === channelId)?.soloSafe ?? false;
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, soloSafe } : c));
    const res = await setChannelSoloSafe(channelId, soloSafe);
    if (!res.ok) {
      console.error(`[Mixer] Solo-safe toggle rejected for ${channelId}:`, res.error);
      setChannels(chs => chs.map(c => c.id === channelId ? { ...c, soloSafe: prev } : c));
      Alert.alert('Solo-safe not applied', `The engine rejected this change. ${res.error || ''}`.trim());
    }
  }, []);

  // FLASH / BUMP (round-2 #5, docs/39 §10.7) — SERVER-AUTHORITATIVE momentary
  // "full while held". The engine's `_bumpedChannelIds` Set is the SOLE truth;
  // the strip "held" state is DISPLAY-ONLY, reconciled from the broadcast's
  // `bumpedChannelIds[]`. pressIn → bump on; pressOut → bump off.
  //
  //   - WS `{ type:'bump'|'unbump', channelId }` is the low-latency path (same
  //     dual-path as solo/mute). On press we also fire a REST mirror for
  //     durability + as the lease seed.
  //   - HOLD RENEW: the engine auto-releases a bump if its ~2 s lease lapses
  //     (so a dropped iPad can't pin a channel full forever). We keep a held
  //     bump alive by re-sending the WS `bump` every BUMP_RENEW_MS — well
  //     inside the lease window — until pressOut.
  //   - Optimistic local flip for instant button feedback; the broadcast
  //     reconciles the truth. We never mutate the channel's fader.
  const BUMP_RENEW_MS = 700;

  const handleBumpOn = useCallback((channelId: string) => {
    // Optimistic "held" feedback.
    setBumpedIds(prev => {
      if (prev.has(channelId)) return prev;
      const next = new Set(prev);
      next.add(channelId);
      return next;
    });
    // Low-latency WS bump (also renews the lease on the engine).
    engineEvents.send({ type: 'bump', channelId });
    // REST durability mirror. Fail-loud: a rejected bump (404 unknown / 400
    // deck) is logged + Alerted — bump is an accent, but a silent failure
    // would leave the button "held" with no effect.
    postBump(channelId, true).then((res) => {
      if (!res.ok) {
        console.error(`[Mixer] Bump REST mirror rejected for ${channelId}:`, res.error);
        // Roll back the optimistic flip — the engine never accepted it.
        setBumpedIds(prev => { const n = new Set(prev); n.delete(channelId); return n; });
        Alert.alert('Bump not applied', `The engine rejected this bump. ${res.error || ''}`.trim());
      }
    }).catch((err) => console.error(`[Mixer] Bump REST mirror failed for ${channelId}:`, err));
    // Start the hold-renew heartbeat (idempotent — replace any prior timer).
    const timers = bumpRenewTimersRef.current;
    const existing = timers.get(channelId);
    if (existing) clearInterval(existing);
    timers.set(channelId, setInterval(() => {
      engineEvents.send({ type: 'bump', channelId });
    }, BUMP_RENEW_MS));
  }, []);

  const handleBumpOff = useCallback((channelId: string) => {
    // Stop the renew heartbeat first so we don't re-bump after releasing.
    const timers = bumpRenewTimersRef.current;
    const existing = timers.get(channelId);
    if (existing) { clearInterval(existing); timers.delete(channelId); }
    setBumpedIds(prev => { const n = new Set(prev); n.delete(channelId); return n; });
    engineEvents.send({ type: 'unbump', channelId });
    postBump(channelId, false).then((res) => {
      if (!res.ok) console.error(`[Mixer] Unbump REST mirror rejected for ${channelId}:`, res.error);
    }).catch((err) => console.error(`[Mixer] Unbump REST mirror failed for ${channelId}:`, err));
  }, []);

  // Safety: on unmount, clear every renew heartbeat AND release any held bump
  // so navigating away from the tab can't pin a channel full (the engine's
  // lease/ws-close would catch it eventually, but release eagerly).
  useEffect(() => {
    const timers = bumpRenewTimersRef.current;
    return () => {
      for (const [channelId, t] of timers) {
        clearInterval(t);
        engineEvents.send({ type: 'unbump', channelId });
      }
      timers.clear();
    };
  }, []);

  const handleModeChange = useCallback(async (channelId: string, newMode: string) => {
    // Capture the prior mode so we can revert if the engine rejects the
    // blend-mode change. The canonical saved mode is the source of truth.
    const prevMode = savedModesRef.current[channelId]
      ?? channelsRef.current.find(c => c.id === channelId)?.mode;
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, mode: newMode } : c));
    // Update canonical modes — this is a user-initiated change
    savedModesRef.current[channelId] = newMode;
    // Codex P0 — fail loud. Blend MODE is operator-critical (it changes
    // how a channel composites into the live mix), so a rejected change
    // is reverted AND surfaced with an Alert, matching the
    // view-selection handler's pattern.
    const res = await updateMixerChannel(channelId, { mode: newMode });
    if (!res.ok) {
      console.error(`[Mixer] Blend-mode change rejected for ${channelId}:`, res.error);
      if (prevMode != null) {
        savedModesRef.current[channelId] = prevMode;
        setChannels(chs => chs.map(c => c.id === channelId ? { ...c, mode: prevMode } : c));
      }
      Alert.alert(
        'Blend mode not applied',
        `The engine rejected this blend mode. ${res.error || ''} The channel kept its previous mode.`.trim(),
      );
    }
  }, []);

  // Unlock-dirty prompt. Engaged when the user toggles lock OFF on a channel
  // whose in-memory params differ from the saved playlist entry. The user
  // must decide whether to discard the live edits or capture them into the
  // playlist before the lock actually releases.
  const [unlockPrompt, setUnlockPrompt] = useState<{
    channelId: string;
    channelName: string;
    pending: boolean;
  } | null>(null);

  const handleLockToggle = useCallback(async (channelId: string, locked: boolean) => {
    // Locking is always immediate — freezing playlist saves is a safe op.
    if (locked) {
      setChannels(chs => chs.map(c => c.id === channelId ? { ...c, locked: true } : c));
      // Codex P0 — fail loud. Lock is operator-critical (it freezes
      // playlist saves; a silently-failed lock means edits the operator
      // believes are protected can still overwrite the saved entry).
      // Revert the toggle and surface an Alert on rejection.
      const res = await updateMixerChannel(channelId, { locked: true });
      if (!res.ok) {
        console.error(`[Mixer] Lock engage rejected for ${channelId}:`, res.error);
        setChannels(chs => chs.map(c => c.id === channelId ? { ...c, locked: false } : c));
        Alert.alert(
          'Lock not applied',
          `The engine rejected locking this channel. ${res.error || ''} The channel is still unlocked.`.trim(),
        );
      }
      return;
    }
    // Unlocking: if the channel accumulated edits while locked, intercept
    // and let the operator pick save-or-discard before we actually release
    // the lock. The engine's `dirty` flag rides in on every `mixer` WS
    // broadcast (see serializeMixerState).
    const ch = channelsRef.current.find(c => c.id === channelId);
    if (ch?.dirty) {
      setUnlockPrompt({ channelId, channelName: ch.name || ch.id, pending: false });
      return;
    }
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, locked: false } : c));
    // Codex P0 — fail loud. Releasing a lock is operator-critical for
    // the same reason engaging one is: a silently-failed unlock leaves
    // the operator believing edits will save when the engine still has
    // the channel frozen. Revert + Alert on rejection.
    const res = await updateMixerChannel(channelId, { locked: false });
    if (!res.ok) {
      console.error(`[Mixer] Lock release rejected for ${channelId}:`, res.error);
      setChannels(chs => chs.map(c => c.id === channelId ? { ...c, locked: true } : c));
      Alert.alert(
        'Unlock not applied',
        `The engine rejected unlocking this channel. ${res.error || ''} The channel is still locked.`.trim(),
      );
    }
  }, []);

  // Resolve the unlock-dirty prompt. `mode` is the user's choice:
  //   - 'save'    → capture live params into the playlist entry, then unlock
  //   - 'discard' → snap params back to the saved entry defaults, then unlock
  //   - 'cancel'  → close the modal, leave the channel locked
  const resolveUnlockPrompt = useCallback(async (mode: 'save' | 'discard' | 'cancel') => {
    const prompt = unlockPrompt;
    if (!prompt) return;
    if (mode === 'cancel') {
      setUnlockPrompt(null);
      return;
    }
    setUnlockPrompt({ ...prompt, pending: true });
    const op = mode === 'save'
      ? captureMixerChannelDefaults(prompt.channelId)
      : discardMixerChannelDefaults(prompt.channelId);
    const res = await op;
    if (!res.ok) {
      // Keep the channel locked and surface the failure. The user can retry.
      setUnlockPrompt({ ...prompt, pending: false });
      console.warn('[Mixer] Unlock-dirty resolve failed:', res.error);
      return;
    }
    // Persisted (or reverted) cleanly — now drop the lock.
    setChannels(chs => chs.map(c => c.id === prompt.channelId ? { ...c, locked: false, dirty: false } : c));
    // Codex P0 — fail loud. The save/discard above already committed, but
    // the lock release itself can still be rejected; surface it and keep
    // the channel locked + the prompt open so the operator can retry the
    // unlock rather than silently believing the channel is editable.
    const unlockRes = await updateMixerChannel(prompt.channelId, { locked: false });
    if (!unlockRes.ok) {
      console.error(`[Mixer] Unlock release rejected for ${prompt.channelId}:`, unlockRes.error);
      setChannels(chs => chs.map(c => c.id === prompt.channelId ? { ...c, locked: true } : c));
      setUnlockPrompt({ ...prompt, pending: false });
      Alert.alert(
        'Unlock not applied',
        `Edits were saved, but the engine rejected releasing the lock. ${unlockRes.error || ''} The channel is still locked.`.trim(),
      );
      return;
    }
    setUnlockPrompt(null);
  }, [unlockPrompt]);

  // Fader-lock toggle (slot 5). Independent of the playlist lock
  // (`handleLockToggle` above). The engine is the source of truth —
  // we optimistically update local state and PATCH; the next mixer
  // broadcast confirms. No dirty-prompt machinery because faderLocked
  // doesn't gate playlist edits.
  const handleFaderLockToggle = useCallback(async (channelId: string, faderLocked: boolean) => {
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, faderLocked } : c));
    // Codex P0 — no silent swallow. Fader-lock is less critical than the
    // playlist lock (it only gates fader drags, not saves), so a rejected
    // toggle reverts the optimistic flip and logs — no Alert spam for a
    // quick toggle.
    const res = await updateMixerChannel(channelId, { faderLocked });
    if (!res.ok) {
      console.error(`[Mixer] Fader-lock toggle rejected for ${channelId}:`, res.error);
      setChannels(chs => chs.map(c => c.id === channelId ? { ...c, faderLocked: !faderLocked } : c));
    }
  }, []);

  // Per-channel color metadata (docs/39 §8.4). Pure operator-facing accent
  // (no render effect). Same optimistic + reconcile + fail-loud shape. A
  // null color clears the accent; the engine requires a string or null.
  const handleColorChange = useCallback(async (channelId: string, color: string | null) => {
    const prev = channelsRef.current.find(c => c.id === channelId)?.color ?? null;
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, color } : c));
    const res = await setChannelColor(channelId, color);
    if (!res.ok) {
      console.error(`[Mixer] color change rejected for ${channelId}:`, res.error);
      setChannels(chs => chs.map(c => c.id === channelId ? { ...c, color: prev } : c));
      Alert.alert(
        'Color not applied',
        `The engine rejected this color. ${res.error || ''} The channel kept its previous color.`.trim(),
      );
    }
  }, []);

  // Per-channel hue (docs/39 §F-hue). A luminance-preserving RGB-only hue
  // rotation applied PRE-blend on this channel's own contribution; W/A/UV are
  // never touched (mission-critical exterior whites). Same optimistic + PATCH
  // + reconcile-from-broadcast + fail-loud revert shape as faderMax/color. The
  // engine's validateHue normalizes degrees into [0,360); a non-finite ⇒ 400.
  const handleHueChange = useCallback(async (channelId: string, hue: number) => {
    const prev = channelsRef.current.find(c => c.id === channelId)?.hue;
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, hue } : c));
    const res = await setChannelHue(channelId, hue);
    if (!res.ok) {
      console.error(`[Mixer] hue change rejected for ${channelId}:`, res.error);
      // Revert to the prior hue; the next mixer broadcast re-syncs too.
      setChannels(chs => chs.map(c => c.id === channelId ? { ...c, hue: prev ?? 0 } : c));
      Alert.alert(
        'Hue not applied',
        `The engine rejected this hue. ${res.error || ''} The channel kept its previous hue.`.trim(),
      );
    }
  }, []);

  const handleControlChange = useCallback((channelId: string, controlId: number, val: number) => {
    setChannels(chs => chs.map(c => {
      if (c.id !== channelId) return c;
      return { ...c, exports: (c.exports || []).map((e: any) => e.id === controlId ? { ...e, v0: val } : e) };
    }));
    if (!engineEvents.send({ type: 'setChannelControl', channelId, id: controlId, v0: val, v1: 0, v2: 0 })) {
      setMixerChannelControl(channelId, controlId, val, 0, 0);
    }
  }, []);

  // Adding a channel is playlist-first. The "+ ADD CHANNEL" button opens the
  // picker so the user can spin up a new layer with one tap. The first row is
  // always "+ DEFAULT" for the fastest possible add.
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [addPickerPlaylists, setAddPickerPlaylists] = useState<string[]>([]);
  // ── "ADDING…" button state machine ───────────────────────────────────
  //
  // The previous design awaited the HTTP POST response before
  // clearing addBusy. That was correct in theory (try/finally always
  // runs) but visually broken: under heavy WS load the iPad's JS
  // thread is starved processing 10 Hz mixer + vis broadcasts, so
  // the fetch promise's continuation can sit in the microtask queue
  // for hundreds of ms behind those broadcasts. The button felt
  // stuck even though the engine had already created the channel.
  //
  // The fix: decouple the button state from HTTP timing. The button
  // is cleared by whichever signal arrives first —
  //
  //   A. The WS `mixer` broadcast that lists the NEW channel id
  //      (~10ms after the engine's POST handler runs; sometimes
  //      arrives BEFORE the HTTP response is fully parsed).
  //   B. The HTTP response itself (POST result, OK or error).
  //
  // Both paths clear the same single source of truth. The button is
  // therefore guaranteed to be released as soon as the engine
  // confirms the channel exists, regardless of which transport the
  // confirmation arrives on. No watchdog needed.
  //
  // pendingAddRef holds the ids we knew about at the moment the
  // user tapped — when a mixer broadcast arrives with a channel
  // whose id is NOT in that set, we know the add succeeded. We use
  // an id-set (not a counter) so concurrent remove+add operations
  // can't confuse the matcher.
  const addBusyRef = useRef(false);
  const [addBusy, setAddBusy] = useState(false);
  const pendingAddRef = useRef<{ knownIds: Set<string> } | null>(null);
  const clearAddBusy = useCallback(() => {
    pendingAddRef.current = null;
    addBusyRef.current = false;
    setAddBusy(false);
  }, []);

  // Open the "from playlist" picker instantly using the parent-owned
  // playlistLibrary state (kept fresh by engineEvents.playlistLibrary
  // WS events — see loadAll + the WS subscriber). Operator review
  // May 2026 #14: this used to await fetchPlaylists() before showing
  // the modal AND it flipped addBusy=true while waiting, which made
  // the button feel broken under load ("almost not showing up at
  // all"). The cached list is by definition up-to-date because every
  // save/delete in the engine emits a `playlistLibrary` event the
  // mixer screen already subscribes to. Worst case (engine boot
  // race), we fall back to ['default'].
  const openAddChannelPicker = () => {
    if (addBusyRef.current) return;
    const list = playlistLibrary && playlistLibrary.length > 0
      ? playlistLibrary
      : ['default'];
    setAddPickerPlaylists(list);
    setAddPickerOpen(true);
  };

  const handleAddChannelWithPlaylist = (playlistName: string) => {
    if (addBusyRef.current) return;
    addBusyRef.current = true;
    setAddBusy(true);
    setAddPickerOpen(false);

    // Snapshot the channel ids we know about right NOW. The WS
    // handler in connectWebSocket() above will spot the newly-added
    // id when the engine's mixer broadcast lands and call
    // clearAddBusy().
    pendingAddRef.current = {
      knownIds: new Set(channelsRef.current.map((c) => c.id as string)),
    };

    // Fire the POST as fire-and-forget. The button is decoupled
    // from this promise's resolution — clearAddBusy() will fire
    // from the WS handler the moment the engine confirms the add,
    // typically faster than the HTTP response parses on the iPad.
    // We still observe the response so we can show an alert if the
    // engine rejected the add (over capacity, playlist missing,
    // etc.); that path also calls clearAddBusy() defensively.
    //
    // Both transports use fetchWithTimeout (8s AbortController) /
    // the WS connection's own keepalive, so there is NO codepath
    // where addBusy can remain set indefinitely. Worst case (WS
    // dropped a frame AND HTTP timed out): clearAddBusy fires from
    // the timeout-induced rejection. No watchdog needed.
    void addMixerChannel({
      playlist: playlistName,
      name: playlistName === 'default' ? 'New Layer' : playlistName,
      mode: 'blend_screen',
      fader: 1.0,
    }).then((result) => {
      if (!result.ok) {
        clearAddBusy();
        Alert.alert(
          'Add channel failed',
          result.error || 'Engine did not accept the new channel. Check that the engine is running and reachable, then try again.',
        );
      } else {
        // Idempotent clear — the WS handler probably already
        // cleared addBusy by the time this HTTP continuation runs,
        // but if not, this is the second guaranteed clear path.
        clearAddBusy();
        // Synchronously stash the inline playlist payload for the
        // newly-minted channel id. Usually the WS channelPlaylistData
        // event lands first, but on a slow iPad the HTTP path can win.
        // Either way the new PlaylistPanel mounting off the mixer
        // event reads this map and gets entries on first paint.
        const pd = (result.data as any)?.playlistData as PlaylistData | undefined;
        const cid = (result.data as any)?.channelId as string | undefined;
        if (cid && pd && pd.name) {
          setInlinePlaylist(cid, pd);
        }
      }
    }).catch((err) => {
      clearAddBusy();
      Alert.alert('Add channel failed', err?.message || String(err));
    });
  };

  const handleMasterChange = async (val: number) => {
    setMaster(val);
    const now = Date.now();
    if (now - (throttleRef.current['master'] || 0) > 33) {
      throttleRef.current['master'] = now;
      await updateMixerMaster(val);
    }
  };

  // Destructive-action guard (production-console safety): deleting a
  // mixer channel drops a live overlay layer mid-show, so it must never
  // happen on a single accidental tap. The trash button now ARMS the
  // confirm sheet; the actual removeMixerChannel only fires when the
  // operator confirms. `deletePrompt` holds the target id + display name.
  const [deletePrompt, setDeletePrompt] = useState<{ id: string; name: string } | null>(null);
  const handleDeleteChannel = useCallback((id: string) => {
    const ch = channelsRef.current.find(c => c.id === id);
    setDeletePrompt({ id, name: ch?.name || ch?.id || id });
  }, []);
  const confirmDeleteChannel = useCallback(async () => {
    const target = deletePrompt;
    if (!target) return;
    setDeletePrompt(null);
    // Codex P0 — fail loud: removeMixerChannel now reports a rejected
    // DELETE instead of always returning ok. The strip is still shown
    // by the live mixer broadcast (the engine never removed it), so the
    // operator MUST be told the layer is still on air rather than
    // assuming a silent success on a live-show destructive action.
    const res = await removeMixerChannel(target.id);
    if (!res.ok) {
      console.error('[Mixer] Delete channel failed:', res.error);
      Alert.alert(
        'Delete channel failed',
        `"${target.name}" is still in the live mix. ${res.error || 'The engine did not accept the delete.'} Check that the engine is reachable, then try again.`,
      );
    }
  }, [deletePrompt]);

  // ── Channel ops cluster (docs/39 §6b) ──────────────────────────────────
  // Duplicate · Reorder · Panic/Home. All three reconcile from the engine's
  // `mixer` broadcast (the engine is the authority); the handlers are
  // useCallback'd with empty deps + read channelsRef so ChannelStrip's
  // React.memo holds across re-renders.

  // #6 Duplicate — clone an overlay onto the TOP of the stack. The new
  // channel id arrives on the next `mixer` broadcast (same WS-driven
  // reconcile path the add button already uses), so no optimistic insert
  // here — that would risk a phantom strip if the engine rejected the dup.
  // Fail loud: an over-cap (400) / missing-source (404) / deck (400) is
  // surfaced as an Alert. Cap uses the engine-reported max so the operator
  // sees the real number.
  const handleDuplicateChannel = useCallback(async (channelId: string) => {
    const res = await duplicateMixerChannel(channelId);
    if (!res.ok) {
      console.error(`[Mixer] Duplicate channel failed for ${channelId}:`, res.error);
      Alert.alert(
        'Duplicate channel failed',
        `${res.error || 'The engine did not accept the duplicate.'} `
          + `(Up to ${maxChannelsRef.current} mixer channels are allowed.)`,
      );
      return;
    }
    // Synchronously stash the inline playlist payload for the freshly-minted
    // copy (same race protection as the add path) so its PlaylistPanel paints
    // entries on first mount even on a slow iPad link.
    const pd = (res.data as any)?.playlistData as PlaylistData | undefined;
    const cid = (res.data as any)?.channelId as string | undefined;
    if (cid && pd && pd.name) {
      setInlinePlaylist(cid, pd);
    }
  }, [setInlinePlaylist]);

  // #7 Reorder — move a channel one slot toward the TOP (up) or BOTTOM (down)
  // of the mix. The engine's overlay array is ordered [0]=bottom … [last]=top,
  // and the mixer renders `channels` in that same array order, so "up = toward
  // top of mix" means swapping with the NEXT-higher index. We compute the full
  // new id order locally, POST it, and reconcile from the broadcast (no
  // optimistic local reorder — the engine's atomic reassignment is the truth
  // and a rejected REORDER_BAD_SET must not leave the strips visually shuffled).
  // direction: +1 = up/top, -1 = down/bottom.
  const moveChannel = useCallback(async (channelId: string, direction: 1 | -1) => {
    const cur = channelsRef.current;
    const idx = cur.findIndex(c => c.id === channelId);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= cur.length) return; // at an end — no-op
    const orderIds = cur.map(c => c.id as string);
    // Swap the two ids.
    const tmp = orderIds[idx];
    orderIds[idx] = orderIds[target];
    orderIds[target] = tmp;
    const res = await reorderMixerChannels(orderIds);
    if (!res.ok) {
      console.error(`[Mixer] Reorder rejected (${res.error}); order=`, orderIds);
      Alert.alert(
        'Reorder not applied',
        `The engine rejected this reorder. ${res.error || ''} The stack kept its previous order.`.trim(),
      );
    }
  }, []);
  const handleMoveUp = useCallback((channelId: string) => { void moveChannel(channelId, 1); }, [moveChannel]);
  const handleMoveDown = useCallback((channelId: string) => { void moveChannel(channelId, -1); }, [moveChannel]);

  // #9 Panic / Home — mission-critical safe LIT reset, ConfirmSheet-gated
  // (it cancels in-flight fades / transitions / swaps and clears blackout, so
  // it must never fire on an accidental tap). Recalls the `home` snapshot when
  // present, else a safe LIT default. The engine broadcasts fresh mixer/deck/
  // globals — every strip + the master + the rig bar reconcile from those.
  // Fail loud: a malformed/over-cap `home` is the ONE sanctioned loud fallback
  // (400, but the rig is STILL lit). We Alert so the operator knows the home
  // look couldn't load while reassuring them the rig is lit.
  const [panicPrompt, setPanicPrompt] = useState(false);
  const [panicBusy, setPanicBusy] = useState(false);
  const confirmPanic = useCallback(async () => {
    setPanicPrompt(false);
    setPanicBusy(true);
    try {
      const res = await panicMixer(true);
      if (!res.ok) {
        console.error('[Mixer] Panic reported a loud fallback:', res.error, res.data);
        const rigLit = (res.data as any)?.rigLit === true;
        Alert.alert(
          'Panic — home look not loaded',
          `${res.error || 'The "home" snapshot could not be recalled.'} `
            + (rigLit
              ? 'The rig is still LIT (blackout cleared, master up).'
              : 'Check the engine and re-run panic.'),
        );
      }
    } catch (err: any) {
      console.error('[Mixer] Panic request failed:', err);
      Alert.alert('Panic failed', `Could not reach the engine. ${err?.message || ''}`.trim());
    } finally {
      setPanicBusy(false);
    }
  }, []);

  const handleTransitionSettingsChange = useCallback(async (channelId: string, updates: { transitionMode?: string; transitionTime?: number }) => {
    // Codex P0 — no silent swallow. The transition mode/time live in the
    // child ChannelStrip's local state (re-synced from the engine on the
    // next mixer broadcast), so the parent can't cleanly revert them
    // here; surface the rejection via log. These aren't show-critical
    // (they tune HOW a transition runs, not the live mix), so no Alert.
    const res = await updateMixerChannel(channelId, updates);
    if (!res.ok) {
      console.error(`[Mixer] Transition-settings change rejected for ${channelId}:`, res.error, updates);
    }
  }, []);

  // Per-channel view-selection update. Optimistic local apply + PATCH;
  // the engine validates and broadcasts a fresh `mixer` event with the
  // committed value, so a rejected PATCH (e.g. unknown group) is
  // visually corrected on the next broadcast. v1 ships ALL vs GROUP.
  const handleViewSelectionChange = useCallback(async (channelId: string, viewSelection: any) => {
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, viewSelection } : c));
    // Codex P0 — fail loud. The optimistic apply above flips the picker
    // immediately; if the engine REJECTS the PATCH (unknown group, bad
    // viewMask) the next mixer broadcast silently reverts it and the
    // operator never learns why their pick "didn't take". Surface both
    // a transport failure (catch) and an engine rejection (res.ok=false).
    try {
      const res = await updateMixerChannel(channelId, { viewSelection });
      if (!res.ok) {
        console.error('[Mixer] View-selection PATCH rejected:', res.error);
        Alert.alert(
          'View selection not applied',
          `The engine rejected this view selection. ${res.error || ''} The channel will snap back to its committed value.`.trim(),
        );
      }
    } catch (err: any) {
      console.error('[Mixer] View-selection PATCH failed:', err);
      Alert.alert('View selection not applied', `Could not reach the engine. ${err?.message || ''}`.trim());
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // handleTransition — server-driven (May 2026, third rewrite)
  //
  // What used to be ~150 lines of rAF + WS-throttle + ease-curve math
  // collapses to a single triggerMixerTransition WS message. The
  // marsin_engine owns the entire fader animation:
  // pattern_mixer.triggerMixerTransition() force-enables every overlay,
  // schedules a smooth-step interpolation for each channel, and ticks
  // them at the engine's 40 Hz render rate inside updateTransitions().
  // The engine then throttles the resulting mixer broadcasts to 10 Hz so
  // the iPad sliders animate smoothly without flooding the WS connection.
  //
  // Why this fixes the stepping/jumping the operator was seeing:
  //   - The DMX/SACN output is updated EVERY engine tick (40 Hz) with
  //     the smooth-step-interpolated fader value. No throttle dead-zones,
  //     no WS jitter, no rAF stepping.
  //   - Smooth-step (3t² − 2t³) is symmetric: derivative is 0 at both
  //     endpoints. Winner (start→1) and losers (start→0) ride the SAME
  //     curve in their respective directions, so brightness evolves
  //     symmetrically — no "creep then snap" artifacts that the
  //     asymmetric sin/cos pair produced.
  //   - The previous 250 ms echo lockout is gone. The iPad trusts every
  //     mixer broadcast unconditionally (with a tiny per-channel guard
  //     to protect against stale broadcasts arriving milliseconds after
  //     a user's slider drag — see localFaderWriteRef), so the final
  //     mixer-state broadcast that lands ~5 ms after the engine
  //     completes the transition snaps the UI into perfect sync
  //     immediately.
  //
  // See agent diagnostic "Mixer Transition Behavior Analysis" (May 2026)
  // for the full root-cause breakdown of the previous client-driven
  // implementation, and the agent review of the server-side plan for
  // why we use smooth-step (not sin/cos) + a single per-group completion
  // callback + manual-fader cancellation.
  //
  // `transMode` is the user-selected trans_* blend script (trans_flash,
  // trans_dissolve, trans_iris, trans_wipe_left/right/up, or
  // trans_crossfade). The engine swaps the target channel's blend mode
  // to this script for the duration of the fade so the visual effect
  // (flash white at midpoint, random-pixel dissolve, iris open, wipe
  // edge…) plays out across the requested time. trans_crossfade keeps
  // the cheaper fader-only smoothstep behavior (no script swap). See
  // pattern_mixer.triggerMixerTransition() for the full contract.
  // ─────────────────────────────────────────────────────────────────────
  const handleTransition = useCallback((targetChannelId: string, durationSec: number, transMode: string, _originalMode: string) => {
    const durationMs = Math.max(1, Math.min(30000, Math.round(durationSec * 1000)));
    // Defensive: trans_* dropdown strings only. Anything else falls back
    // to crossfade so a stale UI state can't break the transition.
    const safeTransMode = (typeof transMode === 'string' && transMode.startsWith('trans_'))
      ? transMode
      : 'trans_crossfade';
    // Clear solo display optimistically so the SOLO buttons pop back to off
    // immediately. The engine's triggerMixerTransition() clears the
    // soloedChannelIds Set at the start of the transition (docs/39 §10) and
    // broadcasts the empty set within ~100 ms, but the operator shouldn't have
    // to wait that long to see the badges clear. This is DISPLAY-ONLY — the
    // engine is the authority and the broadcast reconciles.
    setSoloedIds(new Set());
    // engineEvents.send queues the message if the control bus is
    // reconnecting; we deliberately don't bail out on transient
    // disconnect so a stale state doesn't strand the transition.
    const ok = engineEvents.send({
      type: 'triggerMixerTransition',
      targetChannelId,
      durationMs,
      curve: 'smoothstep',
      mode: 'exclusiveOverlays',
      transitionMode: safeTransMode,
    });
    if (!ok) console.warn('[Mixer] Transition queued — control WS not yet open');
  }, []);

  return (
    <View style={styles.container}>
      {/* ── Top Header Bar ─────────────────────────────────────────── */}
      <View style={[styles.header, isPortrait && { paddingHorizontal: 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 8 : 16 }}>
          <Text style={[styles.brandText, isPortrait && { fontSize: 16 }]}>Marsin Mixer</Text>
          <View style={[styles.statusBadge, isPortrait && { paddingHorizontal: 8, paddingVertical: 4 }]}>
            <View style={[styles.statusDot, !isConnected && {backgroundColor: C.error}]} />
            {!isPortrait && (
              <Text style={[styles.labelCaps, {color: isConnected ? '#00a86b' : C.error}]}>
                {isConnected ? 'CONNECTED' : 'OFFLINE'}
              </Text>
            )}
          </View>
          {/* Active model chip — secondary status, after the connection
              pill. Hidden until the /status probe resolves and on
              portrait (matches the CONNECTED label's portrait behaviour)
              so the narrow header isn't crowded. */}
          {!isPortrait && activeModel ? (
            <View style={styles.modelChip}>
              <Text style={styles.labelCaps}>MODEL</Text>
              <Text style={styles.modelName} numberOfLines={1}>{activeModel}</Text>
            </View>
          ) : null}
          {/* Engine-health warning — renders NOTHING when healthy (no layout
              shift); shows an amber "⚠ DEGRADED" chip only when the engine
              reports a degrade on /status. See HealthChip / useEngineHealth. */}
          <HealthChip compact={isPortrait} />
          {/* Named-look snapshots (docs/39 §8.1): capture the full mixer
              state under a name + recall/delete saved looks. Reconciles
              from the WS `snapshots` event. Hidden in portrait to keep the
              narrow header uncrowded (matches the model chip's behaviour). */}
          {!isPortrait ? <SnapshotBar /> : null}
        </View>
        {/* Right control cluster (QA round1 #5). flexWrap + justify-end lets the
            MASTER readout and the two add buttons reflow to a second line rather
            than push `+ FROM PLAYLIST…` past the screen edge. The columnGap is
            the spacing the cramped landscape header was missing. */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          flexShrink: 1,
          columnGap: isPortrait ? 6 : 12,
          rowGap: 8,
        }}>
          {/* CLEAR SOLO — only shown while a server-authoritative solo is
              engaged. Sends WS clearSolo (all) + REST mirror; the broadcast's
              empty soloedChannelIds[] reconciles every strip back to lit. */}
          {soloedIds.size > 0 ? (
            <TouchableOpacity
              style={[styles.clearSoloBtn, isPortrait && { paddingHorizontal: 6, paddingVertical: 6 }]}
              onPress={handleClearAllSolo}
              accessibilityRole="button"
              accessibilityLabel="Clear all solos"
            >
              <Text style={[styles.labelCaps, { color: '#FFF' }, isPortrait && { fontSize: 9 }]}>
                {isPortrait ? 'CLR SOLO' : 'CLEAR SOLO'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {/* MASTER label + fader + readout travel together as one cluster so
              they never split across a wrap and the value keeps a reserved
              column (no more cramped overlap with the slider). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 6 : 10 }}>
            {!isPortrait && <Text style={styles.labelCaps}>MASTER</Text>}
            <HorizontalFader
              value={master}
              onChange={handleMasterChange}
              trackStyle={[styles.faderTrack, { width: isPortrait ? 120 : 160 }]}
              fillStyle={styles.faderFill}
            />
            <Text style={[styles.displayMono, {fontSize: 16, width: 36, textAlign: 'right'}, isPortrait && { fontSize: 14, width: 28 }]}>{Math.round(master * 100)}</Text>
          </View>
          {/* One-tap default add: fastest path. disabled+opacity gives the
              operator visual feedback while the POST is in flight, so they
              don't mash and queue 5 of them. */}
          <TouchableOpacity
            style={[styles.addBtn, isPortrait && { paddingHorizontal: 6, paddingVertical: 6 }, addBusy && { opacity: 0.5 }]}
            onPress={() => handleAddChannelWithPlaylist('default')}
            disabled={addBusy}
          >
            <Text style={[styles.labelCaps, {color: '#FFF'}, isPortrait && { fontSize: 9 }]}>{addBusy ? 'ADDING…' : '+ DEFAULT'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder }, isPortrait && { paddingHorizontal: 6, paddingVertical: 6 }, addBusy && { opacity: 0.5 }]}
            onPress={openAddChannelPicker}
            disabled={addBusy}
          >
            <Text style={[styles.labelCaps, {color: C.primary}, isPortrait && { fontSize: 9 }]} numberOfLines={1}>{isPortrait ? '+ PLAYLIST' : '+ FROM PLAYLIST…'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <CPCControls />

      {/* ── Channel Groups (gang-faders) rail (docs/39 §10) ──────────── */}
      {/* Stateless w.r.t. the registry — it renders the parent-owned
          mixGroups + channels (both reconciled from the `mixer` broadcast)
          and reports edits up through the typed groupsSoloApi clients. */}
      <GroupRail mixGroups={mixGroups} channels={channels} />

      {/* ── Master Visualization ──────────────────────────────────────
          Tight band (2026-06-22 UI cleanup): the label sits inline with no
          extra top padding and the viz is a slim 12px strip, so the channel
          strip below moves up and reclaims the vertical space the operator
          flagged as wasted on narrow (phone) widths.
          QA round1 #8: the bare pixel strip read as a "broken black bar" with
          no scale/value. We now (a) surface the master output % inline with the
          label, and (b) seat the strip in a bordered light track (matching every
          other slider's track styling) so an all-dark frame reads as a real
          meter at idle, not a glitch. */}
      <View style={{ paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <Text style={[styles.labelCaps, { fontSize: 9 }]}>MASTER OUTPUT</Text>
          <Text style={[styles.labelCaps, { fontSize: 9, color: C.primary }]}>{Math.round(master * 100)}%</Text>
        </View>
        {/* QA round3 #5: the header above already shows MASTER OUTPUT <n>%, so
            ChannelVizStrip's own in-track meter row (a duplicate bar + a
            right-hugging `<n>%` label) was redundant — and its level sidecar
            read 0% while the header read 100%, so the stray `0%` looked like a
            bug. showMeter={false} drops the in-strip meter row, leaving just
            the pixel strip under the single authoritative header value. */}
        <View style={styles.masterVizTrack}>
          <ChannelVizStrip vizKey="master" height={12} style={{ borderRadius: 6 }} showMeter={false} />
        </View>
      </View>

      {/* ── Channel Strips ─────────────────────────────────────────── */}
      {/* Post-channel-split: /mixer.channels[] contains ONLY mixer
          overlays (the deck channel lives on /deck/channel). We
          iterate the array directly — no `.slice(1)` skip-the-deck
          dance. The engine's HIL test (hil_channel_isolation_test)
          guards this invariant. */}
      {/* QA round3 #3: a centered single (or double) card at the 560px cap
          left a ~520px empty gutter on either side in landscape, reading as
          lopsided dead space. Center ONLY when the row is full (3 layers,
          which fills the viewport); with fewer layers left-align the column so
          the cards anchor to the left edge and the unused width sits as a
          single trailing margin instead of two symmetric gutters that frame
          the emptiness. Portrait is untouched (always a single fixed column).*/}
      <ScrollView horizontal scrollEnabled={false} contentContainerStyle={[{ padding: 16, gap: 16, flexGrow: 1 }, !isPortrait && { justifyContent: channels.length >= 3 ? 'center' : 'flex-start' }]} style={{ flex: 1 }}>
        {channels.map((channel, idx) => {
          // Landscape width distribution (QA round1 #7): the strips used to be
          // a fixed 320px each and hugged the left edge, leaving ~2/3 of the
          // landscape viewport as dead grey space. In landscape we now hand
          // each strip a flex width so the row fills the viewport — `flex: 1`
          // splits the available width evenly across the visible strips, with a
          // 320px floor so a strip never collapses below its usable layout and
          // a 560px ceiling so a single strip fills sensibly without ballooning.
          // Portrait keeps the original fixed 320px column.
          // `width: undefined` explicitly overrides channelCard's fixed 320
          // (RN style-merge keeps the earlier width unless it's reset), letting
          // `flex: 1` distribute the row width instead.
          // QA round3 #3: lift the per-card width ceiling when the row isn't
          // full so 1-2 layers widen to use the freed landscape width instead
          // of capping at 560 and leaving a gutter. A 3-layer row keeps the
          // 560 cap (it already fills evenly); 1-2 layers may grow to 760 each
          // so the column reads filled, not stranded at the left.
          const landscapeMaxWidth = channels.length >= 3 ? 560 : 760;
          const cardStyle = isPortrait
            ? null
            : { width: undefined, flex: 1, minWidth: 320, maxWidth: landscapeMaxWidth };
          // Solo display (docs/39 §10) — DISPLAY-ONLY, derived from the
          // authoritative soloedIds Set. `isSolo` = this channel is soloed.
          // `soloActive` = ANY solo is engaged. `dimmedBySolo` mirrors the
          // engine's render gate: when a solo is active and this channel is
          // NOT soloed / solo-safe / fader-locked, the engine zeroes its
          // contribution — we dim the strip to match (never mutating state).
          const isSoloActive = soloedIds.has(channel.id);
          const anySolo = soloedIds.size > 0;
          // FLASH / BUMP held-state (docs/39 §10.7) — display-only.
          const isBumped = bumpedIds.has(channel.id);
          const soloProtected = !!channel.soloSafe || !!channel.faderLocked;
          const dimmedBySolo = anySolo && !isSoloActive && !soloProtected;
          // Group this channel belongs to (single-membership pointer), for the
          // strip tint + badge.
          const group = channel.mixGroupId
            ? mixGroups.find(g => g.id === channel.mixGroupId) || null
            : null;
          // Read inlinePlaylistVersion so this scope re-renders when
          // the Map changes (Maps aren't structurally compared by React).
          void inlinePlaylistVersion;
          const channelInlinePlaylist = inlinePlaylistRef.current.get(channel.id) || null;
          return (
            <ChannelStrip
              key={channel.id}
              index={idx + 1}
              channel={channel}
              isSolo={isSoloActive}
              soloActive={anySolo}
              dimmedBySolo={dimmedBySolo}
              isBumped={isBumped}
              onBumpOn={handleBumpOn}
              onBumpOff={handleBumpOff}
              group={group}
              isDeck={false}
              blends={blends}
              transitions={transitionsList}
              playlistLibrary={playlistLibrary}
              initialPlaylist={channelInlinePlaylist}
              cardStyle={cardStyle}
              onFaderChange={handleFaderChange}
              onColorChange={handleColorChange}
              onHueChange={handleHueChange}
              onMuteToggle={handleMuteToggle}
              onSoloToggle={handleSoloToggle}
              onSoloSafeToggle={handleSoloSafeToggle}
              onModeChange={handleModeChange}
              onControlChange={handleControlChange}
              onDelete={handleDeleteChannel}
              onDuplicate={handleDuplicateChannel}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              canMoveUp={idx < channels.length - 1}
              canMoveDown={idx > 0}
              onLockToggle={handleLockToggle}
              onFaderLockToggle={handleFaderLockToggle}
              onTransition={handleTransition}
              onTransitionSettingsChange={handleTransitionSettingsChange}
              viewSelectionGroups={viewSelectionGroups}
              viewSelectionViewMasks={viewSelectionViewMasks}
              onViewSelectionChange={handleViewSelectionChange}
            />
          );
        })}
        {channels.length === 0 && (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={[styles.labelCaps, { fontSize: 14 }]}>NO CHANNELS — TAP &quot;+ DEFAULT&quot; OR &quot;+ FROM PLAYLIST&quot;</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Global Rig Controls (Bottom) ───────────────────────────── */}
      <View style={styles.globalRigBar}>
        {/* PANIC / HOME (docs/39 §6b #9) — mission-critical safe LIT reset.
            Distinct AMBER so it reads as the rig's "get me back to safe" button,
            visually separate from the GEM grid + the e-stop BLACKOUT inside it.
            ConfirmSheet-gated (it cancels in-flight fades/transitions/swaps and
            clears blackout). Reconciles from the engine's broadcasts. */}
        <TouchableOpacity
          style={[styles.panicBtn, panicBusy && { opacity: 0.5 }]}
          onPress={() => setPanicPrompt(true)}
          disabled={panicBusy}
          accessibilityRole="button"
          accessibilityLabel="Panic — reset rig to a safe lit state"
          accessibilityState={{ disabled: panicBusy }}
        >
          <Text style={styles.panicBtnText}>{panicBusy ? 'PANIC…' : 'PANIC'}</Text>
          <Text style={styles.panicBtnHint}>HOME / SAFE LIT</Text>
        </TouchableOpacity>
        <RigGlobals variant="mixer" />
      </View>

      {/* ── Add-channel playlist picker ─────────────────────────────── */}
      <Modal transparent visible={addPickerOpen} animationType="fade" onRequestClose={() => setAddPickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAddPickerOpen(false)}>
          <View style={styles.modalContent}>
            <Text style={[styles.labelCaps, {marginBottom: 12}]}>NEW CHANNEL · PICK A PLAYLIST</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {addPickerPlaylists.map(name => (
                <TouchableOpacity
                  key={name}
                  style={[styles.modalRow, name === 'default' && styles.modalRowActive]}
                  onPress={() => handleAddChannelWithPlaylist(name)}
                >
                  <Text style={[styles.valueReadout, name === 'default' && { color: C.primary }]}>
                    {name === 'default' ? '★ default' : name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Delete-channel confirmation (production-console safety) ──── */}
      <ConfirmSheet
        visible={!!deletePrompt}
        title="Delete channel?"
        message={`This removes the "${deletePrompt?.name ?? ''}" overlay layer from the live mix. Its playlist assignment stays on disk, but the channel and its current settings are gone.`}
        confirmLabel="DELETE CHANNEL"
        cancelLabel="CANCEL"
        onConfirm={confirmDeleteChannel}
        onCancel={() => setDeletePrompt(null)}
      />

      {/* ── Panic / Home confirmation (docs/39 §6b #9) ──────────────── */}
      <ConfirmSheet
        visible={panicPrompt}
        title="Panic to safe state?"
        message={'Resets the rig to a safe LIT state: cancels in-flight fades, transitions and deck swaps, clears solo, un-mutes groups, brings the master up, and clears blackout. Recalls the "home" look if one is saved, otherwise a safe default. The exterior stays lit throughout.'}
        confirmLabel="PANIC"
        cancelLabel="CANCEL"
        onConfirm={confirmPanic}
        onCancel={() => setPanicPrompt(false)}
      />

      {/* ── Unlock-dirty prompt ─────────────────────────────────────── */}
      {/* Channel has unsaved param edits made while locked. The user must
          choose to either persist them into the playlist entry or roll
          back to the saved defaults before the lock actually releases. */}
      <Modal transparent visible={!!unlockPrompt} animationType="fade" onRequestClose={() => resolveUnlockPrompt('cancel')}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => { if (!unlockPrompt?.pending) resolveUnlockPrompt('cancel'); }}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.modalContent, { maxWidth: 420 }]}>
              <Text style={[styles.labelCaps, { marginBottom: 8 }]}>UNSAVED PARAM CHANGES</Text>
              <Text style={{ color: C.text, fontSize: 14, lineHeight: 20, marginBottom: 16 }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold' }}>{unlockPrompt?.channelName}</Text>
                {' was edited while locked. What should we do with those changes before unlocking?'}
              </Text>
              <View style={{ gap: 8 }}>
                <TouchableOpacity
                  style={[styles.unlockPromptBtn, styles.unlockPromptSave]}
                  onPress={() => resolveUnlockPrompt('save')}
                  disabled={!!unlockPrompt?.pending}
                >
                  <Text style={[styles.unlockPromptBtnText, { color: C.primary }]}>SAVE TO PLAYLIST</Text>
                  <Text style={styles.unlockPromptHint}>Capture current params into the active entry</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unlockPromptBtn, styles.unlockPromptDiscard]}
                  onPress={() => resolveUnlockPrompt('discard')}
                  disabled={!!unlockPrompt?.pending}
                >
                  <Text style={[styles.unlockPromptBtnText, { color: '#B3261E' }]}>DISCARD CHANGES</Text>
                  <Text style={styles.unlockPromptHint}>Reload saved params from the playlist</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unlockPromptBtn, styles.unlockPromptCancel]}
                  onPress={() => resolveUnlockPrompt('cancel')}
                  disabled={!!unlockPrompt?.pending}
                >
                  <Text style={[styles.unlockPromptBtnText, { color: C.secondary }]}>KEEP LOCKED</Text>
                  <Text style={styles.unlockPromptHint}>Stay locked, decide later</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ── Styles (Using Colors.light for consistency with other tabs) ────────

function makeStyles(C: Palette, globalStyles: GlobalStyles) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    // minHeight (was a fixed 64) so the right-hand control cluster can wrap to
    // a second line in landscape instead of clipping `+ FROM PLAYLIST…` off the
    // screen edge (QA round1 #5). flexWrap lets the brand/status cluster and the
    // master/add cluster stack when the viewport is too narrow to seat both.
    minHeight: 64,
    backgroundColor: C.surfaceContainerLow,
    borderBottomWidth: 1,
    borderBottomColor: C.ghostBorder,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    rowGap: 8,
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  globalParamsBar: {
    backgroundColor: C.surfaceContainerHigh,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.ghostBorder,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Bottom-pinned global-effects strip. Full-width, intentionally
  // short (header + 36 px button row + small padding) so it doesn't
  // eat fader real-estate. Pre-May-2026 this had paddingV:12 +
  // alignItems:center which collapsed the inner row to its intrinsic
  // width and floated it left; the inner GEM now sets flex:1 in
  // mixer-strip mode so it stretches edge-to-edge.
  globalRigBar: {
    backgroundColor: C.surfaceContainerLow,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: C.ghostBorder,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  globalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: C.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
    ...globalStyles.ambientShadow,
  },
  // PANIC / HOME (docs/39 §6b #9) — amber so it reads as the rig's
  // mission-critical "back to safe" action, distinct from the teal GEM grid
  // and the red BLACKOUT e-stop inside it. Pinned at the left of the global
  // rig bar where the operator's thumb can find it without hunting. Min 44pt
  // touch target (production-console safety floor).
  panicBtn: {
    minWidth: 96,
    minHeight: 52,
    paddingHorizontal: 14,
    marginRight: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(245,166,35,0.18)',
    borderWidth: 1.5,
    borderColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    ...globalStyles.ambientShadow,
  },
  panicBtnText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 14,
    letterSpacing: 1.2,
    color: '#F5A623',
  },
  panicBtnHint: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 8,
    letterSpacing: 0.6,
    color: '#F5A623',
    opacity: 0.8,
    marginTop: 1,
  },
  brandText: {
    color: C.primary,
    fontSize: 20,
    fontFamily: 'SpaceGrotesk_700Bold',
    letterSpacing: -0.5,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surfaceContainerHigh,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.ghostBorder,
  },
  statusDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#00a86b',
  },
  // Secondary "active model" chip — same surface/border geometry as the
  // status badge so the two read as one toolbar; slightly tighter
  // padding to keep it visually subordinate to the connection pill.
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 200,
    backgroundColor: C.surfaceContainerHigh,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.ghostBorder,
  },
  modelName: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 11,
    letterSpacing: 0.4,
    color: C.primary,
    flexShrink: 1,
  },
  labelCaps: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 10,
    letterSpacing: 1.2,
    color: C.secondary,
    textTransform: 'uppercase',
  },
  valueReadout: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 13,
    color: C.text,
  },
  headlineSm: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 18,
    color: C.text,
    textTransform: 'uppercase',
  },
  displayMono: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 18,
    color: C.primary,
  },
  addBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    ...globalStyles.ambientShadow,
  },
  // MASTER OUTPUT viz track (QA round1 #8). A light, bordered, rounded
  // container that frames the pixel strip the same way faderTrack frames a
  // slider — so an idle all-dark frame reads as a meter at rest, not a broken
  // black bar. overflow:hidden clips the strip's corners to the track radius.
  masterVizTrack: {
    backgroundColor: C.surfaceContainerHigh,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    overflow: 'hidden',
  },
  channelCard: {
    width: 320,
    backgroundColor: C.surfaceContainerLowest,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    overflow: 'hidden',
    // Stretch to the parent ScrollView's height so the playlist column fills
    // the entire visible strip area, regardless of how many entries exist.
    alignSelf: 'stretch',
    ...globalStyles.ambientShadow,
  },
  channelCardLocked: {
    borderColor: 'rgba(245,166,35,0.4)',
    borderWidth: 2,
  },
  channelHeader: {
    flexDirection: 'row',
    // Wrap (2026-06-22 UI cleanup): on narrow strips the 9-button control
    // row no longer fits beside the channel name, so the whole header is
    // allowed to wrap — the name+badge keep the first line and the button
    // row drops to a full-width second line (where it wraps internally too)
    // instead of clipping off the right edge.
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    rowGap: 8,
    padding: 12,
    backgroundColor: C.surfaceContainerHigh,
    borderBottomWidth: 1,
    borderBottomColor: C.ghostBorder,
  },
  channelBadge: {
    width: 24, height: 24, borderRadius: 6,
    backgroundColor: 'rgba(0,104,117,0.1)',
    borderWidth: 1, borderColor: C.primary,
    alignItems: 'center', justifyContent: 'center'
  },
  // Unified title-bar button (refresh, lock, pin, delete). 28×28
  // squircle with the same surface + border so the title bar reads as
  // a single toolbar regardless of which buttons are present. The
  // ACTIVE variants below only override the colours; keeping the box
  // geometry constant prevents reflow when an operator toggles a
  // lock / pin.
  titleBtn: {
    width: 28, height: 28, borderRadius: 6,
    backgroundColor: C.surfaceContainerLowest,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.ghostBorder,
  },
  titleBtnAmberActive: {
    backgroundColor: 'rgba(245, 166, 35, 0.15)',
    borderColor: 'rgba(245, 166, 35, 0.5)',
  },
  titleBtnTealActive: {
    backgroundColor: 'rgba(0, 104, 117, 0.15)',
    borderColor: 'rgba(0, 104, 117, 0.5)',
  },
  // Legacy aliases — left in place so any unmigrated call sites still
  // resolve. Title-bar buttons now use titleBtn / titleBtnAmberActive /
  // titleBtnTealActive directly. These can be removed once nothing
  // outside this file references them.
  lockBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderColor: 'rgba(245,166,35,0.5)',
  },
  // Fader-lock (slot 5): teal accent so the operator can tell it
  // apart from the amber playlist lock above without reading the
  // icon. Same footprint as lockBtnActive — uses the project's
  // primary teal at 15% / 50% opacity to match the existing
  // "active toggle" visual language elsewhere in the strip.
  faderLockBtnActive: {
    backgroundColor: 'rgba(0,104,117,0.15)',
    borderColor: 'rgba(0,104,117,0.5)',
  },
  modeDropdown: {
    backgroundColor: C.surfaceContainerLowest,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    borderWidth: 1, borderColor: C.ghostBorder,
  },
  deleteBtn: {
    width: 28, height: 28, borderRadius: 6,
    backgroundColor: C.surfaceContainerLowest,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.ghostBorder,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.ghostBorder,
  },
  faderTrack: {
    height: 16,
    backgroundColor: C.surfaceContainerHigh,
    borderRadius: 4,
  },
  faderFill: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    backgroundColor: C.primaryFixedDim,
    borderRadius: 4,
  },
  // Per-channel hue row (docs/39 §F-hue). DECLUTTER (mixer declutter): HUE is
  // now the only secondary fader on the strip and is rendered SLIM so LEVEL
  // reads as the primary control. Tighter vertical padding than the LEVEL row,
  // a thin track (hueTrack), and a small swatch keep its visual weight low.
  hueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: C.ghostBorder,
  },
  // Slim HUE track — half the LEVEL fader's height so HUE reads as a secondary
  // trim. The fill is a neutral magenta-ish accent (the live tint shows in the
  // swatch).
  hueTrack: {
    height: 8,
    backgroundColor: C.surfaceContainerHigh,
    borderRadius: 4,
  },
  hueFill: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    backgroundColor: '#B36AE2',
    borderRadius: 4,
  },
  hueSwatch: {
    width: 12, height: 12, borderRadius: 3,
    borderWidth: 1, borderColor: C.ghostBorder,
  },
  // Channel color picker swatch grid.
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    maxWidth: 220,
    marginBottom: 12,
  },
  swatch: {
    width: 44, height: 44, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)',
  },
  swatchActive: {
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  swatchCheck: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 18,
    color: '#FFFFFF',
  },
  clearColorBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    backgroundColor: C.surfaceContainerHigh,
  },
  channelBody: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 0,
  },
  channelBodyPortrait: {
    // Portrait stacks playlist over params (QA round1 #2).
    flexDirection: 'column',
  },
  patternListPanel: {
    // Wider than params (item 1): the list is the channel's primary surface.
    width: '60%',
    padding: 6,
  },
  // Portrait: full strip width for the playlist so track names stop being
  // squeezed by the side-by-side params column. A minHeight keeps the
  // internally-scrolling list usable now that the parent is no longer a
  // height-distributing flex row.
  patternListPanelPortrait: {
    width: '100%',
    minHeight: 220,
  },
  paramsPanel: {
    width: '40%',
    padding: 8,
    // QA round3 #4: the LOCAL PARAMS column's last slider (e.g. a pattern's
    // `LEVEL` export) was sliced by the pinned MUTE/SOLO/BUMP footer — only its
    // right-aligned value peeked out. `minHeight:0` lets the inner ScrollView
    // actually bound itself to the flex-distributed body space and scroll its
    // contents, instead of growing to its full intrinsic content height and
    // pushing the tail of the list under the footer band.
    minHeight: 0,
  },
  // Portrait: params sit BELOW the playlist at full width.
  paramsPanelPortrait: {
    width: '100%',
  },
  // Bordered "LOCAL PARAMS" card inside the right column. Gives each
  // channel's local sliders a distinct visual cluster so the strip
  // reads as { left: playlist column · right: tuned local knobs }
  // rather than one long undifferentiated rail.
  localParamsCard: {
    borderWidth: 1,
    borderColor: C.ghostBorder,
    borderRadius: 8,
    padding: 8,
    // Extra right padding (QA round1 #22): 3-digit values like "100" were
    // crowding the card's right border / column divider. The roomier right
    // gutter lets the right-aligned value readouts breathe.
    paddingRight: 12,
    backgroundColor: C.surfaceContainerLowest,
  },
  // Mute / Solo span the full strip width below the body.
  muteSoloRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: C.ghostBorder,
  },
  toggleBtn: {
    flex: 1, height: 32,
    backgroundColor: C.surfaceContainerHigh,
    borderRadius: 6, borderWidth: 1, borderColor: C.ghostBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  toggleBtnMuted: {
    backgroundColor: C.error,
    borderColor: C.error,
  },
  // Solo-safe toggle (docs/39 §10). Teal-tinted when engaged (protection ON);
  // a brighter "lit" variant while a solo is ACTIVE so the operator sees which
  // channels are surviving the solo (mission-critical exterior protection).
  toggleBtnSafe: {
    backgroundColor: 'rgba(0,104,117,0.12)',
    borderColor: 'rgba(0,104,117,0.5)',
  },
  // FLASH / BUMP held state (docs/39 §10.7) — bright amber, distinct from
  // solo green + mute red so a held accent is unmistakable on the surface.
  toggleBtnBump: {
    backgroundColor: '#ffb300',
    borderColor: '#ffb300',
  },
  toggleBtnSafeLit: {
    backgroundColor: 'rgba(0,104,117,0.28)',
    borderColor: C.primary,
  },
  // Clear-all-solo header button — only rendered while a solo is engaged.
  // Green to match the solo accent (it CLEARS the green solo state).
  clearSoloBtn: {
    backgroundColor: '#00a86b',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    ...globalStyles.ambientShadow,
  },
  // Group membership badge in the strip header (docs/39 §10).
  groupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 96,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    backgroundColor: C.surfaceContainerLowest,
  },
  groupBadgeDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  groupBadgeText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 9,
    letterSpacing: 0.6,
    color: C.text,
    flexShrink: 1,
  },
  // Transition action + dropdown + time on its own full-width row.
  transitionBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 4,
    gap: 6,
  },
  transitionBtn: {
    backgroundColor: C.secondary,
    borderColor: C.secondary,
    height: 36,
  },
  transitionDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // Full-screen backdrop for every Modal on this screen (blend / transition
  // / color / view / add-channel pickers). QA round3 #1: when a picker's
  // <Modal> is mounted INSIDE a width-constrained channel column (landscape
  // hands each card `flex:1, maxWidth:560`), a `flex:1` overlay fills the
  // COLUMN, not the viewport — so the centered card drifts left-of-screen.
  // Pinning the overlay to the Modal host with `position:'absolute'` inset 0
  // makes it a true full-viewport layer regardless of where the <Modal> tag
  // sits in the tree, so the card centers on the whole screen (verified for
  // an 834-wide iPad-portrait viewport). Backdrop raised to 0.7 (was 0.4) to
  // match PlaylistPanel's HOT SWAP picker so the busy playlist rows behind
  // can't bleed through.
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  modalContent: {
    backgroundColor: C.surfaceContainerLowest,
    borderRadius: 16,
    padding: 24,
    minWidth: 200,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    ...globalStyles.ambientShadow,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  // Selected option: solid primary fill + onPrimary text + a ✓ so the
  // active blend/transition reads unambiguously, not as a faint outline
  // (operator report 2026-06-22).
  modalRowActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  unlockPromptBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: C.surfaceContainerLowest,
  },
  unlockPromptSave: {
    borderColor: 'rgba(0,104,117,0.4)',
    backgroundColor: 'rgba(0,104,117,0.08)',
  },
  unlockPromptDiscard: {
    borderColor: 'rgba(179,38,30,0.4)',
    backgroundColor: 'rgba(179,38,30,0.06)',
  },
  unlockPromptCancel: {
    borderColor: C.ghostBorder,
  },
  unlockPromptBtnText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 13,
    letterSpacing: 0.5,
  },
  unlockPromptHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.icon,
    marginTop: 2,
  },
});
}
