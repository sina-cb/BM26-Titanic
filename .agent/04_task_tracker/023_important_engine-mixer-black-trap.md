# Engine --pattern drives deck/PFL only; saved mixer state can output black

- **ID:** 023
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** color-fidelity audit 2026-06-12 (sub-agent)
- **Location:** marsin_engine/engine.js (viewFader/mixer routing), .agent/01_skills/05_full_stack_smoke.md
- **Created:** 2026-06-12
- **Updated:** 2026-06-12

## Description
`node engine.js --pattern <name>` (and POST /set-pattern) load the
pattern into the DECK (PFL preview) channel, but the live sACN output
follows the MIXER view (viewFader defaults to 1.0 = mixer). If the
restored `marsin_engine/states/` mixer has its layer faders at 0, the
engine renders pure black (plus forced ch1 dimmers) regardless of the
requested pattern — during the audit this silently produced a dark rig
for ~40 minutes. The restored playlist autopilot additionally swaps
patterns every 15 s. Workarounds used: `POST /mixer/view
{"view":"deck"}` + autopilot off.

## Suggested fix
- CLI intent: when --pattern is given explicitly, either route the
  output to deck or raise the mixer layer so the requested pattern is
  actually emitted — and log loudly which view/fader is live.
- Update skill 05 (full-stack smoke) with the deck-view step so smoke
  runs can't silently validate a black rig.

## Why it matters
"Engine runs pattern X" is the basic operator contract; a saved state
silently overriding it to black is a playa footgun and has wasted real
debugging time twice.
