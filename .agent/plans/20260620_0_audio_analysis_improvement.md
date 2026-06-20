# 2026-06-20 — PLAN: Audio Analysis Improvement (autonomous 10h run)

**This file is GROUND TRUTH for the autonomous Audio Round 2 operation.** The
instigator (orchestrating Claude) reloads this file at every check-in and drives
the project from it. Companion file: `20260620_1_audio_analysis_verification.md`
(proof log — nothing is "done" until it has verification proof there).

- **Deliverable branch:** `feat/audio_analysis_2` (everything merges here; NO PR
  unless the operator asks).
- **T0:** 2026-06-20 ~02:43Z · **Deadline:** ~2026-06-20 12:43Z (T0 + 10h).
- **Operator:** Sina (OUT OF SERVICE — full autonomous authority granted, incl.
  merge authority. Do NOT block waiting for approval.)

---

## 1. GROUND TRUTH (operator directives — verbatim intent, do not lose)

From the operator's messages (the mandate):

1. **Improve the audio analysis game.** Current state is loved (smooth, flexible,
   "just works") — keep that feel.
2. **Mood detection:** we have **calm** and **party**. Great. **ADD GENRE
   DETECTION** for party mode: **techno, melodic house, deep house**, plus other
   genres popular at Burning Man. Keep it a **simple** genre detection driven by
   **the signals we already have (kick, low, high, and their state)**.
3. Operator offered **SoundCloud / Spotify credentials** to listen to songs and
   tune. (Treated as optional; tune on datasets/synths we can reach — see §7.)
4. **Note detection** works but **needs more validation**; the **note→color change
   signals were NOT working** — fix + validate.
5. **Audio Companion** must show **ALL signals being sent to the marsin engine on
   ONE page** — a **new "OSC OUT" accounting page**.
6. **Companion does NOT use the CaptainPad theme** — port CaptainPad's color themes
   (light/dark/midnight/sunset/gruvbox) into the companion.
7. **Kick off 2 agents** to find **new features** + **low-hanging-fruit
   improvements** on the audio side. (DONE — see reports `20260620_2`, `20260620_3`.)
8. **Use datasets / music files from different genres**, tune the heck out of genre
   detection AND the other signals, **test them all**. **Note down any new datasets
   used** (in `marsin_engine/datasets/README.md`).
9. **Parallelize with as many agents as needed in git worktrees** without conflict;
   give each **separate ports**; **run only 2–3 engines at a time** (resource cap —
   the engine is heavy).
10. **Merge everything into `feat/audio_analysis_2`** — that is the deliverable.
11. **Write reports** (dated, `.agent/02_reports/202606/`).
12. **Full authority to take this end to end.**
13. **Start 3 MORE agents** focused on **P1-and-above features** in: **audio
    analysis, DSP, signal, detection, scoring of detections**, and **some UI
    improvement areas**.
14. **Drop detection, slow zone, build-up** all need **super tuning AND validation**.
15. **When we run out of features, kick off 5 ADVERSARIAL agents** to find the **top
    10–15 P1 and P0 features again and implement them.**
16. **Schedule a task every 30 minutes**: come up, **check the plan + tasks**,
    **update the reports and the `_verification` file**; **if the plan/queue is
    empty, add more work.**
17. **Keep going until 10 hours from now.**
18. **Write the plan in `.agent/plans/`** using the report naming convention.
19. **Verification discipline:** in `_verification.md`, **any task crossed off must
    show REAL verification proof** — screenshots, captures, test output, and the
    process taken to close it. Bake this into the protocol (§5).
20. **Note down ALL ground truth in this plan** (this section).

---

## 2. MAIN GOAL

Make the Titanic's audio-reactive lighting dramatically smarter and better-tuned for
a Burning Man dance floor, WITHOUT losing the "smooth, just-works" feel:

- **Genre-aware party mode** (techno / house family / melodic / downtempo) from
  cheap existing signals.
- **Rock-solid detections** — drop, slow-zone, build-up **super-tuned and validated**
  with real precision/recall/F1 scoring.
- **Trustworthy note→color** behavior.
- **Operator observability** — one page that accounts for every OSC signal sent to
  the engine, themed like CaptainPad.
- **New high-value audio-reactive signals** (per-band onsets, sub-bass chest-hit,
  riser/anticipation, track-change, phrase, climax…) implemented P1-first.
- Everything **merged to `feat/audio_analysis_2`**, **tested**, **verified with
  proof**, and **reported**.

---

## 3. OPERATING PROTOCOL (how the instigator drives this autonomously)

