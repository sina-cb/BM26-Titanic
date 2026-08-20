# Perf-mode hide-bar explainer label removal (deck + mixer)

> **REPORT-NUMBER COLLISION.** `_308` was reserved for this wave in the
> thread tracker, but a concurrent wave landed
> `.agent/reports/202608/20260817_308_crisp_final_art_and_validation.md`
> (written 16:37) under the same number. Both files now exist. This report
> keeps the filename it was ordered to use; the coordinator should renumber
> one of the two.

## Outcome

The two inline explainer labels the operator circled in the CaptainPad
hide/show chip bar are **gone from the source entirely** — perf mode
included:

- `PERFORMANCE — PARAMS & AUTOPILOT HIDDEN`
- `1D OUTPUT — SHOWN WHEN PIXELS IS HIDDEN`

Both lived on the **deck** bar (`DeckWorkspaceBar`). The **mixer** bar had
already lost its own perf caption in an earlier wave — what remained there
was dead prose and an orphaned style docblock describing a slot that no
longer exists; that is cleaned up too, so the mixer side now reads honestly.

This is a **label removal, not a behaviour change**. Every hide/show rule is
byte-identical:

- `PERF_HIDDEN_WINDOWS` / `effectiveOpenWindows` / `effectiveRailWindows`
  still drop PARAMETERS + AUTOPILOT from both the open row and the rail
  while perf mode is on.
- `PIXELS_SUPPRESSES` / `effectiveShownBars` still drop the OUTPUT bar chip
  while PIXELS is effectively shown, and still restore it — from the
  persisted layout, never a write — when PIXELS closes.
- The `HIDDEN` divider caption (the one that separates shown chips from
  railed chips) **stays**. It was not part of the order and is not an
  explainer — it is the rail's own boundary label.
- `perfActive` and `pixelsShown` remain live inputs to both bars; nothing
  about the props or the derivation order changed.

## Files changed

| File | Change |
|---|---|
| `CaptainPad/components/deck/deck_workspace_layout.ts` | Deleted `PERF_BAR_CAPTION` and `PIXELS_BAR_CAPTION` exports; retargeted the two doc comments that justified them ("which the bar's caption names" → the suppression is silent). |
| `CaptainPad/components/deck/deck_workspace.tsx` | Deleted both caption render blocks (each a `<View divider>` + `<Text railCaption>` pair) and the two now-unused imports; corrected the `perfActive` prop doc, which claimed "one static caption stands in their place". |
| `CaptainPad/components/deck/deck_workspace_layout.test.ts` | Replaced the two wording assertions with **source-text guards** (see below); dropped the two now-unexported imports. |
| `CaptainPad/components/mixer/mixer_workspace_bar.tsx` | Removed the orphaned perf-caption-slot style docblocks (two `/** */` blocks with **no style property under them** — pure residue of the earlier removal); corrected the header docblock ("whether the perf caption shows") and the `perfActive` prop doc ("appends the ONE static PARAMS-HIDDEN caption"). |
| `CaptainPad/app/(tabs)/mixer.tsx` | Corrected the stale inline comment pointing at `showPerfCaption` — a symbol that no longer exists anywhere in the tree. |
| `docs/55_colors_schemes_and_perf_overlay.md` | AMENDED note at the D3 caption decision + at the open-question "caption wording" item. Chip-suppression contract left intact. |
| `docs/63_deck_declutter_view_optimizer.md` | AMENDED note at §2.4 (caption + divider removed; "the bar chip row narrates it" no longer holds) and at the §appendix selector list. |
| `docs/58_mixer_pixel_views.md` | Struck the never-shipped `PARAMS HIDDEN · SHOW MODE · MIDI STILL LIVE` caption item, which cited `PERF_BAR_CAPTION` as its precedent. |

## Dead code removed, with proof

1. **`PERF_BAR_CAPTION`** — 1 declaration, 1 render site, 1 test assertion.
   All three gone. `grep -rn "PERF_BAR_CAPTION" CaptainPad --include=*.ts
   --include=*.tsx` now returns only the negative assertions inside the new
   guard test.
