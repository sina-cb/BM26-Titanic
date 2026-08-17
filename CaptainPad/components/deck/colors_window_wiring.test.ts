// colors_window_wiring.test.ts — source-text guards for the W2 slice of
// docs/61_colors_interaction_model.md (the COLORS window's yield/strip/scheme
// wiring). vitest cannot render `colors_window.tsx` (react-native + the
// config's globs admit pure `.ts` under `components/**` only), so this file
// follows the same idiom as `components/no_raw_alerts.test.ts`: read the real
// source as text and assert the contract holds, rather than trust it to a
// code review. Every behavioural rule these regexes check has already been
// proven correct in isolation by `colors_window_logic.test.ts` (W1) — this
// file only proves `colors_window.tsx` (W2) actually WIRES to it the way the
// contract says.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(HERE, 'colors_window.tsx');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');
const LINES = SOURCE.split('\n');

/** Strip line and block comments so prose mentioning a banned token (this
 *  very docblock, for instance) cannot trip a scan. Same crude-but-sufficient
 *  approach as `no_raw_alerts.test.ts`. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const CODE = stripComments(SOURCE);

describe('_217 no-timer rule (docs/61 §6 — grep-gated)', () => {
  it('adds no setInterval to colors_window.tsx', () => {
    expect(CODE).not.toMatch(/\bsetInterval\s*\(/);
  });

  it('adds no requestAnimationFrame to colors_window.tsx', () => {
    expect(CODE).not.toMatch(/\brequestAnimationFrame\s*\(/);
  });

  it('the one-shot setTimeout idioms (say/scheme-flash) are still the only timers', () => {
    // Not a ban — `_217` permits one-shot setTimeout (the message line and
    // the scheme flash). This just proves the scan sees real matches so an
    // empty regex is not silently passing both tests above.
    expect(CODE).toMatch(/\bsetTimeout\s*\(/);
  });
});

describe('W1 signature repair (docs/61 §8 W1→W2 handoff)', () => {
  it('no call site still uses the retired manualWriteGate(disabled, rotationDriving) form', () => {
    expect(CODE).not.toMatch(/manualWriteGate\(\s*disabled,\s*rotationDriving\s*\)/);
  });

  it('no schemeTapOutcome call is missing the surface argument (the old 2-arg form)', () => {
    // The old broken call closed its parens right after `title`:
    // `schemeTapOutcome(rotationKind(...), title)`. The repaired call reads
    // `..., title, mode)`, so this pattern (title followed immediately by a
    // closing paren) must not exist anywhere in the file.
    expect(CODE).not.toMatch(/schemeTapOutcome\(\s*rotationKind\([^)]*\),\s*title\)/);
  });
});

describe('§5 C3 fix — scheme taps carry the current card as `surface`', () => {
  it('schemeTapOutcome is called with `mode` (the visible card) as its third argument', () => {
    expect(CODE).toMatch(/schemeTapOutcome\(\s*rotationKind\([^)]*\),\s*title,\s*mode\)/);
  });
});

describe('§2.1 YIELD rule — exactly one L1 (card-switch) gesture', () => {
  it("yieldDecision({ gesture: 'card', ... }) appears exactly once", () => {
    const hits = CODE.match(/yieldDecision\(\{\s*gesture:\s*'card'/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it('the mode-card taps route through goCard, not a bare setMode', () => {
    // The three ModeButton onPress handlers must call `goCard(...)`, the one
    // function that runs `yieldDecision` before ever touching `mode` — a
    // regression back to `() => setMode('two')` would silently drop L1 yield.
    expect(CODE).toMatch(/onPress=\{\(\)\s*=>\s*goCard\('two'\)\}/);
    expect(CODE).toMatch(/onPress=\{\(\)\s*=>\s*goCard\('turns'\)\}/);
    expect(CODE).toMatch(/onPress=\{\(\)\s*=>\s*goCard\('follow'\)\}/);
  });
});

describe('§2.1 mechanics — the yield/STOP body is the byte-exact bare stop', () => {
  it('the file posts the literal `{ active: false }` body', () => {
    expect(CODE).toContain('{ active: false }');
  });

  it('no onColorAutopilotChange call carrying the bare stop also carries mode: or followNote:', () => {
    // Every yield/STOP call site sends EITHER the literal `{ active: false }`
    // object OR `d.post` (yieldDecision's own bare-stop return, pinned by the
    // W1 suite). Neither call form may be caught reaching for `mode:` or
    // `followNote:` — that would turn a freeze-in-place stop into a takeover.
    const hits: string[] = [];
    LINES.forEach((line, i) => {
      if (/onColorAutopilotChange\(\s*(\{\s*active:\s*false\s*\}|d\.post)/.test(line)) {
        // A generous ±2 line window catches a call that wraps, without
        // reaching far enough to cross into an unrelated statement.
        const window = LINES.slice(Math.max(0, i - 2), i + 3).join('\n');
        if (/\b(mode|followNote)\s*:/.test(window)) hits.push(`line ${i + 1}: ${line.trim()}`);
      }
    });
    expect(hits.join('\n')).toBe('');
  });

  it('at least one bare-stop call site exists to test (the scanner is not vacuous)', () => {
    const count = (CODE.match(/onColorAutopilotChange\(\s*(\{\s*active:\s*false\s*\}|d\.post)/g) ?? []).length;
    expect(count).toBeGreaterThan(0);
  });
});

describe('§4.1 the DRIVING STRIP', () => {
  it('drivingStripModel is called with three arguments: kind, the visible card, and the broadcast', () => {
    expect(CODE).toMatch(/drivingStripModel\(\s*kind,\s*mode,\s*\{/);
  });

  it('the strip container carries testID="colors-driving-strip"', () => {
    expect(SOURCE).toContain('testID="colors-driving-strip"');
  });

  it('the STOP button carries testID="colors-driving-stop"', () => {
    expect(SOURCE).toContain('testID="colors-driving-stop"');
  });

  it('the strip is gated on stripModel.show, never on the retired rotationDriving banner', () => {
    expect(CODE).toMatch(/\{stripModel\.show\s*\?/);
    // The old banner's exact condition must be gone — `rotationDriving` may
    // still legitimately appear elsewhere (the FOLLOW NOTE card's own
    // "replaces it" footnote), so this checks the specific retired form
    // rather than banning the identifier outright.
    expect(CODE).not.toMatch(/\{rotationDriving\s*\?\s*\(/);
  });
});

describe('§4.3/D6 entry auto-select — armed-one-shot fires on first usable truth', () => {
  // W5 validation found C7 still open: on a COLD OPEN the window mounts
  // before `colorAutopilot` is seeded, so `kind` is 'none' at the exact
  // moment `visible` flips true and the OLD single-fire-on-transition effect
  // burned its one shot on nothing. The fix arms on the transition and fires
  // on the first later render with a usable `kind`, so the effect must now
  // legitimately depend on `kind` too — no longer `[visible]` alone.
  it('an `armed`-style ref exists alongside the visible-transition ref', () => {
    expect(CODE).toMatch(/const\s+armedRef\s*=\s*useRef(?:<boolean>)?\(false\)/);
    expect(CODE).toMatch(/const\s+wasVisibleRef\s*=\s*useRef(?:<boolean>)?\(false\)/);
  });

  it('the auto-select effect depends on `kind` (not just `visible`), so it can fire late', () => {
    expect(CODE).toMatch(/\},\s*\[visible,\s*kind,\s*onCardChange\]\);/);
  });

  it('cardForKind gates the fire so palette-set (no owning card) never forces a jump', () => {
    expect(CODE).toMatch(/cardForKind\(kind\)/);
  });

  it('a false→true visible transition arms the one-shot rather than firing it directly', () => {
    expect(CODE).toMatch(/if\s*\(visible\s*&&\s*!wasVisibleRef\.current\)\s*armedRef\.current\s*=\s*true;/);
  });

  it('firing disarms the one-shot (armedRef is cleared when the card is set)', () => {
    expect(CODE).toMatch(/armedRef\.current\s*=\s*false;\s*\n\s*setMode\(card\);/);
  });
});

describe('§4.3/D6 — goCard disarms the entry one-shot on an operator pick', () => {
  const goCardMatch = CODE.match(/const goCard = useCallback\(\(next: Mode\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/);

  it('goCard clears armedRef before/without ever re-arming it', () => {
    expect(goCardMatch).not.toBeNull();
    expect(goCardMatch![0]).toMatch(/armedRef\.current\s*=\s*false;/);
  });

  // W5 residual: disarming AFTER the same-card early return means a tap on
  // the already-selected card (or an operator who never touches the
  // selector) leaves the one-shot armed indefinitely, so a family that arms
  // itself later can still yank his parked selection. The disarm must
  // precede the `next === mode` early return, not follow it.
  it('armedRef is disarmed BEFORE the same-card early return, not after', () => {
    expect(goCardMatch).not.toBeNull();
    const body = goCardMatch![0];
    const disarmAt = body.indexOf('armedRef.current = false;');
    const earlyReturnAt = body.indexOf('if (next === mode) return;');
    expect(disarmAt).toBeGreaterThan(-1);
    expect(earlyReturnAt).toBeGreaterThan(-1);
    expect(disarmAt).toBeLessThan(earlyReturnAt);
  });
});

describe('§6 C4 fix — the crossfade card goes inert under follow-note', () => {
  it('a followInert flag exists and is derived from kind, not a local guess', () => {
    expect(CODE).toMatch(/followInert\s*=\s*kind\s*===\s*'follow-note'/);
  });

  it('the inert explanatory line names the strip as the driver', () => {
    expect(SOURCE).toContain('FOLLOW NOTE is driving — the blend has no endpoints while the music picks the hue.');
  });
});

describe('§5 row 1 — takeover messages name the loser', () => {
  it('every rotation-starting call captures prevKind before posting', () => {
    const hits = CODE.match(/const prevKind = kind;/g) ?? [];
    // startTurns, runCrossfade, startFollowNote.
    expect(hits.length).toBe(3);
  });

  it('takeoverNote is invoked for all three starters with the kind each one starts', () => {
    expect(CODE).toMatch(/takeoverNote\(prevKind,\s*'follow-note'\)/);
    expect(CODE).toMatch(/takeoverNote\(prevKind,\s*'turns'\)/);
    expect(CODE).toMatch(/takeoverNote\(prevKind,\s*'crossfade'\)/);
  });
});

describe('_279 render cost — the window re-renders at the broadcast rate', () => {
  // WHY THESE ARE GREP GUARDS. While a colour autopilot tweens, the engine
  // rewrites colorPalette1/2 every 40 ms, this window mirrors those into
  // `h1`/`h2`, and so its whole body re-runs ~25 times a second. That is by
  // design — the dial follows the rig. What is NOT affordable is doing
  // operator-speed work at broadcast speed, which is what the operator felt as
  // lag on the PALETTE TURNS card. Every rule below is a specific way that
  // regressed once; none of them is provable by rendering, because vitest
  // cannot render this file (see the header docblock).

  it('the scheme row does not regenerate its nine faces inside the JSX', () => {
    // `colours={generateScheme(id, baseHue)}` ran nine generators and built 45
    // swatches per render. The faces come from the `schemeFaces` memo now.
    expect(CODE).not.toMatch(/colours=\{generateScheme\(/);
    expect(CODE).toMatch(/const schemeFaces = useMemo\(/);
  });

  it('the dial gets stable handler identities, not fresh arrows per render', () => {
    expect(CODE).toMatch(/onArm=\{onWheelArm\}/);
    expect(CODE).toMatch(/onDragEnd=\{onWheelDragEnd\}/);
    // The retired forms: either one made `HueWheel`'s memo useless.
    expect(CODE).not.toMatch(/onArm=\{\(i\)\s*=>/);
    expect(CODE).not.toMatch(/onDragEnd=\{\(\)\s*=>/);
  });

  it('the dial gets stable ARRAY identities for hues and labels', () => {
    // `hues={[h1, h2]}` / `labels={['A','B']}` rebuilt both arrays every render.
    expect(CODE).toMatch(/const turnHues = useMemo\(/);
    expect(CODE).toMatch(/const pairHues = useMemo\(/);
    expect(CODE).toMatch(/PAIR_WHEEL_LABELS/);
    expect(CODE).toMatch(/TURNS_WHEEL_LABELS/);
  });

  it('setSlot does not close over the live hues', () => {
    // Closing over `h1`/`h2` gave setSlot — and loadIntoArmed, loadPair and
    // loadPreset downstream of it — a new identity on every broadcast frame,
    // which defeated every memo below it.
    expect(CODE).toMatch(/const setSlot = useCallback\([\s\S]*?\},\s*\[writeThrottled,\s*writeNow\]\);/);
  });

  it('the per-item children of the hot lists are memoized', () => {
    for (const name of ['SlotButton', 'SchemeButton', 'SwatchChip', 'PresetChip']) {
      expect(CODE).toMatch(new RegExp(`const ${name} = React\\.memo\\(function ${name}`));
    }
  });

  it('the memoized list children take an id/index back instead of a fresh closure', () => {
    // A `() => onSchemeTap(id)` at the call site is a new prop every render and
    // silently un-memoizes the child it is passed to.
    expect(CODE).toMatch(/onPress=\{onSchemeTap\}/);
    expect(CODE).toMatch(/onPress=\{setArmedTurn\}/);
    expect(CODE).toMatch(/onPress=\{setArmedTwo\}/);
  });

  it('the TWO COLOUR strips are not derived while another card is showing', () => {
    // 27 colour strings per frame for two strips that were not mounted.
    expect(CODE).toMatch(/const showPairStrips = mode === 'two'/);
    expect(CODE).toMatch(/if \(!showPairStrips\) return NO_STRIP;/);
  });

  it('the live-touch badge comparison list is built once, not once per chip', () => {
    // The TURNS side used to call `turnDraft.map(...)` INSIDE the chip loop.
    expect(CODE).toMatch(/const turnPins = useMemo\(/);
    expect(CODE).not.toMatch(/slotIndexFor\(sw\.c, pairSurface \?/);
  });

  it('the dial component itself is memoized', () => {
    const wheel = readFileSync(join(HERE, 'hue_wheel.tsx'), 'utf8');
    expect(stripComments(wheel)).toMatch(/export const HueWheel = React\.memo\(function HueWheel/);
  });
});

describe('the scanner itself works', () => {
  it('reads a real, non-trivial source file', () => {
    expect(SOURCE.length).toBeGreaterThan(10000);
  });

  it('strips comments so prose in this very file cannot self-trip a ban', () => {
    expect(stripComments('// setInterval(x, 1)\ncode()')).not.toContain('setInterval');
    expect(stripComments('/* requestAnimationFrame(x) */\ncode()')).not.toContain('requestAnimationFrame');
  });
});
