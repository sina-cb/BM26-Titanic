# `_301` — Live Touch native ARM "pixel view is not verified": root cause proven

**Date:** 2026-08-17 · **Agent:** Fable (exclusive owner of this diagnosis;
Codex Live Touch task paused) · **Phase:** DIAGNOSIS ONLY — no product source
changed. Repro harness: `~/tmp/live_touch_arm_repro/repro.mjs` (9/9 PASS,
fully offline, zero live ports touched).

All line numbers below are the **current working tree** (Codex-modified
files, deliberately not reverted).

---

## 1. Root cause — one sentence

ARM setup couples the **safety verification** (artifact + engine topology,
correctly visibility-independent, and it PASSES on the iPad) to the **screen
projection** (built only when the Spatial canvas has nonzero layout size),
because `padWorldPerPx` throws the same `'pixel view is not verified'` string
for two different conditions — `!staticVerified` **or** `screenGlyphs`
empty — and with the Spatial panel docked (`display:none`) the projection is
never built, so a fully verified page still aborts ARM with a message that
falsely indicts verification.

## 2. The exact throwing call path

Press ARM (Spatial docked, Color+Effects open):

1. `docs/ui/touch_control_wire.js:1294-1302` — ARM click → `startArmChain(true)`
2. `:1286-1287` — `armLiveTouch().catch(err => abortArm('arm setup', err))`
3. `:1230-1246` — `TouchControlLifecycle.arm({ verify, acquireLease, stage, assertState, … })`
   - `verify` = `verifyArmReadiness` (`:866`) → `verifyPixelViewArmReadiness`
     (`:876`) → `chartDriftCheck` (`:512`) — **PASSES on the iPad**
     (artifact + 964/964 topology + fingerprints all good; host banner
     cleared by the `status:'ready'` publish, which is exactly why no
     WAITING/CHECKING/FAILED diagnostic is visible in the screenshot)
   - `acquireLease`, `stage` — pass
4. `assertState` = `assertLiveSurfaceState` (`:1146`) → at `:1179` calls
   `initialSpatialPrepareBody()`
5. `initialSpatialPrepareBody` (`:1096`) — `:1100 currentViewSpec()` passes
   (view selection is visibility-independent), then `:1106 brushPatch()`
6. `brushPatch` (`:1992`) → `padBrush()` (`:1984`) →
   `window.padBrushWorld(undefined)` — `padBrush` guards a null RETURN, not
   a THROW, so the exception sails through
7. `docs/ui/touch_control.html:4362-4370` — `padBrushWorld` → `padBox()`
   (`:4351`; `#xyPad` is inside the docked panel, rect is 0×0, the `|| 1`
   fallback hands back `{w:1,h:1}`) → `window.padWorldPerPx(1, 1, target)`
8. `docs/ui/touch_control_pixel_views.js:709-711` — **the throw**:
   ```js
   if (!state.staticVerified || !state.screenGlyphs.length) {
     throw new Error('pixel view is not verified');
   }
   ```
   `staticVerified === true`, `engineVerified === true`, `canArm() === true`
   — but `screenGlyphs` is `[]`.
9. Rejection propagates → `abortArm('arm setup', err)` (`wire.js:684`) →
   `fail('arm setup - ABORTED', …)` → the embedded red pill in the
   screenshot: `arm setup - ABORTED: pixel view is not verified`.

### Why `screenGlyphs` is empty when Spatial is hidden

- `.panel.is-docked { display: none; }` — `touch_control.html:322`; docking
  is applied by `loadLayout()` (~`:8867`) from the persisted
  `bm26_touch_layout_v2` store.
- `state.screenGlyphs` has exactly ONE writer: `rebuildBase()`
  (`touch_control_pixel_views.js:529`), whose only caller is `draw()`
  (`:560`), which early-returns on a zero-size canvas (`:548-550`:
  `if (!width || !height) return;`). The `ResizeObserver` (`:1174`) never
  fires with nonzero size for a `display:none` canvas.
- `TouchPixelViews.mount()` (`touch_control.html:6193`) runs unconditionally
  at page init, so **verification** (fetch + SHA-256 + engine topology)
  completes fine while hidden — only the **screen** projection cannot exist.

### Sister sites sharing the same conflated message

`padPxToWorld` (`pixel_views.js:673`), `worldToPad` (`:697`) throw the same
string for `!staticVerified` only; `padWorldPerPx` (`:710`) is the one that
also throws it for the empty-projection case. The three must stop sharing
one message (see fix contract).

