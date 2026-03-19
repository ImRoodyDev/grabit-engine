/**
 * @type {import('@jest/types').Config.InitialOptions}
 */
module.exports = {
	modulePathIgnorePatterns: ["<rootDir>/dist/"],
	// Allow these ESM modules to be transformed by Babel/Jest
	transformIgnorePatterns: ["/node_modules/(?!(@react-native|react-native|p-limit|yocto-queue|parse-duration)/)"]
};
