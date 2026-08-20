# 2026-08-16 — Live Touch hide/show → Deck grammar: docs/70 §11 (Fable, operator override)

**Agent:** Fable design agent (third Live Touch commission tonight).
**Deliverable:** `docs/70_live_touch_production_overhaul.md` **§11** — the
contract replacing the Live Touch dock-rail + header-chevron system with
the Deck's workspace chip grammar, on fresh operator feedback (verbatim in
§11). **Records the operator override (2026-08-16) of the docs/65 §6
"one show/hide system per surface" pin.**

## Diagnosis ("buttons disappear at certain grid layouts") — code-anchored

1. Landscape ≥901px has **no scroll escape**: `.content-grid{overflow:auto}`
   is portrait-only (`touch_control.html:2280`); with base
   `min-height:0` panels compressing under the 1.36 ratio ceiling, header
   collapse/lock buttons that fall outside the viewport are unreachable.
2. **Silent displacement**: `MAX_PER_ROW=2` LRU displacement
   (`:7220-7229`) and `loadLayout`'s cap-pop (`:7182-7185`) dock panels
   with zero narration — windows and their buttons vanish as a side
   effect of opening others.
3. The left `#panelRail` restore rail is the "dominant" area the operator
   objects to, and a third control vocabulary (§1-F5).

A scroll-aware, 127.0.0.1-only probe harness enumerating every reachable
shut-set × both 11" viewports is saved at
`C:/Users/TITANI~1/tmp/live_touch_dock_probe/dock_orphan_probe2.cjs`;
per the token-limit directive no clean probe run was completed tonight,
so **W7 step one is reproduce-first**, and post-change acceptance is zero
orphans across the full matrix.

## Ruled grammar (§11.2)

One quiet bottom chip row, deck semantics ported as grammar (recon of
`workspace_chip.tsx` / `deck_workspace_layout.ts` /
`mixer_workspace_layout.ts`): open chips (caps, `▾`, tap hides) →
divider + `HIDDEN` micro-caption → hidden chips in close order (micro
caps, ghost, `▸`, tap restores); identity dot never changes; ~28px pill
with `::after` reach to ≥44pt; one row, horizontal scroll, `›` overflow
hint outside the scroller; bars (AUDIO strip) ride the same row;
MIN_OPEN=1 becomes the unpressable-floor chip; MAX_PER_ROW=2 kept but
displacement lands the victim's chip at the HIDDEN head (narrated);
`#panelRail` and header chevrons deleted (locks stay).

## Persistence ruling (§11.3)

**`bm26_touch_layout_v3`** = deck wire shape `{closed, known}` under the
known-set rule (quoted verbatim in §11.3); future panels default closed,
bars open; total normalizer. **v2 bumped-and-ignored, loudly** — panel
layout is a view preference (the deck convention's licensed case),
NOT rig state (contrast the §5 D10 preset migration); v2 key left on
disk; boot-time console note. D21 vetoable → one-time migration.

## W7 + decisions

W7 (panel-reload only, `touch_control.html` only) sequenced **after
`_289` and W6**, slot `_294+` per coordinator. Acceptance in §11.4
(probe matrix zero-orphan, chip hit/quietness gates, displacement +
floor tests, v3 round-trip + future-key simulation, all §9/W6 pins
byte-identical). Decisions D20-D24.

## Notes

- Deck-grammar recon (chip spec, known-set rule, mixer-port lessons,
  pinned consumers incl. the source-text pins on `workspace_chip.tsx`)
  was gathered by one Explore agent; anchors are in §11.
- Standing rule acknowledged and followed: local probes bind
  127.0.0.1/localhost only; 192.0.2.x for black-holes; never any other
  loopback address.
- No engine change; no scratch servers left running; no git ops.
