const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);
defaultConfig.server.enhanceMiddleware = (middleware) => middleware;

module.exports = mergeConfig(defaultConfig, {});
