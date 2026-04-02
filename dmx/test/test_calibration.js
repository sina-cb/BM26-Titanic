#!/usr/bin/env node
/**
 * test_calibration.js
 * ====================
 * Test bench calibration tool.
 *
 * Modes:
 *   --red_static       All fixtures solid red — good for verifying R channel wiring
 *   --green_static     Solid green
 *   --blue_static      Solid blue
 *   --white_static     Solid white (amber+white channels on wash, white on pars)
 *   (no flag)          Animated scrolling rainbow (40fps)
 *
 * Options:
 *   --fps <n>          Frame rate for animated modes (default: 40)
 *   --speed <n>        Rainbow scroll speed multiplier (default: 1.0)
 *
 * Usage:
 *   node test/test_calibration.js --red_static
 *   node test/test_calibration.js --fps 60
 *   Ctrl+C → blackout + exit
 */

'use strict';

const path = require('path');
const { DmxHandler, DmxRenderLoop } = require(path.join(__dirname, '..'));

// ── CLI ───────────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const FPS        = parseArgFloat(args, '--fps',   40);
const SPEED      = parseArgFloat(args, '--speed', 1.0);
const RED_STATIC   = args.includes('--red_static');
const GREEN_STATIC = args.includes('--green_static');
const BLUE_STATIC  = args.includes('--blue_static');
const WHITE_STATIC = args.includes('--white_static');
const STATIC_MODE  = RED_STATIC || GREEN_STATIC || BLUE_STATIC || WHITE_STATIC;

function parseArgFloat(args, flag, fallback) {
    const i = args.indexOf(flag);
    return (i !== -1 && args[i + 1]) ? parseFloat(args[i + 1]) : fallback;
}

// ── HSV → RGB ─────────────────────────────────────────────────────────────────
function hsv(h, s, v) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function deriveAmber(r, g, b) {
    return Math.min(255, Math.round(Math.max(0, r - b) * 0.8 + Math.max(0, r - g) * 0.2));
}
function deriveWhite(r, g, b) {
    return Math.min(255, Math.round(Math.min(r, g, b) * 0.6 + (r * 0.3 + g * 0.59 + b * 0.11) * 0.4));
}

// ── Write one colour to all fixtures ─────────────────────────────────────────
/**
 * @param {boolean} driveAcw  If true, derive amber/white from RGB. If false, zero them (calibration).
 */
