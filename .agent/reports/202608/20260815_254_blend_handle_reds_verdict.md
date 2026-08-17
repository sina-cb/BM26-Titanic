# `_254` — the 11 `blend_screen` mixer reds: a TEST artifact that was hiding a REAL engine-killer

`_248` blamed the 11 on `_243`. `_253` re-confirmed them still red and left
them alone. This report closes them (**11 → 0**) and answers the question that
gated the restart.

**Two-part verdict.**

1. **The `No compiled blend handle for mode 'blend_screen'` message itself is a
   TEST-ENVIRONMENT ARTIFACT.** No show transition on the gen-7 engine can
   produce it. Four test fixtures leaned on a fallback that a correct P0 fix
   deleted.
2. **But auditing *why* it can't happen live found one route where it CAN.**
   `POST /mixer/channels` — the single channel-CREATING route — passed
   `data.mode` to the mixer **unvalidated**, while every sibling route gated
   on `isValidBlendMode`. One typo'd POST creates a channel with no compiled
   handle, `renderAll6ch()` throws inside the 40 Hz `tick()`, and
   `engine.js:1369`'s `uncaughtException` handler prints `⛔ ENGINE FATAL` and
   `process.exit(1)`. **Same fatal shape `_253` just removed from the deck-cancel
   path.** Gate closed here, pinned by a new e2e suite.

## Part 1 — the artifact

Empirical proof, real WASM host, this working tree:

```bash
node engine.js --pattern test_const --model test_bench --dry-run \
     --dest 192.0.2.x --port 17244
# [Mixer] Compiled blend script: blend_add / blend_over / blend_screen
# + all 15 trans_*   → 18/18 compiled, zero warnings, exit 0
```

Every blend the hot path can be asked for compiles at boot. The failing tests
build `new PatternMixer({ wasmHost: <fake> })` and **never set
`patternsDir`**, so `precompileAllBlends()` never runs and
`getBlendHandle('blend_screen')` returns `null`. At `HEAD` that `null` was
absorbed by a host-side linear-interpolation fallback; in the working tree it
throws.

### When they went red

**Not `_243`.** Its D5 preview-mask pre-pass is a 3-line hunk in the *vis*
pre-pass (`applyPreviewMaskBlackout` on the PREVIEW buffer) and touches
nothing on the composite path.

