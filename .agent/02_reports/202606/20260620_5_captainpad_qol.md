# CaptainPad QoL — fail-loud + a11y on mixer/deck destructive paths

- Date: 2026-06-20
- Slot: 5
- Branch: `dev/captainpad_qol` (local only — not pushed)
- Worktree: `/root/workspace/BM26-Titanic-worktrees/captainpad_qol`
- Commit: `f7590a0`
- Source: adversarial UX review (lens C). Theme: remove silent failures
  on a live lighting console (codex P0), plus two easy accessibility
  fixes.

## Scope shipped (all of P0 + every targeted item)

| # | Item | Status |
|---|------|--------|
| 1 | C1/C7 fail-loud on delete | DONE |
| 2 | C2 fail-loud on swallowed fader/mute/solo errors | DONE |
| 3 | C3 ConfirmSheet hitSlop + a11y | DONE (label/44pt already present; added hitSlop) |
| 4 | C10 SOLO not color-only | DONE |
| 5 | C5 deck transition-mode rollback on reject | DONE |
| 6 | C6 view-selection surfaces engine rejection | DONE |
| 7 | E#9 tighten `any` | NOT taken — see Known gaps |

Files touched (only owned files + within ownership):
`CaptainPad/utils/api.ts`, `CaptainPad/app/(tabs)/mixer.tsx`,
`CaptainPad/app/(tabs)/index.tsx`,
`CaptainPad/components/ui/ConfirmSheet.tsx`.

## VERIFIED vs already-correct (against real code, not the brief)

- **api.ts `removeMixerChannel`** — VERIFIED the brief: it returned
  `{ ok: true }` unconditionally regardless of HTTP status (line ~1027).
  Fixed.
- **api.ts `updateMixerChannel`** — VERIFIED: same bug. It did NOT check
  `res.ok`, so the C6 view-selection rejection branch would never fire
  unless this was fixed too. The function is referenced in only two
  files (api.ts def + mixer.tsx), and no mixer.tsx caller branched on
  `ok` for a non-2xx, so tightening it to honor `res.ok` is
  behavior-preserving for the happy path and only ADDS fail-loud
  behavior. Fixed (mirrors `updateDeckChannel`).
- **api.ts `setDeckTransitionConfig`** — VERIFIED: did not check
  `res.ok`; required for the C5 rollback to ever trigger on an engine
  reject. Used only in api.ts + index.tsx. Fixed.
- **mixer.tsx swallowed `.catch(() => {})`** — VERIFIED four sites:
  fader REST fallback (~836), mute (~853), un-solo restore loop (~895),
  solo loop (~927). All four replaced.
- **mixer.tsx `handleViewSelectionChange`** — VERIFIED `.catch(() => {})`
  + optimistic apply with no failure surface (~1175). Fixed.
- **ConfirmSheet.tsx** — the brief said "add accessibilityLabel"; in the
  real code BOTH buttons ALREADY had `accessibilityLabel` +
  `accessibilityRole="button"` and the `btn` style ALREADY set
  `minHeight:44 / minWidth:96`. So only the missing piece — `hitSlop` —
  was added (C3). Documented here so the discrepancy is explicit.
- **mixer.tsx SOLO button** — VERIFIED color-only (green fill + white
  text, no text/glyph delta). Fixed (C10).
- **index.tsx `handleDeckTxChange`** — VERIFIED fire-and-forget
  optimistic update with no rollback (~274). Fixed (C5).

## Per-change structural assertions

1. **C1/C7 delete (api.ts + mixer.tsx)**
   - `removeMixerChannel`: after `await res.json()`, added
     `if (!res.ok) return { ok:false, error: data?.error || \`HTTP ${res.status}\`, data }`.
   - `confirmDeleteChannel` (mixer.tsx): now awaits the result and, on
     `!res.ok`, calls `console.error(...)` + `Alert.alert('Delete channel
     failed', '"<name>" is still in the live mix. ...')`. Endpoint:
     `DELETE /mixer/channels/:id`.

2. **C2 swallowed errors (mixer.tsx)** — four `.catch(() => {})` →
   - fader fallback: `.catch((err) => console.error('[Mixer] Fader REST
     fallback failed:', err))` (no alert — continuous drag, broadcast
     re-syncs).
   - mute: `.catch((err) => { console.error(...); Alert.alert('Mute may
     not have applied', ...) })` (operator-critical → alert).
   - un-solo restore loop + solo loop: `console.error('[Mixer] (Un-)solo
     ... PATCH failed for <id>', err)` (per-channel inside a loop → log
     only, alert would spam).
   - All target `PATCH /mixer/channels/:id`.