## 3. Why web passes and native fails

**It is not a platform difference — it is per-device persisted panel
layout.** `bm26_touch_layout_v2` lives in each runtime's localStorage. The
operator's iPad has Spatial docked (visible in the screenshot's HIDDEN row)
and the WebView document had never had Spatial open since load, so
`screenGlyphs` was never built. Web test sessions had Spatial visible (or
had opened it at least once — see the stale-projection hazard below), so the
projection existed and the same code passed. A web browser with Spatial
docked from boot will abort identically — predicted by the repro, and worth
one adversarial check in the impl wave's browser proof.

**Proof (offline, 9/9):** `~/tmp/live_touch_arm_repro/repro.mjs` loads the
real runtime + real artifact + real YAML/resolver sources, stubs only DOM:

- zero-size mount → `staticVerified=true`, `readyStatus=fulfilled`,
  `staticRenderCount=0`, `reprojectCount=0`
- real 964-pixel `marsin_engine/models/titanic.js` topology →
  `engineVerified=true`, **`canArm()===true`**
- `currentViewSpec()` works hidden (720 paint pixels)
- `padWorldPerPx(1,1)` → throws exactly `'pixel view is not verified'`
- set canvas 1024×520 + fire the runtime's own ResizeObserver → projection
  builds, same call returns `{x:0.00114, y:0.00217}`
- **Bonus hazard:** after visible→hidden toggle, the STALE projection still
  answers (nothing clears `screenGlyphs` on dock) — so ARM with Spatial
  hidden-after-toggle would stage a screen-derived radius against `padBox()`
  `{w:1,h:1}`, i.e. a min-clamped 0.01 world radius, silently. The fix
  contract removes ARM's dependence on the screen path entirely, which also
  kills this second bug.

## 4. Eliminated failure classes (proven, not assumed)

- **Native bridge / diagnostics (class 3):** no bug. Host banner clears are
  prefix-scoped — theme acks clear only `LIVE TOUCH THEME…`
  (`CaptainPad/app/(tabs)/touch_control.tsx:403`), verification `ready`
  clears only `LIVE TOUCH PIXEL VERIFICATION…` (`:359-361`). The banner is
  absent in the screenshot because verification genuinely SUCCEEDED; the
  later ARM-setup abort is never published to the host (only
  `verifyPixelViewArmReadiness` publishes `failed`, and it passed).
- **Pre-verification ARM ordering (class 2):** verify runs first and
  passes; the throw is downstream in `assertState`. The "different call
  path" hypothesis was right in spirit: the raw message comes from the
  projection helpers, not the instrumented verifier (whose failures are
  prefixed `canonical pixel-view verification failed:` /
  `…completed without ARM readiness`).
- **Focus/onLoad ordering (class 4):** the protocol-gated
  verifier-ready/start handshake (`wire.js:452-566`,
  `touch_control.tsx:178-343`) held; verification completed exactly once
  with status `ready`.
- **Transport pins:** `buildTransport` / `__captainpadDeliver` /
  `captainpad_embed` all present in `docs/ui/touch_control_theme.js`
  (`:96`, `:354`, `:16`) — not moved.

## 5. Minimal-fix contract (for the `_302` Opus-managed Sonnet wave)

Never weakens verification; no fallback; Spatial stays wherever the operator
put it; web ARM semantics unchanged; topology verification and canvas
mounting fully separated.

**A. `docs/ui/touch_control_pixel_views.js`**
1. **Split the conflated guard.** `'pixel view is not verified'` is reserved
   for `!state.staticVerified` (all three sites: `:673`, `:697`, `:710`).
   The `screenGlyphs`-empty condition in `padWorldPerPx` (and any other
   screen-path helper) gets its own loud error, e.g.
   `'pixel view has no on-screen projection — the Spatial panel is hidden'`.
   Never conflate again.
