# MFT knob-motion pipeline — adversarial protocol review vs upstream reference

- **Date:** 2026-07-09
- **Reviewer:** cold adversarial reviewer (no prior diagnosis supplied), report #9.
  A second independent reviewer writes #10.
- **Scope:** CaptainPad MFT knob-motion path only — `CaptainPad/utils/midi/mft/{config,messages,constants}.ts`,
  `utils/midi/accel.ts`, `utils/midi/resolver.ts`, `utils/midi/manager.ts` (read-only).
- **State reviewed:** branch `feat/party_integration_20260711` @ `0dd960f`, **with the
  working tree's uncommitted edits** (a fix agent is concurrently editing; uncommitted
  diffs present in `mft/messages.ts`, `resolver.ts`, `accel.ts`, `manager.ts` and tests).
  Where HEAD and the working tree diverge on a finding, both states are named.
- **Primary sources (cloned and read verbatim, not summarized):**
  - `github.com/sina-cb/pymft` (the library the TS port cites) — `pymft/src/{pymft,constants,encoder,device_settings,config}.py`
  - `github.com/DJ-TechTools/Midi_Fighter_Twister_Open_Source` (official firmware) —
    `src/encoders.c`, `src/encoders.h`, `src/input.h`, `src/input.c`, `src/config.c`
  - The MFT User Guide 2020 PDF is vendored inside the pymft repo (`mft-user-guide/`).

---

## 1. What the hardware actually sends (firmware ground truth)

For an encoder configured `SEND_REL_ENC` (2) + movement `VELOCITY_SENSITIVE_ENC` (2) —
exactly what our connect config pushes — the send path is
`process_encoder_input_rotary_relative`, `encoders.c:744-777`:

```c
if(encoder_settings[banked_encoder_id].movement == VELOCITY_SENSITIVE_ENC) {
    int8_t tick_count = new_value < 0 ? -1*new_value : new_value;
    uint16_t base_multiplier = convert_ticks_per_scan_to_value_multiplier(tick_count, cycle_count);
    int16_t scaled_mult = 1 + ((base_multiplier >> 4) & 0x1F); // 0-16
    output_value = 64 + new_value*scaled_mult;   // Relative: Bin Offset
} else {
    output_value = 64 + new_value;               // Relative: Bin Offset
}
...
if (output_value != 64) { midi_stream_raw_cc(ch, cc_number, output_value); }
```

with the velocity curve (`encoders.c:549-557`, `input.h:67-73`, `input.c:90-92`):

```c
multiplier = slope * ticks_per_sample + offset;   // linear in tick rate
clamped to [VELOCITY_CALC_MIN_MULTIPLIER=1, VELOCITY_CALC_MAX_MULTIPLIER=256]
// calibration: mult=1 at 30 ticks/s ... mult=256 at 250 ticks/s (1.21 ms samples)
```

Consequences, all verified in source:

