import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Palette } from '@/constants/theme';
import { View, Text, TouchableOpacity, Pressable, ScrollView, StyleSheet, TextInput, Modal, useWindowDimensions, Alert } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { usePalette } from '@/hooks/use-theme';
import { useGlobalStyles, GlobalStyles } from '@/styles/globalStyles';
import { useFocusEffect, router } from 'expo-router';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { RigGlobals } from '@/components/RigGlobals';
import {
  fetchMixerState, updateMixerChannel, removeMixerChannel, setMixerChannelControl,
  addMixerChannel, updateMixerMaster,
  fetchChannelBlends, fetchTransitions, setMixerView,
  fetchPlaylists, fetchViewSelectionOptions,
  captureMixerChannelDefaults, discardMixerChannelDefaults,
  type PlaylistData,
} from '@/utils/api';
import { engineEvents } from '@/utils/engineEvents';
import { useActiveModel } from '@/hooks/useEngineState';
import { setMidiActiveContext, setMidiFocus, useIsMidiFocused } from '@/hooks/useMidiControl';
import { MidiMapBadge, MidiMapPopover, useEntryMidiMappings, MIDI_VIOLET } from '@/components/MidiMap';
import { KnobPill } from '@/components/ui/knob_pill';
import { deriveKnobOrder, type Export } from '@/utils/midi/knob_order';
import { knobBadgeFor } from '@/utils/midi/knob_badge';
import { globalKnobNumber } from '@/utils/midi/knob_page';

import { CPCControls } from '@/components/CPCControls';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import { TRANSITION_DURATION_PRESETS_MS } from '@/components/DeckTransitionControls';
import { MiniFader } from '@/components/ui/MiniFader';
import { HealthChip } from '@/components/ui/HealthChip';
import { TimerWheel } from '@/components/ui/TimerWheel';
import { ChannelVizStrip } from '@/components/ChannelVizStrip';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { SnapshotBar } from '@/components/SnapshotBar';
import { MasterFadeGroup } from '@/components/MasterFadeGroup';
import { useMasterFade } from '@/hooks/use_master_fade';
import { setChannelColor, setChannelHue } from '@/utils/channelExtrasApi';
import { duplicateMixerChannel, reorderMixerChannels, panicMixer } from '@/utils/channelOpsApi';
import {
  type MixGroup,
  postSolo, deleteSolo, clearAllSolo, setChannelSoloSafe,
} from '@/utils/groupsSoloApi';
import { postBump } from '@/utils/bumpApi';
import { GroupRailBody, MixGroupHeader, tintFromHex } from '@/components/GroupRail';
import { useEngineConnection } from '@/hooks/useEngineConnection';
import type { EngineMessage, BusStatus } from '@/utils/engineEvents';
import { useOperatorTakeover, useTimeline } from '@/hooks/useTimeline';
import { PlanLockScrim } from '@/components/PlanLockScrim';
import { useEngineLock } from '@/hooks/useEngineLock';
import { PlanLockBanner } from '@/components/PlanLockBanner';
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

// (Per-channel color-accent palette removed 2026-06-22 — color coding was
// dropped from the channel strip at operator request.)

// ── Channel title derivation (round8 #1) ───────────────────────────────
// Every default-added channel was minted with the literal name "New Layer"
// (see handleAddChannelWithPlaylist), so three fresh strips read three
// identical "NEW LAYER" headers and the operator couldn't tell them apart.
// We treat that placeholder (and an empty/whitespace name) as "no operator
// name set" and derive a meaningful title from the channel's content instead:
//   1. the active playlist ENTRY's label / pattern name (most specific), then
//   2. the assigned PLAYLIST name, then
//   3. "Ch <N>" using the 1-based channel index.
// A genuine operator-set rename (anything else) always wins — we never
// override a name the operator typed. `initialPlaylist` is the inline
// PlaylistData payload (entries[]), used to resolve the active entry's
// pattern; `playlistAssignment` is the channel's PlaylistAssignment
// (name + activeEntryId).
const PLACEHOLDER_CHANNEL_NAMES = new Set(['new layer', 'newlayer']);

function isPlaceholderChannelName(name: string | null | undefined): boolean {
  if (name == null) return true;
  const trimmed = String(name).trim();
  if (trimmed.length === 0) return true;
  return PLACEHOLDER_CHANNEL_NAMES.has(trimmed.toLowerCase());
}

