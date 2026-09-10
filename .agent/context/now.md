# now.md — State of Play

> Updated 2026-09-09. Keep this file under one screen; history belongs in
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

Anything else is a new game. Play it kindly, and have fun.
