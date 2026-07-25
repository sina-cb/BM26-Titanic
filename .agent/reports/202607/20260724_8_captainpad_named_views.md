# 2026-07-24 — W1: CaptainPad namedViews picker (T1 unlock)

Implementer slice **W1** of the BM Readiness project (branch `feat/bm_readiness`).
Subsystem: **CaptainPad only**. Design doc: `20260724_7_views_overlays_playa_design.md`
(§T1, §5 W1). **No git ops / no commits** — tree carries other slices'
uncommitted work, left untouched.

## Problem (from the gap analysis)

CaptainPad's view pickers ignored the engine's `namedViews` array, so the
entire Tier-A auto-view catalog (PORT/STARBOARD, WALLS/DECKS/CHIMNEYS,
@PAR/@BAR/@VINTAGE/@RAW, BAND_*, `<base>_BOTH`, CTRL_<n>, LEFT/RIGHT) was
invisible on the iPad — only bit-backed `viewMasks` + `groups` showed. Worse,
the bit-less Tier-A views that *did* leak into the old VIEW MASKS section
rendered as dimmed "(NO PIXELS)" (their `bit` is 0, so `viewMaskUnion & bit`
was 0) even when the mask covers real pixels.

## What landed

**New (both testable-pure + presentation split):**
- `CaptainPad/components/view_selection_picker_logic.ts` — RN-free logic:
  `NamedView`/`ViewSelectionValue` types, `isValidNamedView`,
  `classifyNamedView` (name-pattern-over-kind family bucketing),
  `viewSelectionForNamedView` (apply-path: base groups → `type:'group'`;
  composites/pixelSets → `type:'viewMask'` by name), `isNamedViewActive`,
  `isAllActive`, `buildViewPickerSections` (sectioned + filtered + fail-loud
  `missing` flag), `namedViewMemberLabel`.
- `CaptainPad/components/view_selection_picker_logic.test.ts` — 28 tests.
- `CaptainPad/components/ViewSelectionPicker.tsx` — the **shared** RN modal
  used by both surfaces: family section headers, per-view **memberCount**
  ("35 px" / dimmed "EMPTY"), a **search/filter** box (case-insensitive, with
  an "N/total VIEWS" count badge), big ≥52px gloved-touch rows, a loud red
  "NO VIEW CATALOG" banner when the engine payload omits `namedViews`
  (codex P0 — never silently hide the picker). `includeAll` prop offers the
  ALL PIXELS row for the mixer and omits it for deck overlays (engine refuses
  `type:'all'` overlays).

**Modified:**
- `CaptainPad/utils/api.ts` — `fetchViewSelectionOptions` return type gains
  `namedViews?: {name,kind,bit,memberCount}[]`; added fail-loud guards
  (non-2xx / non-object body → `ok:false`).
- `CaptainPad/app/(tabs)/mixer.tsx` — replaced the inline 3-section modal +
  `viewSelectionGroups`/`viewSelectionViewMasks` state with a single
  `viewSelectionNamedViews` state feeding `<ViewSelectionPicker>`. The
  existing apply path (`handleViewSelectionChange` → `updateMixerChannel`,
  optimistic + fail-loud) is unchanged.
- `CaptainPad/components/DeckOverlayStack.tsx` — deleted the local
  `ViewPickerModal` + `ViewMaskOption`; both the add-overlay flow and the
  per-card view re-target now use `<ViewSelectionPicker>` fed by a single
  `namedViews` state.

**Behavior preserved:** base **groups** still apply as `{type:'group'}` and
bit-backed **viewMasks** still apply as `{type:'viewMask'}`; selection +
active-highlight semantics for both are unchanged (unit-tested).

## Verification

- `npx tsc --noEmit`: **clean (exit 0)**.
- Full CaptainPad vitest suite: **790 passed, 6 skipped (37 files)** — the 28
  new tests are the delta over the prior baseline. All green.
- `npm run lint`: my six touched files are **0 errors** (verified via direct
  `eslint` on them; the warnings they show — `router`/`Platform` unused,
  `Array<T>` in api.ts — are all pre-existing, outside my edits). The suite's
  **4 lint errors are entirely in `components/GlobalEffectMacros.tsx`**
  (react-hooks/rules-of-hooks) — a file I never touched, part of another
  slice's uncommitted work in the tree. **Not introduced by W1.**
- `npm run web:build`: **exit 0**; served `dist` on :6967.
- Live screenshots (fresh dist + live engine, console muted per the memory
  technique) in `.agent_renders/`:
  - `views_mixer_picker.png` — picker open on a mixer channel: header
    "VIEW · LATENCY_0 / 21 VIEWS", sectioned SIDES & ENDS (LEFT **35 px**,
    RIGHT 45 px — the old "NO PIXELS" bug is fixed), HEIGHT BANDS, FIXTURE
    TYPES, with per-view pixel counts. Engine CONNECTED, model test_bench.
  - `views_mixer_filter.png` — after typing "BAND": narrows to **3/21 VIEWS**,
    HEIGHT BANDS only, ordered LOW→MID→HIGH.
  Both visually inspected.

## Engine

No engine was running on :6968, so I started one per the slice instructions:
`cd marsin_engine && node engine.js --model test_bench --pattern 01_cylon_sweep`.
**Left running** (I did not kill it). A `serve dist` on :6967 was also left
running for the captures. The capture toggled PERFORMANCE mode on the deck once
(runtime engine state residue only).

## Gaps / notes

- **Deck-overlay picker screenshot not captured** in headless: the
  "+ ADD OVERLAY" button sits below the fold and is PERFORMANCE-mode-gated,
  which was fiddly to drive in puppeteer. It renders the *identical* shared
  `<ViewSelectionPicker>` (compile- + code-verified, `includeAll` omitted) —
  the mixer captures are the live-data proof. A manual tap on the iPad / a
  non-perf deck will show it immediately.
- Screenshots use **test_bench** (21 views). On a regenerated **titanic**
  model the same picker will show ~60 entries across all families (SIDES,
  STRUCTURE, PAIRS, CONTROLLERS, GROUPS, COMPOSITES) — which is exactly why
  the search + sectioning were built. That regen is slice **W2**.
- The engine `family` field (design doc T1 "engine assist") was **out of W1
  scope** (no engine changes); families are derived client-side from
  name/kind, which matches the real payload cleanly.
