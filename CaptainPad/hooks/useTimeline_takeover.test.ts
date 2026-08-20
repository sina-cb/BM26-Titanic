// useTimeline's two takeover entry points under the performance-mode passcode
// gate (operator ruling 2026-08-14). These are the functions EVERY CaptainPad
// takeover affordance funnels through:
//
//   runTakeover()        ← PlanLockBanner TEMPORARY TAKE OVER (deck / mixer /
//                          touch-control), the mixer's takeover-and-switch
//                          variant, and the implicit takeover fired by touching
//                          a manual control under a live plan.
//   runPerformTakeover() ← the timeline EVENT sheet's scoped PERFORM.
//
// What is pinned here: prompt per attempt (never remembered), the passcode
// travels only as the transport's per-request argument, CANCEL costs nothing,
// a refusal retries cleanly, and performance mode OFF behaves exactly as before.
//
// P0: placeholder passcodes only — no credential material lives in this repo.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/utils/engineEvents', () => ({
  engineEvents: {
    subscribe: () => () => undefined,
    subscribeStatus: () => () => undefined,
  },
}));

vi.mock('@/utils/passcode_waiver', () => ({
  getValidPasscodeWaiver: vi.fn(async () => null),
}));

const performanceMode = { active: false };
vi.mock('@/hooks/usePerformanceMode', () => ({
  getPerformanceModeState: () => performanceMode,
}));

const postTimelineTakeover = vi.fn(async (_body?: unknown, _auth?: unknown) => (
  { ok: true, status: 200, data: {} } as Record<string, unknown>
));
vi.mock('@/utils/timelineApi', () => ({
  fetchTimelineState: async () => ({ ok: true, data: { mode: 'overridden' } }),
  activateTimelinePlan: async () => ({ ok: true }),
  setTimelineAutopilot: async () => ({ ok: true }),
  resumeTimeline: async () => ({ ok: true }),
  endTimelineProgram: async () => ({ ok: true }),
  enableTimelineProgram: async () => ({ ok: true }),
  dismissTimelineProgram: async () => ({ ok: true }),
  fireTimelineCue: async () => ({ ok: true }),
  postTimelineActivity: async () => ({ ok: true }),
  postTimelineTravel: async () => ({ ok: true }),
  postTimelineTakeover: (body?: unknown, auth?: unknown) => postTimelineTakeover(body, auth),
}));

import {
  registerTakeoverPasscodePrompt,
  type OperatorAuthSendInput,
  type TakeoverPasscodePrompt,
} from '@/utils/takeover_passcode';
import { runPerformTakeover, runTakeover } from './useTimeline';

const FAKE_GOOD = 'fake-code-alpha';
const FAKE_BAD = 'fake-code-wrong';

function typedAuth(passcode: string, remember30 = false): OperatorAuthSendInput {
  return { passcode, remember30 };
}

function authRefusal(code: string, extra: Record<string, unknown> = {}) {
  return { ok: false, status: 401, error: 'refused', data: { code, ...extra } };
}

let prompts: TakeoverPasscodePrompt[] = [];
let unregister: () => void = () => undefined;

/** Wait until the gate reaches requestTakeoverPasscode and registers a prompt. */
async function waitForPrompts(count = 1) {
  await vi.waitFor(() => {
    expect(prompts).toHaveLength(count);
  });
}

beforeEach(() => {
  prompts = [];
  unregister = registerTakeoverPasscodePrompt((prompt) => { prompts.push(prompt); });
  performanceMode.active = false;
  postTimelineTakeover.mockReset();
  postTimelineTakeover.mockResolvedValue({ ok: true, status: 200, data: {} });
});

afterEach(() => { unregister(); });

describe('runTakeover — performance mode OFF', () => {
  it('takes over with no prompt and no passcode', async () => {
    expect(await runTakeover()).toBe('ok');
    expect(prompts).toHaveLength(0);
    expect(postTimelineTakeover).toHaveBeenCalledWith(undefined, undefined);
  });

  it('reports a plain engine refusal as a failure, not a cancel', async () => {
    postTimelineTakeover.mockResolvedValue({ ok: false, status: 409, error: 'plan is dormant' });

    expect(await runTakeover()).toBe('failed');
    expect(prompts).toHaveLength(0);
  });
});

