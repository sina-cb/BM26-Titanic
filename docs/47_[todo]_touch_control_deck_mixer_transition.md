# Layer-setting transitions: Deck, Mixer, and Live Touch

**Status:** Implemented and covered by focused engine/API tests and disposable
engine `/ws/viz` loopback; operator validation pending
**Operator decision:** Deck, Mixer, and Live Touch are independent layer
settings. Every switch uses one canonical linear blend. Deck and Mixer use the
existing activation/take-over behavior; Live Touch requires explicit ARM.

## Authority model

The engine renders three independent settings:

```text
Deck buffer ──────┐
Mixer buffer ─────┼─ canonical two-participant linear blend ─ authority ─ output
Live Touch buffer ┘
```

Only the active setting and the destination setting render during a
transition. When Deck is active it does not render Mixer layers or Live Touch.
The router never combines all three settings at once.

Canonical IDs are `deck`, `mixer`, and `live_touch`. The engine is the sole
authority for active setting, target, transition progress, queued latest
intent, and the Live ARM owner:

```json
{
  "type": "layerSettings",
  "active": "deck",
  "target": "live_touch",
  "transition": {
    "id": "layer-transition-7",
    "from": "deck",
    "to": "live_touch",
    "progress": 0.42,
    "durationMs": 1000,
    "curve": "linear"
  },
  "queued": null,
  "liveTouch": {
    "armed": true,
    "ownerId": "touch-control-...",
    "ready": true,
    "pattern": "130_spatial_paint"
  }
}
```

`progress` is the byte-blend amount used by the established Deck/Mixer
operation. There is no private ARM envelope, blackout dip, or browser-side
crossfade around it.

## Public contract

```text
GET  /layers/state
POST /layers/activate
WS   /ws/control       layerSettings broadcasts and ARM lease messages
```

`POST /layers/activate` accepts:

```json
{
  "target": "deck|mixer|live_touch",
  "durationMs": 1000,
  "reason": "operator reason",
  "ownerId": "required only while Live participates"
}
```

A third destination requested during a blend is stored as the latest queued
intent and returns `202`; otherwise activation returns `200`. The response and
WebSocket broadcast use the same `layerSettings` shape. Clients prove landing
with `active === target`, `target === target`, `transition === null`, and
`queued === null`.

Deck and Mixer activation needs no ARM. Activating Live Touch requires the
matching owner in both the ARM lease and `X-Touch-Control-Owner`. Leaving Live
also supplies that owner while its lease is held. Invalid inputs, mismatched
owners, missing ARM, and PortWatch return typed non-2xx errors; clients do not
guess or fall back.

## Live-local state

Live Touch has its own staged pattern channel:

```text
PUT  /layers/live_touch/pattern
GET  /layers/live_touch/exports
POST /layers/live_touch/control
```

A fresh engine intentionally reports `liveTouch.ready: false`. Passive tab
focus treats that as an online, read-only state and does not stage a pattern.

When an active Live owner calls the existing creative endpoints, the engine
routes the owner-tagged request to an in-memory Live session context rather
than persistent Deck/Mixer/global state. That context contains palette/CPC and
color-transition timing, effect slots and macros, group paint, spatial paint,
effect scope, parked groups, movement/strobe, audio bindings, and local tempo
arbitration. Untagged calls retain their normal durable behavior. A missing or
foreign lease fails loudly. The session has no persistence hook, so saved
shared state stays byte-identical across clean handback and deadman recovery.
The legacy owner-body paint lease also preserves and restores any durable
paint underlay instead of deleting it.

The complete Live-local creative pipeline and Live brightness factors run on
the Live buffer before the canonical blend. Shared Dimmer Rack, blackout, and
output authority run after the blend. Preparing or performing a Live look
therefore cannot alter the outgoing Deck/Mixer buffer.

