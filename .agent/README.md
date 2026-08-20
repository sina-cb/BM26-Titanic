# The Agent OS — `.agent/`

This directory is the **Agent OS**: the machinery agents and the human
operator (**Sina Solaimanpour**) use to build the Titanic's lighting for
Burning Man 2026. The **Game of Life** continues — the OS is just how we
play it. Read this after the codex; it is the map to everything else.

## Precedence — the spec stack

We call these **specs**, not laws (Sina, 2026-07-28): shared agreements
that keep everyone making better progress, safe, happy, and on the same
page of markdowns. It's a Game of Life, not a courtroom. When two
documents disagree, the higher one wins. Conflicts resolve **upward**:

> **`codex.md`** › **`os/` specs** › **`ops/` + `skills/` procedures** ›
> **`roles/` briefs** › **`context/` + `memory/`**

`codex.md` is **the holy word** — the constitution. It is maintained by
**Sina only**; no agent ever edits it. Everything below it exists to serve
it, never to override it.

## Directory map

| Dir | What it is | When to use it |
|---|---|---|
| `codex.md` | **The holy word** — mission, P0 rules. Sina-only, never edit. | Read first, every session. |
| `README.md` | This map — OS layout, precedence, boot pointer. | After the codex. |
| `os/` | **The specs** — git, style guides, ui_design, multi_agent, **interface_agent**, task_tracking, security_privacy, **autonomy**, **memory**. | Before committing, writing code, fanning out, or acting on your own initiative. |
| `ops/` | **Runbooks + auto-checks** — how to run each subsystem, and the checks that prove it works. | Before running or before claiming a subsystem is merge-ready. |
| `skills/` | **How-tos** — reusable procedures (see the sim, place lights, PB patterns, smoke tests…). | When the task matches a skill, follow it instead of improvising. |
| `roles/` | **Role briefs** — coordinator, planner, designer, developer (+ subsystem experts), reviewer, deployment, artist, investigator, validator, task_manager, **curator** (the operator's Codex agent — content curation; if you are Codex, read `roles/curator.md` first). | Adopt the matching role's mindset and checklist. |
| `context/` | **State of play** — `boot.md` (session start sequence) + `now.md` (living dashboard). | Boot from `boot.md`; read/update `now.md` when state changes. |
| `memory/` | **Durable facts** — `MEMORY.md` index + one fact per file. Survives context compaction. | Load the index at boot; open facts on demand; write facts that outlive a session. |
| `plans/` | **Campaign plans** — dated, historical ground truth. | Read when working a campaign; don't rewrite the contents. |
| `projects/` | **Project dossiers** — `TEMPLATE.md` + one live dossier per campaign. | Read/update the dossier for the project you're advancing. |
| `reports/` | **Dated reports** — handoffs, audits, investigations (`YYYYMM/YYYYMMDD_N_slug.md`). | Read for context; write one when handing off or concluding. |
| `reports_local/` | **Operator-private short-term tracking** — gitignored AND deploy-excluded; the only home for future dates/deadlines (public repo!). Exists on the operator's machine only. | Schedule/deadline material goes here, never in tracked files. Rules: `os/security_privacy.md` + its own README. |
| `agent_fs.yaml` | Filesystem visibility config for the mobile viewer. | Rarely; don't break it. |

## Boot sequence

Every agent runs the ordered checklist in **[`context/boot.md`](context/boot.md)**
at session start (codex → this map → `now.md` → memory index → your role →
the specs/ops your task touches). Don't ask what to read — boot yourself.

## Radical autonomy

You are a trusted operator of this OS, not a supplicant: **you are trusted
to act; the gates are few and explicit.** The doctrine and the exhaustive
list of operator gates live in **[`os/autonomy.md`](os/autonomy.md)**.

## Naming rules

- **snake_case** filenames everywhere (`git.md`, `see_the_world.md`).
- **No numeric prefixes** on any file — the old `00_`/`01_` scheme is gone.
  The **only** exception is the date prefix on `plans/` and `reports/`
  entries (`YYYYMMDD_N_slug.md`), which orders them chronologically.

## Historical note — old paths in the record

Reports and plans written before **2026-07-06** cite the old numbered
layout (`.agent/00_gol/`, `01_skills/`, `02_reports/`, `03_agent_types/`,
`04_plans/`). Those are **records**, left unrewritten. Map old → new:

| Old path | New path |
|---|---|
| `.agent/00_gol/00_codex.md` | `.agent/codex.md` |
| `.agent/00_gol/*` | `.agent/os/*` (specs) or `.agent/ops/*` (runbooks/checks) |
| `.agent/01_skills/*` | `.agent/skills/*` |
| `.agent/02_reports/*` | `.agent/reports/*` |
| `.agent/03_agent_types/*` | `.agent/roles/*` |
| `.agent/04_plans/*` | `.agent/plans/*` |

This is a game — play it kindly, and have fun.
