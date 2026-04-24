import { promises as fs } from 'fs';

async function test() {
  const code = await fs.readFile('src/fixtures/dmx_fixture_runtime.js', 'utf8');
  console.log(code.substring(100, 300));
}
test();
