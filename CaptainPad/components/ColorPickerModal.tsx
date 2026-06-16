/**
 * ColorPickerModal — global colour picker for the Deck + Mixer chrome.
 *
 * Rendered from CPCControls, which lives on BOTH the Deck tab and the
 * Mixer tab, so every behavior here reaches both surfaces for free.
 *
 * Three behaviors (docs/36):
 *   1. Easy colour choosing — Presets tab applies a curated pair on a
 *      single tap (sourced from the engine, config.yaml → colorPalettes).
 *   2. Manual colour play — the Manual tab's hue sliders apply LIVE as
 *      you drag (throttled ~30 Hz), so the rig paints in real time. The
 *      engine fades between colours over `colorTransitionMs` (the
 *      TRANSITION field below), so a drag looks like a smooth wash, not a
 *      strobe of intermediate hues.
 *   3. Tap-outside / CANCEL revert — because we write live, dismissing
 *      without APPLY restores the colours captured when the modal opened.
 *
 * S/V are pinned to 100% on every write — stage lights stay punchy. If
 * we ever want stage-dim, add a brightness param, don't reopen S/V here.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, Modal, ScrollView } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { useSharedParamValues } from '@/hooks/useEngineState';
import { getCachedColorPalettes, updateParamCenter, warmColorPalettesCache } from '@/utils/api';

// Picker policy: hue-only. Every write pins S=V=1.0.
const FULL_S = 1;
const FULL_V = 1;

// Live-apply throttle. ~30 Hz matches the engine's sharedParams
// broadcast debounce — fast enough to feel continuous, slow enough not
// to flood the POST path during a drag.
const LIVE_THROTTLE_MS = 33;

// Operator-facing transition bounds (seconds). Mirrors the engine's
// `colorTransitionMs` range [0, 10000] in docs/36.
const TRANSITION_MAX_S = 10;

export type ColorPalettePreset = {
  id: string;
  name: string;
  c1: number;
  c2: number;
};

type Tab = 'presets' | 'manual';

export function ColorPickerModal({
  visible,
  initialH1,
  initialH2,
  initialTab = 'presets',
  onClose,
}: {
  visible: boolean;
  initialH1: number;
  initialH2: number;
  initialTab?: Tab;
  onClose: () => void;
}) {
  const C = usePalette();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [h1, setH1] = useState(initialH1);
  const [h2, setH2] = useState(initialH2);
  const [presets, setPresets] = useState<ColorPalettePreset[]>(() => getCachedColorPalettes());

  // Baseline captured on open — what tap-outside / CANCEL reverts to,
  // since the Manual tab writes live while you drag.
  const baselineRef = useRef({ h1: initialH1, h2: initialH2 });

  // Live engine value of the global colour-fade time, surfaced in the
  // TRANSITION field. The field edits a local string; we commit to the
  // engine on submit/blur (not per keystroke).
  const { colorTransitionMs } = useSharedParamValues({ colorTransitionMs: 800 }) as { colorTransitionMs: number };
  const [transText, setTransText] = useState('');

  // Reset working state to live engine values every time the modal
  // reopens, and snapshot the baseline for revert.
  useEffect(() => {
    if (visible) {
      setH1(initialH1);
      setH2(initialH2);
      setTab(initialTab);
      baselineRef.current = { h1: initialH1, h2: initialH2 };
      setTransText(formatSeconds(colorTransitionMs));
    }
    // colorTransitionMs intentionally omitted — we only seed the field
    // on open, not on every live broadcast (would fight the operator's
    // in-progress typing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialH1, initialH2, initialTab]);

  // Cache-first preset load (warmed at app boot in _layout.tsx); also
  // kick a background refresh on open so a transient empty cache
  // self-heals and operator edits to config.yaml's colorPalettes show
  // up without an app restart.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      const cached = getCachedColorPalettes();
      if (cached.length > 0 && presets.length === 0 && !cancelled) setPresets(cached);
      const next = await warmColorPalettesCache({ force: presets.length === 0 && cached.length === 0 });
      if (cancelled) return;
      if (Array.isArray(next) && next.length > 0 && (presets.length === 0 || next !== presets)) {
        setPresets(next);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, presets]);

  // ── Live writers ────────────────────────────────────────────────────
  // Atomic dual-write so the engine broadcasts one sharedParams update
  // (no C1/C2 flicker), exactly as the old APPLY did.
  const writeColors = useCallback((nh1: number, nh2: number) => {
    updateParamCenter({
      colorPalette1: { h: nh1, s: FULL_S, v: FULL_V },
      colorPalette2: { h: nh2, s: FULL_S, v: FULL_V },
    });
  }, []);
  const [liveWrite, cancelLiveWrite] = useThrottle(writeColors, LIVE_THROTTLE_MS);

  const onManualH1 = useCallback((v: number) => { setH1(v); liveWrite(v, h2); }, [h2, liveWrite]);
  const onManualH2 = useCallback((v: number) => { setH2(v); liveWrite(h1, v); }, [h1, liveWrite]);

  // APPLY: value is already live; just push the final position
  // un-throttled (so the last drag frame is never lost) and close. Drop
  // any pending throttled write first so it can't fire after this.
  const apply = useCallback(() => {
    cancelLiveWrite();
    writeColors(h1, h2);
    onClose();
  }, [h1, h2, writeColors, onClose, cancelLiveWrite]);

  // CANCEL / tap-outside / Android-back: revert to the baseline (the
  // engine fades back) and close. The TRANSITION field is a setting, not
  // a play value, so it is NOT reverted — it commits on its own. Drop any
  // pending throttled write FIRST, else a just-released drag would re-apply
  // the abandoned colour a few ms after the revert lands.
  const cancel = useCallback(() => {
    cancelLiveWrite();
    const b = baselineRef.current;
    writeColors(b.h1, b.h2);
    onClose();
  }, [writeColors, onClose, cancelLiveWrite]);

  // Preset tap: apply both hues live and close (one tap = done).
  const pickPreset = useCallback((p: ColorPalettePreset) => {
    cancelLiveWrite();
    setH1(p.c1); setH2(p.c2);
    writeColors(p.c1, p.c2);
    onClose();
  }, [writeColors, onClose, cancelLiveWrite]);

  // Commit the TRANSITION field to the engine (parse seconds → ms). On
  // non-numeric input, restore the field from the live engine value and
  // skip the write — never silently reinterpret garbage as 0 (codex P0).
  const commitTransition = useCallback(() => {
    const sec = parseFloat(transText);
    if (!Number.isFinite(sec)) {
      setTransText(formatSeconds(colorTransitionMs));
      return;
    }
    const clamped = Math.max(0, Math.min(TRANSITION_MAX_S, sec));
    updateParamCenter({ colorTransitionMs: Math.round(clamped * 1000) });
    setTransText(formatSeconds(clamped * 1000)); // normalise display
  }, [transText, colorTransitionMs]);

  const hasPresets = presets.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      {/* Backdrop: tapping anywhere outside the card cancels (docs/36 §6). */}
      <Pressable
        onPress={cancel}
        accessibilityLabel="Close colour picker"
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}
      >
        {/* Card swallows taps so interacting inside never dismisses. */}
        <Pressable
          onPress={() => {}}
          style={{ width: 360, maxHeight: '85%', backgroundColor: C.surfaceContainerLowest, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder }}
        >
          {/* ── Header: title + live combined preview ──────────────── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 14, textTransform: 'uppercase' }}>
              Colours
            </Text>
            <DualSwatch h1={h1} h2={h2} size={44} />
          </View>

          {/* ── Tab bar (only shown if we actually have presets) ───── */}
          {hasPresets ? (
            <View style={{ flexDirection: 'row', marginBottom: 14, borderRadius: 8, backgroundColor: C.surfaceContainerHigh, padding: 3 }}>
              <TabButton label="Presets" active={tab === 'presets'} onPress={() => setTab('presets')} />
              <TabButton label="Manual"  active={tab === 'manual'}  onPress={() => setTab('manual')} />
            </View>
          ) : null}

          {/* ── Tab body ───────────────────────────────────────────── */}
          {tab === 'presets' && hasPresets ? (
            <PresetsTab presets={presets} onPick={pickPreset} />
          ) : (
            <ManualTab h1={h1} h2={h2} setH1={onManualH1} setH2={onManualH2} />
          )}

          {/* ── Transition time (always visible, both tabs) ────────── */}
          <TransitionField
            value={transText}
            onChangeText={setTransText}
            onCommit={commitTransition}
          />

          {/* ── Footer (Manual-only — presets apply on tap) ───────── */}
          {tab === 'manual' || !hasPresets ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, alignItems: 'center' }}>
              <TouchableOpacity onPress={cancel} style={{ padding: 12 }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary }}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={apply}
                style={{ backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000' }}>APPLY</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

/**
 * ColorQueueModal — "pick one pair to ARM" selector for the Deck/Mixer
 * quick-cue queue. Same backdrop + card + preset grid as the main picker,
 * but it does NOT touch the engine: tapping a pair hands it back via
 * onSelect so the caller can arm it (the colour only goes live later when
 * the operator taps the armed slot). Tap-outside / back dismiss without
 * selecting. A chooser — no Manual tab, no transition field. docs/36 §5b.
 */
export function ColorQueueModal({ visible, presets, onSelect, onClose }: {
  visible: boolean;
  presets: ColorPalettePreset[];
  onSelect: (p: ColorPalettePreset) => void;
  onClose: () => void;
}) {
  const C = usePalette();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close queue picker"
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}
      >
        <Pressable
          onPress={() => {}}
          style={{ width: 360, maxHeight: '85%', backgroundColor: C.surfaceContainerLowest, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder }}
        >
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 14, textTransform: 'uppercase', marginBottom: 14 }}>
            Queue Colour
          </Text>
          {presets.length ? (
            <PresetsTab presets={presets} onPick={(p) => { onSelect(p); onClose(); }} />
          ) : (
            <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 12 }}>
              No colour palettes available.
            </Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flex: 1, paddingVertical: 8, borderRadius: 6,
        backgroundColor: active ? C.primary : 'transparent',
        alignItems: 'center',
      }}
    >
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
        color: active ? '#000' : C.secondary,
        textTransform: 'uppercase', letterSpacing: 1,
      }}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * Presets grid. Each card shows the pair as a split-circle swatch + the
 * curated name. Tap applies BOTH hues and dismisses — one tap is the
 * whole interaction (the engine fades to the new pair).
 */
