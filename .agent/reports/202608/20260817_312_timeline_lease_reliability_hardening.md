# Timeline lease and reliability hardening

## Incident

On a physical iPad, Timeline maker preview failed while Live Touch held ARM:

`POST /timeline/overview` returned `423 TOUCH_CONTROL_LEASE_HELD` because the
global HTTP lease gate treated every body-bearing POST as a mutation. The route
only validates an unsaved plan and builds a derived overview; it performs no
state, disk, lease, broadcast, dispatch, or device write. CaptainPad compounded
the problem by claiming that a valid draft still auto-saved even though the
separate save POST was rejected by the same lease.

The failure was reproduced against an isolated real engine before editing, on a
random high HTTP port with temporary config/state, TEST-NET sACN, auth disabled,
and OSC/fire-sync/device output disabled.

## Ownership contract

- `POST /timeline/overview` is the sole body-bearing read-only Timeline route.
  It neither requires a Live Touch owner header nor renews any owner activity.
- Plan save, activation, cue fire, time travel, and party configuration remain
  mutations. An unowned request receives 423 while Live Touch is armed; a stale
  owner receives 409; an explicit current owner may mutate without stealing or
  releasing the ARM lease.
- CaptainPad never borrows the Live Touch owner for background Timeline work.
  Preview and save have separate status. Only an acknowledged save of the exact
  current draft version may display `SAVED`.
- A held save stays local and retries after observed DISARM/reconnect. In-flight
  DISARM edges are retained; older completions cannot overtake a newer draft or
  loaded plan.
- Every draft version clears older preview data and errors before deriving its
  own overview. A failed preview cannot leave stale cues on screen.
- Authored plan replacement is atomic. Active-plan saves preflight runtime-state
  persistence, roll authored/runtime plan state back after hot-reload failure,
  and serialize save/activation mutations so overlapping requests cannot mix
  two plans across disk, memory, and execution.

## Implementation

CaptainPad:

- `app/(tabs)/timeline.tsx`
- `hooks/useTimeline.ts`
- `utils/timeline_draft_saver.ts`
- `utils/timeline_draft_saver.test.ts`
- `utils/timeline_ownership_api.test.ts`
- `components/timeline/timeline_maker_ownership_contract.test.ts`

Engine:

- `lib/api_server.js` (serialized integration by the Live Touch owner)
- `lib/timeline/http_ownership.js`
- `lib/timeline/show_plan.js`
- `lib/timeline/timeline_service.js`
- `tests/effects/timeline_live_touch_lease_api.test.js`
- `tests/timeline/http_ownership.test.js`
- `tests/timeline/save_write_honesty.test.js`
- `tests/timeline/timeline_service.test.js`

The Live Touch owner serialized the shared `lib/api_server.js` integration
after freezing its stabilization work. The reviewed helper now runs in both
the lease-conflict classifier and the successful-owner-activity wrapper. Both
hooks are required: skipping only the first would allow preview but an
owner-tagged preview could still renew the Timeline lease.

## Validation

- CaptainPad Timeline suite: 76/76 PASS.
- CaptainPad focused race/ownership suite: 15/15 PASS.
- CaptainPad touched-file ESLint: PASS.
- CaptainPad web export: PASS.
- Engine Timeline suite, including the final serialization test: 450/450 PASS.
- Engine ownership/atomic focused tests: PASS.
- Exact isolated armed-Live-Touch API regression: 1/1 PASS. It covers ordinary,
  owner-tagged, invalid, and eight parallel previews; protected writes; stale
  and active owner writes; DISARM; and released-owner rejection.
- Adjacent Live Touch takeover, priority, and layer-settings APIs: 5/5 PASS.
- Engine touched-file syntax: PASS.
- Scoped `git diff --check`: PASS.
- Independent read-only validation: PASS with no remaining blocker, including
  the final `api_server.js` integration, armed-owner real-engine matrix,
  late-completion, mid-flight DISARM, persistence-preflight, rollback,
  ownership-ordering, and overlapping-save probes.
- Full CaptainPad TypeScript: BLOCKED by unrelated concurrent errors in
  `app/(tabs)/audio.tsx`, `components/audio/audio_native_route.test.ts`, and
  `components/deck/color_control_core_browser.test.ts`; no Timeline file appears
  in compiler diagnostics.

## Visual evidence

- Native iPad BEFORE (operator capture):
  `.agent_renders/timeline_hardening/before_native_ipad_1880x1280.png`
- Web BEFORE (isolated armed engine, 1280x900):
  `.agent_renders/timeline_hardening/before_web_1280x900.png`
- Web AFTER (isolated armed engine, 1280x900):
  `.agent_renders/timeline_hardening/after_web_1280x900.png`
- Web iPad-landscape AFTER (isolated armed engine, 1880x1280):
  `.agent_renders/timeline_hardening/after_web_ipad_landscape_1880x1280.png`

All captures were visually inspected. The native BEFORE shows the original
false autosave claim. The web BEFORE shows the same 423 after UI hardening.
Both AFTER captures show the derived schedule during ARM, explicit local
unsaved/waiting-for-DISARM state, no preview error, no stale content, no layout
collision, and zero browser console errors. A true physical-iPad AFTER capture
remains a hardware smoke gate and cannot be replaced by a web viewport.

## Physical-iPad smoke

1. Open Timeline with Live Touch disarmed; confirm preview and acknowledged save.
2. ARM Live Touch and keep it armed; Timeline preview must continue with no 423.
3. Edit a valid draft; confirm `NOT SAVED — LIVE TOUCH IS ARMED`, never `SAVED`.
4. Make rapid edits; confirm no stale preview or older-plan reversion.
5. DISARM during an in-flight save refusal; confirm the retained latest draft
   retries once and becomes `SAVED` only after engine acknowledgement.
6. Re-ARM, disconnect/reconnect the pad, and confirm ownership remains truthful.
7. Attempt activation, cue fire, and travel while ARM is held; confirm visible
   lease refusal and no partial execution.
8. DISARM and repeat the actions; confirm normal execution and completion.

## Remaining risk

The physical-iPad AFTER smoke and screenshot are still required. The authored
plan rollback can restore disk and in-memory/runtime derivation after a hot-load
failure, but an external device dependency that fails after partially applying
a multi-step cue cannot provide a hardware transaction; that failure is surfaced
loudly and the prior plan is reapplied best-effort.
