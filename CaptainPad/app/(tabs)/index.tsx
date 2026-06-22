import React, { useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, Modal, StyleSheet } from 'react-native';
import { useGlobalStyles } from '@/styles/globalStyles';
import { usePalette } from '@/hooks/use-theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { RigGlobals } from '@/components/RigGlobals';
import { GlobalParams, DeckSavedFlash } from '@/components/GlobalParams';
import { CPCControls } from '@/components/CPCControls';
import { DeckTopBar } from '@/components/DeckTopBar';
import { PlaylistPanel } from '@/components/PlaylistPanel';
import { GlobalHueRow } from '@/components/global_hue_row';
import { EntryLabelEditor } from '@/components/EntryLabelEditor';
import { PixelStrip } from '@/components/ui/PixelStrip';
import { AutopilotTimerPills, DeckTransitionControls } from '@/components/DeckTransitionControls';
import { AllModulationsPanel } from '@/components/AllModulationsPanel';
import { useFocusEffect } from 'expo-router';
import {
  getAutopilot, setAutopilot,
  fetchDeckChannel, setDeckChannelControl,
  setMixerView,
  fetchDeckTransitionConfig, setDeckTransitionConfig,
  fetchPlaylists,
  fetchMixerState,
  type DeckTransitionConfig,
  type MixerChannel,
} from '@/utils/api';
import { setChannelFaderMax, setChannelColor } from '@/utils/channelExtrasApi';
import { setDeckFocus } from '@/utils/deckFocusApi';
import { DeckOverlayStack } from '@/components/DeckOverlayStack';
import type { DeckOverlay, DeckOverlayAutopilot } from '@/utils/deckOverlaysApi';
import { useEngineConnection } from '@/hooks/useEngineConnection';
import type { EngineMessage, BusStatus } from '@/utils/engineEvents';

// 8pt hitSlop on every edge → a 28×28 visual button gets a 44×44 interactive
// area (28 + 8 + 8 = 44), matching the mixer's touch-target floor.
const ICON_BTN_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

// Deck channel color accent palette (docs/39 §8.4 — channel `color` metadata,
// no render effect). Same curated high-contrast set the mixer strip uses so
// the deck and mixer read consistently; the "NO COLOR" option clears it
// (color = null). The engine accepts any string or null — this is purely the
// tap-to-pick surface.
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

// ── Global Effect Button moved to RigGlobals ────────────────────────────

const ToggleButton = ({ id, name, initialValue = 0, onChange }: { id: number, name: string, initialValue?: number, onChange: Function }) => {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const [isOn, setIsOn] = React.useState(initialValue > 0.5);
  React.useEffect(() => { setIsOn(initialValue > 0.5) }, [initialValue]);
  return (
    <TouchableOpacity 
      onPress={() => { const next = !isOn; setIsOn(next); onChange(id, next ? 1.0 : 0.0); }}
      style={[
        globalStyles.macroButton, 
        { flexBasis: '30%' }, 
        isOn ? { backgroundColor: C.primary, borderColor: C.primary } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isOn ? '#fff' : C.text, textAlign: 'center' }}>
        {name.replace(/toggle|trigger/i, '').substring(0, 10).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
};

const MomentaryButton = ({ id, name, onChange }: { id: number, name: string, onChange: Function }) => {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const [isPressed, setIsPressed] = React.useState(false);
  return (
    <TouchableOpacity 
      onPressIn={() => { setIsPressed(true); onChange(id, 1.0); }}
      onPressOut={() => { setIsPressed(false); onChange(id, 0.0); }}
      activeOpacity={1}
      style={[
        globalStyles.macroButton, 
        { flexBasis: '30%' }, 
        isPressed ? { backgroundColor: C.error, borderColor: C.error } : {}
      ]}
    >
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isPressed ? '#fff' : C.text, textAlign: 'center' }}>
        {name.replace(/toggle|trigger/i, '').substring(0, 10).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
};

// ── Connection Status Banner ────────────────────────────────────────────
const OfflineBanner = ({ error }: { error: string }) => {
  const C = usePalette();
  return (
    <View style={{
      // 'rgba(186, 26, 26, 0.12)' — translucent error wash; reads as
      // alarm on both light and dark surfaces, so we keep it as a
      // literal rather than burning a palette token.
      backgroundColor: 'rgba(186, 26, 26, 0.12)',
      borderColor: C.error,
      borderWidth: 1,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12
    }}>
      <IconSymbol name="wifi.slash" size={24} color={C.error} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 14 }}>
          ENGINE OFFLINE
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.error, fontSize: 12, marginTop: 4 }}>
          {error || 'Cannot reach MarsinEngine. Check Config tab for IP settings.'}
        </Text>
      </View>
    </View>
  );
};

