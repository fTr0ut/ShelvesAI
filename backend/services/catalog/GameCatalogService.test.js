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
});
