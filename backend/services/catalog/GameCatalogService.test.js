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

  it('returns remasters even when they retain their version parent', async () => {
    const remaster = {
      id: 2,
      name: 'Super Mario 64',
      category: 9,
      version_parent: 1,
      platforms: [{ name: 'Nintendo Switch' }],
    };

    const service = createService([remaster]);

    const result = await service.safeLookup(baseInput);

    expect(result).toBeTruthy();
    expect(result.game).toBe(remaster);
    expect(result.game.version_parent).toBe(1);

    const query = service.callIgdb.mock.calls[0][1];
    expect(query).toContain('category = (8, 9, 10, 11)');
    expect(query).toContain('(category = 0 & version_parent = null)');
  });

  it('returns ports that would previously be filtered out', async () => {
    const port = {
      id: 3,
      name: 'Super Mario 64 3D',
      category: 11,
      version_parent: 1,
      platforms: [{ name: 'Nintendo 3DS' }],
    };

    const service = createService([port]);

    const result = await service.safeLookup({
      title: 'Super Mario 64 3D',
      name: 'Super Mario 64 3D',
      platform: 'Nintendo 3DS',
    });

    expect(result).toBeTruthy();
    expect(result.game).toBe(port);
    expect(result.game.category).toBe(11);

    const query = service.callIgdb.mock.calls[0][1];
    expect(query).toContain('category = (8, 9, 10, 11)');
  });

  it('retries with a platform filter when the first search yields no results', async () => {
    const fallbackResult = {
      id: 5,
      name: 'Super Mario 64',
      category: 9,
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
