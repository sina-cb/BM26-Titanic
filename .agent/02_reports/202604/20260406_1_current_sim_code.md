# Simulation Codebase — Structural Review & Cleanup Plan

**Date:** 2026-04-06  
**Scope:** `/simulation/` directory — structural review only, no logic changes.

---

## 1. Current File Layout (Flat)

```
simulation/
├── index.html                 # Entry point (114 lines)
├── main.js                    # MONOLITH — 4,528 lines (everything)
├── style.css                  # All styles (725 lines)
├── package.json               # Scripts + deps
│
├── ParLight.js                # PascalCase — fixture class (157 lines)
├── ModelFixture.js            # PascalCase — fixture class (257 lines)
├── LedStrand.js               # PascalCase — fixture class (213 lines)
├── Iceberg.js                 # PascalCase — fixture class (556 lines)
├── MarsinEngine.js            # PascalCase — WASM wrapper (303 lines)
│
├── save-server.js             # kebab-case — Node.js save server (134 lines)
├── agent_render.js            # snake_case — Puppeteer renderer (399 lines)
├── ui_controller.js           # snake_case — Puppeteer UI automation (223 lines)
├── brace_counter.js           # snake_case — one-off debug utility
├── check_syntax.js            # snake_case — one-off debug utility
├── get_logs.js                # snake_case — Puppeteer log capture
├── net_log.js                 # snake_case — Puppeteer net debug
│
├── scene_config.yaml          # Scene state (405 KB!)
├── scene_preset_cameras.yaml  # Camera presets
├── server_config.yaml         # Empty / placeholder
├── dev.bat                    # Windows-only dev script
├── README.md                  # Documentation
│
├── lib/
│   └── marsin-engine/         # WASM binaries (6 files + README)
├── models/
│   └── *.stl                  # 4 cached iceberg STL meshes
├── pb/
│   ├── *.js                   # 9 Pixelblaze pattern scripts
│   └── model/
│       └── model.js           # Auto-generated pixel model
├── agent_tools/
│   ├── agent_render.cjs       # CJS version of agent_render
│   └── validate_ui.cjs        # CJS UI validation
└── node_modules/              # Dependencies
```

---

## 2. Key Structural Problems

### 2.1 The Monolith: `main.js` (4,528 lines)

This is **by far** the biggest problem. `main.js` contains:

| Concern | Lines (approx) | Should Be |
|---|---|---|
| Three.js scene init (renderer, camera, controls, post-processing) | 1–400 | `core/scene.js` |
| Snap-to-surface mode | 403–518 | `core/snap.js` |
| Pointer/keyboard interaction & selection | 520–889 | `core/interaction.js` |
| Ground, stars, model loading, lighting setup | 891–1093 | `core/environment.js` |
| Par light / DMX fixture rebuild logic | 1094–1216 | `core/fixtures.js` |
| YAML config I/O (extractParams, reconstructYAML) | 170–273 | `core/config.js` |
| Undo/redo system | 89–168 | `core/undo.js` |
| GUI setup (lil-gui) — **2,600 lines alone** | 1218–3794 | `gui/` subfolder |
| HUD frame setup | 3796–3808 | `gui/hud.js` |
| View presets & camera animation | 3810–3946 | `gui/view-presets.js` |
| Pattern engine init & editor wiring | 3956–4237 | `gui/pattern-editor.js` |
| Animation/render loop | 4239–4415 | `core/animate.js` |
| Bootstrap (fetch configs, init) | 4417–4528 | `core/bootstrap.js` |

> **Impact:** Impossible to navigate, hard to review in PRs, no clear ownership boundaries. Every change risks collateral breakage.

### 2.2 File Naming Inconsistencies

Three different conventions are used **at the same level**:

| Convention | Files | Typical Use |
|---|---|---|
| **PascalCase** | `ParLight.js`, `ModelFixture.js`, `LedStrand.js`, `Iceberg.js`, `MarsinEngine.js` | ES module classes (browser) |
| **snake_case** | `agent_render.js`, `ui_controller.js`, `check_syntax.js`, `brace_counter.js`, `get_logs.js`, `net_log.js` | Node.js scripts/tools |
| **kebab-case** | `save-server.js` | Node.js server |

The convention split actually correlates with **runtime** (browser vs Node.js), which is a valid pattern — but the mixing of `snake_case` and `kebab-case` within the Node.js tools is inconsistent.

### 2.3 Orphan / Debug Files at Root Level

These sit alongside production code with no separation:

