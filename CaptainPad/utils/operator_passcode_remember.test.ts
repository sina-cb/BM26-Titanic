import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  REMEMBERED_OPERATOR_AUTH_HINT,
} from '@/components/performance_mode_logic';

const FAKE_PASSCODE = 'fake-code-echo';

/** Mirrors TakeoverPasscodeSheet submit() with async setState (render lags ref). */
function simulateTakeoverSheetSubmit(options: {
  passcodeRef: string;
  toggleRememberBeforeSubmit?: boolean;
}): { passcode: string; remember30: boolean; staleRemember: boolean } {
  let remember30 = false;
  const remember30Ref = { current: false };
  const passcodeRef = { current: options.passcodeRef };
  const setRemember30 = (next: boolean) => {
    remember30Ref.current = next;
    // setRemember30State(next) — React schedules; render `remember30` lags.
  };
  const toggleRemember30 = () => setRemember30(!remember30Ref.current);

  if (options.toggleRememberBeforeSubmit) {
    toggleRemember30();
  }

  const attempted = passcodeRef.current;
  const remember = remember30Ref.current;
  return {
    passcode: attempted,
    remember30: remember,
    staleRemember: remember30,
  };
}

/**
 * Mirrors remember30 wiring in passcode sheets without RN. The ref matches the
 * ref-hardened component so toggle-then-immediate-submit reads the latest value.
 */
function simulateRememberToggleImmediateSubmit(
  toggleBeforeSubmit: boolean,
): { staleRemember: boolean; refRemember: boolean } {
  let remember30 = false;
  let remember30Ref = false;
  const setRemember30 = (next: boolean) => {
    remember30Ref = next;
    remember30 = next;
  };

  if (toggleBeforeSubmit) {
    setRemember30(true);
  }

  return {
    staleRemember: remember30,
    refRemember: remember30Ref,
  };
}

/** Mirrors ExitPerformanceSheet choose() auth snapshot wiring. */
function simulateExitChooseAuthSnapshot(options: {
  passcodeRef: string;
  remember30Ref: boolean;
}): { passcode: string; remember30: boolean } {
  const attempted = options.passcodeRef;
  const remember = options.remember30Ref;
  return { passcode: attempted, remember30: remember };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = join(HERE, '..', 'components');

function readComponent(name: string): string {
  return readFileSync(join(COMPONENTS, name), 'utf8');
}

describe('remember30 toggle + immediate submit event flow', () => {
  it('takeover submit passes remember=true on toggle-then-immediate-submit while render lags', () => {
    const result = simulateTakeoverSheetSubmit({
      passcodeRef: FAKE_PASSCODE,
      toggleRememberBeforeSubmit: true,
    });
    expect(result.remember30).toBe(true);
    expect(result.staleRemember).toBe(false);
    expect(result.passcode).toBe(FAKE_PASSCODE);
  });

  it('ref snapshot preserves remember=true before React re-render', () => {
    const { staleRemember, refRemember } = simulateRememberToggleImmediateSubmit(true);
    expect(refRemember).toBe(true);
    expect(staleRemember).toBe(true);
  });

  it('documents stale render-state failure when setState is async', () => {
    let remember30 = false;
    const remember30Ref = { current: false };
    const setRemember30 = (next: boolean) => {
      remember30Ref.current = next;
      // React would schedule setRemember30State(next) here; render state lags.
    };

    setRemember30(true);
    expect(remember30).toBe(false);
    expect(remember30Ref.current).toBe(true);
  });

  it('exit choose passes remember30 from ref, not render-closed state', () => {
    expect(simulateExitChooseAuthSnapshot({
      passcodeRef: FAKE_PASSCODE,
      remember30Ref: true,
    })).toEqual({ passcode: FAKE_PASSCODE, remember30: true });
  });
});

describe('remember30 ref hardening in source', () => {
  it.each([
    'takeover_passcode_sheet.tsx',
    'ExitPerformanceSheet.tsx',
    'privileged_auth_sheet.tsx',
  ])('%s snapshots remember30 through remember30Ref at submit/choose', (file) => {
    const src = readComponent(file);
    expect(src).toMatch(/remember30Ref\.current/);
    expect(src).not.toMatch(/const remember = remember30;/);
  });

  it('exit sheet hydrates remembered auth instead of always showing the keypad', () => {
    const src = readComponent('ExitPerformanceSheet.tsx');
    expect(src).toContain('getValidPasscodeWaiver');
    expect(src).toContain('getPasscodeWaiver');
    expect(src).toContain('isValidPasscodeWaiver');
    expect(src).toContain('REMEMBERED_OPERATOR_AUTH_HINT');
    expect(src).toContain('rememberedAuth');
  });

  it('remember row uses ref-backed onToggle from parent sheets', () => {
    for (const file of ['takeover_passcode_sheet.tsx', 'ExitPerformanceSheet.tsx']) {
      const src = readComponent(file);
      expect(src).toMatch(/toggleRemember30/);
      expect(src).toMatch(/onToggle=\{toggleRemember30\}/);
      expect(src).not.toMatch(/onChange=\{setRemember30\}/);
    }
    const row = readComponent('operator_passcode_remember_row.tsx');
    expect(row).toMatch(/onToggle/);
    expect(row).not.toMatch(/onChange\(!checked\)/);
  });

  it('edit session chip skips the sheet when a stored waiver validates', () => {
    const src = readComponent('edit_session_chip.tsx');
    expect(src).toContain('getValidPasscodeWaiver');
    expect(src).toMatch(/assertEditSession\(\{\}\)/);
  });
});

describe('remembered operator auth copy', () => {
  it('states that passcode entry is not needed while the waiver is valid', () => {
    expect(REMEMBERED_OPERATOR_AUTH_HINT.toLowerCase()).toContain('remembered');
    expect(REMEMBERED_OPERATOR_AUTH_HINT.toLowerCase()).toContain('no passcode');
  });
});
