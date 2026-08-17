// takeover_passcode — the CLIENT half of the performance-mode takeover gate.
//
// OPERATOR RULING 2026-08-14: "Take over in performance mode from the timeline
// needs to have either of the passwords we have for Sina, Muisha, or Sailors"
// … "pass code is required EVERY TIME."
//
// The engine side (agent _200) refuses every takeover FROM a running plan while
// performance mode is live unless the request carries a FRESH
// `X-CaptainPad-Passcode` header, verified per attempt against the three named
// principals. It deliberately ignores `X-CaptainPad-Session`: a live privileged
// session, a remembered device, or a takeover authorised ten seconds ago buys
// nothing. This module is the matching client behaviour.
//
// ── STORAGE AUDIT — where the passcode lives, and for how long ─────────────
//
// NOWHERE, beyond the single in-flight request.
//
//   * The typed characters live in the sheet component's local `useState` and
//     are wiped the instant the operator submits or the sheet closes.
//   * The submitted string is passed as a function ARGUMENT down
//     `submit(passcode) → attempt(passcode) → send(passcode)` and ends up in
//     one fetch header. No module-level variable in this file (or any other)
//     ever holds it.
//   * It is NEVER written to AsyncStorage, never put in a privileged session,
//     never cached for a retry, never logged, and never echoed back into an
//     error message — a rejected attempt shows only the engine's reason.
//   * There is no "remember" affordance on the takeover sheet, by design. The
//     ruling is EVERY TIME; a remembered passcode would be exactly the thing
//     the ruling forbids.
//
// Consequence: two consecutive takeovers prompt twice. That is the feature.
//
// Pure TypeScript with no React / React Native imports so vitest can drive the
// whole gate (`utils/*.test.ts` runs in the node environment).

// ── Engine refusal codes (marsin_engine/lib/api_server.js checkTakeoverPasscode)

export const TAKEOVER_AUTH_REQUIRED = 'TAKEOVER_AUTH_REQUIRED';
export const TAKEOVER_AUTH_INVALID = 'TAKEOVER_AUTH_INVALID';
export const TAKEOVER_AUTH_RATE_LIMITED = 'TAKEOVER_AUTH_RATE_LIMITED';

/** The minimal response envelope this gate reads (a subset of ApiResult). */
export interface TakeoverSendResult {
  ok: boolean;
  status?: number;
  error?: string;
  data?: unknown;
}