1. **The CC value is binary-offset around 64**: signed offset = `value − 64`. ✔ (matches
   the working tree's new decode)
2. **The legal offset range is ±1 … ±17 per message**, not ±1…±3:
   `scaled_mult = 1 + ((mult >> 4) & 0x1F)` with `mult ∈ [1,256]` → `scaled_mult ∈ [1,17]`
   (`new_value` is ±1 per scan in practice — comment at `encoders.c:724`). The offset
   crosses ±2 at ≈43 detents/s and saturates at ±17 at 250 detents/s.
3. **The offset is pre-accelerated travel, not a "speed class."** `scaled_mult` is the
   firmware's velocity multiplier — the same role `base_multiplier` plays in the
   ABSOLUTE path (`encoders.c:788-812`), where it directly multiplies internal travel.
   The receiver is meant to apply `value − 64` **1:1** as counts of travel. The
   acceleration curve already lives in the firmware.
4. **Message rate:** one CC per encoder per scan block whenever `output_value != 64`;
   direction changes debounced at ~6 ms (`ENCODER_DEBOUNCE_CYCLE_TIMEOUT`, `input.h:86-89`),
   so worst case is on the order of 160+ msg/s per encoder. No burst batching on the
   device side.
5. **Responsive/EMULATION mode** sends fixed `64 ± 2` per tick (`encoders.c:740-742`,
   `ENCODER_RELATIVE_TICKS_RESPONSIVE = 2`, `encoders.h:47`). DIRECT sends `64 ± 1`.
6. Enum values confirmed against `encoders.h` (the live header; `encoder_types.h` is
   marked deprecated): `SEND_NOTE=0, SEND_CC=1, SEND_REL_ENC=2`;
   `DIRECT=0, EMULATION=1, VELOCITY_SENSITIVE_ENC=2`; `encoder_config_t` byte layout
   matches sysex addresses 10-24 in order.

### What pymft actually is (and is not)

**pymft never decodes relative encoders.** Its decode path (`pymft.py:337-361`,
`_handle_midi_message`) assigns the rotary-channel CC value as an ABSOLUTE 0-127
position (`self._config._encoders[cc].value = value`, then `update_mapped_value()`
maps 0-127 → min/max). Its defaults are `MIDITYPE_SENDCC` + `MOVEMENTTYPE_DIRECT_HIGHRESOLUTION`
(`pymft.py:236-242`). The `EncoderControl` constants (61-67, "fast/veryfast") exist in
`constants.py:36-53` but are **dead code — referenced nowhere**. So for relative-mode
value semantics, pymft is not an authority at all; the firmware is the only reference.
Our port's comments cite pymft for a decode path pymft does not implement.

What pymft IS authoritative for — the sysex config push — our port matches
**byte-for-byte**: setting addresses 10-24 and order (`encoder.py:13-28` ↔
`constants.ts:258-274`), 24-byte BULK_XFER chunking with tag = index+1
(`encoder.py:89-123` ↔ `config.ts:49-98`), global PUSH_CONF frame with the 25-30
address gap (`device_settings.py` ↔ `constants.ts:293-322`), `send_all()` order
encoders-then-global (`config.py:80-84` ↔ `config.ts:155-194`). `switch_midi_type` is
ignored by the firmware anyway (`encoders.c:285` hardcodes it to 0). **No config-push
findings.**

---

## 2. Findings, ranked by likely contribution to the symptom

Symptom: *"when I move fast, it misses the movement altogether; slow is somewhat better."*

| # | Sev | State | Finding | Evidence (ours) | Reference that contradicts it |
|---|-----|-------|---------|-----------------|-------------------------------|
| F1 | **P0 — root cause of the reported symptom** | HEAD (`0dd960f`), i.e. the build the operator ran; **fixed in the uncommitted working tree** | `decodeRelativeDelta` was a six-code switch (61-67 → ±1/±2/±3) returning `null` for every other value, and `resolveEvent` turned that `null` into a silent drop. But the firmware legally sends offsets up to **±17** — codes 47…63 and 65…81. Offset ≥ ±4 begins at ≈70 detents/s, i.e. any brisk spin. Above that speed **every message** was outside 61-67 → the entire movement discarded. Between ≈43-70 det/s, codes ±2/±3 decoded but understated travel (multiplier read as class). Below ≈43 det/s everything worked. That is *exactly* "fast is missed altogether; slow is somewhat better." | HEAD `mft/messages.ts` (`git show 0dd960f:...`, decode switch, ~lines 72-89); HEAD `resolver.ts` (delta === null → return null) | `encoders.c:748-753` (`scaled_mult` 1..17); `input.h:68-73` (mult 1..256, 30..250 ticks/s) |
| F2 | **P1 — the working-tree fix overcorrects: double acceleration** | working tree | The new decode (`value − 64`, correct) feeds `relativeStep()` = `delta × steps[0]` (correct, linear 1:1) — but then `TickAccelerator.applyTick` multiplies **again** by a Hill-curve gain 0.5→10× whose rate input `mag/dt` already contains the firmware's 1→17× multiplier. Two acceleration curves compound multiplicatively → response ~quadratic in turn speed. Worked example (S=0.005): 100 det/s spin → firmware offset ≈6/msg → raw ≈3.0 range-units/s → host rate estimate 3.0 ≫ HALF_RATE 0.18 → gain ≈9.9 → **≈30 range-units/s**; a hard flick computes 50-140 range-units/s. Every bounded param slams to its rail on any fast gesture (and hue spins multiple full wheels). The feel bug flips from "fast is lost" to "fast is a light switch". Additionally the rate estimator's units are corrupted: "rate" is firmware-*accelerated* travel/s, not physical speed, so ACCEL_HALF_RATE=0.18 maps to different physical speeds at different speeds — the curve's own x-axis moves. | `accel.ts:96-135, 183-189` (GAIN_MAX 10, Hill of mag/dt); `resolver.ts:194, 209-212`; `manager.ts:1024-1034` (per-tick gain then sum) | Firmware already applies the full velocity curve **inside the value** (`encoders.c:748-753`); the offset is designed for 1:1 application — cf. the absolute path applying the same multiplier directly to travel (`encoders.c:788-812`), and `input.h:69` calibration comment ("sweeps 14-bit value in 48 ticks (half turn)") |
| F3 | **P1 — collateral regression of the in-flight fix** | working tree | `manager.ts:887`: while MIDI-learn is armed, `isRelativeCode = decoded.type === 'cc' && decodeRelativeDelta(decoded.value) !== null` rejects the capture. With the old six-code decode this matched only 61-67; with the new full-range decode it is true for **every CC value except exactly 64, on every device** — so learning an APC (or any absolute) fader is now rejected as "order-mapped-encoder" unless the first captured tick happens to be value 64. MIDI-learn for absolute controllers is effectively broken in the working tree. | `manager.ts:887-903` | `decodeRelativeDelta` (working tree `mft/messages.ts:93-101`) returns non-null for all 0-127 except 64 — by design |
| F4 | **P2 — false protocol documentation embedded in code** | both | The port's comments encode a protocol that does not exist: `constants.ts:40-50` presents 61-67 as *the* relative codes ("±3 very fast" as the ceiling); `accel.ts:8-16, 54-60` builds the whole round-4 rationale on "velocity CLASS: codes ±1/±2/±3" and claims this was "verified in the decode path" (it was verified against our own constants, not the device); the port cites pymft as the reference for relative decode, which pymft never implements (its `EncoderControl` block is dead code; its real decode is absolute — `pymft.py:337-352`). These comments are how F1 survived several fix rounds: each round re-derived the feel model from a wrong spec. | `constants.ts:40-50`; `accel.ts:8-16,54-60`; `messages.ts` header | `encoders.c:744-777`; `pymft.py:337-352` |
| F5 | **P3 — theoretical wraparound edge (informational)** | both | `output_value` is `uint8_t`; `64 + new_value*scaled_mult` with a multi-tick scan (`new_value` beyond ±3, "technically it could hold values higher", `encoders.c:724`) can exceed 7-bit and wrap, arriving as a large opposite-sign offset which the host would now decode and (per F2) amplify. Physically requires >millisecond-scale multi-detent scans — unreachable at the encoder's real 250 det/s ceiling (max legit offset ±17, wrap needs >±63). No action needed beyond an optional plausibility clamp (e.g. reject/clamp |delta| > 32). | working tree `messages.ts:93-101` accepts 1-127 fully | `encoders.c:724-753` |
| F6 | **clean** | both | Everything the config push claims was verified true: SENDRELENC=2 and VELOCITYSENSITIVE=2 match the firmware enums; sysex addresses/order/chunking/global frame match pymft byte-for-byte; channels (rotary raw 0, switch/color raw 1, system raw 3) match both pymft and the firmware; bank-change decode (ch3 CC0-3=127) matches. Web MIDI timestamps are genuine per-message `e.timeStamp` (`web_midi_transport.ts:137-141`), so the host rate estimator's input is sound; the 33 ms coalescer **sums** deltas and drops nothing (`manager.ts:1024-1034`). | — | — |

---

## 3. Recommended correct model

The firmware already implements exactly the feel curve the operator keeps asking for —
linear 1× at ≤30 det/s ramping to 17× at 250 det/s, per-detent precision preserved.
The host's job is to *apply* it, not to re-derive it:

1. **Decode:** `delta = value − 64`, full range, only 64 = no-op. (Working tree already
   does this — keep.)
2. **Travel:** `travel = delta × S` with `S` = the per-count step (today `steps[0]`).
   Strictly linear, no clamp. (Working tree already does this — keep.)
3. **Host gain: identity.** Delete the Hill/EMA accelerator from this path (or pin
   `GAIN_MIN = GAIN_MAX = 1`). The firmware multiplier IS the acceleration; two curves
   compound quadratically (F2). If Sina still wants finer-than-detent slow motion, set
   `S = 0.0025` directly (his stated slow-detent target) instead of the current
   `0.5 × 0.005` gain trick — same slow feel, zero state. Sanity of the result with
   S = 0.0025: slow detent 0.0025; hard flick ≈ 17 counts/msg × ~160 msg/s × 0.0025 ≈
   6.8 range/s → full sweep in ~150 ms of hard spin; moderate spin ~1.5 range/s. That
   is the DJTT-designed feel, single authority, no transient-ramp tuning knobs at all.
4. **If host-side feel-shaping is ever wanted again**, first switch the firmware config
   to `MOVEMENTTYPE_DIRECT_HIGHRESOLUTION` (offset always ±1) so exactly ONE
   acceleration authority exists — never both. (Needs hardware verify; not before the
   party.)
5. **Fix F3:** gate the learn-rejection on the *device/channel*, not on decodability —
   e.g. only treat a CC as a relative code when the profile control that matches it has
   `match.relative`/is the MFT rotary channel on a `configureOnConnect` device. Any
   `value ≠ 64` heuristic is now equivalent to "any CC at all".
6. **Fix F4:** rewrite the `constants.ts` EncoderControl comment block and the
   `accel.ts`/`messages.ts` headers to state the firmware truth (binary offset ±1…±17,
   value = pre-multiplied travel, curve lives in firmware), citing
   `Midi_Fighter_Twister_Open_Source/src/encoders.c:744-777` and `input.h:60-73`.
   Keep the six named constants only as historical aliases if anything still imports
   them. Add a decode test pinning `47 → −17` and `81 → +17`.
7. **Retune knob:** with gain removed, the only feel lever is `S` (and optionally a
   sub-linear `RELATIVE_SPAN_SLOPE < 1` if the firmware ceiling feels too hot) — a
   one-constant tuning surface, matching the operator's preference for single-knob
   iterations.

## 4. Verdict

- The operator's literal symptom ("fast is missed altogether") is fully explained by
  **F1 at HEAD**: the six-code decoder silently discarded every legal velocity-scaled
  offset ≥ ±4, which is *all* messages above ≈70 detents/s. The uncommitted full-range
  decode is protocol-correct and fixes it.
- The uncommitted round-4 feel model then **double-accelerates** (F2): firmware 1-17×
  times host 0.5-10× on a rate estimate that itself contains the firmware multiplier.
  Expect the next hardware session to report "any fast move slams to the end". The
  correct model is decode ±N → apply ±N×S with identity gain and let the firmware's
  curve be the acceleration.
- The broadened decoder also silently broke MIDI-learn for absolute faders (F3,
  `manager.ts:887`) — one-line-shaped fix, but it must land with the decode change.
- The config push (sysex, channels, mode bytes) is verified byte-for-byte against both
  pymft and the firmware — no findings there.
