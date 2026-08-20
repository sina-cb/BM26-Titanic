# _267 — Deck declutter SHIPPED: audio + 1D-vis bars join the workspace, optimizer under GLOBALS

Contract: `docs/63_deck_declutter_view_optimizer.md` (design `_257`).
Four operator orders from live iPad testing, all four satisfied. Client-only —
**zero engine files touched, zero engine traffic added**.

Five Sonnet slices under an Opus lead/validator, plus the lead's W0 repro and
W4 walk.

---

## What shipped

**The model — surface tiers in ONE reducer (W1, `deck_workspace_layout.ts`).**
`DeckSurfaceId = DeckWindowId | DeckBarId` (`audioBar`/`outputBar`) in the SAME
closed-set store `deck_workspace_layout_v1`, the SAME reducer, the SAME chip
row. Bars never receive a track, a wide flex weight, or a `patternsFillsNarrow`
vote — the window-only selectors stay total over windows and closed to bars *by
construction*, not by runtime filtering discipline. `openWindows` keeps its
signature and filters against `DECK_WINDOW_IDS`.

**The `_225` known-set rule GENERALIZED**: unknown id → its SHIPPED DEFAULT
membership. A window outside `known` is still appended to `closed` (future
windows arrive closed); a BAR outside `known` is left OPEN, because bars
pre-exist as always-visible chrome. Key stays `_v1`. Every pre-existing store —
legacy no-`known`, 4-id, 5-id — hydrates byte-identical **plus two OPEN bar
chips**. Verified on the running app, not just in tests (W4 §F).

**Order 1 — PIXELS suppresses the 1D strip — as a `_217`-style DERIVED
overlay.** `effectiveShownBars(layout, pixelsShown)`, zero reducer actions,
zero storage writes, static caption `1D OUTPUT — SHOWN WHEN PIXELS IS HIDDEN`.
A manual OUTPUT hide survives a PIXELS open/close cycle because the persisted
truth is never rewritten. Derivation order is single and fixed: persisted
layout → perf overlay (windows) → pixels suppression (bars).

