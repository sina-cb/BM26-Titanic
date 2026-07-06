# Slot 1 — health_pill

- **Branch:** dev/health_pill
- **Parent branch:** feat/optimize_channels (tip 41a4bcb — all channels work merged)
- **Worktree:** /root/workspace/BM26-Titanic-worktrees/health_pill
- **Slot ports:** engine 6968 (not booted — pure CaptainPad UI change), sim n/a, metro n/a

## Scope

Last open audit nit (N3 / F1): when the engine reports degraded health on
`GET /status`, surface a small non-intrusive amber `⚠ DEGRADED` warning chip
next to the header connection pill on BOTH operator views (deck + mixer). A
clean engine shows nothing new (no layout shift, no chrome change). Degraded =
`renderHealth.ok === false` (a channel blend fell back to host-side linear
interp) OR `deckRestoreDegraded != null` (saved deck pattern failed to restore
and the engine fell back to the default to keep the mission-critical exterior
LIT). Purely additive; no behavior change when healthy.

## Engine contract verified against real code (read-only)

- `marsin_engine/lib/api_server.js` GET /status emits:
  - `renderHealth: mixer.getRenderHealth ? mixer.getRenderHealth() : null`
  - `deckRestoreDegraded` — `{ failedPattern, reason, fellBackTo }` or `null`
- `marsin_engine/lib/pattern_mixer.js` `getRenderHealth()` returns
  `{ ok: blendErrors.length === 0, frame, blendErrors: [{ blend, message, sinceFrame, count }, ...] }`.
  A green rig ⇒ `{ ok:true, blendErrors:[] }`.

## Files changed

```
M CaptainPad/app/(tabs)/mixer.tsx        (+5  — import + render <HealthChip> in header)
M CaptainPad/components/DeckTopBar.tsx    (+5  — import + render <HealthChip> in header)
M CaptainPad/hooks/useEngineState.ts      (+~145 — engineHealth state, seed from /status,
                                                  deriveEngineHealth(), useEngineHealth())
M CaptainPad/utils/api.ts                 (+38 — RenderHealth / DeckRestoreDegraded types,
                                                  additive optional fields on ConnectionResult.data)
?? CaptainPad/components/ui/HealthChip.tsx (new — presentational amber chip)
```

(`CaptainPad/node_modules` is the pre-provisioned symlink — NOT gitignored in
this worktree, so it was deliberately excluded from the commit by adding only
the five specific paths above. Never `git add -A` here.)

## Design / data flow (mirrors the existing `activeModel` channel)

`activeModel` already travels REST-only on `GET /status` → `EngineLiveState`
→ `useActiveModel()` → header chip. The two health signals ride the SAME path:

1. `api.ts` — `ConnectionResult.data` gains optional `renderHealth?` /
   `deckRestoreDegraded?` (additive; no existing consumer breaks).
2. `useEngineState.ts` — `EngineLiveState.engineHealth` seeded by the same
   `/status` probe (renamed `_seedActiveModel` → `_seedFromStatus`, now seeds
   model + health together). Re-probed once per control-bus (re)connect — no
   polling, same cadence as the model chip.
3. `useEngineHealth()` selector wraps the pure `deriveEngineHealth()` predicate
   (exported, unit-testable). Reference-stable per slice — header chrome stays
   still through mixer/vis ticks.
4. `HealthChip.tsx` reads `useEngineHealth()`; renders `null` when healthy,
   otherwise an amber `⚠ DEGRADED` Pressable (min 44pt touch target) with a
   concise inline reason; tap → Alert with full reason; `accessibilityLabel`
   carries the full reason for hover / screen readers.
5. `DeckTopBar.tsx` and `mixer.tsx` each drop `<HealthChip compact={isPortrait} />`
   right after the MODEL chip — no prop threading needed (the chip self-reads
   the shared cache).

## Structural assertion (the UX contract)

- **Component:** `CaptainPad/components/ui/HealthChip.tsx`, rendered next to
  the connection pill in both `DeckTopBar.tsx` (deck view) and `mixer.tsx`
  header (mixer view).
- **Exact condition:** `deriveEngineHealth()` returns `degraded:true` iff
  `deckRestoreDegraded != null` OR `renderHealth.ok === false` — i.e. the
  spec's `renderHealth.ok===false || deckRestoreDegraded!=null`. HealthChip
  renders `null` unless `degraded`.
- **Field(s) rendered:** the chip text `⚠ DEGRADED` plus a one-line reason —
  `deck fell back to <fellBackTo>` when deckRestoreDegraded is set (preferred,
  mission-critical exterior), else `blend: <blendErrors[0].blend>` (falls back
  to `blend: unknown` when no detail). Full reason on tap (Alert) and via
  `accessibilityLabel`.
- **Healthy path renders nothing:** confirmed. `engineHealth === null`
  (pre-probe / offline / older engine omitting the fields) → `deriveEngineHealth`
  returns `{degraded:false}` → `HealthChip` returns `null`. A clean engine
  (`renderHealth.ok:true`, `deckRestoreDegraded:null`) → same. No layout shift,
  no new chrome when healthy. The "absence == healthy" default is documented at
  every layer and is NOT a silent fallback: a degraded engine reports the
  degrade explicitly on /status, so absence genuinely means healthy.

## Tests run

- **diff --check:** `git diff --check -- CaptainPad` → exit 0 (no whitespace
  errors).
- **tsc:** `npx tsc --noEmit` → **exit 0**.
- **lint:** `npm run lint` → **0 errors, 12 warnings** — exactly the documented
  baseline. None of the 12 warnings are in the new/edited files (HealthChip.tsx,
  useEngineState.ts, api.ts, DeckTopBar.tsx, mixer.tsx all absent from the list).
  No new warnings introduced.
- **web:build:** `npm run web:build` → **exit 0**, 21 static routes exported
  (deck `/`, `/mixer`, etc.). The build-time `ECONNREFUSED 6968` line is the
  prerender probe to a non-running engine — pre-existing/expected, the export
  still completed.
- **Predicate sanity check:** ran a standalone Node mirror of
  `deriveEngineHealth()` (in `~/tmp/health_predicate_check.mjs`, NOT committed)
  over 7 cases — null snapshot, clean engine, older-engine-both-null, blend
  degraded (with + without detail), deck-restore degraded, and both-degraded
  (deck-restore wins). **7/7 passed.** The three healthy cases all return
  `{degraded:false}` (chip renders nothing), proving the healthy path.

## Known gaps / follow-ups

- **No committed unit test:** CaptainPad has no test runner wired (no jest, no
  `test` script, no existing `*.test.ts`). Adding one would require a new dev
  dependency, which violates the offline / no-new-deps rule and is out of scope
  for this additive nit. The predicate is exported (`deriveEngineHealth`) so a
  test is trivial to add once a runner exists; the throwaway `~/tmp` check above
  proves correctness in the meantime.
- **No headless screenshot:** the degraded chip only appears when the engine
  is actually degraded, which requires booting an engine with a broken blend /
  unrestorable saved deck — not reproducible from a static export and out of
  scope for a UI-only slice. Verified structurally + via the predicate check
  instead.
- **Probe cadence:** health is seeded once per connection (no polling), same as
  the model chip. A runtime degrade that happens mid-session (e.g. a hot-edited
  blend that then fails) won't surface until the next control-bus reconnect.
  This matches the existing model-chip posture; if live runtime tracking is
  wanted later, the engine would need a `status`/health WS broadcast (it has
  none today). Filed as a possible future follow-up, not a blocker for this nit.

## Operator action requested

Ready for review and merge.
