#!/usr/bin/env node
/*
  build_button_context.cjs — compile the templates/button_context/ demo into
  per-page PATCH dumps that restore_config.cjs can validate + deploy.

  Emits (into dumps/, gitignored):
    patch_button_context_page0.json   full demo: key INITs (LED colors),
                                      encoder ENDLESS, side-button BCs,
                                      LCD INIT + DRAW
    patch_button_context_page1.json   side-button BCs only (page switching
    patch_button_context_page2.json   works FROM every page; everything else
    patch_button_context_page3.json   stays factory on pages 1-3)

  The patch files use the exact dump schema (module/page/elements/shortLua),
  so the deploy path is the already-field-proven restore_config.cjs with its
  dry-run default, per-entry validation, ACK waits and single PAGESTORE per
  page. Nothing here touches the device.

  Deploy order note: deploy pages 3 -> 2 -> 1 -> 0 so the device is left
  with page 0 active (restore_config sends PAGEACTIVE for the page it writes).
*/
'use strict';

const fs = require('fs');
const path = require('path');

const gs = require('./grid_serial.cjs');

const TPL = path.join(__dirname, 'templates', 'button_context');
const OUT = path.join(__dirname, 'dumps');

// One unique color per main key (elements 0..7). MUST match cols in
// lcd_init.lua — the LCD swatch and the key LED are supposed to agree.
const KEY_COLORS = [
  [255, 40, 40],
  [255, 140, 0],
  [255, 220, 0],
  [60, 220, 60],
  [0, 200, 200],
  [60, 120, 255],
  [160, 60, 255],
  [255, 60, 200],
];

function readTemplate(name) {
  return fs.readFileSync(path.join(TPL, name), 'utf8');
}

async function main() {
  const gp = await import('@intechstudio/grid-protocol');
  const { grid } = gp;
  await gp.initLuaFormatter();

  const maxLength = Number(grid.getProperty('CONFIG_LENGTH'));
  const compile = (luaSource, label) => {
    const device = gs.buildActionStringFromLua(gp, luaSource, maxLength);
    console.log(`  ${label.padEnd(28)} ${String(device.length).padStart(3)}/${maxLength} chars`);
    return device;
  };

  // Cross-check: lcd_init.lua's cols table must match KEY_COLORS.
  const lcdInitSrc = readTemplate('lcd_init.lua');
  const colsInLcd = lcdInitSrc.match(/cols\s*=\s*\{(.+)\}/);
  if (!colsInLcd) {
    throw new Error('lcd_init.lua: could not find the cols table.');
  }
  for (const [r, g, b] of KEY_COLORS) {
    if (!colsInLcd[1].includes(`{${r}, ${g}, ${b}}`)) {
      throw new Error(
        `lcd_init.lua cols table is missing {${r}, ${g}, ${b}} — KEY_COLORS ` +
          `and the template have drifted apart.`,
      );
    }
  }

  console.log('Compiling templates (budget check against CONFIG_LENGTH):');

  // Per-key INIT actions with substituted colors.
  const keyInitTpl = readTemplate('key_init.lua');
  const keyInits = KEY_COLORS.map(([r, g, b], i) => {
    const src = keyInitTpl
      .replace(/__R__/g, String(r))
      .replace(/__G__/g, String(g))
      .replace(/__B__/g, String(b));
    return compile(src, `key ${i} INIT (led ${r},${g},${b})`);
  });

  const endlessEdit = compile(readTemplate('endless_edit.lua'), 'encoder ENDLESS');
  const sideButton = compile(readTemplate('side_button_page.lua'), 'side-button BC (shared)');
  const lcdInit = compile(lcdInitSrc, 'LCD INIT');
  const lcdDraw = compile(readTemplate('lcd_draw.lua'), 'LCD DRAW');

  const entry = (elementIndex, elementType, eventType, eventKey, shortLua) => ({
    elementIndex,
    elementType,
    events: [{ eventType, eventKey, actionLength: shortLua.length, shortLua }],
  });

  const sideButtonEntries = () => [9, 10, 11, 12].map((el) =>
    entry(el, 'button', 3, 'BC', sideButton),
  );

  const patch = (page, elements) => ({
    tool: 'vsn1_config/build_button_context.cjs',
    generatedAt: new Date().toISOString(),
    note: 'PATCH dump (partial) — deploy with restore_config.cjs',
    module: { type: 'VSN1L', firmware: 'patch', hwcfg: 59, position: { dx: 0, dy: 0 } },
    page,
    elements,
  });

  // Page 0: the full demo.
  const page0Elements = [
    ...KEY_COLORS.map((_, i) => entry(i, 'button', 0, 'INIT', keyInits[i])),
    entry(8, 'endless', 7, 'ENDLESS', endlessEdit),
    ...sideButtonEntries(),
    entry(13, 'lcd', 0, 'INIT', lcdInit),
    entry(13, 'lcd', 8, 'DRAW', lcdDraw),
  ];

  const files = [];
  const emit = (page, elements) => {
    const p = path.join(OUT, `patch_button_context_page${page}.json`);
    fs.writeFileSync(p, JSON.stringify(patch(page, elements), null, 2));
    files.push(p);
    const n = elements.reduce((a, e) => a + e.events.length, 0);
    console.log(`Wrote ${p} (${n} action strings)`);
  };

  emit(0, page0Elements);
  for (const page of [1, 2, 3]) {
    emit(page, sideButtonEntries());
  }

  console.log('\nDeploy (dry-run first, live in page order 3 -> 2 -> 1 -> 0):');
  for (const page of [3, 2, 1, 0]) {
    console.log(`  node restore_config.cjs dumps/patch_button_context_page${page}.json [--live]`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  });