**Orders 3 + 4 — the screen reordered (W2/W3).** `CPCControls` gained two
DECK-ONLY props, `optimizerSlot` and `hideAudioRow`; the mixer passes neither.
`DeckWorkspaceBar` now renders between GLOBALS and AUDIO SIGNALS ("under the
globals"), the AUDIO row hides through the same chip mechanism as the windows,
and the LIVE OUTPUT caption + `PixelStrip` became one conditional block. The
plan-status cluster (PLAN LIVE / TOOK OVER / `PlanIndicatorPill`) HOISTED to the
bar's new `trailing` slot — outside the chip ScrollView, so safety indicators
can never scroll away and are never hideable.

**The 200 ms vis re-render is gated.** `onViz` is a zero-dependency
`useCallback` whose stable identity keeps the engine-bus subscription from
tearing down; the bar's shown-ness is mirrored into a ref by an effect and
`onViz` reads the REF. `visDataRef.current` is still written on every message,
so the strip paints the latest frame the instant the bar returns. Hidden bar ⇒
zero vis-driven re-renders of the deck screen.

---

## The operator's second order, folded in mid-wave

> "in the deck, when all views are hidden and then I enable one, it takes over
> most of the screen — please fix."

**Traced before anyone touched code.** `wideFlexFor` returned raw weights and
flexbox renormalized over the OPEN set only, so a lone reopened secondary
(weight 3) against a lone PATTERNS (weight 4) landed at 43 % instead of its
shipped-default 30 %.

**Fix: a denominator floor absorbed by the protected window.**
`WIDE_FLEX_FLOOR` (10) is DERIVED from `DEFAULT_LAYOUT` so it cannot drift;
secondaries keep their raw weights and PATTERNS returns
`WIDE_FLEX.patterns + max(0, FLOOR − rawOpenSum)`. The returned weights now
encode *the shares of the default deck* whenever the open set is sparser than
the default.

**It changes exactly 5 of the 16 reachable compositions** — PATTERNS-alone plus
each PATTERNS+one-secondary pair — and every composition whose raw weight sum
already reaches the floor is byte-identical. That is what keeps the
operator-locked **40/30/30** split and the all-five-open split untouched
(§5 pin 9). Pinned by an exhaustive 16-row LITERAL weight table plus a sum
invariant over every reachable layout.

**MEASURED before/after** (fraction of the columns host, reopened from
all-hidden): secondaries **41.8 % → 28.8 %**, PIXELS **50.2 % → 39.9 %**.
(The residual ~1 % under the nominal 30/40 is the 8 pt inter-track gutters.)

### Portrait is NOT the same defect — ruled, then PROVED

The portrait report ("reopening COLORS gives it 1010 px, extending below the
fold") looked like the same complaint on the other orientation. It is not.

In narrow mode every secondary window track renders `isWide ? {flex…} : {}` —
**content-sized regardless of how many windows are open**. So the behaviour is
not sparse-specific and is not a renormalization artifact. Measured A/B at
834×1194:

| portrait state | COLORS height | PATTERNS height |
|---|---|---|
| reopened from all-hidden | 1010 px | 460 px |
| open alongside PARAMETERS + AUTOPILOT | **1010 px** | **460 px** |

Identical. The only sparse-specific portrait transition is PATTERNS snapping
825 → 460, which is exactly `patternsFillsNarrow` — the `_217` contract pinned
by §5 pins 1 and 9. And the intuitive fix (cap the reopened window to the
scroll viewport) would require a nested same-axis ScrollView inside
`ColumnsScrollRest`, which the `narrowScrollOwner` single-scroll-region
contract explicitly forbids. **Fixing it would break two pins to solve
behaviour that is not a defect**, so it goes to the operator as a decision, not
a silent contract break.

---

## W0 — the "only 1 pattern" repro, decomposed

Not top-of-screen chrome, and **not** performance mode (perf rows have been
*smaller* since the 2026-07-27 30 % cut). The reproducing state is **DECK B
BOUND**: in wide mode `SplitPlaylistPanes` stacks the panes vertically and each
pane re-pays the full ~78 px `PlaylistPanel` chrome plus an 18 px divider.

Derived from measured unbound geometry (binding DECK B is an engine mutation
and was correctly refused):

| viewport | state | pane height | list/pane | **rows/pane** |
|---|---|---|---|---|
| 1194×834 | default | 204.5 | 126.5 | **1** ← the operator's exact report |
| 1194×834 | both bars hidden | 242 | 164 | **2** |
| 1366×1024 | both bars hidden | 337 | 259 | **3** |

---

## W4 walk — measured, with inspected screenshots

22 PNGs + `w4_measurements.json` in `C:/Users/TITANI~1/tmp/fix_262/`. Probe
hygiene: console muted, **Web MIDI hard-disabled** (a live VSN1 is attached;
a second client claiming it freezes the operator's pads), one tab, port 7188,
zero engine mutation — only chip taps and localStorage seeding.

**Measured row pitch is 66 px (65 + 1), not the ~51 px §4.2 assumed** — real
deck entries carry BOTH a sub-label ("7 params") and the edit control sub-row.
The floors were derived from the thinner row, so they must be read against the
real pitch:

| viewport | state | list viewport | seatable rows | fully visible |
|---|---|---|---|---|
| 1366×1024 | default | 495 | 7 | 7 |
| 1366×1024 | both hidden | 570 | 8 | 7\* |
| 1194×834 | default | 305 | 4 | 3\* |
| 1194×834 | both hidden | 380 | 5 | 5 |
| 834×1194 | all states | 258 | 3 | 3 |

\* "fully visible" is one lower than seatable capacity whenever the list is
auto-scrolled to a mid-list live entry, which clips the top row. Capacity is the
number the floors are about.

**FLOOR VERDICT — honest, not rounded up:**

- **1366×1024 (the operator's 12.9" iPad): both floors MET with margin** —
  7 default (≥4) and 8 simplified (≥6).
- **1194×834 (11"): the ≥4 default floor is met at capacity (4). The ≥6
  simplified floor is MISSED — 5 seatable, 380 px against the 396 px six rows
  need. Sixteen pixels short.**
- **DECK-B-bound at 1194×834: 2 rows/pane simplified, short of the ≥3 floor.**
  1366×1024 clears at 3.

Portrait is pinned at 3 rows in every state — the 38.5 % PATTERNS pin, entirely
unaffected by bar state, exactly as designed.

**Other walk results:** all three seeded-store hydration probes correct (both
bars OPEN, and the stored string is **unchanged by hydration** — hydration
writes nothing); close→reopen storage round trip byte-identical; PIXELS toggle
removes the OUTPUT chip from BOTH the open row and the rail and shows the static
caption (screenshot `1194x834_pixels_open.png`); plan cluster visible in the bar's
trailing slot in every captured state including both-bars-hidden.

**Perf-mode byte-identity** was NOT screenshotted: performance mode is
engine-backed and toggling it would mutate the live show. The claim rests on
something stronger than a screenshot — the overlay has **no reducer action to
dispatch**, so `deck_workspace_layout_v1` is architecturally unreachable from
it, and the bar tier is pinned orthogonal to `PERF_HIDDEN_WINDOWS` by unit
tests. Worth the operator's eye on the iPad.

---

## Gates

- CaptainPad suite **100 files / 2132 passed / 6 skipped / 0 failed** — my
  failing list is EMPTY.
- `tsc --noEmit` **clean**. `expo export` **succeeds**.
- Lint **0 errors**; 2 warnings, both FOREIGN and reported not fixed:
  `index.tsx` unused `ScrollView` (residue of `_263` swapping in
  `LockableScrollView`) and `PlaylistPanel.tsx:648` `clearPending` (the
  concurrent opDialog refactor).
- **Mixer parity pinned by test**, not by eyeball:
  `cpc_controls_mixer_parity.test.ts` isolates the actual `<CPCControls …/>`
  call block in `mixer.tsx` and asserts it passes NEITHER new prop, with an
  anti-vacuous guard that the scanner really matched the call.

## As-built deviations from the contract

1. **`outputBar` dot is `C.text`, not §3.3's `C.icon`.** `C.icon` measures
   **1.549:1** on the light theme — under the 3:1 UI-component bar. The
   constraint set is forced: `icon` fails, `secondary` collides with PIXELS
   (§3.3 pins that they must not), so `C.text` is the only neutral that clears
   3:1 on all five themes without colliding. Recorded, contrast-pinned.
2. **Light-theme dot collision, surfaced not patched.** `ACCENT_AUTO` and
   `light.tertiary` are both literally `#1b9e77`, so the new AUDIO dot and the
   AUTOPILOT dot are the same colour in the same chip row on the daylight
   palette only. Not re-tuned: the already-identified one-line
   `light.tertiary → #0d5c44` fix (carried in the readiness dossier, pinned by
   a test that fails the day it lands) resolves it automatically.
3. **D4 padding trim taken** (`rowPadY` 5→4, `rowGap` 2→1, `panelGap` 6→4),
   NON-COMPACT branch only — compact IS the mixer strip sizing, so touching it
   would have broken pin 8. Perf tokens frozen. Tap-target matrix verified: no
   row that was ≥44 pt dropped below it.

## Open for the operator

1. **The ≥6 simplified floor at the 11" viewport (and ≥3 bound).** Padding trim
   is spent. The two remaining levers are both D4-beyond-padding, i.e. his call:
   (a) **drop the entry sub-label** ("7 params") from the deck list — pitch
   66→52, which yields **7 rows simplified at 11"** and lifts the bound case;
   (b) **deduplicate the 78 px per-pane `PlaylistPanel` chrome** paid twice in
   split mode, the single dominant term in the bound case. Note his 12.9" iPad
   already clears every floor.
2. **Portrait content sizing** — narrow secondary windows size to content
   (COLORS 1010 px) and the page scrolls. Capping them requires changing the
   single-scroll-region contract; not done unilaterally.
3. **Perf mode on the iPad** — eyeball the bars-hidden round trip.

## Notes for the next agent

- **The apostrophe in the Windows profile name silently breaks
  `expo export --output-dir`.** Expo reports `Exported: …` and writes nothing
  recoverable. Use the 8.3 short path `C:/Users/TITANI~1/tmp/…`. Same class of
  defect as `_256`'s spawn-quoting finding.
- `CaptainPad/dist` is the LIVE :6967 prod surface — always export to a scratch
  dir and verify afterwards that `dist`'s mtime did not move.
- Never parallelise `expo export`; concurrent runs corrupt the metro cache and
  produce a blank-page bundle that looks exactly like a product crash.
- **This is the last deck-file wave.** The `WindowChip` extraction convergence
  duty passes to the mixer relayout lead per `docs/64` — `deck_workspace.tsx`
  now hosts the two-tier chip recipe that the mixer's rail should share.

No engine restart, no schema change, no wire change. **CaptainPad web rebuild
required** for the deck to pick this up.
