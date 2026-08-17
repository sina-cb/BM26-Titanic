// op_dialog — the broker contract.
//
// Runs in vitest's NODE env (see vitest.config.ts `utils/*.test.ts`), which is
// exactly why utils/op_dialog.ts is pure TypeScript with no react-native
// import: the whole notice/dialog protocol is drivable here with a fake host,
// no renderer required.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OP_NOTICE_DURATION_MS,
  OP_NOTICE_MAX_VISIBLE,
  opConfirm,
  opDialog,
  opDialogHostReady,
  opError,
  opInfo,
  opNotify,
  opPrompt,
  opWarn,
  OP_PROMPT_CANCEL,
  OP_PROMPT_SUBMIT,
  registerOpDialogHost,
  resetOpDialogForTest,
  type OpDialog,
  type OpNotice,
} from '@/utils/op_dialog';

/** A stand-in for components/op_dialog_host.tsx. */
function fakeHost() {
  const notices: OpNotice[] = [];
  const dialogs: OpDialog[] = [];
  const unregister = registerOpDialogHost({
    pushNotice: (n) => { notices.push(n); },
    openDialog: (d) => { dialogs.push(d); },
  });
  return { notices, dialogs, unregister };
}

beforeEach(() => {
  resetOpDialogForTest();
});

// ── notices ───────────────────────────────────────────────────────────────

describe('notices', () => {
  it('delivers title, message and tone to the mounted host', () => {
    const host = fakeHost();
    opError('Switch failed', 'the engine said no');
    expect(host.notices).toHaveLength(1);
    expect(host.notices[0]).toMatchObject({
      tone: 'error',
      title: 'Switch failed',
      message: 'the engine said no',
    });
  });

  it('each shorthand carries its own tone and default dwell time', () => {
    const host = fakeHost();
    opError('e');
    opWarn('w');
    opInfo('i');
    expect(host.notices.map((n) => n.tone)).toEqual(['error', 'warning', 'info']);
    expect(host.notices.map((n) => n.durationMs)).toEqual([
      OP_NOTICE_DURATION_MS.error,
      OP_NOTICE_DURATION_MS.warning,
      OP_NOTICE_DURATION_MS.info,
    ]);
  });

  it('errors linger longer than warnings, which linger longer than info', () => {
    // The engine's reason rides on the error toast; it gets the most read time.
    expect(OP_NOTICE_DURATION_MS.error).toBeGreaterThan(OP_NOTICE_DURATION_MS.warning);
    expect(OP_NOTICE_DURATION_MS.warning).toBeGreaterThan(OP_NOTICE_DURATION_MS.info);
  });

  it('an explicit durationMs overrides the tone default', () => {
    const host = fakeHost();
    opNotify({ tone: 'info', title: 't', durationMs: 999 });
    expect(host.notices[0].durationMs).toBe(999);
  });

  it('gives every notice a distinct id', () => {
    const host = fakeHost();
    opError('a');
    opError('a');
    expect(host.notices[0].id).not.toBe(host.notices[1].id);
  });

  it('a message is optional', () => {
    const host = fakeHost();
    opInfo('bare');
    expect(host.notices[0].message).toBeUndefined();
  });
});

// ── the pre-mount buffer ──────────────────────────────────────────────────

describe('notices raised before the host mounts', () => {
  it('are buffered and flushed in order on registration', () => {
    // A failure during boot must not vanish just because the tree is not up.
    opError('first');
    opWarn('second');
    const host = fakeHost();
    expect(host.notices.map((n) => n.title)).toEqual(['first', 'second']);
  });

  it('are flushed exactly once, not re-delivered to a later host', () => {
    opError('once');
    const first = fakeHost();
    first.unregister();
    const second = fakeHost();
    expect(first.notices.map((n) => n.title)).toEqual(['once']);
    expect(second.notices).toHaveLength(0);
  });

  it('drop the OLDEST past the bound, and say so loudly', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 40; i++) opError(`n${i}`);
    const host = fakeHost();
    // Bounded — a boot-time failure loop cannot grow this without limit.
    expect(host.notices.length).toBeLessThan(40);
    // The newest survive; the drop is reported rather than hidden.
    expect(host.notices[host.notices.length - 1].title).toBe('n39');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('opNotify never throws with no host — it must not mask a caught error', () => {
    // Nearly every call site is inside a `catch`. Throwing there would replace
    // the operator's real engine error with a plumbing error.
    expect(() => opError('boom')).not.toThrow();
  });
});

