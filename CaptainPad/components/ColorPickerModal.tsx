/**
 * ColorPickerModal — single tabbed modal for both global colours.
 *
 * The Deck used to expose two separate "C1" and "C2" hue-only swatches
 * that each opened their own modal. The May 2026 redesign collapsed
 * both colours behind one COLORS button so the operator can either tap
 * a curated preset pair (Presets tab) or tweak the two hues individually
 * (Manual tab) — all in one place.
 *
 * S/V are still locked to 100% on write — see the "always pure" rationale
 * in CPCControls.tsx. Curated pairs are loaded from the engine
 * (`GET /color-palettes`, sourced from config.yaml → `colorPalettes:`).
 *
 * The Apply button writes BOTH `colorPalette1` and `colorPalette2` in a
 * single `/param-center` POST so the engine's broadcast round-trips a
 * single sharedParams update — no flicker between hue changes.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { getCachedColorPalettes, updateParamCenter, warmColorPalettesCache } from '@/utils/api';

// Picker policy: hue-only. Every write pins S=V=1.0. Stage lights
// should stay punchy; if we ever want stage-dim, do it as a separate
// brightness param, not by re-opening S/V in this picker.
const FULL_S = 1;
const FULL_V = 1;

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
  // Initialise from the module-level cache (warmed at app boot in
  // _layout.tsx) so the Presets tab renders immediately on first open.
  // The previous version started with [] and depended on a per-open
  // fetch landing before the user finished a tap; on a fresh app start
  // that fetch often raced api_base resolution and the modal would
  // open with an empty grid.
  const [presets, setPresets] = useState<ColorPalettePreset[]>(() => getCachedColorPalettes());

  // Reset working hues to the live engine values every time the modal
  // is reopened. Without this, edits made then cancelled would leak
  // into the next open as stale defaults.
  useEffect(() => {
    if (visible) {
      setH1(initialH1);
      setH2(initialH2);
      setTab(initialTab);
    }
  }, [visible, initialH1, initialH2, initialTab]);

  // Cache-first preset load. Module-level cache is populated by the app's
  // root layout on boot; we use it synchronously above. When the modal
  // opens we ALSO kick a background refresh so:
  //   1. If the boot warm hit a transient engine-offline window and the
  //      cache is still empty, this attempt self-heals.
  //   2. If the engine's curated `colorPalettes:` list changed since the
  //      last warm (operator edited config.yaml + reload), the modal
  //      picks up the new pairs without an app restart.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      // Sync from the latest cache first — if the boot warm finished
      // AFTER this component mounted (e.g. opened deck before cache
      // settled, then opened the picker), useState's initial value
      // would still be the empty snapshot we captured at mount.
      // Operator bug May 26 2026: deck color picker showed Manual
      // tab only while the mixer (mounted later) showed presets.
      const cached = getCachedColorPalettes();
      if (cached.length > 0 && presets.length === 0 && !cancelled) {
        setPresets(cached);
      }
      const next = await warmColorPalettesCache({ force: presets.length === 0 && cached.length === 0 });
      if (cancelled) return;
      if (Array.isArray(next) && next.length > 0) {
        // Set unconditionally when we have items — comparing by reference
        // could miss an in-place cache refresh. The render below is cheap.
        if (presets.length === 0 || next !== presets) setPresets(next);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, presets]);

  const apply = useCallback((nextH1: number, nextH2: number, andClose = true) => {
    // Atomic both-colour write so the engine broadcasts one
    // sharedParams update — no flicker between C1 and C2 hops.
    updateParamCenter({
      colorPalette1: { h: nextH1, s: FULL_S, v: FULL_V },
      colorPalette2: { h: nextH2, s: FULL_S, v: FULL_V },
    });
    if (andClose) onClose();
  }, [onClose]);

  const hasPresets = presets.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: 360, maxHeight: '85%', backgroundColor: C.surfaceContainerLowest, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder }}>
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
            <PresetsTab presets={presets} onPick={(p) => { setH1(p.c1); setH2(p.c2); apply(p.c1, p.c2, true); }} />
          ) : (
            <ManualTab h1={h1} h2={h2} setH1={setH1} setH2={setH2} />
          )}

          {/* ── Footer (Manual-only — presets apply on tap) ───────── */}
          {tab === 'manual' || !hasPresets ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, alignItems: 'center' }}>
              <TouchableOpacity onPress={onClose} style={{ padding: 12 }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary }}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => apply(h1, h2, true)}
                style={{ backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#000' }}>APPLY</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

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
 * Presets grid. Each card shows the pair as a split-circle swatch +
 * the curated name. Tap applies BOTH hues atomically and dismisses
 * the modal — a single tap is the whole interaction.
 */
function PresetsTab({ presets, onPick }: { presets: ColorPalettePreset[]; onPick: (p: ColorPalettePreset) => void }) {
  const C = usePalette();
  return (
    <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
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
 * Manual tab — two hue sliders side-by-side (C1 on top, C2 below) so
 * operators who need a one-off colour can still get it without leaving
 * the picker. APPLY in the footer commits both as a single write.
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
        Saturation and brightness are locked to 100% to keep stage colours pure.
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
 * Split-circle swatch showing both palette hues at once. Used in the
 * modal header (live preview of pending change) and in every preset
 * card. We render two half-circles via a clipped overlay so we don't
 * need an SVG dependency.
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
