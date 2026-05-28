import React, { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { Palette } from '@/constants/theme';
import { View, Text, TextInput, Alert, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { usePalette } from '@/hooks/use-theme';
import {
  fetchPlaylist, savePlaylist, fetchMixerChannelPlaylist,
  PlaylistData, PlaylistAssignment,
} from '@/utils/api';
import { engineEvents, EngineMessage } from '@/utils/engineEvents';

// Time we wait after the last keystroke before persisting. Long enough to feel
// like one save per edit-burst, short enough that walking away from an iPad
// never leaves an unsaved label on screen.
const AUTOSAVE_DEBOUNCE_MS = 500;

// EntryLabelEditor — renders the currently-active playlist entry's `label`
// as an editable title. Lives in the deck's parameters card so a tap-and-type
// flow is right next to the params the user is tweaking.
//
// Design notes:
//   - Renaming = updating `entries[i].label`. We POST the full entries array
//     back through the existing `/playlists` endpoint; the engine validates,
//     persists, and broadcasts `playlistSaved`, which the PlaylistPanel
//     already listens for. That panel flashes its existing ✓ SAVED toast,
//     so the user gets immediate visual confirmation across panes for free.
//   - Auto-save without requiring the user to think about saving. Three
//     redundant paths, in order of when they fire:
//       1. Debounced commit ~500ms after the last keystroke. Primary path —
//          the value is durable well before the user reaches for anything
//          else, even on iPad where the on-screen keyboard never sees an
//          Enter press.
//       2. Native DOM `blur` listener (web) / `onBlur` prop (native).
//          Flushes any pending debounce the moment focus leaves so the
//          save is never "in the air" when the user moves on. We attach
//          the web listener directly via the input ref because
//          react-native-web's TextInput `onBlur` prop does not fire on
//          tap-away or Tab in Expo Web.
//       3. `onSubmitEditing` flushes on Enter for hardware-keyboard users.
//   - We capture the entry id *at the moment editing started* via
//     `editingEntryIdRef`. If the active entry flips while typing (autopilot,
//     sibling tab tap), the commit still routes the typed value to the
//     entry the user was looking at, not the one that happens to be active
//     when the commit fires.
//   - Locked channels show the label as static text — no input box.
interface Props {
  channelId: string;
  /** Small badge prefix, e.g. "DECK MAIN" or "MIXER CH 1". */
  channelLabel?: string;
  /** When the channel is locked, the field becomes read-only. */
  locked?: boolean;
}

export const EntryLabelEditor: React.FC<Props> = ({ channelId, channelLabel, locked }) => {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const [assignment, setAssignment] = useState<PlaylistAssignment | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [draft, setDraft] = useState('');

  const playlistRef = useRef<PlaylistData | null>(null);
  const assignmentRef = useRef<PlaylistAssignment | null>(null);
  const draftRef = useRef('');
  // Pinned to the entry the user started editing. This is what commit()
  // saves to — never the "live" active entry, which can shift mid-edit.
  const editingEntryIdRef = useRef<string | null>(null);
  // Debounce timer for typing → autosave.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Underlying input element, used to attach a native DOM blur listener on
  // web (workaround for react-native-web's TextInput onBlur not firing).
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { assignmentRef.current = assignment; }, [assignment]);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  const activeEntry = playlist && assignment
    ? playlist.entries.find((e) => e.id === assignment.activeEntryId) || null
    : null;

  // Reset the draft whenever the active entry changes so the input mirrors
  // the canonical label. The `key` prop on the TextInput below remounts the
  // component, which keeps the native input state in sync too.
  useEffect(() => {
    setDraft(activeEntry?.label || '');
    editingEntryIdRef.current = null;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [activeEntry?.id, activeEntry?.label]);

  const refresh = useCallback(async () => {
    if (!channelId) return;
    const a = await fetchMixerChannelPlaylist(channelId);
    const nextAssign = a.ok ? (a.data || null) : null;
    setAssignment(nextAssign);
    if (nextAssign?.name) {
      const pl = await fetchPlaylist(nextAssign.name);
      setPlaylist(pl.ok && pl.data ? pl.data : null);
    } else {
      setPlaylist(null);
    }
  }, [channelId]);

  useEffect(() => { refresh(); }, [refresh]);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // Cross-tab consistency — react to the same broadcasts PlaylistPanel does.
  useEffect(() => {
    return engineEvents.subscribe((msg: EngineMessage) => {
      if (msg.type === 'mixer') {
        const channels = (msg.channels as { id: string; playlist?: PlaylistAssignment | null }[]) || [];
        const ch = channels.find((c) => c.id === channelId);
        if (!ch) return;
        const local = assignmentRef.current;
        const next = ch.playlist || null;
        if (
          (local?.name ?? null) !== (next?.name ?? null) ||
          (local?.activeEntryId ?? null) !== (next?.activeEntryId ?? null)
        ) {
          refresh();
        }
      } else if (msg.type === 'playlistSaved') {
        const cur = playlistRef.current;
        if (cur && msg.name === cur.name && msg.playlist) {
          setPlaylist(msg.playlist as PlaylistData);
        }
      } else if (msg.type === 'playlistDeleted') {
        const cur = playlistRef.current;
        if (cur && msg.name === cur.name) refresh();
      } else if (msg.type === 'playlistEntryCaptured') {
        const cur = playlistRef.current;
        if (cur && msg.playlist === cur.name) refresh();
      }
    });
  }, [channelId, refresh]);

  // The actual save. Pulls draft from the ref so it works correctly when
  // called from the debounce timer or the native blur listener — both of
  // which capture stale closures otherwise.
  const commit = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const cur = playlistRef.current;
    const targetEntryId = editingEntryIdRef.current;
    editingEntryIdRef.current = null;
    if (!cur || !targetEntryId) return;
    const target = cur.entries.find((e) => e.id === targetEntryId);
    if (!target) return;
    const trimmed = draftRef.current.trim();
    const nextLabel = trimmed.length > 0 ? trimmed : null;
    if ((target.label ?? null) === nextLabel) return;
    const nextEntries = cur.entries.map((e) =>
      e.id === targetEntryId ? { ...e, label: nextLabel } : e
    );
    setPlaylist({ ...cur, entries: nextEntries });
    const res = await savePlaylist({ name: cur.name, entries: nextEntries });
    if (!res.ok) {
      // Don't leak server-side details to the user — the engine already
      // logs the failure server-side; we just need a generic toast here.
      Alert.alert('Rename failed', 'Could not save the new name. Try again.');
      await refresh();
    }
  }, [refresh]);

  const handleChangeText = useCallback((text: string) => {
    if (!editingEntryIdRef.current && activeEntry) {
      editingEntryIdRef.current = activeEntry.id;
    }
    setDraft(text);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      commit();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [activeEntry, commit]);

  // Native-DOM blur safety net for web. react-native-web's `onBlur` prop on
  // TextInput is unreliable in Expo Web (it does not fire on tap-away or
  // Tab navigation), so we hook the underlying `<input>` element directly.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = inputRef.current as unknown as HTMLInputElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const onNativeBlur = () => { commit(); };
    node.addEventListener('blur', onNativeBlur);
    return () => node.removeEventListener('blur', onNativeBlur);
  }, [commit, activeEntry?.id]);

  // Flush any pending save when this component unmounts (tab switch, channel
  // change, etc.) so a half-typed name is never lost.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        commit();
      }
    };
  }, [commit]);

  const labelText = channelLabel ? channelLabel.toUpperCase() : '';

  // If there is no playlist / no active entry, fall back to a static title so
  // the parameters card still renders cleanly (e.g. while the channel is
  // booting or its playlist is being assigned).
  if (!activeEntry) {
    return (
      <View style={styles.row}>
        {labelText ? <Badge text={labelText} /> : null}
        <Text style={styles.titleStatic} numberOfLines={1}>
          —
        </Text>
      </View>
    );
  }

  const subtitleParamCount = Object.keys(activeEntry.defaults || {}).length;

  if (locked) {
    return (
      <View style={styles.row}>
        {labelText ? <Badge text={labelText} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.titleStatic} numberOfLines={1}>
            {activeEntry.label || activeEntry.pattern}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {activeEntry.pattern}
            {subtitleParamCount > 0
              ? `  ·  ${subtitleParamCount} ${subtitleParamCount === 1 ? 'param' : 'params'}`
              : ''}
            {'  ·  (locked)'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      {labelText ? <Badge text={labelText} /> : null}
      <View style={{ flex: 1 }}>
        <TextInput
          // Remount on entry change so the native input state can't get
          // out of step with the canonical label.
          key={activeEntry.id}
          ref={inputRef}
          value={draft}
          onChangeText={handleChangeText}
          // React Native (iOS/Android) reliably fires onBlur — flush there.
          // On Web this rarely fires; the native DOM listener above covers
          // that case.
          onBlur={commit}
          // Hardware-keyboard users who hit Enter still get an instant save,
          // and `blurOnSubmit` dismisses the iPad on-screen keyboard.
          onSubmitEditing={commit}
          blurOnSubmit
          returnKeyType="done"
          placeholder={activeEntry.pattern}
          placeholderTextColor={C.icon}
          accessibilityLabel="Rename pattern instance"
          style={styles.input}
        />
        <Text style={styles.subtitle} numberOfLines={1}>
          {activeEntry.pattern}
          {subtitleParamCount > 0
            ? `  ·  ${subtitleParamCount} ${subtitleParamCount === 1 ? 'param' : 'params'}`
            : ''}
        </Text>
      </View>
    </View>
  );
};

const Badge: React.FC<{ text: string }> = ({ text }) => {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
};


function makeStyles(C: Palette) {
  return {
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: C.surfaceContainerHigh,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.ghostBorder,
  },
  badgeText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 10,
    color: C.secondary,
    letterSpacing: 1.2,
  },
  titleStatic: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 16,
    color: C.text,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  input: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 16,
    color: C.text,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.ghostBorder,
    backgroundColor: C.surfaceContainerLowest,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: C.icon,
    marginTop: 2,
    paddingHorizontal: 8,
  },
};
}
