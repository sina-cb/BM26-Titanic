import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  fetchPlaylists, fetchPlaylist, savePlaylist, deletePlaylist,
  fetchChannelPlaylist, setChannelPlaylist, setChannelPlaylistEntry,
  swapChannelPlaylist,
  fetchPatterns, fetchPatternDirs, fetchPatternsInDir,
  getApiBaseAsync,
  invalidatePlaylistCache, invalidatePlaylistsCache, primePlaylistCache,
  PlaylistData, PlaylistEntry, PlaylistAssignment,
  type ChannelRole,
} from '@/utils/api';
import { engineEvents, EngineMessage } from '@/utils/engineEvents';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import AsyncStorage from '@react-native-async-storage/async-storage';

// "1 list to rule them all": this component renders the active playlist's
// entries AS the channel's pattern queue. There's no separate "all patterns"
// list anywhere in the deck or mixer — adding new patterns to a slot is an
// explicit `+` action that opens a quick picker.
//
// Auto-save model:
//   - Adding or removing an entry persists immediately to disk (no manual
//     SAVE needed). A "✓ saved" toast appears briefly.
//   - Live parameter edits also auto-save via the engine's debounced
//     `scheduleEntryCapture()` (500 ms after last slider tick). The engine
//     broadcasts `playlistEntryCaptured` which flashes the same toast here.
//
// Cross-tab consistency:
//   - The panel subscribes to engineEvents (`mixer`, `playlistLibrary`,
//     `playlistEntryCaptured`) so deck and mixer stay in lockstep when one
//     side changes things. `useFocusEffect` also refreshes on tab focus.
interface Props {
  channelId: string;
  /** Role decides which API endpoint backs this panel. Post slot 6
   *  channel_isolation, /mixer/channels/:id/* and /deck/* are strict
   *  about role — hitting the wrong one returns HTTP 400 WRONG_ROLE
   *  and the panel will retry-loop forever showing "failed to load".
   *  Deck tab MUST pass 'deck'; mixer strips default to 'mixer'. */
  role?: ChannelRole;
  /** Section header text. Falls back to "PLAYLIST". */
  channelLabel?: string;
  /** Tight padding/font, capped list height — for mixer strips. */
  compact?: boolean;
  /** When the channel is locked, hide destructive controls (+, –, library
   *  picker, SAVE). Taps on entries still work so an operator can perform
   *  the show, but the playlist contents are frozen for safety. */
  locked?: boolean;
  /** When true, all entry taps are no-ops and the list is greyed out.
   *  Used by the deck tab to ignore operator taps during an in-flight
   *  pattern transition — server also rejects with 409, this just makes
   *  the lock visible (and avoids the operator hearing the "switch
   *  failed" alert spam if they tap repeatedly). */
  disabled?: boolean;
  /** Pre-known playlist assignment from the parent (mixer.tsx, which
   *  already has it from the engine's mixer broadcast). When provided,
   *  the panel renders the dropdown label immediately instead of
   *  flashing "LOAD…" while waiting for its own
   *  /mixer/channels/<id>/playlist GET to come back. Important during
   *  rapid-add scenarios where N panels mount together — without this
   *  hint the engine sees N parallel GETs and some can stall past the
   *  8 s fetch timeout.
   *
   *  Live updates: this prop is ALSO honoured when it changes from
   *  null → non-null (or between names) AFTER first render. That is
   *  the failure mode we used to hit on the iPad when a channel was
   *  added via "+ default" / "+ from playlist": the parent's first
   *  render of the new PlaylistPanel could see `channel.playlist`
   *  arrive on the SECOND mixer broadcast (a few ms after mount), and
   *  useState's initial value was already locked in as `null`. The
   *  `useEffect([initialAssignment])` below adopts the late prop.
   */
  initialAssignment?: PlaylistAssignment | null;
  /** Pre-fetched playlist content (entries + defaults) from the parent.
   *  When the iPad's POST /mixer/channels response arrives, it carries
   *  the FULL playlist inline as `playlistData`. The mixer screen
   *  caches that keyed by channelId and forwards it here so the panel
   *  can render the entry list on first paint — without depending on
   *  refresh()'s own GETs to succeed. This is the synchronous-hand-off
   *  guarantee that makes "+ default" / "+ from playlist" feel instant
   *  even when the iPad's wifi is laggy and the panel's own refresh
   *  GETs would otherwise race the WS broadcast and lose. Honoured on
   *  every prop change (not just first render) for the same late-prop
   *  reason as `initialAssignment` above. */
  initialPlaylist?: PlaylistData | null;
  /** Optional refresh / reconnect handler. When provided, a small
   *  ↻ icon button is rendered in the panel header (top-right) so the
   *  operator can reconnect to the engine without leaving the playlist
   *  view. Used by the deck tab to replace the old full-width
   *  REFRESH/RECONNECT button that was eating vertical space below the
   *  list. */
  onRefreshConnection?: () => void;
  /** Bump this from the parent to force a hard reload of the playlist
   *  library, the channel's assignment, and the playlist's entries
   *  (busts the per-name + global playlists caches first). The mixer
   *  channel strip's name-row refresh arrow uses this so the operator
   *  has a one-tap rescue for a panel that lost its entries to a WS
   *  race or transient fetch failure. The default (0) never triggers a
   *  reload — only a CHANGE in the value does. */
  refreshNonce?: number;
  /** Parent-owned playlist library list. When provided, the panel uses
   *  this instead of its own /playlists fetch. This is the May-2026
   *  refactor (mixer.tsx + index.tsx own one shared list, kept fresh
   *  by the engine's `playlistLibrary` WS event) — eliminates N parallel
   *  GETs under burst channel adds, which was the original
   *  "no playlists yet on 3rd channel" symptom. */
  playlistLibrary?: string[];
}

