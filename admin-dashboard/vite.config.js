import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

function buildCsp(isDev) {
  const connectSrc = ["'self'", 'https:'];
  if (isDev) {
    connectSrc.push('ws:', 'wss:');
  }

  const scriptSrc = ["'self'"];
  if (isDev) {
    // React Fast Refresh requires unsafe-eval for HMR and unsafe-inline
    // for the preamble script that @vitejs/plugin-react injects.
    scriptSrc.push("'unsafe-eval'", "'unsafe-inline'");
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    `connect-src ${connectSrc.join(' ')}`,
    "font-src 'self' data:",
    "object-src 'none'",
  ].join('; ');
}

function buildSecurityHeaders(isDev) {
  return {
    'Content-Security-Policy': buildCsp(isDev),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isDev = mode === 'development' || mode === 'localdev';
  const headers = buildSecurityHeaders(isDev);
  const apiTarget = env.API_TARGET || 'http://localhost:5001';

  return {
    plugins: [react(), basicSsl()],
    server: {
      port: 5173,
      headers,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/media': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      headers,
    },
  };
});
