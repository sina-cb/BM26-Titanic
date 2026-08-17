const LIVE_MASTER_FADE_MAX_MS = 60000;
const PIXEL_LANES = ['r', 'g', 'b', 'w', 'a', 'u'];

function requireUnitInterval(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite number in [0,1], got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireRevision(value, current) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `expectedRevision must be a non-negative integer, got ${JSON.stringify(value)}`,
    );
  }
  if (value !== current) {
    const error = new Error(
      `stale Live Touch brightness revision ${value}; current revision is ${current}`,
    );
    error.code = 'TOUCH_BRIGHTNESS_STALE_REVISION';
    throw error;
  }
}

/** Stable group-name to section-id map used to guard armed model reloads. */
export function modelGroupSectionMap(pixels) {
  if (!Array.isArray(pixels)) throw new Error('model pixels must be an array');
  const groups = new Map();
  for (const pixel of pixels) {
    if (!pixel || typeof pixel.group !== 'string' || pixel.group.length === 0
        || !Number.isInteger(pixel.sId) || pixel.sId <= 0) {
      throw new Error('every model pixel needs a group name and positive integer sectionId');
    }
    const previous = groups.get(pixel.group);
    if (previous !== undefined && previous !== pixel.sId) {
      throw new Error(`model group '${pixel.group}' spans sectionIds ${previous} and ${pixel.sId}`);
    }
    groups.set(pixel.group, pixel.sId);
  }
  return groups;
}

export function sameModelGroupSections(currentPixels, candidatePixels) {
  const current = modelGroupSectionMap(currentPixels);
  const candidate = modelGroupSectionMap(candidatePixels);
  if (current.size !== candidate.size) return false;
  for (const [group, sectionId] of current) {
    if (candidate.get(group) !== sectionId) return false;
  }
  return true;
}

/**
 * Transient brightness owned by one ARMED Live Touch session.
 *
 * This state is intentionally absent from StateManager. Deck, Mixer, presets,
 * and the Dimmer Rack remain durable authorities; these factors disappear on
 * every disarm, deadman revert, and restart.
 */
export class LiveBrightnessController {
  constructor(now = () => Date.now()) {
    this._now = now;
    this.active = false;
    this.ownerId = null;
    this.revision = 0;
    this.master = 1;
    this.groupsBySectionId = new Map();
    this._masterRamp = null;
  }

  activate(ownerId, sectionIds) {
    if (typeof ownerId !== 'string' || ownerId.length === 0) {
      throw new Error('Live Touch brightness ownerId must be a non-empty string');
    }
    if (!Array.isArray(sectionIds) || sectionIds.length === 0) {
      throw new Error('Live Touch brightness requires the complete model section set');
    }
    const nextGroups = new Map();
    for (const sectionId of sectionIds) {
      if (!Number.isInteger(sectionId) || sectionId <= 0) {
        throw new Error(
          `Live Touch sectionId must be a positive integer, got ${JSON.stringify(sectionId)}`,
        );
      }
      if (nextGroups.has(sectionId)) {
        throw new Error(`duplicate Live Touch sectionId ${sectionId}`);
      }
      nextGroups.set(sectionId, 1);
    }
    this.active = true;
    this.ownerId = ownerId;
    this.master = 1;
    this.groupsBySectionId = nextGroups;
    this._masterRamp = null;
    this.revision += 1;
    return this.getState();
  }

  reset(ownerId = null) {
    if (ownerId !== null && this.active && ownerId !== this.ownerId) {
      throw new Error(`Live Touch brightness is owned by '${this.ownerId}', not '${ownerId}'`);
    }
    const changed = this.active || this.ownerId !== null || this.master !== 1
      || this.groupsBySectionId.size > 0 || this._masterRamp !== null;
    this.active = false;
    this.ownerId = null;
    this.master = 1;
    this.groupsBySectionId = new Map();
    this._masterRamp = null;
    if (changed) this.revision += 1;
    return this.getState();
  }

  replace(ownerId, expectedRevision, master, groupsBySectionId) {
    const validated = this.validateReplacement(
      ownerId,
      expectedRevision,
      master,
      groupsBySectionId,
    );
    this.master = validated.master;
    this.groupsBySectionId = validated.groupsBySectionId;
    this._masterRamp = null;
    this.revision += 1;
    return this.getState();
  }

  validateReplacement(ownerId, expectedRevision, master, groupsBySectionId) {
    this._assertOwner(ownerId);
    requireRevision(expectedRevision, this.revision);
    requireUnitInterval(master, 'master');
    if (!(groupsBySectionId instanceof Map)) {
      throw new Error('groupsBySectionId must be a Map');
    }
    if (groupsBySectionId.size !== this.groupsBySectionId.size) {
      throw new Error(
        `Live Touch brightness requires ${this.groupsBySectionId.size} groups, `
          + `got ${groupsBySectionId.size}`,
      );
    }
    const nextGroups = new Map();
    for (const sectionId of this.groupsBySectionId.keys()) {
      if (!groupsBySectionId.has(sectionId)) {
        throw new Error(`Live Touch brightness is missing sectionId ${sectionId}`);
      }
      nextGroups.set(
        sectionId,
        requireUnitInterval(groupsBySectionId.get(sectionId), `group sectionId ${sectionId}`),
      );
    }
    for (const sectionId of groupsBySectionId.keys()) {
      if (!this.groupsBySectionId.has(sectionId)) {
        throw new Error(`unknown Live Touch sectionId ${sectionId}`);
      }
    }
    return { master, groupsBySectionId: nextGroups };
  }

