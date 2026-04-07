import yaml from 'js-yaml';

/**
 * Parse a full YAML string into the internal model format.
 */
export function loadModelFromYaml(yamlString) {
  try {
    const doc = yaml.load(yamlString);
    return doc.model;
  } catch (e) {
    console.error("YAML Parse Error:", e);
    return null;
  }
}

/**
 * Serialize the internal model back to YAML.
 */
export function serializeModelToYaml(model) {
  try {
    return yaml.dump({ model }, { sortKeys: false, lineWidth: -1 });
  } catch (e) {
    console.error("YAML Dump Error:", e);
    return "";
  }
}
