'use strict';
/**
 * DmxRenderLoop — Frame-rate timing driver for the DmxHandler.
 *
 * Calls an engine callback at a fixed fps.  The callback receives
 * { handler, elapsed, frame } and is responsible for writing to
 * fixtures and calling universe.send().
 *
 * Usage:
 *   const loop = new DmxRenderLoop(handler);
 *   loop.start(40, ({ handler, elapsed, frame }) => { ... });
 *   loop.stop();
 *   loop.setFps(60);   // hot-swap without stopping
 */

class DmxRenderLoop {
    /**
     * @param {import('./DmxHandler')} handler
     */
    constructor(handler) {
        this._handler   = handler;
        this._fps       = 40;
        this._callback  = null;
        this._timer     = null;
        this._startTime = 0;
        this._frame     = 0;
        this._running   = false;
    }

    /** Whether the loop is currently running */
    get running() { return this._running; }

    /** Current frame rate setting */
    get fps() { return this._fps; }

    /**
     * Start the render loop.
     * @param {number}   fps      - Frames per second (1–120)
     * @param {Function} callback - ({ handler, elapsed, frame }) => void
     */
    start(fps, callback) {
        if (this._running) this.stop();

        this._fps      = Math.max(1, Math.min(fps, 120));
        this._callback = callback;
        this._frame    = 0;
        this._startTime = Date.now();
        this._running  = true;

        this._schedule();
        console.log(`[DmxRenderLoop] Started at ${this._fps} fps`);
    }

    /** Stop the render loop (does not blackout). */
    stop() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        this._running = false;
        console.log(`[DmxRenderLoop] Stopped after ${this._frame} frames`);
    }

    /**
     * Hot-swap the frame rate without stopping.
     * @param {number} fps
     */
    setFps(fps) {
        this._fps = Math.max(1, Math.min(fps, 120));
        console.log(`[DmxRenderLoop] Frame rate → ${this._fps} fps`);
    }

    // ── Internal ──────────────────────────────────────────────────────────

    _schedule() {
        if (!this._running) return;
        const frameMs = 1000 / this._fps;
        const tickStart = Date.now();

        this._tick();

        // Compensate for tick execution time to maintain steady fps
        const elapsed = Date.now() - tickStart;
        const delay   = Math.max(0, frameMs - elapsed);
        this._timer   = setTimeout(() => this._schedule(), delay);
    }

    _tick() {
        const elapsed = (Date.now() - this._startTime) / 1000;
        try {
            this._callback({
                handler: this._handler,
                elapsed,
                frame:   this._frame,
            });
        } catch (err) {
            console.error(`[DmxRenderLoop] Error in frame ${this._frame}:`, err.message);
        }
        this._frame++;
    }
}

module.exports = { DmxRenderLoop };
