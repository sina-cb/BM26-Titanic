# CLAUDE.md — BM26 Titanic

Lighting project for **the Titanic at Burning Man 2026**. We play a shared
Game of Life here: agents and the human operator (**Sina Solaimanpour**)
collaborate through the `.agent/` directory, which is the source of truth for
how we work. **Read `.agent/00_gol/00_codex.md` first** — it is the master
rulebook; this file is the distilled map.

The mission, in order: make the Titanic exterior highly visible at night
(mission critical), light the rooms, keep strike under 2 hours, carry TE's
DNA forward, be welcoming, be kind, have fun.

## The `.agent/` directory — how to wield it

| Path | What it is | When to use it |
|---|---|---|
| `.agent/00_gol/` | **Game of Life specs** — codex, git rules, style guides, runbooks, auto-check specs, multi-agent workflow, task tracking | Before writing code, committing, running anything, or claiming merge-readiness |
| `.agent/01_skills/` | **Skills** — reusable how-tos (screenshot/render the sim, lighting arrangement, PB patterns, adding global params) | When the task matches a skill, follow the skill instead of improvising |
| `.agent/02_reports/` | **Reports** — dated handoffs, audits, investigations (`YYYYMM/YYYYMMDD_N_slug.md`) | Read for context on past work; write one when handing off or concluding an investigation |
| `.agent/03_agent_types/` | **Agent roles** — coordinator, planner, designer, developer (+ per-subsystem experts), reviewer, deployment, artist, investigator, validator | Adopt the matching role's mindset and checklist when acting in that capacity |
| `.agent/agent_fs.yaml` | Agent filesystem visibility config for the mobile viewer | Rarely; don't break it |

(The old `.agent/04_task_tracker/` directory was deprecated and removed
on 2026-06-12 — tasks live in Notion, see below.)

Key specs by number (in `.agent/00_gol/`): `00` codex · `01` git +
python style · `02` nodejs style · `03/04/05` auto-checks (CaptainPad / sim /
engine) · `06` run sim · `07` run engine · `08` MarsinScript patterns ·
`09` iPad builds · `10` auto-patcher · `11` UI design · `12` Raspberry Pi ·
`13` multi-agent worktrees · `14` task tracking (Notion).

## Task tracking (Notion)

Tasks live on the Notion board **Titanic Lighting - Task Tracker**
(Titanic's End workspace → Camp Operations → Titanic Lighting):
<https://app.notion.com/p/titanicsend/9f241c2d454747859b149d738cc21bc8>

Agents access it through the **Notion MCP server — the connection must
be enabled and the Titanic's End workspace shared with it**, or every
read fails with a 404. If you get a 404, ask Sina to enable the MCP
connection; do not fall back to creating task files in the repo.
Board schema, card body format, and add/close workflow:
`.agent/00_gol/14_task_tracking.md`. Check the board before starting
new work; file follow-ups there as `Backlog` cards.

## Hard rules (P0 — from the codex)

- **No fallback behaviors. Ever.** Unless explicitly asked. Fail loudly.
- **Never** use built-in web tools to view the sim — use the skill
  `.agent/01_skills/00_see_the_world.md` (puppeteer renderer).
- **All imports at the top of the file**, never inside functions, never
  wrapped in try/except — a missing dependency must crash at startup.
- **snake_case filenames** for all source files (`par_light.js`); classes
  inside stay PascalCase.
- **Temp/scratch files go in `~/tmp/`** (gitignored), never in the source tree.
- **No git operations until explicitly asked** by the human op. Never use
  `git reset --hard` / `git checkout --` to hide test side effects. Before
  claiming merge-ready, run the touched subsystems' auto-check specs.
- **Offline readiness is a deployment requirement**: the playa has no
  internet. No CDNs, no external fonts, no runtime `npm install`, no
  telemetry. Browser deps are vendored in `simulation/vendor/`.
- Style guides: `.agent/00_gol/01_python_style.md`,
  `.agent/00_gol/02_nodejs_style.md` — read before writing code.

## Repo map

| Directory | What lives there |
|---|---|
| `simulation/` | Three.js 3D lighting sim (browser). `npm start` → HTTP :6969, save :6970, sACN bridges :6971/:6972. Scenes in `simulation/scenes/<scene>/` |
| `marsin_engine/` | Pixelblaze-compatible pattern engine (WASM VM, 40 fps, sACN out, REST/WS API). `node engine.js --model test_bench --pattern <name>` |
| `CaptainPad/` | TypeScript Expo iPad app — operator control surface |
| `control_podium/` | Podium hardware + Raspberry Pi server bridge (Meshtastic radio path) |
| `marsin_pb/` | Pixelblaze-related tooling |
| `3d_models/`, `3d_structure/`, `renders/`, `images/` | Assets |
| `states/`, `docs/`, `archived/` | State files, docs, retired work |
| `.agent_renders/` | Sim screenshot output (gitignored) |

## Seeing your work (sim screenshots)

Follow `.agent/01_skills/00_see_the_world.md`. Short version:

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

Follow `.agent/01_skills/05_full_stack_smoke.md` to bring up the whole chain
and prove every link with screenshots:

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

- The codex (`00_codex.md`) is maintained by Sina only — never edit it.
- Decompose multi-slice work via `.agent/00_gol/13_multi_agent.md`
  (worktrees, own branches, own ports).
- Leave a dated report in `.agent/02_reports/` when handing off; file
  follow-ups on the Notion task tracker (see "Task tracking" above).
- This is a game — play it kindly, and have fun.
