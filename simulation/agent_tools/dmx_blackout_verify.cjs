/**
 * dmx_blackout_verify.cjs — live proof that a DMX group master (⏻ Group On /
 * Brightness) blacks out / scales its fixtures on EVERY path:
 *   • the merged sACN universe buffer (already gated by
 *     applyFixtureOutputOverrides — the sACN OUTPUT + the DMX runtime bulbs),
 *   • the GLOBAL V2 instanced-dot flush (_pixelInstancedMesh.instanceColor) and
 *     the 2D Pixel Map decode (entryDisplayRgb) — both of which read the RAW
 *     _batchRenderList entry color, which the last-layer DMX entry gate
 *     (_applyDmxOutputGate) must scale/zero.
 *
 * The DMX twin of led_blackout_verify.cjs (report 20260724_27).
 *
 * Renderer-only (see_the_world): launches its OWN Chromium against the
 * ALREADY-RUNNING stack on :6969; NEVER starts/stops a server. autosave is
 * stubbed so nothing writes the operator's scene, the group override under test
 * is restored before exit, and the browser is closed at the end.
 *
 * Both patch regimes matter and are BOTH verified by this tool:
 *   • DEFAULT — the titanic show scene is fully UNPATCHED (patches.yaml has zero
 *     non-zero universes), so applyFixtureOutputOverrides is a NO-OP there and
 *     EVERY path (dots, 2D map, and the fixture bulbs, which are direct-painted
 *     by entry.apply while unpatched) depends on the entry gate.
 *   • `--patch` — patches the group under test onto scratch universes IN THE
 *     PROBE BROWSER'S MEMORY ONLY (autosave stubbed, sACN-bridge notify
 *     neutralised, nothing written to disk) so the buffer-gated regime — where
 *     applyFixtureOutputOverrides zeroes the universe bytes and applyDmxFrame
 *     repaints the bulbs from them — is proven in the SAME scene.
 *
 * Usage:
 *   node dmx_blackout_verify.cjs [--scene titanic] [--group "Name"] [--dim 40]
 *                                [--patch] [--keep-alive]
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ORIGIN = 'http://127.0.0.1:6969';
const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};
const SCENE = argOf('--scene') || 'titanic';
const SIM = `${ORIGIN}/simulation/?scene=${SCENE}&profile=full&renderer=webgl`;
const OUT = path.join(__dirname, '..', '..', '.agent_renders');
const KEEP = process.argv.includes('--keep-alive');
const FORCE_GROUP = argOf('--group');
const DIM_PCT = Number(argOf('--dim') || 40);
const DO_PATCH = process.argv.includes('--patch');
// Scratch universes for --patch: high enough to miss the rig's real routes.
const PATCH_UNIVERSE_BASE = 60;
const VP = { width: 1280, height: 720 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => Math.floor(Date.now() / 1000);

async function shot(page, name) {
  const p = path.join(OUT, `dmxblk_${stamp()}_${SCENE}_${name}.png`);
  await page.screenshot({ path: p });
  console.log(`  📸 ${path.basename(p)}`);
  return p;
}

async function launch() {
  return puppeteer.launch({
    headless: false, defaultViewport: VP,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-gpu-blocklist',
      '--enable-gpu', '--enable-webgl', '--enable-webgl2', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', `--window-size=${VP.width + 40},${VP.height + 120}`],
  });
}

async function waitReady(page) {
  await page.waitForFunction(() => {
    const o = document.getElementById('loading-overlay');
    if (o) {
      const s = getComputedStyle(o);
      if (!(s.display === 'none' || s.opacity === '0' || s.visibility === 'hidden')) return false;
    }
    return Array.isArray(window.parFixtures) && window.parFixtures.length > 0 && !!window.dmxRouter;
  }, { timeout: 90000 });
  await sleep(3000);
}

/**
 * Read a full-scene DMX snapshot for one group from the LIVE app (in-page):
 *  - maxEntry   : largest RGBWAU magnitude across the group's dmx entries (feeds
 *                 the global dot flush + the 2D map).
 *  - max2dDecode: the 2D Pixel Map's OWN per-pixel decode (entryDisplayRgb).
 *  - maxDot     : largest instanceColor component on the GLOBAL instanced-dot
 *                 mesh at this group's entry indices (what the 3D render shows).
 *  - maxBulb    : largest per-fixture bulb instanceColor (the DMX runtime mesh,
 *                 painted from the gated universe buffer via applyDmxFrame).
 *  - maxByte    : largest byte in the group's DMX footprints on the merged
 *                 universe buffers (the sACN OUTPUT).
 *  - rgb        : per-entry [r,g,b] samples (first N) for exact ratio math.
 */
