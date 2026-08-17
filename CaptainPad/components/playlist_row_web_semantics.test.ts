import { describe, expect, it } from 'vitest';

import { playlistRowAccessibilityRole } from './playlist_row_web_semantics';

describe('playlist row web semantics', () => {
  it('does not turn the row wrapper into a web button around child buttons', () => {
    expect(playlistRowAccessibilityRole('web')).toBeUndefined();
  });

  it('retains explicit button semantics on native platforms', () => {
    expect(playlistRowAccessibilityRole('ios')).toBe('button');
    expect(playlistRowAccessibilityRole('android')).toBe('button');
  });
});
