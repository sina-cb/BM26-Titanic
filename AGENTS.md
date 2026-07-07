# AGENTS.md — BM26 Titanic

Lighting project for **the Titanic at Burning Man 2026**. We play a shared
**Game of Life** here: agents and the human operator (**Sina Solaimanpour**)
collaborate through the `.agent/` **Agent OS**, which is the source of truth
for how we work. **Read `.agent/codex.md` first** — it is the constitution;
this file is the distilled map.

The mission, in order: make the Titanic exterior highly visible at night
(mission critical), light the rooms, keep strike under 2 hours, carry TE's
DNA forward, be welcoming, be kind, have fun.

## The Agent OS — `.agent/`

The full map, precedence stack, and boot pointer live in
`.agent/README.md`. Short version:

| Dir | What it is | When to use it |
|---|---|---|
| `.agent/codex.md` | **The holy word** — mission + P0 rules. Sina-only, never edit. | Read first, every session. |
| `.agent/os/` | **The laws** — git, style guides, ui_design, multi_agent, task_tracking, security_privacy, autonomy, memory. | Before committing, writing code, fanning out, or acting on initiative. |
| `.agent/ops/` | **Runbooks + auto-checks** per subsystem. | Before running, or before claiming merge-readiness. |
| `.agent/skills/` | **How-tos** — reusable procedures. | When the task matches a skill, follow it. |
| `.agent/roles/` | **Role briefs** — coordinator, planner, developer, subsystem experts, reviewer, deployment, artist, investigator, validator, task_manager. | Adopt the matching role's mindset. |
| `.agent/context/` | `boot.md` (start sequence) + `now.md` (living dashboard). | Boot from `boot.md`; update `now.md` on state change. |
| `.agent/memory/` | `MEMORY.md` index + one fact per file. | Load index at boot; open facts on demand; write durable facts. |
| `.agent/plans/` | Dated campaign plans (historical). | Read when working a campaign; don't rewrite. |
| `.agent/projects/` | Project dossiers (`TEMPLATE.md` + live dossiers). | Read/update the dossier you're advancing. |
| `.agent/reports/` | Dated reports (`YYYYMM/YYYYMMDD_N_slug.md`). | Read for context; write when handing off. |
| `.agent/agent_fs.yaml` | Filesystem visibility for the mobile viewer. | Rarely; don't break it. |

**Precedence (law stack, conflicts resolve upward):** `codex.md` › `os/`
laws › `ops/` + `skills/` procedures › `roles/` briefs › `context/` +
`memory/`. The codex is maintained by **Sina only** — no agent ever edits it.

**Boot yourself** at session start via `.agent/context/boot.md`.

## Task tracking (Notion)

