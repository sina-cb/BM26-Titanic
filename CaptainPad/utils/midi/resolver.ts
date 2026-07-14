// Event → action resolver. PURE: given a profile and one decoded MIDI event,
// find the matching control and produce a ResolvedAction with the value
// already scaled into engine units. Returns null when nothing matches (an
// unmapped control dispatches nothing — that silence IS the signal, never a
// wrapped no-op). The impure half (calling utils/api.ts) lives in dispatch.ts;
// keeping resolution pure is what makes it unit-testable with synthetic events.

import { ControllerProfile, ControlDef, Range } from './profile';
import { DecodedMidi, decodeMidi } from './midi_message';
import { scaleMidiToRange, MidiControlRef } from './learn';
import { decodeRelativeDelta } from './mft/messages';

// ResolvedAction has TWO producers:
//   1. resolveEvent() (this file, PURE, profile-driven) produces every kind
//      EXCEPT `localParam` — a decoded event mapped to a static profile action.
//   2. The controller runtime (manager.ts) builds `localParam` from the focused
//      entry's stored bindings + live exports (not profile-driven), then routes
//      it through the same coalescer + dispatcher seam.
// The dispatcher handles the engine-call kinds; `focusChannel` / `playlistScroll`
// / `playlistWindowSelect` and the MFT relative kinds (`focusedParamDelta` /
// `paramCenterDelta` / `focusedParamReset` / `focusStep`) are consumed by the
// runtime (controller-local state / focused-channel math) and never reach an
// engine call.
export type ResolvedAction =
  | { kind: 'paramCenter'; key: string; value: number }
  | { kind: 'master'; value: number }
  | { kind: 'pattern'; name: string }
  | { kind: 'patternBank'; bank: number; index: number }
  | { kind: 'blackoutToggle' }
  | { kind: 'globalEffect'; effect: string }
  | { kind: 'sectionBrightness'; sectionId: number; value: number }
  | { kind: 'groupFixedColor'; group: string; color: number[]; brightness: number }
  | { kind: 'mixerLayerFader'; layer: number; value: number }
  // A global-effect slot pad. `phase` distinguishes press from release so a
  // future HOLD slot can dispatch 'down' on press and 'up' on release; today
  // resolveEvent only ever produces 'press' (Note Off is swallowed, so no
  // release reaches here — see the hold TODO in dispatch.ts). Toggle/trigger
  // slots act on press only, so the field is irrelevant to them.
  | { kind: 'globalEffectSlot'; slot: number; phase?: 'press' | 'release' }
  // ── APC operator re-layout (2026-07) — discrete button actions ──
  // Toggle the active CaptainPad tab (Deck ↔ Mixer). Dispatched: the injected
  // api reads the current tab and navigates the other.
  | { kind: 'viewToggle' }
  // Combined pattern+color autopilot toggle (any-on → both-on; both-on →
  // both-off). Dispatched: the injected api reads both states and writes both.
  | { kind: 'autopilotToggle' }
  // Master fade TO BLACK / UP toggle over the selected duration. Dispatched: the
  // injected api reads the live master + the selected fade duration.
  | { kind: 'masterFadeToggle' }
  // PERFORMANCE-MODE dialog summon (APC solo, 2026-07-13): opens the guarded
  // enter-confirm / exit sheet in the CaptainPad UI. Never a blind engine
  // toggle — the injected api pokes the summon bus; the choice is on the iPad.
  | { kind: 'performanceDialog' }
  | { kind: 'playlistScroll'; layer: number; dir: 'up' | 'down' }
  | { kind: 'playlistWindowSelect'; layer: number; slot: number }
  | { kind: 'colorPalettePair'; palette: number }
  // Select which layer the learnable param faders (4-8) target. Handled in the
  // controller runtime (UI/controller state, not an engine call).
  | { kind: 'focusChannel'; layer: number }
  // ── Driver #2 — MIDI Fighter Twister (relative-encoder) resolved actions ──
  // A relative knob turn on the FOCUSED channel's export at `index`. `delta` is
  // ALREADY the signed step magnitude (signStep × the profile's step for the
  // detent speed) — the runtime accumulates deltas + applies to the export's
  // current value. Runtime-handled (needs focused.exports), never dispatched.
  | { kind: 'focusedParamDelta'; index: number; delta: number }
  // A relative knob turn on a CPC global param by key. Runtime-handled.
  | { kind: 'paramCenterDelta'; key: string; delta: number }
  // Encoder push → reset the focused param at `index`. Runtime-handled.
  | { kind: 'focusedParamReset'; index: number }
  // Side-button focus move (prev/next/deck). Runtime-handled (controller state).
  | { kind: 'focusStep'; dir: 'prev' | 'next' | 'deck' }
  // ── MFT UX v2 — row-0 global knobs ──
  // Encoder push → toggle the engine's BPM→Speed sync (CPC `bpmSpeedSync`).
  // Dispatched (the dispatcher reads the current state from context).
  | { kind: 'bpmSyncToggle' }
  // Relative hue-knob turn: `delta` is a signed fraction of one full ring
  // (0..1 ↔ 0..360°). Runtime-handled — it accumulates onto the FOCUSED
  // CHANNEL's per-channel hue (deck tab = the DECK CHANNEL, auto-focused;
  // mixer tab = the focused overlay). Hue is PER-CHANNEL ONLY — the global
  // hue shifter was removed 2026-07 (operator decision).
  | { kind: 'hueDelta'; delta: number }
  // Encoder push → reset the FOCUSED CHANNEL's hue to 0°. Runtime-handled.
  // Per-channel hue has no auto-rotate concept — nothing to preserve.
  | { kind: 'hueReset' }
  // A concrete PER-CHANNEL hue write, BUILT BY THE RUNTIME from the
  // accumulated delta / reset against the FOCUSED channel (never produced by
  // resolveEvent). Lands on the channel PATCH `hue` field (engine F-hue,
  // docs/39): pre-blend RGB rotation on that layer only. No autoRotate field
  // exists per-channel, so none is threaded (never invent one).
  | { kind: 'channelHue'; role: 'deck' | 'mixer'; channelId: string; degrees: number }
  // A MIDI-learned local-param write. NOT produced by resolveEvent (which is
  // profile-driven) — the runtime builds it from the focused entry's stored
  // bindings + live exports, then routes it through the same coalescer +
  // dispatcher seam as every other continuous control.
  | { kind: 'localParam'; role: 'deck' | 'mixer'; channelId: string; exportId: number; value: number }
  // ── Driver #3 — Intech VSN1 global-effects surface ──
  // Absolute jog-wheel turn (CC 0..127). `value` is ALREADY scaled to 0..1
  // (value/127). Runtime-handled: the runtime maps it onto the SELECTED slot's
  // intensity (last-write-wins, with a soft-takeover pickup guard on selection
  // change), never dispatched directly — the selection lives in runtime state.
  | { kind: 'effectIntensityAbs'; value: number }
  // Jog press → reset the SELECTED slot's intensity to its default. Runtime-
  // handled (needs the selection).
  | { kind: 'effectIntensityReset' }
  // A concrete slot intensity WRITE. Two producers: (a) the RUNTIME, from a
  // legacy selected-slot jog value (effectIntensityAbs + pickup guard); (b)
  // resolveEvent DIRECTLY, from the VSN1 keyed value contract (2026-07-11
  // firmware): CC channel = page, controller = 32+k → flat slot id
  // 8*channel + k + 1, value/127 → 0..1 — the message addresses its own slot,
  // no selection needed. Dispatched: POST the slot's intensity.
  | { kind: 'effectIntensitySlot'; slotId: number; value: number }
  // A concrete slot intensity RESET, BUILT BY THE RUNTIME against the selected
  // slot (never produced by resolveEvent). Dispatched: POST intensity/reset.
  | { kind: 'effectIntensitySlotReset'; slotId: number }
  // ── Effects v2 — 32 paged slots + discrete mode ──
  // A side-button page select (0..3). Dispatched: PATCH /global-effects/page.
  // The engine broadcasts the change so every surface converges.
  | { kind: 'effectsPageSelect'; page: number }
  // Encoder press → cycle the SELECTED slot's mode. Runtime-handled (needs the
  // selection); the runtime builds the concrete effectModeCycleSlot below.
  | { kind: 'effectModeCycle' }
  // A concrete slot MODE cycle, BUILT BY THE RUNTIME against the selected slot
  // (never produced by resolveEvent). Dispatched: POST mode/cycle.
  | { kind: 'effectModeCycleSlot'; slotId: number }
  // VSN1 controller PROFILE switch (sb_2). BUILT BY THE RUNTIME: the manager reads
  // the current profile from the snapshot and sets `profile` to the OPPOSITE
  // ('edit' ↔ 'play') — never produced by resolveEvent. Dispatched: PATCH
  // /global-effects/profile { profile }. The engine broadcast is the source of
  // truth (no optimistic flip).
  | { kind: 'controllerProfileSet'; profile: 'edit' | 'play' }
  // ── VSN1 SMALL BUTTONS (sb_0..sb_3, notes 41..44) — 2026-07-09 ──
  // The four small PANEL buttons (device elements 9..12). They NEVER change
  // pages (the physical side button does that, firmware-native). `button` is
  // 0..3. RUNTIME-HANDLED in the VSN1 path (the manager owns the policy):
  //   sb_0 → VIEW MODE: single click = DRUM, double click = EFFECT (host-side
  //          click/double-click detection from note timestamps; the mode is
  //          echoed back to the device as a feedback CC so it survives page
  //          changes). sb_1 → no-op for now (TODO). sb_2 → reset-all, sb_3 →
  //          disable-all (the manager builds the dispatched actions below).
  | { kind: 'vsn1SmallButton'; button: number }
  // Reset EVERY global-effect slot to default (VSN1 sb_2). BUILT BY THE RUNTIME
  // from a vsn1SmallButton press. Dispatched: POST /global-effects/reset-all.
  | { kind: 'globalEffectsResetAll' }
  // Turn OFF every active global effect (VSN1 sb_3). BUILT BY THE RUNTIME from a
  // vsn1SmallButton press. Dispatched: POST /global-effects/disable-all.
  | { kind: 'globalEffectsDisableAll' };

