const yaml = require('js-yaml');
const upstreamTransformer = require('@expo/metro-config/babel-transformer');

module.exports.transform = async ({ src, filename, options, ...rest }) => {
  if (filename.endsWith('.yaml') || filename.endsWith('.yml')) {
    try {
      const parsed = yaml.load(src);
      const jsCode = `export default ${JSON.stringify(parsed)};`;
      return upstreamTransformer.transform({ src: jsCode, filename, options, ...rest });
    } catch (err) {
      throw new Error(`Failed to transform YAML file ${filename}: ${err.message}`);
    }
  }
  return upstreamTransformer.transform({ src, filename, options, ...rest });
};
