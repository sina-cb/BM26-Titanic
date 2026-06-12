# sACN-in frames can stall; out-bridge relays U2 to mapped controller IP

- **ID:** 021
- **Priority:** NORMAL
- **Status:** IN_PROGRESS
- **Source:** full-stack audit 2026-06-12 (sub-agent run, partial — killed by session limit)
- **Location:** simulation/server (sACN bridges), simulation/src/core/animate.js:437-473
- **Created:** 2026-06-12
- **Updated:** 2026-06-12

## Description
Two observations from the engine→sACN→sim audit that need a focused
follow-up:
1. During a 40 s sampled capture in sacn_in mode, the browser-side U2
   frame was byte-identical at every 4 s sample while the engine ran an
   animated wash — received frames stalled (bridge log showed client
   disconnect around the same window). Symptom on the floor: fixtures
   frozen at a stale (but well-aligned) frame.
2. With a controller mapping active, the sim's OUT bridge auto-creates
   a sender relaying universe frames to the mapped controllerIp
   (`[Bridge] ✨ New sender: U2 → 10.1.1.10`, stale-closed after 15 s,
   STALE_SENDER_MS). In sacn_in mode this re-emits the engine's frames
   toward the real controllers and, on loopback-style setups, can put a
   second source on the wire.

## Suggested fix
Reproduce the frame stall with WS reconnect logging on both bridge
ends; decide whether the out-bridge relay should be gated off while
lightingMode = sacn_in (the engine already unicasts to the controllers
directly on playa).

## Why it matters
A stalled in-feed looks like "the engine stopped" with zero indication,
and a duplicate source scrambles colors — both indistinguishable from
mapping bugs to the operator.

## Notes
The byte audit itself PASSED: four mapped pars produced well-bounded
10-channel groups exactly at 1/11/21/31 with zeros elsewhere — the
mapping → model → engine → wire → sim addressing chain is aligned.

2026-06-12 — instrumentation landed (operator decision: make it
monitorable rather than guess):
- IN monitor: new "Last frame" age row; status flips to a red
  ⚠ STALLED when the socket is connected but frames stop for >2 s,
  with loud log lines on stall and recovery. The silent 40 s freeze
  class is now visible at a glance.
- OUT monitor: new "Mode" row (RELAY engine→controllers vs SIM RENDER
  local patterns) and a live "Targets" row (U→ip pairs, idle entries
  age out after 5 s) — the relay is no longer invisible.
- Diagnosis correction: the sacn_in relay is INTENTIONAL (animate.js
  comment: "simulation acts as bridge"; on playa the engine unicasts to
  localhost and the sim is the path to hardware). Do NOT gate it off.
  Double-send only occurs if the engine's destinations are ALSO pointed
  at controller IPs — config hygiene, now observable in the panel.
- Remaining: root cause of the original frame stall (receive client
  already has reconnect; cause unknown). Re-diagnose with the new
  indicators + logs if it recurs on the real rig.