2. **Add a canvas-independent world-brush API** (name suggestion:
   `worldBrushRadii(fraction, target)`):
   - Refuses loudly unless `state.staticVerified && state.engineVerified`
     (distinct messages per missing gate — verification is NOT skipped or
     faked; the same two booleans that gate `canArm()` gate this).
   - Reprojects the current view into a **canonical design-space viewport**
     — `reprojectView(state.view, state.artifact.design,
     design.width, design.height, 0, 0, 1)` — a pure computation, no
     canvas, no DOM, cacheable per view id (invalidate in `selectView`).
   - Computes per-axis world-per-px with the **same panel-scoped extent
     math** as `padWorldPerPx` (extract the shared extent helper; do not
     duplicate it — remember the H7 hoist lesson at `wire.js:2011-2020`).
   - Returns `{x, y}` world radii = `fraction × viewportWidth × per`,
     clamped to the exact `padBrushWorld` bounds (x∈[0.01,1], y∈[0.01,2]).
   - This is scale-invariant for the width-limited fit, so at default
     pan/zoom it reproduces today's visible-pad numbers (repro measured
     per.x = 0.0011375 at 1024w ⇒ radius identical to canonical to within
     float noise).
3. Do NOT auto-build screen projections for hidden canvases, and do NOT
   clear or fake verification state anywhere in this change.

**B. `docs/ui/touch_control.html`**
4. Next to `padBrushWorld` (`:4362`), add
   `window.padBrushWorldCanonical = function (target) {
     return window.TouchPixelViews.worldBrushRadii(brushPadFrac(), target);
   };`
   Page keeps owning the SIZE fraction; the chart keeps owning the world
   mapping — the same single-ownership split as today. No panel/layout
   changes; Spatial is never auto-opened or force-mounted.

**C. `docs/ui/touch_control_wire.js`**
5. `initialSpatialPrepareBody()` (`:1106`) replaces `brushPatch()` with the
   canonical read: missing `padBrushWorldCanonical` → throw (no silent
   fallback to the screen path, no engine-default fallback). Map to
   `{radius: min(1, r.x), radiusY: min(2, r.y)}` exactly as `brushPatch`
   does today.
6. The live stroke path is UNTOUCHED: `pushXY` → `brushPatch(sp)`
   (`:2274`), the ring, `padToWorld` (`:2247`) all still require the real
   on-screen projection — which is inherently satisfied because a hidden
   pad cannot be touched. Spatial painting may keep requiring a visible,
   mounted projection; ARM ownership no longer does.

**D. CaptainPad native — no changes required** for this root cause. The
verifier handshake, retention, and prefix-scoped clears are correct as-is.