| File | Purpose | Used by |
|---|---|---|
| `brace_counter.js` | One-off debug script for `Iceberg.js` brace matching | Nobody (manual) |
| `check_syntax.js` | One-off syntax check for `Iceberg.js` | Nobody (manual) |
| `net_log.js` | Puppeteer debug tool (Windows Chrome path hardcoded!) | Nobody |
| `get_logs.js` | Puppeteer log capture | Agent tooling |
| `dev.bat` | Windows-only dev script | Windows users |

### 2.4 `agent_tools/` Duplication

- `agent_tools/agent_render.cjs` is a **CJS copy** of the browser-side `agent_render.js`
- Both exist with slightly different logic. This is a maintenance risk.

### 2.5 `pb/model/` Directory Confusion

- `pb/` contains pattern scripts (user-editable `.js` files)
- `pb/model/` contains auto-generated pixel map data
- The name "model" inside "pb" (Pixelblaze) is misleading — it's not a PB pattern

### 2.6 Missing `.gitignore` Entries

- The `models/` directory contains cached STL files that are auto-generated
- `pb/model/model.js` is auto-generated on every save
- These should be gitignored (or at least documented)

### 2.7 No Separate Entry for GUI Logic

The GUI builder logic alone is **~2,600 lines** deeply nested inside `setupGUI()`. This includes:
- Par lights section builder
- DMX lights section builder
- LED strands section builder
- Icebergs section builder
- Group generator (traces)
- Lighting engine section
- Pattern editor wiring

Each of these is self-contained enough to be its own file.

---

## 3. Proposed Restructure

> **Goal:** Move files around and rename; do NOT change any logic, imports, or behavior.

### 3.1 Target Directory Layout

```
simulation/
├── index.html                    # Entry point (unchanged)
├── main.js                       # Slim orchestrator (~200 lines)
├── style.css                     # Unchanged
├── package.json                  # Unchanged
├── README.md                     # Unchanged
│
├── src/                          # ← NEW: All browser-side JS modules
│   ├── core/                     # Scene fundamentals
│   │   ├── scene.js              # Renderer, camera, controls, post-processing
│   │   ├── environment.js        # Ground, stars, model loading, lighting
│   │   ├── interaction.js        # Pointer, keyboard, selection, transform
│   │   ├── snap.js               # Snap-to-surface mode
│   │   ├── fixtures.js           # rebuildParLights, rebuildDmxFixtures
│   │   ├── config.js             # extractParams, reconstructYAML, config I/O
│   │   ├── undo.js               # Undo/redo stack
│   │   └── animate.js            # Animation loop + lighting modes
│   │
│   ├── fixtures/                 # Fixture classes (renamed for consistency)
│   │   ├── ParLight.js           # (moved from root)
│   │   ├── ModelFixture.js       # (moved from root)
│   │   ├── LedStrand.js          # (moved from root)
│   │   ├── Iceberg.js            # (moved from root)
│   │   └── MarsinEngine.js       # (moved from root)
│   │
│   └── gui/                      # GUI builders
│       ├── setup.js              # Main setupGUI + generic builder
│       ├── par-lights.js         # buildParLightsSection + renderParGUI
│       ├── dmx-lights.js         # buildDmxLightsSection + renderDmxGUI
│       ├── led-strands.js        # buildLedStrandsSection
│       ├── icebergs.js           # buildIcebergsSection
│       ├── generators.js         # Group generator (traces)
│       ├── lighting-engine.js    # buildLightingEngineSection
│       ├── pattern-editor.js     # setupPatternEditor + compile logic
│       ├── view-presets.js       # Camera presets UI
│       └── hud.js                # HUD frame setup
│
├── server/                       # ← NEW: All Node.js server code
│   └── save-server.js            # (moved from root)
│
├── tools/                        # ← NEW: All Node.js CLI tools
│   ├── agent-render.js           # (moved + renamed from agent_render.js)
│   ├── ui-controller.js          # (moved + renamed from ui_controller.js)
│   └── get-logs.js               # (moved + renamed from get_logs.js)
│
├── tools/debug/                  # ← NEW: One-off debug scripts
│   ├── brace-counter.js          # (moved + renamed)
│   ├── check-syntax.js           # (moved + renamed)
│   └── net-log.js                # (moved + renamed)
│
├── config/                       # ← NEW: All YAML config files
│   ├── scene_config.yaml         # (moved from root)
│   ├── scene_preset_cameras.yaml # (moved from root)
│   └── server_config.yaml        # (moved from root)
│
├── lib/                          # WASM binaries (unchanged)
│   └── marsin-engine/
│
├── models/                       # STL cache (unchanged)
│   └── *.stl
│
├── patterns/                     # ← RENAMED from pb/
│   ├── *.js                      # Pixelblaze patterns
│   └── model/
│       └── model.js              # Auto-generated pixel map
│
└── agent_tools/                  # Keep if needed for external CI
    ├── agent_render.cjs
    └── validate_ui.cjs
```

