const path = require('path')
const {
    getSentryExpoConfig
} = require("@sentry/react-native/metro");

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getSentryExpoConfig(projectRoot)

config.watchFolders = [...(config.watchFolders || []), path.resolve(workspaceRoot, 'shared')]

// Add SVG transformer support
config.transformer = {
    ...config.transformer,
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
}
config.resolver = {
    ...config.resolver,
    assetExts: config.resolver.assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...config.resolver.sourceExts, 'svg'],
}

module.exports = config