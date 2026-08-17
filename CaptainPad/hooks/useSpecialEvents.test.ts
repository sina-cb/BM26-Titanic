// useSpecialEvents' action layer: the ARM passcode gate, honest refusals, and
// the storage audit.
//
// These drive the REAL functions the tab calls (exported as runArmShow /
// runFireStage / … so vitest can run them in plain node), not a parallel
// re-implementation.
//
// What is pinned:
//   * ARM is a takeover, so performance mode asks for a FRESH passcode EVERY
//     time (operator ruling 2026-08-14) — prompt before any request, nothing
//     remembered between attempts, cancel costs nothing.
//   * A 409 out-of-order fire surfaces the engine's own sentence and re-reads
//     the engine's real stage — the UI never keeps the operator's guess.
//   * Nothing engine-owned is persisted anywhere.
//
// P0: placeholder passcodes only — no credential material lives in this repo.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/engineEvents', () => ({
  engineEvents: {
    subscribe: () => () => undefined,
    subscribeStatus: () => () => undefined,
  },
}));

// The two leaf transport modules, stubbed so the REAL special_events_api can be
// imported (for its refusal copy) without dragging in config.yaml / RN.
vi.mock('@/utils/apiBase', () => ({
  api_base: 'http://engine.test',
  getApiBase: () => 'http://engine.test',
  getApiBaseAsync: async () => 'http://engine.test',
}));
vi.mock('@/utils/api', () => ({
  fetchWithTimeout: async () => { throw new Error('no request should reach the network here'); },
}));

const performanceMode = { active: false };
vi.mock('@/hooks/usePerformanceMode', () => ({
  getPerformanceModeState: () => performanceMode,
}));

type Result = { ok: boolean; status?: number; error?: string; code?: string; data?: unknown };

const armSpecialEvent = vi.fn(async (_show: string, _passcode?: string): Promise<Result> => ({ ok: true, status: 200 }));
const fireSpecialEventStage = vi.fn(async (_stageId: string, _choiceId?: string): Promise<Result> => ({ ok: true, status: 200 }));
const fireSpecialEventQuickEffect = vi.fn(async (_effectId: string): Promise<Result> => ({ ok: true, status: 200 }));
const dismissSpecialEvent = vi.fn(async (): Promise<Result> => ({ ok: true, status: 200 }));
const extendSpecialEvent = vi.fn(async (): Promise<Result> => ({ ok: true, status: 200 }));
const finishSpecialEvent = vi.fn(async (): Promise<Result> => ({ ok: true, status: 200 }));
const abortSpecialEvent = vi.fn(async (): Promise<Result> => ({ ok: true, status: 200 }));
/** What a re-read finds: the engine's REAL stage, whatever the operator hoped. */
const fetchSpecialEventsState = vi.fn(async () => ({
  ok: true,
  data: {
    status: 'running',
    currentStageId: 'tease',
    armedStageId: 'blackout',
    catalog: { shows: [], errors: [] },
  },
}));

vi.mock('@/utils/special_events_api', async () => {
  const actual = await vi.importActual<typeof import('@/utils/special_events_api')>(
    '@/utils/special_events_api',
  );
  return {
    ...actual,
    armSpecialEvent: (show: string, passcode?: string) => armSpecialEvent(show, passcode),
    fireSpecialEventStage: (s: string, c?: string) => fireSpecialEventStage(s, c),
    fireSpecialEventQuickEffect: (e: string) => fireSpecialEventQuickEffect(e),
    extendSpecialEvent: () => extendSpecialEvent(),
    finishSpecialEvent: () => finishSpecialEvent(),
    abortSpecialEvent: () => abortSpecialEvent(),
    dismissSpecialEvent: () => dismissSpecialEvent(),
    fetchSpecialEventsState: () => fetchSpecialEventsState(),
  };
});

import {
  registerTakeoverPasscodePrompt,
  type TakeoverPasscodePrompt,
} from '@/utils/takeover_passcode';
import { STAGE_NOT_ARMED } from '@/utils/special_events_api';
import {
  __resetSpecialEventsCache,
  getSpecialEventsCache,
  runAbort,
  runArmShow,
  runDismiss,
  runExtend,
  runFinish,
  runFireStage,
  runPulseEffect,
} from './useSpecialEvents';

const FAKE_GOOD = 'fake-code-alpha';
const FAKE_BAD = 'fake-code-wrong';

function authRefusal(): Result {
  return { ok: false, status: 401, error: 'refused', data: { code: 'TAKEOVER_AUTH_INVALID' } };
}

let prompts: TakeoverPasscodePrompt[] = [];
let unregister: () => void = () => undefined;

