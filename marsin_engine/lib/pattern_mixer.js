import { PatternChannel } from './pattern_channel.js';
import fs from 'fs';
import path from 'path';

export class PatternMixer {
  constructor({ wasmHost, pixelCount }) {
    this.wasmHost = wasmHost;
    this.pixelCount = pixelCount;
    this.channels = [];
    this.master = 1.0;
    this.baseChannelId = null;
    this.maxChannels = 6;

    // View crossfade state (0.0 = deck exclusively, 1.0 = mixer exclusively)
    this.viewFader = 0.0;
    this.targetViewFader = 0.0;

    // Buffer for compositing output
    this.outputBuffer = new Uint8Array(this.pixelCount * 6);
    // Buffer for individual channel output
    this.channelBuffer = new Uint8Array(this.pixelCount * 6);
    
    this.transitions = []; // Active transitions
    this.blendHandles = {}; // Cache: blendName -> WASM handle
    this.patternsDir = null; // Set by caller after construction
    this.onChannelRemoved = null; // Callback: (channelId) => void
  }

  getChannel(channelId) {
    return this.channels.find(c => c.id === channelId);
  }

  addChannel(channelConfig) {
    if (this.channels.length >= this.maxChannels) {
      throw new Error(`Maximum of ${this.maxChannels} channels allowed`);
    }
    const channel = new PatternChannel(channelConfig);
    this.channels.push(channel);
    if (!this.baseChannelId) {
      this.baseChannelId = channel.id;
    }
    return channel;
  }

  removeChannel(channelId) {
    const index = this.channels.findIndex(c => c.id === channelId);
    if (index !== -1) {
      const channel = this.channels[index];
      if (this.onChannelRemoved) this.onChannelRemoved(channelId);
      channel.destroy(this.wasmHost);
      this.channels.splice(index, 1);
      if (this.baseChannelId === channelId) {
        this.baseChannelId = this.channels.length > 0 ? this.channels[0].id : null;
      }
    }
  }

  setMaster(value) {
    this.master = Math.max(0, Math.min(1, value));
  }

  async transitionBaseTo(patternName, options = {}) {
    const { durationMs = 500, mode = 'blend_screen', loadPatternFn } = options;
    // Note: loadPatternFn should be an async function that returns the compiled handle, exports, etc.
    // However, the mixer operates on handles. The caller should compile and pass the handle.
    // For simplicity, let's assume the caller adds the new channel and sets up a transition here.
    // We will automate the fade.
  }

  fadeChannel(channelId, targetFader, durationMs, options = {}) {
    const channel = this.getChannel(channelId);
    if (!channel) return;

    this.transitions.push({
      channelId,
      startFader: channel.fader,
      targetFader,
      startTime: performance.now(),
      durationMs,
      destroyOnComplete: options.destroyOnComplete || false,
      isBaseTransition: options.isBaseTransition || false,
      newBaseId: options.newBaseId || null
    });
  }

  updateTransitions(now) {
    for (let i = this.transitions.length - 1; i >= 0; i--) {
      const t = this.transitions[i];
      const elapsed = now - t.startTime;
      let progress = t.durationMs > 0 ? elapsed / t.durationMs : 1;
      
      if (progress >= 1) progress = 1;

      const channel = this.getChannel(t.channelId);
      if (channel) {
        channel.fader = t.startFader + (t.targetFader - t.startFader) * progress;
      }

      if (progress >= 1) {
        if (t.destroyOnComplete && channel) {
          this.removeChannel(t.channelId);
        }
        if (t.isBaseTransition && t.newBaseId) {
          this.baseChannelId = t.newBaseId;
        }
        this.transitions.splice(i, 1);
      }
    }
  }

  beginFrame(elapsedSeconds) {
    this.updateTransitions(performance.now());
    for (const channel of this.channels) {
      channel.beginFrame(this.wasmHost, elapsedSeconds);
    }
  }

  applyMaster(out, master) {
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.round(out[i] * master);
    }
  }

  renderAll6ch() {
    if (!this.deckBuffer) {
      this.deckBuffer = new Uint8Array(this.pixelCount * 6);
      this.mixerBuffer = new Uint8Array(this.pixelCount * 6);
    }
    
    this.deckBuffer.fill(0);
    this.mixerBuffer.fill(0);
    this.outputBuffer.fill(0);

    // simple 1-second crossfade at 40fps (0.025 increment per frame)
    if (this.viewFader < this.targetViewFader) {
      this.viewFader = Math.min(this.targetViewFader, this.viewFader + 0.05);
    } else if (this.viewFader > this.targetViewFader) {
      this.viewFader = Math.max(this.targetViewFader, this.viewFader - 0.05);
    }

    // 1. Render Deck
    const deck = this.getChannel(this.baseChannelId);
    if (deck && deck.enabled && deck.fader > 0) {
      deck.renderInto(this.wasmHost, this.deckBuffer);
      if (deck.fader < 1.0) this.applyMaster(this.deckBuffer, deck.fader);
    }

    // 2. Render Mixer layers
    for (const channel of this.channels) {
      if (channel.id === this.baseChannelId) continue;
      if (!channel.enabled || channel.fader <= 0.01) continue;

      channel.renderInto(this.wasmHost, this.channelBuffer);

      const blendHandle = this.getBlendHandle(channel.mode);
      if (blendHandle) {
        const result = this.wasmHost.renderBlend6ch(
          blendHandle, this.pixelCount,
          this.mixerBuffer, this.channelBuffer, channel.fader
        );
        this.mixerBuffer.set(result);
      }
    }

    // 3. Transition between Deck and Mixer
    if (this.viewFader <= 0.001) {
      this.outputBuffer.set(this.deckBuffer);
    } else if (this.viewFader >= 0.999) {
      this.outputBuffer.set(this.mixerBuffer);
    } else {
      const transitionHandle = this.getBlendHandle('blend_crossfade'); // or blend_wipe_left
      if (transitionHandle) {
        const result = this.wasmHost.renderBlend6ch(
          transitionHandle, this.pixelCount,
          this.deckBuffer, this.mixerBuffer, this.viewFader
        );
        this.outputBuffer.set(result);
      } else {
        this.outputBuffer.set(this.mixerBuffer);
      }
    }

    if (this.master < 1.0) {
      this.applyMaster(this.outputBuffer, this.master);
    }

    return this.outputBuffer;
  }

  destroy() {
    for (const channel of this.channels) {
      channel.destroy(this.wasmHost);
    }
    // Destroy blend handles
    for (const [name, handle] of Object.entries(this.blendHandles)) {
      if (handle) this.wasmHost.destroy(handle);
    }
    this.blendHandles = {};
    this.channels = [];
  }

  getBlendHandle(blendName) {
    if (!blendName) return null;
    if (this.blendHandles[blendName] !== undefined) return this.blendHandles[blendName];
    // Lazy-compile the blend script
    this.blendHandles[blendName] = this._compileBlend(blendName);
    return this.blendHandles[blendName];
  }

  _compileBlend(blendName) {
    if (!this.patternsDir) return null;
    try {
      const blendPath = path.join(this.patternsDir, 'channel_blends', `${blendName}.js`);
      const code = fs.readFileSync(blendPath, 'utf8');
      const result = this.wasmHost.compile(code);
      if (result.ok) {
        console.log(`[Mixer] Compiled blend script: ${blendName}`);
        return result.handle;
      } else {
        console.warn(`[Mixer] Blend compile failed for ${blendName}: ${result.error}`);
        return null;
      }
    } catch (e) {
      console.warn(`[Mixer] Could not load blend script ${blendName}:`, e.message);
      return null;
    }
  }
}
