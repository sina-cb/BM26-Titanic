/**
 * halo_reach_probe.cjs — does the Global Halo Size knob reach every bus?
 *
 * Operator (2026-07-30): "The halo size parameter only affects the TE sign
 * lights, no LED strands, none of the DMX lights." + "please make sure that's a
 * global for-all-fixtures parameter."
 *
 * MEASURES, does not fix. For one fixture of each class (LED-bus sign, LED
 * strand, UKing par, Vintage LED, Shehds bar) it reads the DRAWN bulb and halo
 * radii straight out of the live instance matrices, then drives the two halo
 * controls through the EXACT bodies the GUI handlers run and re-reads them. The
 * output answers three questions per class:
 *   • does the radius MOVE when the knob moves (reach)?
 *   • is the halo actually OUTSIDE its own opaque bulb (visibility)?
 *   • is it sitting at a pitch cap (a legitimate physical bound)?
 *
 * LIVE-SESSION SAFETY — the same four guards as vintage_sizing_capture.cjs:
 *   GUARD 1 `__readonlyMode` forced true as an accessor before any page script.
 *   GUARD 2 the sACN-OUT bridge socket (:6972) refused at the constructor.
 *   GUARD 3 every save-server (:6970) request counted; loud failure on non-GET.
 *   GUARD 4 no GUI controller is ever touched (that would reach
 *     debounceAutoSave) — the handler BODIES are replayed by hand, params are
 *     restored, and nothing is written to disk.
 *
 * Usage (servers must already be running — never start them from here):
 *   node halo_reach_probe.cjs [--profile full]
 */
const puppeteer = require('puppeteer');

const ORIGIN = 'http://127.0.0.1:6969';
const args = process.argv.slice(2);
const pi = args.indexOf('--profile');
const PROFILE = pi === -1 ? 'full' : args[pi + 1];
const SIM_URL = `${ORIGIN}/simulation/?scene=titanic&profile=${PROFILE}&renderer=webgl`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function installGuards(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, '__readonlyMode', {
      get: () => true, set: () => {}, configurable: true,
    });
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = function GuardedWebSocket(url, protocols) {
      if (typeof url === 'string' && /:6972(\/|$)/.test(url)) {
        throw new Error('[halo_reach_probe] blocked: sACN OUT bridge socket (:6972)');
      }
      return new NativeWebSocket(url, protocols);
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
  });
}

// Uniform scale baked into instance `i` of an InstancedMesh — the drawn radius.
const MEASURE = () => {
  const scaleOf = (mesh, i) => {
    if (!mesh || mesh.count <= i) return null;
    const a = mesh.instanceMatrix.array;
    const o = i * 16;
    return Math.hypot(a[o], a[o + 1], a[o + 2]);
  };
  const rows = [];
  const push = (cls, name, bulb, halo, pitch, sprite) => rows.push({
    cls, name,
    bulb: bulb === null ? null : +bulb.toFixed(5),
    halo: halo === null ? null : +halo.toFixed(5),
    ratio: bulb && halo ? +(halo / bulb).toFixed(3) : null,
    pitch: pitch === undefined || pitch === null ? null : +pitch.toFixed(5),
    sprite: sprite === undefined || sprite === null ? null : +sprite.toFixed(5),
  });
  const seen = new Set();
  for (const f of [...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])]) {
    if (!f || !f.config) continue;
    const cls = f._isLed ? `led-bus:${f.config.fixtureType}` : `dmx:${f.config.fixtureType}`;
    if (seen.has(cls)) continue;
    seen.add(cls);
    push(cls, f.config.name, scaleOf(f.bulbInst, 0), scaleOf(f.haloInst, 0),
      f._minPixelPitch, f.pixels && f.pixels[0] && f.pixels[0].halo ? f.pixels[0].halo.scale.x : null);
  }
  const s = (window.ledStrandFixtures || [])[0];
  if (s) push('strand', s.config.name, scaleOf(s.bulbInst, 0), scaleOf(s.haloInst, 0), null, null);
  return rows;
};

