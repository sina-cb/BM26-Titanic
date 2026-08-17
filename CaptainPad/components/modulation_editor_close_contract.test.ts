import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, 'Modulation.tsx'), 'utf8');

describe('modulation editor successful mutation lifecycle', () => {
  it('closes before refreshing its Deck or Mixer owner after save', () => {
    const saveBlock = source.slice(source.indexOf('const save = async'), source.indexOf('const remove = async'));
    expect(saveBlock.indexOf('setDismissed(true);')).toBeGreaterThan(-1);
    expect(saveBlock.indexOf('setDismissed(true);')).toBeLessThan(saveBlock.indexOf('onClose();'));
    expect(saveBlock.indexOf('onClose();')).toBeGreaterThan(-1);
    expect(saveBlock.indexOf('onClose();')).toBeLessThan(saveBlock.indexOf('onChanged();'));
  });

  it('closes before refreshing its Deck or Mixer owner after remove', () => {
    const removeBlock = source.slice(source.indexOf('const remove = async'), source.indexOf('return (', source.indexOf('const remove = async')));
    expect(removeBlock.indexOf('setDismissed(true);')).toBeGreaterThan(-1);
    expect(removeBlock.indexOf('setDismissed(true);')).toBeLessThan(removeBlock.indexOf('onClose();'));
    expect(removeBlock.indexOf('onClose();')).toBeGreaterThan(-1);
    expect(removeBlock.indexOf('onClose();')).toBeLessThan(removeBlock.indexOf('onChanged();'));
  });

  it('keeps failed saves open by closing only after the ok guard', () => {
    const saveBlock = source.slice(source.indexOf('const save = async'), source.indexOf('const remove = async'));
    expect(saveBlock.indexOf('if (!r.ok)')).toBeLessThan(saveBlock.indexOf('onClose();'));
  });
});
