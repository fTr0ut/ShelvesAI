/**
 * Raw Output Debug Script for BlurayDiscoveryAdapter
 * 
 * Run with: node api/services/discovery/rawBlurayOutput.js
 * 
 * This script outputs the raw data from the BlurayDiscoveryAdapter
 * to help diagnose data issues.
 */

const BlurayDiscoveryAdapter = require('./BlurayDiscoveryAdapter');
const logger = require('../../logger');

async function main() {
    const adapter = new BlurayDiscoveryAdapter();

    logger.info('='.repeat(80));
    logger.info('BLURAY DISCOVERY ADAPTER - RAW OUTPUT DEBUG');
    logger.info('='.repeat(80));
    logger.info(`Timestamp: ${new Date().toISOString()}`);
    logger.info(`Base URL: ${adapter.baseUrl}`);
    logger.info(`Is Configured: ${adapter.isConfigured()}`);
    logger.info('='.repeat(80));

    const sections = [
        { name: 'NEW PRE-ORDERS (4K)', method: 'fetchNewPreorders4K' },
        { name: 'NEW PRE-ORDERS (Blu-ray)', method: 'fetchNewPreordersBluray' },
        { name: 'NEW RELEASES (4K)', method: 'fetchNewReleases4K' },
        { name: 'NEW RELEASES (Blu-ray)', method: 'fetchNewReleasesBluray' },
        { name: 'UPCOMING RELEASES (4K)', method: 'fetchUpcomingReleases4K' },
        { name: 'UPCOMING RELEASES (Blu-ray)', method: 'fetchUpcomingReleasesBluray' }
    ];

    for (const section of sections) {
        logger.info(`\n>>> FETCHING ${section.name}...\n`);

        try {
            const results = await adapter[section.method]();
            logger.info(`Total Found: ${results.length}`);
            logger.info('-'.repeat(80));

            if (results.length > 0) {
                // Show first 5 items
                const preview = results.slice(0, 5);
                logger.info('PREVIEW (first 5 items):');
                logger.info(JSON.stringify(preview, null, 2));

                if (results.length > 5) {
                    logger.info(`... and ${results.length - 5} more items`);
                }

                // Data quality check
                logger.info('\nDATA QUALITY:');
                const withDates = results.filter(r => r.release_date).length;
                const withUrls = results.filter(r => r.source_url).length;
                logger.info(`  Items with valid dates: ${withDates}/${results.length}`);
                logger.info(`  Items with valid URLs: ${withUrls}/${results.length}`);
            } else {
                logger.info('No items found.');
            }

            logger.info('-'.repeat(80));
        } catch (error) {
            logger.error(`ERROR: ${error.message}`);
            logger.error('Stack:', error.stack);
        }
    }

    logger.info('\n' + '='.repeat(80));
    logger.info('DEBUG COMPLETE');
    logger.info('='.repeat(80));
}

main().catch((err) => {
    logger.error('[rawBlurayOutput] fatal', {
        error: err.message,
        stack: err.stack,
    });
});