// The EXACT body of the gui_builder `globalHaloScale` onChange handler.
const APPLY_GLOBAL_HALO = (v) => import(`${location.origin}/simulation/src/core/state.js`)
  .then((st) => {
    st.params.globalHaloScale = v;
    const all = [...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])];
    all.forEach((f) => { if (f && f.updateScales) f.updateScales(st.params.globalPixelScale || 1.0, v); });
    (window.ledStrandFixtures || []).forEach((f) => { if (f && f.applyVisualSize) f.applyVisualSize(); });
  });

// The EXACT body of `applyLedSizeToAll` MINUS its debounceAutoSave() call
// (GUARD 4 — a save must never be reachable from a probe).
const APPLY_LED_HALO_SIZE = (v) => import(`${location.origin}/simulation/src/core/state.js`)
  .then((st) => {
    st.params.ledHaloSize = v;
    (window.ledStrandFixtures || []).forEach((f) => { if (f) f.applyVisualSize(); });
    [...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])].forEach((f) => {
      if (f && f._isLed && f.updateScales) {
        f.updateScales(st.params.globalPixelScale || 1.0, st.params.globalHaloScale || 1.0);
      }
    });
  });

async function main() {
  const browser = await puppeteer.launch({
    headless: false, defaultViewport: { width: 1024, height: 640 }, protocolTimeout: 240000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const page = (await browser.pages())[0];
  const saveServerHits = [];
  const sacnOutLines = [];
  page.on('console', (m) => { if (/\[sACN Out\]\s+Enabling/i.test(m.text())) sacnOutLines.push(m.text()); });
  page.on('request', (r) => {
    if (/:6970(\/|$)/.test(r.url())) saveServerHits.push(`${r.method()} ${r.url()}`);
  });
  page.on('dialog', async (d) => { await d.accept(); });
  await installGuards(page);

  try {
    console.log(`📡 ${SIM_URL}`);
    await page.goto(SIM_URL, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForFunction(() => {
      const o = document.getElementById('loading-overlay');
      if (!o) return true;
      const s = window.getComputedStyle(o);
      return s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden';
    }, { timeout: 120000 });
    await sleep(7000);

    const env = await page.evaluate(() => import(`${location.origin}/simulation/src/core/state.js`)
      .then((st) => ({
        profile: st.params.lightingProfile,
        globalPixelScale: st.params.globalPixelScale,
        globalHaloScale: st.params.globalHaloScale,
        ledPixelSize: st.params.ledPixelSize,
        ledHaloSize: st.params.ledHaloSize,
        strands: (window.ledStrandFixtures || []).length,
        dmx: (window.parFixtures || []).length,
      })));
    console.log(`⚙️  ${JSON.stringify(env)}`);
    const saved = { halo: env.globalHaloScale, ledHalo: env.ledHaloSize };

    const table = (label, rows) => {
      console.log(`\n── ${label} ──`);
      for (const r of rows) {
        console.log(`  ${r.cls.padEnd(22)} bulb=${String(r.bulb).padEnd(8)} halo=${String(r.halo).padEnd(8)} ` +
          `halo/bulb=${String(r.ratio).padEnd(7)} pitch=${String(r.pitch).padEnd(8)} sprite=${r.sprite}`);
      }
      return rows;
    };

    const base = table(`baseline (Global Halo Size ${env.globalHaloScale})`, await page.evaluate(MEASURE));

    console.log('\n════ knob 1: Global Halo Size (params.globalHaloScale) ════');
    const sweeps = {};
    for (const v of [0.1, 2.5, 5]) {
      await page.evaluate(APPLY_GLOBAL_HALO, v);
      await sleep(300);
      sweeps[v] = table(`globalHaloScale = ${v}`, await page.evaluate(MEASURE));
    }
    await page.evaluate(APPLY_GLOBAL_HALO, saved.halo);

    console.log('\n════ knob 2: LED "Halo Size" (params.ledHaloSize) ════');
    for (const v of [0.05, 0.25]) {
      await page.evaluate(APPLY_LED_HALO_SIZE, v);
      await sleep(300);
      table(`ledHaloSize = ${v}`, await page.evaluate(MEASURE));
    }
    await page.evaluate(APPLY_LED_HALO_SIZE, saved.ledHalo);

    console.log('\n════ knob 3: per-fixture LOCAL "Halo ×" (config.haloScale) ════');
    // Writes the property the GUI field writes, then calls the SAME live entry
    // point the GUI calls (syncFromConfig / applyVisualSize). Restored after.
    const localSweep = await page.evaluate((local) => {
      const scaleOf = (mesh) => {
        const a = mesh.instanceMatrix.array;
        return Math.hypot(a[0], a[1], a[2]);
      };
      const out = [];
      const seen = new Set();
      const touched = [];
      for (const f of [...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])]) {
        if (!f || !f.config || !f.haloInst) continue;
        const cls = `${f._isLed ? 'led-bus' : 'dmx'}:${f.config.fixtureType}`;
        if (seen.has(cls)) continue;
        seen.add(cls);
        const before = scaleOf(f.haloInst);
        const had = Object.prototype.hasOwnProperty.call(f.config, 'haloScale');
        const prev = f.config.haloScale;
        f.config.haloScale = local;
        f.syncFromConfig();
        out.push({ cls, before: +before.toFixed(5), after: +scaleOf(f.haloInst).toFixed(5) });
        touched.push({ f, had, prev });
      }
      const s = (window.ledStrandFixtures || [])[0];
      if (s && s.haloInst) {
        const before = scaleOf(s.haloInst);
        const had = Object.prototype.hasOwnProperty.call(s.config, 'haloScale');
        const prev = s.config.haloScale;
        s.config.haloScale = local;
        s.applyVisualSize();
        out.push({ cls: 'strand', before: +before.toFixed(5), after: +scaleOf(s.haloInst).toFixed(5) });
        touched.push({ f: s, had, prev, strand: true });
      }
      // Restore EXACTLY — including deleting a key that was never there.
      for (const t of touched) {
        if (t.had) t.f.config.haloScale = t.prev;
        else delete t.f.config.haloScale;
        if (t.strand) t.f.applyVisualSize(); else t.f.syncFromConfig();
      }
      return out;
    }, 2);
    for (const r of localSweep) {
      const ok = r.after > r.before;
      console.log(`  ${r.cls.padEnd(22)} local 1 → 2: ${r.before} → ${r.after}  ${ok ? 'MOVES' : '**DEAD**'}`);
    }

    console.log('\n── VERDICT: which classes MOVE under Global Halo Size 0.1 → 5 ──');
    for (const r of base) {
      const lo = sweeps[0.1].find((x) => x.cls === r.cls);
      const hi = sweeps[5].find((x) => x.cls === r.cls);
      if (!lo || !hi) continue;
      const moved = lo.halo !== hi.halo;
      const visible = hi.ratio !== null && hi.ratio > 1.05;
      console.log(`  ${r.cls.padEnd(22)} ${moved ? 'MOVES' : '**DEAD**'} ` +
        `(${lo.halo} → ${hi.halo})  outside its bulb at max: ${visible ? 'yes' : '**NO**'}`);
    }

    console.log('\n── guards ──');
    console.log(`  sACN OUT enables: ${sacnOutLines.length} (must be 0)`);
    console.log(`  save-server requests: ${saveServerHits.length} → ${JSON.stringify(saveServerHits)}`);
    const restored = await page.evaluate(() => import(`${location.origin}/simulation/src/core/state.js`)
      .then((st) => ({ halo: st.params.globalHaloScale, ledHalo: st.params.ledHaloSize })));
    console.log(`  params restored: ${JSON.stringify(restored)} (saved ${JSON.stringify(saved)})`);
    const nonGet = saveServerHits.filter((h) => !h.startsWith('GET '));
    if (sacnOutLines.length || nonGet.length) {
      throw new Error(`GUARD VIOLATION — sACN out: ${sacnOutLines.length}, save writes: ${nonGet.length}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
