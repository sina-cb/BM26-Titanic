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
import { CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS } from '@/utils/modal_orientation';
import { usePalette } from '@/hooks/use-theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { useSharedParamValues } from '@/hooks/useEngineState';
import {
  fetchColorPairs,
  fetchColorPaletteVisibility,
  getCachedColorPalettes,
  saveColorPairs,
  saveColorPaletteVisibility,
  updateParamCenter,
  warmColorPalettesCache,
} from '@/utils/api';
import { opConfirm, opError, opInfo, opPrompt } from '@/utils/op_dialog';
import {
  addPalettePreset,
  buildPalettePreset,
  normalizeColorPairs,
  PRESET_NAME_MAX,
  type PalettePreset,
} from '@/components/deck/colors_window_logic';
import {
  buildColorPresetLibrary,
  canRemoveColorPalette,
  type ColorPalettePreset,
  type MenuColorPalettePreset,
} from '@/components/color_preset_library';
import {
  PALETTE_PICKER_CARD_ITEM_STYLE,
  PALETTE_PICKER_CARD_STYLE,
  PALETTE_PICKER_GRID_STYLE,
} from '@/components/color_preset_library_layout';

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

// How long after a hue-fader drag ends we keep swallowing a backdrop
// dismiss. Covers the synthesised `click` react-native-web fires on the
// backdrop when a drag releases past the card edge, regardless of whether
// that click task runs before or after our 0ms flag-clear. Comfortably
// longer than the click's dispatch latency, far shorter than a deliberate
// tap-to-dismiss after the operator has stopped dragging.
const DRAG_DISMISS_GUARD_MS = 300;

