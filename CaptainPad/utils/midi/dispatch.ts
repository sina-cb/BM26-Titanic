// Dispatch — the one impure seam where a ResolvedAction becomes a call to an
// existing utils/api.ts function. The mapping layer owns NO transport and adds
// NO new engine surface (docs/34 hard constraint): every action lands on a
// dispatch fn the on-screen UI already uses. The api + context are injected so
// the whole thing is unit-testable with mocks — tests assert the right fn was
// called with the right scaled value.

import { ResolvedAction } from './resolver';

export interface MidiApiResult { ok: boolean; error?: string; code?: string }

/** The subset of utils/api.ts the MIDI layer dispatches through. */
export interface MidiDispatchApi {
  updateParamCenter(params: Record<string, unknown>): Promise<MidiApiResult>;
  updateMixerMaster(master: number): Promise<MidiApiResult>;
  setActivePattern(pattern: string): Promise<MidiApiResult>;
  setGlobalBlackout(state: boolean): Promise<MidiApiResult>;
  setGlobalEffect(effect: string, state: boolean): Promise<MidiApiResult>;
  setSectionBrightness(sectionId: number, brightness: number): Promise<MidiApiResult>;
  setGroupFixedColor(group: string, color: number[], brightness: number): Promise<MidiApiResult>;
  updateMixerChannel(channelId: string, updates: Record<string, unknown>): Promise<MidiApiResult>;
  updateDeckChannel(updates: Record<string, unknown>): Promise<MidiApiResult>;
  dispatchGlobalEffectSlotAction(slotId: number, action: string): Promise<MidiApiResult>;
  setGlobalEffectBlackout(enabled: boolean): Promise<MidiApiResult>;
  /** Driver #3 (VSN1): write the SELECTED global-effect slot's `intensity`
   *  (0..1). POST /global-effect-slots/:slotId/intensity { value }. The jog
   *  wheel (absolute) drives this for whichever slot the operator last pressed
   *  on the VSN1. */
  setGlobalEffectSlotIntensity(slotId: number, value: number): Promise<MidiApiResult>;
  /** Driver #3 (VSN1): reset the SELECTED slot's intensity to its default.
   *  POST /global-effect-slots/:slotId/intensity/reset (jog press). */
  resetGlobalEffectSlotIntensity(slotId: number): Promise<MidiApiResult>;
  /** Effects v2: select the effects PAGE (0..3) on the engine (the single
   *  source of truth). PATCH /global-effects/page { page }. Driven by the VSN1
   *  side buttons (and the CaptainPad page switcher). */
  setEffectsPage(page: number): Promise<MidiApiResult>;
  /** Effects v2: cycle the SELECTED slot's discrete `primaryMode` to the next
   *  value. POST /global-effect-slots/:slotId/mode/cycle (VSN1 encoder press). */
  cycleGlobalEffectSlotMode(slotId: number): Promise<MidiApiResult>;
  /** VSN1 sb_2 → cycle to the NEXT named effect bank: POST /global-effects/banks/next
   *  { source? }. The engine computes the target (atomic cycle+wrap) — no
   *  client-computed target, no optimistic switch; it broadcasts `effectBanks` and
   *  every surface converges. `source` is an optional provenance tag the engine
   *  logs + echoes (the operator can see WHICH surface cycled the bank). */
  nextEffectBank(source?: string): Promise<MidiApiResult>;
  /** Effects v2 (VSN1 small button sb_2): reset EVERY global-effect slot's
   *  intensity + mode to default. POST /global-effects/reset-all. */
  resetAllGlobalEffects(): Promise<MidiApiResult>;
  /** Effects v2 (VSN1 small button sb_3): turn OFF every active global effect.
   *  POST /global-effects/disable-all. */
  disableAllGlobalEffects(): Promise<MidiApiResult>;
  setChannelPlaylistEntry(role: 'deck' | 'mixer', channelId: string, entryId: string): Promise<MidiApiResult>;
  // ── APC operator re-layout (2026-07) ──
  /** Toggle the active CaptainPad tab Deck ↔ Mixer (APC Shift button). The
   *  implementation (injected from useMidiControl, which owns the router +
   *  active-tab signal) reads the current tab and navigates the other. */
  toggleDeckMixerView(): Promise<MidiApiResult>;
  /** Combined pattern+color autopilot toggle (APC clip_stop button): read BOTH
   *  autopilot states, then — if AT LEAST ONE is on turn BOTH on; if BOTH are on
   *  turn BOTH off. The read/decision lives in the injected impl (it needs the
   *  live engine reads), not in the pure dispatcher. */
  toggleCombinedAutopilot(): Promise<MidiApiResult>;
  /** Master FADE toggle (APC stop_all_clips button): if the master is NOT
   *  already black, fade TO BLACK over the currently-selected duration; if it IS
   *  black, fade UP. The injected impl reads the live master + the selected
   *  duration (MasterFadeGroup store) — never a hardcoded duration. */
  toggleMasterFade(): Promise<MidiApiResult>;
  /** PERFORMANCE-MODE dialog summon (APC solo button, 2026-07-13): open the
   *  state-appropriate guarded sheet in the CaptainPad UI (idle → enter-confirm;
   *  active → KEEP/RESTORE exit; second press cancels). NEVER a blind engine
   *  toggle — the exit choice can only be answered on the iPad. The injected
   *  impl pokes the performance-dialog summon bus (hooks/usePerformanceMode)
   *  and fails loud when no UI control is mounted to receive it. */
  summonPerformanceDialog(): Promise<MidiApiResult>;
  // Per-control STATIC writes for MIDI-learned local params. The deck has a
  // singleton route (no id); mixer overlays are addressed by channel id.
  setDeckChannelControl(id: number, v0: number, v1?: number, v2?: number): Promise<MidiApiResult>;
  setMixerChannelControl(channelId: string, id: number, v0: number, v1?: number, v2?: number): Promise<MidiApiResult>;
  /** PER-CHANNEL hue (engine F-hue — hue is per-channel ONLY; the global
   *  shifter was removed 2026-07): PATCH /mixer/channels/:id { hue } — or
   *  PATCH /deck/channel when `opts.deck` — the same client the on-screen HUE
   *  trim uses (utils/channelExtrasApi setChannelHue). Degrees; the engine
   *  normalizes into [0,360) and 400s on a non-finite value. */
  setChannelHue(channelId: string, hue: number, opts?: { deck?: boolean }): Promise<MidiApiResult>;
}

