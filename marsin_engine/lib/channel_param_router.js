export class ChannelParamRouter {
  constructor(mixer, paramCenter) {
    this.mixer = mixer;
    this.paramCenter = paramCenter || null;
    this.localControlKinds = new Set([1, 2, 3, 6]);
  }

  // Set control for a specific channel
  setChannelControl(channelId, controlId, v0, v1, v2) {
    // Reject writes to CPC-owned controls
    if (this.paramCenter?.isSharedControlId(channelId, controlId)) {
      return { status: 'ignored', reason: 'shared_ownership' };
    }

    const channel = this.mixer.getChannel(channelId);
    if (!channel) return { status: 'ignored', reason: 'channel_not_found' };
    const exp = this.mixer.wasmHost.getExports(channel.handle).find(e => e.id === controlId);
    if (!exp || !this.localControlKinds.has(exp.kind)) {
      return { status: 'ignored', reason: 'not_local_control' };
    }

    // Update local state and WASM instance
    channel.setControl(this.mixer.wasmHost, controlId, v0, v1, v2);
    return { status: 'ok' };
  }

  // Legacy fallback for base channel only
  setControl(controlId, v0, v1, v2) {
    if (!this.mixer.baseChannelId) return { status: 'ignored', reason: 'no_base_channel' };
    return this.setChannelControl(this.mixer.baseChannelId, controlId, v0, v1, v2);
  }
}
