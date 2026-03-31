'use strict';
/**
 * DmxHandler — Top-level DMX system manager.
 *
 * Loads universes.yaml, instantiates DmxUniverse objects, and places
 * the correct fixture subclass into each universe.  Manages the lifecycle
 * (init/close) of all sACN (E1.31) sockets.
 *
 * This is the single object a rendering engine needs:
 *
 *   const handler = new DmxHandler();
 *   await handler.init();
 *   handler.universe('main').fixture('bar_1').setPixel(1, 255, 0, 0);
 *   handler.universe('main').send();
 */

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { DmxUniverse }  = require('./DmxUniverse');

const { UkingPar }     = require('./fixtures/UkingPar');
const { VintageLed }   = require('./fixtures/VintageLed');
const { ShehdsBar }    = require('./fixtures/ShehdsBar');

// ── Fixture factory ────────────────────────────────────────────────────────
// Maps fixture type name (as written in universes.yaml) → implementation class.
// Add new entries here when new fixture subclasses are introduced.
const FIXTURE_REGISTRY = {
    'UkingPar':    UkingPar,
    'VintageLed':  VintageLed,
    'ShehdsBar':   ShehdsBar,
};

/**
 * Resolve a fixture class from its type string.
 * @param {string} typeName - e.g. "EndyshowBar"
 * @returns {Function} Constructor
 */
function resolveFixtureClass(typeName) {
    const cls = FIXTURE_REGISTRY[typeName];
    if (!cls) {
        throw new Error(
            `[DmxHandler] Unknown fixture type "${typeName}". ` +
            `Registered types: ${Object.keys(FIXTURE_REGISTRY).join(', ')}`
        );
    }
    return cls;
}

// ── DmxHandler ─────────────────────────────────────────────────────────────

class DmxHandler {
    /**
     * @param {string} [universesYamlPath] - Path to universes.yaml.
     *   Defaults to <dmx root>/universes.yaml.
     */
    constructor(universesYamlPath) {
        this._yamlPath  = universesYamlPath || path.join(__dirname, '..', 'universes.yaml');
        this._universes = new Map();   // id → DmxUniverse
        this._loaded    = false;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    /**
     * Load universes.yaml, build all universes and place fixtures.
     * Must be called before init().
     */
    load() {
        if (this._loaded) return;

        const raw = fs.readFileSync(this._yamlPath, 'utf8');
        const cfg = yaml.load(raw);

        const dmxRoot = path.dirname(this._yamlPath);

        for (const univCfg of (cfg.universes || [])) {
            const univ = new DmxUniverse(univCfg);

            for (const fixCfg of (univCfg.fixtures || [])) {
                // Support both new schema (type + config.layout) and legacy (profile)
                const layoutRelPath = (fixCfg.config && fixCfg.config.layout)
                    ? fixCfg.config.layout
                    : fixCfg.profile;

                if (!layoutRelPath) {
                    throw new Error(
                        `[DmxHandler] Fixture "${fixCfg.label}" has no config.layout or profile`
                    );
                }

                const profileAbsPath = path.join(dmxRoot, layoutRelPath);
                const FixtureClass   = fixCfg.type
                    ? resolveFixtureClass(fixCfg.type)
                    : resolveFixtureClass(layoutRelPath);  // legacy fallback

                const fixture = new FixtureClass(fixCfg.label, profileAbsPath);
                univ.addFixture(fixture, fixCfg.dmx_start_address || 1);
            }


            this._universes.set(univCfg.id, univ);
        }

        this._loaded = true;
        console.log(`[DmxHandler] Loaded ${this._universes.size} universe(s) from ${this._yamlPath}`);
    }

    /**
     * Open all Art-Net sockets.  Calls load() automatically if not already done.
     */
    async init() {
        if (!this._loaded) this.load();

        for (const univ of this._universes.values()) {
            await univ.init();
        }

        console.log(`[DmxHandler] All universes initialized`);
    }

    /** Close all Art-Net sockets. */
    close() {
        for (const univ of this._universes.values()) {
            univ.close();
        }
        console.log(`[DmxHandler] Closed`);
    }

    // ── Universe Access ──────────────────────────────────────────────────

    /**
     * Retrieve a universe by its id.
     * @param {string} id
     * @returns {DmxUniverse}
     */
    universe(id) {
        const u = this._universes.get(id);
        if (!u) throw new Error(`[DmxHandler] Unknown universe "${id}"`);
        return u;
    }

    /** All universes as a Map<id, DmxUniverse>. */
    get universes() { return this._universes; }

    // ── Convenience ──────────────────────────────────────────────────────

    /** Send a blackout packet on every universe. */
    async blackoutAll() {
        for (const univ of this._universes.values()) {
            univ.blackout();
        }
        console.log(`[DmxHandler] Blackout sent to all universes`);
    }

    /** Flush all universe buffers (send one packet per universe). */
    sendAll() {
        for (const univ of this._universes.values()) {
            univ.send();
        }
    }
}

module.exports = { DmxHandler };