/** A resolved mixer "layer" — unified across tabs. On the Deck tab layer 0 is
 *  the deck channel (role 'deck', its own API); on the Mixer tab layers are the
 *  overlay channels (role 'mixer'). null when that layer doesn't exist. */
export interface MidiLayerRef { id: string; role: 'deck' | 'mixer' }

/** Live engine state the dispatcher needs to resolve toggles + banks. */
export interface MidiDispatchContext {
  /** Current global blackout (for blackoutToggle). */
  getBlackout(): boolean;
  /** Current state of a named global effect (for globalEffect toggle). */
  getGlobalEffectState(effect: string): boolean;
  /** Map a pattern-bank pad (bank, padIndex) to a pattern name, or null when
   *  no pattern sits behind that pad — an unlit pad dispatches nothing. */
  resolvePatternForBank(bank: number, index: number): string | null;
  /** The Nth "layer" for the active tab (deck channel on Deck, overlay on
   *  Mixer), or null when it doesn't exist. */
  getLayer(layer: number): MidiLayerRef | null;
  /** Curated palette pair (hues 0..1) at index, or null when out of range. */
  getColorPalette(index: number): { c1: number; c2: number } | null;
  /** Is the engine's BPM→Speed sync currently ON (for bpmSyncToggle)? */
  getBpmSpeedSyncOn(): boolean;
  /** The behavior of a global-effect slot (by 1-based slot number) from the
   *  live engine snapshot: 'toggle' | 'trigger' | 'hold'. null when the slot
   *  isn't in the snapshot yet (a boot/refresh race) — the dispatcher then
   *  FAILS SAFE to 'toggle' (the historical behavior) with a status note rather
   *  than crashing. This is what makes a pad BEHAVIOR-AWARE: a 'trigger' slot
   *  (Iceberg Flash / White Drop) must send 'trigger', not 'toggle' (a no-op
   *  flash-wise on a momentary effect). */
  getGlobalEffectSlotBehavior(slot: number): GlobalEffectSlotBehavior | null;
}

