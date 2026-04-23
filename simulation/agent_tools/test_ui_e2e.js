const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Only log Marsin-related messages
    page.on('console', msg => {
        const t = msg.text();
        if (t.includes('Marsin') || t.includes('fetch')) {
            console.log('[BROWSER]', t);
        }
    });
    page.on('requestfailed', req => {
        console.log('[FAILED]', req.url(), req.failure().errorText);
    });
    page.on('request', req => {
        if (req.url().includes('8081')) {
            console.log('[NET REQ]', req.method(), req.url(), 'body:', req.postData());
        }
    });
    page.on('response', res => {
        if (res.url().includes('8081')) {
            console.log('[NET RES]', res.status(), res.url());
        }
    });

    console.log("Step 1: Navigate");
    await page.goto('http://localhost', { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log("Step 2: Wait 4s for lil-gui");
    await new Promise(r => setTimeout(r, 4000));

    const ctrlCount = await page.evaluate(() => {
        const g = document.querySelector('.lil-gui');
        return g ? g.querySelectorAll('.controller').length : -1;
    });
    console.log("Step 3: Controllers found:", ctrlCount);

    // Click the checkbox via Puppeteer selector
    console.log("Step 4: Click checkbox");
    const checkbox = await page.$('input[type="checkbox"]');
    if (checkbox) {
        const box = await checkbox.boundingBox();
        if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            console.log("  Clicked at", box.x + box.width / 2, box.y + box.height / 2);
        } else {
            console.log("  ERROR: checkbox has no bounding box (hidden?)");
        }
    } else {
        console.log("  ERROR: no checkbox found");
    }

    console.log("Step 5: Wait 3s for network");
    await new Promise(r => setTimeout(r, 3000));

    // Manual fetch as control test
    console.log("Step 6: Manual fetch from browser");
    const manualResult = await page.evaluate(async () => {
        try {
            const res = await fetch('http://127.0.0.1:8081/', {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ power: false, intensity: 77.0, test: 'manual' })
            });
            return { ok: res.ok, status: res.status, body: await res.text() };
        } catch (e) {
            return { error: e.message };
        }
    });
    console.log("  Result:", JSON.stringify(manualResult));

    await new Promise(r => setTimeout(r, 1000));
    await browser.close();
    console.log("DONE");
})();
