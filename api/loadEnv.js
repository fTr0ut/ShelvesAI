const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_LOADED_FLAG = '__SHELVES_API_ENV_LOADED__';
const LOCAL_DB_ENV_KEYS = new Set([
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_SSL',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_NAME',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_POOL',
  'POSTGRES_POOL_MAX',
  'DB_SSL',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
]);

function applyEnvFile(filePath, { override = false, includeKeys } = {}) {
  if (!fs.existsSync(filePath)) return;

  if (!includeKeys) {
    dotenv.config({ path: filePath, override });
    return;
  }

  const parsed = dotenv.parse(fs.readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (!includeKeys.has(key)) continue;
    if (!override && Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = value;
  }
}

function loadApiEnv() {
  if (global[ENV_LOADED_FLAG]) return;

  const envPath = path.join(__dirname, '.env');
  const envLocalPath = path.join(__dirname, '.env.local');

  applyEnvFile(envPath, { override: true });

  if (process.env.USE_LOCAL_DB) {
    applyEnvFile(envLocalPath, {
      override: true,
      includeKeys: LOCAL_DB_ENV_KEYS,
    });
  }

  global[ENV_LOADED_FLAG] = true;
}

module.exports = {
  LOCAL_DB_ENV_KEYS,
  loadApiEnv,
};
