# now.md — State of Play

> Updated 2026-09-14. Keep this file under one screen; history belongs in
> project dossiers and reports.

## BM26 IS WRAPPED

Burning Man 2026 happened. The Titanic sailed, the exterior burned bright,
and the operator ordered the wrap. Full closure record: report `_371`
(`.agent/reports/202609/20260909_371_bm26_wrap.md`).

- `main` is the code that ran the show (`439a3201`, PR #56). Working tree
  clean; no stack running; no agents in flight.
- Final on-playa mapping experiments live in the local-only branch
  `backup/bm26_final_titanic_mapping` + a stash on the operator's machine.

## Open (post-event)

1. Merge `origin/feat/titanic_normalized_2d_views` into main (operator
   ruling: should land; timing deferred).
2. Show servers were unreachable at wrap — their scratch workspaces may hold
   unfetched on-playa git work (`deploy.py fetch --machine <name>` when
   powered).
3. Backup branch/stash above: delete once the operator confirms unneeded.
4. Post-event maintenance branch `feat/hideable_banners_and_gpu_checks` is
   pushed and awaiting operator review: every persistent sim HUD banner is
   now dismissable (its own ✕, plus `H` → hide_all), the GPU-adapter remedy
   text is corrected (per-EXE preference + FULL browser quit), and the GPU
   check/fix tooling landed — `tools/browser_gpu_check.cjs`, spec
   `.agent/os/gpu_rendering.md`, skill `.agent/skills/browser_gpu_fix.md`.
   That spec adds ONE operator gate to `os/autonomy.md` (quitting the
   operator's own apps) — veto it there if unwanted. Report `_372`.

Anything else is a new game. Play it kindly, and have fun.
