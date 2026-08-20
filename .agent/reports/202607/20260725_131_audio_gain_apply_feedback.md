# `_131` — Audio Companion: input-gain calibration APPLY feedback

Follow-up to `_129` §4 (*"the gain calibration still applies via the old
fire-and-forget `setInputGain` path and has the same silence problem at a
smaller blast radius"*).

**Fixed, with the identical treatment.** `▶ Calibrate gain → ✓ Apply gain` now
(a) awaits the write, (b) reports in one line what an **authoritative read-back**
says actually landed — never an echo of the number the browser sent — and
(c) leaves a small always-present readout of the gain in force that is correct
after an app reload.

---

## 1. What "✓ Apply gain" used to do

```
MIC TUNE ▸ ▶ Calibrate gain
  → ws {calibrate}      → server records ≤5 s, peak → recommendedGain
  → ws {calResult}
  → operator taps ✓ Apply gain
  → ws {setInputGain, value}
      server: writeThroughShared(applyInputGain + broadcast,
                                 { bands:{ inputGain } })   ← FIRE AND FORGET PATCH
```

`writeThroughShared` PATCHes `/audio/config` and does **not** await it. On
success: a slider nudged. On a rejected PATCH: a slider nudged, plus a generic
`engineLink` flash. Identical-looking outcomes for "the engine took it" and
"the engine refused it" — and the engine is what **persists** the gain
(`audio_state.yaml`) and what CaptainPad reads.

---

## 2. What was added

### 2.1 `audio/companion/apply_readback.js` (new, pure, shared)

The one thing the two verified-apply paths genuinely share: the **provenance
vocabulary**. `SOURCE_LABEL` (`engine` / `local only`) + `sourceLabel(source,
context)`, which **throws** on an unknown source — a confirmation line whose
provenance we can't name must not render at all. `noise_floor.js` now imports
it instead of carrying its own copy (its `formatApplyMessage` copy and thrown
message are unchanged; `_129`'s 17 tests still pass untouched).

### 2.2 `audio/companion/input_gain.js` (new, pure)

Same split as `noise_floor.js` — the arithmetic + operator copy live outside
`companion_server.js` so they're testable without a socket:

- `GAIN_MIN` / `GAIN_MAX` (`[0, 64]`, the engine validator's + analyzer's
  bounds) and `GAIN_EPSILON` `5e-3` (the calibration recommends at 2 dp).
- `normalizeGainRequest(v)` — the OPERATOR's ask. Out of range or non-numeric
  **throws**; nothing is written. No silent clamp into a distorting value.
- `normalizeInputGain(bands)` — the READ-BACK, from an engine `/audio/config`
  bands block or the analyzer's bands. Missing / non-finite / out-of-range
  **throws** (codex P0: never invent a number to display).
- `formatGainSummary(gain)` — the always-visible readout, `×3.70`. **2 dp** so
  an engine clamp is visible instead of being rounded away.
- `verifyGainApply({requested, applied})` → `{ok, mismatch}`.
- `formatGainApplyMessage({ok, source, applied, mismatch, error})` — the
  one-line copy for every outcome; refuses to render an incoherent one.
- **`runGainApply({requested, applyLocal, engineLink, readAnalyzerGain})`** —
  the apply PATH itself, with every side effect injected. This is what makes
  the *order* (the whole point of the change) unit-testable, and it is
  literally the code the server runs — not a mirror that can drift:

  ```
  validate the request (refuse → write nothing)
    → apply locally (analysis never blocks on the engine)
    → AWAIT the engine PATCH
    → read the AUTHORITATIVE post-apply gain back
    → reconcile the local value to it
    → verify requested vs. read-back
    → one line saying what actually landed
  ```

**One improvement over `_129`'s failure path.** When the engine is up and
*refuses* the write, `runGainApply` **re-reads the engine's own config once**
and reconciles to that. Rationale: a refused write leaves the engine on its own
value, the engine is the truth that persists, and its next `audioConfig`
broadcast would overwrite our optimistic local apply anyway. Without the
re-read the operator sees a red *"NOT set"* directly above *"input gain now:
×3.70"* — the number nothing upstream ever accepted. With it, the two lines
agree (see the fail screenshot: `×1.48`, the engine's own gain). It is one
authoritative read, not a retry; if that read also fails, the line says **both**
failures. The same upgrade would suit the noise-floor path — noted as a
follow-up rather than smuggled into `_129`'s tested copy.

### 2.3 `companion_server.js`

- `applyGainVerified(ws, value, opts)` — supplies the side effects
  (`applyInputGain` + broadcast, the real `engineLink`, `liveAnalyzerGain`),
  then turns the verdict into `gainApplyResult { ok, source, gain, savedTo,
  text }` and remembers it as `lastGainApply`.
- `liveAnalyzerGain()` — the read-back when there is no engine. The
  `mode === 'test'` branch reads the MIC PREAMP state rather than
  `analyzer.bands.inputGain`, because the synthetic test source deliberately
  renders at unity (`effectiveInputGain`, report `_39`); for mic/file the two
  are the same number and reading the analyzer proves the reconfigure landed.
- New WS message **`applyInputGain`** — the one-shot operator apply. The
  continuously-dragged sliders keep the cheap `setInputGain` write-through
  (awaiting every drag event would be worse than useless).
- `gainMsg()` — every `inputGain` broadcast (and `hello`) now carries a
  server-built `summary`, so the persistent readout is server truth and is
  right on a fresh page load. All four broadcast sites were switched to it.
- `hello` carries `gainSummary` + `lastGainApply`.
- `saveActiveProfile` now accepts an `inputGain` alongside the gate bundle and
  routes it through the same verified apply with `persistProfile`, so a profile
  can only ever record a gain the read-back proved landed — the same rule
  `_129` gave the gates. The pre-existing snapshot paths (`addProfile`, plain
  `saveActiveProfile`, `applyNoiseFloor`'s `prof.inputGain = inputGain`) get
  this for free: after any verified apply the local variable IS the
  authoritative read-back.

### 2.4 UI (`companion_app.js`, `index.html`)

Two lines under the **Calibrate gain** card, mirroring the noise card exactly
(same `.mac-applied` / `.mac-current` classes — no CSS change needed):

| Element | Behaviour |
|---|---|
| `#gaincal-applied` | The confirmation, e.g. `✓ input gain set (engine) — ×3.70`. **Success auto-clears after 5 s**; a **failure stays** until the next apply. Appends `· saved to "<profile>"` on the save path. |
| `#gaincal-current` | Always present: `input gain now: ×3.70`, from the server's `inputGain.summary` (re-seeded on `hello`, so a reload shows it). |

On reload a previous **failure** is re-shown tagged `(last apply)`; a previous
success is not re-announced. `NOISE_APPLY_MS` became **`APPLY_CONFIRM_MS`** —
one 5 s lifetime shared by both cards. The DESIGN page's compact `Apply` button
now uses the same verified message and surfaces the server's read-back text as
a flash (it has no line of its own); its old optimistic
`flash('gain → ×…')` — which lied on a failed apply — is gone.

---

## 3. Evidence

### 3.1 Tests

`marsin_engine/tests/companion/companion_input_gain.test.js` — **30 new tests,
all green.** They pin the request guard (out-of-range refused before anything
is written), read-back normalization (throws on missing / non-finite /
impossible), the summary format, verification (clamp fails, 2 dp tolerance
holds, malformed throws), every copy outcome, and the **apply-path outcomes
end to end** against fake engine links: ok, engine PATCH rejected, refused-write
reconcile to the engine's own gain, PATCH + re-read both failing, read-back
mismatch (clamped) with the live value following the engine, untrusted
read-back, engine offline (`local only`), a down link never consulted, a
stubborn analyzer that ignored the write, and the profile save only snapshotting
a proven gain.

Suite runs (`MARSIN_CONFIG_FILE` black-holed to a throwaway path +
`tests/helpers/setup_config_guard.mjs`, per the engine test contract):

- `tests/companion/companion_input_gain.test.js` +
  `companion_noise_floor.test.js`: **45 pass / 0 fail** (`_129`'s 17 unchanged).
- Full engine suite (`npm test`): **2582 tests, 2573 pass, 9 fail** — the exact
  `_129` baseline failure set: `audio_capture` ×5 (wants a pinned Windows mic),
  `effects_v2_mode_page_layout`, `osc_listener` EADDRINUSE,
  `status_output_routing`, `specialty_white_uv` playlist byte-identity. All
  environmental / pre-existing (the operator's live stack holds `:6968` and OSC
  `:10000`), **no new failures**, none in `audio/companion`.
- `git diff --check` clean; `node --check` clean on every touched JS file.

### 3.2 Screenshots

Rendered from the **real** UI files, driven by frames whose copy is produced by
the **real** `input_gain.js` `runGainApply` against fake engine links, in a
throwaway harness (`~/tmp/gain_apply_shots/shoot.mjs`, HTTP on **:31941** —
the agent slot range). The operator's live companion (`:6966`), engine
(`:6968`) and the rest of the stack were **not** touched, and no gain was
written to the running engine.

| File (`~/tmp/gain_apply_shots/`) | Shows |
|---|---|
| `gain_apply_ok.png` | `✓ input gain set (engine) — ×3.70` + `input gain now: ×3.70`, slider moved to the read-back |
| `gain_apply_fail.png` | `✗ input gain NOT set — engine PATCH failed: "bands.inputGain": must be in [0, 64]` — and the readout reconciled to the engine's own `×1.48`, so nothing looks like a success |
| `gain_apply_mismatch.png` | `✗ input gain MISMATCH (engine) — asked ×24.00 got ×16.00` + `input gain now: ×16.00` (the engine clamped; the operator is shown the engine's number) |
| `gain_apply_reload.png` | Fresh load, no calibration run: `input gain now: ×3.70` — the reload-safe readout |

---

## 4. Notes / follow-ups

- The noise-floor path could take the same **re-read on a refused PATCH**
  (§2.2); today it falls to the analyzer read-back, so a rejected gate write can
  leave `noise floor now:` showing the locally-applied value under a red
  "NOT set". Small, self-contained follow-up.
- The gain card still has no *"💾 Save to profile"* button; the server side of
  it (`saveActiveProfile` + `inputGain`) is in place and tested if the operator
  wants the button.
- CaptainPad's audio screen shows gain but has no apply-verification of its
  own; it receives the engine's `audioConfig` broadcast, so it stays correct
  either way.