async function snapshot(page, group, sampleN) {
  return page.evaluate((group, sampleN) => {
    const p = window.__params;
    const list = window.__dmxBatchTap || null;
    const patchesActive = !!window._patchesActive;
    const showUnpatchedRed = !!(p && p.showUnpatchedRed);
    const dots = window.__globalDotMesh || null;

    let maxEntry = 0, entryCount = 0, max2dDecode = 0, maxDot = 0;
    const rgb = [];
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e || e.type !== 'dmx') continue;
        if ((e.group || '') !== group) continue;
        entryCount++;
        const m = (e.r || 0) + (e.g || 0) + (e.b || 0) + (e.w || 0) + (e.a || 0) + (e.u || 0);
        if (m > maxEntry) maxEntry = m;
        if (window.__entryDisplayRgb) {
          const [dr, dg, db] = window.__entryDisplayRgb(e, patchesActive, showUnpatchedRed);
          const dm = dr + dg + db;
          if (dm > max2dDecode) max2dDecode = dm;
        }
        if (dots && dots.instanceColor && i < dots.count) {
          const a = dots.instanceColor.array;
          for (let k = 0; k < 3; k++) if (a[i * 3 + k] > maxDot) maxDot = a[i * 3 + k];
        }
        if (rgb.length < sampleN) rgb.push([+(e.r || 0).toFixed(6), +(e.g || 0).toFixed(6), +(e.b || 0).toFixed(6)]);
      }
    }

    // Per-fixture bulb mesh + universe bytes for the group's members.
    let maxBulb = 0, maxByte = 0, maxIntensityByte = 0, memberCount = 0, patchedMembers = 0;
    const lists = [window.dmxSceneFixtures, window.parFixtures];
    const seen = new Set();
    for (const fl of lists) {
      if (!fl) continue;
      for (const f of fl) {
        if (!f || !f.config || seen.has(f.config)) continue;
        if ((f.config.group || '') !== group) continue;
        seen.add(f.config);
        memberCount++;
        const inst = f.bulbInst;
        if (inst && inst.instanceColor) {
          const a = inst.instanceColor.array;
          for (let k = 0; k < a.length; k++) if (a[k] > maxBulb) maxBulb = a[k];
        }
        const u = Math.floor(Number(f.patchDef?.universe ?? f.config.dmxUniverse));
        const addr = Math.floor(Number(f.patchDef?.addr ?? f.config.dmxAddress));
        const fp = (f.fixtureDef && f.fixtureDef.footprint) || 0;
        if (Number.isFinite(u) && u >= 1 && Number.isFinite(addr) && addr >= 1 && fp > 0 && window.dmxRouter) {
          patchedMembers++;
          const frame = window.dmxRouter.getFullFrame(u);
          if (frame) {
            const end = Math.min(frame.length, addr - 1 + fp);
            for (let k = addr - 1; k < end; k++) if (frame[k] > maxByte) maxByte = frame[k];
            // Intensity-bearing bytes ONLY — the roles the Brightness master is
            // allowed to scale. maxByte also sees the master-dimmer byte that
            // mapPixelsToSacn pins at 255, which would mask the scaling.
            const roles = window.__intensityRoles;
            for (const pm of ((f.fixtureDef && f.fixtureDef.pixels) || [])) {
              for (const role in (pm.channels || {})) {
                if (!roles.has(role)) continue;
                const idx = addr - 1 + (pm.channels[role] - 1);
                if (idx >= 0 && idx < frame.length && frame[idx] > maxIntensityByte) {
                  maxIntensityByte = frame[idx];
                }
              }
            }
          }
        }
      }
    }

    return {
      maxEntry: +maxEntry.toFixed(6), entryCount, max2dDecode: +max2dDecode.toFixed(6),
      maxDot: +maxDot.toFixed(6), maxBulb: +maxBulb.toFixed(6), maxByte, maxIntensityByte,
      memberCount, patchedMembers, patchesActive,
      override: JSON.parse(JSON.stringify((p.groupOverrides || {})[group] || null)),
      rgb,
    };
  }, group, sampleN);
}

