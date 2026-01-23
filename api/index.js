// Load environment from api/.env
require('dotenv').config();

const app = require('./server');
const { pool } = require('./database/pg');
const { startNewsCacheScheduler } = require('./services/newsCacheScheduler');

const PORT = process.env.PORT || 5001;

// Test PostgreSQL connection before starting server
pool.query('SELECT NOW()')
    .then(() => {
        console.log('PostgreSQL connected');

        app.listen(PORT, () => {
            console.log(`API listening on http://localhost:${PORT}`);
            startNewsCacheScheduler();
        });
    })
    .catch((err) => {
        console.error('PostgreSQL connection error:', err);
        process.exit(1);
    });
