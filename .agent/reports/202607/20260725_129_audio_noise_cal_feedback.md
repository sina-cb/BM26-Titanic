# `_129` — Audio Companion: noise-floor calibration APPLY feedback

**Operator report (2026-08-03):** *"In the AUDIO COMPANION, when I run NOISE
LEVEL CALIBRATION and apply it, there is NO UI feedback — nothing shows that the
noise level was actually set."*

**Fixed.** The apply now (a) tells the operator, in one line, exactly what
landed — sourced from an **authoritative read-back**, not an echo of the value
the browser sent — and (b) leaves a small, always-present readout of the noise
floor next to the calibrate control that is correct after an app reload.

---

## 1. Where the companion lives and what "apply" actually did

| Piece | Path |
|---|---|
| Companion server (sole analyzer, WS + UI host, default `:6966`) | `marsin_engine/audio/companion/companion_server.js` |
| Companion UI (plain script, no bundler) | `marsin_engine/audio/companion/ui/{index.html,companion_app.js,companion_app.css}` |
| Engine link (single source of truth for shared tuning) | `marsin_engine/audio/companion/engine_config_link.js` |
| Named venue profiles | `marsin_engine/audio/companion/mic_profiles.js` (+ `mic_profiles.yaml`) |

The **noise floor** is not a dB number — it is the analyzer's per-band **noise
gates** (`lowGate` / `midGate` / `highGate`, unit = post-envelope band level in
`[0, 0.999]`), with a global `noiseGate` as the floor a band uses when it has no
override.

The apply path, before this change:

```
MIC TUNE ▸ ▶ Calibrate noise floor
  → ws {startNoiseCal}         → server records ~4 s of ambient (NOISECAL_MS)
  → ws {noiseCalResult}          recommended[band] = max(noiseGate, p90(band))
  → operator taps ✓ Apply
  → ws {applyNoiseGates,gates}
      server: applyBandGate() ×3 (live analyzer)
              broadcast {gates}                      ← sliders move, nothing else
              writeThroughShared(noop, {bands:{…}})  ← FIRE AND FORGET PATCH
```

`writeThroughShared` PATCHes `/audio/config` on the engine and **does not await
it**; the only failure surface was a generic `engineLink` flash. On success:
three sliders nudged and a number label changed. That is the whole of the
"feedback" the operator was missing — and if the PATCH 400'd, the UI still
looked exactly like a success.

The engine is the thing that **persists** the gates (`PATCH /audio/config` →
`audioState.applyLiveUpdate` → `states/<scene>/audio_state.yaml`) and
rebroadcasts them to CaptainPad, so it — not the companion's local variables —
is the authority when it is up.

---

## 2. What was added

### 2.1 `marsin_engine/audio/companion/noise_floor.js` (new, pure)

The apply arithmetic + operator copy, extracted so it is unit-testable (same
split as `party_tuning.js`, since `companion_server.js` needs a live socket):

- `normalizeGateBundle(bands)` — an engine `/audio/config` `bands` block or the
  live analyzer's `bands` → the companion's gate shape. A per-band `null` is the
  documented "inherit the global gate"; a **missing or non-finite global gate
  throws** (codex P0 — never invent a number to display).
- `effectiveGates(gates)` — resolves inheritance to what is actually gating.
- `formatGateSummary(gates)` — the always-visible line:
  `low 0.061 · mid 0.043 · high 0.180 · global 0.040`.
- `verifyGateApply({requested, applied})` — requested vs. read-back, tolerance
  `5e-4` (the calibration rounds to 3 dp). Returns the per-band mismatches.
- `formatApplyMessage({ok, source, applied, mismatches, error})` — the one-line
  copy for every outcome. It **refuses** to render an incoherent outcome
  (`ok:true` with no read-back gates, unknown source) rather than print a
  reassuring sentence.

### 2.2 `companion_server.js` — `applyNoiseFloor(ws, gates, opts)`

The new apply handler, replacing the fire-and-forget block:

1. apply locally (analysis never blocks on the engine) and broadcast `gates`;
2. **`await engineLink.patch(partial)`** when the link is up;
3. **read back the authoritative post-apply state** — `readBackGates()` prefers
   the engine's own post-PATCH config body (source `engine`), and falls back to
   the live analyzer's `bands` (source `analyzer`, reported to the operator as
   *local only*) **only when there is no engine to be authoritative**;
4. reconcile local state + sliders to the read-back (so the engine's clamping,
   not ours, is what is displayed);