The cause is the **uncommitted `_245` deck-transition rehaul**
(`20260815_245_deck_transition_debug_audit.md` §P0-4 item 3: *"A missing blend
handle silently becomes host-side linear interpolation at
`lib/pattern_mixer.js:3556-3563`"*; remediation item 5: *"remove
crossfade/instant/host-linear visual fallbacks"*). `git diff HEAD --
marsin_engine/lib/pattern_mixer.js` shows the removal as working-tree-only
`+`/`-` lines in **three** places — the deck-overlay path, the deck-swap path,
and the mixer-channel path — each replaced by a `throw`. `HEAD` still carries
the fallback, so at `HEAD` these tests pass. They went red the moment that
rewrite hit the tree, unstaged; no commit bisect can find it.

The same rewrite also made `triggerMixerTransition` **refuse** (return `null`)
when its `trans_*` script has no compiled handle instead of substituting a
crossfade. That is the second, non-obvious half of the red set.

### The 11, by mechanism

| Count | Test | Mechanism |
|---|---|---|
| 8 | `tests/mixer/follow_link.test.js` | `renderAll6ch()` throws — fixture has no `blend_screen` handle |
| 1 | `tests/mixer/blend_precompile.test.js` — *render hot-path records health…* | pinned the DELETED contract: literally `// Render once — should NOT throw` |
| 1 | `tests/mixer/groups_solo_state.test.js` — *clears the solo set at start* | `triggerMixerTransition` refuses before `soloedChannelIds.clear()` (no `trans_crossfade` handle) → `1 !== 0` |
| 1 | `tests/effects/bump_flash.test.js` — *a scripted mixer transition clears bumps* | same refusal, before `_bumpedChannelIds.clear()` → `1 !== 0` |

The `1 !== 0` pair and the `blend_screen` message were never two bugs. They
are one change seen from two sides: **nothing composites, and nothing
transitions, without a compiled handle.**

### Fixture repairs (no engine logic touched)

**A — three fixtures prime their handles.** `follow_link` gets
`blendHandles['blend_screen']`; `groups_solo_state` and `bump_flash` also get
`blendHandles['trans_crossfade']`. Not a new idiom invented to dodge the
failure — it is the convention the sibling suites already used at `HEAD`
(`fader_lock`, `fader_max_clamp`, `groups_solo_precedence`,
`channel_metering`, `deck_overlays`, `channel_ops_state`, `deck_swap_param`).
Those stayed green through the rewrite *because* they primed; these three were
carried by the fallback and nobody noticed.

**B — `blend_precompile` re-pinned to the contract that now exists.** The
hot-path test is renamed *"render hot-path REFUSES (throws) + records health
on an uncompiled mode"* and asserts `assert.throws(…, /No compiled blend
handle for mode 'mode_with_no_script' on channel 'o'/)` **and** that the mode
still lands in `renderHealth.blendErrors` with `ok === false`. Both halves
matter: fail loudly *and* stay visible on `/status`. The file header loses its
"falling through to host-side linear interpolation" sentence and gains the
live-reachability argument, so the next reader does not re-open this question.

`pattern_mixer.js` was not touched. The throw stays a throw.

## Part 2 — the real defect the audit surfaced

The artifact verdict rests on the throw being unreachable live. Three gates
were supposed to guarantee that:

| Gate | Where | Effect |
|---|---|---|
| API mode allowlist | `isValidBlendMode` / `VALID_CHANNEL_BLEND_MODES`, `api_server.js:232` | only `blend_screen`/`blend_add`/`blend_over` + the 15 cataloged `trans_*` accepted; a typo is a 400 |
| Boot precompile | `patternsDir` setter → `precompileAllBlends()`, `pattern_mixer.js:901` | every script compiled before the loop starts; failure is a loud `console.error` **and** `renderHealth.ok=false` on `/status` |
| State sanitation | `state_manager.js:661` | a persisted live `trans_*` is rewritten to `blend_screen` on save, so a restore can't reintroduce a transient mode |

Auditing gate 1 by walking **every** writer of `channel.mode` found four call
sites gated (`api_server.js:10813` PATCH `/mixer/channels/:id`, `:12919` WS
`setChannelMode`, `:14491`, plus the two deck-overlay checks at `:12561` /
`:12807`) — and **one that was not**. `POST /mixer/channels` is the only
`addMixerChannel` call site in the codebase, and it read:

```js
mode: data.mode || 'blend_screen',
```

with no validation anywhere in the handler. The ungated hole is not
theoretical: it accepts an arbitrary JSON string, that string becomes
`channel.mode`, and the very next frame the mixer asks for a handle that
cannot exist. Under `HEAD`'s fallback this merely degraded (host-side lerp +
a red `/status`); under the `_245` no-fallback contract it is **fatal to the
rig**. The comment sitting directly above `VALID_CHANNEL_BLEND_MODES` already
*claimed* this route was covered — it named "PATCH /mixer/channels/:id, PATCH
/deck/channel, and /deck/transition-config" and asserted an unknown mode "is
rejected with 400 instead of being silently handed to the mixer". It was
describing an invariant the code did not hold.

**Fix:** the same gate, verbatim, at the top of the `readBody` callback so it
fails before any pattern/playlist work. 400 + the standard error naming the
accepted set. This is a boundary rejection, not a fallback — nothing is
substituted, the request is refused.

**Not changed, deliberately:** the snapshot-restore path
(`api_server.js:3147`, `mode: saved.mode`). With the creation gate closed, a
junk mode can no longer enter a channel, therefore cannot enter a state file,
therefore cannot come back through restore. Adding a second gate there would
be defense-in-depth against a hand-edited YAML only, and that path already
throws loudly for a failed pattern compile, so its posture is consistent.
Flagged, not touched.

**Also corrected (comment-only, zero behaviour):** `api_server.js:228` no
longer promises the deleted "degraded host-side fallback" and now states that
the allowlist is what keeps the throw unreachable. `pattern_channel.js:25`
advertised a **`'blend_crossfade'`** mode in its list of valid modes — no such
script has ever existed anywhere in the repo, and under the new contract a
channel set to it kills the render loop. Replaced with the real set plus that
warning.

## Verification (all `--test-concurrency=1`; spawned engines on 17400-17440, `--dest 192.0.2.x`)

| Suite | Before | After |
|---|---|---|
| `tests/mixer/` | 619 · 604 pass / **15 fail** | 625 · 620 pass / **5 fail (foreign)** |
| `tests/effects/` | 732 · 731 pass / **1 fail** | 732 · **732 pass / 0 fail** |
| `tests/timeline/` | — | 445 · **445 pass / 0 fail** |
| `tests/special_events/` | — | 109 · **109 pass / 0 fail** |
| `tests/e2e/` | — | 87 · **87 pass / 0 fail** |
| `tests/mixer/channel_create_mode_gate` (new) | — | **6 · 6 pass** |

`node --check` on all three edited source files. Engine dry-run clean (exit 0,
18/18 blends compiled). The +6 mixer tests are the new gate suite.

**All 11 target reds are green.** The remaining 5 are the known-foreign
`dev_test_bench` model-lint set — `groupBits out of sync with model —
missing: [] stale: [ParLights, VintageLights, BarLights, LED_0]` out of
`model_loader.js:156` — untouched here and unrelated to the mixer.

`tests/effects/touch_control_wire_layers_contract` was left alone as
instructed and is now **passing on its own**: `_252` landed its `touch.tsx`
rewrite and repaired that contract itself. It is no longer a red.

*Methodology note:* running `tests/effects/` and `tests/e2e/` concurrently
produced 8 phantom `global_effects` failures (a 25 s timeout head — spawned
engines racing for ports). Both are green run serially. Anyone re-checking
these numbers should keep the harness at one suite at a time.

## Gate

**ENGINE RESTART REQUIRED** — `lib/api_server.js` changed (the creation-route
mode gate). The live `:6968` process still accepts an unvalidated `mode` on
`POST /mixer/channels`. This composes with `_253`'s pending restart; one
restart covers both. No schema, no YAML, no wire change, no client rebuild.

## Residual risk (disclosed, deliberately not "fixed")

`renderAll6ch()` runs inside `tick()` on a 40 Hz interval with no surrounding
try/catch, so any throw becomes `uncaughtException` → `⛔ ENGINE FATAL` →
`exit(1)`. That is the price of the no-fallback contract: **the rig stops
loudly rather than showing a silently-wrong look.** Per codex P0 that is the
correct trade, and wrapping the loop in a catch would re-introduce exactly the
fallback `_245` deleted — so nothing was added.

What makes the trade safe is that the throw is now unreachable from every
operator-facing surface. What would make it unsafe is a **new** writer of
`channel.mode` that skips `isValidBlendMode` — a future WS handler, a scene
YAML field, a timeline action. This report is the second time in two sessions
(`_253` was the first) that a fatal-exit path was reachable because one caller
of a hardened contract was missed. A standing check for whoever adds the next
mode-writing route: `grep -n "\.mode = \|addMixerChannel(" lib/api_server.js`
and confirm every hit is preceded by the gate.
