import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { usePalette } from '@/hooks/use-theme';
import { useGlobalStyles } from '@/styles/globalStyles';
import { fetchBikes, setBikesConfig } from '@/utils/api';
import type { BikeSnapshot, FetchBikesResult } from '@/utils/api';
import { opConfirm, opError } from '@/utils/op_dialog';
import {
  BIKE_LINK_REVERT_HINT,
  DISABLE_BIKE_LINK_CONFIRM_MESSAGE,
  DISABLE_BIKE_LINK_CONFIRM_TITLE,
  ENGINE_PREDATES_BIKE_LINK_MESSAGE,
  bikeVisualRole,
  derivePanelState,
  disabledMessage,
  enabledEmptyMessage,
  formatAge,
  formatLeaseRemaining,
  formatPushStats,
  reconcileTargetsDraft,
  saveBikeTargetsPatch,
  startBikeLinkPatch,
  type BikeLinkPanelState,
  type BikeVisualRole,
} from '@/components/bike_link_logic';

const POLL_INTERVAL_MS = 3000;

interface PollOptions {
  acceptedEditRevision?: number;
}

export function BikeColorLinkCard() {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const [panelState, setPanelState] = useState<BikeLinkPanelState>({ kind: 'loading' });
  const [targetsDraft, setTargetsDraft] = useState('');
  const [serverTargets, setServerTargets] = useState('');
  const [pollError, setPollError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mountedRef = useRef(true);
  const panelStateRef = useRef(panelState);
  const editingRef = useRef(false);
  const dirtyRef = useRef(false);
  const editRevisionRef = useRef(0);
  panelStateRef.current = panelState;

  const applyFetchResult = useCallback((result: FetchBikesResult, options?: PollOptions): boolean => {
    if (!mountedRef.current) return false;
    const next = derivePanelState(result, panelStateRef.current);
    panelStateRef.current = next;
    setPanelState(next);

    if (!result.ok) {
      setPollError(result.status === 404
        ? null
        : ('error' in result ? result.error : `HTTP ${result.status}`));
      return false;
    }

    setPollError(null);
    const acceptedRevision = options?.acceptedEditRevision;
    const acceptedEditIsCurrent = acceptedRevision !== undefined
      && acceptedRevision === editRevisionRef.current;
    const nextServerTargets = result.data.config.targets;
    setServerTargets(nextServerTargets);
    setTargetsDraft((current) => reconcileTargetsDraft(
      current,
      nextServerTargets,
      acceptedEditIsCurrent ? false : editingRef.current,
      acceptedEditIsCurrent ? false : dirtyRef.current,
    ));
    if (acceptedEditIsCurrent) dirtyRef.current = false;
    return true;
  }, []);

  const poll = useCallback(async (options?: PollOptions): Promise<boolean> => {
    const result = await fetchBikes();
    return applyFetchResult(result, options);
  }, [applyFetchResult]);

  useEffect(() => {
    mountedRef.current = true;
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [poll]);

  const runConfigWrite = useCallback(async (
    patch: Parameters<typeof setBikesConfig>[0],
    failureTitle: string,
  ) => {
    if (busy) return;
    const submittedRevision = editRevisionRef.current;
    setBusy(true);
    setActionError(null);
    const result = await setBikesConfig(patch);
    if (!result.ok) {
      const message = result.error || 'Bike Link configuration was rejected';
      if (mountedRef.current) {
        setBusy(false);
        setActionError(message);
      }
      opError(failureTitle, message);
      return;
    }

    const rereadOk = await poll({ acceptedEditRevision: submittedRevision });
    if (mountedRef.current) {
      setBusy(false);
      if (!rereadOk) {
        setActionError('The engine accepted the write, but its current Bike Link state could not be reread.');
      }
    }
  }, [busy, poll]);

  const handleSaveAndStart = useCallback(() => {
    void runConfigWrite(
      startBikeLinkPatch(targetsDraft),
      'Could not save and start Bike Link',
    );
  }, [runConfigWrite, targetsDraft]);

  const handleSaveTargets = useCallback(() => {
    void runConfigWrite(
      saveBikeTargetsPatch(targetsDraft),
      'Could not save Bike Link targets',
    );
  }, [runConfigWrite, targetsDraft]);

  const handleStop = useCallback(async () => {
    if (busy) return;
    let confirmed = false;
    try {
      confirmed = await opConfirm({
        title: DISABLE_BIKE_LINK_CONFIRM_TITLE,
        message: DISABLE_BIKE_LINK_CONFIRM_MESSAGE,
        confirmLabel: 'STOP LINK',
        destructive: true,
      });
    } catch (error: any) {
      opError('Could not confirm', error?.message || String(error));
      return;
    }
    if (confirmed) {
      await runConfigWrite({ enabled: false }, 'Could not stop Bike Link');
    }
  }, [busy, runConfigWrite]);

  const handleTargetsChange = useCallback((value: string) => {
    editRevisionRef.current += 1;
    dirtyRef.current = true;
    setTargetsDraft(value);
    setActionError(null);
  }, []);

  const enabled = panelState.kind === 'list' || panelState.kind === 'enabled_empty';
  const unavailable = panelState.kind === 'engine_predates' || panelState.kind === 'unavailable';
  const loading = panelState.kind === 'loading';
  const pillLabel = loading
    ? 'LOADING…'
    : unavailable
      ? 'UNAVAILABLE'
      : enabled ? 'LINK RUNNING' : 'LINK STOPPED';
  const pillColor = loading
    ? C.icon
    : unavailable
      ? C.error
      : enabled ? C.tertiary : C.icon;

  return (
    <View style={[globalStyles.card, { alignSelf: 'stretch', padding: 24, marginBottom: 24 }]}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconSymbol name="network" size={24} color={C.primary} />
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 16,
            color: C.text,
            letterSpacing: 1,
          }}>
            ENGINE LINK STATE
          </Text>
        </View>
        <View style={{
          paddingVertical: 4,
          paddingHorizontal: 10,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: pillColor,
        }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 11,
            color: pillColor,
            letterSpacing: 1,
          }}>
            {pillLabel}
          </Text>
        </View>
      </View>

      <BikeLinkBody panelState={panelState} />

      {!unavailable && (
        <View style={{
          marginTop: 18,
          paddingTop: 18,
          borderTopWidth: 1,
          borderTopColor: C.ghostBorder,
        }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            fontSize: 12,
            color: C.text,
            letterSpacing: 1,
            marginBottom: 8,
          }}>
            TARGET CONTROLLERS
          </Text>
          <Text style={{
            fontFamily: 'Inter_400Regular',
            fontSize: 12,
            color: C.secondary,
            lineHeight: 17,
            marginBottom: 8,
          }}>
            Comma-separated entries. Only controllers named here are contacted.
              {' '}Shared global Color 1 and Color 2 changes are coalesced and pushed at most once per second.
              {' '}A 10-second idle keepalive maintains each engine lease.
          </Text>
          <View style={{
            borderWidth: 1,
            borderColor: C.ghostBorder,
            borderRadius: 8,
            backgroundColor: C.surfaceContainerLowest,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 10,
            gap: 3,
          }}>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold',
              fontSize: 10,
              color: C.primary,
              letterSpacing: 0.8,
              marginBottom: 2,
            }}>
              TARGET FORMAT EXAMPLES
            </Text>
            <TargetSyntaxExample label="Single" value="A.B.C.D" color={C.secondary} />
            <TargetSyntaxExample label="Custom port" value="A.B.C.D:port" color={C.secondary} />
            <TargetSyntaxExample label="Bracket range" value="A.B.C.[D...E]" color={C.secondary} />
            <TargetSyntaxExample label="Range + port" value="A.B.C.[D...E]:port" color={C.secondary} />
            <TargetSyntaxExample label="Full range" value="A.B.C.D-A.B.C.E" color={C.secondary} />
          </View>
          <Text style={{
            fontFamily: 'Inter_400Regular',
            fontSize: 11,
            color: C.icon,
            lineHeight: 15,
            marginBottom: 8,
          }}>
            Combine any formats with commas. Bracket and full ranges are inclusive.
          </Text>
          <TextInput
            value={targetsDraft}
            onChangeText={handleTargetsChange}
            onFocus={() => { editingRef.current = true; }}
            onBlur={() => { editingRef.current = false; }}
            editable={!busy && !loading}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Bike Link target controllers"
            placeholder="A.B.C.D, A.B.C.[D...E]"
            placeholderTextColor={C.icon}
            style={{
              width: '100%',
              borderWidth: 1,
              borderColor: C.ghostBorder,
              borderRadius: 10,
              backgroundColor: C.surfaceContainerLowest,
              color: C.text,
              fontFamily: 'Inter_400Regular',
              fontSize: 14,
              paddingHorizontal: 14,
              paddingVertical: 13,
            }}
          />
          <Text style={{
            fontFamily: 'Inter_400Regular',
            fontSize: 11,
            color: C.icon,
            marginTop: 7,
          }}>
            Persisted on engine: {serverTargets || 'none'}
          </Text>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
            {!enabled ? (
              <ActionButton
                label={busy ? 'SAVING…' : 'SAVE & START'}
                onPress={handleSaveAndStart}
                disabled={busy || loading}
                primary
              />
            ) : (
              <>
                <ActionButton
                  label={busy ? 'SAVING…' : 'SAVE TARGETS'}
                  onPress={handleSaveTargets}
                  disabled={busy}
                  primary
                />
                <ActionButton
                  label="STOP LINK"
                  onPress={() => void handleStop()}
                  disabled={busy}
                  destructive
                />
              </>
            )}
          </View>

          <Text style={{
            fontFamily: 'Inter_400Regular',
            fontSize: 12,
            color: C.icon,
            marginTop: 14,
            lineHeight: 17,
          }}>
            {BIKE_LINK_REVERT_HINT}
          </Text>
        </View>
      )}

      {actionError && <ErrorRow message={actionError} />}
      {pollError && panelState.kind !== 'unavailable' && <ErrorRow message={pollError} />}
    </View>
  );
}

