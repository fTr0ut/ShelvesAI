const { query } = require('../database/pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function checkBluray() {
    try {
        const res = await query("SELECT count(*) as count, item_type FROM news_items WHERE payload->>'original_source' = 'blu-ray.com' GROUP BY item_type ORDER BY item_type");
        console.log('Blu-ray items by type:');
        for (const row of res.rows) {
            console.log(`  ${row.item_type}: ${row.count} items`);
        }

        // Check enrichment rate
        const enriched = await query("SELECT count(*) as count FROM news_items WHERE payload->>'original_source' = 'blu-ray.com' AND payload->>'tmdb_match' = 'true'");
        const total = await query("SELECT count(*) as count FROM news_items WHERE payload->>'original_source' = 'blu-ray.com'");
        console.log(`\nEnrichment: ${enriched.rows[0].count}/${total.rows[0].count} items have TMDB data`);

    } catch (err) {
        console.error('Query failed:', err);
    }
    process.exit(0);
}

checkBluray();
