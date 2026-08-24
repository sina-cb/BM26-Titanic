// Tiny UI-only request broker between the compact plan-status tile and the
// floating lease notice. The tile and notice deliberately own no shared
// operational state: the engine remains authoritative for the lease itself.

type PlanLeaseNoticeListener = () => void;

const listeners = new Set<PlanLeaseNoticeListener>();

export function requestPlanLeaseNotice(): void {
  for (const listener of listeners) listener();
}

export function subscribePlanLeaseNoticeRequests(
  listener: PlanLeaseNoticeListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
