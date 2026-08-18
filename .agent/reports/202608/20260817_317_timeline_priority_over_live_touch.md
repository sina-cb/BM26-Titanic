# Timeline Priority Over Live Touch

## Outcome

Timeline authority mutations are explicit, fail-loud Live Touch preemptors. The
engine arbitration gate, exact route classifier, CaptainPad feedback, and real
isolated API matrix are landed and green.

## Incident

An armed Live Touch surface owned the global Touch Control HTTP lease. Timeline
save, activation, cue-fire, time-travel, and Party Mode configuration requests
were therefore rejected by the generic 423 lease gate before Timeline code could
run. The UI told the operator to disarm Live Touch, which inverted the required
authority order: Timeline must outrank Live Touch.

## Authority contract

- Exact Timeline mutations preempt Live Touch: plan create/update/delete,
  activation, cue fire, time travel, takeover, resume, autopilot enable/disable,
  program end/enable/dismiss, and Party Mode configuration.
- `POST /timeline/overview` stays ownerless and read-only. It never disarms,
  renews, or acquires anything.
- `/timeline/activity`, reads, preview near-misses, and unrelated writes do not
  receive Timeline authority.
- The first concurrent Timeline mutation creates one shared engine-side handoff.
  Later Timeline mutations await that same handoff; they do not disarm or resume
  twice.
- Handoff order is atomic: force-clear the ARM lease and parameter source lock,
  confirm Live Touch remains unarmed, then allow each original route to dispatch
  once. The handoff is release-only: unconditionally resuming the old plan first
  would double-apply `/timeline/resume` and could produce an intermediate
  old-plan frame before activate, travel, takeover, or autopilot-off.
- Live Touch re-arm is refused from handoff start through the original HTTP
  response, including asynchronous body parsing. A stale Touch owner
  header cannot demote a Timeline mutation, while stale owner headers on
  non-Timeline mutations retain their existing 409 contract.
- A failed release/confirmation returns 503
  `TIMELINE_LIVE_TOUCH_PREEMPT_FAILED`; the requested Timeline route is not run.
  Live Touch remains disarmed, which is the mission-safe failure state.
- Release itself is synchronous and engine-owned, so it does not depend on a
  client response or silently time out.
- The physical landing uses the existing forced Timeline handback: brightness,
  ARM, and source lock are cleared first; an on-air Live session is held only for
  its outgoing Deck blend and cannot re-arm itself (`autoRearm:false`).

## CaptainPad feedback

Timeline actions now show explicit `PREEMPTING LIVE TOUCH`, success, or failure
feedback. Each attempt has an ID, so a stale completion cannot overwrite a newer
attempt. Plan autosave no longer waits for DISARM, and a force-disarm broadcast
cannot trigger a duplicate retry. A preemption failure retains the local draft
and says the requested operation was not applied.

## Files

- `marsin_engine/lib/timeline/http_ownership.js`
- `marsin_engine/lib/timeline/timeline_preemption_gate.js`
- `marsin_engine/lib/api_server.js`
- `marsin_engine/tests/timeline/http_ownership.test.js`
- `marsin_engine/tests/timeline/timeline_preemption_gate.test.js`
- `marsin_engine/tests/effects/timeline_live_touch_lease_api.test.js`
- `CaptainPad/app/(tabs)/timeline.tsx`
- `CaptainPad/utils/timeline_priority_feedback.ts`
- `CaptainPad/utils/timeline_priority_feedback.test.ts`
- `CaptainPad/utils/timeline_draft_saver.ts`
- `CaptainPad/utils/timeline_draft_saver.test.ts`
- `CaptainPad/components/timeline/timeline_maker_ownership_contract.test.ts`

## Validation

- Timeline ownership classifier and preemption state machine: 10/10 pass.
- CaptainPad Timeline-adjacent slice: 62/62 pass (priority/draft/contract focus:
  18/18).
- CaptainPad TypeScript: pass.
- Touched-file ESLint: pass.
- CaptainPad web export: pass.
- Real isolated API matrix: 1/1 pass. It proves ownerless preview, save,
  activate, cue fire, time travel, Party Mode configuration, stale Timeline
  owner priority, one-disarm concurrency, paused-body re-arm refusal through
  commit, and stale Live-owner rejection.
- Adjacent Live Touch lease/takeover/deadman APIs: 10/10 pass.
- Engine syntax checks: pass.

## Visual and physical gate

The existing read-only CaptainPad stack redirects `/timeline` to Deck while
global Performance mode is active, so it cannot honestly display the new
Timeline feedback state. No mode was changed and no live mutation was attempted.
After the Performance navigation repair is available, capture and inspect web
plus iPad-landscape states for preempting, success, and failure. A physical iPad
smoke remains required for the actual Live-to-Timeline output handoff.

No git operation, deployment, production-service action, rig arm, or live-output
mutation was performed. Isolated test harnesses used redirected state and
TEST-NET output and self-terminated.