2. **`PIXELS_BAR_CAPTION`** — same shape, same proof.
3. **Two orphaned style docblocks** in `mixer_workspace_bar.tsx` (including
   the long "DEVIATION from docs/67 §4.3's literal `maxWidth: 260`,
   measured 262.36 pt" note) documenting a `perfCaptionSlot` style that a
   previous wave had already deleted. Proof they were dead: the existing
   guard `mixer_polish_source_guards.test.ts:194` already asserts the bar
   source contains no `perfCaptionSlot`/`perfCaptionText`/`showPerfCaption`,
   and that guard was green before this wave.
4. **Nothing else orphaned.** `styles.railCaption` and `styles.divider`
   survive because the `HIDDEN` divider still uses both. `perfActive`,
   `pixelsShown`, `PERF_HIDDEN_WINDOWS` and `PIXELS_SUPPRESSES` all still
   have live consumers in the composition logic.

### Test coverage: swapped, not lost

The two deleted assertions only pinned caption **wording** — they covered no
hide/show behaviour. Every behavioural test around them is untouched and
still green (round-trip purity, "the overlay has no reducer action", the
persisted-truth restore cycle, the whole `effectiveShownBars` matrix).

In their place, two **source-text guards** (repo idiom, same recipe as
`mixer_polish_source_guards.test.ts`, comments stripped first so this wave's
own prose cannot satisfy them):

- `suppresses SILENTLY — no explainer caption stands in the chips' place`
- `suppresses SILENTLY — no explainer caption for the absent OUTPUT chip`

They read `deck_workspace_layout.ts` + `deck_workspace.tsx` and assert the
constants and the label text are absent. Each carries a **positive sanity
assertion** (`PERF_HIDDEN_WINDOWS` present, `>HIDDEN<` still rendered,
`PIXELS_SUPPRESSES` present) so the guard cannot pass by reading an empty or
wrong file — and so a future "clean up the whole bar" mistake goes red
instead of silently passing.

This is the only way to state the fact: the bar's JSX lives in a `.tsx` that
the vitest config deliberately excludes from its glob.

## Gates

| Gate | Result |
|---|---|
| `npx vitest run` (full CaptainPad suite) | **129 files / 2443 passed**, 6 skipped, 0 failed |
| Targeted suites (deck_workspace_layout, mixer_polish_source_guards, mixer_workspace_bar_logic, mixer_scroll_layout, use_mixer_workspace) | **193 passed** |
| `npx tsc --noEmit` (CaptainPad) | **clean, no output** |
| `npx expo lint` on the 5 touched CaptainPad files | **clean, no output** |
| `python scripts/security_check.py --all` | 6 findings, **all pre-existing** and all inside gitignored `simulation/.scene_backups/**/controllers.yaml` (MAC addresses). **Zero findings in any file this wave touched.** |
| Repo-wide grep for both label strings | Gone from all source. Remaining hits: the guard test's own negative assertions, and doc prose that now carries an AMENDED/WITHDRAWN note beside it. |

No git operations were performed. No live-stack ports were bound. No engine,
pattern, playlist, launcher or Live Touch file was touched.

## Notes / follow-ups

- **Live Touch docs left alone, deliberately.**
  `docs/65_live_touch_declutter.md:60` and `docs/ui/touch_control.html:1262`
  both cite `PIXELS_BAR_CAPTION` as a **design recipe precedent** for the
  Live Touch pad's own mode caption. Those references are now dangling, but
  Live Touch / touch_control files were explicitly out of scope for this
  wave. Worth a one-line follow-up when someone is next in that file —
  and worth an operator ruling on whether the Live Touch pad's own mode
  caption falls under the same "no explainer labels" order.
- Deck bar behaviour was verified by test, not by screenshot: the wave was
  scoped small and the change is a pure JSX deletion whose absence the
  source guard proves. The remaining chips render through the unchanged
  `<WorkspaceChip>` path.