export default function ControlDeckScreen() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const [deckChannel, setDeckChannel] = useState<any | null>(null);
  // One-shot guard for the mount-time CAP clear (June 2026). The deck CAP
  // (faderMax) fader UI was removed; any residual/persisted faderMax < 1.0
  // would silently cap exterior brightness with no visible control to undo
  // it — a mission-critical "never dark" hazard. On the first deck-channel
  // seed we send exactly ONE faderMax:1.0 write to neutralize a stored cap.
  // Guarded so it fires once per mount, never mid-interaction.
  const capClearedRef = useRef(false);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string>('');
  // D6: floating ALL MODULATIONS overlay state. Placed at the screen
  // level so the panel can layer above every card on the deck without
  // borrowing the deck channel card's clipping context.
  const [showAllMods, setShowAllMods] = useState(false);

  // Deck channel color picker visibility (docs/39 §8.4). The swatch button
  // in the deck card header opens this modal; selecting a swatch (or NO
  // COLOR) routes through handleDeckColor.
  const [showColorPicker, setShowColorPicker] = useState(false);

  // ── Cue-to-deck (docs/39 §F-cue) ───────────────────────────────────────
  // Audition a MIXER overlay's pattern on the deck PREVIEW buffer at 100%
  // (PFL) before pushing it live. The engine render path already honours
  // `deckFocusChannelId`; the deck tab just arms/clears it via
  // POST /deck/focus and reconciles the active cue from the `deck` WS event.
  //
  // - `cueOverlays`: the mixer overlay list to choose from. The deck tab does
  //   NOT otherwise call /mixer, so we seed it once and keep it fresh from the
  //   `mixer` WS broadcast (overlay add/remove/rename while the picker is up).
  // - `activeCueId`: engine-confirmed deckFocusChannelId (null = no cue).
  //   Optimistic on tap, reconciled by the `deck` broadcast's deckFocusChannelId.
  // - `showCuePicker`: the overlay-picker modal visibility.
  const [cueOverlays, setCueOverlays] = useState<MixerChannel[]>([]);
  const [activeCueId, setActiveCueId] = useState<string | null>(null);
  const [showCuePicker, setShowCuePicker] = useState(false);

  // Post-channel-split (May 2026): the deck channel comes from its
  // own /deck/channel endpoint and the WS `deck` event. The mixer's
  // `channels[]` array NEVER contains the deck channel anymore — that
  // was the source of countless "deck shows a mixer overlay's
  // exports" bugs. See docs/16_captain_pad.md and
  // marsin_engine/lib/pattern_mixer.js (channel-split note).
  const deckChannelId: string | null = deckChannel?.id ?? null;

  // Autopilot state (cycles through the active playlist on a timer)
  const [isPlaylistActive, setPlaylistActive] = useState<boolean>(false);
  const [playlistDelayStr, setPlaylistDelayStr] = useState<string>('30');
  const [isShuffle, setIsShuffle] = useState<boolean>(false);

  // Deck transition config (soft swap between patterns via server-side
  // double-buffer — see DECK TRANSITIONS in DeckTransitionControls.tsx
  // and triggerDeckPatternSwap in marsin_engine/lib/pattern_mixer.js).
  const [deckTxConfig, setDeckTxConfig] = useState<DeckTransitionConfig>({
    enabled: false,
    mode: 'trans_crossfade',
    durationMs: 1000,
    shuffle: false,
  });

  // Live swap state — the engine broadcasts `deckSwapStarted` / `…Complete`
  // around every soft swap. We use this to grey out the playlist (so taps
  // during the fade are ignored client-side — server also returns 409 if
  // a tap leaks through). Cleared on tab focus changes too: switching
  // away to the mixer tells the engine to finalize the swap, so when we
  // come back this flag is stale by definition.
  const [deckSwapInFlight, setDeckSwapInFlight] = useState(false);

  // Last engine-picked transition mode. When shuffle is enabled the
  // engine rolls a new style per swap (pickRandomTransitionMode in
  // api_server.js) and broadcasts it on `deckSwapStarted`. Without
  // this state the picker dropdown was stuck showing the operator's
  // pre-shuffle pick forever — operator report 2026-05-29: "the
  // dropdown doesn't change per transition." With this we surface the
  // actually-used mode so the operator can see what just played.
  const [lastSwapMode, setLastSwapMode] = useState<string | null>(null);

  // Parent-owned playlist library (May 2026 refactor — see mixer.tsx
  // for the full rationale). Fetched once on mount, then refreshed
  // from the engine's `playlistLibrary` WS event. Passed down to the
  // single PlaylistPanel below so it doesn't have to do its own
  // /playlists GET — which under load could race and return an empty
  // list, causing the "no playlists yet" symptom on the 3rd channel
  // (in the mixer; same fetch path here for consistency).
  const [playlistLibrary, setPlaylistLibrary] = useState<string[]>([]);

  // ── Deck dynamic VIEW OVERRIDES (engine #deck-overlays) ────────────────
  // View-scoped overlay decks layered OVER the main deck. Both the list and
  // the SHARED auto-cycle cadence ride the existing `deck` WS message (folded
  // in by the engine — no new WS type), so we read them in the `deck` branch
  // of onControl below and render the DeckOverlayStack beneath the deck
  // surface. The list IS the source of truth; we keep it in state only to
  // drive the cards (PlaylistPanel reconciles its own playlist off the same
  // `deck` message via role="deckOverlay").
  const [deckOverlays, setDeckOverlaysState] = useState<DeckOverlay[]>([]);
  const [overlayAutopilot, setOverlayAutopilot] = useState<DeckOverlayAutopilot>({
    active: false,
    delay_s: 30,
    shuffle: false,
  });

  // Pre-May-2026 the deck tab owned its own WS. The topic split
  // moved that into singleton buses (utils/engineEvents +
  // utils/engineVizEvents). This tab now just subscribes — no per-tab
  // socket, no double-parse of the mixer / vis firehose. The boot +
  // subscription lifecycle (resolve base, probe, nudge buses, AppState
  // re-seed, subscribe/teardown) is shared with the mixer via
  // useEngineConnection; the per-bus message handlers below are the
  // deck-specific part.
  const visDataRef = useRef<{ [key: string]: string | null }>({});
  const [, setVisVersion] = useState(0);
  const lastVisUpdateRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      setMixerView('deck');
      // Tab unmount cleanup: any in-flight swap is finalized by the
      // engine when we navigate away (the /mixer/view POST does that
      // server-side), so clear the local flag so the next mount starts
      // with the lock OFF instead of a stale in-flight assumption.
      return () => setDeckSwapInFlight(false);
    }, [])
  );

  // Control plane: deck channel state, autopilot, deck-transition
  // config, soft-swap lifecycle markers.
  const onControl = useCallback((msg: EngineMessage) => {
    if (msg.type === 'playlistLibrary' && Array.isArray(msg.names)) {
      setPlaylistLibrary(msg.names as string[]);
    }
    if (msg.type === 'deck') {
      setDeckChannel((msg.channel as any) || null);
      // F-cue: reconcile the active cue from the engine's canonical
      // deckFocusChannelId (source of truth; clears any optimistic value
      // the engine refused). Absent field (old engine) ⇒ no cue.
      const focus = (msg as { deckFocusChannelId?: unknown }).deckFocusChannelId;
      setActiveCueId(typeof focus === 'string' ? focus : null);
      // Deck dynamic VIEW OVERRIDES ride the same `deck` message: the
      // overlay stack + the SHARED auto-cycle cadence. Reconcile both off
      // the broadcast (the engine is the source of truth — every add /
      // patch / reorder / autopilot change re-broadcasts).
      const ovs = (msg as { overlays?: unknown }).overlays;
      setDeckOverlaysState(Array.isArray(ovs) ? (ovs as DeckOverlay[]) : []);
      const ap = (msg as { overlayAutopilot?: any }).overlayAutopilot;
      if (ap && typeof ap === 'object') {
        setOverlayAutopilot({
          active: !!ap.active,
          delay_s: typeof ap.delay_s === 'number' ? ap.delay_s : 30,
          shuffle: !!ap.shuffle,
        });
      }
    } else if (msg.type === 'mixer') {
      // F-cue: the deck tab doesn't otherwise track overlays, but the cue
      // picker needs the live overlay list. The mixer broadcast carries
      // `channels` (overlays only — never the deck channel).
      const chans = (msg as { channels?: unknown }).channels;
      if (Array.isArray(chans)) setCueOverlays(chans as MixerChannel[]);
    } else if (msg.type === 'autopilot') {
      if (typeof msg.active === 'boolean') setPlaylistActive(msg.active);
      if (typeof msg.delay_s === 'string' && (msg.delay_s as string).length) {
        setPlaylistDelayStr(msg.delay_s as string);
      }
      if (typeof msg.shuffle === 'boolean') setIsShuffle(msg.shuffle);
    } else if (msg.type === 'deckTransitionConfig') {
      setDeckTxConfig((prev) => ({
        enabled: typeof msg.enabled === 'boolean' ? msg.enabled : prev.enabled,
        mode: typeof msg.mode === 'string' ? msg.mode : prev.mode,
        durationMs: typeof msg.durationMs === 'number' ? msg.durationMs : prev.durationMs,
        shuffle: typeof msg.shuffle === 'boolean' ? msg.shuffle : prev.shuffle,
      }));
    } else if (msg.type === 'deckSwapStarted') {
      setDeckSwapInFlight(true);
      const tm = (msg as unknown as { transitionMode?: string }).transitionMode;
      if (typeof tm === 'string') setLastSwapMode(tm);
    } else if (msg.type === 'deckSwapComplete') {
      setDeckSwapInFlight(false);
      const tm = (msg as unknown as { transitionMode?: string }).transitionMode;
      if (typeof tm === 'string') setLastSwapMode(tm);
    }
  }, []);

  const onStatus = useCallback((s: BusStatus) => {
    setIsConnected(!!s.connected);
    setConnectionError(s.connected ? '' : (s.lastError || ''));
  }, []);

  // Viz plane: master strip lives on the deck tab too.
  const onViz = useCallback((msg: EngineMessage) => {
    if (msg.type === 'vis') {
      visDataRef.current = (msg.vis as { [key: string]: string | null }) || {};
      const now = Date.now();
      if (now - lastVisUpdateRef.current > 200) {
        lastVisUpdateRef.current = now;
        setVisVersion(v => v + 1);
      }
    }
  }, []);

  // ── Boot: warm REST seeds (the shared hook handles base resolution,
  // the connection probe, bus reconnect nudging, and AppState 'active'
  // re-seeding). Deck deliberately does NOT call /mixer — the deck tab
  // has no business surfacing overlay channels.
  const seed = useCallback(async (_base: string, connected: boolean) => {
    if (!connected) return;

    // Load autopilot state
    const apResult = await getAutopilot();
    if (apResult.ok && apResult.data) {
      setPlaylistActive(apResult.data.active);
      setPlaylistDelayStr(apResult.data.delay_s);
      setIsShuffle(apResult.data.shuffle);
    }

    // Load deck transition config
    const dtRes = await fetchDeckTransitionConfig();
    if (dtRes.ok && dtRes.data) {
      setDeckTxConfig(dtRes.data);
    }

    // Load initial deck channel state.
    const deckRes = await fetchDeckChannel();
    if (deckRes.ok && deckRes.data) {
      const ch = deckRes.data.channel || null;
      setDeckChannel(ch);
      // F-cue: seed the active cue from /deck/channel's deckFocusChannelId.
      // The top-level api type doesn't pin this field, so read it loosely.
      const focus = (deckRes.data as { deckFocusChannelId?: unknown }).deckFocusChannelId;
      setActiveCueId(typeof focus === 'string' ? focus : null);

      // CAP-removal cleanup (June 2026): the deck CAP (faderMax) fader was
      // removed from the UI. A persisted faderMax < 1.0 would silently limit
      // the deck's exterior brightness with no control left to clear it —
      // mission-critical "never dark" hazard. Fire exactly ONE guarded
      // faderMax:1.0 write (same PATCH /deck/channel route the old CAP fader
      // used, via setChannelFaderMax {deck:true}) to neutralize any stored
      // cap. Guarded by capClearedRef so it fires once per mount, never
      // mid-interaction. faderMax stays a valid engine field — we only force
      // it open here.
      const seededMax = typeof ch?.faderMax === 'number' ? ch.faderMax : 1.0;
      if (!capClearedRef.current && ch?.id && seededMax < 1.0) {
        capClearedRef.current = true;
        setChannelFaderMax(ch.id, 1.0, { deck: true }).then((r) => {
          if (r.ok) {
            setDeckChannel((c: any) => (c ? { ...c, faderMax: 1.0 } : c));
          } else {
            console.warn('[Deck] failed to clear residual faderMax cap:', r.error);
          }
        });
      } else {
        capClearedRef.current = true;
      }
    }

    // F-cue: seed the mixer overlay list for the cue picker. The deck tab
    // doesn't otherwise call /mixer; the `mixer` WS broadcast keeps this
    // fresh after the seed.
    const mixRes = await fetchMixerState();
    if (mixRes.ok && mixRes.data && Array.isArray(mixRes.data.channels)) {
      setCueOverlays(mixRes.data.channels);
    }

    // Seed the parent-owned playlist library (see comment on the
    // state declaration). Engine returns the cached in-memory list.
    const pLib = await fetchPlaylists();
    if (pLib.ok && pLib.data) setPlaylistLibrary(pLib.data);
  }, []);

  const { reconnect: connectToEngine } = useEngineConnection({ seed, onControl, onStatus, onViz });

  // Patch the deck transition config (optimistic local update + POST).
  // The server broadcasts `deckTransitionConfig` on success which we
  // already mirror in the WS handler — that's the source of truth, but
  // updating locally first avoids the visible "snap-back" on tap.
  const handleDeckTxChange = useCallback((patch: Partial<DeckTransitionConfig>) => {
    // Optimistic apply with rollback (C5). We snapshot the fields the
    // patch touches BEFORE applying so a rejected POST can restore
    // exactly those keys without clobbering any concurrent WS update to
    // other fields. Keeps the no-visible-snap UX on the happy path while
    // honoring Codex P0 — a server reject must NOT leave the UI showing a
    // value the engine refused. The `deckTransitionConfig` WS broadcast
    // remains the source of truth on success.
    let prevSnapshot: Partial<DeckTransitionConfig> = {};
    setDeckTxConfig((prev) => {
      const snap: Partial<DeckTransitionConfig> = {};
      for (const k of Object.keys(patch) as (keyof DeckTransitionConfig)[]) {
        (snap as any)[k] = prev[k];
      }
      prevSnapshot = snap;
      return { ...prev, ...patch };
    });
    void setDeckTransitionConfig(patch).then((res) => {
      if (!res.ok) {
        console.error('[Deck] Transition-config POST rejected:', res.error);
        setDeckTxConfig((prev) => ({ ...prev, ...prevSnapshot }));
        Alert.alert(
          'Transition setting not applied',
          `The engine rejected the change. ${res.error || ''} Reverted to the previous value.`.trim(),
        );
      }
    }).catch((err) => {
      console.error('[Deck] Transition-config POST failed:', err);
      setDeckTxConfig((prev) => ({ ...prev, ...prevSnapshot }));
      Alert.alert('Transition setting not applied', `Could not reach the engine. ${err?.message || ''} Reverted.`.trim());
    });
  }, []);

  // (Removed June 2026: handleDeckFaderMax + the deck CAP fader UI. The
  // per-deck intensity ceiling was a "never dark" hazard. faderMax stays a
  // valid engine field but is no longer operator-adjustable here; it is forced
  // open to 1.0 once at mount in seed() — see capClearedRef.)

  // Per-channel color metadata (docs/39 §8.4) on the DECK channel. Pure
  // operator-facing accent (no render effect) — tints the deck card for
  // at-a-glance identification, matching the mixer strips. Same optimistic +
  // reconcile + fail-loud shape; a null color clears the accent and the engine
  // requires a string or null.
  const handleDeckColor = useCallback(async (channelId: string, color: string | null) => {
    const prev = deckChannel?.color ?? null;
    setDeckChannel((c: any) => (c ? { ...c, color } : c));
    const res = await setChannelColor(channelId, color, { deck: true });
    if (!res.ok) {
      console.error(`[Deck] color change rejected for ${channelId}:`, res.error);
      setDeckChannel((c: any) => (c ? { ...c, color: prev } : c));
      Alert.alert(
        'Color not applied',
        `The engine rejected this color. ${res.error || ''} The deck kept its previous color.`.trim(),
      );
    }
  }, [deckChannel?.color]);

  // ── Cue-to-deck handlers (docs/39 §F-cue) ──────────────────────────────
  // Arm a cue: audition `channelId` (a mixer overlay) on the deck preview
  // buffer at 100%, or clear (null → restore the canonical deck view).
  // Optimistic local apply; the `deck` WS broadcast's deckFocusChannelId is
  // the source of truth and reconciles in onControl. Fail loud (Codex P0):
  // a rejected arm reverts locally + Alerts with the engine's error verbatim.
  const handleSetCue = useCallback(async (channelId: string | null) => {
    const prev = activeCueId;
    setActiveCueId(channelId);
    const res = await setDeckFocus(channelId);
    if (!res.ok) {
      console.error('[Deck] Cue (deck focus) rejected:', res.error);
      setActiveCueId(prev);
      Alert.alert(
        'Cue not applied',
        `The engine rejected this cue. ${res.error || ''} The deck preview kept its previous state.`.trim(),
      );
    }
  }, [activeCueId]);

  // Human label for a cued overlay id (its name, or a short id fallback so a
  // freshly-added overlay the picker hasn't seen yet still reads sensibly).
  const cueLabelFor = useCallback((id: string): string => {
    const ov = cueOverlays.find(c => c.id === id);
    const name = ov?.name;
    return (typeof name === 'string' && name.length) ? name : id.slice(0, 8);
  }, [cueOverlays]);

  const triggerChannelControl = (_channelId: string, id: number, v0: number, v1?: number, v2?: number) => {
    // Deck tab only ever writes to the deck channel — there's a single
    // dedicated route for that now. We ignore the channelId arg (kept
    // for API compatibility with the previous mixer-routed call).
    setDeckChannelControl(id, v0, v1, v2);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* Top bar: title + connection status + master fader. Matches the
          Marsin Mixer header layout, minus channel-add buttons. */}
      <DeckTopBar isConnected={isConnected} />
      <CPCControls />
      {/* ── Channel Preview Visualization ───────────────────────────── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, minHeight: 44 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: C.icon }}>
            DECK MAIN
          </Text>
          {/* ── Cue-to-deck (docs/39 §F-cue) ──────────────────────────
              Audition a mixer overlay on this preview buffer at 100% before
              pushing it live. When a cue is armed we show the cued overlay's
              name + a CLEAR button; otherwise just the CUE button. The row
              reserves a 44pt min-height so arming/clearing never shifts the
              preview strip below. */}
          <View style={{ flex: 1 }} />
          {activeCueId ? (
            <>
              <View style={[styles.cueActiveChip, { borderColor: C.primary, backgroundColor: C.surfaceContainerHigh }]}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1, color: C.primary }}>
                  CUE · {cueLabelFor(activeCueId)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => handleSetCue(null)}
                style={[styles.cueBtn, { borderColor: C.ghostBorder }]}
                accessibilityRole="button"
                accessibilityLabel="Clear deck cue"
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.5, color: C.text }}>CLEAR</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              onPress={() => setShowCuePicker(true)}
              disabled={cueOverlays.length === 0}
              style={[styles.cueBtn, { borderColor: C.ghostBorder, opacity: cueOverlays.length === 0 ? 0.4 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Cue a mixer overlay onto the deck preview"
            >
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 0.5, color: C.text }}>◎ CUE</Text>
            </TouchableOpacity>
          )}
        </View>
        <PixelStrip base64Data={visDataRef.current[deckChannelId || 'master']} height={18} style={{ borderRadius: 6 }} />
      </View>
      <View style={globalStyles.container}>
        {/* Left Pane — Playlist (the one and only pattern list).
            Padding is tightened from the default leftPane (24) so the
            playlist gets more vertical room. GLOBAL EFFECTS no longer
            lives in this narrow column — it moved to a full-width bottom
            bar below the two-pane content (mirrors the mixer tab) so the
            effect labels render fully legible instead of being squeezed
            into the cramped left column (QA round2 deck fix). The
            playlist now shows ≥5 entries on 11" iPad landscape and the
            REFRESH/RECONNECT button moved INTO the playlist header
            (top-right ↻ icon, see PlaylistPanel `onRefreshConnection`)
            so the old full-width button below the list is gone. */}
        <View style={[globalStyles.leftPane, { padding: 14, gap: 8 }]}>
          {isConnected === false && <OfflineBanner error={connectionError} />}

          {/* THE pattern list = the active playlist for the deck.
              No duplicate "all patterns" list — tap + on the panel to pick from the
              full library and add it as a new entry. */}
          {deckChannelId ? (
            <View key={deckChannelId} style={{ flex: 1, minHeight: 0 }}>
              {/* Global rig HUE shifter, pinned to the TOP of the deck's
                  pattern list (operator request June 2026). The deck's
                  GLOBAL EFFECTS strip (mixer-strip variant, bottom bar) has
                  no room for a hue row, so the global hue control lives here
                  — mirroring how the MIXER shows a compact HUE row above each
                  channel's playlist. Self-contained wiring (own state, seed,
                  WS reconcile, POST) so it's the deck's ONE-AND-ONLY hue
                  control; the bottom effects bar stays hue-less. */}
              <GlobalHueRow />
              <PlaylistPanel
                channelId={deckChannelId}
                role="deck"
                channelLabel="DECK MAIN"
                locked={!!deckChannel?.locked}
                initialAssignment={deckChannel?.playlist || null}
                // During a deck pattern soft-swap we grey out the list +
                // disable taps. The engine also rejects taps server-side
                // with 409 — this is just the UX layer of the contract.
                disabled={deckSwapInFlight}
                onRefreshConnection={connectToEngine}
                playlistLibrary={playlistLibrary}
              />
            </View>
          ) : (
            <Text style={{ color: C.secondary, fontStyle: 'italic' }}>
              Waiting for deck…
            </Text>
          )}
        </View>

        {/* Right Pane - Parameters & Macros (autopilot + channel exports) */}
        <View style={[globalStyles.rightPane, { padding: 0 }]}>
          <ScrollView contentContainerStyle={{ padding: 48, paddingBottom: 96 }} showsVerticalScrollIndicator={false}>
            {/* Offline Banner (right pane) */}
            {isConnected === false && (
              <OfflineBanner error={connectionError} />
            )}

            {/* ── AUTOPILOT TRANSITIONS ────────────────────────────────
                PLAY/PAUSE | preset pill-bar (1s … 180s) | SHUFFLE.
                The pill-bar replaced a native <Picker> wheel in May 2026 —
                the wheel was hard to hit, ate vertical space, and rendered
                inconsistently across iOS versions. Pills are direct-tap
                and scroll horizontally if the operator's currently-active
                pick is off-screen.
                Card-internal header (May 2026): the AUTOPILOT TRANSITIONS
                label was hoisted INSIDE the card to recover the ~24px the
                free-standing label + its 8px margin used to occupy. Same
                typography recipe as `labelCaps` (SpaceGrotesk_700Bold /
                10pt / 1.2 tracking / secondary / uppercase). */}
            <View style={{ marginBottom: 12, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8, borderRadius: 8, backgroundColor: C.surfaceContainerHigh, ...globalStyles.ghostBorder, gap: 6 }}>
              {/* Header sits on the SAME row as PLAY/PAUSE + SHUFFLE so it
                  costs zero extra vertical height — the label rides the
                  baseline of the tallest control next to it. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: C.secondary, textTransform: 'uppercase' }}>AUTOPILOT</Text>
                  <TouchableOpacity
                    onPress={() => { const nx = !isPlaylistActive; setPlaylistActive(nx); setAutopilot(nx, playlistDelayStr, isShuffle); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: isPlaylistActive ? C.primary : 'transparent', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: isPlaylistActive ? 'transparent' : C.ghostBorder }}
                  >
                    <IconSymbol name={isPlaylistActive ? "pause.fill" : "play.fill"} size={16} color={isPlaylistActive ? "#FFF" : C.text} />
                    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: isPlaylistActive ? "#FFF" : C.text, fontSize: 12 }}>
                      {isPlaylistActive ? 'PAUSE' : 'PLAY'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={() => { const nx = !isShuffle; setIsShuffle(nx); setAutopilot(isPlaylistActive, playlistDelayStr, nx); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8 }}
                  accessibilityRole="switch"
                  accessibilityLabel={isShuffle ? 'Disable autopilot shuffle' : 'Enable autopilot shuffle'}
                >
                  <IconSymbol name="shuffle" size={16} color={isShuffle ? C.primary : C.icon} />
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: isShuffle ? C.primary : C.icon, fontSize: 12, letterSpacing: 0.5 }}>SHUFFLE</Text>
                </TouchableOpacity>
              </View>

              {/* Row 2: timer pill-bar */}
              <AutopilotTimerPills
                value={parseInt(playlistDelayStr, 10) || 30}
                onChange={(v) => {
                  const str = String(v);
                  setPlaylistDelayStr(str);
                  setAutopilot(isPlaylistActive, str, isShuffle);
                }}
              />
            </View>

            {/* ── DECK TRANSITIONS ───────────────────────────────────
                Soft-swap pattern changes via the engine's hidden deck
                shadow channel (see triggerDeckPatternSwap in the engine
                mixer). Independent of AUTOPILOT — playlist auto-cycling
                and per-tap entry swaps BOTH route through this when
                enabled. */}
            <DeckTransitionControls
              enabled={deckTxConfig.enabled}
              // When shuffle is on, show the actually-rolled style from
              // the engine's most-recent broadcast instead of the
              // operator's pre-shuffle pick (which the engine ignores
              // in shuffle mode anyway). Falls back to the config mode
              // before any swap has happened.
              mode={deckTxConfig.shuffle && lastSwapMode ? lastSwapMode : deckTxConfig.mode}
              durationMs={deckTxConfig.durationMs}
              shuffle={deckTxConfig.shuffle}
              onChange={handleDeckTxChange}
            />

            {/* ── DECK DYNAMIC VIEW OVERRIDES (engine #deck-overlays) ──────
                View-scoped overlay decks layered OVER the main deck. Each
                overlay is a CLEAN, self-contained, color-tagged card that
                collapses to a one-line header and expands on tap; a single
                shared header drives the unison auto-cycle cadence for the
                whole group, and a "+ ADD OVERLAY" affordance (hidden at the
                4-overlay cap) opens a view + playlist picker. Reads the
                overlay list + shared autopilot off the same `deck` WS message
                this tab already consumes; PlaylistPanel (role="deckOverlay")
                drives each overlay's playlist. */}
            <DeckOverlayStack
              overlays={deckOverlays}
              overlayAutopilot={overlayAutopilot}
              playlistLibrary={playlistLibrary}
              disabled={isConnected === false}
            />

            {/* Channel parameters for the deck (base) channel. The deck is
                hard-wired to the base channel; CaptainPad's MIXER tab is
                where multi-channel routing lives. */}
            <View style={{ gap: 24, paddingRight: 24 }}>
              {(deckChannel ? [deckChannel] : []).map((channel) => {
                const channelTitle = "DECK MAIN";
                const exports = channel.exports || [];
                // GlobalParams (above) is now responsible for surfacing
                // CPC-matched local exports with a MATCHED badge. This
                // bottom strip just renders the operator-tappable ones,
                // so filter the matched toggles/triggers out here to
                // avoid double-listing them.
                const toggles = exports.filter((e: any) => e.kind === 2 && !e.cpcOwned);
                const triggers = exports.filter((e: any) => e.kind === 3 && !e.cpcOwned);

                return (
                  <View key={channel.id} style={[
                    { width: '100%', backgroundColor: C.surfaceContainerLowest, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.ghostBorder },
                    // Color accent (docs/39 §8.4): tint the card's left edge so
                    // the operator can identify the deck at a glance — mirrors the
                    // mixer strip. The lock border still wins (operator-critical
                    // state); only paint the accent when the deck isn't locked.
                    // No layout shift when color is null (defaults to ghostBorder
                    // at the same 1px width).
                    !channel.locked && channel.color ? { borderColor: channel.color, borderLeftWidth: 4 } : null,
                  ]}>
                    {/* D6 trigger: ◎ ALL pill next to the entry label.
                        Disabled when no deck playlist is loaded — the
                        AllModulationsPanel renders an empty state in
                        that case but the disabled affordance is a
                        clearer signal up-front. */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <View style={{ flex: 1 }}>
                        {/* Renaming the active playlist entry: tap the title and type.
                            Auto-saves on blur; the PlaylistPanel listens for the same
                            `playlistSaved` broadcast and flashes its ✓ SAVED toast. */}
                        <EntryLabelEditor
                          channelId={channel.id}
                          channelLabel={channelTitle}
                          locked={!!channel.locked}
                        />
                      </View>
                      {/* SAVED flash moved up here from inside GlobalParams
                          so it never reflows the slider stack. The component
                          always reserves the same width/height — the inner
                          pill only fades in/out. */}
                      <DeckSavedFlash deckChannelId={channel.id} />
                      {/* Color swatch (docs/39 §8.4) — taps open the accent
                          picker. The swatch fill IS the deck's current color
                          (or a hollow "no color" ring when null). Pure
                          metadata; tints the card for identification, no render
                          effect. Mirrors the mixer strip's swatch button. */}
                      <TouchableOpacity
                        onPress={() => setShowColorPicker(true)}
                        hitSlop={ICON_BTN_HIT_SLOP}
                        accessibilityRole="button"
                        accessibilityLabel={channel.color ? `Deck color ${channel.color}` : 'Set deck color'}
                        style={[
                          styles.deckSwatchBtn,
                          { borderColor: C.ghostBorder },
                          channel.color ? { backgroundColor: channel.color, borderColor: channel.color } : null,
                        ]}
                      >
                        <Text style={{
                          fontFamily: 'SpaceGrotesk_700Bold',
                          fontSize: 13,
                          color: channel.color ? '#FFFFFF' : C.secondary,
                        }}>{channel.color ? '●' : '○'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setShowAllMods(true)}
                        disabled={!channel.playlist?.name}
                        accessibilityLabel="Open all modulations panel"
                        accessibilityRole="button"
                        // Production-console touch target: the pill is
                        // visually compact (fontSize 11 + 4pt vertical
                        // padding) so we expand the tappable area with
                        // hitSlop + a 44pt min height/width instead of
                        // inflating the chrome, keeping the header tidy.
                        hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
                        style={{
                          paddingHorizontal: 12, borderRadius: 6,
                          minHeight: 44, minWidth: 44,
                          alignItems: 'center', justifyContent: 'center',
                          borderWidth: 1, borderColor: '#00a86b',
                          backgroundColor: 'transparent',
                          opacity: channel.playlist?.name ? 1 : 0.4,
                        }}
                      >
                        <Text style={{
                          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
                          color: '#00a86b', letterSpacing: 0.5,
                        }}>
                          ◎ ALL
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={{ marginBottom: 16 }}>
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, marginBottom: 16, textTransform: 'uppercase' }}>PARAMETERS</Text>
                      <GlobalParams variant="deck" channelId={channel.id} exports={exports} />
                    </View>

                    {/* CAP (faderMax) fader removed June 2026 — the per-deck
                        intensity ceiling UI was a "never dark" hazard (a stored
                        cap < 1.0 silently dimmed the exterior with no visible
                        control to undo it). faderMax remains a valid engine
                        field, forced open to 1.0 once at mount (see the seed's
                        capClearedRef one-shot). Mirrors the already-removed
                        mixer-strip CAP row. */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 16, gap: 8 }}>
                      {toggles.map((e: any) => (
                        <ToggleButton key={`toggle-${e.id}`} id={e.id} name={e.name} initialValue={e.v0 ?? 0} onChange={(id: number, v: number) => triggerChannelControl(channel.id, id, v)} />
                      ))}
                      {triggers.map((e: any) => (
                        <MomentaryButton key={`trigger-${e.id}`} id={e.id} name={e.name} onChange={(id: number, v: number) => triggerChannelControl(channel.id, id, v)} />
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>
      {/* ── Global Rig Controls (Bottom) ───────────────────────────────
          GLOBAL EFFECTS as a full-width horizontal strip pinned at the
          bottom of the deck — mirrors the mixer tab's bottom bar so the
          effect labels ("Vintage White", "Iceberg Flash", "Blackout"…)
          render at full width and stay legible, instead of being crammed
          into the narrow left playlist column (QA round2 deck fix). The
          two-pane `container` above is flex:1 so it fills the space above
          this bar and its right pane scrolls independently; this bar is
          intrinsic-height so it never overlaps or gets cut off. The deck
          has no PANIC control (that's a mixer-only safe-reset), so unlike
          the mixer's bottom bar there is no PANIC button beside it. The
          HUE shifter is omitted by the strip variant itself (it has its
          own deck-grid placement) — see GlobalEffectMacros `mixer-strip`. */}
      <View style={[styles.globalRigBar, { backgroundColor: C.surfaceContainerLow, borderTopColor: C.ghostBorder }]}>
        <RigGlobals variant="mixer" />
      </View>
      {/* D6: floating ALL MODULATIONS overlay — rendered at the screen
          level so it draws above every card. */}
      <AllModulationsPanel
        visible={showAllMods}
        onClose={() => setShowAllMods(false)}
        playlistName={deckChannel?.playlist?.name ?? null}
        activeEntryId={deckChannel?.playlist?.activeEntryId ?? null}
      />
      {/* Deck channel color picker (docs/39 §8.4). A swatch grid + a "NO COLOR"
          clear option (color = null). Pure metadata — tints the deck card for
          identification, no render effect. Mirrors the mixer strip's picker.
          Screen-level so it draws above every card. */}
      <Modal transparent visible={showColorPicker} animationType="fade" onRequestClose={() => setShowColorPicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowColorPicker(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.modalContent, { backgroundColor: C.surfaceContainerHigh, borderColor: C.ghostBorder }]}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: C.secondary, textTransform: 'uppercase', marginBottom: 12 }}>DECK COLOR</Text>
              <View style={styles.swatchGrid}>
                {CHANNEL_COLOR_SWATCHES.map((hex) => {
                  const active = (deckChannel?.color ?? null) === hex;
                  return (
                    <TouchableOpacity
                      key={hex}
                      style={[styles.swatch, { backgroundColor: hex }, active && styles.swatchActive]}
                      hitSlop={ICON_BTN_HIT_SLOP}
                      onPress={() => { if (deckChannelId) handleDeckColor(deckChannelId, hex); setShowColorPicker(false); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Set deck color ${hex}`}
                      accessibilityState={{ selected: active }}
                    >
                      {active ? <Text style={styles.swatchCheck}>✓</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={[styles.clearColorBtn, { borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerHigh }]}
                onPress={() => { if (deckChannelId) handleDeckColor(deckChannelId, null); setShowColorPicker(false); }}
                accessibilityRole="button"
                accessibilityLabel="Clear deck color"
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.secondary }}>NO COLOR</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
      {/* Cue-to-deck picker (docs/39 §F-cue). A list of the live mixer overlays
          plus a CLEAR option. Tapping an overlay auditions it on the deck
          preview buffer at 100% (PFL) without pushing it live. Screen-level so
          it draws above every card. */}
      <Modal transparent visible={showCuePicker} animationType="fade" onRequestClose={() => setShowCuePicker(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowCuePicker(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={[styles.modalContent, { backgroundColor: C.surfaceContainerHigh, borderColor: C.ghostBorder, minWidth: 260 }]}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: C.secondary, textTransform: 'uppercase', marginBottom: 12 }}>
                CUE OVERLAY TO DECK PREVIEW
              </Text>
              {cueOverlays.length === 0 ? (
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.secondary, marginBottom: 12 }}>
                  No mixer overlays to cue. Add one on the Mixer tab.
                </Text>
              ) : (
                cueOverlays.map((ov) => {
                  const active = activeCueId === ov.id;
                  const label = (typeof ov.name === 'string' && ov.name.length) ? ov.name : ov.id.slice(0, 8);
                  return (
                    <TouchableOpacity
                      key={ov.id}
                      style={[styles.cueRow, { borderColor: active ? C.primary : C.ghostBorder, backgroundColor: active ? C.surfaceContainerHigh : 'transparent' }]}
                      onPress={() => { handleSetCue(ov.id); setShowCuePicker(false); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Cue ${label} onto the deck preview`}
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: active ? C.primary : C.text }}>{label}</Text>
                      {active ? <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.primary }}>✓</Text> : null}
                    </TouchableOpacity>
                  );
                })
              )}
              <TouchableOpacity
                style={[styles.clearColorBtn, { borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerHigh, marginTop: 4 }]}
                onPress={() => { handleSetCue(null); setShowCuePicker(false); }}
                accessibilityRole="button"
                accessibilityLabel="Clear deck cue (show the canonical deck view)"
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.secondary }}>CLEAR CUE</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// Local styles for the cue header + color-picker recipe (docs/39 §8.4).
// Palette-dependent colors are applied inline at the call site (this screen
// reads the palette via the usePalette hook, not a StyleSheet factory).
// (The CAP row styles — capRow/faderTrack/capFill — were removed June 2026
// alongside the deck CAP fader.)
const styles = StyleSheet.create({
  // Bottom-pinned global-effects strip — the deck mirror of the mixer
  // tab's `globalRigBar`. Full-width, intentionally short (header + a
  // single ~36px button row + small padding) so it doesn't eat the
  // playlist / params real-estate above it. alignItems:'stretch' so the
  // inner GEM (flex:1 in mixer-strip mode) spans edge-to-edge instead of
  // collapsing to its intrinsic content width and floating left. Palette
  // colors (surfaceContainerLow bg + ghostBorder top) are applied inline
  // at the call site — this screen reads the palette via usePalette, not
  // a StyleSheet factory.
  globalRigBar: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 6,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  deckSwatchBtn: {
    width: 44, height: 44, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  // Cue-to-deck (docs/39 §F-cue): the CUE / CLEAR buttons in the preview
  // header. 44pt min touch target; the row reserves height so arming a cue
  // never shifts the preview strip below.
  cueBtn: {
    minHeight: 44, minWidth: 44,
    paddingHorizontal: 12,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 6, borderWidth: 1,
  },
  cueActiveChip: {
    minHeight: 44,
    paddingHorizontal: 10,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 6, borderWidth: 1,
  },
  cueRow: {
    minHeight: 44,
    paddingHorizontal: 14, paddingVertical: 8,
    marginBottom: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 8, borderWidth: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
  },
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
  },
});
