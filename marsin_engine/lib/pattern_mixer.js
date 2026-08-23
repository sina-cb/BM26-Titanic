import fs from 'fs';
import path from 'path';

import { PatternChannel } from './pattern_channel.js';
import { buildMaskRegistry } from './mask_registry.js';
import {
  DEFAULT_LAYER_TRANSITION_DURATION_MS,
  LAYER_SETTING_IDS,
  LayerSurfaceRouter,
} from './layer_surface_router.js';
import { isDeckTransitionMode } from './transition_modes.js';

// ── View-selection masking ─────────────────────────────────────────────
// See docs/27_[todo]_mixer_layer_view_selection.md §4.
//
// `compileViewSelectionMask` turns the per-channel viewSelection config
// into a fast Uint8Array lookup: mask[i] === 1 means "this channel's
// output may be committed to pixel i", 0 means "ignore". We return null
// as the cheap-path sentinel meaning "ALL pixels selected", so the hot
// render loop can short-circuit the per-pixel check entirely.
//
// IMPORTANT: callers MUST validate viewSelection shape (see
// validateViewSelection in api_server.js) before passing it in here.
// This function does not throw on bad shapes — it logs and returns null
// (fall back to ALL) so the render loop never hangs on a malformed
// config, but the upstream API path should refuse the write so the
// operator sees the error immediately.
//
// `viewMasks` (optional) is the model's named-view-mask dictionary:
//   [{ name: 'MainShow', bit: 2 }, ...]
// When viewSelection.type === 'viewMask' and target is a string, we
// resolve the bit by name lookup. If target is a positive integer the
// legacy bitmask path is used (also handy when no named dictionary is
// available, e.g. in unit tests). An unresolvable name THROWS (codex P0,
// no fallbacks — report 20260618_2 §6 Q1): the old behaviour silently
// resolved an unknown name to bit 0, producing an all-zero mask (a
// silent black-out) and only console.warn'ing. Callers that must keep
// rendering through a transient name miss (the mixer's hot-reload path)
// catch this and keep the previous compiled mask; every other path lets
// it propagate so a typo fails loudly at config time.
export function compileViewSelectionMask({ pixels, pixelCount, viewSelection, viewMasks = [], maskRegistry = null }) {
  if (!viewSelection || viewSelection.type === 'all') return null;
  if (!Array.isArray(pixels) || pixels.length === 0) return null;

  const mask = new Uint8Array(pixelCount);
  const target = viewSelection.target;
  const invert = !!viewSelection.invert;

  // Tier-A fast path (report 20260618_2 §3.3): when a MaskRegistry is
  // available and the target names a registered mask, resolve straight to
  // its per-pixel `members[]` — NO viewMask bit needed. This is what
  // lifts the 31-mask ceiling for live/host-side selection: a named mask
  // usable here costs zero bits. The in-VM `viewMask & MASK_X` path
  // (patterns) is untouched and still bit-backed.
  if (viewSelection.type === 'viewMask' && typeof target === 'string' && maskRegistry) {
    const entry = maskRegistry.get(target);
    if (!entry) {
      throw new Error(`Unknown viewMask name '${target}' — no such named view in this model. ` +
        `Known viewMasks: [${maskRegistry.names().join(', ')}]`);
    }
    const members = entry.members;
    for (let i = 0; i < pixelCount; i++) {
      const inView = i < members.length && members[i] === 1;
      mask[i] = invert ? (inView ? 0 : 1) : (inView ? 1 : 0);
    }
    return mask;
  }

  // Legacy bit path: integer-bit targets, and string targets when no
  // registry is supplied (e.g. unit tests passing a raw viewMasks array).
  // Resolve the target to its bit BEFORE the per-pixel loop so the hot
  // path stays integer-only. An unknown name / wrong-typed target THROWS
  // — masking nothing would be a silent black-out (codex P0).
  let resolvedViewMaskBit = null;
  if (viewSelection.type === 'viewMask') {
    if (typeof target === 'number' && Number.isInteger(target)) {
      resolvedViewMaskBit = target;
    } else if (typeof target === 'string') {
      const entry = Array.isArray(viewMasks)
        ? viewMasks.find(vm => vm && vm.name === target)
        : null;
      if (!entry || !Number.isInteger(entry.bit)) {
        const known = (viewMasks || []).map(v => v && v.name).filter(Boolean).join(', ');
        throw new Error(`Unknown viewMask name '${target}' — no such named view in this model. ` +
          `Known viewMasks: [${known}]`);
      }
      resolvedViewMaskBit = entry.bit;
    } else {
      throw new Error(`viewMask target must be a string name or integer bit, got ${typeof target}`);
    }
  }

  for (let i = 0; i < pixelCount; i++) {
    const px = pixels[i] || {};
    let match = false;
    switch (viewSelection.type) {
      case 'group':
        match = px.group === target;
        break;
      case 'section': {
        const sectionId = px.sId ?? px.sectionId;
        match = sectionId === target;
        break;
      }
      case 'fixture': {
        const fixtureId = px.fId ?? px.fixtureId;
        match = fixtureId === target;
        break;
      }
      case 'viewMask': {
        const viewMask = px.vMask ?? px.viewMask ?? 0;
        match = resolvedViewMaskBit !== 0 && (viewMask & resolvedViewMaskBit) !== 0;
        break;
      }
      default:
        // Unknown type: surface noise once and treat as ALL so we never
        // silently mask the whole rig to black. The API validator should
        // have caught this; if we got here something is wrong upstream.
        console.warn(`[PatternMixer] Unknown viewSelection type '${viewSelection.type}'; treating as ALL`);
        return null;
    }
    mask[i] = invert ? (match ? 0 : 1) : (match ? 1 : 0);
  }
  return mask;
}

// Copy one 6ch pixel (RGBWAU) from src into dst at the given index.
// Inlined-by-hand on purpose — V8 won't inline through Uint8Array views
// reliably at 40 Hz × ~50–5000 pixel counts, and a tight 6-byte copy
// avoids the overhead of Uint8Array.prototype.set sliced views.
function copyPixel6(dst, src, pixelIndex) {
  const o = pixelIndex * 6;
  dst[o + 0] = src[o + 0];
  dst[o + 1] = src[o + 1];
  dst[o + 2] = src[o + 2];
  dst[o + 3] = src[o + 3];
  dst[o + 4] = src[o + 4];
  dst[o + 5] = src[o + 5];
}

// Per-channel Hue shift (docs/39 §F-hue). Rotates the RGB hue of an
// interleaved 6ch RGBWAU Uint8Array (0-255) IN PLACE, leaving the W/A/U
// bytes BYTE-FOR-BYTE untouched (mission-critical exterior whites carry no
// hue concept and must not be tinted/dimmed). Same luminance-preserving
// YIQ rotation as effects/hue_shift.js, expressed on 0-255 bytes:
// precompute cos/sin + the 3x3 matrix ONCE, ~9 mults/pixel, clamp 0-255.
// Allocation-free. Caller MUST gate on `degrees !== 0` so the default
// channel pays nothing.
const HUE_DEG_TO_RAD = Math.PI / 180;
function applyHueShift6chU8(buf, pixelCount, degrees) {
  if (!degrees) return; // defensive no-op (caller also gates)
  const theta = degrees * HUE_DEG_TO_RAD;
  const c = Math.cos(theta);
  const s = Math.sin(theta);

  const m00 = 0.299 + 0.701 * c + 0.168 * s;
  const m01 = 0.587 - 0.587 * c + 0.330 * s;
  const m02 = 0.114 - 0.114 * c - 0.497 * s;
  const m10 = 0.299 - 0.299 * c - 0.328 * s;
  const m11 = 0.587 + 0.413 * c + 0.035 * s;
  const m12 = 0.114 - 0.114 * c + 0.292 * s;
  const m20 = 0.299 - 0.300 * c + 1.250 * s;
  const m21 = 0.587 - 0.588 * c - 1.050 * s;
  const m22 = 0.114 + 0.886 * c - 0.203 * s;

  for (let i = 0; i < pixelCount; i++) {
    const o = i * 6;
    const r = buf[o];
    const g = buf[o + 1];
    const b = buf[o + 2];
    // Bytes 3,4,5 (W,A,U) are deliberately never read or written.
    let nr = m00 * r + m01 * g + m02 * b;
    let ng = m10 * r + m11 * g + m12 * b;
    let nb = m20 * r + m21 * g + m22 * b;
    // Round + clamp into the 0-255 byte range.
    nr = nr < 0 ? 0 : (nr > 255 ? 255 : (nr + 0.5) | 0);
    ng = ng < 0 ? 0 : (ng > 255 ? 255 : (ng + 0.5) | 0);
    nb = nb < 0 ? 0 : (nb > 255 ? 255 : (nb + 0.5) | 0);
    buf[o] = nr;
    buf[o + 1] = ng;
    buf[o + 2] = nb;
  }
}

// Commit a blended-layer result onto mixerBuffer ONLY at selected pixels.
// The unselected pixels keep whatever the previous layer painted, which
// is the whole point of view-selection: it lets a sparkle pattern on
// CH2 (masked to "Wall") overlay on top of a bioluminescence wash on
// the base channel without zeroing out the rest of the ship.
function commitBlendedLayerWithMask(mixerBuffer, blendedBuffer, pixelMask, pixelCount) {
  if (!pixelMask) {
    // Fast path: "all pixels selected" — straight buffer set, no per-pixel
    // branch. This is also the only path when viewSelection.type === 'all'.
    mixerBuffer.set(blendedBuffer);
    return;
  }
  for (let i = 0; i < pixelCount; i++) {
    if (pixelMask[i]) copyPixel6(mixerBuffer, blendedBuffer, i);
  }
}

// Zero out unselected pixels in the deck/PFL preview buffer. PFL is a
// strict "show me what THIS channel covers" view, so unselected pixels
// must read as black. (Mixer overlays do the opposite — they preserve
// the background; see commitBlendedLayerWithMask above.)
function applyPreviewMaskBlackout(buffer, pixelMask, pixelCount) {
  if (!pixelMask) return;
  for (let i = 0; i < pixelCount; i++) {
    if (!pixelMask[i]) {
      const o = i * 6;
      buffer[o + 0] = 0;
      buffer[o + 1] = 0;
      buffer[o + 2] = 0;
      buffer[o + 3] = 0;
      buffer[o + 4] = 0;
      buffer[o + 5] = 0;
    }
  }
}

// ── Deck dynamic view overrides (deck overlays) ─────────────────────────
// Layered, view-scoped overlay decks composited OVER the main deck inside
// the deck buffer (NOT through the mixer overlay stack — that feeds the
// other side of the deck/mixer crossfade). See docs/39 §deck-overlays.
//
// Cap is a hard 4 (operator ruling): a 5th add is rejected 400
// DECK_OVERLAY_OVER_CAP at the API boundary; addDeckOverlay also throws as a
// belt-and-braces fail-loud so a buggy callsite can't sneak past the cap.
export const DECK_OVERLAY_MAX = 4;
export const DECK_OVERLAY_SOURCE_MODES = Object.freeze(['playlist', 'solid']);
const DECK_OVERLAY_HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function normalizeDeckOverlayColor(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !DECK_OVERLAY_HEX_RE.test(value)) {
    throw new TypeError(`${field} must be ${nullable ? 'null or ' : ''}a #RRGGBB color`);
  }
  return value.toUpperCase();
}

function deckOverlayRgb(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** Colorize RGB by preserving each pixel's brightness envelope. */
export function applyDeckOverlayTint6ch(buffer, pixelCount, hex) {
  const [tr, tg, tb] = deckOverlayRgb(hex);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 6;
    const level = Math.max(buffer[offset], buffer[offset + 1], buffer[offset + 2]) / 255;
    buffer[offset] = Math.round(tr * level);
    buffer[offset + 1] = Math.round(tg * level);
    buffer[offset + 2] = Math.round(tb * level);
    // A selected tint means ONLY that color family should render. Native
    // white/amber/UV channels would otherwise leak untinted light around it.
    buffer[offset + 3] = 0;
    buffer[offset + 4] = 0;
    buffer[offset + 5] = 0;
  }
}

export function fillDeckOverlaySolid6ch(buffer, pixelCount, hex) {
  const [r, g, b] = deckOverlayRgb(hex);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 6;
    buffer[offset] = r;
    buffer[offset + 1] = g;
    buffer[offset + 2] = b;
    buffer[offset + 3] = 0;
    buffer[offset + 4] = 0;
    buffer[offset + 5] = 0;
  }
}

// Engine-side accent palette for deck overlays. The CaptainPad swatch list
// (CHANNEL_COLOR_SWATCHES, index.tsx) is UI-only; the engine owns this copy
// so auto-color assignment works headlessly (HIL, unit tests) and offline.
// 8 curated high-contrast hex colors — addDeckOverlay cycles through them,
// skipping any color already in use by a sibling overlay or the main deck so
// adjacent layers never collide.
export const DECK_OVERLAY_COLOR_SWATCHES = Object.freeze([
  '#FF5252', // red
  '#FFB300', // amber
  '#FFEB3B', // yellow
  '#69F0AE', // green
  '#40C4FF', // cyan
  '#448AFF', // blue
  '#B388FF', // violet
  '#FF80AB', // pink
]);