function PresetsTab({ presets, onPick }: { presets: ColorPalettePreset[]; onPick: (p: ColorPalettePreset) => void }) {
  const C = usePalette();
  return (
    <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
      {presets.map((p) => (
        <TouchableOpacity
          key={p.id}
          onPress={() => onPick(p)}
          style={{
            width: '47%',
            paddingVertical: 12, paddingHorizontal: 10,
            borderRadius: 10, borderWidth: 1, borderColor: C.ghostBorder,
            backgroundColor: C.surface,
            alignItems: 'center', gap: 8,
          }}
          accessibilityLabel={`Apply ${p.name} palette`}
          accessibilityRole="button"
        >
          <DualSwatch h1={p.c1} h2={p.c2} size={48} />
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
            color: C.text, textTransform: 'uppercase', letterSpacing: 0.5,
            textAlign: 'center',
          }} numberOfLines={1}>
            {p.name}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

/**
 * Manual tab — two hue sliders (C1 top, C2 below). Dragging writes the
 * rig LIVE (the parent throttles + fades), so the operator "plays" the
 * colour. APPLY just confirms; CANCEL reverts.
 */
function ManualTab({ h1, h2, setH1, setH2 }: {
  h1: number; h2: number;
  setH1: (v: number) => void; setH2: (v: number) => void;
}) {
  const C = usePalette();
  return (
    <View style={{ gap: 16 }}>
      <HueRow label="Colour 1" h={h1} setH={setH1} />
      <HueRow label="Colour 2" h={h2} setH={setH2} />
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon }}>
        Drag to play colours live. Saturation and brightness stay at 100%.
      </Text>
    </View>
  );
}

function HueRow({ label, h, setH }: { label: string; h: number; setH: (v: number) => void }) {
  const C = usePalette();
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10, textTransform: 'uppercase' }}>{label}</Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 10 }}>{Math.round(h * 360)}°</Text>
      </View>
      <HorizontalFader
        value={h}
        onChange={(v: number) => setH(v)}
        trackStyle={{ height: 24, backgroundColor: C.surfaceContainerHigh, borderRadius: 12 }}
        fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: hsvToRgbString(h, FULL_S, FULL_V), borderRadius: 12 }}
      />
    </View>
  );
}

