/**
 * test_speed_run.js
 * Hardware-In-the-Loop equivalent API test.
 * Exercises the MarsinEngine REST/WS control interfaces.
 */
import http from 'http';

const ENGINE_HOST = 'http://localhost:6968';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname: 'localhost',
      port: 6968,
      path,
      headers: {}
    };

    let payload = null;
    if (body) {
      payload = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let speed = 2.0;
  let reverse = 1.0;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--speed' && args[i + 1]) speed = parseFloat(args[++i]);
    if (args[i] === '--reverse' && args[i + 1]) reverse = parseFloat(args[++i]);
  }
  return { speed, reverse };
}

async function run() {
  const config = parseArgs();
  console.log('--- MarsinEngine Automated API Test ---');
  console.log(`[Config] Target Speed: ${config.speed} | Target Reverse: ${config.reverse}`);
  
  // 1. Check if engine is alive
  console.log('1. Polling for Engine...');
  try {
    await request('GET', '/patterns');
  } catch(e) {
    console.error('❌ Engine is not running on port 6968. Please start `node engine.js` first.');
    process.exit(1);
  }
  console.log('   ✅ Engine is Online.');

  // 2. Hot-swap to test_params
  console.log('2. Hot-swapping pattern to "test_params"...');
  const swapRes = await request('PUT', '/pattern', { pattern: 'test_params' });
  if (swapRes.status !== 200) {
    console.error('❌ Failed to swap pattern:', swapRes.data);
    process.exit(1);
  }
  console.log('   ✅ Pattern swapped successfully.');

  await sleep(1000); // Give WASM time to initialize exports

  // 3. Obtain WASM Exports Map to discover true IDs
  console.log('3. Requesting parameter ID mapping from WASM Exports...');
  const exportsRes = await request('GET', '/exports');
  const exportsList = JSON.parse(exportsRes.data);
  
  const speedObj = exportsList.find(e => e.name.toLowerCase().includes('speed'));
  const reverseObj = exportsList.find(e => e.name.toLowerCase().includes('reverse'));
  const flashObj = exportsList.find(e => e.name.toLowerCase().includes('flash'));
  const colorObj = exportsList.find(e => e.kind === 'hsvPicker' || e.name.toLowerCase().includes('color'));

  console.log(`   ✅ Acquired Mapping -> Speed: ID ${speedObj ? speedObj.id : 'N/A'}, Reverse: ID ${reverseObj ? reverseObj.id : 'N/A'}, Color: ID ${colorObj ? colorObj.id : 'N/A'}`);

  console.log(`4. Injecting control overrides (Speed: ${config.speed}, Reverse: ${config.reverse}, Color: Blue)...`);
  
  if (speedObj !== undefined) {
    await request('POST', '/control', { id: speedObj.id, v0: config.speed });
  }
  if (reverseObj !== undefined) {
    await request('POST', '/control', { id: reverseObj.id, v0: config.reverse });
  }
  if (colorObj !== undefined) {
    // Blue is ~0.66 in HSV domain [0, 1]
    await request('POST', '/control', { id: colorObj.id, v0: 0.66, v1: 1.0, v2: 1.0 });
  }

  // Ensure flash is OFF to prevent the pattern from looking "frozen" solid.
  if (flashObj !== undefined) {
    await request('POST', '/control', { id: flashObj.id, v0: 0.0 });
  }

  console.log('   ✅ Modifications transmitted.');
  console.log('\n🚢 Check your simulation render out! The pattern should reflect your tuned parameters.');
  console.log('✅ Test Completed Successfully.');
}

run().catch(err => {
  console.error('❌ Fatal Test Error:', err);
  process.exit(1);
});
