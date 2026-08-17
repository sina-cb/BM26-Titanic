# _227 — sim theme parity restored (warning family + borderStrong) — 2026-08-15

Six reds in `simulation/tests/theme_parity.test.js` — the five palette
parity tests plus the `style.css :root` boot-defaults test. Cause: the
_210/_217 waves added tokens to `CaptainPad/constants/theme.ts` (the
single source of truth) and the sim port was never updated. The test file
was NOT touched — it is the spec, and it was already correct.

## What was missing

Four tokens per palette, in every one of the five palettes:

| token | why it exists (CaptainPad `Palette` doc comments) |
|---|---|
| `warning` | the amber "something else is driving / dangerous" accent — sibling of `error`, which stays reserved for FAILURE. Each theme's value clears WCAG AA on all of that theme's surfaces. |
| `warningContainer` | translucent `warning` fill for inline caution chips — amber twin of `errorContainer`. |
| `warningContainerBorder` | border companion, same rgb, higher alpha. |
| `borderStrong` | selected/focused/hovered chrome; ≥ 3:1 against every surface (WCAG 1.4.11), where `ghostBorder` sits at ~1.1–1.5:1 by design. |

Values ported verbatim, per palette:

```
light     warning #6f4d00  container rgba(111, 77, 0, .08)/.3     borderStrong rgba(70, 98, 112, 0.85)
dark      warning #f5a623  container rgba(245, 166, 35, .16)/.45  borderStrong rgba(180, 195, 200, 0.55)
midnight  warning #f5a623  container rgba(245, 166, 35, .16)/.45  borderStrong rgba(150, 170, 200, 0.65)
sunset    warning #ffd166  container rgba(255, 209, 102, .16)/.45 borderStrong rgba(180, 150, 120, 0.7)
gruvbox   warning #ffb04d  container rgba(255, 176, 77, .16)/.45  borderStrong rgba(168, 153, 132, 0.85)
```

The three light-theme values are deliberately the odd ones out: daylight
amber has to be DARK to be legible (`#f5a623` is only ~2:1 on white), and
gruvbox deliberately avoids the canonical `#fe8019` because it cannot
clear AA as chip text on its own wash. Those are CaptainPad's decisions,
recorded in its comments — the sim just mirrors the hexes.

## Files changed

- `simulation/src/gui/theme.js` — the four tokens added to all five
  `PALETTES` entries, in CaptainPad's declaration order (warning trio
  after `tertiary`, `borderStrong` after `ghostBorder`). No other code
  path changed: `applyCssVariables()` already iterates
  `Object.entries(palette)` and writes every token via `tokenToCssVar()`,
  so the new tokens ship as `--warning`, `--warning-container`,
  `--warning-container-border`, `--border-strong` with no plumbing.
- `simulation/style.css` — the same four, gruvbox values, appended to the
  `:root` boot-default block in matching order.

`--caution: #ffb400` in `style.css` is untouched. It is a deliberately
UNthemed fixed safety-signage amber (unpatched fixtures, spotlight
budget), documented as such in place; rewiring sim chrome onto the new
themed `--warning` is a separate design call, not a parity fix.

Nothing consumes `--warning*` / `--border-strong` in the sim yet — this
change makes the tokens EXIST and match. That is what the parity contract
asks for; adoption is future work.

## Verify

`cd simulation && node --test tests/*.test.js`

```
before: 2283 tests, 2269 pass, 13 fail
after:  2283 tests, 2275 pass,  7 fail
```

The failing list shrank by exactly the six theme_parity reds and gained
nothing. The seven survivors are pre-existing and out of scope here:

```
_176 §5.3: a TEST-CONTEXT write into the REPO's real scenes dir is REFUSED
fixtures are docked beside the ship, not left inside the hull
REFUSES: a patched fixture no chain reaches (orphan patch record)
the real titanic scene can accept the block today (no collisions)
CLI: default emit against the real scenes exits 0 and reports parity=absent
CLI: --require-applied fails (exit 3) while Phase B has not applied the block
Live display orientation is a pure projection of authoritative 3D coordinates
```

(the last one is the offsets-conflict red awaiting an operator decision.)

No services started, stopped, or bound — the operator's live stack on
6966-6972 was never approached. The running sim keeps serving the old
token set until its next page reload. No git operations.
