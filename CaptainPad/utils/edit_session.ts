/**
 * edit_session — PURE copy mapping for the principal-scoped persistence gates
 * (docs/56). No React / react-native imports so vitest pins it in plain Node,
 * matching utils/takeover_passcode.ts.
 *
 * Every message here is FIXED CLIENT COPY chosen from the engine's machine
 * code. The client never echoes a passphrase, a raw engine body, or any
 * deployment detail back into the operator UI — the same rule
 * captainPadAuthFailureMessage and takeoverAuthFailureMessage follow.
 */

/**
 * The operator-passcode header.
 *
 * It lives in THIS module because this module imports nothing: the timeline
 * takeover, the special-event ARM, the performance-mode exit and the
 * edit-session assertion all need it, and routing it through `api.ts` or
 * `timelineApi.ts` made it disappear whenever a suite mocked one of those.
 * A constant that four transports agree on should not depend on any of them.
 *
 * The VALUE it carries is never stored: it can only arrive as an argument on
 * the single request it authorises, the engine verifies it per attempt, and it
 * buys no session. Storage audit: utils/takeover_passcode.ts.
 */
export const TAKEOVER_PASSCODE_HEADER = 'X-CaptainPad-Passcode';

/** Refusal codes the engine emits for the edit-session family. */
export const EXIT_AUTH_REQUIRED = 'EXIT_AUTH_REQUIRED';
export const EXIT_AUTH_INVALID = 'EXIT_AUTH_INVALID';
export const EXIT_AUTH_RATE_LIMITED = 'EXIT_AUTH_RATE_LIMITED';
export const EXIT_KEEP_SAVE_OWNER_ONLY = 'EXIT_KEEP_SAVE_OWNER_ONLY';
export const EDIT_SESSION_AUTH_REQUIRED = 'EDIT_SESSION_AUTH_REQUIRED';
export const EDIT_SESSION_AUTH_INVALID = 'EDIT_SESSION_AUTH_INVALID';
export const EDIT_SESSION_AUTH_RATE_LIMITED = 'EDIT_SESSION_AUTH_RATE_LIMITED';
export const EDIT_SESSION_PERFORMANCE_ACTIVE = 'EDIT_SESSION_PERFORMANCE_ACTIVE';
export const EDIT_PRINCIPAL_READONLY = 'EDIT_PRINCIPAL_READONLY';

export interface EditSessionResult {
  ok: boolean;
  code?: string;
  data?: unknown;
}

function retryAfterSec(result: EditSessionResult): number | null {
  const body = result.data as { retryAfterMs?: unknown } | undefined;
  const ms = body && body.retryAfterMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.ceil(ms / 1000);
}

function rateLimitedCopy(result: EditSessionResult): string {
  const sec = retryAfterSec(result);
  return sec === null
    ? 'Too many passcode attempts. The engine has locked this device out — wait, then retry.'
    : `Too many passcode attempts. The engine has locked this device out for ${sec}s.`;
}

/**
 * The message for a refused PERFORMANCE-MODE EXIT, or null when the failure is
 * not one of this family (the caller keeps its own generic handling).
 */
export function performanceExitRefusalMessage(result: EditSessionResult): string | null {
  switch (result.code) {
    case EXIT_AUTH_REQUIRED:
      return 'An operator passcode is required to leave performance mode.';
    case EXIT_AUTH_INVALID:
      return 'Passcode rejected. Check it and try again.';
    case EXIT_AUTH_RATE_LIMITED:
      return rateLimitedCopy(result);
    case EXIT_KEEP_SAVE_OWNER_ONLY:
      return 'Only the captain’s passcode can save this session’s tuning. '
        + 'Choose DISCARD PERFORMANCE CHANGES, or enter the captain’s passcode.';
    default:
      return null;
  }
}

/**
 * TOTAL failure copy for a performance-mode EXIT — this one NEVER returns null.
 *
 * Report `_236`, operator: "when going from perform mode to the edit mode, now
 * the 'restore pre-show' or the 'Keep live state' isn't making progress
 * anymore." Root cause (half two): `PerformanceModeControl.doExit` sent every
 * failure OUTSIDE the four codes above to `Alert.alert`, and react-native-web's
 * `Alert` is a literal empty stub (`class Alert { static alert() {} }`) — so a
 * 400 / 423 / 500 / timeout left the sheet open with NO message at all. The
 * operator taps, the engine refuses, and the pad says nothing: a silent
 * refusal, which codex P0 forbids outright.
 *
 * So the exit flow no longer has a "not my family" branch. Every code the
 * engine can answer this route with gets a sentence that names the cause AND
 * the way out; anything unrecognised still gets a sentence carrying the machine
 * code (a public enum — never credential material, never a raw engine body,
 * exactly the posture the rest of this module keeps).
 */
