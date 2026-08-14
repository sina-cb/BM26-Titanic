# Live Touch implementation proof

**Status:** Implementation and local full-stack proof complete; physical iPad final review pending
**Integration worktree:** `live_touch_bm_readiness_rebase`
**Local branch:** `dev/live_touch_bm_readiness_rebase`
**Base:** local `feat/bm_readiness`
**Date:** 2026-08-13

## Operator contract

This document traces the implementation back to the review discussion:

1. Live Touch must read the canonical Titanic top/front/strands/sign pixel
   views and reproject them when required.
2. Layers are named Deck, Mixer, and Live Touch. Every directed transition is
   the same blend operation. Deck and Mixer use activate/takeover; Live Touch
   becomes active only through ARM.
3. Only the active setting renders at steady state. During a transition only
   the outgoing and incoming settings render.
4. Live brightness is subordinate to the Dimmer Rack. It must never bypass or
   overwrite the rack's global/group ceilings.
5. Live Touch sits under Deck in CaptainPad, inherits the CaptainPad theme,
   and preserves Misha's control layout and feel.
6. Leaving Live Touch for Deck or Mixer disarms it and completes the same
   linear blend before navigation is acknowledged.
7. Non-Layers tabs preserve an armed Live performance. Timeline takeover is
   renewed only by real owner control changes, never by ARM heartbeats; after
   operator inactivity Timeline regains Deck, while the next real Live change
   reacquires takeover through the canonical blend.

## Requirement-to-evidence matrix

| Requirement | Implementation evidence | Executable evidence |
|---|---|---|
| Canonical views and reprojection | `docs/ui/touch_control_pixel_views.js`, generated schema-4 `docs/ui/touch_control_pixel_views.json`, exact simulator-resolved geometry, shared view/camera/resolver fingerprints | `simulation/tests/touch_control_pixel_views.test.js`; artifact check; 15/15 passed |
| Spatial projection identity | Top/Strands `(nx,nz)`, Front `(nx,ny)`, TE Sign `(nz,ny)` with per-view masks and exact nearest-glyph identity | Pure model-coordinate correlation, preview/engine affected-set equality, display-only PAN, and Aerial-camera fingerprint tests |
| Symmetric Front painting | Front displays the canonical 396 Front pixels and sends an identity-pinned 792-pixel Front+Back paint mask | Engine selection test proves visible preview equality plus hidden Back participation |
| TE Sign brush accuracy | Rotated sign declares screen-horizontal `nz`, screen-vertical `ny`; brush scale is calculated per touched sign panel and included atomically in each stroke sample | XS selects 7 local LEDs in the measured center case, all inside the visible circle; reversed-axis engine test rejects row-wide spill |
| iPad brush bounds | rAF-coalesced preview/input, cached static map, DPR cap 2, bounded ink stamps, 0.1/0.5/1.0/1.5 s linear time-to-zero | `simulation/agent_tools/live_touch_brush_perf_test.cjs`; 1,200-sample and 640–1366 px containment gate |
| Three independent Layers settings | `marsin_engine/lib/layer_surface_router.js`, `marsin_engine/lib/pattern_mixer.js` | Six directed transitions, reversal, queue, and render-isolation tests |
| Same transition operation | Canonical router uses the original Deck/Mixer linear byte blend for every pair | HIL forward/reverse midpoint delta: exactly zero per pixel |
| ARM-only Live activation | `docs/ui/touch_control_lifecycle.js`, `docs/ui/touch_control_wire.js`, layer API owner lease | Passive load performs no owner writes; ARM/abort/disarm/deadman tests |
| Exact render participation | One steady renderer; exactly outgoing + incoming during a blend; third setting queued | Router/render-isolation gate in the 91/91 engine suite |
| Full-look isolation | Owner-scoped `live_touch_session_context.js` and pre-blend creative processor | Non-default CPC/effects/paint/palette state survives clean and deadman handback byte-for-byte |
| Rack remains final brightness authority | Live factors applied to the Live look before blend; Dimmer Rack and safety applied once after blend | Rack 0.30 x Live 0.50 rendered ceiling tests, bypass/blackout/parked coverage |
| Versioned brightness truth | Independent monotonic Live and rack revisions in API/WS/client | Reconnect and out-of-order authority tests |
| Canonical group profiles | Default 24-strip bank plus exact 5-view instrument and 4-view performance-plane projections; memberships come from the live MaskRegistry catalog | Real Titanic catalog partitions all 24 groups exactly once; stale/partial/overlap failures; armed Identity fader changed only both TE Sign factors to 0.40 |
| Deck -> Live -> Mixer lifecycle | CaptainPad coordinator plus exact-origin iframe bridge | Deep-link, background, bfcache, superseding destination, timeout, and release-order tests |
| Timeline inactivity authority | Owner-tagged Live mutations renew/reacquire the operator lease; WebSocket pongs renew ARM liveness only; inactivity returns Timeline to Deck without destroying the private Live session | Real-engine short-lease test proves idle handback, no pong renewal, mutation-based reacquire/renewal, and clean release |
| Lease UI | Compact `PlanLockBanner` status is dismissible while takeover is healthy; an active plan-lock warning remains fail-loud and non-dismissible | CaptainPad component/static contract and full TypeScript/Vitest gates |
| Theme without layout redesign | Theme bridge writes color CSS custom properties and color/shadow/border rules only | Gruvbox/Light/System captures; bridge tests; TypeScript and web export |
| Current pattern contract | 128 Five Colour Prism, 129 Five Colour Stations, 130 Spatial Paint | Engine catalog/list and selected-pattern contract tests |
| Baby Reveal integration | 131 Baby Reveal, 132 Baby Tease, 133 Baby Reveal Burst; stable playlist and entry IDs retained; 132 ends in indefinite blackout and never chooses Girl/Boy automatically | Timeline/split/gallery/W+A suite; regenerated four Titanic galleries; obsolete-name guard |
| BM-readiness integration | Rebased on local `feat/bm_readiness`; calibration patterns 66-74 retained | Rebased integration gates and 93-pattern engine list |

