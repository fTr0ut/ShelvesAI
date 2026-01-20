const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TmdbDiscoveryAdapter = require('../services/discovery/TmdbDiscoveryAdapter');

async function testSearch() {
    const tmdb = new TmdbDiscoveryAdapter();

    if (!tmdb.isConfigured()) {
        console.error('TMDB not configured!');
        process.exit(1);
    }

    const testTitles = [
        'TRON: Ares',
        'The Matrix',
        'Dune: Part Two',
        'Gladiator II'
    ];

    for (const title of testTitles) {
        console.log(`\nSearching for: "${title}"`);
        try {
            const results = await tmdb.searchMovie({ title });
            console.log(`  Found ${results.length} results`);
            if (results.length > 0) {
                console.log(`  Top match: ${results[0].title} (${results[0].release_date})`);
            }
        } catch (err) {
            console.error(`  Error: ${err.message}`);
        }
    }

    process.exit(0);
}

testSearch();