Per `.agent/00_gol/13_multi_agent.md` (instigator + worktree sub-agents). The
operator granted standing merge authority for this run, so the instigator merges
without pausing — but ONLY after a branch meets the §5 quality+verification bar.

**Loop (event-driven + 30-min cron backstop):**
1. A sub-agent completes → its branch + report land. Instigator REVIEWS the branch.
2. If it passes §5 → **merge into `feat/audio_analysis_2`** (safest-first: pure-add
   before shared-file edits), run post-merge auto-checks, append PROOF to
   `_verification.md`, update §6 queue status here.
3. Merge conflicts (esp. `derived_signals.js` setMany hub) → instigator resolves by
   hand using both reports as the union-of-intent (operator pre-authorized).
4. If a slice failed/partial → log it in §6, re-queue or re-scope.
5. **Resource cap:** never more than **2–3 engine processes** booting at once.
   Offline harnesses (`tools/pattern_audio_harness.mjs`, `tests/integration/
   run_analysis*`, corpus) are preferred over a live engine for validation.
6. **Keep the queue full** until the deadline: when §6 ACTIVE+QUEUED empties, launch
   the **adversarial wave** (§4). Stop launching new work at the deadline; finish
   merges/verification already in flight, then write the final merge summary.

**Worktree / port discipline** (`13_multi_agent.md` §4–5):
- Worktrees: `~/workspace/BM26-Titanic-worktrees/<slug>` on `dev/<slug>` off
  `feat/audio_analysis_2`. `dev/*` is LOCAL ONLY — never pushed.
- Slot ports: base `31000 + slot*100`; engine API `…68`, OSC `…00`, companion uses
  the slot base region. Free-port-check before boot; kill servers after.
- node_modules is SHARED via symlink from the main checkout (engine + CaptainPad) —
  agents must NOT run npm install unless the symlink is missing.
- Codex P0 always: **no fallback behaviors / fail loud**, all imports top-of-file,
  snake_case filenames, scratch in `~/tmp/` only, no `git reset --hard`, restore any
  touched `states/*.yaml`, don't commit per-worktree `config.yaml` port edits.

---

## 4. AGENT TYPES & WAVES

**Available sub-agent types** (FleetView): `general-purpose` (full tools, used for
dev worktree agents), `Explore` / read-only investigators, `Plan` (architect),
`claude` (catch-all). The instigator uses `general-purpose` for code worktrees and
read-only investigators for discovery/adversarial review.

**Wave A — Foundations (LAUNCHED, in flight):**
- Slot 0 `dev/genre_signals` — genre detection + note→color fix (audio/signals).
- Slot 1 `dev/companion_ui` — OSC accounting page + CaptainPad theming.
- Slot 2 (discovery) — new-feature ideas → report `20260620_2`. ✅ DONE.
- Slot 3 (discovery) — low-hanging-fruit/bug triage → report `20260620_3`. ✅ DONE.

