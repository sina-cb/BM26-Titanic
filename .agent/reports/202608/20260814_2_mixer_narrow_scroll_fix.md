# Mixer narrow-desktop scroll fix

**Date:** 2026-08-14  
**Worktree:** `live_touch_bm_readiness_rebase`  
**Scope:** CaptainPad Mixer narrow desktop only; no engine/runtime state changed.

The channel playlist had an automatic content-height minimum on web. When the
viewport was short, its entries extended behind the channel's fixed MUTE/SOLO
and transition rows rather than becoming scrollable.

`MIXER_BOUNDED_SCROLL_AREA` now carries the `minHeight: 0` contract through the
Mixer content wrapper, channel ScrollView, card, and both body columns. This
makes the playlist's existing ScrollView own the remaining height. No touch or
fader responder code changed, and portrait/iPad sizing remains unchanged.

## Verification

- `npm test -- --run components/mixer_scroll_layout.test.ts` — 1 pass.
- `npx tsc --noEmit` — pass.
- `npm run lint` — 0 errors; 13 pre-existing warnings outside this change.
- `npm run web:build` — pass; `/mixer` exported.
- `git diff --check -- CaptainPad` — pass.

No screenshot was captured: the full stack was deliberately kept stopped, and
the isolated web export has no engine-backed playlist to exercise.

## Live narrow-desktop follow-up

At a `344x848` viewport, the initial base-only fix was insufficient: the
portrait `minHeight: 220` override expanded the playlist through the footer.
The repair now keeps the original floor for a full-height iPad strip, but uses
the measured channel-card height (not React Native Web's window dimensions) to
apply a bounded 3:1 playlist/params split below 560px. The compact decision is
also active before the first layout event, so a short strip never paints with
the overflowing floor.

The source bundle exposes the repair and the focused test now has 3 passing
assertions. After the authoritative-stack restart, live `344x848` proof passed:
the first playlist's ScrollView has a 46px bounded viewport, 4252px content
height, and reaches `scrollTop: 4206`. Its bottom is y=597; MUTE/SOLO begin at
y=672 and TRANSITION at y=712, so no fixed-control overlap remains. Screenshot:
`.agent_renders/20260814_mixer_narrow_scroll_fixed.png`.

Final checks: focused layout 3/3, `npx tsc --noEmit` pass, lint 0 errors (13
existing warnings), and web export pass with `/mixer` emitted.