export function performanceExitFailureMessage(result: EditSessionResult): string {
  const family = performanceExitRefusalMessage(result);
  if (family) return family;
  switch (result.code) {
    case 'PERFORMANCE_MODE_NOT_ACTIVE':
      // Not an error in outcome — the rig IS in edit mode, just not because of
      // this tap (another pad, or the engine, left the lock first). Said plainly
      // rather than silently closing, so the operator knows who moved the rig.
      return 'Performance mode is already off — the engine or another pad left it '
        + 'first. You are in edit mode; close this sheet.';
    case 'PERFORMANCE_MODE_SNAPSHOT_MISSING':
    case 'PERFORMANCE_MODE_SNAPSHOT_MALFORMED':
      return 'The pre-show snapshot is missing or unreadable, so the rig cannot be '
        + 'restored. Choose SAVE CHANGES to leave performance mode with the '
        + 'current look.';
    case 'PERFORMANCE_MODE_INVALID_EXIT':
    case 'INVALID_BODY':
      return 'The engine rejected this pad’s request as malformed — this CaptainPad '
        + 'and the engine disagree. Reload the pad, then try again.';
    case 'TOUCH_CONTROL_LEASE_HELD':
    case 'TOUCH_CONTROL_LEASE_INACTIVE':
      return 'Live Touch is armed and holds the rig, so the engine refuses every '
        + 'other change. Disarm the Touch Control panel, then leave performance mode.';
    case 'SPECIAL_EVENT':
      return 'A special event is running and owns the deck. End or abort it from the '
        + 'Events tab first.';
    default:
      break;
  }
  // An unrecognised refusal still names its machine code, because that is what
  // the operator reads out to whoever debugs the engine. Only a SCREAMING_SNAKE
  // enum qualifies: this module's standing rule is that nothing from an engine
  // body reaches the UI unfiltered, and this charset cannot carry a passphrase,
  // a path, or a sentence — so a malformed or hostile `code` degrades to the
  // generic copy instead of being printed.
  if (typeof result.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(result.code)) {
    return `The engine refused to leave performance mode (${result.code}). `
      + 'Nothing changed — check the engine, then try again.';
  }
  if (typeof result.code === 'string' && result.code.length > 0) {
    return 'The engine refused to leave performance mode with an unreadable reason. '
      + 'Nothing changed — check the engine, then try again.';
  }
  // No code at all: the request never reached a route (offline engine, DNS,
  // the 8 s client timeout). Still a sentence, never a shrug.
  return 'The engine did not answer, so performance mode is unchanged. Check the '
    + 'engine connection, then try again.';
}

/** The message for a refused POST /edit-session. Always returns copy — this
 *  sheet has nowhere else to put a failure. */
export function editSessionRefusalMessage(result: EditSessionResult): string {
  switch (result.code) {
    case EDIT_SESSION_AUTH_REQUIRED:
      return 'A passcode is required.';
    case EDIT_SESSION_AUTH_INVALID:
      return 'Passcode rejected. Check it and try again.';
    case EDIT_SESSION_AUTH_RATE_LIMITED:
      return rateLimitedCopy(result);
    case EDIT_SESSION_PERFORMANCE_ACTIVE:
      return 'Performance mode is live. Leave it first — that is where the session starts.';
    case 'PRIVILEGED_AUTH_DISABLED':
      return 'This engine has no operator passcodes, so nothing is gated — everything already saves.';
    default:
      return 'The engine did not accept the passcode. Check the connection and try again.';
  }
}

/**
 * The toast copy for a 403 EDIT_PRINCIPAL_READONLY on any explicit file-writing
 * route, or null when the failure is something else. Names the cause instead of
 * a generic "failed", because the operator's next question is always "why".
 */
export function principalReadonlyMessage(result: EditSessionResult): string | null {
  if (result.code !== EDIT_PRINCIPAL_READONLY) return null;
  const body = result.data as { principal?: unknown } | undefined;
  const principal = body && body.principal;
  const who = principal === 'collaborator' ? 'crew session' : 'sailor session';
  return `Not saved — ${who}. Playlist and settings files are read-only until the `
    + 'captain’s passcode is entered.';
}
