// The performance-mode takeover passcode gate (operator ruling 2026-08-14):
// prompt EVERY TIME, send the passcode as a per-request header only, never
// store it, retry cleanly on refusal, and make CANCEL cost nothing.
//
// Pure logic — no React, no transport. The sheet is driven through the same
// broker the real host (components/takeover_passcode_host.tsx) registers with.
//
// P0: every passcode below is an obvious placeholder. No credential material
// from $BM26_SECRETS exists in this repo, tests included.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  registerTakeoverPasscodePrompt,
  requestTakeoverPasscode,
  runGatedTakeover,
  takeoverAuthFailureMessage,
  takeoverPasscodePromptReady,
  type TakeoverPasscodePrompt,
  type TakeoverSendResult,
} from './takeover_passcode';

const FAKE_GOOD = 'fake-code-alpha';
const FAKE_BAD = 'fake-code-wrong';

function refusal(code: string, extra: Record<string, unknown> = {}): TakeoverSendResult {
  return { ok: false, status: 401, error: 'refused', data: { error: 'refused', code, ...extra } };
}

// ── A stand-in for the mounted host ───────────────────────────────────────
// Records every prompt it is handed and lets the test drive submit/cancel,
// exactly like an operator tapping the sheet.
interface FakeHost {
  prompts: TakeoverPasscodePrompt[];
  unregister: () => void;
}

function mountFakeHost(): FakeHost {
  const prompts: TakeoverPasscodePrompt[] = [];
  const unregister = registerTakeoverPasscodePrompt((prompt) => { prompts.push(prompt); });
  return { prompts, unregister };
}

let host: FakeHost;

beforeEach(() => { host = mountFakeHost(); });
afterEach(() => { host.unregister(); });

describe('takeoverAuthFailureMessage — which refusals are passcode refusals', () => {
  it('names the three engine passcode codes and nothing else', () => {
    expect(takeoverAuthFailureMessage(refusal('TAKEOVER_AUTH_REQUIRED')))
      .toMatch(/operator passcode is required/i);
    expect(takeoverAuthFailureMessage(refusal('TAKEOVER_AUTH_INVALID')))
      .toMatch(/rejected/i);
    // A plain engine error is NOT a passcode problem — it must fall through to
    // the caller's normal error channel instead of looping the sheet.
    expect(takeoverAuthFailureMessage(refusal('LAYER_SETTING_LOCKED'))).toBeNull();
    expect(takeoverAuthFailureMessage({ ok: false, status: 409, error: 'out of window' })).toBeNull();
    expect(takeoverAuthFailureMessage({ ok: true, status: 200 })).toBeNull();
  });

  it('surfaces the engine lockout honestly, with its own retry window', () => {
    const message = takeoverAuthFailureMessage(
      refusal('TAKEOVER_AUTH_RATE_LIMITED', { retryAfterMs: 42_000 }),
    );
    expect(message).toMatch(/locked this device out for 42s/i);
  });

  it('still reports the lockout when the engine sends no retry window', () => {
    expect(takeoverAuthFailureMessage(refusal('TAKEOVER_AUTH_RATE_LIMITED')))
      .toMatch(/locked this device out/i);
  });

  it('never echoes the attempted passcode in any message', () => {
    const codes = ['TAKEOVER_AUTH_REQUIRED', 'TAKEOVER_AUTH_INVALID', 'TAKEOVER_AUTH_RATE_LIMITED'];
    for (const code of codes) {
      // The engine body cannot make us leak it either.
      const message = takeoverAuthFailureMessage(refusal(code, { attempted: FAKE_BAD }));
      expect(message).not.toBeNull();
      expect(message).not.toContain(FAKE_BAD);
    }
  });
});

