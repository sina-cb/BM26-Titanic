# HTTP server has no EADDRINUSE retry; hot-restart fragile

- **ID:** 004
- **Priority:** NORMAL
- **Status:** OPEN
- **Source:** .agent/02_reports/202605/20260527_1_code_review.md (§P1-6)
- **Location:** marsin_engine/engine.js:603-613 (port kill block),
  marsin_engine/lib/api_server.js:3289-3294 (EADDRINUSE exit)
- **Created:** 2026-05-27
- **Updated:** 2026-05-27

## Description
The engine's HTTP listener has no retry on `EADDRINUSE`. It relies on
`npx -y kill-port` (non-dry-run only, errors silently swallowed) to free
the port first. When that fails — no network for npm install, no `npx`
in PATH, etc. — the engine hits `EADDRINUSE`, logs, and crashes with no
backoff. Recovery requires the operator to find and kill the prior
process by hand. The OSC listener already has a 4-attempt retry with
backoff for the same situation; the HTTP server doesn't.

## Suggested fix
- Mirror the OSC port-bind retry pattern on the HTTP listener: 3–5
  attempts with 250 ms backoff.
- Replace the `npx -y kill-port` shell-out with a local binary; `npx -y`
  can hang on a flaky network trying to fetch the package.

## Why it matters
Cold-restart in the middle of a show needs to be quick. If a previous
engine instance is still grace-period-holding the port for a few
seconds, the new boot dies. Same failure mode kicks in any time the
laptop is offline (typical for a remote camp).