function refusalCode(result: TakeoverSendResult): string | null {
  if (result.ok) return null;
  const data = result.data;
  if (!data || typeof data !== 'object') return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function retryAfterSec(result: TakeoverSendResult): number | null {
  const data = result.data;
  if (!data || typeof data !== 'object') return null;
  const ms = (data as { retryAfterMs?: unknown }).retryAfterMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.ceil(ms / 1000);
}

/**
 * The operator-facing reason a takeover attempt needs a (new) passcode, or null
 * when the result is NOT a passcode refusal — a plain engine error (out of the
 * festival window, no plan, portwatch) must surface through the normal error
 * channel, not as a retry inside the passcode sheet.
 *
 * The attempted passcode is never part of any message returned here.
 */
export function takeoverAuthFailureMessage(result: TakeoverSendResult): string | null {
  switch (refusalCode(result)) {
    case TAKEOVER_AUTH_REQUIRED:
      return 'Performance mode is live. An operator passcode is required to take the rig '
        + 'from the timeline.';
    case TAKEOVER_AUTH_INVALID:
      return 'Passcode rejected. Check it and try again.';
    case TAKEOVER_AUTH_RATE_LIMITED: {
      // Surface the engine's OWN lockout honestly — 5 failures in a rolling
      // minute locks this address out for 60 s (captainpad_auth.js policy).
      const sec = retryAfterSec(result);
      return sec === null
        ? 'Too many passcode attempts. The engine has locked this device out — wait, then retry.'
        : `Too many passcode attempts. The engine has locked this device out for ${sec}s.`;
    }
    default:
      return null;
  }
}

// ── Prompt broker ─────────────────────────────────────────────────────────
//
// ONE mounted host (components/takeover_passcode_host.tsx) registers itself and
// renders the sheet. Any surface can then ask for a passcode without importing
// React state or plumbing a modal through five component layers — the same
// shape as the performance-dialog summon bus.

/** One live prompt, handed to the mounted host. */
export interface TakeoverPasscodePrompt {
  /** Sheet title (what is being taken over). */
  title: string;
  /** Body copy explaining WHY the passcode is being asked for. */
  detail: string;
  /**
   * Run ONE attempt with the typed passcode.
   * Resolves to a failure reason to display while the sheet STAYS OPEN for a
   * retry, or to `null` when the flow is finished and the host must close.
   * Never throws — a transport failure closes the sheet and rejects the
   * requester's promise instead.
   */
  submit: (passcode: string) => Promise<string | null>;
  /** Operator dismissed the sheet. No request is made. */
  cancel: () => void;
}

export type TakeoverPasscodePromptHandler = (prompt: TakeoverPasscodePrompt) => void;

let _handler: TakeoverPasscodePromptHandler | null = null;

/**
 * Mount point registration. Returns the unregister function.
 * A SECOND registration replaces the first (Fast Refresh remounts the host);
 * the unregister only clears the handler it installed.
 */
export function registerTakeoverPasscodePrompt(
  handler: TakeoverPasscodePromptHandler,
): () => void {
  _handler = handler;
  return () => {
    if (_handler === handler) _handler = null;
  };
}

/** True once the app-wide host is mounted. */
export function takeoverPasscodePromptReady(): boolean {
  return _handler !== null;
}

export type TakeoverPromptOutcome = 'submitted' | 'cancelled';

export interface TakeoverPasscodeRequest {
  title: string;
  detail: string;
  /**
   * Perform one takeover attempt with this passcode. Resolve to a failure
   * reason to keep the sheet open for a retry, or `null` when the flow is done
   * (success OR a non-passcode engine error the caller will surface itself).
   */
  attempt: (passcode: string) => Promise<string | null>;
}

/**
 * Open the passcode sheet and drive its retry loop.
 *
 * Codex P0 — no fallback: with no host mounted this THROWS rather than
 * silently taking over without a passcode or silently doing nothing.
 */
export function requestTakeoverPasscode(
  request: TakeoverPasscodeRequest,
): Promise<TakeoverPromptOutcome> {
  const handler = _handler;
  if (!handler) {
    throw new Error(
      'Takeover passcode prompt is not mounted — cannot ask for the operator passcode',
    );
  }
  return new Promise<TakeoverPromptOutcome>((resolve, reject) => {
    let settled = false;
    handler({
      title: request.title,
      detail: request.detail,
      submit: async (passcode: string) => {
        if (settled) return null;
        try {
          const retryReason = await request.attempt(passcode);
          if (retryReason !== null) return retryReason;
          settled = true;
          resolve('submitted');
          return null;
        } catch (error) {
          // A throwing attempt is a broken transport, not a wrong passcode:
          // close the sheet and hand the failure to the requester loudly.
          settled = true;
          reject(error);
          return null;
        }
      },
      cancel: () => {
        if (settled) return;
        settled = true;
        resolve('cancelled');
      },
    });
  });
}

// ── The gate ──────────────────────────────────────────────────────────────

export interface GatedTakeoverOptions<R extends TakeoverSendResult> {
  /** The engine-global performance-mode flag (NOT this device's privilege). */
  performanceActive: boolean;
  title: string;
  detail: string;
  /**
   * Issue the takeover request. Called with no argument when no passcode is in
   * play, and with the freshly typed passcode otherwise — which the transport
   * must send ONLY as the `X-CaptainPad-Passcode` header of that one request.
   * Must resolve an envelope rather than throwing (timelineSend already does).
   */
  send: (passcode?: string) => Promise<R>;
}

export type GatedTakeoverResult<R extends TakeoverSendResult> =
  | { cancelled: true; result: null }
  | { cancelled: false; result: R };

/**
 * Run a takeover under the performance-mode passcode gate.
 *
 * Performance mode OFF → exactly one bodyless request, no prompt, byte-identical
 * to the pre-ruling behaviour.
 *
 * Performance mode ON → prompt FIRST, then one request per typed passcode. A
 * passcode refusal keeps the sheet open with the engine's reason; any other
 * failure closes it and is returned for the caller's normal error channel.
 *
 * The un-prompted path still re-checks the response: if the engine answers
 * TAKEOVER_AUTH_* anyway (performance mode was switched on between our state
 * read and the request, or this client had not seeded it yet) we ask for the
 * passcode instead of failing silently.
 */
export async function runGatedTakeover<R extends TakeoverSendResult>(
  options: GatedTakeoverOptions<R>,
): Promise<GatedTakeoverResult<R>> {
  if (!options.performanceActive) {
    const direct = await options.send();
    if (takeoverAuthFailureMessage(direct) === null) return { cancelled: false, result: direct };
  }

  let last: R | null = null;
  const outcome = await requestTakeoverPasscode({
    title: options.title,
    detail: options.detail,
    attempt: async (passcode: string) => {
      const result = await options.send(passcode);
      const authFailure = takeoverAuthFailureMessage(result);
      if (authFailure !== null) return authFailure;
      last = result;
      return null;
    },
  });

  if (outcome === 'cancelled' || last === null) return { cancelled: true, result: null };
  return { cancelled: false, result: last };
}
