// GroupRailBody — channel groups (gang-faders) operator surface (docs/39 §10).
//
// A mix group is a named gang-fader: its `fader` + `muted` scale every member
// channel's contribution at composite time (engine-side, `_effFader`). Each
// channel has a SINGLE-membership pointer (`channel.mixGroupId`). This body:
//   - lists every group as a card with a gang FADER + a MUTE toggle + a rename
//     field + a delete (ConfirmSheet-gated), and shows its member chips.
//   - creates a new (empty) group.
//   - assigns / unassigns a channel to a group (the assign picker respects
//     single-membership — the engine 400s a 2nd-group add and we surface it).
//
// As of the 2026-06-28 mixer UI refactor this grouping UI lives inside a
// floating modal launched from a compact "GROUPS" button on the mixer's
// GLOBALS row (it no longer eats an always-on full-width rail row). The body
// is rendered already-expanded — the modal IS the expansion — so the old
// collapsed-rail header/chevron is gone. All grouping functionality and
// handlers are preserved verbatim; this was a relocation, not a rewrite.
//
// The engine is the AUTHORITY: every mutation is validate→saveAllState→
// broadcastMixerState on the engine. This component is STATELESS w.r.t. the
// group registry + membership — it renders the parent-owned `mixGroups` +
// `channels` (both reconciled from the `mixer` broadcast) and reports edits up
// through the typed groupsSoloApi clients. Codex P0 — fail loud: every client
// honours res.ok; failures (group 404, single-membership 400, deck WRONG_ROLE
// 400, transport) surface via Alert and the next broadcast reconciles truth.
//
// Touch targets are ≥44 pt (hitSlop / minHeight). The group gang-fader writes
// optimistically over its own row but the engine broadcast is the truth — a
// rejected PATCH reverts on the next `mixer` event.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput, Alert } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { Palette } from '@/constants/theme';
import { useGlobalStyles, GlobalStyles } from '@/styles/globalStyles';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import {
  type MixGroup,
  createMixGroup, updateMixGroup, deleteMixGroup,
  addChannelToGroup, removeChannelFromGroup,
} from '@/utils/groupsSoloApi';

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

// Minimal channel shape the rail needs (the parent passes the full channel
// objects; we only read id / name / mixGroupId).
interface RailChannel {
  id: string;
  name?: string | null;
  mixGroupId?: string | null;
}

export interface GroupRailBodyProps {
  mixGroups: MixGroup[];
  channels: RailChannel[];
}

// ── In-list group header ───────────────────────────────────────────────────
// A SLIM, low-footprint divider rendered in the mixer's channel list directly
// before a group's first member (operator request 2026-06-29: "make the group
// container very minimally visible to not waste UI space"). Tapping the header
// (its NAME is the affordance) collapses ↔ expands that group's member
// channels — collapsed members render as thin strips, expanded members render
// as full cards. The header carries the group color tint, the name, a member
// count, and a chevron that flips with the collapsed state.
//
// Collapse is VIEW-ONLY and lives in the mixer screen's state (session-scoped),
// so this component is a pure controlled affordance: it reports taps up via
// `onToggle` and reflects `collapsed` — it owns no fold state itself. The full
// create/rename/assign/gang surface still lives in GroupRailBody (the GROUPS
// modal); this header is just the in-list presence + collapse toggle.
export interface MixGroupHeaderProps {
  group: MixGroup;
  index: number;
  memberCount: number;
  collapsed: boolean;
  onToggle: (groupId: string) => void;
}