3. **C3 ConfirmSheet (ConfirmSheet.tsx)** — added module const
   `BTN_HIT_SLOP = { top:8, bottom:8, left:8, right:8 }`; passed
   `hitSlop={BTN_HIT_SLOP}` to the CANCEL and CONFIRM `TouchableOpacity`.
   Existing `btn` style retains `minHeight:44 / minWidth:96`.

4. **C10 SOLO (mixer.tsx)** — button now renders text `{isSolo ? 'Solo
   ✓' : 'Solo'}` (was static "Solo") and adds `accessibilityRole`,
   `accessibilityLabel={isSolo ? 'Solo on' : 'Solo'}`,
   `accessibilityState={{ selected: !!isSolo }}`. State is no longer
   carried by the green fill alone.

5. **C5 deck transition (index.tsx + api.ts)** —
   `setDeckTransitionConfig` now returns `ok:false` on non-2xx.
   `handleDeckTxChange` snapshots only the patched keys from the previous
   config, applies optimistically, awaits the POST, and on
   reject/throw restores `{ ...prev, ...prevSnapshot }` + alerts. Only
   the touched fields roll back, so a concurrent `deckTransitionConfig`
   WS update to other fields is preserved. Endpoint:
   `POST /deck/transition-config`. Added `Alert` to the RN import.

6. **C6 view-selection (mixer.tsx + api.ts)** — `updateMixerChannel`
   honors `res.ok`. `handleViewSelectionChange` is now `async`, awaits
   the PATCH, and alerts on both `!res.ok` (engine rejection) and a
   thrown transport error. The optimistic apply is unchanged, so the
   picker still flips instantly; a rejected pick now tells the operator
   it will snap back. Endpoint: `PATCH /mixer/channels/:id`.

## Why no screenshot

Headless render of CaptainPad is not part of the CaptainPad auto-check
spec (`.agent/00_gol/03_captain_pad_auto_checks.md`) — the verification
bar is tsc + lint + web:build. The sim screenshot skill
(`agent_render.cjs`) renders the Three.js sim, not the Expo/RN-web app,
so it cannot capture these RN component changes. Behavior is asserted
structurally above. A full-stack smoke (engine + CaptainPad web) was out
of scope for this UX slice and would not exercise the failure branches
(they require an engine that returns non-2xx on these endpoints).

## Verification proof (exact)

Run from `<worktree>/CaptainPad` unless noted.

- `git -C <worktree> diff --check -- CaptainPad` → exit 0 (no
  whitespace/conflict errors).
- `npx tsc --noEmit` → **exit 0** (baseline was also 0).
- `npm run lint` → **✖ 12 problems (0 errors, 12 warnings)** — identical
  to baseline (0 errors / 12 warnings). **No new warnings or errors.**
- `npm run web:build` → **exit 0**, Web Bundled (1143 modules), **21
  static routes** (incl. `/mixer`, `/(tabs)/mixer`, `/` index,
  `/(tabs)` index). The "Something prevented Expo from exiting" line is
  the known env artifact; build artifacts (`dist`) exported successfully.
  No `ECONNREFUSED :6968` line appeared in this run.

Baseline (pre-change) confirmed before editing: tsc exit 0; lint 0
errors / 12 warnings.

## Known gaps (deliberately not taken)

- **E#9 (`any` tightening)** — every `catch` in the files I touched uses
  `catch (err: any)`, the dominant pattern across api.ts (40+ sites) and
  both screens. Converting only the few I touched to `catch (err:
  unknown)` + guards would create local inconsistency for no behavior
  change and risk new lint churn. Left as-is to stay behavior-preserving
  and consistent with neighbors. A repo-wide pass is the right venue if
  desired.
- **MUTE button color/text-only state** — like SOLO it isn't a strong
  glyph state (only text color changes), but it already carries a text
  label "Mute" + the `toggleBtnMuted` fill, and C10 only named SOLO.
  Left untouched to keep the diff scoped.
- The two solo loops use `console.error` (not an Alert) on purpose: they
  fire per-channel and an Alert per channel would bury the operator. The
  WS sends remain the primary transport and the next mixer broadcast
  re-syncs; the REST PATCH is a durability mirror.

## Notes for the integrator

- Three api.ts helpers had their non-2xx contract tightened
  (`removeMixerChannel`, `updateMixerChannel`, `setDeckTransitionConfig`).
  Each is used only within owned files; no out-of-slice caller relied on
  the old "always ok" behavior. They now match the established typed
  res.ok pattern (`fetchMixerState`, `updateDeckChannel`, audio helpers).
- `node_modules` under CaptainPad is the provided symlink and was NOT
  staged or committed.