function prettyPatternName(raw: string): string {
  // Strip a leading "NN_" ordering prefix and turn snake/separators into
  // spaced Title Case so "05_orbital_attractor_field" reads "Orbital
  // Attractor Field" in the header.
  const base = raw.replace(/^\d+[_-]/, '').replace(/[_-]+/g, ' ').trim();
  if (base.length === 0) return raw;
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveChannelTitle(
  channel: { name?: string | null },
  index: number,
  playlistAssignment: { name?: string; activeEntryId?: string | null } | null | undefined,
  initialPlaylist: { entries?: { id: string; pattern: string; label?: string | null }[] } | null | undefined,
): string {
  // An operator-set rename always wins.
  if (!isPlaceholderChannelName(channel.name)) return String(channel.name);
  // 1. Active playlist entry's pattern / label.
  const activeId = playlistAssignment?.activeEntryId ?? null;
  const entries = initialPlaylist?.entries ?? [];
  if (activeId && entries.length > 0) {
    const entry = entries.find((e) => e.id === activeId);
    if (entry) {
      if (entry.label && entry.label.trim().length > 0) return entry.label.trim();
      if (entry.pattern && entry.pattern.trim().length > 0) return prettyPatternName(entry.pattern);
    }
  }
  // 2. Assigned playlist name.
  const plName = playlistAssignment?.name;
  if (plName && plName.trim().length > 0) return prettyPatternName(plName);
  // 3. Index fallback.
  return `Ch ${index}`;
}

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
          {/* QA round 10 fix #7: unselected rows now carry a ghost surface +
              border (styles.modalRowGhost) so every option reads as tappable —
              previously only the selected row had a fill, leaving the others as
              bare text that didn't look interactive. Selection still = solid
              fill + ✓. */}
          {(blends || []).map((id: string) => (
            <TouchableOpacity key={id} style={[styles.modalRow, id === current ? styles.modalRowActive : styles.modalRowGhost]} onPress={() => { onSelect(id); onClose(); }}>
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
function MixerLocalParams({ channel, onControlChange, disabled }: {
  channel: { id: string; exports?: any[]; playlist?: { name?: string; activeEntryId?: string } | null };
  onControlChange: (channelId: string, controlId: number, value: number) => void;
  /** Soft PLAN lock — the live param sliders change what's playing, so they're
   *  disabled (greyed) until the operator takes over. */
  disabled?: boolean;
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

  // MIDI-map bindings for this channel's active playlist entry. Mirrors the
  // modulation fetch above (same per-entry array on the playlist), indexed by
  // target.parameter so each slider can look up its own binding. Editable only
  // when the channel actually has a playlist + active entry — the badge opens
  // the ⊞ MIDI-learn popover keyed to this channel's entry, exactly like the
  // deck's ModulatedSlider. Bindings live per playlist entry (engine-side), so
  // touch + APC track-button focus + MFT all edit the same source of truth.
  const { mappings: midiMappings, refresh: refreshMidi } = useEntryMidiMappings(playlistName, entryId);
  const midiByTarget = React.useMemo(() => {
    const m: Record<string, any> = {};
    for (const x of midiMappings) m[x.target.parameter] = x;
    return m;
  }, [midiMappings]);
  const midiEditable = !!playlistName && !!entryId;
  // Which param's MIDI popover is open (target name), or null.
  const [midiPopoverTarget, setMidiPopoverTarget] = React.useState<string | null>(null);

  const exps = channel.exports || [];
  if (exps.length === 0) {
    return <Text style={[styles.labelCaps, { textAlign: 'center', marginTop: 16 }]}>NO PARAMS</Text>;
  }
  // #1 + N4: render the continuous MiniFaders from THE knob order (kind-1 only),
  // so the on-screen order IS the physical MFT knob order and non-kind-1 exports
  // (toggles kind-2, hsvPickers kind-6, triggers kind-3) are NEVER drawn as a
  // fader — a fader drag on those used to emit a fabricated v0 with v1:0/v2:0,
  // zeroing an hsvPicker's saturation/value. deriveKnobOrder.rows is kind-1
  // scoped, so those exports simply don't appear here; we surface them below as
  // a small non-interactive chip so the operator still sees the pattern declares
  // them (but can't corrupt them from the mixer strip).
  const sliderRows = deriveKnobOrder(exps as Export[]).rows;
  const nonFaderExports = (exps as any[]).filter((e) => e.kind !== 1);
  return (
    <View style={{ gap: 4 }}>
      {sliderRows.map((row) => {
        const exp = row.export as any;
        const badge = knobBadgeFor(row);
        const matched = !!exp.cpcOwned;
        // no-v0 exclusion (rare — engine now serializes a real v0): the slider
        // has no numeric anchor, so it's NOT knob-mapped and must not be driven.
        // Render it non-interactive with a "—" marker like the deck does.
        const noV0 = badge.excludedReason === 'no-v0';
        const knobExcluded = matched || noV0;
        const niceLabel = prettySliderName(exp.name);
        const hasMapping = !matched && !!mappingByTarget[exp.name];
        // MIDI-map badge — only meaningful for learnable (non-CPC-matched)
        // sliders, matching useMidiControl's focused-export filter. Show the
        // badge when this param already has a binding, or when the channel is
        // editable (has a playlist + active entry) so the operator can add one.
        const midiMapping = !matched ? (midiByTarget[exp.name] ?? null) : null;
        const showMidiBadge = !matched && (!!midiMapping || midiEditable);
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
            {/* Badge row above the MiniFader — the green ◎ modulation pill
                (read-only on the mixer) and the violet ⊞ MIDI pill sit side
                by side so the slider row reads the same way on the deck and
                mixer. CPC-matched sliders still use the MiniFader's own
                `badge` prop because that's a different concept ("the global
                owns this"). The ⊞ badge opens the MIDI-learn popover keyed to
                THIS channel's active playlist entry (editable when the channel
                has a playlist + entry). */}
            {/* Badge row — always rendered so the physical-knob indicator is
                visible on EVERY kind-1 row: a violet "KNOB N" pill on a mapped
                slider (the encoder that drives it), or a "—" marker on a no-v0
                row that consumes no knob. The green ◎ modulation pill + violet
                ⊞ MIDI pill join it when present. (Matched rows carry their MATCH
                tag on the MiniFader itself, so no knob badge there.) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 1 }}>
              {badge.mapped && badge.knobNumber !== null ? (
                <KnobPill knobNumber={badge.knobNumber} />
              ) : null}
              {noV0 ? (
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: C.secondary }}>—</Text>
              ) : null}
              {hasMapping ? (
                <ModulationReadonlyBadge hasMapping={true} isOverride={mappingByTarget[exp.name]?.mode === 'override'} />
              ) : null}
              {hasMapping && ghost !== null ? (
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: '#00a86b' }}>
                  →{ghost.toFixed(2)}
                </Text>
              ) : null}
              {showMidiBadge ? (
                <MidiMapBadge
                  mapping={midiMapping}
                  editable={midiEditable}
                  onEdit={() => setMidiPopoverTarget(exp.name)}
                />
              ) : null}
            </View>
            <View style={{ position: 'relative' }}>
              <MiniFader
                label={niceLabel}
                value={base}
                onChange={(v: number) => onControlChange(channel.id, exp.id, v)}
                disabled={knobExcluded}
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
      {/* N4: non-kind-1 exports (toggles / triggers / hsvPickers) are NOT
          continuous faders — rendering one as a MiniFader used to emit a
          fabricated v0 with v1:0/v2:0 on drag, zeroing an hsvPicker's
          saturation/value. The mixer strip has no controls for these kinds, so
          we surface them as a small non-interactive chip (the operator sees the
          pattern declares them; they're edited from the deck). */}
      {nonFaderExports.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {nonFaderExports.map((exp: any) => (
            <View
              key={exp.id}
              style={{
                paddingHorizontal: 6, paddingVertical: 2,
                borderRadius: 4, borderWidth: 1, borderColor: C.ghostBorder,
                backgroundColor: C.surfaceContainerHigh, opacity: 0.5,
              }}
            >
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 8, color: C.secondary, letterSpacing: 0.4 }} numberOfLines={1}>
                {prettySliderName(exp.name).toUpperCase()} · DECK ONLY
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {/* Single MIDI-learn popover for the whole strip — opened by whichever
          param's ⊞ badge was tapped (keyed by target name). Guarded on
          playlistName + entryId, which are non-null whenever the badge was
          editable (the only way to open it). On save/remove we refresh the
          per-entry bindings so the badge repaints without a full reload. */}
      {midiPopoverTarget && playlistName && entryId ? (
        <MidiMapPopover
          paramName={prettySliderName(midiPopoverTarget)}
          targetParameter={midiPopoverTarget}
          playlistName={playlistName}
          entryId={entryId}
          existing={midiByTarget[midiPopoverTarget] ?? null}
          onClose={() => setMidiPopoverTarget(null)}
          onChanged={refreshMidi}
        />
      ) : null}
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
const ChannelStrip = React.memo(({ channel, index, layerIndex, blends, transitions, isSolo, soloActive, dimmedBySolo, isBumped, onBumpOn, onBumpOff, group, collapsed, isDeck, playlistLibrary, initialPlaylist, cardStyle, isOnlyChannel, activationsLocked, onRename, onFaderChange, onHueChange, onMuteToggle, onSoloToggle, onSoloSafeToggle, onModeChange, onControlChange, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onLockToggle, onFaderLockToggle, onTransition, onTransitionSettingsChange, viewSelectionGroups, viewSelectionViewMasks, onViewSelectionChange }: any) => {
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
  // The MIDI-focused mixer layer (module state shared with the APC track
  // buttons + the MFT). This strip is focused when its 0-based layer index
  // matches. Tapping FOCUS writes the same module state, so touch and the
  // physical controllers always agree on which channel the param faders
  // (4-6/8) drive. `layerIndex` is the 0-based position in the channels array
  // (NOT the 1-based display `index`), matching useMidiControl's focus math.
  //
  // 12a: subscribe to the BOOLEAN "is THIS layer focused?" selector, not the
  // global focus number. React.memo(ChannelStrip) can then re-render only the
  // two strips whose focus actually flips on a focus change — with the numeric
  // selector, every strip re-rendered on any focus change (render churn).
  const isFocused = useIsMidiFocused(layerIndex);
  // Overflow (⋮) menu for the secondary channel-control actions (pin fader,
  // delete). The 2026-06-22 toolbar cleanup keeps only lock, the reorder
  // chevrons, the blend-mode dropdown, and this ⋮ button inline on ONE
  // non-wrapping row; pin + delete move into a centered modal of LABELED rows
  // (icon + text). Same modalOverlay/modalContent pattern as the
  // blend/transition/view pickers for visual consistency.
  const [showActionsMenu, setShowActionsMenu] = useState(false);
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
  // Per-strip refresh nonce passed to PlaylistPanel. The manual ↻ refresh
  // button was removed at operator request (2026-06-22); PlaylistPanel now
  // refreshes on its own (load-on-open + WS reconcile), so this stays a
  // stable seed — the panel no longer needs an operator-driven bump.
  const [refreshNonce] = useState(0);
  // Header collision guard (operator request 2026-06-29): the single-row header
  // (name + GROUP chip on the left, lock · reorder · blend ▾ · ⋮ cluster on the
  // right) collides on a NARROW strip — notably a group member, whose column is
  // split inside the group container and also carries the GROUP chip. We measure
  // the header width and, ONLY when it's too narrow to seat both clusters on one
  // line, fall back to a 2-row header (name row over controls row). Wide strips
  // keep the single row. Threshold ≈ the controls cluster (~190pt) + a usable
  // name min (~150pt).
  const [headerWidth, setHeaderWidth] = useState(0);
  const headerTwoRow = headerWidth > 0 && headerWidth < 340;
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
  // Round8 #1: derive a distinct header title from the channel's content when
  // the operator hasn't set a real name (default-added strips are all minted
  // "New Layer"). A genuine rename always wins (it's a non-placeholder, so
  // deriveChannelTitle returns it verbatim). Feeds the uncontrolled TextInput's
  // defaultValue below — same uncontrolled rename behaviour as before, we only
  // changed what the *initial* value resolves to so the three strips no longer
  // all read "NEW LAYER".
  const derivedTitle = deriveChannelTitle(channel, index, channel.playlist, initialPlaylist);

  // ── Collapsed (thin) strip ──────────────────────────────────────────────
  // When this channel's group is collapsed the operator wants it "left alone":
  // a slim row that still IDENTIFIES the channel (number + name) and keeps the
  // essentials reachable (its CHANNEL level fader + value + Mute/Solo) without
  // the viz / hue / playlist / params / blend / transition chrome. This is a
  // pure early-return inside React.memo — `collapsed` is just another prop, so
  // the memo's referential-equality short-circuit is preserved (the handlers
  // are still the parent's useCallback-stable refs). Touch targets stay ≥44pt
  // via the row minHeight + the toggle hitSlops.
  if (collapsed) {
    // A collapsed group is a NARROW VERTICAL bar (operator request 2026-06-29:
    // "when collapsed the group becomes a vertical bar — thin horizontally —
    // with content stacked vertically"). The parent group container supplies
    // the slim column width; each member renders as ONE tiny vertical cell:
    //   number (top) → a small level indicator (mini fill bar + %) → stacked
    //   M / S toggles.
    // We deliberately DON'T apply cardStyle (which would force a ≥320pt column).
    // The full level fader / viz / hue / playlist / params chrome is dropped —
    // collapsed = "left alone, save space". Tapping the group header expands the
    // whole group back. Touch targets stay ≥44pt via thinVToggle minHeight +
    // the toggle hitSlops.
    const levelPct = Math.round((channel.fader ?? 0) * 100);
    return (
      <View
        style={[
          styles.channelCellV,
          dimmedBySolo ? { opacity: 0.45 } : null,
        ]}
      >
        <View style={[styles.channelBadge, styles.channelBadgeThin]}>
          <Text style={[styles.valueReadout, { color: C.primary, fontSize: 11 }]}>{index}</Text>
        </View>
        {/* Tiny vertical level indicator: a slim track whose fill height tracks
            the channel level, plus a compact % readout below it. Read-only here
            (the full fader returns on expand). */}
        <View style={styles.cellLevelTrack} accessibilityLabel={`Level ${levelPct} percent`}>
          <View style={[styles.cellLevelFill, { height: `${levelPct}%` }]} />
        </View>
        <Text style={[styles.displayMono, { fontSize: 10, textAlign: 'center' }]}>
          {levelPct}
        </Text>
        <TouchableOpacity
          style={[styles.thinVToggle, !channel.enabled && styles.toggleBtnMuted, activationsLocked && { opacity: 0.45 }]}
          hitSlop={ICON_BTN_HIT_SLOP}
          disabled={activationsLocked}
          onPress={() => onMuteToggle(channel.id, !channel.enabled)}
          accessibilityRole="button"
          accessibilityLabel={channel.enabled ? 'Mute channel' : 'Channel muted'}
          accessibilityState={{ selected: !channel.enabled, disabled: !!activationsLocked }}
        >
          <Text style={[styles.labelCaps, { fontSize: 9 }, !channel.enabled && { color: '#FFF' }]}>M</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.thinVToggle, isSolo && { backgroundColor: '#00a86b', borderColor: '#00a86b' }, activationsLocked && { opacity: 0.45 }]}
          hitSlop={ICON_BTN_HIT_SLOP}
          disabled={activationsLocked}
          onPress={() => onSoloToggle(channel.id)}
          accessibilityRole="button"
          accessibilityLabel={isSolo ? 'Solo on' : 'Solo'}
          accessibilityState={{ selected: !!isSolo, disabled: !!activationsLocked }}
        >
          <Text style={[styles.labelCaps, { fontSize: 9 }, isSolo && { color: '#FFF' }]}>S</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[
      styles.channelCard,
      // Group tint (docs/39 §10): a member channel takes its group's color on
      // the left edge so grouped strips read together at a glance. The lock
      // border (operator-critical) wins over it. (Per-channel color coding was
      // removed at operator request 2026-06-22.)
      !locked && group?.color ? { borderColor: group.color, borderLeftWidth: 4 } : null,
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
      {/* Header — title bar buttons share one geometry (28×28 squircle,
          identical surface / border) so they read as a single toolbar.
          Pre-May-2026 refresh was 22×22 + pinned to the name, lock was
          28×28 + pinned to the right. Operator feedback "make them
          look exactly the same" drove this unification. */}
      <View
        style={[
          styles.channelHeader,
          // Narrow strip ⇒ stack into 2 rows so the name and the control
          // cluster stop colliding (operator request 2026-06-29). Wide strips
          // keep the single row.
          headerTwoRow && { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
        ]}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          // Hysteresis-free: only update on a real change to avoid layout loops.
          setHeaderWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
        }}
      >
        {/* Name + badges take the left of the single header row and flex to
            fill the space left of the control cluster; minWidth:0 lets the
            name truncate instead of pushing the buttons off the edge. In the
            2-row fallback this is the FULL-WIDTH first row. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: headerTwoRow ? undefined : 1, minWidth: 0 }}>
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
            style={[styles.headlineSm, { fontSize: 14, color: C.text, flex: 1, padding: 0 }, activationsLocked && { opacity: 0.45 }]}
            // Soft PLAN lock: renaming is a channel edit — read-only until the
            // operator takes over (editable=false blocks focus/typing on both
            // native and react-native-web).
            editable={!activationsLocked}
            defaultValue={derivedTitle}
            // Commit the rename on BLUR (and on Enter via onSubmitEditing).
            //
            // ROOT CAUSE of the "renamed channels not picked up in the group UI"
            // bug, confirmed two layers deep:
            //   1. react-native-web (0.21.2, the CaptainPad web/iPad build)
            //      DOES NOT wire `onEndEditing` at all — its TextInput only
            //      forwards onBlur + onSubmitEditing (see RNW
            //      exports/TextInput/index.js handleBlur/handleKeyDown). So the
            //      old `onEndEditing` rename handler NEVER FIRED on web: no
            //      PATCH, no broadcast, nothing — the strip's own field only
            //      "looked right" because it's an UNCONTROLLED input keeping the
            //      typed text. onBlur fires on BOTH web and native, so it's the
            //      portable commit hook.
            //   2. Even where it did fire (native), there was no optimistic
            //      update to the parent `channels` state, so every surface that
            //      derives a display name from it — the group rail member chips,
            //      the assign picker, the per-strip GROUP badge — stayed stale
            //      until a broadcast/fetch.
            // The fix addresses both: commit on onBlur/onSubmitEditing, and hand
            // the rename UP to the parent (onRename) which applies it
            // OPTIMISTICALLY to `channels` BEFORE the PATCH (mirroring every
            // other control) so the new name shows everywhere immediately; the
            // PATCH stays the persistence path and the next broadcast reconciles.
            // We register onEndEditing (native iPad — fires with nativeEvent.text),
            // onSubmitEditing (Enter key, both platforms), AND onBlur (the ONLY
            // one RNW forwards on the web build). A rename may fire more than one
            // of these; onRename is idempotent (same setChannels map + PATCH), so
            // a duplicate commit is harmless. We guard against an undefined text
            // (native onBlur's nativeEvent may omit it) so we never PATCH a name
            // of `undefined`.
            onEndEditing={(e) => { const t = e.nativeEvent?.text; if (t != null) onRename(channel.id, t); }}
            onSubmitEditing={(e) => { const t = e.nativeEvent?.text; if (t != null) onRename(channel.id, t); }}
            // RN types `onBlur` as a TargetedEvent (no `text`); RNW DOES set
            // nativeEvent.text on blur (see RNW TextInput handleBlur), so read it
            // through a narrowed cast rather than widening the handler to `any`.
            onBlur={(e) => { const t = (e.nativeEvent as { text?: string })?.text; if (t != null) onRename(channel.id, t); }}
            placeholderTextColor={C.icon}
          />
        </View>
        {/* Channel-control button row (2026-06-22 UI cleanup, refined). ONE
            compact, NON-WRAPPING line of high-frequency controls: the lock
            toggle, the reorder chevrons (⌃ up / ⌄ down), the SCREEN▾ blend-mode
            dropdown, and a trailing ⋮ overflow button. Color coding, refresh,
            and duplicate were removed at operator request; pin-fader and delete
            live in the ⋮ menu as LABELED rows. The per-button 28pt squircles +
            their ICON_BTN_HIT_SLOP keep every target ≥44pt. */}
        <View style={{ flexDirection: 'row', flexShrink: 0, columnGap: 4, alignItems: 'center', justifyContent: headerTwoRow ? 'flex-start' : 'flex-end' }}>
          {/* Lock (playlist/pattern lock) — amber when engaged. Gated under
              the soft PLAN lock: toggling it changes save/edit behaviour. */}
          <TouchableOpacity
            style={[styles.titleBtn, locked && styles.titleBtnAmberActive, activationsLocked && { opacity: 0.45 }]}
            hitSlop={ICON_BTN_HIT_SLOP}
            disabled={activationsLocked}
            onPress={() => onLockToggle(channel.id, !locked)}
            accessibilityLabel={locked ? 'Unlock channel' : 'Lock channel'}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!activationsLocked }}
          >
            <IconSymbol name={locked ? 'lock.fill' : 'lock.open.fill'} size={14} color={locked ? '#F5A623' : C.secondary} />
          </TouchableOpacity>
          {/* Reorder chevrons — kept inline (operator request 2026-06-22):
              up = toward the TOP of the mix, down = toward the bottom.
              Disabled at the ends of the stack. Non-destructive, NOT gated
              by the channel lock. */}
          {onMoveUp && (
            <TouchableOpacity
              style={[styles.titleBtn, (!canMoveUp || activationsLocked) && { opacity: 0.3 }]}
              hitSlop={ICON_BTN_HIT_SLOP}
              // Reorder changes the composite order of the live mix — gated
              // under the soft PLAN lock with the other channel edits.
              disabled={!canMoveUp || activationsLocked}
              onPress={() => onMoveUp(channel.id)}
              accessibilityLabel="Move channel up (toward top of mix)"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canMoveUp || !!activationsLocked }}
            >
              <IconSymbol name="chevron.up" size={14} color={C.secondary} />
            </TouchableOpacity>
          )}
          {onMoveDown && (
            <TouchableOpacity
              style={[styles.titleBtn, (!canMoveDown || activationsLocked) && { opacity: 0.3 }]}
              hitSlop={ICON_BTN_HIT_SLOP}
              disabled={!canMoveDown || activationsLocked}
              onPress={() => onMoveDown(channel.id)}
              accessibilityLabel="Move channel down (toward bottom of mix)"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canMoveDown || !!activationsLocked }}
            >
              <IconSymbol name="chevron.down" size={14} color={C.secondary} />
            </TouchableOpacity>
          )}
          {/* Blend-mode ("SCREEN ▾") dropdown — gated under the soft PLAN lock
              in addition to the channel lock: it changes how this channel
              composites into the live mix. */}
          <TouchableOpacity
            style={[styles.modeDropdown, activationsLocked && { opacity: 0.45 }]}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            disabled={activationsLocked}
            onPress={() => { if (!locked && !activationsLocked) setShowBlendPicker(true); }}
            activeOpacity={locked ? 1.0 : 0.2}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!activationsLocked }}
            accessibilityLabel={`Blend mode: ${(channel.mode || 'normal').replace('blend_', '')}`}
          >
            <Text style={[styles.valueReadout, { color: locked ? C.secondary : C.primary, fontSize: 11 }]}>{(channel.mode || 'normal').replace('blend_', '').toUpperCase()}{locked ? '' : ' ▾'}</Text>
          </TouchableOpacity>
          {/* Overflow ⋮ — vertical three-dot "more" affordance; opens the
              secondary-actions menu (pin fader, delete). Both actions mutate
              the channel, so the entry button is gated under the soft PLAN
              lock. */}
          <TouchableOpacity
            style={[styles.titleBtn, activationsLocked && { opacity: 0.45 }]}
            hitSlop={ICON_BTN_HIT_SLOP}
            disabled={activationsLocked}
            onPress={() => setShowActionsMenu(true)}
            accessibilityLabel="More channel actions"
            accessibilityRole="button"
            accessibilityState={{ disabled: !!activationsLocked }}
          >
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.secondary }}>⋮</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Channel-actions overflow menu ────────────────────────────────
          The secondary channel-control actions that used to crowd the
          toolbar, now as LABELED rows (icon + text) in a centered modal.
          REUSES the modalOverlay/modalContent pattern (absolute inset-0 +
          0.7 backdrop) so it reads the same as the blend/transition/view
          pickers and never clips. Each row is ≥44pt tall and preserves the
          exact handler + gating of the original icon button. */}
      <Modal transparent visible={showActionsMenu} animationType="fade" onRequestClose={() => setShowActionsMenu(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowActionsMenu(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalContent}>
              <Text style={[styles.labelCaps, { marginBottom: 12 }]}>CHANNEL ACTIONS</Text>
              {/* Pin fader (fader-lock, slot 5). When ON the engine ignores
                  manual fader writes and skips scripted transitions on this
                  channel; the client-side solo handler also skips it. */}
              {onFaderLockToggle && (
                <TouchableOpacity
                  style={styles.actionsMenuRow}
                  onPress={() => { onFaderLockToggle(channel.id, !faderLocked); setShowActionsMenu(false); }}
                  accessibilityLabel={faderLocked ? 'Unpin fader' : 'Pin fader'}
                  accessibilityRole="button"
                >
                  {/* QA round 10 fix #5: the icon must agree with the label.
                      "Pin fader" (action, currently unpinned) → a NON-slashed
                      pin. The slashed variant reads as "unpin/off", so reserve
                      it for the toggled-ON "Unpin fader" state (label flips
                      too). */}
                  <IconSymbol
                    name={faderLocked ? 'pin.slash.fill' : 'pin.fill'}
                    size={16}
                    color={faderLocked ? C.primary : C.secondary}
                  />
                  <Text style={styles.actionsMenuLabel}>{faderLocked ? 'Unpin fader' : 'Pin fader'}</Text>
                </TouchableOpacity>
              )}
              {/* Round8 #5: separate the destructive Delete from Pin fader with
                  a divider + ≥16px gap so it can't be hit by a mis-tap meant for
                  Pin (they were stacked 4px apart). The engine forbids deleting
                  the LAST channel, so when this is the only channel we render
                  Delete greyed + disabled (rather than hidden) so the operator
                  sees WHY it's unavailable instead of the row silently vanishing.
                  Still hidden entirely when the channel is locked — same gating
                  as the original icon button. */}
              {onDelete && !locked && (
                <>
                  <View style={styles.actionsMenuDivider} />
                  <TouchableOpacity
                    style={[styles.actionsMenuRow, styles.actionsMenuRowDestructive, isOnlyChannel && { opacity: 0.4 }]}
                    onPress={() => { if (isOnlyChannel) return; onDelete(channel.id); setShowActionsMenu(false); }}
                    disabled={!!isOnlyChannel}
                    accessibilityLabel={isOnlyChannel ? 'Delete channel (unavailable — at least one channel must remain)' : 'Delete channel'}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !!isOnlyChannel }}
                  >
                    <IconSymbol name="trash" size={16} color={C.error} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.actionsMenuLabel, { color: C.error }]}>Delete channel</Text>
                      {isOnlyChannel ? (
                        <Text style={styles.actionsMenuHint}>At least one channel must remain</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Pixel Visualization — self-subscribing per-channel strip so a
          new viz frame re-renders ONLY this tiny component, not the whole
          strip list (see ChannelVizStrip + the perf note on the mixer
          screen's viz handling).

          The per-channel strip renders the channel's TRUE pattern at full
          brightness, INDEPENDENT of the channel fader / solo / mute (operator
          request 2026-06-29): every layer's vis stays active so the operator
          can read each pattern and tune live, matching the (perfect) master
          strip. The fader's effect on the mix is shown by the master/preDimmer
          preview + the fader value — not by dimming this strip. (Replaces the
          Round8 effective-output greying, which dimmed/greyed this strip with
          the fader and read as "the channel vis is affected by the fader".) */}
      <View style={{ marginBottom: 6 }}>
        <ChannelVizStrip vizKey={channel.id} height={14} />
      </View>

      {/* Level Fader. `fader` is null-coalesced to 0 for display ONLY —
          a broadcast that omits it shows an empty fader rather than NaN%
          (which RN would render as the literal text "NaN"). The engine is
          the source of truth and normally always sends fader. */}
      {/* QA round 10 fix #3: this top fader and the LOCAL PARAMS "LEVEL" slider
          both read "LEVEL" in the same card — contradictory (one at 0, one at
          100). This is the strip's CHANNEL fader (its mix contribution), so we
          label it "CHANNEL" to disambiguate; LOCAL PARAMS keeps "LEVEL" (the
          pattern's own param). Behavior unchanged — label only. */}
      <View style={styles.levelRow}>
        <Text style={[styles.labelCaps, { width: 66 }]} numberOfLines={1}>CHANNEL</Text>
        <HorizontalFader
          value={channel.fader ?? 0}
          // Under the soft PLAN lock the channel fader is an activation control
          // (it changes the mix) — gate the write + dim the track so it reads
          // disabled. Taking over re-enables it (parent clears activationsLocked).
          onChange={(v: number) => { if (!activationsLocked) onFaderChange(channel.id, v); }}
          trackStyle={[styles.faderTrack, { flex: 1, marginHorizontal: 6, opacity: activationsLocked ? 0.45 : 1 }]}
          fillStyle={styles.faderFill}
          // QA round 10 fix #6: visible grabbable thumb so the channel fader
          // reads as draggable at 0 (empty track) and 100 (solid fill), matching
          // the HUE fader's handle below and the master/deck thumbs.
          thumbStyle={styles.channelFaderThumb}
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
          {/* Physical-knob badge on the FOCUSED strip only: the MFT hue knob
              (knob 2) drives the FOCUSED CHANNEL's per-channel hue — this
              exact trim on the mixer tab (on the deck tab it drives the DECK
              CHANNEL's hue, badged on the deck's DeckHueRow; hue is
              per-channel only — the global shifter was removed 2026-07).
              The badge follows focus so it always sits
              on the control the knob is live on (push = reset this to 0°). */}
          {isFocused ? <KnobPill knobNumber={globalKnobNumber('hue')} style={{ marginRight: 4 }} /> : null}
          <Text style={[styles.labelCaps, { width: 52, fontSize: 10 }]}>HUE</Text>
          {/* QA round 10 fix #4: the swatch is now a CIRCLE (was a rounded
              square that mimicked the destructive Blackout/Invert chips and
              read as tappable). A circle reads as a non-interactive status dot,
              matching the deck HUE row (deck_hue_row.tsx). */}
          <View
            style={[
              styles.hueSwatch,
              { backgroundColor: `hsl(${Math.round(channel.hue ?? 0)}, 80%, 55%)` },
            ]}
            accessibilityLabel={`Current channel hue ${Math.round(channel.hue ?? 0)} degrees`}
          />
          <HorizontalFader
            value={(channel.hue ?? 0) / 360}
            // Soft PLAN lock: the per-channel HUE trim changes the live output,
            // so it's gated alongside the channel fader / local params.
            onChange={(v: number) => { if (!locked && !activationsLocked) onHueChange(channel.id, Math.round(v * 360)); }}
            trackStyle={[styles.hueTrack, { flex: 1, marginHorizontal: 6, opacity: (locked || activationsLocked) ? 0.5 : 1 }]}
            fillStyle={styles.hueFill}
            // QA round 11 fix: a visible grabbable thumb so the HUE fader reads
            // as draggable at 0° (empty track) instead of looking inert (the
            // red swatch to its left is a non-interactive status dot, not a
            // handle). Matches the channel/level fader + deck HUE row.
            thumbStyle={styles.channelFaderThumb}
          />
          {/* QA round 10 fix #4: HUE is an angle — show the "°" unit so the
              value reads as degrees, matching the deck HUE row + ColorPicker. */}
          <Text style={[styles.displayMono, { width: 32, textAlign: 'right', fontSize: 11, color: C.secondary }]}>
            {Math.round(channel.hue ?? 0)}°
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
            // Soft PLAN lock: pattern/entry selection changes what's playing —
            // same gate the deck's PlaylistPanel already carries. Taking over
            // re-enables it.
            disabled={activationsLocked}
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
              {/* Row-0 globals (knob 1 SPEED, knob 2 HUE) are NOT re-legended
                  here — their canonical UI elements wear the KNOB badges
                  directly (SPEED on the GLOBALS-row fader, HUE on this focused
                  strip's own per-channel HUE trim above). The old read-only
                  MftGlobalsRow duplicate was removed 2026-07 per operator
                  request — no duplicate speed/hue UI. */}
              <MixerLocalParams channel={channel} onControlChange={onControlChange} disabled={activationsLocked} />
            </View>
          </ScrollView>
        </View>
      </View>

      {/* ── Bottom action rows: full strip width ─────────────────────── */}
      <View style={styles.muteSoloRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, !channel.enabled && styles.toggleBtnMuted, activationsLocked && { opacity: 0.45 }]}
          disabled={activationsLocked}
          accessibilityState={{ disabled: !!activationsLocked }}
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
          style={[styles.toggleBtn, isSolo && { backgroundColor: '#00a86b', borderColor: '#00a86b' }, activationsLocked && { opacity: 0.45 }]}
          disabled={activationsLocked}
          onPress={() => onSoloToggle(channel.id)}
          accessibilityRole="button"
          accessibilityLabel={isSolo ? 'Solo on' : 'Solo'}
          accessibilityState={{ selected: !!isSolo, disabled: !!activationsLocked }}>
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
            style={[styles.toggleBtn, isBumped && styles.toggleBtnBump, activationsLocked && { opacity: 0.45 }]}
            disabled={activationsLocked}
            onPressIn={() => { if (!activationsLocked) onBumpOn(channel.id); }}
            onPressOut={() => { if (!activationsLocked) onBumpOff(channel.id); }}
            hitSlop={ICON_BTN_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={isBumped ? 'Bump held' : 'Bump (hold for full)'}
            accessibilityState={{ selected: !!isBumped, disabled: !!activationsLocked }}>
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
              activationsLocked && { opacity: 0.45 },
            ]}
            // Soft PLAN lock: solo-safe changes how solos gate this channel's
            // live contribution — locked with the other activation controls.
            disabled={activationsLocked}
            onPress={() => onSoloSafeToggle(channel.id, !soloSafe)}
            accessibilityRole="button"
            accessibilityLabel={soloProtected ? 'Solo-safe on' : 'Solo-safe'}
            accessibilityState={{ selected: soloProtected, disabled: !!activationsLocked }}>
            <Text style={[styles.labelCaps, { fontSize: 9 }, soloProtected && { color: C.primary }]}>
              {soloProtected ? (faderLocked && !soloSafe ? 'SAFE (LOCK)' : 'SAFE ✓') : 'SAFE'}
            </Text>
          </TouchableOpacity>
        )}

        {/* FOCUS — the on-screen twin of the APC track-button focus. Lit
            (violet, matching the ⊞ MIDI accent) when THIS layer is the one the
            MIDI param faders (4-6/8) drive. Writes the shared module focus
            state via setMidiFocus(layerIndex), so touch + APC track button +
            MFT all agree on the focused channel — one focused overlay at a
            time. */}
        <TouchableOpacity
          style={[styles.toggleBtn, isFocused && { backgroundColor: MIDI_VIOLET, borderColor: MIDI_VIOLET }]}
          onPress={() => setMidiFocus(layerIndex)}
          accessibilityRole="button"
          accessibilityLabel={isFocused ? 'This channel is MIDI-focused' : 'Focus this channel for MIDI param faders'}>
          <Text style={[styles.labelCaps, isFocused && { color: '#FFF' }]}>Focus</Text>
        </TouchableOpacity>

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
              style={[styles.toggleBtn, viewSel.type !== 'all' && { backgroundColor: C.primary, borderColor: C.primary }, activationsLocked && { opacity: 0.45 }]}
              // Soft PLAN lock: view selection re-targets which pixels this
              // channel drives — a live-mix change.
              disabled={activationsLocked}
              accessibilityState={{ disabled: !!activationsLocked }}
              onPress={() => setShowViewPicker(true)}>
              {/* Round8 #4: the "VIEW:" prefix pushed "ALL" off the end of the
                  narrow toggle ("VIEW: A…"). Drop the prefix and show just the
                  scope + a ▾ caret so it reads as one clean line matching the
                  MUTE/SOLO/BUMP/SAFE siblings. */}
              <Text
                style={[styles.labelCaps, viewSel.type !== 'all' && { color: '#FFF' }, { fontSize: 9 }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {viewSelLabel} ▾
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
        // Soft PLAN lock: the whole transition row (TRANSITION trigger, style
        // dropdown, duration wheel) drives/tunes live-mix fades, so it's gated
        // as one section — pointerEvents 'none' stops every interactive child
        // (button, dropdown, and the TimerWheel's scroll), the dim marks it
        // disabled. No PANIC/BLACKOUT lives here.
        <View
          pointerEvents={activationsLocked ? 'none' : 'auto'}
          style={[styles.transitionBar, activationsLocked && { opacity: 0.45 }]}
        >
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
  // In-flight grand-master fade (shared hook) — drives the smooth master-slider
  // animation + the FADING tint while a TO BLACK / UP is running.
  const masterFade = useMasterFade();
  const fading = masterFade?.active === true;
  // Channel groups (gang-faders) + server-authoritative solo (docs/39 §10).
  // Both are reconciled DISPLAY-ONLY from the `mixer` broadcast's top-level
  // `mixGroups[]` + `soloedChannelIds[]` — the engine is the authority. The
  // soloed set is a Set<string> for O(1) per-strip membership checks; per-
  // channel `mixGroupId`/`soloSafe` ride on the channel objects themselves.
  const [mixGroups, setMixGroups] = useState<MixGroup[]>([]);
  const [soloedIds, setSoloedIds] = useState<Set<string>>(new Set());
  // Per-group COLLAPSE state (operator request 2026-06-29: "make the group
  // name when clicked collapse the channels to a thin channel"). This is a
  // VIEW-ONLY, session-scoped preference held entirely in the mixer screen —
  // it never touches the engine (the engine has no concept of a collapsed
  // group, and the broadcast reconciles the registry, not the operator's
  // local fold state). A Set<groupId> of the groups whose member channels
  // should render as thin strips; absent = expanded (full cards).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroupCollapse = useCallback((gid: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid); else next.add(gid);
      return next;
    });
  }, []);
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
  // ── Operator takeover (requests #3/#5) ─────────────────────────────────
  // A manual touch here while a plan is driving the rig is a takeover:
  // notifyInteraction() fires the takeover ONCE then keeps the lease alive
  // (throttled) on continued interaction. Plan/lease/countdown status is
  // surfaced by the floating PlanLockBanner overlay (top-right) — the old
  // inline header chips + PlanIndicatorPill were removed 2026-07-02 so the
  // header fits one row on an iPad.
  const { leaseHeld, notifyInteraction } = useOperatorTakeover();
  // ── Soft PLAN lock (CONTRACT: globalsState.controlLock ∈ {null,'portwatch',
  // 'plan'}) ──────────────────────────────────────────────────────────────
  // 'portwatch' stays the FULL hard lockout (EngineLockoutOverlay, tab layout).
  // 'plan' is the SOFTER lock: a yellow PlanLockBanner + the channel ACTIVATION
  // controls (fader / mute / solo / bump / live params) disabled, while
  // navigation, scrolling and read-only viewing stay live. Taking over (any
  // control touch fires the operator lease) clears the gate and re-enables them.
  const { planLocked } = useEngineLock();
  const activationsLocked = planLocked && !leaseHeld;
  // ── Entering the mixer while a plan forces the deck (CP-VIEWSWITCH) ─────
  // `forcingDeckView` (engine, on timelineState) = plan active AND output
  // pinned to the deck under plan control. The old behaviour popped a blue
  // confirm modal ("TAKE OVER / STAY ON PLAN") with a 60s auto-return timer.
  // Operator request 2026-07-02: KILL the modal. Entering the mixer while the
  // plan drives the deck just shows the mixer READ-ONLY under the yellow
  // PlanLockBanner + scrim; the banner's TEMPORARY TAKE OVER button is the one
  // and only takeover affordance (see handleMixerTakeover below), so both
  // surfaces share the same takeover UX.
  const { state: timelineState, takeover: timelineTakeover } = useTimeline();
  // Guard so the on-focus output switch runs ONCE per mixer-tab entry (and so
  // our own takeover can't re-trigger it). Reset on blur.
  const viewGateHandledRef = useRef(false);
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

  // Group rail / assign-picker channel list with a DISPLAY name derived the
  // same way the channel strips do (deriveChannelTitle): a default-added strip
  // is minted with the literal name "New Layer", so the group chips + the
  // "ADD CHANNEL" picker used to read three identical "New Layer" rows. We
  // resolve each to its active playlist entry / playlist name / "Ch N" so the
  // operator can tell members apart. A genuine rename still wins. Re-derives
  // when channels or the inline playlists change.
  const groupRailChannels = useMemo(() => {
    void inlinePlaylistVersion;
    return channels.map((ch, idx) => ({
      id: ch.id,
      mixGroupId: ch.mixGroupId,
      name: deriveChannelTitle(ch, idx + 1, ch.playlist, inlinePlaylistRef.current.get(ch.id) || null),
    }));
  }, [channels, inlinePlaylistVersion]);
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

  // TEMPORARY TAKE OVER (mixer variant) — handed to the PlanLockBanner. Engage
  // the operator lease, UNLOCK the controls, AND put the live output on the
  // mixer so the operator's CHANNELS drive the lights.
  //
  // Operator request 2026-07-03: a mixer takeover used to leave the output on
  // the DECK (the plan was driving the base channel), so the exterior kept
  // playing the plan's base look — "some random master" — while the operator's
  // mixer-fader moves did nothing visible. Switching to the mixer here makes the
  // takeover WYSIWYG: what you mix is what shows.
  //
  // Ordering is race-free: the takeover POST clears the plan's deck-pin, and
  // that release runs to completion (microtask drain) BEFORE the engine can
  // process the next request — so the /mixer/view write below always lands on
  // the LIVE fader (→ mixer, targetViewFader 1.0), never gets swallowed as a
  // saved-only value.
  //
  // Trade-off the operator accepted: this is a DELIBERATE manual takeover, so if
  // every mixer channel sits at fader 0 the exterior goes dark until they raise
  // one. The never-dark mission rule governs AUTONOMOUS/plan behavior — not a
  // hands-on operator who chose to grab the mixer.
  const handleMixerTakeover = useCallback(async () => {
    const ok = await timelineTakeover();
    if (!ok) {
      Alert.alert('Take over failed', 'The engine rejected the takeover. The plan may still be running.');
      return;
    }
    await setMixerView('mixer');
  }, [timelineTakeover]);

  // On mixer-tab focus, switch the engine output to the mixer — but ONLY when
  // NO plan is driving the rig. Bug 2026-07-02: this used to fire off a ref
  // that was still `undefined` (falsey) before the first timelineState arrived,
  // so entering the mixer while a plan drove the DECK yanked the output to the
  // (empty, fader-0) mixer view and blacked the whole rig out — even on
  // takeover. Now we WAIT for the state, and while a plan is active
  // (planActive) we leave the output on the deck (the live look stays up); the
  // operator flips the DECK/MIXER toggle if they actually want mixer output.
  const isMixerFocusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      // Switch the MIDI controller to its Mixer mapping context. setMixerView
      // is deferred to the plan-gated effect below (main's blackout fix), so we
      // no longer yank the output to the mixer directly on tab focus.
      setMidiActiveContext('mixer');
      isMixerFocusedRef.current = true;
      viewGateHandledRef.current = false; // re-evaluate the switch each entry
      return () => { isMixerFocusedRef.current = false; };
    }, [])
  );
  useEffect(() => {
    if (!isMixerFocusedRef.current || viewGateHandledRef.current) return;
    if (!timelineState) return; // wait for the first state before deciding
    viewGateHandledRef.current = true;
    // Switch to mixer output ONLY when the rig is truly free — no plan driving
    // AND no operator takeover in progress. Under a lock OR a takeover, leave
    // the output on the (lit) deck so we never black the rig out; the operator
    // flips the DECK/MIXER toggle for mixer output.
    if (timelineState.planActive !== true && !leaseHeld) setMixerView('mixer');
  }, [timelineState, leaseHeld]);

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
    notifyInteraction();
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
  }, [notifyInteraction]);

  const handleMuteToggle = useCallback(async (channelId: string, enabled: boolean) => {
    notifyInteraction();
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
  }, [notifyInteraction]);

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
    notifyInteraction();
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
  }, [soloedIds, notifyInteraction]);

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
    notifyInteraction();
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
  }, [notifyInteraction]);

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
    notifyInteraction();
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
  }, [notifyInteraction]);

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
    notifyInteraction();
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
  }, [notifyInteraction]);

  // Channel rename — OPTIMISTIC parent update (bug fix 2026-06-29). Every
  // other control (fader/mode/soloSafe/lock/hue) writes `channels`
  // optimistically; rename was the lone exception — it only fired the PATCH
  // and waited on the WS `mixer` broadcast. The channel STRIP looked correct
  // because its name field is an UNCONTROLLED TextInput (defaultValue showing
  // the typed text), but every OTHER surface that derives a display name from
  // the parent `channels` state — the group rail member chips, the assign
  // picker, the per-strip GROUP badge — read the stale pre-rename name until a
  // broadcast/fetch landed (and never re-rendered if the broadcast was missed).
  // Updating `channels` here makes the new name reflect IMMEDIATELY everywhere
  // the `groupRailChannels` memo (deriveChannelTitle) and the strips read from;
  // the PATCH stays the persistence path and the next broadcast reconciles.
  // Name is cosmetic (not operator-critical) so a rejected PATCH is logged, not
  // Alerted — matching the old onEndEditing behaviour.
  const handleRename = useCallback(async (channelId: string, name: string) => {
    setChannels(chs => chs.map(c => c.id === channelId ? { ...c, name } : c));
    const res = await updateMixerChannel(channelId, { name });
    if (!res.ok) console.error(`[Mixer] Channel rename rejected for ${channelId}:`, res.error);
  }, []);

  const handleControlChange = useCallback((channelId: string, controlId: number, val: number) => {
    notifyInteraction();
    setChannels(chs => chs.map(c => {
      if (c.id !== channelId) return c;
      return { ...c, exports: (c.exports || []).map((e: any) => e.id === controlId ? { ...e, v0: val } : e) };
    }));
    if (!engineEvents.send({ type: 'setChannelControl', channelId, id: controlId, v0: val, v1: 0, v2: 0 })) {
      setMixerChannelControl(channelId, controlId, val, 0, 0);
    }
  }, [notifyInteraction]);

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
    // Soft PLAN lock — the fader is pointerEvents-blocked while gated; this
    // is the belt-and-suspenders write-path gate.
    if (activationsLocked) return;
    notifyInteraction();
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
  // Channel-grouping UI now lives in a floating modal launched from the
  // GROUPS button on the GLOBALS row (2026-06-28 UI refactor) instead of an
  // always-on full-width rail — reclaims the vertical space.
  const [groupsModalOpen, setGroupsModalOpen] = useState(false);
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
      {/* Soft PLAN lock banner — low-key YELLOW, non-blocking (box-none), only
          mounts when controlLock === 'plan'. Navigation/viewing/scrolling stay
          live; the channel ACTIVATION controls (fader/mute/solo/bump/params)
          are the only thing disabled (per ChannelStrip activationsLocked). The
          full red portwatch lockout stays in the tab layout. */}
      <PlanLockBanner onTemporaryTakeOver={handleMixerTakeover} />
      {/* ── Plan-lock content region ──────────────────────────────────
          Header + master strip + channel strips live inside this relative
          wrapper so the PlanLockScrim (bottom of the wrapper) hermetically
          blankets every mutating mixer control with ONE tap-catching layer —
          future-proof, and a backstop for any control that doesn't wire its
          own `activationsLocked`. The floating PlanLockBanner (above) and the
          bottom safety bar (PANIC/BLACKOUT, a sibling BELOW) stay OUTSIDE. */}
      <View style={{ flex: 1, position: 'relative' }}>
      {/* ── Top Header Bar ─────────────────────────────────────────── */}
      <View style={[styles.header, isPortrait && { paddingHorizontal: 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 8 : 16 }}>
          <Text style={[styles.brandText, isPortrait && { fontSize: 16 }]}>Marsin Mixer</Text>
          <View style={[styles.statusBadge, isPortrait && { paddingHorizontal: 8, paddingVertical: 4 }]}>
            <View style={[styles.statusDot, !isConnected && {backgroundColor: C.error}]} />
            {/* Connection label — ALWAYS rendered (both orientations), mirroring
                the deck top bar (DeckTopBar.tsx). A bare dot is not an acceptable
                disconnect indicator: the OFFLINE state especially must read as a
                WORD, never a single red pixel (QA round 10 fix #1). */}
            <Text style={[styles.labelCaps, {color: isConnected ? '#00a86b' : C.error}]}>
              {isConnected ? 'CONNECTED' : 'OFFLINE'}
            </Text>
          </View>
          {/* Active model chip — secondary status, after the connection pill.
              Hidden only until the /status probe resolves / while offline (same
              graceful-degrade posture as the OFFLINE pill).
              Round8 #7: previously this was landscape-only, so the operator lost
              the model readout when they rotated to portrait. It's now shown in
              BOTH orientations for consistency, just de-emphasized in portrait —
              the "MODEL" caps label is dropped and the chip tightens so it stays
              subtle in the narrow header while still telling the operator which
              model is live. */}
          {activeModel ? (
            <View style={[styles.modelChip, isPortrait && { paddingHorizontal: 8, paddingVertical: 4, maxWidth: 120 }]}>
              {!isPortrait && <Text style={styles.labelCaps}>MODEL</Text>}
              <Text style={[styles.modelName, isPortrait && { fontSize: 10 }]} numberOfLines={1}>{activeModel}</Text>
            </View>
          ) : null}
          {/* Engine-health warning — renders NOTHING when healthy (no layout
              shift); shows an amber "⚠ DEGRADED" chip only when the engine
              reports a degrade on /status. See HealthChip / useEngineHealth. */}
          <HealthChip compact={isPortrait} />
          {/* Named-look snapshots (docs/39 §8.1): capture the full mixer
              state under a name + recall/delete saved looks. Reconciles
              from the WS `snapshots` event. Hidden in portrait to keep the
              narrow header uncrowded (matches the model chip's behaviour).
              RECALL/CAPTURE rebuild the live mix, so they're gated under the
              soft PLAN lock with the rest of the mutating controls. */}
          {!isPortrait ? <SnapshotBar disabled={activationsLocked} /> : null}
          {/* Plan-lock / takeover status moved OUT of this row (operator
              request 2026-07-02: the header must fit ONE row on an iPad).
              The inline "PLAN LIVE · CONTROLS LOCKED" chip, the "TOOK OVER ·
              RESUMES M:SS · RESUME NOW" chip, and the PlanIndicatorPill all
              used to stack here and crowded the row. Both states now surface
              as the floating PlanLockBanner overlay (top-right, on TOP of the
              header — zero row width), which carries the lease countdown +
              RESUME NOW when taken over. */}
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
              style={[styles.clearSoloBtn, isPortrait && { paddingHorizontal: 6, paddingVertical: 6 }, activationsLocked && { opacity: 0.45 }]}
              onPress={handleClearAllSolo}
              // Soft PLAN lock: clearing solos changes the live mix, same as
              // the per-strip SOLO buttons it undoes.
              disabled={activationsLocked}
              accessibilityRole="button"
              accessibilityState={{ disabled: activationsLocked }}
              accessibilityLabel="Clear all solos"
            >
              <Text style={[styles.labelCaps, { color: '#FFF' }, isPortrait && { fontSize: 9 }]}>
                {isPortrait ? 'CLR SOLO' : 'CLEAR SOLO'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {/* Timed grand-master FADE (TO BLACK / UP) — the SAME shared
              MasterFadeGroup the deck top bar renders, so the two surfaces
              never drift. Gated under the soft PLAN lock (the e-stop BLACKOUT
              in the rig bar stays live — this is the timed fade, not the
              safety cut). */}
          <MasterFadeGroup isPortrait={isPortrait} disabled={activationsLocked} />
          {/* MASTER label + fader + readout travel together as one cluster so
              they never split across a wrap and the value keeps a reserved
              column (no more cramped overlap with the slider). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: isPortrait ? 6 : 10 }}>
            {/* MASTER label — ALWAYS rendered (both orientations), mirroring the
                deck top bar (QA round 10 fix #2). Portrait used to drop it,
                leaving the highest-consequence fader on the surface as an
                unlabeled bare strip. */}
            <Text style={styles.labelCaps}>MASTER</Text>
            {/* Soft PLAN lock: pointerEvents 'none' blocks the fader's
                PanResponder entirely (a gated onChange alone would still let
                the thumb track the finger locally — a visual lie); the dim
                marks it disabled. Broadcast sync / fade animation stay live so
                plan-driven master moves still show. */}
            <View
              pointerEvents={activationsLocked ? 'none' : 'auto'}
              style={activationsLocked ? { opacity: 0.45 } : null}
            >
              <HorizontalFader
                value={master}
                onChange={handleMasterChange}
                // Smoothly animate the slider during a timed fade (shared with the
                // deck) instead of snapping to each broadcast value.
                fadingTarget={fading ? masterFade?.to : null}
                fadingDurationMs={masterFade?.remainingMs}
                trackStyle={[styles.faderTrack, { width: isPortrait ? 120 : 160 }]}
                fillStyle={[styles.faderFill, fading && { backgroundColor: C.tertiary }]}
                // Visible, grabbable THUMB (QA round 10 fix #2) — same pattern as
                // the deck master (DeckTopBar.tsx faderThumb). Without it the
                // master is a full-width hot strip: a stray graze anywhere on the
                // bar writes master and can drive the whole rig toward 0. The
                // thumb gives the operator a deliberate handle to aim for.
                thumbStyle={styles.masterFaderThumb}
              />
            </View>
            <Text style={[styles.displayMono, {fontSize: 16, width: 36, textAlign: 'right'}, isPortrait && { fontSize: 14, width: 28 }]}>{Math.round(master * 100)}</Text>
          </View>
          {/* One-tap default add: fastest path. disabled+opacity gives the
              operator visual feedback while the POST is in flight, so they
              don't mash and queue 5 of them. */}
          <TouchableOpacity
            style={[styles.addBtn, isPortrait && { paddingHorizontal: 6, paddingVertical: 6 }, addBusy && { opacity: 0.5 }, activationsLocked && { opacity: 0.45 }]}
            onPress={() => handleAddChannelWithPlaylist('default')}
            // Soft PLAN lock: adding a channel changes the live mix.
            disabled={addBusy || activationsLocked}
            accessibilityState={{ disabled: addBusy || activationsLocked }}
          >
            <Text style={[styles.labelCaps, {color: '#FFF'}, isPortrait && { fontSize: 9 }]}>{addBusy ? 'ADDING…' : '+ DEFAULT'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: C.surfaceContainerHigh, borderWidth: 1, borderColor: C.ghostBorder }, isPortrait && { paddingHorizontal: 6, paddingVertical: 6 }, addBusy && { opacity: 0.5 }, activationsLocked && { opacity: 0.45 }]}
            onPress={openAddChannelPicker}
            disabled={addBusy || activationsLocked}
            accessibilityState={{ disabled: addBusy || activationsLocked }}
          >
            <Text style={[styles.labelCaps, {color: C.primary}, isPortrait && { fontSize: 9 }]} numberOfLines={1}>{isPortrait ? '+ PLAYLIST' : '+ FROM PLAYLIST…'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Mixer-only: a compact GROUPS button at the right end of the GLOBALS
          row opens the channel-grouping modal. The deck renders <CPCControls />
          with no `trailing`, so its globals row is unchanged. Both the GLOBALS
          row (SPEED/SIZE/SYNC/COLORS/QUEUE/TAP/BPM source) and the GROUPS
          button (group CRUD / gang faders / group mute) mutate the rig, so
          they're gated under the soft PLAN lock. */}
      <CPCControls
        screen="mixer"
        disabled={activationsLocked}
        trailing={
          <TouchableOpacity
            style={[styles.groupsButton, activationsLocked && { opacity: 0.45 }]}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            onPress={() => setGroupsModalOpen(true)}
            disabled={activationsLocked}
            accessibilityRole="button"
            accessibilityState={{ disabled: activationsLocked }}
            accessibilityLabel="Open channel groups"
          >
            <Text style={[styles.labelCaps, { fontSize: 10, color: C.primary }]}>GROUPS</Text>
            {mixGroups.length > 0 ? (
              <View style={styles.groupsButtonBadge}>
                <Text style={styles.groupsButtonBadgeText}>{mixGroups.length}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        }
      />

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
          <ChannelVizStrip vizKey="preDimmer" height={12} style={{ borderRadius: 6 }} showMeter={false} />
        </View>
      </View>

      {/* ── Channel Strips ─────────────────────────────────────────── */}
      {/* Post-channel-split: /mixer.channels[] contains ONLY mixer
          overlays (the deck channel lives on /deck/channel). We
          iterate the array directly — no `.slice(1)` skip-the-deck
          dance. The engine's HIL test (hil_channel_isolation_test)
          guards this invariant. */}
      {/* Round8 #3: previously 1-2 landscape cards were left-anchored
          (justifyContent flex-start for <3 layers), so a lone strip hugged the
          left edge with a big right gutter (the operator-flagged "large
          left-anchored void"). We now CENTER the row at every count so the
          unused width sits as symmetric margins instead of one lopsided right
          gutter, and we let 1-2 cards grow wider (cap raised below) so they
          fill more of the freed width. A full 3-layer row already fills evenly,
          so centering it is a visual no-op. Portrait is untouched (always a
          single fixed column).*/}
      {/* Horizontal scroll is enabled ONLY when the strips overflow the row
          (>3 landscape / >2 portrait) — so the common case has NO scroll
          container to fight the horizontal faders, and the faders (which now
          capture-claim their own drags) stay rock-solid. When few channels fit,
          they center; when many, they left-align and scroll. */}
      <ScrollView horizontal scrollEnabled={!isPortrait ? channels.length > 3 : channels.length > 2} contentContainerStyle={[{ padding: 16, gap: 16, flexGrow: 1 }, !isPortrait && (channels.length <= 3 ? { justifyContent: 'center' } : { justifyContent: 'flex-start' })]} style={{ flex: 1 }}>
        {/* Track which groups have already had their slim in-list header
            rendered, so the header is emitted ONCE — before a group's FIRST
            member in list order. Group members may not be contiguous (channels
            reorder freely); collapsing keys off mixGroupId, so every member of
            a collapsed group renders as a thin strip wherever it sits, and the
            single header acts as the group's collapse toggle + presence marker.
            This Set is rebuilt every render (cheap, deterministic in map order)
            and is NOT React state — purely a render-pass bookkeeping aid. */}
        {(() => {
          // ── Render plan (operator request 2026-06-29 #1) ────────────────
          // A group should VISUALLY SURROUND its member channels. We no longer
          // emit `header + members` as flat siblings in the strip row; instead
          // we cluster each group's members into a single render UNIT that is
          // rendered inside ONE bordered/tinted container (the group color
          // wraps the header + the member columns). Ungrouped channels stay
          // standalone units, rendered outside any container.
          //
          // Members may not be contiguous in channel order (channels reorder
          // freely); we cluster by mixGroupId and anchor each group's unit at
          // the position of its FIRST member, preserving channel order
          // otherwise. The header is therefore emitted ONCE per group, on top
          // of (expanded) / above (collapsed) its members.
          // Landscape width distribution (QA round1 #7): in landscape each
          // standalone strip / each member column gets a flex width so the row
          // fills the viewport; portrait keeps the fixed 320 column.
          const landscapeMaxWidth = channels.length >= 3 ? 560 : (channels.length === 1 ? 920 : 760);
          const cardStyle = isPortrait
            ? null
            : { width: undefined, flex: 1, minWidth: 320, maxWidth: landscapeMaxWidth };

          // Per-channel ChannelStrip element factory — keeps the (large) prop
          // wiring in one place whether the strip is standalone or a group
          // member, and whether it's expanded or collapsed.
          const renderStrip = (channel: any, idx: number, group: any, collapsed: boolean) => {
            // Solo display (docs/39 §10) — DISPLAY-ONLY, derived from the
            // authoritative soloedIds Set.
            const isSoloActive = soloedIds.has(channel.id);
            const anySolo = soloedIds.size > 0;
            const isBumped = bumpedIds.has(channel.id);
            const soloProtected = !!channel.soloSafe || !!channel.faderLocked;
            const dimmedBySolo = anySolo && !isSoloActive && !soloProtected;
            // Read inlinePlaylistVersion so this scope re-renders when the Map
            // changes (Maps aren't structurally compared by React).
            void inlinePlaylistVersion;
            const channelInlinePlaylist = inlinePlaylistRef.current.get(channel.id) || null;
            return (
              <ChannelStrip
                key={channel.id}
                index={idx + 1}
                layerIndex={idx}
                channel={channel}
                isSolo={isSoloActive}
                soloActive={anySolo}
                dimmedBySolo={dimmedBySolo}
                isBumped={isBumped}
                onBumpOn={handleBumpOn}
                onBumpOff={handleBumpOff}
                group={group}
                collapsed={collapsed}
                isDeck={false}
                blends={blends}
                transitions={transitionsList}
                playlistLibrary={playlistLibrary}
                initialPlaylist={channelInlinePlaylist}
                cardStyle={cardStyle}
                isOnlyChannel={channels.length === 1}
                activationsLocked={activationsLocked}
                onRename={handleRename}
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
          };

          // Build the ordered render plan: a list of units, each either a lone
          // ungrouped channel or a group with its (ordered) members.
          type Unit =
            | { kind: 'channel'; channel: any; idx: number }
            | { kind: 'group'; group: any; members: { channel: any; idx: number }[] };
          const units: Unit[] = [];
          const groupUnitByGid = new Map<string, Extract<Unit, { kind: 'group' }>>();
          channels.forEach((channel, idx) => {
            const group = channel.mixGroupId
              ? mixGroups.find(g => g.id === channel.mixGroupId) || null
              : null;
            if (!group) {
              units.push({ kind: 'channel', channel, idx });
              return;
            }
            let unit = groupUnitByGid.get(group.id);
            if (!unit) {
              unit = { kind: 'group', group, members: [] };
              groupUnitByGid.set(group.id, unit);
              units.push(unit);
            }
            unit.members.push({ channel, idx });
          });

          return units.map((unit) => {
            if (unit.kind === 'channel') {
              return renderStrip(unit.channel, unit.idx, null, false);
            }
            const { group, members } = unit;
            const groupIndex = mixGroups.findIndex(g => g.id === group.id);
            const memberCount = members.length;
            const collapsed = collapsedGroups.has(group.id);
            const borderColor = group.color || C.ghostBorder;
            const tint = tintFromHex(group.color, 0.07);

            if (collapsed) {
              // Collapsed group → one narrow VERTICAL bar: a vertical name +
              // chevron on top, a divider, then members stacked as tiny cells.
              // Tapping the header expands the group back.
              return (
                <TouchableOpacity
                  key={group.id}
                  activeOpacity={0.7}
                  onPress={() => toggleGroupCollapse(group.id)}
                  style={[
                    styles.groupBarV,
                    { borderColor },
                    tint ? { backgroundColor: tint } : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${(group.name || `GROUP ${groupIndex + 1}`).toUpperCase()} group, ${memberCount} channel${memberCount === 1 ? '' : 's'}, collapsed — tap to expand`}
                  accessibilityState={{ expanded: false }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.groupBarVChevron}>▸</Text>
                  <View style={[styles.groupDotV, { backgroundColor: group.color || C.secondary }]} />
                  <View style={{ height: 64, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={styles.groupBarVName} numberOfLines={1}>
                      {(group.name || `GROUP ${groupIndex + 1}`).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.groupBarVDivider} />
                  {members.map((m) => renderStrip(m.channel, m.idx, group, true))}
                </TouchableOpacity>
              );
            }

            // Expanded group → a bordered/tinted container that SURROUNDS the
            // header (banner on top) + the member channel columns (a row).
            return (
              <View
                key={group.id}
                style={[
                  styles.groupContainer,
                  { borderColor },
                  tint ? { backgroundColor: tint } : null,
                  cardStyle ? { alignSelf: 'stretch' } : null,
                ]}
              >
                <View style={styles.groupContainerHeader}>
                  <MixGroupHeader
                    group={group}
                    index={groupIndex < 0 ? 0 : groupIndex}
                    memberCount={memberCount}
                    collapsed={false}
                    onToggle={toggleGroupCollapse}
                  />
                </View>
                <View style={styles.groupMembersRow}>
                  {members.map((m) => renderStrip(m.channel, m.idx, group, false))}
                </View>
              </View>
            );
          });
        })()}
        {channels.length === 0 && (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={[styles.labelCaps, { fontSize: 14 }]}>NO CHANNELS — TAP &quot;+ DEFAULT&quot; OR &quot;+ FROM PLAYLIST&quot;</Text>
          </View>
        )}
      </ScrollView>
        {/* Hermetic plan-lock scrim — blankets the header + master + channels
            region above with one tap-catching layer. Active only under the
            soft PLAN lock and NOT during an operator takeover
            (activationsLocked = planLocked && !leaseHeld). */}
        <PlanLockScrim active={activationsLocked} />
      </View>

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

      {/* ── Channel-groups floating modal (docs/39 §10) ──────────────────
          The grouping UI (create / name / color / assign / unassign / gang /
          mute / delete) moved out of the always-on rail into this centered
          modal, launched from the GROUPS button on the GLOBALS row. REUSES
          the modalOverlay/modalContent pattern (absolute inset-0 + 0.7
          backdrop) like every other picker. GroupRailBody is stateless w.r.t.
          the registry — it renders the parent-owned mixGroups + channels and
          reports edits up through the typed groupsSoloApi clients. */}
      <Modal transparent visible={groupsModalOpen} animationType="fade" onRequestClose={() => setGroupsModalOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setGroupsModalOpen(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalContent}>
              <GroupRailBody mixGroups={mixGroups} channels={groupRailChannels} />
            </View>
          </TouchableOpacity>
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
  // Compact GROUPS button seated at the right end of the GLOBALS row (mixer
  // only). Matches the GLOBALS tile cluster height (48) so it reads as part
  // of that strip; carries a small count badge when groups exist.
  groupsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 48,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.primary,
    backgroundColor: C.surface,
  },
  groupsButtonBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupsButtonBadgeText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 10,
    color: '#FFF',
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
  // ── Group container (operator request 2026-06-29 #1) ──────────────────
  // A bordered/tinted box that VISUALLY SURROUNDS a group's header + member
  // channels so the members read as belonging to the group (instead of the
  // header sitting as a separate full-width column beside flat-sibling
  // members). The box hugs its members — small padding/gap, no big gutters —
  // and carries the group color as its border + a faint tint. Ungrouped
  // channels render outside any container.
  groupContainer: {
    alignSelf: 'stretch',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    padding: 8,
    gap: 8,
  },
  // The header sits on TOP of the member row in the expanded container; we let
  // it span the container width so the group name + collapse chevron read as a
  // banner over its members.
  groupContainerHeader: {
    alignSelf: 'stretch',
  },
  // Horizontal row of the group's member channel columns inside the container.
  // flex:1 + minHeight:0 makes the row CLAIM the container's leftover height
  // under the header (the group container is height-bounded by the strip
  // ScrollView's alignItems:'stretch'). Without it the row sized to its members'
  // intrinsic content height, so a member's inner playlist / LOCAL PARAMS
  // ScrollViews never bounded → they overflowed the card with NO scroll (the
  // exact bug: grouped channels had no param/pattern scroll). With it, each
  // member stretches to the bounded row height and its inner lists scroll —
  // matching a standalone strip.
  groupMembersRow: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  // ── Collapsed group: narrow VERTICAL bar (operator request 2026-06-29 #2) ──
  // The whole collapsed group is one slim vertical column: a vertical/compact
  // header on top, then its members stacked as tiny vertical cells. Thin
  // HORIZONTALLY to save space; content stacks vertically. The header tap
  // expands it back.
  groupBarV: {
    alignSelf: 'flex-start',
    width: 60,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 6,
    alignItems: 'center',
    ...globalStyles.ambientShadow,
  },
  // Vertical (sideways) group name shown at the top of the collapsed bar.
  groupBarVName: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: C.text,
    transform: [{ rotate: '90deg' }],
  },
  groupBarVChevron: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 11,
    color: C.secondary,
  },
  groupDotV: {
    width: 8, height: 8, borderRadius: 4,
  },
  groupBarVDivider: {
    alignSelf: 'stretch',
    height: 1,
    backgroundColor: C.ghostBorder,
  },
  // One member in the collapsed vertical bar: number → mini level → M/S, all
  // stacked. Hugs its own height; the parent bar supplies the narrow width.
  channelCellV: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  channelBadgeThin: {
    width: 22, height: 22,
  },
  // Tiny vertical level indicator for a collapsed member cell — a slim upright
  // track whose fill grows from the bottom with the channel level.
  cellLevelTrack: {
    width: 8,
    height: 30,
    borderRadius: 4,
    backgroundColor: C.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  cellLevelFill: {
    alignSelf: 'stretch',
    backgroundColor: C.primary,
    borderRadius: 4,
  },
  // Compact M/S toggles for the collapsed vertical cell — narrow box + hitSlop
  // expands the interactive area to ≥44pt. Same surface/border as toggleBtn.
  thinVToggle: {
    width: 30, minHeight: 22,
    paddingVertical: 2,
    backgroundColor: C.surfaceContainerHigh,
    borderRadius: 6, borderWidth: 1, borderColor: C.ghostBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  channelHeader: {
    flexDirection: 'row',
    // Single row (operator request 2026-06-29): name on the left, the compact
    // control cluster on the right — NO wrap. The button row was trimmed to a
    // handful of controls (lock · reorder · blend ▾ · ⋮), so it now fits beside
    // the name; the name flexes + truncates and the buttons keep their size.
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  // Grabbable master THUMB (QA round 10 fix #2) — same visual language as the
  // deck master thumb (DeckTopBar.tsx faderThumb): lowest-surface block with a
  // primary border, sized to the 16pt track height and centred on the fill
  // edge via translateX:-7. The master is the highest-consequence fader on the
  // surface, so it must have a deliberate handle rather than being a bare
  // full-width fill bar draggable from anywhere.
  masterFaderThumb: {
    position: 'absolute',
    top: 0, bottom: 0,
    width: 14,
    backgroundColor: C.surfaceContainerLowest,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.primary,
    transform: [{ translateX: -7 }],
  },
  // Per-channel level/hue fader THUMB (QA round 10 fix #6) — gives the channel
  // LEVEL fader (and matches the HUE fader's existing handle) a visible,
  // grabbable block so an empty track at 0 / solid fill at 100 still reads as a
  // draggable control. Same language as the master/deck thumbs, sized to the
  // 16pt LEVEL track.
  channelFaderThumb: {
    position: 'absolute',
    top: 0, bottom: 0,
    width: 14,
    backgroundColor: C.surfaceContainerLowest,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.secondary,
    transform: [{ translateX: -7 }],
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
  // QA round 10 fix #4: CIRCLE (borderRadius = half the 12pt box) so the live
  // hue preview reads as a non-interactive status dot, not a tappable square
  // chip — matching the deck HUE row swatch (deck_hue_row.tsx).
  hueSwatch: {
    width: 12, height: 12, borderRadius: 6,
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
  // an 834-wide iPad-portrait viewport). Backdrop raised to 0.7 (was 0.4) so
  // the busy playlist rows behind can't bleed through.
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
  // QA round 10 fix #7: unselected blend-mode rows get a subtle surface fill +
  // ghost border so every option reads as a tappable row (not bare text). The
  // selected row's solid primary fill (modalRowActive) still stands apart.
  modalRowGhost: {
    backgroundColor: C.surfaceContainerHigh,
    borderColor: C.ghostBorder,
  },
  // Channel-actions overflow menu rows: icon + label, laid out as a left-
  // aligned row so the action reads as "<glyph> <words>". minHeight 44 keeps
  // every row at the operator-safety touch floor.
  actionsMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  actionsMenuLabel: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 14,
    color: C.text,
  },
  // Round8 #5: a hairline divider + the destructive row's extra top margin
  // put ≥16px of separation between Pin fader and the error-red Delete row so
  // the destructive action can't be hit by a mis-tap (they were 4px apart).
  actionsMenuDivider: {
    height: 1,
    backgroundColor: C.ghostBorder,
    marginTop: 12,
    marginHorizontal: 4,
  },
  actionsMenuRowDestructive: {
    marginTop: 8,
  },
  actionsMenuHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.icon,
    marginTop: 1,
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
