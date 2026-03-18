import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function buildCsp(isDev) {
  const connectSrc = ["'self'", 'https:'];
  if (isDev) {
    connectSrc.push('ws:', 'wss:');
  }

  const scriptSrc = ["'self'"];
  if (isDev) {
    scriptSrc.push("'unsafe-eval'");
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
  const isDev = mode === 'development';
  const headers = buildSecurityHeaders(isDev);

  return {
    plugins: [react()],
    server: {
      port: 5173,
      headers,
      proxy: {
        '/api': {
          target: 'http://localhost:5001',
          changeOrigin: true,
        },
      },
    },
    preview: {
      headers,
    },
  };
});