// ── dialogs ───────────────────────────────────────────────────────────────

describe('dialogs', () => {
  it('resolves with the chosen action id', async () => {
    const host = fakeHost();
    const answer = opDialog({
      tone: 'warning',
      title: 'Switch refused',
      message: 'a special event owns the deck',
      actions: [{ id: 'dismiss', label: 'DISMISS', kind: 'cancel' }, { id: 'events', label: 'OPEN EVENTS' }],
    });
    host.dialogs[0].resolve('events');
    await expect(answer).resolves.toBe('events');
  });

  it('resolves null when dismissed', async () => {
    const host = fakeHost();
    const answer = opDialog({ tone: 'info', title: 't', message: 'm', actions: [{ id: 'ok', label: 'OK' }] });
    host.dialogs[0].resolve(null);
    await expect(answer).resolves.toBeNull();
  });

  it('ignores a second resolve (double-tap) rather than throwing', async () => {
    const host = fakeHost();
    const answer = opDialog({ tone: 'info', title: 't', message: 'm', actions: [{ id: 'ok', label: 'OK' }] });
    host.dialogs[0].resolve('ok');
    host.dialogs[0].resolve(null);
    await expect(answer).resolves.toBe('ok');
  });

  it('THROWS with no host mounted — never silently resolves null', () => {
    // Codex P0. A null here would read as "the operator said no" and the
    // caller would skip the action without anyone noticing.
    expect(opDialogHostReady()).toBe(false);
    expect(() => opDialog({ tone: 'info', title: 't', message: 'm', actions: [{ id: 'ok', label: 'OK' }] }))
      .toThrow(/not mounted/);
  });

  it('THROWS on an actionless dialog — an unanswerable question is a bug', () => {
    fakeHost();
    expect(() => opDialog({ tone: 'info', title: 't', message: 'm', actions: [] }))
      .toThrow(/at least one action/);
  });
});

// ── confirm ───────────────────────────────────────────────────────────────

describe('opConfirm', () => {
  it('offers cancel first and a destructive confirm second, by default', async () => {
    const host = fakeHost();
    const answer = opConfirm({ title: 'Fire?', message: 'this is loud' });
    expect(host.dialogs[0].actions).toEqual([
      { id: 'cancel', label: 'CANCEL', kind: 'cancel' },
      { id: 'confirm', label: 'CONFIRM', kind: 'destructive' },
    ]);
    host.dialogs[0].resolve('cancel');
    await answer;
  });

  it('resolves true only for the confirm action', async () => {
    const host = fakeHost();
    const answer = opConfirm({ title: 't', message: 'm', confirmLabel: 'FIRE' });
    expect(host.dialogs[0].actions[1].label).toBe('FIRE');
    host.dialogs[0].resolve('confirm');
    await expect(answer).resolves.toBe(true);
  });

  it('resolves FALSE on cancel and on dismissal alike', async () => {
    const host = fakeHost();
    const cancelled = opConfirm({ title: 't', message: 'm' });
    host.dialogs[0].resolve('cancel');
    await expect(cancelled).resolves.toBe(false);

    const dismissed = opConfirm({ title: 't', message: 'm' });
    host.dialogs[1].resolve(null);
    await expect(dismissed).resolves.toBe(false);
  });

  it('destructive:false drops the danger ink', async () => {
    const host = fakeHost();
    const answer = opConfirm({ title: 't', message: 'm', destructive: false });
    expect(host.dialogs[0].actions[1].kind).toBe('default');
    host.dialogs[0].resolve(null);
    await answer;
  });
});

