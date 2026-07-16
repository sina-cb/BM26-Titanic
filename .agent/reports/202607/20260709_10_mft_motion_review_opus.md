# MFT knob-motion pipeline — COLD adversarial protocol review (reviewer _10, Opus)

**Date:** 2026-07-09
**Reviewer:** Opus (cold, adversarial, READ-ONLY). No prior diagnosis consumed.
**Subject:** MIDI Fighter Twister (MFT) knob-motion pipeline in CaptainPad.
**Operator symptom:** "when I move fast, it misses the movement altogether; slow is somewhat better" — persisting through multiple fix attempts.

**State reviewed (important — the tree is mid-edit):**
- `git diff HEAD` shows an in-flight fix (a concurrent agent) that has advanced `accel.ts` to "round 5", rewritten `mft/messages.ts::decodeRelativeDelta`, and rewritten `resolver.ts::relativeStep`. I reviewed **both** the committed HEAD and the uncommitted working tree, and I say which is which for every finding.
- `mft/config.ts`, `mft/constants.ts`, `manager.ts` tick-feed, `mft.yaml` profile: reviewed as-is (config.ts/constants.ts are unmodified vs HEAD).
- Uncommitted files touched: `accel.ts`, `resolver.ts`, `mft/messages.ts`, `manager.ts` (+ their tests).

---

## 1. What the reference / hardware ACTUALLY sends (primary sources)

The port's comments claim it is "byte-for-byte diffable against pymft" and cite `github.com/sina-cb/pymft`. I read the **DJTT open-source firmware** (the authoritative source) and pymft in full. Primary-source findings:

### A. Relative encoding is BINARY-OFFSET centered on 64 — confirmed
DJTT firmware `src/encoders.c :: process_encoder_input_rotary_relative()` emits `output_value = 64 + delta` in **every** live branch. The two's-complement form (`(uint8_t)new_value & 0x7F`, CW=1.. / CCW=127..) exists **only as a commented-out dead line**. The user manual (p.15) confirms: *"a value of 65 is sent for each clockwise step, and a value of 63 is sent for each anti-clockwise step."*
→ **Decoding with `value − 64` is on the correct axis.** (Confidence: high.)

### B. The per-message delta is NOT capped at ±1/±2/±3 — this is the crux
Default shipped build is `VELOCITY_CALC_METHOD == VELOCITY_CALC_M_TPS_BLOCKS` (`src/input.h:60`). For a `VELOCITY_SENSITIVE_ENC` encoder:
```c
int8_t  tick_count  = abs(new_value);
uint16_t base_mult  = convert_ticks_per_scan_to_value_multiplier(tick_count, cycle_count);
int16_t scaled_mult = 1 + ((base_mult >> 4) & 0x1F);   // 1 … 32
output_value = 64 + new_value * scaled_mult;            // Bin Offset
```
So on a fast twist the **CC VALUE itself widens**: `64 ± (1..32)` ⇒ **values roughly 32 … 96**. Speed is packed into the VALUE, not merely the message rate. Movement-type summary the hardware actually implements:
- **DIRECT / high-res (0):** ±1 per detent → values **63 / 65** only.
- **RESPONSIVE / EMULATION (1):** fixed ±2 per detent → values **62 / 66** (`ENCODER_RELATIVE_TICKS_RESPONSIVE = 2`).
- **VELOCITY_SENSITIVE (2):** ±1 slow, growing to **±32** fast → values **~32 … ~96**.