function fillAll(wash, pars, vintages, shehdsBars, r, g, b, driveAcw = false) {
    if (wash) {
        const PIXELS = wash._rgbPixels;

        // Defeat any built-in strobe/effect modes on the wash
        if (typeof wash.setRgbStrobe === 'function') wash.setRgbStrobe(0);
        if (typeof wash.setAcwStrobe === 'function') wash.setAcwStrobe(0);
        if (typeof wash.setRgbEffect === 'function') wash.setRgbEffect(0);
        if (typeof wash.setAcwEffect === 'function') wash.setAcwEffect(0);

        for (let px = 1; px <= PIXELS; px++) {
            wash.setPixel(px, r, g, b);
        }
        // Amber + white segments — zero during static calibration so pure hue shows cleanly
        for (let seg = 1; seg <= wash._amberPixels; seg++) {
            wash.setChannel(wash._amberStart + seg - 1, driveAcw ? deriveAmber(r, g, b) : 0);
        }
        for (let seg = 1; seg <= wash._whitePixels; seg++) {
            wash.setChannel(wash._whiteStart + seg - 1, driveAcw ? deriveWhite(r, g, b) : 0);
        }
    }

    for (const par of pars) {
        par.setDimmer(255);   // 10-ch mode CH1 = master dimmer
        par.setStrobe(0);     // 10-ch mode CH8 = strobe
        par.setFunction(0);   // 10-ch mode CH9 = function (0 = manual rgb mode, 51+ = auto/sound)
        
        par.setRed(r);
        par.setGreen(g);
        par.setBlue(b);
        par.setAmber(driveAcw ? deriveAmber(r, g, b) : 0);
        par.setWhite(driveAcw ? deriveWhite(r, g, b) : 0);
    }

    for (const v of vintages) {
        v.setDimmer(255);
        v.setStrobe(0);
        v.setRed(r);
        v.setGreen(g);
        v.setBlue(b);
        v.fillWarm(0);
        v.setMainEffect(0);
        v.setAuxEffect(0);
        v.fillHeadAuxRgb(r, g, b);
    }

    for (const sb of shehdsBars) {
        sb.setDimmer(255);
        sb.setStrobe(0);
        sb.fillPixels(r, g, b, driveAcw ? deriveWhite(r, g, b) : 0, driveAcw ? deriveAmber(r, g, b) : 0, 0); // violet=0
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    const handler = new DmxHandler();
    await handler.init();

    const bench    = handler.universe('test_bench');
    const wash     = bench.fixtures.has('wash_1') ? bench.fixture('wash_1') : null;
    const pars     = ['par_1', 'par_2', 'par_3', 'par_4'].filter(l => bench.fixtures.has(l)).map(l => bench.fixture(l));
    const vintages = ['vintage_1', 'vintage_2'].filter(l => bench.fixtures.has(l)).map(l => bench.fixture(l));
    const shehdsBars = ['shehds_bar_1', 'shehds_bar_2'].filter(l => bench.fixtures.has(l)).map(l => bench.fixture(l));

    const modeLabel = RED_STATIC   ? 'RED static'
                    : GREEN_STATIC ? 'GREEN static'
                    : BLUE_STATIC  ? 'BLUE static'
                    : WHITE_STATIC ? 'WHITE static'
                    : `Rainbow (${FPS} fps, ${SPEED}x speed)`;

    console.log('\n' + '═'.repeat(56));
    console.log('  🔧  TEST BENCH CALIBRATION');
    console.log('─'.repeat(56));
    console.log(`  Mode     : ${modeLabel}`);
    console.log(`  Universe : test_bench @ ${bench._sender ? bench._sender.host : '?'}`);
    console.log(`  Fixtures : \${wash ? 'wash_1 (32px) + ' : ''}par_1–par_4 + vintage_1–vintage_2 + shehds_bar_1-shehds_bar_2`);
    console.log('  Ctrl+C to stop');
    console.log('═'.repeat(56) + '\n');

    // ── Static modes: send once, hold ────────────────────────────────────
    if (STATIC_MODE) {
        const [r, g, b] = RED_STATIC   ? [255, 0,   0  ]
                        : GREEN_STATIC ? [0,   255, 0  ]
                        : BLUE_STATIC  ? [0,   0,   255]
                        :                [0,   0,   0  ];   // WHITE_STATIC: 0 RGB, white/amber driven

        if (WHITE_STATIC) {
            fillAll(wash, pars, vintages, shehdsBars, 255, 255, 255);
        } else {
            fillAll(wash, pars, vintages, shehdsBars, r, g, b);
        }

        bench.send();
        console.log(`  ✅ Holding — press Ctrl+C to blackout\n`);

        // Keep process alive
        setInterval(() => bench.send(), 2000);   // retransmit every 2s (some nodes time out)

    // ── Animated rainbow ─────────────────────────────────────────────────
    } else {
        const loop = new DmxRenderLoop(handler);

        loop.start(FPS, ({ elapsed, frame }) => {
            const baseHue = (elapsed * SPEED) % 1;

            // Wash: rainbow sweep across RGB pixels
            if (wash) {
                const PIXELS = wash._rgbPixels;
                for (let px = 1; px <= PIXELS; px++) {
                    const { r, g, b } = hsv((baseHue + (px - 1) / PIXELS) % 1, 1, 1);
                    wash.setPixel(px, r, g, b);
                }
                // Amber/white from per-segment average hue
                for (let seg = 1; seg <= wash._amberPixels; seg++) {
                    const { r, g, b } = hsv((baseHue + (seg - 1) / wash._amberPixels) % 1, 1, 1);
                    wash.setChannel(wash._amberStart + seg - 1, deriveAmber(r, g, b));
                    wash.setChannel(wash._whiteStart + seg - 1, deriveWhite(r, g, b));
                }
            }

            // Pars: evenly spaced hues, dimmer open
            for (let i = 0; i < pars.length; i++) {
                const { r, g, b } = hsv((baseHue + i / pars.length) % 1, 1, 1);
                pars[i].setDimmer(255);
                pars[i].setRed(r); pars[i].setGreen(g); pars[i].setBlue(b);
                pars[i].setAmber(deriveAmber(r, g, b));
                pars[i].setWhite(deriveWhite(r, g, b));
            }

            // Vintage LEDs: evenly spaced hues across aux RGB
            for (let i = 0; i < vintages.length; i++) {
                const { r, g, b } = hsv((baseHue + i / vintages.length) % 1, 1, 1);
                vintages[i].setDimmer(255);
                vintages[i].setStrobe(0);
                vintages[i].setRed(r);
                vintages[i].setGreen(g);
                vintages[i].setBlue(b);
                vintages[i].fillWarm(0);
                vintages[i].setMainEffect(0);
                vintages[i].setAuxEffect(0);
                vintages[i].fillHeadAuxRgb(r, g, b);
            }
            
            // Shehds Bars: rainbow sweep across 18 pixels
            for (const sb of shehdsBars) {
                sb.setDimmer(255);
                sb.setStrobe(0);
                const PIXELS = sb.pixelCount || 18;
                for (let px = 1; px <= PIXELS; px++) {
                    const { r, g, b } = hsv((baseHue + (px - 1) / PIXELS) % 1, 1, 1);
                    sb.setPixel(px, r, g, b, deriveWhite(r, g, b), deriveAmber(r, g, b), 0);
                }
            }

            bench.send();

            if (frame % 80 === 0) {
                console.log(`  t=${elapsed.toFixed(1)}s  frame=${frame}  hue=${Math.round(baseHue * 360)}°`);
            }
        });

        process.on('SIGINT', async () => {
            console.log('\n  🛑 Stopping — blackout...');
            loop.stop();
            await handler.blackoutAll();
            setTimeout(() => { handler.close(); process.exit(0); }, 300);
        });

        return;   // keep process alive via loop timer
    }

    // Static mode shutdown
    process.on('SIGINT', async () => {
        console.log('\n  🛑 Blackout...');
        await handler.blackoutAll();
        setTimeout(() => { handler.close(); process.exit(0); }, 300);
    });
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
