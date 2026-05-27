/**
 * AudioCapture — spawn ffmpeg and stream raw s16le PCM frames.
 *
 * See docs/25_marsin_audio_analysis.md §3 for the design rationale.
 * Summary:
 *
 *   - Wraps a child-process ffmpeg invocation that pipes raw mono
 *     16-bit-little-endian PCM on stdout at a known sample rate.
 *   - Re-frames the byte stream into fixed-size `Int16Array` chunks
 *     (one chunk = `frameSamples` samples, regardless of how ffmpeg
 *     hands us bytes).
 *   - Each chunk goes to `onFrame(int16)`. The downstream analyzer
 *     decides what to do with it (FFT, energy detection, etc).
 *   - On unexpected ffmpeg exit, restart with exponential backoff
 *     capped at 30 s so an unplugged USB mic doesn't take down the
 *     engine.
 *   - `onStatus` carries lifecycle events ('starting' / 'running' /
 *     'stopped' / 'error' / 'restarting') with optional error and
 *     captureFps metadata. api_server.js pumps these into the
 *     `audioStatus` WS broadcast.
 *
 * Why ffmpeg over sox / naudiodon:
 *   - Already on this rig and most show machines.
 *   - Zero npm deps (no native compilation).
 *   - Cross-platform via input-format auto-detection.
 *
 * Why a separate class (not folded into AudioAnalyzer):
 *   - Lets `audio_capture.test.js` inject a fake spawn() without
 *     touching the FFT code, and vice versa.
 *   - A future swap to PortAudio bindings only touches this file.
 */

import { spawn } from 'node:child_process';

const RESTART_BACKOFF_INITIAL_MS = 1000;
const RESTART_BACKOFF_CAP_MS = 30_000;
const STDERR_WARN_INTERVAL_MS = 60_000;

// ── Cross-platform helpers (see docs/25 §3 "Cross-platform capture rule") ──
//
// These are the ONLY OS-aware bits in the audio stack alongside
// audio_devices.js. The analyzer, CPC, BPM sync, API and CaptainPad
// all stay platform-neutral and just see `Int16Array` hop frames.

const DEFAULT_FORMAT_BY_PLATFORM = Object.freeze({
  darwin: 'avfoundation',
  win32:  'dshow',
  linux:  'pulse',
});

function resolvePlatform(p) {
  return (!p || p === 'auto') ? process.platform : p;
}

function resolveInputFormat({ platform, inputFormat }) {
  if (inputFormat) return inputFormat;
  return DEFAULT_FORMAT_BY_PLATFORM[platform] || null;
}

/**
 * Pick a device string. macOS / Linux have safe defaults; Windows
 * REQUIRES the operator to have run `--choose_mic` (or pinned
 * audio.capture.device in config) because the default mic name is
 * machine-specific.
 */
function resolveDevice({ platform, device }) {
  if (device) return device;
  if (platform === 'darwin') return ':0';
  if (platform === 'linux')  return 'default';
  if (platform === 'win32') {
    const err = new Error(
      'Windows audio capture requires a pinned device. Run ' +
      '`node marsin_engine/engine.js --choose_mic` (or set audio.capture.device).',
    );
    err.code = 'device_not_configured';
    throw err;
  }
  const err = new Error(`Unsupported audio capture platform: ${platform}`);
  err.code = 'unsupported_platform';
  throw err;
}

/**
 * Build ffmpeg argv for live capture. Pure function — exported for tests
 * and for the `--choose_mic` flow that wants to print the command it
 * would have run.
 *
 * Always returns a plain string[] so `spawn(ffmpeg, args, { shell:false })`
 * is safe. Do NOT build shell command strings here.
 */
export function buildFfmpegArgs(cfg) {
  const platform    = resolvePlatform(cfg.platform);
  const inputFormat = resolveInputFormat({ platform, inputFormat: cfg.inputFormat });
  const device      = resolveDevice({ platform, device: cfg.device });
  if (!inputFormat) {
    const err = new Error(`No ffmpeg input format known for platform ${platform}`);
    err.code = 'unsupported_platform';
    throw err;
  }
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    // -nostdin keeps ffmpeg from grabbing the parent terminal's stdin.
    '-nostdin',
    '-f',  inputFormat,
    '-i',  device,
    '-ac', String(cfg.channels   ?? 1),
    '-ar', String(cfg.sampleRate ?? 44100),
    '-f',  's16le',
    '-',
  ];
}

