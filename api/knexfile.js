require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

const connection = connectionString
    ? { connectionString, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'shelvesai',
        user: process.env.DB_USER || 'shelves',
        password: process.env.DB_PASSWORD || 'localdev123',
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
