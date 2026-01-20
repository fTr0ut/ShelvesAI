/**
 * BlurayDiscoveryAdapter
 * 
 * Scrapes blu-ray.com for new and upcoming Blu-ray/4K releases.
 * 
 * Sections scraped:
 * - New Pre-orders: Recently added pre-order titles
 * - New Releases: Recently released titles
 * - Upcoming Releases: Titles releasing soon (sorted by release date)
 * 
 * Note: The Blu-ray tabs (index 0) contain BOTH Blu-ray and 4K items.
 * The 4K tabs (index 1) are dynamically loaded and empty in raw HTML.
 * We parse the Blu-ray tabs and filter by format detection.
 */

const fetch = require('node-fetch');
const cheerio = require('cheerio');

class BlurayDiscoveryAdapter {
    // Format constants
    static FORMATS = {
        BLURAY: 'bluray',
        '4K': '4k',
        ALL: 'all'
    };

    // Section ID prefixes (we always use index 0 which contains all formats)
    static SECTIONS = {
        NEW_PREORDERS: 'newpreorderstabbody0',
        NEW_RELEASES: 'newmoviestabbody0',
        UPCOMING_RELEASES: 'upcomingmoviestabbody0'
    };

    constructor() {
        this.baseUrl = 'https://www.blu-ray.com';
    }

    isConfigured() {
        return true; // No API key needed for scraping
    }

    // ==================== NEW PRE-ORDERS ====================

    /**
     * Fetch new pre-orders for a specific format
     * @param {string} format - 'bluray', '4k', or 'all'
     */
    async fetchNewPreorders(format = BlurayDiscoveryAdapter.FORMATS.ALL) {
        return this._scrapeSection(BlurayDiscoveryAdapter.SECTIONS.NEW_PREORDERS, format);
    }

    async fetchNewPreorders4K() {
        return this.fetchNewPreorders(BlurayDiscoveryAdapter.FORMATS['4K']);
    }

    async fetchNewPreordersBluray() {
        return this.fetchNewPreorders(BlurayDiscoveryAdapter.FORMATS.BLURAY);
    }

    // ==================== NEW RELEASES ====================

    /**
     * Fetch new releases for a specific format
     * @param {string} format - 'bluray', '4k', or 'all'
     */
    async fetchNewReleases(format = BlurayDiscoveryAdapter.FORMATS.ALL) {
        return this._scrapeSection(BlurayDiscoveryAdapter.SECTIONS.NEW_RELEASES, format);
    }

    async fetchNewReleases4K() {
        return this.fetchNewReleases(BlurayDiscoveryAdapter.FORMATS['4K']);
    }

    async fetchNewReleasesBluray() {
        return this.fetchNewReleases(BlurayDiscoveryAdapter.FORMATS.BLURAY);
    }

    // ==================== UPCOMING RELEASES ====================

    /**
     * Fetch upcoming releases for a specific format
     * @param {string} format - 'bluray', '4k', or 'all'
     */
    async fetchUpcomingReleases(format = BlurayDiscoveryAdapter.FORMATS.ALL) {
        return this._scrapeSection(BlurayDiscoveryAdapter.SECTIONS.UPCOMING_RELEASES, format);
    }

    async fetchUpcomingReleases4K() {
        return this.fetchUpcomingReleases(BlurayDiscoveryAdapter.FORMATS['4K']);
    }

    async fetchUpcomingReleasesBluray() {
        return this.fetchUpcomingReleases(BlurayDiscoveryAdapter.FORMATS.BLURAY);
    }

    // ==================== PRIVATE METHODS ====================

    /**
     * Fetch the page HTML
     */
    async _fetchPage() {
        const response = await fetch(this.baseUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch ${this.baseUrl}: ${response.statusText}`);
        }

        return response.text();
    }

    /**
     * Scrape a specific section by ID
     * @param {string} sectionId - The section div ID
     * @param {string} format - 'bluray', '4k', or 'all'
     */
    async _scrapeSection(sectionId, format) {
        try {
            const html = await this._fetchPage();
            return this._parseSection(html, sectionId, format);
        } catch (error) {
            console.error(`[Bluray Adapter] Error scraping ${sectionId}:`, error.message);
            return [];
        }
    }

    /**
     * Detect if a title/URL is for a 4K release
     * @param {string} title - The movie title
     * @param {string} url - The source URL
     */
    _is4K(title, url) {
        const title4K = /\b4K\b/i.test(title);
        const url4K = /-4K-Blu-ray/i.test(url) || /4K-Blu-ray/i.test(url);
        return title4K || url4K;
    }

    /**
     * Parse a section from HTML
     * @param {string} html - The page HTML
     * @param {string} sectionId - The section div ID
     * @param {string} format - 'bluray', '4k', or 'all'
     */
    _parseSection(html, sectionId, format) {
        const $ = cheerio.load(html);
        const items = [];

        const container = $(`#${sectionId}`);

        if (!container.length) {
            console.warn(`[Bluray Adapter] Section "${sectionId}" not found`);
            return [];
        }

        // Find the table within the section
        const table = container.find('table').first();

        if (!table.length) {
            console.warn(`[Bluray Adapter] No table found in "${sectionId}"`);
            return [];
        }

        // Process each row (skip header row)
        table.find('tr').each((index, row) => {
            if (index === 0) return; // Skip header row

            const $row = $(row);
            const cells = $row.find('td');

            if (cells.length < 2) return;

            // Column 1 (index 0) is usually empty or contains a small indicator
            // Column 2 (index 1) contains the movie link/title
            // Column 3 (index 2) contains the date
            const titleCell = cells.eq(1);
            const dateCell = cells.eq(2);

            const link = titleCell.find('a').first();
            const href = link.attr('href');
            const rawTitle = link.text().trim();

            if (!rawTitle || !href) return;

            // Build full URL
            const movieUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;

            // Determine if this is a 4K release
            const is4K = this._is4K(rawTitle, movieUrl);

            // Filter by format
            if (format === BlurayDiscoveryAdapter.FORMATS['4K'] && !is4K) {
                return; // Skip non-4K items when filtering for 4K
            }
            if (format === BlurayDiscoveryAdapter.FORMATS.BLURAY && is4K) {
                return; // Skip 4K items when filtering for Blu-ray only
            }

            // Clean the title (remove format suffixes)
            const cleanTitle = rawTitle
                .replace(/ 4K \(.*?\)$/, '')
                .replace(/ 4K$/, '')
                .replace(/ Blu-ray$/, '')
                .replace(/ \(.*?\)$/, '') // Remove edition info in parentheses at end
                .trim();

            // Parse the date
            const dateText = dateCell.text().trim();
            const releaseDate = this._parseDate(dateText);

            items.push({
                title: cleanTitle,
                source_url: movieUrl,
                release_date: releaseDate,
                format: is4K ? '4K' : 'Blu-ray',
                raw_title: rawTitle // Keep original for debugging
            });
        });

        return items;
    }

    /**
     * Parse a date string like "Jan 19, 2026" into a Date object
     * @param {string} dateStr - The date string
     * @returns {Date|null}
     */
    _parseDate(dateStr) {
        if (!dateStr) return null;

        // Try parsing the date string directly
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
            return parsed;
        }

        // Try common formats like "Jan 19, 2026"
        const match = dateStr.match(/([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/);
        if (match) {
            const [, month, day, year] = match;
            const dateFromMatch = new Date(`${month} ${day}, ${year}`);
            if (!isNaN(dateFromMatch.getTime())) {
                return dateFromMatch;
            }
        }

        return null;
    }
}

module.exports = BlurayDiscoveryAdapter;
