// use_tempo_tap — shared tap-tempo logic + tempo-source state, used by BOTH
// the deck TAP button (DeckTopBar) and the GLOBALS-bar TAP cluster
// (CPCControls). Extracted so the two surfaces agree pixel-for-behaviour on
// what a tap means and what "128 · OSC/TAP/held" reads as.
//
// TEMPO ARBITRATION (engine feat/optimize_channels): the engine now arbitrates
// "OSC auto-drives, tap overrides":
//   - OSC live + no recent tap  → the live OSC BPM drives mixer.tempoBpm.
//     `tempoSource === 'osc'`.
//   - A manual tap (POST /mixer/tempo) sets the clock AND arms a ~12s
//     manual-override hold so OSC can't immediately reclaim it.
//     `tempoSource === 'manual'` for the duration of that window.
//   - OSC stale/off → the last value just holds. `tempoSource === 'held'`.
// `oscTempoBpm` is the RAW live OSC bpm (clamped) or null when stale — distinct
// from the applied `tempoBpm`. All three ride the SAME `mixer` / `deck`
// control-bus WS broadcasts the master/tempo already use — no new polling path.
//
// POST /mixer/tempo/sync (postTempoSync) is the explicit "re-sync to OSC":
// drop the manual override so OSC reclaims on the next tick. Only meaningful
// while `tempoSource === 'manual'` (an active override exists to drop).

import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { engineEvents, type EngineMessage } from '@/utils/engineEvents';
import { postTapTempo, postTempoSync } from '@/utils/channelExtrasApi';

// The engine's accepted tempo window. The client clamps the DISPLAY to match
// (the engine 400s anything out of [20,400], so clamping here is honest).
export const TAP_BPM_MIN = 20;
export const TAP_BPM_MAX = 400;
const TAP_MAX_SAMPLES = 5; // average over the last few intervals
const TAP_RESET_MS = 2500; // gap longer than this ⇒ a fresh tap series

// How the current tempoBpm is being driven (engine `tempoSource`). We default
// to 'held' until the first broadcast — the conservative "no live OSC, no
// recent tap" reading — matching the engine's no-arbiter fallback.
export type TempoSource = 'osc' | 'manual' | 'held';

export interface TempoState {
  /** The applied pattern-clock BPM (mixer.tempoBpm). null = no tempo set. */
  bpm: number | null;
  /** Which input is driving `bpm` right now. */
  source: TempoSource;
  /** The RAW live OSC bpm (clamped), or null when OSC is stale/off. */
  oscBpm: number | null;
}

function isTempoSource(v: unknown): v is TempoSource {
  return v === 'osc' || v === 'manual' || v === 'held';
}

/**
 * Read the tempo arbitration state off the SAME control-bus broadcasts that
 * drive the master value (`mixer` / `deck` push events — NOT a new polling
 * path). Surfaces `tempoBpm`, `tempoSource`, and `oscTempoBpm` together so a
 * consumer renders one coherent "128 · OSC" / "128 · TAP" / "128 · held".
 *
 * IMPORTANT: only the `mixer` broadcast carries the tempo fields — serialize-
 * MixerState() puts them there, and the engine fires the `deck` broadcast
 * back-to-back WITHOUT them. So we MUST ignore any message that doesn't carry
 * `tempoSource`; treating its absent `tempoBpm`/`tempoSource` as null/held
 * would let the trailing `deck` event clobber a freshly-applied mixer tempo
 * (the exact bug the old per-field `useTempoBpm` avoided by only acting on a
 * present value). `tempoSource` is the presence sentinel — it is always one of
 * the three strings on a tempo-bearing broadcast, never absent.
 */