/** Let the gate reach the prompt (one microtask past the send guard). */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  __resetSpecialEventsCache();
  prompts = [];
  performanceMode.active = false;
  armSpecialEvent.mockReset().mockResolvedValue({ ok: true, status: 200 });
  fireSpecialEventStage.mockReset().mockResolvedValue({ ok: true, status: 200 });
  fireSpecialEventQuickEffect.mockReset().mockResolvedValue({ ok: true, status: 200 });
  dismissSpecialEvent.mockReset().mockResolvedValue({ ok: true, status: 200 });
  extendSpecialEvent.mockReset().mockResolvedValue({ ok: true, status: 200 });
  finishSpecialEvent.mockReset().mockResolvedValue({ ok: true, status: 200 });
  abortSpecialEvent.mockReset().mockResolvedValue({ ok: true, status: 200 });
  fetchSpecialEventsState.mockClear();
  unregister = registerTakeoverPasscodePrompt((p) => { prompts.push(p); });
});

afterEach(() => {
  unregister();
});

describe('ARM outside performance mode', () => {
  it('sends exactly one bodyless-passcode request and never prompts', async () => {
    const outcome = await runArmShow('baby_reveal');
    expect(outcome).toBe('ok');
    expect(prompts).toHaveLength(0);
    expect(armSpecialEvent).toHaveBeenCalledTimes(1);
    expect(armSpecialEvent).toHaveBeenCalledWith('baby_reveal', undefined);
  });

  it('still opens the prompt if the engine demands a passcode anyway', async () => {
    // Performance mode flipped on between our state read and the request.
    armSpecialEvent.mockResolvedValueOnce(authRefusal());
    const pending = runArmShow('baby_reveal');
    await settle();
    expect(prompts).toHaveLength(1);
    await prompts[0].submit(FAKE_GOOD);
    expect(await pending).toBe('ok');
  });
});

describe('ARM in performance mode — a fresh passcode EVERY time', () => {
  beforeEach(() => { performanceMode.active = true; });

  it('prompts BEFORE any request reaches the engine', async () => {
    const pending = runArmShow('baby_reveal');
    await settle();
    expect(prompts).toHaveLength(1);
    expect(armSpecialEvent).not.toHaveBeenCalled();
    await prompts[0].submit(FAKE_GOOD);
    expect(await pending).toBe('ok');
    expect(armSpecialEvent).toHaveBeenCalledWith('baby_reveal', FAKE_GOOD);
  });

  it('prompts again on the very next ARM — nothing is remembered', async () => {
    const first = runArmShow('baby_reveal');
    await settle();
    await prompts[0].submit(FAKE_GOOD);
    await first;

    const second = runArmShow('baby_reveal');
    await settle();
    expect(prompts).toHaveLength(2);
    await prompts[1].submit(FAKE_GOOD);
    await second;
    expect(armSpecialEvent.mock.calls.map((c) => c[1])).toEqual([FAKE_GOOD, FAKE_GOOD]);
  });

  it('treats CANCEL as a non-event: no request, no error, no alert', async () => {
    const pending = runArmShow('baby_reveal');
    await settle();
    prompts[0].cancel();
    expect(await pending).toBe('cancelled');
    expect(armSpecialEvent).not.toHaveBeenCalled();
    expect(getSpecialEventsCache().error).toBeNull();
  });

  it('retries in place on a rejected passcode — one prompt, two attempts', async () => {
    armSpecialEvent.mockResolvedValueOnce(authRefusal());
    const pending = runArmShow('baby_reveal');
    await settle();
    const reason = await prompts[0].submit(FAKE_BAD);
    expect(reason).toContain('Passcode rejected');
    expect(reason).not.toContain(FAKE_BAD);
    await prompts[0].submit(FAKE_GOOD);
    expect(await pending).toBe('ok');
    expect(prompts).toHaveLength(1);
    expect(armSpecialEvent).toHaveBeenCalledTimes(2);
  });

  it('fails LOUDLY when no prompt host is mounted — it never arms unauthenticated', async () => {
    unregister();
    const outcome = await runArmShow('baby_reveal');
    expect(outcome).toBe('failed');
    expect(armSpecialEvent).not.toHaveBeenCalled();
    expect(getSpecialEventsCache().error).toContain('not mounted');
  });
});

