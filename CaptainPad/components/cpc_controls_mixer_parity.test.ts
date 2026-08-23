// cpc_controls_mixer_parity.test.ts — source-text guards for the mixer's
// CPCControls wiring: the AUDIO SIGNALS row must hide/show via the SAME deck
// workspace `audioBar` state while its chip lives in the Mixer's ONE workspace
// shown/hidden list. vitest cannot render `CPCControls.tsx` or `mixer.tsx`
// (react-native + this config's globs admit pure `.ts` under `components/**`
// only — see vitest.config.ts), so this file follows the same idiom as
// `components/deck/colors_window_wiring.test.ts`: read the real source as text
// and assert the contract holds.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CPC_PATH = join(HERE, 'CPCControls.tsx');
const MIXER_PATH = join(HERE, '..', 'app', '(tabs)', 'mixer.tsx');
const DECK_WORKSPACE_PATH = join(HERE, 'deck', 'deck_workspace.tsx');
const CPC_SOURCE = readFileSync(CPC_PATH, 'utf8');
const MIXER_SOURCE = readFileSync(MIXER_PATH, 'utf8');
const DECK_WORKSPACE_SOURCE = readFileSync(DECK_WORKSPACE_PATH, 'utf8');

/** Strip line and block comments so prose cannot trip a scan. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const CPC_CODE = stripComments(CPC_SOURCE);
const MIXER_CODE = stripComments(MIXER_SOURCE);
const DECK_WORKSPACE_CODE = stripComments(DECK_WORKSPACE_SOURCE);

describe('mixer CPCControls — AUDIO joins the Mixer workspace shown/hidden list', () => {
  const callMatch = MIXER_CODE.match(
    /<CPCControls\b[\s\S]*?hideAudioRow=\{!deckWorkspace\.isBarShown\('audioBar'\)\}[\s\S]*?\n\s*\/>/,
  );

  it('the <CPCControls ... /> call site exists and is captured (scanner is not vacuous)', () => {
    expect(callMatch).not.toBeNull();
    expect(callMatch![0]).toContain('screen="mixer"');
    expect(callMatch![0]).toContain('trailing=');
  });

  it('passes `hideAudioRow` gated on `deckWorkspace.isBarShown(\'audioBar\')` — same predicate as the deck tab', () => {
    expect(callMatch).not.toBeNull();
    expect(callMatch![0]).toMatch(/hideAudioRow=\{!deckWorkspace\.isBarShown\('audioBar'\)\}/);
  });

  it('does not render a second DeckWorkspaceBar inside CPCControls', () => {
    expect(callMatch).not.toBeNull();
    expect(callMatch![0]).not.toContain('optimizerSlot=');
    expect(MIXER_CODE).not.toContain("barsOnly={['audioBar']}");
  });

  it('keeps deck audioBar state but routes its controls into MixerWorkspaceBar', () => {
    expect(MIXER_CODE).toMatch(/import \{ useDeckWorkspace \} from '@\/components\/deck\/deck_workspace';/);
    expect(MIXER_CODE).toMatch(/const deckWorkspace = useDeckWorkspace\(\);/);
    expect(MIXER_CODE).toMatch(/audioBarOpen=\{deckWorkspace\.isBarShown\('audioBar'\)\}/);
    expect(MIXER_CODE).toMatch(/onAudioOpen=\{\(\) => deckWorkspace\.openWindow\('audioBar'\)\}/);
    expect(MIXER_CODE).toMatch(/onAudioClose=\{\(\) => deckWorkspace\.closeWindow\('audioBar'\)\}/);
  });
});

describe('§3.1 — both deck-only props are declared OPTIONAL on CPCControlsProps', () => {
  const propsBlock = CPC_CODE.match(/interface CPCControlsProps \{[\s\S]*?\n\}/);

  it('the CPCControlsProps interface is captured (scanner is not vacuous)', () => {
    expect(propsBlock).not.toBeNull();
    expect(propsBlock![0]).toContain('trailing?:');
  });

  it('`optimizerSlot` is declared with the optional-prop `?:` marker', () => {
    expect(propsBlock).not.toBeNull();
    expect(propsBlock![0]).toMatch(/optimizerSlot\?\s*:\s*React\.ReactNode/);
  });

  it('`hideAudioRow` is declared with the optional-prop `?:` marker', () => {
    expect(propsBlock).not.toBeNull();
    expect(propsBlock![0]).toMatch(/hideAudioRow\?\s*:\s*boolean/);
  });
});

describe('§3.1 — row 2 (AUDIO SIGNALS) and its <AudioPlotPicker> modal are gated on the SAME condition', () => {
  it('row 2\'s outer <View> is gated on `!hideAudioRow ?`', () => {
    expect(CPC_CODE).toMatch(/\{!hideAudioRow \? \(\s*\n\s*<View/);
  });

  it('the <AudioPlotPicker> element is gated on the identical `!hideAudioRow ?` condition', () => {
    expect(CPC_CODE).toMatch(/\{!hideAudioRow \? \(\s*\n\s*<AudioPlotPicker/);
  });

  it('both gates use the literal `!hideAudioRow` token — no drift', () => {
    const gateHits = CPC_CODE.match(/\{!hideAudioRow \? \(/g) ?? [];
    expect(gateHits.length).toBe(2);
  });
});

describe('DeckWorkspaceBar — `barsOnly` exposes bar chips without deck windows', () => {
  const propsBlock = DECK_WORKSPACE_CODE.match(/interface DeckWorkspaceBarProps \{[\s\S]*?\n\}/);

  it('declares the optional `barsOnly?: readonly DeckBarId[]` prop', () => {
    expect(propsBlock).not.toBeNull();
    expect(propsBlock![0]).toMatch(/barsOnly\?\s*:\s*readonly DeckBarId\[\]/);
  });

  it('skips window chips when `barsOnlySet` is set', () => {
    expect(DECK_WORKSPACE_CODE).toMatch(/barsOnlySet \? \[\] : effectiveOpenWindows/);
  });

  it('filters shown bars through `DECK_BAR_IDS` membership in `barsOnly` mode', () => {
    expect(DECK_WORKSPACE_CODE).toMatch(/DECK_BAR_IDS\.filter\(\(id\) => barsOnlySet\.has\(id\)/);
  });

  it('filters the restore rail to the requested bars only in `barsOnly` mode', () => {
    expect(DECK_WORKSPACE_CODE).toMatch(/layout\.closed\.filter\(\(id\): id is DeckBarId => barsOnlySet\.has\(id as DeckBarId\)\)/);
  });
});

describe('the scanner itself works', () => {
  it('reads real, non-trivial source files', () => {
    expect(CPC_SOURCE.length).toBeGreaterThan(10000);
    expect(MIXER_SOURCE.length).toBeGreaterThan(10000);
    expect(DECK_WORKSPACE_SOURCE.length).toBeGreaterThan(5000);
  });
});
