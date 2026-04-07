const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
  const wsEndpointUrl = fs.readFileSync(path.join(__dirname, '..', '.puppeteer-endpoint'), 'utf8').trim();
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpointUrl });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('localhost') || p.url().includes('127.0.0.1'));
  
  if (!page) { console.log('No simulation page found'); process.exit(1); }
  
  page.on('console', msg => {
      // ignore verbose threejs logs if we want, but let's print them
      console.log('LOG:', msg.text());
  });
  page.on('pageerror', err => console.log('ERROR:', err.toString()));
  page.on('requestfailed', request => {
    console.log('REQ FAILED:', request.url(), request.failure().errorText);
  });
  
  console.log('Reloading page to capture fresh logs...');
  await page.reload({ waitUntil: 'networkidle2' });
  
  // Wait a couple seconds for generation
  await new Promise(r => setTimeout(r, 2000));
  console.log('Done.');
  process.exit(0);
})();