export interface ResolvedEvent {
  controlId: string;
  resolved: ResolvedAction;
  /** Continuous controls (CC) get coalesced; discrete (notes) dispatch now. */
  continuous: boolean;
}

const MIDI_MAX = 127;

/** Thrown when a caller supplies a `context` (CaptainPad tab) that a
 *  MULTI-context profile never published. Codex P0 fail-loud: the OLD
 *  `?? profile.controls` fallback silently resolved every control on an unknown
 *  tab against the DECK list — a wrong-tab mismap that looked like it worked.
 *  Now the offending context is named and the caller surfaces it (red status),
 *  never a guessed control set. */
export class UnknownContextError extends Error {
  constructor(context: string, known: string[]) {
    super(
      `MIDI: unknown context '${context}' — profile publishes ${known.length ? known.map((k) => `'${k}'`).join(', ') : '(none)'}`,
    );
    this.name = 'UnknownContextError';
  }
}

/** The synthetic context a FLAT `controls:` profile (no per-tab `contexts:` map)
 *  is normalised into by validateProfile. Such a profile is context-AGNOSTIC —
 *  one universal map — so any requested context resolves to it; only genuinely
 *  multi-context profiles police their context names. */
const DEFAULT_CONTEXT = 'default';

/** Resolve the control list for a context, FAILING LOUD on an unknown one (P3-7).
 *
 *  - No `context` supplied → the default list (`profile.controls`), unchanged.
 *  - A flat/context-AGNOSTIC profile (its only context is the synthetic
 *    `default`) → the default list for ANY requested context. It declares no
 *    tabs, so it can't have an "unknown" one; this keeps single-map profiles
 *    working under the manager's `'deck'` default sentinel.
 *  - A MULTI-context profile + an unknown context → THROW (the P3-7 fix): the
 *    tab was never published, so resolving it against the deck list would
 *    silently mismap every control.
 *
 *  Shared by resolveEvent (this file) and the LED projector so the two paths can
 *  never diverge on what "unknown context" means. */