/**
 * Largest ABSOLUTE per-channel deviation of `obs` from `base * want`.
 * Absolute (not ratio) because a channel sitting near 0 makes a ratio explode
 * while the visible error is nil. `want = 1` measures the sampling noise floor
 * (the gradient is frozen, not stopped, so two samples can differ by a LUT step).
 */
function scaleError(base, obs, want) {
  let worst = 0, compared = 0;
  const n = Math.min(base.length, obs.length);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      compared++;
      const err = Math.abs(obs[i][k] - base[i][k] * want);
      if (err > worst) worst = err;
    }
  }
  return { worst: +worst.toFixed(6), compared };
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await launch();
  const page = (await browser.pages())[0];
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  console.log(`Loading ${SIM}`);
  await page.goto(SIM, { waitUntil: 'networkidle2', timeout: 60000 });
  await waitReady(page);

  // Reach the REAL params singleton + subscribe a batch tap (onPixelFrame hands
  // over the live _batchRenderList each frame — the exact list the 2D map and the
  // global dot flush read). Stub autosave so NOTHING writes the scene. Freeze the
  // gradient so the RAW paint source is identical frame to frame, making the
  // brightness ratio math exact.
  await page.evaluate(async (origin) => {
    const state = await import(`${origin}/simulation/src/core/state.js`);
    const animate = await import(`${origin}/simulation/src/core/animate.js`);
    const blend = await import(`${origin}/simulation/src/core/rgbwau_blend.js`);
    const editor = await import(`${origin}/simulation/src/gui/pattern_editor.js`);
    const ov = await import(`${origin}/simulation/src/dmx/dmx_output_overrides.js`);
    window.__intensityRoles = ov.OUTPUT_INTENSITY_CHANNELS;
    window.__entryDisplayRgb = blend.entryDisplayRgb;
    window.__params = state.params;
    // Camera handle so the probe can prefer a group that is actually ON SCREEN —
    // a screenshot of an off-camera group proves nothing to a human reviewer.
    // Hand-rolled world→NDC so the probe needs no THREE handle in page scope
    // (animate.js's `THREE` is not a window global).
    window.__onScreen = (x, y, z) => {
      const cam = state.camera;
      if (!cam) return false;
      cam.updateMatrixWorld();
      const mul = (m, v) => {
        const e = m.elements, out = [0, 0, 0, 0];
        for (let r = 0; r < 4; r++) {
          out[r] = e[r] * v[0] + e[4 + r] * v[1] + e[8 + r] * v[2] + e[12 + r] * v[3];
        }
        return out;
      };
      const view = mul(cam.matrixWorldInverse, [x, y, z, 1]);
      const clip = mul(cam.projectionMatrix, view);
      if (!(clip[3] > 0)) return false;                       // behind the camera
      const nx = clip[0] / clip[3], ny = clip[1] / clip[3], nz = clip[2] / clip[3];
      return nz > -1 && nz < 1 && Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
    };
    window.debounceAutoSave = () => {};
    // Neutralise the sACN-bridge notify path. Any `setScene` sent to the shared
    // bridge on :6971 is a last-writer stomp on the operator's live routes
    // (memory: sACN route ownership). Since slice S4 the auto-subscribe path no
    // longer notifies at all (it only arms the stubbed debounce above), but a
    // null socket keeps ANY other notify a console.warn inside THIS throwaway
    // browser and nothing else. The shim keeps enable/disable callable
    // (onLightingChange calls disable()).
    window.sacnInput = { _ws: null, enable() {}, disable() {} };
    // Deterministic paint source: gradient, engine OFF (a live pattern engine
    // repaints every entry with animated color and destroys the ratio math),
    // wave effectively frozen. onLightingChange is the ONE switch that syncs
    // params → state.js (lightingEnabled / lightingMode / engineEnabled).
    state.params.lightingEnabled = true;
    state.params.lightingMode = 'gradient';
    state.params.waveSpeed = 1e-7;   // effectively frozen (never exactly 0 — falsy)
    editor.onLightingChange();
    window.__dmxBatchTap = null;
    animate.onPixelFrame((list) => {
      window.__dmxBatchTap = list;
      // Locate the GLOBAL instanced-dot mesh by identity: the only InstancedMesh
      // in the scene whose count equals the batch list length. Re-locate whenever
      // the cached one is detached (parent === null) — _rebuildBatchCache
      // scene.remove()s + dispose()s the old mesh and builds a NEW one with the
      // SAME count, so a count-only check silently samples a dead buffer.
      const stale = window.__globalDotMesh &&
        (window.__globalDotMesh.parent === null || window.__globalDotMesh.count !== list.length);
      if (list && (!window.__globalDotMesh || stale)) {
        let found = null;
        state.scene.traverse((o) => {
          if (!found && o.isInstancedMesh && o.count === list.length) found = o;
        });
        window.__globalDotMesh = found;
      }
    });
  }, ORIGIN);
  await sleep(1500);

  // Pick the DMX group under test: the one with the MOST dmx entries (biggest
  // visible surface), unless --group forces one. Patched and unpatched groups
  // are BOTH legitimate targets — the show scene is entirely unpatched, and the
  // group master must black it out all the same.
  const pick = await page.evaluate((forced) => {
    const list = window.__dmxBatchTap || [];
    const counts = new Map();
    for (const e of list) {
      if (!e || e.type !== 'dmx') continue;
      const g = e.group || '';
      const c = counts.get(g) || { all: 0, patched: 0, onScreen: 0 };
      c.all++;
      if (e.patch && e.patch.universe > 0) c.patched++;
      if (window.__onScreen(e.wx, e.wy, e.wz)) c.onScreen++;
      counts.set(g, c);
    }
    // Rank by ON-SCREEN pixels first: the group under test must be visible in
    // the capture, or the before/after screenshots show nothing but the
    // light-pool reallocation that freeing a group's spotlights causes.
    const ranked = [...counts.entries()]
      .sort((a, b) => (b[1].onScreen - a[1].onScreen) || (b[1].all - a[1].all));
    return {
      chosen: forced || (ranked[0] ? ranked[0][0] : null),
      ranked: ranked.slice(0, 8).map(([g, c]) => `${g}: ${c.all} px (${c.onScreen} on screen, ${c.patched} patched)`),
      dotMesh: window.__globalDotMesh ? window.__globalDotMesh.count : null,
      total: list.length,
      patchesActive: !!window._patchesActive,
    };
  }, FORCE_GROUP);
  console.log(`\nscene=${SCENE}  batch entries: ${pick.total}  global dot mesh count: ${pick.dotMesh}  ` +
    `_patchesActive=${pick.patchesActive}`);
  console.log('dmx entries per group (top):');
  pick.ranked.forEach((r) => console.log(`  • ${r}`));
  const group = pick.chosen;
  if (!group) { console.error('No DMX group in scene — cannot verify.'); if (!KEEP) await browser.close(); process.exit(1); }
  if (pick.dotMesh === null) { console.error('Global instanced-dot mesh not found — cannot verify the 3D path.'); if (!KEEP) await browser.close(); process.exit(1); }
  console.log(`DMX group under test: ${JSON.stringify(group)}`);

  // ── Optional: put the group into the PATCHED regime (probe memory only) ──
  if (DO_PATCH) {
    const res = await page.evaluate((g, uBase) => {
      const p = window.__params;
      const configs = (p.dmxFixtures && p.dmxFixtures.length > 0 ? p.dmxFixtures : p.parLights) || [];
      const byConfig = new Map();
      for (const fl of [window.dmxSceneFixtures, window.parFixtures]) {
        if (!fl) continue;
        for (const f of fl) if (f && f.config) byConfig.set(f.config, f);
      }
      let n = 0;
      configs.forEach((c) => {
        if (!c || (c.group || '') !== g) return;
        // One scratch universe per fixture — no footprint arithmetic, no overlap.
        c.dmxUniverse = uBase + n;
        c.dmxAddress = 1;
        const f = byConfig.get(c);
        if (f) f.patchDef = { universe: c.dmxUniverse, addr: c.dmxAddress };
        n++;
      });
      window.PatchManager.recompute();
      window.invalidateMarsinBatchCache('dmx_blackout_verify --patch');
      return { patched: n, patchesActive: !!window._patchesActive };
    }, group, PATCH_UNIVERSE_BASE);
    console.log(`--patch: ${res.patched} fixture(s) patched to scratch universes ` +
      `${PATCH_UNIVERSE_BASE}..${PATCH_UNIVERSE_BASE + res.patched - 1} ` +
      `(probe memory only) — _patchesActive=${res.patchesActive}`);
    await sleep(2000);
  }

  const SAMPLES = 24;
  const setOv = (enabled, brightness) => page.evaluate((g, en, br) => {
    const p = window.__params;
    if (!p.groupOverrides) p.groupOverrides = {};
    p.groupOverrides[g] = { ...(p.groupOverrides[g] || {}), enabled: en, brightness: br };
  }, group, enabled, brightness);

  // Remember the operator's real override so we can put it back.
  const original = await page.evaluate((g) => {
    const o = (window.__params.groupOverrides || {})[g];
    return o ? JSON.parse(JSON.stringify(o)) : null;
  }, group);

  console.log(`operator's stored override for this group: ${JSON.stringify(original)}`);

  // ── Baseline: group ON @ 100 % ───────────────────────────────────────────
  await setOv(true, 100);
  await sleep(1200);
  const on = await snapshot(page, group, SAMPLES);
  console.log('\n[ON  ] group on @100% :', JSON.stringify({ ...on, rgb: undefined }));
  await shot(page, 'group_on');

  // Second identical baseline, same wall-clock gap as the tests below: its
  // deviation from the first IS the sampling noise floor (the frozen gradient
  // can still creep one LUT step). Everything below is judged against it.
  await sleep(1200);
  const on2 = await snapshot(page, group, SAMPLES);
  const floor = scaleError(on.rgb, on2.rgb, 1);
  console.log(`[ON2 ] noise floor    : worst |Δchannel| = ${floor.worst} over ${floor.compared} channels`);

  // ── (1) Group OFF ⇒ BLACK on every path ──────────────────────────────────
  await setOv(false, 100);
  await sleep(1200);
  const off = await snapshot(page, group, SAMPLES);
  console.log('[OFF ] group OFF      :', JSON.stringify({ ...off, rgb: undefined }));
  await shot(page, 'group_off');

  // ── (2) Group dimmed ⇒ EXACT linear scale on every path ──────────────────
  await setOv(true, DIM_PCT);
  await sleep(1200);
  const dim = await snapshot(page, group, SAMPLES);
  console.log(`[DIM ] group @${DIM_PCT}%    :`, JSON.stringify({ ...dim, rgb: undefined }));
  await shot(page, 'group_dim');

  // Restore the operator's override (probe-local; autosave is stubbed anyway).
  await page.evaluate((g, orig) => {
    const p = window.__params;
    if (orig) p.groupOverrides[g] = orig; else delete p.groupOverrides[g];
  }, group, original);
  await sleep(600);

  // ── Verdict ──────────────────────────────────────────────────────────────
  const onLit = on.maxEntry > 0 && on.max2dDecode > 0 && on.maxDot > 0;
  // The universe byte check only means something when the group is actually
  // patched — an unpatched group has no footprint on any universe (the show
  // scene). Never let a vacuous 0 masquerade as proof.
  const byteBlack = off.patchedMembers === 0 || off.maxByte === 0;
  const offBlack = off.maxEntry === 0 && off.max2dDecode === 0 && off.maxDot === 0
    && off.maxBulb === 0 && byteBlack;
  const want = DIM_PCT / 100;
  const err = scaleError(on.rgb, dim.rgb, want);
  const tol = Math.max(1e-6, floor.worst * 2);
  const dimExact = err.compared > 0 && err.worst <= tol;

  console.log('\n=== SUMMARY ===');
  console.log(`group under test                  : ${JSON.stringify(group)} ` +
    `(${on.entryCount} dmx entries, ${on.memberCount} fixtures, ` +
    `${on.patchedMembers} patched, patchesActive=${on.patchesActive})`);
  console.log(`ON baseline lit (entry/2D/dot >0) : ${onLit}  ` +
    `entry=${on.maxEntry} 2d=${on.max2dDecode} dot=${on.maxDot} bulb=${on.maxBulb} ` +
    `byte=${on.maxByte} intensityByte=${on.maxIntensityByte}`);
  console.log(`GROUP OFF ⇒ BLACK on every path   : ${offBlack}`);
  console.log(`   entry=${off.maxEntry} 2d=${off.max2dDecode} dot=${off.maxDot} bulb=${off.maxBulb} ` +
    `byte=${off.maxByte} intensityByte=${off.maxIntensityByte}`);
  console.log(`GROUP @${DIM_PCT}% ⇒ exact ×${want} scale   : ${dimExact} ` +
    `(worst |Δchannel| ${err.worst} vs tolerance ${+tol.toFixed(6)} — 2× the ` +
    `measured noise floor ${floor.worst} — over ${err.compared} channels)`);
  console.log(`   entry=${dim.maxEntry} 2d=${dim.max2dDecode} dot=${dim.maxDot} bulb=${dim.maxBulb} ` +
    `byte=${dim.maxByte} intensityByte=${dim.maxIntensityByte}`);
  if (on.patchedMembers > 0) {
    // Single application on the wire: the entry gate runs AFTER mapPixelsToSacn +
    // applyFixtureOutputOverrides, so a dimmed group must scale the universe
    // intensity bytes exactly ONCE (×want), never ×want².
    const wireOnce = on.maxIntensityByte * want;
    const wireTwice = on.maxIntensityByte * want * want;
    console.log(`WIRE not double-dimmed              : ` +
      `${Math.abs(dim.maxIntensityByte - wireOnce) <= 1} ` +
      `(intensity byte ${on.maxIntensityByte} → ${dim.maxIntensityByte}; once=${wireOnce.toFixed(1)}, ` +
      `twice=${wireTwice.toFixed(1)})`);
  }
  const noise = errors.filter((e) => /animate|dmx_output_overrides|exporter|gui_builder|TypeError|is not a function|undefined is not/i.test(e));
  console.log('console errors (filtered):', noise.length);
  noise.slice(0, 15).forEach((e) => console.log('  •', e.slice(0, 160)));
  console.log(`\nRESULT: ${onLit && offBlack && dimExact ? 'PASS ✅' : 'FAIL ❌'}`);

  if (!KEEP) await browser.close();
  else console.log('\n(keep-alive — close manually)');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
