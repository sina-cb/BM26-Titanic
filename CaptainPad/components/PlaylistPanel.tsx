import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  fetchPlaylists, fetchPlaylist, savePlaylist, deletePlaylist,
  fetchChannelPlaylist, setChannelPlaylist, setChannelPlaylistEntry,
  fetchPatterns,
  getApiBaseAsync,
  invalidatePlaylistCache, invalidatePlaylistsCache, primePlaylistCache,
  PlaylistData, PlaylistEntry, PlaylistAssignment,
  type ChannelRole,
} from '@/utils/api';
import { engineEvents, EngineMessage } from '@/utils/engineEvents';

const C = Colors.light;

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

export const PlaylistPanel: React.FC<Props> = ({ channelId, role = 'mixer', channelLabel, compact, locked, disabled, initialAssignment, initialPlaylist, onRefreshConnection, refreshNonce, playlistLibrary }) => {
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
  const [showLibrary, setShowLibrary] = useState(false);
  const [showAddPattern, setShowAddPattern] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

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
      setAssignment(effectiveAssign);
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
        const local = assignmentRef.current;
        const next = ch.playlist || null;
        const changed =
          (local?.name ?? null) !== (next?.name ?? null) ||
          (local?.activeEntryId ?? null) !== (next?.activeEntryId ?? null);
        if (changed) refresh();
      } else if (role === 'deck' && msg.type === 'deck') {
        // Deck event: `channel` is a single object (or null), not an array.
        const ch = msg.channel as { id?: string; playlist?: PlaylistAssignment | null } | null | undefined;
        if (!ch || ch.id !== channelId) return;
        const local = assignmentRef.current;
        const next = ch.playlist || null;
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
              setAssignment(msg.playlist as PlaylistAssignment);
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
  }, [role, channelId, refresh, flashSaved]);

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
    setAssignment({ ...assignment, activeEntryId: entryId });
    try {
      const res = await setChannelPlaylistEntry(role, channelId, entryId);
      if (!res.ok) {
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
      refresh();
    } catch (e) {
      setAssignment(prev);
      Alert.alert('Switch failed', (e as Error)?.message || 'Network error');
    }
  }, [role, assignment, channelId, disabled, refresh]);

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

  // Remove + persist in one step.
  const handleRemoveEntry = useCallback(async (entryId: string) => {
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
    fontPrimary: compact ? 12 : 13,
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

        {editable && (
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
              return (
                <View
                  key={e.id}
                  onLayout={(ev) => {
                    const { y, height } = ev.nativeEvent.layout;
                    rowOffsetsRef.current.set(e.id, { y, h: height });
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
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
                      numberOfLines={1}
                    >
                      {e.label || e.pattern}
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
                      >
                        {e.label ? e.pattern : ''}
                        {e.label && paramCount > 0 ? '  · ' : ''}
                        {paramCount > 0 ? `${paramCount} ${paramCount === 1 ? 'param' : 'params'}` : ''}
                      </Text>
                    )}
                  </TouchableOpacity>
                  {editable && (
                    <TouchableOpacity
                      onPress={() => handleRemoveEntry(e.id)}
                      style={{
                        width: sz.btnH - 4,
                        height: sz.btnH - 4,
                        borderRadius: 4,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      accessibilityLabel={`Remove ${e.pattern} from playlist`}
                    >
                      <Text style={{ color: isActive ? '#FFF' : C.error, fontWeight: 'bold', fontSize: sz.fontPrimary }}>−</Text>
                    </TouchableOpacity>
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

      <AddPatternModal
        visible={showAddPattern}
        onClose={() => setShowAddPattern(false)}
        playlistName={playlist?.name || null}
        allPatterns={allPatterns}
        onPick={handleAddPattern}
      />
    </View>
  );
};

// ── Modal sub-components ────────────────────────────────────────────────
// Pulled out into their own components so the JSX nesting is shallow and
// readable. Both share the same backdrop pattern: outer TWF closes on tap,
// inner TWF swallows taps so the modal content is opaque to dismissal.

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
}) => (
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
            <ScrollView style={{ maxHeight: 320 }}>
              {playlists.length === 0 && (
                <Text style={{ color: C.icon, fontStyle: 'italic', fontSize: 11 }}>
                  No playlists yet — create one below.
                </Text>
              )}
              {playlists.map((name) => {
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

interface AddPatternModalProps {
  visible: boolean;
  onClose: () => void;
  playlistName: string | null;
  allPatterns: string[];
  onPick: (name: string) => void;
}

const AddPatternModal: React.FC<AddPatternModalProps> = ({
  visible, onClose, playlistName, allPatterns, onPick,
}) => (
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

const modalStyles = {
  // Full-screen tint: tapping this dismisses the modal.
  backdrop: {
    flex: 1,
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