export function controlsForContext(profile: ControllerProfile, context: string | undefined): ControlDef[] {
  if (context === undefined) return profile.controls;
  const known = Object.keys(profile.contexts);
  if (known.length === 1 && known[0] === DEFAULT_CONTEXT) return profile.controls;
  const controls = profile.contexts[context];
  if (!controls) throw new UnknownContextError(context, known);
  return controls;
}

// The single value→range scaler is learn.ts `scaleMidiToRange` (which also
// clamps out-of-spec bytes). `scale()` is a thin range-typed alias so the
// paramCenter / fader / sectionBrightness sites read cleanly.
function scale(value: number, range: Range): number {
  return scaleMidiToRange(value, range);
}

// ── MFT relative-encoder step mapping ──
//
// THE TRUE FIRMWARE MODEL (verified against the DJTT firmware encoders.c and
// the operator's live MIDI capture, 2026-07): per message the MFT sends
//
//     value = 64 + ticks × mult
//
// where `mult` is the FIRMWARE's velocity multiplier ramping 1 → 17 with turn
// speed (encoders.c; the live capture confirms it — a hard sustained spin
// saturates at exactly value 81 = +17 with messages every ~2-10 ms, and a slow
// twist is a stream of 65 = +1). decodeRelativeDelta returns that whole count
// (value − 64) — the fast-twist fix: the old six-code decoder returned null for
// every value outside 61-67, so nearly all fast motion (47..81 during a spin)
// was DROPPED.
//
// THE STEP MAPPING is LINEAR in the count: raw travel = count × steps[0]. The
// host then applies a light per-tick velocity gain in accel.ts (round-4,
// GAIN_MAX = 3.0) on top. This combined model is what the operator
// HARDWARE-CONFIRMED as the correct feel (slow precise, fast sweeps to the
// ends, no jumpiness) — do NOT alter the slope or re-introduce a per-code clamp
// without a fresh hardware feel test.

