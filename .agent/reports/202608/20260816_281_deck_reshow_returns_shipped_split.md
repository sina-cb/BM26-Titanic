# _281 — Deck reshow-from-all-hidden: PATTERNS returns to the pin, the deck snaps back to its SHIPPED split (Fable debug+fix)

**Operator report (verbatim, AFTER _274 shipped and the dist was rebuilt +
reloaded):**

> "the overly sized deck view is still an issue please fix — first reproduce:
> hide all panels, then reshow any of them, and it overlays the patterns
> panel. the pattern panel is not resizing maybe? from full screen or sth?"

**Mid-session operator intel (via coordinator):** "the all hidden then 1 shown
problem is only in the vertical layout" — portrait-only; landscape is fine on
the device.

Client-only. Zero engine files touched, zero persisted-state changes, zero
new actions. Files: `CaptainPad/components/deck/deck_workspace_layout.ts`
(pure), `CaptainPad/components/deck/deck_workspace_layout.test.ts`,
`CaptainPad/app/(tabs)/index.tsx` (comment only — no code line in the render
layer changed).

---

## 1. Reproduction — what was actually hunted, and what was found

_274 left an honest gap: it never reproduced a literal box intersection on
web, and flagged a native paint-over class as the remaining suspect. This
session hunted the overlay through every path _274's probes missed, on a
scratch dist of the CURRENT tree (post _274/_275/_277), on TWO browser
engines — Chromium (puppeteer) and **WebKit** (Playwright — the operator's
iPad Safari engine), at 834×1194 and 1024×1366:

- **A. The operator's literal sequence, bars included** — interactively hide
  EVERYTHING hideable (4 windows + AUDIO + OUTPUT bars), then reshow each
  surface in turn. _274's probe had never hidden the bars.
- **B. Persisted all-hidden hydration** — `deck_workspace_layout_v1` seeded
  all-closed (bars included), reload, reshow after hydrate.
- **C. CPU-throttled (6×) reshow** immediately after load — the onLayout race.
- **Q. Rapid taps** — hide-all with 60 ms settles, reshow with none.
- **R. Rotation around the reshow** — portrait→landscape→portrait then
  immediate reshow; reshow in landscape then rotate to portrait.
- **D. _274's own seeded path** as a control.

Every step measured `getBoundingClientRect` for the host, all five windows,
and the scroll region, PLUS two detectors _274 did not have: an
`elementsFromPoint` **paint-sampling grid inside the PATTERNS box** (a literal
"what is painted on top" check, catching z-order overlays that rect
intersection misses) and a **content-vs-box overflow check** on PATTERNS
(`scrollHeight` vs box — the native non-clipping overlay class, since the
PATTERNS card computes `overflow: visible`).

**Result: zero box intersections, zero paint-over samples, zero content
overflow, zero host overflow by PATTERNS — in all ~90 measured states, on
both engines.** The one anomaly (throttled run, list viewport 24 px) was
data, not layout: the playlist hadn't loaded yet under throttle ("No playlist
loaded" empty state, screenshot-verified). The onLayout race resolves next
frame exactly as _274 designed. `CaptainPad/dist` (the live bundle) was
verified to CONTAIN _274 (`patternsHeight`/`restHeight` markers present in
the minified entry) — the operator was not running pre-_274 web code.

## 2. The mechanism, named

