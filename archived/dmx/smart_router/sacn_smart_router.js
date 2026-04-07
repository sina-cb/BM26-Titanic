const { Receiver, Sender } = require('sacn');

// ── Configuration ────────────────────────────────────────────────────────────

const IN_UNIVERSE = 1;         // Universe to listen to 
const OUT_UNIVERSE = 1;        // Universe to forward to
const HARDWARE_IP = '10.1.1.102'; // The physical PKnight Node
const LOCKOUT_MS = 10000;      // Hold high-priority channel for 10s

const DEBUG = process.env.DEBUG_PAYLOAD === 'true';

// ── Networking ───────────────────────────────────────────────────────────────

const sender = new Sender({
    universe: OUT_UNIVERSE,
    useUnicastDestination: HARDWARE_IP,
    // The router dictates the ultimate priority hitting the hardware.
    // We send at highest so nobody else physically competing can override it.
    defaultPacketOptions: { priority: 200 } 
});

const receiver = new Receiver({
    universes: [IN_UNIVERSE],
    reuseAddr: true
});

// ── State ────────────────────────────────────────────────────────────────────

let activeSource = null;       // sourceName of whoever is currently being forwarded
let highPriorityActive = false;
let highPriorityTimer = null;

console.log('═'.repeat(60));
console.log('  ⚡ sACN Smart Priority Router');
console.log('─'.repeat(60));
console.log(`  Listening on Universe : ${IN_UNIVERSE}`);
console.log(`  Forwarding to         : ${HARDWARE_IP}`);
console.log(`  Rule                  : Priority >=150 locks out lower for ${LOCKOUT_MS/1000}s`);
console.log(`  Debug                 : ${DEBUG}`);
console.log('═'.repeat(60));
console.log('  Waiting for packets...\n');

receiver.on('packet', (packet) => {
    const priority = packet.priority || 100;
    const sourceKey = packet.sourceName || 'Unknown';

    // ── Debug: log every packet (throttled per source) ───────────────────
    if (DEBUG) {
        const now = Date.now();
        if (!global._dbg) global._dbg = {};
        if (now - (global._dbg[sourceKey] || 0) > 1000) {
            console.log(`[DEBUG] 📩 '${sourceKey}' (Priority: ${priority})`);
            logDebugPayload(packet);
            global._dbg[sourceKey] = now;
        }
    }

    // ── High priority source (e.g. LX Studio = 200) ─────────────────────
    if (priority >= 150) {
        if (!highPriorityActive || activeSource !== sourceKey) {
            console.log(`[Router] 🔴 OVERRIDE — '${sourceKey}' (Priority ${priority}) is now in control.`);
            highPriorityActive = true;
            activeSource = sourceKey;
        }

        // Reset the lockout countdown on every high-priority packet
        clearTimeout(highPriorityTimer);
        highPriorityTimer = setTimeout(() => {
            console.log(`[Router] 🟢 RELEASED — '${activeSource}' went silent for ${LOCKOUT_MS/1000}s. Falling back.`);
            highPriorityActive = false;
            activeSource = null;
        }, LOCKOUT_MS);

        forward(packet);
    }
    // ── Low priority source (e.g. Testbench = 100) ──────────────────────
    else {
        if (!highPriorityActive) {
            // Source changed — log it once
            if (activeSource !== sourceKey) {
                console.log(`[Router] 🟡 ACTIVE — '${sourceKey}' (Priority ${priority}) is now forwarding.`);
                activeSource = sourceKey;
            }
            forward(packet);
        } else {
            // Silently drop; only log in debug mode
            if (DEBUG) {
                const now = Date.now();
                if (!global._dropLog) global._dropLog = 0;
                if (now - global._dropLog > 2000) {
                    console.log(`[DEBUG] 🔇 Dropping '${sourceKey}' (Priority ${priority}) — Override Active.`);
                    global._dropLog = now;
                }
            }
        }
    }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function forward(packet) {
    sender.send({
        payload: packet.payload,
        sourceName: 'SmartRouter'
    }).catch(err => {
        console.error(`[Router] Forward error: ${err.message}`);
    });
}

function logDebugPayload(packet) {
    const pLen = packet.payload ? (packet.payload.length || Object.keys(packet.payload).length) : 0;
    const activeData = {};
    
    if (packet.payload) {
        for (let k in packet.payload) {
            if (packet.payload[k] > 0) activeData[k] = packet.payload[k];
        }
    }
    
    console.log(`         -> typeof=${typeof packet.payload}, size=${pLen}`);
    console.log(`         -> Active Data: ${JSON.stringify(activeData)}`);
}
