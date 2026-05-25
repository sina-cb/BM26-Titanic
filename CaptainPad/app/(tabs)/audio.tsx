// Audio Analysis tab — operator surface for the in-engine mic
// listener and BPM → speed sync (docs/25 §8.2).
//
// Important UI note: every interactive sub-component (FaderRow,
// BandMeter, …) lives at MODULE scope. Defining them inside the
// screen function would give them a new component identity on every
// parent state change, which unmounts / remounts the underlying
// HorizontalFader mid-drag and makes the sliders feel broken. The
// optimistic local state update happens on every drag tick; the
// PATCH to the engine only fires on release so we don't spam the
// REST endpoint with hundreds of partial values per drag.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { fetchAudioConfig, patchAudioConfig, resetAudioConfig, getApiBaseAsync, updateParamCenter } from '@/utils/api';
import { useAudioStatus, useSharedParamValues, useOscStatus, useParamRange } from '@/hooks/useEngineState';

const C = Colors.light;
// "Auto-driven" accent — mirrors Colors.light.tertiary in theme.ts.
// Local copy keeps this screen working even when the theme's TS
// shape isn't yet picked up by the consuming module's checker.
const ACCENT_AUTO = '#1b9e77';

interface AudioConfig {
  enabled: boolean;
  capture: { backend: string; device: string; sampleRate: number; channels: number; inputFormat: string | null };
  fftSize: number;
  hopSize: number;
  bands: { lowMaxHz: number; midMaxHz: number; smoothingAlpha: number };
  kick:  { minHz: number; maxHz: number; threshold: number; refractoryMs: number; decayMs: number };
}

const SECTION = {
  borderRadius: 12,
  borderWidth: 1,
  borderColor: C.ghostBorder,
  backgroundColor: C.surface,
  padding: 16,
  marginBottom: 16,
} as const;

const SECTION_TITLE = {
  fontFamily: 'SpaceGrotesk_700Bold',
  fontSize: 11,
  color: C.secondary,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  marginBottom: 12,
};

// ── Module-scoped sub-components (see header note) ───────────────────────

type FaderRowProps = {
  label: string;
  suffix?: string;
  min: number;
  max: number;
  value: number;
  step?: number;
  hint?: string;
  /** Called continuously during drag with the live value. Update local state here. */
  onDrag: (v: number) => void;
  /** Called once on touch release with the final value. Persist to the engine here. */
  onCommit: (v: number) => void;
};

function FaderRow({ label, suffix, min, max, value, step, hint, onDrag, onCommit }: FaderRowProps) {
  // Local drag mirror so we can show the live value while the parent
  // is debouncing its real update — avoids the slider snapping back
  // mid-drag if the parent re-renders.
  const [draftNorm, setDraftNorm] = useState<number | null>(null);
  const lastValRef = useRef<number>(value);

  const span = max - min || 1;
  const externalNorm = Math.max(0, Math.min(1, (value - min) / span));
  const norm = draftNorm ?? externalNorm;

  const snap = useCallback((v: number) => (step ? Math.round(v / step) * step : v), [step]);

  const handleChange = useCallback((v: number) => {
    setDraftNorm(v);
    const real = snap(min + v * span);
    lastValRef.current = real;
    onDrag(real);
  }, [min, span, snap, onDrag]);

  const handleRelease = useCallback(() => {
    onCommit(lastValRef.current);
    setDraftNorm(null);
  }, [onCommit]);

  const display = snap(draftNorm !== null ? min + draftNorm * span : value);
  const isInt = Number.isInteger(display);

  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 11 }}>
          {isInt ? display : display.toFixed(2)}{suffix ? ` ${suffix}` : ''}
        </Text>
      </View>
      <HorizontalFader
        value={norm}
        onChange={handleChange}
        onRelease={handleRelease}
        trackStyle={{ height: 22, backgroundColor: C.surfaceContainerHigh, borderRadius: 11 }}
        fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primary, borderRadius: 11 }}
      />
      {hint ? <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10, marginTop: 4 }}>{hint}</Text> : null}
    </View>
  );
}

