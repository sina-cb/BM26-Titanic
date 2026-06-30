# 2026-06-20 — Companion + CaptainPad adversarial fixes (items 5–10)

**Author:** developer sub-agent (worktree `dev/companion_captainpad_fixes`, parent
`feat/audio_analysis_2`). **Scope:** the SAFE, disjoint subset of the adversarial-wave
findings (`20260620_9` items 5–10). The BACKLOG items (FFT 2048, fixed-dt, genre v2,
detector scoring) are explicitly OUT OF SCOPE — coordinated follow-ups.

## Scope / files changed

| # | Fix | File(s) |
|---|-----|---------|
| 5 | OSC accounting `rateHz` decays at read time (no stale-rate lie) | `marsin_engine/audio/companion/companion_server.js` |
| 6 | Light-theme on-accent WCAG AA fix via `--on-accent` token | `marsin_engine/audio/companion/ui/companion_app.css` |
| 9 | Native `window.confirm()` → themed confirm modal | `marsin_engine/audio/companion/ui/companion_app.js`, `…/index.html`, `…/companion_app.css` |
| 7 | `isGenreKey` excludes `audioGenreConf` | `CaptainPad/utils/audioSignals.ts` |
| 8 | `curateDeckSignals` band-token collision (segment-anchored match) | `CaptainPad/utils/audioSignals.ts` |
| 10 | DerivedSignals perf-budget + end-to-end finiteness tests | `marsin_engine/tests/derived_signals_perf_finiteness.test.js` (new) |
| — | Test extensions for 5 + 6 | `marsin_engine/tests/companion_osc_accounting.test.js` |

## The exact fixes

### 5 — OSC accounting rateHz never decayed (companion_server.js)
`rateHz` was only folded in `recordOscSend`, and `buildOscAccounting` read it raw —
a stopped stream (disabled tap, or BPM during silence where `emitDerivedBpm` returns
false) reported its last EWMA forever (observability that LIES, codex P0). Added
`effectiveRateHz(acc, now)` that, at READ time, folds the idle interval into the EWMA
as a value-0 step (`rate ← (1 − a)·rate`, `a = min(1, idleMs/TAU)`) and forces exactly
`0` once `idle > OSC_RATE_IDLE_CUTOFF_TAUS (4) × TAU (1000ms)`. `buildOscAccounting`
now reports `effectiveRateHz(acc, now)` instead of `acc.rateHz`.

### 6 — Light-theme on-accent contrast (companion_app.css)
`.seg-btn.active`, `.cal-apply`, `.primary` hardcoded `color:#1a1205` on `--accent`.
On the LIGHT theme's teal accent `#006875` that is **2.86:1** — fails WCAG AA (4.5).
Added a per-theme `--on-accent` token (`:root`/dark/midnight/sunset/gruvbox →
`#1a1205`, which passes 8.77–10.93:1 on their lighter accents; **light → `#ffffff`**,
which passes at **6.49:1**) and routed all 3 literals through `var(--on-accent)`. No
fallback default — every theme defines it so a missing token FAILS visibly (P0). This
mirrors CaptainPad's `.nav-btn.active{color:var(--bg)}` posture.

### 9 — Native confirm() dialogs removed (companion_app.js)
`removeView` / `removeSignal` used `window.confirm(...)` (the designer contract says
NO native dialogs). Added a reusable themed `confirmModal(message, onConfirm)` backed
by a new `#confirm-modal` (reuses `.modal`/`.modal-box`/`.modal-foot`, themed via the
existing CSS vars). Both removers now route through it; the destructive action runs in
the confirm callback. Verified: `grep` for `window.confirm|alert|prompt` in the
designer → **0 matches**.

### 7 — isGenreKey over-matched audioGenreConf (audioSignals.ts)
`/genre/i.test(key)` matched `audioGenreConf` (a real [0,1] confidence), so the AUDIO
tab would have rendered the confidence through `audioGenreName()` as a fake genre
NAME (0 → "AMBIENT"). Now `/genre/i.test(key) && !/conf/i.test(key)`. Sole use site
(`audio.tsx:374 slotValueText`) verified: `audioGenreConf` now falls through to the
numeric readout.

### 8 — curateDeckSignals band-token collision (audioSignals.ts)
`key.toLowerCase().includes('low')` is TRUE for `audioSlowZone` ("s**low**zone");
same fragility for mid/high. Added `keyHasBandToken(key, token)` that splits the
camelCase/underscore key into lowercase word segments
(`audioSlowZone → ['audio','slow','zone']`, `micLow → ['mic','low']`) and tests
SEGMENT equality. `curateDeckSignals` now uses it. `micLow`/`audioLow`/`low` still
match LOW; `audioSlowZone`/`audioHighway`/`audioMidnight` correctly rejected.

> Related (NOT changed — out of scope, item 8 is `curateDeckSignals` only):
> `audioAccentHex` has the same `k.includes(token)` shape and would give
> `audioSlowZone` the LOW teal instead of the `slow` cyan. It is a cosmetic accent
> (not a P0 lie). Flagging for a follow-up; left untouched to keep this slice disjoint.

