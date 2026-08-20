# _203 — PARTY SIGNAL fails honest on disconnect

Date 2026-08-14 · agent _203 · branch `feat/bm_readiness` · `CaptainPad/**` only
· audio-closure campaign, fix 1

## Defect

The AUDIO tab's PARTY SIGNAL pill read `liveDoc.params.audioParty` straight out
of the live-param cache. That cache is deliberately NOT cleared when the
`/ws/signals` socket drops (every meter holds its last frame rather than
snapping to zero), so the pill went on asserting **PARTY SIGNAL ON** — or OFF —
with no engine behind it. Nothing in the render path observed the link at all.

## The seam

Three surgical pieces; nothing else in the audio pipeline was touched.

| File | Change |
|---|---|
| `CaptainPad/utils/audioSignals.ts` | New pure reducer `nextPartySignalTruth(prev, obs)` + `PARTY_SIGNAL_UNKNOWN`, `PartySignalTruth`, `PartySignalObservation`. Decides *whether we are entitled to a verdict*. `describePartySignal` is untouched — it still owns the 0.5 ON/OFF boundary. |
| `CaptainPad/hooks/useEngineState.ts` | New narrow hook `useLiveSignalsConnected()` — subscribes ONLY to `engineSignalsEvents.subscribeStatus` (the `/ws/signals` transport that actually carries `audioParty`), re-renders on connect/disconnect edges only, never at the 15-30 Hz value cadence. Reads status; mutates nothing. |
| `CaptainPad/app/(tabs)/audio.tsx` | `LiveAudioMeters` folds `{connected, doc, value}` through the reducer into a ref **during render**, then labels `truth.value`. Reducing in render (not an effect) is what makes the unknown paint on the same frame as the disconnect. |

Why the signals bus and not the control bus: `audioParty` rides `liveParams` on
`/ws/signals`. The control socket being up says nothing about whether the value
on screen is observable. This is the narrowest connection truth for this pill.

### Freshness marker: document IDENTITY, not revision, not a timer

Two rejected alternatives, recorded because both look reasonable:

- **Revision-must-advance.** The engine REPLAYS its last cached `liveParams`
  payload to every fresh `/ws/signals` connection
  (`api_server.js`, `wssSignals.on('connection')`), and that replay carries the
  same CPC revision. Gating on "revision moved" would hold the pill at `…`
  after a reconnect whenever the analyser is quiet — but the replayed value IS
  the engine's current held gate, and the engine is what drives the lights. That
  would be a false unknown about a knowable truth.
- **An age / no-message timeout.** `liveParams` is CHANGE-driven — a calm room
  produces no frames at all — so "nothing arrived recently" is not evidence of
  lost truth. A staleness window would flip a healthy calm rig to `…` and would
  also mean inventing a threshold. Not done.

What is used instead: each WS frame is parsed into a **fresh object**, so
document identity distinguishes "the engine just told us" from "React still
holds the pre-outage frame". On drop we remember the document in hand and refuse
it; the reconnect replay is a new object and lands within milliseconds.

## Behaviour table (state × link → display)

| Live link | Document in hand | `audioParty` | Pill |
|---|---|---|---|
| never connected | none yet | — | `PARTY SIGNAL …` |
| connected | fresh arrival | `>= 0.5` | `PARTY SIGNAL ON` |
| connected | fresh arrival | `< 0.5` | `PARTY SIGNAL OFF` |
| connected | fresh arrival | absent / non-finite | `PARTY SIGNAL …` |
| **drops while ON** | frozen pre-outage frame | `1` | `PARTY SIGNAL …` (same frame) |
| **drops while OFF** | frozen pre-outage frame | `0` | `PARTY SIGNAL …` (same frame) |
| stays down | frozen frame | any | `PARTY SIGNAL …` (no-op, same object) |
| **reconnected, nothing arrived yet** | still the distrusted frame | `1` | `PARTY SIGNAL …` |
| **reconnected, engine frame lands** | new document | whatever it says | ON / OFF from THAT value |

`tone` is unchanged (`'off'` for unknown, as startup already rendered) — the
operator's existing pill colours are untouched. No party threshold was added, no
detection retuned, no unrelated live state cleared: the live-param cache, every
meter, the trace canvases, OSC/BPM pills all behave exactly as before.

## Tests — `CaptainPad/utils/audioSignals.test.ts`

+8 tests (the required six plus two guards), driving the exact fold the tab
runs. `pill()` in the test asserts the end-to-end operator-visible label, not
just the intermediate value.

1. startup — no link, no document → `…`
2. ON — live document, `1` → `PARTY SIGNAL ON`
3. OFF — live document, `0` → `PARTY SIGNAL OFF`
4. disconnect after ON → `…` on the same observation (and stays, as a no-op)
5. disconnect after OFF → `…` (OFF is a claim, not a default)
6. reconnect → holds `…` on the distrusted frame, resumes on the fresh one
7. connected but no `audioParty` / non-finite → `…`
8. idempotent + reference-stable while the stream repeats itself

No component-level test: vitest here is scoped to pure `.ts` logic
(`vitest.config.ts` include globs) and there is no RN testing library in the
tree. The reducer is the whole decision; the component is three lines of glue.

## Verify

| Check | Result |
|---|---|
| `npx vitest run utils/audioSignals.test.ts` | 10 passed |
| `npx vitest run` (full) | **1121 passed**, 6 skipped, 0 failed (baseline 1113 + 8; failing list still empty) |
| `npm run typecheck` | clean |
| `npx eslint` on the 4 touched files | 0 errors; 2 warnings, both pre-existing in `useEngineState.ts` (`Array<T>` at 613, `useMemo` deps at 923) — untouched lines |
| `npm run web:build` | Exported: dist (build only; no server, no port) |

Live stack on 6966-6972 was not touched.

## Residual, out of scope

A half-open socket (playa Wi-Fi vanishing without a TCP close) still reads as
connected until the OS times it out, so the pill can hold the last engine value
during that window. Closing it needs an engine-side heartbeat on the signals
topic, which is engine work and a new contract — not a CaptainPad presentation
change.