// ── prompts (_242 order 4: "ask for a name too") ──────────────────────────

describe('opPrompt', () => {
  it('carries a text field and a generated icon to the host', () => {
    const host = fakeHost();
    const answer = opPrompt({
      title: 'Name this palette',
      message: 'm',
      placeholder: 'unnamed',
      maxLength: 24,
      swatches: ['rgb(255, 0, 0)', 'rgb(0, 255, 0)'],
    });
    const d = host.dialogs[0];
    expect(d.input).toMatchObject({ placeholder: 'unnamed', maxLength: 24 });
    expect(d.swatches).toEqual(['rgb(255, 0, 0)', 'rgb(0, 255, 0)']);
    expect(d.actions.map((a) => a.id)).toEqual([OP_PROMPT_CANCEL, OP_PROMPT_SUBMIT]);
    d.resolve(OP_PROMPT_CANCEL);
    return answer;
  });

  it('resolves the literal text the operator typed', async () => {
    const host = fakeHost();
    const answer = opPrompt({ title: 't', message: 'm' });
    host.dialogs[0].resolve(OP_PROMPT_SUBMIT, 'Sunset');
    await expect(answer).resolves.toBe('Sunset');
  });

  it('an EMPTY name is a real answer, distinct from cancelling', async () => {
    // The operator ruling: "by default accept an empty name too for no name on
    // the screen". '' must therefore never collapse into the null that means
    // "they backed out".
    const host = fakeHost();
    const empty = opPrompt({ title: 't', message: 'm' });
    host.dialogs[0].resolve(OP_PROMPT_SUBMIT, '');
    await expect(empty).resolves.toBe('');

    const cancelled = opPrompt({ title: 't', message: 'm' });
    host.dialogs[1].resolve(OP_PROMPT_CANCEL, '');
    await expect(cancelled).resolves.toBeNull();

    const dismissed = opPrompt({ title: 't', message: 'm' });
    host.dialogs[2].resolve(null);
    await expect(dismissed).resolves.toBeNull();
  });

  it('THROWS when a submit arrives with no value — never substitutes an empty name', async () => {
    // A host that rendered the field but forgot to wire it would otherwise ship
    // a naming dialog that silently refuses to name anything.
    const host = fakeHost();
    const answer = opPrompt({ title: 't', message: 'm' });
    host.dialogs[0].resolve(OP_PROMPT_SUBMIT);
    await expect(answer).rejects.toThrow(/without the field value/);
  });

  it('a plain opDialog carries no input, so the sheet renders no field', () => {
    const host = fakeHost();
    const answer = opDialog({ tone: 'info', title: 't', message: 'm', actions: [{ id: 'ok', label: 'OK' }] });
    expect(host.dialogs[0].input).toBeUndefined();
    expect(host.dialogs[0].swatches).toBeUndefined();
    host.dialogs[0].resolve('ok');
    return answer;
  });
});

// ── host lifecycle ────────────────────────────────────────────────────────

describe('host registration', () => {
  it('reports readiness', () => {
    expect(opDialogHostReady()).toBe(false);
    const host = fakeHost();
    expect(opDialogHostReady()).toBe(true);
    host.unregister();
    expect(opDialogHostReady()).toBe(false);
  });

  it('a second registration wins, and the stale unregister is inert', () => {
    // Fast Refresh remounts the host; the old one must not blank the new one.
    const first = fakeHost();
    const second = fakeHost();
    first.unregister();
    expect(opDialogHostReady()).toBe(true);
    opError('to the live host');
    expect(first.notices).toHaveLength(0);
    expect(second.notices).toHaveLength(1);
  });

  it('caps how many toasts the host is asked to show at once', () => {
    // The host enforces this; the constant is shared so the two agree.
    expect(OP_NOTICE_MAX_VISIBLE).toBeGreaterThan(0);
    expect(OP_NOTICE_MAX_VISIBLE).toBeLessThanOrEqual(5);
  });
});
