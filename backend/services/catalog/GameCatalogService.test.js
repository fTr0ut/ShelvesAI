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
    jest.spyOn(service, 'callIgdb').mockResolvedValue(mockResults);
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
    expect(query).toContain('(category = 0 & version_parent = null) |');
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
});