export function useTempoState(): TempoState {
  const [state, setState] = useState<TempoState>({ bpm: null, source: 'held', oscBpm: null });
  useEffect(() => {
    const onMessage = (msg: EngineMessage) => {
      if (msg.type !== 'mixer' && msg.type !== 'deck') return;
      const rawSource = (msg as { tempoSource?: unknown }).tempoSource;
      // No tempoSource ⇒ this broadcast doesn't carry tempo (e.g. the deck
      // event). Leave the last applied tempo untouched.
      if (!isTempoSource(rawSource)) return;
      const rawBpm = (msg as { tempoBpm?: unknown }).tempoBpm;
      const rawOsc = (msg as { oscTempoBpm?: unknown }).oscTempoBpm;
      const bpm =
        typeof rawBpm === 'number' && Number.isFinite(rawBpm) ? rawBpm : null;
      const oscBpm =
        typeof rawOsc === 'number' && Number.isFinite(rawOsc) ? rawOsc : null;
      setState((prev) =>
        prev.bpm === bpm && prev.source === rawSource && prev.oscBpm === oscBpm
          ? prev
          : { bpm, source: rawSource, oscBpm },
      );
    };
    const unsubscribe = engineEvents.subscribe(onMessage);
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);
  return state;
}

export interface TempoTap {
  /** Register one tap; once ≥2 taps land, POSTs the averaged BPM. */
  tap: () => void;
  /** Drop the manual override so OSC reclaims (POST /mixer/tempo/sync). */
  sync: () => void;
}

// Tap timestamps live at MODULE scope, not per-hook-instance, so a tap series
// is GLOBAL across every surface that taps: the deck TAP button and the mixer
// TAP cluster are different `useTempoTap()` instances, but the operator
// experiences one tempo. A component-scoped ref reset the series whenever you
// switched the deck↔mixer tab (the host unmounts), so a 4-tap series split
// across the switch lost its history. At module scope the taps accumulate
// continuously; TAP_RESET_MS still starts a fresh series after a long gap.
const tapTimes: number[] = [];

/**
 * Tap-tempo behaviour shared by the deck + globals TAP controls. The client
 * computes BPM from the intervals between the last few taps, averages them,
 * clamps to the engine's [20,400] window, and POSTs the resolved BPM (which
 * also arms the manual override engine-side). `sync()` drops that override.
 *
 * Tap timestamps live in a ref so tapping never re-renders the host — only the
 * engine-authoritative tempo state (via useTempoState) drives the label.
 *
 * Codex P0 — fail loud: a rejected tempo / sync surfaces a real Alert; we
 * never swallow the engine's error.
 */
export function useTempoTap(): TempoTap {
  const sendTempo = async (bpm: number) => {
    const res = await postTapTempo(bpm);
    if (!res.ok) {
      console.error('Tap tempo failed:', res.error);
      Alert.alert('Tap tempo failed', res.error || 'The engine rejected the tempo.');
    }
  };

  const tap = () => {
    const now = Date.now();
    const times = tapTimes;
    // A long gap means a new series — drop the stale taps.
    if (times.length > 0 && now - times[times.length - 1] > TAP_RESET_MS) {
      times.length = 0;
    }
    times.push(now);
    // Keep only the most recent samples (need N taps ⇒ N-1 intervals).
    if (times.length > TAP_MAX_SAMPLES + 1) {
      times.splice(0, times.length - (TAP_MAX_SAMPLES + 1));
    }
    // Need at least two taps to derive an interval.
    if (times.length < 2) return;
    let sum = 0;
    for (let i = 1; i < times.length; i++) sum += times[i] - times[i - 1];
    const avgIntervalMs = sum / (times.length - 1);
    if (!(avgIntervalMs > 0)) return;
    const rawBpm = 60000 / avgIntervalMs;
    const bpm = Math.round(Math.max(TAP_BPM_MIN, Math.min(TAP_BPM_MAX, rawBpm)));
    void sendTempo(bpm);
  };

  const sync = async () => {
    const res = await postTempoSync();
    if (!res.ok) {
      console.error('Tempo sync failed:', res.error);
      Alert.alert('Tempo sync failed', res.error || 'The engine could not hand tempo back to OSC.');
    }
  };

  return { tap, sync: () => void sync() };
}

// ── Source-tag presentation ───────────────────────────────────────────────
// The short OSC/TAP/HELD source tag was retired (2026-06-22 UI cleanup) — the
// readout is now just the BPM number, with SYNC + the source-based tint
// carrying the "what's driving the clock" signal. Only the override predicate
// remains, since SYNC depends on it.

/** True only when a manual override is active (⇒ show the SYNC affordance). */
export function tempoSourceHasOverride(source: TempoSource): boolean {
  return source === 'manual';
}
