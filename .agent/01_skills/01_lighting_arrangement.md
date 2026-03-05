---
name: "Lighting Arrangement (UI Automation)"
description: "Standard operating procedure for arranging and generating Par lights in the BM26 Titanic simulation."
---

# Lighting Arrangement Skill

This document defines the strict procedure for arranging and positioning dynamically generated par lights in the BM26 Titanic simulation.

## Core Principle: UI-Driven Generation
**NEVER manually edit `scene_config.yaml` to specify exact mathematical coordinates for par lights.**
The simulation's Lil-GUI interface is the source of truth for constructing light groups via "Traces". Traces compute the complicated math (circle arcing, line lerping, aim targeting) and push perfect arrays of fixtures to the scene.

To arrange lights, you must **write a Puppeteer script (`ui_controller.js`)** that connects to the live browser session and programmatically acts as the user clicking the UI.

## Naming Conventions
The user requires **clean names** for generators and groups. Do not use underscores (`left_front_wall`).
- **Trace Name:** Descriptive for the GUI (e.g., `Left Front Wall`)
- **Group Name:** The exact target group name for the lights (e.g., `Left Front Wall`)
- **Light Name:** Handled automatically by the UI (e.g., `Left Front Wall 1`, `Left Front Wall 2`)

*Example Trace Configuration:*
```javascript
{
  name: 'Left Front Deck',
  shape: 'line',
  startX: 13.95, startY: 11.5, startZ: -15.20,
  endX: 30.96, endY: 1.8, endZ: -15.82,
  spacing: 1.0,
  aimMode: 'direction', aimX: 0, aimY: -1, aimZ: 1,
  lightColor: '#ffaa44', lightIntensity: 22.0, lightAngle: 50.0,
  groupName: 'Left Front Deck',
  generated: false
}
```

## The Iterative Workflow
When adjusting lights to fit the complex geometry of the Titanic hull:

1. **Ensure browser runs:** The simulation must be live via `node agent_render.js --open`.
2. **Inject Traces:** Run the Puppeteer script (template below) to forcefully clear out stale traces/lights and inject the new mathematical coordinates.
3. **Capture & Review:** 
   - Run `node agent_render.js --current` to capture the immediate live result.
   - Run `node agent_render.js` to capture all specific views (front, aerial, dramatic, night-walk).
   - Visually review the renders.
4. **Refine & Repeat:** If the lights miss the hull by a few feet, go back to the Puppeteer script, tweak the `startX/endX/startY/endY`, and repeat step 2.

## Puppeteer Automation Template
Use the following boilerplate `ui_controller.js` to safely interact with the `window.params` object in the live simulation and trigger the lil-gui generator loops.

```javascript
const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const endpointFile = '.puppeteer-endpoint';
  if (!fs.existsSync(endpointFile)) process.exit(1);

  const endpoint = fs.readFileSync(endpointFile, 'utf8').trim();
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('localhost:8080/simulation'));

  page.on('console', msg => console.log('BROWSER:', msg.text()));

  await page.evaluate(() => {
    if (!window.params) return;
    
    // 1. CLEAR OLD GROUPS
    const targetGroups = ['Left Front Deck', 'Left Front Wall'];
    window.params.traces = window.params.traces.filter(t => !targetGroups.includes(t.groupName));
    window.params.parLights = window.params.parLights.filter(l => !targetGroups.includes(l.group));

    if (window.deselectAllFixtures) window.deselectAllFixtures();
    if (window.transformControl) window.transformControl.detach();

    // 2. DEFINE NEW TRACES
    const newTraces = [ /* Insert trace configurations here */ ];
    window.params.traces.push(...newTraces);

    if (window._setGuiRebuilding) window._setGuiRebuilding(true);
    if (window.rebuildTraceObjects) window.rebuildTraceObjects();

    // 3. TRIGGER LIL-GUI GENERATION LOGIC
    const startIndex = window.params.traces.length - newTraces.length;
    for (let i = 0; i < newTraces.length; i++) {
        const traceIndex = startIndex + i;
        const trace = window.params.traces[traceIndex];
        
        const computeTracePoints = (tr) => { /* Circle or Line Math */ };
        const pts = computeTracePoints(trace);

        pts.forEach((pt, idx) => {
            window.params.parLights.push({
                group: trace.groupName,
                name: \`\${trace.groupName} \${idx + 1}\`,
                // apply config...
                _traceGenerated: true
            });
        });
        trace.generated = true;
    }

    if (window.rebuildParLights) window.rebuildParLights();
    if (window._setGuiRebuilding) window._setGuiRebuilding(false);
    if (window.exportConfig) window.exportConfig(); // Force save to scene_config.yaml
  });

  await new Promise(r => setTimeout(r, 2000));
  browser.disconnect();
})();
```
