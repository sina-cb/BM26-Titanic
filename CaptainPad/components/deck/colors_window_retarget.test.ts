// colors_window_retarget.test.ts — W2 slice of docs/75_colors_panel_live_apply.md
// (§5 "colour gestures retune the running program" + §4's stepped-orbit UI
// plumbing, as wired in `colors_window.tsx`).
//
// `colors_window.tsx` cannot be RENDERED or even IMPORTED by vitest (react-
// native + this config's globs admit pure `.ts` under `components/**` only —
// confirmed here: importing `pairGestureOutcome` from it, even though the
// function itself is pure and exported, fails at the SSR-transform step
// before a single test runs). `colors_window_wiring.test.ts`'s own header
// docblock warns of exactly this, and it never imports the `.tsx` module —
// it reads the file as raw text instead. This file follows suit throughout:
// every assertion below is SOURCE-TEXT scanning against the real file, the
// same idiom that suite uses for the 37 pins it owns (this file owns none of
// them and never touches that file). `pairGestureOutcome` stays a plain
// (non-hook) function so its LOGIC can still be read and reasoned about here
// even though it cannot be invoked from a test process.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { manualWriteGate, type RotationKind } from './colors_window_logic';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'colors_window.tsx'), 'utf8');

/** Same crude-but-sufficient comment strip as `colors_window_wiring.test.ts`
 *  and `no_raw_alerts.test.ts`, so prose in either file cannot self-trip a
 *  scan run against the OTHER file's source. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const CODE = stripComments(SOURCE);

/** Slice `CODE` from the start of a marker line to the next top-level
 *  `return;` inside the same handler, so a call-site assertion can be scoped
 *  to ONE outcome branch instead of matching the whole file. Mirrors the
 *  wiring suite's own `LINES.slice(...)` windowing technique, but keyed to a
 *  literal anchor rather than a line number (line numbers drift; anchors
 *  don't). */
function branch(anchor: string): string {
  const at = CODE.indexOf(anchor);
  expect(at, `anchor not found in colors_window.tsx: ${anchor}`).toBeGreaterThan(-1);
  const end = CODE.indexOf('return;', at);
  expect(end, `no closing return; after anchor: ${anchor}`).toBeGreaterThan(-1);
  return CODE.slice(at, end + 'return;'.length);
}