/** SAFETY-ONLY per-message count cap. Purely defensive: the firmware multiplier
 *  never exceeds 17 (encoders.c) and the live capture never showed a count past
 *  ±17, so this ceiling — set FAR above that real range — NEVER triggers in
 *  normal use and does NOT touch the confirmed sweep feel. It exists only to
 *  bound a single out-of-spec/glitch code so it cannot teleport the value.
 *  Clamps the COUNT (not the scaled travel) so the guard stays proportional to
 *  each knob's own steps[0]. RAISE if a legitimate future firmware mult exceeds
 *  it (a real fast turn must never be clamped); it is intentionally generous. */
export const RELATIVE_COUNT_CEILING = 48;

/** Map a decoded relative-encoder count (the FULL binary-offset value − 64,
 *  never just ±1/±2/±3) + the profile's step triple to the SIGNED raw travel,
 *  LINEAR in the count:
 *
 *    raw = clamp(count, ±RELATIVE_COUNT_CEILING) × steps[0]
 *
 *  A slow detent (±1) is `steps[0]` (fine-grained); a saturated fast message
 *  (±17) is 17 × steps[0] (well within the safety cap, untouched). The per-tick
 *  velocity gain that shapes fast-vs-slow feel lives in accel.ts, applied
 *  downstream. Exported for the end-to-end pipeline tests. */
export function relativeStep(delta: number, steps: [number, number, number]): number {
  const count = Math.max(-RELATIVE_COUNT_CEILING, Math.min(RELATIVE_COUNT_CEILING, delta));
  return count * steps[0];
}

function matches(control: ControlDef, ev: DecodedMidi): { hit: boolean; index: number } {
  const m = control.match;
  if (m.type === 'cc' && ev.type === 'cc') {
    // `anyChannel` (VSN1): match on the CC number ALONE — the device emits its
    // value CCs on channel = the current effects page (0-3), so a channel-pinned
    // match would drop every turn off page 0. Explicit opt-in, never a fallback.
    const channelHit = m.anyChannel === true || ev.channel === m.channel;
    // `ccTo` (inclusive range, mirrors the note [lo, hi] form): the matched CC's
    // offset from `cc` becomes the action index (VSN1 keyed values: which key).
    const hi = m.ccTo ?? m.cc;
    if (!channelHit || ev.cc < m.cc || ev.cc > hi) return { hit: false, index: 0 };
    return { hit: true, index: ev.cc - m.cc };
  }
  if (m.type === 'note' && (ev.type === 'noteOn' || ev.type === 'noteOff')) {
    // `anyChannel` (VSN1): match on the NOTE alone. The device's keys, jog press,
    // and side buttons ride channel = the current effects page (0-3) — the same
    // moving-channel firmware constraint the CC values have — so a channel-pinned
    // note match would silently drop every press off page 0 (the "keys do nothing
    // on page 2-4" bug). Explicit opt-in, never a fallback; the page-aware slot is
    // derived downstream from the engine's effectsPage, not from this channel.
    if (m.anyChannel !== true && ev.channel !== m.channel) return { hit: false, index: 0 };
    const lo = m.notes[0];
    const hi = m.notes.length === 2 ? m.notes[1] : m.notes[0];
    if (ev.note < lo || ev.note > hi) return { hit: false, index: 0 };
    return { hit: true, index: ev.note - lo };
  }
  if (m.type === 'column' && (ev.type === 'noteOn' || ev.type === 'noteOff')) {
    if (ev.channel !== m.channel) return { hit: false, index: 0 };
    const col = ev.note % 8;
    const row = Math.floor(ev.note / 8);
    if (col !== m.column || row < m.fromRow || row > m.toRow) return { hit: false, index: 0 };
    return { hit: true, index: m.reverse ? m.toRow - row : row - m.fromRow };
  }
  return { hit: false, index: 0 };
}

