# _319 — Deck and Mixer palette library polish

**Scope:** the shared Deck/Mixer `ColorsWindow`, the shared colour-preset modal,
pure layout and crossfade-endpoint helpers, and focused tests. No Live Touch
core, engine service, runtime state, deployment, or git operation.

## Outcome

Deck and Mixer continue to mount the same `ColorsWindow`; the saved-palette
gallery now has one bounded Fabric/Yoga layout contract. Headers, actions,
chips, modal cards, and preset tiles can shrink or wrap inside narrow
workspaces, long names are ellipsized, and the grid retains one bounded scroll
owner.

Deleting a saved palette is now deliberate and authority-first. The operator
confirms the exact shared deletion, the current rig colours are explicitly
unchanged, and the gallery updates only from the engine's confirmed saved list.
An in-flight list change or rejected write leaves the local gallery intact.
Curated starred palettes remain protected through the existing unified preset
library: they have no remove affordance; ordinary curated palettes may be
hidden and user saves may be deleted.

The two-colour crossfade also no longer starts from a stopped daemon ring. A
previous Crossfade could leave blue/green endpoints in the inactive config;
the next RUN then reused those stale values despite an operator having selected
new A/B hues. New starts now seed from current selected A/B. While Crossfade is
actually running, its broadcast ring remains authoritative for the truthful
scrubber/readout. Preset/manual changes retarget the running ring from their
latest A/B selection.

## Files changed

- `CaptainPad/components/color_preset_library_layout.ts`
- `CaptainPad/components/color_preset_library_layout.test.ts`
- `CaptainPad/components/ColorPickerModal.tsx`
- `CaptainPad/components/deck/colors_window.tsx`
- `CaptainPad/components/deck/colors_window_crossfade_endpoints.ts`
- `CaptainPad/components/deck/colors_window_crossfade_endpoints.test.ts`
- `.agent/context/now.md`
- `.agent/memory/bm_readiness_thread_tracker.md`
- `.agent/projects/bm26_show_readiness.md`
- this report

## Validation

- Focused palette/layout/wiring/crossfade Vitest: **354 passed, 0 failed**
  across 6 files, including real `yoga-layout` narrow-gallery bounds and both
  Deck/Mixer shared-mount guards.
- `npx tsc --noEmit`: **passed**.
- Touched-file ESLint: **passed with no output**.
- New crossfade regression proves a stale inactive two-entry ring cannot win
  over new A/B, while a running Crossfade remains engine-authoritative.

## Visual gate

No service was started or state changed. Honest Deck/Mixer iPad/web screenshots
need either the operator's already-running UI or explicit isolated-stack
permission; no mock geometry is reported as visual acceptance.

## Manual smoke path

1. Open COLORS in Deck, then Mixer, at normal and narrow widths.
2. Save a long-named palette; confirm the header/chips wrap or ellipsize rather
   than clip, and the gallery scrolls as one region.
3. Enter EDIT: starred curated palettes have no remove action. Delete one user
   save, confirm DELETE, then verify it remains until the success acknowledgement
   and the current A/B rig colours do not change.
4. Select a new A/B pair after a prior Crossfade has stopped. Start Crossfade:
   its announced endpoints and animation must use the newly selected hues, not
   the old ring. Change the pair while it runs and confirm the displayed strip
   reconciles from engine motion.

**Needed from Sina:** physical Deck and Mixer smoke above after the next
CaptainPad reload; no extra command or service action is needed from Sina for
the code gates.
