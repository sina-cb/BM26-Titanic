/**
 * Serialize an explicit Timeline handoff from an armed Live Touch surface.
 *
 * The gate deliberately owns no HTTP concerns. Callers classify authority
 * mutations before entering it, await `preempt()`, and dispatch the original
 * mutation only after it resolves. A rejection therefore means the route body
 * must not run.
 */
export function createTimelinePreemptionGate({
  currentLiveTouchOwner,
  forceDisarmLiveTouch,
  confirmLiveTouchReleased,
}) {
  for (const [name, dependency] of Object.entries({
    currentLiveTouchOwner,
    forceDisarmLiveTouch,
    confirmLiveTouchReleased,
  })) {
    if (typeof dependency !== 'function') {
      throw new TypeError(`${name} must be a function`);
    }
  }

  let pending = null;

  return {
    isPending() {
      return pending !== null;
    },

    async preempt(operation) {
      if (pending) return pending;

      const ownerId = currentLiveTouchOwner();
      if (!ownerId) return { preempted: false, ownerId: null };

      const handoff = (async () => {
        const released = forceDisarmLiveTouch(operation);
        if (!released || !confirmLiveTouchReleased()) {
          throw new Error(`Live Touch owner '${ownerId}' did not release`);
        }

        // Yield once so concurrent callers share this exact handoff promise.
        // Do NOT resume/catch-up here: doing that before activate, travel,
        // takeover, cue-fire, or autopilot-off can apply an obsolete plan frame
        // or double-run /timeline/resume. The original route is the one and only
        // Timeline operation dispatched after release.
        await Promise.resolve();
        if (!confirmLiveTouchReleased()) {
          throw new Error(`Live Touch re-armed during Timeline handoff from '${ownerId}'`);
        }

        return { preempted: true, ownerId };
      })();

      pending = handoff;
      try {
        return await handoff;
      } finally {
        if (pending === handoff) pending = null;
      }
    },
  };
}
