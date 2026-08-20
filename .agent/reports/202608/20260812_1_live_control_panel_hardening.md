# Live Touch layers integration and production hardening

**Integration worktree:** `live_touch_bm_readiness_rebase`
**Local integration branch:** `dev/live_touch_bm_readiness_rebase`
**Base:** local `feat/bm_readiness`
**Date:** 2026-08-12

## Outcome

Misha's Live Touch work was rebased onto BM readiness and implemented as the
third canonical Layers setting beside Deck and Mixer. The work remains
uncommitted and unpushed for Sina's review. The original checkout and its
tracked runtime state were not modified during the transfer.

The canonical settings are `deck`, `mixer`, and `live_touch`. Every directed
pair uses the same linear byte blend. One setting renders at steady state;
exactly the outgoing and incoming settings render during a transition; a third
request queues without rendering.

Live Touch is passive on tab focus. ARM acquires the owner-scoped session,
source lock, and any required timeline takeover before staging and asserting
the Live look. Leaving the tab serializes handback to Deck or Mixer, proves the
landing, cleans the private Live session while its lease is valid, and only
then releases ARM. Background, bfcache, deep-link, deadman, and superseding
navigation paths use the same lifecycle.

## Rendering and authority

- Live Touch owns a private, in-memory creative context: Param Center values,
  palettes, tempo, effects and slots, audio bindings, fixed paint, and spatial
  paint never overwrite the durable Deck/Mixer state.
- Deck, Mixer, and Live creative looks are composed before the canonical pair
  blend. Safety and Dimmer Rack policy run once after blending.
- Live brightness is transient and multiplicative beneath Dimmer Rack ceilings.
  Versioned Live and rack revisions prevent stale WebSocket truth from winning.
- Existing persistent group paint remains underneath Live's transient paint and
  survives clean disarm and deadman byte-for-byte.
- ARM heartbeat proves desk liveness but does not renew Timeline takeover.
  Owner-authorized Live mutations renew the same inactivity lease used by Deck
  and Mixer. When input stops, Timeline reclaims Deck; the next real Live
  mutation reacquires the lease and blends back to Live. Clean handback
  preserves the selected Deck/Mixer destination; deadman resumes the plan
  immediately.

## Pixel views and UI

- Live Touch consumes a deterministic generated artifact from the canonical
  Titanic pixel-map view YAML and the shared resolver. It contains top, front,
  strands, and sign views, verifies source/model/topology fingerprints, and
  fails visibly if any input is stale or malformed.
- The artifact was regenerated after the BM-readiness rebase because that
  branch changed the exported Titanic model fingerprint.
- Live patterns are 128 Five Colour Prism, 129 Five Colour Stations, and 130
  Spatial Paint. BM-readiness calibration patterns 66-73 remain intact.
- CaptainPad orders Layers as Deck, Live Touch, Mixer. The iframe inherits the
  active CaptainPad theme without changing Misha's component geometry.

## Verification

- Independent production review: all 12 acceptance areas passed; no transfer
  blockers remained.
- Rebased engine integration gate: **91/91 passed** (router/render isolation,
  brightness/rack authority, owner-local session, persistence, source lock,
  timeline takeover, ARM/deadman/revert, catalog and WS replay).
- Touch Control lifecycle/static contracts: **19/19 passed**.
- CaptainPad focused Vitest: **14/14 passed**; TypeScript passed; web export
  produced all 25 routes including Live Touch.
- Rebased canonical pixel artifact: current; **9/9 passed**.
- Transition HIL against a disposable engine and `/ws/viz`: passed; midpoint
  forward/reverse per-pixel delta was exactly zero and cleanup completed.
- Full local stack: Titanic sim, Titanic engine (964/964 pixels patched,
  render health OK), and CaptainPad served successfully. Live ARM reached
  `live_touch`; disarm landed Deck and released the owner.
- Passive catalog initialization regression: **19/19** lifecycle contracts
  pass and passive load no longer attempts owner-tagged effect provisioning.
- `git diff --check`: passed apart from Git's expected CRLF notices.

## Known baseline/tooling notes

- Full simulation baseline remains red for pre-existing scene/compression
  assertions, including the operator-authored 5.20 compression gap versus an
  older test threshold. The authoritative view source was preserved.
- Expo's static web build logs expected server-side `ECONNREFUSED` messages when
  the engine is intentionally absent; the export still succeeds.
- The HIL transition script still hardcodes port 6968, so it is not slot-portable.
- A passive pixel canvas logs its explicit fail-closed "waiting for source and
  engine verification" state before asynchronous verification completes.
- Node modules in the integration worktree are local junctions to the reviewed
  worktree so no network install is required; they are ignored by Git.

## Git and state boundary

No files are staged, committed, or pushed. Tracked engine runtime-state residue
from the original worktree was deliberately excluded from the rebased
integration worktree. The local `dev/` branch is a review worktree only and
must not be pushed; promote the result to the requested durable `feat/` branch
only after Sina approves the review.
