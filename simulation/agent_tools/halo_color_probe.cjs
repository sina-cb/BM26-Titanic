/**
 * halo_color_probe.cjs — why is a patched par wearing a RED halo ring?
 *
 * Operator (2026-07-30, with a screenshot): "there's an extra halo around the
 * par lights that are red, but those pars are mapped patched and are good."
 * Black/dark par housings on the roof edge, each ringed in bright red.
 *
 * MEASURES, does not fix. For every UkingPar in the live scene it dumps the
 * colour of EVERY layer that can paint at that spot, so the red one is named
 * rather than guessed:
 *   • shell material      (the unpatched-red body tint)
 *   • bulb instanceColor  (the driven per-pixel colour)
 *   • halo instanceColor  (the rim — the suspect)
 *   • cone instanceColor + visibility
 *   • the scene-wide dot mesh instance for that pixel (20260725_74)
 *   • the fixture's patch, and the live DMX frame bytes it is being driven by
 *
 * LIVE-SESSION SAFETY — the same four guards as vintage_sizing_capture.cjs:
 *   GUARD 1 `__readonlyMode` forced true as an accessor before any page script.
 *   GUARD 2 the sACN-OUT bridge socket (:6972) refused at the constructor.
 *   GUARD 3 every save-server (:6970) request counted; loud failure on non-GET.
 *   GUARD 4 read-only — no param, config, GUI controller or matrix is written.
 *
 * Usage (servers must already be running — never start them from here):
 *   node halo_color_probe.cjs [--profile full]
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
        throw new Error('[halo_color_probe] blocked: sACN OUT bridge socket (:6972)');
      }
      return new NativeWebSocket(url, protocols);
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
  });
}

const SURVEY = () => import(`${location.origin}/simulation/src/core/state.js`).then((st) => {
  const hex = (arr, i) => {
    if (!arr) return null;
    const o = i * 3;
    const to = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return `#${to(arr[o])}${to(arr[o + 1])}${to(arr[o + 2])}`;
  };
  const instColor = (mesh, i) => (mesh && mesh.instanceColor ? hex(mesh.instanceColor.array, i) : null);
  const scaleOf = (mesh, i) => {
    if (!mesh) return null;
    const a = mesh.instanceMatrix.array;
    const o = i * 16;
    return +Math.hypot(a[o], a[o + 1], a[o + 2]).toFixed(4);
  };

  // The scene-wide dot mesh (20260725_74): the only InstancedMesh parented
  // directly to the scene.
  const dotMesh = st.scene.children.filter((o) => o.isInstancedMesh)[0] || null;

  const rows = [];
  (window.parFixtures || []).forEach((f, idx) => {
    if (!f || !f.config || f.config.fixtureType !== 'UkingPar') return;
    const u = Math.floor(Number(f.config.dmxUniverse));
    const a = Math.floor(Number(f.config.dmxAddress));
    const patched = Number.isFinite(u) && u >= 1 && Number.isFinite(a) && a >= 1;
    let frame = null;
    if (patched && window.dmxRouter && window.dmxRouter.getFullFrame) {
      const full = window.dmxRouter.getFullFrame(u);
      if (full) frame = Array.from(full.subarray(a - 1, a - 1 + 8));
    }
    rows.push({
      idx,
      name: f.config.name,
      group: f.config.group,
      patched,
      patch: patched ? `U${u}:${a}` : null,
      cfgColor: f.config.color,
      shell: f.shellMat ? `#${f.shellMat.color.getHexString()}` : null,
      bulb: instColor(f.bulbInst, 0),
      halo: instColor(f.haloInst, 0),
      cone: instColor(f.coneInst, 0),
      coneVis: f.coneInst ? f.coneInst.visible : null,
      pixelColor: `#${f.pixels[0].color.getHexString()}`,
      rBulb: scaleOf(f.bulbInst, 0),
      rHalo: scaleOf(f.haloInst, 0),
      frame,
    });
  });

  // Which dot-mesh instances belong to pars, and what colour are they?
  let dotSample = null;
  if (dotMesh && window.__probeDotIndexByName) dotSample = 'n/a';

  return {
    showUnpatchedRed: !!st.params.showUnpatchedRed,
    patchesActive: !!window._patchesActive,
    profile: st.params.lightingProfile,
    conesEnabled: st.params.conesEnabled,
    dotMeshCount: dotMesh ? dotMesh.count : null,
    dotSample,
    rows,
  };
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
    await sleep(8000);

    const s = await page.evaluate(SURVEY);
    console.log(`\n⚙️  profile=${s.profile} showUnpatchedRed=${s.showUnpatchedRed} ` +
      `_patchesActive=${s.patchesActive} conesEnabled=${s.conesEnabled} dots=${s.dotMeshCount}`);
    console.log(`🔦 UkingPar fixtures: ${s.rows.length} ` +
      `(patched ${s.rows.filter((r) => r.patched).length})`);

    const show = (r) => console.log(
      `  #${String(r.idx).padEnd(3)} ${String(r.name).slice(0, 22).padEnd(23)} ` +
      `${(r.patch || 'UNPATCHED').padEnd(10)} cfg=${String(r.cfgColor).padEnd(8)} ` +
      `shell=${String(r.shell).padEnd(8)} bulb=${String(r.bulb).padEnd(8)} ` +
      `halo=${String(r.halo).padEnd(8)} cone=${String(r.cone).padEnd(8)}/${r.coneVis} ` +
      `rB=${r.rBulb} rH=${r.rHalo}${r.frame ? ` frame=[${r.frame.join(',')}]` : ''}`);

    console.log('\n── PATCHED pars ──');
    s.rows.filter((r) => r.patched).slice(0, 14).forEach(show);
    console.log('\n── UNPATCHED pars ──');
    s.rows.filter((r) => !r.patched).slice(0, 8).forEach(show);

    console.log('\n── MISMATCH: bulb colour ≠ halo colour ──');
    const bad = s.rows.filter((r) => r.bulb !== r.halo);
    if (!bad.length) console.log('  none — every par\'s halo carries the same colour as its bulb');
    bad.slice(0, 14).forEach(show);

    console.log('\n── guards ──');
    console.log(`  sACN OUT enables: ${sacnOutLines.length} (must be 0)`);
    console.log(`  save-server requests: ${saveServerHits.length} → ${JSON.stringify(saveServerHits)}`);
    const nonGet = saveServerHits.filter((h) => !h.startsWith('GET '));
    if (sacnOutLines.length || nonGet.length) {
      throw new Error(`GUARD VIOLATION — sACN out: ${sacnOutLines.length}, save writes: ${nonGet.length}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
