# 20260724_29 — LED generator catalog (Slice S1)

**Author:** Opus implementer · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-24
**Design:** `20260724_26_led_generator_workflow_design.md` (Slice S1, §2.3)
**Scope:** S1 only — NEW FILES ONLY. No edits to `gui_builder.js`,
`te_sign_generator.js`, or any scene YAML (sibling agents own that territory).

## What landed

- `simulation/src/fixtures/led_generator_catalog.js` — pure, DOM-free, fail-loud
  catalog module. No `window`/global/THREE/I-O access. Validates the catalog at
  module load (throws on malformed/duplicate entry) per codex P0.
- `simulation/tests/led_generator_catalog.test.js` — 23 tests: catalog shape,
  lookup, `runLedGenerator` (A≡B pair via `buildTeSign`, suffixed groups,
  fail-loud propagation), output-contract guard, and `uniqueGroupName` edge
  cases (fresh base, first-gap fill, suffix walk-up, trace-groupName union
  collisions, reserved `Ungrouped`, trimming, invalid inputs).

## Design fidelity

- The single catalog entry is **TE Sign** (`target: 'parLights'`,
  `bornLocked: true`, `build: (opts) => buildTeSign(opts)`) — byte-for-byte
  delegation to the existing `te_sign_generator.js` machinery; nothing in that
  module changed.
- `uniqueGroupName` dodges the caller-supplied union of target group names **and**
  `params.traces[*].groupName` (the caller passes the union), plus it dodges
  `Ungrouped` intrinsically. This honors `config.js` `extractParams` L146-149,
  which re-stamps `traceGenerated:true` on any fixture whose `group` matches a
  trace's `groupName` — so a generated sign group can never be captured by a
  trace. Suffixing is `base`, `base 2`, `base 3`, … and fills the first free gap.
- Two design-implied additions beyond the literal §2.3 sketch, both to serve the
  generic click flow the design describes (fail-loud, testable):
  - each entry declares `defaultGroup` (the §2.3 flow references `defaultGroup`
    but the code sketch omitted it) — for te_sign it is `TE_SIGN_DEFAULTS.group`
    (`'TE Sign'`);
  - `runLedGenerator(entry, opts)` wraps `entry.build` and enforces the design's
    output contract ("build must return a non-empty array sharing one group").

## Verify

- `node --check` on both new files: pass.
- `cd simulation && npm test`: **478 pass / 0 fail** (455 baseline + 23 new; no
  sibling test additions observed at run time — a higher count later is fine,
  zero fails is the bar).

## API surface for S2 to consume

From `simulation/src/fixtures/led_generator_catalog.js`:

```js
LED_GENERATORS            // Object.frozen ordered array; iterate to render one
                          //   button per entry. Each entry (frozen):
                          //   { id, label, target, defaultGroup, bornLocked, build }
LED_GENERATOR_TARGETS     // Object.freeze(['parLights', 'ledStrands']) — dispatch keys
RESERVED_GROUP_NAME       // 'Ungrouped' (display bucket; never a generated group)

getLedGenerator(id)                    // -> entry; throws on unknown id
uniqueGroupName(existingGroups, base)  // existingGroups: Array|Set of names —
                                       //   caller passes UNION of params[target]
                                       //   group names + params.traces[*].groupName.
                                       //   -> first free name (base, "base 2", …),
                                       //   dodges RESERVED_GROUP_NAME. Throws on
                                       //   bad base / non-iterable groups.
runLedGenerator(entry, opts)           // -> validated non-empty fixtures array
                                       //   sharing one group. opts must include
                                       //   { group }. Throws on bad output/entry.
assertGeneratorFixtures(fixtures, entry) // standalone output-contract guard
```

**Intended S2 click flow** (per design §2.3):
`pushUndo → base = entry.defaultGroup → group = uniqueGroupName(union, base) →
fixtures = runLedGenerator(entry, { group }) → params[entry.target].push(...fixtures)
→ if entry.bornLocked: params.groupOverrides[group] = {enabled:true, brightness:100,
locked:true} (ledStrands target → params.ledGroupOverrides) → rebuild/render by
target → debounceAutoSave → toast`. The confirm-on-existing-sign prompt (§2.3) is
S2 UI policy, not in this module.