function TargetSyntaxExample({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Text style={{
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color,
      lineHeight: 15,
    }}>
      {label}: <Text style={{ fontFamily: 'SpaceMono_400Regular' }}>{value}</Text>
    </Text>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  primary = false,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  primary?: boolean;
  destructive?: boolean;
}) {
  const C = usePalette();
  const color = destructive ? C.error : primary ? C.primary : C.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flexGrow: 1,
        flexBasis: 220,
        paddingVertical: 14,
        paddingHorizontal: 18,
        borderRadius: 10,
        borderWidth: primary ? 2 : 1,
        borderColor: color,
        backgroundColor: primary ? C.primaryContainer : C.surfaceContainerLow,
        alignItems: 'center',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold',
        fontSize: 13,
        color,
        letterSpacing: 1.2,
      }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ErrorRow({ message }: { message: string }) {
  const C = usePalette();
  return (
    <View style={{
      marginTop: 12,
      backgroundColor: 'rgba(186, 26, 26, 0.08)',
      borderRadius: 8,
      padding: 12,
      borderWidth: 1,
      borderColor: 'rgba(186, 26, 26, 0.3)',
    }}>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: C.error }}>
        {message}
      </Text>
    </View>
  );
}

function BikeLinkBody({ panelState }: { panelState: BikeLinkPanelState }) {
  const C = usePalette();

  if (panelState.kind === 'loading') {
    return <StatusText message="Loading Bike Link state from the engine…" />;
  }
  if (panelState.kind === 'engine_predates') {
    return <ErrorRow message={ENGINE_PREDATES_BIKE_LINK_MESSAGE} />;
  }
  if (panelState.kind === 'unavailable') {
    return <ErrorRow message={panelState.message} />;
  }
  if (panelState.kind === 'disabled') {
    return <StatusText message={disabledMessage(panelState.knownBikeCount)} />;
  }
  if (panelState.kind === 'enabled_empty') {
    return <StatusText message={enabledEmptyMessage(panelState.targetsConfigured, panelState.targets)} />;
  }

  const nowMs = Date.now();
  return (
    <View style={{ gap: 8, marginBottom: 8 }}>
      {panelState.bikes.map((bike) => (
        <BikeRow key={bike.controllerId} bike={bike} nowMs={nowMs} />
      ))}
      <View style={{ height: 1, backgroundColor: C.ghostBorder, marginTop: 4, marginBottom: 4 }} />
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon }}>
        {panelState.stats.sweeps} sweeps · {panelState.stats.pushCycles} push cycles
        {panelState.stats.pushCycleOverruns > 0 ? ` (${panelState.stats.pushCycleOverruns} overrun)` : ''}
        {' '}· {panelState.stats.pushesOk} ok / {panelState.stats.pushesFailed} failed
        {panelState.stats.paletteErrors > 0 ? ` · ${panelState.stats.paletteErrors} palette errors` : ''}
      </Text>
    </View>
  );
}

