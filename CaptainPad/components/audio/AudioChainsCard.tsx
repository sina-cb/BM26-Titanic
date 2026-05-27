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
  type AudioChainOp, type AudioChainsMap, type AudioChainCatalog,
} from '@/utils/api';

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
// order (Math → Filter → Trigger → Hold).
const OP_PICKER_ORDER: readonly string[] = [
  'gain', 'bias', 'clamp', 'lpf', 'envelope', 'schmitt', 'hold',
];

// Module-scope catalog cache. Lifecycle: fetched lazily on the first
// AudioChainsCard mount per app session, kept until the app is killed
// (the op schemas don't change without an engine restart, and a stale
// cache would surface as a 400 from the engine on PUT — operator-visible,
// fail-loudly).
let _catalogCache: AudioChainCatalog | null = null;
let _catalogInflight: Promise<AudioChainCatalog | null> | null = null;
function loadCatalog(): Promise<AudioChainCatalog | null> {
  if (_catalogCache) return Promise.resolve(_catalogCache);
  if (_catalogInflight) return _catalogInflight;
  _catalogInflight = (async () => {
    const r = await fetchAudioChainsCatalog();
    if (r.ok && r.data) {
      _catalogCache = r.data;
      return _catalogCache;
    }
    return null;
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
};

function uiRange(opType: string, paramKey: string, fallback: [number, number]): [number, number] {
  const cap = UI_SLIDER_CAPS[opType]?.[paramKey];
  return cap ?? fallback;
}

// Per-op label string for the catalog picker + compact preview row.
function opLabel(type: string): string {
  switch (type) {
    case 'gain':     return 'Gain';
    case 'bias':     return 'Bias';
    case 'clamp':    return 'Clamp';
    case 'lpf':      return 'LPF';
    case 'envelope': return 'Envelope';
    case 'schmitt':  return 'Schmitt';
    case 'hold':     return 'Hold';
    default:         return type;
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

// ── Per-op editor body ────────────────────────────────────────────────────

function OpParams({
  op, opIndex, otherOps,
  onPatchParam,
}: {
  op: AudioChainOp;
  opIndex: number;
  otherOps: AudioChainOp[];
  onPatchParam: (paramPatch: Record<string, number | string>) => void;
}) {
  // Render the 7 op types' param controls. Each control commits one
  // PATCH per gesture (onCommit). The engine's validateChain rejects
  // out-of-range / cross-param violations atomically; we revert at
  // the parent (SignalChainEditor) on a 400.
  switch (op.type) {
    case 'gain': {
      const usesParamKey = typeof op.params.paramKey === 'string';
      if (usesParamKey) {
        return (
          <Text style={{
            fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10,
            marginTop: 2,
          }}>
            Value driven live from CPC key: {String(op.params.paramKey)}. Edit the slider that owns this key (e.g. PER-BAND GAIN below) to change.
          </Text>
        );
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
      return (
        <>
          <OpParamSlider
            label="min" min={0} max={Math.max(0.01, hi)} value={lo} step={0.01}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ min: Math.min(nv, hi) })}
          />
          <OpParamSlider
            label="max" min={Math.min(lo, 0.99)} max={1} value={hi} step={0.01}
            onDrag={() => { /* commit on release */ }}
            onCommit={(nv) => onPatchParam({ max: Math.max(nv, lo) })}
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
    default:
      // Unknown op type from a future engine: render a read-only json
      // dump so the operator sees SOMETHING (vs silently empty). Codex
      // P0: fail visibly — the catalog picker won't OFFER unknown ops,
      // so this only fires if the engine returns one we don't know.
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
  preview, accent,
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
  onPatchParam: (paramPatch: Record<string, number | string>) => void;
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
  visible, onPick, onCancel, catalog,
}: {
  visible: boolean;
  onPick: (opType: string) => void;
  onCancel: () => void;
  catalog: AudioChainCatalog | null;
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
  const params: Record<string, number | string> = {};
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
  signalKey, label, chain, catalog, otherSignals,
  onChainUpdated, onError,
}: {
  signalKey: string;
  label: string;
  chain: AudioChainOp[];
  catalog: AudioChainCatalog | null;
  otherSignals: { key: string; label: string; chain: AudioChainOp[] }[];
  onChainUpdated: (next: AudioChainOp[]) => void;
  onError: (msg: string) => void;
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

  const handlePatchParam = useCallback(async (opId: string, paramPatch: Record<string, number | string>) => {
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
    if (!catalog) return;
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
        <TouchableOpacity
          onPress={() => setPickerOpen(true)}
          style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
            backgroundColor: C.primary,
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', color: '#fff', fontSize: 11,
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}>+ Add op</Text>
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
        onPick={handleAddOp}
        onCancel={() => setPickerOpen(false)}
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
  signalKey, label, chain, expanded, catalog, otherSignals,
  onToggleExpand, onChainUpdated, onError,
}: {
  signalKey: string;
  label: string;
  chain: AudioChainOp[] | undefined;
  expanded: boolean;
  catalog: AudioChainCatalog | null;
  otherSignals: { key: string; label: string; chain: AudioChainOp[] }[];
  onToggleExpand: () => void;
  onChainUpdated: (next: AudioChainOp[]) => void;
  onError: (msg: string) => void;
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
          otherSignals={otherSignals}
          onChainUpdated={onChainUpdated}
          onError={onError}
        />
      ) : null}
    </View>
  );
}

// ── Outer card ────────────────────────────────────────────────────────────

export function AudioChainsCard() {
  const [chains, setChains] = useState<AudioChainsMap | null>(null);
  const [catalog, setCatalog] = useState<AudioChainCatalog | null>(_catalogCache);
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

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    let alive = true;
    loadCatalog().then((c) => { if (alive && c) setCatalog(c); });
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

  // ── Subscription lifecycle (docs/29 §Interactions step 1/6) ──────────
  //
  // While the AUDIO tab is focused, tell the engine to emit 5 Hz
  // signalChain preview frames. On blur, unsubscribe so the engine
  // pays zero cost. Re-subscribe on WS reconnect (an `audioChainsChanged`
  // doesn't fire on reconnect, so we hook the bus status directly).
  useFocusEffect(useCallback(() => {
    // Send immediately if connected; otherwise the bus's outbound queue
    // (cap 64) will flush on the next open.
    engineEvents.send({ type: 'subscribeChains' });

    // Watch for reconnects and re-subscribe. (Subscribing while already
    // subscribed is cheap on the engine — it's a boolean set.)
    let lastConnected = engineEvents.getStatus().connected;
    const unsubStatus = engineEvents.subscribeStatus((s) => {
      if (!lastConnected && s.connected) {
        engineEvents.send({ type: 'subscribeChains' });
      }
      lastConnected = s.connected;
    });

    return () => {
      engineEvents.send({ type: 'unsubscribeChains' });
      unsubStatus();
    };
  }, []));

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
            otherSignals={others}
            onToggleExpand={() => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))}
            onChainUpdated={(next) => updateSignalChain(key, next)}
            onError={handleError}
          />
        );
      })}
    </View>
  );
}
