import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { transform } from 'esbuild';
import path from 'node:path';

const enableHmr = process.env.PLASMIC_HOST_ENABLE_HMR === 'true';

const jsAsJsxPlugin = (): Plugin => ({
  name: 'collector:js-as-jsx',
  enforce: 'pre' as const,
  async transform(code: string, id: string) {
    if (!id.endsWith('.js')) {
      return null;
    }
    if (!id.includes('/mobile/') && !id.includes('\\mobile\\')) {
      return null;
    }
    const patched = code
      .replace(/from\s+['"]react-native['"]/g, "from '@collector/react-native-shim'")
      .replace(/require\(['"]react-native['"]\)/g, "require('@collector/react-native-shim')");
    const result = await transform(patched, {
      loader: 'jsx',
      jsx: 'automatic',
      sourcefile: id,
    });
    return { code: result.code, map: result.map || undefined };
  },
});

export default defineConfig({
  root: path.resolve(__dirname),
  base: '/plasmic-host/',
  plugins: [jsAsJsxPlugin(), react({ include: [/\.jsx?$/, /\.tsx?$/] })],
  server: {
    host: '0.0.0.0',
    port: 3002,
    allowedHosts: ['nonresilient-rylan-nondebilitating.ngrok-free.dev'],
    hmr: enableHmr ? undefined : false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  esbuild: {
    loader: 'tsx',
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      '@frontend': path.resolve(__dirname, '../frontend/src'),
      '@mobile': path.resolve(__dirname, '../mobile/src'),
      react: path.resolve(__dirname, '../node_modules/react'),
      'react-dom/server': path.resolve(__dirname, '../node_modules/react-dom/server.browser.js'),
      'react-native': path.resolve(__dirname, 'shims/react-native.ts'),
      'react-native$': path.resolve(__dirname, 'shims/react-native.ts'),
      '@collector/react-native-shim': path.resolve(__dirname, 'shims/react-native.ts'),
      'react-native-web': path.resolve(__dirname, 'node_modules/react-native-web/dist/index.js'),
      'react-native-web/dist/index': path.resolve(__dirname, 'node_modules/react-native-web/dist/index.js'),
    },
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.web.js', '.web.ts', '.web.tsx'],
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
});

