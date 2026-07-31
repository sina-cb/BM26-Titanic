# 20260725_25 — LED strand white + colour fix (software side)

Date: 2026-07-28 · Wave: R7 (LED strand tuning) · Scope: **LED strands only**;
the DMX par path is byte-for-byte untouched.

Operator ask: *"let's focus on the white and colors for LEDs — what can we do
on the engine side"*, then mid-wave: *"do the gamma curve and software side
white handling better"* (the controller-side firmware change is PAUSED
indefinitely, so this software work is the permanent solution).

Input: the cross-repo colour review at `~/tmp/led_color_translation_review.md`
(kept out of this public repo by operator rule). Full wire math, the
old-vs-new number tables and the controller runbook live in the private
addendum `~/tmp/led_white_fix_addendum.md`. This report states only BM-side
facts and refers to the LED controller's behaviour generically.

---

## 1. The bug, in one paragraph

The LED controller runs its own white processing on every pixel: it folds the
wire's W byte into R/G/B (each channel saturating at 255) and then re-extracts
white as `min(R,G,B)`. The old mapper sent the pattern's colour AND its white
lane at full value, so any bright white pushed `RGB + W` past 255 — and
because the saturation is per-channel, it destroyed the RATIO between
channels. A tungsten warm white went out as `(255,173,82, W=255)` and arrived
as **neutral** `(255,255,255)`: the tint was gone, and it got worse the harder
the operator pushed the level. Separately, the amber render lane was dropped
entirely for strands (they have no amber emitter) while the sim preview mixed
amber in, so the screen promised warmth the wire never carried.

## 2. What changed

**New module `simulation/src/dmx/led_wire.js`** — the one place strand colour
translation lives. It:

1. **Folds amber into strand RGB** on the sim's own blend weights, so wire and
   screen agree by construction. **UV stays dropped** — an RGBW strand has no
   UV emitter and the code says so explicitly.
2. **Jointly pre-scales the whole RGBW quad by ONE factor** so that every
   channel's composite (`RGB + W`) fits under full scale. One shared factor
   means every ratio survives — hue *and* the colour/white balance the pattern
   authored. Over-bright content gets dimmer, never distorted.
3. **Emits TRUE RGBW**: the pattern's own white lane rides the W byte (a plain
   `rgb()` pattern still sends `W = 0`). The composite is quantized first and
   the RGB bytes derived from it, so `R + W ≤ 255` holds *exactly* — rounding
   cannot break it. **Clipping is now structurally impossible.**
   This format is deliberate: it renders correctly both on the controller
   behaviour the fleet runs today and on a future wire-exact white path, so a
   half-updated fleet can never look broken.
4. **Applies NO gamma.** Gamma lives in exactly ONE place — the LED
   controller's own configurable per-channel correction (§4). A mapper-side
   curve would compound with it. Passing `gamma` to the mapper config is a
   loud config error, not a silent no-op.
5. **Models the controller's behaviour behind ONE function**
   (`simulateLedEmitters`), selected by a per-controller `controllerWhite`
   key. Flipping a controller to a different white behaviour later is a
   one-line config change, not a code change.

**Preview honesty.** Strand pixels on screen are now computed from the EXACT
wire bytes, pushed back through the modeled controller behaviour (white
extraction + its gamma) — on both paths: the sACN-out map caches the result on
the entry, and the sACN-IN demap derives it from the received frame bytes. The
3D dots, the strand bulbs and the 2D pixel map all read the same number.
DMX fixtures keep the additive RGBWAU blend (they really do have those
emitters, so it is honest for them).

**Config surface** — per LED controller in `scenes/<scene>/controllers.yaml`:

```yaml
    led:
      wire:
        controllerGamma: { r: 1.0, g: 1.0, b: 1.0, w: 1.0 }   # mirror of the hardware
        foldAmber: true
```

Every key is validated hard (range, type, unknown keys) and throws on a
mistake — a scene that mis-spells a knob hard-stops the boot. Both the nested
`led.wire` form and flat keys on `led` are accepted, so a saved scene
round-trips. Model files only carry the block when a scene overrides a
default, so a default rig exports exactly as before.

## 3. Proof

**A/B, old code vs new, same inputs** (full table in the addendum; the old
mapper was pulled read-only via `git show HEAD:`):

| case | OLD at the emitters | NEW at the emitters |
|---|---|---|
| Temple warm white @ full | `255,255,255` — **neutral, tint destroyed** | `255,205,133` — tint `1 : 0.80 : 0.52`, matching intent |
| Cool white tint | `255,255,255` — neutral | `230,242,255` — cool tint intact |
| Amber-only warm glow | `0,0,0` — **black on strands** | `184,122,0` — warm glow |
| Saturated red / cyan | `255,0,0` / `0,255,255` | **identical** — colour look untouched |

**Tint across the master range**: the warm white holds its ratios to within
**0.2 %** at full, **1.1 %** at 5 % master. Below ~3 % master the whole colour
lives in fewer than 20 byte steps and the ratio can only be held to ±4 % —
8-bit quantization, physics, not a bug. Tests pin both bounds so a regression
past today's behaviour fails.

