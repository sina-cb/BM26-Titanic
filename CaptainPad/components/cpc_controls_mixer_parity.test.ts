// cpc_controls_mixer_parity.test.ts — source-text guards for the W3a slice of
// docs/63_deck_declutter_view_optimizer.md (the CPCControls half: the two
// deck-only `optimizerSlot` / `hideAudioRow` props). vitest cannot render
// `CPCControls.tsx` or `mixer.tsx` (react-native + this config's globs admit
// pure `.ts` under `components/**` only — see vitest.config.ts), so this file
// follows the same idiom as `components/deck/colors_window_wiring.test.ts`
// and `components/no_raw_alerts.test.ts`: read the real source as text and
// assert the contract holds, rather than trust it to a code review.
//
// The single highest-stakes pin here is docs/63 §5 pin 8 — mixer.tsx is NOT
// edited this wave, and CPCControls called with neither new prop must render
// BYTE-IDENTICAL to today. Assertion 1 proves the mixer call site actually
// stays silent on both props; assertions 2-4 prove CPCControls.tsx honors
// that silence (props optional, nothing emitted when the slot is undefined)
// and never lets the audio row and its modal drift apart.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CPC_PATH = join(HERE, 'CPCControls.tsx');
const MIXER_PATH = join(HERE, '..', 'app', '(tabs)', 'mixer.tsx');
const CPC_SOURCE = readFileSync(CPC_PATH, 'utf8');
const MIXER_SOURCE = readFileSync(MIXER_PATH, 'utf8');

