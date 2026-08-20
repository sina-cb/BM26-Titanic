# Live Touch production stabilization

## Outcome

Live Touch is independently validated offline and is a GO for the operator's
physical-iPad smoke. Production acceptance is intentionally still pending that
device round. No launcher, live service, production output port, physical ARM,
rig, or real sACN destination was touched.

The work began from observable failures and traced the complete UI, native
WebView bridge, owner lease, REST/WS reconciliation, session authority, and
engine state path. Deterministic pre-fix tests reproduced the reported pattern,
Effects, Color, and Preset failures before implementation.

## Proven failure points and authority decisions

- Pattern selection immediately repainted the chooser from the old engine
  state, hiding the pending target. Malformed ambient catalogs could leave a
  partial chooser. The engine's PatternMixer already owned the correct 500 ms
  transition, overlap refusal, and A/B animation; UI reconciliation and catalog
  readiness were repaired without adding a second transition owner.
- Effect presses gated on nonexistent `#armControl` rather than the real ARM
  element. Hold actions never emitted `/up`. Performance authority was
  incomplete in both the client and owner-scoped engine session, including
  atomic prepare and audio bindings. The catalog and engine slot status are now
  authoritative; Performance permits runtime actions only, while Edit owns
  configuration.
- Color Hub had no scroll owner at constrained landscape heights while the
  native WebView itself is non-scrolling. Color Hub now owns one deliberate
  vertical scroll surface; the stacked layout retains its existing outer owner.
- Preset writes omitted the Live Touch owner header, migration marked success
  before imports completed, validation admitted stale topology, and recall
  could claim active before asynchronous writes/readback settled. Presets now
  validate before mutation, carry lease ownership, use strict mutation and
  readback barriers, and remain inactive on partial failure with an actionable
  DISARM -> ARM recovery message.

## Implementation scope

UI and hermetic browser coverage:

- `docs/ui/touch_control.html`
- `docs/ui/touch_control_wire.js`
- `simulation/tests/live_touch_ui_layout.test.js`

Engine authority and focused coverage:

- `marsin_engine/lib/api_server.js`
- `marsin_engine/lib/live_touch_session_context.js`
- `marsin_engine/tests/effects/live_touch_session_performance_authority.test.js`
- `marsin_engine/tests/effects/live_touch_background_entry.test.js`
- `marsin_engine/tests/mixer/live_touch_base_swap.test.js`
- `marsin_engine/tests/state/live_touch_presets.test.js`

No new pattern content was created. PatternMixer production code did not need a
change: focused tests proved its existing exact transition behavior.

## Final panel matrix

| Panel / state | Result | Accepted evidence |
| --- | --- | --- |
| Header, chooser, ARM | PASS | Native/web captures; authoritative catalog plus all three instrument patterns stage exactly; selected, actual, target, phase, and failure state reconcile truthfully. |
| Pattern transition | PASS | A and B both animate through the crossfade, B carries phase after landing, completion is exactly 500 ms, and overlap refuses with `EBUSY`. |
| Spatial | PASS | Full-map and hidden/reopened captures; single-contact add and erase compose over the moving background; stale contacts and lifecycle cleanup pass; ARM safety is unchanged. |
| Color + Legacy Color | PASS | Shared palette authority and cross-updates pass; authoritative crossfade settles; 900x560 constrained Color reaches the last action through one scroll owner. |
| Effects — Edit | PASS | Every displayed control is catalog-backed; assignment/configuration persists through PATCH plus readback; toggle, trigger, hold, pending, and failure states are truthful. |
| Effects — Performance | PASS | Sparse authoritative slots only; one permitted `/press` reconciles toggle intent; hold uses `/down` then `/up`; zero slot, group, color, or audio configuration writes. |
| Presets | PASS | List, load, save, broadcast reload, apply, settled active state, two-step delete, malformed/stale refusal, lease rejection, and partial-failure recovery pass. |
| Groups | PASS | Full controls are visible and stable; profile/group authority and writes pass without clipping or flicker. |
| Audio | PASS — offline scope | Full rail is reachable; meters retain read-only presentation; configuration is locked with an explicit Edit-required state in Performance and re-enabled in Edit. |
| Native/web/layout | PASS — offline scope | Native bridge ordering, bfcache/handoff, 1024x682 and 1194x834 landscape, desktop web, and constrained split allocation pass. |
| ARM/pixel verification | PASS | Lease-first staging, document-scoped verification, hidden-Spatial ARM, no-cache/embed contracts, and failure-closed behavior remain intact. |

## Automated validation

- Hermetic Live Touch UI and evidence suite: **20/20 pass**.
- Accepted guarded engine focused suite: **50/50 pass**.
- Engine contract suite: **54/54 pass**.
- Pattern/Spatial/creative pure suites: **38/38 pass**.
- Wire contract suite: **35/35 pass**.
- Simulation embed/pixel/ARM suite: **74/74 pass**.
- CaptainPad focused Vitest: **31/31 pass**.
- CaptainPad full Vitest: **2,443 pass, 6 skip, 0 fail**.
- CaptainPad TypeScript: **0 errors**.
- Touched-file lint: **0 errors**. Full lint retained 10 unrelated existing
  warnings.
