#!/usr/bin/env node
/*
  deploy_layout.cjs — convert an effects LAYOUT (32 paged slots) into a full
  VSN1 device config and deploy it. THE pipeline endpoint for the
  effects_v2_midi_layout project (dossier: .agent/projects/
  effects_v2_midi_layout.md, Track T): the engine invokes this as a child
  process whenever the layout changes.

      node deploy_layout.cjs --layout <file.json> [--live] [--port <name>]

  ── DRY-RUN IS THE DEFAULT ───────────────────────────────────────────────────
  Without --live: validates the layout, compiles every action string (Lua
  pipeline + 909-char budget + encode/decode round-trip via restore_config's
  dry-run), writes the four per-page patch dumps, and STOPS. --live deploys
  the patches through the field-proven restore_config.cjs (spawned as a child
  per page, order 3 -> 2 -> 1 -> 0 so page 0 ends active), failing loudly on
  the first non-zero exit.

  What the generated config does on-device (per page):
    keys 0-7   INIT: LED = slot color (dim grey if the slot is empty);
               BC: FACTORY string verbatim -> MIDI unchanged (note 32+k,
               channel = current page, grid-fw auto-MIDI)
    sb0-3      BC: local page_load(N) + factory-auto note 41+N (Track C
               page-select contract, dossier)
    encoder    INIT: module globals + the runtime MIDI FEEDBACK receiver
               (midirx_cb; CC map from the layout's "midi" block);
               ENDLESS: local-predict value edit + relative CC 40 out;
               BC: press = mode-cycle note 40 out (engine cycles + echoes)
    LCD        INIT: page's names/colors + selection eventrx; DRAW: selected
               name + value text/bar + mode index + active + page indicator

  Layout schema: see README.md "Layout schema". Runtime values NEVER trigger
  this tool — they flow as MIDI feedback (dossier: knob twists never cause
  flash writes).
*/
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const gs = require('./grid_serial.cjs');

const TPL = path.join(__dirname, 'templates', 'effects_layout');
const OUT = path.join(__dirname, 'dumps');

const PAGES = 4;
const KEYS_PER_PAGE = 8;
const EMPTY_COLOR = [30, 30, 30];
// Fallback colors by key position (engine slots currently carry color: null).
const PALETTE = [
  [255, 40, 40], [255, 140, 0], [255, 220, 0], [60, 220, 60],
  [0, 200, 200], [60, 120, 255], [160, 60, 255], [255, 60, 200],
];
const EMPTY_NAME = '-';
// Name cap. A dense 8-slot page bakes 8 names + colors + abbrevs + mode tables
// into ONE 909-char LCD INIT script; 12-char names on a full multi-mode page
// blew the budget (froze the device live, 2026-07-10). 10 chars keeps a real
// safety margin on a packed page while staying legible.
const MAX_NAME_LEN = 10;
// Mode-name display cap. The LCD INIT carries a per-slot mode-name table (mnm)
// that is the single biggest VARIABLE cost on a dense page — 8 slots, several
// with 4-mode colorWash lists, blew page 0 past the 909-char device budget
// (review C1, hit live 2026-07-10). Modes are a secondary detail line, so we
// abbreviate them hard to keep the operator's full effect NAMES intact and buy
// budget headroom. 3 chars keeps them recognizable (rep/mul/tin/add/max).
const MAX_MODE_LEN = 3;