**Tests**: `simulation/tests/led_wire.test.js` — 29 cases including a
property sweep over the full 0–255 range proving `R+W`, `G+W`, `B+W` never
exceed 255 and never go negative; tint preservation at full and across master
levels; the amber fold and its opt-out; UV drop; gamma monotonicity through
the whole chain; the preview round trip; and a test proving the DMX par path
is byte-for-byte unchanged.

**Suites**: sim `npm test` **571/571 pass, 0 fail** (baseline before this work:
542; +29 new, zero regressions). Engine `tests/io/led_dmx_parity.test.js`
**24/24** — its four old-policy assertions were rewritten to the new wire
contract (the policy changed deliberately). Full engine `npm test`:
2271 pass / **8 fail**, all pre-existing environment failures unrelated to this
work (audio-capture ffmpeg cases, a socket-bind case that gets EACCES in this
sandbox, and two files that pass in isolation and only fail under parallel
run). Nothing in the LED/colour path fails.

**Renders** (`.agent_renders/`, viewport 1280×720, test_bench scene, sim
restarted between captures with the old files swapped in from `git show`):

* `1785270825_front.png` — BEFORE (previous code)
* `1785270876_front.png` — AFTER (this work)

Visually inspected: **identical**. That is the expected and desired result for
the pattern that was live (a saturated red wash) and is the strongest
available evidence for the "don't touch the colour look that's already good"
constraint — pure colour content is bit-identical. The white/warm delta is not
visible in that pattern; it is captured numerically in the table above and in
the addendum, driven through the real modules. `1785270710_night-walk.png` is
a strand close-up from the same session.

## 4. Gamma: where it lives and how to tune it

Gamma is applied **only by the LED controller**, per channel, over its
configuration API (an HTTP config write — no firmware flash involved).

Tool added: **`simulation/agent_tools/led_gamma_push.cjs`**

```bash
cd simulation/agent_tools
node led_gamma_push.cjs --host <ip> --read        # show the current curve
node led_gamma_push.cjs --host <ip>               # push the recommended curve
node led_gamma_push.cjs --host <ip> --gamma 2.0,2.0,2.0,1.0
node led_gamma_push.cjs --host <ip> --revert      # back to off (1,1,1,1)
node led_gamma_push.cjs --host <ip> --restore <backup.json>
```

It backs the controller's FULL configuration up to
`~/tmp/led_controller_configs_backup/` before any write, sends a partial body
(never clobbers other settings), reads the value back and fails loudly on a
mismatch, then prints the exact YAML line to mirror in the scene.

**Recommended curve: R/G/B 2.2, W 1.0.** The W exponent is 1.0 deliberately:
the controller derives its white channel *after* applying the R/G/B curve, so
the white it emits has already been corrected once — a second exponent on W
compounds with the first and crushes every white and pastel (the review's
suggested 1.8 would land whites on an effective ~4.0 curve, the opposite of
the goal). A unit test encodes this. Trim W only against a measurement, and
relative to 1.0.

**Status: NOT PUSHED — the outbound config write was permission-blocked in
this session.** The hardware is still at gamma off `{1,1,1,1}` and the scene
mirror says the same, so preview and hardware are consistent right now. The
operator (or an approved session) runs the one-liner above to turn the
vibrancy on; the mirror line then follows.

**Fleet status, no silent partial success**: an HTTP scan of the whole /24
found exactly ONE LED controller answering — the one bound as the test_bench
LED controller. No other controller was reachable, so nothing else was
inspected or changed. Related discrepancy worth a look (not touched):
`marsin_engine/config.yaml` aims its second sACN sender at a host that did not
answer, while the scene's controller entry and the live device are a different
address; the sim bridge routes correctly.

## 5. Deploy — BLOCKED

`python deploy/deploy.py deploy --machine titanic-ext --scene test_bench` was
**denied by the permission system**. Nothing was shipped.

Remote-newer preflight (run first, per the wave rule): the remote tree's
`simulation/scenes/test_bench/*` (12:41) and `marsin_engine/models/test_bench*`
(12:46) are all OLDER than the laptop's copies, so a deploy would not have
clobbered newer remote work. One thing the operator should confirm before
shipping: the laptop's `marsin_engine/models/test_bench.js` carries **20 pixels
per LED strand (166 total)** while both the remote copy and git HEAD carry
**40 per strand (206 total)**. That change predates this session (a scene
backup from 12:59 already shows 20), so it looks like intentional operator
work — but a deploy pushes it, so it is worth a conscious yes.

## 6. Follow-ups

1. **Push the gamma curve** (blocked here) and mirror it in the scene.
2. **Measure the strands' white emitter colour temperature** — the preview
   models it as neutral. If the installed strip is warm or cool, neutral
   whites will read off against the pars; a per-controller white-point top-up
   closes it.
3. **Neutral white stays white-emitter-only** on the current controller
   behaviour — no software lever exists for that; it is what the paused
   controller-side change would buy.
4. Reconcile the engine's LED controller host address with the scene's.
5. PSU / power-cap audit for the long RGB runs (queued from the review).

## 7. Session residue (stated, not hidden)

The sim and engine were started for the render captures and stopped after.
The engine writes runtime state into tracked `marsin_engine/states/*` files and
the sim rewrites `simulation/scenes/test_bench/*.yaml` + the exported model on
save — expected residue, left in place, not committed and not silently
reverted. No git write of any kind was performed.
