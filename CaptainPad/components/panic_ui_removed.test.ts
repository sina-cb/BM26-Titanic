import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = path.join(__dirname, '../app/(tabs)');
const deck = fs.readFileSync(path.join(APP, 'index.tsx'), 'utf8');
const mixer = fs.readFileSync(path.join(APP, 'mixer.tsx'), 'utf8');

describe('Deck and Mixer operator safety surface', () => {
  it.each([
    ['Deck', deck],
    ['Mixer', mixer],
  ])('%s does not mount or wire a PANIC control', (_name, source) => {
    expect(source).not.toContain('panicMixer');
    expect(source).not.toContain('panicPrompt');
    expect(source).not.toContain('panicBusy');
    expect(source).not.toContain('styles.panicBtn');
    expect(source).not.toContain('accessibilityLabel="Panic');
    expect(source).not.toContain('title="Panic to safe state?"');
  });

  it('retains the global effects strip, whose BLACKOUT remains the emergency control', () => {
    expect(deck).toContain('<RigGlobals variant="mixer" />');
    expect(mixer).toContain('<RigGlobals variant="mixer" />');
  });
});
