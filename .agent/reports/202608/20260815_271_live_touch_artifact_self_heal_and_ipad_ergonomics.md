# _271 — Live Touch pixel-view artifact self-heals at the source; iPad ergonomics contract (docs/66)

**Role:** Fable debug+fix agent, operator-ordered ("use fable to debug this
and try to fix for good — I am seeing this a few times now"), plus the
addendum ("design for proper touch controls and optimize for iPad …
TOP PRIORITY"). Two deliverables, one session.

---

## Deliverable 1 — "PIXEL VIEW UNAVAILABLE … stale against cameras.yaml", fixed for good

### Root cause (proven live, not inferred)

The Live Touch panel (`docs/ui/touch_control_pixel_views.js` `load()`)
fetches the derived artifact `docs/ui/touch_control_pixel_views.json` plus
its live inputs (`pixel_map_views.yaml`, `cameras.yaml`, the two resolver
sources), SHA-256s each input, and fails CLOSED on any fingerprint mismatch.
The artifact is produced by
`simulation/tools/export_touch_control_pixel_views.mjs`
(`npm run pixel-views:export`).

The recurrence: **saving a camera view preset in the sim**
(`view_presets.js saveCameraPresets()` → save-server `/save-cameras` →
`scenes/titanic/cameras.yaml`) changes a fingerprinted input, and *nothing*
re-exported the artifact. Report `_223` had added a re-export to
`/save-pixel-map-views` only; every other input write — cameras above all,
plus model saves, views.yaml splits, git pulls and hand edits while the
stack was down — left the artifact stale until a human remembered the
manual export (done by hand on 2026-08-14, and again needed since).

Smoking gun at session start: the working tree held uncommitted operator
edits to `cameras.yaml`, and the artifact's `camerasFingerprint` was the
ONLY stale one (views/resolver/model all matched). The operator's red
screen was live on disk.

### The fix — ownership, not a fallback

The save server is the only runtime writer of the artifact's inputs, so it
now owns the derived file's freshness (`simulation/server/save-server.js`,
one shared `refreshTouchPixelViews(trigger)` helper):

- **at boot** — heals anything edited while the stack was down;
- **after `/save-cameras`** (the recurring trigger), **`/save`** (which
  splits out views.yaml, a resolver-registry input that previously went
  *silently* stale — the panel never fingerprints it), **`/save-model`**
  (base `titanic.js` only; the effects/viewmasks burst companions are not
  exporter inputs), and **`/save-pixel-map-views`** (refactored onto the
  helper) — all gated on scene `titanic`.

Verification is NOT weakened: the exporter remains the single resolver
implementation; its write is now idempotent by content (byte-identical ⇒
loud no-op); a genuine export failure leaves the old artifact in place so
the gate still refuses, logs the named error, and appends a WARNING with the
remedy to the (still-200) save response — the operator's edit is never lost
and never silently un-verified. Under the `SIM_SAVE_SERVER_ROOT` test
override the exporter gets `--out <tmp>` (new explicit flag), so tests
exercise the real wiring without touching the tracked artifact (the old
SIM_ROOT-anchored spawn simply failed under the override; also fixed by
anchoring the exporter path on `__dirname`).

Refusal copy now names the fix: `…stale against cameras.yaml — restart the
sim stack (the save server re-exports it at boot) or run: cd simulation &&
npm run pixel-views:export`.

**Cost:** one exporter run ≈ 150 ms per qualifying save. Files:
`simulation/server/save-server.js`,
`simulation/tools/export_touch_control_pixel_views.mjs`,
`docs/ui/touch_control_pixel_views.js`, and the regenerated
`docs/ui/touch_control_pixel_views.json` (healed against the operator's
current cameras.yaml).

### Proof, both directions

- **New regressions** `simulation/tests/touch_artifact_freshness.test.js`
  (9/9): boot export exists before any save and is byte-identical to a
  direct exporter run; `/save-cameras`, `/save`, `/save-pixel-map-views`
  regenerate; non-titanic scenes don't; a forced export failure (directory
  squatting on the artifact path) yields 200 + WARNING naming
  `pixel-views:export` while the cameras write lands, the server survives,
  and the next save heals; source pins on all five triggers and the remedy
  copy.
- **Browser proof** (scratch static serve :17969, puppeteer, live stack
  untouched; engine topology injected from the real Titanic model exactly as
  the wire does): stale cameras overlay → full-pane refusal naming source +
  remedy, `canArm() === false`
  (`.agent_renders/live_touch_stale_refusal.png`); true bytes →
  static+engine verified, error hidden, spatial pane draws glyphs,
  `canArm() === true` (`live_touch_verified_pane.png`).
- **Sim suite:** 2418 tests, 2410 pass; the 7 reds are the known foreign
  scene/bench set (fixture docking, scene-block parity CLI, display
  orientation) — identical names to the `_268` foreign list, none touch
  `docs/ui` or the save server.

### Operator activation

- **Immediately:** the artifact on disk is already regenerated — reloading
  Live Touch on the running stack goes green now (the panel fetches
  `no-store`; the sim's static server serves the file live).
- **Next sim restart:** picks up the save-server code (boot re-export + the
  new save triggers). From then on the manual-export class is gone —
  camera saves, layout saves, scene saves and model saves keep the artifact
  fresh automatically, and a boot heals offline edits.

## Deliverable 2 — iPad ergonomics contract: `docs/66_live_touch_ipad_ergonomics.md`

Built ON the just-shipped docs/65/_268 declutter (read first; nothing it
landed is redesigned). Measured the post-_268 panel at the **11-inch**
viewports (1194×834 / 834×1194) with a 151-control
`getBoundingClientRect` audit per orientation — measured, not read from CSS.

Headlines (full tables in docs/66):

- **150 of 151 controls are under the 44 pt floor**; ARM itself is 32 pt
  (a pinned safety surface), TAP is 24 pt, ON TIME pills are 28×17 with
  3 px gaps (10 px wide in portrait).
- **Two 11-inch-only P1 defects the 12.9-inch validation never saw:**
  portrait meter strip balloons to **420 px** of dead space (container
  stretch — child `.meter-bars` stays 46 px) with overlapping card labels;
  groups pane clips mid-column with no overflow affordance.
- Wheel is 153/124 px at 11" (vs the 248 px measured at 12.9).

Contract: hit-region-vs-visual-size doctrine (the palette slot rows already
PASS at 46 pt via wrapper padding — the recipe), performance/setup hit
tiers, one-up pane stacking below ~900 px width, W0–W5 items sized for the
standing pipeline, five operator decision points (incl. whether the
landscape topbar may grow to give ARM 44 pt), pins carried forward (embed
transport, docs/61 narration, frozen gestures, safety surfaces ≥44 pt and
never hideable). App-wide note: the audit harness is reusable for deck/
mixer/dimmer tabs, and the 11" viewports should join every future wave's
acceptance matrix.

## Ledger

- Live stack (6966–6981, 5568) untouched; all captures on scratch serves
  :17968/:17969, closed after use. No git operations. No engine started
  (topology injected from the model file).
- Tracked writes: the four fix files above, the new test file, docs/66,
  this report, tracker block, one dossier row.
- Scratch: `~/tmp/live_touch_freshness_proof/` (proof harness +
  `control_audit.json`); captures in `.agent_renders/`.
- Follow-ups for the board: docs/66 W0–W5; residual (accepted) gap — an
  agent hand-editing scene YAML with the stack RUNNING still needs a save,
  a restart, or the manual export before Live Touch reloads green.