## UI preservation proof

The current `touch_control.html` was structurally compared with the rebased
Misha baseline after removing `script`, `style`, and comment nodes:

```text
baseline visible nodes:                         269
current nodes excluding fail-closed diagnostic: 269
ordered tag + id signature equal:               true
baseline/current id count:                      80 / 80
id differences:                                 0
```

The spatial panel now also contains the required generated-view dropdown plus
explicit PAN and FIT controls, and `div#pixelMapError` remains a normally
hidden, fail-closed diagnostic for stale or invalid generated pixel-view data.
The rest of Misha's tuned controls and gestures retain their existing structure.

`docs/ui/touch_control_theme.js` maps CaptainPad palette tokens to existing CSS
custom properties. Its injected rules change background, foreground, border,
shadow, and selected/ARM state colors. They do not set width, height, margin,
padding, position, grid, flex, or typography geometry. Pattern selection,
colour wheel, presets, effects, XY pad, group columns, faders, and locks remain
the controls Misha supplied.

The only CaptainPad navigation change is the required Layers order:

```text
Deck
Live Touch
Mixer
```

## Screenshot evidence

The local proof pack is in `.agent_renders/live_touch_proof/`:

- `01_deck_system.png` — existing Deck surface with Live Touch directly below.
- `02_live_touch_disarmed_system.png` — passive Live tab; Deck remains on air.
- `03_live_touch_armed_system.png` — landed Live ownership; same panel geometry.
- `04_mixer_after_live_handoff.png` — Mixer after serialized Live cleanup,
  landing proof, and ARM release.
- `05_live_touch_disarmed_gruvbox.png` — Gruvbox palette applied to existing
  Live Touch chrome.
- `06_live_touch_disarmed_light.png` — Light palette applied to the same
  controls and geometry.
- `live_touch_brush_perf.png` — isolated real-page 1,200-sample brush gate at
  iPad DPR, after the maximum 1.5 s trail has retired.
- `captainpad_live_touch_front_latest.png` — the embedded CaptainPad panel with
  the canonical Front projection selected.
- `captainpad_live_touch_armed_latest.png` — Live Touch armed and landed on the
  canonical Top-Down projection.
- `captainpad_dimmer_live_still_armed_latest.png` — Dimmer Rack after leaving
  Live Touch for a non-Layers tab; the server retained the same Live owner.
- `captainpad_mixer_after_live_latest.png` — Mixer after the 100 ms Live
  handoff and authoritative ARM release.
- `live_touch_hardened_top_down.png` — Top is a pure X/Z projection with
  `Z+ SHIP FORWARD`; both hulls use the same direction.
- `live_touch_hardened_front.png` — Front X/Y chart with explicit `Y+ UP`;
  the paint mask mirrors the same stroke onto the hidden Back surfaces.
- `live_touch_hardened_te_sign.png` — TE Sign Z/Y chart with explicit axes;
  its rotated display no longer swaps the brush radii.
- `1786594912_aerial.png` — authoritative simulator Aerial camera used for
  visual orientation comparison.
- `1786600798_aerial.png` — fresh read-only Aerial/pixel-mapping capture for
  the orthographic orientation audit.
- `orthographic_shared_top_down.png` / `orthographic_shared_front.png` — the
  simulator's current 2D Pixel Map after removing skew and saved offsets.
- `orthographic_live_touch_top_down.png` — Live Touch rendering the same
  schema-4 resolved Top glyphs, including all 16 auditorium uplights.
- `live_touch_group_profile_instruments.png` — five authored instrument views.
- `live_touch_group_profile_planes.png` — four performance planes; mixed
  underlying levels are visibly marked rather than silently averaged.

