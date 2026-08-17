// Metro configuration for the grabit-engine isolation demo.
//
// grabit-engine is consumed straight from source: the bare import
// `grabit-engine` is aliased to the package's RN source index
// (../src/index.native.ts). No npm dependency, no tarball, no package-exports
// resolution — editing anything under the package's src/ hot-reloads here.
//
// Because that source lives outside this project, Metro must (1) watch it and
// (2) know where the package's own runtime deps are. Package exports and TS
// transpilation from node_modules are defaults in Expo SDK 57.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const packageRoot = path.resolve(projectRoot, '..');

/** Resolve a package's root directory (not its entry file) so subpath imports keep working. */
const pkgRoot = (name) => path.dirname(require.resolve(`${name}/package.json`));

const config = getDefaultConfig(projectRoot);

// grabit-engine is symlinked into node_modules from the repo root (see
// package.json: "grabit-engine": "file:.."). That symlink is NOT a tarball —
// it points at the live package folder, and Metro reads its source directly:
// the package's "react-native" export condition resolves to src/index.native.ts.
// Editing anything under the package's src/ hot-reloads here.
//
// Metro must watch that source and find the package's own runtime deps, since
// they live outside this project.
config.watchFolders = [path.join(packageRoot, 'src'), path.join(packageRoot, 'node_modules')];

config.resolver = {
	...config.resolver,
	// Demo deps first, then the package's own node_modules (cheerio, tldts, …).
	// react / react-native live only in the demo, so no duplicate-React hazard.
	nodeModulesPaths: [path.join(projectRoot, 'node_modules'), path.join(packageRoot, 'node_modules')],
	extraNodeModules: {
		...(config.resolver.extraNodeModules || {}),
		// Only Node builtin grabit-engine touches directly (src/services/crypto.ts).
		crypto: pkgRoot('react-native-quick-crypto'),
		// Required by react-native-quick-crypto itself, not by grabit-engine.
		stream: pkgRoot('readable-stream'),
		buffer: pkgRoot('@craftzdog/react-native-buffer'),
	},
};

module.exports = config;
