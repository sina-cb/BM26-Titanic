/**
 * pixel_surface_visibility (NATIVE) — "is the host actually being looked at?"
 *
 * The native peer of the web module's `document.visibilityState` question
 * (report _252, docs/60 §3.4). On iOS the equivalent of a backgrounded tab is a
 * backgrounded APP: `AppState.currentState` is read at DRAIN time by the paint
 * scheduler's `isVisible()` predicate, so a poll is exactly the right shape —
 * no subscription to leak, and the answer is never stale by more than one
 * frame.
 *
 * `'active'` is the only state that draws. `'inactive'` (the iPad's app
 * switcher, a control-centre pull, an incoming call banner) and `'background'`
 * both cost 0 ms, which is what keeps nine bands free while the operator is
 * anywhere but in front of them.
 */
import { AppState } from 'react-native';

export function isPixelSurfaceHostVisible(): boolean {
  return AppState.currentState === 'active';
}
