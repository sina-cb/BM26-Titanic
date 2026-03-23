/**
 * Art-Net Protocol Implementation
 * ================================
 * Implements Art-Net 4 DMX output (OpDmx / OpOutput) over UDP.
 * No third-party Art-Net dependencies — uses Node's built-in dgram.
 *
 * Art-Net spec: https://art-net.org.uk/
 * Default port: 6454 (0x1936)
 */
const dgram = require('dgram');

const ARTNET_PORT = 6454;
const ARTNET_HEADER = Buffer.from('Art-Net\0');
const OPCODE_DMX = 0x5000;       // OpOutput / OpDmx
const OPCODE_POLL = 0x2000;      // ArtPoll
const PROTOCOL_VERSION = 14;     // Art-Net 4

class ArtNetSender {
    /**
     * @param {object} opts
     * @param {string} opts.host       - Target Art-Net node IP
     * @param {number} [opts.universe] - DMX universe (0-32767)
     * @param {number} [opts.subnet]   - Art-Net subnet (0-15)
     * @param {number} [opts.net]      - Art-Net net (0-127)
     * @param {string} [opts.bindIp]   - Local IP to bind to (for multi-NIC machines)
     */
    constructor(opts = {}) {
        this.host = opts.host || '10.1.1.100';
        this.universe = opts.universe || 0;   // 0-15 within subnet
        this.subnet = opts.subnet || 0;       // 0-15 within net
        this.net = opts.net || 0;             // 0-127
        this.bindIp = opts.bindIp || '0.0.0.0';
        this.sequence = 1;                     // Sequence counter (1-255, 0=disabled)
        this.socket = null;
        this._ready = false;
        this._channelData = Buffer.alloc(512, 0); // 512 channels, all zero
    }

    /** Calculate the 15-bit port-address from net, subnet, universe */
    get portAddress() {
        return ((this.net & 0x7F) << 8) | ((this.subnet & 0x0F) << 4) | (this.universe & 0x0F);
    }

    /** Initialize the UDP socket */
    async init() {
        return new Promise((resolve, reject) => {
            this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            this.socket.on('error', (err) => {
                console.error('[ArtNet] Socket error:', err.message);
                reject(err);
            });
            this.socket.bind(0, this.bindIp, () => {
                this.socket.setBroadcast(true);
                this._ready = true;
                const addr = this.socket.address();
                console.log(`[ArtNet] Socket ready on ${addr.address}:${addr.port}`);
                console.log(`[ArtNet] Target: ${this.host}:${ARTNET_PORT} | Universe: ${this.universe} | Subnet: ${this.subnet} | Net: ${this.net}`);
                resolve();
            });
        });
    }

    /**
     * Build an Art-Net DMX packet (OpOutput / OpDmx)
     * Packet structure per Art-Net 4 spec:
     *   [0-7]   "Art-Net\0"         (8 bytes)
     *   [8-9]   OpCode             (2 bytes, little-endian)
     *   [10]    ProtVerHi          (1 byte)
     *   [11]    ProtVerLo          (1 byte)
     *   [12]    Sequence           (1 byte)
     *   [13]    Physical           (1 byte — physical input port, informational)
     *   [14-15] SubUni + Net       (2 bytes, little-endian port-address)
     *   [16-17] LengthHi+Lo       (2 bytes, big-endian — number of DMX channels)
     *   [18+]   DMX data           (2-512 bytes, must be even)
     */
    _buildDmxPacket(channelData) {
        const dataLen = channelData.length;
        // Ensure even length as per spec
        const paddedLen = dataLen + (dataLen % 2);
        const packet = Buffer.alloc(18 + paddedLen, 0);

        // Header
        ARTNET_HEADER.copy(packet, 0);

        // OpCode (little-endian)
        packet.writeUInt16LE(OPCODE_DMX, 8);

        // Protocol version (big-endian)
        packet.writeUInt8(0, 10);               // ProtVerHi
        packet.writeUInt8(PROTOCOL_VERSION, 11); // ProtVerLo

        // Sequence (1-255, wraps)
        packet.writeUInt8(this.sequence, 12);
        this.sequence = (this.sequence % 255) + 1;

        // Physical port (informational, 0)
        packet.writeUInt8(0, 13);

        // Port-Address (little-endian)
        packet.writeUInt16LE(this.portAddress, 14);

        // Length (big-endian)
        packet.writeUInt16BE(paddedLen, 16);

        // DMX data
        channelData.copy(packet, 18);

        return packet;
    }