export class PatternMixer {
  constructor({ wasmHost, pixelCount, maxChannels, pixels = [], viewMasks = [], groupBits = {} }) {
    this.wasmHost = wasmHost;
    this.pixelCount = pixelCount;
    // ── Channel split (May 2026) ─────────────────────────────────────
    // Pre-split: a single `this.channels[]` held the deck channel at
    // index 0 followed by the mixer overlays. That coupling caused
    // a continuous stream of bugs where mixer-side code paths leaked
    // the deck channel into the mixer view (and vice versa) every
    // time someone forgot to filter on `baseChannelId`.
    //
    // Post-split: the deck channel and the mixer overlay stack are
    // explicitly separate fields with their own APIs:
    //
    //   - `deckChannel` (singleton) — the PFL preview channel that
    //     drives the deck buffer. Owned by /deck/* routes.
    //   - `mixerChannels[]` — the live composition stack. Owned by
    //     /mixer/* routes.
    //
    // Compatibility getters (`channels`, `baseChannelId`) are kept
    // around so legacy iteration / vis code keeps working while we
    // migrate call sites. The legacy `addChannel`/`removeChannel`/
    // `getChannel` facades route to the correct collection based on
    // current state (first add becomes the deck channel; later adds
    // become mixer channels) so internal callers don't break.
    this.deckChannel = null;
    this.mixerChannels = [];
    // Live Touch is a real, independent render setting. It never borrows the
    // Deck handle, so staging or performing a Live look cannot destroy the
    // exact Deck pattern/local-control state the operator will return to.
    this.liveTouchChannel = null;
    // ── Deck dynamic view overrides (deck overlays) ──────────────────────
    // Layered, view-scoped overlay decks composited OVER the main deck into
    // `deckBuffer` (NOT through `mixerChannels`). Each overlay IS a
    // PatternChannel (reuse the overlay-channel construction path) targeting
    // a UNIQUE view (at most one overlay per equivalent viewSelection). Order
    // = array index: deckOverlays[0] = bottom, deckOverlays[last] = top.
    // Owned by /deck/overlays/* routes. See docs/39 §deck-overlays.
    this.deckOverlays = [];
    // SHARED deck-overlay auto-advance clock (operator refinement #1): a
    // SINGLE anchor + a SINGLE delay for the ENTIRE overlay group. When the
    // shared timer crosses its delay boundary EVERY auto-advancing overlay
    // advances its own playlist cursor at the SAME instant (each to its own
    // next entry) — they never drift apart. An overlay may be individually
    // paused via its own enabled flag, but when it auto-advances it uses this
    // shared cadence + phase. `active` defaults false (opt-in; exterior
    // immunity). `_anchorMs` is the TRANSIENT wall-clock anchor (null = not
    // yet seeded; re-seeds to now on the first active tick and after each
    // advance) — never serialized. `delay_s`/`shuffle` ARE persisted.
    this.deckOverlayAutopilot = { active: false, delay_s: 30, shuffle: false };
    this._deckOverlayAnchorMs = null;
    this.master = 1.0;
    // ── Tap-tempo (docs/39 §F-phase #4) ──────────────────────────────────
    // A single GLOBAL tempo the operator taps in. `tempoBpm` is the
    // operator-facing value (null = "no tempo set", a documented schema
    // default — distinct from a tapped tempo). `_tempoMultiplier` is the
    // derived speed multiplier applied to channels that OPT IN
    // (followsTempo). 120 BPM = 1× by convention (setTempoBpm). Channels
    // that don't follow tempo are unaffected — the mission-critical
    // exterior stays on its own clock unless the operator opts it in.
    // tempoBpm is serialized as a mixer global; _tempoMultiplier is derived
    // (never serialized — recomputed from tempoBpm on restore).
    this.tempoBpm = null;
    this._tempoMultiplier = 1;
    // STICKY tempo source preference ('osc' | 'tap') — the operator's selector
    // position, persisted + broadcast so the deck and mixer UIs agree. The
    // TempoArbiter is the logic owner (reads/writes this); default 'osc' means
    // OSC auto-drives until the operator taps or selects TAP. (See tempo_arbiter.js.)
    this.tempoSourcePref = 'osc';
    // ── Grand-master timed fade (F-B) ────────────────────────────────
    // An in-flight master fade animates `master` from a start value toward
    // a target over a fixed wall-clock duration on the 40 Hz render tick.
    // Mirrors the viewFader ramp's dt-clamped, frame-rate-independent
    // approach (see renderAll6ch). `_masterFade` is null when no fade is in
    // flight; a direct setMaster() write cancels any in-flight fade so the
    // operator's hand always wins (no animation fighting a manual set).
    //   { from, to, startMs, durationMs }
    this._masterFade = null;
    // ── Group-fader timed fades (snapshot morph, round-2 #1) ─────────────
    // Parallel to `_masterFade`: an in-flight group fade animates a mix
    // group's `fader` from a start value toward a target over a fixed
    // wall-clock duration on the 40 Hz tick. Used by the snapshot
    // crossfade/morph to ramp gang-fader levels current→target alongside
    // the per-channel `transitions[]` and the grand-master `_masterFade`.
    // An array (not a single descriptor) because a morph may ramp several
    // groups at once. Each entry: { groupId, from, to, startMs, durationMs }.
    // Empty when no group fade is in flight. A direct updateMixGroup() fader
    // write cancels any in-flight fade for that group (operator's hand wins).
    this._groupFades = [];
    // ── Snapshot crossfade / morph descriptor (round-2 #1) ───────────────
    // Non-null while a snapshot morph is animating current→target. The morph
    // itself owns no per-frame interpolation — it RIDES the existing
    // transitions[] (per-channel fader ramps), _masterFade, and _groupFades
    // ticks. This descriptor only carries the wall-clock window + the set of
    // channel ids that are fading OUT (current-only channels) so the
    // finalizer can CPC-unregister + structurally remove them exactly once on
    // completion. Shape: { startMs, durationMs, fadeOutIds: string[] }.
    // The api_server owns build + CPC + the onMorphComplete finalizer.
    this._morph = null;
    this.onMorphComplete = null; // Callback: () => void — fired once when a morph's wall-clock window elapses
    // maxChannels comes from config.yaml `mixer.maxChannels`. Default 3 — the
    // CaptainPad iPad strip layout doesn't fit more than that without
    // horizontal scroll / clipping. Caps `mixerChannels.length` only —
    // the deck channel does NOT count toward this limit, since it is
    // owned by a separate route tree.
    this.maxChannels = Number.isFinite(maxChannels) && maxChannels >= 1
      ? Math.floor(maxChannels)
      : 3;

    // Model pixel mapping reference. Required for view-selection mask
    // compilation. Guarded by an alignment check: if pixels[i].i is set,
    // it MUST equal i. Out-of-order or missing indices would silently
    // mis-map the mask and paint the wrong fixtures, so we fail loudly
    // at boot rather than at first paint. See docs/27 §5 "Rigorous
    // Index Validation".
    this.pixels = Array.isArray(pixels) ? pixels : [];
    if (this.pixels.length > 0) {
      if (this.pixels.length !== this.pixelCount) {
        throw new Error(`[PatternMixer] pixels length (${this.pixels.length}) must match pixelCount (${this.pixelCount})`);
      }
      for (let i = 0; i < this.pixels.length; i++) {
        const idx = this.pixels[i] && this.pixels[i].i;
        if (idx !== undefined && idx !== i) {
          throw new Error(`[PatternMixer] Model pixel index alignment corrupted: pixels[${i}].i = ${idx}, expected ${i}`);
        }
      }
    }

    // Named view-mask dictionary from the active model:
    //   [{ name: 'MainShow', bit: 2 }, ...]
    // Used by compileViewSelectionMask to resolve viewSelection
    // { type: 'viewMask', target: '<name>' } payloads to their bit
    // value at mask-compile time. Empty array is fine — the engine
    // just won't enumerate any named view masks in
    // /model/view-selection-options and the picker will hide that
    // section in CaptainPad. Validation is defensive: drops entries
    // missing a string name or integer bit instead of throwing, so a
    // model author typo doesn't block boot.
    this.viewMasks = Array.isArray(viewMasks)
      ? viewMasks.filter(vm => vm && typeof vm.name === 'string' && vm.name.length > 0 && Number.isInteger(vm.bit))
      : [];

    // Group → bit table, kept so the MaskRegistry can be rebuilt on
    // model hot-reload (setModelViewMasks) without re-plumbing it.
    this.groupBits = (groupBits && typeof groupBits === 'object' && !Array.isArray(groupBits))
      ? groupBits : {};

    // Tier-A named-mask registry (report 20260618_2). Holds per-pixel
    // `members[]` for every base group + named preset so live/host-side
    // view selection resolves by name WITHOUT consuming a viewMask bit —
    // the 31-mask ceiling no longer limits host-side selection. The raw
    // (full, unfiltered) viewMasks feed the registry so bit-less masks
    // register too; `this.viewMasks` stays the bit-backed subset the
    // legacy bit path and the picker still read.
    this.maskRegistry = buildMaskRegistry({
      pixels: this.pixels,
      pixelCount: this.pixelCount,
      groupBits: this.groupBits,
      viewMasks: Array.isArray(viewMasks) ? viewMasks : [],
    });

    // View crossfade state (0.0 = deck exclusively, 1.0 = mixer exclusively).
    // Default to mixer view per docs/27 §2 — at engine startup the live output
    // is the composed mixerBuffer; the CaptainPad Deck tab POSTs view='deck'
    // to crossfade down to the PFL preview.
    this.viewFader = 1.0;
    this.targetViewFader = 1.0;
    // Time-based crossfade ramp (units per second). 1.0/s = a full
    // deck↔mixer swap in 1 second, matching the iPad operator's
    // mental model when they swipe between tabs (May 2026 task 5).
    // Frame-rate independent so changing config.fps doesn't break
    // the perceived ramp duration.
    this.viewFaderRampPerSec = 1.0;
    this._lastViewFaderTickMs = null;

    // Canonical three-setting router. The legacy viewFader fields remain as a
    // compatibility surface for older Deck/Mixer callers and focused tests;
    // once activateLayerSetting() is used, this router is authoritative.
    this.layerRouter = new LayerSurfaceRouter({
      initialSetting: LAYER_SETTING_IDS.MIXER,
      defaultDurationMs: DEFAULT_LAYER_TRANSITION_DURATION_MS,
      onChange: change => {
        if (!this.onLayerSettingsChange) return;
        try {
          this.onLayerSettingsChange(change);
        } catch (error) {
          console.error('[Mixer] onLayerSettingsChange threw:', error.message);
        }
      },
    });
    this._canonicalLayerRouting = false;
    this.onLayerSettingsChange = null;
    this.layerSettingOutputProcessors = new Map();
    this.liveTouchPhaseSpeedProvider = null;
    this.liveTouchOutputProcessor = null;

    // Buffer for compositing output
    this.outputBuffer = new Uint8Array(this.pixelCount * 6);
    // Buffer for individual channel output
    this.channelBuffer = new Uint8Array(this.pixelCount * 6);
    // Reusable scratch buffer for view-selection masked layer commits.
    // Pre-allocated once here so the 40 Hz render loop never triggers
    // GC for new Uint8Arrays. `blendedScratch` holds the result of a
    // host-side blend fallback (or a WASM blend copy if we ever needed
    // to mutate it). See docs/27 §4.2.
    this.blendedScratch = new Uint8Array(this.pixelCount * 6);

    // Per-key vis buffer pool (item 6). `_extractVis` used to allocate a
    // fresh `new Uint8Array(buf)` for every channel on every vis-broadcast
    // frame. The broadcast consumer (engine.js render loop) reads ALL of
    // _visData's entries synchronously in one tick (subsample + base64),
    // before the next frame runs — so a per-KEY persistent buffer is safe
    // to reuse across frames: we just copy fresh pixels into the same
    // backing array each vis frame. A single shared buffer would NOT be
    // safe (all of one frame's per-channel entries co-exist in _visData
    // until the broadcast drains them), hence keying by channel/vis id.
    this._visBufferPool = new Map();

    // ── Per-channel effective-output METERING ───────────────────────────
    // `_visLevels` maps the same vis keys used by `_visData`
    // (channel id / 'master' / '__deck_inactive__') to a cheap effective
    // output LEVEL in [0,1]: the channel's intrinsic brightness scaled by
    // the SAME effFader (fader/clamp/group/solo) that gates its
    // contribution to the composite. It answers "is this layer actually
    // putting light on the rig right now, or is it sitting dark?" — a fader
    // at 0, a muted group, or a solo gate all drive the meter to ~0 even
    // when the underlying pattern is bright.
    //
    // Computed allocation-free in the SAME pass as the vis extraction
    // (renderAll6ch step 1) — no new per-frame Uint8Array. Refilled (a
    // fresh plain object) only on vis-broadcast frames, exactly like
    // `_visData`, and drained synchronously by the broadcast each frame.
    // Absent ⇒ the client renders NO meter (documented schema default, not
    // a hidden failure — see ChannelVizStrip).
    this._visLevels = {};

    // Reusable render-order scratch (item 7). When a scripted transition
    // promotes its target channel to render LAST, we need a reordered view
    // of mixerChannels. Building `[...filter(), target]` every frame would
    // allocate two arrays per frame for the whole duration of the fade;
    // instead we rebuild this persistent array in place. Never aliased
    // outside renderAll6ch, never held across frames.
    this._renderOrderScratch = [];

    // ── Channel groups + server-authoritative solo (WAVE 15) ────────────
    // `mixGroups` is the gang-fader registry. Each MixGroup is
    //   { id: 'mg_*', name, fader (0..1), muted (bool), color (string|null) }
    // and applies a SCALE (or 0 when muted) to every member channel's
    // contribution at composite time. Membership is a channel→group pointer
    // (`channel.mixGroupId`), so members are derived, never stored here.
    this.mixGroups = [];
    this._mixGroupCounter = 0;

    // `soloedChannelIds` is the SOLE server-side source of truth for solo.
    // TRANSIENT — never persisted; cleared on restart and at the start of a
    // scripted mixer transition. When non-empty, only soloed / solo-safe /
    // fader-locked channels contribute (see _effFader). A Set so membership
    // tests are O(1) on the hot path.
    this.soloedChannelIds = new Set();

    // `_bumpedChannelIds` is the SOLE server-side source of truth for FLASH /
    // BUMP — the momentary "full while held" busking accent (round-2 #5,
    // docs/39 §10.7). DIRECTLY analogous to the solo Set: a channel in this Set
    // has its effective output OVERRIDDEN to FULL (capped only by faderMax — see
    // _effFader) for as long as it's held, then snaps back to its parked level
    // on release. TRANSIENT — never persisted; cleared on restart, on teardown,
    // at the start of a scripted mixer transition, and when a channel is
    // removed. A Set so membership tests are O(1) on the hot path. Bump
    // overrides fader + group-scale + solo-dimming so the accent ALWAYS reads;
    // it does NOT override a hard mute (enabled=false) — a muted channel never
    // bumps (mute is the operator's explicit "off", bump is an "up" gesture).
    this._bumpedChannelIds = new Set();

    // Per-frame group-scale cache (allocation-free hot path). Precomputed
    // ONCE per render frame into this reused Map (clear()+set(), never
    // realloc — mirrors _renderOrderScratch) so _effFader is pure O(1)
    // arithmetic with zero per-channel allocation. Maps group id -> scale
    // (group.muted ? 0 : group.fader). Never aliased outside renderAll6ch.
    this._groupScaleCache = new Map();

    // ── Channel FOLLOW/LINK previous-frame effective cache (round-2 #6) ──
    // A follower's composite INPUT is its leader's EFFECTIVE level (the value
    // the leader actually renders at) × the follower's followScale. We resolve
    // that by reading the leader's effective value from the PREVIOUS frame,
    // snapshotted into this reused Map at the END of every renderAll6ch (one
    // allocation-free clear()+set() pass over deck + mixer channels, mirroring
    // _groupScaleCache). This previous-frame resolution is chosen DELIBERATELY
    // over a per-frame topological resolve because it is the simplest correct
    // approach that is O(1) per channel and allocation-free: it needs no
    // ordering pass, makes the multiple _effFader calls within a single frame
    // (vis pre-pass AND composite loop) return IDENTICAL values (they all read
    // the same frozen prev-frame snapshot), and a chain (A→B→C) resolves
    // naturally with one frame of latency PER HOP. One-frame latency (25 ms at
    // 40 fps) is imperceptible for lighting and acceptable per the spec. Maps
    // channel id -> effective fader [0,1] from the previous frame; a missing
    // entry (first frame, or a leader added this frame) reads as 0 (follower
    // tracks down to 0 for one frame, then catches up — fail-safe, never a
    // spurious flash). Never aliased outside the mixer.
    this._prevEffFaderCache = new Map();

    this.transitions = []; // Active per-channel fader transitions
    this.blendHandles = {}; // Cache: blendName -> WASM handle
    this._patternsDir = null; // Backing field for the patternsDir setter below.
    this.onChannelRemoved = null; // Callback: (channelId) => void

    // ── Render-health structure (Codex P0 visibility) ────────────────────
    // The 40 Hz render loop must NEVER crash on a bad blend script (that
    // would freeze the whole rig). But it must also never silently produce
    // wrong output. This structure makes blend failures VISIBLE on /status:
    //
    //   blendErrors: { <blendName>: { message, sinceFrame, count } }
    //
    // A blend whose WASM handle is missing/failed to compile records its
    // error here ONCE and is logged loudly ONCE per mode (not per
    // frame — a 40 Hz log would bury the console). `getRenderHealth()`
    // surfaces this for the /status endpoint so an operator (or a smoke
    // check) sees `renderHealth.ok === false` immediately instead of a
    // silently-wrong fade. Cleared for a mode the moment its handle
    // compiles successfully (e.g. after a boot precompile or a hot edit).
    this.renderHealth = {
      blendErrors: {},        // blendName -> { message, sinceFrame, count }
      loggedBlendErrors: {},  // blendName -> true once we've logged it
      // ── R4 "NEVER FULLY BLACK" runtime enforcer (redteam _112 I1/I2) ────
      // The vendored WASM VM absorbs a hostile pattern into a black or solid
      // -red composite SILENTLY: a NaN in ANY arg to rgbwau()/hsv() blacks
      // the whole pixel and is absorbing in persistent state (I1); a
      // beforeRender that overruns the ~5000-instruction budget truncates
      // mid-execution with NO return channel (the marsin_begin_frame ABI is
      // bound void and the compiled WASM genuinely returns nothing — verified
      // empirically, and there is no C source in-repo to re-vendor), so the
      // mandatory palette resolve never runs and the ship renders black from a
      // pattern that COMPILED CLEAN (I2). Neither had ANY runtime signal.
      //
      // Because the NaN is already cast to 0 inside the WASM before JS ever
      // sees a byte, per-channel NaN sanitising is unreachable at this layer —
      // the enforceable, mission-aligned invariant is on the CONSEQUENCE: the
      // composite that feeds sACN must never be fully black while the mix is
      // configured to emit light. This structure tracks that:
      //
      //   darkness: {
      //     black,        // this frame fully black while light was expected
      //     blackStreak,  // consecutive such frames
      //     tripped,      // streak >= NEVER_BLACK_TRIP_FRAMES (LOUD)
      //     floorActive,  // last-resort non-black floor applied this frame
      //     solidRed,     // this frame is uniformly (255,0,0) — VM over-budget
      //     pattern,      // active deck pattern name at the trip
      //     sinceFrame,   // frame the current dark streak began
      //     message,      // human-readable trip reason
      //   }
      //
      // getRenderHealth().ok folds this in, so /status.renderHealth.ok already
      // goes false the moment the ship goes dark-while-lit — no engine wiring
      // required. Logged LOUDLY once per trip, never per frame.
      darkness: {
        black: false,
        blackStreak: 0,
        tripped: false,
        floorActive: false,
        solidRed: false,
        pattern: null,
        sinceFrame: null,
        message: null,
      },
      loggedDarkness: false,   // true once we've logged the current never-black trip
      loggedSolidRed: false,   // true once we've logged the current solid-red run
    };
    // Tunables for the never-black enforcer. TRIP is deliberately a short
    // streak (0.2 s @ 40 fps): a legitimate hard cut / crossfade passes THROUGH
    // colour, never an all-zero frame, and an operator blackout (master 0 or
    // all faders down) is gated out by _isExpectingLight(), so the ONLY way to
    // accumulate an all-zero-while-lit streak is the bug. Short enough to
    // protect the mission, long enough to ignore a 1-frame transient. The floor
    // engages at the same point so the ship is never dark for more than the trip
    // window. The floor value is a dim uniform RGB glow (clearly degraded, but
    // VISIBLE-at-night per the P0 mission).
    this.NEVER_BLACK_TRIP_FRAMES = 8;
    this.NEVER_BLACK_FLOOR_VALUE = 10;
    this._frameCounter = 0;

    // Group-transition machinery — when a triggerMixerTransition arrives
    // via the API, we register one transitionGroupId on every per-channel
    // fader transition. updateTransitions() fires progress / complete
    // callbacks at the group boundary, so the API layer can broadcast a
    // single throttled mixer-state instead of one per channel.
    this.transitionGroupCounter = 0;
    this.activeTransitionGroupId = null;
    // When a scripted transition is in flight, this is the target channel
    // id. renderAll6ch() promotes that channel to render LAST so its
    // trans_* blend script overlays every other (fading-out) overlay.
    // Without this the visual effect would be obscured by losers higher
    // up in the channels[] array. Cleared when the transition completes.
    this.scriptedTransitionTargetId = null;
    this.onTransitionProgress = null; // Callback: (groupId) => void — every frame an active transition is in flight
    this.onTransitionComplete = null; // Callback: (groupId) => void — fired once when the LAST channel in the group lands

    // ── Deck pattern-swap state (deterministic double buffer) ───────────
    // The deck renders one pattern at a time, but to get a SMOOTH switch
    // from pattern A to pattern B we need both running simultaneously
    // for the duration of the transition. The operator's mental model
    // (May 2026):
    //
    //   "the deck has 2 channels, 1 active, 1 inactive.
    //    on selecting a new pattern, we set the pattern in the inactive
    //    channel to the newly selected pattern. we transition from active
    //    to inactive channel with the settings we have for the transition
    //    and the transition mode selected. we swap the active inactive
    //    pointers."
    //
    // Implementation: `deckChannel` is the PERSISTENT ACTIVE deck channel
    // (the IDENTITY container — id, localControls, playlist, viewSelection
    // all live here forever). `_inactiveDeckChannel` is a hidden sibling
    // PatternChannel whose sole job is to hold a SECOND WASM handle —
    // it lives OUTSIDE this.channels / mixerChannels so it doesn't show
    // up in /mixer or count toward maxChannels. A parked precompile is NOT
    // ticked: every incoming pattern starts from phase zero regardless of
    // how long it waited. During a swap it composites ON TOP of deckBuffer
    // via its `fader` (driven by `_swapTransition`) and its `mode`
    // (the selected trans_* blend script, including trans_crossfade).
    //
    // On swap completion we SWAP HANDLES AND PHASE CLOCKS (not pointers) — `deckChannel`
    // keeps its id and all its operator-visible state intact; only its
    // `.handle` and `.pattern` get rebound to the newly-active pattern.
    // The OLD active handle moves into the inactive slot only as an owned
    // standby; it is marked non-fresh and cannot be reused as an incoming
    // zero-phase pattern. Sequential autopilot retains the compile-latency
    // optimization by explicitly parking a newly-compiled fresh handle.
    //
    // Handle reuse contract: callers (api_server.loadPlaylistEntryWith
    // Transition) MUST check `getInactiveDeckPattern()` BEFORE
    // compiling — if the inactive slot already holds the requested
    // pattern name AND `isInactiveDeckHandleFresh()` is true, they pass
    // `newHandle: null` and the deterministic parked handle is reused.
    // If the inactive slot is empty or holds a different pattern, the
    // caller compiles a fresh handle, the old inactive handle (if any)
    // gets destroyed, and the new handle takes over the inactive slot.
    this._inactiveDeckChannel = null;
    this._swapTransition = null;
    this.onDeckSwapComplete = null; // Callback: ({ pattern, transitionId }) => void
    this.onDeckSwapCancelled = null; // Callback: ({ transitionId }) => void

    // Live Touch base swaps use their own retained sibling. This is deliberately
    // separate from the Deck sibling: Live owns a private ParamCenter and its
    // complete effects/spatial stage runs after this base-only blend.
    this._inactiveLiveTouchChannel = null;
    this._liveTouchSwapTransition = null;
    this.onLiveTouchPatternSwapChange = null;
  }

  // ── patternsDir: setting it triggers a one-time blend precompile ─────
  // Boot wiring lives HERE (not in engine.js) on purpose: engine.js sets
  // `mixer.patternsDir = .../patterns` exactly once after construction,
  // and that single assignment is the natural hook to scan
  // patterns/channel_blends/ + patterns/transitions/ and warm every blend
  // handle BEFORE the first render frame. This removes lazy compile from
  // the 40 Hz hot path (a first-use compile could blow a frame budget and
  // produce a visible stutter) and lets the dry-run prove there are no
  // missing-blend scripts. Idempotent: re-assigning the same dir re-scans.
  set patternsDir(dir) {
    this._patternsDir = dir;
    if (dir) this.precompileAllBlends();
  }

  get patternsDir() {
    return this._patternsDir;
  }

  // Snapshot of render-health for /status. `ok` is false whenever any
  // blend is unavailable (the render path throws instead of substituting
  // another compositor). Returns a plain serializable
  // object — safe to JSON.stringify into the status payload.
  getRenderHealth() {
    const blendErrors = Object.entries(this.renderHealth.blendErrors).map(
      ([name, info]) => ({ blend: name, ...info }),
    );
    const d = this.renderHealth.darkness;
    // `ok` is false whenever ANY blend is degraded OR the never-black enforcer
    // has tripped OR the frame is solid-red (VM over-budget). All three are
    // "the rig is showing something wrong right now" and must fail a smoke
    // check identically — /status.renderHealth.ok is the single green light.
    const ok = blendErrors.length === 0 && !d.tripped && !d.solidRed;
    return {
      ok,
      frame: this._frameCounter,
      blendErrors,
      darkness: {
        black: d.black,
        blackStreak: d.blackStreak,
        tripped: d.tripped,
        floorActive: d.floorActive,
        solidRed: d.solidRed,
        pattern: d.pattern,
        sinceFrame: d.sinceFrame,
        message: d.message,
      },
    };
  }

  // Dedicated never-black snapshot (redteam _112 I1/I2 handoff for W1-1). Same
  // `darkness` object getRenderHealth() folds into `ok`, exposed standalone so a
  // caller that wants ONLY the never-black verdict (e.g. a top-level
  // /timeline/state field, or the launcher watchdog) doesn't have to reach
  // through blendErrors. `lit` is the inverse convenience flag.
  getNeverBlackHealth() {
    const d = this.renderHealth.darkness;
    return {
      lit: !d.tripped,
      black: d.black,
      blackStreak: d.blackStreak,
      tripped: d.tripped,
      floorActive: d.floorActive,
      solidRed: d.solidRed,
      pattern: d.pattern,
      sinceFrame: d.sinceFrame,
      message: d.message,
    };
  }

  // Is the mix CONFIGURED to emit light this frame? True when the grand master
  // is up AND at least one contributor (deck or a mixer overlay) is enabled with
  // an effective fader above zero, accounting for the deck↔mixer view crossfade.
  // Used to gate the never-black enforcer so a LEGITIMATE operator blackout
  // (master 0 / all faders down / everything muted) is never flagged as a fault
  // — only "should be lit but is fully black" trips.
  _isExpectingLight(soloActive) {
    if (!(this.master > 0)) return false;
    if (this.isLayerSettingRenderParticipant(LAYER_SETTING_IDS.DECK) &&
        this.deckChannel && this.deckChannel.enabled) {
      const fMax = (typeof this.deckChannel.faderMax === 'number' && Number.isFinite(this.deckChannel.faderMax))
        ? this.deckChannel.faderMax : 1.0;
      const f = Math.min(this.deckChannel.fader, fMax);
      if (f > 0) return true;
    }
    if (this.isLayerSettingRenderParticipant(LAYER_SETTING_IDS.MIXER)) {
      const solo = soloActive === undefined ? this.soloedChannelIds.size > 0 : soloActive;
      for (let i = 0; i < this.mixerChannels.length; i++) {
        if (this._effFader(this.mixerChannels[i], solo) > 0) return true;
      }
    }
    if (this.isLayerSettingRenderParticipant(LAYER_SETTING_IDS.LIVE_TOUCH) &&
        this.liveTouchChannel && this.liveTouchChannel.enabled) {
      const fMax = (typeof this.liveTouchChannel.faderMax === 'number' &&
        Number.isFinite(this.liveTouchChannel.faderMax))
        ? this.liveTouchChannel.faderMax
        : 1.0;
      return Math.min(this.liveTouchChannel.fader, fMax) > 0;
    }
    return false;
  }