/**
 * Resolve one decoded event to a ResolvedEvent, or null if no control matches.
 * Discrete (note) actions fire on Note On only — Note Off is swallowed (v1 has
 * no momentary actions). Continuous (CC) actions always resolve.
 */
export function resolveEvent(
  profile: ControllerProfile,
  ev: DecodedMidi,
  context?: string,
): ResolvedEvent | null {
  if (ev.type === 'other') return null;
  const controls = controlsForContext(profile, context);
  for (const control of controls) {
    const { hit, index } = matches(control, ev);
    if (!hit) continue;

    const a = control.action;
    // Discrete note presses: act on Note On, ignore Note Off.
    if (ev.type === 'noteOff') return null;

    switch (a.kind) {
      case 'paramCenter':
        if (ev.type !== 'cc') return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'paramCenter', key: a.key, value: scale(ev.value, a.range) } };
      case 'master':
        if (ev.type !== 'cc') return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'master', value: ev.value / MIDI_MAX } };
      case 'sectionBrightness':
        if (ev.type !== 'cc') return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'sectionBrightness', sectionId: a.sectionId, value: scale(ev.value, a.range) } };
      case 'mixerLayerFader':
        if (ev.type !== 'cc') return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'mixerLayerFader', layer: a.layer, value: scale(ev.value, a.range) } };
      case 'focusChannel':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'focusChannel', layer: a.layer } };
      case 'focusedParamKnob': {
        // Relative endless-encoder turn. The CC VALUE is a delta code; an
        // unknown value (not 61-67) resolves to null — loud silence, never a
        // guessed delta. Relative knobs are continuous (coalesced, accumulated).
        if (ev.type !== 'cc') return null;
        const delta = decodeRelativeDelta(ev.value);
        if (delta === null) return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'focusedParamDelta', index: a.index, delta: relativeStep(delta, a.steps) } };
      }
      case 'paramCenterRelative': {
        if (ev.type !== 'cc') return null;
        const delta = decodeRelativeDelta(ev.value);
        if (delta === null) return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'paramCenterDelta', key: a.key, delta: relativeStep(delta, a.steps) } };
      }
      case 'focusedParamReset':
        // Encoder push (a CC-hold on the MFT). Discrete; fire on press (value>0).
        if (ev.type === 'cc' && ev.value === 0) return null; // release — ignore
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'focusedParamReset', index: a.index } };
      case 'focusStep':
        if (ev.type === 'cc' && ev.value === 0) return null; // side-button release
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'focusStep', dir: a.dir } };
      case 'bpmSyncToggle':
        // Encoder push (CC-hold). Discrete; fire on press (value > 0).
        if (ev.type === 'cc' && ev.value === 0) return null; // release — ignore
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'bpmSyncToggle' } };
      case 'hueKnob': {
        // Relative endless-encoder turn on the FOCUSED CHANNEL's hue. Same
        // delta-code semantics as focusedParamKnob: an unknown value resolves
        // to null.
        if (ev.type !== 'cc') return null;
        const delta = decodeRelativeDelta(ev.value);
        if (delta === null) return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'hueDelta', delta: relativeStep(delta, a.steps) } };
      }
      case 'hueReset':
        if (ev.type === 'cc' && ev.value === 0) return null; // release — ignore
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'hueReset' } };
      case 'globalEffectSlot':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'globalEffectSlot', slot: a.slot } };
      case 'viewToggle':
        // Discrete button (Note On already the only survivor — Note Off swallowed).
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'viewToggle' } };
      case 'autopilotToggle':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'autopilotToggle' } };
      case 'masterFadeToggle':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'masterFadeToggle' } };
      case 'performanceDialog':
        // Discrete button (Note On only — Note Off swallowed above). Summons
        // the performance-mode dialog in the UI; nothing engine-side.
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'performanceDialog' } };
      case 'effectIntensityAbs':
        // Absolute jog-wheel CC → the selected slot's intensity. The CC value
        // is an ABSOLUTE 0-127 position (jog in absolute mode), so scale
        // value/127 → 0..1 here (no relative decode, no acceleration —
        // last-write-wins). Continuous: coalesced at flush cadence.
        if (ev.type !== 'cc') return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'effectIntensityAbs', value: ev.value / MIDI_MAX } };
      case 'effectIntensityReset':
        // Jog press (a note). Discrete; fire on press (Note Off already
        // swallowed above).
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'effectIntensityReset' } };
      case 'effectIntensityKeyed': {
        // VSN1 keyed value contract: the CC message ADDRESSES ITS SLOT — channel
        // = the effects page (0-3), matched index = the key (0-7), so flat slot
        // id = 8*channel + index + 1; value is absolute 0..127 → 0..1. Resolves
        // a CONCRETE effectIntensitySlot (no runtime selection, no pickup: the
        // device renders its displayed value from our feedback stream, so its
        // absolute position is anchored on the slot's live value by
        // construction — a host-side takeover lock would only swallow
        // legitimate writes). A channel beyond 3 addresses a slot beyond 32 and
        // the engine rejects it — surfaced fail-loud, never silently clamped.
        if (ev.type !== 'cc') return null;
        return { controlId: control.id, continuous: true,
          resolved: { kind: 'effectIntensitySlot', slotId: 8 * ev.channel + index + 1, value: ev.value / MIDI_MAX } };
      }
      case 'effectsPageSelect':
        // Side-button press → select the effects page on the engine. Discrete.
        // A CC-form side button releases at value 0 — ignore that (fire on press).
        if (ev.type === 'cc' && ev.value === 0) return null;
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'effectsPageSelect', page: a.page } };
      case 'vsn1SmallButton':
        // VSN1 small panel button (sb_0..sb_3). Discrete; fires on press (Note
        // Off is swallowed above; a CC-form release at 0 is ignored). The VSN1
        // path in the manager owns the per-button policy (view mode / reset-all
        // / disable-all) — this only carries WHICH button was pressed.
        if (ev.type === 'cc' && ev.value === 0) return null;
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'vsn1SmallButton', button: a.button } };
      case 'effectModeCycle':
        // Encoder press (a note) → cycle the SELECTED slot's mode. Discrete;
        // fire on press (Note Off already swallowed above). Runtime-resolved
        // against the current selection.
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'effectModeCycle' } };
      case 'playlistScroll':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'playlistScroll', layer: a.layer, dir: a.dir } };
      case 'playlistWindowSelect':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'playlistWindowSelect', layer: a.layer, slot: index } };
      case 'colorPalettePair':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'colorPalettePair', palette: a.bank * 8 + index } };
      case 'pattern':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'pattern', name: a.name } };
      case 'patternBank':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'patternBank', bank: a.bank, index } };
      case 'blackoutToggle':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'blackoutToggle' } };
      case 'globalEffect':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'globalEffect', effect: a.effect } };
      case 'groupFixedColor':
        return { controlId: control.id, continuous: false,
          resolved: { kind: 'groupFixedColor', group: a.group, color: a.color, brightness: a.brightness } };
      case 'ledOff':
        // A deliberately-dark button (unused APC arrows/scene keys). It exists
        // ONLY to be projected dark (see led_projector) — pressing it maps to
        // nothing. Return null: no ResolvedAction, so nothing is dispatched and
        // no other control shadows it. This IS the loud silence, made explicit.
        return null;
      default:
        return null;
    }
  }
  return null;
}

/**
 * Does a captured control already resolve to a STATIC profile action in the
 * given context? Returns the claiming control's id (so the caller can name it,
 * e.g. "CC 54 is GLOBAL SPEED") or null when the control is unmapped and thus
 * free to learn. Used to REJECT learning a control that would permanently
 * shadow a profile action (global speed, master, pads, …) — the faders/pads
 * reserved for learn are simply absent from the profile, so they return null.
 *
 * Pure: it synthesises the most-representative decoded event for the ref (a
 * mid-value CC, a full-velocity Note On) and runs it through resolveEvent.
 */
export function profileClaims(
  profile: ControllerProfile,
  ref: MidiControlRef,
  context?: string,
): string | null {
  const status = ref.type === 'cc' ? 0xb0 : 0x90;
  // CC: a mid value (64) resolves the same as any other for range/toggle
  // actions; Note On: full velocity so it is never mistaken for a Note Off.
  const value = ref.type === 'cc' ? 64 : 127;
  const ev = decodeMidi([status | (ref.channel & 0x0f), ref.number, value]);
  const resolved = resolveEvent(profile, ev, context);
  return resolved ? resolved.controlId : null;
}
