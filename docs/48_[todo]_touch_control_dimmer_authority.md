# Live Touch brightness under Dimmer Rack authority

**Status:** Implemented; rendered authority and disposable-engine loopback
validated, operator validation pending
**Operator decision:** Live Touch faders remain normalized 0–100%
performance controls. They scale only the Live Touch setting and can never
raise, overwrite, persist, repair, or bypass the authoritative Dimmer Rack.

## Authority invariant

For a Live pixel in Dimmer Rack group `g`, on each of the six RGBWAU lanes:

```text
live_look = clamp(pattern + Live-local effects/paint, 0, 1)
live_surface = live_look * live_master * live_group[g]
pair_surface = linear_blend(outgoing_surface, incoming_surface, progress)
output = blackout
  ? 0
  : clamp(pair_surface, 0, 1) * arm_envelope * rack_ceiling[g]
```

`live_master` and every `live_group` are transient, neutral at `1`, and owned
by the active ARM lease. `rack_ceiling` remains the persistent Dimmer Rack
value. The shared rack and blackout run once after the canonical setting
blend. Live cannot set per-lane dimmer-bypass flags; a blend involving Live
clears such scratch flags before rack authority runs.

Examples:

| Rack | Live group | Live master | Maximum output |
|---:|---:|---:|---:|
| 30% | 100% | 100% | 30% |
| 30% | 50% | 100% | 15% |
| 30% | 50% | 50% | 7.5% |
| 0% | 100% | 100% | 0% |

An intentional zero rack value stays zero. Mission-level never-dark policy
must be explicit in the Dimmer Rack or automatic-show policy; Live Touch does
not silently repair it.

## Render placement

The implementation has two different authority scopes:

```text
Live pattern
  -> Live-local CPC / effects / fixed paint / spatial paint / master
  -> transient Live brightness
  -> canonical Deck | Mixer | Live Touch linear pair blend
  -> creative clamp
  -> shared arm envelope
  -> authoritative section Dimmer Rack
  -> blackout / sACN
```

`LiveBrightnessController.applyBuffer()` runs only on `liveTouchBuffer`. It
never scales the outgoing Deck/Mixer surface or the already-blended buffer.
`IntensityController.apply(model.pixels)` remains the single shared
post-blend rack/blackout stage.

Putting Live brightness after its complete local creative chain is important:
group zero also suppresses Live fixed color, spatial paint, strobe, movement,
and other effect output—not only the base pattern. Putting the rack after the
pair blend makes a rack change authoritative on the next frame, including
mid-transition.

## Runtime state

Live brightness is an in-memory controller state:

```ts
type LiveBrightnessState = {
  active: boolean;
  ownerId: string | null;
  revision: number;
  master: number; // finite [0,1]
  groupsBySectionId: Map<number, number>; // exhaustive, finite [0,1]
  masterFade: null | {
    from: number;
    to: number;
    startedAtMs: number;
    durationMs: number;
  };
};
```

The public contract uses stable model group names. The API translates those
names to runtime section IDs only after validating the complete model group
set. This state is never passed to `StateManager` and never written to
`globals_state.yaml`, `mixer_state.yaml`, a playlist, or a Deck channel.

## API contract

```text
GET   /touch-control/brightness
PUT   /touch-control/brightness
PATCH /touch-control/brightness
POST  /touch-control/brightness/master/fade
```

`GET` returns the complete operator truth:

```json
{
  "active": true,
  "ownerId": "touch-control-…",
  "revision": 42,
  "rackRevision": 9,
  "master": 0.8,
  "groups": { "Left Front Wall": 0.5 },
  "rackCeilings": { "Left Front Wall": 0.3 },
  "effectiveCaps": { "Left Front Wall": 0.12 },
  "masterFade": null
}
```