    /**
     * Send DMX channel data to the Art-Net node.
     * @param {Buffer|number[]} channels - Up to 512 bytes of DMX data (channels 1-512).
     *                                     If array, values are 0-255.
     */
    send(channels) {
        if (!this._ready) throw new Error('ArtNet socket not initialized. Call init() first.');

        // Accept array or buffer
        if (Array.isArray(channels)) {
            const buf = Buffer.alloc(512, 0);
            for (let i = 0; i < Math.min(channels.length, 512); i++) {
                buf[i] = channels[i] & 0xFF;
            }
            channels = buf;
        } else if (Buffer.isBuffer(channels)) {
            // Pad to full 512 if shorter
            if (channels.length < 512) {
                const padded = Buffer.alloc(512, 0);
                channels.copy(padded);
                channels = padded;
            }
        }

        // Update internal state
        channels.copy(this._channelData);

        const packet = this._buildDmxPacket(channels);
        this.socket.send(packet, 0, packet.length, ARTNET_PORT, this.host, (err) => {
            if (err) console.error('[ArtNet] Send error:', err.message);
        });
    }

    /**
     * Set individual channel value.
     * @param {number} channel - DMX channel (1-512)
     * @param {number} value   - Value (0-255)
     */
    setChannel(channel, value) {
        if (channel < 1 || channel > 512) throw new RangeError('Channel must be 1-512');
        this._channelData[channel - 1] = value & 0xFF;
        this.send(this._channelData);
    }

    /** Send all zeros — blackout */
    blackout() {
        this._channelData.fill(0);
        this.send(this._channelData);
        console.log('[ArtNet] Blackout sent.');
    }

    /** Close the UDP socket */
    close() {
        if (this.socket) {
            this.socket.close();
            this._ready = false;
            console.log('[ArtNet] Socket closed.');
        }
    }
}

/**
 * Send an ArtPoll broadcast to discover Art-Net nodes.
 * @param {object} [opts]
 * @param {string} [opts.broadcastIp] - Broadcast address (default: 255.255.255.255)
 * @param {string} [opts.bindIp]      - Local bind IP
 * @param {number} [opts.timeout]     - Time in ms to wait for replies (default: 3000)
 * @returns {Promise<object[]>} Array of discovered nodes
 */
async function artPollDiscover(opts = {}) {
    const broadcastIp = opts.broadcastIp || '255.255.255.255';
    const bindIp = opts.bindIp || '0.0.0.0';
    const timeout = opts.timeout || 3000;

    return new Promise((resolve) => {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        const discovered = [];

        socket.on('message', (msg, rinfo) => {
            // Check for Art-Net header
            if (msg.length < 10) return;
            const header = msg.slice(0, 8).toString();
            if (header !== 'Art-Net\0') return;

            const opCode = msg.readUInt16LE(8);

            // ArtPollReply = 0x2100
            if (opCode === 0x2100 && msg.length >= 207) {
                const node = parseArtPollReply(msg, rinfo);
                discovered.push(node);
                console.log(`[ArtPoll] Found node: ${node.longName} @ ${node.ip} (${node.shortName})`);
            }
        });

        socket.bind(ARTNET_PORT, bindIp, () => {
            socket.setBroadcast(true);

            // Build ArtPoll packet
            const poll = Buffer.alloc(14, 0);
            ARTNET_HEADER.copy(poll, 0);
            poll.writeUInt16LE(OPCODE_POLL, 8);      // OpCode
            poll.writeUInt8(0, 10);                    // ProtVerHi
            poll.writeUInt8(PROTOCOL_VERSION, 11);     // ProtVerLo
            poll.writeUInt8(0x06, 12);                 // TalkToMe: send ArtPollReply on change + diagnostics
            poll.writeUInt8(0x00, 13);                 // Priority: DpAll

            console.log(`[ArtPoll] Broadcasting to ${broadcastIp}:${ARTNET_PORT}...`);
            socket.send(poll, 0, poll.length, ARTNET_PORT, broadcastIp, (err) => {
                if (err) console.error('[ArtPoll] Send error:', err.message);
            });

            // Also try subnet broadcast
            if (broadcastIp === '255.255.255.255') {
                socket.send(poll, 0, poll.length, ARTNET_PORT, '10.1.1.255', (err) => {
                    if (err) { /* ignore */ }
                });
            }

            setTimeout(() => {
                socket.close();
                resolve(discovered);
            }, timeout);
        });
    });
}

/**
 * Parse an ArtPollReply packet into a readable object.
 */
function parseArtPollReply(msg, rinfo) {
    const ip = `${msg[10]}.${msg[11]}.${msg[12]}.${msg[13]}`;
    const port = msg.readUInt16LE(14);
    const versionHi = msg[16];
    const versionLo = msg[17];
    const netSwitch = msg[18];
    const subSwitch = msg[19];
    const oem = msg.readUInt16BE(20);
    const shortName = msg.slice(26, 44).toString('ascii').replace(/\0/g, '').trim();
    const longName = msg.slice(44, 108).toString('ascii').replace(/\0/g, '').trim();
    const numPorts = msg.readUInt16BE(172);

    return {
        ip: rinfo.address || ip,
        reportedIp: ip,
        port,
        firmware: `${versionHi}.${versionLo}`,
        net: netSwitch,
        subnet: subSwitch,
        oem: `0x${oem.toString(16).padStart(4, '0')}`,
        shortName,
        longName,
        numPorts,
        raw: rinfo
    };
}

module.exports = { ArtNetSender, artPollDiscover, ARTNET_PORT };
