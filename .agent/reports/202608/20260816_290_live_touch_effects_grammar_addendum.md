# 2026-08-16 — F6 EFFECTS-panel production grammar: docs/70 §10 addendum (Fable)

**Agent:** Fable design agent (focused follow-up commission from the
coordinator after `_288`).
**Branch:** `feat/bm_readiness` working tree (design-only; edits: docs/70
§10 addendum, this report, tracker block, dossier row).
**Deliverable:** `docs/70_live_touch_production_overhaul.md` **§10** — the
contract for finding F6 (the EFFECTS panel config-sheet problem), the one
§1 finding left unscoped in the original docs/70. W6 package for the
implementer, decisions D14-D19, acceptance criteria with per-orientation
visible-rows/tap-target numbers.

## Evidence and diagnosis (on the `_288` substrate, zero scratch cost)

Read `_288` first (its three contract corrections + the new
`live_touch_overhaul_shots.cjs` union(box, `::after`) gate). Re-examined
the `_288` after-shots (`~/tmp/live_touch_impl/shots/after/`) with a 2×
zoom crop of the effects region rather than spinning a scratch stack —
the after-shot is current (post-`_288` shell, live-connected).

F6, precisely: (1) identity lives in the wrong control — the 18px assign
`<select>` is the only readable label and the default bank makes SEVEN of
16 cells read "Movement Trace - …", while the pressable face (already
desk-grammar: tap=latch, hold≥350ms=momentary, singleton/FX_CAPPED
eviction, solid-green lit) renders its FX_SHORT two-liner **invisibly**
through the theme bridge (dark-theme literal colours); (2) the family-law
legend ("DIM · one | FLASH · one | …") is permanent header furniture;
(3) every cell foot carries an always-on 8.5px audio-binding micro-row —
32 edit-time controls on the performance surface, the exact population
docs/66 W4 P2 documents as accepted 44pt residuals *because* they are
always-on selects.

## The ruled grammar (docs/70 §10.2)

Two class-states on the existing DOM, visibility-only — **PLAY** (default:
sixteen named keys; face two-liner in theme tokens at AA both arm states;
family corner tag + stripe; read-only foot amount bar; legend deleted —
family law narrated at the moment it acts via the eviction one-liner +
ⓘ overlay; `#palNote` untouched) and **EDIT** (one 44pt header pill:
selects grown to ≥44pt real boxes, aud-rows at ≥44pt, and a new base-level
horizontal fader riding the EXISTING `paramsOverride` MERGE writer
(`touch_control_wire.js:1411-1420`) — **no new engine surface**; ghosted
read-only when an LVL audio binding owns the slot). EDIT may scroll
internally; PLAY never scrolls; EDIT is never persisted.

Wire/theme pins carried as gates: `#fxGrid`/`#fxCount`/`#palNote`,
`[data-role=fxpick]`/`[data-role=fxface]`, `HOLD_MS`, family map + caps,
`touch_control_theme.js` zero changes, all §9 transport pins,
`xyPad.clipBottom` budget (spatial panel untouched).

## Acceptance numbers (both docs/66 11" viewports, `_288` gate tool)

- PLAY: **16/16 cells, 4×4, no panel scroll** (landscape in-viewport;
  portrait once scrolled to); **every face ≥44×44pt**; zero always-on
  selects/aud-rows; zero truncated face lines (FX_SHORT ≤8-char test);
  face contrast ≥4.5:1 DISARMED and ARMED, lit and unlit.
- EDIT: every edit control ≥44pt real box; fader proves MERGE + ghost
  single-writer semantics.
- No engine change; panel-reload only; W6 runs **after `_289`** (same-file
  waves must not interleave).

## Decisions (vetoable, docs/70 §10.4)

D14 PLAY/EDIT class-states, PLAY default, EDIT never persisted; D15
identity on the face, select edit-only; D16 legend → ⓘ + eviction
narration + family tags; D17 default-bank family-spread curation
(operator blesses); D18 EDIT base-level fader on the existing merge
writer (veto → read-only foot bar only); D19 theme-token wash-out fix
gated at AA.

## Follow-ups

- W6 lands with the standing Opus pipeline after `_289`.
- D17 needs an operator blessing pass on the proposed default bank.
