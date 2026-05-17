// metro.config.js — pin Metro to this app and ignore the parent.
//
// PortWatch lives at control_podium/PortWatch/, alongside the firmware
// and Pi-bridge sources. Metro must NOT walk up into control_podium/
// itself — there's no Node project up there, but if a `package.json`
// ever lands in a sibling folder (or someone runs `npm install` at the
// repo root), Metro's default hierarchical resolution would happily
// pick up unrelated node_modules and confuse Expo's auto-entry
// detection.
//
// We lock Metro to our directory by:
//   * pinning projectRoot + watchFolders to __dirname
//   * setting nodeModulesPaths to ONLY our local node_modules
//   * blockList'ing every file under control_podium/ that isn't inside
//     PortWatch/, which makes the parent's node_modules unreachable
//     even though Node's hierarchical lookup would normally walk up
//     there.
//
// We deliberately DO leave Node's hierarchical lookup enabled (do not
// set disableHierarchicalLookup: true) because npm sometimes splits
// transitive dependencies into nested node_modules folders — for
// example `expo-asset` lands at `node_modules/expo/node_modules/`
// instead of the top level. Hierarchical lookup is what lets Metro
// find those nested copies; the blockList keeps resolution from
// escaping the project once it walks past our own node_modules.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.projectRoot = projectRoot;
config.watchFolders = [projectRoot];

config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules")];

const escape = (s) => s.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
const parentDir = path.resolve(projectRoot, "..");
const sep = escape(path.sep);
config.resolver.blockList = [
  new RegExp(
    `^${escape(parentDir)}${sep}(?!PortWatch(?:${sep}|$)).*`,
  ),
];

module.exports = config;