function StatusText({ message }: { message: string }) {
  const C = usePalette();
  return (
    <Text style={{
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: C.secondary,
      marginBottom: 8,
      lineHeight: 18,
    }}>
      {message}
    </Text>
  );
}

function roleColorFrom(C: ReturnType<typeof usePalette>, role: BikeVisualRole): string {
  switch (role) {
    case 'primary': return C.primary;
    case 'tertiary': return C.tertiary;
    case 'warning': return C.warning;
    case 'error': return C.error;
    case 'icon': return C.icon;
  }
}

function BikeRow({ bike, nowMs }: { bike: BikeSnapshot; nowMs: number }) {
  const C = usePalette();
  const roleColor = roleColorFrom(C, bikeVisualRole(bike.state));
  return (
    <View style={{
      width: '100%',
      alignSelf: 'stretch',
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerLow,
      gap: 8,
    }}>
      <View style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
      }}>
        <View>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 9, color: C.icon, letterSpacing: 1 }}>
            CONTROLLER ID
          </Text>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text }}>
            {bike.controllerId}
          </Text>
        </View>
        <View style={{
          paddingVertical: 3,
          paddingHorizontal: 9,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: roleColor,
        }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: roleColor, letterSpacing: 1 }}>
            {bike.state}
          </Text>
        </View>
      </View>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.secondary }}>
        {bike.address} · firmware {bike.firmwareTag || '—'} · pattern {bike.activePattern || '—'}
      </Text>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary }}>
        fresh {formatAge(nowMs, bike.lastSeenMs)} · lease {formatLeaseRemaining(bike.leaseMsRemaining)}
        {' '}· pushes {formatPushStats(bike.pushStats)}
      </Text>
    </View>
  );
}