describe('runGatedTakeover — performance mode OFF', () => {
  it('sends exactly one bodyless request and never opens the prompt', async () => {
    const send = vi.fn(async () => ({ ok: true, status: 200 }));

    const gated = await runGatedTakeover({
      performanceActive: false,
      title: 't',
      detail: 'd',
      send,
    });

    expect(gated.cancelled).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith();
    expect(host.prompts).toHaveLength(0);
  });

  it('surfaces a plain engine failure without prompting', async () => {
    const send = vi.fn(async () => ({ ok: false, status: 409, error: 'plan is dormant' }));

    const gated = await runGatedTakeover({ performanceActive: false, title: 't', detail: 'd', send });

    expect(gated.cancelled).toBe(false);
    expect(gated.result?.error).toBe('plan is dormant');
    expect(host.prompts).toHaveLength(0);
  });

  it('asks for the passcode anyway when the engine says one is required', async () => {
    // The race the ruling has to survive: performance mode went live between
    // this client's last state seed and the request. The engine is the
    // authority, so its TAKEOVER_AUTH_REQUIRED opens the prompt rather than
    // failing silently.
    const send = vi.fn(async (passcode?: string) => (
      passcode === FAKE_GOOD ? { ok: true, status: 200 } : refusal('TAKEOVER_AUTH_REQUIRED')
    ));

    const gate = runGatedTakeover({ performanceActive: false, title: 't', detail: 'd', send });
    await Promise.resolve();
    expect(host.prompts).toHaveLength(1);
    await host.prompts[0].submit(FAKE_GOOD);

    expect((await gate).cancelled).toBe(false);
    expect(send).toHaveBeenNthCalledWith(1);
    expect(send).toHaveBeenNthCalledWith(2, FAKE_GOOD);
  });
});

describe('runGatedTakeover — performance mode ON', () => {
  it('prompts FIRST and sends the typed passcode with that one request', async () => {
    const send = vi.fn(async () => ({ ok: true, status: 200 }));

    const gate = runGatedTakeover({ performanceActive: true, title: 'Passcode', detail: 'why', send });
    await Promise.resolve();

    // Nothing is requested before the operator answers.
    expect(send).not.toHaveBeenCalled();
    expect(host.prompts).toHaveLength(1);
    expect(host.prompts[0].title).toBe('Passcode');
    expect(host.prompts[0].detail).toBe('why');

    await host.prompts[0].submit(FAKE_GOOD);
    const gated = await gate;

    expect(gated.cancelled).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(FAKE_GOOD);
  });

  it('prompts AGAIN for a second takeover — nothing is remembered', async () => {
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const options = { performanceActive: true, title: 't', detail: 'd', send };

    const first = runGatedTakeover(options);
    await Promise.resolve();
    await host.prompts[0].submit(FAKE_GOOD);
    await first;

    const second = runGatedTakeover(options);
    await Promise.resolve();
    expect(host.prompts).toHaveLength(2);
    // The second attempt gets NOTHING for free: no passcode is replayed, the
    // request only happens once the operator types it again.
    expect(send).toHaveBeenCalledTimes(1);

    await host.prompts[1].submit(FAKE_GOOD);
    await second;

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls).toEqual([[FAKE_GOOD], [FAKE_GOOD]]);
  });

  it('CANCEL makes no request at all', async () => {
    const send = vi.fn(async () => ({ ok: true, status: 200 }));

    const gate = runGatedTakeover({ performanceActive: true, title: 't', detail: 'd', send });
    await Promise.resolve();
    host.prompts[0].cancel();

    expect(await gate).toEqual({ cancelled: true, result: null });
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the sheet open with the reason on a rejected passcode, then succeeds', async () => {
    const send = vi.fn(async (passcode?: string) => (
      passcode === FAKE_GOOD ? { ok: true, status: 200 } : refusal('TAKEOVER_AUTH_INVALID')
    ));

    const gate = runGatedTakeover({ performanceActive: true, title: 't', detail: 'd', send });
    await Promise.resolve();

    // A refusal resolves to a retry reason — the host keeps the sheet mounted.
    const retryReason = await host.prompts[0].submit(FAKE_BAD);
    expect(retryReason).toMatch(/rejected/i);
    expect(retryReason).not.toContain(FAKE_BAD);
    // Still ONE prompt: the retry happens in place, not by reopening.
    expect(host.prompts).toHaveLength(1);

    expect(await host.prompts[0].submit(FAKE_GOOD)).toBeNull();
    expect((await gate).cancelled).toBe(false);
    expect(send.mock.calls).toEqual([[FAKE_BAD], [FAKE_GOOD]]);
  });

  it('cancelling after a rejected attempt still counts as cancelled', async () => {
    const send = vi.fn(async () => refusal('TAKEOVER_AUTH_INVALID'));

    const gate = runGatedTakeover({ performanceActive: true, title: 't', detail: 'd', send });
    await Promise.resolve();
    await host.prompts[0].submit(FAKE_BAD);
    host.prompts[0].cancel();

    expect(await gate).toEqual({ cancelled: true, result: null });
  });

  it('closes the sheet and returns a NON-passcode engine error to the caller', async () => {
    const send = vi.fn(async () => ({ ok: false, status: 409, error: 'portwatch owns the rig' }));

    const gate = runGatedTakeover({ performanceActive: true, title: 't', detail: 'd', send });
    await Promise.resolve();

    // null = "flow finished, close" — the sheet must not loop on an error the
    // operator cannot fix by retyping a passcode.
    expect(await host.prompts[0].submit(FAKE_GOOD)).toBeNull();
    const gated = await gate;
    expect(gated.cancelled).toBe(false);
    expect(gated.result?.error).toBe('portwatch owns the rig');
  });

  it('rejects loudly when the transport throws, instead of hanging the sheet', async () => {
    const send = vi.fn(async () => { throw new Error('Engine unreachable'); });

    const gate = runGatedTakeover({ performanceActive: true, title: 't', detail: 'd', send });
    await Promise.resolve();
    // The host closes on null and the requester sees the throw.
    expect(await host.prompts[0].submit(FAKE_GOOD)).toBeNull();
    await expect(gate).rejects.toThrow('Engine unreachable');
  });
});