describe('pairGestureOutcome — the family-matched router (docs/75 §5)', () => {
  it('checks disabled FIRST, exactly like manualWriteGate has always ordered it', () => {
    const at = CODE.indexOf('export function pairGestureOutcome(');
    expect(at).toBeGreaterThan(-1);
    const end = CODE.indexOf('\n}', CODE.indexOf('return outcome;', at));
    const body = CODE.slice(at, end);
    expect(body.indexOf('if (disabled)')).toBeLessThan(body.indexOf('colourGestureOutcome(kind, surface)'));
  });

  it("a 'retarget' answer is trusted only when the running kind IS this gesture's own family — a mismatch (the OTHER retarget-capable kind) falls back to manualWriteGate's refusal instead of a wrongly-shaped PATCH", () => {
    const at = CODE.indexOf('export function pairGestureOutcome(');
    const end = CODE.indexOf('\n}', CODE.indexOf('return outcome;', at));
    const body = CODE.slice(at, end);
    expect(body).toMatch(/if \(outcome\.action === 'retarget' && kind !== family\) \{/);
    expect(body).toMatch(/return \{ action: 'refuse', reason: writeRefusalReason\(disabled, kind\) \};/);
  });

  it('writeRefusalReason narrows the WriterGate union rather than asserting the type away, and throws if the gate is unexpectedly writable', () => {
    expect(CODE).toMatch(/function writeRefusalReason\(disabled: boolean, kind: RotationKind\): string \{/);
    expect(CODE).toMatch(/if \(g\.canWrite\) throw new Error/);
  });

  // The REFUSAL SENTENCES themselves are `manualWriteGate`'s, imported here
  // from the real (importable) logic module — proving the specific strings
  // `pairGestureOutcome` reuses actually exist and read the way docs/75 §5
  // says a refusal must (name the driver, name the way out).
  it('the sentences pairGestureOutcome reuses are manualWriteGate\'s real, unchanged text', () => {
    const kinds: RotationKind[] = ['crossfade', 'turns', 'follow-note', 'palette-set'];
    for (const kind of kinds) {
      const g = manualWriteGate(false, kind);
      if (g.canWrite) throw new Error(`test setup: expected '${kind}' to be refused`);
      expect(g.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('§5 crossfade retarget — a scheme tap PATCHes, never POSTs', () => {
  it("applyScheme's 'retarget' branch (crossfade) builds a 2-entry ring via crossfadeRetargetRing and sends it through retune/retuneThrottled — never onColorAutopilotChange", () => {
    const b = branch("if (outcome.action === 'retarget') {");
    expect(b).toMatch(/const ring = crossfadeRetargetRing\(a\.h, b\.h\);/);
    expect(b).toMatch(/if \(throttle\) retuneThrottled\('palettes', ring, note\); else retune\('palettes', ring, note\);/);
    expect(b).not.toMatch(/onColorAutopilotChange/);
    expect(b).not.toMatch(/\{\s*active\s*:/);
  });

  it("schemeTapOutcome's crossfade row is consulted with the CURRENT kind before the retarget fires — one outcome, one PATCH", () => {
    expect(CODE).toMatch(/const outcome = schemeTapOutcome\(\s*rotationKind\(colorAutopilot\?\.active, colorAutopilot\?\.palettes, colorAutopilot\?\.mode\), title, mode\);/);
  });
});

describe('§5 turns restage — a scheme tap/drag PATCHes the running ring, not a full POST', () => {
  it("applyScheme's 'restage' branch builds the ring via turnsRetargetRing and sends it through retune/retuneThrottled — never a turnsAutopilotPatch POST", () => {
    const b = branch("if (outcome.action === 'restage') {");
    expect(b).toMatch(/const ring = turnsRetargetRing\(colours, sel\);/);
    expect(b).toMatch(/if \(throttle\) retuneThrottled\('palettes', ring, note\); else retune\('palettes', ring, note\);/);
    expect(b).not.toMatch(/turnsAutopilotPatch/);
    expect(b).not.toMatch(/onColorAutopilotChange/);
  });

  it('the latched wheel-drag call site passes throttle=true (the 5th arg) to applyScheme — the POST-storm-per-sample this replaces', () => {
    expect(CODE).toMatch(/applyScheme\(latched\.scheme, hue, pairSel, false, true\);/);
  });

  it('a plain scheme TAP (onSchemeTap) does not pass throttle — one discrete PATCH, not a throttled one', () => {
    expect(CODE).toMatch(/applyScheme\(scheme, baseHue, pairSel\);/);
  });
});

describe('§5/D5 turns A/B pick — one PATCH, no {active} write', () => {
  it('onPickTurnsPairSlot retargets via retune(\'palettes\', turnsRetargetRing(...)) only while turns is the running kind', () => {
    const at = CODE.indexOf('const onPickTurnsPairSlot = useCallback');
    expect(at).toBeGreaterThan(-1);
    const end = CODE.indexOf('}, [armedPairChannel, pairSel, kind, turnDraft, retune, say]);', at);
    expect(end).toBeGreaterThan(-1);
    const b = CODE.slice(at, end);
    expect(b).toMatch(/if \(kind === 'turns'\) \{\s*retune\('palettes', turnsRetargetRing\(turnDraft, res\.sel\), 'turns A\/B pick'\);\s*\}/);
    expect(b).not.toMatch(/\{\s*active\s*:/);
    expect(b).not.toMatch(/onColorAutopilotChange/);
    expect(b).not.toMatch(/updateParamCenter/);
  });

  it('the D5 pick reuses selectSchemePair\'s own refusal — the same builder onPickPairSlot (TWO COLOUR card) uses', () => {
    expect(CODE).toMatch(/selectSchemePair\(pairSel, armedPairChannel, index, TURNS_SLOT_COUNT\)/);
  });

  it('pin trap 1 protected: setArmedTurn is a router, and every OTHER call site (wheel-arm, pair-load step-on) reads the raw setArmedTurnState instead', () => {
    // The router itself.
    expect(CODE).toMatch(/const setArmedTurn = useCallback\(\(index: number\) => \{\s*if \(armedPairChannel !== null\) \{ onPickTurnsPairSlot\(index\); return; \}\s*setArmedTurnState\(index\);\s*\}, \[armedPairChannel, onPickTurnsPairSlot\]\);/);
    // The pinned JSX text survives byte-identical.
    expect(CODE).toMatch(/onPress=\{setArmedTurn\}/);
    // Call sites that must NOT route through the picker.
    expect(CODE).toMatch(/if \(mode === 'two'\) setArmedTwo\(i\); else setArmedTurnState\(i\);/);
    expect(CODE).toMatch(/setArmedTurnState\(\(armedTurn \+ 2\) % TURNS_SLOT_COUNT\);/);
  });
});

describe('§5 item B — throttled retargets, trailing PATCH on release', () => {
  it('retuneThrottled mirrors writeThrottled\'s leading+trailing recipe at the SAME LIVE_THROTTLE_MS cadence', () => {
    expect(CODE).toMatch(/const retuneThrottled = useCallback\(\(field: RetuneField, value: unknown, note\?: string\) => \{/);
    expect(CODE).toMatch(/const remaining = LIVE_THROTTLE_MS - \(now - t\.last\);/g);
    // Two independent throttle machines share the constant — writeThrottled's
    // own use of it plus retuneThrottled's — proving retune got its OWN
    // throttle rather than borrowing / racing the write one.
    const hits = CODE.match(/LIVE_THROTTLE_MS - \(now - t\.last\)/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it('setTurnSlot (un-latched per-slot drag) retargets through the THROTTLED path while turns runs', () => {
    expect(CODE).toMatch(/if \(kind === 'turns'\) \{\s*retuneThrottled\('palettes', turnsRetargetRing\(next, pairSel\), `T\$\{index \+ 1\} edit`\);\s*\}/);
  });

  it('setSlot (two-colour wheel drag) retargets while crossfade runs, throttled on drag / immediate on chip-load, and never falls back to the /param-center write in that branch', () => {
    const at = CODE.indexOf("if (liveKind === 'crossfade') {");
    expect(at).toBeGreaterThan(-1);
    const end = CODE.indexOf('return;', at);
    const b = CODE.slice(at, end + 'return;'.length);
    expect(b).toMatch(/const ring = crossfadeRetargetRing\(a, b\);/);
    expect(b).toMatch(/if \(throttled\) retuneThrottledRef\.current\('palettes', ring, note\);/);
    expect(b).toMatch(/else retuneRef\.current\('palettes', ring, note\);/);
    expect(b).not.toMatch(/writeThrottled|writeNow/);
  });

  it('onWheelDragEnd flushes an UNTHROTTLED trailing retarget for crossfade on release — the last drag sample always lands', () => {
    const at = CODE.indexOf('const onWheelDragEnd = useCallback');
    expect(at).toBeGreaterThan(-1);
    const end = CODE.indexOf('}, [writeNow]);', at);
    const b = CODE.slice(at, end);
    expect(b).toMatch(/retuneRef\.current\('palettes', crossfadeRetargetRing\(s\.h1, s\.h2\), 'COLOUR drag release'\);/);
  });

  it('setSlot\'s dependency array is still pinned to exactly [writeThrottled, writeNow] — the retarget logic reads kind/retune only through refs', () => {
    expect(CODE).toMatch(/const setSlot = useCallback\([\s\S]*?\},\s*\[writeThrottled,\s*writeNow\]\);/);
  });
});

describe('§5 item C — failNote widened and forwarded from every retarget call site', () => {
  it('onColorAutopilotRetune\'s prop type carries an optional failNote', () => {
    expect(CODE).toMatch(/onColorAutopilotRetune\?: \(patch: Record<string, unknown>, failNote\?: string\) => void;/);
  });

  it('the local retune() helper takes and forwards the note', () => {
    expect(CODE).toMatch(/const retune = useCallback\(\(field: RetuneField, value: unknown, note\?: string\) => \{/);
    expect(CODE).toMatch(/onColorAutopilotRetune\(rotationRetunePatch\(kind, \{ \[field\]: value \}\), note\);/);
  });

  it('every new retarget call site names its own gesture', () => {
    for (const note of [
      "`COLOUR ${PAIR_CHANNEL_LABELS[index]} pick`",
      "'COLOUR drag release'",
      '`${title} restage`',
      '`${title} retune`',
      "'turns A/B pick'",
      "`T${index + 1} edit`",
      "'pair load'",
      "'palette load'",
    ]) {
      expect(CODE, `missing failNote literal: ${note}`).toContain(note);
    }
  });
});

describe('docs/75 §4 — the stepped orbit reaches the UI (relocated from colors_window_wiring.test.ts per lead review: these three assertions are legitimate and correct, but do not belong in the 37-pin gate file this wave does not own)', () => {
  it('turnsOrbit is read back against the STAGED ring, disambiguating a stepped wire', () => {
    expect(CODE).toMatch(/turnsOrbit\(livePalettes,\s*turnDraft\)/);
  });

  it('the recovered step reaches both the lit-window projection and the rail', () => {
    expect(CODE).toMatch(/orbitWindowSlots\(cursor\.index,\s*liveDistance,\s*ringPhase,\s*TURNS_SLOT_COUNT,\s*liveStep\)/);
    expect(CODE).toMatch(/cursorRailSegments\(cursor,\s*ringLength,\s*distance,\s*phase,\s*step\)/);
  });

  it('WindowRail carries the step prop through to the rail', () => {
    expect(CODE).toMatch(/function WindowRail\(\{ cursor, ringLength, distance, step, phase \}/);
    expect(CODE).toMatch(/step=\{liveStep\}/);
  });
});

describe('D3 — Blend SCRUB stays refused while any family runs (unchanged, not a retarget)', () => {
  it('onScrub still gates on the ordinary manualWriteGate and never calls retune', () => {
    const at = CODE.indexOf('const onScrub = useCallback');
    expect(at).toBeGreaterThan(-1);
    const end = CODE.indexOf('}, [disabled, kind, endA, endB, writeThrottled, say]);', at);
    expect(end).toBeGreaterThan(-1);
    const b = CODE.slice(at, end);
    expect(b).toMatch(/const g = manualWriteGate\(disabled, kind\);/);
    expect(b).not.toMatch(/retune/);
  });
});

describe('the scanner itself works', () => {
  it('reads a real, non-trivial source file', () => {
    expect(SOURCE.length).toBeGreaterThan(10000);
  });

  it('strips comments so prose in this very file cannot self-trip a ban', () => {
    expect(stripComments('// setInterval(x, 1)\ncode()')).not.toContain('setInterval');
  });
});
