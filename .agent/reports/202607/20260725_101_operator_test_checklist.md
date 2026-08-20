# _101 — Operator test checklist: the 2026-07-31 wave

**Author:** coordinator (interface agent), on operator order: "keep track
of a set of things for me to learn what you did and test as much as I
can … keep that as a report to me when I am back at my desk."

**Scope:** everything that landed 2026-07-31 (reports `_89`–`_100`),
distilled into do-this → see-that checks. The live copy with tick-boxes
also sits at the top of `.agent/projects/bm26_show_readiness.md`; this
report is the stable snapshot. Deep detail per item lives in the linked
report.

> ⚠ **Correction baked in here (operator, 2026-07-31): the TE sign
> pucks are RGBW — the same lights as the ropes.** The `_92` addendum's
> "set output order RGB" instruction was wrong. An audit thread is
> confirming nothing in code inherited an RGB/3-byte assumption; its
> outcome is appended to the `_92` report.

---

## 1 · Controller pane (reload the sim page first)

| Check | Do | Expect | Report |
|---|---|---|---|
| Status dots | Open the controller pane | ● ONLINE / ○ OFFLINE / ◌ UNKNOWN per card; pane never stalls on probes; UNKNOWN never masquerades as offline | `_96` |
| TE signs in LED tray | Look at UNMAPPED | Four 💡 sign chips in the LED half; DMX list has no PLACEHOLDER, 12 DMX controllers | `_92`+ |
| **Map the signs** | Attach the 4 halves to a MarsinLED output, **color order RGBW**, Save | `scene_model_parity titanic`: 4 errors → 0 (the only red left is deliberate until you do this) | `_92`+ |
| Provisional binding | On each of the 3 unbound rope controllers: type real IP → **⚑ Patch without the board** → Save | Patches/model lanes/bridge routes exist immediately; card badge PROVISIONAL; flips ✓ VERIFIED by itself when the board first answers | `_96` |
| Reconcile dialog | If a board disagrees at first contact | Two explicit choices, nothing auto-picked, nothing changed on either side until you choose | `_96` |

## 2 · Timeline engine

| Check | Do | Expect | Report |
|---|---|---|---|
| Dry-run a night | `cd marsin_engine && node tools/timeline_dryrun.mjs --fixture` | Whole playa night minute-by-minute: phases, cues fired and WHY, suppressed fires, party session lifecycle, summary table | `_93` |
| Burn-night fix | Same, festival day 6, `--mood all_night` | Party sessions fire after the burn hold ends (pre-fix: one suppression silenced the whole night, 0 sessions) | `_98` |
| Ambient-dominant | Quiet-night run | Ambient playlist owns ~half the day; `hold-expired-baseline` source never appears | `_98` |
| Plan lint | `GET /timeline/state` → `planWarnings` | 3 warnings: `sunrise`, `burn_night`, `temple` looks lack autopilot blocks (deck would freeze on one pattern for those holds) — **your yaml edit** | `_98` |

## 3 · CaptainPad zoom ladder

| Check | Do | Expect | Report |
|---|---|---|---|
| Day zoom | Tap a day card → OPEN DAY ▸ | Full-screen day: phase bands (party_night wraps midnight as two pieces) + resolved "what actually plays" ribbon, plain-language reason per segment; browsing makes zero engine calls | `_97` |
| Perform (event zoom, live) | Tap today's ACTIVE cue | Green PERFORMING banner on every tab; you drive the deck; a due show shows "starts when you exit" and fires on exit — never steals control mid-performance | `_94`/`_95`/`_97` |
| Time travel (event zoom, inactive) | Tap an inactive event | Purple TIME TRAVELING banner, ◀ ▶ steppers through events; leaving to the timeline tab exits and the real program resumes | `_94`/`_95`/`_97` |
| Two pads | Zoom on pad A, watch pad B | B shows the banner, is not kicked, cannot fight the writer | `_97`/`_100` |

## 4 · Stack & bench

| Check | Do | Expect | Report |
|---|---|---|---|
| Prod bring-up | `cd simulation && node launcher.js prod --scene titanic` (with `-f` is fine) | Boot log: interface inventory printed, subscriptions held until the socket listens, no EINVAL death; input bridge relaying | `_99` |
| Bench mirror | Sim window pinned `--scene test_bench`, engine on titanic | `🪞 BENCH MIRROR ACTIVE` + 3 `composes` lines in bridge log; bench plays the ship's LEFT FRONT (Auditorium pars 5-8, Front Rails, Front Wall bars, port-rope heads). If strands stay dark: one revert-Push on the Titanic_202 card in test_bench | `_89` |

## 5 · Your config edits owed (scene files — operator-only)

- `whenPhase: 'party_night'` back on the party cue (closes the
  3pm-stereo hole; the engine-side ambient-only enforcement is in).
- Three ~3-line `autopilot` blocks: `sunrise`, `burn_night`, `temple`
  looks (see the lint above).
- Roof-edge par row: only 8 of 40 pars patched (`_78`).
- The `.60` card one-push (items 15/18/22).
- Smokestack Top-Down margin call (item 27).

## 6 · Standing tools you already use

- ChatGPT tuning loop: `_90` prompt (live since this morning).
- Playlist coverage matrix for ChatGPT fodder: `_91` §5.

---

*Wave ledger: `_89` bench mirror · `_90` ChatGPT prompt · `_91` show
audit · `_92`(+) TE signs · `_93` dry-run harness · `_94` zoom design ·
`_95` zoom engine · `_96` optional discovery + status · `_97` zoom pad ·
`_98` timeline bug wave · `_99` bridge boot fix · `_100` zoom e2e (in
flight at writing).*