Two hard consequences that falsify the port's stated model:
1. The port everywhere claims velocity mode emits the fixed codes **±1/±2/±3 (61–67)**. The firmware caps the multiplier at **32**, not 3. Values reach ~32/~96, **NOT** 55/70 (the accel.ts round-4 comment's "55 → −9 … 70 → +6" numbers are invented; the real spread is far wider). It also does **NOT** reach 1 or 127 in velocity mode (that would need multiplier 63/64, impossible) — so a comment claiming "127 → +63, 1 → −63" over-states the top end.
2. Speed lives in the VALUE. So `MOVEMENTTYPE_DIRECT_HIGHRESOLUTION` would emit **only ±1** and convey speed purely by message count — the exact opposite of what several code comments assert (they claim DIRECT would "change tick density"; in relative mode DIRECT is the LOW-density, fixed-±1 mode).

### C. pymft — the cited reference — DOES NOT DECODE RELATIVE AT ALL (dropped-in-port gap)
`pymft/src/pymft.py::_handle_midi_message` stores the rotary CC byte **verbatim** and `encoder.py::update_mapped_value` normalizes it as an **absolute** value (`self.value / 127`). There is **no `value−64`, no signed decode, no 61–67 lookup** in pymft's read path. pymft's `EncoderControl` 61–67 table is **unused documentation** and it caps at ±3.
→ The TS port's `decodeRelativeDelta` (both the old switch AND the design comments) was modeled on pymft's **incomplete, unused** constant table, not on the firmware. "Byte-for-byte diffable against pymft" is true only for the SysEx *config-push* builders; for the *decode* path pymft is not a valid reference at all (it has no decode). This is the root provenance error behind the whole saga.

### D. SysEx setting addresses match; midi-TYPE constant NUMBERS in pymft are suspect
Per-encoder addresses (`movement_type=11`, `encoder_midi_type=18`, etc.) match firmware. **But** pymft's `MIDITYPE_SEND*` *numbers* conflict with the firmware enum (`src/encoders.h`): firmware `SEND_CC=0, SEND_NOTE=1, SEND_REL_ENC=2`; pymft/our-constants say `SENDNOTE=0x00, SENDCC=0x01, SENDRELENC=0x02`. `SENDRELENC=2` happens to agree; `SENDCC`/`SENDNOTE` look swapped. We push `SENDRELENC` (=2, correct), so the encoder DOES enter relative mode — but our `constants.ts` MIDITYPE table is not trustworthy for CC/Note and should not be treated as firmware-accurate.

---

## 2. Findings, ranked by contribution to "fast motion lost"

| # | Severity | Finding | Evidence | Reference that contradicts it |
|---|---|---|---|---|
| **1** | **CRITICAL — the bug** | **Committed HEAD silently DROPS every fast velocity-mode message.** `decodeRelativeDelta` maps only 61–67 and returns `null` otherwise; `resolveEvent`'s `focusedParamKnob`/`hueKnob`/`paramCenterRelative` cases do `if (delta === null) return null` → the tick vanishes. In velocity mode a fast flick emits values ~32–96, virtually all outside 61–67 ⇒ **the whole fast twist is discarded**. Slow turns stay near 63/65 (inside the map) ⇒ "slow is somewhat better." This is a textbook match to the symptom. | HEAD `mft/messages.ts:64-92` (switch, null default); HEAD `resolver.ts` `focusedParamKnob`/`hueKnob`/`paramCenterRelative` null-guards | Firmware `encoders.c`: velocity value = `64 + new_value*scaled_mult`, `scaled_mult∈[1,32]` ⇒ values 32–96, NOT confined to 61–67 |
| **2** | **CRITICAL (compounding #1)** | **Even a decoded fast code was CLAMPED to ±3.** HEAD `relativeStep` = `steps[min(|delta|,3)−1]` — so even if a fast value HAD decoded, its magnitude was capped at `steps[2]=0.015` (0.015 of range per message). A real ±32 message should move ~32× a slow detent; clamping to ±3 caps it at 3×. Fast could never sweep. | HEAD `resolver.ts::relativeStep` (`Math.min(Math.abs(delta),3)`) | Firmware multiplier up to 32; clamp to 3 loses ≥10× of a hard flick |
| **3** | **Verify (fix present, unverified on hardware)** | **Working-tree fix is on the right axis but its magnitude model is UNCALIBRATED and can now OVER-shoot.** Round-5 decodes `value−64` (full range ✓) and `relativeStep = delta × 0.005` (linear, unclamped ✓). But a single fast message (value 96 ⇒ +32) now yields `32×0.005 = 0.16` raw, ×accel gain (up to 3.0) = **0.48 of full range from ONE message**; a couple of such messages saturate a [0,1] param. Slow-miss becomes fast-overshoot unless `RELATIVE_SPAN_SLOPE`/`GAIN_MAX`/`steps[0]` are tuned against a real capture. The direction of the fix is correct; the constants are guesses. | WT `messages.ts::decodeRelativeDelta` (`value−64`), `resolver.ts::relativeStep` (`delta×SLOPE×steps[0]`), `accel.ts` GAIN_MAX 3.0 | Firmware max multiplier 32 ⇒ per-message travel up to 0.16 pre-gain; needs bench calibration |
| **4** | **Design-doc error (misleads future fixers)** | Pervasive comments assert velocity mode emits **only ±1/±2/±3** and that the "codes ARE the speed signal" bounded at 3. False: bounded at **32**. Also the round-4 accel.ts numbers ("55→−9, 70→+6, 127→+63") are fabricated — real spread is ~32–96 and never 1/127 in velocity mode. Any future agent trusting these comments will mis-tune. | `accel.ts` header (round-3/4 text), `config.ts:150-153`, `mft.yaml:31-35`, `docs/34:688-708` | Firmware `scaled_mult = 1 + ((m>>4)&0x1F)` ∈ [1,32] |
| **5** | **Provenance error** | Code + docs claim the decode path is a pymft port ("byte-for-byte diffable against pymft"). pymft has **no relative decode** — it treats rotary CC as absolute `value/127`. The 61–67 switch was cloned from pymft's **unused** doc constants. The config-push builders ARE a fair pymft port; the DECODE path never had a valid reference. | `messages.ts:1-2` header, `docs/34:689` | pymft `pymft.py::_handle_midi_message` + `encoder.py::update_mapped_value` store/normalize verbatim |
| **6** | **Latent — mode choice worth reconsidering** | We push `MOVEMENTTYPE_VELOCITYSENSITIVE`. That is the mode with the WIDEST, least-predictable value spread (multiplier 1–32) and the one whose steppiness the manual explicitly warns about. For a host that already runs its own smooth `accel.ts` velocity model, `MOVEMENTTYPE_RESPONSIVE` (fixed ±2 → values 62/66) or `DIRECT` (fixed ±1 → 63/65) gives a **clean, predictable per-message unit** and lets the HOST own the entire feel curve from message TIMING — no double speed source. Velocity mode stacks a firmware speed multiplier under the host's timing-based gain (two speed models fighting). | `config.ts:166` (`MOVEMENTTYPE_VELOCITYSENSITIVE`) | Firmware: DIRECT=±1, RESPONSIVE=±2 fixed; VELOCITY=±1..32 variable |
| **7** | **Minor — untrustworthy constant** | `constants.ts` MIDITYPE numbering (SENDNOTE=0, SENDCC=1) conflicts with firmware (CC=0, NOTE=1). We only USE SENDRELENC (=2, agrees), so no live bug, but the table is not firmware-accurate and shouldn't be cited as such. | `constants.ts:201-207` | Firmware `encoders.h` `midi_type_t`: CC=0, NOTE=1 |

### Non-findings (audited, sound)
- **Config push IS sent** on connect (`manager.ts:726`), guarded against mid-set re-blast, fail-loud on sysex denial. Encoder forced to `SENDRELENC` (2) correctly.
- **Channel map** (ch0 rotary / ch1 switch+colour / ch3 system) matches firmware + pymft; `switch_midi_channel:2` (1-based → raw ch1) is correct.
- **Rate-estimate timing** uses Web MIDI `event.timeStamp` (`web_midi_transport.ts:141` → `manager.ts:1033`), a real high-res clock, and floors dt at 4 ms so same-timestamp batches can't self-accelerate. Sound.
- **Optimistic anchoring + echo-span guard** (`manager.ts:328-346`, `flushResolved` 1461-1535) correctly keep a fast sweep accumulating locally instead of adopting the throttled engine echo; final `clampUnit` saturating at the ends is correct behavior, not a drop.
- **Coalescer** sums pre-gained deltas linearly — partitioning can't lose travel.

---

## 3. Recommended correct model

**The fix already in the working tree (round-5 decode + linear unclamped step) targets the right root cause (findings #1/#2) and should land** — do not revert to the 61–67 switch. Refinements:

1. **Keep `value − 64` full-range decode.** It correctly inverts the firmware's `64 + delta` for all three movement modes. Only 64 is "no movement" → null. Out-of-[0,127] still throws (P0). ✓ already done.
2. **Keep the linear, unclamped `relativeStep`.** ✓ already done. But treat `steps[0]`, `RELATIVE_SPAN_SLOPE`, `GAIN_MAX` as **provisional** until a real capture exists.
3. **Calibrate against a real velocity-mode capture (finding #3).** With multiplier ≤32, one fast message ⇒ +32 counts. Choose `steps[0]` (and/or SLOPE) so that a *typical* fast flick (a short burst of ~+8..+16 messages) sweeps the range without a single +32 message alone jumping half the range. Concretely: with `steps[0]=0.005`, GAIN_MAX 3.0 makes one +32 message = 0.48 — likely too hot. Either lower `steps[0]` (e.g. 0.0025) or hold GAIN_MAX near 1 for velocity mode, then bench-tune ONE knob at a time. **Ask the operator for a fast-twist MIDI dump** — the actual `scaled_mult` distribution on their unit is the missing calibration input; everything else is guesswork.
4. **Reconsider velocity mode itself (finding #6).** Strong recommendation to A/B **RESPONSIVE** (fixed ±2, values 62/66) on the bench. It gives the host a single clean per-message unit and lets `accel.ts`'s timing-based gain own the ENTIRE feel curve — removing the firmware/host double-speed-model that has made this so hard to tune. If chosen, `movement_type` → `0x01` in `config.ts` (needs a device reconnect to re-push) and the accel constants re-tuned once, cleanly.
5. **Fix the misleading comments/docs (findings #4/#5/#7).** State the real value range (~32–96 in velocity mode, ±1/±2 fixed for direct/responsive), that speed is in the VALUE, that pymft has no relative decode (so the decode path is firmware-derived, not a pymft port), and drop the fabricated 55/70/127 numbers. Otherwise the next fixer re-derives from wrong premises.

---

## Verdict

The operator's "fast is missed, slow is fine" is **not a feel-tuning problem** — it is a **hard protocol decode bug** in committed HEAD: `decodeRelativeDelta` returns `null` for the ~32–96 value range the MFT emits in `VELOCITY_SENSITIVE` mode, so every fast twist is silently discarded (finding #1), and even decoded fast codes were clamped to ±3 (finding #2). Both were cloned from pymft's **unused, incomplete** 61–67 constant table; pymft itself never decodes relative input (finding #5). The uncommitted round-5 work fixes the decode on the correct `value−64` axis, but its magnitude constants are uncalibrated and can now overshoot at the top of the ±32 range (finding #3). Recommended: land the round-5 decode, calibrate against a real fast-twist capture from the operator, and seriously evaluate switching the device to RESPONSIVE mode to collapse the two competing speed models into one host-side curve.

**Sources:** DJTT firmware `DJ-TechTools/Midi_Fighter_Twister_Open_Source` (`src/encoders.c`, `encoders.h`, `input.h`); MFT user manual p.13/p.15 (manualslib 1361832); `sina-cb/pymft` (`pymft.py`, `encoder.py`, `constants.py`). Files audited: `CaptainPad/utils/midi/mft/{config,messages,constants}.ts`, `utils/midi/{accel,resolver,manager,profile}.ts`, `midi_profiles/mft.yaml`, `docs/34_captainpad_midi.md` — both committed HEAD and the uncommitted working tree (round-5 in-flight fix).
