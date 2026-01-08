const { GameCatalogService } = require('./GameCatalogService');

describe('GameCatalogService.safeLookup', () => {
  const baseInput = {
    title: 'Super Mario 64',
    name: 'Super Mario 64',
    platform: 'Nintendo Switch',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createService(mockResults) {
    const service = new GameCatalogService({
      clientId: 'client',
      clientSecret: 'secret',
    });
    if (mockResults !== undefined) {
      jest.spyOn(service, 'callIgdb').mockResolvedValue(mockResults);
    } else {
      jest.spyOn(service, 'callIgdb');
    }
    return service;
  }

  it('omits category filters and prefers the earliest release year among exact matches', async () => {
    const olderRelease = {
      id: 2,
      name: 'Super Mario 64',
      first_release_date: Date.UTC(1996, 5, 23) / 1000,
      platforms: [{ name: 'Nintendo Switch' }],
    };

    const newerRelease = {
      id: 3,
      name: 'Super Mario 64',
      first_release_date: Date.UTC(2020, 8, 18) / 1000,
      platforms: [{ name: 'Nintendo Switch' }],
    };

    const service = createService([newerRelease, olderRelease]);

    const result = await service.safeLookup(baseInput);

    expect(result).toBeTruthy();
    expect(result.game).toBe(olderRelease);

    const query = service.callIgdb.mock.calls[0][1];
    expect(query).not.toContain('category =');
  });

  it('respects the configured concurrency limit during lookupFirstPass', async () => {
    const service = new GameCatalogService({
      clientId: 'client',
      clientSecret: 'secret',
      concurrency: 1,
      requestsPerSecond: 100,
    });

    const items = Array.from({ length: 4 }, (_, index) => ({
      title: `Test Game ${index}`,
      name: `Test Game ${index}`,
    }));

    let activeLookups = 0;
    let peakConcurrency = 0;

    jest.spyOn(service, 'safeLookup').mockImplementation(async () => {
      activeLookups += 1;
      peakConcurrency = Math.max(peakConcurrency, activeLookups);
      try {
        await Promise.resolve();
        return null;
      } finally {
        activeLookups -= 1;
      }
    });

    await service.lookupFirstPass(items, { concurrency: 5 });

    expect(peakConcurrency).toBeLessThanOrEqual(1);
  });

  it('throttles IGDB requests according to the configured rate', async () => {
    const response = {
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue([]),
      text: jest.fn().mockResolvedValue(''),
    };

    const fetchMock = jest.fn().mockResolvedValue(response);
    let currentTime = 1000;

    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

    const delayFn = jest
      .fn()
      .mockImplementation(async (ms) => {
        currentTime += ms;
      });

    const service = new GameCatalogService({
      clientId: 'client',
      clientSecret: 'secret',
      fetch: fetchMock,
      delayFn,
      concurrency: 1,
      requestsPerSecond: 1,
    });

    jest.spyOn(service, 'getAccessToken').mockResolvedValue('token');
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    await Promise.all([
      service.callIgdb('games', 'fields name;'),
      service.callIgdb('games', 'fields summary;'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delayFn).toHaveBeenCalled();
    expect(infoSpy.mock.calls.some(([message]) =>
      typeof message === 'string' &&
      message.includes('[GameCatalogService.rateLimit] throttling'),
    )).toBe(true);

    const waitedMs = delayFn.mock.calls.map(([ms]) => ms);
    expect(waitedMs.some((ms) => ms >= 1000)).toBe(true);
  });

  it('prefers exact title matches over partial matches when choosing results', async () => {
    const partialMatch = {
      id: 4,
      name: 'Super Mario 64 DS',
      first_release_date: Date.UTC(2004, 10, 21) / 1000,
      platforms: [{ name: 'Nintendo Switch' }],
    };

    const exactMatch = {
      id: 5,
      name: 'Super Mario 64',
      first_release_date: Date.UTC(2015, 8, 24) / 1000,
      platforms: [{ name: 'Nintendo Switch' }],
    };

    const service = createService([partialMatch, exactMatch]);

    const result = await service.safeLookup(baseInput);

    expect(result).toBeTruthy();
    expect(result.game).toBe(exactMatch);

    const query = service.callIgdb.mock.calls[0][1];
    expect(query).not.toContain('category =');
  });

  it('retries with a platform filter when the first search yields no results', async () => {
    const fallbackResult = {
      id: 6,
      name: 'Super Mario 64',
      platforms: [{ name: 'Nintendo Switch' }],
    };

    const service = createService();
    service.callIgdb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([fallbackResult]);

    const result = await service.safeLookup(baseInput);

    expect(service.callIgdb).toHaveBeenCalledTimes(2);
    const firstQuery = service.callIgdb.mock.calls[0][1];
    const secondQuery = service.callIgdb.mock.calls[1][1];

    expect(firstQuery).not.toContain('platforms.name ~ *"Nintendo Switch"*');
    expect(secondQuery).toContain('platforms.name ~ *"Nintendo Switch"*');
    expect(secondQuery).toContain(
      'release_dates.platform.abbreviation ~ *"Nintendo Switch"*',
    );

    expect(result).toBeTruthy();
    expect(result.game).toBe(fallbackResult);
  });

  it('provides metadata when lookupFirstPass encounters IGDB rate limiting', async () => {
    const service = new GameCatalogService({
      clientId: 'client',
      clientSecret: 'secret',
    });

    jest
      .spyOn(service, 'safeLookup')
      .mockImplementation(async (item, retries, observer) => {
        observer?.onRateLimited?.({
          backoff: 500,
          attempt: 0,
          willRetry: true,
          item: { title: item?.title || item?.name || '' },
        });
        return null;
      });

    const items = [{ title: 'Test Game', name: 'Test Game' }];
    const results = await service.lookupFirstPass(items);

    expect(results.metadata).toBeTruthy();
    expect(results.metadata.igdbRateLimited).toBe(true);
    expect(Array.isArray(results.metadata.warnings)).toBe(true);
    expect(results.metadata.warnings[0]).toMatchObject({
      type: 'igdb-rate-limit',
      index: 0,
    });
  });
});