**Semantic note for the reviewer:** the ARM-staged *initial* radius becomes
canonical (deterministic, independent of the operator's current pan/zoom)
on web as well. Today it silently depended on live viewport state; the first
stroke re-asserts the screen-true size anyway (`wire.js:2259-2274`).
Observable ARM semantics on web are unchanged: same success/refusal
behavior, same verification gates.

**Rejected alternatives:** force-mounting/off-screen-rendering the hidden
canvas (alters layout semantics, wasted redraws, still screen-coupled);
auto-opening Spatial on ARM (mutates the operator's layout — forbidden);
tolerating empty `screenGlyphs` and skipping radius staging (fallback —
forbidden).

## 6. Regression spec (implemented by `_302`)

**Node-level (extend `simulation/tests/touch_control_pixel_views.test.js`,
reusing the `~/tmp/live_touch_arm_repro/repro.mjs` stub-DOM technique):**
1. Zero-size mount → full static + engine verification passes;
   `canArm()===true`; `staticRenderCount===0`.
2. `worldBrushRadii(frac)` succeeds with the canvas at 0×0; finite positive
   radii; identical across repeated calls, across viewport sizes, and
   before/after visible→hidden→visible toggling.
3. Hidden-but-verified `padWorldPerPx` now throws the NEW projection
   message, not `'pixel view is not verified'`; unverified state still
   throws `'pixel view is not verified'` from all three sites.
4. `worldBrushRadii` refuses loudly when `staticVerified` is false AND
   (separately) when `engineVerified` is false — verification never
   weakened.
5. **A REAL mismatch still refuses ARM loudly:** tampered layout (wrong
   count; one perturbed `nx`) → `verifyEngineLayout` rejects, `canArm()`
   false, `worldBrushRadii` refuses.
6. Canonical-vs-screen parity: at default fit/zoom on a visible canvas,
   `worldBrushRadii` matches the `padWorldPerPx`-derived radius within
   tolerance (guards the shared extent helper against drift).

**Wire/page contract pins (existing source-pin style,
`CaptainPad/components/live_touch_ui_authority.test.ts` and/or the wire
contract suite):**
7. `initialSpatialPrepareBody` sources its radius from
   `padBrushWorldCanonical` and contains no `brushPatch()` call; absence of
   the canonical export is a throw, not a fallback.
8. The mount call (`touch_control.html:6193`) and verifier-ready
   announcements remain unconditional on panel visibility.

**Native-embed lifecycle (protocol tests, existing bridge/authority suites):**
9. Adversarially reordered/duplicated `theme-ready`, `surface-focus`,
   `onLoadEnd`, and `verifier-ready` messages with Spatial hidden →
   verification completes exactly once per document, ARM proceeds after one
   authoritative verifier promise, and no message clears another prefix's
   banner.
10. ARM after a WebView document reload (new `documentId`): handshake
    re-runs, verification re-completes, ARM proceeds with Spatial still
    hidden.

**Browser proof (scratch stack per `.agent/skills/full_stack_smoke.md` —
NEVER the live rig):** seed `bm26_touch_layout_v2` with Spatial docked
before first paint; load the page; press ARM → verification completes
exactly once, ARM proceeds, Spatial stays hidden, no error pill. Then a
stale/tampered artifact copy → loud refusal. Then Spatial
visible→hidden→visible toggling and a document reload, ARM each time.

## 7. Validation the impl wave must run

- `node --test simulation/tests/touch_control_pixel_views.test.js` (26/26
  baseline + new cases) and `simulation/tests/touch_artifact_freshness.test.js`
- `marsin_engine/tests/effects/touch_control_wire_layers_contract.test.js`
- CaptainPad: `npx tsc`, focused jest (`live_touch_bridge`,
  `live_touch_ui_authority`, `live_touch_handoff_curtain`), `expo lint` on
  touched files
- The scratch-stack browser ARM proof from §6 (disposable engine only;
  `assertDisposableEngine` disciplines apply)
- `python scripts/security_check.py --staged` before any operator-gated commit

## 8. Physical-iPad retest sequence for Sina (after `_302` lands)

The fix is all in `docs/ui/*` (served live to the WebView) — no CaptainPad
rebuild expected; the WebView document just needs a fresh load.

1. In Live Touch, tap the panel header **RELOAD** (or force-quit and relaunch
   Expo Go from Metro :6981) so the WebView pulls the fixed page.
2. Leave **SPATIAL in the HIDDEN row** — do not open it.
3. Tap **ARM**: expect ARMING → ARMED, no red pill; the
   `LIVE TOUCH PIXEL VERIFICATION WAITING/CHECKING` banner may flash and
   must clear itself.
4. Confirm Spatial is STILL hidden (the fix must not have opened it).
5. Open SPATIAL from the HIDDEN row → the pixel map draws; one short stroke
   to confirm painting (this writes to the rig — your call when).
6. Dock Spatial again → DISARM → ARM again (visible→hidden→ARM path).
7. Panel header RELOAD while DISARMED, Spatial hidden → ARM once more
   (document-reload path).

## 9. Residue + follow-ups

- Repro harness left at `~/tmp/live_touch_arm_repro/repro.mjs` (gitignored
  area) for the impl wave to port into the test suite.
- No product sources touched; Codex's working-tree changes intact
  (ownership hash checked at session start and end).
- Follow-up worth a Backlog card: `padBox()`'s `|| 1` zero-size fallback
  (`touch_control.html:4353-4354`) silently converts "no layout" into a
  1-px pad; after the ARM decoupling it only feeds the visible-stroke path,
  but it is still a small P0-style fallback smell.

## 10. EXCLUSIVE-OWNERSHIP VIOLATION — detected at session end (13:36 PDT)

At the closing ownership check, three in-scope files had been modified UNDER
this session, minutes before the check: `docs/ui/touch_control_wire.js`
(mtime 13:31:16), `docs/ui/touch_control.html` (13:33:09), and
`docs/ui/touch_control_pixel_views.js` (13:35:43; 1239 → 1247 lines; diff
stat 53 → 57 changed lines). The concurrent editor split the EXACT conflated
guard this report diagnoses: `padWorldPerPx` now throws
`'pixel-view source artifact is not verified'` vs a new
`'pixel view has no rendered display projection'`. Every `file:line` in §2
and §5 was verified against the tree as it stood BEFORE these edits; the
mechanism and proof (§2-§3, repro 9/9) are unaffected, but the `_302` wave
MUST re-baseline against the tree it inherits and reconcile with whatever
the concurrent editor (presumably the "paused" Codex Live Touch task) has
landed — the guard-split portion of the §5 contract may already be partially
implemented. Per the spawn brief, this session STOPPED at detection.
