# OSC listener defaults to wildcard bind + empty allowlist

- **ID:** 003
- **Priority:** NORMAL
- **Status:** OPEN
- **Source:** .agent/02_reports/202605/20260527_1_code_review.md (§P0-1)
- **Location:** marsin_engine/config.yaml:24-30,
  marsin_engine/lib/osc_listener.js:478-490, enabled at boot via
  marsin_engine/engine.js:1351
- **Created:** 2026-05-27
- **Updated:** 2026-05-27

## Description
The new OSC subsystem ships with `enabled: true`, `host: 0.0.0.0`,
`allowedSenders: []`. The listener treats an empty `allowedSenders` as
"no allowlist gate" (`_onPacket`: `if (this._allowedByIp.size > 0) { … }`
at osc_listener.js:481). Combined with wildcard bind, any device on the
venue WiFi can send `/marsin/cpc/*` and `/marsin/stems/*` packets and
drive CPC parameters, push mic gain values, or fake audio reactivity
inputs. With `buildCanonicalBindings`, every CPC key with `oscAddress`
is reachable out-of-the-box.

## Suggested fix
Three options from the report:

- (a) ship the boot default as `enabled: false` and require explicit
  opt-in,
- (b) make an empty `allowedSenders` an explicit boot error so the
  operator must declare an allowlist (matches the listener's own "fail
  loud, never silently fall back" posture), or
- (c) default `host: 127.0.0.1` so the operator must consciously open
  it to the LAN.

## Why it matters
Anyone running a free OSC sender (TouchOSC, etc.) on the venue WiFi can
scan and start nudging the show. Unintentional traffic from random app
sweeps will paint the rig. The OSC stats throttle would mask it from
the operator.

## Notes
Operator explicitly accepted the risk for the immediate summer camp
event — priority kept at NORMAL (not CRITICAL) on operator's call.
Fix scheduled for after the camp. Status stays OPEN until then.
