const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  const endpointFile = path.join(__dirname, '..', '.puppeteer-endpoint');
  if (!fs.existsSync(endpointFile)) {
    console.error("No running simulation browser found. Run `node tools/agent-render.js --open` first.");
    process.exit(1);
  }

  const endpoint = fs.readFileSync(endpointFile, 'utf8').trim();
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('localhost:8080/simulation'));

  if (!page) {
    console.error("Simulation page not found in the connected browser.");
    process.exit(1);
  }

  page.on('console', msg => console.log('BROWSER:', msg.text()));

  console.log("Connected to simulation UI. Injecting automated trace generation...");

  await page.evaluate(() => {
    // 1. Clear any existing left-side groups to prevent duplicates
    if (!window.params) return;
    
    // Names of the groups we will create
    const targetGroups = [
      'Left Front Deck',
      'Left Front Wall',
      'Left Chimney',
      'Left Center Auditorium',
      'Left Back Wall',
      // Ensure we clear the old messy names too
      'left_front_deck',
      'left_front_wall',
      'left_chimney',
      'left_center_auditorium',
      'left_back_wall'
    ];

    console.log("Cleaning up old traces and lights...");
    // Remove existing traces with these names
    window.params.traces = window.params.traces.filter(t => !targetGroups.includes(t.groupName) && !targetGroups.includes(t.name));
    
    // Remove existing par lights associated with these groups
    window.params.parLights = window.params.parLights.filter(l => !targetGroups.includes(l.group));

    // Deselect all and detach transform controls just to be safe
    if (window.deselectAllFixtures) window.deselectAllFixtures();
    if (window.transformControl) window.transformControl.detach();

    // 2. Define the exact, mathematically mirrored port-side traces
    const portTraces = [
      {
        name: 'Left Front Deck Generator',
        shape: 'line',
        startX: 13.95, startY: 11.5, startZ: -15.20,
        endX: 30.96, endY: 1.8, endZ: -15.82,
        spacing: 1.0,
        aimMode: 'direction', aimX: 0, aimY: -1, aimZ: 1,
        lightColor: '#f07100', lightIntensity: 22.0, lightAngle: 50.0,
        groupName: 'Left Front Deck',
        generated: false
      },
      {
        name: 'Left Front Wall Generator',
        shape: 'line',
        startX: 31.56, startY: 0.3, startZ: -13.71,
        endX: 13.61, endY: 10.5, endZ: -12.96,
        spacing: 1.5,
        aimMode: 'direction', aimX: 0, aimY: 1, aimZ: 1,
        lightColor: '#00ccff', lightIntensity: 15.0, lightAngle: 45.0,
        groupName: 'Left Front Wall',
        generated: false
      },
      {
        name: 'Left Chimney Generator',
        shape: 'circle',
        radius: 2.2, arc: 360,
        spacing: 1.0,
        x: 23.61, y: 8.1, z: -7.78,
        rotX: -25, rotY: 0, rotZ: 25,
        aimMode: 'direction', aimX: 0, aimY: -0.5, aimZ: 1,
        lightColor: '#fba70b', lightIntensity: 30.0, lightAngle: 40.0,
        groupName: 'Left Chimney',
        generated: false
      },
      {
        name: 'Left Center Auditorium Generator',
        shape: 'line',
        startX: -13, startY: 11, startZ: -5.35,
        endX: -5, endY: 9, endZ: -8.27,
        spacing: 1.5,
        aimMode: 'direction', aimX: 1, aimY: -0.5, aimZ: 1,
        lightColor: '#ff0000', lightIntensity: 50.0, lightAngle: 60.0,
        groupName: 'Left Center Auditorium',
        generated: false
      },
      {
        name: 'Left Back Wall Generator',
        shape: 'line',
        startX: -29, startY: 2, startZ: 0.50,
        endX: -13, endY: 11, endZ: -5.35,
        spacing: 2.0,
        aimMode: 'direction', aimX: 0, aimY: -1, aimZ: 1,
        lightColor: '#ff0000', lightIntensity: 18.0, lightAngle: 30.0,
        groupName: 'Left Back Wall',
        generated: false
      }
    ];

    console.log("Injecting port-side traces...");
    // 3. Inject traces
    window.params.traces.push(...portTraces);

    // Stop GUI from reacting during bulk changes
    if (window._setGuiRebuilding) window._setGuiRebuilding(true);

    // Update the trace objects in 3D
    if (window.rebuildTraceObjects) window.rebuildTraceObjects();

    // Rebuild the Par Lights configuration from the traces
    // We mimic clicking the "GENERATE LIGHTS" button for each injected trace
    console.log("Generating lights from traces via UI logic...");
    
    // We must find the index of the newly added traces to pass to generateGroupFromTrace
    const startIndex = window.params.traces.length - portTraces.length;
    
    for (let i = 0; i < portTraces.length; i++) {
        const traceIndex = startIndex + i;
        
        // This is the internal function bound to the "🚀 GENERATE LIGHTS" button
        // It reads from params.traces[traceIndex] and pushes to params.parLights
        const trace = window.params.traces[traceIndex];
        
        // We need to re-implement generateGroupFromTrace logic slightly because it might not be exposed globally
        // Instead of calling the inner function, we just simulate the math it does to populate params.parLights
        
        const computeTracePoints = (tr) => {
            const pts = [];
            if (tr.shape === 'circle') {
                const r = tr.radius || 5;
                const arcRad = (tr.arc || 360) * Math.PI / 180;
                const circumference = r * arcRad;
                const count = Math.max(1, Math.round(circumference / (tr.spacing || 2)));
                for (let j = 0; j < count; j++) {
                    const angle = (j / count) * arcRad;
                    pts.push(new window.THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
                }
            } else {
                const start = new window.THREE.Vector3(tr.startX || 0, tr.startY || 5, tr.startZ || 0);
                const end = new window.THREE.Vector3(tr.endX || 10, tr.endY || 5, tr.endZ || 0);
                const totalLen = start.distanceTo(end);
                const count = Math.max(2, Math.round(totalLen / (tr.spacing || 2)));
                for (let j = 0; j < count; j++) {
                    const t = j / (count - 1);
                    pts.push(new window.THREE.Vector3().lerpVectors(start, end, t));
                }
            }
            return pts;
        };

        const pts = computeTracePoints(trace);
        const isLine = trace.shape === 'line';
        const grp = window.traceObjects[traceIndex]?.group;
        if (!isLine && grp) grp.updateMatrixWorld(true);
        const worldMatrix = (!isLine && grp) ? grp.matrixWorld : null;

        pts.forEach((pt, idx) => {
            const worldPt = worldMatrix ? pt.clone().applyMatrix4(worldMatrix) : pt.clone();
            
            let rotX = 0, rotY = 0, rotZ = 0;
            if (trace.aimMode === 'direction') {
                const firstPt = worldMatrix ? pts[0].clone().applyMatrix4(worldMatrix) : pts[0].clone();
                const aimTarget = new window.THREE.Vector3(trace.aimX || 0, trace.aimY || 0, trace.aimZ || 0);
                const dir = aimTarget.clone().sub(firstPt).normalize();
                const defaultDir = new window.THREE.Vector3(0, 0, -1);
                const quat = new window.THREE.Quaternion().setFromUnitVectors(defaultDir, dir);
                const euler = new window.THREE.Euler().setFromQuaternion(quat, 'YXZ');
                rotX = euler.x * 180 / Math.PI;
                rotY = euler.y * 180 / Math.PI;
                rotZ = euler.z * 180 / Math.PI;
            }

            window.params.parLights.push({
                group: trace.groupName,
                name: `${trace.groupName} ${idx + 1}`,
                color: trace.lightColor,
                intensity: trace.lightIntensity,
                angle: trace.lightAngle,
                penumbra: 0.5,
                x: worldPt.x, y: worldPt.y, z: worldPt.z,
                rotX, rotY, rotZ,
                _traceGenerated: true
            });
        });
        trace.generated = true;
    }

    // Attempt to invoke the global rebuild functions if they exist
    // to apply the data model changes to the 3D scene and HTML GUI
    if (window.rebuildParLights) window.rebuildParLights();
    
    // Resume GUI reactions
    if (window._setGuiRebuilding) window._setGuiRebuilding(false);

    // Force a save to disk via the save server
    if (window.exportConfig) window.exportConfig();
    
    return "SUCCESS: UI Automation generated " + portTraces.length + " trace groups.";
  });

  console.log("UI Automation complete. Waiting 2 seconds for save to flush...");
  await new Promise(r => setTimeout(r, 2000));
  
  // We disconnect so we don't hold the browser open via script
  browser.disconnect();
  console.log("Disconnected.");
})();