describe('engine refusals surface honestly', () => {
  it('reports a 409 out-of-order fire with the engine sentence intact', async () => {
    fireSpecialEventStage.mockResolvedValueOnce({
      ok: false,
      status: 409,
      code: STAGE_NOT_ARMED,
      error: "stage 'reveal' is not armed (armed: blackout)",
    });
    const ok = await runFireStage('reveal', 'pink');
    expect(ok).toBe(false);
    const err = getSpecialEventsCache().error ?? '';
    expect(err).toContain('Out of order');
    expect(err).toContain("stage 'reveal' is not armed (armed: blackout)");
  });

  it('re-reads the engine after a refusal so the tab lands on the REAL stage', async () => {
    fireSpecialEventStage.mockResolvedValueOnce({ ok: false, status: 409, error: 'nope' });
    await runFireStage('reveal');
    expect(fetchSpecialEventsState).toHaveBeenCalled();
    expect(getSpecialEventsCache().state?.currentStageId).toBe('tease');
  });

  it('adopts the state the engine RETURNS on success — no optimistic cursor, no re-read', async () => {
    fireSpecialEventStage.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        status: 'running',
        currentStageId: 'blackout',
        armedStageId: 'reveal',
        catalog: { shows: [], errors: [] },
      },
    });
    await runFireStage('blackout');
    expect(getSpecialEventsCache().state?.currentStageId).toBe('blackout');
    expect(fetchSpecialEventsState).not.toHaveBeenCalled();
  });
});

describe('the rest of the verbs', () => {
  it('pulses a quick effect by id — the engine resolves it against the live stage', async () => {
    expect(await runPulseEffect('strobe')).toBe(true);
    expect(fireSpecialEventQuickEffect).toHaveBeenCalledWith('strobe');
  });

  it('dismisses an ENDED banner engine-side, never client-side', async () => {
    expect(await runDismiss()).toBe(true);
    expect(dismissSpecialEvent).toHaveBeenCalledTimes(1);
  });

  it('extends, finishes and aborts through their own routes', async () => {
    expect(await runExtend()).toBe(true);
    expect(await runFinish()).toBe(true);
    expect(await runAbort()).toBe(true);
    expect(extendSpecialEvent).toHaveBeenCalledTimes(1);
    expect(finishSpecialEvent).toHaveBeenCalledTimes(1);
    expect(abortSpecialEvent).toHaveBeenCalledTimes(1);
  });

  it('surfaces an abort failure instead of pretending the rig is back', async () => {
    abortSpecialEvent.mockResolvedValueOnce({ ok: false, status: 500, error: 'snapshot recall failed' });
    expect(await runAbort()).toBe(false);
    expect(getSpecialEventsCache().error).toBe('snapshot recall failed');
  });
});

// ── Storage audit ─────────────────────────────────────────────────────────
//
// The engine owns the show. Persisting ANY of it client-side is how a woken
// iPad ends up confidently drawing a stage the show left ten minutes ago — and
// persisting a passcode is forbidden outright by the operator ruling. This is a
// source scan rather than a runtime spy because it catches the import before
// anybody can call it.

const SPECIAL_EVENTS_SOURCES = [
  'utils/special_events_api.ts',
  'hooks/useSpecialEvents.ts',
  'components/special_events/special_events_view.ts',
  'components/special_events/stage_button.tsx',
  'app/(tabs)/special_events.tsx',
];

describe('storage audit', () => {
  it('no special-events source touches AsyncStorage or any other persistence', () => {
    for (const rel of SPECIAL_EVENTS_SOURCES) {
      const src = readFileSync(join(__dirname, '..', rel), 'utf8');
      expect(src, `${rel} must not import AsyncStorage`).not.toMatch(/async-storage/);
      expect(src, `${rel} must not use localStorage`).not.toMatch(/localStorage/);
      expect(src, `${rel} must not use sessionStorage`).not.toMatch(/sessionStorage/);
    }
  });

  it('nothing logs, and the passcode has no home outside the ARM argument', () => {
    const api = readFileSync(join(__dirname, '../utils/special_events_api.ts'), 'utf8');
    const hook = readFileSync(join(__dirname, './useSpecialEvents.ts'), 'utf8');
    // No console output on these paths: an engine refusal reaches the operator
    // through the error channel, never a log line that could carry an attempt.
    expect(api).not.toMatch(/console\./);
    expect(hook).not.toMatch(/console\./);
    // The word `passcode` appears only as a parameter/argument, never as a
    // module-level binding that could outlive a request.
    expect(api).not.toMatch(/^(let|const|var)\s+\w*[Pp]asscode/m);
    expect(hook).not.toMatch(/^(let|const|var)\s+\w*[Pp]asscode/m);
  });

  it('keeps the module cache in memory only — a reset clears everything', async () => {
    await runFireStage('blackout');
    expect(getSpecialEventsCache().state).not.toBeNull();
    __resetSpecialEventsCache();
    expect(getSpecialEventsCache().state).toBeNull();
    expect(getSpecialEventsCache().error).toBeNull();
  });
});
