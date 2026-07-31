# 20260725_80 — sim left menu: every instances + generator list sorts by name

**Branch:** `feat/bm_readiness` · **Subsystem:** `simulation/` (GUI render order + one core helper)
**Order (operator, 2026-07-30, with a screenshot of the sim's left menu):**
*"please in the menu for the instances and generator lists for dmx and LED too — sort by name."*

His screenshot showed **Light Instances** group folders in arbitrary order
(Right Front Wall, Right SmokeStacks, Right Front Rails, Right Auditorium,
Left Auditorium, Left Back Wall, …), the **📐 Group Generator** list in a
similarly arbitrary order, and the **LED Fixtures** drawer below. All of them
now render sorted by name.

## What is sorted

Six lists, one rule, one comparator:

| # | List | Sorted by | Source array (untouched) |
|---|---|---|---|
| 1 | **Light Instances** → group folders | group name | `params.parLights` buckets |
| 2 | **Light Instances** → fixture cards inside a group | fixture name | same |
| 3 | **📐 Group Generator** → generator cards | generator (trace) name | `params.traces` |
| 4 | **🔌 DMX Light Fixtures → DMX Instances** → fixture cards | fixture name | `params.dmxFixtures` |
| 5 | **LED Fixtures → ✨ Generators** → buttons | button label | `LED_GENERATORS` (frozen catalog) |
| 6 | **LED Fixtures → LED Fixture Instances** → strand group folders, and the strands inside each | group name / strand name | `params.ledStrands` |

Two "→ Move…" pickers (par fixture card, strand card) list their groups in the
same order — same rule, one surface deeper, and pure display.

Ordering is **natural / numeric-aware**: `Bar 2` lands before `Bar 10`, which is
what every generated fixture needs (`"<group> <n>"` naming from
`generator_chain_order.js`). This is the trap report `_50` was written for.

Two ordering rules are deliberately NOT alphabetical and stay as they were:

- **`Ungrouped` stays pinned LAST** in the LED strand list. It is a display
  bucket, not a group — sorting it into the U's would bury loose strands
  mid-list. (Design D4 already pinned it; only the *named* groups above it
  moved from appearance order to name order.)
- **Sign (TE Sign) group folders stay pinned ABOVE** the strand groups inside
  LED Fixture Instances — `_orderLedFixtureInstances` still re-seats them after
  every render. They are now sorted among themselves.

## The no-data-reorder guarantee

Sorting happens at **render time on a copy**. No scene array is ever sorted in
place, so chain order, patch derivation, the pixel model export and YAML
serialization are byte-identical on save.

Mechanically:

- Every list builds a **view** — an array of `{ item, index }` pairs (or of
  group-name strings) — and sorts *that*. `params.parLights`, `params.traces`,
  `params.ledStrands`, `params.dmxFixtures` and the per-group buckets in
  `groupMap` keep their own order and their own array identity.
- Each display row **carries its real source index**, because essentially every
  hook below the label is index-keyed: `window.traceGuiFolders[i]`,
  `clickTraceFolder(i)`, `setTraceSelected(i)`, `flyToTrace(i)`,
  `window.parGuiFolders[index]`, `window.strandGuiFolders[i]`,
  `window.dmxGuiFolders[index]`, `window.parFixtures[index]`. Sorting the labels
  never renumbers anything.
- Two places that read *source position* rather than list position were kept on
  source position on purpose:
  - the generated-fixture default name (`Fixture <n>`) now reads a new
    `ordinal` field (the member's position **within its group in
    `params.parLights` order**) instead of the render loop counter, so a seeded
    name cannot depend on how the list happens to be sorted;
  - the **group-delete reassignment** (`groupOrder.find(g => g !== groupName)`)
    still reads the un-sorted `groupOrder`. That call *writes* `config.group` —
    it is data, not display, and must not start picking a different target
    because the menu changed. A test pins this.
- Open/closed folder state is untouched: restore still keys on `_plainTitle`
  (the un-badged `"<group> (N)"` string from `_76`), which has nothing to do
  with position. `_76`'s orphan badges, orphan group banners and remove bars all
  render inside the group folder and moved with it, unchanged.

## The comparator

Reuses the existing shared `simulation/src/core/natural_sort.js` — one cached
`Intl.Collator`, built once at module load. No second comparator, and no
per-item `localeCompare` (rebuilding a collator per call was the exact
per-keystroke perf bug `_50` fixed on the controllers pane).

One helper was added there, next to `sortNamesNatural`:

```js
sortByNameNatural(items, nameOf)   // NEW array, sorted by compareNatural(nameOf(x))
```

It is the object-list twin of `sortNamesNatural` and never sorts in place.
`nameOf` is **required** and throws if missing — a defaulted accessor would key
every row on `''` and produce a list that looks sorted but is arbitrary, which
is precisely the quiet-wrong-answer the codex forbids.

## Files changed

- `simulation/src/core/natural_sort.js` — `+sortByNameNatural`.
- `simulation/src/gui/gui_builder.js` — display-order views at the six list
  sites + the two move-pickers; `ordinal` added to the par group buckets.
- `simulation/tests/menu_name_sort.test.js` — **new**.
- `simulation/tests/natural_sort.test.js` — 2 tests for the new helper.

## Tests

`cd simulation && npm test` → **tests 1335 · pass 1327 · fail 8**.
Baseline was 1316 / 1308 / 8. **+19 tests, +19 pass, 0 new failures** — the 8
failures are the known pre-existing stale-model / real-scene ones
(`test_bench` + `titanic` model freshness, view-bit headroom, the two CLI emit
checks), unchanged and unrelated.

`node --check` clean on both touched source files.

The 17 new tests in `menu_name_sort.test.js` pin the order two ways, because
list construction lives inside a browser-only closure over THREE + DOM (the
same split `led_fixtures_menu_wiring.test.js` uses):

- **behaviour** — a synthetic scene in a deliberately hostile order (groups
  unsorted, members out of chain order, `Bar 2` vs `Bar 10` in three separate
  lists) is run through the real helpers: labels come out sorted, each row
  still points at its own slot in the source array, `ordinal` stays on source
  position, `Ungrouped` stays last, and each source array is asserted unchanged
  by **both array identity and element order** before/after;
- **wiring** — the `gui_builder.js` source is scanned: it imports the shared
  comparator and nothing else (no `localeCompare`, no second `Intl.Collator`),
  no `params.<array>.sort(` and no `groupMap.get(...).sort(` appears anywhere,
  and all six list sites plus both move-pickers are matched at their call form.

## Not done (deliberate)

No browser session, no scene save, no device HTTP, no restarts — the
live-mapping lockdown was in force and a sort needs none of it. The operator
sees the new order on his next reload of the sim; nothing about the scene file
changes when he next saves.
