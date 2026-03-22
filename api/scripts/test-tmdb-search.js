const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TmdbDiscoveryAdapter = require('../services/discovery/TmdbDiscoveryAdapter');
const logger = require('../logger');

async function testSearch() {
    const tmdb = new TmdbDiscoveryAdapter();

    if (!tmdb.isConfigured()) {
        logger.error('TMDB not configured!');
        process.exit(1);
    }

    const testTitles = [
        'TRON: Ares',
        'The Matrix',
        'Dune: Part Two',
        'Gladiator II'
    ];

    for (const title of testTitles) {
        logger.info(`\nSearching for: "${title}"`);
        try {
            const results = await tmdb.searchMovie({ title });
            logger.info(`  Found ${results.length} results`);
            if (results.length > 0) {
                logger.info(`  Top match: ${results[0].title} (${results[0].release_date})`);
            }
        } catch (err) {
            logger.error(`  Error: ${err.message}`);
        }
    }

    process.exit(0);
}

testSearch();