Pixel effects use the canonical numeric blend. DMX-only effects such as fog
cannot be interpolated; their private setting state remains on the outgoing
side until the pixel transition lands, then switches at the same transaction
boundary. Blackout remains authoritative for both controllers.

## Explicit ARM sequence

Opening or focusing the Live Touch tab is inert. The ARM control performs one
serialized transaction:

1. Verify the engine effect catalog and the canonical generated pixel-view
   artifact against the current engine model.
2. Announce the owner over `/ws/control` and wait for a positive ARM lease
   acknowledgement.
3. Only after the lease exists, stage the selected Live pattern and read its
   authoritative exports.
4. Initialize exhaustive Live brightness and assert the complete owner-scoped
   creative state.
5. `POST /layers/activate` with target `live_touch` and the matching owner.
6. Poll `/layers/state` until the linear blend has landed.
7. Display `ARMED` only after that proof.

This ordering is required: the engine rejects every owner-tagged mutation
before the lease exists. If any post-lease step fails, the client first lands a
Deck handback if Live became a participant, clears owner-scoped state while the
lease is still valid, requests lease release, waits for its acknowledgement,
and only then reports DISARMED. Cleanup failure retains the handoff curtain and
does not acknowledge success.

ARM is also the explicit operator take-over gesture for an active Timeline
plan. Live activation atomically acquires the same take-over authority and
clears the plan pin. The ARM socket heartbeat proves only that the Live desk is
still connected; it does **not** count as operator activity. The Timeline
operator lease is renewed by owner-authorized Live mutations, using the same
inactivity contract as Deck and Mixer. If no control changes arrive before the
lease expires, Timeline reclaims Deck even while the private Live session
remains armed. The next real Live mutation reacquires the operator lease and
returns to Live through the canonical blend. Passive focus never changes the
plan. PortWatch is a hard lock and refuses activation.

CaptainPad shows the same lease countdown over Live Touch as it does over Deck
and Mixer. The countdown notice is deliberately compact and dismissible so it
cannot cover performance controls; dismissing it changes presentation only.
The non-dismissible plan-lock warning returns when Timeline owns the output.

On a clean Live handback, ARM stops renewing the takeover but does not resume
the plan immediately: the existing operator lease transfers to the selected
Deck/Mixer surface. Its normal activity can renew it, or it expires and the
plan catches up. This prevents a Live -> Mixer handback from landing Mixer and
then being yanked straight back to the plan's Deck. Deadman recovery is
different: it resumes the plan immediately as part of automatic-show recovery.

ARM also acquires the shared Parameter Center source lock in the engine and
restores the exact pre-ARM lock on release. This prevents WS, MIDI, OSC,
modulation, and unrelated API writers from mutating the shared Deck/Mixer look
while the one Live desk owns the performance. Live CPC and tempo writes are
routed to the private session, not through that shared lock.

## Destination handback

Selecting Deck or Mixer while Live is armed performs:

1. keep the ARM lease and owner-scoped Live context alive;
2. activate the exact requested destination through `/layers/activate`;
3. wait until that destination has landed;
4. clear all owner-scoped Live transient state;
5. request `touchControlArmed:false` and wait for the engine acknowledgement;
6. acknowledge the CaptainPad navigation request and remove its curtain.

The engine retains the lease after the visual landing so cleanup remains
authorized. It destroys the in-memory Live context when release completes.
Deck patterns, Mixer faders, Dimmer Rack values, automatic writers, and their
durable creative state are never captured, muted, restored, or deleted by Live
Touch.

Rapid route changes use latest-destination semantics. If a newer destination
arrives while the first handback is running, the first operation may land, but
the parent does not navigate until the latest requested destination is itself
activated and proven landed. There are no parallel handbacks.

## CaptainPad lifecycle

The CaptainPad provider owns a global handoff curtain and a strict,
exact-origin iframe bridge:

```text
Parent -> child: captainpad-surface-focus
Parent -> child: captainpad-surface-blur { requestId, target, reason }
Child  -> parent: touch-control-surface-released { requestId, target }
```