- Pixel-view artifact check and touched JavaScript syntax checks: PASS.

Accepted process harnesses used temporary state/config, random high HTTP ports,
TEST-NET sACN, and disabled fire-sync and production OSC. During independent
validation, a combined command accidentally included the explicitly excluded
OSC isolation test. It bound and sent only on `127.0.0.1:31570`, touched no
production port, rig, or hardware, and is excluded from the accepted counts.
It was not rerun.

## Screenshot evidence

The independent validator visually inspected all 17 named, non-alias captures
in `C:/Users/Titanic's End/tmp/live_touch_stabilization_evidence/`:

- native iPad landscape: header/ARM, Color, Legacy Color, populated Presets,
  successful settled recall, lease refusal, and partial-apply error;
- web desktop: header/ARM, named pending A -> B, full/reopened Spatial,
  hidden Spatial, Edit Effects, sparse Performance Effects, Groups, and Audio;
- constrained split: 900x560 Color Hub scrolled to its final action.

The frames are clean and readable. Red ribbons appear only in the deliberate,
actionable Preset refusal captures.

## Remaining risks

- Preset recall is barrier-verified but not transactionally rolled back. A
  rejected write leaves the row inactive and reports the partially applied
  operation plus the required DISARM -> ARM recovery. This is loud and
  recoverable, but not all-or-nothing rollback.
- Physical WKWebView lifecycle, real audio input, touch feel, and live rig
  behavior remain operator-only validation.

## Physical-iPad smoke

Use the operator's already-running prod/titanic CaptainPad. Do not restart the
stack merely for this checklist.

1. Confirm CONNECTED, DISARMED, pixel verification ready, and no unexplained
   error ribbon. ARM and verify owner plus ARMED state.
2. Exercise every background and instrument chooser option. Each must show the
   named A -> B transition for about 0.5 s, keep both patterns moving during
   the crossfade, land on the selected actual pattern, and refuse a rapid
   overlap visibly without substitution.
3. With a background moving, make one Spatial add stroke and one erase stroke.
   Confirm only the local area changes, the background continues, and the full
   pixel map survives hide -> reopen and app background -> foreground.
4. In Performance, test one toggle, one trigger, and one hold. Confirm no
   configuration controls are active and the states reconcile to the rig. In
   Edit, change an assignment, confirm persistence, then round-trip Edit ->
   Performance -> Edit.
5. At landscape half-height, scroll Color Hub to every last action. Change the
   palette from Color and Legacy Color in both directions and verify immediate
   cross-updates plus STOP/RUN crossfade settlement.
6. Save and name a Preset, reload its list, recall it, and confirm the row only
   becomes active after the full look settles. Delete it through the confirmed
   two-step action. Verify disarmed recall and a second-owner lease are refused
   loudly without stale active state.
7. Open Groups and operate the profile/fader/all-off controls; confirm no
   clipping or jump. Open Audio, confirm real meters, Performance lock, and
   Edit re-enable behavior.
8. Rotate once and background/foreground CaptainPad. Confirm lease, ARM,
   selected pattern, actual engine pattern, and panel state remain synchronized.
9. DISARM when finished. Capture any failure with the header, owner state, and
   full actionable ribbon visible; do not retry around or bypass a safety gate.

## Final offline closeout

The later physical failure `ABORT CLEANUP INCOMPLETE ... POST /movement-rate ->
409` was reproduced and removed. DISARM now deactivates each active authoritative
overlay slot through `/global-effect-slots/{slotId}/deactivate`, reads back zero
active effects, and only then releases the Live Touch lease. The retired
`/movement-rate` route is never used for cleanup.

Final focused evidence: cleanup 36/36; TAKE 10/10; transport/lift 9/9; Spatial
map parity 17/17; ARM brush 7/7; shared projection 55/55; overlay cleanup 16/16;
aggregate Live Touch 72/72. Independent manager reruns passed spatial stroke
9/9 and engine session/wire/timeline-preemption 40/40 on a random high port,
TEST-NET sACN, and temporary state. Full CaptainPad passed 2591 with six hardware
skips, zero failures. Physical-iPad acceptance remains intentionally open.

## Deferred post-stability follow-up

Qualify true multi-touch Spatial painting only after this stability round. The
current implementation already contains bounded multi-contact behavior, but
this task deliberately added no multi-touch code, experiment, flag, or
architecture. Add a Notion Backlog card titled **“Live Touch: qualify true
multi-touch Spatial painting after stability”** when the configured Titanic
tracker connection is available. The connection was not available in this
task, so no tracker mutation was attempted.

No git operation was run.
