#!/usr/bin/env node
/**
 * testbench_helloworld.js
 * =======================
 * Color sequence test for the test bench universe.
 *
 * Cycles through 6 colors with smooth crossfades:
 *   RED → BLUE → GREEN → WHITE → AMBER → PURPLE
 *
 * Each color holds for 2s, then crossfades to the next over 2s.
 * The LED bar (EndyshowBar) has no purple channel — it goes dark during the purple phase.
 *
 * Usage:
 *   node test/testbench_helloworld.js
 *   node test/testbench_helloworld.js --fps 60
 *   node test/testbench_helloworld.js --hold 3     (3s hold between fades)
 *   node test/testbench_helloworld.js --fade 1     (1s crossfade)
 *   Ctrl+C → blackout all fixtures and exit
 */

'use strict';

const path = require('path');
const { DmxHandler, DmxRenderLoop } = require(path.join(__dirname, '..'));

// ── CLI args ──────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const FPS      = parseArgFloat(args, '--fps',  40);
const HOLD_SEC = parseArgFloat(args, '--hold', 2.0);
const FADE_SEC = parseArgFloat(args, '--fade', 2.0);

function parseArgFloat(args, flag, fallback) {
    const i = args.indexOf(flag);
    return (i !== -1 && args[i + 1]) ? parseFloat(args[i + 1]) : fallback;
}

// ── Color definitions ─────────────────────────────────────────────────────────
// Each color specifies:  { r, g, b, w, a, p }
//   r/g/b = RGB channels       (wash pixels + par CH2-4)
//   w     = white channel       (wash white segments + par CH5)
//   a     = amber channel       (wash amber segments + par CH6/Y)
//   p     = purple channel      (par CH7 only — wash has no purple)
const COLORS = [
    { name: 'RED',    r: 255, g: 0,   b: 0,   w: 0,   a: 0,   p: 0   },
    { name: 'GREEN',  r: 0,   g: 255, b: 0,   w: 0,   a: 0,   p: 0   },
    { name: 'BLUE',   r: 0,   g: 0,   b: 255, w: 0,   a: 0,   p: 0   },
    { name: 'WHITE',  r: 0,   g: 0,   b: 0,   w: 255, a: 0,   p: 0   },
    { name: 'AMBER',  r: 0,   g: 0,   b: 0,   w: 0,   a: 255, p: 0   },
    { name: 'PURPLE', r: 0,   g: 0,   b: 0,   w: 0,   a: 0,   p: 255 },
];

const CYCLE_SEC = HOLD_SEC + FADE_SEC;   // one color phase = hold + crossfade
const TOTAL_CYCLE = COLORS.length * CYCLE_SEC;

/** Linear interpolation between two values */
function lerp(a, b, t) {
    return Math.round(a + (b - a) * t);
}

/**
 * Given elapsed time, return the blended color for this instant.
 * @returns {{ r, g, b, w, a, p, label }}
 */
function getColor(elapsed) {
    const t = elapsed % TOTAL_CYCLE;
    const phaseIdx = Math.floor(t / CYCLE_SEC);
    const phaseT   = t - phaseIdx * CYCLE_SEC;

    const from = COLORS[phaseIdx];
    const to   = COLORS[(phaseIdx + 1) % COLORS.length];

    if (phaseT < HOLD_SEC) {
        // Static hold phase
        return { ...from, label: from.name };
    } else {
        // Crossfade phase
        const fadeT = (phaseT - HOLD_SEC) / FADE_SEC;   // 0→1
        return {
            r: lerp(from.r, to.r, fadeT),
            g: lerp(from.g, to.g, fadeT),
            b: lerp(from.b, to.b, fadeT),
            w: lerp(from.w, to.w, fadeT),
            a: lerp(from.a, to.a, fadeT),
            p: lerp(from.p, to.p, fadeT),
            label: from.name + ' → ' + to.name,
        };
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    const handler = new DmxHandler();
    await handler.init();

    const bench    = handler.universe('test_bench');
    const pars     = ['par_1', 'par_2', 'par_3', 'par_4'].map(l => bench.fixture(l));
    const vintages = ['vintage_1', 'vintage_2'].map(l => bench.fixture(l));
    const bars     = ['shehds_bar_1', 'shehds_bar_2'].map(l => bench.fixture(l));

    const ctrlIP = bench._sender ? bench._sender.host : '?';

    console.log('\n' + '═'.repeat(56));
    console.log('  🎨  TESTBENCH HELLO WORLD — Color Sequence');
    console.log('─'.repeat(56));
    console.log('  Universe : test_bench @ ' + ctrlIP);
    console.log('  Fixtures : par_1–par_4 + vintage_1–vintage_2 + shehds_bar_1–2 (18px)');
    console.log('  FPS      : ' + FPS);
    console.log('  Sequence : ' + COLORS.map(c => c.name).join(' → '));
    console.log('  Hold     : ' + HOLD_SEC + 's  |  Fade: ' + FADE_SEC + 's');
    console.log('  Ctrl+C to stop');
    console.log('═'.repeat(56) + '\n');

    const loop = new DmxRenderLoop(handler);
    let lastLabel = '';

    loop.start(FPS, ({ elapsed }) => {
        const c = getColor(elapsed);

        // ── SHEHDS Bars: 18 RGBWAV pixels + master dimmer ────────────────
        for (const bar of bars) {
            bar.setDimmer(255);
            bar.setStrobe(0);
            bar.fillPixels(c.r, c.g, c.b, c.w, c.a, c.p);
        }

        // ── Pars (UkingPar): full RGBWAP ─────────────────────────────────
        for (const par of pars) {
            par.setDimmer(255);
            par.setStrobe(0);
            par.setFunction(0);
            par.setRed(c.r);
            par.setGreen(c.g);
            par.setBlue(c.b);
            par.setWhite(c.w);
            par.setAmber(c.a);
            par.setPurple(c.p);
        }

        // ── Vintage LEDs: aux RGB + warm ─────────────────────────────────
        // The vintage LED has no amber/white/purple channels.
        //   - Amber (c.a) → warm channels (warm-toned LEDs)
        //   - White (c.w) → warm channels + full RGB
        //   - Purple (c.p) → approximate via R+B on aux RGB
        for (const v of vintages) {
            v.setDimmer(255);
            v.setStrobe(0);
            v.fillWarm(Math.max(c.a, c.w));
            v.setRed(c.r   || c.p);
            v.setGreen(c.g);
            v.setBlue(c.b  || c.p);
            v.setMainEffect(0);
            v.setAuxEffect(0);
            v.fillHeadAuxRgb(c.r || c.p, c.g, c.b || c.p);
        }

        bench.send();

        // Log phase transitions
        if (c.label !== lastLabel) {
            lastLabel = c.label;
            const ts = elapsed.toFixed(1);
            console.log('  t=' + ts + 's  ' + c.label);
        }
    });

    // ── Graceful shutdown ─────────────────────────────────────────────────
    process.on('SIGINT', async () => {
        console.log('\n  🛑 Stopping — blackout...');
        loop.stop();
        await handler.blackoutAll();
        setTimeout(() => { handler.close(); process.exit(0); }, 300);
    });
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