export class AudioCapture {
  /**
   * @param {object} opts
   * @param {'ffmpeg'} [opts.backend] — only ffmpeg supported in v1
   * @param {string}  [opts.device]
   * @param {number}  [opts.sampleRate]
   * @param {number}  [opts.channels]
   * @param {number}  opts.frameSamples — samples per emitted frame (matches analyzer hop size)
   * @param {string}  [opts.inputFormat] — null = auto
   * @param {(int16: Int16Array) => void} opts.onFrame
   * @param {(status: object) => void} [opts.onStatus]
   * @param {(args: string[]) => any} [opts.spawnFn] — DI hook for tests
   */
  constructor(opts) {
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('AudioCapture requires an options object');
    }
    if (typeof opts.onFrame !== 'function') {
      throw new TypeError('AudioCapture requires onFrame callback');
    }
    if (!Number.isInteger(opts.frameSamples) || opts.frameSamples <= 0) {
      throw new RangeError('AudioCapture requires positive integer frameSamples');
    }

    this.backend       = opts.backend || 'ffmpeg';
    if (this.backend !== 'ffmpeg') {
      throw new Error(`AudioCapture backend "${this.backend}" not supported in v1`);
    }
    this.ffmpegPath    = opts.ffmpegPath || 'ffmpeg';
    this.platform      = resolvePlatform(opts.platform);
    this.sampleRate    = opts.sampleRate || 44100;
    this.channels      = opts.channels || 1;
    this.frameSamples  = opts.frameSamples;
    this.inputFormat   = resolveInputFormat({ platform: this.platform, inputFormat: opts.inputFormat || null });
    this.deviceLabel   = opts.deviceLabel || null;
    this.deviceId      = opts.deviceId || null;
    this._onFrame      = opts.onFrame;
    this._onStatus     = opts.onStatus || (() => {});
    this._spawnFn      = opts.spawnFn || spawn;
    this._stopTimeoutMs           = opts.stopTimeoutMs           ?? 2000;
    this._stderrWarnIntervalMs    = opts.stderrWarnIntervalMs    ?? STDERR_WARN_INTERVAL_MS;

    // resolveDevice throws a typed error on Windows-without-config — let
    // it propagate so the engine can surface it via audioStatus instead
    // of silently picking the wrong mic.
    this.device = resolveDevice({ platform: this.platform, device: opts.device });

    this._restartCount = 0;
    this._lastFrameAtMs = null;
    this._errorCode = null;

    // Each emitted frame is frameSamples * channels * 2 bytes (s16le).
    this._frameBytes = this.frameSamples * this.channels * 2;
    this._pending = []; // queued Buffer fragments awaiting reframing
    this._pendingBytes = 0;

    this._child = null;
    this._stopRequested = false;
    this._restartTimer = null;
    this._backoffMs = RESTART_BACKOFF_INITIAL_MS;

    // captureFps tracking — incremented per onFrame call, sampled
    // once per second for the audioStatus broadcast.
    this._framesSinceLastTick = 0;
    this._captureFps = 0;
    this._fpsTimer = null;