// Factory key BC string, verbatim from the device dump (read_config.cjs,
// VSN1L fw 1.5.1). Written back as-is so key MIDI behavior is unchanged.
const FACTORY_KEY_BC =
  '<?lua --[[@sbc]] self:bmo(0) self:bmi(0) self:bma(127)' +
  '--[[@sglc]] self:glc(-1,{{-1,-1,-1,1}}) self:glp(-1,-1)' +
  '--[[@gms]] self:gms(-1,-1,-1,-1) ?>';

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { layout: null, live: false, port: null, fromEngine: false, engineUrl: 'http://127.0.0.1:6968', page: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--page') {
      args.page = parseInt(argv[++i], 10);
    } else if (a === '--layout') {
      args.layout = argv[++i];
    } else if (a === '--from-engine') {
      args.fromEngine = true;
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args.engineUrl = argv[++i];
      }
    } else if (a === '--live') {
      args.live = true;
    } else if (a === '--port') {
      args.port = argv[++i];
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
vsn1 deploy_layout — effects layout (32 paged slots) -> full VSN1 config.
DRY-RUN BY DEFAULT; --live deploys via restore_config.cjs (pages 3->2->1->0).

Usage:
  node deploy_layout.cjs --layout layouts/example_layout.json [--live] [--port <name>]
  node deploy_layout.cjs --from-engine [http://127.0.0.1:6968] [--live] [--port <name>]
  node deploy_layout.cjs --from-engine --page N [--live]   # re-flash ONE page

--from-engine builds the layout from the LIVE engine: GET /global-effects/layout
(slot placement + names) merged with GET /global-effect-slots/status (behavior
toggle|trigger, colors, primaryMode value names). Missing colors fall back to
the built-in palette by key position.

--page N (0..3) deploys only that page — the fast path the engine's auto-deploy
hook uses when a single slot changes. Dry-run default + read-back verify apply.

Layout schema: README.md "Layout schema". Emits dumps/layout_<name>_page{0..3}.json.
`);
}

// ── Layout validation ────────────────────────────────────────────────────────
function validateLayout(layout) {
  if (layout.version !== 1) {
    throw new Error(`Unsupported layout version: ${layout.version} (want 1).`);
  }
  if (typeof layout.name !== 'string' || !/^[a-z0-9_]+$/.test(layout.name)) {
    throw new Error('layout.name must be a snake_case string (used in patch filenames).');
  }
  if (layout.module !== 'VSN1L' && layout.module !== 'VSN1R') {
    throw new Error(`layout.module must be VSN1L or VSN1R, got ${layout.module}.`);
  }

  // MIDI feedback contract — Track C pins: feedbackChannel 1 (active notes,
  // value CCs, page CC), modeChannel 2 (mode CCs), slotBase 32 (i = 0..7,
  // over the ACTIVE page's slots), pageCc 40, sbNoteBase 41.
  const m = layout.midi || {};
  for (const k of ['feedbackChannel', 'modeChannel', 'slotBase', 'pageCc', 'sbNoteBase', 'helloCc', 'selectCc', 'viewCc']) {
    if (!Number.isInteger(m[k])) {
      throw new Error(`layout.midi.${k} must be an integer.`);
    }
  }
  for (const k of ['feedbackChannel', 'modeChannel']) {
    if (m[k] < 0 || m[k] > 15) {
      throw new Error(`midi.${k} must be 0..15.`);
    }
  }
  if (m.slotBase < 0 || m.slotBase + 7 > 127) {
    throw new Error(`midi.slotBase: block ${m.slotBase}..${m.slotBase + 7} must fit 0..127.`);
  }
  if (m.sbNoteBase < 0 || m.sbNoteBase + 3 > 127) {
    throw new Error(`midi.sbNoteBase: block ${m.sbNoteBase}..${m.sbNoteBase + 3} must fit 0..127.`);
  }
  if (m.pageCc < 0 || m.pageCc > 119) {
    throw new Error('midi.pageCc must be 0..119.');
  }
  if (m.pageCc >= m.slotBase && m.pageCc < m.slotBase + 8) {
    throw new Error(
      `midi.pageCc ${m.pageCc} overlaps the slot block ${m.slotBase}..${m.slotBase + 7}.`,
    );
  }
  if (m.sbNoteBase < m.slotBase + 8 && m.sbNoteBase + 3 >= m.slotBase) {
    throw new Error(
      `midi.sbNoteBase block ${m.sbNoteBase}..${m.sbNoteBase + 3} overlaps the ` +
        `slot block ${m.slotBase}..${m.slotBase + 7}.`,
    );
  }
  if (m.helloCc < 0 || m.helloCc > 119) {
    throw new Error('midi.helloCc must be 0..119.');
  }
  if (m.helloCc >= m.slotBase && m.helloCc < m.slotBase + 8) {
    throw new Error(
      `midi.helloCc ${m.helloCc} overlaps the slot block (mode CCs share its ` +
        `channel) ${m.slotBase}..${m.slotBase + 7}.`,
    );
  }
  // selectCc — the SELECT CUE (host-armed key) rides modeChannel, so it must
  // not collide with the mode CC slot block or the hello CC on that channel.
  if (m.selectCc < 0 || m.selectCc > 119) {
    throw new Error('midi.selectCc must be 0..119.');
  }
  if (m.selectCc >= m.slotBase && m.selectCc < m.slotBase + 8) {
    throw new Error(
      `midi.selectCc ${m.selectCc} overlaps the slot block (mode CCs share its ` +
        `channel) ${m.slotBase}..${m.slotBase + 7}.`,
    );
  }
  if (m.selectCc === m.helloCc) {
    throw new Error(
      `midi.selectCc ${m.selectCc} collides with midi.helloCc on the mode channel.`,
    );
  }
  // viewCc — the VIEW MODE echo (DRUM/EFFECT) rides modeChannel too, so it must
  // not collide with the mode CC slot block, the hello CC, or the select CC.
  if (m.viewCc < 0 || m.viewCc > 119) {
    throw new Error('midi.viewCc must be 0..119.');
  }
  if (m.viewCc >= m.slotBase && m.viewCc < m.slotBase + 8) {
    throw new Error(
      `midi.viewCc ${m.viewCc} overlaps the slot block (mode CCs share its ` +
        `channel) ${m.slotBase}..${m.slotBase + 7}.`,
    );
  }
  if (m.viewCc === m.helloCc || m.viewCc === m.selectCc) {
    throw new Error(
      `midi.viewCc ${m.viewCc} collides with helloCc/selectCc on the mode channel.`,
    );
  }

  if (!Array.isArray(layout.slots) || layout.slots.length === 0) {
    throw new Error('layout.slots must be a non-empty array.');
  }
  const seen = new Set();
  for (const s of layout.slots) {
    if (!Number.isInteger(s.id) || s.id < 1 || s.id > 32) {
      throw new Error(`slot id ${s.id}: must be an integer 1..32.`);
    }
    if (seen.has(s.id)) {
      throw new Error(`slot id ${s.id} appears twice.`);
    }
    seen.add(s.id);
    if (typeof s.effect !== 'string' || s.effect.length === 0) {
      throw new Error(`slot ${s.id}: effect must be a non-empty string.`);
    }
    if (typeof s.name !== 'string' || s.name.length === 0 || s.name.length > MAX_NAME_LEN) {
      throw new Error(`slot ${s.id}: name must be 1..${MAX_NAME_LEN} chars (LCD width).`);
    }
    if (/["\\\n]/.test(s.name)) {
      throw new Error(`slot ${s.id}: name must not contain quotes, backslashes or newlines.`);
    }
    if (!Array.isArray(s.color) || s.color.length !== 3 ||
        s.color.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) {
      throw new Error(`slot ${s.id}: color must be [r,g,b] with 0..255 integers.`);
    }
    if (s.behavior !== undefined && s.behavior !== 'toggle' && s.behavior !== 'trigger') {
      throw new Error(`slot ${s.id}: behavior must be "toggle" or "trigger" (or omitted = toggle).`);
    }
    if (s.modeNames !== undefined) {
      if (!Array.isArray(s.modeNames) ||
          s.modeNames.some((x) => typeof x !== 'string' || /["\\\n]/.test(x) || x.length > 10)) {
        throw new Error(`slot ${s.id}: modeNames must be strings <= 10 chars, no quotes/backslashes.`);
      }
    }
  }
}


// ── Layout from the LIVE engine ──────────────────────────────────────────────
// GET /global-effects/layout   -> slot placement (id, page, effectId, name)
// GET /global-effect-slots/status -> behavior, color, primaryMode value names
// Missing colors fall back to the palette by key position. Names/mode names
// are sanitized for the on-device Lua string literals (quotes/backslashes
// stripped, length clamped) — display data, documented normalization.
async function loadLayoutFromEngine(engineUrl) {
  const get = async (path) => {
    const res = await fetch(engineUrl + path);
    if (!res.ok) {
      throw new Error(`${engineUrl}${path} -> HTTP ${res.status}. Is the engine running?`);
    }
    return res.json();
  };
  const layoutRes = await get('/global-effects/layout');
  const statusRes = await get('/global-effect-slots/status');
  // The engine's CURRENT page: after a live deploy the device must be put
  // back on THIS page (restore_config leaves it on whatever page it wrote —
  // the "device stuck on the wrong page" bug, 2026-07-10). effectsPage rides
  // the status payload; missing/malformed fails loud below at deploy time.
  const effectsPage = Number.isInteger(statusRes.effectsPage) ? statusRes.effectsPage : null;
  const statusById = new Map((statusRes.slots || []).map((x) => [x.slotId, x]));

  const clean = (str, max) =>
    String(str).replace(/["\\\n]/g, '').slice(0, max);

  const slots = (layoutRes.layout.slots || []).map((s) => {
    const info = statusById.get(s.slotId) || {};
    const key = (s.slotId - 1) % KEYS_PER_PAGE;
    return {
      id: s.slotId,
      effect: s.effectId,
      name: clean(s.name || s.effectId, MAX_NAME_LEN),
      color: Array.isArray(s.color) && s.color.length === 3 ? s.color : PALETTE[key],
      behavior: info.behavior === 'trigger' ? 'trigger' : 'toggle',
      modeNames: Array.isArray(info.modeValues)
        ? info.modeValues.map((v) => clean(v, MAX_MODE_LEN))
        : [],
    };
  });
  if (slots.length === 0) {
    throw new Error('Engine layout has no populated slots — refusing to build an empty device.');
  }
  return {
    version: 1,
    name: 'engine',
    module: 'VSN1L',
    midi: { feedbackChannel: 1, modeChannel: 2, slotBase: 32, pageCc: 40, sbNoteBase: 41, helloCc: 41, selectCc: 42, viewCc: 43 },
    effectsPage,
    slots,
  };
}

// slot for (page, key) or null. Dossier: page p views slots 8p+1 .. 8p+8.
function slotAt(layout, page, key) {
  const id = page * KEYS_PER_PAGE + key + 1;
  return layout.slots.find((s) => s.id === id) || null;
}

// ── Build the per-page patch dumps ───────────────────────────────────────────
function buildLayout(gp, layout) {
  validateLayout(layout);
  const { grid } = gp;
  const maxLength = Number(grid.getProperty('CONFIG_LENGTH'));
  const m = layout.midi;

  const readTpl = (f) => fs.readFileSync(path.join(TPL, f), 'utf8');
  const compile = (src, label) => {
    const device = gs.buildActionStringFromLua(gp, src, maxLength);
    return { device, label, length: device.length };
  };

  const sub = (src, map) => {
    let out = src;
    for (const [k, v] of Object.entries(map)) {
      out = out.split(k).join(String(v));
    }
    return out;
  };

  // Page-independent strings. knd = 32-entry toggle/trigger array (1=toggle)
  // for the sticky-LED gate in the receiver; empty slots are 0 (momentary).
  const kinds = [];
  for (let id = 1; id <= 32; id++) {
    const slot = layout.slots.find((x) => x.id === id);
    kinds.push(slot && (slot.behavior || 'toggle') === 'toggle' ? 1 : 0);
  }
  const encoderInit = compile(
    sub(readTpl('encoder_init.lua'), {
      __FCH__: m.feedbackChannel,
      __MCH__: m.modeChannel,
      __SB__: m.slotBase,
      __PCC__: m.pageCc,
      __SNB__: m.sbNoteBase,
      __HCC__: m.helloCc,
      __SCC__: m.selectCc,
      __VCC__: m.viewCc,
    }),
    'encoder INIT (midirx receiver)',
  );
  const encoderTurn = compile(
    sub(readTpl('encoder_turn.lua'), { __SB__: m.slotBase }),
    'encoder ENDLESS',
  );
  const systemInit = compile(readTpl('system_init.lua'), 'system INIT (ebar+wdw)');
  const keyBcToggle = compile(readTpl('key_bc_toggle.lua'), 'key BC (toggle, sticky LED)');
  const encoderPress = compile(readTpl('encoder_press.lua'), 'encoder BC (mode cycle)');
  const sideButton = compile(readTpl('side_button.lua'), 'side-button BC');
  const lcdDraw = compile(readTpl('lcd_draw.lua'), 'LCD DRAW');

  const keyInitTpl = readTpl('key_init.lua');
  const lcdInitTpl = readTpl('lcd_init.lua');

  const budgets = [encoderInit, encoderTurn, encoderPress, sideButton, lcdDraw, systemInit, keyBcToggle];
  const patches = [];

  for (let page = 0; page < PAGES; page++) {
    const names = [];
    const colors = [];
    const modes = [];
    const elements = [];

    // System element FIRST: the firmware executes each event right after a
    // CONFIG write registers it (grid_decode.c: register + process_single),
    // so shared helpers (ebar) must exist before any later-written action
    // that might run mid-deploy references them. (All callers also nil-guard.)
    elements.push({
      elementIndex: 255,
      elementType: 'system',
      events: [
        { eventType: 0, eventKey: 'INIT', actionLength: systemInit.device.length, shortLua: systemInit.device },
      ],
    });

    for (let key = 0; key < KEYS_PER_PAGE; key++) {
      const slot = slotAt(layout, page, key);
      const color = slot ? slot.color : EMPTY_COLOR;
      names.push(slot ? slot.name : EMPTY_NAME);
      colors.push(color);
      modes.push(slot && Array.isArray(slot.modeNames) ? slot.modeNames : []);

      const keyInit = compile(
        // __KINDS__ (the 32-entry toggle/trigger array) moved here from the LCD
        // INIT for budget (the LCD INIT now also carries the per-cell
        // abbreviations). It is page-independent; every key INIT re-assigns the
        // same global harmlessly, and all INITs run before any MIDI reaches the
        // receiver that reads knd.
        sub(keyInitTpl, {
          __R__: color[0], __G__: color[1], __B__: color[2],
          __KINDS__: `{${kinds.join(',')}}`,
        }),
        `p${page} key ${key} INIT`,
      );
      budgets.push(keyInit);
      // Toggle slots: BC without local LED writes (sticky state = feedback
      // only). Trigger slots + empty keys: factory BC (momentary tap-flash).
      const isToggle = slot && (slot.behavior || 'toggle') === 'toggle';
      const bc = isToggle ? keyBcToggle.device : FACTORY_KEY_BC;
      elements.push({
        elementIndex: key,
        elementType: 'button',
        events: [
          { eventType: 0, eventKey: 'INIT', actionLength: keyInit.device.length, shortLua: keyInit.device },
          { eventType: 3, eventKey: 'BC', actionLength: bc.length, shortLua: bc },
        ],
      });
    }

    elements.push({
      elementIndex: 8,
      elementType: 'endless',
      events: [
        { eventType: 0, eventKey: 'INIT', actionLength: encoderInit.device.length, shortLua: encoderInit.device },
        { eventType: 3, eventKey: 'BC', actionLength: encoderPress.device.length, shortLua: encoderPress.device },
        { eventType: 7, eventKey: 'ENDLESS', actionLength: encoderTurn.device.length, shortLua: encoderTurn.device },
      ],
    });

    for (const el of [9, 10, 11, 12]) {
      elements.push({
        elementIndex: el,
        elementType: 'button',
        events: [
          { eventType: 3, eventKey: 'BC', actionLength: sideButton.device.length, shortLua: sideButton.device },
        ],
      });
    }

    const luaNames = `{${names.map((n) => `"${n}"`).join(',')}}`;
    const luaColors = `{${colors.map((c) => `{${c.join(',')}}`).join(',')}}`;
    const luaModes = `{${modes.map((mm) => `{${mm.map((x) => `"${x}"`).join(',')}}`).join(',')}}`;
    // ONE VIEW (Sina, 2026-07-10 evening): the grid draws COLORS ONLY — the
    // per-cell abbreviations (and their `__ABBRS__` array) are gone, buying
    // permanent LCD-INIT budget headroom on dense pages. `knd` (32-entry
    // toggle/trigger array for the receiver's sticky-LED gate) rides the KEY
    // INITs; all INITs run per page load before any MIDI.
    // LCD INIT is still the budget-critical element: it carries the per-page
    // names + colors + MODE-name tables, so a dense page (8 named slots, each
    // with a couple of mode names) is the one that can breach the 909-char
    // device ceiling. If it does, `compile` throws a generic length error deep
    // in the flash — turn that into a LOUD, ACTIONABLE failure naming the page
    // and the fix, so the operator learns WHY a page didn't flash instead of
    // seeing a silently-stale screen (Codex P0 fail-loud; review C1 2026-07-10).
    let lcdInit;
    try {
      lcdInit = compile(
        sub(lcdInitTpl, {
          __NAMES__: luaNames,
          __COLORS__: luaColors,
          __MODES__: luaModes,
        }),
        `p${page} LCD INIT`,
      );
    } catch (e) {
      const nameChars = names.reduce((s, n) => s + String(n).length, 0);
      const modeChars = modes.reduce(
        (s, mm) => s + mm.reduce((t, x) => t + String(x).length, 0), 0);
      throw new Error(
        `VSN1 page ${page} LCD INIT exceeds the ${maxLength}-char device budget ` +
          `(${e.message}). This page has too much on-screen text to flash — it was ` +
          `NOT deployed and the device keeps its previous page ${page}. Trim it: ` +
          `shorten slot names (page ${page} carries ${nameChars} chars of names, ` +
          `cap ${MAX_NAME_LEN}/name) and/or reduce mode-name lists ` +
          `(${modeChars} chars of mode names on this page).`,
      );
    }
    budgets.push(lcdInit);

    elements.push({
      elementIndex: 13,
      elementType: 'lcd',
      events: [
        { eventType: 0, eventKey: 'INIT', actionLength: lcdInit.device.length, shortLua: lcdInit.device },
        { eventType: 8, eventKey: 'DRAW', actionLength: lcdDraw.device.length, shortLua: lcdDraw.device },
      ],
    });

    patches.push({
      tool: 'vsn1_config/deploy_layout.cjs',
      generatedAt: new Date().toISOString(),
      layout: layout.name,
      note: 'Layout patch dump — deploy with restore_config.cjs or deploy_layout.cjs --live',
      module: { type: layout.module, firmware: 'layout', hwcfg: 59, position: { dx: 0, dy: 0 } },
      page,
      elements,
    });
  }

  return { patches, budgets, maxLength };
}

function writePatches(layout, patches) {
  const files = [];
  for (const p of patches) {
    const f = path.join(OUT, `layout_${layout.name}_page${p.page}.json`);
    fs.writeFileSync(f, JSON.stringify(p, null, 2));
    files.push(f);
  }
  return files;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.layout && !args.fromEngine) {
    throw new Error('Need --layout <file> or --from-engine. See --help.');
  }
  if (args.layout && args.fromEngine) {
    throw new Error('--layout and --from-engine are mutually exclusive.');
  }

  // Dynamic import (not a top-level require) is REQUIRED here: grid-protocol is
  // ESM-only and this file is CJS (.cjs), so it cannot be `require`d and CJS has
  // no top-level await — the ESM package can only be pulled in via `await
  // import()` inside an async fn. This is the sanctioned CJS→ESM interop
  // exception, not an "import inside a function" style violation.
  const gp = await import('@intechstudio/grid-protocol');
  await gp.initLuaFormatter();

  const layout = args.fromEngine
    ? await loadLayoutFromEngine(args.engineUrl)
    : JSON.parse(fs.readFileSync(args.layout, 'utf8'));
  if (args.fromEngine) {
    console.log(`Layout fetched from engine at ${args.engineUrl}:`);
    for (const sl of layout.slots) {
      console.log(
        `  slot ${String(sl.id).padStart(2)} p${Math.floor((sl.id - 1) / 8)} ` +
          `${sl.behavior.padEnd(7)} ${sl.name.padEnd(12)} [${sl.modeNames.join(', ')}]`,
      );
    }
  }
  const { patches, budgets, maxLength } = buildLayout(gp, layout);

  if (args.page !== null && (!Number.isInteger(args.page) || args.page < 0 || args.page > 3)) {
    throw new Error(`--page must be 0..3, got ${args.page}.`);
  }
  // Deploy order: single page = just that one; full = 3->2->1->0 (page 0 last
  // so it ends active). Always write ALL patch files (cheap; keeps a full set
  // on disk for rollback), but only validate/deploy the selected page(s).
  const pageOrder = args.page !== null ? [args.page] : [3, 2, 1, 0];

  console.log(`Layout "${layout.name}": ${layout.slots.length}/32 slots assigned.`);
  console.log('Budgets:');
  for (const b of budgets) {
    console.log(`  ${b.label.padEnd(32)} ${String(b.length).padStart(3)}/${maxLength}`);
  }

  const files = writePatches(layout, patches);
  console.log('\nPatch dumps:');
  for (const f of files) {
    console.log(`  ${f}`);
  }

  // Validate every patch through restore_config's dry-run (encode/decode
  // round-trip per entry) — same code path a live deploy will use.
  console.log(`\nValidating ${pageOrder.length > 1 ? 'patches' : 'patch (page ' + pageOrder[0] + ')'} (restore_config dry-run):`);
  for (const p of pageOrder) {
    const f = files[p];
    const r = spawnSync(process.execPath, [path.join(__dirname, 'restore_config.cjs'), f],
      { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(`Patch validation FAILED for page ${p}:\n${r.stdout}\n${r.stderr}`);
    }
    console.log(`  page ${p}: OK`);
  }

  if (!args.live) {
    console.log('\nDRY RUN — nothing was sent. Deploy with:');
    for (const p of pageOrder) {
      console.log(`  node restore_config.cjs ${path.relative(__dirname, files[p])} --live`);
    }
    console.log('or re-run this tool with --live.');
    return 0;
  }

  // ── LIVE: deploy the selected page(s) via restore_config.cjs ──────────────
  console.log(pageOrder.length > 1
    ? '\n*** LIVE MODE: deploying all four pages (3 -> 2 -> 1 -> 0). ***'
    : `\n*** LIVE MODE: deploying page ${pageOrder[0]} only. ***`);
  for (const p of pageOrder) {
    const cmd = [path.join(__dirname, 'restore_config.cjs'), files[p], '--live'];
    if (args.port) {
      cmd.push('--port', args.port);
    }
    console.log(`\n--- page ${p} ---`);
    const r = spawnSync(process.execPath, cmd, { stdio: 'inherit' });
    if (r.status !== 0) {
      throw new Error(
        `Live deploy FAILED at page ${p} (exit ${r.status}). Pages deployed so ` +
          `far remain committed; fix the problem and re-run. Rollback: restore ` +
          `the pre-deploy dumps from dumps/.`,
      );
    }
  }
  // ── Snap the device back to the ENGINE's current page ─────────────────────
  // restore_config MUST activate the page it writes (firmware NACKs CONFIG
  // writes to a non-active page) and leaves the device there. Without this
  // step a single-page deploy (the auto-deploy hook's normal shape) strands
  // the device on the deployed page while the engine stays on effectsPage —
  // every key press then maps to the wrong flat slot ("buttons do nothing",
  // hit live 2026-07-10). From-engine deploys know the engine's page; manual
  // --layout deploys fall back to the last deployed page (unchanged behavior).
  const lastDeployed = pageOrder[pageOrder.length - 1];
  const wantPage = args.fromEngine && Number.isInteger(layout.effectsPage)
    ? layout.effectsPage
    : lastDeployed;
  // ALWAYS run the activation, even when wantPage === lastDeployed (review D2,
  // 2026-07-10): restore_config's own page-change re-enable is a single
  // fire-and-forget TYPE-255 heartbeat that the reader can drop (grid_serial
  // documents this) — if it drops, the side button AND host page CCs are
  // silently ignored ("device stuck on a page"). activate_page's retry loop
  // re-sends the enable heartbeat every round and CONFIRMS via
  // PAGEACTIVE/REPORT, so it doubles as the robust re-latch.
  console.log(`\nActivating engine page ${wantPage} (post-deploy confirm + page-change re-latch) ...`);
  const cmd = [path.join(__dirname, 'activate_page.cjs'), '--page', String(wantPage)];
  if (args.port) {
    cmd.push('--port', args.port);
  }
  const r = spawnSync(process.execPath, cmd, { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(
      `Deploy succeeded but activating page ${wantPage} FAILED (exit ${r.status}). ` +
        `The device may be showing page ${lastDeployed} with page changes ` +
        `locked — key presses can hit the wrong slots. ` +
        `Run: node activate_page.cjs --page ${wantPage}`,
    );
  }
  console.log(`\nLayout deployed. Page ${wantPage} is active.`);
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`\nERROR: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { buildLayout, validateLayout, loadLayoutFromEngine };
