const BlurayDiscoveryAdapter = require('./BlurayDiscoveryAdapter');
const fetch = require('node-fetch');

// Mock node-fetch
jest.mock('node-fetch');
const { Response } = jest.requireActual('node-fetch');

describe('BlurayDiscoveryAdapter', () => {
    let adapter;

    // Mock HTML that matches the actual blu-ray.com structure
    // The Blu-ray tab (index 0) contains BOTH Blu-ray and 4K items
    const createMockHtml = (sectionId, movies) => {
        const rows = movies.map(m => `
            <tr>
                <td></td>
                <td><a href="${m.href}">${m.title}</a></td>
                <td>${m.date}</td>
            </tr>
        `).join('');

        return `
            <html>
            <body>
                <div id="${sectionId}">
                    <table>
                        <tr><th>Movie</th><th>Release date</th></tr>
                        ${rows}
                    </table>
                </div>
            </body>
            </html>
        `;
    };

    beforeEach(() => {
        adapter = new BlurayDiscoveryAdapter();
        jest.clearAllMocks();
    });

    describe('Configuration', () => {
        it('should be configured', () => {
            expect(adapter.isConfigured()).toBe(true);
        });

        it('should have correct base URL', () => {
            expect(adapter.baseUrl).toBe('https://www.blu-ray.com');
        });
    });

    describe('Format Detection', () => {
        it('should detect 4K from title', () => {
            expect(adapter._is4K('The Matrix 4K', '/movies/test/')).toBe(true);
            expect(adapter._is4K('4K Ultra HD Edition', '/movies/test/')).toBe(true);
        });

        it('should detect 4K from URL', () => {
            expect(adapter._is4K('The Matrix', '/movies/The-Matrix-4K-Blu-ray/12345/')).toBe(true);
        });

        it('should detect non-4K correctly', () => {
            expect(adapter._is4K('The Matrix', '/movies/The-Matrix-Blu-ray/12345/')).toBe(false);
        });
    });

    describe('New Pre-orders', () => {
        const mixedMovies = [
            { href: '/movies/Matrix-4K-Blu-ray/12345/', title: 'The Matrix 4K', date: 'Jan 19, 2026' },
            { href: '/movies/Inception-Blu-ray/67890/', title: 'Inception', date: 'Jan 20, 2026' }
        ];

        it('should fetch all pre-orders', async () => {
            const mockHtml = createMockHtml('newpreorderstabbody0', mixedMovies);
            fetch.mockResolvedValue(new Response(mockHtml));

            const results = await adapter.fetchNewPreorders();

            expect(results).toHaveLength(2);
        });

        it('should filter for 4K pre-orders', async () => {
            const mockHtml = createMockHtml('newpreorderstabbody0', mixedMovies);
            fetch.mockResolvedValue(new Response(mockHtml));

            const results = await adapter.fetchNewPreorders4K();

            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('The Matrix');
            expect(results[0].format).toBe('4K');
        });

        it('should filter for Blu-ray pre-orders', async () => {
            const mockHtml = createMockHtml('newpreorderstabbody0', mixedMovies);
            fetch.mockResolvedValue(new Response(mockHtml));

            const results = await adapter.fetchNewPreordersBluray();

            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('Inception');
            expect(results[0].format).toBe('Blu-ray');
        });
    });

    describe('New Releases', () => {
        const mixedMovies = [
            { href: '/movies/Dune-4K-Blu-ray/11111/', title: 'Dune 4K', date: 'Mar 10, 2026' },
            { href: '/movies/Avatar-Blu-ray/22222/', title: 'Avatar', date: 'Apr 20, 2026' }
        ];

        it('should filter for 4K new releases', async () => {
            const mockHtml = createMockHtml('newmoviestabbody0', mixedMovies);
            fetch.mockResolvedValue(new Response(mockHtml));

            const results = await adapter.fetchNewReleases4K();

            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('Dune');
            expect(results[0].format).toBe('4K');
        });

        it('should filter for Blu-ray new releases', async () => {
            const mockHtml = createMockHtml('newmoviestabbody0', mixedMovies);
            fetch.mockResolvedValue(new Response(mockHtml));

            const results = await adapter.fetchNewReleasesBluray();

            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('Avatar');
            expect(results[0].format).toBe('Blu-ray');
        });
    });

    describe('Upcoming Releases', () => {
        const mixedMovies = [
            { href: '/movies/Gladiator-II-4K-Blu-ray/33333/', title: 'Gladiator II 4K', date: 'May 25, 2026' },
            { href: '/movies/Tenet-Blu-ray/44444/', title: 'Tenet', date: 'Jun 30, 2026' }
        ];

        it('should filter for 4K upcoming releases', async () => {
            const mockHtml = createMockHtml('upcomingmoviestabbody0', mixedMovies);
            fetch.mockResolvedValue(new Response(mockHtml));

            const results = await adapter.fetchUpcomingReleases4K();

            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('Gladiator II');
            expect(results[0].format).toBe('4K');
        });

        it('should filter for Blu-ray upcoming releases', async () => {
            const mockHtml = createMockHtml('upcomingmoviestabbody0', mixedMovies);
            fetch.mockResolvedValue(new Response(mockHtml));

            const results = await adapter.fetchUpcomingReleasesBluray();

            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('Tenet');
            expect(results[0].format).toBe('Blu-ray');
        });
    });

    describe('Error Handling', () => {
        it('should handle missing sections gracefully', async () => {
            const mockHtml = `<html><body>No content</body></html>`;
            fetch.mockResolvedValue(new Response(mockHtml));

            const releases = await adapter.fetchNewReleases4K();
            expect(releases).toEqual([]);
        });

        it('should handle fetch errors', async () => {
            fetch.mockRejectedValue(new Error('Network error'));

            const releases = await adapter.fetchNewReleases4K();
            expect(releases).toEqual([]);
        });

        it('should handle empty tables', async () => {
            const mockHtml = `
                <html><body>
                    <div id="newmoviestabbody0">
                        <table><tr><th>Movie</th><th>Date</th></tr></table>
                    </div>
                </body></html>
            `;
            fetch.mockResolvedValue(new Response(mockHtml));

            const releases = await adapter.fetchNewReleases4K();
            expect(releases).toEqual([]);
        });
    });

    describe('Date Parsing', () => {
        it('should parse dates correctly', async () => {
            const mockHtml = createMockHtml('newmoviestabbody0', [
                { href: '/movies/Test-4K-Blu-ray/1/', title: 'Test 4K', date: 'Dec 25, 2025' }
            ]);
            fetch.mockResolvedValue(new Response(mockHtml));

            const results = await adapter.fetchNewReleases4K();

            expect(results[0].release_date.getFullYear()).toBe(2025);
            expect(results[0].release_date.getMonth()).toBe(11); // December is 11 (0-indexed)
            expect(results[0].release_date.getDate()).toBe(25);
        });

        it('should handle invalid dates', async () => {
            const mockHtml = createMockHtml('newmoviestabbody0', [
                { href: '/movies/Test-4K-Blu-ray/1/', title: 'Test 4K', date: 'Invalid Date' }
            ]);
            fetch.mockResolvedValue(new Response(mockHtml));

            const results = await adapter.fetchNewReleases4K();

            expect(results[0].release_date).toBeNull();
        });
    });

    describe('Multiple Items', () => {
        it('should parse multiple 4K movies from a section', async () => {
            const mockHtml = createMockHtml('newmoviestabbody0', [
                { href: '/movies/Movie1-4K-Blu-ray/1/', title: 'Movie One 4K', date: 'Jan 01, 2026' },
                { href: '/movies/Movie2-Blu-ray/2/', title: 'Movie Two', date: 'Jan 02, 2026' },
                { href: '/movies/Movie3-4K-Blu-ray/3/', title: 'Movie Three 4K', date: 'Jan 03, 2026' }
            ]);
            fetch.mockResolvedValue(new Response(mockHtml));

            const results = await adapter.fetchNewReleases4K();

            expect(results).toHaveLength(2); // Only 4K items
            expect(results[0].title).toBe('Movie One');
            expect(results[1].title).toBe('Movie Three');
        });
    });
});