5. `verifyGateApply` requested vs. read-back;
6. emit `noiseApplyResult { ok, source, gates, savedTo, text }`.

A rejected PATCH, a read-back that throws, or a value that came back different
all produce `ok:false` with a loud line. There is **no** success-looking state
for an apply that did not land.

Also:

- `gatesMsg()` — every `gates` broadcast (and `hello`) now carries a
  server-built `summary`, so the persistent readout is server truth and is
  correct on a fresh page load.
- `hello` carries `gatesSummary` + `lastNoiseApply`.
- `saveActiveProfile` with a gate bundle (the calibration's 💾 *Save to
  "profile"*) now routes through the same verified apply and **only snapshots
  the profile when the read-back proves the gates landed** — a profile can no
  longer record a value the pipeline refused. A non-finite gate in that message
  is rejected loudly instead of being coerced.

### 2.3 UI (`companion_app.js`, `index.html`, `companion_app.css`)

Two lines under the calibrate card, both quiet (no banner, no toast, no layout
jump — the transient line reserves its row height while empty):

| Element | Behaviour |
|---|---|
| `#noisecal-applied` | The apply confirmation, e.g. `✓ noise floor set (engine) — low 0.061 · mid 0.043 · high 0.180`. **Success auto-clears after 5 s**; a **failure stays** until the next apply. Appends `· saved to "<profile>"` when the save path was used. |
| `#noisecal-current` | Always present: `noise floor now: low 0.061 · mid 0.043 · high 0.180 · global 0.040`, from the server's `gates.summary` (re-seeded on `hello`, so a reload shows it). |

On reload, a previous **failure** is re-shown (tagged `(last apply)`); a
previous success is **not** re-announced — the persistent line already states
the truth, and a stale ✓ would read as "just now".

---

## 3. Evidence

### 3.1 Tests

`marsin_engine/tests/companion/companion_noise_floor.test.js` — **17 new tests,
all green.** They pin: read-back normalization (incl. throwing on missing /
non-finite gates), inheritance, the summary format, verification (a clamped
value fails, the 3 dp tolerance holds, malformed input throws), and every copy
outcome (set / local-only / failed PATCH / mismatch / incoherent).

Suite runs (`MARSIN_CONFIG_FILE` black-holed to a throwaway path +
`tests/helpers/setup_config_guard.mjs`, per the engine test contract):

- `tests/companion/*` + `tests/audio/*`: **663 pass / 5 fail** — all 5 are
  `tests/audio/audio_capture.test.js` demanding a pinned Windows mic device
  (environmental, untouched by this change).
- Full engine suite (`npm test`): **2549 tests, 2540 pass, 9 fail** — the 5
  above plus `effects_v2_mode_page_layout`, `osc_listener` EADDRINUSE,
  `status_output_routing`, and the `specialty_white_uv` playlist byte-identity
  check. All environmental / pre-existing (the operator's live stack holds
  `:6968` and the OSC port), none in `audio/companion`.
- `git diff --check` clean; `node --check` clean on every touched JS file.

### 3.2 Screenshots

Rendered from the **real** UI files driven by frames whose copy is produced by
the **real** `noise_floor.js` formatter, in a throwaway harness
(`~/tmp/noise_cal_shots/shoot.mjs`) — the operator's live companion (`:6966`),
engine (`:6968`) and the rest of the stack were **not** touched, and no gate was
written to the running engine.

| File (`~/tmp/noise_cal_shots/`) | Shows |
|---|---|
| `noise_apply_ok.png` | `✓ noise floor set (engine) — low 0.061 · mid 0.043 · high 0.180` + the persistent line + sliders/labels moved to the read-back values |
| `noise_apply_fail.png` | `✗ noise floor NOT set — engine PATCH failed: "bands.lowGate": must be in [0, 0.999]` — and the persistent line still reads the OLD, true `0.040` gates (no success-looking state) |
| `noise_apply_reload.png` | Fresh load, no calibration run: `noise floor now: low 0.061 · mid 0.043 · high 0.180 · global 0.040` — requirement 2 |

---

## 4. Notes / follow-ups

- The *gain* calibration (`▶ Calibrate gain → ✓ Apply gain`) still applies via
  the old fire-and-forget `setInputGain` path and has the same silence problem
  at a smaller blast radius. Same treatment would be a small follow-up.
- CaptainPad's audio screen shows the gates but has no apply-verification of its
  own; it receives the engine's `audioConfig` broadcast, so it stays correct
  either way.
- The transient line's 5 s lifetime is `NOISE_APPLY_MS` in `companion_app.js`.