/** A global-effect slot's press behavior, mirroring the engine's per-slot
 *  `behavior` field (marsin_engine global_effect_slot_manager). 'hold' is
 *  forward-looking — no slot currently uses it and the engine's slot pipeline
 *  doesn't wire it yet — but the dispatch mapping is ready for it. */
export type GlobalEffectSlotBehavior = 'toggle' | 'trigger' | 'hold';

// Every dispatch RETURNS the api's MidiApiResult so the runtime can surface a
// failed engine call (fail-loud, codex P0): a knob that silently does nothing
// after an engine restart / deleted entry (404) is the exact anti-pattern this
// layer exists to prevent. A deliberate no-op (an empty pad, an absent layer)
// is a SUCCESS (`OK`) — nothing was meant to happen, so nothing failed.
export type MidiDispatcher = (resolved: ResolvedAction) => Promise<MidiApiResult>;

/** A deliberate no-op (empty pad / absent layer / missing palette) succeeds:
 *  the mapping resolved but there was nothing behind it, which is loud silence
 *  by design, not a dispatch failure. */
const OK: MidiApiResult = { ok: true };

export function createDispatcher(api: MidiDispatchApi, ctx: MidiDispatchContext): MidiDispatcher {
  // Optimistic blackout intent (#P3-1): the GEM blackout snapshot lags the send
  // by an echo window, so a panic double-tap inside that window would read the
  // SAME stale `getBlackout()` twice and send `true` twice — sticking ON. We
  // track the last state we SENT and toggle off THAT while the snapshot hasn't
  // caught up yet, so a rapid re-tap actually inverts. null = no send in flight
  // (trust the snapshot); cleared implicitly once the snapshot matches our send.
  let lastBlackoutSent: boolean | null = null;
  // Same optimistic-toggle pattern for the BPM→Speed sync push (the sharedParams
  // echo that updates the snapshot's bpmSpeedSyncOn lags the POST by a frame or
  // two; a rapid double-press must actually invert, not send the same state
  // twice).
  let lastSyncSent: boolean | null = null;

  return async (resolved: ResolvedAction): Promise<MidiApiResult> => {
    switch (resolved.kind) {
      case 'paramCenter':
        return api.updateParamCenter({ [resolved.key]: resolved.value });
      case 'master':
        return api.updateMixerMaster(resolved.value);
      case 'sectionBrightness':
        return api.setSectionBrightness(resolved.sectionId, resolved.value);
      case 'pattern':
        return api.setActivePattern(resolved.name);
      case 'patternBank': {
        const name = ctx.resolvePatternForBank(resolved.bank, resolved.index);
        if (name === null) return OK; // no pattern behind this pad — loud silence
        return api.setActivePattern(name);
      }
      case 'blackoutToggle': {
        // The unified GEM e-stop ("stop all clips → blackout"): blacks out
        // pixels AND clears active macros/global effects. Base the toggle on the
        // last state we SENT while the snapshot echo is still catching up to it
        // (#P3-1), otherwise on the live snapshot; a matching snapshot means the
        // echo landed, so we trust it again.
        const snap = ctx.getBlackout();
        const base = lastBlackoutSent !== null && lastBlackoutSent !== snap ? lastBlackoutSent : snap;
        const next = !base;
        lastBlackoutSent = next;
        return api.setGlobalEffectBlackout(next);
      }
      case 'globalEffect':
        return api.setGlobalEffect(resolved.effect, !ctx.getGlobalEffectState(resolved.effect));
      case 'groupFixedColor':
        return api.setGroupFixedColor(resolved.group, resolved.color, resolved.brightness);
      case 'mixerLayerFader': {
        const L = ctx.getLayer(resolved.layer);
        if (!L) return OK; // layer doesn't exist — inert
        if (L.role === 'deck') return api.updateDeckChannel({ fader: resolved.value });
        return api.updateMixerChannel(L.id, { fader: resolved.value });
      }
      case 'globalEffectSlot': {
        // BEHAVIOR-AWARE slot dispatch (the Iceberg-Flash / White-Drop fix). The
        // pad used to hardcode 'toggle' for EVERY slot, so a 'trigger' slot (a
        // momentary drop-hit) got a toggle it doesn't understand and never
        // fired. Read the slot's behavior from the live snapshot and map it to
        // the engine's slot-action vocabulary:
        //   'toggle'  → 'toggle'  (unchanged — flip on/off)
        //   'trigger' → 'trigger' (one-shot flash — THE FIX)
        //   'hold'    → 'down' on press / 'up' on release (forward-looking)
        // Fail SAFE, not loud, on an unknown/absent behavior (a boot/refresh
        // race where the snapshot hasn't got this slot yet): default to
        // 'toggle' (the historical behavior) rather than crash the transport
        // callback. Loud-but-nonfatal would need a status seam the pure
        // dispatcher doesn't own, so the safe default IS the surfaced choice.
        const behavior = ctx.getGlobalEffectSlotBehavior(resolved.slot);
        const phase = resolved.phase ?? 'press';
        let action: string;
        if (behavior === 'trigger') {
          action = 'trigger';
        } else if (behavior === 'hold') {
          // A hold slot presses 'down' and releases 'up'. NOTE (TODO): resolveEvent
          // currently swallows every Note Off (v1 has no momentary pads), so a
          // 'release' phase never actually reaches this dispatcher yet — no slot
          // uses 'hold', and the engine's slot pipeline doesn't wire hold either.
          // The mapping is here so wiring the release path later is a one-line
          // resolver change; until then a hold slot only ever fires 'down'.
          action = phase === 'release' ? 'up' : 'down';
        } else {
          // 'toggle' OR unknown/absent (fail-safe default).
          action = 'toggle';
        }
        return api.dispatchGlobalEffectSlotAction(resolved.slot, action);
      }
      case 'colorPalettePair': {
        const p = ctx.getColorPalette(resolved.palette);
        if (!p) return OK; // no palette behind this pad — loud silence
        return api.updateParamCenter({
          colorPalette1: { h: p.c1, s: 1, v: 1 },
          colorPalette2: { h: p.c2, s: 1, v: 1 },
        });
      }
      case 'localParam':
        // A MIDI-learned local-param STATIC write. Route to the deck singleton
        // or the addressed mixer overlay channel. The render loop's audio
        // modulators stay layered on top of this base value untouched.
        if (resolved.role === 'deck') return api.setDeckChannelControl(resolved.exportId, resolved.value);
        return api.setMixerChannelControl(resolved.channelId, resolved.exportId, resolved.value);
      case 'bpmSyncToggle': {
        // Toggle the engine's BPM→Speed sync via the existing param-center API
        // ({ bpmSpeedSync: 1|0 }). Same lagging-echo protection as blackout:
        // base the flip on the last state we SENT while the snapshot hasn't
        // caught up yet, so a rapid re-press actually inverts.
        const snap = ctx.getBpmSpeedSyncOn();
        const base = lastSyncSent !== null && lastSyncSent !== snap ? lastSyncSent : snap;
        const next = !base;
        lastSyncSent = next;
        return api.updateParamCenter({ bpmSpeedSync: next ? 1 : 0 });
      }
      case 'channelHue':
        // Runtime-built absolute PER-CHANNEL hue write (the hue knob's ONLY
        // engine write — hue is per-channel only; the global shifter is
        // gone). Routed like localParam: the deck singleton via its own PATCH,
        // a mixer overlay by channel id. No autoRotate field exists per
        // channel, so none is sent (never invent one).
        return api.setChannelHue(
          resolved.channelId,
          resolved.degrees,
          resolved.role === 'deck' ? { deck: true } : undefined,
        );
      case 'effectIntensitySlot':
        // Driver #3 (VSN1): runtime-built SELECTED-slot intensity write — the jog
        // value already resolved against the selection + pickup guard. POST
        // /global-effect-slots/:slotId/intensity { value }.
        return api.setGlobalEffectSlotIntensity(resolved.slotId, resolved.value);
      case 'effectIntensitySlotReset':
        // Driver #3 (VSN1): runtime-built SELECTED-slot intensity reset (jog press).
        // POST /global-effect-slots/:slotId/intensity/reset.
        return api.resetGlobalEffectSlotIntensity(resolved.slotId);
      case 'effectsPageSelect':
        // Effects v2: side-button page select → PATCH the engine's effectsPage.
        // The engine broadcasts the change so the UI + every controller converge.
        return api.setEffectsPage(resolved.page);
      case 'effectModeCycleSlot':
        // Effects v2: runtime-built SELECTED-slot mode cycle (encoder press).
        // POST /global-effect-slots/:slotId/mode/cycle.
        return api.cycleGlobalEffectSlotMode(resolved.slotId);
      case 'effectBankNext':
        // VSN1 sb_2: runtime-built bank CYCLE — the engine computes the next bank
        // (atomic cycle+wrap) and broadcasts `effectBanks` so the badge + device
        // converge (no client-computed target, no optimistic switch).
        // `effectBankNext` is ONLY produced by the sb_2 path, so the provenance tag
        // is a constant here — the engine logs + echoes it so a spurious cycle is
        // traceable to sb_2.
        return api.nextEffectBank('vsn1_sb2');
      case 'globalEffectsResetAll':
        // Effects v2: VSN1 small button sb_2 → reset EVERY slot to default.
        return api.resetAllGlobalEffects();
      case 'globalEffectsDisableAll':
        // Effects v2: VSN1 small button sb_3 → turn OFF every active effect.
        return api.disableAllGlobalEffects();
      case 'viewToggle':
        // APC Shift → flip the active CaptainPad tab. The injected impl owns the
        // current-tab read + the router navigate (it lives in the hook layer).
        return api.toggleDeckMixerView();
      case 'autopilotToggle':
        // APC clip_stop → combined pattern+color autopilot toggle. The injected
        // impl reads BOTH states and applies the any-on→both-on / both-on→both-off
        // rule (it needs the live engine reads, which the pure dispatcher lacks).
        return api.toggleCombinedAutopilot();
      case 'masterFadeToggle':
        // APC stop_all_clips → master fade TO BLACK / UP over the selected
        // duration. The injected impl reads the live master + the selected fade
        // duration (never hardcoded).
        return api.toggleMasterFade();
      case 'performanceDialog':
        // APC solo → summon the performance-mode dialog in the UI. Never a
        // blind engine toggle: the injected impl opens the guarded sheet
        // (enter-confirm / KEEP-RESTORE exit) and the operator answers on the
        // iPad. Fails loud when no dialog UI is mounted.
        return api.summonPerformanceDialog();
      case 'focusChannel':
      case 'playlistScroll':
      case 'playlistWindowSelect':
      case 'focusedParamDelta':
      case 'paramCenterDelta':
      case 'focusedParamReset':
      case 'focusStep':
      case 'hueDelta':
      case 'hueReset':
      // The RAW (slotless) VSN1 jog actions carry no slot — the runtime resolves
      // them against the SELECTED slot + pickup guard and dispatches the concrete
      // effectIntensitySlot / effectIntensitySlotReset instead. Reaching the
      // dispatcher with the raw form is a wiring bug.
      case 'effectIntensityAbs':
      case 'effectIntensityReset':
      // The RAW (slotless) encoder-press mode cycle carries no slot — the runtime
      // resolves it against the SELECTED slot and dispatches effectModeCycleSlot.
      case 'effectModeCycle':
        // These are RUNTIME-ONLY actions (controller-local state: focus
        // selection / per-layer window cursor / focused-channel delta math /
        // VSN1 selected-slot). The runtime intercepts them BEFORE the dispatcher
        // — reaching here means a wiring bug, so fail loud rather than silently
        // swallow (codex P0: no silent no-ops).
        throw new Error(`dispatch: '${resolved.kind}' must be handled by the controller runtime, not dispatched`);
      default:
        // Exhaustiveness guard — a new ResolvedAction kind must add a case.
        throw new Error(`dispatch: unhandled ResolvedAction kind '${(resolved as { kind: string }).kind}'`);
    }
  };
}
