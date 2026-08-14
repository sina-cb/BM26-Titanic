function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function touchControlOwner(req) {
  const raw = req.headers['x-touch-control-owner'];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function groupsByNameToSectionMap(groups, dimmerGroups, exhaustive) {
  if (!isPlainObject(groups)) {
    throw new Error('groups must be an object keyed by stable Dimmer Rack group name');
  }
  const knownNames = Object.keys(dimmerGroups);
  const suppliedNames = Object.keys(groups);
  if (exhaustive && suppliedNames.length !== knownNames.length) {
    throw new Error(`groups must contain all ${knownNames.length} model groups exactly once`);
  }
  if (!exhaustive && suppliedNames.length === 0) {
    throw new Error('groups patch must contain at least one group');
  }
  const out = new Map();
  for (const name of suppliedNames) {
    if (!Object.prototype.hasOwnProperty.call(dimmerGroups, name)) {
      throw new Error(`unknown Dimmer Rack group '${name}'`);
    }
    const value = groups[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`group '${name}' must be a finite number in [0,1], got ${JSON.stringify(value)}`);
    }
    const sectionId = dimmerGroups[name];
    if (out.has(sectionId)) {
      throw new Error(`model groups resolve to duplicate sectionId ${sectionId}`);
    }
    out.set(sectionId, value);
  }
  if (exhaustive) {
    for (const name of knownNames) {
      if (!Object.prototype.hasOwnProperty.call(groups, name)) {
        throw new Error(`groups is missing Dimmer Rack group '${name}'`);
      }
    }
  }
  return out;
}

export function serializeTouchBrightness(liveBrightness, dimmerGroups, sectionBrightness) {
  const state = liveBrightness.getState();
  const groups = {};
  const rackCeilings = {};
  const effectiveCaps = {};
  for (const [name, sectionId] of Object.entries(dimmerGroups)) {
    const liveGroup = state.groupsBySectionId.get(sectionId);
    const rack = sectionBrightness[sectionId] === undefined ? 1 : sectionBrightness[sectionId];
    groups[name] = liveGroup === undefined ? 1 : liveGroup;
    rackCeilings[name] = rack;
    effectiveCaps[name] = rack * state.master * groups[name];
  }
  return {
    active: state.active,
    ownerId: state.ownerId,
    revision: state.revision,
    master: state.master,
    groups,
    rackCeilings,
    effectiveCaps,
    masterFade: state.masterFade,
  };
}

export function statusForTouchBrightnessError(error) {
  if (error && error.code === 'TOUCH_BRIGHTNESS_STALE_REVISION') return 409;
  if (error && error.code === 'TOUCH_BRIGHTNESS_INACTIVE') return 409;
  if (error && error.code === 'TOUCH_BRIGHTNESS_WRONG_OWNER') return 403;
  return 400;
}