Behavior:

- normal sidebar selection is intercepted before navigation;
- route actions and focus loss derive the actual Deck/Mixer destination, so a
  programmatic or deep-link Mixer jump cannot silently hand back to Deck;
- AppState/background and document visibility request a Deck handback while
  the iframe and WebSocket are still alive;
- bfcache restore cancels a frozen ARM into normal cleanup or resumes an armed
  Deck handback; it reaches DISARMED authoritatively and never reactivates;
- page teardown starts a keepalive Deck blend, while the engine deadman owns
  final context cleanup if JavaScript cannot await it;
- theme messages are presentation-only and cannot ARM or activate a setting.

Mixer keeps its established plan gate: passive Mixer focus does not override
an active Timeline plan; explicit `TAKE OVER` activates Mixer. Deck focus and
explicit Deck selection activate Deck. All of those calls use the same layer
router as Live.

## Failure and crash behavior

- Another ARM owner is rejected before staging.
- Stale owner-tagged HTTP writes return `TOUCH_CONTROL_LEASE_INACTIVE` or an
  owner mismatch; they never become untagged global writes.
- A lost WebSocket triggers engine-owned handback and context destruction.
- Only the socket currently bound to the ARM owner can renew the ARM and
  Timeline takeover leases; a replaced socket cannot keep them alive.
- Client cleanup errors remain visible and prevent release acknowledgement.
- Engine restart begins with Live unstaged, unarmed, and non-participating.
- No browser cleanup handler is the sole safety mechanism.

## Validation contract

Automated checks cover:

- three-setting router state, linear progress, latest-intent queuing, and only
  two render participants;
- ARM lease before staging, every setup assertion before activation, and no
  activation after assertion failure;
- fresh unstaged passive focus remaining online and mutation-free;
- owner-scoped CPC, tempo, effects, scope, parked groups, slots, audio
  bindings, fixed/spatial paint, and brightness not changing shared runtime or
  persistent state;
- competing WS and OSC writes rejected during ARM and accepted after exact
  source-lock restoration;
- clean release and deadman preserving non-default durable group paint;
- Deck/Mixer/Live transition continuity and Dimmer Rack authority;
- exact destination handback, cleanup-before-release, release ACK, background,
  deep-link, and superseding-destination races;
- absence of legacy `/arm-fade`, source-lock, Deck pattern mutation, Mixer
  fader muting, Mixer master, section-brightness, and rack writes in Live wire.

Before show approval, capture Deck -> Live, Mixer -> Live, Live -> Deck, and
Live -> Mixer frames against loopback output. No frame may go unexpectedly
black or jump outside the configured linear blend. Exercise Timeline takeover,
PortWatch refusal, backgrounding, socket loss, and cleanup failure before a
real-rig test.

## Acceptance criteria

1. Passive Live Touch focus performs no mutation or activation.
2. Only explicit ARM can activate Live Touch.
3. Deck, Mixer, and Live Touch all switch through one linear layer operation.
4. Only the active/transition pair renders; Deck never renders other settings.
5. Live setup and performance state is isolated from durable Deck/Mixer state.
6. Every exit lands the requested destination, cleans up, releases ARM, and
   receives authoritative acknowledgement before navigation unlocks.
7. Background, reload, stale messages, and disconnect cannot leave an
   unowned Live look controlling the rig.
8. Dimmer Rack and shared safety authority remain downstream of every setting.

## Deliberate exclusions

- Live Touch is not temporary ownership of Deck.
- It does not hard-swap the Deck pattern or restore a captured snapshot.
- It does not mute Mixer layers or rewrite Deck/Mixer autopilot state as part
  of look preparation. The engine does acquire and exactly restore the shared
  CPC source lock for one-desk exclusivity.
- It does not add an ARM fade envelope around the canonical blend.
- It does not ARM from tab focus, theme change, reload, or reconnect.
