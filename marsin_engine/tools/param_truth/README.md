# param_truth — do the sliders do what they say?

An offline behavioural verifier for every pattern parameter in
`marsin_engine/patterns/`. It loads each pattern into the engine's own WASM
VM, sweeps each declared `slider*` control across its range, **measures what
actually changed in the rendered light**, and checks that measurement against
what the parameter's **name claims**.

It never opens a socket. Safe to run while the operator's live stack holds
`:6966-:6972` and `5568`.

## Run it

```bash
cd marsin_engine

# full sweep, sharded across cores (this is the one you want)
node tools/param_truth/sweep_all.mjs

# scoped / targeted runs
node tools/param_truth/run_param_truth.mjs --pattern 01_cylon_sweep
node tools/param_truth/run_param_truth.mjs --dir summer_camp --model summer_camp_logsville
node tools/param_truth/run_param_truth.mjs --top-level --cross-model test_bench
```

Outputs a pair of files at `--out` (default
`tools/param_truth/param_truth_results.{json,md}`):

- **`.json`** — keyed by pattern id + control name, so the sweep is re-runnable
  and diffable across pattern edits.
- **`.md`** — human report, worst-first, with a per-pattern punch-list.

The pattern list always comes from **disk discovery** (`pattern_discovery.js`
walks the tree, including subdirectories). Patterns are being renamed and
reorganised into themed folders; a hardcoded list would silently stop covering
whatever moved.

## Verdicts

| Verdict | Meaning |
|---|---|
| `TRUE` | The claimed effect was measured, with the sign/monotonicity the name implies. |
| `DEAD` | Nothing measurably changed anywhere in the parameter's range. |
| `WRONG` | Something real changed, but not the thing the name claims — or it moved the wrong way ("speed" that slows down). |
| `WEAK` | A real but sub-visible effect across the whole range. |
| `UNKNOWN_CLAIM` | The name makes no claim this harness can falsify. The measured effect is recorded for human judgement. |

Every verdict carries the numbers that produced it (`effectScore`,
`topMovers`, `detail`), so it can be audited rather than taken on faith.

## How a claim is checked

`claims.js` tokenises the control name (`sliderWhiteKick` → `white`, `kick`)
and maps it to a family. Each family has one testable prediction:

| Family | Prediction |
|---|---|
| `SPEED` | Temporal rate/frequency rises monotonically, by ≥ 1.25×. |
| `DIRECTION` | The ends of the range travel opposite ways — by net drift, or by anticorrelated per-frame velocity (ping-pong sweeps net to zero). |
| `HUE` | Circular hue mean or saturation shifts. |
| `BRIGHTNESS` / `DARKNESS` | Luma rises (resp. falls) monotonically. |
| `WHITE` / `UV` / `WARMTH` | The named emitter channel moves. |
| `SPATIAL` / `TRAIL` / `CONTRAST` | Spatial statistics move (feature count, contrast, lit fraction). |
| `MAGNITUDE` / `UNKNOWN_CLAIM` | Only "there is an amount of me" — can be `DEAD` or `WEAK`, never `WRONG`. |

All thresholds live in one place, `claims.js` → `THRESHOLDS`, are absolute, and
are never adapted per pattern. They are echoed into every results file.

## Things worth knowing before you trust a row

- **Baseline = the live engine's baseline.** Other sliders sit at the code
  default `parsePatternDefaults()` resolves; a slider with no literal default
  is left at the VM's compiled-in seed — exactly what
  `api_server.seedSliderCodeDefaults()` does. Which one applied is recorded per
  slider as `defaultSource`.
- **`DEAD` can mean "dead on this model".** A control gated behind
  `sectionId == 2` is byte-identical on `titanic` (every ship pixel reports
  section 0) while working fine on `test_bench`. `--cross-model` re-measures
  every `DEAD` param on a second model and separates the two cases in its own
  report section. Read that section before filing a bug against a pattern.
- **Frozen baselines get a second context.** A `sliderDirection` defaulting to
  0.5 freezes many patterns, which would make every other slider look dead. If
  the baseline renders no motion and the pattern has a direction slider, the
  pattern is re-swept with direction pinned to 1.0. Every row records which
  `context` produced it.
- **Renders are deterministic**, and the harness proves it per pattern by
  rendering the baseline twice and using the difference as a noise floor. The
  smoke test asserts this; if it ever fails, no verdict from that pattern is
  trustworthy.
- **Known limitation.** For a symmetric ping-pong sweep whose motion is
  mirror-symmetric at the launch phase, direction is genuinely unobservable and
  will report `WRONG` with reason `no_reversal_net_travel_or_velocity_series`.
  That is an honest measurement of "this knob does not visibly reverse
  anything", but it deserves a human look before it is called a bug.

## CI

`tests/patterns/param_truth_smoke.test.js` runs the harness over a fixed
three-pattern subset (~6 s) and asserts the machinery's properties — discovery
recurses, every declared slider gets a verdict, rendering is deterministic,
no module imports a network transport. It deliberately does **not** pin a
verdict census: pattern files belong to the curator lineage and change often.
The full sweep is run on demand, not in CI.
