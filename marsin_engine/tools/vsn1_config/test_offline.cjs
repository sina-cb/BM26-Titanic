#!/usr/bin/env node
/*
  test_offline.cjs — offline unit checks for the vsn1_config tools. No device,
  no serial port: pure codec / builder verification. Run: node test_offline.cjs

  Covers:
    1. FrameAssembler splits the exact live-captured heartbeat byte stream.
    2. CONFIG/EXECUTE encode -> decode round-trip (frame builder correctness).
    3. toDeviceActionString round-trips ALL action strings of the newest
       factory dump in dumps/ (the 45/45 wrapper-fix guarantee).
    4. buildActionStringFromLua compiles templates/hello_world.lua into a
       valid, single-line, in-budget device string that humanizes back.
    5. The length guard fires on an oversize action string.
*/
'use strict';

const fs = require('fs');
const path = require('path');

const gs = require('./grid_serial.cjs');
const { buildLayout, validateLayout } = require('./deploy_layout.cjs');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

function newestDump() {
  const dir = path.join(__dirname, 'dumps');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    throw new Error('No dumps/*.json found — run read_config.cjs first.');
  }
  return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
}

async function main() {
  const gp = await import('@intechstudio/grid-protocol');
  const { grid } = gp;
  await gp.initLuaFormatter();

  // 1. FrameAssembler on a live-captured heartbeat stream (two frames + tail).
  check('FrameAssembler splits live-captured heartbeat stream', () => {
    const mkFrame = (brcHex, cs) => {
      const b = [1, 15];
      for (const ch of brcHex) b.push(ch.charCodeAt(0));
      b.push(23, 2);
      for (const ch of '010e013b010501005b') b.push(ch.charCodeAt(0));
      b.push(3, 2);
      for (const ch of '030d00') b.push(ch.charCodeAt(0));
      b.push(3, 4);
      for (const ch of cs) b.push(ch.charCodeAt(0));
      b.push(10);
      return b;
    };
    const f1 = mkFrame('003433cc7f7f00000000', '1b');
    const f2 = mkFrame('003434cc7f7f00000000', '1c');
    const stream = [...f1, ...f2, 1, 15, 48]; // plus an incomplete tail
    const asm = new gs.FrameAssembler();
    const frames = [];
    // Feed in awkward 7-byte chunks to exercise reassembly.
    for (let i = 0; i < stream.length; i += 7) {
      asm.push(stream.slice(i, i + 7), (f) => frames.push(f));
    }
    assert(frames.length === 2, `expected 2 frames, got ${frames.length}`);
    assert(frames[0].length === f1.length - 1, 'frame 1 must exclude trailing LF');
    const decoded = grid.decode_packet_frame(frames[0]);
    assert(decoded !== undefined, 'captured frame must decode (checksum ok)');
    grid.decode_packet_classes(decoded);
    assert(decoded[0].class_name === 'HEARTBEAT', 'first class must be HEARTBEAT');
    assert(decoded[1].class_name === 'PAGEACTIVE', 'second class must be PAGEACTIVE');
  });

  // 2. CONFIG/EXECUTE encode -> decode round-trip.
  check('CONFIG/EXECUTE frame encode/decode round-trip', () => {
    const action = '<?lua --[[@cb]] self:ldsw() ?>';
    const descr = gs.configExecuteDescriptor(gp, 0, 0, 0, 13, 8, action);
    const packet = grid.encode_packet(descr);
    assert(packet !== undefined, 'encode_packet failed');
    const classArray = grid.decode_packet_frame([...packet.serial]);
    assert(classArray !== undefined, 'decode failed');
    grid.decode_packet_classes(classArray);
    const c = classArray.find((x) => x.class_name === 'CONFIG');
    assert(c && c.class_instr === 'EXECUTE', 'must decode as CONFIG/EXECUTE');
    assert(c.class_parameters.ACTIONSTRING === action, 'ACTIONSTRING must round-trip');
    assert(Number(c.class_parameters.ELEMENTNUMBER) === 13, 'element must round-trip');
    assert(Number(c.class_parameters.EVENTTYPE) === 8, 'event must round-trip');
  });

  // 3. Wrapper-fix round-trip across the whole factory dump.
  check('toDeviceActionString round-trips every dump action string', () => {
    const dump = newestDump();
    let n = 0;
    for (const el of dump.elements) {
      for (const ev of el.events) {
        const rt = gs.toDeviceActionString(gp, gs.toHumanActionString(gp, ev.shortLua));
        assert(
          rt === ev.shortLua,
          `mismatch at element ${el.elementIndex} event ${ev.eventType}`,
        );
        n++;
      }
    }
    assert(n > 0, 'dump had no action strings');
  });

  // 4. hello_world template compiles to a valid device string.
  check('hello_world.lua compiles, fits budget, humanizes back', () => {
    const maxLength = Number(grid.getProperty('CONFIG_LENGTH'));
    const src = fs.readFileSync(path.join(__dirname, 'templates', 'hello_world.lua'), 'utf8');
    const device = gs.buildActionStringFromLua(gp, src, maxLength);
    assert(device.startsWith('<?lua --[[@cb]]'), `bad wrapper: ${device.slice(0, 30)}`);
    assert(device.endsWith('?>'), 'must end with ?>');
    assert(!/\n/.test(device), 'must be single-line');
    assert(device.length <= maxLength, `over budget: ${device.length} > ${maxLength}`);
    assert(device.includes('Hello World'), 'payload text must survive');
    const human = gs.toHumanActionString(gp, device);
    assert(human.includes('draw_text_fast'), 'humanized form must use long names');
    assert(device.includes('ldft'), 'device form must use short names');
  });

  // 5. Length guard fires.
  check('oversize action string is rejected', () => {
    const maxLength = Number(grid.getProperty('CONFIG_LENGTH'));
    const big = `self:draw_text_fast("${'x'.repeat(maxLength)}", 0, 0, 8, {1,1,1})`;
    let threw = false;
    try {
      gs.buildActionStringFromLua(gp, big, maxLength);
    } catch (err) {
      threw = /limit|chars/.test(err.message);
    }
    assert(threw, 'expected the length guard to throw');
  });

  // 6. deploy_layout: the example layout builds 4 in-budget, decodable pages.
  check('example layout builds 4 valid page patches', () => {
    const layout = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'layouts', 'example_layout.json'), 'utf8'),
    );
    const { patches, budgets, maxLength } = buildLayout(gp, layout);
    assert(patches.length === 4, `expected 4 page patches, got ${patches.length}`);
    for (const b of budgets) {
      assert(b.length <= maxLength, `${b.label} over budget: ${b.length}`);
    }
    for (const p of patches) {
      // 8 keys x (INIT + factory BC) + encoder (INIT + BC + ENDLESS)
      // + 4 side buttons (BC) + LCD (INIT + DRAW) + system (INIT) = 26
      const n = p.elements.reduce((a, e) => a + e.events.length, 0);
      assert(n === 26, `page ${p.page}: expected 26 action strings, got ${n}`);
      for (const el of p.elements) {
        for (const ev of el.events) {
          const descr = gs.configExecuteDescriptor(
            gp, 0, 0, p.page, el.elementIndex, ev.eventType, ev.shortLua,
          );
          const packet = grid.encode_packet(descr);
          assert(packet !== undefined, `encode failed p${p.page} el${el.elementIndex}`);
          const classArray = grid.decode_packet_frame([...packet.serial]);
          grid.decode_packet_classes(classArray);
          const c = classArray.find((x) => x.class_name === 'CONFIG');
          assert(
            c.class_parameters.ACTIONSTRING === ev.shortLua,
            `round-trip mismatch p${p.page} el${el.elementIndex} ev${ev.eventType}`,
          );
        }
      }
    }
    // The feedback CC map must be substituted into the receiver. `knd` (the
    // 32-entry kind array) now rides the LCD INIT for budget, but the receiver
    // still USES it via the sticky-LED gate below.
    const rx = patches[0].elements.find((e) => e.elementIndex === 8)
      .events.find((e) => e.eventKey === 'INIT').shortLua;
    assert(!rx.includes('__'), 'unsubstituted placeholder in encoder INIT');
    assert(rx.includes('midirx_cb'), 'receiver must install midirx_cb');
    assert(rx.includes('hi=0'), 'receiver must dismiss the welcome on non-hello feedback');
    assert(rx.includes('hi=1'), 'receiver must ARM the welcome on the host hello (connect only)');
    assert(rx.includes('knd[base+k+1]==1'), 'sticky LEDs must be gated on toggle kind');
    assert(rx.includes('vm=p2'), 'receiver must apply the host-echoed view mode');
    assert(rx.includes('ebar('), 'receiver must repaint the bar on selected-slot feedback');
    // Welcome = HOST-ARMED on connect only (device INIT defaults hi=0). View
    // mode (DRUM/EFFECT) is host-echoed; the grid draws in EFFECT view only.
    const lcdEvs = patches[0].elements.find((e) => e.elementIndex === 13).events;
    const lcdInit = lcdEvs.find((e) => e.eventKey === 'INIT').shortLua;
    const lcdDraw = lcdEvs.find((e) => e.eventKey === 'DRAW').shortLua;
    assert(!lcdInit.includes('os.'), 'no os.* dependency (unprovable on this firmware)');
    assert(lcdInit.includes('pf=20'), 'page loads must arm the 20-frame page flash');
    assert(lcdInit.includes('hi=0'), 'LCD INIT must default the welcome OFF (host arms it on connect)');
    assert(!/[^-]hi=1/.test(lcdInit), 'LCD INIT must NOT arm the welcome on page load');
    // ONE VIEW (2026-07-10 evening): the LCD defaults straight to the grid
    // visual (vm=1) so a VM wipe lands on the drum/grid view even before the
    // host's pinned echo arrives; the grid is COLORS ONLY (no abr array).
    assert(lcdInit.includes('vm=1'), 'LCD INIT must default to the grid visual (vm=1)');
    assert(!lcdInit.includes('abr='), 'grid is COLORS ONLY — no abbreviation array on the LCD INIT');
    assert(lcdInit.includes('e[3]>0 and e[3]<8'),
      'ANY user event (incl. the sb release after a swap) must dismiss the welcome');
    assert(lcdInit.includes('gdw=function'),
      'LCD INIT must define its own grid renderer (self-sufficiency)');
    assert(lcdInit.includes('mnm='), 'LCD INIT must embed the mode-name table');
    // `knd` (the 32-entry toggle/trigger array) rides the KEY INIT now — moved
    // off the LCD INIT for budget (2026-07-10). It's a page-load global the
    // encoder receiver reads for its sticky-LED gate. Assert it's present AND
    // that its `__KINDS__` (+ per-key colour) placeholders were substituted.
    const keyInit0 = patches[0].elements.find((e) => e.elementIndex === 0)
      .events.find((e) => e.eventKey === 'INIT').shortLua;
    assert(keyInit0.includes('knd='), 'KEY INIT must embed the kind array');
    assert(!keyInit0.includes('__'), 'unsubstituted placeholder in key INIT');
    assert(lcdDraw.includes('gdw(self)'), 'LCD DRAW must render the grid (EFFECT view)');
    assert(lcdDraw.includes('vm==1'), 'LCD DRAW must gate the grid on EFFECT view');
    assert(lcdDraw.includes('wdw~=nil') && lcdDraw.includes('fdw~=nil'),
      'system-INIT helpers must be nil-guarded (a lost system INIT must not black the screen)');
    assert(!/and gdw~=nil/.test(lcdDraw.replace(/\s+/g, '')) || lcdDraw.includes('gdw~=nil'),
      'draw gate may only depend on LCD-INIT state');
    assert(lcdDraw.includes('pf-1'), 'LCD DRAW must run the page-flash countdown');
    assert(lcdDraw.includes('pd=1'), 'page flash must paint once, not every frame');
    // System INIT hosts only OPTIONAL helpers now.
    const sysInit = patches[0].elements.find((e) => e.elementIndex === 255)
      .events.find((e) => e.eventKey === 'INIT').shortLua;
    for (const fn of ['ebar=function', 'wdw=function', 'fdw=function']) {
      assert(sysInit.includes(fn), `system INIT must define ${fn.split('=')[0]}`);
    }
    assert(sysInit.includes('glag(8,'), 'ebar must resolve LEDs via led_address_get(8, i)');
    assert(sysInit.includes('Marsin'), 'system INIT must host the welcome artwork');
    // Encoder turn: ABSOLUTE per-slot value CC (the knob-bug fix).
    const turn = patches[0].elements.find((e) => e.elementIndex === 8)
      .events.find((e) => e.eventKey === 'ENDLESS').shortLua;
    assert(turn.includes('gms(-1,176,32+sel,vals[si])'),
      'encoder turn must emit the absolute per-slot value CC');
    assert(turn.includes('ebar('), 'encoder turn must repaint the LED bar');
    // Key LED (item 2 fix): every key INIT sets its color on EXPLICIT layer 1
    // (auto-layer is nil in INIT -> a -1 layer would no-op = black LED) and
    // starts brightness at 0; the receiver drives sticky brightness on layer 1.
    const layoutSlots = layout.slots;
    const k0init = patches[0].elements.find((e) => e.elementIndex === 0)
      .events.find((e) => e.eventKey === 'INIT').shortLua;
    assert(k0init.includes('glc(1,'), 'key INIT must set LED color on explicit layer 1');
    assert(k0init.includes('glp(1,0)'), 'key INIT must start the LED off (brightness 0)');
    assert(rx.includes('led_value(1'.replace('led_value', 'glp')) || rx.includes('glp(1,'),
      'receiver must drive sticky LED brightness on layer 1');
    // Toggle key BC does not touch its LED; trigger keeps the factory tap-flash.
    const k0bc = patches[0].elements.find((e) => e.elementIndex === 0)
      .events.find((e) => e.eventKey === 'BC').shortLua; // slot 1: trigger in engine layout
    const toggleKey = layoutSlots.find((x) => x.behavior === 'toggle');
    assert(toggleKey, 'layout must contain a toggle slot for this test');
    const tbc = patches[Math.floor((toggleKey.id - 1) / 8)].elements
      .find((e) => e.elementIndex === (toggleKey.id - 1) % 8)
      .events.find((e) => e.eventKey === 'BC').shortLua;
    assert(!tbc.includes('glp') && !tbc.includes('glc'),
      'toggle key BC must not touch its own LED (sticky = feedback only)');
    const trigSlot = layoutSlots.find((x) => x.behavior === 'trigger');
    assert(trigSlot, 'layout must contain a trigger slot for this test');
    const kt = patches[Math.floor((trigSlot.id - 1) / 8)].elements
      .find((e) => e.elementIndex === (trigSlot.id - 1) % 8)
      .events.find((e) => e.eventKey === 'BC').shortLua;
    assert(kt.includes('glp(-1,-1)'), 'trigger key BC must keep the factory tap-flash');
    // Item 1: selected grid cell text uses an on-device contrast color.
    assert(lcdInit.includes('1280'), 'gdw must compute a contrast text color for the filled cell');
  });

  // 7. deploy_layout: bad layouts are rejected loudly.
  check('layout validation rejects bad inputs', () => {
    const good = () => JSON.parse(
      fs.readFileSync(path.join(__dirname, 'layouts', 'example_layout.json'), 'utf8'),
    );
    const cases = [
      [(l) => { l.version = 2; }, /version/],
      [(l) => { l.slots[1].id = 1; }, /twice/],
      [(l) => { l.slots[0].id = 33; }, /1\.\.32/],
      [(l) => { l.slots[0].name = 'WayTooLongEffectName'; }, /name/],
      [(l) => { l.slots[0].color = [300, 0, 0]; }, /color/],
      [(l) => { l.midi.pageCc = 35; }, /overlap/],
      [(l) => { l.slots[0].behavior = 'sticky'; }, /behavior/],
      [(l) => { l.slots[0].modeNames = ['ok', 'this-mode-name-is-way-too-long']; }, /modeNames/],
      [(l) => { l.midi.helloCc = 33; }, /overlap/],
      [(l) => { l.midi.sbNoteBase = 36; }, /overlap/],
      [(l) => { l.midi.modeChannel = 16; }, /0\.\.15/],
    ];
    for (const [mutate, want] of cases) {
      const l = good();
      mutate(l);
      let threw = false;
      try {
        validateLayout(l);
      } catch (err) {
        threw = want.test(err.message);
        if (!threw) {
          throw new Error(`wrong error for ${want}: ${err.message}`);
        }
      }
      assert(threw, `expected validation error matching ${want}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  });