/** Strip line and block comments so prose (including this very docblock)
 *  cannot trip a scan. Same crude-but-sufficient approach as
 *  `no_raw_alerts.test.ts` / `colors_window_wiring.test.ts`. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const CPC_CODE = stripComments(CPC_SOURCE);
const MIXER_CODE = stripComments(MIXER_SOURCE);

describe('§5 pin 8 — mixer call site stays silent on both new props', () => {
  // Isolate the ACTUAL JSX call block (`<CPCControls ... />`), not the
  // surrounding file, so an unrelated comment elsewhere in mixer.tsx that
  // happens to mention these prop names (e.g. explaining the deck's usage)
  // can never produce a false failure or a false pass here.
  const callMatch = MIXER_CODE.match(/<CPCControls\b[\s\S]*?\n\s*\/>/);

  it('the <CPCControls ... /> call site exists and is captured (scanner is not vacuous)', () => {
    expect(callMatch).not.toBeNull();
    // Sanity: it's the real multi-prop call (screen + disabled + trailing),
    // not an accidental match on some other self-closing tag.
    expect(callMatch![0]).toContain('screen="mixer"');
    expect(callMatch![0]).toContain('trailing=');
  });

  it('the call passes neither `optimizerSlot` nor `hideAudioRow` — docs/63 §5 pin 8: mixer.tsx is not edited this wave, so CPCControls must render byte-identical with both props defaulting to undefined/false', () => {
    expect(callMatch).not.toBeNull();
    expect(callMatch![0]).not.toMatch(/\boptimizerSlot\s*=/);
    expect(callMatch![0]).not.toMatch(/\bhideAudioRow\s*=/);
  });
});

describe('§3.1 — both deck-only props are declared OPTIONAL on CPCControlsProps', () => {
  const propsBlock = CPC_CODE.match(/interface CPCControlsProps \{[\s\S]*?\n\}/);

  it('the CPCControlsProps interface is captured (scanner is not vacuous)', () => {
    expect(propsBlock).not.toBeNull();
    expect(propsBlock![0]).toContain('trailing?:');
  });

  it('`optimizerSlot` is declared with the optional-prop `?:` marker — a required prop would break every existing (deck AND mixer) call site that omits it', () => {
    expect(propsBlock).not.toBeNull();
    expect(propsBlock![0]).toMatch(/optimizerSlot\?\s*:\s*React\.ReactNode/);
  });

  it('`hideAudioRow` is declared with the optional-prop `?:` marker, same reasoning', () => {
    expect(propsBlock).not.toBeNull();
    expect(propsBlock![0]).toMatch(/hideAudioRow\?\s*:\s*boolean/);
  });
});

describe('§3.1 — row 2 (AUDIO SIGNALS) and its <AudioPlotPicker> modal are gated on the SAME condition', () => {
  // docs/63 §3.1: "row 2 (meters + picker button + picker modal) not
  // rendered" when hideAudioRow is true. If the row and the modal were ever
  // gated on two different expressions, a future edit to one and not the
  // other could leave the picker modal mounted (and openable) over a row
  // the operator believes is hidden.
  it('row 2\'s outer <View> is gated on `!hideAudioRow ?`', () => {
    expect(CPC_CODE).toMatch(/\{!hideAudioRow \? \(\s*\n\s*<View/);
  });

  it('the <AudioPlotPicker> element is gated on the identical `!hideAudioRow ?` condition', () => {
    expect(CPC_CODE).toMatch(/\{!hideAudioRow \? \(\s*\n\s*<AudioPlotPicker/);
  });

  it('no OTHER condition (e.g. a negated/differently-spelled variant) gates either the row or the modal — both gates use the literal `!hideAudioRow` token', () => {
    // Guards against a drift like `hideAudioRow !== true` on one side and
    // `!hideAudioRow` on the other — behaviourally close, but two sources of
    // truth is exactly the split this pin exists to prevent.
    const gateHits = CPC_CODE.match(/\{!hideAudioRow \? \(/g) ?? [];
    expect(gateHits.length).toBe(2);
  });

  it('the hook backing the AUDIO row selection (`useAudioPlotSelection`) stays unconditional — only JSX is gated, not the hook call (rules of hooks; docs/63 §3.1 "AsyncStorage selection is untouched")', () => {
    // The hook call itself must NOT sit inside the `!hideAudioRow` gate —
    // i.e. it must not appear on a line following the gate before the row's
    // <View>. Simplest robust check: the hook call exists exactly once, and
    // it is NOT inside the captured row-gate JSX (the row gate match starts
    // at the View, not the hook, by construction of the regex above — this
    // extra check guards against a future refactor that inlines the hook
    // call into the gated block).
    const hookHits = CPC_CODE.match(/const \[audioSelected, setAudioSelected\] = useAudioPlotSelection\(screen\);/g) ?? [];
    expect(hookHits.length).toBe(1);
    const hookIndex = CPC_CODE.indexOf('const [audioSelected, setAudioSelected] = useAudioPlotSelection(screen);');
    const firstGateIndex = CPC_CODE.indexOf('{!hideAudioRow ? (');
    expect(hookIndex).toBeGreaterThan(-1);
    expect(firstGateIndex).toBeGreaterThan(-1);
    expect(hookIndex).toBeLessThan(firstGateIndex);
  });
});

describe('§3.1 — `optimizerSlot` renders conditionally: nothing emitted when undefined', () => {
  it('the slot is interpolated as a bare `{optimizerSlot}` expression — React skips undefined/null children, so this alone satisfies "renders nothing, no wrapper" for the mixer\'s undefined case', () => {
    expect(CPC_CODE).toMatch(/\n\s*\{optimizerSlot\}\s*\n/);
  });

  it('the slot is NOT wrapped in an always-rendered <View> or fragment — that would add a real child node (and, given the outer View\'s `gap`, phantom vertical space) even when optimizerSlot is undefined', () => {
    expect(CPC_CODE).not.toMatch(/<View[^>]*>\s*\{optimizerSlot\}/);
    expect(CPC_CODE).not.toMatch(/<>\s*\{optimizerSlot\}/);
    expect(CPC_CODE).not.toMatch(/\{optimizerSlot\s*\?\s*</); // not re-wrapped in its own ternary either
  });

  it('the slot sits between row 1 (GLOBALS) and row 2 (AUDIO) in source order — after the GLOBALS row\'s closing tag, before the `hideAudioRow` gate', () => {
    const globalsRowLabelIndex = CPC_CODE.indexOf("Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: isPortrait ? 9 : 10, color: C.secondary, textTransform: 'uppercase' }}>GLOBALS</Text");
    const slotIndex = CPC_CODE.indexOf('{optimizerSlot}');
    const audioGateIndex = CPC_CODE.indexOf('{!hideAudioRow ? (');
    expect(globalsRowLabelIndex).toBeGreaterThan(-1);
    expect(slotIndex).toBeGreaterThan(-1);
    expect(audioGateIndex).toBeGreaterThan(-1);
    expect(slotIndex).toBeGreaterThan(globalsRowLabelIndex);
    expect(slotIndex).toBeLessThan(audioGateIndex);
  });
});

describe('the scanner itself works', () => {
  it('reads real, non-trivial source files', () => {
    expect(CPC_SOURCE.length).toBeGreaterThan(10000);
    expect(MIXER_SOURCE.length).toBeGreaterThan(10000);
  });

  it('strips comments so prose in this very file cannot self-trip a ban', () => {
    expect(stripComments('// optimizerSlot={foo}\ncode()')).not.toContain('optimizerSlot');
    expect(stripComments('/* hideAudioRow */\ncode()')).not.toContain('hideAudioRow');
  });
});
