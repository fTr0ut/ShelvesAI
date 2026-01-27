require('dotenv').config();

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sslEnabled =
    process.env.POSTGRES_SSL === 'true' ||
    process.env.POSTGRES_SSL === 'require' ||
    process.env.DB_SSL === 'true';
const sslConfig = sslEnabled ? { rejectUnauthorized: false } : false;

const connection = connectionString
    ? { connectionString, ssl: sslConfig }
    : {
        host: process.env.POSTGRES_HOST || process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || process.env.DB_PORT || '5432', 10),
        database: process.env.POSTGRES_NAME || process.env.POSTGRES_DB || process.env.DB_NAME || 'shelvesai',
        user: process.env.POSTGRES_USER || process.env.DB_USER || 'shelves',
        password: process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || 'localdev123',
        ssl: sslConfig,
    };

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
