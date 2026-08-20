# CaptainPad privileged Performance mode and Spatial fullscreen proof

**Date:** 2026-08-14  
**Branch:** `dev/bm_readiness_local`  
**Worktree:** `C:/Users/Titanic's End/workspace/BM26-Titanic-worktrees/live_touch_bm_readiness_rebase`

## Outcome

CaptainPad now has one server-authoritative global Performance mode and a
separate per-device privileged Edit session. Audio Companion and the 2D
Simulator are privileged CaptainPad tabs. Live Touch Spatial / XY can occupy
the complete browser viewport without reloading its iframe or changing ARM
state. The final source is running on the operator stack at port 6967.

Physical two-iPad acceptance is still an operator gate. The automated,
browser, restart, and security evidence in this report is green.

## Implemented contracts

### Global Performance and per-device Edit

- Global Performance remains engine-owned and affects every CaptainPad.
- Privileged Edit is device-local. Authenticating one iPad never unlocks a
  second iPad.
- The global sidebar is the single Performance control. An authenticated
  device can either relock itself or explicitly end global Performance using
  the existing keep, keep-and-save, or restore choices.
- The optional remembered session is server-pinned to 30 minutes. A transient
  session is memory-only.
- Reconnect, expiry, invalidation, engine-origin change, and engine restart all
  fail closed. Engine restart resumes the global Performance lock while
  invalidating the old per-device token.
- The per-tab policy is centralized. Existing tabs are currently unchanged;
  the operator can specify later which controls each tab hides in Performance.

### Authentication boundary

- Passphrases live only in the external private deployment secrets file. The
  public repository contains key names and validation logic, never values.
- The launcher requires the three configured private identities, rejects
  missing or duplicate entries before spawning the stack, and enables required
  auth explicitly for the engine child.
- The engine compares credential digests with timing-safe comparisons and
  stores only opaque session-token digests.
- Login is rate limited. Auth responses are `no-store`; tokens are scoped to
  the issuing engine origin and never attached to arbitrary URL probes.
- Auth endpoints are isolated from Live Touch ownership/activity accounting.
  Login, validation, and logout cannot steal or renew the Timeline/Live lease.
- Error paths redact YAML source excerpts so malformed private files cannot
  print credential material.

### Privileged embedded tools

- **Audio Companion** derives the active engine host and embeds port 6966.
- **2D Simulator** derives the same host and opens port 6969 with the
  `2d_pixels` and `sacn_in` profile.
- Both surfaces unmount on focus loss so hidden analyzers/render loops do not
  consume iPad resources.
- Both tabs are hidden in unauthenticated Performance and their direct routes
  fail closed before an iframe or WebView mounts.

### Spatial / XY true fullscreen

- The Live iframe remains in its original DOM position and retains the same
  browsing context. CaptainPad temporarily elevates the iframe's full ancestor
  stacking chain above the sidebar, then restores every original inline style.
- The child Spatial panel moves within its own document to fill its viewport;
  unrelated Live controls become inert and hidden until Exit.
- PAN, pinch/wheel zoom, +/- zoom, FIT, and paint gestures are arbitrated so
  navigation never emits paint and multi-touch paint never pans.
- Enter, Exit, route teardown, and host cleanup are explicit. No orphaned
  fullscreen iframe or elevated stacking context remains.

## Additional live-console fixes

- Deck's entry-label editor now reads the role-aware Deck playlist endpoint
  instead of repeatedly calling the Mixer endpoint for `ch_base`.
- Web playlist rows no longer render an outer HTML button around inner reorder
  and remove buttons. Native button semantics remain unchanged.
- Titanic's legacy saved SIZE value now converges atomically to the intentional
  0.5 identity lock before boot restore, even when normal Auto Save is off.
  Clean boots no longer show a permanent false DEGRADED chip. Real runtime
  attempts and stale recalled snapshots remain visible and fail closed.

## Automated evidence

| Gate | Result |
|---|---|
| CaptainPad TypeScript | PASS |
| CaptainPad full Vitest | 59 files; 1067 pass; 6 hardware skips |
| CaptainPad lint | PASS, 0 errors; 13 existing warnings |
| CaptainPad Expo web export | PASS; 29 routes |
| Live Touch layer/wire contract | 26/26 PASS |
| Canonical pixel-view suite | 16/16 PASS |
| CaptainPad Live bridge | 7/7 PASS |
| CaptainPad auth API, including crash/restart and Live/Timeline isolation | 4/4 PASS |
| SIZE lock migration/restart/snapshot suite | 18/18 PASS |
| Launcher credential preflight regression | PASS |
| Public-repository security scan | PASS; no leaks found |
| `git diff --check` on the completed slices | PASS |

The auth-required restart regression proves this sequence on isolated high
ports: authenticate, enter Performance, SIGKILL, respawn the same state, resume
global Performance, reject the old token, reject unauthenticated structural
writes, authenticate again, and explicitly exit. A separate integration test
proves auth requests leave the active Live owner and Timeline lease expiry
unchanged.

## Actual operator-stack visual proof

The final proof ran through the rebuilt CaptainPad at
`http://127.0.0.1:6967/`, not a component mock. The browser viewport was
1366x900.

- Before: iframe at `112,0`, size `1254x900`.
- Fullscreen: iframe at `0,0`, size `1366x900`, fixed above all 13 host
  ancestor stacking contexts.
- The child Spatial panel filled `1366x900`; the rest of the child shell was
  inert.
- Unique host-owner and child-Window markers survived enter and exit, proving
  zero iframe reload.
- PAN moved the view `80/55` with zero paint pointers. Zoom reached 1.25x and
  FIT returned to `1/0/0`.
- Exit restored the original iframe bounds and all ancestor z-index values.
- ARM stayed DISARMED before, during, and after. Bridge diagnostics were empty.

Screenshots:

- `.agent_renders/captainpad_header_clean_20260814.png`
- `.agent_renders/live_touch_operator_6967_before_fullscreen.png`
- `.agent_renders/live_touch_operator_6967_fullscreen_fit.png`
- `.agent_renders/live_touch_operator_6967_fullscreen_pan_zoom.png`
- `.agent_renders/live_touch_operator_6967_after_exit.png`

The images were visually inspected: fullscreen contains only the Spatial
controls and model, with no CaptainPad sidebar or neighboring-panel bleed; Exit
returns to the same Live Touch layout. A fresh post-migration CaptainPad load
shows the green LIVE chip with no DEGRADED/SIZE warning and no console errors.

## Live stack at handoff

The launcher is running the `dev` profile with scene `titanic`. The simulator,
save service, sACN in/out bridges, engine, Audio Companion, and CaptainPad are
all responsive. The engine is actively driving approximately 7,486 sACN
packets per five-second status sample.

After the SIZE migration restart, `/status` reported
`sizeLockWarning: null`, `sizeLock.clean: true`, `sizeLock.locked: 0.5`,
`renderHealth.ok: true`, and no deck-restore degradation.

Operator URLs:

- CaptainPad: <http://127.0.0.1:6967/>
- Audio Companion: <http://127.0.0.1:6966/>
- Engine status: <http://127.0.0.1:6968/status>
- 2D Simulator: <http://127.0.0.1:6969/simulation/?profile=2d_pixels&lighting_mode=sacn_in>

## Remaining operator gate

Complete sections 11-13 of
`.agent/reports/202608/20260813_4_bm_readiness_operator_test_matrix.md` on both
physical iPads: independent privilege, remembered-session expiry, embedded
surface focus lifetime, direct-route denial, real touch pan/zoom, multi-touch
paint, and Exit restoration. Record the result before selective staging and
durable branch promotion.
