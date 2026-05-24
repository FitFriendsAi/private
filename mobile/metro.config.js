const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Allow importing from ../shared
config.watchFolders = [path.resolve(__dirname, "..")];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, "../node_modules"),
];

// Pin memoize-one to the top-level version so Metro doesn't try to resolve
// react-native-web's nested v6 copy (whose ESM entry causes Metro resolver issues).
config.resolver.extraNodeModules = {
  "memoize-one": path.resolve(__dirname, "node_modules/memoize-one"),
};

module.exports = withNativeWind(config, { input: "./global.css" });