describe('runTakeover — performance mode ON', () => {
  beforeEach(() => { performanceMode.active = true; });

  it('prompts before touching the engine and sends the typed passcode', async () => {
    const takeover = runTakeover();
    await waitForPrompts();

    expect(postTimelineTakeover).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].title).toMatch(/passcode/i);
    expect(prompts[0].detail).toMatch(/every takeover/i);

    await prompts[0].submit(FAKE_GOOD, false);

    expect(await takeover).toBe('ok');
    expect(postTimelineTakeover).toHaveBeenCalledWith(undefined, typedAuth(FAKE_GOOD));
  });

  it('prompts AGAIN on the very next takeover — two takeovers, two prompts', async () => {
    const first = runTakeover();
    await waitForPrompts();
    await prompts[0].submit(FAKE_GOOD, false);
    expect(await first).toBe('ok');

    const second = runTakeover();
    await waitForPrompts(2);
    // Nothing was replayed from the authorised attempt seconds ago.
    expect(postTimelineTakeover).toHaveBeenCalledTimes(1);

    await prompts[1].submit(FAKE_GOOD, false);
    expect(await second).toBe('ok');
    expect(postTimelineTakeover).toHaveBeenCalledTimes(2);
  });

  it('CANCEL issues no request and is not reported as a failure', async () => {
    const takeover = runTakeover();
    await waitForPrompts();
    prompts[0].cancel();

    expect(await takeover).toBe('cancelled');
    expect(postTimelineTakeover).not.toHaveBeenCalled();
  });

  it('retries in place with the engine reason, without echoing the attempt', async () => {
    postTimelineTakeover.mockImplementation(async (_body?: unknown, auth?: unknown) => {
      const typed = auth as OperatorAuthSendInput | undefined;
      return typed?.passcode === FAKE_GOOD
        ? { ok: true, status: 200, data: {} }
        : authRefusal('TAKEOVER_AUTH_INVALID');
    });

    const takeover = runTakeover();
    await waitForPrompts();

    const reason = await prompts[0].submit(FAKE_BAD, false);
    expect(reason).toMatch(/rejected/i);
    expect(reason).not.toContain(FAKE_BAD);
    expect(prompts).toHaveLength(1);

    expect(await prompts[0].submit(FAKE_GOOD, false)).toBeNull();
    expect(await takeover).toBe('ok');
    expect(postTimelineTakeover.mock.calls).toEqual([
      [undefined, typedAuth(FAKE_BAD)],
      [undefined, typedAuth(FAKE_GOOD)],
    ]);
  });

  it('surfaces the engine lockout instead of inventing a client-side one', async () => {
    postTimelineTakeover.mockResolvedValue(
      authRefusal('TAKEOVER_AUTH_RATE_LIMITED', { retryAfterMs: 30_000 }),
    );

    const takeover = runTakeover();
    await waitForPrompts();
    expect(await prompts[0].submit(FAKE_BAD, false)).toMatch(/locked this device out for 30s/i);

    prompts[0].cancel();
    expect(await takeover).toBe('cancelled');
  });

  it('fails LOUD rather than taking over unauthenticated when no host is mounted', async () => {
    unregister();

    expect(await runTakeover()).toBe('failed');
    expect(postTimelineTakeover).not.toHaveBeenCalled();

    unregister = registerTakeoverPasscodePrompt((prompt) => { prompts.push(prompt); });
  });
});

describe('runPerformTakeover — the EVENT sheet scoped PERFORM', () => {
  it('runs unprompted with the scope body while performance mode is off', async () => {
    expect(await runPerformTakeover('cue_1')).toEqual({ outcome: 'ok', error: null });
    expect(postTimelineTakeover).toHaveBeenCalledWith({ scope: 'perform', cueId: 'cue_1' }, undefined);
  });

  it('prompts under performance mode and keeps the scope body intact', async () => {
    performanceMode.active = true;

    const perform = runPerformTakeover('cue_1');
    await waitForPrompts();
    await prompts[0].submit(FAKE_GOOD, false);

    expect(await perform).toEqual({ outcome: 'ok', error: null });
    expect(postTimelineTakeover).toHaveBeenCalledWith(
      { scope: 'perform', cueId: 'cue_1' },
      typedAuth(FAKE_GOOD),
    );
  });

  it('reports a dismissed prompt as cancelled with no error to display', async () => {
    performanceMode.active = true;

    const perform = runPerformTakeover('cue_1');
    await waitForPrompts();
    prompts[0].cancel();

    expect(await perform).toEqual({ outcome: 'cancelled', error: null });
    expect(postTimelineTakeover).not.toHaveBeenCalled();
  });

  it('returns a non-passcode engine error verbatim for the sheet to show', async () => {
    performanceMode.active = true;
    postTimelineTakeover.mockResolvedValue({
      ok: false, status: 409, error: 'target is outside the festival window',
    });

    const perform = runPerformTakeover('cue_1');
    await waitForPrompts();
    expect(await prompts[0].submit(FAKE_GOOD, false)).toBeNull();

    expect(await perform).toEqual({
      outcome: 'failed',
      error: 'target is outside the festival window',
    });
  });
});