function genEntryId() {
  return `e_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function sanitizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 64);
}

// Display name for an entry's pattern: strip the directory prefix so a
// folder-loaded pattern reads as "trans_crossfade", not
// "transitions/trans_crossfade". The stored `pattern` keeps the full
// `<dir>/<name>` slug — the engine needs it to locate the .js file.
function patternDisplayName(pattern: string): string {
  const i = pattern.lastIndexOf('/');
  return i >= 0 ? pattern.slice(i + 1) : pattern;
}

export const PlaylistPanel: React.FC<Props> = ({ channelId, role = 'mixer', channelLabel, compact, locked, disabled, initialAssignment, initialPlaylist, onRefreshConnection, refreshNonce, playlistLibrary }) => {
  const C = usePalette();
  // playlistLibrary is currently consumed via the local `playlists`
  // state + engineEvents `playlistLibrary` subscription further down.
  // The prop is accepted so parents (mixer/index) can pass their
  // single shared list; if provided we still let the local state
  // mirror it so existing render paths don't have to fork.
  void playlistLibrary;
  const [playlists, setPlaylists] = useState<string[]>([]);
  // Seed assignment from parent immediately so the dropdown shows the
  // playlist name on first render — no "LOAD…" flash while the panel
  // races its own /mixer/channels/<id>/playlist GET to land.
  const [assignment, setAssignment] = useState<PlaylistAssignment | null>(initialAssignment ?? null);
  // Seed entries-list content from parent too. When mixer.tsx forwards the
  // inline `playlistData` from the POST /mixer/channels response (keyed by
  // the new channel's id), patterns appear synchronously on first paint
  // and the panel never has to depend on refresh()'s GETs landing in time.
  const [playlist, setPlaylist] = useState<PlaylistData | null>(initialPlaylist ?? null);
  const [allPatterns, setAllPatterns] = useState<string[]>([]);
  // "Load directory" support: the patterns/ sub-folders the operator can
  // bulk-add from. Fetched lazily the first time the picker opens so the
  // panel's hot path (mount + refresh under burst channel adds) doesn't
  // pay an extra GET it rarely needs.
  const [patternDirs, setPatternDirs] = useState<string[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  // Hot-swap picker (feat/timeline_support). Distinct from the LOAD
  // dropdown: this opens a picker of DIFFERENT playlists and rides the
  // deck/mixer transition machinery to crossfade onto the picked one's
  // first usable entry, rather than the plain assignment LOAD does.
  const [showSwap, setShowSwap] = useState(false);
  // ConfirmSheet target for the hot swap — picking a playlist in the
  // swap picker arms this; the swap only fires on explicit confirmation
  // so an accidental tap can't crossfade the whole channel mid-show.
  const [swapPrompt, setSwapPrompt] = useState<string | null>(null);
  const [swapInFlight, setSwapInFlight] = useState(false);
  // Re-entrancy guard for the hot swap. `swapInFlight` STATE drives the
  // disabled/opacity chrome, but state updates are async — two confirms
  // in the same tick can both read swapInFlight===false before the first
  // setSwapInFlight(true) flushes, so both would queue a crossfade. This
  // ref flips synchronously, closing that double-fire window.
  const swapInFlightRef = useRef(false);
  const [showAddPattern, setShowAddPattern] = useState(false);
  const [showLoadDir, setShowLoadDir] = useState(false);
  // "New playlist from folder" name prompt. `pendingNewDir` holds the
  // folder whose patterns will seed the playlist while the operator names
  // it; the name modal is open whenever it's non-null.
  const [pendingNewDir, setPendingNewDir] = useState<string | null>(null);
  const [newDirPlaylistName, setNewDirPlaylistName] = useState('');
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Playlist-edits lock — operator-toggled gate that hides every
  // destructive edit affordance on the deck's playlist: per-row up/down
  // chevrons, per-row remove (−) button, and the header's add (+)
  // button. Mid-show, operators worry about brushing any of these by
  // accident and quietly mutating the set. With the lock engaged none
  // of them render (no visual affordance, no tap target). The lock
  // control sits next to the refresh icon in the header so it's
  // discoverable from where the operator already looks. Deck-only —
  // mixer channels already have their own channel-scoped lock.
  //
  // Persisted to AsyncStorage so the choice survives panel remounts +
  // app restarts; default = unlocked so existing iPads keep current
  // behavior until the operator opts in.
  const REORDER_LOCK_STORAGE_KEY = '@CaptainPad:deck:playlistEditsLocked';
  const [playlistEditsLocked, setReorderLocked] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(REORDER_LOCK_STORAGE_KEY)
      .then((v) => { if (v === 'true') setReorderLocked(true); })
      .catch(() => undefined);
  }, []);
  const toggleReorderLock = useCallback(() => {
    setReorderLocked((prev) => {
      const next = !prev;
      AsyncStorage.setItem(REORDER_LOCK_STORAGE_KEY, next ? 'true' : 'false')
        .catch(() => undefined);
      return next;
    });
  }, []);

  // Mid-transition reconciliation suppression. Operator report
  // 2026-05-29: when transitions are enabled and the operator taps a
  // new pattern, the row highlight bounces NEW → OLD → NEW. Root cause:
  // the engine keeps reporting the OLD activeEntryId in its WS
  // broadcasts (mixer / deck / channelPlaylistData) until the
  // transition completes ~Ns later. Our optimistic flip lands on NEW,
  // then the broadcast (still OLD) overwrites it, then the
  // post-transition broadcast settles on NEW.
  //
  // Fix: when the operator taps, record the target id in
  // `pendingActiveEntryIdRef`. While that ref is non-null, broadcasts
  // whose activeEntryId DOESN'T match the target are ignored — the
  // engine is mid-transition and the operator's intent is the source
  // of truth. The moment a broadcast arrives WITH the target we clear
  // the ref and adopt the engine state. A watchdog clears the ref
  // after PENDING_WATCHDOG_MS in case the engine never confirms (the
  // transition was cancelled out-of-band, the network dropped, …) so
  // the panel can't get stranded ignoring real state forever.
  const pendingActiveEntryIdRef = useRef<string | null>(null);
  const pendingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PENDING_WATCHDOG_MS = 8000;
  const armPendingWatchdog = useCallback(() => {
    if (pendingWatchdogRef.current) clearTimeout(pendingWatchdogRef.current);
    pendingWatchdogRef.current = setTimeout(() => {
      pendingActiveEntryIdRef.current = null;
      pendingWatchdogRef.current = null;
    }, PENDING_WATCHDOG_MS);
  }, []);
  const clearPending = useCallback(() => {
    pendingActiveEntryIdRef.current = null;
    if (pendingWatchdogRef.current) {
      clearTimeout(pendingWatchdogRef.current);
      pendingWatchdogRef.current = null;
    }
  }, []);
  // Returns true when the broadcast is mid-transition (engine reports
  // an activeEntryId that doesn't match what the operator just asked
  // for). Callers should bail out without applying the reconciliation.
  // When the broadcast MATCHES the pending target, this also clears
  // the gate as a side effect — the next reconciliation pass will run
  // unhindered.
  const shouldSuppressReconcile = useCallback((incomingActiveEntryId: string | null | undefined, source: string): boolean => {
    const pending = pendingActiveEntryIdRef.current;
    const local = assignmentRef.current?.activeEntryId ?? null;
    if (!pending) {
      console.log(`[PLAYLIST_DBG] reconcile/${source}: no pending, incoming=${incomingActiveEntryId} local=${local} → ACCEPT`);
      return false;
    }
    if (incomingActiveEntryId === pending) {
      console.log(`[PLAYLIST_DBG] reconcile/${source}: pending=${pending} matched, clearing → ACCEPT`);
      clearPending();
      return false;
    }
    console.log(`[PLAYLIST_DBG] reconcile/${source}: pending=${pending} ≠ incoming=${incomingActiveEntryId} → SUPPRESS`);
    return true;
  }, [clearPending]);
  useEffect(() => {
    return () => {
      if (pendingWatchdogRef.current) clearTimeout(pendingWatchdogRef.current);
    };
  }, []);

  // ── Why the dropdown has no `busy` gate anymore ─────────────────────
  // The previous design wrapped handleLoadPlaylist in a busy flag and
  // disabled the dropdown while the POST was in-flight. Two failure
  // modes operators reported:
  //   1. "After selecting a new playlist, the dropdown is not usable
  //      anymore on that channel" — busy somehow stayed true past the
  //      POST. Even with the v2 watchdog the operator perceived the
  //      6-second window as "permanently broken".
  //   2. "Watchdog is a shitty approach, make sure the button works
  //      correctly" — the v2 watchdog was an explicit anti-pattern.
  //
  // The root cause is real but subtle: any path that sets a UI gate
  // and tries to clear it from an async continuation is at the mercy
  // of (a) React batching, (b) the WS event handler running between
  // the await and the finally, (c) the component unmounting mid-await
  // (Fast Refresh, route change, channel removal), and (d) any
  // exception inside the finally itself. In production the operator
  // does sometimes see the flag get stranded.
  //
  // The cure is to NOT GATE the dropdown at all. The dropdown opens
  // a Modal — a pure UI action — and the modal's onLoad fires the
  // POST. Concurrent POSTs are legal on the engine side (last-write
  // wins), the optimistic local state gives instant visual feedback,
  // and the WS broadcast reconciles the canonical state in <10 ms.
  // No state machine, no watchdog, no stranded-flag failure mode.
  // The `+` and entry-tap buttons keep their own narrower disabled
  // states (no-playlist, already-active, in-transition) which are
  // derived from already-tracked state with no try/finally needed.

  // Single source of truth: avoid stale closures inside the WS event
  // listener by routing through refs.
  const playlistRef = useRef<PlaylistData | null>(null);
  const assignmentRef = useRef<PlaylistAssignment | null>(null);
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { assignmentRef.current = assignment; }, [assignment]);

  // ── Late-prop hydration: adopt initialAssignment / initialPlaylist ──
  //
  // The mixer screen now caches the POST /mixer/channels response's
  // inline playlist payload keyed by the new channel id and forwards
  // it here. But because of how React batches mixer broadcasts vs the
  // first paint of the new PlaylistPanel, the prop value at FIRST
  // RENDER can still be null even though the parent already has the
  // data — useState's initial value gets captured before the parent's
  // setState lands. These effects pick up the prop the moment it
  // becomes non-null (or changes name) so we never depend on
  // refresh()'s own GETs landing in time. This is THE fix for the
  // "+ default / + from playlist → patterns don't show until I re-pick
  // from the dropdown" iPad bug — without it, the panel sat empty
  // when refresh() raced the slow iPad wifi and lost.
  //
  // No-ops when the value matches what we already have, so a chatty
  // parent that re-renders the same assignment object on every WS
  // broadcast doesn't cause unnecessary state updates.
  useEffect(() => {
    if (!initialAssignment) return;
    const cur = assignmentRef.current;
    if (cur && cur.name === initialAssignment.name && cur.activeEntryId === initialAssignment.activeEntryId) return;
    setAssignment(initialAssignment);
  }, [initialAssignment]);
  useEffect(() => {
    if (!initialPlaylist || !initialPlaylist.name) return;
    const cur = playlistRef.current;
    // Adopt if we have no playlist yet OR the parent's snapshot is for
    // a different name (operator re-picked from the dropdown and the
    // mixer screen pushed a fresh payload through). Same-name same-
    // length snapshots are skipped because refresh() / WS playlistSaved
    // events are the canonical source of subsequent edits.
    if (!cur || cur.name !== initialPlaylist.name) {
      setPlaylist(initialPlaylist);
    }
  }, [initialPlaylist]);

  // Scroll-active-entry-into-view machinery (item 2 in the user
  // feedback). When the deck auto-swaps to the next pattern, the
  // operator wants the playlist to scroll so the new active row is
  // visible — otherwise on a 20-entry playlist they have no idea
  // which one is playing.
  //
  // We track per-row y offsets via onLayout, plus the ScrollView's
  // visible height. When the active id changes we scroll to centre
  // that row in the viewport (clamped to [0, contentHeight - height]).
  const scrollRef = useRef<ScrollView>(null);
  const rowOffsetsRef = useRef<Map<string, { y: number; h: number }>>(new Map());
  const viewportHeightRef = useRef<number>(0);
  const contentHeightRef = useRef<number>(0);
  const scrollActiveIntoView = useCallback((entryId: string | null | undefined) => {
    if (!entryId || !scrollRef.current) return;
    const row = rowOffsetsRef.current.get(entryId);
    if (!row) return;
    const viewportH = viewportHeightRef.current || 0;
    const contentH = contentHeightRef.current || 0;
    if (viewportH <= 0) return;
    // Centre the row vertically; clamp so we don't try to scroll
    // past the content edges (which RN would clip silently anyway,
    // but explicit clamping avoids janky overscroll bounce).
    let targetY = row.y + row.h / 2 - viewportH / 2;
    targetY = Math.max(0, Math.min(targetY, Math.max(0, contentH - viewportH)));
    scrollRef.current.scrollTo({ y: targetY, animated: true });
  }, []);

  // ── Saved-toast: visible for 1.4 s after the last save ──────────────
  const flashSaved = useCallback(() => {
    setSavedAt(Date.now());
  }, []);
  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 1400);
    return () => clearTimeout(t);
  }, [savedAt]);

  // ── Data refresh ─────────────────────────────────────────────────────
  // refresh() is the panel's only path to "I have a playlist to show".
  // If this hits a flaky network on the first attempt the panel goes
  // blank and never recovers (the user reported "mixer can't see
  // playlists for channels"). Two defences:
  //   1. Each fetch has an 8s timeout (utils/api fetchWithTimeout) so
  //      hung requests reject instead of hanging the panel.
  //   2. On any non-ok response we schedule a single retry after 1.5s,
  //      then leave it to the WS `mixer` event or the next tab focus.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(async () => {
    if (!channelId) return;
    try {
      await getApiBaseAsync();
      // Use whatever assignment hint we already have to KICK OFF the
      // playlist-content fetch in parallel with the global library +
      // patterns fetches. Without this hint we had to wait for the
      // /mixer/channels/<id>/playlist GET to come back before we even
      // started /playlists/<name>. Under load that serial second hop
      // is what left newly-added panels stranded on "loading"
      // forever — the canonical refresh would finish, the assignment
      // would land, but the second fetch could already be wedged.
      const knownName = assignmentRef.current?.name ?? null;
      const [lib, a, ps, plHint] = await Promise.all([
        fetchPlaylists(),
        fetchChannelPlaylist(role, channelId),
        fetchPatterns(),
        knownName ? fetchPlaylist(knownName) : Promise.resolve(null),
      ]);
      const anyFailed = !lib.ok || !a.ok || !ps.ok;
      if (lib.ok && lib.data) setPlaylists(lib.data);
      // If we have an existing assignment (from initialAssignment or
      // a prior WS broadcast) and the GET returned null, that's
      // almost always a transient state on the engine — the new
      // channel was just created and its playlist field hadn't
      // populated yet when the iPad's GET landed. Keep what we have
      // rather than clearing the dropdown back to "LOAD…", and
      // schedule a retry so we re-converge to the real engine state.
      // Without this guard, a brand-new channel whose GET races the
      // engine's loadPlaylistEntry would flip the panel from
      // "default" back to "LOAD…" and the entries would never show.
      const nextAssign = a.ok ? (a.data || null) : null;
      const effectiveAssign = nextAssign || assignmentRef.current || null;
      // refresh() reaches here regardless of the pending-gate state. If
      // we have a pending target and the GET response disagrees with
      // it (engine still mid-transition), DO NOT clobber the optimistic
      // flip — preserve the operator's intent until a broadcast finally
      // confirms.
      const pending = pendingActiveEntryIdRef.current;
      if (pending && effectiveAssign && effectiveAssign.activeEntryId !== pending) {
        console.log(`[PLAYLIST_DBG] refresh() GET returned activeEntryId=${effectiveAssign?.activeEntryId} but pending=${pending} → SKIP setAssignment`);
      } else {
        if (pending && effectiveAssign && effectiveAssign.activeEntryId === pending) {
          console.log(`[PLAYLIST_DBG] refresh() GET returned activeEntryId=${effectiveAssign?.activeEntryId} matches pending → clear + setAssignment`);
          clearPending();
        } else {
          console.log(`[PLAYLIST_DBG] refresh() GET → setAssignment activeEntryId=${effectiveAssign?.activeEntryId}`);
        }
        setAssignment(effectiveAssign);
      }
      if (a.ok && !nextAssign && assignmentRef.current) scheduleRetry();

      // If our hint was right (same name the engine reports), the
      // optimistic fetchPlaylist we kicked off above is already
      // resolved — adopt it immediately. Otherwise issue a fresh fetch
      // for the real name; the dedupe cache in api.ts means concurrent
      // panels won't pile up.
      const targetName = effectiveAssign?.name || null;
      if (targetName) {
        if (knownName === targetName && plHint && plHint.ok && plHint.data) {
          setPlaylist(plHint.data);
        } else {
          const pl = await fetchPlaylist(targetName);
          if (pl.ok && pl.data) setPlaylist(pl.data);
          else if (!pl.ok) scheduleRetry();
        }
      } else if (a.ok) {
        // a.ok with no assignment AND no prior assignment = real
        // "no playlist" state. Safe to clear.
        setPlaylist(null);
      }
      if (ps.ok && ps.data) setAllPatterns(ps.data);
      if (anyFailed) scheduleRetry();
    } catch {
      scheduleRetry();
    }
    function scheduleRetry() {
      if (retryTimerRef.current) return;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        refresh();
      }, 1500);
    }
  }, [role, channelId]);

  useEffect(() => {
    refresh();
    return () => {
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    };
  }, [refresh]);

  // When the active entry id changes (autopilot tick, manual tap, or
  // cross-tab sync), scroll the matching row into view. Defer one tick
  // so the row's onLayout has a chance to run for newly-rendered
  // entries (e.g. when assignment + playlist arrive together on first
  // load).
  useEffect(() => {
    if (!assignment?.activeEntryId) return;
    const t = setTimeout(() => scrollActiveIntoView(assignment.activeEntryId), 50);
    return () => clearTimeout(t);
  }, [assignment?.activeEntryId, scrollActiveIntoView]);

  // Refresh whenever this tab gains focus (e.g. switching between Deck and
  // Mixer) so cross-tab edits show up immediately.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // Parent-driven hard refresh. Bumping `refreshNonce` from the parent
  // (the channel strip's name-row arrow) invalidates BOTH the global
  // playlists library cache AND this channel's playlist cache, then
  // re-fires refresh(). This is the operator's rescue path when a panel
  // has lost its entries to a transient WS race or fetch failure — no
  // need to delete and re-add the channel. We skip the initial render
  // (nonce === 0 / undefined on first mount) so the regular mount
  // refresh effect handles the cold-start case cleanly.
  const prevNonceRef = useRef<number | undefined>(refreshNonce);
  useEffect(() => {
    if (prevNonceRef.current === refreshNonce) return;
    prevNonceRef.current = refreshNonce;
    if (refreshNonce === undefined) return;
    invalidatePlaylistsCache();
    const cur = assignmentRef.current?.name;
    if (cur) invalidatePlaylistCache(cur);
    refresh();
  }, [refreshNonce, refresh]);

  // Subscribe to engine WS broadcasts via the global bus. The screen-level
  // ws.onmessage forwards every parsed message here.
  //
  // Post slot 6 channel_isolation, the engine emits TWO state events:
  //   - `mixer` carries the mixer overlay array (`channels[]`)
  //   - `deck`  carries the deck channel as a single `channel` field
  // A PlaylistPanel only listens to the event matching its role so it
  // doesn't react to a sibling channel's swap.
  useEffect(() => {
    return engineEvents.subscribe((msg: EngineMessage) => {
      if (role === 'mixer' && msg.type === 'mixer') {
        // If our channel's playlist assignment changed under us (because a
        // sibling tab swapped playlists, or autopilot stepped to a new
        // entry), pick that up.
        const channels = (msg.channels as { id: string; playlist?: PlaylistAssignment | null }[]) || [];
        const ch = channels.find((c) => c.id === channelId);
        if (!ch) return;
        const next = ch.playlist || null;
        // Mid-transition gate — engine's activeEntryId may still be the
        // PRIOR entry while it transitions to the one the operator
        // just asked for. Ignore until it matches.
        if (shouldSuppressReconcile(next?.activeEntryId ?? null, 'mixer')) return;
        const local = assignmentRef.current;
        const changed =
          (local?.name ?? null) !== (next?.name ?? null) ||
          (local?.activeEntryId ?? null) !== (next?.activeEntryId ?? null);
        if (changed) {
          console.log(`[PLAYLIST_DBG] mixer event triggers refresh: local=${local?.activeEntryId} next=${next?.activeEntryId}`);
          refresh();
        }
      } else if (role === 'deck' && msg.type === 'deck') {
        // Deck event: `channel` is a single object (or null), not an array.
        const ch = msg.channel as { id?: string; playlist?: PlaylistAssignment | null } | null | undefined;
        if (!ch || ch.id !== channelId) return;
        const next = ch.playlist || null;
        if (shouldSuppressReconcile(next?.activeEntryId ?? null, 'deck')) return;
        const local = assignmentRef.current;
        const changed =
          (local?.name ?? null) !== (next?.name ?? null) ||
          (local?.activeEntryId ?? null) !== (next?.activeEntryId ?? null);
        if (changed) {
          console.log(`[PLAYLIST_DBG] deck event triggers refresh: local=${local?.activeEntryId} next=${next?.activeEntryId}`);
          refresh();
        }
      } else if (role === 'deckOverlay' && msg.type === 'deck') {
        // Deck dynamic VIEW OVERRIDE event: this overlay's assignment rides
        // the `deck` message's `overlays[]` array (engine #deck-overlays
        // folds it in — no new WS type). Find our overlay by id and adopt
        // its playlist exactly like the deck channel does above.
        const overlays = (msg.overlays as { id?: string; playlist?: PlaylistAssignment | null }[]) || [];
        const ovCh = overlays.find((o) => o && o.id === channelId);
        if (!ovCh) return;
        const next = ovCh.playlist || null;
        if (shouldSuppressReconcile(next?.activeEntryId ?? null, 'deckOverlay')) return;
        const local = assignmentRef.current;
        const changed =
          (local?.name ?? null) !== (next?.name ?? null) ||
          (local?.activeEntryId ?? null) !== (next?.activeEntryId ?? null);
        if (changed) refresh();
      } else if (msg.type === 'channelPlaylistData') {
        // Engine emits this whenever a channel's playlist is set or
        // swapped (before the mixer event that announces the
        // change). It carries the FULL playlist content inline so we
        // can prime the per-name cache — when this channel's
        // PlaylistPanel mounts and tries to fetchPlaylist(name),
        // it hits the primed cache instead of issuing a slow GET that
        // might race the broadcast.
        if (msg.playlistData && typeof msg.playlistData === 'object' && 'name' in msg.playlistData) {
          const pd = msg.playlistData as PlaylistData;
          primePlaylistCache(pd.name, pd);
          // If the event targets US specifically, adopt the playlist
          // data immediately so the entry list renders without
          // waiting for refresh().
          if (msg.channelId === channelId) {
            setPlaylist(pd);
            if (msg.playlist && typeof msg.playlist === 'object') {
              const incoming = msg.playlist as PlaylistAssignment;
              // Mid-transition gate. If the operator just tapped a new
              // entry and the engine is still reporting the prior
              // active id, skip the assignment swap so the UI stays
              // on the requested entry instead of bouncing.
              if (!shouldSuppressReconcile(incoming.activeEntryId ?? null, 'channelPlaylistData')) {
                console.log(`[PLAYLIST_DBG] channelPlaylistData → setAssignment activeEntryId=${incoming.activeEntryId}`);
                setAssignment(incoming);
              }
            }
          }
        }
      } else if (msg.type === 'playlistLibrary') {
        // The set of playlist names changed; the shared cache in
        // api.ts is now stale — drop it so the next fetchPlaylists
        // re-hits the engine instead of returning the old list.
        invalidatePlaylistsCache();
        setPlaylists(Array.isArray(msg.names) ? (msg.names as string[]) : []);
      } else if (msg.type === 'playlistSaved') {
        // Some tab (this one or a sibling) just saved a playlist. If it's
        // the one we're showing, swap in the new content directly — no
        // extra fetch needed since the broadcast carries it.
        if (typeof msg.name === 'string') invalidatePlaylistCache(msg.name);
        const cur = playlistRef.current;
        if (cur && msg.name === cur.name && msg.playlist) {
          setPlaylist(msg.playlist as PlaylistData);
          flashSaved();
        }
      } else if (msg.type === 'playlistDeleted') {
        // The currently-loaded playlist was deleted out from under us.
        if (typeof msg.name === 'string') invalidatePlaylistCache(msg.name);
        invalidatePlaylistsCache();
        const cur = playlistRef.current;
        if (cur && msg.name === cur.name) refresh();
      } else if (msg.type === 'playlistEntryCaptured') {
        // The engine just auto-captured defaults on some channel. Flash the
        // toast if it's ours; refresh the playlist data if we're showing it.
        if (msg.channelId === channelId) flashSaved();
        const cur = playlistRef.current;
        if (cur && msg.playlist === cur.name) {
          if (typeof msg.playlist === 'string') invalidatePlaylistCache(msg.playlist);
          refresh();
        }
      }
    });
  }, [role, channelId, refresh, flashSaved, shouldSuppressReconcile]);

  // ── Actions ─────────────────────────────────────────────────────────
  // Switch this channel to a different playlist.
  //
  // Design: the dropdown is NEVER disabled (see the long comment
  // above the busy-state removal). The user can re-open the modal and
  // pick another playlist while a POST is in-flight; the engine
  // accepts concurrent swaps (last-write wins) and the WS broadcast
  // reconciles the canonical state in <10 ms.
  //
  // We DO need a small in-flight guard so we don't apply a STALE POST
  // response on top of a newer one. swapEpochRef ticks on every tap;
  // each in-flight request remembers its epoch and bails out of the
  // setAssignment(next) call if a newer swap has started since. The
  // engine's WS `channelPlaylistData` broadcast (which arrives
  // ~1 ms after each POST handler runs) is the authoritative source
  // for the final state anyway — the HTTP response is just a
  // belt-and-suspenders confirmation.
  const swapEpochRef = useRef(0);
  const handleLoadPlaylist = useCallback(async (name: string) => {
    setShowLibrary(false);
    const myEpoch = ++swapEpochRef.current;
    const prevAssignment = assignmentRef.current;
    const prevPlaylist = playlistRef.current;
    // Optimistic flip of the dropdown label + "loading…" placeholder
    // for the entry list so the operator gets instant feedback that
    // the switch is being applied.
    setAssignment({
      name,
      activeEntryId: null,
      cursor: 0,
      autopilot: prevAssignment?.autopilot ?? { active: false, delay_s: 30, shuffle: false },
    });
    setPlaylist(null);
    try {
      const res = await setChannelPlaylist(role, channelId, name);
      // If a newer swap started while we were awaiting, the engine's
      // WS broadcast has already (or will shortly) reconcile state
      // for the latest pick. Don't clobber it with our stale result.
      if (myEpoch !== swapEpochRef.current) return;
      if (!res.ok) {
        setAssignment(prevAssignment);
        setPlaylist(prevPlaylist);
        Alert.alert('Load failed', res.error || 'Unknown error');
        return;
      }
      // Engine returns `{ status, playlist }` — adopt that as the
      // canonical assignment so the activeEntryId / cursor reflect the
      // real engine state, not our optimistic guess.
      const next = (res.data && res.data.playlist) || null;
      if (next) setAssignment(next);
      flashSaved();
    } catch (err: any) {
      if (myEpoch !== swapEpochRef.current) return;
      setAssignment(prevAssignment);
      setPlaylist(prevPlaylist);
      Alert.alert('Load failed', err?.message || 'Network error');
      return;
    }
    // Fire-and-forget background refresh to pull the new playlist's
    // entries / patterns library / etc. Any failure is handled by
    // refresh()'s own scheduleRetry().
    refresh();
  }, [role, channelId, flashSaved, refresh]);

  // ── Hot swap: crossfade onto a DIFFERENT playlist ──────────────────
  // Unlike handleLoadPlaylist (a plain assignment that the engine lands
  // on the first entry of with a hard load), this rides the deck's
  // soft-swap transition machinery — the engine crossfades from the
  // current pattern to the new playlist's first usable entry. On the
  // mixer it's an instant overlay load of the different playlist (the
  // overlay path has no double-buffer transition machinery), still via
  // the explicit /swap route.
  //
  // Gating mirrors handleEntryTap: a no-op while `disabled` (the deck's
  // soft-swap-in-flight lock), and we guard our own `swapInFlight` so a
  // double-tap can't queue two crossfades. The engine ALSO rejects a
  // concurrent swap with 409/EBUSY, which we swallow silently (no alert
  // spam) exactly like the entry-tap path. Any other failure surfaces
  // loudly (Codex P0 — no silent fallback).
  //
  // We do NOT optimistically flip local state here: the deck transition
  // takes ~Ns and the engine keeps reporting the prior entry until it
  // completes (see shouldSuppressReconcile). We let the WS broadcast
  // (deck / mixer / channelPlaylistData) reconcile the final state, and
  // arm the pending-gate with the engine-reported target entry so the
  // row highlight settles on the swapped-in entry without bouncing.
  const handleHotSwap = useCallback(async (name: string) => {
    if (disabled) return;                              // soft-swap-in-flight lock
    if (swapInFlightRef.current) return;               // synchronous re-entrancy guard
    swapInFlightRef.current = true;
    setSwapInFlight(true);
    try {
      const res = await swapChannelPlaylist(role, channelId, name);
      if (!res.ok) {
        // 409 = a transition is already running; swallow silently like
        // the entry-tap path (operator double-tap / mid-crossfade).
        const code = (res as { code?: string }).code;
        if (code === 'EBUSY' || code === '409') return;
        Alert.alert('Hot swap failed', (res as { error?: string }).error || 'Unknown error');
        return;
      }
      // Adopt the RESOLVED target entry as the pending target so the
      // mid-transition gate keeps the UI pinned to the swapped-in entry
      // until the broadcast confirms.
      //
      // FIX B: during a deck soft-swap the engine's `playlist.activeEntryId`
      // is still the OLD entry (the new id is only written in the swap
      // onComplete AFTER the fade). Arming the gate from that stale id pinned
      // the panel to the old entry for the full ~8s watchdog. The engine now
      // returns the resolved `targetEntryId` in the 200 body — prefer it for
      // the deck role. Fall back to playlist.activeEntryId only if the engine
      // didn't report a target (older engine).
      const targetEntryId = (res.data && res.data.targetEntryId) as string | undefined;
      const next = (res.data && res.data.playlist) as PlaylistAssignment | undefined;
      const pendingTarget = (role === 'deck' && targetEntryId)
        ? targetEntryId
        : (next && next.activeEntryId) || null;
      if (pendingTarget) {
        pendingActiveEntryIdRef.current = pendingTarget;
        armPendingWatchdog();
      }
      flashSaved();
      // Pull the swapped-in playlist's entries / assignment. The /swap
      // caches were invalidated in the api helper, so this re-converges.
      refresh();
    } catch (e) {
      Alert.alert('Hot swap failed', (e as Error)?.message || 'Network error');
    } finally {
      swapInFlightRef.current = false;
      setSwapInFlight(false);
    }
  }, [role, channelId, disabled, flashSaved, refresh, armPendingWatchdog]);

  const handleEntryTap = useCallback(async (entryId: string) => {
    if (disabled) return;                                  // tap-during-transition lock
    if (!assignment || assignment.activeEntryId === entryId) return;
    // Optimistic: flip the active entry in local state IMMEDIATELY so
    // the row highlight moves on tap, not after the HTTP round-trip.
    // The engine swaps the actual pattern fast (the operator already
    // sees the lights change); the only thing that was lagging was
    // this React tree waiting on `await refresh()`. We still POST and
    // refresh in the background — if the server rejects we roll back
    // and surface the error.
    const prev = assignment;
    pendingActiveEntryIdRef.current = entryId;
    armPendingWatchdog();
    console.log(`[PLAYLIST_DBG] handleEntryTap: from=${assignment.activeEntryId} to=${entryId}, pending set`);
    setAssignment({ ...assignment, activeEntryId: entryId });
    try {
      const res = await setChannelPlaylistEntry(role, channelId, entryId);
      console.log(`[PLAYLIST_DBG] POST returned ok=${res.ok}, pending=${pendingActiveEntryIdRef.current}`);
      if (!res.ok) {
        clearPending();
        setAssignment(prev);   // roll back optimistic flip
        // 409 = "swap already in flight" (engine rejects taps during
        // an in-flight transition per operator spec). Swallow silently
        // — this is expected when a user double-taps; no alert spam.
        const code = (res as { code?: string }).code;
        if (code === 'EBUSY' || code === '409') return;
        Alert.alert('Switch failed', (res as { error?: string }).error || 'Unknown error');
        return;
      }
      // Don't await refresh — the WS `mixer` broadcast will reconcile
      // anything the optimistic update missed (e.g. server-side entry
      // capture). Awaiting here is what the operator perceived as lag.
      // Note: `pendingActiveEntryIdRef` stays set until a broadcast
      // arrives reporting the new active entry — gates mid-transition
      // reconciliations that would otherwise bounce the UI back to
      // the prior entry (see shouldSuppressReconcile above).
      refresh();
    } catch (e) {
      clearPending();
      setAssignment(prev);
      Alert.alert('Switch failed', (e as Error)?.message || 'Network error');
    }
  }, [role, assignment, channelId, disabled, refresh, armPendingWatchdog, clearPending]);

  // Add a pattern and persist immediately — no manual SAVE step. The user
  // never has to think "did I save?".
  const handleAddPattern = useCallback(async (patternName: string) => {
    setShowAddPattern(false);
    const cur = playlistRef.current;
    if (!cur) return;
    const newEntry: PlaylistEntry = {
      id: genEntryId(),
      pattern: patternName,
      label: null,
      defaults: {},
    };
    const nextEntries = [...cur.entries, newEntry];
    // Optimistic UI: show the new row instantly.
    setPlaylist({ ...cur, entries: nextEntries });
    const res = await savePlaylist({ name: cur.name, entries: nextEntries });
    if (!res.ok) {
      Alert.alert('Add failed', res.error || 'Unknown error');
      await refresh();
      return;
    }
    flashSaved();
  }, [flashSaved, refresh]);

  // Open the "load directory" picker, fetching the available patterns/
  // sub-folders lazily on first open.
  const openLoadDir = useCallback(async () => {
    setShowLoadDir(true);
    const res = await fetchPatternDirs();
    if (res.ok && res.data) setPatternDirs(res.data);
  }, []);

  // Build playlist entries from a directory's patterns. Shared by both
  // the "new playlist" and "append" actions. Returns null (after surfacing
  // an alert) when the fetch fails or the folder is empty.
  const fetchDirEntries = useCallback(async (dir: string): Promise<PlaylistEntry[] | null> => {
    const res = await fetchPatternsInDir(dir);
    if (!res.ok || !res.data) {
      Alert.alert('Load directory failed', res.error || 'Unknown error');
      return null;
    }
    if (res.data.length === 0) {
      Alert.alert('Empty directory', `No patterns found in "${dir}".`);
      return null;
    }
    return res.data.map((pattern) => ({
      id: genEntryId(),
      pattern,
      label: null,
      defaults: {},
    }));
  }, []);

  // "New playlist" action: open a name prompt seeded with the folder
  // name. We DON'T auto-create — the operator confirms (and can rename)
  // first. This avoids silently clobbering an existing playlist (e.g.
  // "default") and works on web, where Alert.alert button callbacks don't
  // fire (so a confirm-via-Alert never resolved).
  const handleDirNewPlaylist = useCallback((dir: string) => {
    setShowLoadDir(false);
    setNewDirPlaylistName(sanitizeName(dir));
    setPendingNewDir(dir);
  }, []);

  // Confirm the name prompt: build entries from the pending folder, save
  // under the chosen name, and load the new playlist onto this channel.
  const confirmDirNewPlaylist = useCallback(async () => {
    const dir = pendingNewDir;
    if (!dir) return;
    const name = sanitizeName(newDirPlaylistName);
    if (!name) return; // Create is disabled when empty; guard anyway.
    const entries = await fetchDirEntries(dir);
    if (!entries) { setPendingNewDir(null); return; }
    const save = await savePlaylist({ name, entries });
    if (!save.ok) {
      Alert.alert('Create failed', save.error || 'Unknown error');
      return;
    }
    setPendingNewDir(null);
    await handleLoadPlaylist(name);
  }, [pendingNewDir, newDirPlaylistName, fetchDirEntries, handleLoadPlaylist]);

  // "Append" action: bulk-add every pattern in a directory to the
  // currently-loaded playlist, then persist — same auto-save model as
  // handleAddPattern, just for a whole folder at once.
  const handleDirAppend = useCallback(async (dir: string) => {
    const cur = playlistRef.current;
    if (!cur) return;
    const newEntries = await fetchDirEntries(dir);
    if (!newEntries) return;
    setShowLoadDir(false);
    const nextEntries = [...cur.entries, ...newEntries];
    // Optimistic UI: show the new rows instantly.
    setPlaylist({ ...cur, entries: nextEntries });
    const save = await savePlaylist({ name: cur.name, entries: nextEntries });
    if (!save.ok) {
      Alert.alert('Load directory failed', save.error || 'Unknown error');
      await refresh();
      return;
    }
    flashSaved();
  }, [fetchDirEntries, flashSaved, refresh]);

  // Destructive-action guard (production-console safety): removing a
  // playlist entry persists immediately to disk, so it must not happen on
  // a single accidental tap mid-show. The (−) button ARMS the confirm
  // sheet; performRemoveEntry only runs on explicit confirmation.
  // `removePrompt` holds the target entry id + a display label.
  const [removePrompt, setRemovePrompt] = useState<{ id: string; label: string } | null>(null);
  const requestRemoveEntry = useCallback((entryId: string) => {
    const cur = playlistRef.current;
    const entry = cur?.entries.find((e) => e.id === entryId);
    const label = entry ? (entry.label || patternDisplayName(entry.pattern)) : entryId;
    setRemovePrompt({ id: entryId, label });
  }, []);

  // Remove + persist in one step (invoked only after confirmation).
  const performRemoveEntry = useCallback(async (entryId: string) => {
    const cur = playlistRef.current;
    if (!cur) return;
    const nextEntries = cur.entries.filter((e) => e.id !== entryId);
    setPlaylist({ ...cur, entries: nextEntries });
    const res = await savePlaylist({ name: cur.name, entries: nextEntries });
    if (!res.ok) {
      Alert.alert('Remove failed', res.error || 'Unknown error');
      await refresh();
      return;
    }
    flashSaved();
  }, [flashSaved, refresh]);

  const confirmRemoveEntry = useCallback(async () => {
    const target = removePrompt;
    if (!target) return;
    setRemovePrompt(null);
    await performRemoveEntry(target.id);
  }, [removePrompt, performRemoveEntry]);

  // ── Reorder: move an entry one slot up (direction=-1) or down (+1) ──
  // Operator request (May 2026): re-sequence mid-show without going back
  // to YAML. Chevron buttons next to each row (one tap = one slot).
  //
  // Critical invariants:
  //   1. The active entry's ID never changes — only the order around it
  //      shuffles. If the active row IS the one being moved, autopilot
  //      keeps cycling from the same id (autopilot uses id-based lookup,
  //      not cursor index — see marsin_engine/lib/api_server.js Autopilot
  //      callback at ~line 1474).
  //   2. Per-entry `defaults`, `modulations`, `notes`, `label` ride along
  //      because we splice the existing entry objects, not new ones.
  //   3. Optimistic UI: re-render the new order BEFORE the POST resolves.
  //      The engine's `playlistSaved` WS broadcast reconciles canonical
  //      state in <10 ms; if the POST fails we restore the prior order
  //      and surface the error.
  //   4. Codex P0 — bounds violations throw loudly, no silent clamp:
  //      a request to move index 0 up (or last index down) is rejected
  //      at the call site by hiding the button (disabled chevron), so
  //      this function should never actually receive an out-of-range
  //      pair. If somehow it does, the assertion fires.
  const handleMoveEntry = useCallback(async (entryId: string, direction: -1 | 1) => {
    const cur = playlistRef.current;
    if (!cur) return;
    const from = cur.entries.findIndex((e) => e.id === entryId);
    if (from < 0) throw new Error(`handleMoveEntry: entry not found in playlist: ${entryId}`);
    const to = from + direction;
    if (to < 0 || to >= cur.entries.length) {
      // Off-by-one guard. The chevrons hide at boundaries so this is
      // a "should never happen" — fail loud per codex P0.
      throw new Error(`handleMoveEntry: out-of-range move ${from}→${to} in playlist "${cur.name}" (size ${cur.entries.length})`);
    }
    if (cur.entries.length < 2) return; // 1-entry playlist: no-op
    const nextEntries = cur.entries.slice();
    const [moved] = nextEntries.splice(from, 1);
    nextEntries.splice(to, 0, moved);
    // Optimistic: show the new order instantly.
    const prevEntries = cur.entries;
    setPlaylist({ ...cur, entries: nextEntries });
    const res = await savePlaylist({ name: cur.name, entries: nextEntries });
    if (!res.ok) {
      // Roll back to the prior order and surface the error.
      setPlaylist({ ...cur, entries: prevEntries });
      Alert.alert('Reorder failed', res.error || 'Unknown error');
      await refresh();
      return;
    }
    flashSaved();
  }, [flashSaved, refresh]);

  // ── Per-entry hold / loop toggles (#12) ────────────────────────────
  // Mirror the handleMoveEntry optimistic + rollback template: flip the
  // flag in local state, persist the whole playlist, and on failure
  // restore the prior entries + surface the error (Codex P0 — no silent
  // fallback). `field` is 'hold' or 'loop'; the toggle is independent per
  // field so an entry may be both held and looping (hold wins at the
  // engine, but the operator can pre-arm loop).
  //
  // NOTE: hold/loop are honored by the DECK autopilot only. Mixer overlays
  // persist these flags (round-tripped on save) but have no live autopilot
  // to act on them, so on a mixer panel they are inert metadata.
  const handleToggleEntryFlag = useCallback(async (entryId: string, field: 'hold' | 'loop') => {
    const cur = playlistRef.current;
    if (!cur) return;
    const idx = cur.entries.findIndex((e) => e.id === entryId);
    if (idx < 0) throw new Error(`handleToggleEntryFlag: entry not found: ${entryId}`);
    const prevEntries = cur.entries;
    const nextEntries = cur.entries.map((e) =>
      e.id === entryId ? { ...e, [field]: !(e[field] === true) } : e,
    );
    // Optimistic: flip the chip instantly.
    setPlaylist({ ...cur, entries: nextEntries });
    const res = await savePlaylist({ name: cur.name, tags: cur.tags, entries: nextEntries });
    if (!res.ok) {
      setPlaylist({ ...cur, entries: prevEntries });
      Alert.alert(`Toggle ${field} failed`, res.error || 'Unknown error');
      await refresh();
      return;
    }
    flashSaved();
  }, [flashSaved, refresh]);

  const handleCreateNew = useCallback(async () => {
    const name = sanitizeName(newPlaylistName);
    if (!name) return;
    const res = await savePlaylist({ name, entries: [] });
    if (!res.ok) {
      Alert.alert('Create failed', res.error || 'Unknown error');
      return;
    }
    setNewPlaylistName('');
    await handleLoadPlaylist(name);
  }, [handleLoadPlaylist, newPlaylistName]);

  const handleDeletePlaylist = useCallback(async (name: string) => {
    if (name === 'default') { Alert.alert('Refused', 'Cannot delete the default playlist'); return; }
    const res = await deletePlaylist(name);
    if (!res.ok) Alert.alert('Delete failed', res.error || 'Unknown error');
    await refresh();
  }, [refresh]);

  // ── Compact / regular sizing tokens ────────────────────────────────────
  // The deck (non-compact) path was tuned tighter on 2026-05-25 so the
  // landscape layout shows ≥5 pattern rows on an 11" iPad alongside the
  // (now-also-compacted) Rig globals strip. Touch targets stay ≥44 pt
  // because the entry's <TouchableOpacity flex:1> spans the full row
  // width plus the surrounding rowPadY; the visible row chrome is just
  // smaller, the tap area isn't.
  const sz = {
    rowPadY: compact ? 4 : 5,
    rowPadX: compact ? 6 : 8,
    rowGap: compact ? 1 : 2,
    fontPrimary: compact ? 13 : 13,
    fontSecondary: compact ? 9 : 10,
    fontMicro: compact ? 8 : 9,
    indexWidth: compact ? 16 : 20,
    btnH: compact ? 22 : 26,
    btnFont: compact ? 10 : 11,
    headerFont: compact ? 10 : 11,
    panelPad: compact ? 6 : 8,
    panelGap: compact ? 4 : 6,
  };

  const editable = !locked;
  const showSaved = savedAt !== null;

  return (
    <View
      style={{
        backgroundColor: C.surfaceContainerLowest,
        borderRadius: compact ? 8 : 12,
        borderWidth: 1,
        borderColor: C.ghostBorder,
        padding: sz.panelPad,
        gap: sz.panelGap,
        // Always flex-fill the parent. Both deck and mixer wrap us in a
        // sized flex container; this lets the list grow to fill the column
        // even when there are only a few entries (item 1 in the feedback).
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* ── Row 1: section label + saved indicator + refresh icon ────
          The refresh icon is rendered only when the parent passes an
          onRefreshConnection handler (deck tab). It replaces the old
          full-width REFRESH/RECONNECT button that used to sit below the
          playlist — putting it inline here frees a chunky vertical
          slot for an extra entry row. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, minHeight: sz.btnH - 4 }}>
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: sz.headerFont,
            color: C.secondary,
            letterSpacing: 1.2,
            flex: 1,
          }}
          numberOfLines={1}
        >
          {(channelLabel ? `${channelLabel.toUpperCase()} · ` : '') + 'PLAYLIST'}
        </Text>
        {showSaved && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 4,
              backgroundColor: 'rgba(0,168,107,0.15)',
            }}
          >
            <Text style={{ color: '#00a86b', fontFamily: 'SpaceGrotesk_700Bold', fontSize: sz.fontMicro }}>
              ✓ SAVED
            </Text>
          </View>
        )}
        {onRefreshConnection && (
          <>
            {/* Playlist-edits lock — sits IMMEDIATELY beside refresh
                so the operator finds it from where they already look.
                Filled lock icon when engaged; open lock when unlocked.
                Border tints primary when locked so the state reads
                across the podium without staring at the icon. Deck
                only. When locked: chevrons, the + button, and the
                per-row − button are all hidden. */}
            <TouchableOpacity
              onPress={toggleReorderLock}
              accessibilityLabel={playlistEditsLocked ? 'Unlock playlist edits' : 'Lock playlist edits'}
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                width: sz.btnH,
                height: sz.btnH,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: playlistEditsLocked ? C.primary : C.ghostBorder,
                backgroundColor: playlistEditsLocked ? C.primaryContainer : C.surfaceContainerHigh,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconSymbol
                name={playlistEditsLocked ? 'lock.fill' : 'lock.open.fill'}
                size={sz.btnFont + 2}
                color={playlistEditsLocked ? C.primary : C.icon}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onRefreshConnection}
              accessibilityLabel="Refresh / reconnect to engine"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                width: sz.btnH,
                height: sz.btnH,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: C.ghostBorder,
                backgroundColor: C.surfaceContainerHigh,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconSymbol name="arrow.clockwise" size={sz.btnFont + 4} color={C.primary} />
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── Row 2: [playlist name dropdown ▾] [+] [SAVE-locked indicator] ── */}
      {/* All controls live here so the playlist name has full row width to
          breathe. SAVE button is gone — adds / removes / param edits all
          auto-persist. Lock hides the +; the dropdown becomes a static
          label so the operator can still see which playlist is active. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {editable ? (
          <TouchableOpacity
            onPress={() => setShowLibrary(true)}
            style={{
              flex: 1,
              height: sz.btnH,
              paddingHorizontal: 8,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: C.ghostBorder,
              backgroundColor: C.surfaceContainerHigh,
              justifyContent: 'center',
            }}
          >
            <Text
              style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: sz.btnFont, color: C.primary }}
              numberOfLines={1}
            >
              {assignment?.name || 'LOAD…'} ▾
            </Text>
          </TouchableOpacity>
        ) : (
          <View
            style={{
              flex: 1,
              height: sz.btnH,
              paddingHorizontal: 8,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: 'rgba(245,166,35,0.4)',
              backgroundColor: 'rgba(245,166,35,0.06)',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: sz.btnFont, color: '#8a6a1f' }}
              numberOfLines={1}
            >
              {assignment?.name || '—'} (locked)
            </Text>
          </View>
        )}

        {/* HOT SWAP button (feat/timeline_support) — opens a picker of
            DIFFERENT playlists and crossfades onto the picked one's first
            usable entry, riding the deck/mixer transition machinery.
            Distinct from the LOAD dropdown (plain assignment) and the
            per-entry tap (advance within the current playlist).

            Gating mirrors the entry-tap contract: disabled while the
            deck soft-swap is in flight (`disabled`) or while our own
            swap POST is mid-flight (`swapInFlight`). A confirm sheet
            arms before the crossfade actually fires. hitSlop keeps the
            tap target >= 44pt even though the visible chrome is btnH
            (22/26). Hidden in locked / playlist-edits-locked modes for
            the same reason the + / folder buttons are: a frozen show
            playlist must not be mutated mid-set. */}
        {editable && !(role === 'deck' && playlistEditsLocked) && (
          <TouchableOpacity
            onPress={() => setShowSwap(true)}
            disabled={disabled || swapInFlight}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={{
              height: sz.btnH,
              paddingHorizontal: 8,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: C.secondary,
              backgroundColor: C.surfaceContainerHigh,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 4,
              opacity: (disabled || swapInFlight) ? 0.4 : 1,
            }}
            accessibilityLabel="Hot swap to a different playlist"
            accessibilityRole="button"
          >
            <IconSymbol name="shuffle" size={sz.btnFont + 2} color={C.secondary} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: sz.btnFont, color: C.secondary }}>
              SWAP
            </Text>
          </TouchableOpacity>
        )}

        {/* Load-directory button — opens the directory picker where a
            folder can be loaded as a NEW playlist or appended to the
            current one. Always enabled (the "new playlist" action needs
            no loaded playlist). Same visibility rules as the + button:
            hidden when the channel is locked (read-only show mode) and,
            on the deck, when the operator has engaged the playlist-edits
            lock. On the mixer this rides the `compact` sizing so it
            renders as the requested small button. */}
        {editable && !(role === 'deck' && playlistEditsLocked) && (
          <TouchableOpacity
            onPress={openLoadDir}
            style={{
              width: sz.btnH,
              height: sz.btnH,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: C.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityLabel="Load a directory of patterns into playlist"
          >
            <IconSymbol name="folder.fill" size={sz.btnFont + 2} color={C.primary} />
          </TouchableOpacity>
        )}

        {editable && !(role === 'deck' && playlistEditsLocked) && (
          <TouchableOpacity
            onPress={() => setShowAddPattern(true)}
            disabled={!playlist}
            style={{
              width: sz.btnH,
              height: sz.btnH,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: C.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !playlist ? 0.4 : 1,
            }}
            accessibilityLabel="Add pattern to playlist"
          >
            <Text style={{ color: C.primary, fontWeight: 'bold', fontSize: sz.btnFont + 2 }}>+</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Entry list (THE one and only pattern queue for this channel) ── */}
      {playlist ? (
        playlist.entries.length === 0 ? (
          <Text
            style={{
              color: C.icon,
              fontStyle: 'italic',
              fontSize: sz.fontSecondary,
              padding: sz.rowPadY,
            }}
          >
            {editable ? 'Empty playlist — tap + to add a pattern.' : 'Empty playlist.'}
          </Text>
        ) : (
          <ScrollView
            ref={scrollRef}
            nestedScrollEnabled
            style={{ flex: 1, minHeight: 0, opacity: disabled ? 0.55 : 1 }}
            contentContainerStyle={{ paddingBottom: 4 }}
            onLayout={(ev) => { viewportHeightRef.current = ev.nativeEvent.layout.height; }}
            onContentSizeChange={(_w, h) => { contentHeightRef.current = h; }}
          >
            {playlist.entries.map((e, idx) => {
              const isActive = assignment?.activeEntryId === e.id;
              const missing = e._missing;
              const paramCount = e.defaults ? Object.keys(e.defaults).length : 0;
              // Reorder chevrons (slot 5, May 2026): hidden at the
              // boundaries so the operator can't tap a no-op. A 1-entry
              // playlist also disables both. Hidden entirely when the
              // panel is `locked` (read-only show mode) since reordering
              // would be a destructive edit.
              const canMoveUp = editable && playlist.entries.length > 1 && idx > 0;
              const canMoveDown = editable && playlist.entries.length > 1 && idx < playlist.entries.length - 1;
              return (
                <View
                  key={e.id}
                  onLayout={(ev) => {
                    const { y, height } = ev.nativeEvent.layout;
                    rowOffsetsRef.current.set(e.id, { y, h: height });
                  }}
                  style={{
                    // 2-line layout (2026-06-20, mixer readability): line 1 is
                    // the index badge + full-width name; line 2 is the compact
                    // control sub-row (reorder chevrons + H/L + remove). In a
                    // cramped mixer channel-strip the name column used to
                    // collapse to ~60pt and truncate long pattern names to
                    // "tran…"/"0…"; stacking the controls underneath gives the
                    // name the full strip width with no strip-width change.
                    flexDirection: 'column',
                    gap: 2,
                    paddingHorizontal: sz.rowPadX,
                    paddingVertical: sz.rowPadY,
                    borderRadius: 6,
                    backgroundColor: isActive ? C.primary : 'transparent',
                    borderWidth: 1,
                    borderColor: isActive ? 'transparent' : C.ghostBorder,
                    marginBottom: sz.rowGap,
                    opacity: missing ? 0.4 : 1,
                  }}
                >
                  {/* Line 1: index badge + full-width name (≥44pt tap row). */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text
                      style={{
                        fontFamily: 'SpaceGrotesk_700Bold',
                        fontSize: sz.fontMicro,
                        color: isActive ? 'rgba(255,255,255,0.75)' : C.icon,
                        width: sz.indexWidth,
                      }}
                    >
                      {(idx + 1).toString().padStart(2, '0')}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleEntryTap(e.id)}
                      disabled={missing || disabled}
                      style={{ flex: 1 }}
                    >
                      <Text
                        style={{
                          fontFamily: 'SpaceGrotesk_700Bold',
                          fontSize: sz.fontPrimary,
                          color: isActive ? '#FFF' : C.text,
                        }}
                        numberOfLines={2}
                        ellipsizeMode="middle"
                      >
                        {e.label || patternDisplayName(e.pattern)}
                        {missing ? '  ⚠' : ''}
                      </Text>
                      {(e.label || paramCount > 0) && (
                        <Text
                          style={{
                            fontFamily: 'Inter_400Regular',
                            fontSize: sz.fontMicro,
                            color: isActive ? 'rgba(255,255,255,0.7)' : C.icon,
                          }}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                        >
                          {e.label ? patternDisplayName(e.pattern) : ''}
                          {e.label && paramCount > 0 ? '  · ' : ''}
                          {paramCount > 0 ? `${paramCount} ${paramCount === 1 ? 'param' : 'params'}` : ''}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  {/* Line 2: compact control sub-row — reorder chevrons + H/L
                      toggles + remove. Only rendered when there is at least one
                      control to show (i.e. editable & not deck-edit-locked), so
                      read-only / show-mode rows stay single-line. */}
                  {editable && !(role === 'deck' && playlistEditsLocked) && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                    {(
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 0, marginRight: 'auto' }}>
                      <TouchableOpacity
                        onPress={canMoveUp ? () => handleMoveEntry(e.id, -1) : undefined}
                        disabled={!canMoveUp}
                        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                        style={{
                          width: sz.btnH - 4,
                          height: sz.btnH - 4,
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: canMoveUp ? 1 : 0.2,
                        }}
                        accessibilityLabel={`Move ${e.pattern} up`}
                        accessibilityRole="button"
                      >
                        <IconSymbol
                          name="chevron.up"
                          size={sz.fontPrimary + 2}
                          color={isActive ? '#FFF' : C.primary}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={canMoveDown ? () => handleMoveEntry(e.id, 1) : undefined}
                        disabled={!canMoveDown}
                        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                        style={{
                          width: sz.btnH - 4,
                          height: sz.btnH - 4,
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: canMoveDown ? 1 : 0.2,
                        }}
                        accessibilityLabel={`Move ${e.pattern} down`}
                        accessibilityRole="button"
                      >
                        <IconSymbol
                          name="chevron.down"
                          size={sz.fontPrimary + 2}
                          color={isActive ? '#FFF' : C.primary}
                        />
                      </TouchableOpacity>
                    </View>
                    )}
                  {/* Per-entry HOLD / LOOP toggles (#12). Same editable +
                      playlist-edits-lock guard as the reorder chevrons.
                      hold = park autopilot on this entry until released by
                      a manual tap; loop = repeat this entry (overrides
                      shuffle). Compact "H"/"L" chrome, >= 44pt tap target
                      via hitSlop. Honored by the DECK autopilot only —
                      inert (but persisted) on mixer overlays. */}
                  {(
                    <>
                      <TouchableOpacity
                        onPress={() => handleToggleEntryFlag(e.id, 'hold')}
                        hitSlop={{ top: 11, bottom: 11, left: 6, right: 6 }}
                        style={{
                          width: sz.btnH - 4,
                          height: sz.btnH - 4,
                          borderRadius: 4,
                          borderWidth: 1,
                          borderColor: e.hold ? C.primary : C.ghostBorder,
                          backgroundColor: e.hold ? C.primaryContainer : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        accessibilityLabel={`${e.hold ? 'Clear' : 'Set'} hold on ${e.pattern}`}
                        accessibilityRole="button"
                      >
                        <Text style={{
                          fontFamily: 'SpaceGrotesk_700Bold',
                          fontSize: sz.fontMicro + 1,
                          color: e.hold ? C.primary : (isActive ? 'rgba(255,255,255,0.7)' : C.icon),
                        }}>H</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleToggleEntryFlag(e.id, 'loop')}
                        hitSlop={{ top: 11, bottom: 11, left: 6, right: 6 }}
                        style={{
                          width: sz.btnH - 4,
                          height: sz.btnH - 4,
                          borderRadius: 4,
                          borderWidth: 1,
                          borderColor: e.loop ? C.primary : C.ghostBorder,
                          backgroundColor: e.loop ? C.primaryContainer : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        accessibilityLabel={`${e.loop ? 'Clear' : 'Set'} loop on ${e.pattern}`}
                        accessibilityRole="button"
                      >
                        <Text style={{
                          fontFamily: 'SpaceGrotesk_700Bold',
                          fontSize: sz.fontMicro + 1,
                          color: e.loop ? C.primary : (isActive ? 'rgba(255,255,255,0.7)' : C.icon),
                        }}>L</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  {(
                    <TouchableOpacity
                      onPress={() => requestRemoveEntry(e.id)}
                      // Compact (−) chrome but >= 44pt tap area via
                      // hitSlop so an operator doesn't fat-finger a
                      // neighbouring control on the production console.
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={{
                        width: sz.btnH - 4,
                        height: sz.btnH - 4,
                        borderRadius: 4,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      accessibilityLabel={`Remove ${e.pattern} from playlist`}
                      accessibilityRole="button"
                    >
                      <Text style={{ color: isActive ? '#FFF' : C.error, fontWeight: 'bold', fontSize: sz.fontPrimary }}>−</Text>
                    </TouchableOpacity>
                  )}
                  </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )
      ) : (
        <Text style={{ color: C.icon, fontStyle: 'italic', fontSize: sz.fontSecondary, padding: sz.rowPadY }}>
          {editable ? 'No playlist loaded. Tap the dropdown above.' : 'No playlist loaded.'}
        </Text>
      )}

      <LibraryModal
        visible={showLibrary}
        onClose={() => setShowLibrary(false)}
        playlists={playlists}
        currentName={assignment?.name || null}
        onLoad={handleLoadPlaylist}
        onDelete={handleDeletePlaylist}
        newPlaylistName={newPlaylistName}
        setNewPlaylistName={setNewPlaylistName}
        onCreateNew={handleCreateNew}
      />

      {/* Hot-swap picker: list of DIFFERENT playlists. Picking one arms
          the confirm sheet rather than swapping immediately. */}
      <SwapPlaylistModal
        visible={showSwap}
        onClose={() => setShowSwap(false)}
        playlists={playlists}
        currentName={assignment?.name || null}
        onPick={(name) => { setShowSwap(false); setSwapPrompt(name); }}
        role={role}
      />

      {/* Hot-swap confirmation (production-console safety) — swapping the
          whole channel onto a different playlist is a deliberate show
          action, not a one-tap accident. FIX B: deck swaps crossfade;
          mixer-overlay swaps load instantly (no crossfade), so branch the
          copy on role rather than promising a crossfade the mixer never does. */}
      <ConfirmSheet
        visible={!!swapPrompt}
        title="Hot swap playlist?"
        message={role === 'deck'
          ? `Crossfade ${channelLabel ? `"${channelLabel}"` : 'this channel'} onto "${swapPrompt ?? ''}" — it transitions to that playlist's first entry, riding the active transition.`
          : `Switch ${channelLabel ? `"${channelLabel}"` : 'this channel'} onto "${swapPrompt ?? ''}" — it loads that playlist's first entry instantly (no crossfade).`}
        confirmLabel="HOT SWAP"
        cancelLabel="CANCEL"
        onConfirm={() => {
          const name = swapPrompt;
          setSwapPrompt(null);
          if (name) handleHotSwap(name);
        }}
        onCancel={() => setSwapPrompt(null)}
      />

      <AddPatternModal
        visible={showAddPattern}
        onClose={() => setShowAddPattern(false)}
        playlistName={playlist?.name || null}
        allPatterns={allPatterns}
        onPick={handleAddPattern}
      />

      <LoadDirectoryModal
        visible={showLoadDir}
        onClose={() => setShowLoadDir(false)}
        playlistName={playlist?.name || null}
        dirs={patternDirs}
        onNewPlaylist={handleDirNewPlaylist}
        onAppend={handleDirAppend}
      />

      <NewPlaylistNameModal
        visible={pendingNewDir !== null}
        dir={pendingNewDir}
        name={newDirPlaylistName}
        setName={setNewDirPlaylistName}
        exists={playlists.includes(sanitizeName(newDirPlaylistName))}
        onCancel={() => setPendingNewDir(null)}
        onCreate={confirmDirNewPlaylist}
      />

      {/* Remove-entry confirmation (production-console safety). */}
      <ConfirmSheet
        visible={!!removePrompt}
        title="Remove entry?"
        message={`Remove "${removePrompt?.label ?? ''}" from this playlist? This saves immediately to disk.`}
        confirmLabel="REMOVE"
        cancelLabel="CANCEL"
        onConfirm={confirmRemoveEntry}
        onCancel={() => setRemovePrompt(null)}
      />
    </View>
  );
};

