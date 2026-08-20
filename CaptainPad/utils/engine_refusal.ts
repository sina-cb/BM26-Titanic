// engine_refusal — recognising the engine refusals that deserve more than a
// toast, kept as PURE TypeScript so vitest can drive it in the node env.
//
// Some 4xx bodies are not "something broke", they are "something else owns the
// rig, and here is where you go to release it". Those deserve a MODAL with a
// route out, not a toast that fades while the operator is still reading it.
//
// The routing itself deliberately lives at the call site: importing
// `expo-router` here would make this module unloadable in the node test env,
// and the whole point of splitting it out is that the DECISION is testable.

/** The minimal response envelope this reads (a subset of ApiResult). */
export interface EngineRefusalResult {
  ok?: boolean;
  status?: number;
  error?: string;
  code?: string;
  data?: unknown;
}

/** marsin_engine/lib/api_server.js → rejectIfSpecialEventHoldsRig(). */
export const SPECIAL_EVENT_REFUSAL = 'SPECIAL_EVENT';

/** `code` can arrive flattened onto the envelope or nested in the parsed body,
 *  depending on which transport helper made the call. Read both. */
function refusalCode(result: EngineRefusalResult): string | null {
  if (typeof result.code === 'string') return result.code;
  const data = result.data;
  if (!data || typeof data !== 'object') return null;
  const nested = (data as { code?: unknown }).code;
  return typeof nested === 'string' ? nested : null;
}

/**
 * The engine's VERBATIM reason when a special event owns the deck, else null.
 *
 * Verbatim matters: the engine already writes the operator-facing sentence
 * ("special event \"baby_reveal\" is running and owns the deck — end or abort
 * it from the Events tab first") and names the show. Re-wording it here would
 * put two different sentences in front of the operator for one condition.
 */
export function specialEventRefusal(result: EngineRefusalResult): string | null {
  if (result.ok) return null;
  if (refusalCode(result) !== SPECIAL_EVENT_REFUSAL) return null;
  const data = result.data;
  const nested = data && typeof data === 'object'
    ? (data as { error?: unknown }).error
    : undefined;
  const message = result.error ?? (typeof nested === 'string' ? nested : undefined);
  if (!message) {
    // Codex P0 — no fallback sentence invented here. A SPECIAL_EVENT code with
    // no reason is an engine contract break and must surface as one.
    throw new Error('engine returned SPECIAL_EVENT refusal with no error message');
  }
  return message;
}
