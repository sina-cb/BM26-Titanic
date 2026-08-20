// colors_yield_bridge — the testable seam for the L2/L3 navigation triggers
// of docs/61 §2.1 (the YIELD rule).
//
// `app/(tabs)/index.tsx` is a `.tsx` screen vitest cannot render, so the
// DECISION of whether hiding the COLORS window (L2) or leaving the Deck tab
// (L3) stops FOLLOW NOTE cannot be proven by a component test — it has to
// live in a pure `.ts` module the suite can drive directly, the same seam
// `colors_window_logic.ts` is for W1/W2's L1 (the mode-card tap).
//
// This module decides NOTHING new: `yieldDecision` (W1, `colors_window_logic
// .ts`) is still the ONE arbitration function for the §2.1 rule. This is the
// plumbing AROUND it —
//
//   1. "is there even a window to leave" — a HIDDEN COLORS window has no card
//      the operator is leaving, so a gesture that fires while the window is
//      already closed (or was never opened) must never post. L2 is the one
//      exception that still counts as "open": its own gesture runs BEFORE
//      the close it triggers, so it passes `colorsWindowOpen: true`.
//   2. "what happens when it says yield" — fire the bare `{active:false}`
//      stop through the caller's POST path, then narrate the SUCCESS
//      sentence. The FAILURE sentence (`YIELD_FAIL_SAY`) is handed to the
//      caller's `post` as a second argument rather than narrated here,
//      because the caller's POST handler (`handleColorAutopilotChange`) is
//      what actually knows whether the request landed — this module only
//      knows whether the rule fired.
//
// Zero React / React Native imports, exactly like `colors_window_logic.ts` —
// `components/**/*.test.ts` (vitest, node environment) is the only thing this
// module has to satisfy.

import {
  yieldDecision,
  YIELD_FAIL_SAY,
  type ColorsCard,
  type RotationKind,
  type YieldGesture,
} from './colors_window_logic';

export type YieldGestureRun = {
  /** Which navigation gesture is running: L1 ('card', owned by W2), L2
   *  ('hide', the workspace-close chip) or L3 ('tab', the Deck-tab blur). */
  gesture: YieldGesture;
  /** The COLORS card visible at gesture time. */
  card: ColorsCard;
  /** The workspace's `isOpen('colors')` at gesture time. */
  colorsWindowOpen: boolean;
  /** `rotationKind(...)` off the BROADCAST at gesture time — never optimistic
   *  local state. */
  kind: RotationKind;
  /** Offline / plan-locked — suppresses yield exactly like every other
   *  control. */
  disabled: boolean;
  /** Fires the bare `{active:false}` stop. `failNote` is `YIELD_FAIL_SAY`,
   *  handed through so the caller's own POST handler can narrate a
   *  rejected/unreachable request without this module knowing anything about
   *  toasts. */
  post: (patch: { active: false }, failNote: string) => void;
  /** Narrates a SUCCESSFUL yield (`YIELD_SAY`). Never called when the rule
   *  does not fire. */
  say: (message: string) => void;
};

/**
 * Runs one navigation gesture through the §2.1 rule. Returns true iff a stop
 * POST was issued. Never throws on the paths a caller can actually reach;
 * never posts more than once per call.
 *
 * A HIDDEN COLORS window (`colorsWindowOpen: false`) never posts: with the
 * window not open there is no card the operator is leaving FROM, so nothing
 * here can be a "leaving follow-note" gesture. This is the guard that keeps
 * L3 (Deck-tab blur) honest when COLORS was never opened this session, or was
 * already hidden before the operator switched tabs.
 */
export function runYieldGesture(args: YieldGestureRun): boolean {
  if (!args.colorsWindowOpen) return false;
  const decision = yieldDecision({
    gesture: args.gesture,
    leavingCard: args.card,
    kind: args.kind,
    disabled: args.disabled,
  });
  if (!decision.yield) return false;
  if (!decision.post) {
    // `yieldDecision` is total (W1 acceptance: `yield:true` always carries
    // `post:{active:false}`) — this is a defensive cross-check, not a
    // reachable branch, kept because a silent no-op here would be exactly
    // the "operator sees the navigation complete but nothing was stopped"
    // failure mode this whole doc exists to close.
    throw new Error('[colors_yield_bridge] yieldDecision said yield:true with no post body');
  }
  args.post(decision.post, YIELD_FAIL_SAY);
  args.say(decision.say);
  return true;
}
