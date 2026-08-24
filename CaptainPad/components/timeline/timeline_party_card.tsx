import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';

import { Palette, Type } from '@/constants/theme';
import { usePalette } from '@/hooks/use-theme';
import { useLiveParams, useLiveSignalsConnected } from '@/hooks/useEngineState';
import {
  nextPartySignalTruth,
  PARTY_SIGNAL_UNKNOWN,
  type PartySignalTruth,
} from '@/utils/audioSignals';
import { engineEvents, type EngineMessage } from '@/utils/engineEvents';
import type { TimelineState } from '@/utils/timelineApi';
import { opConfirm, opError, opInfo } from '@/utils/op_dialog';
import {
  describePartyStatus,
  fetchPartyConfig,
  forcePartySession,
  formatMinSec,
  formatMinutes,
  partyButtonRules,
  partyReadinessChips,
  partyTimerReadouts,
  parsePartyConfig,
  resetPartyCooldown,
  returnPartyToLiveAudio,
  setPartyConfig,
  type PartyConfig,
  type PartyReadinessChip,
} from '@/utils/party_api';
import {
  partySignalHeadline,
  partySignalSourceControl,
  setPartySignalSource,
  setPartyTestOverride,
  subscribePartyDetector,
  type PartyDetectorState,
  type PartySignalSource,
  type PartySignalSourceControl,
} from '@/utils/party_test_api';
import { Dropdown } from './makerControls';

interface TimelinePartyCardProps {
  state: TimelineState | null;
  connected: boolean;
  controlsLocked?: boolean;
  /**
   * IANA plan timezone, for the WINDOW chip's "opens HH:MM". Absent means the
   * chip omits the time — the pad's own clock is not the plan's clock.
   */
  planTz?: string | null;
}

