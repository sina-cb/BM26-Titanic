// AudioChainsCard — docs/29 Phase 5 chain editor.
//
// Renders the SIGNALS · CHAINS section of the AUDIO tab (Wireframe A
// row + Wireframes E/F/G for the expanded editor / empty / error
// states). One collapsed row per signal; tap [edit] to reveal the
// drag-reorderable op list with per-op param sliders + the engine's
// 5 Hz signalChain pre/post preview meters.
//
// Critical invariants:
//   1. NO audio math runs here. Every value the operator sees came
//      from the engine in the most-recent WS frame, and every edit
//      ships to the engine via REST (PATCH for one param, PUT for
//      reorder/add/delete). The engine validates atomically and
//      broadcasts `audioChainsChanged` on success; on 400 we revert
//      the optimistic local state and show the engine's error verbatim
//      (Wireframe G). Codex P0: never swallow.
//   2. WS subscription is gated on `useFocusEffect` — on AUDIO tab
//      blur we send `unsubscribeChains` upstream so the engine pays
//      zero cost for the 5 Hz signalChain preview when the operator
//      isn't looking. On reconnect we re-send subscribeChains.
//   3. Catalog is fetched once per session and cached at module scope
//      — the 7 op schemas don't change without an engine restart.
//   4. Drag-to-reorder uses a custom PanResponder (no new native
//      dep). The handle (`⠿`) claims the responder before the
//      enclosing ScrollView; on drop we PUT the reordered chain and
//      revert on rejection.
//
// Performance: every signal's chain (1 to N ops) re-renders ONLY
// when (a) its own signalChain frame arrives (sliced via
// `engineSignalsEvents.subscribe` per-signal) or (b) its config
// changes via `audioChainsChanged`. The collapsed-row body for
// signals the operator hasn't expanded skips slider work entirely.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Modal, Pressable,
  PanResponder, LayoutChangeEvent, GestureResponderEvent,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Colors } from '@/constants/theme';
import { globalStyles } from '@/styles/globalStyles';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { engineEvents, type EngineMessage } from '@/utils/engineEvents';
import { engineSignalsEvents } from '@/utils/engineSignalsEvents';
import {
  fetchAudioChains, fetchAudioChainsCatalog,
  putAudioChain, patchAudioChainOp,
  resetAudioChainSignal, getApiBaseAsync,
  updateParamCenter,
  type AudioChainOp, type AudioChainsMap, type AudioChainCatalog,
} from '@/utils/api';
import { useSharedParamValues, useParamRange } from '@/hooks/useEngineState';

const C = Colors.light;

// docs/29 §Chain config — engine ships these 7 signal keys; iPad mirrors
// the order so the operator's mental model (mic first, then stems)
// matches Wireframe A.
const SIGNAL_ORDER: readonly { key: string; label: string }[] = [
  { key: 'micLow',      label: 'MIC LOW' },
  { key: 'micMid',      label: 'MIC MID' },
  { key: 'micHigh',     label: 'MIC HIGH' },
  { key: 'micKick',     label: 'MIC KICK' },
  { key: 'stemsBass',   label: 'STEMS BASS' },
  { key: 'stemsDrums',  label: 'STEMS DRUMS' },
  { key: 'stemsVocals', label: 'STEMS VOCALS' },
];

// Op order in the picker matches docs/29 §Operator catalog reading
// order (Math → Curve/Shape → Filter → Dynamics → Derivative → Trigger
// → Hold). Phase 7 added curve/slew/compressor/biquad/slope; we slot
// them into the order so the operator-facing picker stays grouped by
// function rather than by patch number.
const OP_PICKER_ORDER: readonly string[] = [
  'gain', 'bias', 'clamp',
  'curve',
  'lpf', 'biquad', 'slew',
  'compressor',
  'envelope', 'slope',
  'schmitt', 'hold',
];

// Set of op types this build knows how to render in OpParams (used by
// the "schema missing" guard — see OpParams). Keep in sync with the
// switch cases below; if you add an op renderer, add its type here too.
const KNOWN_RENDERER_TYPES: ReadonlySet<string> = new Set<string>([
  'gain', 'bias', 'clamp', 'lpf', 'envelope', 'schmitt', 'hold',
  'curve', 'slew', 'compressor', 'biquad', 'slope',
]);

// Module-scope catalog cache. Lifecycle: fetched lazily on the first
// AudioChainsCard mount per app session, kept until the app is killed
// (the op schemas don't change without an engine restart, and a stale
// cache would surface as a 400 from the engine on PUT — operator-visible,
// fail-loudly).
//
// Failure handling (docs/29 §Interactions + codex P0 fail-loudly):
// if the first fetch fails (engine offline at first mount), neither
// the cache nor an in-flight promise sticks around — `loadCatalog()`
// is callable again to drive a retry. The outer card holds the
// last-seen error in React state and surfaces it on the disabled
// `[+ ADD OP]` button so the operator has a tap-to-retry path
// without restarting the app.
type CatalogLoadResult = { ok: true; catalog: AudioChainCatalog } | { ok: false; error: string };

let _catalogCache: AudioChainCatalog | null = null;
let _catalogInflight: Promise<CatalogLoadResult> | null = null;
function loadCatalog(): Promise<CatalogLoadResult> {
  if (_catalogCache) return Promise.resolve({ ok: true, catalog: _catalogCache });
  if (_catalogInflight) return _catalogInflight;
  _catalogInflight = (async (): Promise<CatalogLoadResult> => {
    const r = await fetchAudioChainsCatalog();
    if (r.ok && r.data) {
      _catalogCache = r.data;
      return { ok: true, catalog: r.data };
    }
    return { ok: false, error: r.error || 'failed to load op catalog' };
  })().finally(() => { _catalogInflight = null; });
  return _catalogInflight;
}

// ── Card frame ─────────────────────────────────────────────────────────────

const CARD = {
  ...globalStyles.card,
  padding: 20,
  marginBottom: 20,
  alignSelf: 'stretch' as const,
  ...globalStyles.ambientShadow,
};

// ── Param ranges that drive the per-op sliders ────────────────────────────
//
// Catalog reports min/max for every numeric param; we use them as the
// operator-facing slider range. For LPF cutoffHz the catalog reports
// [0.01, 1000] which is impractically wide for a horizontal slider —
// the operator's useful range is 0.1..50 Hz per docs/29 §Operator
// catalog. We cap UI-only without changing the catalog so the engine
// still accepts the full range via PATCH if the operator ever wants it.
const UI_SLIDER_CAPS: Record<string, Record<string, [number, number]>> = {
  lpf:      { cutoffHz:  [0.1, 50]  },
  envelope: { attackMs:  [1, 2000], releaseMs: [1, 2000] },
  hold:     { timeoutMs: [0, 5000], decayMs:   [1, 5000] },
  schmitt:  { refractoryMs: [0, 2000] },
  // Phase 7: UI-cap the operator-useful slice of the catalog ranges
  // (engine accepts the full range via PATCH if needed). Precedent: lpf
  // cutoffHz is [0.01,1000] in catalog but [0.1,50] here.
  curve:      { gamma:         [0.1, 10]   },
  slew:       { maxStepPerSec: [0.1, 50]   },
  biquad:     { cutoffHz:      [0.5, 30],   Q:         [0.1, 5]    },
  slope:      { scale:         [0.1, 50]   },
  compressor: { ratio:         [1, 20],     attackMs:  [1, 2000], releaseMs: [1, 2000] },
};

function uiRange(opType: string, paramKey: string, fallback: [number, number]): [number, number] {
  const cap = UI_SLIDER_CAPS[opType]?.[paramKey];
  return cap ?? fallback;
}

// Per-op label string for the catalog picker + compact preview row.
function opLabel(type: string): string {
  switch (type) {
    case 'gain':       return 'Gain';
    case 'bias':       return 'Bias';
    case 'clamp':      return 'Clamp';
    case 'lpf':        return 'LPF';
    case 'envelope':   return 'Envelope';
    case 'schmitt':    return 'Schmitt';
    case 'hold':       return 'Hold';
    // Phase 7
    case 'curve':      return 'Curve';
    case 'slew':       return 'Slew';
    case 'compressor': return 'Compressor';
    case 'biquad':     return 'Biquad LPF';
    case 'slope':      return 'Slope';
    default:           return type;
  }
}

// Compact one-line summary of an op for the COLLAPSED row (Wireframe A
// row text: `raw → [Gain 1.20×] [LPF 5Hz] [Compressor] → CPC`). For
// the live param-bound Gain we render the paramKey name (more
// useful at a glance than a stale numeric).
function opSummary(op: AudioChainOp): string {
  const name = opLabel(op.type);
  if (!op.enabled) return `${name} (off)`;
  switch (op.type) {
    case 'gain': {
      const pk = op.params.paramKey;
      if (typeof pk === 'string' && pk.length > 0) return `${name} ${pk}`;
      const v = typeof op.params.value === 'number' ? op.params.value : 1;
      return `${name} ${v.toFixed(2)}×`;
    }
    case 'bias': {
      const v = typeof op.params.value === 'number' ? op.params.value : 0;
      const sign = v >= 0 ? '+' : '';
      return `${name} ${sign}${v.toFixed(2)}`;
    }
    case 'clamp': {
      const lo = typeof op.params.min === 'number' ? op.params.min : 0;
      const hi = typeof op.params.max === 'number' ? op.params.max : 1;
      return `${name} ${lo.toFixed(2)}..${hi.toFixed(2)}`;
    }
    case 'lpf': {
      const fc = typeof op.params.cutoffHz === 'number' ? op.params.cutoffHz : 5;
      return `${name} ${fc.toFixed(1)}Hz`;
    }
    case 'envelope': {
      const a = typeof op.params.attackMs === 'number' ? op.params.attackMs : 8;
      const r = typeof op.params.releaseMs === 'number' ? op.params.releaseMs : 180;
      return `${name} ${Math.round(a)}/${Math.round(r)}ms`;
    }
    case 'schmitt': {
      const tH = typeof op.params.tHigh === 'number' ? op.params.tHigh : 0.5;
      const tL = typeof op.params.tLow === 'number' ? op.params.tLow : 0.3;
      return `${name} ${tH.toFixed(2)}/${tL.toFixed(2)}`;
    }
    case 'hold': {
      const t = typeof op.params.timeoutMs === 'number' ? op.params.timeoutMs : 500;
      return `${name} ${Math.round(t)}ms`;
    }
    // Phase 7 ops — one-line compact summary for the collapsed row.
    case 'curve': {
      const shape = typeof op.params.shape === 'string' ? op.params.shape : 'linear';
      if (shape === 'exp') {
        const g = typeof op.params.gamma === 'number' ? op.params.gamma : 2;
        return `${name} ${shape} γ${g.toFixed(1)}`;
      }
      return `${name} ${shape}`;
    }
    case 'slew': {
      const r = typeof op.params.maxStepPerSec === 'number' ? op.params.maxStepPerSec : 4;
      return `${name} ${r.toFixed(1)}/s`;
    }
    case 'compressor': {
      const th = typeof op.params.threshold === 'number' ? op.params.threshold : 0.5;
      const ra = typeof op.params.ratio === 'number' ? op.params.ratio : 4;
      return `${name} ${th.toFixed(2)}@${ra.toFixed(1)}:1`;
    }
    case 'biquad': {
      const fc = typeof op.params.cutoffHz === 'number' ? op.params.cutoffHz : 8;
      const q = typeof op.params.Q === 'number' ? op.params.Q : 0.707;
      return `${name} ${fc.toFixed(1)}Hz Q${q.toFixed(2)}`;
    }
    case 'slope': {
      const s = typeof op.params.scale === 'number' ? op.params.scale : 4;
      const bi = op.params.bipolar === true ? ' bi' : '';
      return `${name} /${s.toFixed(1)}${bi}`;
    }
    default:
      return name;
  }
}