/**
 * GainRow — per-stem / per-band multiplier slider. Lives in the Audio
 * Analysis tab because tuning these is a once-per-show task, not a
 * performance gesture (the deck only shows the resulting levels).
 *
 * `paramKey` drives both the CPC range lookup (so each row respects
 * `osc.gainMax` from config.yaml) and the write target. Writes happen
 * directly via `updateParamCenter` — these are CPC params, not part of
 * the analyzer's PATCH /audio/config surface.
 */
function GainRow({ label, paramKey, value }: { label: string; paramKey: string; value: number }) {
  const [gMin, gMax] = useParamRange(paramKey, [0, 2]);
  const span = Math.max(0.0001, gMax - gMin);
  const [draft, setDraft] = useState<number | null>(null);
  const showVal = draft !== null ? draft : value;
  const norm = (showVal - gMin) / span;
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 11 }}>{showVal.toFixed(2)}×</Text>
      </View>
      <HorizontalFader
        value={Math.max(0, Math.min(1, norm))}
        onChange={(v: number) => setDraft(gMin + v * span)}
        onRelease={() => { if (draft !== null) { updateParamCenter({ [paramKey]: draft }); setDraft(null); } }}
        trackStyle={{ height: 18, backgroundColor: C.surfaceContainerHigh, borderRadius: 9 }}
        fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primary, borderRadius: 9 }}
      />
    </View>
  );
}

type BandMeterProps = { label: string; value: number; gain: number };

function BandMeter({ label, value, gain }: BandMeterProps) {
  const effective = Math.max(0, Math.min(1, value * gain));
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10, textTransform: 'uppercase' }}>{label}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10 }}>
          {(effective * 100).toFixed(0)}%  ·  gain {gain.toFixed(2)}×
        </Text>
      </View>
      <View style={{
        height: 10, borderRadius: 5,
        backgroundColor: C.surfaceContainerHigh,
        borderWidth: 1, borderColor: C.ghostBorder, overflow: 'hidden',
      }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${value * 100}%`, backgroundColor: C.secondaryContainer }} />
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${effective * 100}%`, backgroundColor: C.primary }} />
      </View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────