  patch(ownerId, expectedRevision, patch) {
    this._assertOwner(ownerId);
    requireRevision(expectedRevision, this.revision);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('Live Touch brightness patch must be an object');
    }
    const hasMaster = Object.prototype.hasOwnProperty.call(patch, 'master');
    const hasGroupsField = Object.prototype.hasOwnProperty.call(patch, 'groupsBySectionId');
    if (hasGroupsField && !(patch.groupsBySectionId instanceof Map)) {
      throw new Error('groupsBySectionId must be a Map');
    }
    const hasGroups = hasGroupsField && patch.groupsBySectionId.size > 0;
    if (!hasMaster && !hasGroups) {
      throw new Error('Live Touch brightness patch must contain master or at least one group');
    }

    // Validate the complete patch before mutating any live state. A combined
    // master + group request is one optimistic-concurrency transaction: an
    // unknown/invalid group must not leave the master changed under the old
    // revision after the request reports failure.
    const nextMaster = hasMaster ? requireUnitInterval(patch.master, 'master') : this.master;
    const nextGroups = new Map(this.groupsBySectionId);
    if (hasGroups) {
      for (const [sectionId, value] of patch.groupsBySectionId) {
        if (!this.groupsBySectionId.has(sectionId)) {
          throw new Error(`unknown Live Touch sectionId ${sectionId}`);
        }
        nextGroups.set(sectionId, requireUnitInterval(value, `group sectionId ${sectionId}`));
      }
    }

    this.master = nextMaster;
    this.groupsBySectionId = nextGroups;
    if (hasMaster) this._masterRamp = null;
    this.revision += 1;
    return this.getState();
  }

  startMasterFade(ownerId, expectedRevision, target, durationMs) {
    this._assertOwner(ownerId);
    requireRevision(expectedRevision, this.revision);
    requireUnitInterval(target, 'target');
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)
        || durationMs <= 0 || durationMs > LIVE_MASTER_FADE_MAX_MS) {
      throw new Error(
        `durationMs must be a finite number in (0,${LIVE_MASTER_FADE_MAX_MS}], `
          + `got ${JSON.stringify(durationMs)}`,
      );
    }
    this._tick();
    const startedAtMs = this._now();
    this._masterRamp = { from: this.master, to: target, startedAtMs, durationMs };
    this.revision += 1;
    return this.getState();
  }

  apply(pixels) {
    if (!this.active) return;
    this._tick();
    for (const pixel of pixels) {
      const group = this.groupsBySectionId.get(pixel.sId);
      if (group === undefined) {
        throw new Error(`Live Touch brightness has no factor for sectionId ${pixel.sId}`);
      }
      const scale = this.master * group;
      for (const lane of PIXEL_LANES) {
        pixel[lane] = Math.max(0, Math.min(1, pixel[lane])) * scale;
      }
    }
  }

  applyBuffer(buffer6ch, modelPixels) {
    if (!this.active) return;
    if (!(buffer6ch instanceof Uint8Array)) {
      throw new Error('Live Touch output buffer must be a Uint8Array');
    }
    if (!Array.isArray(modelPixels)
        || buffer6ch.length !== modelPixels.length * PIXEL_LANES.length) {
      throw new Error(
        `Live Touch output/model size mismatch: ${buffer6ch.length} lanes for `
        + `${Array.isArray(modelPixels) ? modelPixels.length : 'invalid'} pixels`,
      );
    }
    this._tick();
    for (let pixelIndex = 0; pixelIndex < modelPixels.length; pixelIndex++) {
      const group = this.groupsBySectionId.get(modelPixels[pixelIndex].sId);
      if (group === undefined) {
        throw new Error(
          `Live Touch brightness has no factor for sectionId ${modelPixels[pixelIndex].sId}`,
        );
      }
      const scale = this.master * group;
      const offset = pixelIndex * PIXEL_LANES.length;
      for (let laneIndex = 0; laneIndex < PIXEL_LANES.length; laneIndex++) {
        buffer6ch[offset + laneIndex] = Math.round(buffer6ch[offset + laneIndex] * scale);
      }
    }
  }

  getState() {
    this._tick();
    return {
      active: this.active,
      ownerId: this.ownerId,
      revision: this.revision,
      master: this.master,
      groupsBySectionId: new Map(this.groupsBySectionId),
      masterFade: this._masterRamp === null ? null : { ...this._masterRamp },
    };
  }

  _assertOwner(ownerId) {
    if (!this.active) {
      const error = new Error('Live Touch brightness is not active');
      error.code = 'TOUCH_BRIGHTNESS_INACTIVE';
      throw error;
    }
    if (ownerId !== this.ownerId) {
      const error = new Error(
        `Live Touch brightness is owned by '${this.ownerId}', not '${ownerId}'`,
      );
      error.code = 'TOUCH_BRIGHTNESS_WRONG_OWNER';
      throw error;
    }
  }

  _tick() {
    const ramp = this._masterRamp;
    if (ramp === null) return;
    const elapsed = this._now() - ramp.startedAtMs;
    if (elapsed >= ramp.durationMs) {
      this.master = ramp.to;
      this._masterRamp = null;
      return;
    }
    // Date.now() can move backwards when the host clock is corrected. Hold at
    // the ramp's starting level until time catches up; never extrapolate past
    // the safe [from,to] interval.
    const t = Math.max(0, elapsed / ramp.durationMs);
    const eased = t * t * (3 - 2 * t);
    this.master = ramp.from + (ramp.to - ramp.from) * eased;
  }
}