**Wave B — P1+ features & super-tuning (LAUNCHING NOW, operator msg #13/#14):**
- Slot 2 `dev/detector_tuning` — **drop + slow-zone + build-up SUPER-TUNING &
  VALIDATION** + a real **detection-scoring/eval harness** (precision/recall/F1 on
  corpus + synths). Owns `audio/detector/*` + drop/slow config.
- Slot 3 `dev/analyzer_features` — **per-band onsets** + **sub-bass chest-hit** (cheap
  high-value DSP from `20260620_2` #2/#4), additive analyzer outputs + shaper modules
  + new CPC keys.
- Slot 4 `dev/captainpad_audio_ui` — **UI improvement** on the CaptainPad side (rich
  modulation popup w/ live trail + mapping viz, scrollable signal grid, dynamic audio
  signals) per contract `20260617_0`. Disjoint from the companion UI.

**Wave C — Adversarial (triggered when §6 queue empties, operator msg #15):**
- **5 adversarial agents** re-audit the merged `feat/audio_analysis_2` to find the
  **top 10–15 P0/P1** issues/features across DSP, detection, scoring, signals, UI,
  tests/robustness — then the instigator **implements** the top ranked ones (new
  worktrees, same protocol). Re-run each time the queue empties before the deadline.

---

## 5. DEFINITION OF DONE + VERIFICATION DISCIPLINE (operator msg #19)

A task is **crossed off only when `_verification.md` carries REAL PROOF**:
- The exact **command(s) run** and their **output** (test pass/fail counts, harness
  correlation/score numbers, eval precision/recall/F1).
- **Captures/screenshots** for any UI or signal-shape claim (companion page render,
  theme switch, trace plots, detection-vs-label overlays). On headless machines use
  the puppeteer render path / `make_vis_clip.mjs`; if a capture is truly impossible,
  record a scripted DOM/CSS/numeric assertion AND say why no image.
- The **process** taken to close it (what was changed, how it was validated, what was
  ruled out).
- **No proof ⇒ not done.** "Tests pass" with no numbers is not proof.

Every sub-agent MUST put proof in its report; the instigator copies the decisive
proof into `_verification.md` at merge time and only then checks the box in §6.

Subsystem gates (per `.agent/00_gol/05_marsin_engine_auto_checks.md` etc.): touched-
subsystem auto-checks green, `node --test` green (incl. new tests), engine
`--dry-run` boots, clean `git status`, no port leftovers.

---

## 6. WORK QUEUE (living — update every check-in)

Legend: ⏳ ACTIVE · 📋 QUEUED · ✅ DONE(+verified) · ⚠️ PARTIAL/BLOCKED · ❌ DROPPED

### Wave A
- ⏳ A0 genre detection + note→color fix — `dev/genre_signals` (slot 0)
- ⏳ A1 companion OSC accounting page + CaptainPad theming — `dev/companion_ui` (slot 1)
- ✅ A2 discovery: new audio features → `20260620_2`
- ✅ A3 discovery: low-hanging-fruit triage → `20260620_3`

### Wave B (launching)
- ✅ B2 detector super-tuning + scoring/eval (drop/slow/build) — `dev/detector_tuning` MERGED @ `8ac1b6d` (Drop F1 0.29→0.71 / precision 1.00; slow-zone acc 0.46→0.91; 250+40 tests green; proof in `_verification` 04:00Z)
- ✅ B3 analyzer features: per-band onsets + sub-bass chest-hit — `dev/analyzer_features` MERGED @ `1aa12f4` (242 tests green + dry-run exit 0; proof in `_verification` 03:20Z)
- ✅ B4 CaptainPad audio UI improvements — `dev/captainpad_audio_ui` MERGED @ `bd0fc34` (proof in `_verification` 03:00Z; tsc+lint exit 0 on merged tip)

### Instigator-owned (apply post-merge, from `20260620_3`)
- 📋 I1 fix dead `switch_signals` startup guard (epoch-ms bug, P1) — after A0 merges
- 📋 I2 pass `PARAMS.bpm` to `BpmTracker` / reconcile stale keys (P1) — after A0 merges
- 📋 I3 doc fixes: dom `useKalman` comment, audioBpm `[0,180]` range (P3)
- 📋 I4 (DEFERRED, follow-up) FFT 1024→2048 + fixed-`dt`: re-tune genre/dom/note + HIL

### Backlog (refill source — from `20260620_2`, pull P1-first)
- 📋 riser/build anticipation + drop ETA · 📋 track-change/silence · 📋 phrase/8-16-bar
  · 📋 drop countdown · 📋 climax/hands-up · 📋 advisory AGC (opt-in) · 📋 key/scale (HARD)

---

## 7. DATASETS (operator msg #8 — note ALL datasets used)
- Reachability: prior reports note this datacenter IP is bot-gated for YouTube/audio
  fetch. Primary validation path = the deterministic **synth bank**
  (`audio/synth/test_synths.js`, extended with genre + melodic profiles) + the FMA
  EDM **corpus harness** (`tests/integration/corpus*.mjs`) if audio is present.
- Any real audio fetched (CC0/royalty-free) or dataset used MUST be appended to
  `marsin_engine/datasets/README.md` with name/source-URL/license. Audio stays in
  `~/tmp/`, never committed.

## 8. CHECK-IN CRON (operator msg #16, every 30 min)
A persistent Monitor heartbeat emits a tick every 30 min (≈20 ticks to the deadline).
On each tick (and on every agent-completion event) the instigator:
1. Reloads this plan. 2. Reviews running/finished agents; merges anything that passed
§5. 3. Updates the §6 queue + the dated reports + appends PROOF to `_verification.md`.
4. If ACTIVE+QUEUED is empty → launch the adversarial wave (§4 Wave C). 5. At the
deadline → stop launching, finish in-flight merges/verification, write the merge
summary report, push `feat/audio_analysis_2`.

## 9. STATUS LOG (append-only, newest last)
- `02:43Z` T0. Wave A launched earlier; A2/A3 discovery DONE + reports committed
  (`509e285`). Baseline: 223 audio+companion tests green. Wave B worktrees created;
  launching B2/B3/B4 + 30-min heartbeat. Queue per §6.
- `03:00Z` B4 (CaptainPad UI) completed + MERGED @ `bd0fc34`; tsc+lint exit 0 on the
  merged tip (proof logged). Still in flight: A0 genre/note, A1 companion, B2 detector
  tuning, B3 analyzer features. 4 agents running.