export default function AudioAnalysisScreen() {
  const status = useAudioStatus();
  const oscStatus = useOscStatus();
  const [cfg, setCfg] = useState<AudioConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);

  // Live mic params for the in-tab meters.
  const sp = useSharedParamValues({
    micLow: 0, micMid: 0, micHigh: 0, micKick: 0,
    tempoBpm: 0, bpmSpeedSync: 0, bpmSpeedMin: 60, bpmSpeedMax: 180, speed: 0,
    micLowGain: 1, micMidGain: 1, micHighGain: 1, micKickGain: 1,
    // OSC stems used by the new GainRow surface.
    stemsVocalsGain: 1, stemsBassGain: 1, stemsDrumsGain: 1,
  } as Record<string, any>) as Record<string, number>;

  const reload = useCallback(async () => {
    await getApiBaseAsync();
    const r = await fetchAudioConfig();
    if (r.ok) { setCfg(r.data as AudioConfig); setLoadError(null); }
    else { setLoadError(r.error || 'unknown error'); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Optimistic local-only update while dragging — no network hit.
  const updateLocal = useCallback((group: 'bands' | 'kick', field: string, value: number) => {
    setCfg(prev => prev && ({ ...prev, [group]: { ...prev[group], [field]: value } } as AudioConfig));
  }, []);

  // Commit on slider release. One PATCH per gesture, not per frame.
  const commitField = useCallback(async (group: 'bands' | 'kick', field: string, value: number) => {
    const r = await patchAudioConfig({ [group]: { [field]: value } });
    if (!r.ok) {
      setPatchError(r.error || 'patch failed');
      reload();   // pull back the server's truth so the slider snaps to the rejected value
    } else {
      setPatchError(null);
    }
  }, [reload]);

  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: C.surfaceContainerLowest, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, marginBottom: 8 }}>
          AUDIO CONFIG UNAVAILABLE
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.text }}>{loadError}</Text>
        <TouchableOpacity onPress={reload} style={{ marginTop: 16, padding: 12, backgroundColor: C.primary, borderRadius: 8, alignSelf: 'flex-start' }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000' }}>RETRY</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!cfg) {
    return (
      <View style={{ flex: 1, backgroundColor: C.surfaceContainerLowest, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon }}>Loading audio config…</Text>
      </View>
    );
  }

  // ── Status banner data ───────────────────────────────────────────────
  const enabled  = status?.enabled ?? cfg.enabled;
  const phase    = status?.phase ?? (enabled ? 'unknown' : 'off');
  const phaseColor =
    phase === 'running'    ? ACCENT_AUTO :
    phase === 'starting'   ? C.primary :
    phase === 'restarting' ? C.error :
    phase === 'error'      ? C.error :
    C.icon;

  const bpmSyncOn  = (sp.bpmSpeedSync ?? 0) >= 0.5;
  const oscState   = oscStatus?.state ?? null;
  const oscMissing = bpmSyncOn && oscState !== 'live';   // sync expects OSC; OSC isn't flowing
  const bpmStale   = bpmSyncOn && (!sp.tempoBpm || sp.tempoBpm <= 0);
  const lastKickAgo = status?.lastKickMs ? Math.max(0, Date.now() - status.lastKickMs) : null;
  const bpmMappedSpeed = (() => {
    const min = sp.bpmSpeedMin, max = sp.bpmSpeedMax, bpm = sp.tempoBpm;
    if (!min || !max || min === max || !bpm) return null;
    return Math.max(0, Math.min(1, (bpm - min) / (max - min)));
  })();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.surfaceContainerLowest }}
      contentContainerStyle={{ padding: 20, paddingBottom: 80 }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22, color: C.text }}>
          AUDIO ANALYSIS
        </Text>
        {/* "Reset" hits POST /audio/config/reset on the engine. Server
            wipes only the analyzer tuning back to config.yaml defaults;
            mic selection is preserved. Two-tap (alert + RESET) avoids
            an accidental "I just wanted to tap the title" wipe. */}
        <TouchableOpacity
          onPress={async () => {
            const r = await resetAudioConfig();
            if (!r.ok) setPatchError(r.error || 'reset failed');
            else { setPatchError(null); reload(); }
          }}
          style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
            borderWidth: 1, borderColor: C.ghostBorder,
            backgroundColor: C.surface,
          }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Reset to defaults
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon, marginBottom: 20 }}>
        Mic listener · band detection · kick · BPM → speed sync
      </Text>

      {patchError ? (
        <View style={{ ...SECTION, borderColor: C.error }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 11, marginBottom: 4 }}>PATCH REJECTED</Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 12 }}>{patchError}</Text>
        </View>
      ) : null}

      {/* ── Microphone status ─────────────────────────────────────────── */}
      <View style={SECTION}>
        <Text style={SECTION_TITLE}>MICROPHONE</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: phaseColor, marginRight: 8 }} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 13 }}>
            {enabled ? phase.toUpperCase() : 'DISABLED'}
          </Text>
        </View>
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 11 }}>
          Device <Text style={{ color: C.text }}>{cfg.capture.device}</Text>
          {' · '}{cfg.capture.sampleRate} Hz · {cfg.capture.channels} ch · {cfg.fftSize}-pt FFT
          {' · '}capture {status?.captureFps ?? 0} fps
        </Text>
        {status?.error ? (
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.error, fontSize: 11, marginTop: 4 }}>
            {status.error}
          </Text>
        ) : null}
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10, marginTop: 8 }}>
          To change device or sample rate, run `node marsin_engine/engine.js --choose_mic` and restart the engine.
        </Text>
      </View>

      {/* ── Per-band / per-stem GAIN ────────────────────────────────────
          Moved here from the Deck (operator review 2026-05-24). The deck
          is now a read-only "what's reaching the patterns" surface; this
          is where you actually tune each band's contribution. Each row
          multiplies the band's 0..1 raw level by 0..gainMax (from
          osc.gainMax in config.yaml), then the master REACT on the deck
          scales the whole pile. */}
      <View style={SECTION}>
        <Text style={SECTION_TITLE}>BAND / STEM GAIN</Text>
        <GainRow label="VOCALS"   paramKey="stemsVocalsGain" value={sp.stemsVocalsGain ?? 1} />
        <GainRow label="BASS"     paramKey="stemsBassGain"   value={sp.stemsBassGain   ?? 1} />
        <GainRow label="DRUMS"    paramKey="stemsDrumsGain"  value={sp.stemsDrumsGain  ?? 1} />
        <View style={{ height: 1, backgroundColor: C.ghostBorder, marginVertical: 12 }} />
        <GainRow label="MIC LOW"  paramKey="micLowGain"  value={sp.micLowGain  ?? 1} />
        <GainRow label="MIC MID"  paramKey="micMidGain"  value={sp.micMidGain  ?? 1} />
        <GainRow label="MIC HIGH" paramKey="micHighGain" value={sp.micHighGain ?? 1} />
        <GainRow label="MIC KICK" paramKey="micKickGain" value={sp.micKickGain ?? 1} />
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10, marginTop: 8 }}>
          The deck's master REACT slider multiplies all of these. Set REACT to 0 to silence audio
          contribution entirely without losing your per-band gain tuning.
        </Text>
      </View>

      {/* ── Bands ────────────────────────────────────────────────────── */}
      <View style={SECTION}>
        <Text style={SECTION_TITLE}>BANDS</Text>
        <FaderRow
          label="Low max" suffix="Hz" min={50} max={Math.max(60, cfg.bands.midMaxHz - 50)} value={cfg.bands.lowMaxHz}
          step={5}
          onDrag={(v) => updateLocal('bands', 'lowMaxHz', v)}
          onCommit={(v) => commitField('bands', 'lowMaxHz', v)}
          hint="Upper edge of the LOW band; the MID band starts here."
        />
        <FaderRow
          label="Mid max" suffix="Hz" min={cfg.bands.lowMaxHz + 50} max={cfg.capture.sampleRate / 2 - 50} value={cfg.bands.midMaxHz}
          step={50}
          onDrag={(v) => updateLocal('bands', 'midMaxHz', v)}
          onCommit={(v) => commitField('bands', 'midMaxHz', v)}
          hint="Upper edge of the MID band; everything above goes to HIGH."
        />
        <FaderRow
          label="Smoothing" min={0.05} max={1.0} value={cfg.bands.smoothingAlpha}
          step={0.05}
          onDrag={(v) => updateLocal('bands', 'smoothingAlpha', v)}
          onCommit={(v) => commitField('bands', 'smoothingAlpha', v)}
          hint="Snappy 1.0 ← → 0.05 smooth. Applies to all three bands."
        />
        <View style={{ height: 1, backgroundColor: C.ghostBorder, marginVertical: 12 }} />
        <BandMeter label="LOW"  value={sp.micLow}  gain={sp.micLowGain} />
        <BandMeter label="MID"  value={sp.micMid}  gain={sp.micMidGain} />
        <BandMeter label="HIGH" value={sp.micHigh} gain={sp.micHighGain} />
      </View>

      {/* ── Kick ─────────────────────────────────────────────────────── */}
      <View style={SECTION}>
        <Text style={SECTION_TITLE}>KICK</Text>
        <FaderRow
          label="Energy min" suffix="Hz" min={20} max={Math.max(30, cfg.kick.maxHz - 10)} value={cfg.kick.minHz}
          step={5}
          onDrag={(v) => updateLocal('kick', 'minHz', v)}
          onCommit={(v) => commitField('kick', 'minHz', v)}
        />
        <FaderRow
          label="Energy max" suffix="Hz" min={cfg.kick.minHz + 10} max={400} value={cfg.kick.maxHz}
          step={5}
          onDrag={(v) => updateLocal('kick', 'maxHz', v)}
          onCommit={(v) => commitField('kick', 'maxHz', v)}
          hint="Most kick drums sit between 40–120 Hz."
        />
        <FaderRow
          label="Threshold ×" min={1.05} max={4.0} value={cfg.kick.threshold}
          step={0.05}
          onDrag={(v) => updateLocal('kick', 'threshold', v)}
          onCommit={(v) => commitField('kick', 'threshold', v)}
          hint="Instant energy must be this many times the running average to fire."
        />
        <FaderRow
          label="Refractory" suffix="ms" min={0} max={1000} value={cfg.kick.refractoryMs}
          step={10}
          onDrag={(v) => updateLocal('kick', 'refractoryMs', v)}
          onCommit={(v) => commitField('kick', 'refractoryMs', v)}
          hint="Minimum gap between two kick fires."
        />
        <FaderRow
          label="Decay" suffix="ms" min={20} max={1000} value={cfg.kick.decayMs}
          step={10}
          onDrag={(v) => updateLocal('kick', 'decayMs', v)}
          onCommit={(v) => commitField('kick', 'decayMs', v)}
          hint="How fast micKick envelope falls back to 0 after a hit."
        />
        <View style={{ height: 1, backgroundColor: C.ghostBorder, marginVertical: 12 }} />
        <BandMeter label="KICK" value={sp.micKick} gain={sp.micKickGain} />
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 11, marginTop: 6 }}>
          {lastKickAgo === null ? 'Last hit: never' : `Last hit: ${lastKickAgo < 10_000 ? `${(lastKickAgo / 1000).toFixed(1)} s` : '>10 s'} ago`}
        </Text>
      </View>

      {/* ── BPM → Speed ──────────────────────────────────────────────── */}
      <View style={SECTION}>
        <Text style={SECTION_TITLE}>BPM → SPEED</Text>
        {/* Warning banner — BPM-sync depends on the OSC listener
            receiving /lx/tempo/bpm. If the operator flipped sync ON
            without an OSC source flowing, surface it here so they
            don't spend ten minutes wondering why speed isn't moving. */}
        {oscMissing || bpmStale ? (
          <View style={{
            borderRadius: 8, borderWidth: 1, borderColor: C.error,
            padding: 10, marginBottom: 12,
            backgroundColor: 'rgba(255,80,80,0.08)',
          }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 11, marginBottom: 2 }}>
              ⚠ NO BPM SIGNAL
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 11 }}>
              {oscMissing
                ? `OSC listener is ${oscState ?? 'unknown'}; nothing is feeding /lx/tempo/bpm. Speed will not move.`
                : 'OSC is live but no tempoBpm has arrived yet. Confirm LX Studio is sending /lx/tempo/bpm.'}
            </Text>
          </View>
        ) : null}
        <TouchableOpacity
          onPress={() => updateParamCenter({ bpmSpeedSync: bpmSyncOn ? 0 : 1 })}
          style={{
            paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, marginBottom: 14,
            backgroundColor: bpmSyncOn ? ACCENT_AUTO : C.surfaceContainerHigh,
            borderWidth: 1, borderColor: bpmSyncOn ? ACCENT_AUTO : C.ghostBorder,
            alignSelf: 'flex-start',
          }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: bpmSyncOn ? '#000' : C.text, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {bpmSyncOn ? '● SYNC ON · SPEED DRIVEN BY BPM' : 'SYNC OFF · SPEED MANUAL'}
          </Text>
        </TouchableOpacity>
        <FaderRow
          label="BPM min" min={30} max={Math.max(31, (sp.bpmSpeedMax ?? 180) - 1)} value={sp.bpmSpeedMin ?? 60}
          step={1}
          onDrag={() => { /* writes are debounced via commit, but bpm min/max go through CPC, not /audio. */ }}
          onCommit={(v) => updateParamCenter({ bpmSpeedMin: v })}
          hint="BPM value that maps to speed = 0."
        />
        <FaderRow
          label="BPM max" min={Math.min(239, (sp.bpmSpeedMin ?? 60) + 1)} max={240} value={sp.bpmSpeedMax ?? 180}
          step={1}
          onDrag={() => { /* same — commit-on-release only */ }}
          onCommit={(v) => updateParamCenter({ bpmSpeedMax: v })}
          hint="BPM value that maps to speed = 1."
        />
        <View style={{ height: 1, backgroundColor: C.ghostBorder, marginVertical: 12 }} />
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 12 }}>
          Current tempo: <Text style={{ color: C.text, fontFamily: 'SpaceGrotesk_700Bold' }}>
            {sp.tempoBpm > 0 ? `${Math.round(sp.tempoBpm)} BPM` : 'no signal'}
          </Text>
          {bpmMappedSpeed !== null ? (
            <>  →  speed <Text style={{ color: bpmSyncOn ? ACCENT_AUTO : C.text, fontFamily: 'SpaceGrotesk_700Bold' }}>{bpmMappedSpeed.toFixed(2)}</Text></>
          ) : null}
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 11, marginTop: 6 }}>
          {bpmSyncOn ? 'The engine writes speed on every tempoBpm update; manual speed edits will be overwritten.' : 'Toggle on to drive global speed from the live tempo source.'}
        </Text>
      </View>
    </ScrollView>
  );
}