    this._lastStderrWarnAt = 0;
  }

  /** Build the ffmpeg argv. Exposed for tests / debugging. */
  buildArgs() {
    return buildFfmpegArgs({
      platform:    this.platform,
      inputFormat: this.inputFormat,
      device:      this.device,
      channels:    this.channels,
      sampleRate:  this.sampleRate,
    });
  }

  start() {
    if (this._child || this._stopRequested) return;
    this._spawnChild();
    this._fpsTimer = setInterval(() => {
      this._captureFps = this._framesSinceLastTick;
      this._framesSinceLastTick = 0;
    }, 1000);
    if (this._fpsTimer.unref) this._fpsTimer.unref();
  }

  /** SIGTERM the child; resolves after exit (or immediately if not running). */
  stop() {
    this._stopRequested = true;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (this._fpsTimer) {
      clearInterval(this._fpsTimer);
      this._fpsTimer = null;
    }
    const child = this._child;
    if (!child) {
      this._emitStatus({ phase: 'stopped' });
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const onExit = () => {
        this._child = null;
        this._emitStatus({ phase: 'stopped' });
        resolve();
      };
      child.once('exit', onExit);
      try { child.kill('SIGTERM'); }
      catch { /* already dead */ }
      // Hard backstop — if ffmpeg ignores SIGTERM (shouldn't), force-kill at 2s.
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000).unref?.();
    });
  }

  /** Current captureFps (frames/sec averaged over the last 1s tick). */
  getCaptureFps() { return this._captureFps; }

  // ── Internal ────────────────────────────────────────────────────────────

  _spawnChild() {
    const args = this.buildArgs();
    this._emitStatus({ phase: 'starting' });
    let child;
    try {
      // shell:false is the cross-platform rule (docs/25 §3). Without it,
      // a path containing a quote or space would be re-parsed by /bin/sh
      // or cmd.exe and break in subtle, machine-specific ways.
      child = this._spawnFn(this.ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      // ENOENT etc — ffmpeg not on PATH.
      this._errorCode = 'ffmpeg_missing';
      this._emitStatus({ phase: 'error', error: `spawn failed: ${err.message}` });
      this._scheduleRestart();
      return;
    }
    this._child = child;
    this._pending = [];
    this._pendingBytes = 0;

    child.stdout.on('data', (buf) => this._onStdout(buf));
    child.stderr.on('data', (buf) => this._onStderr(buf));
    child.on('error', (err) => {
      this._emitStatus({ phase: 'error', error: err.message });
    });
    child.on('exit', (code, signal) => {
      this._child = null;
      if (this._stopRequested) return;
      this._errorCode = 'capture_exited';
      this._emitStatus({
        phase: 'exited',
        error: `ffmpeg exited (code=${code}, signal=${signal ?? 'none'})`,
      });
      this._scheduleRestart();
    });

    // First successful frame moves us into the 'running' state and
    // resets the backoff so the next failure starts at 1 s again.
    this._signaledRunning = false;
  }

  _scheduleRestart() {
    if (this._stopRequested) return;
    this._restartCount++;
    this._emitStatus({ phase: 'restarting', backoffMs: this._backoffMs });
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      this._spawnChild();
    }, this._backoffMs);
    if (this._restartTimer.unref) this._restartTimer.unref();
    this._backoffMs = Math.min(this._backoffMs * 2, RESTART_BACKOFF_CAP_MS);
  }

  _onStdout(buf) {
    this._pending.push(buf);
    this._pendingBytes += buf.length;

    while (this._pendingBytes >= this._frameBytes) {
      // Coalesce pending fragments into a single Buffer, then peel
      // off exactly one frame's worth and re-queue the remainder.
      const merged = this._pending.length === 1 ? this._pending[0] : Buffer.concat(this._pending, this._pendingBytes);
      const frame  = merged.subarray(0, this._frameBytes);
      const rest   = merged.subarray(this._frameBytes);
      this._pending      = rest.length > 0 ? [rest] : [];
      this._pendingBytes = rest.length;

      // Wrap into Int16Array WITHOUT copy. Need to align byteOffset
      // to a multiple of 2 — Buffer.subarray preserves alignment from
      // a freshly-concated Buffer (offset 0), so this is safe.
      const i16 = new Int16Array(frame.buffer, frame.byteOffset, this._frameBytes >> 1);

      if (!this._signaledRunning) {
        this._signaledRunning = true;
        this._backoffMs = RESTART_BACKOFF_INITIAL_MS;
        this._errorCode = null;
        this._emitStatus({ phase: 'running' });
      }
      this._framesSinceLastTick++;
      this._lastFrameAtMs = Date.now();
      try { this._onFrame(i16); }
      catch (e) { console.warn(`[AudioCapture] onFrame threw: ${e && e.message}`); }
    }
  }

  _onStderr(buf) {
    const now = Date.now();
    if (now - this._lastStderrWarnAt < this._stderrWarnIntervalMs) return;
    this._lastStderrWarnAt = now;
    const txt = buf.toString('utf8').trim().split('\n').slice(0, 3).join(' | ');
    if (txt.length) console.warn(`[ffmpeg] ${txt}`);
  }

  _emitStatus(extra) {
    try {
      // Extended audioStatus shape (docs/25 §12). The extra fields make
      // CaptainPad's "MICROPHONE" card useful without an extra round-trip.
      this._onStatus({
        enabled:     true,
        backend:     this.backend,
        platform:    this.platform,
        inputFormat: this.inputFormat,
        device:      this.device,
        deviceLabel: this.deviceLabel,
        deviceId:    this.deviceId,
        sampleRate:  this.sampleRate,
        channels:    this.channels,
        captureFps:  this._captureFps,
        lastFrameAtMs: this._lastFrameAtMs,
        restartCount:  this._restartCount,
        errorCode:     this._errorCode,
        ...extra,
      });
    } catch (e) { console.warn(`[AudioCapture] onStatus threw: ${e && e.message}`); }
  }
}
