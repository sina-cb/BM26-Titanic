# Sim http-server runs via npx but is not a declared dependency

- **ID:** 014
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** launcher work, 2026-06-12 (branch claude/launcher-command-profiles-h255l5)
- **Location:** simulation/start.js:32 (`npx http-server`),
  simulation/package.json (no `http-server` entry)
- **Created:** 2026-06-12
- **Updated:** 2026-06-12

## Description
`simulation/start.js` serves the frontend with `npx http-server`, but
`http-server` is not listed in `simulation/package.json`
(dependencies or devDependencies). On a machine where the npx cache is
cold, the first `npm start` downloads `http-server` from the registry
at runtime. On the playa (no internet) that download fails and the sim
HTTP server never comes up — the new root `launcher.js` `prod` profile
inherits this failure mode.

## Suggested fix
- Add `http-server` to `simulation/package.json` devDependencies so
  `npm install` vendors it, and spawn the local binary
  (`node_modules/.bin/http-server`) from `start.js` instead of `npx`.
- Alternatively replace it with a small static server on Node built-ins
  (the save server already shows the pattern).

## Why it matters
Offline readiness is a deployment requirement
(`.agent/00_gol/06_run_sim.md`): no runtime `npm install` on the playa.
A cold npx cache turns "start the show stack" into a network failure.
