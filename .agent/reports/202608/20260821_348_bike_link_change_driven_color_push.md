# Bike Link change-driven shared-color push

## Outcome

Benchmarking rejected a shorter fixed cadence: it improves latency by sending
unnecessary traffic even when Color 1 and Color 2 are idle. Bike Link now uses
a change-driven path for actual shared global Color 1/2 changes, with a 100 ms
coalescing window and a one-second start-to-start flood guard. The existing
10-second idle keepalive remains unchanged.

The subscription is attached only to the shared ParamCenter. Same-value writes,
non-color global parameters, normal global effects, and Live Touch's separate
session-private ParamCenter do not trigger Bike Link. The public Bike Link API
has not been broadened, and controller pushes remain sequential.

CaptainPad describes the contract honestly: shared color changes are coalesced
and pushed at most once per second, while the 10-second idle keepalive maintains
leases.

## Benchmark decision

Normalized two-controller measurements:

| Candidate | Color readback latency | Idle requests/min/bike |
|---|---:|---:|
| Fixed 10 s baseline | 9.015 s | 5.71 |
| Fixed 5 s | 4.008 s | 11.43 |
| Fixed 2 s | 1.021 s | 28.57 |
| Change-driven + 10 s idle keepalive | p50 12 ms, p95 931 ms | 5.71 |

During deliberate rapid color activity, the production scheduler delivered
the newest value with p95 latency of 931 ms at two targets, 962 ms at 16, and
1.028 s at 64. Normalized active-window traffic was 54.51, 54.54, and 50.01
requests/min/bike respectively. This is bounded activity traffic, not a new
idle rate. The 64-target run remained strictly sequential with maximum HTTP
concurrency one and zero push failures.

Event-loop-delay p95 was 11.30 ms for the fixed-10-second baseline and
11.29/11.33/11.44 ms for change-driven runs at 2/16/64 targets. The 25 ms probe
p95 was 26.40 ms at baseline and 26.44/26.40/26.41 ms for the same target
counts. No degradation was measured.

An isolated real engine running a normal animated pattern held its normal
observed 39 FPS with 16 linked mock controllers. Forty rapid shared-color API
writes coalesced to one push cycle, one sequential request per controller, with
zero failures. Twenty normal effect toggles added zero Bike Link requests.

## Reliability evidence

- Real spawned-engine HTTP e2e: shared Color 1/2 change reached controller API
  readback within the two-second test bound; 40 rapid writes coalesced to one or
  two pushes and the final readback matched.
- Same-value Color 1/2 writes, a speed write, and normal effect toggles produced
  zero extra controller requests.
- Existing lease-renewal, stop-and-restore, timeout counting, STALE transition,
  and automatic relink tests remain green.
- Unsupported firmware remains loud and has no fallback write path.
- High-scale burst coverage proves exactly one request per linked target and
  maximum concurrency one.
- The isolated harness now explicitly disables fire sync in addition to OSC,
  web-client, audio, and hardware output paths.

No real-controller run was needed: the real engine/API plus mock-controller API
e2e reproduced the production protocol and supplied the required timing and
flood evidence. The operator-owned production link and its controllers remained
outside the final isolated validation.

## Changed files and selective integration

Production behavior:

- `marsin_engine/lib/bike_color_share.js` — change scheduler, flood guard, and
  observable counters.
- `marsin_engine/engine.js` — only the Bike Link shared-ParamCenter subscription
  and shutdown-unsubscribe hunks. Do not copy this large file wholesale over a
  newer main checkout.
- `CaptainPad/components/BikeColorLinkCard.tsx` — only the latency/keepalive copy
  hunk; preserve the already-integrated dedicated page.
- `CaptainPad/utils/api.ts` — only the added BikeShareStats fields.

Focused evidence:

- `marsin_engine/tests/io/bike_color_share.test.js`
- `marsin_engine/tests/io/bike_color_share_api.test.js`
- `marsin_engine/tests/io/bike_color_change_wiring.test.js` (new file)
- `marsin_engine/tests/e2e/timeline_e2e_harness.mjs` — only the
  `fire_sync.enabled=false` isolation hunk.
- `CaptainPad/components/bike_link_logic.test.ts`
- `CaptainPad/components/bike_link_route.test.ts`

Do not copy `CaptainPad/dist`, scratch benchmarks, runtime YAML, engine state,
launcher files/locks, or any worktree-wide file wholesale. Main may contain
newer unrelated work in every existing file above; integrate the named hunks.

## Validation commands after integration

```powershell
cd marsin_engine
node --check engine.js
node --test tests/io/bike_color_change_wiring.test.js tests/io/bike_color_share.test.js
node --test tests/io/bike_color_share_api.test.js

cd ../CaptainPad
npx vitest run components/bike_link_logic.test.ts components/bike_link_route.test.ts utils/captainpad_tab_policy.test.ts
npm run typecheck
npm run lint
npm run web:build

cd ..
python scripts/security_check.py --all
```

Worktree results: engine Bike Link focused 26/26 pass; CaptainPad focused 54/54
pass; TypeScript pass; lint zero errors with nine unrelated existing warnings;
offline web export pass including `/bike_link`; isolated TEST-NET engine dry-run
and syntax pass; repository security scan pass.

## Operator handoff

This changes engine runtime behavior, so the launcher-owned engine must restart
after selective integration. The CaptainPad copy changed, so run
`node launcher.js rebuild-pad` and reload the iPad as well. Do not copy a
worktree build directory.

On MAIN, confirm both approved controller identities remain LINKED and leased,
then change shared global Color 1/2 and verify both controller color API
readbacks update promptly. Confirm a rapid color-wheel burst converges to the
final value without failures, and STOP LINK when the physical check is done.

## Operator acceptance

Physical production testing passed. Both approved bikes linked successfully, and shared global color changes were visually smooth. This satisfies the operator acceptance gate for the change-driven Bike Link path.

All isolated high-port processes are stopped and the validation ports are down.
No commit or push was made.