// ── Modal sub-components ────────────────────────────────────────────────
// Pulled out into their own components so the JSX nesting is shallow and
// readable. Both share the same backdrop pattern: outer TWF closes on tap,
// inner TWF swallows taps so the modal content is opaque to dismissal.

// ── Name-query filtering ────────────────────────────────────────────
// Shared by the library + swap pickers. A playlist matches when its name
// contains the (lowercased) search query. (Tag filtering was retired in the
// 2026-06-22 UI cleanup — name search is the only client-side filter now.)
function filterPlaylistNames(names: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return names;
  return names.filter((n) => n.toLowerCase().includes(q));
}

interface PlaylistFilterBarProps {
  C: Palette;
  query: string;
  setQuery: (s: string) => void;
}

// Search box shared by both pickers — name-query only.
const PlaylistFilterBar: React.FC<PlaylistFilterBarProps> = ({
  C, query, setQuery,
}) => (
  <View style={{ marginBottom: 8 }}>
    <TextInput
      value={query}
      onChangeText={setQuery}
      placeholder="search playlists…"
      placeholderTextColor={C.icon}
      style={{
        paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6,
        borderWidth: 1, borderColor: C.ghostBorder, color: C.text,
        fontFamily: 'Inter_400Regular', fontSize: 12,
      }}
      accessibilityLabel="Search playlists by name"
    />
  </View>
);

