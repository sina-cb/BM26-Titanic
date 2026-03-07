const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: "new"
  });
  const page = await browser.newPage();
  
  page.on('pageerror', err => {
    console.log(`[PAGE_ERROR] ${err.message} \n ${err.stack}`);
  });

  try {
    console.log("Navigating...");
    await page.goto('http://localhost:8081/simulation/', { waitUntil: 'domcontentloaded', timeout: 300000 });
  } catch(e) {
    console.log("Error:", e.message);
  }
  
  await browser.close();
  process.exit(0);
})();