  // True when every byte of a 6ch RGBWAU buffer is 0 (the whole rig dark).
  _isBufferBlack(buf) {
    for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) return false;
    return true;
  }

  // True when every pixel is exactly (255,0,0,0,0,0) — the vendored VM's
  // signature for a render3D that overran the per-pixel instruction budget
  // (redteam _112 F9). Cheap: bail on the first pixel that doesn't match.
  _isBufferSolidRed(buf) {
    const n = this.pixelCount;
    if (n === 0) return false;
    for (let p = 0; p < n; p++) {
      const k = p * 6;
      if (buf[k] !== 255 || buf[k + 1] !== 0 || buf[k + 2] !== 0
          || buf[k + 3] !== 0 || buf[k + 4] !== 0 || buf[k + 5] !== 0) {
        return false;
      }
    }
    return true;
  }

  // The enforcer proper — runs once per composited frame from renderAll6ch().
  // Records darkness state, logs LOUDLY once per trip, and applies a dim
  // last-resort floor so a persistently-black-while-lit frame is never shipped
  // fully dark. NO fallback silence: the floor only ever engages AFTER the loud
  // trip flag is set, so a floored frame is always accompanied by a health
  // error naming the offending deck pattern.
  _enforceNeverBlack() {
    const d = this.renderHealth.darkness;
    const expectLight = this._isExpectingLight();
    const solidRed = this._isBufferSolidRed(this.outputBuffer);
    const black = expectLight && !solidRed && this._isBufferBlack(this.outputBuffer);

    d.solidRed = solidRed;
    d.black = black;
    d.floorActive = false;

    if (black) {
      if (d.blackStreak === 0) d.sinceFrame = this._frameCounter;
      d.blackStreak += 1;
    } else {
      // A non-black (or not-expected-light) frame clears the streak and any
      // active trip — the ship recovered, so /status goes green again.
      if (d.tripped) {
        console.error(
          `[Mixer] RENDER-HEALTH RECOVERED: composite no longer fully black ` +
          `(was dark for ${d.blackStreak} frames since frame ${d.sinceFrame}).`,
        );
      }
      d.blackStreak = 0;
      d.tripped = false;
      d.sinceFrame = null;
      d.pattern = null;
      d.message = null;
      this.renderHealth.loggedDarkness = false;
    }

    if (d.blackStreak >= this.NEVER_BLACK_TRIP_FRAMES) {
      d.tripped = true;
      d.pattern = this.deckChannel ? this.deckChannel.pattern : null;
      d.message =
        `Composite fully BLACK for ${d.blackStreak} consecutive frames while ` +
        `the mix is lit (deck pattern '${d.pattern || '(none)'}'). A NaN in a ` +
        `colour builtin or a beforeRender budget overrun is the usual cause. ` +
        `Applying a dim last-resort floor (${this.NEVER_BLACK_FLOOR_VALUE}/255).`;
      if (!this.renderHealth.loggedDarkness) {
        this.renderHealth.loggedDarkness = true;
        console.error(
          `[Mixer] RENDER-HEALTH NEVER-BLACK TRIPPED: ${d.message} ` +
          `Visible on /status as renderHealth.ok=false. This log fires ONCE ` +
          `per trip, not per frame.`,
        );
      }
      // Last-resort non-black floor — the P0 mission is visibility at night, so
      // a persistently-black exterior gets a dim uniform glow rather than being
      // shipped dark. RGB only (W/A/UV left at 0); loud flag already set.
      const fv = this.NEVER_BLACK_FLOOR_VALUE;
      const out = this.outputBuffer;
      for (let p = 0; p < this.pixelCount; p++) {
        const k = p * 6;
        out[k] = fv; out[k + 1] = fv; out[k + 2] = fv;
      }
      d.floorActive = true;
    }

    // Solid-red is tracked with its OWN once-per-run log flag (independent of
    // the never-black trip): the rig is SHOWING solid red, the VM's silent
    // over-budget signature. ok=false already reflects it.
    if (solidRed) {
      if (!this.renderHealth.loggedSolidRed) {
        this.renderHealth.loggedSolidRed = true;
        console.error(
          `[Mixer] RENDER-HEALTH SOLID-RED: every pixel is (255,0,0) — the deck ` +
          `pattern '${this.deckChannel ? this.deckChannel.pattern : '(none)'}' is ` +
          `over the per-pixel instruction budget. Visible on /status as ` +
          `renderHealth.ok=false. This log fires ONCE per run, not per frame.`,
        );
      }
    } else {
      this.renderHealth.loggedSolidRed = false;
    }
  }

  // Scan the blend + transition pattern directories once and compile every
  // blend handle into `this.blendHandles`. Called from the patternsDir
  // setter (boot) and reusable for a manual rewarm. Records a render-health
  // error for any blend that fails to compile so the failure is VISIBLE
  // rather than silently lazy-deferred to the hot path. Never throws — a
  // single bad blend script must not block engine boot, but it MUST show
  // up on /status.
  precompileAllBlends() {
    if (!this._patternsDir) return;
    const dirs = ['channel_blends', 'transitions'];
    for (const sub of dirs) {
      const full = path.join(this._patternsDir, sub);
      if (!fs.existsSync(full)) continue;
      const files = fs.readdirSync(full).filter(f => f.endsWith('.js'));
      for (const file of files) {
        const blendName = file.replace(/\.js$/, '');
        // Force a (re)compile even if a stale entry exists so a hot edit
        // that fixed a previously-broken script clears its health error.
        this.precompileBlend(blendName);
      }
    }
  }

  // Compile a single named blend and cache the handle. On success, clears
  // any prior render-health error for that name. On failure, records the
  // error (visible on /status) and caches null (so the hot path doesn't
  // retry-compile every frame). Returns the handle or null.
  precompileBlend(blendName) {
    const handle = this._compileBlend(blendName);
    this.blendHandles[blendName] = handle;
    if (handle) {
      this._clearBlendError(blendName);
    } else {
      this._recordBlendError(
        blendName,
        `Blend script '${blendName}' failed to compile or is missing`,
      );
    }
    return handle;
  }

  // ── Render-health bookkeeping (logged loudly ONCE per mode) ──────────
  _recordBlendError(blendName, message) {
    const existing = this.renderHealth.blendErrors[blendName];
    if (existing) {
      existing.count += 1;
      existing.message = message;
    } else {
      this.renderHealth.blendErrors[blendName] = {
        message,
        sinceFrame: this._frameCounter,
        count: 1,
      };
    }
    if (!this.renderHealth.loggedBlendErrors[blendName]) {
      this.renderHealth.loggedBlendErrors[blendName] = true;
      console.error(
        `[Mixer] RENDER-HEALTH DEGRADED: ${message}. ` +
        `Rendering this mode is blocked; no fallback was substituted ` +
        `(visible on /status as renderHealth.ok=false). This log fires ` +
        `ONCE per mode, not per frame.`,
      );
    }
  }

  _clearBlendError(blendName) {
    if (this.renderHealth.blendErrors[blendName]) {
      delete this.renderHealth.blendErrors[blendName];
    }
    if (this.renderHealth.loggedBlendErrors[blendName]) {
      delete this.renderHealth.loggedBlendErrors[blendName];
    }
  }

  // ── Channel split: canonical accessors ─────────────────────────────
  // Use these. `channels`/`addChannel`/`removeChannel`/`getChannel`
  // are kept below as compatibility facades for legacy code paths.

  /** Compatibility getter: deck id (or null). Replaces the old field. */
  get baseChannelId() {
    return this.deckChannel ? this.deckChannel.id : null;
  }
  set baseChannelId(id) {
    // The only legitimate legacy writer is updateTransitions promoting
    // a transitioned overlay onto the deck. If `id` already names the
    // deck channel this is a no-op. Otherwise we re-home the matching
    // mixer overlay onto the deck slot — that's what the pre-split
    // behaviour did.
    if (!id || (this.deckChannel && this.deckChannel.id === id)) return;
    const idx = this.mixerChannels.findIndex(c => c.id === id);
    if (idx === -1) {
      console.warn(`[Mixer] baseChannelId set to '${id}' which is neither deck nor a mixer channel; ignoring`);
      return;
    }
    const promoted = this.mixerChannels.splice(idx, 1)[0];
    const demoted = this.deckChannel;
    this.deckChannel = promoted;
    if (demoted) {
      // Demote the old deck back into the mixer stack so we don't lose
      // its handle. Operators who hit this path are mid-transition.
      this.mixerChannels.unshift(demoted);
    }
  }

  /**
   * Compatibility getter: combined view of [deckChannel, ...mixerChannels].
   * Internal rendering / vis code reads this. External callers should
   * prefer `getDeckChannel()` + `getMixerChannels()` so the deck-vs-
   * mixer intent is explicit at the call site.
   */
  get channels() {
    if (this.deckChannel) return [this.deckChannel, ...this.mixerChannels];
    return [...this.mixerChannels];
  }

  /** Direct accessor for the deck channel (or null). */
  getDeckChannel() {
    return this.deckChannel;
  }

  /** Returns the LIVE mixer overlay array. Do not mutate; use add/remove APIs. */
  getMixerChannels() {
    return this.mixerChannels;
  }

  /** Return the staged/performing Live Touch channel, or null. */
  getLiveTouchChannel() {
    return this.liveTouchChannel;
  }

  /**
   * Install an independent Live Touch channel. Replacing it is explicit: the
   * caller owns the old WASM handle and must destroy/unregister it first.
   */
  setLiveTouchChannel(channelConfig) {
    const channel = new PatternChannel(channelConfig);
    this.liveTouchChannel = channel;
    this.recompileChannelMask(channel);
    return channel;
  }

  removeLiveTouchChannel() {
    this.cancelLiveTouchPatternSwap();
    const channel = this.liveTouchChannel;
    this.liveTouchChannel = null;
    return channel;
  }

  /**
   * Register the setting-local creative/intensity stage for Live Touch.
   * It runs on liveTouchBuffer before the shared surface crossfade. Shared
   * rack/blackout authority remains downstream in engine.js.
   */
  setLiveTouchOutputProcessor(processor) {
    if (processor !== null && typeof processor !== 'function') {
      throw new TypeError('Live Touch output processor must be a function or null');
    }
    this.liveTouchOutputProcessor = processor;
  }

  /**
   * Register a setting-local full-look processor. Each processor runs after
   * that setting's pattern stack is composed and before the canonical pair
   * blend. A transition can therefore blend two complete, isolated looks.
   */
  setLayerSettingOutputProcessor(setting, processor) {
    if (!Object.values(LAYER_SETTING_IDS).includes(setting)) {
      throw new RangeError(`Unknown layer setting '${setting}'`);
    }
    if (processor !== null && typeof processor !== 'function') {
      throw new TypeError('Layer setting output processor must be a function or null');
    }
    if (processor === null) this.layerSettingOutputProcessors.delete(setting);
    else this.layerSettingOutputProcessors.set(setting, processor);
  }

  _processLayerSettingOutput(setting, buffer) {
    const processor = this.layerSettingOutputProcessors.get(setting);
    if (processor) processor(buffer, setting);
  }

  setLiveTouchPhaseSpeedProvider(provider) {
    if (provider !== null && typeof provider !== 'function') {
      throw new TypeError('Live Touch phase speed provider must be a function or null');
    }
    this.liveTouchPhaseSpeedProvider = provider;
  }

  activateLayerSetting(target, options = {}) {
    // Capture the physical legacy Deck/Mixer side before canonical routing
    // takes ownership. This matters on a restored Deck boot: the router's
    // constructor default is Mixer, but the persisted legacy fader can already
    // be at Deck when the first canonical activation arrives.
    if (!this._canonicalLayerRouting) this._syncLayerRouterFromLegacyView();
    this._canonicalLayerRouting = true;
    const result = this.layerRouter.activate(target, options);
    this._syncLegacyViewFaderFromLayerRouter();
    return result;
  }

  forceLayerSetting(target, reason = 'forced') {
    this._canonicalLayerRouting = true;
    const state = this.layerRouter.forceActive(target, reason);
    this._syncLegacyViewFaderFromLayerRouter();
    return state;
  }

  getLayerSettingsState() {
    if (!this._canonicalLayerRouting) this._syncLayerRouterFromLegacyView();
    return this.layerRouter.getState();
  }

  getLayerRenderParticipants() {
    if (!this._canonicalLayerRouting) return this._legacyLayerParticipants();
    return this.layerRouter.participants();
  }

  /**
   * Validate that Mixer has a configured contributor before routing the live
   * output to it. This deliberately inspects configuration, not rendered
   * luminance: a pattern authored to be black is still a valid operator look.
   * Group, solo, follow, mask and fader gates are included because each can
   * make an apparently enabled channel contribute no pixels.
   */
  getMixerReadiness() {
    const soloActive = this.soloedChannelIds.size > 0;
    const groups = new Map(this.mixGroups.map(group => [group.id, group]));
    const channels = new Map(this.mixerChannels.map(channel => [channel.id, channel]));
    const resolving = new Set();
    const memo = new Map();

    const maskHasPixels = channel => {
      const mask = channel.compiledPixelMask;
      if (!mask) return true;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] === 1) return true;
      }
      return false;
    };

    const configuredLevel = channel => {
      if (memo.has(channel.id)) return memo.get(channel.id);
      if (resolving.has(channel.id)) return 0;
      resolving.add(channel.id);

      let level = 0;
      if (channel.enabled && channel.handle && maskHasPixels(channel)) {
        const faderMax = typeof channel.faderMax === 'number' && Number.isFinite(channel.faderMax)
          ? channel.faderMax
          : 1;
        if (this._bumpedChannelIds.has(channel.id)) {
          level = Math.max(0, Math.min(1, faderMax));
        } else {
          let input = channel.fader;
          if (channel.followLeaderId) {
            const leader = channels.get(channel.followLeaderId)
              || (this.deckChannel && this.deckChannel.id === channel.followLeaderId
                ? this.deckChannel
                : null);
            const followScale = typeof channel.followScale === 'number'
              && Number.isFinite(channel.followScale)
              ? channel.followScale
              : 1;
            if (leader === this.deckChannel) {
              const leaderMax = typeof leader.faderMax === 'number'
                && Number.isFinite(leader.faderMax)
                ? leader.faderMax
                : 1;
              input = leader.enabled ? Math.max(0, Math.min(leader.fader, leaderMax)) : 0;
            } else {
              input = leader ? configuredLevel(leader) : 0;
            }
            input *= followScale;
          }
          level = Math.max(0, Math.min(input, faderMax));
          if (channel.mixGroupId) {
            const group = groups.get(channel.mixGroupId);
            if (group) level *= group.muted ? 0 : Math.max(0, group.fader);
          }
          if (soloActive && !channel.soloSafe && !channel.faderLocked
              && !this.soloedChannelIds.has(channel.id)) {
            level = 0;
          }
        }
      }

      resolving.delete(channel.id);
      memo.set(channel.id, level);
      return level;
    };

    const contributors = this.mixerChannels
      .filter(channel => configuredLevel(channel) > 0.001)
      .map(channel => channel.id);
    if (contributors.length > 0) {
      return { ready: true, contributors, channelCount: this.mixerChannels.length };
    }
    return {
      ready: false,
      contributors: [],
      channelCount: this.mixerChannels.length,
      reason: this.mixerChannels.length === 0
        ? 'Mixer has no channels'
        : 'Mixer has no compiled, enabled channel with a non-zero effective fader '
          + 'and selected pixels',
    };
  }

  isLayerSettingRenderParticipant(setting) {
    if (this._canonicalLayerRouting) return this.layerRouter.isParticipant(setting);
    if (setting === LAYER_SETTING_IDS.LIVE_TOUCH) return false;
    if (setting === LAYER_SETTING_IDS.DECK) {
      return this.viewFader < 0.999 || this.targetViewFader < 0.999;
    }
    if (setting === LAYER_SETTING_IDS.MIXER) {
      return this.viewFader > 0.001 || this.targetViewFader > 0.001;
    }
    throw new RangeError(`Unknown layer setting '${setting}'`);
  }

  _legacyLayerParticipants() {
    const deckWeight = 1 - this.viewFader;
    const mixerWeight = this.viewFader;
    if (deckWeight > 0.001 && mixerWeight > 0.001) {
      return [LAYER_SETTING_IDS.DECK, LAYER_SETTING_IDS.MIXER];
    }
    if (this.viewFader <= 0.001 && this.targetViewFader <= 0.001) {
      return [LAYER_SETTING_IDS.DECK];
    }
    if (this.viewFader >= 0.999 && this.targetViewFader >= 0.999) {
      return [LAYER_SETTING_IDS.MIXER];
    }
    return [LAYER_SETTING_IDS.DECK, LAYER_SETTING_IDS.MIXER];
  }

  _syncLayerRouterFromLegacyView() {
    if (this.viewFader <= 0.001 && this.targetViewFader <= 0.001) {
      if (this.layerRouter.active !== LAYER_SETTING_IDS.DECK || this.layerRouter.transition) {
        this.layerRouter.forceActive(LAYER_SETTING_IDS.DECK, 'legacy_view_fader');
      }
    } else if (this.viewFader >= 0.999 && this.targetViewFader >= 0.999) {
      if (this.layerRouter.active !== LAYER_SETTING_IDS.MIXER || this.layerRouter.transition) {
        this.layerRouter.forceActive(LAYER_SETTING_IDS.MIXER, 'legacy_view_fader');
      }
    }
  }

  _syncLegacyViewFaderFromLayerRouter() {
    const blend = this.layerRouter.blend();
    const amount = blend.amount;
    if (blend.from === LAYER_SETTING_IDS.DECK && blend.to === LAYER_SETTING_IDS.MIXER) {
      this.viewFader = amount;
      this.targetViewFader = 1;
    } else if (blend.from === LAYER_SETTING_IDS.MIXER && blend.to === LAYER_SETTING_IDS.DECK) {
      this.viewFader = 1 - amount;
      this.targetViewFader = 0;
    } else if (blend.from === blend.to) {
      if (blend.to === LAYER_SETTING_IDS.DECK) {
        this.viewFader = 0;
        this.targetViewFader = 0;
      } else if (blend.to === LAYER_SETTING_IDS.MIXER) {
        this.viewFader = 1;
        this.targetViewFader = 1;
      }
    }
  }

  /** Get a mixer overlay by id. Rejects the deck channel id explicitly. */
  getMixerChannel(channelId) {
    if (this.deckChannel && channelId === this.deckChannel.id) return null;
    return this.mixerChannels.find(c => c.id === channelId);
  }

  /**
   * Install (or replace) the deck channel. The deck does NOT count
   * toward `maxChannels`. If a deck channel already exists, the caller
   * is responsible for destroying its WASM handle BEFORE invoking this
   * — the mixer doesn't free it for them, because most callers want
   * to keep using the same handle and only swap metadata.
   */
  setDeckChannel(channelConfig) {
    const channel = new PatternChannel(channelConfig);
    this.deckChannel = channel;
    // Compile the initial view-selection mask. The default
    // {type:'all'} compiles to null (full-rig fast path), so the
    // common case stays zero-cost.
    this.recompileChannelMask(channel);
    return channel;
  }

  /**
   * Recompile a channel's view-selection mask from its current
   * `channel.viewSelection`. Call this whenever viewSelection is set
   * or replaced — the API handler (PATCH /mixer/channels/:id and
   * PATCH /deck/channel) does this when an operator changes the
   * channel's view selection.
   *
   * Cheap: O(pixelCount) once at config time. The 40 Hz render loop
   * only reads `channel.compiledPixelMask` and never recomputes.
   */
  recompileChannelMask(channel) {
    if (!channel) return;
    channel.compiledPixelMask = compileViewSelectionMask({
      pixels: this.pixels,
      pixelCount: this.pixelCount,
      viewSelection: channel.viewSelection,
      viewMasks: this.viewMasks,
      maskRegistry: this.maskRegistry,
    });
  }

  /**
   * Model hot-reload support: swap in the model's refreshed view-mask
   * dictionary and recompile every channel's pixel mask against the
   * (in-place updated) model pixels. Without this, the constructor
   * snapshot is the only copy the mixer ever sees — channels keep
   * painting the OLD membership after a sim save, and a view created
   * while the engine runs can never be selected ("Unknown view mask")
   * even though /model/view-selection-options already lists it.
   *
   * A channel whose viewSelection no longer resolves (its view was
   * deleted/renamed in the sim) keeps its previous compiled mask — the
   * show must keep rendering on playa — and the error is logged loudly
   * so the operator re-picks that channel's view in CaptainPad.
   */
  setModelViewMasks(viewMasks, groupBits = null) {
    this.viewMasks = Array.isArray(viewMasks)
      ? viewMasks.filter(vm => vm && typeof vm.name === 'string' && vm.name.length > 0 && Number.isInteger(vm.bit))
      : [];
    if (groupBits && typeof groupBits === 'object' && !Array.isArray(groupBits)) {
      this.groupBits = groupBits;
    }
    // Rebuild the Tier-A registry against the (in-place updated) pixels
    // and refreshed group/preset tables so a mask created while the
    // engine runs becomes selectable immediately (and bit-less masks
    // register), without renumbering ids under live channels.
    this.maskRegistry = buildMaskRegistry({
      pixels: this.pixels,
      pixelCount: this.pixelCount,
      groupBits: this.groupBits,
      viewMasks: Array.isArray(viewMasks) ? viewMasks : [],
    });
    for (const channel of [
      this.deckChannel,
      ...this.mixerChannels,
      ...this.deckOverlays,
      this.liveTouchChannel,
    ]) {
      if (!channel) continue;
      try {
        this.recompileChannelMask(channel);
      } catch (err) {
        console.error(`[PatternMixer] Channel '${channel.id}' view selection ` +
          `${JSON.stringify(channel.viewSelection)} no longer resolves after model reload — ` +
          `keeping its previous mask; re-pick the view in CaptainPad. (${err.message})`);
      }
    }
  }

  /**
   * Replace a channel's view selection and recompile its mask. Returns
   * true on success, false on unknown channel id. The viewSelection
   * shape MUST be pre-validated by the API layer (validateViewSelection
   * in api_server.js) before reaching this method. Works for both the
   * deck channel and any mixer overlay.
   *
   * ATOMIC on the unknown-mask hard error (codex P0, report 20260618_2
   * §6 Q1): the candidate selection is COMPILED FIRST, and the channel's
   * `viewSelection` + `compiledPixelMask` are only committed once the
   * compile succeeds. If `compileViewSelectionMask` throws (e.g. a name
   * that isn't in this model's MaskRegistry), the channel keeps its
   * previous selection AND its previous compiled mask — no half-applied
   * state, no bogus selection serialized to disk — and the error
   * propagates so the API layer can surface it to the operator. The old
   * code assigned `channel.viewSelection` BEFORE recompiling, so a bad
   * name left the channel storing an unresolvable selection while its
   * compiled mask silently kept the prior value (inconsistent state that
   * then round-trips through saveAllState).
   */
  setChannelViewSelection(channelId, viewSelection) {
    const channel = this.getChannel(channelId);
    if (!channel) return false;
    const candidate = viewSelection || { type: 'all', target: null, invert: false };
    // Compile against the candidate WITHOUT mutating the channel first.
    // Throws on an unknown mask name — propagates, channel untouched.
    const compiled = compileViewSelectionMask({
      pixels: this.pixels,
      pixelCount: this.pixelCount,
      viewSelection: candidate,
      viewMasks: this.viewMasks,
      maskRegistry: this.maskRegistry,
    });
    // Commit only after a clean compile.
    channel.viewSelection = candidate;
    channel.compiledPixelMask = compiled;
    return true;
  }

  /**
   * Add a mixer overlay. Throws if the cap is reached. Refuses to use
   * the deck channel's id (defensive — the API layer should be enforcing
   * this, but the mixer enforces it too so a buggy callsite can't sneak
   * a duplicate id through). Also compiles the channel's initial
   * view-selection mask so the render loop can apply it on the first
   * frame.
   */
  addMixerChannel(channelConfig) {
    if (this.mixerChannels.length >= this.maxChannels) {
      throw new Error(`Maximum of ${this.maxChannels} mixer channels allowed`);
    }
    if (this.deckChannel && channelConfig && channelConfig.id === this.deckChannel.id) {
      throw new Error(`Channel id '${channelConfig.id}' is reserved for the deck channel`);
    }
    const channel = new PatternChannel(channelConfig);
    this.mixerChannels.push(channel);
    this.recompileChannelMask(channel);
    return channel;
  }

  /** Remove a mixer overlay by id. Returns true iff something was removed. */
  removeMixerChannel(channelId) {
    if (this.deckChannel && channelId === this.deckChannel.id) {
      console.warn(`[Mixer] refusing to remove deck channel via removeMixerChannel('${channelId}')`);
      return false;
    }
    const index = this.mixerChannels.findIndex(c => c.id === channelId);
    if (index === -1) return false;
    const channel = this.mixerChannels[index];
    if (this.onChannelRemoved) this.onChannelRemoved(channelId);
    channel.destroy(this.wasmHost);
    this.mixerChannels.splice(index, 1);
    // WAVE 15 cleanup (spec §8): drop any solo + group membership the
    // removed channel held. A lingering id in soloedChannelIds would be a
    // PHANTOM solo — soloActive would stay true with no visible soloed
    // channel, darkening the whole rig. mixGroupId lives on the channel
    // object (gone with the splice), but clearing it here is belt-and-braces
    // for any retained reference.
    this.soloedChannelIds.delete(channelId);
    // FLASH / BUMP: drop any held bump on the removed channel too. A lingering
    // id in _bumpedChannelIds would be a PHANTOM bump — harmless to render (the
    // channel is gone) but a leak; clearing it keeps the Set honest.
    this._bumpedChannelIds.delete(channelId);
    channel.mixGroupId = null;
    // FOLLOW/LINK (round-2 #6): any channel that followed the removed channel
    // must have its followLeaderId cleared so it reverts to its OWN fader
    // rather than tracking a ghost leader (which _effFader would read as a
    // missing cache entry = 0, silently freezing the follower dark). Belt-and-
    // braces: the api_server DELETE path also calls clearFollowersOf + broadcasts
    // BEFORE removal, but clearing here keeps the mixer self-consistent for any
    // direct/legacy caller.
    this.clearFollowersOf(channelId);
    return true;
  }

  /**
   * Reorder the mixer overlay stack to exactly `orderedIds` (CHANNEL OPS #7).
   *
   * `orderedIds` MUST be a permutation of the CURRENT mixerChannels ids —
   * same set, same length, no duplicates. The API layer validates this
   * BEFORE calling (REORDER_BAD_SET 400); this method re-validates as a
   * fail-loud belt-and-braces and THROWS rather than partially applying, so
   * a buggy caller can never half-reorder the live composite stack.
   *
   * Semantics: a SINGLE atomic reassignment of `this.mixerChannels` to the
   * SAME channel objects in the new order. No splice, no recompile, no new
   * PatternChannel. Every per-channel field (handle, compiledPixelMask,
   * fader, faderMax, color, mixGroupId, soloSafe, _savedMode, …) is preserved
   * because the objects are preserved by reference — only the array order
   * changes. This is SAFE against the index invariant (pattern_mixer.js stack
   * order == array position, no numeric index field) and against an in-flight
   * scripted transition (renderAll6ch rebuilds `_renderOrderScratch` from
   * mixerChannels every frame via findIndex, and transitions key on channel
   * id, never on array index) — so a reorder mid-transition is picked up on
   * the very next frame with no 409 and no glitch.
   *
   * order[0] is the BOTTOM of the mix (composited first, the seed layer);
   * order[last] is the TOP (composited last, paints over everything below).
   *
   * @param {string[]} orderedIds Permutation of current mixer channel ids.
   * @returns {PatternChannel[]} the reordered live array.
   */
  reorderMixerChannels(orderedIds) {
    if (!Array.isArray(orderedIds)) {
      throw new Error('reorderMixerChannels: orderedIds must be an array');
    }
    if (orderedIds.length !== this.mixerChannels.length) {
      throw new Error(
        `reorderMixerChannels: orderedIds length (${orderedIds.length}) must equal ` +
        `the current mixer channel count (${this.mixerChannels.length})`);
    }
    const byId = new Map();
    for (const c of this.mixerChannels) byId.set(c.id, c);
    const seen = new Set();
    const reordered = orderedIds.map(id => {
      if (seen.has(id)) {
        throw new Error(`reorderMixerChannels: duplicate id '${id}' in orderedIds`);
      }
      seen.add(id);
      const ch = byId.get(id);
      if (!ch) {
        throw new Error(`reorderMixerChannels: id '${id}' is not a current mixer channel`);
      }
      return ch;
    });
    // Single atomic reassignment — same objects, new order. Nothing else
    // (handles, masks, groups, solo set) is touched.
    this.mixerChannels = reordered;
    return this.mixerChannels;
  }

  // ── Deck dynamic view overrides (deck overlays) ──────────────────────────
  //
  // A deck overlay IS a PatternChannel (reuse the overlay construction path),
  // composited OVER the main deck into `deckBuffer` inside renderAll6ch. The
  // deck overlay machinery deliberately MIRRORS the mixer-overlay add/remove/
  // reorder semantics (cap check, mask compile, handle destroy on remove,
  // permutation validation that THROWS) but keeps a SEPARATE array so deck
  // overlays never leak into the deck/mixer crossfade. Order = array index:
  // deckOverlays[0] = bottom, deckOverlays[last] = top (top wins within its
  // view). See docs/39 §deck-overlays.

  getDeckOverlays() {
    return this.deckOverlays;
  }

  getDeckOverlay(overlayId) {
    return this.deckOverlays.find(o => o.id === overlayId) || null;
  }

  /**
   * Normalize a viewSelection to its canonical {type,target,invert} shape for
   * uniqueness comparison. Two selections are "equivalent" iff their compiled
   * masks would be identical — we compare the normalized tuple (cheap, exact
   * for the validated shapes) so a second overlay can't target a taken view.
   */
  _normalizedViewKey(viewSelection) {
    const vs = viewSelection || { type: 'all', target: null, invert: false };
    const target = (vs.target === undefined) ? null : vs.target;
    return JSON.stringify({ type: vs.type, target, invert: !!vs.invert });
  }

  /**
   * True iff a deck overlay (other than `exceptId`) already targets an
   * equivalent viewSelection. Used to enforce the unique-view rule (at most
   * one overlay per view) at the API boundary (409 DECK_OVERLAY_VIEW_TAKEN).
   */
  deckOverlayViewTaken(viewSelection, exceptId = null) {
    const key = this._normalizedViewKey(viewSelection);
    return this.deckOverlays.some(o => o.id !== exceptId && this._normalizedViewKey(o.viewSelection) === key);
  }

  /**
   * Pick an auto accent color for a NEW deck overlay: cycle the 8-swatch
   * palette, skipping any color already in use by a sibling overlay or the
   * main deck so adjacent layers never collide. Falls back to the next
   * palette slot if every swatch is somehow taken (>8 distinct colors in use,
   * which the cap of 4 makes impossible — but never returns null).
   */
  _pickDeckOverlayColor() {
    const inUse = new Set();
    if (this.deckChannel && typeof this.deckChannel.color === 'string') inUse.add(this.deckChannel.color);
    for (const o of this.deckOverlays) {
      if (typeof o.color === 'string') inUse.add(o.color);
    }
    for (const swatch of DECK_OVERLAY_COLOR_SWATCHES) {
      if (!inUse.has(swatch)) return swatch;
    }
    // Every swatch taken — cycle by current count (deterministic, never null).
    return DECK_OVERLAY_COLOR_SWATCHES[this.deckOverlays.length % DECK_OVERLAY_COLOR_SWATCHES.length];
  }

  /**
   * Add a deck overlay. Throws (fail loud) on: cap reached
   * (DECK_OVERLAY_MAX), a colliding id (deck or a sibling overlay), an empty
   * viewSelection (whole-rig / nothing-selected — never-dark guard), or a
   * taken view. The API layer maps these to 400/409; the throw is a
   * belt-and-braces so a buggy callsite can't bypass the rules. Compiles the
   * overlay's view mask immediately so the first frame composites correctly.
   * `config.color` is honored if provided (restore path); otherwise an auto
   * accent is assigned.
   */
  addDeckOverlay(channelConfig) {
    if (this.deckOverlays.length >= DECK_OVERLAY_MAX) {
      throw new Error(`Maximum of ${DECK_OVERLAY_MAX} deck overlays allowed`);
    }
    const cfg = channelConfig || {};
    if (this.deckChannel && cfg.id && cfg.id === this.deckChannel.id) {
      throw new Error(`deck overlay id '${cfg.id}' collides with the deck channel id`);
    }
    if (cfg.id && this.deckOverlays.some(o => o.id === cfg.id)) {
      throw new Error(`deck overlay id '${cfg.id}' already exists`);
    }
    // Never-dark guard: a deck overlay MUST target an explicit, non-empty,
    // non-whole-rig view. An 'all' selection (or anything compiling to the
    // whole rig / empty) is REFUSED — an overlay can never target everything,
    // so the exterior the deck covers can never be blacked out by overlays.
    const vs = cfg.viewSelection || { type: 'all', target: null, invert: false };
    if (!vs || vs.type === 'all') {
      throw new Error('deck overlay viewSelection must target a specific view (not type "all")');
    }
    if (this.deckOverlayViewTaken(vs, cfg.id || null)) {
      throw new Error(`a deck overlay already targets this view`);
    }
    const sourceMode = cfg.sourceMode === undefined ? 'playlist' : cfg.sourceMode;
    if (!DECK_OVERLAY_SOURCE_MODES.includes(sourceMode)) {
      throw new TypeError(`deck overlay sourceMode must be one of ${DECK_OVERLAY_SOURCE_MODES.join(', ')}`);
    }
    const playlistTint = cfg.playlistTint === undefined
      ? null
      : normalizeDeckOverlayColor(cfg.playlistTint, 'playlistTint', { nullable: true });
    const solidColor = cfg.solidColor === undefined
      ? '#FFFFFF'
      : normalizeDeckOverlayColor(cfg.solidColor, 'solidColor');
    const overlay = new PatternChannel({
      ...cfg,
      // Deck overlays only use steady channel-blend modes (blend_screen
      // default; blend_add | blend_over). trans_* transition modes are
      // excluded — the constructor default already covers an omitted mode.
      mode: cfg.mode || 'blend_screen',
      viewSelection: vs,
      color: (typeof cfg.color === 'string') ? cfg.color : this._pickDeckOverlayColor(),
    });
    overlay.sourceMode = sourceMode;
    overlay.playlistTint = playlistTint;
    overlay.solidColor = solidColor;
    this.deckOverlays.push(overlay);
    this.recompileChannelMask(overlay);
    return overlay;
  }

  /** Remove a deck overlay by id. Returns true iff something was removed. */
  removeDeckOverlay(overlayId) {
    const index = this.deckOverlays.findIndex(o => o.id === overlayId);
    if (index === -1) return false;
    const overlay = this.deckOverlays[index];
    if (this.onChannelRemoved) this.onChannelRemoved(overlayId);
    overlay.destroy(this.wasmHost);
    this.deckOverlays.splice(index, 1);
    return true;
  }

  /**
   * Reorder the deck-overlay stack to exactly `orderedIds`. EXACT mirror of
   * reorderMixerChannels: permutation validation (array, exact length, no
   * dups, exact same id set) all THROW (fail loud, no partial apply), then a
   * SINGLE atomic reassignment of the SAME overlay objects in the new order
   * (handles, masks, color all preserved by reference). order[0] = bottom,
   * order[last] = top.
   */
  reorderDeckOverlays(orderedIds) {
    if (!Array.isArray(orderedIds)) {
      throw new Error('reorderDeckOverlays: orderedIds must be an array');
    }
    if (orderedIds.length !== this.deckOverlays.length) {
      throw new Error(
        `reorderDeckOverlays: orderedIds length (${orderedIds.length}) must equal ` +
        `the current deck overlay count (${this.deckOverlays.length})`);
    }
    const byId = new Map();
    for (const o of this.deckOverlays) byId.set(o.id, o);
    const seen = new Set();
    const reordered = orderedIds.map(id => {
      if (seen.has(id)) {
        throw new Error(`reorderDeckOverlays: duplicate id '${id}' in orderedIds`);
      }
      seen.add(id);
      const o = byId.get(id);
      if (!o) {
        throw new Error(`reorderDeckOverlays: id '${id}' is not a current deck overlay`);
      }
      return o;
    });
    this.deckOverlays = reordered;
    return this.deckOverlays;
  }

  /**
   * Replace a deck overlay's view selection and recompile its mask. Returns
   * true on success, false on unknown id. The viewSelection MUST be
   * pre-validated by the API layer AND pre-checked for view-uniqueness +
   * non-empty (the API path enforces 409 DECK_OVERLAY_VIEW_TAKEN and the
   * never-dark 'all' refusal before calling this).
   */
  setDeckOverlayViewSelection(overlayId, viewSelection) {
    const overlay = this.getDeckOverlay(overlayId);
    if (!overlay) return false;
    overlay.viewSelection = viewSelection || { type: 'all', target: null, invert: false };
    this.recompileChannelMask(overlay);
    return true;
  }

  /**
   * PANIC → safe LIT default (CHANNEL OPS #9). Brings the rig to a known
   * maximally-visible state, mission-critical. Used by POST /mixer/panic when
   * there is no operator-defined "home" snapshot (or as the still-LIT half of
   * the documented loud fallback when a configured home snapshot is broken).
   *
   * This is the engine-side half — the route layer additionally clears the
   * global blackout flag (intensityController), bumps master, resets the view
   * override lease, and persists. Here we make the MIXER itself safe:
   *
   *   - Cancel any in-flight grand-master fade and force master to FULL
   *     (setMaster(1.0) nulls _masterFade — no fade, maximize visibility now).
   *   - cancelDeckPatternSwap() — drop a half-chosen deck target, keep the
   *     current KNOWN-LIT active deck pattern (NOT finishDeckSwapNow, which
   *     would commit to a maybe-wrong target).
   *   - cancelChannelTransition(id) on every overlay — restores each channel's
   *     saved blend mode + clears the scripted-target render flag.
   *   - Enable every overlay at fader 1.0, EXCEPT a faderLocked channel (its
   *     parked level is sacred) — and NEVER touch faderMax (the safety
   *     ceiling stays). enabled is forced true so a muted layer comes back.
   *   - soloedChannelIds.clear() — drop any solo gate (a stuck solo darkens
   *     the rig).
   *   - Un-MUTE every group (muted=false) WITHOUT deleting groups or resetting
   *     their faders — a muted group would otherwise gate its members dark.
   *   - Transition to the Mixer layer setting through the same router used by
   *     every operator surface transition.
   */
  panicToSafeDefault() {
    // Master: cancel any fade + go to FULL immediately (no animation).
    this.setMaster(1.0);
    this.activateLayerSetting(LAYER_SETTING_IDS.MIXER, {
      durationMs: 1000,
      reason: 'panic_safe_default',
    });

    // Deck: cancel an in-flight swap WITHOUT committing to its target.
    this.cancelDeckPatternSwap();

    // Overlays: cancel transitions, force-enable + full fader (respecting
    // faderLocked; never touching faderMax).
    for (const c of this.mixerChannels) {
      this.cancelChannelTransition(c.id);
      c.enabled = true;
      if (!c.faderLocked) c.fader = 1.0;
    }
    // Defensive: clear any lingering scripted-transition render-order flag
    // (cancelChannelTransition clears it per-channel, but a stale id with no
    // matching transition would otherwise promote a non-existent target).
    this.scriptedTransitionTargetId = null;

    // Solo: drop the gate entirely (a stuck solo darkens everyone else).
    this.soloedChannelIds.clear();
    // FLASH / BUMP: drop any held bump (panic forces full anyway; a stale bump
    // from a dropped client must not survive the operator's panic recovery).
    this._bumpedChannelIds.clear();

    // Groups: un-mute (do NOT delete or reset faders). A muted group would
    // gate its members to 0 at composite time.
    for (const g of this.mixGroups) g.muted = false;
  }

  // ── Channel groups (gang-faders) ───────────────────────────────────────
  // Single-membership group registry. CRUD is validate-then-mutate; the API
  // layer owns persistence + broadcast. Members are derived from the
  // channel→group pointer (`channel.mixGroupId`), never stored on the group.

  /** All groups (live references — callers must not mutate ids). */
  getMixGroups() { return this.mixGroups; }

  /** Find a group by id, or undefined. */
  getMixGroup(groupId) { return this.mixGroups.find(g => g.id === groupId); }

  /**
   * Create a group. `name`/`color` are optional metadata. Returns the new
   * MixGroup. fader defaults to 1 (no attenuation), muted to false.
   */
  createMixGroup({ name = null, color = null } = {}) {
    const id = `mg_${++this._mixGroupCounter}_${Date.now()}`;
    const group = {
      id,
      name: (typeof name === 'string' && name.length > 0) ? name : `Group ${this._mixGroupCounter}`,
      fader: 1.0,
      muted: false,
      color: (typeof color === 'string' && color.length > 0) ? color : null,
    };
    this.mixGroups.push(group);
    return group;
  }

  /**
   * Update a group's fields. Caller has already validated values (fader via
   * validateFader, etc). Returns the group, or null if not found. Only the
   * fields present in `patch` are written.
   */
  updateMixGroup(groupId, patch) {
    const group = this.getMixGroup(groupId);
    if (!group) return null;
    if (patch.name !== undefined) group.name = patch.name;
    if (patch.fader !== undefined) {
      // A direct fader write cancels any in-flight morph group fade for this
      // group — the operator's hand wins, no animation fights a manual set
      // (mirrors setMaster cancelling _masterFade).
      this.cancelGroupFade(groupId);
      group.fader = Math.max(0, Math.min(1, patch.fader));
    }
    if (patch.muted !== undefined) group.muted = !!patch.muted;
    if (patch.color !== undefined) group.color = patch.color === null ? null : patch.color;
    return group;
  }

  /**
   * Delete a group. Clears `mixGroupId` on every member first so no channel
   * is left pointing at a ghost group. Returns true iff a group was removed.
   */
  deleteMixGroup(groupId) {
    const index = this.mixGroups.findIndex(g => g.id === groupId);
    if (index === -1) return false;
    for (const c of this.mixerChannels) {
      if (c.mixGroupId === groupId) c.mixGroupId = null;
    }
    // Drop any in-flight morph fade targeting this group so _tickGroupFades
    // never animates a ghost.
    this.cancelGroupFade(groupId);
    this.mixGroups.splice(index, 1);
    return true;
  }

  /**
   * Add a mixer channel to a group (single membership). Returns
   *   { ok: true } on success, or { ok: false, status, error } on a
   * fail-loud condition: group/channel missing (404), the channel is the
   * deck (400 — decks aren't in groups), or it's already in a DIFFERENT
   * group (400 — single membership). Re-adding to the SAME group is a no-op
   * success (idempotent).
   */
  addChannelToGroup(groupId, channelId) {
    const group = this.getMixGroup(groupId);
    if (!group) return { ok: false, status: 404, error: `group '${groupId}' not found` };
    const channel = this.getMixerChannel(channelId);
    if (!channel) return { ok: false, status: 404, error: `mixer channel '${channelId}' not found` };
    if (channel.mixGroupId && channel.mixGroupId !== groupId) {
      return {
        ok: false, status: 400,
        error: `channel '${channelId}' is already in group '${channel.mixGroupId}' (single membership; remove it first)`,
      };
    }
    channel.mixGroupId = groupId;
    return { ok: true };
  }

  /**
   * Remove a channel from a group. Returns { ok:true } even if the channel
   * wasn't in this group (idempotent clear), or a 404 if the channel/group
   * doesn't exist (fail-loud on a bad id).
   */
  removeChannelFromGroup(groupId, channelId) {
    const group = this.getMixGroup(groupId);
    if (!group) return { ok: false, status: 404, error: `group '${groupId}' not found` };
    const channel = this.getMixerChannel(channelId);
    if (!channel) return { ok: false, status: 404, error: `mixer channel '${channelId}' not found` };
    if (channel.mixGroupId === groupId) channel.mixGroupId = null;
    return { ok: true };
  }

  // ── Channel FOLLOW / LINK (round-2 #6, docs/39 §F-follow) ──────────────
  // A follower's `followLeaderId` points at another channel whose effective
  // level it tracks. The render-time resolution lives in _effFader (prev-frame
  // effective × followScale); these helpers own the CONFIG-time graph
  // invariants (cycle prevention, dangling-leader cleanup) so the hot path
  // never has to. Followers may live in mixerChannels OR be the deck (the deck
  // is leader-only — it has no follow field surfaced — but a mixer channel can
  // follow it, so the chain walk consults getChannel()).

  /**
   * Would setting `followerId`'s leader to `leaderId` create a cycle (or a
   * self-follow)? Walks the existing follow chain starting AT `leaderId` and
   * up through each leader's own leader; a cycle exists iff that walk reaches
   * `followerId` (or `leaderId === followerId`, the self-follow). O(chain
   * length) — the chain is at most maxChannels+1 deep, and a `seen` guard
   * makes the walk terminate even against a pre-existing cycle in the data
   * (defensive — the API never lets one form). Pure read; mutates nothing.
   *
   * @param {string} followerId the channel that wants to follow
   * @param {string} leaderId the proposed leader
   * @returns {boolean} true iff the link would be self/cyclic (must be rejected)
   */
  wouldCreateFollowCycle(followerId, leaderId) {
    if (followerId === leaderId) return true; // self-follow
    const seen = new Set();
    let cursor = leaderId;
    while (cursor) {
      if (cursor === followerId) return true; // chain loops back to the follower
      if (seen.has(cursor)) return false; // pre-existing loop NOT involving followerId — terminate
      seen.add(cursor);
      const leaderChannel = this.getChannel(cursor);
      cursor = leaderChannel ? leaderChannel.followLeaderId : null;
    }
    return false;
  }

  /**
   * Clear `followLeaderId` on every channel that currently follows `leaderId`
   * (fail-safe leader-DELETE behavior, docs/39 §F-follow). Called by the
   * api_server BEFORE removing a channel so no follower is left pointing at a
   * ghost leader. A cleared follower reverts to its OWN manual fader — it does
   * NOT freeze and does NOT go dark (the codex's "no silent dangling
   * reference" rule). Returns the array of follower ids that were cleared so
   * the caller can broadcast the change. Scans mixer channels only (the deck
   * has no followLeaderId).
   *
   * @param {string} leaderId the leader being removed
   * @returns {string[]} ids of followers whose follow was cleared
   */
  clearFollowersOf(leaderId) {
    const cleared = [];
    for (const c of this.mixerChannels) {
      if (c.followLeaderId === leaderId) {
        c.followLeaderId = null;
        cleared.push(c.id);
      }
    }
    return cleared;
  }

  // ── Server-authoritative solo ──────────────────────────────────────────
  // soloedChannelIds is the sole truth. setSolo/clearSolo never mutate any
  // sibling's enabled/fader — parked levels survive a solo unchanged (the
  // render gate reads the Set; un-solo simply empties it). All return true
  // iff the set changed (caller decides whether to broadcast).

  /**
   * Solo a channel. `additive` true → add to the current solo set; false
   * (default) → replace the set with just this channel. Returns
   *   { ok:true, changed } or { ok:false, status:404, error } if the id is
   * not a mixer channel (fail-loud — never solo a non-existent / deck id).
   */
  setSolo(channelId, additive = false) {
    if (!this.getMixerChannel(channelId)) {
      return { ok: false, status: 404, error: `mixer channel '${channelId}' not found` };
    }
    if (additive) {
      const had = this.soloedChannelIds.has(channelId);
      this.soloedChannelIds.add(channelId);
      return { ok: true, changed: !had };
    }
    // Replace: only "changed" if the resulting set differs from the current.
    const same = this.soloedChannelIds.size === 1 && this.soloedChannelIds.has(channelId);
    this.soloedChannelIds.clear();
    this.soloedChannelIds.add(channelId);
    return { ok: true, changed: !same };
  }

  /**
   * Clear solo. With a channelId → un-solo just that channel; without →
   * clear ALL solos. Returns { ok:true, changed }. A bad channelId (not a
   * mixer channel) is a fail-loud 404; clearing all is always ok.
   */
  clearSolo(channelId = null) {
    if (channelId === null || channelId === undefined) {
      const changed = this.soloedChannelIds.size > 0;
      this.soloedChannelIds.clear();
      return { ok: true, changed };
    }
    if (!this.getMixerChannel(channelId)) {
      return { ok: false, status: 404, error: `mixer channel '${channelId}' not found` };
    }
    const changed = this.soloedChannelIds.delete(channelId);
    return { ok: true, changed };
  }

  // ── FLASH / BUMP (momentary full-while-held) ───────────────────────────
  // `_bumpedChannelIds` is the sole truth (docs/39 §10.7). bumpChannel/
  // unbumpChannel never mutate any channel's enabled/fader — the parked level
  // survives the bump untouched (the render gate reads the Set; release simply
  // drops the id). Both return { ok, changed } iff the set changed (caller
  // decides whether to broadcast). A bad / non-mixer id is a fail-loud 404 —
  // never bump a non-existent or deck id.

  /**
   * Bump (flash to full) a channel. Returns { ok:true, changed } or
   * { ok:false, status:404, error } if the id is not a mixer channel.
   */
  bumpChannel(channelId) {
    if (!this.getMixerChannel(channelId)) {
      return { ok: false, status: 404, error: `mixer channel '${channelId}' not found` };
    }
    const had = this._bumpedChannelIds.has(channelId);
    this._bumpedChannelIds.add(channelId);
    return { ok: true, changed: !had };
  }

  /**
   * Release a bump. With a channelId → un-bump just that channel; without →
   * release ALL bumps. Returns { ok:true, changed }. A bad channelId (not a
   * mixer channel) is a fail-loud 404; releasing all is always ok.
   */
  unbumpChannel(channelId = null) {
    if (channelId === null || channelId === undefined) {
      const changed = this._bumpedChannelIds.size > 0;
      this._bumpedChannelIds.clear();
      return { ok: true, changed };
    }
    if (!this.getMixerChannel(channelId)) {
      return { ok: false, status: 404, error: `mixer channel '${channelId}' not found` };
    }
    const changed = this._bumpedChannelIds.delete(channelId);
    return { ok: true, changed };
  }

  /** Release ALL bumps (transition / teardown / panic helper). Returns true
   *  iff the set was non-empty. */
  clearBumps() {
    const changed = this._bumpedChannelIds.size > 0;
    this._bumpedChannelIds.clear();
    return changed;
  }

  /**
   * Effective fader for a channel at composite time (WAVE 15 precedence).
   * Pure O(1) arithmetic — no allocation, no closures. `soloActive` and the
   * group scale come precomputed from the caller (per-frame, hot path).
   *
   *   effFader = clamp(fader, 0, faderMax) * groupScale * soloGate * enabledGate
   *
   * where groupScale = (group ? (muted?0:fader) : 1), soloGate = 1 unless a
   * solo is active and this channel is neither soloed nor solo-safe nor
   * fader-locked, enabledGate = enabled?1:0. faderMax clamp is applied to the
   * channel's OWN fader FIRST (per-fixture ceiling), then the group scales
   * it (gang scale ≠ a fader write, so it still attenuates a locked channel).
   */
  // ── Per-channel effective phase-clock speed (docs/39 §F-phase #4) ─────
  // O(1), allocation-free — called once per channel per frame from
  // beginFrame, right next to _effFader. TEMPO-ONLY: a channel that opted
  // in (followsTempo) runs at the global tap-tempo multiplier; every other
  // channel runs at 1× (the global clock rate). Clamped to the [0.05, 8]
  // window so an extreme tap can never push the accumulator to 0 (freeze)
  // or run away.
  _effectiveSpeed(channel) {
    const eff = channel.followsTempo ? this._tempoMultiplier : 1;
    return eff < 0.05 ? 0.05 : (eff > 8 ? 8 : eff);
  }

  // ── Set the global tap-tempo (docs/39 §F-phase #4) ───────────────────
  // 120 BPM = 1× by convention. The derived multiplier is clamped to the
  // phase-clock window [0.05, 8] so an extreme tap can't freeze or run away
  // the followers. Caller validated `bpm` finite + in range at the API
  // boundary; we defensively guard a non-finite here too (codex P0 — never
  // poison _tempoMultiplier with NaN, which would silently freeze every
  // follower).
  setTempoBpm(bpm) {
    if (typeof bpm !== 'number' || !Number.isFinite(bpm)) {
      throw new Error(`setTempoBpm requires a finite bpm, got '${bpm}'`);
    }
    this.tempoBpm = bpm;
    const mult = bpm / 120;
    this._tempoMultiplier = mult < 0.05 ? 0.05 : (mult > 8 ? 8 : mult);
    return this._tempoMultiplier;
  }

  _effFader(channel, soloActive) {
    if (!channel.enabled) return 0;
    const faderMax = (typeof channel.faderMax === 'number' && Number.isFinite(channel.faderMax))
      ? channel.faderMax
      : 1.0;
    // FLASH / BUMP (docs/39 §10.7): a held bump OVERRIDES the channel's own
    // fader, its group scale, and the solo-dimming gate so the accent always
    // reads — BUT a hard mute (enabled=false, handled above) still wins, and
    // the per-fixture faderMax safety ceiling STILL holds (a CAP-protected
    // fixture is never over-driven, even on a bump). So a bumped channel goes
    // to min(1.0, faderMax). O(1) Set membership check; the override short-
    // circuits BEFORE the group/solo arithmetic. The common case (no bumps)
    // pays one extra `_bumpedChannelIds.size` read — gated, allocation-free.
    if (this._bumpedChannelIds.size > 0 && this._bumpedChannelIds.has(channel.id)) {
      const capped = faderMax < 1.0 ? faderMax : 1.0;
      return capped < 0 ? 0 : capped;
    }
    // FOLLOW/LINK (round-2 #6, docs/39 §F-follow): if this channel follows a
    // leader, its composite INPUT is the leader's EFFECTIVE level from the
    // PREVIOUS frame × this follower's followScale, REPLACING its own manual
    // fader. Everything below this line (faderMax cap, group scale, solo gate,
    // enabled gate handled above) STILL applies to the follower — follow only
    // swaps the input, never escapes the follower's own caps. Following NEVER
    // touches the leader (we only READ the leader's cached effective value).
    // A missing cache entry (first frame / leader just added) reads 0 — the
    // follower tracks down for one frame, never a spurious flash. O(1) Map get,
    // allocation-free; the common case (no leader) pays one `followLeaderId`
    // truthiness check.
    let inputFader = channel.fader;
    if (channel.followLeaderId) {
      const leaderEff = this._prevEffFaderCache.get(channel.followLeaderId);
      const scale = (typeof channel.followScale === 'number' && Number.isFinite(channel.followScale))
        ? channel.followScale
        : 1.0;
      inputFader = (leaderEff === undefined ? 0 : leaderEff) * scale;
    }
    let eff = inputFader < faderMax ? inputFader : faderMax;
    if (eff < 0) eff = 0;
    // Group scale (gang fader / mute). Cache miss = no group => scale 1.
    if (channel.mixGroupId) {
      const scale = this._groupScaleCache.get(channel.mixGroupId);
      // A non-null mixGroupId with no cache entry means the group was deleted
      // out from under the channel — treat as no group (scale 1) rather than
      // dropping it dark. (deleteMixGroup clears membership, so this is only
      // a belt-and-braces guard against a stale pointer.)
      if (scale !== undefined) eff *= scale;
    }
    // Solo gate. fader-lock implies solo-safe (a locked level keeps its
    // parked contribution through another channel's solo).
    if (soloActive
        && !channel.soloSafe
        && !channel.faderLocked
        && !this.soloedChannelIds.has(channel.id)) {
      return 0;
    }
    return eff;
  }

  /** Destroy the deck channel's WASM handle and clear the slot.
   *  Also tears down the inactive deck sibling (its handle would
   *  otherwise be orphaned — nothing else holds a reference to it). */
  removeDeckChannel() {
    if (!this.deckChannel) return false;
    const id = this.deckChannel.id;
    if (this.onChannelRemoved) this.onChannelRemoved(id);
    // Cancel any in-flight swap FIRST, before we tear down the deck or the
    // inactive slot. cancelDeckPatternSwap() drops `_swapTransition` and
    // parks the inactive fader at 0, so updateDeckSwapTransition() can't
    // run its completion branch against a half-destroyed deck/inactive pair
    // on a later tick. (Single-threaded event loop means there's no
    // concurrent render, but a queued swap-completion path firing after we
    // null deckChannel would be a use-after-free of the destroyed handle.)
    this.cancelDeckPatternSwap();
    this.deckChannel.destroy(this.wasmHost);
    this.deckChannel = null;
    // Tear down the warm inactive — once there is no active deck, the
    // inactive has nothing to ping-pong back to. Caller (engine.js boot
    // reload, /deck/channel replace) installs a fresh deck via
    // setDeckChannel + first swap. (_swapTransition is already null from
    // cancelDeckPatternSwap above; keep the explicit reset for clarity in
    // the no-swap-in-flight case where cancel was a no-op.)
    this._swapTransition = null;
    if (this._inactiveDeckChannel && this._inactiveDeckChannel.handle) {
      try { this.wasmHost.destroy(this._inactiveDeckChannel.handle); } catch (_) {}
    }
    this._inactiveDeckChannel = null;
    return true;
  }

  // ── Legacy facades ─────────────────────────────────────────────────
  // Existing code paths (api_server.js, engine.js boot, HIL tests)
  // call these. They route by current state: first add becomes the
  // deck channel; subsequent adds become mixer channels. Look up by
  // id checks both collections.

  getChannel(channelId) {
    if (this.deckChannel && this.deckChannel.id === channelId) return this.deckChannel;
    return this.mixerChannels.find(c => c.id === channelId);
  }

  /**
   * Resolve a channel by id across EVERY role — deck base, mixer overlays,
   * AND deck overlays. `getChannel` deliberately omits deck overlays (they
   * live on their own route tree); this accessor is for paths that must reach
   * any live channel's per-channel local controls regardless of role (e.g.
   * the ChannelParamRouter writing a channel-local param onto a deck
   * overlay). Returns undefined when no channel matches.
   */
  getChannelAnyRole(channelId) {
    const direct = this.getChannel(channelId);
    if (direct) return direct;
    if (this.liveTouchChannel && this.liveTouchChannel.id === channelId) {
      return this.liveTouchChannel;
    }
    return this.deckOverlays.find(o => o.id === channelId);
  }

  /**
   * Every LIVE channel the engine renders: the deck base channel, every
   * mixer overlay, AND every deck overlay. For callers that must reach
   * EVERY channel regardless of role — `getChannel` deliberately only
   * covers deck + mixer overlays and would silently skip deck overlays.
   * Returns a fresh array (deck first, then overlays); the deck channel is
   * omitted when absent. Do not mutate the channel objects' role membership
   * through this list.
   *
   * NOTE: `channelsRunningPattern` (the (playlist, pattern) sibling query)
   * was REMOVED with the per-pattern param-sharing feature — parameters are
   * channel-local (operator ruling 2026-07-07); no caller may fan a param
   * write out across channels.
   */
  getAllLiveChannels() {
    const out = [];
    if (this.deckChannel) out.push(this.deckChannel);
    for (const c of this.mixerChannels) out.push(c);
    for (const o of this.deckOverlays) out.push(o);
    if (this.liveTouchChannel) out.push(this.liveTouchChannel);
    return out;
  }

  addChannel(channelConfig) {
    if (!this.deckChannel) {
      return this.setDeckChannel(channelConfig);
    }
    return this.addMixerChannel(channelConfig);
  }

  removeChannel(channelId) {
    if (this.deckChannel && this.deckChannel.id === channelId) {
      this.removeDeckChannel();
      // Pre-split behaviour: when the deck went away we promoted the
      // first remaining overlay onto the deck slot. Preserve that so
      // legacy callers that do `removeChannel(baseChannelId)` and then
      // expect a new base to exist still work.
      if (this.mixerChannels.length > 0) {
        const promoted = this.mixerChannels.shift();
        this.deckChannel = promoted;
      }
      return;
    }
    this.removeMixerChannel(channelId);
  }

  setMaster(value) {
    // A direct master write cancels any in-flight timed fade — the
    // operator's explicit set is the last word (no animation fighting a
    // manual slider). Mirrors cancelChannelTransition before a manual fader.
    this._masterFade = null;
    this.master = Math.max(0, Math.min(1, value));
  }

  /**
   * Begin a timed grand-master fade (F-B). Animates `master` from its
   * CURRENT value toward `target` over `durationMs` on the render tick.
   * A timed blackout is target=0; a restore is a fade back to a non-zero
   * value. Starting a new fade replaces any in-flight one (last-write-wins).
   *
   * Caller (api_server) MUST have validated target ∈ [0,1] finite and
   * durationMs finite > 0 — this method defensively re-validates and throws
   * on bad input rather than silently no-opping (Codex P0: fail loud).
   *
   * @param {number} target normalized [0,1] master gain to fade to
   * @param {number} durationMs fade duration in ms (> 0)
   */
  startMasterFade(target, durationMs) {
    if (!Number.isFinite(target) || target < 0 || target > 1) {
      throw new Error(`startMasterFade: target must be finite in [0,1], got ${target}`);
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error(`startMasterFade: durationMs must be finite > 0, got ${durationMs}`);
    }
    this._masterFade = {
      from: this.master,
      to: target,
      startMs: Date.now(),
      durationMs,
    };
  }

  /**
   * Snapshot of the in-flight master fade for /status + /mixer, or null
   * when no fade is animating. Shape:
   *   { active: true, from, to, durationMs, elapsedMs, remainingMs }
   */
  getMasterFade() {
    if (!this._masterFade) return null;
    const f = this._masterFade;
    const elapsed = Math.max(0, Date.now() - f.startMs);
    return {
      active: true,
      from: f.from,
      to: f.to,
      durationMs: f.durationMs,
      elapsedMs: Math.min(elapsed, f.durationMs),
      remainingMs: Math.max(0, f.durationMs - elapsed),
    };
  }

  /**
   * Advance the master fade one render tick. Linear interpolation over
   * wall-clock time so the perceived duration is frame-rate independent.
   * Lands EXACTLY on the target and clears `_masterFade` when complete, so
   * a steady-state master never carries a dangling fade descriptor. Called
   * from renderAll6ch alongside the viewFader ramp.
   */
  _tickMasterFade() {
    if (!this._masterFade) return;
    const f = this._masterFade;
    const elapsed = Date.now() - f.startMs;
    if (elapsed >= f.durationMs) {
      this.master = Math.max(0, Math.min(1, f.to));
      this._masterFade = null;
      return;
    }
    const t = elapsed <= 0 ? 0 : elapsed / f.durationMs;
    this.master = f.from + (f.to - f.from) * t;
  }

  // ── Group-fader timed fades (snapshot morph, round-2 #1) ───────────────
  // Animate a mix group's `fader` current→target over `durationMs`, parallel
  // to the grand-master `_masterFade` and the per-channel `transitions[]`.
  // Used by the snapshot morph to ramp gang-fader levels smoothly instead of
  // snapping them. Linear over wall-clock time (frame-rate independent),
  // lands EXACTLY on the target, and self-clears the descriptor on
  // completion — exactly like _tickMasterFade. Starting a fade for a group
  // replaces any in-flight fade for the SAME group (last-write-wins).
  //
  // Caller (api_server morph) MUST have validated target ∈ [0,1] finite and
  // durationMs finite > 0; this re-validates and THROWS on bad input rather
  // than silently no-opping (Codex P0: fail loud). A missing/unknown groupId
  // also throws — never silently animate a ghost group.
  startGroupFade(groupId, target, durationMs) {
    const group = this.getMixGroup(groupId);
    if (!group) {
      throw new Error(`startGroupFade: unknown group '${groupId}'`);
    }
    if (!Number.isFinite(target) || target < 0 || target > 1) {
      throw new Error(`startGroupFade: target must be finite in [0,1], got ${target}`);
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error(`startGroupFade: durationMs must be finite > 0, got ${durationMs}`);
    }
    // Last-write-wins: drop any in-flight fade for this same group first.
    this.cancelGroupFade(groupId);
    this._groupFades.push({
      groupId,
      from: group.fader,
      to: target,
      startMs: Date.now(),
      durationMs,
    });
  }

  /** Cancel an in-flight fade for `groupId`. Returns true iff one was removed.
   *  Does NOT touch the group's current fader — the caller (a direct fader
   *  write) owns the new value. */
  cancelGroupFade(groupId) {
    const before = this._groupFades.length;
    if (before === 0) return false;
    this._groupFades = this._groupFades.filter(gf => gf.groupId !== groupId);
    return this._groupFades.length !== before;
  }

  /** Cancel ALL in-flight group fades (morph kickoff / teardown helper).
   *  Returns true iff the list was non-empty. */
  cancelAllGroupFades() {
    const changed = this._groupFades.length > 0;
    this._groupFades = [];
    return changed;
  }

  /**
   * Advance every in-flight group fade one render tick. Linear interpolation
   * over wall-clock time (frame-rate independent). Lands EXACTLY on the
   * target and drops the descriptor when complete, so a steady-state group
   * never carries a dangling fade. Called from beginFrame() alongside the
   * master fade + per-channel transitions. Allocation-free on the steady
   * path (empty array → single length read, no iteration).
   */
  _tickGroupFades() {
    if (this._groupFades.length === 0) return;
    const now = Date.now();
    for (let i = this._groupFades.length - 1; i >= 0; i--) {
      const f = this._groupFades[i];
      const group = this.getMixGroup(f.groupId);
      if (!group) {
        // Group deleted out from under the fade — drop it rather than animate
        // a ghost. (deleteMixGroup doesn't know about fades; this is the
        // belt-and-braces cleanup.)
        this._groupFades.splice(i, 1);
        continue;
      }
      const elapsed = now - f.startMs;
      if (elapsed >= f.durationMs) {
        group.fader = f.to < 0 ? 0 : (f.to > 1 ? 1 : f.to);
        this._groupFades.splice(i, 1);
        continue;
      }
      const t = elapsed <= 0 ? 0 : elapsed / f.durationMs;
      group.fader = f.from + (f.to - f.from) * t;
    }
  }

  // ── Snapshot crossfade / morph (round-2 #1) ────────────────────────────
  // The morph descriptor only owns the wall-clock completion WINDOW + the
  // fade-out id set; the actual interpolation rides transitions[] /
  // _masterFade / _groupFades (already ticked in beginFrame). beginMorph()
  // installs the descriptor; _tickMorph() (called from beginFrame) is an
  // O(1) wall-clock check that fires onMorphComplete exactly once when the
  // window elapses. The api_server's finalizer (onMorphComplete) does the
  // CPC-unregister of the faded-out ids, clears _morph, persists, broadcasts.

  /**
   * Arm a snapshot morph. `fadeOutIds` is the set of current-only channel
   * ids that are ramping to 0 and must be CPC-unregistered + removed on
   * completion (the api_server schedules their destroyOnComplete fades so
   * updateTransitions removes the channel objects; the finalizer cleans CPC).
   * Replacing an in-flight morph is the caller's responsibility (it cancels
   * the prior one at kickoff). durationMs MUST be finite > 0 (re-validated).
   */
  beginMorph(durationMs, fadeOutIds = []) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error(`beginMorph: durationMs must be finite > 0, got ${durationMs}`);
    }
    this._morph = {
      startMs: Date.now(),
      durationMs,
      fadeOutIds: Array.isArray(fadeOutIds) ? fadeOutIds.slice() : [],
    };
  }

  /** Snapshot of the in-flight morph for /status + /mixer, or null. */
  getMorph() {
    if (!this._morph) return null;
    const m = this._morph;
    const elapsed = Math.max(0, Date.now() - m.startMs);
    return {
      active: true,
      durationMs: m.durationMs,
      elapsedMs: Math.min(elapsed, m.durationMs),
      remainingMs: Math.max(0, m.durationMs - elapsed),
      fadeOutIds: m.fadeOutIds.slice(),
    };
  }

  /** Drop the in-flight morph descriptor WITHOUT firing the finalizer.
   *  Used at kickoff to replace a prior morph (the new morph's build path
   *  takes over). Returns true iff a morph was cleared. */
  cancelMorph() {
    if (!this._morph) return false;
    this._morph = null;
    return true;
  }

  /**
   * Advance the morph one render tick. O(1), allocation-free: a single
   * wall-clock comparison. When the window has elapsed, clears `_morph`
   * BEFORE firing `onMorphComplete` (so a re-entrant morph started inside
   * the callback sees a clean descriptor) and invokes the finalizer exactly
   * once. The per-channel/master/group ramps that drove the visible morph
   * have already landed on their targets by this same wall-clock boundary
   * (they share the identical durationMs), so the finalizer's job is purely
   * bookkeeping: CPC-unregister the faded-out ids, persist, broadcast.
   */
  _tickMorph() {
    if (!this._morph) return;
    if (Date.now() - this._morph.startMs < this._morph.durationMs) return;
    // Capture the fade-out id set BEFORE clearing the descriptor so the
    // finalizer can CPC-unregister them. Clear FIRST so a re-entrant morph
    // started inside the callback sees a clean descriptor.
    const fadeOutIds = this._morph.fadeOutIds;
    this._morph = null;
    if (this.onMorphComplete) {
      try { this.onMorphComplete({ fadeOutIds }); }
      catch (e) { console.warn('[Mixer] onMorphComplete threw:', e.message); }
    }
  }

  async transitionBaseTo(patternName, options = {}) {
    const { durationMs = 500, mode = 'blend_screen', loadPatternFn } = options;
    // Note: loadPatternFn should be an async function that returns the compiled handle, exports, etc.
    // However, the mixer operates on handles. The caller should compile and pass the handle.
    // For simplicity, let's assume the caller adds the new channel and sets up a transition here.
    // We will automate the fade.
  }

  /**
   * Cancel any in-flight transition for `channelId`. Returns the number
   * of transitions cancelled (0 or 1 in practice). Call this before any
   * manual fader write so the server-side animation can't fight the
   * operator's hand.
   *
   * Also restores the channel's saved blend mode if the cancelled
   * transition had swapped it to a trans_* script. Without this restore,
   * a user dragging the slider mid-flash would leave the channel stuck
   * rendering `trans_flash` as its steady-state blend mode.
   */
  cancelChannelTransition(channelId) {
    const before = this.transitions.length;
    const cancelled = this.transitions.filter(t => t.channelId === channelId);
    this.transitions = this.transitions.filter(t => t.channelId !== channelId);
    const channel = this.getChannel(channelId);

    // Restore the saved blend mode ONLY if we actually cancelled
    // something. Without this guard we'd undo a brand-new `_savedMode`
    // assignment in cases where the caller (typically fadeChannel)
    // pre-set `_savedMode` and `channel.mode` just before pushing the
    // transition — the cancellation pass would race the trigger and
    // silently snap the blend mode back, killing scripted transitions
    // (trans_flash etc.) the instant they're scheduled.
    if (channel && channel._savedMode && cancelled.length > 0) {
      const restoreMode = cancelled.find(t => t.restoreMode)?.restoreMode || channel._savedMode;
      channel.mode = restoreMode;
      delete channel._savedMode;
      // Pre-compile so the first post-cancel frame doesn't drop the blend.
      this.getBlendHandle(restoreMode);
    }
    // Same reasoning: only clear the scripted-target render-order flag
    // when we actually cancelled a transition for the same channel.
    // Otherwise a fresh trigger would un-promote its own target on the
    // very first fadeChannel call.
    if (cancelled.length > 0 && this.scriptedTransitionTargetId === channelId) {
      this.scriptedTransitionTargetId = null;
    }
    return before - this.transitions.length;
  }

  fadeChannel(channelId, targetFader, durationMs, options = {}) {
    const channel = this.getChannel(channelId);
    if (!channel) return false;

    // Fader-lock: a fader-locked channel's value is frozen against
    // scripted transitions. Refuse to schedule the fade — the caller
    // (typically triggerMixerTransition) should skip the channel
    // upstream so the transition group accounting stays consistent,
    // but this is the final belt-and-suspenders guarantee that no
    // server-side animation can ever drive a locked fader. See the
    // PatternChannel.faderLocked docstring for the full semantics.
    if (channel.faderLocked) return false;

    // Last-write-wins: cancel any existing transition for this channel
    // before pushing the new one. Two stacked fadeChannel calls without
    // this guard would produce visibly jittery faders as updateTransitions
    // ran both lerps against the same channel.fader slot.
    this.cancelChannelTransition(channelId);

    const safeDurationMs = Math.max(1, Number(durationMs) || 1);
    const clampedTarget = Math.max(0, Math.min(1, targetFader));

    this.transitions.push({
      channelId,
      startFader: channel.fader,
      targetFader: clampedTarget,
      startTime: performance.now(),
      durationMs: safeDurationMs,
      destroyOnComplete: options.destroyOnComplete || false,
      isBaseTransition: options.isBaseTransition || false,
      newBaseId: options.newBaseId || null,
      groupId: options.groupId || null,
      curve: options.curve || 'smoothstep',
      // If set, channel.mode is reverted to this string when the
      // transition lands. Used by scripted transitions (trans_flash etc.)
      // to restore the target's steady-state blend mode after the fade.
      restoreMode: options.restoreMode || null,
    });
    return true;
  }

  /**
   * Server-driven group transition. Fades `targetChannelId` to 1.0 and
   * every other overlay channel to 0.0 over `durationMs`. The base/deck
   * channel is never touched. All overlays are force-enabled first
   * (transition wins over mute/solo). Returns the assigned `transitionId`
   * or `null` if nothing was scheduled (no overlays / missing or invalid
   * target).
   *
   * Honors `transitionMode` — the user-selected `trans_*` blend script
   * that drives the visual effect:
   *
   *   - 'trans_crossfade' (default): the target is composited with the real
   *     endpoint-exact crossfade script, never its steady screen/add/over
   *     blend masquerading as a crossfade.
   *
   *   - 'trans_flash' / 'trans_dissolve' / 'trans_iris' / 'trans_wipe_*':
   *     the target channel's `mode` is temporarily swapped to the
   *     selected trans_* script for the duration of the fade. The
   *     channel.fader is ramped 0 → 1, and that value is passed straight
   *     into the WASM blend as `progress`, so the script's visual effect
   *     (flash white, random pixel dissolve, iris open, wipe edge, …)
   *     unfolds across the requested durationMs. On completion the saved
   *     blend mode is restored automatically (see updateTransitions).
   *
   * Losers always fade their faders smoothstep 1 → 0 on their existing
   * blend mode — no script swap — so they smoothly drop out of the mix.
   *
   * Why server-side instead of letting the iPad rAF-drive the fades:
   *   - The engine renders at 40 Hz and applies `channel.fader` on every
   *     tick inside updateTransitions(), so DMX/sACN output updates at
   *     full engine framerate with zero network jitter — no rAF stepping,
   *     no WS throttle dead-zones.
   *   - The client sends ONE WS message instead of a 30 Hz storm of
   *     setChannelFader updates that get throttled, dropped, or coalesced
   *     into visible "dead zones" + sudden jumps. See agent diagnostic
   *     "Mixer Transition Behavior Analysis" (May 2026) §1 / §2.
   *
   * @param {Object} opts
   * @param {string} opts.targetChannelId  Channel that fades to 1.0
   * @param {number} opts.durationMs       Animation length (1–30000 ms)
   * @param {string} [opts.curve]          'smoothstep' (default) or 'linear'
   * @param {string} [opts.mode]           Only 'exclusiveOverlays' supported today
   * @param {string} [opts.transitionMode] 'trans_crossfade' (default) | 'trans_flash' | …
   * @param {string} [opts.transitionId]   Caller-supplied id for round-trip
   */
  triggerMixerTransition({ targetChannelId, durationMs, curve = 'smoothstep', mode = 'exclusiveOverlays', transitionMode = 'trans_crossfade', transitionId = null } = {}) {
    if (mode !== 'exclusiveOverlays') {
      console.warn(`[Mixer] Unsupported mixer transition mode: ${mode}`);
      return null;
    }
    // Mixer transitions only affect the overlay stack — the deck
    // channel is never touched (this is enforced both here and by the
    // /mixer routes that reject deck-channel ids upstream).
    const overlays = this.mixerChannels;
    if (overlays.length === 0) return null;
    if (!overlays.find(c => c.id === targetChannelId)) return null;

    // Validate against the canonical executable catalog. A trans_* typo is
    // rejected explicitly and never substituted with a crossfade.
    if (!isDeckTransitionMode(transitionMode)) {
      console.error(`[Mixer] Invalid transitionMode '${transitionMode}'`);
      return null;
    }
    const resolvedTransMode = transitionMode;
    const handle = this.getBlendHandle(resolvedTransMode);
    if (!handle) {
      console.error(`[Mixer] transitionMode '${resolvedTransMode}' is missing or failed to compile`);
      return null;
    }
    const useScriptedTransition = true;

    // Before scheduling: restore any in-flight saved modes from a
    // previous (still-running) scripted transition. Without this, a
    // back-to-back trigger could snapshot trans_flash as the "saved"
    // mode and never get back to blend_screen.
    for (const c of overlays) {
      if (c._savedMode) {
        c.mode = c._savedMode;
        delete c._savedMode;
      }
    }

    // WAVE 15: a mixer transition is a wholesale re-cue of the overlay stack
    // (every channel's fader is animated to its new target). A leftover solo
    // would gate the fading-out losers to black mid-transition, fighting the
    // crossfade. Clear it at the START so the transition animates against a
    // clean, un-soloed mix. (Solo is transient anyway — never persisted.)
    this.soloedChannelIds.clear();
    // FLASH / BUMP: likewise drop any held bump — a re-cue of the whole stack
    // shouldn't carry a momentary accent into the new look (bump is transient).
    this._bumpedChannelIds.clear();

    const id = transitionId || `g_${++this.transitionGroupCounter}_${Date.now()}`;
    this.activeTransitionGroupId = id;
    this.scriptedTransitionTargetId = useScriptedTransition ? targetChannelId : null;

    for (const c of overlays) {
      // Fader-lock: skip locked channels entirely. We do NOT force-
      // enable them, do NOT touch their fader, and do NOT schedule a
      // fade. This implements the "transitions don't affect this
      // layer" rule literally — a locked channel keeps whatever fader
      // value the operator parked it at, regardless of what the rest
      // of the mix is doing. The transition group accounting still
      // works because fadeChannel() is never invoked for this id.
      // Note: this applies even if `c.id === targetChannelId`. If the
      // operator picks a locked channel as a transition target, the
      // transition for everyone else still runs, but the locked
      // target's fader stays put. Pattern content swaps (which go
      // through loadPlaylistEntry) are still permitted — only the
      // fader value is frozen.
      if (c.faderLocked) continue;

      // Force-enable + anchor at the *visible* contribution. A channel
      // that's currently muted is rendering at 0; treating its start as
      // the stored fader would make it snap to that value the moment we
      // enable it. Anchoring to 0 keeps it fading in cleanly.
      const visibleStart = c.enabled ? c.fader : 0;
      c.enabled = true;
      c.fader = visibleStart;

      const isTarget = c.id === targetChannelId;
      if (isTarget && useScriptedTransition) {
        // Save the steady-state mode so updateTransitions can revert
        // on completion. Anchor fader to 0 so the blend script's
        // progress starts at 0 (== "show from unchanged"); the
        // smoothstep ramp will drive it to 1 by transition end.
        c._savedMode = c.mode;
        c.mode = resolvedTransMode;
        // Keep progress zero exact. Skipping a target at fader zero is the
        // precise trans_* p=0 result and avoids a manufactured first-frame
        // endpoint offset.
        c.fader = 0;
        this.fadeChannel(c.id, 1.0, durationMs, {
          groupId: id,
          curve,
          restoreMode: c._savedMode,
        });
      } else {
        const targetFader = isTarget ? 1.0 : 0.0;
        this.fadeChannel(c.id, targetFader, durationMs, { groupId: id, curve });
      }
    }
    return id;
  }

  // Back-compat shim — old name. Prefer `triggerMixerTransition`.
  transitionTo(targetChannelId, durationMs) {
    return this.triggerMixerTransition({ targetChannelId, durationMs });
  }

  /**
   * Pre-warm the inactive deck slot with a compiled handle for the
   * PREDICTED next pattern, so the next deck advance reuses a warm handle
   * (zero-compile) instead of stalling on a fresh compile in the request
   * path. This is the "precompile-next-entry" optimization for hot-swap
   * playlist playback (feat/timeline_support).
   *
   * Contract (kept deliberately conservative so it can't corrupt phase):
   *   - Refuses while a swap is in flight (the inactive slot is the live
   *     fade target then — overwriting it would glitch the transition).
   *     Returns false; the caller can retry after completion.
   *   - No-op (returns true) if the slot already holds `patternName` —
   *     the fresh handle is already parked.
   *   - Otherwise installs `handle` into the inactive slot at fader 0
   *     (parked, invisible) and destroys whatever stale handle was there.
   *     Ownership of `handle` transfers to the mixer.
   *
   * The parked slot updates only its global-time baseline. It does not enter
   * WASM until selected, so precompile lead time cannot alter visual phase.
   *
   * @param {string} patternName
   * @param {Object} handle  Compiled WASM handle (ownership transfers).
   * @param {string} [mode='blend_screen']  Steady blend for the parked slot.
   * @returns {boolean} true if the slot now holds patternName, false if refused.
   */
  warmInactiveDeckHandle(patternName, handle, mode = 'blend_screen') {
    if (!patternName || !handle) return false;
    if (this.isDeckSwapInFlight()) {
      // Don't touch the slot mid-fade — the caller compiled a handle we
      // now own but can't install; destroy it to avoid a leak.
      try { this.wasmHost.destroy(handle); } catch (_) {}
      return false;
    }
    if (this._inactiveDeckChannel && this._inactiveDeckChannel.pattern === patternName &&
        this._inactiveDeckChannel._deckHandleFresh) {
      // Already warm — the caller's freshly compiled handle is redundant.
      // Destroy it so we don't leak a duplicate VM.
      try { this.wasmHost.destroy(handle); } catch (_) {}
      return true;
    }
    if (this._inactiveDeckChannel) {
      const oldHandle = this._inactiveDeckChannel.handle;
      if (oldHandle && oldHandle !== handle) {
        try { this.wasmHost.destroy(oldHandle); } catch (_) {}
      }
      this._inactiveDeckChannel.handle = handle;
      this._inactiveDeckChannel.pattern = patternName;
      this._inactiveDeckChannel.mode = mode;
      this._inactiveDeckChannel.fader = 0;
      this._inactiveDeckChannel.enabled = true;
      this._inactiveDeckChannel._phaseSeconds = 0;
      this._inactiveDeckChannel._lastPhaseElapsed = null;
      this._inactiveDeckChannel._deckHandleFresh = true;
    } else {
      this._inactiveDeckChannel = new PatternChannel({
        id: '__deck_inactive__',
        name: 'Deck Inactive',
        pattern: patternName,
        handle,
        mode,
        enabled: true,
      });
      this._inactiveDeckChannel._hidden = true;
      this._inactiveDeckChannel.fader = 0;
      this._inactiveDeckChannel._deckHandleFresh = true;
    }
    return true;
  }

  /**
   * Returns the pattern name currently held in the inactive deck slot,
   * or null if there isn't one. The api_server calls this BEFORE
   * compiling a new handle on a deck-swap request — if the inactive
   * slot already holds the requested pattern (the typical "ping-pong"
   * case where the operator just toggled B→A and is now toggling back
   * A→B, leaving the previous A handle warm in the inactive slot), the
   * caller skips the compile entirely and passes `newHandle: null` to
   * `triggerDeckPatternSwap` so the warm handle is reused.
   */
  getInactiveDeckPattern() {
    return this._inactiveDeckChannel ? this._inactiveDeckChannel.pattern : null;
  }

  /**
   * Returns the live inactive deck channel (or null). Internal helper
   * used by the api_server to apply per-entry defaults and pre-register
   * CPC against the inactive handle BEFORE the fade lands. Do not
   * mutate from outside the mixer.
   */
  getInactiveDeckChannel() {
    return this._inactiveDeckChannel;
  }

  isInactiveDeckHandleFresh() {
    return !!(this._inactiveDeckChannel && this._inactiveDeckChannel._deckHandleFresh);
  }

  /**
   * Soft-swap the deck active channel's pattern using a deterministic
   * inactive sibling.
   *
   * Concept (see also `_inactiveDeckChannel` docstring in the constructor):
   *   1. Install the next pattern into the inactive deck channel. Either
   *      reuse the existing warm handle (when caller signals
   *      `newHandle:null` + `getInactiveDeckPattern() === patternName`)
   *      or replace it with the caller's freshly compiled `newHandle`,
   *      destroying whatever the inactive slot previously held.
   *   2. A server-side fader transition ramps the inactive channel
   *      from 0 → 1 with the chosen `transitionMode` (a `trans_*`
   *      blend script — see patterns/transitions/*.js). During the
   *      ramp, `renderAll6ch()` composites the inactive channel ON
   *      TOP of the deck buffer using that blend script, so the
   *      visual effect (crossfade, flash, dissolve, wipe, etc.) plays
   *      out smoothly.
   *   3. On completion, the WASM HANDLES SWAP. `deckChannel` keeps its
   *      id / playlist / localControls / viewSelection intact — only
   *      its `.handle` and `.pattern` get rebound to the newly-active
   *      pattern. The OLD active handle and phase move into the inactive
   *      slot as non-fresh owned state. From the operator's POV the deck now
   *      "is" the new pattern, with no visible glitch.
   *
   * Why we don't reuse `triggerMixerTransition`:
   *   - That routine fades EVERY overlay (winners up, losers down),
   *     which would clobber any user-added mixer overlays on the deck
   *     swap path. Worse, the deck active is explicitly excluded from
   *     that fade. We need a single dedicated target that lives outside
   *     `this.channels` to keep mixer state untouched.
   *
   * Caller contract:
   *   - When `newHandle` is non-null, ownership transfers to the mixer.
   *     Whether the swap succeeds or fails, the mixer is responsible for
   *     destroying it (avoids the caller having to track a
   *     half-installed handle).
   *   - When `newHandle` is null, the caller is asserting that the
   *     warm inactive handle already represents `patternName` — the
   *     mixer verifies this and refuses the swap if it can't.
   *   - `onComplete` fires AFTER the handle swap — i.e. once
   *     `deckChannel.handle` is the new active. The api_server uses
   *     it to re-register CPC, apply entry defaults, save state, and
   *     broadcast — all the bookkeeping that `loadPlaylistEntry`
   *     would normally do synchronously.
   *
   * @param {Object} opts
   * @param {Object|null} opts.newHandle   Compiled WASM handle, or null
   *   to reuse the warm inactive handle (caller pre-checked
   *   `getInactiveDeckPattern() === patternName`).
   * @param {string} opts.patternName      Pattern name (for channel.pattern)
   * @param {number} [opts.durationMs=1000]
   * @param {string} [opts.transitionMode='trans_crossfade']
   * @param {Function} [opts.onComplete]   Called once the swap completes
   * @param {Function} [opts.onCancel]     Called once if the swap is cancelled
   * @returns {string} Transition id. Invalid state throws.
   */
  triggerDeckPatternSwap({
    newHandle = null,
    patternName,
    durationMs = 1000,
    transitionMode = 'trans_crossfade',
    onComplete = null,
    onCancel = null,
  } = {}) {
    if (!this.deckChannel) {
      // No active deck to swap onto — refuse and destroy the incoming
      // handle so the caller doesn't leak the freshly compiled VM.
      if (newHandle) {
        try { this.wasmHost.destroy(newHandle); } catch (_) {}
      }
      throw new Error('cannot start Deck transition without an active Deck channel');
    }

    if (this._swapTransition) {
      if (newHandle) {
        try { this.wasmHost.destroy(newHandle); } catch (_) {}
      }
      const error = new Error('swap-already-in-flight');
      error.code = 'EBUSY';
      throw error;
    }
    const resolvedDurationMs = Number(durationMs);
    if (!Number.isFinite(resolvedDurationMs) || resolvedDurationMs <= 0) {
      if (newHandle) {
        try { this.wasmHost.destroy(newHandle); } catch (_) {}
      }
      throw new Error(`Deck transition durationMs must be a positive finite number, got '${durationMs}'`);
    }
    if (!isDeckTransitionMode(transitionMode)) {
      if (newHandle) {
        try { this.wasmHost.destroy(newHandle); } catch (_) {}
      }
      throw new Error(`invalid Deck transition mode '${transitionMode}'`);
    }
    if (!this.getBlendHandle(transitionMode)) {
      if (newHandle) {
        try { this.wasmHost.destroy(newHandle); } catch (_) {}
      }
      throw new Error(`Deck transition '${transitionMode}' is missing or failed to compile`);
    }

    // Reuse-vs-replace path on the inactive slot:
    //
    //   newHandle=null  → caller asserts the warm inactive already IS
    //                     patternName. Verify; refuse if mismatched.
    //   newHandle set   → take ownership. If inactive already exists,
    //                     destroy its handle and re-bind to newHandle.
    if (!newHandle) {
      if (!this._inactiveDeckChannel || this._inactiveDeckChannel.pattern !== patternName ||
          !this._inactiveDeckChannel._deckHandleFresh) {
        throw new Error(`Deck transition reuse requested for '${patternName}', but no fresh precompiled handle is parked`);
      }
      // Reuse path: nothing to install. _inactiveDeckChannel already
      // has the right handle + pattern. Just reset its render state.
    }

    // If a prior swap is mid-flight, drop the in-flight transition
    // BEFORE re-binding the inactive slot. Operator spamming pattern
    // picks must always converge on the LAST pick — the new pick takes
    // over the inactive slot. We deliberately keep the inactive channel
    // object alive; its handle will be replaced below if newHandle is
    // non-null.
    // Resolve transition mode. Fall back to plain crossfade if the
    // requested blend script can't compile — a clean fade beats an
    // operator-tap error every time.
    const inactiveMode = transitionMode;

    if (newHandle) {
      // Replace path. Re-bind inactive to the freshly compiled handle.
      if (this._inactiveDeckChannel) {
        // Free the OLD warm handle — caller is bringing a different
        // pattern. Guard against double-free if the same handle pointer
        // somehow flowed through twice.
        const oldHandle = this._inactiveDeckChannel.handle;
        if (oldHandle && oldHandle !== newHandle) {
          try { this.wasmHost.destroy(oldHandle); } catch (_) {}
        }
        this._inactiveDeckChannel.handle = newHandle;
        this._inactiveDeckChannel.pattern = patternName;
        this._inactiveDeckChannel._phaseSeconds = 0;
        this._inactiveDeckChannel._lastPhaseElapsed = null;
        this._inactiveDeckChannel._deckHandleFresh = true;
      } else {
        // First-ever swap: allocate the inactive sibling. Persistent
        // for the engine's lifetime — subsequent swaps just rebind
        // .handle / .pattern in place.
        this._inactiveDeckChannel = new PatternChannel({
          id: '__deck_inactive__',
          name: 'Deck Inactive',
          pattern: patternName,
          handle: newHandle,
          mode: inactiveMode,
          enabled: true,
        });
        this._inactiveDeckChannel._hidden = true;
        this._inactiveDeckChannel._deckHandleFresh = true;
      }
    }

    // Set up the transition. Anchor fader at 0.002 so the blend script
    // runs on the very first tick (above the 0.001 render skip
    // threshold; otherwise the first ~25 ms would skip compositing
    // and produce a visible "pop").
    this._inactiveDeckChannel.mode = inactiveMode;
    this._inactiveDeckChannel.fader = 0;
    this._inactiveDeckChannel.enabled = true;
    // Defensive: ensure pattern name is in sync (reuse path passes
    // newHandle=null but the caller still tells us the patternName).
    this._inactiveDeckChannel.pattern = patternName;

    const id = `deck_${++this.transitionGroupCounter}_${Date.now()}`;
    this._swapTransition = {
      id,
      startFader: 0,
      targetFader: 1.0,
      startTime: performance.now(),
      durationMs: resolvedDurationMs,
      onComplete,
      onCancel,
    };
    return id;
  }

  /**
   * Cancel any in-flight deck swap. Does NOT destroy the inactive
   * handle (the inactive slot is persistent across swaps) — just drops
   * the in-flight transition and parks the inactive fader at 0.
   * Useful when the operator triggers a new swap before the previous
   * one has landed, or when the engine shuts down mid-fade.
   */
  cancelDeckPatternSwap() {
    if (!this._swapTransition) return false;
    const cancelled = this._swapTransition;
    this._swapTransition = null;
    if (this._inactiveDeckChannel) {
      // Reset render state so a stale fader doesn't leak into the next
      // render frame.
      this._inactiveDeckChannel.fader = 0;
    }
    if (cancelled.onCancel) {
      try {
        cancelled.onCancel({ transitionId: cancelled.id });
      } catch (e) {
        console.warn('[Mixer] deck-swap onCancel threw:', e.message);
      }
    }
    // Tell listeners the swap is over. The swap's own onComplete is
    // deliberately NOT run (that would commit the cancelled target) —
    // but clients that dimmed/disabled their UI on deckSwapStarted must
    // be released, or they wedge until a remount.
    if (this.onDeckSwapCancelled) {
      try {
        this.onDeckSwapCancelled({ transitionId: cancelled.id });
      } catch (e) {
        console.warn('[Mixer] onDeckSwapCancelled threw:', e.message);
      }
    }
    return true;
  }

  /**
   * True iff a deck pattern swap is currently animating. Used by the
   * API layer to refuse new manual taps (the operator asked for taps
   * during an in-flight swap to be IGNORED, not queued) and to short-
   * circuit redundant "finish now" calls.
   */
  isDeckSwapInFlight() {
    return !!(this._swapTransition && this._inactiveDeckChannel);
  }

  /**
   * Force the current deck swap to land NOW: jumps the fader to 1.0,
   * runs the same atomic handle swap + onComplete callback that
   * `updateDeckSwapTransition` would on normal completion, then returns.
   *
   * Used when the operator navigates away from the deck tab mid-fade
   * (CaptainPad → mixer view): they expect the deck to be "settled" on
   * the destination pattern by the time they come back. Snap-to-end is
   * cleaner than letting a half-blended deck buffer hang around invisibly
   * while the user is in the mixer view.
   *
   * Idempotent: returns false if no swap is in flight.
   */
  finishDeckSwapNow() {
    if (!this.isDeckSwapInFlight()) return false;
    // Trick updateDeckSwapTransition into running its "linear >= 1"
    // branch by rewinding startTime far enough back that elapsed
    // exceeds durationMs. This keeps the SAME completion path — atomic
    // handle swap, onComplete callback, scriptedTransitionTargetId
    // cleanup if applicable — without us reimplementing it here and
    // drifting from the normal flow.
    this._swapTransition.startTime = performance.now() - this._swapTransition.durationMs - 1;
    this.updateDeckSwapTransition(performance.now());
    return true;
  }

  /**
   * Tick the deck-swap transition one frame. Called from beginFrame().
   * Handles fader ramp, ATOMIC HANDLE SWAP on completion, and the
   * `onComplete` callback.
   *
   * Handle-swap semantics: on completion, the WASM handles inside
   * `deckChannel` and `_inactiveDeckChannel` SWAP. The persistent deck
   * identity (`deckChannel.id`, `.localControls`, `.playlist`, etc.) is
   * preserved — `.handle`, `.pattern`, and their phase-clock fields move
   * together. The OLD active state moves into the inactive slot as non-fresh
   * owned state and is replaced by the next fresh compile.
   *
   * Why not swap whole channel POINTERS (operator's literal phrasing)?
   * `deckChannel` is the IDENTITY container — id, playlist state,
   * localControls, viewSelection. Swapping the pointer would change
   * the deck's id under the API layer's feet and orphan
   * localControls/playlist on the demoted sibling. The handle swap
   * preserves the operator-visible identity while preventing a one-frame
   * phase jump at promotion.
   */
  updateDeckSwapTransition(now = performance.now()) {
    if (!this._swapTransition || !this._inactiveDeckChannel) return;
    const t = this._swapTransition;
    const elapsed = now - t.startTime;
    let linear = t.durationMs > 0 ? elapsed / t.durationMs : 1;
    if (linear >= 1) linear = 1;
    // Same smoothstep ease as updateTransitions for visual consistency.
    const eased = linear * linear * (3 - 2 * linear);
    this._inactiveDeckChannel.fader = t.startFader + (t.targetFader - t.startFader) * eased;

    if (linear >= 1) {
      // Snap exactly so floating-point drift can't strand us at 0.9999.
      this._inactiveDeckChannel.fader = 1.0;
      const base = this.deckChannel;
      const inactiveCh = this._inactiveDeckChannel;
      const finishedId = t.id;
      const finishedCb = t.onComplete;
      const finishedPattern = inactiveCh.pattern;

      // Atomic HANDLE SWAP. `deckChannel` keeps its id / playlist /
      // localControls / viewSelection intact — only its .handle and
      // .pattern get rebound to the newly-active pattern. The old
      // active handle moves into the inactive slot for warmth (so a
      // ping-pong back is a zero-compile reuse). No handle gets
      // destroyed here — both stay alive across the swap.
      const newActiveHandle = inactiveCh.handle;
      const newActivePattern = inactiveCh.pattern;
      const oldActiveHandle = base.handle;
      const oldActivePattern = base.pattern;
      const newActivePhaseSeconds = inactiveCh._phaseSeconds;
      const newActiveLastPhaseElapsed = inactiveCh._lastPhaseElapsed;
      const oldActivePhaseSeconds = base._phaseSeconds;
      const oldActiveLastPhaseElapsed = base._lastPhaseElapsed;

      // Promote on the base channel object.
      base.handle = newActiveHandle;
      base.pattern = newActivePattern;
      base._phaseSeconds = newActivePhaseSeconds;
      base._lastPhaseElapsed = newActiveLastPhaseElapsed;
      // Demote into the warm inactive slot. Fader resets to 0 so we
      // don't paint into deckBuffer outside of an active transition.
      inactiveCh.handle = oldActiveHandle;
      inactiveCh.pattern = oldActivePattern;
      inactiveCh._phaseSeconds = oldActivePhaseSeconds;
      inactiveCh._lastPhaseElapsed = oldActiveLastPhaseElapsed;
      inactiveCh._deckHandleFresh = false;
      inactiveCh.fader = 0;

      // Clear in-flight bookkeeping BEFORE the onComplete callback so
      // a re-entrant trigger inside the callback sees a clean state.
      this._swapTransition = null;

      if (finishedCb) {
        try {
          finishedCb({ pattern: finishedPattern, transitionId: finishedId });
        } catch (e) {
          console.warn('[Mixer] deck-swap onComplete threw:', e.message);
        }
      }
      if (this.onDeckSwapComplete) {
        try {
          this.onDeckSwapComplete({ pattern: finishedPattern, transitionId: finishedId });
        } catch (e) {
          console.warn('[Mixer] onDeckSwapComplete threw:', e.message);
        }
      }
    }
  }

  /**
   * Prepare pattern B without changing the authoritative Live Touch base A.
   * The caller may seed code/playlist/CPC defaults on the returned channel,
   * then start the exact retained transition with startLiveTouchPatternSwap().
   */
  prepareLiveTouchPatternSwap({ newHandle, patternName } = {}) {
    if (!this.liveTouchChannel || !this.liveTouchChannel.handle) {
      if (newHandle) this.wasmHost.destroy(newHandle);
      throw new Error('cannot prepare Live Touch transition without an active base pattern');
    }
    if (this._liveTouchSwapTransition || this._inactiveLiveTouchChannel) {
      if (newHandle) this.wasmHost.destroy(newHandle);
      const error = new Error('live-touch-swap-already-in-flight');
      error.code = 'EBUSY';
      throw error;
    }
    if (!newHandle) {
      throw new Error('Live Touch transition requires a compiled incoming handle');
    }
    if (typeof patternName !== 'string' || patternName.length === 0) {
      this.wasmHost.destroy(newHandle);
      throw new Error('Live Touch transition patternName must be a non-empty string');
    }
    if (!this.getBlendHandle('trans_crossfade')) {
      this.wasmHost.destroy(newHandle);
      throw new Error("Live Touch transition 'trans_crossfade' is missing or failed to compile");
    }

    this._inactiveLiveTouchChannel = new PatternChannel({
      id: '__live_touch_swap__',
      name: 'Live Touch Incoming',
      pattern: patternName,
      handle: newHandle,
      mode: 'trans_crossfade',
      fader: 0,
      enabled: true,
      viewSelection: this.liveTouchChannel.viewSelection,
    });
    this.recompileChannelMask(this._inactiveLiveTouchChannel);
    return this._inactiveLiveTouchChannel;
  }

  /** Start the one authored Live Touch base transition: trans_crossfade / 500ms. */
  startLiveTouchPatternSwap({ onComplete = null, onCancel = null } = {}) {
    if (this._liveTouchSwapTransition) {
      const error = new Error('live-touch-swap-already-in-flight');
      error.code = 'EBUSY';
      throw error;
    }
    if (!this._inactiveLiveTouchChannel || !this._inactiveLiveTouchChannel.handle) {
      throw new Error('Live Touch transition has no prepared incoming pattern');
    }
    const id = `live_touch_${++this.transitionGroupCounter}_${Date.now()}`;
    this._liveTouchSwapTransition = {
      id,
      startTime: performance.now(),
      durationMs: 500,
      onComplete,
      onCancel,
    };
    this._emitLiveTouchPatternSwap('started');
    return id;
  }

  getInactiveLiveTouchChannel() {
    return this._inactiveLiveTouchChannel;
  }

  isLiveTouchPatternSwapInFlight() {
    return !!(this._liveTouchSwapTransition && this._inactiveLiveTouchChannel);
  }

  getLiveTouchPatternTransitionState() {
    if (!this.isLiveTouchPatternSwapInFlight()) return null;
    const transition = this._liveTouchSwapTransition;
    return {
      id: transition.id,
      fromPattern: this.liveTouchChannel ? this.liveTouchChannel.pattern : null,
      toPattern: this._inactiveLiveTouchChannel.pattern,
      progress: this._inactiveLiveTouchChannel.fader,
      durationMs: transition.durationMs,
      mode: 'trans_crossfade',
    };
  }

  cancelLiveTouchPatternSwap() {
    const transition = this._liveTouchSwapTransition;
    const incoming = this._inactiveLiveTouchChannel;
    if (!transition && !incoming) return false;
    this._liveTouchSwapTransition = null;
    this._inactiveLiveTouchChannel = null;
    if (incoming && incoming.handle) this.wasmHost.destroy(incoming.handle);
    if (transition && transition.onCancel) {
      try {
        transition.onCancel({ transitionId: transition.id });
      } catch (error) {
        console.warn(`[Mixer] Live Touch swap onCancel threw: ${error.message}`);
      }
    }
    this._emitLiveTouchPatternSwap('cancelled', {
      transitionId: transition ? transition.id : null,
    });
    return true;
  }

  updateLiveTouchPatternSwap(now = performance.now()) {
    if (!this.isLiveTouchPatternSwapInFlight()) return false;
    const transition = this._liveTouchSwapTransition;
    const incoming = this._inactiveLiveTouchChannel;
    const linear = Math.max(0, Math.min(1, (now - transition.startTime) / transition.durationMs));
    incoming.fader = linear * linear * (3 - 2 * linear);
    if (linear < 1) {
      this._emitLiveTouchPatternSwap('progress');
      return true;
    }

    incoming.fader = 1;
    const active = this.liveTouchChannel;
    const outgoingHandle = active.handle;
    active.handle = incoming.handle;
    active.pattern = incoming.pattern;
    active.localControls = incoming.localControls;
    active._phaseSeconds = incoming._phaseSeconds;
    active._lastPhaseElapsed = incoming._lastPhaseElapsed;
    active.compiledPixelMask = incoming.compiledPixelMask;
    this._liveTouchSwapTransition = null;
    this._inactiveLiveTouchChannel = null;
    this.wasmHost.destroy(outgoingHandle);

    if (transition.onComplete) {
      try {
        transition.onComplete({ pattern: active.pattern, transitionId: transition.id });
      } catch (error) {
        console.warn(`[Mixer] Live Touch swap onComplete threw: ${error.message}`);
      }
    }
    this._emitLiveTouchPatternSwap('completed', {
      pattern: active.pattern,
      transitionId: transition.id,
    });
    return true;
  }

  _emitLiveTouchPatternSwap(event, detail = null) {
    if (!this.onLiveTouchPatternSwapChange) return;
    try {
      this.onLiveTouchPatternSwapChange({
        event,
        detail,
        transition: this.getLiveTouchPatternTransitionState(),
        pattern: this.liveTouchChannel ? this.liveTouchChannel.pattern : null,
      });
    } catch (error) {
      console.warn(`[Mixer] Live Touch swap observer threw: ${error.message}`);
    }
  }

  updateTransitions(now = performance.now()) {
    if (this.transitions.length === 0) return false;

    // Snapshot of groups in-flight before this tick — used to fire
    // onTransitionComplete EXACTLY once per group, even if N channels
    // in the same group finish on the same tick. Without this guard the
    // API layer would call saveAllState() once per channel (N writes
    // per transition completion).
    const groupsBefore = new Set();
    for (const t of this.transitions) if (t.groupId) groupsBefore.add(t.groupId);

    for (let i = this.transitions.length - 1; i >= 0; i--) {
      const t = this.transitions[i];
      const elapsed = now - t.startTime;
      let linear = t.durationMs > 0 ? elapsed / t.durationMs : 1;
      if (linear >= 1) linear = 1;
      // Smooth-step ease: derivative is 0 at both endpoints. Winner
      // (start→1) and losers (start→0) ride the SAME curve in their
      // respective directions, so brightness is symmetric across the
      // transition — no "fast at one end, frozen at the other"
      // artifacts that the previous sin/cos pair produced.
      // Agent review (May 2026) §1.
      let eased;
      if (t.curve === 'linear') {
        eased = linear;
      } else {
        eased = linear * linear * (3 - 2 * linear); // smoothstep default
      }

      const channel = this.getChannel(t.channelId);
      if (channel) {
        channel.fader = t.startFader + (t.targetFader - t.startFader) * eased;
      }

      if (linear >= 1) {
        // Snap exactly to target so floating-point drift never strands
        // the final fader at 0.9999 or 0.0001.
        if (channel) channel.fader = t.targetFader;
        // Restore the saved blend mode for scripted transitions
        // (trans_flash etc.). After this the channel goes back to
        // compositing normally with blend_screen / etc.
        if (t.restoreMode && channel) {
          channel.mode = t.restoreMode;
          delete channel._savedMode;
          // Pre-compile so the very next frame doesn't drop the blend
          // while the WASM handle is lazily loaded.
          this.getBlendHandle(t.restoreMode);
        }
        if (t.destroyOnComplete && channel) {
          this.removeChannel(t.channelId);
        }
        if (t.isBaseTransition && t.newBaseId) {
          // Re-home a mixer overlay onto the deck slot — see
          // `set baseChannelId` for the migration semantics.
          this.baseChannelId = t.newBaseId;
        }
        this.transitions.splice(i, 1);
      }
    }

    // After-tick group accounting
    const groupsAfter = new Set();
    for (const t of this.transitions) if (t.groupId) groupsAfter.add(t.groupId);

    // Clear the scripted-target render-order flag when its group lands.
    if (this.scriptedTransitionTargetId &&
        !this.transitions.some(t => t.channelId === this.scriptedTransitionTargetId)) {
      this.scriptedTransitionTargetId = null;
    }

    if (this.onTransitionProgress) {
      try { this.onTransitionProgress({ transitionId: this.activeTransitionGroupId, active: this.transitions.length > 0 }); }
      catch (e) { console.warn('[Mixer] onTransitionProgress threw:', e.message); }
    }

    for (const gid of groupsBefore) {
      if (!groupsAfter.has(gid)) {
        if (gid === this.activeTransitionGroupId) this.activeTransitionGroupId = null;
        if (this.onTransitionComplete) {
          try { this.onTransitionComplete({ transitionId: gid }); }
          catch (e) { console.warn('[Mixer] onTransitionComplete threw:', e.message); }
        }
      }
    }
    return true;
  }

  beginFrame(elapsedSeconds) {
    if (this._canonicalLayerRouting) {
      this.layerRouter.tick();
      this._syncLegacyViewFaderFromLayerRouter();
    }
    const renderDeck = this.isLayerSettingRenderParticipant(LAYER_SETTING_IDS.DECK);
    const renderMixer = this.isLayerSettingRenderParticipant(LAYER_SETTING_IDS.MIXER);
    const renderLiveTouch = this.isLayerSettingRenderParticipant(LAYER_SETTING_IDS.LIVE_TOUCH);
    const now = performance.now();
    // Administrative transitions keep settling on wall clock even while their
    // setting is hidden. This preserves the pre-router behavior (a requested
    // fade/morph still completes) without entering any inactive pattern WASM.
    this.updateTransitions(now);
    // Snapshot morph (round-2 #1): the group-fader ramps tick alongside the
    // per-channel transitions (above) and the grand-master fade (in
    // renderAll6ch). _tickGroupFades is allocation-free + a no-op when no
    // group fade is in flight. The morph COMPLETION check runs AFTER the
    // ramps so the final landed values are committed before the finalizer
    // CPC-unregisters the faded-out channels and persists.
    this._tickGroupFades();
    this._tickMorph();
    // Deck-swap shadow runs on the same clock so its fader animation
    // visibly matches the existing overlay-fade animations.
    this.updateDeckSwapTransition(now);
    this.updateLiveTouchPatternSwap(now);
    // Tick only participating settings. Inactive clocks are suspended: update
    // their phase baseline without entering WASM so they resume without a
    // catch-up jump. Muted channels inside an active setting still advance so
    // that setting's vis previews remain live.
    if (renderDeck && this.deckChannel) {
      this.deckChannel.beginFrame(
        this.wasmHost, elapsedSeconds, true, this._effectiveSpeed(this.deckChannel));
    } else if (this.deckChannel) {
      this.deckChannel._lastPhaseElapsed = elapsedSeconds;
    }
    for (const channel of this.mixerChannels) {
      if (renderMixer) {
        channel.beginFrame(this.wasmHost, elapsedSeconds, true, this._effectiveSpeed(channel));
      } else {
        channel._lastPhaseElapsed = elapsedSeconds;
      }
    }
    // Deck overlays (deck dynamic view overrides) tick on the SAME shared
    // global clock + params as every other channel — they call beginFrame
    // with the SAME `elapsedSeconds` and go through `_effectiveSpeed`, so the
    // global speed/tap-tempo apply to them identically to the deck and mixer
    // overlays (operator refinement #2: shared globals). forceRender=true so a
    // muted overlay still advances its phase (vis + ping-pong smoothness).
    for (const overlay of this.deckOverlays) {
      if (renderDeck && overlay.sourceMode !== 'solid') {
        overlay.beginFrame(this.wasmHost, elapsedSeconds, true, this._effectiveSpeed(overlay));
      } else {
        overlay._lastPhaseElapsed = elapsedSeconds;
      }
    }
    // Tick the inactive Deck sibling only while it is the live transition
    // target. A parked precompile updates its baseline below without entering
    // WASM, so its phase remains zero until selection. During the fade it uses
    // the active Deck's effective speed, and its phase state is promoted with
    // its handle at completion.
    if (renderDeck && this.isDeckSwapInFlight()) {
      const deckSpeed = this.deckChannel ? this._effectiveSpeed(this.deckChannel) : 1;
      this._inactiveDeckChannel.beginFrame(this.wasmHost, elapsedSeconds, true, deckSpeed);
    } else if (this._inactiveDeckChannel) {
      this._inactiveDeckChannel._lastPhaseElapsed = elapsedSeconds;
    }
    if (renderLiveTouch && this.liveTouchChannel) {
      const localSpeed = this.liveTouchPhaseSpeedProvider
        ? this.liveTouchPhaseSpeedProvider(this.liveTouchChannel)
        : 1;
      if (typeof localSpeed !== 'number' || !Number.isFinite(localSpeed) || localSpeed <= 0) {
        throw new Error(`Live Touch phase speed provider returned invalid speed '${localSpeed}'`);
      }
      this.liveTouchChannel.beginFrame(
        this.wasmHost,
        elapsedSeconds,
        true,
        this._effectiveSpeed(this.liveTouchChannel) * localSpeed,
      );
    } else if (this.liveTouchChannel) {
      this.liveTouchChannel._lastPhaseElapsed = elapsedSeconds;
    }
    if (renderLiveTouch && this.isLiveTouchPatternSwapInFlight()) {
      const incoming = this._inactiveLiveTouchChannel;
      const localSpeed = this.liveTouchPhaseSpeedProvider
        ? this.liveTouchPhaseSpeedProvider(incoming)
        : 1;
      if (typeof localSpeed !== 'number' || !Number.isFinite(localSpeed) || localSpeed <= 0) {
        throw new Error(`Live Touch incoming phase speed is invalid: '${localSpeed}'`);
      }
      incoming.beginFrame(
        this.wasmHost,
        elapsedSeconds,
        true,
        this._effectiveSpeed(incoming) * localSpeed,
      );
    } else if (this._inactiveLiveTouchChannel) {
      this._inactiveLiveTouchChannel._lastPhaseElapsed = elapsedSeconds;
    }
  }

  applyMaster(out, master) {
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.round(out[i] * master);
    }
  }

  _bufferForLayerSetting(setting) {
    if (setting === LAYER_SETTING_IDS.DECK) return this.deckBuffer;
    if (setting === LAYER_SETTING_IDS.MIXER) return this.mixerBuffer;
    if (setting === LAYER_SETTING_IDS.LIVE_TOUCH) return this.liveTouchBuffer;
    throw new RangeError(`No render buffer for unknown layer setting '${setting}'`);
  }

  renderAll6ch() {
    this._frameCounter++;
    if (!this.deckBuffer) {
      this.deckBuffer = new Uint8Array(this.pixelCount * 6);
      this.mixerBuffer = new Uint8Array(this.pixelCount * 6);
      this.liveTouchBuffer = new Uint8Array(this.pixelCount * 6);
    }

    this.deckBuffer.fill(0);
    this.mixerBuffer.fill(0);
    this.liveTouchBuffer.fill(0);
    this.outputBuffer.fill(0);

    // Per-channel vis data (RGBWAU, 6 bytes per pixel).
    //
    // OPTIMIZATION (May 2026): we used to fully re-render every channel
    // on every frame here just to populate _visData. Patterns are not
    // cheap (custom WASM bytecode running per pixel), and the vis
    // broadcast on top of this fires at 10 Hz, not 40 Hz — so 3 out
    // of every 4 frames of work were thrown away. With 4 channels
    // (base + 3 overlays) on a hot mac that doubled the per-frame
    // cost. The fix is dead simple:
    //
    //   - Skip the per-channel pre-pass when wantVisThisFrame is false.
    //   - engine.js sets it to true only on frames where it will
    //     actually broadcast vis (every ~100 ms).
    //   - Compositing renders below still happen every frame (they
    //     drive the actual sACN output and the visible deck/mixer
    //     buffer), so the engine output is unaffected.
    //
    // Stale frames between broadcasts keep the previous _visData,
    // which is fine — nobody reads it on those ticks.
    const wantVis = this.wantVisThisFrame !== false;
    if (wantVis) {
      this._visData = {};
      // Per-channel meter levels (item: channel metering). Reset alongside
      // _visData and refilled in the vis pre-pass below; drained together
      // by the broadcast each vis frame.
      this._visLevels = {};
    }

    // Grand-master timed fade (F-B). Advance before compositing so this
    // frame's applyMaster uses the freshly-stepped value. Frame-rate
    // independent (wall-clock interpolation); a no-op when no fade is in
    // flight. Lives alongside the viewFader ramp below by design.
    this._tickMasterFade();

    // Smooth view crossfade (0 = deck, 1 = mixer). Time-based ramp so
    // the perceived duration stays at viewFaderRampPerSec regardless
    // of the engine's render fps. dt is clamped so a frame stall
    // (GC pause, sACN backpressure) doesn't fast-forward the fade.
    if (!this._canonicalLayerRouting) {
      const nowMs = Date.now();
      const last = this._lastViewFaderTickMs;
      this._lastViewFaderTickMs = nowMs;
      if (this.viewFader !== this.targetViewFader && last !== null) {
        const dt = Math.max(0, Math.min(0.25, (nowMs - last) / 1000));
        const step = this.viewFaderRampPerSec * dt;
        if (this.viewFader < this.targetViewFader) {
          this.viewFader = Math.min(this.targetViewFader, this.viewFader + step);
        } else {
          this.viewFader = Math.max(this.targetViewFader, this.viewFader - step);
        }
      }
    }

    const renderDeck = this.isLayerSettingRenderParticipant(LAYER_SETTING_IDS.DECK);
    const renderMixer = this.isLayerSettingRenderParticipant(LAYER_SETTING_IDS.MIXER);
    const renderLiveTouch = this.isLayerSettingRenderParticipant(LAYER_SETTING_IDS.LIVE_TOUCH);

    // WAVE 15 hot-path precompute (allocation-free): refresh the per-frame
    // group-scale cache (clear()+set() — no realloc) and the soloActive flag
    // ONCE, BEFORE both the vis pre-pass (meter levels) and the composite
    // channel loop, so _effFader is pure O(1) arithmetic per channel and the
    // meter level uses the exact same effFader the composite gate does.
    // groupScale = muted ? 0 : fader.
    this._groupScaleCache.clear();
    for (let i = 0; i < this.mixGroups.length; i++) {
      const g = this.mixGroups[i];
      this._groupScaleCache.set(g.id, g.muted ? 0 : g.fader);
    }
    const soloActive = this.soloedChannelIds.size > 0;

    // 1. Render ALL channels for vis data (every channel always gets fresh
    //    vis on vis-broadcast frames). Skipped on non-broadcast frames per
    //    the OPTIMIZATION note above.
    //
    //    Per-channel METER LEVEL is folded into this same pass (no extra
    //    render, no extra buffer): the channel's intrinsic mean brightness
    //    (`_bufferMeanLevel`, one pass over the just-rendered channelBuffer)
    //    scaled by its EFFECTIVE fader so the meter reflects what actually
    //    reaches the mix — a fader at 0 / muted group / solo gate drives the
    //    level to ~0 even when the underlying pattern is bright. The deck is
    //    PFL (rendered at 100% downstream), so its meter uses only its OWN
    //    clamped fader + enabled gate (decks are never in groups / solos).
    if (wantVis) {
      if (renderDeck && this.deckChannel) {
        this.channelBuffer.fill(0);
        this.deckChannel.renderInto(this.wasmHost, this.channelBuffer, true);
        // Mirror the composite-loop hue shift so the vis meter/preview
        // shows the recolored layer (docs/39 §F-hue). Gated on non-zero.
        if (this.deckChannel.hue) {
          applyHueShift6chU8(this.channelBuffer, this.pixelCount, this.deckChannel.hue);
        }
        this._visData[this.deckChannel.id] = this._extractVisInto(this.deckChannel.id, this.channelBuffer);
        const d = this.deckChannel;
        let deckEff = 0;
        if (d.enabled) {
          const fMax = (typeof d.faderMax === 'number' && Number.isFinite(d.faderMax)) ? d.faderMax : 1.0;
          let f = d.fader < fMax ? d.fader : fMax;
          if (f < 0) f = 0;
          deckEff = f;
        }
        this._visLevels[d.id] = this._bufferMeanLevel(this.channelBuffer) * deckEff;
      }
      if (renderMixer) {
        for (const channel of this.mixerChannels) {
          this.channelBuffer.fill(0);
          channel.renderInto(this.wasmHost, this.channelBuffer, true);
          // Mirror the composite-loop hue shift so meter + vis match what
          // actually blends into the mix (docs/39 §F-hue). Gated on non-zero.
          if (channel.hue) {
            applyHueShift6chU8(this.channelBuffer, this.pixelCount, channel.hue);
          }
          // View-selection blackout for the channel PREVIEW (docs/58 §5,
          // docs/27 §4.2). Same call the deck PFL preview (:3431) and Live
          // Touch (:3402) already make: a channel view-selected to `te_sign`
          // must not broadcast its pattern across the whole ship, or the
          // mixer's top-down pixel view answers "where does this layer land"
          // wrongly for every view-selected channel. Affects the PREVIEW
          // buffer only — the composite path below is untouched, and the
          // 2026-06-29 "TRUE pattern at full brightness" ruling (which is
          // about FADER independence) still holds.
          if (channel.compiledPixelMask) {
            applyPreviewMaskBlackout(this.channelBuffer, channel.compiledPixelMask, this.pixelCount);
          }
          this._visData[channel.id] = this._extractVisInto(channel.id, this.channelBuffer);
          this._visLevels[channel.id] =
            this._bufferMeanLevel(this.channelBuffer) * this._effFader(channel, soloActive);
        }
      }
      if (renderLiveTouch && this.liveTouchChannel) {
        const live = this.liveTouchChannel;
        this.channelBuffer.fill(0);
        live.renderInto(this.wasmHost, this.channelBuffer, true);
        if (live.hue) applyHueShift6chU8(this.channelBuffer, this.pixelCount, live.hue);
        if (live.compiledPixelMask) {
          applyPreviewMaskBlackout(this.channelBuffer, live.compiledPixelMask, this.pixelCount);
        }
        this._visData[live.id] = this._extractVisInto(live.id, this.channelBuffer);
        this._visLevels[live.id] = this._bufferMeanLevel(this.channelBuffer);
      }
    }

    // 2. Render Deck (deck channel → deckBuffer)
    //
    // The deck channel renders as PFL (Pre-Fade Listen, always 100%).
    const deck = this.deckChannel;
    if (renderDeck && deck) {
      this.channelBuffer.fill(0);
      deck.renderInto(this.wasmHost, this.deckBuffer, true);

      // Per-channel Hue shift on the live deck/PFL output (docs/39
      // §F-hue): rotate the previewed channel's RGB hue (W/A/U untouched)
      // so the deck buffer matches the composite. Gated on non-zero.
      if (deck.hue) {
        applyHueShift6chU8(this.deckBuffer, this.pixelCount, deck.hue);
      }

      // View-selection blackout for the deck preview. PFL means "show
      // me exactly what THIS channel covers" — unselected pixels go
      // black so the operator can see at a glance which fixtures the
      // channel will affect. (Live mixer overlays do the opposite —
      // they preserve the background; see the mixer compositing loop.)
      // See docs/27 §2 / §4.2 applyPreviewMaskBlackout.
      if (deck.compiledPixelMask) {
        applyPreviewMaskBlackout(this.deckBuffer, deck.compiledPixelMask, this.pixelCount);
      }
    }

    // 2a. Deck dynamic view overrides (deck overlays) — composite OVER the
    //     deck buffer, bottom→top, into `deckBuffer` (NOT mixerBuffer). Each
    //     overlay is masked to its own view, so pixels OUTSIDE every overlay's
    //     view stay EXACTLY at the deckChannel value (commitBlendedLayerWithMask
    //     leaves them untouched) — the never-dark mission rule: overlays can
    //     never blackout the exterior the deck covers. Overlays deliberately do
    //     NOT receive the deck PFL blackout (applied above to the deck channel
    //     only); they preserve the background exactly like mixer overlays.
    //
    //     deckOverlays[0] = bottom, deckOverlays[last] = top → top wins WITHIN
    //     its view. The composited deckBuffer then feeds the EXISTING deck-swap
    //     block + lerp(deck, mixer, viewFader) + applyMaster unchanged, so the
    //     global master and the deck/mixer crossfade apply uniformly; and since
    //     global hue/invert/macros run POST-composite on model.pixels in
    //     engine.js, they apply to overlays automatically (shared globals,
    //     operator refinement #2). Reuses the existing scratch buffers
    //     (channelBuffer / blendedScratch) — no new per-frame allocation.
    for (const overlay of this.deckOverlays) {
      if (!renderDeck) break;
      // Overlay-effective fader: enabled gate × per-overlay faderMax clamp.
      // Deck overlays are NOT subject to the mixer's solo/group/follow gates
      // (those are mixer-stack concepts) — they layer over the deck directly.
      const effFader = overlay.enabled
        ? Math.min(overlay.fader, (typeof overlay.faderMax === 'number' ? overlay.faderMax : 1.0))
        : 0;
      // Skip-dark gate (mirrors the mixer loop): a disabled / zeroed overlay
      // costs ~one length read. A zero-fader overlay contributes nothing.
      if (effFader <= 0.001) continue;

      this.channelBuffer.fill(0);
      if (overlay.sourceMode === 'solid') {
        fillDeckOverlaySolid6ch(
          this.channelBuffer,
          this.pixelCount,
          normalizeDeckOverlayColor(overlay.solidColor, 'solidColor'),
        );
      } else {
        overlay.renderInto(this.wasmHost, this.channelBuffer, true);
        if (overlay.playlistTint !== null && overlay.playlistTint !== undefined) {
          applyDeckOverlayTint6ch(
            this.channelBuffer,
            this.pixelCount,
            normalizeDeckOverlayColor(overlay.playlistTint, 'playlistTint'),
          );
        }
      }

      // Per-overlay hue rotation BEFORE blend (W/A/U untouched), gated on
      // non-zero so a hue=0 overlay pays nothing. Stacks additively with the
      // GLOBAL hue applied post-composite in engine.js.
      if (overlay.hue) {
        applyHueShift6chU8(this.channelBuffer, this.pixelCount, overlay.hue);
      }

      // Blend the WHOLE buffer (overlay over deckBuffer) then commit ONLY at
      // the overlay's selected pixels — exactly the mixer-overlay contract.
      let blended;
      const blendHandle = this.getBlendHandle(overlay.mode);
      if (blendHandle) {
        blended = this.wasmHost.renderBlend6ch(
          blendHandle, this.pixelCount,
          this.deckBuffer, this.channelBuffer, effFader
        );
      } else {
        this._recordBlendError(
          overlay.mode || '(empty mode)',
          `No compiled blend handle for mode '${overlay.mode}' on deck overlay '${overlay.id}'`,
        );
        throw new Error(`No compiled blend handle for mode '${overlay.mode}' on deck overlay '${overlay.id}'`);
      }

      commitBlendedLayerWithMask(this.deckBuffer, blended, overlay.compiledPixelMask, this.pixelCount);

      if (wantVis) {
        this._visData[overlay.id] = this._extractVisInto(overlay.id, this.channelBuffer);
        this._visLevels[overlay.id] = this._bufferMeanLevel(this.channelBuffer) * effFader;
      }
    }

    // 2b. Deck pattern-swap inactive sibling — composite ON TOP of
    // deck buffer using the inactive channel's blend mode + fader.
    // Only runs while a deck swap transition is in flight; outside of
    // a transition the inactive's fader sits at 0 and the cheap-skip
    // gate below prevents any render work. The mixer compositing loop
    // below does NOT see the inactive deck channel because it lives
    // outside `mixerChannels`.
    if (renderDeck && this._inactiveDeckChannel && this._inactiveDeckChannel.handle &&
        this._inactiveDeckChannel.fader > 0.001) {
      this.channelBuffer.fill(0);
      this._inactiveDeckChannel.renderInto(this.wasmHost, this.channelBuffer, true);
      // The selected transition owns every in-flight frame. Endpoint bypasses
      // in WasmHost make p=0/p=1 exact, and completion promotes B atomically;
      // there is no universal tail cut and no hidden linear fallback.
      const blendHandle = this.getBlendHandle(this._inactiveDeckChannel.mode);
      if (!blendHandle) {
        throw new Error(`Deck transition '${this._inactiveDeckChannel.mode}' lost its compiled blend handle`);
      }
      const result = this.wasmHost.renderBlend6ch(
        blendHandle, this.pixelCount,
        this.deckBuffer, this.channelBuffer, this._inactiveDeckChannel.fader,
        this.deckBuffer,
      );
      if (result !== this.deckBuffer) this.deckBuffer.set(result);
      // Expose the inactive channel's vis under a stable id so anyone
      // debugging can see what's coming next. Backward-compat alias
      // '__deck_swap__' kept for any consumer that pinned the old
      // name; the canonical id is '__deck_inactive__'. Only on
      // vis-broadcast frames — see the OPTIMIZATION note in the
      // pre-pass section.
      if (wantVis) {
        // Both keys deliberately alias the SAME extracted buffer — they
        // carry identical data and are drained together by the broadcast.
        const vis = this._extractVisInto('__deck_inactive__', this.channelBuffer);
        this._visData['__deck_inactive__'] = vis;
        this._visData['__deck_swap__'] = vis;
        // Meter the incoming pattern by its intrinsic brightness scaled by
        // the swap fader (how much of it is actually crossfaded in yet).
        const inactiveLevel = this._bufferMeanLevel(this.channelBuffer) * this._inactiveDeckChannel.fader;
        this._visLevels['__deck_inactive__'] = inactiveLevel;
        this._visLevels['__deck_swap__'] = inactiveLevel;
      }
    }

    // 3. Render Mixer layers (all enabled mixer overlays, composited
    //    bottom-to-top → mixerBuffer). The deck channel is NEVER part
    //    of this loop — it lives in `this.deckChannel`, outside the
    //    overlay stack. That structural separation is what makes the
    //    deck-vs-mixer isolation bulletproof: there's no `if (id ===
    //    baseChannelId) continue` to forget anymore.
    //
    //    Per-channel view-selection masking still applies inside the
    //    overlay loop: `channel.compiledPixelMask` is consulted by
    //    `commitBlendedLayerWithMask` so an overlay restricted to a
    //    section/group/fixture keeps the rest of mixerBuffer untouched.
    //
    // When a scripted transition is in flight, promote the target
    // channel to render LAST. Its `mode` has been temporarily swapped
    // to a trans_* blend script (e.g. trans_flash) whose visual must
    // overlay every other (fading-out) overlay. Without this promotion,
    // a loser later in the mixerChannels[] array would composite ON TOP
    // of the flash and obscure it. The natural order is restored as
    // soon as the transition completes (scriptedTransitionTargetId is
    // cleared in updateTransitions).
    // (The per-frame group-scale cache + soloActive flag are precomputed
    // ABOVE, before the vis pre-pass — see the WAVE 15 hot-path precompute
    // note there. They are reused both for the meter levels and for this
    // composite gate.)

    let renderOrder = this.mixerChannels;
    if (this.scriptedTransitionTargetId) {
      const tid = this.scriptedTransitionTargetId;
      const idx = this.mixerChannels.findIndex(c => c.id === tid);
      if (idx !== -1 && idx !== this.mixerChannels.length - 1) {
        // Reorder into the persistent scratch (item 7 — no per-frame
        // array spread/filter). Copy every non-target channel preserving
        // order, then push the target so its trans_* blend composites on
        // top of all the fading-out overlays.
        const scratch = this._renderOrderScratch;
        scratch.length = 0;
        const target = this.mixerChannels[idx];
        for (let i = 0; i < this.mixerChannels.length; i++) {
          const c = this.mixerChannels[i];
          if (c.id !== tid) scratch.push(c);
        }
        scratch.push(target);
        renderOrder = scratch;
      }
    }

    for (const channel of renderOrder) {
      if (!renderMixer) break;
      // Skip dark channels EXCEPT the scripted-transition target, whose
      // blend script must run on every frame (its progress arg is the
      // channel.fader, and at the very start of a fade the value can sit
      // below 0.001 for a frame or two — skipping it would create a
      // visible "no transition yet" pop). The target is already nudged
      // to fader=0.002 in triggerMixerTransition, but this belt-and-
      // suspenders check keeps the invariant honest.
      const isScriptedTarget = channel.id === this.scriptedTransitionTargetId;

      // WAVE 15 composite gate — one effective fader folds together: the
      // explicit-mute check (enabled), the F-C per-channel intensity clamp
      // (faderMax, applied to the channel's OWN level FIRST), the gang-fader
      // group scale (muted group ⇒ 0), and the server-authoritative solo
      // gate. See _effFader for the exact precedence. The grand-master fade
      // (F-B) acts LAST + independently at applyMaster — solo/group never
      // touch this.master.
      const effFader = this._effFader(channel, soloActive);

      // Skip-dark gate uses the composite effFader: a muted / group-muted /
      // solo-gated / clamped-to-0 channel contributes nothing, so skip it —
      // except the scripted-transition target, whose blend script must run
      // every frame (its progress arg is the fader; at fade start it can sit
      // below 0.001 for a frame or two, and skipping would pop).
      if (!isScriptedTarget && effFader <= 0.001) continue;

      // Re-render into channelBuffer for blend compositing.
      this.channelBuffer.fill(0);
      channel.renderInto(this.wasmHost, this.channelBuffer, true);

      // Per-channel Hue shift (docs/39 §F-hue): rotate THIS layer's RGB
      // hue BEFORE it is blended into the mix (W/A/U untouched). Gated on
      // a non-zero hue so the default channel pays nothing. Stacks
      // additively with the global hue applied post-composite in engine.js.
      if (channel.hue) {
        applyHueShift6chU8(this.channelBuffer, this.pixelCount, channel.hue);
      }

      // Blend (mixerBuffer + channelBuffer) → blended. We blend the
      // WHOLE buffer (no mask) so the blend mode sees the existing
      // background on unselected pixels too — this matters when the
      // blend mode is `multiply` or anything else that depends on the
      // bg value. The mask is applied at COMMIT time, not blend time;
      // unselected pixels of the blended result are discarded and the
      // existing mixerBuffer (background) is preserved.
      let blended;
      const blendHandle = this.getBlendHandle(channel.mode);
      if (blendHandle) {
        blended = this.wasmHost.renderBlend6ch(
          blendHandle, this.pixelCount,
          this.mixerBuffer, this.channelBuffer, effFader
        );
      } else {
        this._recordBlendError(
          channel.mode || '(empty mode)',
          `No compiled blend handle for mode '${channel.mode}' on channel ` +
          `'${channel.id}'`,
        );
        throw new Error(`No compiled blend handle for mode '${channel.mode}' on channel '${channel.id}'`);
      }

      commitBlendedLayerWithMask(this.mixerBuffer, blended, channel.compiledPixelMask, this.pixelCount);
    }

    // Compose the Deck/Mixer creative look before a transition involving Live
    // Touch. Deck<->Mixer retains its established post-blend creative stage;
    // Live pairs need complete setting-local looks so Live state can neither
    // leak onto nor erase the outgoing setting.
    if (renderLiveTouch && renderDeck) {
      this._processLayerSettingOutput(LAYER_SETTING_IDS.DECK, this.deckBuffer);
    }
    if (renderLiveTouch && renderMixer) {
      this._processLayerSettingOutput(LAYER_SETTING_IDS.MIXER, this.mixerBuffer);
    }

    // 4. Render Live Touch into its own setting-local buffer. Creative stages
    // (including transient Live brightness) run here, before the shared blend;
    // downstream rack/blackout authority therefore applies to the result once.
    if (renderLiveTouch && this.liveTouchChannel) {
      const live = this.liveTouchChannel;
      live.renderInto(this.wasmHost, this.liveTouchBuffer, true);
      if (live.hue) applyHueShift6chU8(this.liveTouchBuffer, this.pixelCount, live.hue);
      if (live.compiledPixelMask) {
        applyPreviewMaskBlackout(this.liveTouchBuffer, live.compiledPixelMask, this.pixelCount);
      }
      // Pattern A and prepared B are blended as the BASE look. The complete
      // Live creative processor runs exactly once below, so spatial ink/effects
      // remain one stable overlay instead of being duplicated or crossfaded.
      if (this.isLiveTouchPatternSwapInFlight()
          && this._inactiveLiveTouchChannel.fader > 0.001) {
        const incoming = this._inactiveLiveTouchChannel;
        this.channelBuffer.fill(0);
        incoming.renderInto(this.wasmHost, this.channelBuffer, true);
        if (incoming.hue) applyHueShift6chU8(this.channelBuffer, this.pixelCount, incoming.hue);
        if (incoming.compiledPixelMask) {
          applyPreviewMaskBlackout(this.channelBuffer, incoming.compiledPixelMask, this.pixelCount);
        }
        const blendHandle = this.getBlendHandle('trans_crossfade');
        if (!blendHandle) {
          throw new Error("Live Touch transition 'trans_crossfade' lost its compiled handle");
        }
        const result = this.wasmHost.renderBlend6ch(
          blendHandle,
          this.pixelCount,
          this.liveTouchBuffer,
          this.channelBuffer,
          incoming.fader,
          this.liveTouchBuffer,
        );
        if (result !== this.liveTouchBuffer) this.liveTouchBuffer.set(result);
      }
      if (this.liveTouchOutputProcessor) {
        this.liveTouchOutputProcessor(this.liveTouchBuffer);
      }
      this._processLayerSettingOutput(LAYER_SETTING_IDS.LIVE_TOUCH, this.liveTouchBuffer);
      if (wantVis) {
        this._visData[live.id] = this._extractVisInto(live.id, this.liveTouchBuffer);
        this._visLevels[live.id] = this._bufferMeanLevel(this.liveTouchBuffer);
      }
    }

    // 5. Every canonical pair uses this exact same blend operation. Steady
    // state copies one setting. During transition only outgoing + incoming
    // were rendered above; a queued third setting cannot enter this frame.
    if (this._canonicalLayerRouting) {
      const blend = this.layerRouter.blend();
      const fromBuffer = this._bufferForLayerSetting(blend.from);
      const toBuffer = this._bufferForLayerSetting(blend.to);
      if (blend.from === blend.to || blend.amount >= 0.999) {
        this.outputBuffer.set(toBuffer);
      } else if (blend.amount <= 0.001) {
        this.outputBuffer.set(fromBuffer);
      } else {
        const amount = blend.amount;
        const inverse = 1 - amount;
        for (let i = 0; i < this.outputBuffer.length; i++) {
          this.outputBuffer[i] = Math.round(
            fromBuffer[i] * inverse + toBuffer[i] * amount,
          );
        }
      }
    } else if (this.viewFader <= 0.001) {
      this.outputBuffer.set(this.deckBuffer);
    } else if (this.viewFader >= 0.999) {
      this.outputBuffer.set(this.mixerBuffer);
    } else {
      const v = this.viewFader;
      const iv = 1 - v;
      for (let i = 0; i < this.outputBuffer.length; i++) {
        this.outputBuffer[i] = Math.round(this.deckBuffer[i] * iv + this.mixerBuffer[i] * v);
      }
    }

    /* THE GRAND MASTER IS NO LONGER APPLIED HERE.
       It used to scale this composite - which meant it only ever governed the
       PATTERN composition. Everything engine.js adds afterwards (the whole
       global effects chain, and applyGroupFixedColors for a group set to OWN)
       was written on top of an already-mastered buffer and so ignored the
       fader completely. MEASURED on the rig: master 0, and a group painted
       [0.690, 0.4557, 0] still went out as 175/116 on 24 fixtures - "part of
       the boat all yellow at full blast" with the master down.

       Operator ruling: the Touch Control master IS the master when armed, no
       exceptions. So it MOVED to the final pixel stage in engine.js, after the
       effects and after the paint. It must not also be applied here or the
       patterns would be scaled twice (master squared).

       Note for _enforceNeverBlack below: it reads this buffer PRE-master now.
       That is deliberate and safer - it is gated on _isExpectingLight(), which
       already returns false when master is 0, and it no longer mistakes a
       legitimately mastered-down rig for a fault. */

    // ── R4 "NEVER FULLY BLACK" runtime enforcer (redteam _112 I1/I2) ──────
    // The composite is finished (deck ⊕ overlays ⊕ mixer, crossfaded, master
    // applied) — this is EXACTLY the buffer engine.js reads out to sACN, so it
    // is the one true place to prove the mission-critical invariant "the ship
    // is not dark while it is supposed to be lit". See the renderHealth.darkness
    // note in the constructor for why enforcement lives on the consequence
    // (fully-black output) rather than on the (unreachable, silently-absorbed)
    // NaN / beforeRender-truncation root causes.
    this._enforceNeverBlack();

    // Capture master vis (final output). Master is always cheap (the
    // outputBuffer already exists), but we still gate on wantVis so
    // _visData['master'] doesn't leak between broadcasts (otherwise a
    // single broadcast could ship a master that's one frame older than
    // the per-channel vis, which is mildly confusing for debugging).
    if (wantVis) {
      /* The master gain is applied downstream now (see the note above), so the
         preview and the meter have to fold it in themselves - otherwise the
         deck/mixer master meter would sit at full with the fader on the floor,
         which is exactly the kind of UI that lies about the rig. */
      const vis = this._extractVisInto('master', this.outputBuffer);
      if (this.master < 1.0) this.applyMaster(vis, this.master);
      this._visData['master'] = vis;
      this._visLevels['master'] = this._bufferMeanLevel(this.outputBuffer) * this.master;
    }

    // FOLLOW/LINK (round-2 #6): snapshot THIS frame's effective fader for every
    // channel into the prev-frame cache that next frame's followers read. One
    // allocation-free clear()+set() pass (mirrors the group-scale cache). We
    // recompute effFader here rather than caching it inside the composite loop
    // because the composite loop only runs effFader for channels it doesn't
    // skip — and a leader sitting at fader 0 (skipped) must still publish its
    // 0 so a follower tracks it correctly. The deck channel is included (a
    // mixer overlay may follow the deck): the deck is PFL, never grouped/soloed,
    // so its effective level is its own enabled-gated, faderMax-clamped fader
    // (matching the deck meter in the vis pre-pass). This recompute reads the
    // SAME prev-frame snapshot we're about to overwrite, so a chain advances
    // exactly one hop per frame — the documented one-frame-per-hop latency.
    this._prevEffFaderCache.clear();
    if (this.deckChannel) {
      const d = this.deckChannel;
      let deckEff = 0;
      if (d.enabled) {
        const fMax = (typeof d.faderMax === 'number' && Number.isFinite(d.faderMax)) ? d.faderMax : 1.0;
        let f = d.fader < fMax ? d.fader : fMax;
        if (f < 0) f = 0;
        deckEff = f;
      }
      this._prevEffFaderCache.set(d.id, deckEff);
    }
    for (let i = 0; i < this.mixerChannels.length; i++) {
      const c = this.mixerChannels[i];
      this._prevEffFaderCache.set(c.id, this._effFader(c, soloActive));
    }

    return this.outputBuffer;
  }

  /**
   * Extract vis data from a 6ch buffer (full RGBWAU, 6 bytes per pixel)
   * into the pooled buffer for `key`, copying in place (item 6 — no
   * per-frame allocation). Returns the pooled Uint8Array.
   *
   * Safe only because the broadcast consumer drains the whole _visData map
   * synchronously each vis frame before the next frame overwrites these
   * buffers. The pool persists across frames; the buffer for a given key
   * is the same object frame-to-frame, refilled here.
   */
  _extractVisInto(key, buf6ch) {
    let out = this._visBufferPool.get(key);
    if (!out || out.length !== buf6ch.length) {
      out = new Uint8Array(buf6ch.length);
      this._visBufferPool.set(key, out);
    }
    out.set(buf6ch);
    return out;
  }

  /**
   * Extract vis data from a 6ch buffer (full RGBWAU, 6 bytes per pixel).
   * Returns a copy of the buffer as Uint8Array. Kept for callers/tests
   * that want a standalone snapshot not tied to the pool.
   */
  _extractVis(buf6ch) {
    return new Uint8Array(buf6ch);
  }

  /**
   * Cheap mean brightness of a 6ch RGBWAU buffer, normalized to [0,1].
   * Single allocation-free pass — sum every byte, divide by (length*255).
   * Mean (not peak) so a mostly-dark pattern with one hot pixel doesn't
   * read as fully lit; it tracks the perceived "how much light is this
   * layer contributing" rather than a single fixture's spike. The caller
   * scales this by the channel's effFader to get the post-fader level.
   */
  _bufferMeanLevel(buf6ch) {
    const n = buf6ch.length;
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += buf6ch[i];
    return sum / (n * 255);
  }

  /**
   * Get per-channel and master vis data for streaming to clients.
   * Returns { channels: [{id, rgb: Uint8Array|null}, ...], master: Uint8Array }
   */
  getVisData() {
    return this._visData || {};
  }

  /**
   * Per-channel effective-output meter levels for streaming to clients.
   * Returns { <visKey>: number(0..1) } keyed identically to getVisData().
   * Each value is the channel's intrinsic mean brightness scaled by its
   * effFader (fader/clamp/group/solo) — i.e. what actually reaches the
   * mix. Refilled only on vis-broadcast frames; drained alongside vis.
   */
  getVisLevels() {
    return this._visLevels || {};
  }

  destroy() {
    if (this.deckChannel) this.deckChannel.destroy(this.wasmHost);
    if (this.liveTouchChannel) this.liveTouchChannel.destroy(this.wasmHost);
    if (this._inactiveLiveTouchChannel && this._inactiveLiveTouchChannel.handle) {
      this.wasmHost.destroy(this._inactiveLiveTouchChannel.handle);
    }
    for (const channel of this.mixerChannels) {
      channel.destroy(this.wasmHost);
    }
    // Deck overlays own their own WASM handles — free them at teardown.
    for (const overlay of this.deckOverlays) {
      overlay.destroy(this.wasmHost);
    }
    this.deckOverlays = [];
    // Clean up the hidden inactive deck sibling too — without this a
    // warm inactive handle (kept alive across normal swap completions
    // for ping-pong reuse) would leak at engine shutdown.
    if (this._inactiveDeckChannel && this._inactiveDeckChannel.handle) {
      try { this.wasmHost.destroy(this._inactiveDeckChannel.handle); } catch (_) {}
    }
    this._inactiveDeckChannel = null;
    this._swapTransition = null;
    this._inactiveLiveTouchChannel = null;
    this._liveTouchSwapTransition = null;
    // Destroy blend handles
    for (const [name, handle] of Object.entries(this.blendHandles)) {
      if (handle) this.wasmHost.destroy(handle);
    }
    this.blendHandles = {};
    this.deckChannel = null;
    this.mixerChannels = [];
    this.liveTouchChannel = null;
    this.layerSettingOutputProcessors.clear();
    this.liveTouchPhaseSpeedProvider = null;
    this.liveTouchOutputProcessor = null;
    this.onLiveTouchPatternSwapChange = null;
    // WAVE 15: drop group registry + transient solo on teardown so a
    // re-init doesn't inherit ghost groups / phantom solos.
    this.mixGroups = [];
    this.soloedChannelIds.clear();
    this._bumpedChannelIds.clear();
    this._groupScaleCache.clear();
    // FOLLOW/LINK (round-2 #6): drop the prev-frame effective cache so a
    // re-init doesn't have a follower read a stale leader level from a
    // previous mixer lifetime.
    this._prevEffFaderCache.clear();
  }

  getBlendHandle(blendName) {
    if (!blendName) return null;
    if (this.blendHandles[blendName] !== undefined) return this.blendHandles[blendName];
    // Cache miss: compile now and route through precompileBlend so a
    // failure is recorded in render-health (visible on /status) rather
    // than silently caching null. Boot precompile warms the common case,
    // so this lazy path is now only hit for runtime-introduced modes.
    return this.precompileBlend(blendName);
  }

  // Compile a blend/transition script to a WASM handle. Returns the handle
  // on success or null on failure. Callers (precompileBlend / getBlendHandle)
  // are responsible for recording the failure in render-health — this
  // method does the I/O + compile and reports the SPECIFIC reason loudly so
  // the missing-script vs compile-error distinction isn't lost.
  _compileBlend(blendName) {
    if (!this._patternsDir) {
      console.warn(`[Mixer] _compileBlend('${blendName}') called before patternsDir was set`);
      return null;
    }
    let blendPath = path.join(this._patternsDir, 'channel_blends', `${blendName}.js`);
    if (!fs.existsSync(blendPath)) {
      blendPath = path.join(this._patternsDir, 'transitions', `${blendName}.js`);
    }
    if (!fs.existsSync(blendPath)) {
      console.warn(`[Mixer] Blend script NOT FOUND: '${blendName}' ` +
        `(looked in channel_blends/ and transitions/)`);
      return null;
    }
    let code;
    try {
      code = fs.readFileSync(blendPath, 'utf8');
    } catch (e) {
      console.warn(`[Mixer] Could not read blend script ${blendName}: ${e.message}`);
      return null;
    }
    const result = this.wasmHost.compile(code);
    if (result.ok) {
      console.log(`[Mixer] Compiled blend script: ${blendName}`);
      return result.handle;
    }
    console.warn(`[Mixer] Blend compile FAILED for ${blendName}: ${result.error}`);
    return null;
  }
}
