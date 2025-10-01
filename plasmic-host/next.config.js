const path = require('path');

/** @type {import('next').NextConfig} */
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
    };
    return config;
  },
};

module.exports = nextConfig;