// ── Per-signal pre/post preview store ─────────────────────────────────────
//
// engineSignalsEvents fires liveParams + signalChain on /ws/signals. We
// subscribe ONCE at module scope and bucket signalChain frames per
// signalKey so each SignalChainRow can subscribe to ONLY its own
// signal's preview frames (per-signal short-circuit, avoids the
// re-render storm if all 7 rows re-rendered on every 5 Hz tick).

type SignalChainFrame = {
  signalKey: string;
  ops: { id: string; type: string; enabled: boolean; pre: number; post: number; firing?: boolean }[];
};

const _signalChainCache: Record<string, SignalChainFrame> = {};
const _signalChainListeners: Map<string, Set<(f: SignalChainFrame) => void>> = new Map();
let _signalsSubscribed = false;

function _ensureSignalsSubscribed() {
  if (_signalsSubscribed) return;
  _signalsSubscribed = true;
  engineSignalsEvents.subscribe((msg: EngineMessage) => {
    if (msg.type !== 'signalChain') return;
    const frame = msg as unknown as SignalChainFrame;
    if (!frame.signalKey || !Array.isArray(frame.ops)) return;
    _signalChainCache[frame.signalKey] = frame;
    const set = _signalChainListeners.get(frame.signalKey);
    if (!set) return;
    set.forEach((cb) => { try { cb(frame); } catch { /* swallow */ } });
  });
}

function useSignalChainFrame(signalKey: string): SignalChainFrame | null {
  const [frame, setFrame] = useState<SignalChainFrame | null>(() => _signalChainCache[signalKey] ?? null);
  useEffect(() => {
    _ensureSignalsSubscribed();
    let set = _signalChainListeners.get(signalKey);
    if (!set) {
      set = new Set();
      _signalChainListeners.set(signalKey, set);
    }
    set.add(setFrame);
    // Resync on mount — handles the race between mount and the next 5 Hz tick.
    const cached = _signalChainCache[signalKey];
    if (cached) setFrame(cached);
    return () => {
      const s = _signalChainListeners.get(signalKey);
      if (s) s.delete(setFrame);
    };
  }, [signalKey]);
  return frame;
}

// ── Pre/post mini-meter (display-only) ────────────────────────────────────

