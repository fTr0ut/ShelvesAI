const NytBooksDiscoveryAdapter = require('./NytBooksDiscoveryAdapter');
const fetch = require('node-fetch');

// Mock node-fetch
jest.mock('node-fetch');
const { Response } = jest.requireActual('node-fetch');

describe('NytBooksDiscoveryAdapter', () => {
    let adapter;

    // Mock NYT API overview response
    const mockOverviewResponse = {
        status: 'OK',
        copyright: 'Copyright (c) 2026 The New York Times Company.',
        num_results: 2,
        results: {
            bestsellers_date: '2026-01-18',
            published_date: '2026-01-19',
            lists: [
                {
                    list_name: 'Hardcover Fiction',
                    list_name_encoded: 'hardcover-fiction',
                    display_name: 'Hardcover Fiction',
                    books: [
                        {
                            rank: 1,
                            rank_last_week: 0,
                            weeks_on_list: 1,
                            primary_isbn13: '9780316258753',
                            primary_isbn10: '0316258754',
                            publisher: 'Little, Brown',
                            title: 'THE EXAMPLE BOOK',
                            author: 'Jane Author',
                            description: 'A thrilling novel about examples.',
                            book_image: 'https://covers.nyt.com/example.jpg',
                            amazon_product_url: 'https://amazon.com/dp/0316258754'
                        },
                        {
                            rank: 2,
                            rank_last_week: 1,
                            weeks_on_list: 5,
                            primary_isbn13: '9780316000001',
                            title: 'ANOTHER BOOK',
                            author: 'John Writer',
                            description: 'Another bestselling book.',
                            book_image: 'https://covers.nyt.com/another.jpg',
                            amazon_product_url: 'https://amazon.com/dp/0316000001'
                        }
                    ]
                },
                {
                    list_name: 'Hardcover Nonfiction',
                    list_name_encoded: 'hardcover-nonfiction',
                    display_name: 'Hardcover Nonfiction',
                    books: [
                        {
                            rank: 1,
                            rank_last_week: 1,
                            weeks_on_list: 10,
                            primary_isbn13: '9780316999999',
                            title: 'NONFICTION TITLE',
                            author: 'Expert Author',
                            description: 'An informative read.',
                            book_image: 'https://covers.nyt.com/nonfiction.jpg'
                        }
                    ]
                }
            ]
        }
    };

    // Mock NYT API list response
    const mockListResponse = {
        status: 'OK',
        results: {
            list_name: 'Hardcover Fiction',
            display_name: 'Hardcover Fiction',
            books: [
                {
                    rank: 1,
                    rank_last_week: 0,
                    weeks_on_list: 1,
                    primary_isbn13: '9780316258753',
                    title: 'THE EXAMPLE BOOK',
                    author: 'Jane Author',
                    description: 'A thrilling novel.',
                    book_image: 'https://covers.nyt.com/example.jpg'
                }
            ]
        }
    };

    beforeEach(() => {
        adapter = new NytBooksDiscoveryAdapter({
            apiKey: 'test-api-key',
            requestDelayMs: 0 // Disable delay for tests
        });
        jest.clearAllMocks();
    });

    describe('Configuration', () => {
        // Store original env to restore after tests
        const originalEnv = process.env.NYT_BOOKS_API_KEY;

        afterAll(() => {
            // Restore original env after all configuration tests
            if (originalEnv !== undefined) {
                process.env.NYT_BOOKS_API_KEY = originalEnv;
            } else {
                delete process.env.NYT_BOOKS_API_KEY;
            }
        });

        it('should be configured when API key is provided', () => {
            expect(adapter.isConfigured()).toBe(true);
        });

        it('should not be configured without API key', () => {
            // Explicitly clear any env key and pass empty string
            const savedEnv = process.env.NYT_BOOKS_API_KEY;
            delete process.env.NYT_BOOKS_API_KEY;

            const unconfigured = new NytBooksDiscoveryAdapter({ apiKey: '' });
            expect(unconfigured.isConfigured()).toBe(false);

            // Restore for other tests
            if (savedEnv !== undefined) {
                process.env.NYT_BOOKS_API_KEY = savedEnv;
            }
        });

        it('should read API key from environment variable', () => {
            const savedEnv = process.env.NYT_BOOKS_API_KEY;
            process.env.NYT_BOOKS_API_KEY = 'env-api-key';

            const envAdapter = new NytBooksDiscoveryAdapter();
            expect(envAdapter.isConfigured()).toBe(true);

            // Restore
            if (savedEnv !== undefined) {
                process.env.NYT_BOOKS_API_KEY = savedEnv;
            } else {
                delete process.env.NYT_BOOKS_API_KEY;
            }
        });

        it('should have correct base URL', () => {
            expect(adapter.baseUrl).toBe('https://api.nytimes.com/svc/books/v3');
        });
    });

    describe('fetchBestsellerOverview', () => {
        it('should fetch and normalize all bestseller lists', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify(mockOverviewResponse)));

            const results = await adapter.fetchBestsellerOverview();

            expect(results).toHaveLength(3); // 2 fiction + 1 nonfiction
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('should normalize book objects correctly', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify(mockOverviewResponse)));

            const results = await adapter.fetchBestsellerOverview();
            const firstBook = results[0];

            expect(firstBook.category).toBe('books');
            expect(firstBook.title).toBe('THE EXAMPLE BOOK');
            expect(firstBook.creators).toEqual(['Jane Author']);
            expect(firstBook.source_api).toBe('nyt');
            expect(firstBook.external_id).toBe('nyt:9780316258753');
            expect(firstBook.cover_image_url).toBe('https://covers.nyt.com/example.jpg');
            expect(firstBook.payload.rank).toBe(1);
            expect(firstBook.payload.weeks_on_list).toBe(1);
        });

        it('should set item_type to new_release for books with weeks_on_list === 1', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify(mockOverviewResponse)));

            const results = await adapter.fetchBestsellerOverview();
            const newRelease = results.find(b => b.payload.weeks_on_list === 1);

            expect(newRelease.item_type).toBe('new_release');
        });

        it('should set item_type to trending for books with rank <= 3', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify(mockOverviewResponse)));

            const results = await adapter.fetchBestsellerOverview();
            const trending = results.find(b => b.payload.rank <= 3 && b.payload.weeks_on_list > 1);

            expect(trending.item_type).toBe('trending');
        });

        it('should handle empty response', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify({ results: { lists: [] } })));

            const results = await adapter.fetchBestsellerOverview();

            expect(results).toEqual([]);
        });

        it('should handle malformed response', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify({ status: 'ERROR' })));

            const results = await adapter.fetchBestsellerOverview();

            expect(results).toEqual([]);
        });
    });

    describe('fetchList', () => {
        it('should fetch a specific bestseller list', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify(mockListResponse)));

            const results = await adapter.fetchList('hardcover-fiction');

            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('THE EXAMPLE BOOK');
        });

        it('should accept date parameter', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify(mockListResponse)));

            await adapter.fetchList('hardcover-fiction', '2026-01-15');

            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('/lists/2026-01-15/hardcover-fiction.json'),
                expect.any(Object)
            );
        });
    });

    describe('Specific list methods', () => {
        it('should fetch hardcover fiction', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify(mockListResponse)));

            const results = await adapter.fetchHardcoverFiction(10);

            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('hardcover-fiction'),
                expect.any(Object)
            );
        });

        it('should fetch hardcover nonfiction', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify(mockListResponse)));

            await adapter.fetchHardcoverNonfiction(10);

            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('hardcover-nonfiction'),
                expect.any(Object)
            );
        });

        it('should fetch young adult', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify(mockListResponse)));

            await adapter.fetchYoungAdult(10);

            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('young-adult-hardcover'),
                expect.any(Object)
            );
        });
    });

    describe('API key handling', () => {
        it('should include api-key in request URL', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify(mockOverviewResponse)));

            await adapter.fetchBestsellerOverview();

            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('api-key=test-api-key'),
                expect.any(Object)
            );
        });

        it('should throw error when not configured', async () => {
            // Must clear env var since adapter falls back to it
            const savedEnv = process.env.NYT_BOOKS_API_KEY;
            delete process.env.NYT_BOOKS_API_KEY;

            const unconfigured = new NytBooksDiscoveryAdapter({ apiKey: '' });

            await expect(unconfigured.fetchBestsellerOverview())
                .rejects.toThrow('NYT Books API key not configured');

            // Restore
            if (savedEnv !== undefined) {
                process.env.NYT_BOOKS_API_KEY = savedEnv;
            }
        });
    });

    describe('Error handling', () => {
        it('should handle rate limit errors (429)', async () => {
            fetch.mockResolvedValue(new Response('Rate limit exceeded', { status: 429 }));

            await expect(adapter.fetchBestsellerOverview())
                .rejects.toThrow('NYT rate limit exceeded (429)');
        });

        it('should handle API errors', async () => {
            fetch.mockResolvedValue(new Response('Not Found', { status: 404 }));

            await expect(adapter.fetchBestsellerOverview())
                .rejects.toThrow('NYT request failed with 404');
        });

        it('should handle network errors', async () => {
            fetch.mockRejectedValue(new Error('Network error'));

            await expect(adapter.fetchBestsellerOverview())
                .rejects.toThrow('Network error');
        });
    });

    describe('fetchAll', () => {
        it('should use overview endpoint', async () => {
            fetch.mockResolvedValue(new Response(JSON.stringify(mockOverviewResponse)));

            const results = await adapter.fetchAll();

            expect(results).toHaveLength(3);
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('/lists/overview.json'),
                expect.any(Object)
            );
        });
    });

    describe('Book normalization edge cases', () => {
        it('should handle missing author', async () => {
            const responseWithoutAuthor = {
                ...mockOverviewResponse,
                results: {
                    ...mockOverviewResponse.results,
                    lists: [{
                        list_name: 'Test',
                        list_name_encoded: 'test',
                        books: [{ title: 'No Author Book', rank: 1 }]
                    }]
                }
            };
            fetch.mockResolvedValue(new Response(JSON.stringify(responseWithoutAuthor)));

            const results = await adapter.fetchBestsellerOverview();

            expect(results[0].creators).toEqual([]);
        });

        it('should handle missing cover image', async () => {
            const responseWithoutImage = {
                ...mockOverviewResponse,
                results: {
                    ...mockOverviewResponse.results,
                    lists: [{
                        list_name: 'Test',
                        list_name_encoded: 'test',
                        books: [{ title: 'No Image Book', rank: 1 }]
                    }]
                }
            };
            fetch.mockResolvedValue(new Response(JSON.stringify(responseWithoutImage)));

            const results = await adapter.fetchBestsellerOverview();

            expect(results[0].cover_image_url).toBeNull();
        });

        it('should generate external_id from title when ISBN missing', async () => {
            const responseWithoutIsbn = {
                ...mockOverviewResponse,
                results: {
                    ...mockOverviewResponse.results,
                    lists: [{
                        list_name: 'Test',
                        list_name_encoded: 'test',
                        books: [{ title: 'Book Without ISBN', rank: 1 }]
                    }]
                }
            };
            fetch.mockResolvedValue(new Response(JSON.stringify(responseWithoutIsbn)));

            const results = await adapter.fetchBestsellerOverview();

            expect(results[0].external_id).toBe('nyt:book_without_isbn');
        });
    });
});