The engine readback immediately after capture 04 was:

```json
{
  "active": "mixer",
  "target": "mixer",
  "transition": null,
  "liveTouch": {
    "armed": false,
    "ownerId": null,
    "ready": true,
    "pattern": "130_spatial_paint"
  }
}
```

This is the server-side proof that the screenshot is not merely a selected
tab: Mixer landed, the transition completed, and the Live owner was released.

The latest full-stack lifecycle run additionally captured these exact states:

```text
ARM landed:        active=live_touch, armed=true, owner=touch_control_24477...
Dimmer Rack open:  active=live_touch, armed=true, same owner
Mixer landed:      active=mixer, armed=false, owner=null
```

This proves the revised navigation rule: non-Layers tabs preserve the live
performance, while Deck and Mixer perform the canonical blend and disarm.

## Verification record

- Independent 12-area production audit: no transfer blockers.
- Rebased engine integration: **91/91 passed**.
- Live Touch lifecycle/static contracts: **19/19 passed** at implementation
  handoff; the final independent UI review expanded its focused contract set
  to **18/18** before the passive-write regression test was added.
- CaptainPad focused Vitest: **14/14 passed**.
- Latest focused CaptainPad Vitest: **16/16 passed**; TypeScript passed.
- CaptainPad TypeScript: passed.
- CaptainPad static web export: passed, 25 routes including Live Touch.
- Canonical pixel artifact: current; **14/14 passed**, including pure 3D-axis
  correlation, Aerial camera pinning, Front+Back mirror identity, and the
  bounded TE Sign XS footprint.
- Live Touch brush/UI executable gate: **passed**. Across 640, 768, 1024 and
  1366 px viewports, root/body width equalled the viewport while the group bank
  remained internally scrollable. A 1,200-sample gesture produced 599 preview
  composites over 600 rAF ticks, 0 static rebuilds/reprojections/resizes, 0 long
  tasks, and 0 ink points or pending rAF work 1.7 s after lift. Headless
  SwiftShader cadence was p50 33.4 ms / p95 50.1 ms versus 17.0 ms idle p95;
  this absolute software-renderer number is reported, not treated as iPad
  hardware proof.
- Latest post-orientation brush rerun: **passed** with the same 1,200 inputs,
  599 preview composites, 240 accepted ink stamps, zero static rebuilds,
  reprojections, backing-store resizes, or long tasks, and no remaining ink or
  animation work after the maximum fade. Under a concurrently loaded
  SwiftShader host it measured 150.2/181.3 ms p50/p95 versus 166.8 ms idle p95;
  the incremental p95 overhead was 14.5 ms and is reported rather than used as
  an iPad hardware claim.
- Transition HIL: passed on `/ws/viz`; forward/reverse midpoint equality exact.
- Changed engine JavaScript syntax: passed.
- Engine pattern listing: passed, 93 patterns including Live Touch 128-130 and
  Baby Reveal 131-133.
- Final combined Baby/Live/Timeline/audio-registry gate: **108/108 passed**.
  The four Baby galleries were regenerated after the atomic 131-133 renumber;
  no old Baby 128-130 references or filenames remain.
- Engine dry run: passed with all blend scripts compiled.
- Scoped `git diff --check`: passed apart from expected line-ending notices.
- Latest combined engine/client regression: **63/63 passed**, including the
  100 ms latency window, Mixer readiness, atomic ARM preparation, spatial
  projection/fade, lifecycle, session rollback, and deadman cleanup.
- Measured real-engine Deck/Mixer landing p50 was approximately 123–125 ms
  including 40 fps frame quantization; API acknowledgement p50 was 2–3 ms.
- The freshly exported CaptainPad static route, engine, simulation, save
  service, and both sACN bridges were restarted from this worktree. The
  launcher status reported every endpoint healthy and approximately 7,448
  MarsinEngine sACN packets per five seconds.

## Local launch URLs

After starting the stack from this worktree, use:

```text
CaptainPad:        http://127.0.0.1:6967/
Live Touch:        http://127.0.0.1:6967/touch_control
Mixer:             http://127.0.0.1:6967/mixer
Direct Live panel: http://127.0.0.1:6969/docs/ui/touch_control.html
Simulation:        http://127.0.0.1:6969/simulation/?scene=titanic&profile=pixel_mapping
Engine status:     http://127.0.0.1:6968/status
```

On another device, replace `127.0.0.1` with the host machine's current LAN IP
and set CaptainPad's Config-tab engine URL to that host on port 6968.

## Scope and handoff state

The publish target is `feat/mishas_live_control_panel_sina_changes_some`.
The original feature worktree and the main checkout remain untouched by this
integration transfer. Tracked runtime state residue is deliberately excluded
from the publish commit and reported rather than silently reverted.
