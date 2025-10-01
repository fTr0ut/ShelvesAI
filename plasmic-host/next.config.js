const path = require('path');

/** @type {import('next').NextConfig} */
const reactNativeWeb = require.resolve('react-native-web')

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    externalDir: true,
  },
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@shared': path.resolve(__dirname, '../shared'),
      '@frontend': path.resolve(__dirname, '../frontend/src'),
      '@mobile': path.resolve(__dirname, '../mobile/src'),
      'react-native': reactNativeWeb,
    };
    return config;
  },
};

module.exports = nextConfig;
