# `--force-osc-port` SIGKILLs arbitrary PIDs without confirmation

- **ID:** 005
- **Priority:** LOW
- **Status:** OPEN
- **Source:** .agent/02_reports/202605/20260527_1_code_review.md (§P1-3)
- **Location:** marsin_engine/engine.js:1238-1262 (`forceKillUdpPort`)
- **Created:** 2026-05-27
- **Updated:** 2026-05-27

## Description
When the operator passes `--force-osc-port`, the engine shells out to
`lsof -nP -iUDP:10000 -t`, parses the PID list, and `SIGKILL`s every
PID that isn't itself. The function is well-bounded (1500 ms timeout,
integer-only parse, lsof args are not user-controlled), but the kill
action is destructive. On a macOS workstation with a co-resident OSC
application (Ableton Live with Max for Live OSC, TouchOSC bridge, a
DAW) this will silently kill the operator's other tools. The warning is
buried in stderr with no second-chance confirmation.

## Suggested fix
Operator-opt-in flag, so low urgency — fix direction only:

- Log candidate PIDs + their command lines BEFORE killing, with a short
  delay window, **or**
- Require an explicit confirmation suffix such as
  `--force-osc-port=confirm` (or gate behind an env var).

## Why it matters
SIGKILLing a DAW mid-set is recoverable but breaks the flow. Severity
depends on the operator's machine setup at the camp.
