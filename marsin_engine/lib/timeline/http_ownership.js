/*
 * http_ownership.js — semantic ownership classification for Timeline HTTP.
 *
 * The engine's Live Touch lease protects mutations. HTTP method alone is not
 * enough to decide whether a request mutates: POST /timeline/overview accepts
 * an unsaved plan body because it can be too large for a query string, but it
 * only validates and derives an overview in memory. It must remain usable while
 * Live Touch owns the rig and must never count as owner activity.
 *
 * Keep this list exact and deliberately tiny. Adding a route here is an
 * ownership decision: its handler must perform no disk write, state write,
 * dispatch, lease refresh, broadcast, or device output.
 */

const READ_ONLY_BODY_ROUTES = new Set([
  'POST /timeline/overview',
]);

// These requests express an operator's intent to change Timeline-owned show
// state. When Live Touch is armed they must enter the engine's authoritative
// priority handoff before their route handler runs. Keep activity out: a stale
// presence ping is not an operator decision and must never steal the rig.
const TIMELINE_AUTHORITY_MUTATIONS = new Set([
  'PUT /party-config',
  'POST /timeline/plans',
  'POST /timeline/plan/activate',
  'POST /timeline/autopilot',
  'POST /timeline/resume',
  'POST /timeline/takeover',
  'POST /timeline/travel',
  'POST /timeline/program/end',
  'POST /timeline/program/enable',
  'POST /timeline/program/dismiss',
  // PARTY session controls (report 356, P0-2). All three DISPATCH to the deck —
  // FORCE loads the party look, RETURN hands the deck back to the plan's fill,
  // and a cooldown reset re-arms a trigger that fires the moment the music is
  // there. They are operator decisions about Timeline-owned show state and must
  // outrank a Live Touch arm exactly like /party-config does.
  'POST /party/force',
  'POST /party/live-audio',
  'POST /party/cooldown/reset',
]);

const TIMELINE_PLAN_ITEM_MUTATION = /^(?:PUT|DELETE) \/timeline\/plans\/[^/]+$/;
const TIMELINE_CUE_FIRE_MUTATION = /^POST \/timeline\/cues\/[^/]+\/fire$/;

export function isReadOnlyTimelineBodyRequest(method, url) {
  if (typeof method !== 'string' || typeof url !== 'string') return false;
  return READ_ONLY_BODY_ROUTES.has(`${method.toUpperCase()} ${url}`);
}

/**
 * True only for explicit writes whose authority is the Timeline surface.
 * Classification is exact: unknown routes fail through normal routing and do
 * not get the power to disarm Live Touch.
 */
export function isTimelineAuthorityMutation(method, url) {
  if (typeof method !== 'string' || typeof url !== 'string') return false;
  const key = `${method.toUpperCase()} ${url}`;
  return TIMELINE_AUTHORITY_MUTATIONS.has(key)
    || TIMELINE_PLAN_ITEM_MUTATION.test(key)
    || TIMELINE_CUE_FIRE_MUTATION.test(key);
}
