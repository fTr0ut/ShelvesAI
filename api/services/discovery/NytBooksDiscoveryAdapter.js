/**
 * NytBooksDiscoveryAdapter - Fetches bestseller books from New York Times Books API
 *
 * Uses NYT's Books API to populate news_items with bestseller lists.
 * See: https://developer.nytimes.com/docs/books-product/1/overview
 *
 * Rate Limits:
 *   - 500 requests per day
 *   - 5 requests per minute
 *   - Recommended: 12 second delay between requests
 * 
 * Lists are updated every Wednesday around 7:00 PM ET.
 */

const fetch = require('node-fetch');

const NYT_BASE_URL = 'https://api.nytimes.com/svc/books/v3';
const DEFAULT_TIMEOUT_MS = 10000;
const REQUEST_DELAY_MS = 12000; // NYT recommends 12 second delay

function normalizeString(value) {
    if (value == null) return '';
    return String(value).trim();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class NytBooksDiscoveryAdapter {
    constructor(options = {}) {
        this.apiKey = normalizeString(options.apiKey || process.env.NYT_BOOKS_API_KEY) || null;
        this.baseUrl = normalizeString(options.baseUrl) || NYT_BASE_URL;
        this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
        this.requestDelayMs = options.requestDelayMs ?? REQUEST_DELAY_MS;
        this.fetch = typeof options.fetch === 'function' ? options.fetch : fetch;

        this._lastRequestTime = 0;
    }

    isConfigured() {
        return !!this.apiKey;
    }

    /**
     * Fetch the bestseller overview - all lists with top 5 books each
     * This is the most efficient endpoint for discovery (single request)
     */
    async fetchBestsellerOverview() {
        const data = await this._fetchJson('/lists/overview.json');
        if (!data || !data.results || !Array.isArray(data.results.lists)) {
            return [];
        }

        const items = [];
        for (const list of data.results.lists) {
            const listName = list.list_name || list.display_name || 'Unknown';
            const listNameEncoded = list.list_name_encoded || '';

            for (const book of (list.books || [])) {
                // Determine item_type based on weeks_on_list
                let itemType = 'bestseller';
                if (book.weeks_on_list === 1) {
                    itemType = 'new_release';
                } else if (book.rank <= 3) {
                    itemType = 'trending';
                }

                items.push(this._normalizeBook(book, listName, listNameEncoded, itemType));
            }
        }

        return items;
    }

    /**
     * Fetch a specific bestseller list with full rankings
     * @param {string} listName - Encoded list name (e.g., 'hardcover-fiction')
     * @param {string} date - 'current' or 'YYYY-MM-DD'
     */
    async fetchList(listName, date = 'current') {
        const data = await this._fetchJson(`/lists/${date}/${listName}.json`);
        if (!data || !data.results || !Array.isArray(data.results.books)) {
            return [];
        }

        const displayName = data.results.display_name || listName;
        return data.results.books.map(book => {
            let itemType = 'bestseller';
            if (book.weeks_on_list === 1) {
                itemType = 'new_release';
            } else if (book.rank <= 3) {
                itemType = 'trending';
            }
            return this._normalizeBook(book, displayName, listName, itemType);
        });
    }

    /**
     * Fetch hardcover fiction bestsellers
     */
    async fetchHardcoverFiction(limit = 20) {
        const books = await this.fetchList('hardcover-fiction');
        return books.slice(0, limit);
    }

    /**
     * Fetch hardcover nonfiction bestsellers
     */
    async fetchHardcoverNonfiction(limit = 20) {
        const books = await this.fetchList('hardcover-nonfiction');
        return books.slice(0, limit);
    }

    /**
     * Fetch young adult bestsellers
     */
    async fetchYoungAdult(limit = 20) {
        const books = await this.fetchList('young-adult-hardcover');
        return books.slice(0, limit);
    }

    /**
     * Fetch all content - uses overview endpoint for efficiency
     */
    async fetchAll() {
        return this.fetchBestsellerOverview();
    }

    /**
     * Normalize a book object to match news_items schema
     */
    _normalizeBook(book, listDisplayName, listNameEncoded, itemType) {
        // Extract author - NYT format varies
        const author = normalizeString(book.author || book.contributor || '');

        // Build source URL - link to NYT books page or Amazon
        const sourceUrl = book.book_uri
            ? `https://www.nytimes.com/books/best-sellers/${listNameEncoded}/`
            : (book.amazon_product_url || null);

        return {
            category: 'books',
            item_type: itemType,
            title: normalizeString(book.title),
            description: normalizeString(book.description),
            cover_image_url: book.book_image || null,
            release_date: null, // NYT doesn't provide publication dates
            creators: author ? [author] : [],
            franchises: [],
            genres: [listDisplayName], // Use the list name as a genre/category
            external_id: `nyt:${book.primary_isbn13 || book.primary_isbn10 || book.title.replace(/\s+/g, '_').toLowerCase()}`,
            source_api: 'nyt',
            source_url: sourceUrl,
            payload: {
                rank: book.rank || null,
                rank_last_week: book.rank_last_week || null,
                weeks_on_list: book.weeks_on_list || null,
                primary_isbn13: book.primary_isbn13 || null,
                primary_isbn10: book.primary_isbn10 || null,
                publisher: book.publisher || null,
                amazon_product_url: book.amazon_product_url || null,
                list_name: listDisplayName,
                list_name_encoded: listNameEncoded,
                book_image_width: book.book_image_width || null,
                book_image_height: book.book_image_height || null,
                author: author || null
            }
        };
    }

    /**
     * Fetch JSON from NYT API with rate limiting
     */
    async _fetchJson(endpoint, params = {}) {
        if (!this.apiKey) {
            throw new Error('NYT Books API key not configured');
        }

        // Enforce rate limiting
        const now = Date.now();
        const timeSinceLastRequest = now - this._lastRequestTime;
        if (timeSinceLastRequest < this.requestDelayMs && this._lastRequestTime > 0) {
            const waitTime = this.requestDelayMs - timeSinceLastRequest;
            await sleep(waitTime);
        }

        const url = new URL(`${this.baseUrl}${endpoint}`);
        url.searchParams.set('api-key', this.apiKey);

        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            this._lastRequestTime = Date.now();

            const response = await this.fetch(url.toString(), {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'ShelvesAI/1.0'
                }
            });

            if (response.status === 429) {
                throw new Error('NYT rate limit exceeded (429). Try again later.');
            }

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`NYT request failed with ${response.status}: ${text.slice(0, 200)}`);
            }

            return await response.json();
        } finally {
            clearTimeout(timeout);
        }
    }
}

module.exports = NytBooksDiscoveryAdapter;
