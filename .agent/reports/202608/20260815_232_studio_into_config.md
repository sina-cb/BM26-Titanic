# _232 — STUDIO, MIDI and OSC become CONFIG sub-views

**Date:** 2026-08-15
**Branch:** `feat/bm_readiness` (shared tree, several agents editing concurrently)
**Scope:** CaptainPad navigation only. No screen content changed.

## The order

> "move the 'Studio' tab into the config tab or somewhere as a sub view of the
> config maybe, it's taking up realestate and it's never used except for
> showing off the code language :)"

then, mid-pass:

> "also, OSC and MIDI tabs must also be moved into the config tab as
> independent cards in the config per Midi and OSC separate please but use
> opus agents to make sure the functionality doesn't change"

Three rail slots recovered. The rail now carries ten surfaces
(DECK · MIXER · LIVE TOUCH · AUDIO · 2D SIMULATOR · TIMELINE · EVENTS ·
SCHEDULER · DIMMER RACK · CONFIG) instead of thirteen.

## The shape of the change — routes kept, rail entries moved

The load-bearing decision: **STUDIO / MIDI / OSC stay real expo-router
routes.** They are simply not drawn in the sidebar. Nothing about those three
screens' lifecycle moved.

Why that and not "lift the screen bodies into components rendered inside
`config.tsx`":

- **Mount / focus semantics are untouched.** They are still tab screens of the
  same navigator, so lazy-mount-on-first-visit, stay-mounted-after, and every
  focus/blur event behave exactly as before. The order said functionality must
  not change; the cheapest way to guarantee that is not to move the code.
- **`router.push('/midi')` already exists in the product.**
  `components/MidiStatusChip.tsx` — the 🎹 chip in the deck header — navigates
  to `/midi`. Deleting the route would have broken it silently. Deep links and
  `/studio`, `/midi`, `/osc` URLs all still resolve.
- **MIDI's live plumbing is untouched.** Checked before editing: nothing keys
  off these route names. `setMidiActiveContext` is called only by the deck
  (`index.tsx`) and the mixer (`mixer.tsx`) in their `useFocusEffect`s;
  `layerSettingForRoute` only knows deck/mixer/live_touch. None of the three
  screens uses `useFocusEffect` / `useIsFocused` / `navigation.addListener`.
  Web MIDI subscriptions live in `hooks/useMidiControl.ts`, mounted app-wide.

### Policy (`CaptainPad/utils/captainpad_tab_policy.ts`)

Two optional fields on `CaptainPadTabPolicy`:

- `parentRoute?: string` — the tab this surface lives inside. Presence of this
  field is what takes a route off the rail.
- `subviewSummary?: string` — the one-liner on the parent's entry card.
  **Required** when `parentRoute` is set; `captainPadSubviewRoutes()` throws if
  it is missing (no silent blank card).

`studio`, `midi` and `osc` now carry `parentRoute: 'config'` and a summary, and
were moved into a contiguous, commented block immediately above `config` — the
sub-view CARD ORDER is that declaration order (STUDIO, MIDI, OSC). Rail order
is unaffected: it comes from the `<Tabs.Screen>` order in `_layout.tsx`, which
I did not touch (`_221` owns that ordering).

New helpers, all pure and tested:

| Helper | Purpose |
|---|---|
| `isCaptainPadRailTab(route)` | false for parented routes — the rail filter |
| `captainPadRailRouteName(route)` | which pill lights up (a sub-view lights its parent); throws on a parent that is itself parented — no chains |
| `captainPadSubviewRoutes(parent)` | ordered `{routeName,title,tabBarIconName,summary}` for the parent to render |
| `captainPadRouteHref(route)` | `'/'` for `index`, `/<name>` otherwise |

`tabBarIconName` is now typed `IconSymbolName` (newly exported from
`components/ui/icon-symbol.tsx`) instead of `string`, so a policy icon that
isn't in the SF-Symbol→Material mapping is a **compile error** rather than a
blank glyph. All thirteen existing icons type-check.

### Sidebar (`app/(tabs)/_layout.tsx`)

- `visibleRoutes` now also filters on `isCaptainPadRailTab(route.name)`.
- `focusedRailRoute = captainPadRailRouteName(currentRoute.name)` — the CONFIG
  pill stays lit while a sub-view is on screen, so the rail always answers
  "where am I".
- Split `isFocused` (styling) from `isCurrentRoute` (the tap no-op guard). The
  early-return in `onPress` now tests `isCurrentRoute`, so **tapping the lit
  CONFIG pill from inside a sub-view still navigates** — that is the operator's
  second way out. With the old `isFocused` test it would have been a dead pill.
- The performance-mode redirect effect is unchanged and still covers sub-views
  (they are in `state.routes`).

### Frame (`components/config_subview_frame.tsx`, new)

A slim header on each sub-view: a `‹ CONFIG` chip (navigates to the parent's
href) plus the sub-view's own icon and title. It reads parent and title from
the policy and **throws** if used on an unparented route. Wired into the three
screens as one extra wrapper inside the existing `PerformanceRouteGuard` —
that is the entire diff to `studio.tsx`, `midi.tsx` and `osc.tsx` besides a
header comment.

### Config (`app/(tabs)/config.tsx`)

New `ConfigSubviewCards` section — "SETUP SURFACES" — directly under the
CONFIGURATION title, above CONNECTION STATUS: three independent cards (icon,
title, summary, chevron) that wrap onto one row on an iPad and reflow narrow.
The list is **derived** from the policy, not hand-written, so a future
sub-view appears automatically.

### Performance mode