Tasks live on the Notion board **Titanic Lighting - Task Tracker**
(Titanic's End workspace → Camp Operations → Titanic Lighting):
<https://app.notion.com/p/titanicsend/9f241c2d454747859b149d738cc21bc8>

Access is through the **Notion MCP server — the connection must be enabled
and the Titanic's End workspace shared with it**, or every read fails with a
404. If you get a 404, ask Sina to enable the MCP connection; do not fall
back to creating task files in the repo. Board schema, card body format, and
add/close workflow: `.agent/os/task_tracking.md`. Check the board before
starting new work; file follow-ups there as `Backlog` cards.

## Hard rules (P0 — from the codex)

- **No fallback behaviors. Ever.** Unless explicitly asked. Fail loudly.
- **Radical autonomy** — act within the law without asking; anything not
  behind an operator gate is yours to do. The exhaustive gate list lives in
  `.agent/os/autonomy.md`.
- **Never** use built-in web tools to view the sim — use the skill
  `.agent/skills/see_the_world.md` (puppeteer renderer).
- **All imports at the top of the file**, never inside functions, never
  wrapped in try/except — a missing dependency must crash at startup.
- **snake_case filenames** for all source files (`par_light.js`); classes
  inside stay PascalCase.
- **Temp/scratch files go in `~/tmp/`** (gitignored), never in the source tree.
- **No git operations until explicitly asked** by the human op. Never use
  `git reset --hard` / `git checkout --` to hide test side effects. Before
  claiming merge-ready, run the touched subsystems' auto-check specs.
- **Every `git commit` requires a passing security check first** — this repo
  is PUBLIC. Run `python scripts/security_check.py --staged` (PASS/FAIL with
  fix instructions); the `.githooks/pre-commit` hook and a Claude Code
  PreToolUse gate enforce it, and CI re-checks the PR. Never `--no-verify`.
  New clone? `git config core.hooksPath .githooks` once. Full rules:
  `.agent/os/security_privacy.md`.
- **Follow the GoL branch-naming convention** (`.agent/os/git.md` → Branch
  Naming and Lifecycle): this is an **agent-agnostic** repo, so no agent
  name goes in a branch. Durable work lives on `feat/<snake_case>`;
  multi-agent worktrees on `dev/<slug>` (**local only — never pushed to
  `origin`**); `worktree-agent-<hash>` and auto-named session branches are
  scratch. Promote a session branch to `feat/` by **GitHub rename** (never
  delete+recreate a branch with an open PR). Delete temp/merged branches
  only after verifying their work landed.
- **Never name a branch random gibberish.** No throwaway auto-codenames.
  When you create a branch for durable work, give it a proper descriptive
  `feat/<snake_case>` name that says what the work is; if you can't pick a
  good one, **ask the operator for the name** instead of inventing junk.
  (Auto-named session branches must still be promoted to a real `feat/` name
  or deleted — they are not acceptable to keep.)
- **Offline readiness is a deployment requirement**: the playa has no
  internet. No CDNs, no external fonts, no runtime `npm install`, no
  telemetry. Browser deps are vendored in `simulation/vendor/`.
- **Panel firmware is flashed ONLY through its registry-locked deploy
  script.** Flash `LookingGlass/panel_firmware` exclusively via `python
  deploy.py` (run from that directory) — **never** a raw `pio run -t
  upload`. `deploy.py` reads a deployment registry (a MAC allowlist) and
  only flashes a board whose MAC is allowed for the `looking_glass` target —
  refusing every other board. This is mandatory because multiple ESP32s (the
  Stoker controllers) are often plugged in at once. The registry and the
  build secrets (WiFi/AP) are **not** stored in this repo: they come from a
  private, external deployment source that exports `$BM26_DEPLOY_REGISTRY`
  and `$BM26_SECRETS` (with `$STOKER_*` fallbacks). If those env vars are not
  exported, the build and the deploy both **fail loudly** — there is no local
  fallback. See `.agent/skills/panel_firmware_ops.md`.
- Style guides: `.agent/os/python_style.md`, `.agent/os/nodejs_style.md` —
  read before writing code.

## Repo map

| Directory | What lives there |
|---|---|
| `simulation/` | Three.js 3D lighting sim (browser). `npm start` → HTTP :6969, save :6970, sACN bridges :6971/:6972. Scenes in `simulation/scenes/<scene>/` |
| `marsin_engine/` | Pixelblaze-compatible pattern engine (WASM VM, 40 fps, sACN out, REST/WS API). `node engine.js --model test_bench --pattern <name>` |
| `CaptainPad/` | TypeScript Expo iPad app — operator control surface |
| `control_podium/` | Podium hardware + Raspberry Pi server bridge (Meshtastic radio path) |
| `LookingGlass/` | Control-panel art piece — `panel_firmware/` (ESP32-S3 arcade buttons → WiFi telemetry portal), MAC-locked `deploy.py`, `circuit.html` wiring diagram. Flash via `deploy.py` only; see `.agent/skills/panel_firmware_ops.md` |
| `marsin_pb/` | Pixelblaze-related tooling |
| `3d_models/`, `3d_structure/`, `renders/`, `images/` | Assets |
| `states/`, `docs/`, `archived/` | State files, docs, retired work |
| `.agent_renders/` | Sim screenshot output (gitignored) |

## Seeing your work (sim screenshots)

Follow `.agent/skills/see_the_world.md`. Short version:

```bash
cd simulation && npm start            # servers up (:6969 …)
cd simulation/agent_tools
node agent_render.cjs                 # all preset views → .agent_renders/
node agent_render.cjs --view front    # one view
node agent_render.cjs --show-ui       # keep menus/panels in the capture
node agent_render.cjs --viewport 1280x720   # required on software-GL machines
```

On headless machines wrap with `xvfb-run -a`, use `--viewport 1280x720`
(SwiftShader loses the WebGL context at 1080p on close-up views), and always
**visually inspect** the PNGs before reporting success.

## Full-stack smoke (sim + engine + CaptainPad)

Follow `.agent/skills/full_stack_smoke.md` to bring up the whole chain and
prove every link with screenshots:

```text
CaptainPad web :6967 → ws → marsin_engine :6968 → sACN → simulation :6969-:6972
```

Startup order: sim (`cd simulation && npm start`) → engine
(`cd marsin_engine && node engine.js --model test_bench --pattern
01_cylon_sweep`, model must match the sim scene) → CaptainPad web
(`cd CaptainPad && npm run web:build && npm run web:serve`). Verify: sACN IN
monitor Connected (capture with `--show-ui`), two frames showing the pattern
animating, CaptainPad header `● CONNECTED` with live data. The engine writes
runtime state into tracked `marsin_engine/states/` files — expected residue;
report it, don't commit or silently revert it.

## Working etiquette

- The codex (`.agent/codex.md`) is maintained by Sina only — never edit it.
- Decompose multi-slice work via `.agent/os/multi_agent.md` (worktrees, own
  branches, own ports).
- Leave a dated report in `.agent/reports/` when handing off; file
  follow-ups on the Notion task tracker (see "Task tracking" above).
- This is a game — play it kindly, and have fun.