export function MixGroupHeader({ group, index, memberCount, collapsed, onToggle }: MixGroupHeaderProps) {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);
  const name = (group.name || `GROUP ${index + 1}`).toUpperCase();
  return (
    <TouchableOpacity
      style={[
        styles.inlineGroupHeader,
        group.color ? { borderLeftColor: group.color, borderLeftWidth: 3 } : null,
      ]}
      hitSlop={HIT_SLOP}
      onPress={() => onToggle(group.id)}
      accessibilityRole="button"
      accessibilityLabel={`${name} group, ${memberCount} channel${memberCount === 1 ? '' : 's'}, ${collapsed ? 'collapsed — tap to expand' : 'expanded — tap to collapse'}`}
      accessibilityState={{ expanded: !collapsed }}
    >
      <Text style={[styles.inlineGroupChevron, { transform: [{ rotate: collapsed ? '0deg' : '90deg' }] }]}>▸</Text>
      <View style={[styles.groupDot, { backgroundColor: group.color || C.secondary, width: 8, height: 8, borderRadius: 4 }]} />
      <Text style={styles.inlineGroupName} numberOfLines={1}>{name}</Text>
      <View style={styles.inlineGroupCount}>
        <Text style={styles.inlineGroupCountText}>{memberCount}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function GroupRailBody({ mixGroups, channels }: GroupRailBodyProps) {
  const C = usePalette();
  const globalStyles = useGlobalStyles();
  const styles = useMemo(() => makeStyles(C, globalStyles), [C, globalStyles]);

  const [deletePrompt, setDeletePrompt] = useState<{ id: string; name: string } | null>(null);
  // Assign picker: which group are we adding a channel to.
  const [assignTo, setAssignTo] = useState<MixGroup | null>(null);
  // Optimistic gang-fader values keyed by group id. The engine broadcast is
  // the truth; this just smooths the slider during a drag (parallel to the
  // mixer's per-channel localFaderWrite guard, kept simple here).
  const [faderDraft, setFaderDraft] = useState<{ [gid: string]: number }>({});

  const membersByGroup = useMemo(() => {
    const m: { [gid: string]: RailChannel[] } = {};
    for (const ch of channels) {
      if (ch.mixGroupId) {
        (m[ch.mixGroupId] = m[ch.mixGroupId] || []).push(ch);
      }
    }
    return m;
  }, [channels]);

  const handleCreate = useCallback(async () => {
    const res = await createMixGroup();
    if (!res.ok) {
      console.error('[GroupRail] Create group failed:', res.error);
      Alert.alert('Create group failed', res.error || 'The engine did not accept the new group.');
    }
    // Success: the WS mixer broadcast adds the group to the parent's list.
  }, []);

  const handleRename = useCallback(async (gid: string, name: string) => {
    const res = await updateMixGroup(gid, { name });
    // Name is cosmetic — log, don't Alert (matches channel rename).
    if (!res.ok) console.error(`[GroupRail] Group rename rejected for ${gid}:`, res.error);
  }, []);

  const handleGangFader = useCallback(async (gid: string, fader: number) => {
    setFaderDraft((d) => ({ ...d, [gid]: fader }));
    const res = await updateMixGroup(gid, { fader });
    if (!res.ok) {
      console.error(`[GroupRail] Gang-fader rejected for ${gid}:`, res.error);
      // Drop the optimistic draft so the next broadcast's truth shows.
      setFaderDraft((d) => { const n = { ...d }; delete n[gid]; return n; });
      Alert.alert('Group fader not applied', `The engine rejected this group fader. ${res.error || ''}`.trim());
    }
  }, []);

  const handleMute = useCallback(async (gid: string, muted: boolean) => {
    const res = await updateMixGroup(gid, { muted });
    if (!res.ok) {
      console.error(`[GroupRail] Group mute rejected for ${gid}:`, res.error);
      Alert.alert('Group mute not applied', `The engine rejected this group mute. ${res.error || ''}`.trim());
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    const target = deletePrompt;
    if (!target) return;
    setDeletePrompt(null);
    const res = await deleteMixGroup(target.id);
    if (!res.ok) {
      console.error('[GroupRail] Delete group failed:', res.error);
      Alert.alert('Delete group failed', `"${target.name}" is still active. ${res.error || ''}`.trim());
    }
  }, [deletePrompt]);

  const handleAssign = useCallback(async (gid: string, channelId: string) => {
    setAssignTo(null);
    const res = await addChannelToGroup(gid, channelId);
    if (!res.ok) {
      // Surface the single-membership 400 ("already in a different group") and
      // the deck WRONG_ROLE 400 verbatim — these are the operator-facing errors.
      console.error(`[GroupRail] Assign channel ${channelId} → ${gid} rejected:`, res.error);
      Alert.alert('Could not add to group', res.error || 'The engine rejected this assignment.');
    }
  }, []);

  const handleUnassign = useCallback(async (gid: string, channelId: string) => {
    const res = await removeChannelFromGroup(gid, channelId);
    if (!res.ok) {
      console.error(`[GroupRail] Unassign channel ${channelId} from ${gid} rejected:`, res.error);
      Alert.alert('Could not remove from group', res.error || 'The engine rejected this change.');
    }
  }, []);

  const groupName = (g: MixGroup, idx: number) => g.name || `GROUP ${idx + 1}`;

  return (
    <View style={styles.body}>
      {/* Modal header: a title + a "+ NEW GROUP" quick-add. The old
          collapsed-rail chevron is gone — this UI now lives in a floating
          modal launched from the mixer's GROUPS button, so it's always
          "expanded". */}
      <View style={styles.bodyHeader}>
        <View style={styles.railTitleBtn}>
          <Text style={styles.labelCaps}>GROUPS</Text>
          {mixGroups.length > 0 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{mixGroups.length}</Text>
            </View>
          ) : null}
        </View>
        {mixGroups.length > 0 ? (
          <TouchableOpacity
            style={styles.newGroupBtn}
            hitSlop={HIT_SLOP}
            onPress={handleCreate}
            accessibilityRole="button"
            accessibilityLabel="Create group"
          >
            <Text style={[styles.labelCaps, { color: C.primary }]}>+ NEW GROUP</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.groupsRow} showsVerticalScrollIndicator={false}>
          {mixGroups.length === 0 ? (
            // Empty state IS the create affordance — tap it to spin up the
            // first group (mirrors the prior empty-rail behaviour).
            <TouchableOpacity
              style={styles.emptyCreateBtn}
              hitSlop={HIT_SLOP}
              onPress={handleCreate}
              accessibilityRole="button"
              accessibilityLabel="Create group"
            >
              <Text style={[styles.labelCaps, { color: C.primary }]}>+ NEW GROUP</Text>
            </TouchableOpacity>
          ) : null}
          {mixGroups.map((g, idx) => {
            const members = membersByGroup[g.id] || [];
            const faderVal = faderDraft[g.id] ?? g.fader ?? 1;
            return (
              <View
                key={g.id}
                style={[
                  styles.groupCard,
                  g.color ? { borderColor: g.color, borderLeftWidth: 4 } : null,
                  g.muted ? styles.groupCardMuted : null,
                ]}
              >
                <View style={styles.groupCardHeader}>
                  <View style={[styles.groupDot, { backgroundColor: g.color || C.secondary }]} />
                  <TextInput
                    style={styles.groupNameInput}
                    defaultValue={groupName(g, idx)}
                    onEndEditing={(e) => handleRename(g.id, e.nativeEvent.text)}
                    placeholderTextColor={C.icon}
                  />
                  <TouchableOpacity
                    style={[styles.groupIconBtn, { borderColor: 'rgba(217,48,37,0.4)' }]}
                    hitSlop={HIT_SLOP}
                    onPress={() => setDeletePrompt({ id: g.id, name: groupName(g, idx) })}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${groupName(g, idx)}`}
                  >
                    <Text style={{ color: C.error, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13 }}>✕</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.gangRow}>
                  <Text style={[styles.labelCaps, { width: 40 }]}>GANG</Text>
                  <HorizontalFader
                    value={faderVal}
                    onChange={(v: number) => handleGangFader(g.id, v)}
                    trackStyle={[styles.faderTrack, { flex: 1, marginHorizontal: 6, opacity: g.muted ? 0.4 : 1 }]}
                    fillStyle={styles.gangFill}
                  />
                  <Text style={[styles.displayMono, { width: 30, textAlign: 'right', fontSize: 12 }]}>
                    {Math.round(faderVal * 100)}
                  </Text>
                </View>

                <View style={styles.groupActions}>
                  <TouchableOpacity
                    style={[styles.groupToggle, g.muted && styles.groupToggleMuted]}
                    onPress={() => handleMute(g.id, !g.muted)}
                    accessibilityRole="button"
                    accessibilityLabel={g.muted ? 'Group muted' : 'Mute group'}
                    accessibilityState={{ selected: !!g.muted }}
                  >
                    <Text style={[styles.labelCaps, g.muted && { color: '#FFF' }]}>{g.muted ? 'MUTED' : 'MUTE'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.groupToggle}
                    onPress={() => setAssignTo(g)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add channel to ${groupName(g, idx)}`}
                  >
                    <Text style={[styles.labelCaps, { color: C.primary }]}>+ CHANNEL</Text>
                  </TouchableOpacity>
                </View>

                {/* Member chips — tap ✕ to unassign. */}
                <View style={styles.memberChips}>
                  {members.length === 0 ? (
                    <Text style={[styles.labelCaps, { opacity: 0.6 }]}>NO MEMBERS</Text>
                  ) : null}
                  {members.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={styles.memberChip}
                      hitSlop={HIT_SLOP}
                      onPress={() => handleUnassign(g.id, m.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${m.name || m.id} from group`}
                    >
                      <Text style={styles.memberChipText} numberOfLines={1}>{m.name || m.id}</Text>
                      <Text style={styles.memberChipX}>✕</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            );
          })}
      </ScrollView>

      {/* Assign-channel picker — only ungrouped channels + channels already in
          THIS group are sensible to show; the engine 400s a cross-group add so
          we surface that too if the operator picks a grouped channel. We show
          all overlays and disable ones already in another group with a hint. */}
      <Modal transparent visible={!!assignTo} animationType="fade" onRequestClose={() => setAssignTo(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAssignTo(null)}>
          <View style={styles.modalContent}>
            <Text style={[styles.labelCaps, { marginBottom: 12 }]}>ADD CHANNEL TO GROUP</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {channels.length === 0 ? (
                <Text style={[styles.labelCaps, { padding: 8 }]}>NO CHANNELS</Text>
              ) : null}
              {channels.map((ch) => {
                const inThis = !!assignTo && ch.mixGroupId === assignTo.id;
                const inOther = !!ch.mixGroupId && (!assignTo || ch.mixGroupId !== assignTo.id);
                return (
                  <TouchableOpacity
                    key={ch.id}
                    style={[styles.modalRow, inThis && styles.modalRowActive, inOther && { opacity: 0.5 }]}
                    onPress={() => { if (assignTo && !inOther) handleAssign(assignTo.id, ch.id); }}
                    disabled={inOther}
                  >
                    <Text style={[styles.valueReadout, inThis && { color: C.primary }]}>
                      {ch.name || ch.id}{inThis ? ' ✓' : ''}{inOther ? ' · IN ANOTHER GROUP' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <ConfirmSheet
        visible={!!deletePrompt}
        title="Delete group?"
        message={`This removes the "${deletePrompt?.name ?? ''}" group. Its member channels stay in the mix and are released from the group (their own faders resume full control).`}
        confirmLabel="DELETE GROUP"
        cancelLabel="CANCEL"
        onConfirm={confirmDelete}
        onCancel={() => setDeletePrompt(null)}
      />
    </View>
  );
}

function makeStyles(C: Palette, globalStyles: GlobalStyles) {
  return {
    // The grouping UI now renders as the body of a floating modal (the
    // mixer's GROUPS button opens it), so there's no rail frame/border —
    // the host modalContent supplies the surface + padding. We cap the
    // height so a long group list scrolls inside the modal rather than
    // pushing it off-screen.
    body: {
      maxHeight: 520,
    },
    // Slim in-list group header (the collapse affordance in the mixer's
    // channel list). Low-footprint: a single short row with a subtle tinted
    // surface + left color accent so members read as "belonging together"
    // without eating a full card's worth of vertical space.
    inlineGroupHeader: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      minHeight: 30,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 8,
      backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    inlineGroupChevron: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      color: C.secondary,
      width: 12,
      textAlign: 'center' as const,
    },
    inlineGroupName: {
      flex: 1,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      letterSpacing: 0.8,
      color: C.text,
    },
    inlineGroupCount: {
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 5,
      backgroundColor: C.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    inlineGroupCountText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      color: C.secondary,
    },
    bodyHeader: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      marginBottom: 4,
    },
    railTitleBtn: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      minHeight: 32,
      paddingRight: 12,
    },
    countBadge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      backgroundColor: C.primary,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    countBadgeText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      color: '#FFF',
    },
    newGroupBtn: {
      minHeight: 32,
      paddingHorizontal: 12,
      justifyContent: 'center' as const,
    },
    // Round8 #6: the empty-state create button inside the expand. A dashed
    // outline reads as an "add here" affordance now that the header "+ NEW
    // GROUP" button is hidden while the rail is empty. ≥44pt touch target.
    emptyCreateBtn: {
      minHeight: 44,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderStyle: 'dashed' as const,
      borderColor: C.primary,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    // Vertical stack of group cards inside the modal (was a horizontal rail
    // strip). Each card stretches to the modal width.
    groupsRow: {
      flexDirection: 'column' as const,
      gap: 12,
      paddingTop: 8,
      paddingBottom: 4,
    },
    groupCard: {
      width: 300,
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 10,
      ...globalStyles.ambientShadow,
    },
    groupCardMuted: {
      borderColor: C.error,
    },
    groupCardHeader: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      marginBottom: 8,
    },
    groupDot: {
      width: 12, height: 12, borderRadius: 6,
    },
    groupNameInput: {
      flex: 1,
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      color: C.text,
      padding: 0,
    },
    groupIconBtn: {
      width: 28, height: 28, borderRadius: 6,
      backgroundColor: C.surfaceContainerLowest,
      alignItems: 'center' as const, justifyContent: 'center' as const,
      borderWidth: 1, borderColor: C.ghostBorder,
    },
    gangRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      marginBottom: 8,
    },
    faderTrack: {
      height: 16,
      backgroundColor: C.surfaceContainerHigh,
      borderRadius: 4,
    },
    gangFill: {
      position: 'absolute' as const,
      left: 0, top: 0, bottom: 0,
      backgroundColor: C.primary,
      borderRadius: 4,
    },
    groupActions: {
      flexDirection: 'row' as const,
      gap: 8,
      marginBottom: 8,
    },
    groupToggle: {
      flex: 1,
      minHeight: 44,
      backgroundColor: C.surfaceContainerHigh,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    groupToggleMuted: {
      backgroundColor: C.error,
      borderColor: C.error,
    },
    memberChips: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 6,
    },
    memberChip: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 6,
      maxWidth: 120,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    memberChipText: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      color: C.text,
      flexShrink: 1,
    },
    memberChipX: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 11,
      color: C.secondary,
    },
    labelCaps: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 10,
      letterSpacing: 1.2,
      color: C.secondary,
      textTransform: 'uppercase' as const,
    },
    valueReadout: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 13,
      color: C.text,
    },
    displayMono: {
      fontFamily: 'SpaceGrotesk_700Bold',
      fontSize: 18,
      color: C.primary,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
    },
    modalContent: {
      backgroundColor: C.surfaceContainerLowest,
      borderRadius: 16,
      padding: 24,
      minWidth: 260,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      ...globalStyles.ambientShadow,
    },
    modalRow: {
      minHeight: 44,
      justifyContent: 'center' as const,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 8,
      marginBottom: 4,
    },
    modalRowActive: {
      backgroundColor: 'rgba(0,104,117,0.1)',
      borderWidth: 1,
      borderColor: 'rgba(0,104,117,0.3)',
    },
  };
}