Effective reachability is unchanged: all three were `showInPerformance: false`
and CONFIG is too, so during a live set they are unreachable exactly as before
(the rail hides CONFIG, `PerformanceRouteGuard` redirects a deep link). Rather
than add a dead runtime filter inside a tab that can't be open in performance
mode, the invariant is a **test**: every parented route's `showInPerformance`
must equal its parent's — so nobody can later hide a performance-visible
surface behind a frozen parent.

## Verification

**Tab policy suite:** 10/10 green (6 pre-existing + 4 new: rail exclusion +
parent mapping, ordered sub-view list with icon/summary, the perf-parity
invariant, href resolution). The `toHaveLength(13)` route-count assertion is
untouched and still passes — no route was added or removed.

**MIDI suites specifically:** `utils/midi/**` + tab policy + studio editor
logic — **28 files, 632 passed, 6 skipped, 0 failed** (manager, resolver,
led_projector, mft_profile, apc_operator_layout, vsn1_runtime,
vsn1_feedback_pipeline, window_sync, context_switching).

**Full CaptainPad vitest — failing LIST comparison:**

- Baseline before my edits: **10 failed** — 4 × `utils/special_events_api.test.ts`
  (passcode transport) + 6 × `components/performance_mode_logic.test.ts`.
- After my edits: **6 failed / 1468 passed / 6 skipped (1480)** — 4 ×
  `special_events_api` + 2 × `performance_mode_logic`.

My failing list is **empty**: the post list is a strict subset of the baseline
(concurrent agents fixed four of theirs mid-run), both remaining files are
`_226`/`_228`/`_230`-owned work-in-flight, and neither imports anything I
touched.

**tsc:** the only remaining errors are the same foreign in-flight ones
(`performance_mode_logic.test.ts` missing `editPrincipal` / `authRequired` in
its fixtures). Zero in my files. **expo lint:** 0 errors; the two warnings in
`config.tsx` / `studio.tsx` are pre-existing `exhaustive-deps` notes on
untouched effects.

### Screenshots — `~/tmp/fix_232/`

| File | Shows |
|---|---|
| `01_rail_without_studio_midi_osc.png` | full rail, deck: no STUDIO, no MIDI, no OSC |
| `02_config_subview_cards.png` | CONFIG with the three SETUP SURFACES cards |
| `03_studio_via_config.png` | STUDIO open via its card — pattern list + highlighting live, `‹ CONFIG │ STUDIO` frame, CONFIG pill lit |
| `04_back_in_config_via_frame.png` | the frame's back chip returns to CONFIG |
| `05_midi_via_config.png` | MIDI open — MIDI CONTROL card with all three device rows + MAPPING |
| `06_osc_via_config.png` | OSC open — LISTENER STATUS / ENABLE / SOCKET / ALLOWED SENDERS, live from the engine |
| `07_rail_config_pill_returns.png` | tapping the lit rail CONFIG from inside OSC navigates back |

**Isolation.** The operator's `:6967` and the 6966-6972 live stack were never
touched. Two deviations worth recording:

1. **`:7167` was already occupied by another agent's static server**, and
   `serve` silently falls back to a random port instead of failing — my first
   capture pass was against *their* dist (which is how a pre-change rail
   appeared in the shots). Verified by comparing the served
   `entry-<hash>.js` against my export's hash; re-served my own dist on
   **`:7168`** and confirmed the hash matches before believing any screenshot.
2. The app needs a reachable engine to render the full rail at all
   (`performanceModeReady` is false while offline, which correctly collapses
   the rail to the four performance surfaces). So captures ran against **my
   own isolated engine on `:7601`** — `MARSIN_CONFIG_FILE` pointing at a copy
   of `config.yaml` with `sacn.destinations: [192.0.2.x]` (TEST-NET-1, per
   `.agent/memory/spawning_a_test_engine.md` — never a `127.x` "black hole"),
   `osc/fire_sync/timeline` disabled, `vsn1.deployLayout/deployOnBoot: false`,
   and `MARSIN_STATE_DIR` / `MARSIN_PLAYLISTS_DIR` in `~/tmp/fix_232/`. Boot log
   confirms `destinations [192.0.2.x]`. Engine and both static servers were
   stopped afterwards; nothing of mine is listening.

One capture-script bug worth remembering for future CaptainPad screenshots:
React Navigation keeps **inactive screens in the DOM with real bounding
boxes**, so a naive "click the element whose text is X" hits the background
tab's label (here the deck's OSC chip). The script now requires
`document.elementFromPoint(center)` to resolve inside the candidate before
clicking. Also, RN-web uppercases via CSS — the DOM text is still `Config`.

## Files changed

- `CaptainPad/utils/captainpad_tab_policy.ts` — `parentRoute` + `subviewSummary`,
  the three routes re-grouped, four new helpers, icon-name typing
- `CaptainPad/utils/captainpad_tab_policy.test.ts` — four new tests
- `CaptainPad/app/(tabs)/_layout.tsx` — rail filter, parent-aware focus,
  `isCurrentRoute` tap guard
- `CaptainPad/app/(tabs)/config.tsx` — `ConfigSubviewCards` ("SETUP SURFACES")
- `CaptainPad/components/config_subview_frame.tsx` — **new**
- `CaptainPad/app/(tabs)/studio.tsx`, `midi.tsx`, `osc.tsx` — frame wrapper only
- `CaptainPad/components/ui/icon-symbol.tsx` — export `IconSymbolName`

No git operations. Engine `states/` residue: none in the repo — my engine's
state was redirected to `~/tmp/fix_232/`.

## Follow-up worth filing

`npx serve -p <port>` silently rebinds when the port is taken. Every agent
capture recipe in this repo assumes `:7167` is theirs. A capture harness should
assert the served bundle hash matches the local export before trusting a
screenshot — the failure mode is a perfectly plausible screenshot of somebody
else's code.
