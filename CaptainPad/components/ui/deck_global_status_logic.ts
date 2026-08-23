import { colorChipLabel, rotationKind } from '@/components/deck/colors_window_logic';
import type { DeckGlobalStatusFrame } from '@/hooks/useEngineState';

export type DeckGlobalStatusTone = 'auto' | 'info' | 'warning' | 'danger';
export type DeckGlobalStatusTarget = 'deck' | 'colors' | 'overlays';

export interface DeckGlobalStatusChip {
  id: string;
  label: string;
  tone: DeckGlobalStatusTone;
  target: DeckGlobalStatusTarget;
}

export function deckGlobalStatusPages(
  chips: DeckGlobalStatusChip[],
  maxRows = 2,
): DeckGlobalStatusChip[][] {
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error(`maxRows must be a positive integer, got ${JSON.stringify(maxRows)}`);
  }
  const pages: DeckGlobalStatusChip[][] = [];
  for (let index = 0; index < chips.length; index += maxRows) {
    pages.push(chips.slice(index, index + maxRows));
  }
  return pages;
}

function durationLabel(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}MS`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}S`;
}

function modeLabel(mode: string): string {
  return mode.replace(/^(blend_|trans_)/, '').replace(/_/g, ' ').toUpperCase();
}

export function deckGlobalStatusChips(
  frame: DeckGlobalStatusFrame,
): DeckGlobalStatusChip[] {
  const chips: DeckGlobalStatusChip[] = [];

  if (frame.blackout) {
    chips.push({ id: 'blackout', label: 'BLACKOUT', tone: 'danger', target: 'deck' });
  }

  const pattern = frame.patternAutopilot;
  if (pattern?.active) {
    const cadence = pattern.profile === 'audio_reactive'
      ? 'AUDIO'
      : `${Number.parseInt(pattern.delay_s, 10) || 30}S`;
    chips.push({
      id: 'patterns',
      label: `PATTERNS · ${cadence}${pattern.shuffle ? '\nSHUFFLE' : ''}`,
      tone: 'auto',
      target: 'deck',
    });
  }

  const color = frame.colorAutopilot;
  // A stopped color daemon is ordinary Deck state, not an active global
  // behavior. In particular, every engine reports a fixed-color frame at
  // boot; rendering that as COLORS · FIXED made the status rail permanently
  // occupied and contradicted the rail's "active things only" contract.
  if (color?.active) {
    const kind = rotationKind(color.active, color.palettes, color.mode);
    const runningLabel = colorChipLabel(kind, color.notePc);
    chips.push({
      id: 'colors',
      label: runningLabel === null
        ? 'COLORS · FIXED'
        : `${runningLabel}${kind === 'palette-set' && typeof color.delay_s === 'number'
          ? `\n${color.delay_s}S${color.shuffle ? ' · SHUF' : ''}`
          : ''}`,
      tone: 'auto',
      target: 'colors',
    });
  }

  const overlays = frame.deckOverlays;
  if (overlays.enabled > 0) {
    chips.push({
      id: 'overlays',
      label: `OVERLAYS · ${overlays.enabled}${overlays.autopilotActive
        ? `\nAUTO ${overlays.delay_s}S${overlays.shuffle ? ' · SHUF' : ''}`
        : ''}`,
      tone: overlays.autopilotActive ? 'auto' : 'info',
      target: 'overlays',
    });
  }

  const transition = frame.deckTransition;
  if (transition?.enabled) {
    chips.push({
      id: 'transition',
      label: `TX · ${modeLabel(transition.mode)}\n${durationLabel(transition.durationMs)}${transition.shuffle ? ' · SHUF' : ''}`,
      tone: 'info',
      target: 'deck',
    });
  }

  if (frame.activeGlobalEffectCount > 0) {
    chips.push({
      id: 'effects',
      label: `FX · ${frame.activeGlobalEffectCount} ON`,
      tone: 'auto',
      target: 'deck',
    });
  }

  if (frame.master < 0.995) {
    chips.push({
      id: 'master',
      label: `MASTER · ${Math.round(Math.max(0, frame.master) * 100)}%`,
      tone: frame.master <= 0.01 ? 'danger' : 'warning',
      target: 'deck',
    });
  }

  return chips;
}