describe('storage audit — the passcode exists only for the in-flight request', () => {
  it('leaves no trace in the module after a completed takeover', async () => {
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const gate = runGatedTakeover({ performanceActive: true, title: 't', detail: 'd', send });
    await Promise.resolve();
    await host.prompts[0].submit(FAKE_GOOD);
    await gate;

    // Every value this module exports, plus the prompt object it handed out.
    const moduleState = JSON.stringify(await import('./takeover_passcode')
      .then((m) => Object.entries(m).map(([k, v]) => (typeof v === 'function' ? k : v))));
    expect(moduleState).not.toContain(FAKE_GOOD);
    expect(JSON.stringify(host.prompts)).not.toContain(FAKE_GOOD);
  });

  it('never writes the passcode to the console', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const send = vi.fn(async (passcode?: string) => (
      passcode === FAKE_GOOD ? { ok: true, status: 200 } : refusal('TAKEOVER_AUTH_INVALID')
    ));
    const gate = runGatedTakeover({ performanceActive: true, title: 't', detail: 'd', send });
    await Promise.resolve();
    await host.prompts[0].submit(FAKE_BAD);
    await host.prompts[0].submit(FAKE_GOOD);
    await gate;

    const written = [log, warn, error]
      .flatMap((spy) => spy.mock.calls.flat())
      .map((entry) => String(entry))
      .join('\n');
    expect(written).not.toContain(FAKE_BAD);
    expect(written).not.toContain(FAKE_GOOD);

    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe('broker wiring', () => {
  it('reports readiness and fails LOUD with no host mounted', () => {
    expect(takeoverPasscodePromptReady()).toBe(true);
    host.unregister();
    expect(takeoverPasscodePromptReady()).toBe(false);

    // Codex P0 — no fallback: an unmounted prompt must not mean "take over
    // without a passcode", and must not mean "silently do nothing" either.
    expect(() => requestTakeoverPasscode({
      title: 't', detail: 'd', attempt: async () => null,
    })).toThrow(/not mounted/i);

    host = mountFakeHost();
  });

  it('unregistering a replaced host does not tear down the live one', () => {
    const stale = host;
    const fresh = mountFakeHost();
    stale.unregister();
    expect(takeoverPasscodePromptReady()).toBe(true);
    fresh.unregister();
    expect(takeoverPasscodePromptReady()).toBe(false);
    host = mountFakeHost();
  });
});
