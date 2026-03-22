const { query } = require('../database/pg');
const path = require('path');
const logger = require('../logger');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function checkBluray() {
    try {
        const res = await query("SELECT count(*) as count, item_type FROM news_items WHERE payload->>'original_source' = 'blu-ray.com' GROUP BY item_type ORDER BY item_type");
        logger.info('Blu-ray items by type:');
        for (const row of res.rows) {
            logger.info(`  ${row.item_type}: ${row.count} items`);
        }

        // Check enrichment rate
        const enriched = await query("SELECT count(*) as count FROM news_items WHERE payload->>'original_source' = 'blu-ray.com' AND payload->>'tmdb_match' = 'true'");
        const total = await query("SELECT count(*) as count FROM news_items WHERE payload->>'original_source' = 'blu-ray.com'");
        logger.info(`\nEnrichment: ${enriched.rows[0].count}/${total.rows[0].count} items have TMDB data`);

    } catch (err) {
        logger.error('Query failed:', err);
    }
    process.exit(0);
}

checkBluray();