The report is **inconsistent with pre-_274 code** (there, PATTERNS visibly
shrank 835→460 on reshow — nobody describes that as "not resizing from full
screen") and **exactly consistent with post-_274 code**. The defect is
`_274`'s own per-occupant share arithmetic in `narrowStackSizing`:

| state (834×1194, bars hidden) | PATTERNS | restored window |
|---|---|---|
| all hidden (fill) | 908 of 916 | — |
| reshow ONE (_274 shipped) | **688 (75 %)** | **220 px strip (24 %)** |
| default deck, for reference | 460 | 448 region |

`share = restCount / DEFAULT_NARROW_REST_COUNT` gave a lone reopened window
HALF the default region; PATTERNS absorbed the slack to 75–79 % of the stack —
**visually indistinguishable from its full-screen fill state**, with the
restored window rendered as a seam-less fragment chopped mid-content at the
bottom edge. That composition IS the operator's report: "the pattern panel is
not resizing … from full screen" (it kept 75 %) and "it overlays the patterns
panel" (the strip occupies what still reads as the patterns card's territory,
painted over its bottom rows' former position). It is also why the problem is
**"only in the vertical layout"**: the same reshow in wide mode hands the
window its FULL default column (30 % width, full height) via `wideFlexFor`.

The share was the misstep, stated precisely: **the narrow region is a serial
scroll viewport — in the default deck every occupant gets the whole
`restDefault` viewport in turn, so the region's default size is not divisible
per occupant.** The true narrow analogue of `wideFlexFor` ("a reopened window
returns at its shipped-default share") is: any open secondary gives the
region its full default-deck viewport, and PATTERNS returns to the party pin.

## 3. The fix

`narrowStackSizing` drops the share: with ANY secondary open on a measured
host, `patterns = min(pin, host)`, then the two `_274` floors exactly as
before (`NARROW_REST_ABS_MIN_HEIGHT` may cut into the pin on a stack too
short to seat it; `NARROW_PATTERNS_MIN_SHARE` keeps PATTERNS ≥ half). The
now-dead `DEFAULT_NARROW_REST_COUNT` and `NARROW_REST_MIN_HEIGHT` constants
are REMOVED (this repo does not keep constants that pretend to matter).
Notably, `_274`'s own preferred-floor already produced pin-exact splits on
stacks ≤ ~1040 px — this change unifies tall stacks onto the same rule; the
short-stack rows of `_274`'s tables are byte-identical under the new math.

**Pin bent BACK, on the operator's ruling:** `_274` bend #1 ("one secondary →
PATTERNS grows past the pin") is REVERSED — with any secondary open on a
tall-enough stack the party 2026-07-11 pin IS the PATTERNS height again, to
the pixel. Bend #2 (short-stack yield) stands. Explicitly superseded with it:
`_274`'s "reopening ONE window must not drop PATTERNS to the height it has in
the FULL deck" assertion — the operator's `_278`-era report rules that
landing at the shipped default IS the correct reshow outcome (it is exactly
what wide mode does, which he calls fine). All other `_274` pins intact:
`narrowScrollOwner` (one scroll region), `patternsFillsNarrow`/fill mode,
no-remount, host measurement + `flexShrink: 1`, perf zero-write, `wideFlexFor`
untouched, persistence schema untouched.

## 4. Measured after (both engines agree to the pixel)

| viewport | transition | PATTERNS before → after | region |
|---|---|---|---|
| 834×1194 | all-hidden → reshow any window | 908 → **460** (was 688) | **448** (was 220) |
| 1024×1366 | all-hidden → reshow any window | 1080 → **544** (was 807) | **536** (was 273) |

(1024 lands at 544, not the 526 pin: the pre-existing `NARROW_PATTERNS_MIN_SHARE`
half-stack clamp, which already bites the default deck at this viewport.)

Regression matrix (the full `_274` harness, re-run):

- **Default + populated portrait compositions: byte-identical** (460/413,
  526–527/518 — same to the pixel as _274's fixed run).
- **Landscape/wide: 18/18 cases byte-identical** to _274's fixed measurements
  (diffed JSON-to-JSON, zero deltas) — wide mode untouched.
- **Short stacks (880×620 / 834×760 / 640×960): byte-identical** to _274's
  fixed table (237/275/377/400) — no overflow, region never zero.
- **Full hide/reshow cycle at 4 viewports:** portrait is now a clean
  two-state system (pin ↔ fill, symmetric both directions); landscape
  unchanged.
- WebKit run (iPad UA, touch, DPR 2): same numbers everywhere, rotation and
  rapid-tap sequences included.

Screenshots (all inspected): `C:/Users/TITANI~1/tmp/deck_overlay_debug/`
`repro_A_834x1194_reshow_colors.png` (before: 220 px chopped strip) ↔
`fixed_A_834x1194_reshow_colors.png` (after: default-height pattern list,
COLORS fully seated — whole ring, schemes row, both colour slots on screen),
plus the full `repro_*`/`fixed_*`/`wk*`/`matrix_*`/`tight_*` sets and five
measurement JSONs. Harnesses: `probe_overlay.cjs` (Chromium),
`probe_webkit.cjs` (WebKit), `probe_matrix.cjs`/`probe_tight2.cjs` (the _274
harness repointed).

## 5. Gates

- **CaptainPad vitest: 106 files / 2323 passed / 6 skipped / 0 failed.**
  (Baseline 105/2281 after _277; the +1 file is FOREIGN — an untracked
  `hooks/usePerformanceMode_offline.test.ts` from another in-flight session,
  which passes at runtime.) My layout file: 100 tests (was 101 — the
  removed-constant derivation test went with its constant); the `_274`
  defect-1 expectations are rewritten to the `_278` ruling, the 720-case
  invariant sweep now asserts **pin-exact splits for EVERY occupant count**
  whenever the pin seats between the floors — a STRONGER invariant than
  before.
- `tsc --noEmit`: the ONLY error is in that same foreign untracked test file
  (`resetToColdBoot` undeclared, pre-existing) — zero errors in tracked code
  or anything touched here.
- `eslint` on the three touched files: **0 errors**; the one warning is the
  documented `_263` `ScrollView` residue in `index.tsx`, untouched.
- Security: repo scan shows **zero findings in the touched files** (the 79
  repo-wide hits are pre-existing gitignored scene-backup residue).
- `expo export` clean (twice).

## 6. Scratch-stack hygiene

Dist exported to `C:/Users/TITANI~1/tmp/deck_overlay_debug/dist` (8.3 path;
`CaptainPad/dist` mtime unmoved), served on :7195; scratch engine on
**:17969**, sACN → **192.0.2.x** (TEST-NET-1), OSC/fire-sync/VSN1-deploy
disabled in a config copy, `BM26_CAPTAINPAD_AUTH_REQUIRED=0`, state/playlists/
timeline dirs redirected. Live :6966-:6972 answered before and after; :6981
listening with live iPad connections throughout (never touched). Both scratch
ports verified FREE after teardown.

## 7. What stays open, honestly

1. **The literal z-order overlay was never reproduced** — not on Chromium,
   not on WebKit, not with paint sampling, throttling, rotation, hydration,
   bars, or rapid taps. The evidence says the operator was describing the
   `_274` composition (75 % PATTERNS + 220 px fragment), and this fix removes
   exactly that. If he STILL sees a true painted-over window after this
   lands, the remaining suspect is his SURFACE, not this tree: native Expo Go
   on a stale Metro bundle (the documented stale-watcher failure mode) or a
   Safari-cached bundle. The one-question check: which URL/app the iPad is
   on, and a hard reload. Native was not run here (no iOS device/simulator on
   this box) — WebKit desktop is the closest available proxy and it is clean.
2. `_273`'s "one tap costs two thirds of the pattern list" reading is
   formally superseded for the reshow transition: reshow now lands at the
   default split (12 visible rows → 4 at 11"), because the operator's newer
   ruling demands PATTERNS resize down from full screen. If he ever wants a
   taller-than-default PATTERNS after reshow, that is a new knob, not a
   regression.
3. The foreign untracked `usePerformanceMode_offline.test.ts` carries a tsc
   error (`resetToColdBoot` undeclared) — belongs to another in-flight
   session; not touched.

**Deployment: CaptainPad web rebuild REQUIRED** (coordinator `rebuild-pad`);
no engine restart, no schema change, no wire change. A native pad needs its
own rebuild.
