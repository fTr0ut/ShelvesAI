const { loadApiEnv } = require('./loadEnv');

loadApiEnv();

const app = require('./server');
const logger = require('./logger');
const { pool } = require('./database/pg');
const { startNewsCacheScheduler } = require('./services/newsCacheScheduler');
const { startNewsSeenCleanupScheduler } = require('./services/newsSeenCleanupScheduler');
const { getWorkflowQueueService } = require('./services/workflowQueueService');

const PORT = process.env.PORT || 5001;

// Test PostgreSQL connection before starting server
pool.query('SELECT NOW()')
    .then(() => {
        logger.info('PostgreSQL connected');

        app.listen(PORT, () => {
            logger.info(`API listening on http://localhost:${PORT}`);
            startNewsCacheScheduler();
            startNewsSeenCleanupScheduler();
            getWorkflowQueueService().start();
        });
    })
    .catch((err) => {
        logger.error('PostgreSQL connection error', { error: err.message, stack: err.stack });
        process.exit(1);
    });