function MiniMeter({ label, value, color, firing }: {
  label: string; value: number; color: string; firing?: boolean;
}) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: C.secondary, letterSpacing: 0.6,
        }}>{label}</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: firing ? C.error : C.text,
        }}>{firing ? '● FIRING' : v.toFixed(2)}</Text>
      </View>
      <View style={{
        height: 6, borderRadius: 3,
        backgroundColor: C.surfaceContainerLowest,
        borderWidth: 1, borderColor: C.ghostBorder,
        overflow: 'hidden',
      }}>
        <View style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${v * 100}%`, backgroundColor: color,
        }} />
      </View>
    </View>
  );
}

// ── Single-param slider for op editing ────────────────────────────────────
//
// Wraps HorizontalFader with a label + value readout and converts
// 0..1 fader output to the param's real range. Throttles drag emits
// at ~30 Hz; on release, fires `onCommit` (one PATCH per gesture).

function OpParamSlider({
  label, suffix, min, max, value, step, onDrag, onCommit, integer = false,
}: {
  label: string; suffix?: string;
  min: number; max: number; value: number;
  step?: number; integer?: boolean;
  onDrag: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const [draftNorm, setDraftNorm] = useState<number | null>(null);
  const lastValRef = useRef<number>(value);
  const span = Math.max(0.0001, max - min);
  const externalNorm = Math.max(0, Math.min(1, (value - min) / span));
  const norm = draftNorm ?? externalNorm;

  const snap = useCallback((v: number) => {
    if (integer) return Math.round(v);
    if (step) return Math.round(v / step) * step;
    return v;
  }, [step, integer]);

  const handleChange = useCallback((nv: number) => {
    setDraftNorm(nv);
    const real = snap(min + nv * span);
    lastValRef.current = real;
    onDrag(real);
  }, [min, span, snap, onDrag]);

  const handleRelease = useCallback(() => {
    onCommit(lastValRef.current);
    setDraftNorm(null);
  }, [onCommit]);

  const display = snap(draftNorm !== null ? min + draftNorm * span : value);
  const showInt = integer || (step && Number.isInteger(step) && step >= 1);

  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}>{label}</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 10,
        }}>
          {showInt ? Math.round(display) : display.toFixed(2)}{suffix ? ` ${suffix}` : ''}
        </Text>
      </View>
      <HorizontalFader
        value={norm}
        onChange={handleChange}
        onRelease={handleRelease}
        trackStyle={{ height: 16, backgroundColor: C.surfaceContainerHigh, borderRadius: 8 }}
        fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primary, borderRadius: 8 }}
      />
    </View>
  );
}

// ── paramKey-bound Gain slider ────────────────────────────────────────────
//
// A `gain` op configured with `paramKey: "micLowGain"` (etc.) reads its
// multiplier from the shared CPC paramCenter live each frame on the
// engine. Pre-Phase 5 the operator drove that key from MIC LIVE /
// STEMS LIVE cards; pre-Phase 6 the same key was driven from the
// GainRow helper inside the AUDIO tab settings. Both were retired in
// favor of editing the value here on the chain row itself.
//
// Without this component the row would show only the hint string and
// the operator would have NO surface to change per-band/per-stem gain
// from the iPad — a regression. We restore the original GainRow
// pattern: 33 ms throttled live-drag writes via `updateParamCenter`
// (so the post signal responds visually as the operator drags) and a
// release-time flush of any pending throttled value. Range comes from
// the engine's paramSchema via `useParamRange` (falls back to [0, 2]
// per the pre-Phase 5 convention).
function ParamKeyGainRow({ paramKey }: { paramKey: string }) {
  const [gMin, gMax] = useParamRange(paramKey, [0, 2]);
  const span = Math.max(0.0001, gMax - gMin);
  const live = useSharedParamValues(useMemo(() => ({ [paramKey]: 1 }), [paramKey])) as Record<string, number>;
  const liveVal = typeof live[paramKey] === 'number' ? live[paramKey] : 1;
  const [draft, setDraft] = useState<number | null>(null);
  const showVal = draft !== null ? draft : liveVal;
  const norm = (showVal - gMin) / span;

  // Throttled live-drag writer. The operator expects the POST trace to
  // respond as they drag — release-only writes feel broken. 33 ms ≈
  // 30 Hz, comfortably under the engine's analyser hop rate. Identical
  // to the retired GainRow helper that used to live in audio.tsx.
  const lastSentAt = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const sendNow = useCallback((v: number) => {
    lastSentAt.current = Date.now();
    pendingRef.current = null;
    updateParamCenter({ [paramKey]: v });
  }, [paramKey]);
  const sendThrottled = useCallback((v: number) => {
    const now = Date.now();
    if (now - lastSentAt.current >= 33) {
      sendNow(v);
    } else {
      pendingRef.current = v;
    }
  }, [sendNow]);

  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}>value</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 10,
        }}>{showVal.toFixed(2)}×</Text>
      </View>
      <HorizontalFader
        value={Math.max(0, Math.min(1, norm))}
        onChange={(v: number) => {
          const real = gMin + v * span;
          setDraft(real);
          sendThrottled(real);
        }}
        onRelease={() => {
          // Flush any throttled-suppressed final value, then clear
          // draft so the slider snaps back to engine-confirmed value.
          const final = pendingRef.current ?? draft;
          if (final !== null) sendNow(final);
          setDraft(null);
        }}
        trackStyle={{ height: 16, backgroundColor: C.surfaceContainerHigh, borderRadius: 8 }}
        fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primary, borderRadius: 8 }}
      />
      <Text style={{
        fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
        marginTop: 2,
      }}>
        Driven live from CPC key: {paramKey}. Shared with the CPC controls
        elsewhere in the app.
      </Text>
    </View>
  );
}

// ── Pill picker (segmented control for `oneOf` params) ───────────────────
//
// Used by Phase 7 `curve.shape` (linear / easeIn / easeOut / exp). Each
// pill is a TouchableOpacity chip — no new native dep. Selection fires
// onPick(value); the parent translates that into onPatchParam({ shape }).
//
// One-tap commit (no drag), so we PATCH directly on tap rather than the
// draft/release split used by sliders.

function PillPicker({
  label, options, value, onPick,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}>{label}</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 10,
        }}>{value}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {options.map((opt) => {
          const active = opt === value;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => { if (!active) onPick(opt); }}
              style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
                backgroundColor: active ? C.primary : C.surfaceContainerHigh,
                borderWidth: 1, borderColor: active ? C.primary : C.ghostBorder,
              }}
            >
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                color: active ? '#fff' : C.secondary,
                fontSize: 10, letterSpacing: 0.6,
              }}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── Boolean toggle ────────────────────────────────────────────────────────
//
// Used by Phase 7 `slope.bipolar`. Two chips (off / on) instead of a
// platform Switch so the visual rhythm matches the rest of the param
// rows (chips already used by PillPicker above). Tap to commit.

function BooleanToggle({
  label, value, onLabel = 'on', offLabel = 'off', hint, onPick,
}: {
  label: string;
  value: boolean;
  onLabel?: string;
  offLabel?: string;
  hint?: string;
  onPick: (v: boolean) => void;
}) {
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: 0.6,
        }}>{label}</Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 10,
        }}>{value ? onLabel : offLabel}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[false, true].map((b) => {
          const active = b === value;
          return (
            <TouchableOpacity
              key={String(b)}
              onPress={() => { if (!active) onPick(b); }}
              style={{
                flex: 1,
                paddingVertical: 6, borderRadius: 6,
                alignItems: 'center',
                backgroundColor: active ? C.primary : C.surfaceContainerHigh,
                borderWidth: 1, borderColor: active ? C.primary : C.ghostBorder,
              }}
            >
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                color: active ? '#fff' : C.secondary,
                fontSize: 10, letterSpacing: 0.6,
              }}>{b ? onLabel : offLabel}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {hint ? (
        <Text style={{
          fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
          marginTop: 2,
        }}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ── Per-op editor body ────────────────────────────────────────────────────

function OpParams({
  op, opIndex, otherOps, catalog,
  onPatchParam,
}: {
  op: AudioChainOp;
  opIndex: number;
  otherOps: AudioChainOp[];
  // Catalog reference is required by Codex P0 fail-loudly: each renderer
  // checks that the engine schema for op.type actually exists before
  // rendering controls — if it's missing (catalog stale vs. an engine
  // that just shipped a new op type), the panel renders a visible
  // "schema missing" pill instead of an empty/silent body.
  catalog: AudioChainCatalog | null;
  onPatchParam: (paramPatch: Record<string, number | string | boolean>) => void;
}) {
  // docs/29 §Interactions + Codex P0: when catalog is loaded but doesn't
  // describe this op type, surface the gap to the operator. The picker
  // wouldn't have OFFERED an unknown op, so this only fires if the engine
  // returns one (newer engine vs. older iPad) — render the "schema missing"
  // pill so the operator knows to update the app rather than seeing a
  // blank panel.
  const schemaEntry = catalog?.[op.type];
  if (catalog && !schemaEntry && !KNOWN_RENDERER_TYPES.has(op.type)) {
    return (
      <View style={{
        padding: 8, borderRadius: 6,
        backgroundColor: 'rgba(186, 26, 26, 0.06)',
        borderWidth: 1, borderColor: C.error,
      }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4,
        }}>SCHEMA MISSING</Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 11 }}>
          No catalog entry for op type &quot;{op.type}&quot;. Engine ahead of CaptainPad — update the app to edit this op. Params: {JSON.stringify(op.params)}
        </Text>
      </View>
    );
  }
  // Render the 7 op types' param controls. Each control commits one
  // PATCH per gesture (onCommit). The engine's validateChain rejects
  // out-of-range / cross-param violations atomically; we revert at
  // the parent (SignalChainEditor) on a 400.
  switch (op.type) {
    case 'gain': {
      const usesParamKey = typeof op.params.paramKey === 'string';
      if (usesParamKey) {
        // paramKey-bound gain: value lives in shared CPC paramCenter.
        // The slider writes through `updateParamCenter` instead of a
        // PATCH on this op (the op itself has no static value — it
        // reads paramCenter.get(paramKey) live each engine frame).
        return <ParamKeyGainRow paramKey={String(op.params.paramKey)} />;
      }
      const v = typeof op.params.value === 'number' ? op.params.value : 1;
      return (
        <OpParamSlider
          label="value" min={0} max={2} value={v} step={0.01}
          onDrag={() => { /* commit on release */ }}
          onCommit={(nv) => onPatchParam({ value: nv })}
        />
      );
    }
    case 'bias': {
      const v = typeof op.params.value === 'number' ? op.params.value : 0;
      return (
        <OpParamSlider
          label="value" min={-1} max={1} value={v} step={0.01}
          onDrag={() => { /* commit on release */ }}
          onCommit={(nv) => onPatchParam({ value: nv })}
        />
      );
    }
    case 'clamp': {
      const lo = typeof op.params.min === 'number' ? op.params.min : 0;
      const hi = typeof op.params.max === 'number' ? op.params.max : 1;
      // Fixed slider scales [0, 1] on both ends — operator brief
      // 2026-05-27 (4th paired-bound pair, matches kick/bands/BPM fix
      // in ab735b2). Previously min's slider max was derived from hi
      // and max's slider min was derived from lo, so dragging one knob
      // visibly resized the partner's scale and shifted its knob along
      // the track mid-drag. Cross-bound constraint (min < max - 0.01)
      // now clamps at COMMIT only.
      return (
        <>
          <OpParamSlider
            label="min" min={0} max={1} value={lo} step={0.01}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ min: Math.min(nv, hi - 0.01) })}
          />
          <OpParamSlider
            label="max" min={0} max={1} value={hi} step={0.01}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ max: Math.max(nv, lo + 0.01) })}
          />
        </>
      );
    }
    case 'lpf': {
      const fc = typeof op.params.cutoffHz === 'number' ? op.params.cutoffHz : 5;
      const [cmin, cmax] = uiRange('lpf', 'cutoffHz', [0.1, 50]);
      return (
        <OpParamSlider
          label="cutoffHz" suffix="Hz" min={cmin} max={cmax} value={fc} step={0.1}
          onDrag={() => { /* commit on release */ }}
          onCommit={(nv) => onPatchParam({ cutoffHz: nv })}
        />
      );
    }
    case 'envelope': {
      const a = typeof op.params.attackMs === 'number' ? op.params.attackMs : 8;
      const r = typeof op.params.releaseMs === 'number' ? op.params.releaseMs : 180;
      const [amin, amax] = uiRange('envelope', 'attackMs', [1, 2000]);
      const [rmin, rmax] = uiRange('envelope', 'releaseMs', [1, 2000]);
      return (
        <>
          <OpParamSlider
            label="attackMs" suffix="ms" min={amin} max={amax} value={a} step={1} integer
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ attackMs: nv })}
          />
          <OpParamSlider
            label="releaseMs" suffix="ms" min={rmin} max={rmax} value={r} step={1} integer
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ releaseMs: nv })}
          />
        </>
      );
    }
    case 'schmitt': {
      const tH = typeof op.params.tHigh === 'number' ? op.params.tHigh : 0.5;
      const tL = typeof op.params.tLow === 'number' ? op.params.tLow : 0.3;
      const ref = typeof op.params.refractoryMs === 'number' ? op.params.refractoryMs : 0;
      const [rmin, rmax] = uiRange('schmitt', 'refractoryMs', [0, 2000]);
      return (
        <>
          {/* Client-side guard: keep tHigh strictly above tLow so the
              operator never PATCHes the engine into a 400. The engine
              still validates (Codex P0: belt-and-suspenders); we just
              avoid the round-trip. */}
          <OpParamSlider
            label="tHigh" min={0} max={1} value={tH} step={0.01}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ tHigh: Math.max(nv, tL + 0.001) })}
          />
          <OpParamSlider
            label="tLow"  min={0} max={1} value={tL} step={0.01}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ tLow:  Math.min(nv, tH - 0.001) })}
          />
          <OpParamSlider
            label="refractoryMs" suffix="ms" min={rmin} max={rmax} value={ref} step={10} integer
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ refractoryMs: nv })}
          />
        </>
      );
    }
    case 'hold': {
      const t = typeof op.params.timeoutMs === 'number' ? op.params.timeoutMs : 500;
      const d = typeof op.params.decayMs === 'number' ? op.params.decayMs : 200;
      const [tmin, tmax] = uiRange('hold', 'timeoutMs', [0, 5000]);
      const [dmin, dmax] = uiRange('hold', 'decayMs',   [1, 5000]);
      return (
        <>
          <OpParamSlider
            label="timeoutMs" suffix="ms" min={tmin} max={tmax} value={t} step={10} integer
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ timeoutMs: nv })}
          />
          <OpParamSlider
            label="decayMs" suffix="ms" min={dmin} max={dmax} value={d} step={10} integer
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ decayMs: nv })}
          />
        </>
      );
    }
    // ── Phase 7 ops ────────────────────────────────────────────────────
    case 'curve': {
      // Curve: per-sample shape lookup. `shape` is a oneOf enum; `gamma`
      // is only meaningful when shape === 'exp' (engine accepts but
      // ignores gamma for the other shapes — UI hides it so the operator
      // doesn't think they're tuning something inert).
      const SHAPES = ['linear', 'easeIn', 'easeOut', 'exp'] as const;
      const shape = typeof op.params.shape === 'string' && (SHAPES as readonly string[]).includes(op.params.shape)
        ? op.params.shape
        : 'linear';
      const gamma = typeof op.params.gamma === 'number' ? op.params.gamma : 2.0;
      const [gmin, gmax] = uiRange('curve', 'gamma', [0.1, 10]);
      const isExp = shape === 'exp';
      return (
        <>
          <PillPicker
            label="shape" options={SHAPES} value={shape}
            onPick={(nv) => onPatchParam({ shape: nv })}
          />
          {isExp ? (
            <OpParamSlider
              label="gamma" min={gmin} max={gmax} value={gamma} step={0.05}
              onDrag={() => { /* commit on release */ }}
              onCommit={(nv) => onPatchParam({ gamma: nv })}
            />
          ) : (
            <Text style={{
              fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
              marginBottom: 8,
            }}>
              gamma applies to shape=exp only (current: {shape})
            </Text>
          )}
        </>
      );
    }
    case 'slew': {
      const r = typeof op.params.maxStepPerSec === 'number' ? op.params.maxStepPerSec : 4.0;
      const [rmin, rmax] = uiRange('slew', 'maxStepPerSec', [0.1, 50]);
      return (
        <>
          <OpParamSlider
            label="maxStepPerSec" suffix="/s" min={rmin} max={rmax} value={r} step={0.1}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ maxStepPerSec: nv })}
          />
          <Text style={{
            fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
            marginBottom: 4,
          }}>max rate of change per second; lower = smoother</Text>
        </>
      );
    }
    case 'compressor': {
      const th = typeof op.params.threshold === 'number' ? op.params.threshold : 0.5;
      const ra = typeof op.params.ratio === 'number' ? op.params.ratio : 4.0;
      const at = typeof op.params.attackMs === 'number' ? op.params.attackMs : 5;
      const re = typeof op.params.releaseMs === 'number' ? op.params.releaseMs : 80;
      const [rMin, rMax] = uiRange('compressor', 'ratio', [1, 20]);
      const [aMin, aMax] = uiRange('compressor', 'attackMs', [1, 2000]);
      const [reMin, reMax] = uiRange('compressor', 'releaseMs', [1, 2000]);
      return (
        <>
          <OpParamSlider
            label="threshold" min={0.001} max={1} value={th} step={0.01}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ threshold: nv })}
          />
          <Text style={{
            fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
            marginBottom: 4, marginTop: -4,
          }}>level above which compression kicks in</Text>
          <OpParamSlider
            label="ratio" suffix=":1" min={rMin} max={rMax} value={ra} step={0.1}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ ratio: nv })}
          />
          <Text style={{
            fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
            marginBottom: 4, marginTop: -4,
          }}>1 = no compression; higher = stronger gain reduction</Text>
          <OpParamSlider
            label="attackMs" suffix="ms" min={aMin} max={aMax} value={at} step={1} integer
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ attackMs: nv })}
          />
          <Text style={{
            fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
            marginBottom: 4, marginTop: -4,
          }}>how fast compression engages</Text>
          <OpParamSlider
            label="releaseMs" suffix="ms" min={reMin} max={reMax} value={re} step={1} integer
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ releaseMs: nv })}
          />
          <Text style={{
            fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
            marginBottom: 4, marginTop: -4,
          }}>how fast compression releases</Text>
        </>
      );
    }
    case 'biquad': {
      const fc = typeof op.params.cutoffHz === 'number' ? op.params.cutoffHz : 8.0;
      const q  = typeof op.params.Q        === 'number' ? op.params.Q        : 0.707;
      const [cmin, cmax] = uiRange('biquad', 'cutoffHz', [0.5, 30]);
      const [qmin, qmax] = uiRange('biquad', 'Q',        [0.1, 5]);
      return (
        <>
          <OpParamSlider
            label="cutoffHz" suffix="Hz" min={cmin} max={cmax} value={fc} step={0.1}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ cutoffHz: nv })}
          />
          <Text style={{
            fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
            marginBottom: 4, marginTop: -4,
          }}>low-pass corner; everything above is attenuated</Text>
          <OpParamSlider
            label="Q" min={qmin} max={qmax} value={q} step={0.01}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ Q: nv })}
          />
          <Text style={{
            fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
            marginBottom: 4, marginTop: -4,
          }}>resonance: 0.707 = smooth, 2+ = peaky</Text>
        </>
      );
    }
    case 'slope': {
      const s = typeof op.params.scale === 'number' ? op.params.scale : 4.0;
      const bi = op.params.bipolar === true;
      const [smin, smax] = uiRange('slope', 'scale', [0.1, 50]);
      return (
        <>
          <OpParamSlider
            label="scale" min={smin} max={smax} value={s} step={0.1}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ scale: nv })}
          />
          <Text style={{
            fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
            marginBottom: 4, marginTop: -4,
          }}>divides the derivative; larger = less sensitive</Text>
          <BooleanToggle
            label="bipolar" value={bi}
            offLabel="unipolar" onLabel="bipolar"
            hint="unipolar: only rising edges register. bipolar: both rising and falling."
            onPick={(nv) => onPatchParam({ bipolar: nv })}
          />
        </>
      );
    }
    default:
      // Unknown op type from a future engine: render a read-only json
      // dump so the operator sees SOMETHING (vs silently empty). Codex
      // P0: fail visibly — the catalog picker won't OFFER unknown ops,
      // and the schema-missing pill (above the switch) catches the
      // catalog-known-but-no-renderer case, so this only fires for the
      // truly novel "engine ahead of iPad" with no catalog yet.
      return (
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.error, fontSize: 11 }}>
          Unknown op type &quot;{op.type}&quot;. Update CaptainPad to edit. Params: {JSON.stringify(op.params)}
        </Text>
      );
  }
}

// ── Op row ────────────────────────────────────────────────────────────────
//
// One row in the expanded chain editor (Wireframe E). Renders:
//   ⠿ <type> <param-controls>           [✓] [⊖] [↑] [↓]
//   pre: ▓░░ 0.12   post: ▓░░ 0.10
//
// The drag handle (⠿) starts a PanResponder that reports drag
// movement up to the parent SignalChainEditor via callbacks. We
// only claim the responder when the operator pans on the handle
// itself — the rest of the row stays tap-friendly for the toggle /
// delete / arrow buttons.

function OpRow({
  op, opIndex, isFirst, isLast,
  preview, accent, catalog,
  onPatchParam, onToggleEnabled, onRemove, onMove,
  onDragStart, onDragMove, onDragEnd,
  rowHeightRef,
}: {
  op: AudioChainOp;
  opIndex: number;
  isFirst: boolean;
  isLast: boolean;
  preview: { pre: number; post: number; firing?: boolean } | null;
  accent: string;
  catalog: AudioChainCatalog | null;
  onPatchParam: (paramPatch: Record<string, number | string | boolean>) => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onDragStart: (opIndex: number) => void;
  onDragMove: (opIndex: number, dy: number) => void;
  onDragEnd: () => void;
  rowHeightRef: (h: number) => void;
}) {
  // PanResponder bound to the drag handle. Capture-phase so we win
  // against ScrollView's vertical pan. Move callback reports the
  // cumulative dy to the parent, which translates rows of indices.
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => onDragStart(opIndex),
    onPanResponderMove: (_e: GestureResponderEvent, gs) => onDragMove(opIndex, gs.dy),
    onPanResponderRelease: () => onDragEnd(),
    onPanResponderTerminate: () => onDragEnd(),
  }), [opIndex, onDragStart, onDragMove, onDragEnd]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    rowHeightRef(e.nativeEvent.layout.height);
  }, [rowHeightRef]);

  return (
    <View
      onLayout={onLayout}
      style={{
        flexDirection: 'row', alignItems: 'flex-start',
        paddingVertical: 8, paddingHorizontal: 8,
        borderRadius: 8, marginBottom: 6,
        backgroundColor: op.enabled ? C.surfaceContainerLowest : C.surfaceContainerHigh,
        borderWidth: 1, borderColor: C.ghostBorder,
        opacity: op.enabled ? 1 : 0.6,
      }}
    >
      {/* Drag handle — claims gesture responder on touch */}
      <View {...panResponder.panHandlers} style={{
        width: 24, height: 32, alignItems: 'center', justifyContent: 'center',
        marginRight: 4,
      }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 18, color: C.secondary }}>⠿</Text>
      </View>
      {/* Body — name + param controls + pre/post mini-meters */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text,
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}>{opLabel(op.type)}</Text>
          <Text style={{
            fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon, marginLeft: 8,
          }}>{op.id}</Text>
        </View>
        <OpParams
          op={op}
          opIndex={opIndex}
          otherOps={[]}
          catalog={catalog}
          onPatchParam={onPatchParam}
        />
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
          <MiniMeter label="pre"  value={preview?.pre  ?? 0} color={C.secondary} />
          <MiniMeter label="post" value={preview?.post ?? 0} color={accent} firing={preview?.firing} />
        </View>
      </View>
      {/* Row actions — enable toggle, remove, move up/down */}
      <View style={{ flexDirection: 'column', alignItems: 'center', marginLeft: 8, gap: 4 }}>
        <TouchableOpacity onPress={onToggleEnabled} style={iconButtonStyle(op.enabled ? C.primary : C.icon)}>
          <Text style={iconButtonText(op.enabled ? '#fff' : C.text)}>{op.enabled ? '✓' : '○'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onRemove} style={iconButtonStyle(C.error)}>
          <Text style={iconButtonText('#fff')}>⊖</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 2 }}>
          <TouchableOpacity onPress={() => onMove(-1)} disabled={isFirst} style={iconButtonStyle(isFirst ? C.surfaceContainerHigh : C.secondary)}>
            <Text style={iconButtonText(isFirst ? C.icon : '#fff')}>↑</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onMove(1)} disabled={isLast} style={iconButtonStyle(isLast ? C.surfaceContainerHigh : C.secondary)}>
            <Text style={iconButtonText(isLast ? C.icon : '#fff')}>↓</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function iconButtonStyle(bg: string) {
  return {
    width: 26, height: 26, borderRadius: 6,
    backgroundColor: bg,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  };
}
function iconButtonText(color: string) {
  return {
    fontFamily: 'SpaceGrotesk_700Bold' as const,
    fontSize: 12,
    color,
  };
}

// ── Op picker (modal) ─────────────────────────────────────────────────────
//
// Triggered from `[+ ADD OP ▾]`. Lists every op in the catalog with
// its description. Tapping one calls onPick(opType).

function OpPicker({
  visible, onPick, onCancel, catalog, catalogLoading, catalogError, onRetryCatalog,
}: {
  visible: boolean;
  onPick: (opType: string) => void;
  onCancel: () => void;
  catalog: AudioChainCatalog | null;
  catalogLoading: boolean;
  catalogError: string | null;
  onRetryCatalog: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1, justifyContent: 'center', alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.4)', padding: 32,
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            maxWidth: 480, width: '100%',
            backgroundColor: C.surface, borderRadius: 12,
            borderWidth: 1, borderColor: C.ghostBorder,
            padding: 16,
            ...globalStyles.ambientShadow,
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text,
            textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
          }}>+ Add op</Text>
          {/* docs/29 + codex P0 fail-loudly: when the catalog is still
              loading or the fetch failed, render inline status (NOT a
              blank picker). Operator gets clear feedback instead of a
              modal that opens to nothing. */}
          {!catalog && catalogLoading ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <Text style={{
                fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon,
              }}>Loading op catalog…</Text>
            </View>
          ) : null}
          {!catalog && !catalogLoading && catalogError ? (
            <View style={{
              padding: 12, borderRadius: 8, marginBottom: 8,
              backgroundColor: 'rgba(186, 26, 26, 0.06)',
              borderWidth: 1, borderColor: C.error,
            }}>
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.error,
                marginBottom: 4, letterSpacing: 0.6,
              }}>OP CATALOG UNAVAILABLE</Text>
              <Text style={{
                fontFamily: 'Inter_400Regular', fontSize: 11, color: C.text, marginBottom: 8,
              }}>{catalogError}</Text>
              <TouchableOpacity
                onPress={onRetryCatalog}
                style={{
                  paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6,
                  backgroundColor: C.primary, alignSelf: 'flex-start',
                }}
              >
                <Text style={{
                  fontFamily: 'SpaceGrotesk_700Bold', color: '#fff', fontSize: 11,
                  textTransform: 'uppercase', letterSpacing: 0.6,
                }}>RETRY</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {catalog ? (
            <ScrollView style={{ maxHeight: 360 }}>
              {OP_PICKER_ORDER.map((opType) => {
                const entry = catalog?.[opType];
                if (!entry) return null;
                return (
                  <TouchableOpacity
                    key={opType}
                    onPress={() => onPick(opType)}
                    style={{
                      paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6,
                      borderRadius: 8, backgroundColor: C.surfaceContainerLowest,
                      borderWidth: 1, borderColor: C.ghostBorder,
                    }}
                  >
                    <Text style={{
                      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.primary,
                      textTransform: 'uppercase', letterSpacing: 0.8,
                    }}>{opLabel(opType)}</Text>
                    <Text style={{
                      fontFamily: 'Inter_400Regular', fontSize: 11, color: C.text, marginTop: 2,
                    }}>{entry.description}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}
          <TouchableOpacity
            onPress={onCancel}
            style={{
              marginTop: 8, paddingVertical: 10, alignItems: 'center',
              borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
            }}
          >
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 12,
              textTransform: 'uppercase', letterSpacing: 0.8,
            }}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Build a default op from a catalog entry. For Gain we DELIBERATELY
// pick `value: 1.0` (not paramKey) so the operator can layer a
// second Gain on a signal without colliding with the chain's
// default paramKey-driven Gain.
function buildDefaultOpFromCatalog(opType: string, catalog: AudioChainCatalog, existingIds: Set<string>): AudioChainOp {
  const entry = catalog[opType];
  // Phase 7: boolean defaults are now possible (slope.bipolar). String
  // defaults already existed (curve.shape oneOf) — both flow through
  // spec.default unchanged.
  const params: Record<string, number | string | boolean> = {};
  if (entry) {
    for (const [pk, spec] of Object.entries(entry.params)) {
      if (opType === 'gain') {
        if (pk === 'value') params.value = 1.0;
        // skip paramKey — operator can opt in later via PATCH
        continue;
      }
      if (spec.default !== undefined) {
        params[pk] = spec.default;
      }
    }
    // Schmitt: ensure tHigh > tLow even if the catalog defaults are
    // equal (they're not today, but be defensive).
    if (opType === 'schmitt') {
      if (typeof params.tHigh === 'number' && typeof params.tLow === 'number' && !(params.tHigh > params.tLow)) {
        params.tHigh = Math.min(1, (params.tLow as number) + 0.2);
      }
    }
  }
  // Find a unique id like op_<type>_<n>.
  let n = 1;
  let id = `op_${opType}_${n}`;
  while (existingIds.has(id)) {
    n += 1;
    id = `op_${opType}_${n}`;
  }
  return { id, type: opType, enabled: true, params };
}

// ── Per-signal chain editor (expanded body) ───────────────────────────────

function SignalChainEditor({
  signalKey, label, chain, catalog, catalogLoading, catalogError, otherSignals,
  audioConfig, audioConfigError, analyzerHandlers, onRetryAudioConfig,
  onChainUpdated, onError, onRetryCatalog,
}: {
  signalKey: string;
  label: string;
  chain: AudioChainOp[];
  catalog: AudioChainCatalog | null;
  catalogLoading: boolean;
  catalogError: string | null;
  otherSignals: { key: string; label: string; chain: AudioChainOp[] }[];
  audioConfig: AnalyzerConfig | null;
  audioConfigError: string | null;
  analyzerHandlers: AnalyzerHandlers;
  onRetryAudioConfig: () => void;
  onChainUpdated: (next: AudioChainOp[]) => void;
  onError: (msg: string) => void;
  onRetryCatalog: () => void;
}) {
  const frame = useSignalChainFrame(signalKey);
  const previewById = useMemo(() => {
    const out: Record<string, { pre: number; post: number; firing?: boolean }> = {};
    if (frame) {
      for (const o of frame.ops) {
        out[o.id] = { pre: o.pre, post: o.post, firing: o.firing };
      }
    }
    return out;
  }, [frame]);

  const accent = signalKey === 'micKick' ? C.error : '#006875';

  // Local optimistic state — reverts to the prop on engine 400.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  // Drag-reorder state. We snapshot the chain at drag start and
  // translate by floor(dy / rowHeight) to find the target index.
  const rowHeightRef = useRef<number>(80);
  const dragRef = useRef<{ fromIdx: number; previewIdx: number | null }>({ fromIdx: -1, previewIdx: null });
  // Re-render to show preview reorder.
  const [previewOrder, setPreviewOrder] = useState<AudioChainOp[] | null>(null);

  const onDragStart = useCallback((opIndex: number) => {
    dragRef.current = { fromIdx: opIndex, previewIdx: opIndex };
    setPreviewOrder(chain.slice());
  }, [chain]);

  const onDragMove = useCallback((opIndex: number, dy: number) => {
    if (dragRef.current.fromIdx !== opIndex) return;
    const rowH = Math.max(40, rowHeightRef.current);
    const delta = Math.round(dy / rowH);
    const target = Math.max(0, Math.min(chain.length - 1, opIndex + delta));
    if (dragRef.current.previewIdx === target) return;
    dragRef.current.previewIdx = target;
    const next = chain.slice();
    const [moved] = next.splice(opIndex, 1);
    next.splice(target, 0, moved);
    setPreviewOrder(next);
  }, [chain]);

  const onDragEnd = useCallback(async () => {
    const { fromIdx, previewIdx } = dragRef.current;
    dragRef.current = { fromIdx: -1, previewIdx: null };
    if (fromIdx < 0 || previewIdx === null || previewIdx === fromIdx) {
      setPreviewOrder(null);
      return;
    }
    const next = chain.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(previewIdx, 0, moved);
    // Optimistic commit, then PUT
    onChainUpdated(next);
    setPreviewOrder(null);
    const r = await putAudioChain(signalKey, next);
    if (!r.ok) {
      onChainUpdated(chain);
      onError(r.error || 'reorder rejected');
    } else if (r.data) {
      onChainUpdated(r.data);
    }
  }, [chain, signalKey, onChainUpdated, onError]);

  const displayChain = previewOrder ?? chain;

  // ── Per-op handlers ─────────────────────────────────────────────────────

  const handlePatchParam = useCallback(async (opId: string, paramPatch: Record<string, number | string | boolean>) => {
    const idx = chain.findIndex(o => o.id === opId);
    if (idx === -1) return;
    const next = chain.slice();
    next[idx] = { ...next[idx], params: { ...next[idx].params, ...paramPatch } };
    onChainUpdated(next);
    const r = await patchAudioChainOp(signalKey, opId, { params: paramPatch });
    if (!r.ok) {
      onChainUpdated(chain);
      onError(r.error || 'patch rejected');
    } else if (r.data) {
      const conf = chain.slice();
      conf[idx] = r.data;
      onChainUpdated(conf);
    }
  }, [chain, signalKey, onChainUpdated, onError]);

  const handleToggleEnabled = useCallback(async (opId: string) => {
    const idx = chain.findIndex(o => o.id === opId);
    if (idx === -1) return;
    const target = !chain[idx].enabled;
    const next = chain.slice();
    next[idx] = { ...next[idx], enabled: target };
    onChainUpdated(next);
    const r = await patchAudioChainOp(signalKey, opId, { enabled: target });
    if (!r.ok) {
      onChainUpdated(chain);
      onError(r.error || 'toggle rejected');
    } else if (r.data) {
      const conf = chain.slice();
      conf[idx] = r.data;
      onChainUpdated(conf);
    }
  }, [chain, signalKey, onChainUpdated, onError]);

  const handleRemoveOp = useCallback(async (opId: string) => {
    const next = chain.filter(o => o.id !== opId);
    onChainUpdated(next);
    const r = await putAudioChain(signalKey, next);
    if (!r.ok) {
      onChainUpdated(chain);
      onError(r.error || 'remove rejected');
    } else if (r.data) {
      onChainUpdated(r.data);
    }
  }, [chain, signalKey, onChainUpdated, onError]);

  const handleMoveOp = useCallback(async (opId: string, dir: -1 | 1) => {
    const idx = chain.findIndex(o => o.id === opId);
    if (idx === -1) return;
    const target = idx + dir;
    if (target < 0 || target >= chain.length) return;
    const next = chain.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    onChainUpdated(next);
    const r = await putAudioChain(signalKey, next);
    if (!r.ok) {
      onChainUpdated(chain);
      onError(r.error || 'move rejected');
    } else if (r.data) {
      onChainUpdated(r.data);
    }
  }, [chain, signalKey, onChainUpdated, onError]);

  const handleAddOp = useCallback(async (opType: string) => {
    setPickerOpen(false);
    if (!catalog) {
      // Defensive: OpPicker hides the rows when catalog is null, so
      // this branch is unreachable in normal use. If it ever fires
      // (e.g. catalog cleared mid-tap), surface it instead of swallowing.
      onError('op catalog not loaded — cannot add op');
      return;
    }
    const existingIds = new Set(chain.map(o => o.id));
    const newOp = buildDefaultOpFromCatalog(opType, catalog, existingIds);
    const next = [...chain, newOp];
    onChainUpdated(next);
    const r = await putAudioChain(signalKey, next);
    if (!r.ok) {
      onChainUpdated(chain);
      onError(r.error || 'add rejected');
    } else if (r.data) {
      onChainUpdated(r.data);
    }
  }, [chain, signalKey, catalog, onChainUpdated, onError]);

  const handleResetChain = useCallback(async () => {
    const r = await resetAudioChainSignal(signalKey);
    if (!r.ok) {
      onError(r.error || 'reset rejected');
    } else if (r.data) {
      onChainUpdated(r.data);
    }
  }, [signalKey, onChainUpdated, onError]);

  const handleLoadDefault = handleResetChain;

  const handleDuplicateFrom = useCallback(async (sourceSignalKey: string) => {
    setDuplicateOpen(false);
    const source = otherSignals.find(s => s.key === sourceSignalKey);
    if (!source) return;
    // Re-id every op so we don't collide with this signal's existing ids.
    const existingIds = new Set<string>();
    const cloned: AudioChainOp[] = source.chain.map((op, i) => {
      let n = i + 1;
      let id = `op_${op.type}_${n}`;
      while (existingIds.has(id)) { n += 1; id = `op_${op.type}_${n}`; }
      existingIds.add(id);
      return { ...op, id, params: { ...op.params } };
    });
    onChainUpdated(cloned);
    const r = await putAudioChain(signalKey, cloned);
    if (!r.ok) {
      onChainUpdated(chain);
      onError(r.error || 'duplicate rejected');
    } else if (r.data) {
      onChainUpdated(r.data);
    }
  }, [chain, signalKey, otherSignals, onChainUpdated, onError]);

  // ── Render ─────────────────────────────────────────────────────────────

  const isEmpty = displayChain.length === 0;

  return (
    <View style={{
      marginTop: 8, padding: 12, borderRadius: 10,
      backgroundColor: C.surfaceContainerLow,
      borderWidth: 1, borderColor: C.ghostBorder,
    }}>
      {/* ANALYZER sub-section — only renders for micKick (kick detector
          params are genuinely per-signal). Crossovers + envelope/gate
          for mic LOW/MID/HIGH live in `SharedMicAnalyzerSection` at the
          top of the CHAINS card body (they're engine-global). Stems get
          no section (OSC-fed, not FFT-fed). Operator brief 2026-05-26
          (revised). */}
      <AnalyzerSection
        signalKey={signalKey}
        cfg={audioConfig}
        cfgError={audioConfigError}
        handlers={analyzerHandlers}
        onRetryCfg={onRetryAudioConfig}
      />
      {isEmpty ? (
        <View style={{
          paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{
            fontFamily: 'Inter_400Regular', fontSize: 12, color: C.icon,
            marginBottom: 8,
          }}>raw → ─── (passthrough — no ops yet) ─── CPC</Text>
          <TouchableOpacity
            onPress={handleLoadDefault}
            style={{
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
              backgroundColor: C.primary,
            }}
          >
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', color: '#fff', fontSize: 11,
              textTransform: 'uppercase', letterSpacing: 0.8,
            }}>Load default chain</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <Text style={{
            fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon, marginBottom: 6,
          }}>raw →</Text>
          {displayChain.map((op, i) => (
            <OpRow
              key={op.id}
              op={op}
              opIndex={i}
              isFirst={i === 0}
              isLast={i === displayChain.length - 1}
              preview={previewById[op.id] ?? null}
              accent={accent}
              catalog={catalog}
              onPatchParam={(p) => handlePatchParam(op.id, p)}
              onToggleEnabled={() => handleToggleEnabled(op.id)}
              onRemove={() => handleRemoveOp(op.id)}
              onMove={(dir) => handleMoveOp(op.id, dir)}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              rowHeightRef={(h) => { rowHeightRef.current = h; }}
            />
          ))}
          <Text style={{
            fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon, marginBottom: 8,
          }}>→ CPC: {signalKey}</Text>
        </>
      )}

      <View style={{
        flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8,
        alignItems: 'center',
      }}>
        {/* [+ ADD OP] is disabled while the op catalog is unavailable
            (loading on first mount, or failed and not yet retried). The
            old code silently returned from handleAddOp on null catalog —
            operator saw a tappable button that did nothing. Codex P0:
            never swallow. If the catalog FAILED, tapping the button
            triggers a fresh fetch (the picker spinner then resolves to
            rows). If still loading, the button is greyed out. */}
        <TouchableOpacity
          onPress={() => {
            if (catalog) {
              setPickerOpen(true);
              return;
            }
            // Catalog null — either loading (no-op; spinner shown
            // inline) or failed (kick off retry). Either way we open
            // the picker so the operator sees the loading/error state
            // resolve into rows.
            if (catalogError && !catalogLoading) {
              onRetryCatalog();
            }
            setPickerOpen(true);
          }}
          disabled={catalogLoading}
          style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
            backgroundColor: catalog ? C.primary : C.surfaceContainerHigh,
            borderWidth: catalog ? 0 : 1,
            borderColor: catalogError ? C.error : C.ghostBorder,
            opacity: catalogLoading ? 0.5 : 1,
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold',
            color: catalog ? '#fff' : (catalogError ? C.error : C.secondary),
            fontSize: 11,
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}>
            {catalog ? '+ Add op' : (catalogLoading ? '+ Add op (loading…)' : '+ Add op (retry)')}
          </Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={() => setDuplicateOpen(true)}
          style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
            borderWidth: 1, borderColor: C.ghostBorder,
            backgroundColor: C.surfaceContainerLowest,
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 11,
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}>Duplicate from ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleResetChain}
          style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
            borderWidth: 1, borderColor: C.ghostBorder,
            backgroundColor: C.surfaceContainerLowest,
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 11,
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}>Reset chain</Text>
        </TouchableOpacity>
      </View>

      <OpPicker
        visible={pickerOpen}
        catalog={catalog}
        catalogLoading={catalogLoading}
        catalogError={catalogError}
        onPick={handleAddOp}
        onCancel={() => setPickerOpen(false)}
        onRetryCatalog={onRetryCatalog}
      />

      {/* Duplicate-from picker — reuses the modal pattern */}
      <Modal transparent visible={duplicateOpen} animationType="fade" onRequestClose={() => setDuplicateOpen(false)}>
        <Pressable
          onPress={() => setDuplicateOpen(false)}
          style={{
            flex: 1, justifyContent: 'center', alignItems: 'center',
            backgroundColor: 'rgba(0,0,0,0.4)', padding: 32,
          }}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              maxWidth: 480, width: '100%',
              backgroundColor: C.surface, borderRadius: 12,
              borderWidth: 1, borderColor: C.ghostBorder,
              padding: 16,
              ...globalStyles.ambientShadow,
            }}
          >
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14, color: C.text,
              textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
            }}>Duplicate chain from</Text>
            <Text style={{
              fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon, marginBottom: 12,
            }}>
              Replace {label}&apos;s chain with a copy of another signal&apos;s chain. Op ids are renamed to avoid collisions.
            </Text>
            {otherSignals.map((s) => (
              <TouchableOpacity
                key={s.key}
                onPress={() => handleDuplicateFrom(s.key)}
                style={{
                  paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6,
                  borderRadius: 8, backgroundColor: C.surfaceContainerLowest,
                  borderWidth: 1, borderColor: C.ghostBorder,
                }}
              >
                <Text style={{
                  fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.primary,
                  letterSpacing: 0.6,
                }}>{s.label}</Text>
                <Text style={{
                  fontFamily: 'Inter_400Regular', fontSize: 10, color: C.text, marginTop: 2,
                }}>
                  {s.chain.length === 0
                    ? '(empty)'
                    : s.chain.map(opSummary).join(' → ')}
                </Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── Collapsed/expanded row per signal ─────────────────────────────────────

function SignalChainRow({
  signalKey, label, chain, expanded, catalog, catalogLoading, catalogError,
  otherSignals, audioConfig, audioConfigError, analyzerHandlers, onRetryAudioConfig,
  onToggleExpand, onChainUpdated, onError, onRetryCatalog,
}: {
  signalKey: string;
  label: string;
  chain: AudioChainOp[] | undefined;
  expanded: boolean;
  catalog: AudioChainCatalog | null;
  catalogLoading: boolean;
  catalogError: string | null;
  otherSignals: { key: string; label: string; chain: AudioChainOp[] }[];
  audioConfig: AnalyzerConfig | null;
  audioConfigError: string | null;
  analyzerHandlers: AnalyzerHandlers;
  onRetryAudioConfig: () => void;
  onToggleExpand: () => void;
  onChainUpdated: (next: AudioChainOp[]) => void;
  onError: (msg: string) => void;
  onRetryCatalog: () => void;
}) {
  const isLoaded = Array.isArray(chain);
  const ops = chain ?? [];

  return (
    <View style={{
      paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8,
      borderRadius: 10, backgroundColor: C.surfaceContainerLowest,
      borderWidth: 1, borderColor: C.ghostBorder,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12, color: C.text,
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}>{label}</Text>
          {isLoaded ? (
            <Text style={{
              fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, marginTop: 2,
            }}>
              raw →{ops.length === 0 ? ' (passthrough)' : ' ' + ops.map(opSummary).join(' → ')} → CPC
            </Text>
          ) : (
            <Text style={{
              fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon, marginTop: 2,
            }}>… loading chain</Text>
          )}
        </View>
        <TouchableOpacity
          onPress={onToggleExpand}
          disabled={!isLoaded}
          style={{
            paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
            backgroundColor: expanded ? C.primary : C.surfaceContainerHigh,
            borderWidth: 1, borderColor: expanded ? C.primary : C.ghostBorder,
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
            color: expanded ? '#fff' : C.secondary, letterSpacing: 0.6,
          }}>{expanded ? 'CLOSE ▴' : 'EDIT ▾'}</Text>
        </TouchableOpacity>
      </View>
      {expanded && isLoaded ? (
        <SignalChainEditor
          signalKey={signalKey}
          label={label}
          chain={ops}
          catalog={catalog}
          catalogLoading={catalogLoading}
          catalogError={catalogError}
          otherSignals={otherSignals}
          audioConfig={audioConfig}
          audioConfigError={audioConfigError}
          analyzerHandlers={analyzerHandlers}
          onRetryAudioConfig={onRetryAudioConfig}
          onChainUpdated={onChainUpdated}
          onError={onError}
          onRetryCatalog={onRetryCatalog}
        />
      ) : null}
    </View>
  );
}

// ── Per-signal ANALYZER sub-section ───────────────────────────────────────
//
// Only renders for micKick now. Pre-revision (2026-05-26 v1) the
// crossovers + envelope/gate were ALSO surfaced inside the micLow /
// micMid / micHigh editors, but the engine has a SINGLE GLOBAL FFT
// instance — those sliders were misleading because tweaks in one band
// silently changed all three. They've been consolidated into
// `SharedMicAnalyzerSection`, which renders once at the top of the
// SIGNALS · CHAINS card body.
//
// micKick's kick-detector params (kick.{minHz,maxHz,threshold,
// refractoryMs,decayMs}) ARE per-signal in spirit — only micKick uses
// them — so they stay here in the chain editor with a clarifying label.
//
// Wire details (Codex P0 no-silent-fallback):
//   - audioConfig is owned by the parent screen and passed in. When null
//     (fetch still in flight or failed at the parent) we surface a small
//     inline notice — the chain ops themselves are still editable.
//   - Every slider commits ONE PATCH on release; live drag updates the
//     parent's optimistic cache via onUpdateLocal.
//   - On 400 the parent reverts via a refetch (reload). We do NOT
//     clamp silently — engine error strings appear in the parent's
//     patchError banner.

export type AnalyzerConfig = {
  bands: {
    lowMaxHz: number; midMaxHz: number;
    attackMs: number; releaseMs: number; noiseGate: number;
  };
  kick: { minHz: number; maxHz: number; threshold: number; refractoryMs: number; decayMs: number };
  capture: { sampleRate: number };
};

type AnalyzerHandlers = {
  onUpdateLocal: (group: 'bands' | 'kick', field: string, value: number) => void;
  onCommitField: (group: 'bands' | 'kick', field: string, value: number) => void;
};

function AnalyzerSubHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
        color: C.secondary, textTransform: 'uppercase', letterSpacing: 1,
      }}>{title}</Text>
      {hint ? (
        <Text style={{
          fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10, marginTop: 2,
        }}>{hint}</Text>
      ) : null}
    </View>
  );
}

function AnalyzerHint({ text }: { text: string }) {
  return (
    <Text style={{
      fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
      marginTop: -4, marginBottom: 6,
    }}>{text}</Text>
  );
}

// Shared envelope/gate block — rendered inside the shared MIC ANALYZER
// section at the top of the CHAINS card. (Previously also rendered
// per-band inside each mic chain editor; consolidated 2026-05-26 because
// the engine has a single global FFT analyzer and per-band rendering
// misled the operator.)
function SharedEnvelopeGate({ cfg, handlers }: { cfg: AnalyzerConfig; handlers: AnalyzerHandlers }) {
  return (
    <View style={{ marginTop: 10 }}>
      <AnalyzerSubHeader
        title="ENVELOPE & GATE"
      />
      <OpParamSlider
        label="attackMs" suffix="ms" min={1} max={50} value={cfg.bands.attackMs} step={1} integer
        onDrag={(v) => handlers.onUpdateLocal('bands', 'attackMs', v)}
        onCommit={(v) => handlers.onCommitField('bands', 'attackMs', v)}
      />
      <AnalyzerHint text="How fast a band rises on a peak. 5–20 ms feels musical." />
      <OpParamSlider
        label="releaseMs" suffix="ms" min={20} max={800} value={cfg.bands.releaseMs} step={10} integer
        onDrag={(v) => handlers.onUpdateLocal('bands', 'releaseMs', v)}
        onCommit={(v) => handlers.onCommitField('bands', 'releaseMs', v)}
      />
      <AnalyzerHint text="How slow a band falls after a peak. 100–300 ms typical." />
      <OpParamSlider
        label="noiseGate" min={0} max={0.2} value={cfg.bands.noiseGate} step={0.005}
        onDrag={(v) => handlers.onUpdateLocal('bands', 'noiseGate', v)}
        onCommit={(v) => handlers.onCommitField('bands', 'noiseGate', v)}
      />
      <AnalyzerHint text="Bands below this floor read as 0. Raise if HVAC keeps meters lit." />
    </View>
  );
}

function AnalyzerSection({
  signalKey, cfg, cfgError, handlers, onRetryCfg,
}: {
  signalKey: string;
  cfg: AnalyzerConfig | null;
  cfgError: string | null;
  handlers: AnalyzerHandlers;
  onRetryCfg: () => void;
}) {
  // Only micKick has a per-signal analyzer section now. The crossover
  // edges and envelope/gate live in the engine as a SINGLE GLOBAL FFT
  // instance — rendering them inside each mic band's editor was
  // misleading (tweaks in one band silently affected all). They were
  // consolidated to `SharedMicAnalyzerSection` at the top of the
  // SIGNALS · CHAINS card body. Operator brief 2026-05-26 (revised).
  //
  // Stems have no analyzer config (OSC-fed, not FFT-fed) → null.
  // Mic LOW/MID/HIGH now render no analyzer section → null.
  if (signalKey !== 'micKick') return null;

  // Codex P0: if cfg fetch failed we render a visible error + retry, NOT
  // a silently-defaulted set of sliders.
  if (!cfg) {
    return (
      <View style={{
        marginBottom: 12, padding: 12, borderRadius: 10,
        backgroundColor: C.surfaceContainerLow,
        borderWidth: 1, borderColor: cfgError ? C.error : C.ghostBorder,
      }}>
        <AnalyzerSubHeader title="KICK DETECTOR" />
        {cfgError ? (
          <>
            <Text style={{ fontFamily: 'Inter_400Regular', color: C.error, fontSize: 11, marginBottom: 8 }}>
              Audio config unavailable: {cfgError}
            </Text>
            <TouchableOpacity
              onPress={onRetryCfg}
              style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
                backgroundColor: C.primary, alignSelf: 'flex-start',
              }}
            >
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold', color: '#fff', fontSize: 10,
                textTransform: 'uppercase', letterSpacing: 0.6,
              }}>RETRY</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 11 }}>
            syncing…
          </Text>
        )}
      </View>
    );
  }

  // micKick has its own threshold/refractory/decay — genuinely
  // per-signal (only kick has these). The clarifying label tells the
  // operator these params are specific to this chain, distinguishing
  // from the global crossovers/envelope that now live in the shared
  // section at the top of the CHAINS card.
  return (
    <View style={{
      marginBottom: 12, padding: 12, borderRadius: 10,
      backgroundColor: C.surfaceContainerLow,
      borderWidth: 1, borderColor: C.ghostBorder,
    }}>
      <AnalyzerSubHeader
        title="KICK DETECTOR · CONFIGURED PER MICKICK CHAIN"
        hint="EDM kick fundamental sits 50–80 Hz; click transient ~100 Hz."
      />
      {/* Fixed slider scales [20, 500] Hz on both ends — operator brief
          2026-05-27. Previously maxHz's slider min was derived from
          cfg.kick.minHz, which made the slider knob visibly jump as the
          other one was dragged. Cross-bound constraint (min < max - 5)
          is now enforced at COMMIT time so the engine never sees an
          invalid pair while the drag remains predictable. */}
      <OpParamSlider
        label="Energy min" suffix="Hz" min={20} max={500} value={cfg.kick.minHz} step={5} integer
        onDrag={(v) => handlers.onUpdateLocal('kick', 'minHz', v)}
        onCommit={(v) => handlers.onCommitField('kick', 'minHz', Math.min(v, cfg.kick.maxHz - 5))}
      />
      <OpParamSlider
        label="Energy max" suffix="Hz" min={20} max={500} value={cfg.kick.maxHz} step={5} integer
        onDrag={(v) => handlers.onUpdateLocal('kick', 'maxHz', v)}
        onCommit={(v) => handlers.onCommitField('kick', 'maxHz', Math.max(v, cfg.kick.minHz + 5))}
      />
      <OpParamSlider
        label="Threshold ×" min={1.05} max={4.0} value={cfg.kick.threshold} step={0.05}
        onDrag={(v) => handlers.onUpdateLocal('kick', 'threshold', v)}
        onCommit={(v) => handlers.onCommitField('kick', 'threshold', v)}
      />
      <AnalyzerHint text="Instant energy must be this many × running average to fire." />
      <OpParamSlider
        label="Refractory" suffix="ms" min={0} max={1000} value={cfg.kick.refractoryMs} step={10} integer
        onDrag={(v) => handlers.onUpdateLocal('kick', 'refractoryMs', v)}
        onCommit={(v) => handlers.onCommitField('kick', 'refractoryMs', v)}
      />
      <AnalyzerHint text="Minimum gap between two kick fires." />
      <OpParamSlider
        label="Decay" suffix="ms" min={20} max={1000} value={cfg.kick.decayMs} step={10} integer
        onDrag={(v) => handlers.onUpdateLocal('kick', 'decayMs', v)}
        onCommit={(v) => handlers.onCommitField('kick', 'decayMs', v)}
      />
      <AnalyzerHint text="How fast micKick envelope falls back to 0." />
    </View>
  );
}

// ── Shared MIC ANALYZER section (always-visible, top of CHAINS card) ──────
//
// Renders the engine's GLOBAL FFT analyzer config — crossovers + envelope/
// gate — as a single shared block at the top of the SIGNALS · CHAINS card.
// Previously these sliders were rendered inside micLow / micMid / micHigh
// editors, which misled the operator: there's only ONE analyzer in the
// engine, so a tweak in one band silently affected all three.
//
// Wire shape is unchanged from the per-signal version: the same
// AnalyzerHandlers (onUpdateLocal for live drag, onCommitField for the
// release-time PATCH) flow through, and the parent screen owns audioConfig.
//
// Codex P0: if cfg is null (loading or error), surface the state instead
// of rendering silently-defaulted sliders.
function SharedMicAnalyzerSection({
  cfg, cfgError, handlers, onRetryCfg,
}: {
  cfg: AnalyzerConfig | null;
  cfgError: string | null;
  handlers: AnalyzerHandlers;
  onRetryCfg: () => void;
}) {
  if (!cfg) {
    return (
      <View style={{
        marginBottom: 12, padding: 12, borderRadius: 10,
        backgroundColor: C.surfaceContainerLow,
        borderWidth: 1, borderColor: cfgError ? C.error : C.ghostBorder,
      }}>
        <AnalyzerSubHeader
          title="MIC ANALYZER · SHARED ACROSS LOW · MID · HIGH"
          hint="Engine-global FFT analyzer config. Tuning here affects all three mic bands."
        />
        {cfgError ? (
          <>
            <Text style={{ fontFamily: 'Inter_400Regular', color: C.error, fontSize: 11, marginBottom: 8 }}>
              Audio config unavailable: {cfgError}
            </Text>
            <TouchableOpacity
              onPress={onRetryCfg}
              style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
                backgroundColor: C.primary, alignSelf: 'flex-start',
              }}
            >
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold', color: '#fff', fontSize: 10,
                textTransform: 'uppercase', letterSpacing: 0.6,
              }}>RETRY</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 11 }}>
            loading analyzer config…
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={{
      marginBottom: 16, padding: 12, borderRadius: 10,
      backgroundColor: C.surfaceContainerLow,
      borderWidth: 1, borderColor: C.ghostBorder,
    }}>
      <AnalyzerSubHeader
        title="MIC ANALYZER · SHARED ACROSS LOW · MID · HIGH"
        hint="Engine-global FFT analyzer config. Tuning here affects all three mic bands."
      />
      <View style={{ marginTop: 4 }}>
        <AnalyzerSubHeader title="CROSSOVERS" />
        {/* Fixed slider scales [50, 1000] Hz on both ends — operator
            brief 2026-05-27. Previously each end's slider range was
            derived from the other, so dragging one moved the other's
            knob along its track mid-drag. Cross-bound constraint
            (low < mid - 5) now clamps at COMMIT only. */}
        {/* lowMaxHz: typical bass-band edge is 80-400 Hz (sub-bass kick
            fundamental up to bass body). Range tightened from [50, 1000]
            so the slider's full track lives where the operator actually
            tunes. */}
        <OpParamSlider
          label="lowMaxHz" suffix="Hz"
          min={80}
          max={400}
          value={cfg.bands.lowMaxHz}
          step={5}
          integer
          onDrag={(v) => handlers.onUpdateLocal('bands', 'lowMaxHz', v)}
          onCommit={(v) => handlers.onCommitField('bands', 'lowMaxHz', Math.min(v, cfg.bands.midMaxHz - 50))}
        />
        <AnalyzerHint text="Upper edge of LOW band / lower edge of MID band." />
        {/* midMaxHz: typical mid-to-high crossover is 1-8 kHz (vocal
            presence + sibilance edge). Range tightened from [50, 1000]
            (which was below typical floor!) to [1000, 12000]. step=50
            keeps fine-tuning practical at the higher numbers. */}
        <OpParamSlider
          label="midMaxHz" suffix="Hz"
          min={1000}
          max={12000}
          value={cfg.bands.midMaxHz}
          step={50}
          integer
          onDrag={(v) => handlers.onUpdateLocal('bands', 'midMaxHz', v)}
          onCommit={(v) => handlers.onCommitField('bands', 'midMaxHz', Math.max(v, cfg.bands.lowMaxHz + 50))}
        />
        <AnalyzerHint text="Upper edge of MID band / lower edge of HIGH band." />
      </View>
      <SharedEnvelopeGate cfg={cfg} handlers={handlers} />
    </View>
  );
}

// ── Outer card ────────────────────────────────────────────────────────────

export function AudioChainsCard({
  audioConfig, audioConfigError, onUpdateAudioConfigLocal, onCommitAudioConfigField, onRetryAudioConfig,
}: {
  audioConfig: AnalyzerConfig | null;
  audioConfigError: string | null;
  onUpdateAudioConfigLocal: (group: 'bands' | 'kick', field: string, value: number) => void;
  onCommitAudioConfigField: (group: 'bands' | 'kick', field: string, value: number) => void;
  onRetryAudioConfig: () => void;
}) {
  const [chains, setChains] = useState<AudioChainsMap | null>(null);
  const [catalog, setCatalog] = useState<AudioChainCatalog | null>(_catalogCache);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(_catalogCache == null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [wsConnected, setWsConnected] = useState<boolean>(engineEvents.getStatus().connected);

  // Fetch chain map + catalog on mount.
  const reload = useCallback(async () => {
    await getApiBaseAsync();
    const r = await fetchAudioChains();
    if (r.ok && r.data) {
      setChains(r.data);
      setLoadError(null);
    } else {
      setLoadError(r.error || 'failed to load chains');
    }
  }, []);

  // Catalog loader, re-callable on retry. The module-scope cache means
  // a second mount in the same session is a no-op when the first
  // succeeded. When the first fetch failed, this clears any stale
  // inflight state and drives a fresh request.
  const loadCatalogIntoState = useCallback(async () => {
    if (_catalogCache) {
      setCatalog(_catalogCache);
      setCatalogLoading(false);
      setCatalogError(null);
      return;
    }
    setCatalogLoading(true);
    setCatalogError(null);
    const res = await loadCatalog();
    if (res.ok) {
      setCatalog(res.catalog);
      setCatalogError(null);
    } else {
      setCatalogError(res.error);
    }
    setCatalogLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    let alive = true;
    if (_catalogCache) {
      setCatalog(_catalogCache);
      setCatalogLoading(false);
      return () => { alive = false; };
    }
    setCatalogLoading(true);
    loadCatalog().then((res) => {
      if (!alive) return;
      if (res.ok) {
        setCatalog(res.catalog);
        setCatalogError(null);
      } else {
        setCatalogError(res.error);
      }
      setCatalogLoading(false);
    });
    return () => { alive = false; };
  }, []);

  // Listen for `audioChainsChanged` on /ws/control so the iPad picks
  // up engine-side mutations (other clients, scene reload, reset) without
  // re-fetching. The bus fires the broadcast on every successful
  // PUT/PATCH/reset including our own — keeps the map authoritative.
  useEffect(() => {
    const unsub = engineEvents.subscribe((msg: EngineMessage) => {
      if (msg.type !== 'audioChainsChanged') return;
      const next = (msg as unknown as { chains?: AudioChainsMap }).chains;
      if (next && typeof next === 'object') setChains(next);
    });
    return () => { unsub(); };
  }, []);

  // Track WS-control connection state for the "engine offline" pill.
  useEffect(() => {
    const unsub = engineEvents.subscribeStatus((s) => setWsConnected(s.connected));
    return () => { unsub(); };
  }, []);

  // ── Subscription lifecycle (docs/29 §Interactions step 1/6 + step 8) ─
  //
  // While the AUDIO tab is focused, tell the engine to emit 5 Hz
  // signalChain preview frames. On blur, unsubscribe so the engine
  // pays zero cost. On WS reconnect we BOTH re-subscribe (so preview
  // frames resume) AND re-fetch chains via reload() — belt-and-braces
  // alongside the engine-side snapshot emission added in Phase 5.1
  // (commit adc92be: /ws/control now broadcasts `audioChainsChanged`
  // in its initial post-reconnect snapshot). The reload() call here
  // covers the legacy/transport edge cases (operator had an optimistic
  // PATCH in flight when the WS dropped; another client edited; scene
  // reload between disconnect and reconnect) and ensures the iPad
  // ends up on the engine's authoritative state regardless of which
  // side actually applied the in-flight change. docs/29 §Interactions
  // step 8: "engine bus reconnects → on `audioChainsChanged` resync".
  useFocusEffect(useCallback(() => {
    // Send immediately if connected; otherwise the bus's outbound queue
    // (cap 64) will flush on the next open.
    engineEvents.send({ type: 'subscribeChains' });

    // Watch for reconnects and re-subscribe + resync chain state.
    // (Subscribing while already subscribed is cheap on the engine —
    // it's a boolean set.)
    let lastConnected = engineEvents.getStatus().connected;
    const unsubStatus = engineEvents.subscribeStatus((s) => {
      if (!lastConnected && s.connected) {
        engineEvents.send({ type: 'subscribeChains' });
        // Re-fetch chains so any engine-side mutations that happened
        // during the disconnect window land in our local cache.
        reload();
      }
      lastConnected = s.connected;
    });

    return () => {
      engineEvents.send({ type: 'unsubscribeChains' });
      unsubStatus();
    };
  }, [reload]));

  const updateSignalChain = useCallback((signalKey: string, next: AudioChainOp[]) => {
    setChains((prev) => {
      if (!prev) return prev;
      return { ...prev, [signalKey]: next };
    });
  }, []);

  const handleError = useCallback((msg: string) => {
    setOpError(msg);
  }, []);

  const handleRetryLoad = useCallback(() => {
    setLoadError(null);
    reload();
  }, [reload]);

  // Bundle the per-signal analyzer handlers once; stable reference so
  // SignalChainRow's expanded body doesn't re-render on identity churn.
  const analyzerHandlers = useMemo<AnalyzerHandlers>(() => ({
    onUpdateLocal: onUpdateAudioConfigLocal,
    onCommitField: onCommitAudioConfigField,
  }), [onUpdateAudioConfigLocal, onCommitAudioConfigField]);

  // Render
  return (
    <View style={CARD}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text, letterSpacing: 0.8,
        }}>SIGNALS · CHAINS</Text>
        {!wsConnected ? (
          <View style={{
            paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
            backgroundColor: '#f8d7da', borderWidth: 1, borderColor: C.error,
          }}>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.error, letterSpacing: 0.6,
            }}>ENGINE OFFLINE</Text>
          </View>
        ) : null}
      </View>

      {loadError ? (
        <View style={{
          padding: 12, borderRadius: 8, marginBottom: 12,
          backgroundColor: 'rgba(186, 26, 26, 0.06)',
          borderWidth: 1, borderColor: C.error,
        }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 11, marginBottom: 4 }}>CHAINS UNAVAILABLE</Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 12 }}>{loadError}</Text>
          <TouchableOpacity onPress={handleRetryLoad} style={{ marginTop: 8, padding: 8, alignSelf: 'flex-start', backgroundColor: C.primary, borderRadius: 6 }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#fff', fontSize: 11 }}>RETRY</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {opError ? (
        <View style={{
          padding: 10, borderRadius: 8, marginBottom: 12,
          backgroundColor: 'rgba(186, 26, 26, 0.06)',
          borderWidth: 1, borderColor: C.error,
        }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.error, fontSize: 11, marginBottom: 4 }}>LAST EDIT REJECTED</Text>
          <Text style={{ fontFamily: 'Inter_400Regular', color: C.text, fontSize: 11 }}>{opError}</Text>
          <TouchableOpacity onPress={() => setOpError(null)} style={{ marginTop: 6, padding: 6, alignSelf: 'flex-start', borderRadius: 6, borderWidth: 1, borderColor: C.ghostBorder }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10, letterSpacing: 0.6 }}>DISMISS</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Shared MIC ANALYZER — the engine has a single global FFT, so
          crossovers + envelope/gate are NOT per-band. Surfacing them
          once at the top of the CHAINS card (vs. inside each mic band
          editor) prevents the "tweaks in micLow silently change micMid"
          confusion. Always visible — small and important. Operator
          brief 2026-05-26 (revised). */}
      <SharedMicAnalyzerSection
        cfg={audioConfig}
        cfgError={audioConfigError}
        handlers={analyzerHandlers}
        onRetryCfg={onRetryAudioConfig}
      />

      {SIGNAL_ORDER.map(({ key, label }) => {
        const others = SIGNAL_ORDER
          .filter(s => s.key !== key)
          .map(s => ({ key: s.key, label: s.label, chain: chains?.[s.key] ?? [] }));
        return (
          <SignalChainRow
            key={key}
            signalKey={key}
            label={label}
            chain={chains?.[key]}
            expanded={!!expanded[key]}
            catalog={catalog}
            catalogLoading={catalogLoading}
            catalogError={catalogError}
            otherSignals={others}
            audioConfig={audioConfig}
            audioConfigError={audioConfigError}
            analyzerHandlers={analyzerHandlers}
            onRetryAudioConfig={onRetryAudioConfig}
            onToggleExpand={() => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
            onChainUpdated={(next) => updateSignalChain(key, next)}
            onError={handleError}
            onRetryCatalog={loadCatalogIntoState}
          />
        );
      })}
    </View>
  );
}
