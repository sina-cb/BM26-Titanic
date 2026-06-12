# 2026-06-12 — New-UI parity + CaptainPad theming (developer handoff)

**Agent:** developer / simulation expert (remote container session, branch
`claude/admiring-shannon-4ahh4g`, based on `30a807b` = `origin/dev/new_ui`)
**Operator:** Sina Solaimanpour

## What this delivers

The sim UI now shares CaptainPad's design language and theme system while
keeping the existing UI **functionally untouched**: no panel, control,
shortcut, or workflow was added, removed, renamed, or rewired. The rework is
a pure presentation layer — palette tokens, typography, and a theme picker —
so functional parity with the reference (`30a807b`) holds by construction,
and was verified by booting and exercising the UI (screenshots below).

### Architecture

- `simulation/src/gui/theme.js` — palettes ported **value-for-value** from
  `CaptainPad/constants/theme.ts` (`Colors`, `THEMES`, `THEME_ORDER`).
  Self-initializes on import (loaded by `index.html` before `main.js`),
  writes every token as a CSS custom property on `<html>`, persists the
  operator's pick in localStorage (`bm26.sim.themeMode`), resolves
  `system` via `prefers-color-scheme` (and re-applies live on OS flips),
  and supports a `?theme=<id>` URL override that applies + persists.
- `simulation/style.css` — all chrome colors now reference palette tokens;
  variants derive via `color-mix()` (the design.md "variants are derived"
  rule). The `:root` block carries the dark palette as boot defaults only.
  lil-gui is themed by mapping its native custom properties to tokens.
- Inline JS chrome styles (gui_builder, toasts, blackout button, etc.)
  reference `var(--token)`, so theme switches restyle everything live —
  nothing captures a boot-time palette.
- Typography: Space Grotesk (headlines/titles/buttons) + Inter (body),
  matching CaptainPad's `Fonts`. Space Grotesk latin 400/500/700 vendored
  from `@fontsource/space-grotesk@5.2.10` into
  `simulation/vendor/fonts/space_grotesk/` — offline-safe, no CDN.
- Drift guard: `simulation/tests/theme_parity.test.js` extracts the
  palettes from the **TypeScript source** and fails if `theme.js` or the
  `style.css` boot defaults drift from CaptainPad. Wired into `npm test`
  (now `node --test tests/*.test.js`).
- `agent_render.cjs` gained `--url <url>` (full sim-URL override) for
  non-default ports and themed captures (the mission's "task 010").

### Deliberate mapping decisions (flag if you disagree)

- **Accent**: the old fixed gold `#f0c060` → `var(--primary)` per theme.
- **sACN monitors** keep a distinct accent via `--secondary` (was blue) so
  telemetry reads differently from editor chrome.
- **Caution amber** (`--caution: #ffb400`, unpatched pill / spotlight
  budget / overlap toasts) is deliberately **not themed** — safety signage
  should read identically in every palette. Critical states use the themed
  `--error`.
- **Snap-mode indicator** (`interaction.js`) keeps fixed cyan/amber: its
  colors pair with the in-scene 3D cursor ring/arrow materials, which CSS
  variables can't drive. Filed as task 014.
- **Success/green** roles map to `--tertiary` (CaptainPad's "synced" green).

## Parity matrix (reference `30a807b` → themed UI)

Evidence in `.agent_renders/` (gitignored, this container). Reference
screenshot rendered from a clean worktree at `30a807b` on the same scene:
`1781231710_current.png`.

| Surface | Status | Evidence |
|---|---|---|
| HUD frame, top bar, scene selector, FPS chip | ✓ identical layout, themed | all `_current.png` captures |
| Theme selector (new, only intentional addition) | ✓ next to scene select | `1781231515_current.png` (GRUVBOX chip) |
| Pattern editor (presets, code, run/save, autorun, docs) | ✓ | every capture |
| Engine parameters / Global Parameters panel | ✓ | every capture |
| Lighting Controls (lil-gui tree, all folders) | ✓ | every capture |
| DMX patch editors, metadata panels, toolbars | ✓ (token sweep only) | `panels_dark_all.png` |
| LED strand folders + New Strand | ✓ | `panels_dark_all.png` |
| sACN IN/OUT monitors + BLACKOUT button | ✓ | `panels_dark_all.png` |
| Views editor panel + modals + isolation HUD | ✓ | `panels_dark_all.png` |
| Save Configuration / Views buttons | ✓ | `panels_dark_all.png` |
| View preset row (+ add/update/remove) | ✓ | every capture |
| Warnings (unpatched, spotlight, blackout, dirty chip) | ✓ | dark/gruvbox captures |
| Keyboard shortcuts, edit mode, undo/redo | untouched code paths | git diff (no functional changes) |

## Theme matrix

All captured with `--show-ui --viewport 1280x720`, full scene load:

| Theme | Screenshot | Issues |
|---|---|---|
| light | `1781231036_current.png` | none — light frosted panels read well over the night scene |
| dark | `1781231079_current.png` | none |
| midnight | `1781231122_current.png` | none |
| sunset | `1781231163_current.png` | none |
| gruvbox | `1781231207_current.png` / `1781231515_current.png` | none |

Interactive contract verified headlessly (logged values):
`?theme=sunset` → `data-theme=sunset`, stored, `--primary:#ffb84a` →
reload without param keeps sunset, picker shows `sunset`, options =
`light,dark,midnight,sunset,gruvbox,system` → live switch to midnight flips
`--primary` to `#5cc0ff` and persists, no reload.

## Tests run

- `git diff --check -- simulation` — pass.
- `node --check` on every changed JS file — pass.
- `cd simulation && npm run check` — **9/9 pass** (2 fog regression +
  7 theme parity).
- Browser smoke (titanic scene, full profile): loads past overlay, fixture
  dots render, only pre-existing console errors (engine :6968 offline ×7,
  `favicon.ico` 404). All Inter + Space Grotesk fonts report `loaded`.

## Known gaps / notes

- **Scene YAML residue (NOT committed):** `simulation/scenes/common.yaml`,
  `titanic/{scene_config,patches,views}.yaml` are dirty in the worktree —
  the known boot/unload auto-save rewrote runtime values
  (`rendererMode: webgl`, `lightingProfile: full` from render URLs) and
  reordered patch keys. Left unstaged per the rules; do not commit.
- Snap-mode indicator theming → task `014`.
- The Windows-environment quirk "servers exit when the render client
  disconnects" did **not** reproduce on this Linux container (server
  returned 200 after every one of ~10 render sessions).
- The mission referenced tracker tasks 008–012 (sim-UI ports, sACN OUT
  selector, show-helpers toggle) that don't exist in this clone's tracker;
  of those, the agent-render URL override (010) is implemented here.
- CaptainPad picker shows label + hint text; the sim picker is a compact
  HUD `<select>` (labels only) — hints didn't fit the idiom.

## How to try it

```bash
cd simulation && npm start
# then open http://localhost:6969/simulation/ and use the THEME picker
# in the top bar, or append &theme=gruvbox to the URL.
```
