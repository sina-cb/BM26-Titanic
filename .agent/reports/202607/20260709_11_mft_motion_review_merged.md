# MFT Knob Motion — Merged Adversarial Review (Fable + Opus)

**Date:** 2026-07-09 · **Author:** coordinator (merging two independent cold reviews)
**Sources:** `20260709_9_mft_motion_review_fable.md` (Fable, primary-source firmware
read) · `20260709_10_mft_motion_review_opus.md` (Opus, protocol audit) · operator's
live MIDI capture (slow twist vs fast flick, midi_discovery export 09:20)

Both reviewers were run **cold** — no prior diagnosis given — and told to
adversarially audit the CaptainPad MFT pipeline against the upstream **pymft**
library and the MIDI Fighter Twister firmware. They converged on the same root
cause independently. Where they disagreed, the operator's hardware capture
settles it.

---

## 1. The agreed root cause (both reviews, both CRITICAL/P0)

`decodeRelativeDelta` (mft/messages.ts, at HEAD) mapped **only CC values
61–67** (±1/±2/±3) and returned `null` — a silent drop — for every other value.
The MFT in `VELOCITY_SENSITIVE` mode encodes speed in the **value offset**:

```
value = 64 + ticks × mult        (firmware encoders.c:744-777)
```

so any turn faster than ~70 detents/s produces offsets ≥ ±4 → **outside the
map → the entire movement discarded**. Slow turns stay at ±1..±3 → decoded.
This is byte-for-byte the operator's symptom: *"when I move fast, it misses
the movement altogether; slow is somewhat better."*

A second, compounding bug: `relativeStep` (resolver.ts) clamped |delta| to 3,
so even a decoded fast code couldn't sweep proportionally.

**Four rounds of "feel tuning" failed because they tuned gain curves on top of
a decoder that was throwing the fast input away.**

## 2. The provenance finding (why the false model survived so long)

Both reviews independently discovered: **pymft never decodes relative
encoders at all.** Its rotary decode path is absolute (`value/127`); the
61–67 constants in it are **dead documentation code**. Our TS port cloned
those dead constants into a fabricated "velocity class ±1/±2/±3" decode path
that never matched the hardware, and comments describing that false protocol
(including a fabricated "55/70/127" example set) propagated through
constants.ts / accel.ts / docs and misled every subsequent fixer.

The pymft-derived **SysEx config push is clean** — byte-for-byte correct
against pymft and the firmware enums (both reviews audited it; non-finding).

## 3. The one disagreement — resolved by the capture

| Question | Opus | Fable | Hardware capture | Verdict |
|---|---|---|---|---|
| Max velocity multiplier | 1–32 (values 32–96) | **1–17** (`scaled_mult = 1 + ((256>>4) & 0x1F) = 17`, from encoders.c) | max observed value **81 = +17** exactly | **±17** (Fable + capture). Decode stays full-range defensively with a per-message travel cap. |

Capture corroboration: slow twist = steady stream of 65 (+1) at ~100–150 ms;
fast flick = 715 messages in ~10 s, values 47–81 (= −17..+17), bursts at
2–10 ms. During the fast label, the overwhelming majority of values fell
outside 61–67 → dropped at HEAD.

## 4. Verdict on the in-flight fix (round 5, uncommitted at review time)

Both reviews: the fix's **decode axis is correct** (full-range `value − 64`,
proportional un-clamped step) and should land. Both flagged the same two
issues in its first shape:

- **F2 — double acceleration (P1):** the firmware multiplier (1–17×) is
  already the acceleration curve; the value is *pre-accelerated travel meant
  to be applied 1:1*. Stacking the host Hill-curve gain (×0.5–10) on top
  computes 50–140 range-units/s on a hard flick → params slam to the rails.
  Predicted next complaint: "fast is a light switch."
- **F3 — MIDI-learn regression (P1):** manager.ts:887 used
  `decodeRelativeDelta(v) !== null` as its "looks like a relative encoder"
  learn-guard; with a full-range decoder that predicate is always-true, so
  learning absolute controls (APC faders) breaks. Needs a dedicated
  narrow-band predicate.

## 5. The recommended model (adopted; relayed to the fix agent)

1. **Full-range decode** `delta = value − 64` (land as-is; fail loud only on
   malformed MIDI).
2. **Identity host gain:** apply `delta × S` with the **firmware as the single
   acceleration authority**. Neutralize the TickAccelerator on the MFT
   relative path. One feel constant: `S ≈ 0.0025` (slow detent = 0.0025 →
   ~400 detents full range; max flick 17×S ≈ 0.043/msg; sustained fast spin
   sweeps the range in a fraction of a second, as the firmware curve intends).
3. **Per-message travel cap** so a stray out-of-spec code can never teleport
   a parameter.
4. **Fix the learn-gate predicate** (manager.ts) + update the ~8
   manager.test.ts magnitude expectations that encoded the old clamped math.
5. **Correct the false-protocol comments** (constants/accel/config + docs/34)
   to the true `64 + ticks×mult, mult 1–17` model so no future fixer
   re-derives the wrong spec.
6. Tests pinned to the **literal captured sequences** (slow 65-stream, fast
   81/77/74 bursts at 2–10 ms).

Status at merge time: fix agent executing exactly this list; exit gate =
whole CaptainPad suite green. RESPONSIVE-mode (fixed ±2 codes) noted by Opus
as a fallback simplification if identity-gain feel still disappoints — not
needed unless hardware pass fails.

## 6. Non-findings (audited clean by both)

SysEx connect/config push · channel map · Web-MIDI timestamping & rate
estimate · optimistic-anchor echo guard · CC coalescer summation.