interface LibraryModalProps {
  visible: boolean;
  onClose: () => void;
  playlists: string[];
  currentName: string | null;
  onLoad: (name: string) => void;
  onDelete: (name: string) => void;
  newPlaylistName: string;
  setNewPlaylistName: (s: string) => void;
  onCreateNew: () => void;
}

const LibraryModal: React.FC<LibraryModalProps> = ({
  visible, onClose, playlists, currentName, onLoad, onDelete,
  newPlaylistName, setNewPlaylistName, onCreateNew,
}) => {
  const C = usePalette();
  const modalStyles = useMemo(() => makeModalStyles(C), [C]);
  const [query, setQuery] = useState('');
  // Reset the filter each time the picker opens so a stale query from a
  // prior open doesn't hide everything.
  useEffect(() => {
    if (visible) { setQuery(''); }
  }, [visible]);
  const filtered = useMemo(
    () => filterPlaylistNames(playlists, query),
    [playlists, query],
  );
  return (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity
      activeOpacity={1}
      onPress={onClose}
      style={modalStyles.backdrop}
      accessibilityLabel="Close playlist library"
    >
      <TouchableOpacity activeOpacity={1} onPress={() => {}} style={modalStyles.cardWrap}>
        <View style={modalStyles.card}>
            <Text style={modalStyles.title}>PLAYLIST LIBRARY</Text>
            <PlaylistFilterBar
              C={C}
              query={query}
              setQuery={setQuery}
            />
            <ScrollView style={{ maxHeight: 320 }}>
              {playlists.length === 0 && (
                <Text style={{ color: C.icon, fontStyle: 'italic', fontSize: 11 }}>
                  No playlists yet — create one below.
                </Text>
              )}
              {playlists.length > 0 && filtered.length === 0 && (
                <Text style={{ color: C.icon, fontStyle: 'italic', fontSize: 11 }}>
                  No playlists match the current filter.
                </Text>
              )}
              {filtered.map((name) => {
                const isCurrent = name === currentName;
                return (
                  <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <TouchableOpacity
                      onPress={() => onLoad(name)}
                      style={{
                        flex: 1, padding: 10, borderRadius: 8,
                        backgroundColor: isCurrent ? C.primary : C.surfaceContainerHigh,
                      }}
                    >
                      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: isCurrent ? '#FFF' : C.text }}>
                        {isCurrent ? '▶ ' : ''}{name}
                      </Text>
                    </TouchableOpacity>
                    {name !== 'default' && (
                      <TouchableOpacity
                        onPress={() => onDelete(name)}
                        style={{ width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: C.error, alignItems: 'center', justifyContent: 'center' }}
                        accessibilityLabel={`Delete playlist ${name}`}
                      >
                        <Text style={{ color: C.error, fontSize: 12 }}>×</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
              <TextInput
                placeholder="new playlist name"
                placeholderTextColor={C.icon}
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
                onSubmitEditing={onCreateNew}
                returnKeyType="done"
                style={{ flex: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: C.ghostBorder, color: C.text }}
              />
              <TouchableOpacity onPress={onCreateNew} style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.primary, borderRadius: 6, justifyContent: 'center' }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#FFF' }}>NEW</Text>
              </TouchableOpacity>
            </View>
        </View>
      </TouchableOpacity>
    </TouchableOpacity>
  </Modal>
  );
};

interface SwapPlaylistModalProps {
  visible: boolean;
  onClose: () => void;
  playlists: string[];
  currentName: string | null;
  onPick: (name: string) => void;
  role: ChannelRole;
}

// Hot-swap picker (feat/timeline_support). Lists the playlist library so
// the operator can switch the channel onto a DIFFERENT playlist. The
// currently-assigned playlist is shown but disabled — swapping onto the
// already-active playlist is a no-op (use the per-entry tap to move within
// it). Picking a different one calls onPick, which arms a confirm sheet in
// the parent before the swap fires.
//
// FIX B copy: the DECK swap rides the deck's soft-swap transition (a
// crossfade); a MIXER-overlay swap is an INSTANT load (no crossfade — the
// engine path is loadPlaylistEntry, not the transition helper). Branch the
// user-facing wording on role so the mixer copy doesn't promise a crossfade
// that never happens.
const SwapPlaylistModal: React.FC<SwapPlaylistModalProps> = ({
  visible, onClose, playlists, currentName, onPick, role,
}) => {
  const C = usePalette();
  const modalStyles = useMemo(() => makeModalStyles(C), [C]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (visible) { setQuery(''); }
  }, [visible]);
  const swappable = playlists.filter((n) => n !== currentName);
  const others = useMemo(
    () => filterPlaylistNames(swappable, query),
    [swappable, query],
  );
  return (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity
      activeOpacity={1}
      onPress={onClose}
      style={modalStyles.backdrop}
      accessibilityLabel="Close hot-swap picker"
    >
      <TouchableOpacity activeOpacity={1} onPress={() => {}} style={modalStyles.cardWrap}>
        <View style={[modalStyles.card, { maxHeight: '80%' }]}>
          <Text style={modalStyles.title}>HOT SWAP PLAYLIST</Text>
          <Text style={{ color: C.icon, fontFamily: 'Inter_400Regular', fontSize: 11, marginBottom: 10, lineHeight: 15 }}>
            {role === 'deck'
              ? 'Pick a different playlist to crossfade onto. It transitions to that playlist’s first usable entry, riding the active transition.'
              : 'Pick a different playlist to switch onto. It loads that playlist’s first usable entry instantly (no crossfade).'}
          </Text>
          <PlaylistFilterBar
            C={C}
            query={query}
            setQuery={setQuery}
          />
          <ScrollView style={{ maxHeight: 360 }}>
            {currentName && (
              <View
                style={{
                  paddingHorizontal: 10, paddingVertical: 10, marginBottom: 4, borderRadius: 8,
                  borderWidth: 1, borderColor: C.ghostBorder, opacity: 0.45,
                }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.icon }}>
                  {`▶ ${currentName} (current)`}
                </Text>
              </View>
            )}
            {others.length === 0 && (
              <Text style={{ color: C.icon, fontStyle: 'italic', fontSize: 11 }}>
                No other playlists to swap to.
              </Text>
            )}
            {others.map((name) => (
              <TouchableOpacity
                key={name}
                onPress={() => onPick(name)}
                // >= 44pt tap area (10pt vert padding + ~22pt text +
                // hitSlop) per the production-console safety bar.
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                style={{
                  paddingHorizontal: 10, paddingVertical: 12, marginBottom: 4, borderRadius: 8,
                  backgroundColor: C.surfaceContainerHigh,
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                }}
                accessibilityLabel={`Hot swap to ${name}`}
                accessibilityRole="button"
              >
                <IconSymbol name="shuffle" size={14} color={C.secondary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text }} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </TouchableOpacity>
  </Modal>
  );
};

interface AddPatternModalProps {
  visible: boolean;
  onClose: () => void;
  playlistName: string | null;
  allPatterns: string[];
  onPick: (name: string) => void;
}

const AddPatternModal: React.FC<AddPatternModalProps> = ({
  visible, onClose, playlistName, allPatterns, onPick,
}) => {
  const C = usePalette();
  const modalStyles = useMemo(() => makeModalStyles(C), [C]);
  return (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity
      activeOpacity={1}
      onPress={onClose}
      style={modalStyles.backdrop}
      accessibilityLabel="Close add-pattern picker"
    >
      <TouchableOpacity activeOpacity={1} onPress={() => {}} style={modalStyles.cardWrap}>
        <View style={[modalStyles.card, { maxHeight: '80%' }]}>
          <Text style={modalStyles.title}>
            ADD PATTERN TO {playlistName?.toUpperCase() || 'PLAYLIST'}
          </Text>
          <ScrollView style={{ maxHeight: 400 }}>
            {allPatterns.map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => onPick(p)}
                style={{ paddingHorizontal: 10, paddingVertical: 8, marginBottom: 3, borderRadius: 6, backgroundColor: C.surfaceContainerHigh }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text }}>{p}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </TouchableOpacity>
  </Modal>
  );
};

interface LoadDirectoryModalProps {
  visible: boolean;
  onClose: () => void;
  playlistName: string | null;
  dirs: string[];
  onNewPlaylist: (dir: string) => void;
  onAppend: (dir: string) => void;
}

// Picker for the "load directory" action. Lists `default` (the top-level
// patterns/ folder) plus every sub-folder the engine reports. Each folder
// offers two actions:
//   • New playlist — create a playlist named after the folder and open it
//   • Append       — add the folder's patterns to the current playlist
// Append is disabled when no playlist is loaded (nothing to append to).
const LoadDirectoryModal: React.FC<LoadDirectoryModalProps> = ({
  visible, onClose, playlistName, dirs, onNewPlaylist, onAppend,
}) => {
  const C = usePalette();
  const modalStyles = useMemo(() => makeModalStyles(C), [C]);
  const canAppend = !!playlistName;
  return (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity
      activeOpacity={1}
      onPress={onClose}
      style={modalStyles.backdrop}
      accessibilityLabel="Close load-directory picker"
    >
      <TouchableOpacity activeOpacity={1} onPress={() => {}} style={modalStyles.cardWrap}>
        <View style={[modalStyles.card, { maxHeight: '90%', minWidth: 420 }]}>
          <Text style={modalStyles.title}>LOAD DIRECTORY</Text>
          <Text style={{ color: C.icon, fontFamily: 'Inter_400Regular', fontSize: 11, marginBottom: 10, lineHeight: 15 }}>
            <Text style={{ color: C.primary, fontFamily: 'SpaceGrotesk_700Bold' }}>New playlist</Text>
            {' creates a playlist named after the folder. '}
            <Text style={{ color: C.text, fontFamily: 'SpaceGrotesk_700Bold' }}>Append</Text>
            {playlistName ? ` adds its patterns to "${playlistName}".` : ' adds its patterns to the loaded playlist.'}
          </Text>
          {/* Taller scroll area so the folder list + dual actions breathe. */}
          <ScrollView style={{ maxHeight: 520 }}>
            {dirs.length === 0 && (
              <Text style={{ color: C.icon, fontStyle: 'italic', fontSize: 11 }}>
                No pattern directories found.
              </Text>
            )}
            {dirs.map((d) => (
              <View
                key={d}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 9, marginBottom: 5, borderRadius: 8, backgroundColor: C.surfaceContainerHigh }}
              >
                <IconSymbol name="folder.fill" size={15} color={C.primary} />
                <Text style={{ flex: 1, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13, color: C.text }} numberOfLines={1}>
                  {d}
                </Text>
                {/* Primary action (filled) — create + open a new playlist. */}
                <TouchableOpacity
                  onPress={() => onNewPlaylist(d)}
                  style={{ paddingHorizontal: 12, height: 30, borderRadius: 6, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' }}
                  accessibilityLabel={`Create new playlist from ${d}`}
                >
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: '#FFF' }}>New playlist</Text>
                </TouchableOpacity>
                {/* Secondary action (outline) — append to current playlist. */}
                <TouchableOpacity
                  onPress={canAppend ? () => onAppend(d) : undefined}
                  disabled={!canAppend}
                  style={{ paddingHorizontal: 12, height: 30, borderRadius: 6, borderWidth: 1, borderColor: C.primary, alignItems: 'center', justifyContent: 'center', opacity: canAppend ? 1 : 0.35 }}
                  accessibilityLabel={`Append ${d} to current playlist`}
                >
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.primary }}>Append</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </TouchableOpacity>
  </Modal>
  );
};

interface NewPlaylistNameModalProps {
  visible: boolean;
  dir: string | null;
  name: string;
  setName: (s: string) => void;
  exists: boolean;
  onCancel: () => void;
  onCreate: () => void;
}

// Name prompt for "new playlist from folder". Pre-filled with the folder
// name but editable, so the operator can avoid overwriting an existing
// playlist. An in-app modal (not Alert.alert) because RN-web drops
// Alert button callbacks.
const NewPlaylistNameModal: React.FC<NewPlaylistNameModalProps> = ({
  visible, dir, name, setName, exists, onCancel, onCreate,
}) => {
  const C = usePalette();
  const modalStyles = useMemo(() => makeModalStyles(C), [C]);
  const clean = sanitizeName(name);
  return (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <TouchableOpacity
      activeOpacity={1}
      onPress={onCancel}
      style={modalStyles.backdrop}
      accessibilityLabel="Close new-playlist name prompt"
    >
      <TouchableOpacity activeOpacity={1} onPress={() => {}} style={modalStyles.cardWrap}>
        <View style={modalStyles.card}>
          <Text style={modalStyles.title}>NEW PLAYLIST FROM {dir?.toUpperCase() || 'FOLDER'}</Text>
          <Text style={{ color: C.icon, fontFamily: 'Inter_400Regular', fontSize: 11, marginBottom: 10, lineHeight: 15 }}>
            {"Name the new playlist. It will be filled with this folder's patterns and loaded onto the channel."}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="playlist name"
            placeholderTextColor={C.icon}
            autoFocus
            onSubmitEditing={() => { if (clean) onCreate(); }}
            returnKeyType="done"
            style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: C.ghostBorder, color: C.text }}
          />
          {exists && clean ? (
            <Text style={{ color: C.error, fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 6 }}>
              {`⚠ "${clean}" already exists — creating will overwrite it.`}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <TouchableOpacity
              onPress={onCancel}
              accessibilityLabel="Cancel new playlist"
              style={{ paddingHorizontal: 14, height: 34, borderRadius: 6, borderWidth: 1, borderColor: C.ghostBorder, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { if (clean) onCreate(); }}
              disabled={!clean}
              accessibilityLabel="Create new playlist"
              style={{ paddingHorizontal: 18, height: 34, borderRadius: 6, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', opacity: clean ? 1 : 0.4 }}
            >
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: '#FFF' }}>Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </TouchableOpacity>
  </Modal>
  );
};

function makeModalStyles(C: Palette) {
  return {
    // Full-screen tint: tapping this dismisses the modal.
    backdrop: {
      flex: 1,
      // 'rgba(0,0,0,0.5)' — modal-dimmer tint, identical in both themes.
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    // Inner wrapper: noop onPress catches taps so the modal stays open when
    // the user is interacting with content (textbox, list items, …). No
    // additional style is needed; the wrapper just exists to swallow taps.
    cardWrap: {},
    card: {
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: 16,
      padding: 16,
      minWidth: 320,
      maxWidth: '80%' as const,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    title: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 12,
      color: C.secondary,
      letterSpacing: 1.2,
      marginBottom: 8,
    },
  };
}
