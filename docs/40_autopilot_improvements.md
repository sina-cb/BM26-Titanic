# 40 — Autopilot Improvements (audio-detected mix events)

**Status:** DESIGN / TODO — not built. Filed as a **P1 for Burning Man 2026**
(future feature, not July-11 party prep). Tracked on the Notion board
*Titanic Lighting - Task Tracker*.
**Author:** remote agent (Claude), branch `feat/timeline_support`.
**Related (all real, all reused):**
`38_timeline_show_scheduler.md` (the Timeline / Show-Director this extends) ·
`37_marsin_audio_framework.md` (the Audio Companion — the detection source) ·
`26_audio_params_playlist.md` + `15_central_param_center_cpc.md` (mood signals via CPC) ·
`19_playlists.md` (playlists + pattern autopilot) ·
`39_channels_deck_mixer.md` (deck output + view-override / takeover machinery).

> **One-line pitch.** Let the Timeline react to the *room* as well as the
> *clock and sky*: when the audio framework detects a **high-volume party
> moment**, the show fires a transient **auto-detected cue** that takes over the
> deck for a bounded time — but only in the gaps. It **overrides the default
> cue, never a regularly-planned cue**, and it **steps aside the instant a
> planned cue starts**. It decides *when* off the music; the engine stays the
> executor of *what*, exactly like the rest of docs/38.

---

## 1. Why this, why now

The Timeline (docs/38) already follows the clock, the sun, named phases, and
coarse mood transitions (calm → party). What it does **not** do is react to a
sudden, unplanned surge in the room — the DJ drops into a peak, the crowd goes
off, and nothing on the plan happens to be scheduled for that minute. Today the
operator has to notice and take over by hand. The codex goal — **be kind to the
operator** — says the rig should ride that moment on its own, then quietly let go.

This is **not** a new scheduler and **not** a replacement for the default cue or
planned cues. It is a **transient, audio-triggered overlay on the cue precedence
stack**: a special cue that the *audio* arms, that lives *below* the operator's
authored plan and *above* the standing default.

---

## 2. The feature

**Detection.** The Audio Companion (docs/37) already publishes mood / energy /
kick / party signals into the CPC (docs/26, docs/15). An **audio-event detector**
watches for a **sustained high-volume + party** condition (both above threshold
for a debounce window, so a single transient spike does not fire it). When it
latches, it raises an **auto-detected event**.

**The auto-detected cue.** The event maps to a special cue *kind* — call it an
`auto` cue — that configures the deck like any other cue (it reuses the same
action shape docs/38 §16.9 cues already use: playlist + pattern autopilot +
color autopilot + deck TX + hue + globals). It is **held on for a bounded time**
(a `hold`/duration window) after the triggering condition, so the look does not
flicker on and off with the music. When the window elapses **and** the condition
has relaxed, the auto cue releases and the deck falls back to whatever should be
running underneath (see precedence).

**It is a "replace the default" layer, not a scheduled event.** The operator does
not place it on the day timeline. It is defined once (per plan, or as a rig-level
default) and the *audio* decides when it runs.

---

## 3. Cue precedence (the whole point)

The deck already resolves an owner every tick (docs/38): a **planned cue** owns
its window; in the gaps the **default cue** runs. Auto-detected cues slot **between**
those two:

```
operator takeover           (highest — a human always wins; docs/39 lease)
  └─ planned cue (in its window / hold)
       └─ AUTO-DETECTED cue  (NEW — only when NO planned cue is active)
            └─ default cue    (lowest — the standing fallback)
```

Concretely:

1. **Auto cue replaces the DEFAULT cue, never a planned cue.** If a regularly-
   planned cue is active (in its window or authored hold), the auto cue **does
   not fire** — the plan wins. The auto cue is only eligible to take the deck
   when the resolver would otherwise be running the *default* cue.
2. **A starting planned cue disables an active auto cue.** If an auto cue is
   currently holding the deck and a planned cue's trigger fires, the auto cue is
   **immediately released** and the planned cue takes over. (The auto cue does
   not "resume" afterward — when it releases, the resolver re-evaluates from
   scratch; the auto detector may re-arm if the condition still holds and no
   planned cue owns the window.)
3. **Operator takeover still wins over everything.** The existing takeover lease
   (docs/39) sits above the whole stack; while the operator holds it, neither the
   auto cue nor the plan drives the deck. On release, the resolver re-evaluates
   (planned cue → auto → default) as usual.
4. **Out of the festival window the plan is dormant (docs/38) → the auto detector
   is dormant too.** No plan driving = no auto cues.

The auto cue behaves like a very-short-lived cue that the *audio arms and the
clock/plan can pre-empt*. Reuse the existing owner-resolution + view-override /
release machinery rather than inventing a parallel path.

---

## 4. Open design questions (decide before building)

- **Definition surface.** Is the auto cue authored once per plan (a new
  `plan.autoCue` block, sibling to `plan.defaultCue`), or is it a rig-level
  default independent of the active plan? Leaning: **per-plan**, so different
  shows can react differently (a philharmonic-sunset plan may want no party
  auto-cue at all).
- **Detection thresholds + debounce.** Exact signals (volume vs energy vs kick),
  the on/off thresholds, the sustain window to latch, and the minimum hold once
  latched. Must not chatter. Source these from docs/37's published signals.
- **Release semantics.** Hard cut vs crossfade back to the underlying cue when
  the auto window ends (reuse deck TX). Probably crossfade.
- **UI.** How the operator sees an auto cue is active (a distinct banner/pill,
  matching the plan-lock/takeover language in docs/39) and how they author its
  action (reuse the cue editor cards — this is why docs/38's cue editor now
  reuses the deck cards).
- **Interaction with color/pattern autopilot.** The eventual vision (operator,
  2026-07-04) is **one autopilot controlling both patterns and colors, audio-
  driven or not** — the auto-detected cue is the first concrete step toward that
  unification; keep the design compatible with folding pattern + color autopilot
  into a single audio-aware driver later.

---

## 5. Why it matters

On a peak party night the difference between "the operator caught the drop" and
"the operator was refilling water" should not decide whether the Titanic lights
up with the room. This makes the rig *feel alive* to the music without taking the
plan or the operator's hands off the wheel — and it is the seed of the unified,
audio-aware autopilot the operator wants.
