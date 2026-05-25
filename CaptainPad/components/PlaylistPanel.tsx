import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Colors } from '@/constants/theme';
import {
  fetchPlaylists, fetchPlaylist, savePlaylist, deletePlaylist,
  fetchMixerChannelPlaylist, setMixerChannelPlaylist, setMixerChannelPlaylistEntry,
  fetchPatterns,
  getApiBaseAsync,
  PlaylistData, PlaylistEntry, PlaylistAssignment,
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
}

function genEntryId() {
  return `e_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function sanitizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 64);
}

export const PlaylistPanel: React.FC<Props> = ({ channelId, channelLabel, compact, locked, disabled }) => {
  const [playlists, setPlaylists] = useState<string[]>([]);
  const [assignment, setAssignment] = useState<PlaylistAssignment | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [allPatterns, setAllPatterns] = useState<string[]>([]);
  const [busy, setBusyRaw] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showAddPattern, setShowAddPattern] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // ── Busy watchdog ───────────────────────────────────────────────────
  // The user reported "after selecting a new playlist, the playlist
  // dropdown is not even usable anymore on that channel". The only
  // thing that disables the dropdown is `busy`, and every code path
  // that sets it to true wraps the work in try/finally so setBusy(false)
  // always runs. But "always" only holds if neither React state batching,
  // an unmount mid-await, nor a JS error inside finally itself ever
  // strands the flag.
  //
  // The watchdog turns this from a hope into a guarantee: any setBusy(true)
  // call also arms a timer that force-clears the flag after MAX_BUSY_MS
  // even if the surrounding try/finally never fires. Worst case the
  // operator sees a brief flicker; they NEVER see a permanently dead
  // dropdown.
  const busyWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_BUSY_MS = 6000;
  const setBusy = useCallback((next: boolean) => {
    if (busyWatchdogRef.current) {
      clearTimeout(busyWatchdogRef.current);
      busyWatchdogRef.current = null;
    }
    if (next) {
      busyWatchdogRef.current = setTimeout(() => {
        busyWatchdogRef.current = null;
        setBusyRaw(false);
      }, MAX_BUSY_MS);
    }
    setBusyRaw(next);
  }, []);
  useEffect(() => () => {
    if (busyWatchdogRef.current) clearTimeout(busyWatchdogRef.current);
  }, []);

  // Single source of truth: avoid stale closures inside the WS event
  // listener by routing through refs.
  const playlistRef = useRef<PlaylistData | null>(null);
  const assignmentRef = useRef<PlaylistAssignment | null>(null);
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { assignmentRef.current = assignment; }, [assignment]);

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
      const [lib, a, ps] = await Promise.all([
        fetchPlaylists(),
        fetchMixerChannelPlaylist(channelId),
        fetchPatterns(),
      ]);
      const anyFailed = !lib.ok || !a.ok || !ps.ok;
      if (lib.ok && lib.data) setPlaylists(lib.data);
      const nextAssign = a.ok ? (a.data || null) : null;
      setAssignment(nextAssign);
      if (nextAssign?.name) {
        const pl = await fetchPlaylist(nextAssign.name);
        if (pl.ok && pl.data) setPlaylist(pl.data);
        else if (!pl.ok) scheduleRetry();
      } else if (a.ok) {
        // a.ok with no assignment is a real "no playlist" state.
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
  }, [channelId]);

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

  // Subscribe to engine WS broadcasts via the global bus. The screen-level
  // ws.onmessage forwards every parsed message here.
  useEffect(() => {
    return engineEvents.subscribe((msg: EngineMessage) => {
      if (msg.type === 'mixer') {
        // The deck/mixer broadcasts a fresh mixer state on every mutation.
        // If our channel's playlist assignment changed under us (because a
        // sibling tab swapped playlists, or autopilot stepped to a new
        // entry), pick that up.
        const channels = (msg.channels as Array<{ id: string; playlist?: PlaylistAssignment | null }>) || [];
        const ch = channels.find((c) => c.id === channelId);
        if (!ch) return;
        const local = assignmentRef.current;
        const next = ch.playlist || null;
        const changed =
          (local?.name ?? null) !== (next?.name ?? null) ||
          (local?.activeEntryId ?? null) !== (next?.activeEntryId ?? null);
        if (changed) refresh();
      } else if (msg.type === 'playlistLibrary') {
        setPlaylists(Array.isArray(msg.names) ? (msg.names as string[]) : []);
      } else if (msg.type === 'playlistSaved') {
        // Some tab (this one or a sibling) just saved a playlist. If it's
        // the one we're showing, swap in the new content directly — no
        // extra fetch needed since the broadcast carries it.
        const cur = playlistRef.current;
        if (cur && msg.name === cur.name && msg.playlist) {
          setPlaylist(msg.playlist as PlaylistData);
          flashSaved();
        }
      } else if (msg.type === 'playlistDeleted') {
        // The currently-loaded playlist was deleted out from under us.
        const cur = playlistRef.current;
        if (cur && msg.name === cur.name) refresh();
      } else if (msg.type === 'playlistEntryCaptured') {
        // The engine just auto-captured defaults on some channel. Flash the
        // toast if it's ours; refresh the playlist data if we're showing it.
        if (msg.channelId === channelId) flashSaved();
        const cur = playlistRef.current;
        if (cur && msg.playlist === cur.name) {
          refresh();
        }
      }
    });
  }, [channelId, refresh, flashSaved]);

  // ── Actions ─────────────────────────────────────────────────────────
  // Switch this channel to a different playlist. Reported bug history:
  //   1. "Switching doesn't do it" — race between awaited refresh() and
  //      the WS `mixer` broadcast left the dropdown showing stale data.
  //   2. "Dropdown is not even usable anymore on that channel after
  //      selecting a new playlist" — busy stayed true past the POST
  //      because we were awaiting a 4-GET refresh() inside the same
  //      try block, and any slow GET (or even a transient retry) held
  //      the dropdown disabled for seconds.
  //
  // The current shape:
  //   - Optimistically set assignment to the new name so the dropdown
  //     label flips immediately. This also short-circuits the WS
  //     subscriber's "name changed → refresh" path so we don't double
  //     up with the awaited refresh below.
  //   - Use the engine's own response (which already carries the new
  //     `playlist` assignment) as the canonical post-switch state.
  //   - Clear `busy` AS SOON AS the POST resolves. The follow-up GET
  //     for the playlist contents runs in the background and updates
  //     the entry list when it lands — the operator can already tap
  //     the dropdown again.
  //   - The watchdog above guarantees busy clears within MAX_BUSY_MS
  //     even if every promise hangs.
  const handleLoadPlaylist = useCallback(async (name: string) => {
    setBusy(true);
    setShowLibrary(false);
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
      const res = await setMixerChannelPlaylist(channelId, name);
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
      setAssignment(prevAssignment);
      setPlaylist(prevPlaylist);
      Alert.alert('Load failed', err?.message || 'Network error');
      return;
    } finally {
      // Clear BEFORE the entries fetch so the dropdown is responsive
      // again the instant the engine acknowledges the switch.
      setBusy(false);
    }
    // Fire-and-forget background refresh to pull the new playlist's
    // entries / patterns library / etc. Any failure is handled by
    // refresh()'s own scheduleRetry().
    refresh();
  }, [channelId, flashSaved, refresh, setAssignment, setPlaylist, setBusy]);

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
      const res = await setMixerChannelPlaylistEntry(channelId, entryId);
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
  }, [assignment, channelId, disabled, refresh]);

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
  const sz = {
    rowPadY: compact ? 4 : 8,
    rowPadX: compact ? 6 : 10,
    rowGap: compact ? 1 : 3,
    fontPrimary: compact ? 12 : 14,
    fontSecondary: compact ? 9 : 11,
    fontMicro: compact ? 8 : 10,
    indexWidth: compact ? 16 : 22,
    btnH: compact ? 22 : 28,
    btnFont: compact ? 10 : 11,
    headerFont: compact ? 10 : 11,
    panelPad: compact ? 6 : 10,
    panelGap: compact ? 4 : 8,
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
      {/* ── Row 1: section label + saved indicator ─────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: sz.btnH - 4 }}>
        <Text
          style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: sz.headerFont,
            color: C.secondary,
            letterSpacing: 1.2,
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
            disabled={busy}
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
            disabled={!playlist || busy}
            style={{
              width: sz.btnH,
              height: sz.btnH,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: C.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !playlist || busy ? 0.4 : 1,
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
                    disabled={busy || missing || disabled}
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
          <ScrollView>
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
