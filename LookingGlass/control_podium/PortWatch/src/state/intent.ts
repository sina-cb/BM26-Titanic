/**
 * intent.ts — pure helpers for reconciling optimistic command intents
 * against authoritative engine values arriving via compact-status PUBs.
 *
 * Lives in its own module so it's trivially unit-testable (no
 * react-native / zustand / BLE imports anywhere in the dep graph).
 * The store imports `reconcileIntent` and applies it field-by-field
 * inside `setEngineStatus` — see `store.ts` for the wiring.
 */

/**
 * Generic single-value command intent shape. The optimistic value
 * the operator just selected, plus liveness metadata.
 *
 *   value    The thing the operator picked (pattern name, playlist
 *            name, blackout bool, brightness number, …). Reads as
 *            canonical until the engine confirms or overrides it.
 *   pending  True while the bridge hasn't ACK'd yet ("we don't know
 *            if the engine has heard us"). Flipped to false by
 *            markIntentResolved() in the bridge-ACK callback.
 *   setAtMs  Wall-clock millis at intent creation. Used by future
 *            stale-intent UX (e.g. fade after N seconds); reconcile
 *            itself doesn't read it today.
 */
export interface Intent<T> {
  value: T;
  pending: boolean;
  setAtMs: number;
}

/**
 * Reconcile a pending intent against the latest engine-reported
 * value. Returns the intent to KEEP, or `undefined` to drop it
 * (drop = "let the canonical engine value show through; no overlay").
 *
 * Decision table:
 *
 *   intent absent                            → undefined (nothing to do)
 *   engineValue === null                     → keep      (no signal yet)
 *   engineValue === intent.value             → undefined (round-trip
 *                                              success — drop the
 *                                              optimistic overlay)
 *   engineValue !== intent.value, pending    → keep      (still in the
 *                                              optimistic window;
 *                                              operator's tap is en
 *                                              route)
 *   engineValue !== intent.value, !pending   → undefined (CRITICAL:
 *                                              the bridge has ACK'd
 *                                              our cmd — engine has
 *                                              heard us — yet the
 *                                              engine state still
 *                                              disagrees. Either a
 *                                              concurrent CaptainPad
 *                                              write clobbered us, or
 *                                              the engine intentionally
 *                                              rejected the value. In
 *                                              both cases the engine
 *                                              wins; without this
 *                                              branch the LIVE chip /
 *                                              picker highlight would
 *                                              stay pinned to the
 *                                              operator's stale tap
 *                                              forever, which is the
 *                                              "CaptainPad changes
 *                                              playlist, PortWatch
 *                                              doesn't update" bug
 *                                              the user reported.)
 *
 * `T` is the same on both sides on purpose (no widening): we want
 * strict equality, not coercion, so a boolean intent of `true` can't
 * accidentally match an engine value of `1`.
 */
export function reconcileIntent<T>(
  intent: Intent<T> | undefined,
  engineValue: T | null,
): Intent<T> | undefined {
  if (!intent) return undefined;
  if (engineValue === null) return intent;
  if (engineValue === intent.value) return undefined;
  if (!intent.pending) return undefined;
  return intent;
}
