const path = require('path');
require('dotenv').config();
// Load .env.local overrides only when USE_LOCAL_DB is set
if (process.env.USE_LOCAL_DB) {
  require('dotenv').config({ path: path.join(__dirname, '.env.local'), override: true });
}

const isDevelopment = String(process.env.NODE_ENV || '').toLowerCase() === 'development';
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sslEnabled =
    process.env.POSTGRES_SSL === 'true' ||
    process.env.POSTGRES_SSL === 'require' ||
    process.env.DB_SSL === 'true';
const sslConfig = sslEnabled ? { rejectUnauthorized: false } : false;
const hasValue = (value) => typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
const dbPassword =
    process.env.POSTGRES_PASSWORD ||
    process.env.DB_PASSWORD ||
    (isDevelopment ? 'localdev123' : undefined);
const hasExplicitDbConfig =
    (hasValue(process.env.POSTGRES_HOST) || hasValue(process.env.DB_HOST)) &&
    (hasValue(process.env.POSTGRES_USER) || hasValue(process.env.DB_USER)) &&
    (hasValue(process.env.POSTGRES_NAME) || hasValue(process.env.POSTGRES_DB) || hasValue(process.env.DB_NAME)) &&
    (hasValue(process.env.POSTGRES_PASSWORD) || hasValue(process.env.DB_PASSWORD));

const connection = connectionString
    ? { connectionString, ssl: sslConfig }
    : {
        host: process.env.POSTGRES_HOST || process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || process.env.DB_PORT || '5432', 10),
        database: process.env.POSTGRES_NAME || process.env.POSTGRES_DB || process.env.DB_NAME || 'shelvesai',
        user: process.env.POSTGRES_USER || process.env.DB_USER || 'shelves',
        password: dbPassword,
        ssl: sslConfig,
    };

if (!isDevelopment && !connectionString && !hasExplicitDbConfig) {
    throw new Error('Missing explicit database configuration in non-development environment');
}

module.exports = {
    development: {
        client: 'pg',
        connection,
        migrations: {
            directory: './database/migrations',
        },
        seeds: {
            directory: './database/seeds',
        },
    },
    production: {
        client: 'pg',
        connection,
        migrations: {
            directory: './database/migrations',
        },
        seeds: {
            directory: './database/seeds',
        },
        pool: {
            min: 2,
            max: 10,
        },
    },
};
