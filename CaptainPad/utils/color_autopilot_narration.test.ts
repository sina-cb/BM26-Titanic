// color_autopilot_narration.test — pins the composed retune-rejection
// sentence both mounts (deck + mixer) show the operator (docs/75 §5, §6 W3).
// The no-detail/no-failNote cases are pinned to today's shipped sentence
// VERBATIM (including the pre-existing double space where the interpolated
// `${detail || ''}` collapses to nothing) — a wording diff here is a
// regression in the mounts, not an improvement in this helper.

import { describe, expect, it } from 'vitest';

import { retuneRejectionMessage } from '@/utils/color_autopilot_narration';

describe('retuneRejectionMessage', () => {
  describe('kind: rejected', () => {
    it('pins the shipped sentence verbatim with no detail and no failNote', () => {
      expect(retuneRejectionMessage('rejected', undefined, undefined)).toBe(
        'The engine refused the change.  The rotation is still running its previous settings.',
      );
    });

    it('treats an empty-string detail the same as undefined', () => {
      expect(retuneRejectionMessage('rejected', '', undefined)).toBe(
        'The engine refused the change.  The rotation is still running its previous settings.',
      );
    });

    it('folds in the engine detail', () => {
      expect(retuneRejectionMessage('rejected', 'palettes must have length >= 2', undefined)).toBe(
        'The engine refused the change. palettes must have length >= 2 The rotation is still running its previous settings.',
      );
    });

    it('appends the failNote with no detail', () => {
      expect(retuneRejectionMessage('rejected', undefined, 'CONTRAST retune')).toBe(
        'The engine refused the change.  The rotation is still running its previous settings. CONTRAST retune',
      );
    });

    it('folds in both the detail and the failNote', () => {
      expect(retuneRejectionMessage('rejected', 'palettes must have length >= 2', 'CONTRAST retune')).toBe(
        'The engine refused the change. palettes must have length >= 2 The rotation is still running its previous settings. CONTRAST retune',
      );
    });
  });

  describe('kind: unreachable', () => {
    it('pins the shipped sentence verbatim with no detail and no failNote', () => {
      expect(retuneRejectionMessage('unreachable', undefined, undefined)).toBe(
        'Could not reach the engine.',
      );
    });

    it('treats an empty-string detail the same as undefined', () => {
      expect(retuneRejectionMessage('unreachable', '', undefined)).toBe(
        'Could not reach the engine.',
      );
    });

    it('folds in the error detail', () => {
      expect(retuneRejectionMessage('unreachable', 'Network request failed', undefined)).toBe(
        'Could not reach the engine. Network request failed',
      );
    });

    it('appends the failNote with no detail', () => {
      expect(retuneRejectionMessage('unreachable', undefined, 'A/B pick retune')).toBe(
        'Could not reach the engine. A/B pick retune',
      );
    });

    it('folds in both the detail and the failNote', () => {
      expect(retuneRejectionMessage('unreachable', 'Network request failed', 'A/B pick retune')).toBe(
        'Could not reach the engine. Network request failed A/B pick retune',
      );
    });
  });
});
