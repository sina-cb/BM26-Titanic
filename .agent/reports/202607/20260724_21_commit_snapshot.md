# 2026-07-24 — Commit snapshot: bm_readiness day-of-work committed (Slice 21)

Operator-authorized commit of the full 2026-07-24 uncommitted work on
`feat/bm_readiness` ("let's commit on the feat branch so it's safe so far").
Commit only — **not pushed**. No `git reset`/`checkout --`, no branch ops, no
`--no-verify`. The live prod stack (sim :6969–:6972, engine :6968, save
:6970) was left running; the only browser page opened was a readonly export
tab, closed on completion.

## Commits made

| Hash | Files | Summary |
|---|---|---|
| `d631c5c6` | 78 (+11769 / −1995) | Product code: 2D-vis multiview S1–S4, emitter instancing, TE Sign V3 fixtures + generator + scene swap, bridge union-routing + dual-write suppression + multi-client HUD, engine priority hardening, marsinled/LED-discovery hardening, CaptainPad named-views picker, titanic timeline default — **plus the freshly re-exported `marsin_engine/models/titanic.*`**. |
| `22d57138` | 30 (+5013 / −2) | Agent OS: reports `20260724_0..20`, new `os/interface_agent.md`, `multi_agent.md` §9, dossier + thread tracker, `operator_uses_launcher` memory, README/MEMORY/coordinator/AGENTS.md updates. |

Two logical commits (product code vs `.agent/` docs), as the brief allowed.

## Model re-export evidence (pre-commit checklist item 1)

The tracked `titanic.*` was a stale 11:05 snapshot predating the 15:10 TE
Sign V3 swap. Re-exported from the **current** live titanic scene by loading
`?scene=titanic&profile=full&readonly=1` in a throwaway puppeteer tab
(`readonly=1` → `window.__readonlyMode`, so the tab wrote **zero** sACN and
did not disturb the running show) and calling `window.saveModelJS()`, which
POSTs the model to the save server (:6970 → `marsin_engine/models/`). Tab
closed; the one-off script was deleted.

| Marker | Before (stale) | After (fresh) |
|---|---|---|
| `pixelCount` | 1147 | **1141** (= 1147 − 80 old TE LED grids + 74 TE Sign V3) |
| `TE Sign` pixel entries in `titanic.js` | 0 | **74** |
| `TE LED Grid` entries | 80 | **0** |
| `titanic.viewmasks.js` groupBit | `TE LED Grids` | **`TE Sign`** |
| `Updated:` stamp | 2026-07-24T18:05Z | 2026-07-25T01:14Z |

Readiness at export: `scene=titanic`, `parFixtures=84`, `rebuilding=false`.
The 1141 count matches the live 2D-map figure the integration sweep (`_16`)
recorded. LED strands exported UNPATCHED (loud per-strand markers) — that is
the current scene state, faithfully reflected, not introduced here.

## Exclusions (checklist item 2) — left uncommitted, by design

- **Engine runtime state — all `marsin_engine/states/**`** (AGENTS.md: engine
  writes runtime state into these tracked files; "expected residue… don't
  commit"): `test_bench/{audio,globals,mixer,deck}_state.yaml`,
  `titanic/{audio,mixer}_state.yaml`, and untracked
  `{test_bench,titanic}/vsn1_layout.yaml`, `titanic/{deck,globals}_state.yaml`.
- **`marsin_engine/models/test_bench.{js,effects.js,viewmasks.js}`** — diff is
  **timestamp-only** (`--ignore-all-space` = 1 line each = the `Updated:`
  stamp); the test_bench scene edits are non-geometric so the model content is
  unchanged. Excluded as timestamp churn.
- **`simulation/scenes/common.yaml`** — real content diff but it is a session
  default flip `lightingProfile: 2d_pixels → full`, not authored branch work.
  Excluded (preserves the committed `2d_pixels` default).
- **`simulation/scenes/test_bench/scene_config.yaml`** — only two preview-only
  sim settings changed (`masterExposure 0.2→0.6`, `maxSpotlights 60→200`);
  session UI churn, not part of any reported slice. Excluded.
- **CRLF / whitespace-only** — `simulation/scenes/manifest.json` and
  `test_bench/{patches,controllers,views}.yaml` were CRLF-only; staging
  re-normalized them so they no longer show as modified (nothing of substance
  committed).
- **Pre-existing junk** — a 0-byte file literally named `{}` at repo root
  (created 17:18 today by some earlier botched redirect, before this session);
  not mine, left untouched, not committed.

Included as genuine authored config (NOT excluded): `marsin_engine/config.yaml`
(`engine.priority: high` from slice `_20`), `simulation/scenes/titanic/
scene_config.yaml` (TE Sign V3 swap), `simulation/scenes/titanic/timeline/
playa_default.yaml` (every other scene already tracks its `timeline/
playa_default.yaml`; titanic's was the missing one).

## Security gate (checklist item 3)

`python scripts/security_check.py --staged` — **PASS** on both commits (78
and 30 files, "no leaks found"). Commit 1 passed first try. Commit 2 initially
**FAILED** with 24 `bm26-report-ip` findings: show-LAN gateway IPs
(`10.x.x.202/.10/.201/.226`, `10.x.x.1`, and a `10.x.x.1–254` range) in
today's reports + tracker, which the no-IP-in-`.agent/` rule forbids. Redacted
all to `10.x.x.NNN` (last octet kept, per `os/security_privacy.md`;
loopback/multicast/`0.0.0.0`/panel-AP left as-is since the rule allows them),
re-staged, re-ran → PASS. No `--no-verify`, no hook bypass. These IPs were
never previously committed (all new files), so no history exposure.

## Post-commit verification (checklist item 5)

`git log --oneline` tip: `22d57138` → `d631c5c6` → `4e14ef61` (prior). `git
status` residue is exactly the intended set above (runtime state, timestamp
churn, session-churn YAML, the `{}` junk file, and this report). Nothing
pushed.