export type { ColorPalettePreset } from '@/components/color_preset_library';

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
  const [presets, setPresets] = useState<MenuColorPalettePreset[]>(() => (
    buildColorPresetLibrary(getCachedColorPalettes(), [], [])
  ));
  const [savedPresets, setSavedPresets] = useState<PalettePreset[]>([]);
  const [hiddenPaletteIds, setHiddenPaletteIds] = useState<string[]>([]);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [editingPresets, setEditingPresets] = useState(false);

  // Baseline captured on open — what tap-outside / CANCEL reverts to,
  // since the Manual tab writes live while you drag.
  const baselineRef = useRef({ h1: initialH1, h2: initialH2 });

  // Live engine value of the global colour-fade time, surfaced in the
  // TRANSITION field. The field edits a local string; we commit to the
  // engine on submit/blur (not per keystroke).
  const { colorTransitionMs } = useSharedParamValues({ colorTransitionMs: 800 }) as { colorTransitionMs: number };
  const [transText, setTransText] = useState('');

  // Latest props, read by the seed effect below WITHOUT keying it on them.
  // initialH1/initialH2 come from the LIVE engine params in the parent, so a
  // Manual-tab drag writes a colour → the engine broadcasts it back → these
  // props change WHILE the modal is open. Keying the seed effect on them
  // (the old deps) re-ran it mid-drag, snapping the tab back to `initialTab`
  // (Presets) and the hue back to the broadcast value — unmounting the fader
  // and the Manual pane under the operator's finger. That's the "colour
  // picker disappears when I drag" bug. We seed ONLY on the open transition.
  const initialH1Ref = useRef(initialH1);
  const initialH2Ref = useRef(initialH2);
  const initialTabRef = useRef(initialTab);
  const colorTransitionMsRef = useRef(colorTransitionMs);
  initialH1Ref.current = initialH1;
  initialH2Ref.current = initialH2;
  initialTabRef.current = initialTab;
  colorTransitionMsRef.current = colorTransitionMs;

  // Reset working state to live engine values every time the modal opens
  // (the rising edge of `visible` only), and snapshot the baseline for
  // revert. Seeding on open — not on prop changes — is what stops a live
  // drag's own feedback from resetting the tab/hue mid-gesture.
  useEffect(() => {
    if (visible) {
      setH1(initialH1Ref.current);
      setH2(initialH2Ref.current);
      setTab(initialTabRef.current);
      setEditingPresets(false);
      baselineRef.current = { h1: initialH1Ref.current, h2: initialH2Ref.current };
      setTransText(formatSeconds(colorTransitionMsRef.current));
    }
    // Initial* and colorTransitionMs are read via refs (latest value at the
    // moment the modal opens) so they are intentionally NOT dependencies —
    // we seed only when `visible` flips, never on a live broadcast.
  }, [visible]);

  const rebuildPresetMenu = useCallback((saved: PalettePreset[], hidden: string[]) => {
    setSavedPresets(saved);
    setHiddenPaletteIds(hidden);
    setPresets(buildColorPresetLibrary(getCachedColorPalettes(), saved, hidden));
  }, []);

  // The preset chooser is the union of the curated show catalog and the
  // scene-owned palettes saved from the COLORS workspace. Both are refreshed
  // on every open so a save/delete made anywhere appears here immediately.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      await warmColorPalettesCache({ force: getCachedColorPalettes().length === 0 });
      const [savedResult, visibilityResult] = await Promise.all([
        fetchColorPairs(),
        fetchColorPaletteVisibility(),
      ]);
      if (cancelled) return;
      if (!savedResult.ok || !visibilityResult.ok) {
        const reason = savedResult.ok ? visibilityResult.error : savedResult.error;
        setPresetError(reason || 'engine unreachable');
        return;
      }
      try {
        const saved = normalizeColorPairs(savedResult.data);
        const hidden = visibilityResult.data?.hiddenPaletteIds ?? [];
        rebuildPresetMenu(saved, hidden);
        setPresetError(null);
      } catch (error: any) {
        setPresetError(error?.message || String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [visible, rebuildPresetMenu]);

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

  const saveCurrentPreset = useCallback(async () => {
    const draft = buildPalettePreset({ c1: h1, c2: h2, name: '' });
    const probe = addPalettePreset(savedPresets, draft);
    if (!probe.ok) {
      opError('Palette not saved', probe.reason);
      return;
    }
    let name: string | null;
    try {
      name = await opPrompt({
        title: 'Save colour preset',
        message: 'This saves the current A/B pair into the shared COLORS preset menu on every iPad.',
        placeholder: 'unnamed',
        maxLength: PRESET_NAME_MAX,
        submitLabel: 'SAVE PRESET',
        swatches: [`hsl(${Math.round(h1 * 360)}, 100%, 50%)`, `hsl(${Math.round(h2 * 360)}, 100%, 50%)`],
      });
    } catch (error: any) {
      opError('Could not ask for a palette name', error?.message || String(error));
      return;
    }
    if (name === null) return;
    const next = addPalettePreset(savedPresets, {
      ...draft,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    if (!next.ok) {
      opError('Palette not saved', next.reason);
      return;
    }
    const result = await saveColorPairs(next.presets);
    if (!result.ok) {
      opError('Palette not saved', result.error || 'engine unreachable');
      return;
    }
    try {
      const saved = normalizeColorPairs(result.data);
      rebuildPresetMenu(saved, hiddenPaletteIds);
      setPresetError(null);
      setEditingPresets(false);
      setTab('presets');
      opInfo('Palette saved', 'It is now available in the shared COLORS preset menu.');
    } catch (error: any) {
      setPresetError(error?.message || String(error));
      opError('Palette saved but could not be displayed', error?.message || String(error));
    }
  }, [h1, h2, savedPresets, hiddenPaletteIds, rebuildPresetMenu]);

  const removePreset = useCallback(async (preset: MenuColorPalettePreset) => {
    if (!canRemoveColorPalette(preset)) return;
    let confirmed = false;
    try {
      confirmed = await opConfirm({
        title: 'Remove colour preset?',
        message: preset.source === 'saved'
          ? `Delete "${preset.name}" from the shared preset menu on every iPad?`
          : `Hide "${preset.name}" from the shared operator menu? The engine keeps it available for authored shows.`,
        confirmLabel: 'REMOVE',
      });
    } catch (error: any) {
      opError('Could not confirm palette removal', error?.message || String(error));
      return;
    }
    if (!confirmed) return;

    if (preset.source === 'saved') {
      if (preset.savedIndex === null || !savedPresets[preset.savedIndex]) {
        opError('Palette not removed', 'The saved palette list changed. Reopen COLORS and try again.');
        return;
      }
      const next = savedPresets.filter((_, index) => index !== preset.savedIndex);
      const result = await saveColorPairs(next);
      if (!result.ok) {
        opError('Palette not removed', result.error || 'engine unreachable');
        return;
      }
      try {
        rebuildPresetMenu(normalizeColorPairs(result.data), hiddenPaletteIds);
        opInfo('Palette removed', `Deleted "${preset.name}" from every iPad.`);
      } catch (error: any) {
        setPresetError(error?.message || String(error));
      }
      return;
    }

    const nextHidden = [...hiddenPaletteIds, preset.id];
    const result = await saveColorPaletteVisibility(nextHidden);
    if (!result.ok) {
      opError('Palette not removed', result.error || 'engine unreachable');
      return;
    }
    const hidden = result.data?.hiddenPaletteIds ?? nextHidden;
    rebuildPresetMenu(savedPresets, hidden);
    opInfo('Palette removed', `Hidden "${preset.name}" from the shared operator menu.`);
  }, [savedPresets, hiddenPaletteIds, rebuildPresetMenu]);

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

  // Drag guard for the Manual hue faders. On react-native-web a horizontal
  // drag that starts on a fader but releases past the card's edge makes the
  // browser synthesise a `click` on the nearest common ancestor of the
  // pointerdown/pointerup targets — the backdrop — which fires its
  // onPress={cancel} and dismisses the modal mid-scrub. PanResponder capture
  // moves the fader but does NOT suppress that synthetic click.
  //
  // We guard the backdrop two ways so it's robust to event-loop ordering
  // (RNW does not reliably dispatch that click in the same task as the
  // pointer-up): (1) a live `draggingRef` set on grant, and (2) a
  // `lastDragEndRef` timestamp. On release we stamp the time AND clear the
  // live flag on a 0ms timeout. The backdrop bails while a drag is live OR
  // if one ended within DRAG_DISMISS_GUARD_MS — so the synthesised click is
  // swallowed whether it arrives before or after the timeout runs. Native is
  // unaffected (no synthetic click; a real tap-outside is never within the
  // guard window of a drag it didn't start).
  const draggingRef = useRef(false);
  const lastDragEndRef = useRef(0);
  const onFaderDragStart = useCallback(() => { draggingRef.current = true; }, []);
  const onFaderRelease = useCallback(() => {
    lastDragEndRef.current = Date.now();
    setTimeout(() => { draggingRef.current = false; }, 0);
  }, []);
  const shouldSwallowBackdrop = useCallback(
    () => draggingRef.current || Date.now() - lastDragEndRef.current < DRAG_DISMISS_GUARD_MS,
    [],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}
      supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}
    >
      {/* Backdrop: tapping anywhere outside the card cancels (docs/36 §6). */}
      <Pressable
        onPress={() => { if (shouldSwallowBackdrop()) return; cancel(); }}
        accessibilityLabel="Close colour picker"
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}
      >
        {/* Card swallows taps so interacting inside never dismisses. */}
        <Pressable
          onPress={() => {}}
          style={[PALETTE_PICKER_CARD_STYLE, {
            maxHeight: '85%', backgroundColor: C.surfaceContainerLowest, padding: 20,
            borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder,
          }]}
        >
          {/* ── Header: title + live combined preview ──────────────── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 14, textTransform: 'uppercase' }}>
              Colours
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {tab === 'presets' && hasPresets ? (
                <TouchableOpacity
                  onPress={() => setEditingPresets((value) => !value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: editingPresets }}
                  accessibilityLabel={editingPresets ? 'Finish editing color presets' : 'Edit color presets'}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 7,
                    borderWidth: 1,
                    borderColor: editingPresets ? C.primary : C.ghostBorder,
                    backgroundColor: editingPresets ? C.primaryContainer : C.surface,
                  }}
                >
                  <Text style={{
                    fontFamily: 'SpaceGrotesk_700Bold',
                    color: editingPresets ? C.primary : C.secondary,
                    fontSize: 10,
                    letterSpacing: 0.6,
                  }}>
                    {editingPresets ? 'DONE' : 'EDIT'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <DualSwatch h1={h1} h2={h2} size={44} />
            </View>
          </View>

          {presetError ? (
            <Text style={{ color: C.error, fontFamily: 'Inter_400Regular', fontSize: 10, marginBottom: 10 }}>
              {`Saved presets unavailable: ${presetError}`}
            </Text>
          ) : null}

          {/* ── Tab bar (only shown if we actually have presets) ───── */}
          {hasPresets ? (
            <View style={{ flexDirection: 'row', marginBottom: 14, borderRadius: 8, backgroundColor: C.surfaceContainerHigh, padding: 3 }}>
              <TabButton label="Presets" active={tab === 'presets'} onPress={() => setTab('presets')} />
              <TabButton label="Manual"  active={tab === 'manual'}  onPress={() => setTab('manual')} />
            </View>
          ) : null}

          {/* ── Tab body ───────────────────────────────────────────── */}
          {tab === 'presets' && hasPresets ? (
            <PresetsTab
              presets={presets}
              editing={editingPresets}
              onPick={pickPreset}
              onRemove={(preset) => { void removePreset(preset); }}
            />
          ) : (
            <ManualTab
              h1={h1}
              h2={h2}
              setH1={onManualH1}
              setH2={onManualH2}
              onDragStart={onFaderDragStart}
              onRelease={onFaderRelease}
            />
          )}

          {/* ── Transition time (always visible, both tabs) ────────── */}
          <TransitionField
            value={transText}
            onChangeText={setTransText}
            onCommit={commitTransition}
          />

          {/* ── Footer (Manual-only — presets apply on tap) ───────── */}
          {tab === 'manual' || !hasPresets ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, alignItems: 'center', gap: 8 }}>
              <TouchableOpacity onPress={cancel} style={{ padding: 12 }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.secondary }}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { void saveCurrentPreset(); }}
                disabled={presetError !== null}
                accessibilityRole="button"
                accessibilityState={{ disabled: presetError !== null }}
                style={{
                  borderWidth: 1,
                  borderColor: C.primary,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderRadius: 8,
                  opacity: presetError !== null ? 0.45 : 1,
                }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 11 }}>
                  SAVE PRESET
                </Text>
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}
      supportedOrientations={CAPTAIN_PAD_MODAL_SUPPORTED_ORIENTATIONS}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close queue picker"
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}
      >
        <Pressable
          onPress={() => {}}
          style={[PALETTE_PICKER_CARD_STYLE, {
            maxHeight: '85%', backgroundColor: C.surfaceContainerLowest, padding: 20,
            borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder,
          }]}
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
function PresetsTab({ presets, editing = false, onPick, onRemove }: {
  presets: ColorPalettePreset[];
  editing?: boolean;
  onPick: (p: ColorPalettePreset) => void;
  onRemove?: (p: MenuColorPalettePreset) => void;
}) {
  const C = usePalette();
  return (
    <ScrollView
      style={{ alignSelf: 'stretch', maxHeight: 360, minWidth: 0 }}
      contentContainerStyle={PALETTE_PICKER_GRID_STYLE}
    >
      {presets.map((p) => {
        const menuPreset = 'source' in p ? p as MenuColorPalettePreset : null;
        const removable = menuPreset ? canRemoveColorPalette(menuPreset) : false;
        return (
          <TouchableOpacity
            key={p.id}
            onPress={() => {
              if (editing) {
                if (menuPreset && removable) onRemove?.(menuPreset);
                return;
              }
              onPick(p);
            }}
            disabled={editing && !removable}
            style={[PALETTE_PICKER_CARD_ITEM_STYLE, {
              paddingVertical: 12, paddingHorizontal: 10,
              borderRadius: 10, borderWidth: 1,
              borderColor: editing && removable ? C.error : C.ghostBorder,
              backgroundColor: C.surface,
              alignItems: 'center', gap: 8,
              opacity: editing && !removable ? 0.58 : 1,
            }]}
            accessibilityLabel={editing
              ? removable ? `Remove ${p.name} palette` : `${p.name} palette is protected`
              : `Apply ${p.name} palette`}
            accessibilityRole="button"
            accessibilityState={{ disabled: editing && !removable }}
          >
            <DualSwatch h1={p.c1} h2={p.c2} size={48} />
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
              color: C.text, textTransform: 'uppercase', letterSpacing: 0.5,
              textAlign: 'center',
            }} numberOfLines={1}>
              {p.name}
            </Text>
            {editing ? (
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: 9,
                color: removable ? C.error : C.secondary,
                letterSpacing: 0.6,
              }}>
                {removable ? 'REMOVE' : '\u2605 LOCKED'}
              </Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/**
 * Manual tab — two hue sliders (C1 top, C2 below). Dragging writes the
 * rig LIVE (the parent throttles + fades), so the operator "plays" the
 * colour. APPLY just confirms; CANCEL reverts.
 */
function ManualTab({ h1, h2, setH1, setH2, onDragStart, onRelease }: {
  h1: number; h2: number;
  setH1: (v: number) => void; setH2: (v: number) => void;
  onDragStart: () => void; onRelease: () => void;
}) {
  const C = usePalette();
  return (
    <View style={{ gap: 16 }}>
      <HueRow label="Colour 1" h={h1} setH={setH1} onDragStart={onDragStart} onRelease={onRelease} />
      <HueRow label="Colour 2" h={h2} setH={setH2} onDragStart={onDragStart} onRelease={onRelease} />
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.icon }}>
        Drag to play colours live. Saturation and brightness stay at 100%.
      </Text>
    </View>
  );
}

function HueRow({ label, h, setH, onDragStart, onRelease }: {
  label: string; h: number; setH: (v: number) => void;
  onDragStart: () => void; onRelease: () => void;
}) {
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
        onDragStart={onDragStart}
        onRelease={onRelease}
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
