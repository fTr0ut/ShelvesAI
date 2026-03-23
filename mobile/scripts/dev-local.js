/**
 * dev-local.js — Start Expo with a local API backend.
 *
 * Reads LOCAL_API_ADDRESS from the environment or .env.local,
 * ensures EXPO_PUBLIC_API_BASE is set in .env.local so Expo's
 * bundler picks it up (Expo re-reads .env files itself, so
 * process.env alone is not enough), and spawns `npx expo start`.
 *
 * Usage:
 *   npm run dev:local
 *   LOCAL_API_ADDRESS=http://192.168.1.5:5001 npm run dev:local
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const mobileRoot = path.join(__dirname, '..');
const envLocalPath = path.join(mobileRoot, '.env.local');

// ---------------------------------------------------------------------------
// Lightweight .env.local parser (no external dependencies)
// ---------------------------------------------------------------------------
const envLocalVars = {};
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    envLocalVars[key] = val;
    // Don't override vars already set in the shell environment
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

// ---------------------------------------------------------------------------
// Resolve the local API address
// ---------------------------------------------------------------------------
const localApi = process.env.LOCAL_API_ADDRESS || 'http://localhost:5001';
process.env.EXPO_PUBLIC_API_BASE = localApi;

// ---------------------------------------------------------------------------
// Ensure .env.local contains EXPO_PUBLIC_API_BASE so Expo's own
// env-file loader (which runs inside Metro) picks it up with higher
// priority than .env.  Without this, .env's production URL wins.
// ---------------------------------------------------------------------------
if (envLocalVars['EXPO_PUBLIC_API_BASE'] !== localApi) {
  const lines = fs.existsSync(envLocalPath)
    ? fs.readFileSync(envLocalPath, 'utf8').split('\n')
    : [];

  // Replace existing EXPO_PUBLIC_API_BASE line, or append one
  let replaced = false;
  const updated = lines.map((line) => {
    if (/^\s*EXPO_PUBLIC_API_BASE\s*=/.test(line)) {
      replaced = true;
      return `EXPO_PUBLIC_API_BASE=${localApi}`;
    }
    return line;
  });
  if (!replaced) {
    updated.push(`EXPO_PUBLIC_API_BASE=${localApi}`);
  }

  fs.writeFileSync(envLocalPath, updated.join('\n'));
}

console.log(`[dev:local] Connecting to local API at: ${localApi}`);

const child = spawn('npx', ['expo', 'start', '--clear'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
  cwd: mobileRoot,
});

child.on('exit', (code) => process.exit(code ?? 0));
