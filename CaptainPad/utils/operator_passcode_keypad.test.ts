import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  OPERATOR_PASSCODE_CHARS,
  OPERATOR_PASSCODE_KEYPAD_INSTRUCTION,
  appendOperatorPasscodeChar,
  clearOperatorPasscode,
  deleteOperatorPasscodeChar,
  isOperatorPasscodeChar,
  maskOperatorPasscode,
} from './operator_passcode_keypad';

const MIXED_PLACEHOLDER = 'A1B2C3D4E5F609';

/**
 * Mirrors OperatorPasscodeKeypad + TakeoverPasscodeSheet wiring without RN.
 * The value ref matches the ref-hardened component so rapid taps accumulate.
 */
function simulateOperatorPasscodeEntryFlow(
  chars: readonly string[],
  options?: { submit?: boolean },
): string {
  const submit = options?.submit ?? true;

  let passcode = '';
  let passcodeRef = '';
  const setPasscode = (next: string) => {
    passcodeRef = next;
    passcode = next;
  };

  let valueRef = passcode;
  for (const char of chars) {
    const next = appendOperatorPasscodeChar(valueRef, char);
    valueRef = next;
    setPasscode(next);
  }

  if (!submit) return passcode;
  return passcodeRef;
}

/** Reproduces rapid taps before re-render: every append reads the same stale `value`. */
function simulateStaleKeypadBurst(chars: readonly string[]): string {
  let passcode = '';
  const staleValue = passcode;
  for (const char of chars) {
    passcode = appendOperatorPasscodeChar(staleValue, char);
  }
  return passcode;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = join(HERE, '..', 'components');

function readComponent(name: string): string {
  return readFileSync(join(COMPONENTS, name), 'utf8');
}

describe('operator passcode keypad contract', () => {
  it('declares exactly sixteen allowed characters in A–F then 0–9 order', () => {
    expect(OPERATOR_PASSCODE_CHARS).toEqual([
      'A', 'B', 'C', 'D',
      'E', 'F', '1', '2',
      '3', '4', '5', '6',
      '7', '8', '9', '0',
    ]);
    expect(OPERATOR_PASSCODE_CHARS).toHaveLength(16);
  });

  it('accepts only uppercase hex digits', () => {
    for (const char of OPERATOR_PASSCODE_CHARS) {
      expect(isOperatorPasscodeChar(char)).toBe(true);
    }
    expect(isOperatorPasscodeChar('a')).toBe(false);
    expect(isOperatorPasscodeChar('g')).toBe(false);
    expect(isOperatorPasscodeChar(' ')).toBe(false);
    expect(isOperatorPasscodeChar('')).toBe(false);
    expect(isOperatorPasscodeChar('AB')).toBe(false);
    expect(isOperatorPasscodeChar('-')).toBe(false);
  });

  it('appends allowed characters and rejects everything else', () => {
    expect(appendOperatorPasscodeChar('', 'A')).toBe('A');
    expect(appendOperatorPasscodeChar('A1', 'F')).toBe('A1F');
    expect(appendOperatorPasscodeChar('A1', 'z')).toBe('A1');
    expect(appendOperatorPasscodeChar('A1', ' ')).toBe('A1');
    expect(appendOperatorPasscodeChar('A1', '9')).toBe('A19');
  });

  it('deletes the last character and is a no-op on empty input', () => {
    expect(deleteOperatorPasscodeChar('ABC')).toBe('AB');
    expect(deleteOperatorPasscodeChar('A')).toBe('');
    expect(deleteOperatorPasscodeChar('')).toBe('');
  });

  it('clears the entire value', () => {
    expect(clearOperatorPasscode('ABC123')).toBe('');
    expect(clearOperatorPasscode('')).toBe('');
  });

  it('masks without revealing the value', () => {
    expect(maskOperatorPasscode('')).toBe('');
    expect(maskOperatorPasscode('A1F')).toBe('•••');
    expect(maskOperatorPasscode('A1F')).not.toContain('A');
  });

  it('states the in-app keypad instruction copy', () => {
    expect(OPERATOR_PASSCODE_KEYPAD_INSTRUCTION).toMatch(/keypad/i);
    expect(OPERATOR_PASSCODE_KEYPAD_INSTRUCTION).toMatch(/operator passcode/i);
  });
});

describe('operator passcode keypad component event flow', () => {
  it('submits the exact mixed alphanumeric sequence entered through rapid taps', () => {
    const taps = MIXED_PLACEHOLDER.split('');
    for (const char of taps) {
      expect(isOperatorPasscodeChar(char)).toBe(true);
    }
    expect(simulateOperatorPasscodeEntryFlow(taps)).toBe(MIXED_PLACEHOLDER);
  });

  it('preserves digits when letter keys precede a rapid digit burst', () => {
    expect(simulateOperatorPasscodeEntryFlow(['A', 'B', 'C', '1', '2', '3', '0'])).toBe('ABC1230');
  });

  it('documents the stale-closure failure mode without a value ref', () => {
    expect(simulateStaleKeypadBurst(['A', '1', 'B', '2'])).toBe('2');
    expect(simulateStaleKeypadBurst(['1', '2', '3', '4', '5'])).toBe('5');
    expect(simulateStaleKeypadBurst(MIXED_PLACEHOLDER.split(''))).toBe('9');
  });

  it('uses a passcode ref at submit so the last tap is not dropped before re-render', () => {
    let passcode = 'AB';
    let passcodeRef = 'AB';
    const submitFromRender = () => passcode;
    const submitFromRef = () => passcodeRef;

    passcodeRef = 'AB1';
    expect(submitFromRender()).toBe('AB');
    expect(submitFromRef()).toBe('AB1');
  });
});

describe('operator passcode keypad ref hardening in source', () => {
  it('keypad reads the latest value through a ref before append/delete/clear', () => {
    const src = readComponent('operator_passcode_keypad.tsx');
    expect(src).toMatch(/valueRef\.current/);
    expect(src).not.toMatch(/appendOperatorPasscodeChar\(value,/);
  });

  it('passcode sheets snapshot submit through passcodeRef and remember30Ref', () => {
    for (const file of ['takeover_passcode_sheet.tsx', 'ExitPerformanceSheet.tsx']) {
      const src = readComponent(file);
      expect(src).toMatch(/passcodeRef\.current/);
      expect(src).toMatch(/remember30Ref\.current/);
      expect(src).not.toMatch(/const attempted = passcode;/);
      expect(src).not.toMatch(/const remember = remember30;/);
    }
  });
});

describe('operator passcode sheets use the reusable keypad', () => {
  it.each([
    'takeover_passcode_sheet.tsx',
    'ExitPerformanceSheet.tsx',
  ])('%s wires OperatorPasscodeKeypad and has no native passcode TextInput', (file) => {
    const src = readComponent(file);
    expect(src).toContain('OperatorPasscodeKeypad');
    expect(src).not.toMatch(/\bTextInput\b/);
    expect(src).not.toMatch(/\bautoFocus\b/);
    expect(src).not.toMatch(/\bsecureTextEntry\b/);
    expect(src).not.toMatch(/\bonChangeText=\{setPasscode\}/);
  });
});
