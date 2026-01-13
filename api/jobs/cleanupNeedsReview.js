/**
 * Cleanup Job: Delete expired needs_review records
 * 
 * Run weekly (or as needed) to delete pending review items older than 7 days.
 * 
 * Usage:
 *   node jobs/cleanupNeedsReview.js
 * 
 * Or schedule with cron:
 *   0 3 * * 0 cd /path/to/api && node jobs/cleanupNeedsReview.js >> logs/cleanup.log 2>&1
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const needsReviewQueries = require('../database/queries/needsReview');

const EXPIRY_DAYS = parseInt(process.env.NEEDS_REVIEW_EXPIRY_DAYS || '7', 10);

async function runCleanup() {
    console.log(`[Cleanup] Starting needs_review cleanup (expiry: ${EXPIRY_DAYS} days)...`);
    console.log(`[Cleanup] Timestamp: ${new Date().toISOString()}`);

    try {
        const deletedCount = await needsReviewQueries.deleteExpired(EXPIRY_DAYS);
        console.log(`[Cleanup] Deleted ${deletedCount} expired pending review items.`);
        process.exit(0);
    } catch (err) {
        console.error('[Cleanup] Error:', err);
        process.exit(1);
    }
}

runCleanup();
