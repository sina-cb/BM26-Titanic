const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log("[Profiler] Launching Headless Chromium...");
  const browser = await puppeteer.launch({ 
    headless: "new",
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-webgpu']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 2560, height: 1440 });

  page.on('console', msg => console.log(`[Browser]: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[Browser Crash]: ${err.toString()}`));

  console.log("[Profiler] Navigating to simulation...");
  await page.goto('http://localhost:6969/simulation/?scene=titanic', { waitUntil: 'networkidle2', timeout: 60000 });

  console.log("[Profiler] Waiting for model to load...");
  await page.waitForFunction(() => window._threeRefs && window._threeRefs.renderer, { timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000)); // Let the geometry buffer stabilize

  console.log("[Profiler] Triggering Edit Mode...");
  await page.evaluate(() => {
    // Manually force the params so the handler correctly acts on 'edit'
    if (window.params) window.params.lightingProfile = 'edit';
    if (window.handlers && window.handlers.lightingProfile) {
      window.handlers.lightingProfile('edit');
    }
  });

  await new Promise(r => setTimeout(r, 5000)); // Let the pipeline recompile

  console.log("[Profiler] Starting CPU/GPU Timeline Trace...");
  const tracePath = path.join(__dirname, '..', 'edit_mode_trace.json');
  await page.tracing.start({ path: tracePath, screenshots: false, categories: ['devtools.timeline', 'disabled-by-default-v8.cpu_profiler', 'disabled-by-default-devtools.timeline', 'v8', 'blink.user_timing'] });
  
  console.log("[Profiler] Simulating dense mouse movements (raycast stressing)...");
  for (let i = 0; i < 50; i++) {
    await page.mouse.move(500 + (i * 10), 500 + Math.sin(i) * 50);
    await new Promise(r => setTimeout(r, 50));
  }

  console.log("[Profiler] Stopping trace...");
  await page.tracing.stop();

  await browser.close();
  console.log(`[Profiler] Trace successfully written to: ${tracePath}`);
  console.log(`[Profiler] You can drop this file directly into chrome://tracing or the Chrome DevTools Performance tab to visualize the bottleneck.`);
})();