export function TimelinePartyCard({
  state,
  connected,
  controlsLocked = false,
  planTz = null,
}: TimelinePartyCardProps) {
  const C = usePalette();
  const styles = useMemo(() => makeStyles(C), [C]);
  const [config, setConfig] = useState<PartyConfig | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The companion override reset is a SEPARATE step from the engine call
  // (_356 F5), so it gets its own error line: a companion that is down must
  // never make a successful engine RETURN look like a failure.
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [detector, setDetector] = useState<PartyDetectorState | null>(null);
  const [detectorError, setDetectorError] = useState<string | null>(null);
  // SIGNAL SOURCE is companion-owned config: its own pending flag and its own
  // error line, so a refused source write never reads as an engine failure.
  const [sourcePending, setSourcePending] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const liveDoc = useLiveParams();
  const signalsConnected = useLiveSignalsConnected();
  const broadEntry = liveDoc?.params?.audioParty;
  const strongEntry = liveDoc?.params?.audioPartyStrong;
  const broadTruthRef = useRef<PartySignalTruth>(PARTY_SIGNAL_UNKNOWN);
  const strongTruthRef = useRef<PartySignalTruth>(PARTY_SIGNAL_UNKNOWN);
  broadTruthRef.current = nextPartySignalTruth(broadTruthRef.current, {
    connected: signalsConnected,
    doc: liveDoc,
    value: broadEntry && typeof broadEntry.value === 'number' ? broadEntry.value : null,
  });
  strongTruthRef.current = nextPartySignalTruth(strongTruthRef.current, {
    connected: signalsConnected,
    doc: liveDoc,
    value: strongEntry && typeof strongEntry.value === 'number' ? strongEntry.value : null,
  });
  const broadSignal = broadTruthRef.current.value;
  const strongSignal = strongTruthRef.current.value;

  const refresh = useCallback(async () => {
    if (!connected) return;
    const result = await fetchPartyConfig();
    if (!result.ok || !result.data) {
      setError(result.error || 'Party status unavailable');
      return;
    }
    setConfig(result.data);
    setError(null);
  }, [connected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Party session transitions are not broadcast on every tick. Poll while the
  // LIVE card is mounted, and also accept immediate cross-surface PUT updates.
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => { void refresh(); }, 1000);
    return () => clearInterval(timer);
  }, [connected, refresh]);
  useEffect(() => engineEvents.subscribe((message: EngineMessage) => {
    if (!message || (message as { type?: string }).type !== 'partyConfig') return;
    try {
      setConfig(parsePartyConfig(message));
      setError(null);
    } catch (caught: any) {
      setError(caught?.message || 'Party status broadcast malformed');
    }
  }), []);
  useEffect(() => {
    if (!connected) {
      setDetector(null);
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let lastPaintAt = 0;
    void subscribePartyDetector(
      (next) => {
        if (cancelled) return;
        const now = Date.now();
        // Companion publishes at 10 Hz. The operator panel needs responsive
        // stages, not ten full React renders per second.
        if (now - lastPaintAt < 250) return;
        lastPaintAt = now;
        setDetector(next);
        setDetectorError(null);
      },
      (caught) => {
        if (!cancelled) setDetectorError(caught.message);
      },
    ).then((close) => {
      if (cancelled) close();
      else unsubscribe = close;
    }).catch((caught: any) => {
      if (!cancelled) setDetectorError(caught?.message || String(caught));
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [connected]);

  const active = config?.effectiveState === 'in_session';
  const cooldown = config?.effectiveState === 'cooldown';
  useEffect(() => {
    if (!active && !cooldown) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, cooldown]);
  const status = describePartyStatus({
    enabled: config?.enabled ?? state?.partyEnabled ?? null,
    effectiveState: config?.effectiveState,
    planActive: config?.planActive ?? state?.planActive ?? null,
    inFestivalWindow: config?.inFestivalWindow ?? state?.inFestivalWindow ?? null,
    party: state?.party,
    currentMood: state?.currentMood,
    sessionFollowsMusic: config?.sessionFollowsMusic,
    sessionEndsAtMs: config?.sessionEndsAtMs,
    cooldownRemainingSec: config?.cooldownRemainingSec ?? state?.partyCooldownRemainingSec,
    nowMs,
    engineOffline: !connected,
  });
  const statusColor = status.tone === 'live'
    ? C.tertiary
    : status.tone === 'off'
      ? C.error
      : status.tone === 'armed'
        ? C.primary
        : status.tone === 'unknown'
          ? C.secondary
          : C.warning;
  const timerReadouts = config ? partyTimerReadouts(config, nowMs) : [];
  const planContext = !config
    ? 'PLAN STATUS UNAVAILABLE'
    : config.partyCueId
      ? `${config.planActive ? 'ACTIVE PLAN' : 'SAVED PLAN'} · ${config.partyCueId}`
      : 'NO ENABLED PARTY TRIGGER IN THIS PLAN';

  // Every control's enablement and label comes from ONE pure rule set, and
  // every readiness chip from ONE pure derivation over engine fields — the
  // card itself decides nothing (_356 §4).
  const buttons = partyButtonRules({
    config,
    connected,
    locked: controlsLocked,
    pending,
    expanded,
  });
  const engineMoodStale = config?.moodStale ?? state?.moodStale ?? null;
  const chips = config
    ? partyReadinessChips(config, { moodStale: engineMoodStale, planTz, nowMs })
    : [];
  const cueError = config?.cueError || null;

  const toggleEnabled = async () => {
    if (!buttons.enabledToggle.enabled || !config) return;
    if (config.enabled && active) {
      const confirmed = await opConfirm({
        title: 'END PARTY SESSION?',
        message: 'Disabling Party immediately ends the active session and returns control to the calm Timeline state.',
        confirmLabel: 'DISABLE PARTY',
        destructive: true,
      });
      if (!confirmed) return;
    }
    setPending(true);
    const result = await setPartyConfig({ enabled: !config.enabled });
    setPending(false);
    if (!result.ok || !result.data) {
      setError(result.error || 'Party update rejected');
      return;
    }
    setConfig(result.data);
    setError(null);
  };

  const selectPlaylist = async (playlist: string) => {
    if (!config || pending || !connected || controlsLocked || playlist === config.playlist) return;
    setPending(true);
    const result = await setPartyConfig({ playlist });
    setPending(false);
    if (!result.ok || !result.data) {
      setError(result.error || 'Party playlist update rejected');
      return;
    }
    setConfig(result.data);
    setError(null);
  };

  const forceParty = async () => {
    if (!buttons.force.enabled) return;
    setPending(true);
    try {
      const result = await forcePartySession();
      if (!result.ok || !result.data) throw new Error(result.error || 'The engine rejected Force Party.');
      setConfig(result.data);
      opInfo('PARTY FORCED', 'Party started now. Detection, sustain, Party Window, and cooldown were bypassed.');
    } catch (caught: any) {
      opError('FORCE PARTY FAILED', caught?.message || String(caught));
    } finally {
      setPending(false);
    }
  };

  // ENGINE FIRST, companion second (_356 P0-4). The old order asked the
  // companion to drop its test override before calling the engine, so a
  // companion that was down aborted the whole action and the live session kept
  // playing with no explanation. Ending the session is the operator's actual
  // intent; clearing the override is housekeeping that reports its own failure.
  const returnToAudio = async () => {
    if (!buttons.returnToAudio.enabled) return;
    const cancellingForcedSession = config?.sessionForced === true;
    setPending(true);
    try {
      const result = await returnPartyToLiveAudio();
      if (!result.ok || !result.data) throw new Error(result.error || 'The engine rejected live audio.');
      setConfig(result.data);
      setOverrideError(null);
      try {
        await setPartyTestOverride('auto');
      } catch (caught: any) {
        setOverrideError(
          `Session ended, but the companion test override could not be cleared: ${caught?.message || String(caught)}`,
        );
      }
      opInfo(
        cancellingForcedSession ? 'FORCED PARTY CANCELLED' : 'PARTY SESSION ENDED',
        cancellingForcedSession
          ? 'The force-started session stopped immediately. Live detection is restored; normal cooldown applies.'
          : 'The running session stopped immediately. Live detection is restored; normal cooldown applies.',
      );
    } catch (caught: any) {
      opError('LIVE AUDIO FAILED', caught?.message || String(caught));
    } finally {
      setPending(false);
    }
  };

  // SIGNAL SOURCE — exposure only. The companion persists `party.source` into
  // its own config.yaml and answers with a typed ack; the pad never keeps a
  // local copy of the selection, it just re-renders the telemetry it is sent.
  const sourceControl = partySignalSourceControl({
    detector,
    connected,
    locked: controlsLocked,
    pending: sourcePending || pending,
  });
  const selectSignalSource = async (next: PartySignalSource) => {
    if (sourceControl.disabled || next === sourceControl.source) return;
    setSourcePending(true);
    setSourceError(null);
    try {
      await setPartySignalSource(next);
    } catch (caught: any) {
      setSourceError(caught?.message || String(caught));
    } finally {
      setSourcePending(false);
    }
  };

  const clearCooldown = async () => {
    if (!buttons.resetCooldown.enabled) return;
    setPending(true);
    try {
      const result = await resetPartyCooldown();
      if (!result.ok || !result.data) throw new Error(result.error || 'The engine rejected cooldown reset.');
      setConfig(result.data);
      opInfo('COOLDOWN RESET', 'Party may trigger again immediately when the other live conditions are ready.');
    } catch (caught: any) {
      opError('COOLDOWN RESET FAILED', caught?.message || String(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>PARTY</Text>
          <Text style={[
            styles.state,
            { color: statusColor },
          ]}>
            {status.label}
          </Text>
        </View>
        {pending ? <ActivityIndicator size="small" color={C.primary} /> : (
          <View style={[
            styles.dot,
            { backgroundColor: statusColor },
          ]} />
        )}
      </View>

      <Text style={styles.statusDetail}>{status.detail}</Text>
      <Text style={styles.planContext}>{planContext}</Text>
      <Text style={styles.playlist} numberOfLines={1}>
        {config?.playlist || state?.partyPlaylist || 'Playlist unavailable'}
      </Text>

      <View style={styles.signalRow}>
        <SignalPill label="MUSIC LEVEL" value={broadSignal} styles={styles} />
        <SignalPill label="QUALIFIED SIGNAL" value={strongSignal} styles={styles} />
      </View>
      <PartyDetectorPanel
        detector={detector}
        error={detectorError}
        styles={styles}
        onTune={() => router.push('/audio')}
        sourceControl={sourceControl}
        sourcePending={sourcePending}
        sourceError={sourceError}
        onSelectSource={(next) => { void selectSignalSource(next); }}
      />

      {timerReadouts.length > 0 ? (
        <>
          <Text style={styles.layerLabel}>TIMELINE SESSION LAYER</Text>
          <View style={styles.timerRow}>
            {timerReadouts.map((timer) => (
              <PartyTimer key={timer.id} timer={timer} styles={styles} />
            ))}
          </View>
        </>
      ) : null}

      {chips.length > 0 ? (
        <View style={styles.readinessRow}>
          {chips.map((entry) => (
            <ReadinessChip key={entry.id} chip={entry} styles={styles} />
          ))}
        </View>
      ) : null}

      {cueError ? (
        <Text style={styles.error} accessibilityRole="alert">
          {`PARTY CUE ERROR — ${cueError}`}
        </Text>
      ) : null}
      {engineMoodStale === true ? (
        <Text style={styles.error} accessibilityRole="alert">
          SIGNAL STALE — companion not publishing
        </Text>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[
            styles.actionButton,
            config?.sessionForced && styles.actionButtonActive,
            !buttons.force.enabled && styles.disabled,
          ]}
          onPress={() => { void forceParty(); }}
          disabled={!buttons.force.enabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !buttons.force.enabled }}
        >
          <Text style={styles.actionLabel}>{buttons.force.label}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.disclosure,
            !buttons.returnToAudio.enabled && styles.disabled,
          ]}
          onPress={() => { void returnToAudio(); }}
          disabled={!buttons.returnToAudio.enabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !buttons.returnToAudio.enabled }}
        >
          <Text
            style={styles.disclosureLabel}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {buttons.returnToAudio.label}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.help}>
        FORCE PARTY starts immediately and ignores detection, sustain, window, and cooldown.
        The second button ends whichever session is running — forced or detected — and
        restores live detection with normal cooldown.
      </Text>

      <TouchableOpacity
        style={[
          styles.cooldownReset,
          !buttons.resetCooldown.enabled && styles.disabled,
        ]}
        onPress={() => { void clearCooldown(); }}
        disabled={!buttons.resetCooldown.enabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !buttons.resetCooldown.enabled }}
      >
        <Text style={styles.cooldownResetLabel}>{buttons.resetCooldown.label}</Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {overrideError ? (
        <Text style={styles.error} accessibilityRole="alert">{overrideError}</Text>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[
            styles.actionButton,
            config?.enabled && styles.actionButtonActive,
            !buttons.enabledToggle.enabled && styles.disabled,
          ]}
          onPress={() => { void toggleEnabled(); }}
          disabled={!buttons.enabledToggle.enabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !buttons.enabledToggle.enabled }}
        >
          <Text
            style={styles.actionLabel}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {buttons.enabledToggle.label}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.disclosure}
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
        >
          <Text
            style={styles.disclosureLabel}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {buttons.settings.label}
          </Text>
        </TouchableOpacity>
      </View>

      {expanded ? (
        <View style={styles.settings}>
          <Text style={styles.settingLabel}>HOW PARTY STARTS</Text>
          <Text style={styles.help}>
            Add a timed PARTY WINDOW with a normal baseline and a detected-party playlist.
            ENABLED allows sustained strong music to switch playlists only while that
            calendar window is open. Outside the window, detection cannot change the deck.
          </Text>
          <Text style={styles.settingLabel}>PLAN TRIGGER SETTINGS</Text>
          {config?.partyCueId ? (
            <>
              <SettingRow
                label="SUSTAIN"
                value={formatMinSec(config.minDwellSec)}
                styles={styles}
              />
              <SettingRow
                label="SESSION"
                value={config.durationEnabled ? `${config.durationMin} min` : 'FOLLOWS MUSIC'}
                styles={styles}
              />
              <SettingRow
                label="COOLDOWN"
                value={config.cooldownEnabled ? formatMinutes(config.cooldownSec) : 'OFF'}
                styles={styles}
              />
            </>
          ) : (
            <Text style={styles.help}>
              Add a PARTY trigger to a cue in EDIT PLAN. Until then, enabling PARTY cannot arm a session.
            </Text>
          )}
          <Text style={styles.settingLabel}>NEXT SESSION PLAYLIST</Text>
          <Dropdown
            value={config?.playlist ?? null}
            options={(config?.availablePlaylists ?? []).map((playlist) => ({
              id: playlist,
              label: playlist,
            }))}
            onSelect={(playlist) => { void selectPlaylist(playlist); }}
            disabled={!connected || controlsLocked || !config || pending}
            placeholder="Playlist unavailable"
            emptyHint="No Party playlists are available from the engine."
          />
          <Text style={styles.help}>
            Edit the PARTY WINDOW to change its time, baseline, detected playlist, sustain,
            session length, and cooldown. Saving the active plan applies those settings here;
            ENABLED / DISABLED remains the live operator gate.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function PartyTimer({
  timer,
  styles,
}: {
  timer: ReturnType<typeof partyTimerReadouts>[number];
  styles: ReturnType<typeof makeStyles>;
}) {
  const active = timer.tone === 'active';
  const ready = timer.tone === 'ready';
  return (
    <View style={[
      styles.timerTile,
      active && styles.timerTileActive,
      ready && styles.timerTileReady,
    ]}>
      <View style={styles.timerTitleRow}>
        <View style={[
          styles.timerDot,
          active && styles.timerDotActive,
          ready && styles.timerDotReady,
        ]} />
        <Text style={styles.timerLabel}>{timer.label}</Text>
      </View>
      <Text
        style={[
          styles.timerValue,
          active && styles.timerValueActive,
          ready && styles.timerValueReady,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {timer.value}
      </Text>
      <Text style={styles.timerDetail} numberOfLines={1}>{timer.detail}</Text>
    </View>
  );
}

function SignalPill({
  label,
  value,
  styles,
}: {
  label: string;
  value: number | null;
  styles: ReturnType<typeof makeStyles>;
}) {
  const on = value !== null && value >= 0.5;
  const state = value === null ? '…' : (on ? 'ON' : 'OFF');
  return (
    <View style={[styles.signalPill, on && styles.signalPillOn]}>
      <Text style={[styles.signalPillText, on && styles.signalPillTextOn]}>{`${label} · ${state}`}</Text>
    </View>
  );
}

function PartyDetectorPanel({
  detector,
  error,
  styles,
  onTune,
  sourceControl,
  sourcePending,
  sourceError,
  onSelectSource,
}: {
  detector: PartyDetectorState | null;
  error: string | null;
  styles: ReturnType<typeof makeStyles>;
  onTune: () => void;
  sourceControl: PartySignalSourceControl;
  sourcePending: boolean;
  sourceError: string | null;
  onSelectSource: (source: PartySignalSource) => void;
}) {
  if (!detector) {
    return (
      <View style={styles.detectorPanel}>
        <Text style={styles.layerLabel}>AUDIO COMPANION DETECTOR</Text>
        <Text style={error ? styles.error : styles.detectorProgress}>
          {error || 'Reading detector stages…'}
        </Text>
      </View>
    );
  }
  const p = detector.params;
  const onHoldSec = p.onSustainMs / 1000;
  const offHoldSec = p.offConfirmMs / 1000;
  const qualifySec = Math.min(onHoldSec, Math.max(0, detector.qualifyingForMs / 1000));
  const releaseSec = Math.min(offHoldSec, Math.max(0, detector.disqualifyingForMs / 1000));
  const progress = detector.overrideMode !== 'auto'
    ? `OVERRIDE · ${detector.overrideMode.toUpperCase()}`
    : detector.party
      ? detector.qualify
        ? 'QUALIFIED SIGNAL HELD ON'
        : `DETECTOR RELEASE HOLD · ${releaseSec.toFixed(1)} / ${offHoldSec.toFixed(0)}s`
      : detector.qualify
        ? `DETECTOR START HOLD · ${qualifySec.toFixed(1)} / ${onHoldSec.toFixed(0)}s`
        : 'WAITING FOR ALL FOUR GATES';
  const levelThreshold = p.ambientFloor * p.marginX;
  const gates = [
    {
      label: 'LEVEL',
      ok: detector.levelOk,
      detail: `Loudness ${detector.loudness.toFixed(2)}; requires at least ${levelThreshold.toFixed(2)}.`,
    },
    {
      label: 'BEAT',
      ok: detector.beatOk,
      detail: `Kick rate ${detector.kickRate.toFixed(2)}/s (allowed ${p.kickRateMin.toFixed(1)}–${p.kickRateMax.toFixed(1)}), regularity ${detector.kickReg.toFixed(2)} (minimum ${p.kickRegMin.toFixed(2)}), plus BPM lock.`,
    },
    {
      label: 'SHAPE',
      ok: detector.shapeOk,
      detail: `Low share ${detector.lowShare.toFixed(2)} (minimum ${p.shapeLowMin.toFixed(2)}); high share ${detector.highShare.toFixed(2)} (minimum ${p.shapeHighMin.toFixed(2)}).`,
    },
    {
      label: 'QUIET',
      ok: detector.quietOk,
      detail: `Silence detector ${detector.silence.toFixed(2)}; must remain below ${p.silenceMax.toFixed(2)}.`,
    },
    {
      label: 'QUALIFY',
      ok: detector.qualify,
      detail: `LEVEL, BEAT, SHAPE, and QUIET must all pass continuously. Then the Companion holds for ${onHoldSec.toFixed(0)}s to turn Party ON and ${offHoldSec.toFixed(0)}s to turn it OFF.`,
    },
  ];
  return (
    <View style={styles.detectorPanel}>
      <View style={styles.detectorHeader}>
        <Text style={styles.layerLabel}>AUDIO COMPANION DETECTOR</Text>
        <Text style={[
          styles.detectorState,
          detector.publishedParty === true && styles.detectorStateOn,
        ]}>
          {partySignalHeadline(detector)}
        </Text>
      </View>
      <Text style={styles.layerLabel}>SIGNAL SOURCE</Text>
      {sourceControl.visible ? (
        <>
          <View style={styles.sourceRow}>
            {sourceControl.options.map((option) => {
              const active = option.id === sourceControl.source;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.sourceSegment,
                    active && styles.sourceSegmentActive,
                    sourceControl.disabled && styles.disabled,
                  ]}
                  onPress={() => onSelectSource(option.id)}
                  disabled={sourceControl.disabled}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: sourceControl.disabled }}
                  accessibilityLabel={`Publish the ${option.label} party detector`}
                >
                  <Text style={[styles.sourceSegmentText, active && styles.sourceSegmentTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.detectorHint}>
            {sourcePending ? 'WRITING THE SOURCE TO THE COMPANION…' : sourceControl.note}
          </Text>
        </>
      ) : (
        <Text style={styles.detectorHint}>
          {sourceControl.hiddenNote || 'Reading the companion signal source…'}
        </Text>
      )}
      {sourceError ? (
        <Text style={styles.error} accessibilityRole="alert">{sourceError}</Text>
      ) : null}
      <View style={styles.detectorChipRow}>
        {gates.map((gate) => (
          <TouchableOpacity
            key={gate.label}
            style={[styles.detectorChip, gate.ok && styles.detectorChipOk]}
            onPress={() => opInfo(`${gate.label} · ${gate.ok ? 'PASS' : 'WAITING'}`, gate.detail)}
            accessibilityRole="button"
            accessibilityLabel={`${gate.label} detector gate ${gate.ok ? 'passing' : 'waiting'}. Tap for details.`}
          >
            <Text style={[styles.detectorChipText, gate.ok && styles.detectorChipTextOk]}>
              {`${gate.ok ? '✓' : '×'} ${gate.label}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.detectorProgress}>{progress}</Text>
      <Text style={styles.detectorHint}>Tap any gate for its live values and thresholds.</Text>
      <TouchableOpacity
        style={styles.detectorTune}
        onPress={onTune}
        accessibilityRole="button"
        accessibilityLabel="Open Audio detector tuning"
      >
        <Text style={styles.detectorTuneText}>TUNE IN AUDIO ›</Text>
      </TouchableOpacity>
    </View>
  );
}

function ReadinessChip({
  chip,
  styles,
}: {
  chip: PartyReadinessChip;
  styles: ReturnType<typeof makeStyles>;
}) {
  // 'ready' and 'live' are the two affirmative tones; 'neutral' is a condition
  // that simply is not met right now (calm audio, a closed session) and must
  // NOT read as an error; only 'alert' is red.
  const box = chip.tone === 'ready' || chip.tone === 'live'
    ? styles.readinessChipReady
    : chip.tone === 'neutral'
      ? styles.readinessChipNeutral
      : null;
  const text = chip.tone === 'ready'
    ? styles.readinessTextReady
    : chip.tone === 'live'
      ? styles.readinessTextLive
      : chip.tone === 'neutral'
        ? styles.readinessTextNeutral
        : null;
  return (
    <View style={[styles.readinessChip, box]}>
      <Text style={[styles.readinessText, text]}>{chip.text}</Text>
    </View>
  );
}

function SettingRow({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingRowLabel}>{label}</Text>
      <Text style={styles.settingRowValue}>{value}</Text>
    </View>
  );
}

function makeStyles(C: Palette) {
  return {
    card: {
      borderRadius: 18,
      backgroundColor: C.surfaceContainerLowest,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      padding: 18,
      gap: 10,
    },
    header: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
    },
    titleBlock: {
      flex: 1,
    },
    title: {
      ...Type.timelineTitle,
      color: C.text,
    },
    state: {
      ...Type.timelineMeta,
      color: C.secondary,
      marginTop: 3,
    },
    statusDetail: {
      ...Type.body,
      fontSize: 13,
      color: C.secondary,
      lineHeight: 18,
    },
    planContext: {
      ...Type.labelCaps,
      color: C.primary,
    },
    dot: {
      width: 14,
      height: 14,
      borderRadius: 7,
    },
    playlist: {
      ...Type.timelineBody,
      color: C.text,
    },
    signalRow: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 8,
    },
    signalPill: {
      minHeight: 30,
      borderRadius: 999,
      paddingHorizontal: 10,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    signalPillOn: {
      borderColor: C.tertiary,
      backgroundColor: C.secondaryContainer,
    },
    signalPillText: {
      ...Type.labelCaps,
      color: C.secondary,
    },
    signalPillTextOn: {
      color: C.tertiary,
    },
    layerLabel: {
      ...Type.labelCaps,
      color: C.secondary,
      fontSize: 9,
      letterSpacing: 1.2,
    },
    detectorPanel: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      padding: 10,
      gap: 7,
    },
    detectorHeader: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: 8,
    },
    detectorState: {
      ...Type.labelCaps,
      color: C.secondary,
      fontSize: 9,
    },
    detectorStateOn: {
      color: C.tertiary,
    },
    detectorChipRow: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 6,
    },
    // SIGNAL SOURCE segmented control — gloved-hand targets (44pt), same
    // vocabulary as the gate chips so it reads as part of the detector block.
    sourceRow: {
      flexDirection: 'row' as const,
      gap: 6,
    },
    sourceSegment: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerLowest,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: 10,
    },
    sourceSegmentActive: {
      borderColor: C.tertiary,
      backgroundColor: C.secondaryContainer,
    },
    sourceSegmentText: {
      ...Type.labelCaps,
      color: C.secondary,
      fontSize: 10,
    },
    sourceSegmentTextActive: {
      color: C.tertiary,
    },
    detectorChip: {
      minHeight: 28,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.error,
      backgroundColor: C.surfaceContainerLowest,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: 8,
    },
    detectorChipOk: {
      borderColor: C.tertiary,
      backgroundColor: C.secondaryContainer,
    },
    detectorChipText: {
      ...Type.labelCaps,
      color: C.error,
      fontSize: 8,
    },
    detectorChipTextOk: {
      color: C.tertiary,
    },
    detectorProgress: {
      ...Type.timelineMeta,
      color: C.text,
      fontSize: 11,
    },
    detectorHint: {
      ...Type.body,
      color: C.secondary,
      fontSize: 10,
    },
    detectorTune: {
      minHeight: 30,
      alignSelf: 'flex-start' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: 8,
    },
    detectorTuneText: {
      ...Type.labelCaps,
      color: C.primary,
      fontSize: 9,
    },
    timerRow: {
      flexDirection: 'row' as const,
      gap: 8,
    },
    timerTile: {
      flex: 1,
      minWidth: 0,
      minHeight: 80,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 9,
      paddingVertical: 8,
      justifyContent: 'space-between' as const,
    },
    timerTileActive: {
      borderColor: C.tertiary,
      backgroundColor: C.secondaryContainer,
    },
    timerTileReady: {
      borderColor: C.primary,
    },
    timerTitleRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 5,
    },
    timerDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: C.ghostBorder,
    },
    timerDotActive: {
      backgroundColor: C.tertiary,
    },
    timerDotReady: {
      backgroundColor: C.primary,
    },
    timerLabel: {
      ...Type.labelCaps,
      color: C.secondary,
      fontSize: 9,
    },
    timerValue: {
      ...Type.timelineMeta,
      color: C.text,
      fontSize: 15,
      textAlign: 'center' as const,
    },
    timerValueActive: {
      color: C.tertiary,
    },
    timerValueReady: {
      color: C.primary,
    },
    timerDetail: {
      ...Type.labelCaps,
      color: C.secondary,
      fontSize: 7.5,
      textAlign: 'center' as const,
    },
    readinessRow: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 6,
    },
    readinessChip: {
      minHeight: 24,
      borderRadius: 8,
      paddingHorizontal: 8,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    readinessChipReady: {
      borderColor: C.tertiary,
    },
    readinessChipNeutral: {
      borderColor: C.ghostBorder,
    },
    readinessText: {
      ...Type.labelCaps,
      fontSize: 9,
      color: C.error,
    },
    readinessTextReady: {
      color: C.tertiary,
    },
    readinessTextLive: {
      color: C.tertiary,
    },
    readinessTextNeutral: {
      color: C.secondary,
    },
    error: {
      ...Type.timelineBody,
      color: C.error,
    },
    actions: {
      flexDirection: 'row' as const,
      gap: 10,
    },
    cooldownReset: {
      minHeight: 38,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.warning,
      backgroundColor: C.surfaceContainerHigh,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: 12,
    },
    cooldownResetLabel: {
      ...Type.labelCaps,
      color: C.warning,
    },
    actionButton: {
      flex: 1,
      minHeight: 48,
      minWidth: 0,
      borderRadius: 12,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingHorizontal: 16,
      backgroundColor: C.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: C.ghostBorder,
    },
    actionButtonActive: {
      borderColor: C.tertiary,
      backgroundColor: C.secondaryContainer,
    },
    actionLabel: {
      ...Type.timelineMeta,
      color: C.text,
      textAlign: 'center' as const,
    },
    disclosure: {
      minHeight: 48,
      flex: 1,
      minWidth: 0,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.ghostBorder,
      backgroundColor: C.surfaceContainerHigh,
      paddingHorizontal: 12,
    },
    disclosureLabel: {
      ...Type.timelineMeta,
      color: C.primary,
      textAlign: 'center' as const,
    },
    settings: {
      gap: 8,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: C.ghostBorder,
    },
    settingLabel: {
      ...Type.labelCaps,
      color: C.secondary,
    },
    settingRow: {
      minHeight: 32,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: 12,
      paddingHorizontal: 2,
    },
    settingRowLabel: {
      ...Type.body,
      fontSize: 13,
      color: C.secondary,
    },
    settingRowValue: {
      ...Type.timelineMeta,
      color: C.text,
      textAlign: 'right' as const,
    },
    help: {
      ...Type.body,
      fontSize: 13,
      color: C.secondary,
    },
    disabled: {
      opacity: 0.38,
    },
  };
}
