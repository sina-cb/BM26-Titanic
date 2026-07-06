# 2026-06-20 — CaptainPad UI for grand-master timed fade (F-B)

**Agent role**: developer (CaptainPad) · **Branch**: `dev/ui_master_fade` (local only)
**Wave**: channel-features (2026-06-20). Engine side already merged; this slice
is the CaptainPad UI for the grand-master timed fade (`docs/39 §8.2 — F-B`).

## Scope / file ownership

Edited ONLY the two owned files (+ this report):

- `CaptainPad/utils/masterApi.ts` (NEW) — typed `fadeMaster(target, durationMs)` client.
- `CaptainPad/components/DeckTopBar.tsx` — FADE affordance in the deck header.

Did NOT touch `mixer.tsx`, `PlaylistPanel.tsx`, `utils/api.ts`, or any engine file.

## What was built

### `utils/masterApi.ts`
- `fadeMaster(target: number, durationMs: number): Promise<ApiResult<…>>`
  → `POST /mixer/master/fade { target, durationMs }`.
- Reads the engine base from the dependency-free leaf module `apiBase.ts`
  (`import { api_base } from './apiBase'`) — the same resolver `api.ts` itself
  re-exports — so NO duplication of fragile resolve logic and `api.ts` is never
  edited. Reuses `fetchWithTimeout` + the `ApiResult<T>` type from `api.ts` via a
  read-only import (importing does not mutate the module), so the client matches
  every other CaptainPad client byte-for-byte (8 s timeout, structured result).
- Fail-loud: surfaces a non-2xx as `{ ok:false, error }` (`data?.error || HTTP n`),
  never fabricates `{ ok:true }`. No silent fallback.

### `components/DeckTopBar.tsx`
- New FADE group next to MASTER: four duration pills `1s / 3s / 5s / 10s`
  (default `3s`, local state `fadeSeconds`) + two action buttons **TO BLACK**
  (`runFade(0)`) and **UP** (`runFade(1)`). `runFade` calls
  `fadeMaster(target, fadeSeconds * 1000)`.
- Fail-loud handler: a rejected fade does `console.error` **and** `Alert.alert`
  ("Master fade failed", engine error). Not swallowed.
- In-flight reflection: a local `useMasterFade()` hook subscribes to the SAME
  `engineEvents` control bus (`/ws/control`) that already feeds the deck — it
  reads the `masterFade` field off the existing push `mixer` / `deck`
  broadcasts. This is NOT a new polling path (`useEngineState` subscribes to the
  identical bus; it simply does not surface `masterFade`, and that hook is owned
  by another agent this wave so it could not be extended). While
  `masterFade.active === true` the master bar fill is tinted (`tertiary`) and a
  `FADING…` hint replaces the numeric readout. The bar animates on its own
  because `master` itself ticks toward the target on each broadcast.
- No layout shift when idle: the FADING… hint occupies a fixed-width slot that
  swaps with the equally-fixed numeric readout; the FADE group lives in the
  existing right-hand row and is gated to landscape (same crowding posture as the
  MASTER label / model chip).
- Touch targets ≥44 pt: pills are 28 pt tall + 14 pt vertical `hitSlop`
  (≥44 pt effective); action buttons 28 pt + 8 pt `hitSlop` (≥44 pt).
- Tokens, not literals: all colors via the `Palette` (`primary`, `onPrimary`,
  `error`, `tertiary`, `ghostBorder`, `secondary`, `surfaceContainerHigh`).

## Structural assertion

- **Control**: deck-header `FADE` group — duration pills (`fadeSeconds` state) +
  `TO BLACK` / `UP` `TouchableOpacity` actions.
- **Handler**: `runFade(target)` → `fadeMaster(target, fadeSeconds * 1000)`.
- **Endpoint**: `POST /mixer/master/fade { target, durationMs }` (in `masterApi.ts`).
- **masterFade field read**: `(mixer|deck).masterFade.active` off `engineEvents`
  push broadcasts via the local `useMasterFade()` hook.
- **Idle render**: a healthy/idle engine (`masterFade` null/none) renders the
  numeric master readout and the untinted bar — i.e. NO visual change vs. before
  this slice, no layout shift.

## Verification (from worktree `CaptainPad/`)

- `git -C <worktree> diff --check -- CaptainPad` → exit `0` (no whitespace errors).
- `npx tsc --noEmit` → exit `0`.
- `npm run lint` → `✖ 12 problems (0 errors, 12 warnings)`, exit `0`. Identical to
  the documented baseline; NONE of the 12 warnings are in `DeckTopBar.tsx` or
  `masterApi.ts` (no new warnings).
- `npm run web:build` → exit `0`, **21 static routes** exported to `dist`. The
  `ECONNREFUSED 127.0.0.1:6968` line (`fetchScheduledTasks` at build-time
  prerender, no engine running) is the known env artifact, not a build failure.
- **No headless screenshot**: the sim screenshot tooling
  (`agent_render.cjs`) renders the Three.js *simulation*, not the CaptainPad Expo
  web app; there is no equivalent headless CaptainPad capture in this repo, so a
  screenshot of the deck header is not available in this environment. The change
  is structurally verified (tsc + lint + web:build) and the idle render is
  asserted above.

## Deferrals / notes

- The FADE affordance is landscape-only (portrait hides it, matching the existing
  MASTER label / model chip behaviour to avoid crowding the narrow header). The
  master fader + drag remains available in portrait; this is a deliberate parity
  choice, not a missing feature.
- `masterFade` is read via a local `engineEvents` subscription because the shared
  `useEngineState` hook (which would be the cleaner home for the field) is owned
  by another agent this wave. A follow-up could promote `masterFade` into
  `EngineLiveState` + a `useMasterFade()` selector there and have `DeckTopBar`
  consume that instead — purely a refactor, no behaviour change.
- No new dependencies; offline-safe (no CDNs/fonts/runtime installs).
