const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer.babelTransformerPath = require.resolve('./yaml-transformer.js');
config.resolver.sourceExts.push('yaml', 'yml');

module.exports = config;
