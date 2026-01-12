#!/usr/bin/env node
/**
 * TMDB Test Script
 * 
 * Accepts JSON input (file or stdin) and runs lookups via TmdbAdapter.
 * 
 * Usage:
 *   node scripts/test-tmdb.js --file input.json
 *   cat input.json | node scripts/test-tmdb.js
 * 
 * Input format:
 *   [{ "title": "The Matrix", "year": 1999, "director": "The Wachowskis" }, ...]
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const TmdbAdapter = require('../services/catalog/adapters/TmdbAdapter');

async function readInput() {
    const args = process.argv.slice(2);
    const fileIndex = args.indexOf('--file');

    if (fileIndex !== -1 && args[fileIndex + 1]) {
        const filePath = path.resolve(args[fileIndex + 1]);
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    }

    // Read from stdin
    return new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', chunk => { data += chunk; });
        process.stdin.on('end', () => {
            try {
                resolve(JSON.parse(data));
            } catch (err) {
                reject(new Error(`Invalid JSON input: ${err.message}`));
            }
        });
        process.stdin.on('error', reject);

        // Timeout for stdin if no data
        setTimeout(() => {
            if (!data) {
                reject(new Error('No input received. Use --file <path> or pipe JSON to stdin.'));
            }
        }, 1000);
    });
}

async function main() {
    const adapter = new TmdbAdapter();

    if (!adapter.isConfigured()) {
        console.error('Error: TMDB_API_KEY not configured in environment.');
        process.exit(1);
    }

    let items;
    try {
        items = await readInput();
    } catch (err) {
        console.error(`Input error: ${err.message}`);
        process.exit(1);
    }

    if (!Array.isArray(items)) {
        items = [items];
    }

    console.error(`[test-tmdb] Processing ${items.length} item(s)...`);

    const results = [];

    for (const item of items) {
        const normalizedItem = {
            title: item.title || item.name,
            year: item.year,
            author: item.author || item.director || item.primaryCreator,
            format: item.format,
        };

        console.error(`  -> Looking up: "${normalizedItem.title}"${normalizedItem.year ? ` (${normalizedItem.year})` : ''}`);

        try {
            const result = await adapter.lookup(normalizedItem);
            results.push({
                input: item,
                resolved: result !== null,
                collectable: result,
            });
        } catch (err) {
            console.error(`     Error: ${err.message}`);
            results.push({
                input: item,
                resolved: false,
                error: err.message,
            });
        }
    }

    const resolved = results.filter(r => r.resolved).length;
    console.error(`\n[test-tmdb] Complete: ${resolved}/${items.length} resolved`);

    // Output results as JSON to stdout
    console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
});
