// takeover_passcode — the CLIENT half of the performance-mode operator passcode gates.
//
// While performance mode is live, the engine refuses takeover, exit, and
// edit-session routes unless the request carries a fresh operator passcode OR a
// valid 30-minute opaque passcode waiver (operator ruling 2026-08-18).
//
// Privileged sessions deliberately buy nothing here. When Remember is checked,
// CaptainPad mints a waiver through POST /captainpad/auth/passcode-waiver and
// stores only opaque token metadata bound to the engine origin — never the raw
// passcode.
//
// ── STORAGE AUDIT ─────────────────────────────────────────────────────────
//
// Raw passcodes:
//   * live in sheet local `useState`, wiped on submit and on close;
//   * travel as a per-request header only when Remember is OFF;
//   * are NEVER written to AsyncStorage, never logged, never echoed in errors.
//
// Waivers (Remember ON):
//   * opaque token + principal + expiry + engineOrigin in AsyncStorage;
//   * cleared on expiry, engine-origin change, invalid/unauthorized response,
//     privileged logout/lock, or failed validation.
//
// Pure TypeScript with no React / React Native imports so vitest can drive the
// whole gate (`utils/*.test.ts` runs in the node environment).

export const TAKEOVER_AUTH_REQUIRED = 'TAKEOVER_AUTH_REQUIRED';
export const TAKEOVER_AUTH_INVALID = 'TAKEOVER_AUTH_INVALID';
export const TAKEOVER_AUTH_RATE_LIMITED = 'TAKEOVER_AUTH_RATE_LIMITED';
export const TAKEOVER_AUTH_WAIVER_INVALID = 'TAKEOVER_AUTH_WAIVER_INVALID';

/** The minimal response envelope this gate reads (a subset of ApiResult). */
export interface TakeoverSendResult {
  ok: boolean;
  status?: number;
  error?: string;
  data?: unknown;
}

export interface OperatorAuthSendInput {
  passcode?: string;
  remember30?: boolean;
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

const AUTH_REFUSAL_CODES = new Set([
  TAKEOVER_AUTH_REQUIRED,
  TAKEOVER_AUTH_INVALID,
  TAKEOVER_AUTH_RATE_LIMITED,
  TAKEOVER_AUTH_WAIVER_INVALID,
  'EXIT_AUTH_REQUIRED',
  'EXIT_AUTH_INVALID',
  'EXIT_AUTH_RATE_LIMITED',
  'EXIT_AUTH_WAIVER_INVALID',
  'EDIT_SESSION_AUTH_REQUIRED',
  'EDIT_SESSION_AUTH_INVALID',
  'EDIT_SESSION_AUTH_RATE_LIMITED',
  'EDIT_SESSION_AUTH_WAIVER_INVALID',
]);

/**
 * The operator-facing reason a passcode-gated attempt needs a (new) credential,
 * or null when the result is NOT an auth refusal.
 */
export function takeoverAuthFailureMessage(result: TakeoverSendResult): string | null {
  const code = refusalCode(result);
  if (!code || !AUTH_REFUSAL_CODES.has(code)) return null;
  switch (code) {
    case TAKEOVER_AUTH_REQUIRED:
    case 'EXIT_AUTH_REQUIRED':
    case 'EDIT_SESSION_AUTH_REQUIRED':
      return 'Performance mode is live. An operator passcode is required.';
    case TAKEOVER_AUTH_INVALID:
    case 'EXIT_AUTH_INVALID':
    case 'EDIT_SESSION_AUTH_INVALID':
      return 'Passcode rejected. Check it and try again.';
    case TAKEOVER_AUTH_WAIVER_INVALID:
    case 'EXIT_AUTH_WAIVER_INVALID':
    case 'EDIT_SESSION_AUTH_WAIVER_INVALID':
      return 'Your remembered passcode expired or was rejected — enter it again.';
    case TAKEOVER_AUTH_RATE_LIMITED:
    case 'EXIT_AUTH_RATE_LIMITED':
    case 'EDIT_SESSION_AUTH_RATE_LIMITED': {
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

export interface TakeoverPasscodePrompt {
  title: string;
  detail: string;
  submit: (passcode: string, remember30: boolean) => Promise<string | null>;
  cancel: () => void;
}

export type TakeoverPasscodePromptHandler = (prompt: TakeoverPasscodePrompt) => void;

let _handler: TakeoverPasscodePromptHandler | null = null;

export function registerTakeoverPasscodePrompt(
  handler: TakeoverPasscodePromptHandler,
): () => void {
  _handler = handler;
  return () => {
    if (_handler === handler) _handler = null;
  };
}

export function takeoverPasscodePromptReady(): boolean {
  return _handler !== null;
}

export type TakeoverPromptOutcome = 'submitted' | 'cancelled';

export interface TakeoverPasscodeRequest {
  title: string;
  detail: string;
  attempt: (auth: OperatorAuthSendInput) => Promise<string | null>;
}

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
      submit: async (passcode: string, remember30: boolean) => {
        if (settled) return null;
        try {
          const retryReason = await request.attempt({ passcode, remember30 });
          if (retryReason !== null) return retryReason;
          settled = true;
          resolve('submitted');
          return null;
        } catch (error) {
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
  performanceActive: boolean;
  title: string;
  detail: string;
  send: (auth?: OperatorAuthSendInput) => Promise<R>;
}

export type GatedTakeoverResult<R extends TakeoverSendResult> =
  | { cancelled: true; result: null }
  | { cancelled: false; result: R };

export async function runGatedTakeover<R extends TakeoverSendResult>(
  options: GatedTakeoverOptions<R>,
): Promise<GatedTakeoverResult<R>> {
  const { getValidPasscodeWaiver } = await import('./passcode_waiver');

  if (!options.performanceActive) {
    const direct = await options.send();
    if (takeoverAuthFailureMessage(direct) === null) return { cancelled: false, result: direct };
  }

  const waiver = await getValidPasscodeWaiver();
  if (waiver) {
    const withWaiver = await options.send();
    if (takeoverAuthFailureMessage(withWaiver) === null) {
      return { cancelled: false, result: withWaiver };
    }
  }

  let last: R | null = null;
  const outcome = await requestTakeoverPasscode({
    title: options.title,
    detail: options.detail,
    attempt: async (auth) => {
      const result = await options.send(auth);
      const authFailure = takeoverAuthFailureMessage(result);
      if (authFailure !== null) return authFailure;
      last = result;
      return null;
    },
  });

  if (outcome === 'cancelled' || last === null) return { cancelled: true, result: null };
  return { cancelled: false, result: last };
}