/**
 * TRANSITION field — the global colour-fade time in seconds. A plain
 * numeric text field (operator request 2026-06-13): type a number, it
 * commits to the engine's `colorTransitionMs` on submit/blur. 0 = snap.
 */
function TransitionField({ value, onChangeText, onCommit }: {
  value: string; onChangeText: (t: string) => void; onCommit: () => void;
}) {
  const C = usePalette();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.ghostBorder,
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          Transition
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', color: C.icon, fontSize: 10, marginTop: 2 }}>
          Fade time when colours change · 0 = instant
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onCommit}
          onBlur={onCommit}
          keyboardType="decimal-pad"
          returnKeyType="done"
          accessibilityLabel="Colour transition time in seconds"
          placeholder="0"
          placeholderTextColor={C.icon}
          style={{
            width: 64, textAlign: 'right',
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 16, color: C.text,
            backgroundColor: C.surfaceContainerHigh,
            borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
            paddingVertical: 8, paddingHorizontal: 10,
          }}
        />
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary, fontSize: 12 }}>s</Text>
      </View>
    </View>
  );
}

/**
 * Split-circle swatch showing both palette hues at once. Used in the
 * modal header, every preset card, and the Deck/Mixer COLORS button.
 */
export function DualSwatch({ h1, h2, size }: { h1: number; h2: number; size: number }) {
  const C = usePalette();
  const r = size / 2;
  return (
    <View style={{
      width: size, height: size, borderRadius: r,
      borderWidth: 2, borderColor: C.ghostBorder,
      overflow: 'hidden', flexDirection: 'row',
    }}>
      <View style={{ flex: 1, backgroundColor: hsvToRgbString(h1, FULL_S, FULL_V) }} />
      <View style={{ flex: 1, backgroundColor: hsvToRgbString(h2, FULL_S, FULL_V) }} />
    </View>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

// Leading + trailing throttle. Fires immediately if the interval has
// elapsed, otherwise schedules a single trailing call with the latest
// args so the final slider position always lands. Returns `[call, cancel]`
// — `cancel()` drops any pending trailing write, which APPLY/CANCEL use so
// a just-released drag can't clobber the final/baseline write a few ms
// later (the modal stays mounted, so the timer would otherwise survive).
function useThrottle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const lastRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<A | null>(null);
  const cancel = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    pendingRef.current = null;
  }, []);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const call = useCallback((...args: A) => {
    pendingRef.current = args;
    const now = Date.now();
    const remaining = ms - (now - lastRef.current);
    if (remaining <= 0) {
      lastRef.current = now;
      fnRef.current(...args);
    } else if (!timerRef.current) {
      timerRef.current = setTimeout(() => {
        lastRef.current = Date.now();
        timerRef.current = null;
        if (pendingRef.current) fnRef.current(...pendingRef.current);
      }, remaining);
    }
  }, [ms]);
  return [call, cancel] as const;
}

// ms → friendly seconds string ("0", "0.8", "2.5").
function formatSeconds(ms: number): string {
  const sec = (Number.isFinite(ms) ? ms : 0) / 1000;
  return String(Math.round(sec * 10) / 10);
}

// Local hsv→rgb so this module doesn't depend on the helper colocated
// in CPCControls.tsx. Pinned to the same FULL_S/FULL_V policy.
function hsvToRgbString(h: number, s: number, v: number) {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}