- `PUT` is an exhaustive atomic assertion used during ARM and preset recall.
- `PATCH` is a strict, non-empty partial gesture update.
- `master/fade` is an engine-clocked transient master fade.
- Every mutation supplies the current `expectedRevision`.
- Values must be finite numbers in `[0,1]`; there is no coercion.
- Unknown, missing, duplicate-section, stale-revision, unarmed-owner, and
  foreign-owner requests fail before mutation.
- Mutations require `X-Touch-Control-Owner` matching the active ARM lease.

The control WebSocket broadcasts and replays:

- `touchControlBrightness`, including the brightness revision, rack revision,
  exhaustive factors, rack ceilings, and effective caps;
- `dimmerState`, including a process-lifetime monotonic rack revision and the
  exhaustive stable-name ceiling table.

The Live client ignores stale rack messages and can resynchronize with `GET`.
Revisions are runtime concurrency guards, not persisted identities.

## Write gates and persistence

While ARM is held:

- an owner-tagged Live request to `/section-brightness` is rejected with
  `TOUCH_CANNOT_WRITE_DIMMER_RACK`;
- an owner-tagged `PATCH /mixer` containing `master`, or a Live request to
  `/mixer/master/fade`, is rejected with
  `TOUCH_CANNOT_WRITE_MIXER_MASTER`;
- an untagged Dimmer Rack write remains allowed and increments the rack
  revision;
- other mutating clients remain subject to the one-desk ARM lease gate.

A rack update writes the existing durable rack state and broadcasts both the
new rack authority and recalculated Live effective caps. Live gestures do not
call a save path. The automatic-show deadman does not raise or repair an
all-zero rack.

## Lifecycle

1. A positive ARM acknowledgement creates an exhaustive neutral brightness
   state for the owner.
2. The surface sends one strict full `PUT` reflecting all visible Live faders.
3. Gestures use revisioned patches; presets may use a full replacement and an
   engine-clocked master fade.
4. During Live handback, the factors remain alive through the outgoing blend
   and the post-landing owner cleanup window.
5. Explicit `touchControlArmed:false` discards brightness and the private Live
   context atomically after landing.
6. On socket loss/deadman, the engine preserves the outgoing Live look through
   its Deck blend, then resets brightness and destroys the private session on
   transition completion.
7. Engine restart begins inactive and neutral.

Deck/Mixer rack values, Mixer master, and their state-file bytes are unchanged
by every Live lifecycle path.

## Implemented files

- `marsin_engine/lib/live_brightness_controller.js`
- `marsin_engine/lib/touch_brightness_api.js`
- `marsin_engine/lib/live_touch_creative_processor.js`
- `marsin_engine/lib/intensity_controller.js`
- `marsin_engine/lib/api_server.js`
- `marsin_engine/lib/ws_topic_routing.js`
- `marsin_engine/engine.js`
- `CaptainPad/live_touch/touch_control_wire.js`

## Automated evidence

Focused tests cover:

- all six lanes, neutral/reset behavior, strict atomic validation, stale
  revisions, clock-backwards fades, and buffer/model mismatch;
- full Live creative output—including fixed/spatial paint and effects—under
  Live group/master factors;
- over-range creative output under an absolute rack ceiling;
- writable Dimmer Rack authority during ARM, monotonic rack broadcasts/replay,
  and unchanged persistent rack/Mixer files;
- owner mismatch, unarmed writes, forbidden old master/rack paths, clean
  handback, and deadman reset;
- a real-engine session proving Live state and persistent shared state remain
  isolated.

The remaining show-validation step is loopback frame capture at representative
rack values, followed by a gated real-rig test.

## Acceptance criteria

1. Dimmer Rack is the only persistent group ceiling and remains writable while
   Live is armed.
2. Live 0–100% scales monotonically inside the current rack ceiling on all six
   lanes and across every Live creative path.
3. Live cannot increase, overwrite, persist, repair, or bypass a rack value or
   Mixer master.
4. Clean release, abort, socket loss, deadman, and restart clear only transient
   Live factors.
5. Shared rack/blackout authority remains downstream of every layer setting.
