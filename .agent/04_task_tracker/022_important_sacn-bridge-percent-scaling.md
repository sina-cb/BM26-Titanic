# sACN IN bridge forwards 0-100 percent values as raw DMX bytes

- **ID:** 022
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** color-fidelity audit 2026-06-12 (sub-agent, byte evidence)
- **Location:** simulation/server/sacn_bridge.js (sacn npm lib payload handling)
- **Created:** 2026-06-12
- **Updated:** 2026-06-12

## Description
The sacn npm library delivers packet payloads as PERCENT (0-100) by
default; the sim's IN bridge forwards those values into the browser as
if they were raw DMX bytes (0-255). A full-on channel (wire byte 255)
reaches the renderer as 100 → everything in sACN-in mode displays at
~39% absolute brightness. Hue ratios survive (solid red still looks
red), so it masquerades as "the sim is just dim". Verified during the
solid-color audit: engine emitted 255s on the wire; browser frames
held 100s.

## Suggested fix
Read the raw payload from the sacn lib (payloadAsBuffer / raw packet
slice) or rescale 0-100 → 0-255 at the bridge boundary. Byte-for-byte
fidelity test afterwards (the audit scripts pattern works).

## Why it matters
On-site visual tuning done against the sim in sACN-in mode is being
judged at 39% brightness — color/intensity decisions made there won't
match the physical rig.
