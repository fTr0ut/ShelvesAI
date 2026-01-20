/**
 * Raw Output Debug Script for BlurayDiscoveryAdapter
 * 
 * Run with: node api/services/discovery/rawBlurayOutput.js
 * 
 * This script outputs the raw data from the BlurayDiscoveryAdapter
 * to help diagnose data issues.
 */

const BlurayDiscoveryAdapter = require('./BlurayDiscoveryAdapter');

async function main() {
    const adapter = new BlurayDiscoveryAdapter();

    console.log('='.repeat(80));
    console.log('BLURAY DISCOVERY ADAPTER - RAW OUTPUT DEBUG');
    console.log('='.repeat(80));
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Base URL: ${adapter.baseUrl}`);
    console.log(`Is Configured: ${adapter.isConfigured()}`);
    console.log('='.repeat(80));

    const sections = [
        { name: 'NEW PRE-ORDERS (4K)', method: 'fetchNewPreorders4K' },
        { name: 'NEW PRE-ORDERS (Blu-ray)', method: 'fetchNewPreordersBluray' },
        { name: 'NEW RELEASES (4K)', method: 'fetchNewReleases4K' },
        { name: 'NEW RELEASES (Blu-ray)', method: 'fetchNewReleasesBluray' },
        { name: 'UPCOMING RELEASES (4K)', method: 'fetchUpcomingReleases4K' },
        { name: 'UPCOMING RELEASES (Blu-ray)', method: 'fetchUpcomingReleasesBluray' }
    ];

    for (const section of sections) {
        console.log(`\n>>> FETCHING ${section.name}...\n`);

        try {
            const results = await adapter[section.method]();
            console.log(`Total Found: ${results.length}`);
            console.log('-'.repeat(80));

            if (results.length > 0) {
                // Show first 5 items
                const preview = results.slice(0, 5);
                console.log('PREVIEW (first 5 items):');
                console.log(JSON.stringify(preview, null, 2));

                if (results.length > 5) {
                    console.log(`... and ${results.length - 5} more items`);
                }

                // Data quality check
                console.log('\nDATA QUALITY:');
                const withDates = results.filter(r => r.release_date).length;
                const withUrls = results.filter(r => r.source_url).length;
                console.log(`  Items with valid dates: ${withDates}/${results.length}`);
                console.log(`  Items with valid URLs: ${withUrls}/${results.length}`);
            } else {
                console.log('No items found.');
            }

            console.log('-'.repeat(80));
        } catch (error) {
            console.error(`ERROR: ${error.message}`);
            console.error('Stack:', error.stack);
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log('DEBUG COMPLETE');
    console.log('='.repeat(80));
}

main().catch(console.error);
