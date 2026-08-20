# `_132` — Audio Companion MIC TUNE polish: refused-write re-read + gain save-to-profile

The two follow-ups `_131` §4 left open, accepted by the operator as a wave:

1. give the **noise-floor** apply path the refused-write re-read that
   `runGainApply` got in `_131`;
2. add the **"💾 Save to `<profile>`"** button the gain card was missing (the
   server side was already in place and tested).

---

## 1. Noise floor: reconcile to the engine when it REFUSES the write

### The hole

`applyNoiseFloor` applies the gates locally and broadcasts them *before* the
PATCH (analysis never blocks on the engine). When the engine then **rejects**
the write, `_129`'s `readBackGates` fell through to the **analyzer** — which is
running the optimistic local value. Result: a red
`✗ noise floor NOT set — engine PATCH failed: …` sitting directly above
`noise floor now: low 0.061 · mid 0.043 · high 0.180` — the very numbers the
engine had just refused. The engine is still up, still authoritative, still
holding its own gates, and its next `audioConfig` broadcast would overwrite the
local apply anyway.

### The fix — `resolveGateReadBack` (new, pure, in `noise_floor.js`)

The read-back decision moved out of `companion_server.js` into a pure, awaited
helper so the new behaviour is unit-testable without a socket (the same reason
`_131` extracted `runGainApply`; `applyNoiseFloor`'s surrounding structure and
every WS frame it emits are unchanged):

| Situation | Read-back source | Behaviour |
|---|---|---|
| Engine took the write | `engine` | its own post-PATCH body — unchanged from `_129` |
| Engine **refused** the write | `engine` | **re-read `/audio/config` ONCE**, reconcile the sliders + summary to the engine's own gates. The verdict stays `ok:false` — the re-read fixes *what is shown*, never the outcome |
| Refused, and the re-read **also** fails | `analyzer` | error becomes `…; engine re-read failed: <why>` — both failures reported, nothing swallowed |
| Refused, engine has nothing to serve (`fetchConfig` → `null`, the documented 503 "audio not initialized") | `analyzer` | analyzer read-back, original error intact |
| No engine at all | `analyzer` | labelled *local only* — unchanged from `_129` |
| Read-back we can't trust | — | `gates:null` + `read-back failed: …`; never a number |

One authoritative read, not a retry loop (pinned by a test that counts the
`fetchConfig` calls, and by one asserting a *successful* write is never
re-read). `companion_server.js` now imports `resolveGateReadBack` and drops its
own `readBackGates`; `error` is taken from the resolver so the appended re-read
failure reaches the operator's line.

**`_129`'s 17 tests all still pass, unmodified** — no pinned expectation had to
change. The only edit to that file is the appended §5 section (8 new tests) and
its header note.

---

## 2. Gain card: "💾 Save to `<profile>`"

`_131` wired `saveActiveProfile` to accept an `inputGain` and route it through
the verified apply (`persistProfile`), but shipped no control for it. Added,
mirroring the noise card **exactly**:

- `index.html` — `<button id="gaincal-save" class="primary">💾 Save to <span
  id="gaincal-save-name">profile</span></button>`, the second button in the
  same `.mac-result` row as `✓ Apply gain`, same classes, same copy shape as
  `#noisecal-save`.
- `companion_app.js` — the click sends
  `{ type:'saveActiveProfile', inputGain: r.recommendedGain }` (calibrate the
  gain *into* the profile, exactly as the noise button sends its recommended
  gates). `renderProfiles` now keeps **both** save buttons' labels current from
  one `label` string.
- No CSS change: the existing `.mac-result` / `.primary` rules already lay it
  out identically to the noise card's pair.

The server answers on the existing `gainApplyResult` path, so the card's own
one-liner covers the button: `✓ input gain set (engine) — ×3.70 · saved to
"Quiet room"`, and a refused write still writes nothing into the profile.

---

## 3. Evidence

### 3.1 Tests

- `tests/companion/companion_noise_floor.test.js` — **8 new tests** appended as
  §5 (engine-preferred read-back, analyzer only when there's no engine truth,
  refused-write re-read exactly once, re-read failure reporting both errors,
  `fetchConfig → null`, successful write never re-read, untrusted read-back
  yields no gates, missing `readAnalyzerBands` rejects). **`_129`'s 17
  untouched and green.**
- `companion_noise_floor` + `companion_input_gain`: **55 pass / 0 fail**.
- Full engine suite (`npm test`, `MARSIN_CONFIG_FILE` black-holed per the
  engine test contract): **2590 tests, 2581 pass, 9 fail** — the same
  environmental set as the `_131` baseline (`audio_capture` ×5,
  `effects_v2_mode_page_layout`, `osc_listener` EADDRINUSE,
  `status_output_routing`, `specialty_white_uv`; the operator's live stack holds
  `:6968` and OSC `:10000`). **No new failures**, none in `audio/companion`.
- `git diff --check` clean; `node --check` clean on every touched JS file.

### 3.2 Screenshots

Throwaway harness `~/tmp/companion_polish_shots/shoot.mjs`, HTTP on **:31942**
(agent slot range), rendering the **real** UI files with frames produced by the
**real** `resolveGateReadBack` / `formatApplyMessage` / `runGainApply`. The
operator's live companion (`:6966`), engine (`:6968`) and the rest of the stack
were **not** touched; no gate and no gain was written to the running engine.

| File (`~/tmp/companion_polish_shots/`) | Shows |
|---|---|
| `noise_refused_write.png` | `✗ noise floor NOT set — engine PATCH failed: "bands.highGate": must be in [0, 0.999]` **above** `noise floor now: low 0.040 · mid 0.040 · high 0.040 · global 0.040` — the engine's own gates, re-read; the readout no longer contradicts the failure |
| `gain_save_button.png` | The gain card after a calibration: `✓ Apply gain` + the new `💾 Save to "Quiet room"`, laid out exactly like the noise card's pair |
| `gain_saved_to_profile.png` | After the save: `✓ input gain set (engine) — ×3.70 · saved to "Quiet room"` + `input gain now: ×3.70` |

---

## 4. Notes

- The two cards' apply paths are now behaviourally identical: same read-back
  authority rules, same refused-write reconcile, same transient-✓ /
  persistent-✗ lines, same reload-safe readout, same verified save-to-profile.
- `applyNoiseFloor` still pre-clamps the requested gates to `[0, 0.999]` before
  verifying (pre-existing `_129` behaviour, deliberately left alone), so its
  mismatch case fires on an engine that clamps *differently*, not on an
  out-of-range ask. The gain path refuses an out-of-range ask outright — the
  difference is intentional and documented in each module's header.
- No git operations; no service on `:6966-:6972` was started, stopped or
  written to.
