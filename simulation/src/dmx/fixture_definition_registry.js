/**
 * fixture_definition_registry.js — Central registry for fixture model definitions.
 *
 * Loads fixture model YAMLs at startup from dmx/fixtures directories.
 * Provides getDefinition(fixtureType) and listTypes() for the simulation.
 *
 * A fixture definition contains:
 *   - id, name, fixture_type, channel_mode
 *   - dimensions (physical size)
 *   - pixels (channel-to-color mapping, dot positions)
 *   - controls (human-readable channel descriptions)
 *   - shell (visual body description)
 */

// Fixture definitions keyed by fixture_type (e.g. "UkingPar")
const _definitions = {};

/**
 * Initialize the registry from pre-loaded model YAML objects.
 * Called at startup after fetching fixture model files.
 *
 * @param {Object} fixtureModelsMap - { fixtureType: parsedModelObject }
 *                                    e.g. { "UkingPar": { id, name, ... } }
 */
export function initRegistry(fixtureModelsMap) {
  Object.keys(_definitions).forEach(k => delete _definitions[k]);

  for (const [type, model] of Object.entries(fixtureModelsMap)) {
    if (!model || !model.fixture_type) {
      console.warn(`[FixtureRegistry] Skipping invalid model for type '${type}': missing fixture_type`);
      continue;
    }

    // Compute channel footprint from pixels
    let maxChannel = 0;
    if (model.pixels) {
      for (const pixel of model.pixels) {
        if (pixel.channels) {
          for (const ch of Object.values(pixel.channels)) {
            if (typeof ch === 'number' && ch > maxChannel) maxChannel = ch;
          }
        }
      }
    }

    _definitions[model.fixture_type] = {
      id: model.id,
      name: model.name,
      fixtureType: model.fixture_type,
      channelMode: model.channel_mode || maxChannel,
      footprint: model.channel_mode || maxChannel,
      dimensions: model.dimensions || { width: 150, height: 150, depth: 120 },
      shell: model.shell || null,
      pixels: model.pixels || [],
      controls: model.controls || [],
      // Rendering defaults for simple fixtures (will be used by DmxFixtureRuntime)
      defaultColor: '#ffaa44',
      defaultAngle: 20,
      defaultIntensity: 5,
      defaultPenumbra: 0.5,
    };
  }

  console.log(`[FixtureRegistry] Loaded ${Object.keys(_definitions).length} fixture type(s):`,
    Object.keys(_definitions).join(', '));
}

/**
 * Get a fixture definition by type.
 * @param {string} fixtureType - e.g. "UkingPar"
 * @returns {Object|null}
 */
export function getDefinition(fixtureType) {
  return _definitions[fixtureType] || null;
}

/**
 * List all registered fixture type names.
 * @returns {string[]}
 */
export function listTypes() {
  return Object.keys(_definitions);
}

/**
 * Get all registered definitions.
 * @returns {Object} - keyed by fixtureType
 */
export function getAllDefinitions() {
  return { ..._definitions };
}

/**
 * Extract the RGB channel indices from a fixture definition's first pixel.
 * Returns { red, green, blue, dimmer } channel numbers (1-indexed) or null.
 * @param {string} fixtureType
 * @returns {Object|null}
 */
export function getRGBChannels(fixtureType) {
  const def = _definitions[fixtureType];
  if (!def || !def.pixels || def.pixels.length === 0) return null;

  const firstPixel = def.pixels[0];
  if (!firstPixel.channels) return null;

  return {
    red: firstPixel.channels.red || null,
    green: firstPixel.channels.green || null,
    blue: firstPixel.channels.blue || null,
    dimmer: firstPixel.channels.dimmer || null,
    white: firstPixel.channels.white || null,
    amber: firstPixel.channels.amber || null,
  };
}
