# Engine REST + WebSocket exposes full control plane with no auth

- **ID:** 001
- **Priority:** CRITICAL
- **Status:** OPEN
- **Source:** .agent/02_reports/202605/20260527_1_code_review.md (§P0-2)
- **Location:** marsin_engine/lib/api_server.js:1496-1498 (CORS); endpoint
  definitions throughout the same file; engine binds all interfaces on
  port 6968
- **Created:** 2026-05-27
- **Updated:** 2026-05-27

## Description
The HTTP server sets `Access-Control-Allow-Origin: *` and accepts every
method with zero authentication on any endpoint. The same applies to
`/ws/control`, `/ws/params`, `/ws/signals`, `/ws/viz`. Any LAN peer can
hit unauthenticated POST verbs that drive the whole show, including
`/save-pattern` (writes arbitrary JS that is then compiled into the WASM
VM), `/set-pattern`, `/control`, `/mixer/channels` CRUD,
`/global-blackout`, `/global-effect-macros/blackout`,
`/global-effect-macros/panic-stop`, all `/audio/*` mutations,
`/osc/config`, and `/deck/*` routes.

## Suggested fix
Two acceptable directions from the report:

- **Quick / event-floor**: bind HTTP to `127.0.0.1` and tether the iPad
  via USB (or stand up a dedicated operator-only SSID for engine + iPad
  only).
- **Proper**: shared-bearer-token check on every `POST/PATCH/PUT/DELETE`
  endpoint plus WS upgrade, with the token shipped in CaptainPad config.
  `*` CORS is fine once the service is token-protected.

## Why it matters
On a venue WiFi this is a remote-blackout vector — anyone with a browser
can `fetch('http://<engine>:6968/global-blackout', {method:'POST', body:'{"state":true}'})`
from a devtools console. The pattern-write path is worse: unauthenticated
arbitrary-write of executable code into the engine. The summer-camp
scenario explicitly hands a non-engineer-controlled network to the
engine.

## Notes
Severity is context-dependent. CRITICAL stands as long as the engine
sits on the same SSID as guests. If the camp uses a closed
operator-only SSID, urgency drops (report suggests P1) but the task
stays open — the auth gap is real either way.