### 3.2 Naming Convention (Standardized)

| Category | Convention | Example |
|---|---|---|
| **ES module files** (browser) | `kebab-case.js` or `PascalCase.js` for classes | `par-lights.js`, `ParLight.js` |
| **Node.js scripts** (tools) | `kebab-case.js` | `agent-render.js`, `save-server.js` |
| **Directories** | `kebab-case/` | `src/`, `core/`, `gui/`, `tools/` |

> **Decision:** Keep PascalCase for class files (`ParLight.js`), use kebab-case for everything else; delete the inconsistent snake_case.

### 3.3 Deleteable Files

| File | Reason |
|---|---|
| `dev.bat` | Windows-only, project runs on macOS |
| `server_config.yaml` | Contains only `port: 8181` — hardcoded in save-server.js anyway |
| `agent_tools/agent_render.cjs` | Duplicate of `agent_render.js` — only keep one |

---

## 4. Execution Sequence

Since the goal is to keep functionality identical, the refactor is **purely a move/rename operation** with import path updates. Steps:

### Phase 1: Create directories
```
mkdir -p src/core src/fixtures src/gui server tools tools/debug config
```

### Phase 2: Move files (no content changes yet)
1. Move fixture classes: `ParLight.js`, `ModelFixture.js`, `LedStrand.js`, `Iceberg.js`, `MarsinEngine.js` → `src/fixtures/`
2. Move server: `save-server.js` → `server/save-server.js`
3. Move tools: `agent_render.js` → `tools/agent-render.js`, etc.
4. Move debug: `brace_counter.js`, `check_syntax.js`, `net_log.js` → `tools/debug/`
5. Move config: `scene_config.yaml`, `scene_preset_cameras.yaml` → `config/`
6. Rename `pb/` → `patterns/`
7. Delete: `dev.bat`, `server_config.yaml`

### Phase 3: Update import paths
1. `main.js` — update all `import { X } from './ParLight.js'` → `'./src/fixtures/ParLight.js'`
2. `index.html` — no change (still loads `main.js`)
3. `save-server.js` — update file paths for YAML reads/writes
4. `agent_render.js` — update preset YAML path
5. `package.json` — update `start` script to reference `server/save-server.js`

### Phase 4: Split `main.js` (optional, larger effort)
This is the most impactful step but also the riskiest. Can be done incrementally:
1. Extract `src/core/undo.js` (simple, self-contained)
2. Extract `src/core/config.js` (simple, self-contained)
3. Extract `src/core/snap.js` (depends on scene objects)
4. Continue per the table in §2.1

> [!IMPORTANT]  
> Phase 4 (splitting `main.js`) is a **follow-up task** — it requires careful dependency analysis  
> since many functions reference shared closure variables (`scene`, `camera`, `params`, etc.).  
> The file moves in Phases 1–3 are safe and can be done immediately.

---

## 5. Risk Assessment

| Risk | Mitigation |
|---|---|
| Broken import paths | Grep for all `import` and `require` statements; update systematically |
| Save server path references | `__dirname` in `save-server.js` will change; update relative paths |
| `http-server` root | Static server root is `../` from `simulation/`; YAML paths in `main.js` use relative fetch URLs — verify these still resolve |
| `agent_render.js` file references | Uses `path.join(__dirname, ...)` — paths must be updated |
| Pattern editor save/load | Fetches `pb/*.js` via HTTP; if renaming to `patterns/`, must update both JS and server routes |

---

## 6. Summary

| Metric | Before | After |
|---|---|---|
| Files at root level | **22** | **5** (main.js, index.html, style.css, package.json, README.md) |
| Naming conventions | **3 mixed** | **1 consistent** (kebab-case + PascalCase for classes) |
| Debug scripts in root | **4** | **0** (moved to `tools/debug/`) |
| `main.js` size | **4,528 lines** | **4,528 lines** (Phase 3) or **~200 lines** (Phase 4) |
| Clear directory purpose | ❌ Flat soup | ✅ `src/`, `server/`, `tools/`, `config/` |

> [!TIP]
> **Recommended approach:** Execute Phases 1–3 now (30 min, low risk). Schedule Phase 4  
> (splitting `main.js`) as a separate focused session with testing between each extraction.