### 10 — Test gaps (tests/derived_signals_perf_finiteness.test.js, NEW)
- **10a PERF:** drives the REAL `DerivedSignals.tick()` against a real `ParamCenter`
  with PARTY latched ON (genre re-score + 3 band-onset shapers + sub-bass + bpm + note
  + switch all hot), 200k hops (auditor methodology — dilutes GC outliers), asserts
  steady-state **p99 ≤ 0.5 ms/hop** (the detector's `docs/30` budget). Measured
  **p99 ≈ 0.39 ms** (matches the auditor's ~0.38 ms).
- **10b FINITENESS:** ticks ~25 s and asserts EVERY hop that the NEW keys
  (`micOnsetLow/Mid/High`, `audioChestHit` ∈ [0,1]; `audioGenre` ∈ [0,6];
  `audioGenreConf` ∈ [0,1]) are finite numbers in range through the integrated
  publish path; also asserts party actually latched (the hot path was real).

## Verification proof (paste-ready for `_verification.md`)

### Companion tests (incl. new rateHz-decay + extended theme test)
```
cd marsin_engine && node --test tests/companion_*.test.js
→ # tests 70 · # pass 70 · # fail 0   (was 69; +1 decay test)
ran 3× consecutively → 70/70 every time (the initial under-load count-race flake
  was fixed by snapshotting the frozen count AFTER a 400ms settle post-removal).
```
Decay test (`a STOPPED OSC stream decays its accounting rate toward 0`): boots the
real server, forces TEST mode so `/marsin/mic/low` streams (asserts count>0 & rate>0),
removes the `low` signal, waits past the 4×TAU cutoff, asserts the row's `count` stays
frozen and `rateHz === 0`.

### Companion live boot + /osc_accounting
```
node audio/companion/companion_server.js --port 31466   (headless, no mic device)
curl /osc_accounting →
  {"target":{"host":"127.0.0.1","port":10000},"totalSent":0,"outputs":[
    {"address":"/marsin/mic/low",...,"rateHz":0}, … ,
    {"address":"/marsin/audio/bpm","cpcKey":"audioBpm","kind":"derived",...,"rateHz":0}]}
```
Endpoint shape intact; every row carries `rateHz`. (No mic in the datacenter → no
stream flowed, so every rate is the correct 0 for a never-started stream — the decay
behaviour under a LIVE-then-stopped stream is proven by the test above, which forces
TEST mode. No chromium → JSON capture in lieu of a screenshot.) Server killed; `ps`
confirms 0 leftover companion/engine processes.

### WCAG contrast (numeric proof for fix 6)
```
light accent #006875 vs OLD #1a1205 = 2.86:1  (FAILS AA 4.5)
light accent #006875 vs NEW #ffffff = 6.49:1  (PASSES AA 4.5)
dark/midnight/sunset/gruvbox accent vs #1a1205 = 8.77 / 9.22 / 10.78 / 10.93 :1 (pass)
```

### CaptainPad
```
cd CaptainPad && npx tsc --noEmit            → exit 0
cd CaptainPad && npm run lint                → exit 0
  (12 pre-existing warnings, 0 errors, NONE in audioSignals.ts / audio.tsx — matches
   the documented baseline; no new warnings from this branch)
```
No ts/jest runner present → behavioural proof via a standalone node check mirroring the
exact `isGenreKey` / `keyHasBandToken` / `curateDeckSignals` logic:
```
item7 isGenreKey: PASS  (audioGenre=true, micGenre=true, audioGenreConf=false, genreConf=false)
item8 keyHasBandToken: PASS  (micLow/audioLow/low match; audioSlowZone/Highway/Midnight rejected)
curateDeckSignals([micLow,micMid,micHigh,micKick,audioSlowZone,audioEnergy])
  → ["micLow","micMid","micHigh","micKick","audioEnergy"]   (audioSlowZone NOT curated)
ALL CaptainPad behavioral checks PASS
```

### Engine
```
node --test tests/audio_*.test.js tests/party_mode.test.js tests/genre_classifier.test.js \
            tests/companion_*.test.js tests/derived_signals_perf_finiteness.test.js
→ # tests 240 · # pass 240 · # fail 0
  [derived perf] hops=200000 p50=0.0111ms p99=0.3943ms   (budget 0.5ms — PASS)

node engine.js --pattern test_const --model test_bench --port 31468 --dry-run
→ exit 0  "Dry run complete. Pattern loads and compiles OK."  52/52 pixels patched
```

### Clean tree
```
git status --short →
 M CaptainPad/utils/audioSignals.ts
 M marsin_engine/audio/companion/companion_server.js
 M marsin_engine/audio/companion/ui/companion_app.css
 M marsin_engine/audio/companion/ui/companion_app.js
 M marsin_engine/audio/companion/ui/index.html
 M marsin_engine/tests/companion_osc_accounting.test.js
?? marsin_engine/tests/derived_signals_perf_finiteness.test.js
```
No node_modules (gitignored symlink), no `states/*.yaml` residue, `git diff --check`
clean. All servers killed.

## Items NOT done (with reason)
- None of the assigned items 5–10 were blocked; all implemented + verified.
- `audioAccentHex` band-token collision (same class as item 8, cosmetic-only) left
  for a follow-up — out of this slice's scope (item 8 is `curateDeckSignals`).
- No UI SCREENSHOTS of the themed confirm modal / contrast fix — no chromium/puppeteer
  in this datacenter. Proven instead by the committed CSS-var theme test, the numeric
  WCAG ratios, and a `grep`-confirmed absence of native dialogs. Visual check deferred
  to a browser machine before playa.
