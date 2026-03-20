const { MusicCatalogService } = require('./MusicCatalogService');
const { musicbrainzReleaseGroupToCollectable } = require('../../adapters/musicbrainz.adapter');

const ORIGINAL_MUSIC_ROUTER_ENV = process.env.MUSIC_CATALOG_USE_ROUTER;

beforeAll(() => {
  process.env.MUSIC_CATALOG_USE_ROUTER = 'false';
});

afterAll(() => {
  if (ORIGINAL_MUSIC_ROUTER_ENV == null) {
    delete process.env.MUSIC_CATALOG_USE_ROUTER;
  } else {
    process.env.MUSIC_CATALOG_USE_ROUTER = ORIGINAL_MUSIC_ROUTER_ENV;
  }
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildSampleReleaseGroup(overrides = {}) {
  return {
    id: 'rg-mbid-1234',
    title: 'Kind of Blue',
    disambiguation: '',
    'primary-type': 'Album',
    'secondary-types': [],
    'first-release-date': '1959-08-17',
    'artist-credit': [
      {
        name: 'Miles Davis',
        artist: { id: 'artist-mbid-1', name: 'Miles Davis' },
        joinphrase: '',
      },
    ],
    releases: [
      {
        id: 'release-mbid-1',
        title: 'Kind of Blue',
        'label-info': [
          { label: { id: 'label-mbid-1', name: 'Columbia' } },
        ],
      },
    ],
    tags: [{ name: 'jazz', count: 10 }, { name: 'modal jazz', count: 5 }],
    genres: [{ name: 'Jazz', count: 10 }],
    rating: { value: 4.8, 'votes-count': 200 },
    ...overrides,
  };
}

function buildSearchResponse(releaseGroups = []) {
  return {
    count: releaseGroups.length,
    offset: 0,
    'release-groups': releaseGroups,
  };
}

// ---------------------------------------------------------------------------
// MusicCatalogService — supportsShelfType
// ---------------------------------------------------------------------------

describe('MusicCatalogService.supportsShelfType', () => {
  it('returns true for vinyl-related shelf types', () => {
    const service = new MusicCatalogService();
    expect(service.supportsShelfType('vinyl')).toBe(true);
    expect(service.supportsShelfType('album')).toBe(true);
    expect(service.supportsShelfType('record')).toBe(true);
    expect(service.supportsShelfType('lp')).toBe(true);
  });

  it('returns false for non-vinyl shelf types', () => {
    const service = new MusicCatalogService();
    expect(service.supportsShelfType('movies')).toBe(false);
    expect(service.supportsShelfType('books')).toBe(false);
    expect(service.supportsShelfType('games')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MusicCatalogService — rankMatches
// ---------------------------------------------------------------------------

describe('MusicCatalogService.rankMatches', () => {
  let service;

  beforeEach(() => {
    service = new MusicCatalogService();
  });

  it('scores exact title match higher than partial match', () => {
    const results = [
      {
        id: '1',
        title: 'Kind of Blue Extended',
        'artist-credit': [],
        score: 80,
      },
      {
        id: '2',
        title: 'Kind of Blue',
        'artist-credit': [],
        score: 90,
      },
    ];

    const ranked = service.rankMatches(results, { title: 'Kind of Blue', artist: '' });
    expect(ranked[0].id).toBe('2');
  });

  it('adds bonus for exact artist match', () => {
    const results = [
      {
        id: '1',
        title: 'Kind of Blue',
        'artist-credit': [
          { name: 'John Coltrane', artist: { name: 'John Coltrane' } },
        ],
        score: 90,
      },
      {
        id: '2',
        title: 'Kind of Blue',
        'artist-credit': [
          { name: 'Miles Davis', artist: { name: 'Miles Davis' } },
        ],
        score: 90,
      },
    ];

    const ranked = service.rankMatches(results, { title: 'Kind of Blue', artist: 'Miles Davis' });
    expect(ranked[0].id).toBe('2');
  });

  it('adds bonus for primary type Album', () => {
    const results = [
      {
        id: '1',
        title: 'Kind of Blue',
        'primary-type': 'Single',
        'artist-credit': [],
        score: 90,
      },
      {
        id: '2',
        title: 'Kind of Blue',
        'primary-type': 'Album',
        'artist-credit': [],
        score: 90,
      },
    ];

    const ranked = service.rankMatches(results, { title: 'Kind of Blue', artist: '' });
    expect(ranked[0].id).toBe('2');
  });

  it('adds bonus for having first-release-date', () => {
    const results = [
      {
        id: '1',
        title: 'Kind of Blue',
        'artist-credit': [],
        score: 90,
      },
      {
        id: '2',
        title: 'Kind of Blue',
        'first-release-date': '1959-08-17',
        'artist-credit': [],
        score: 90,
      },
    ];

    const ranked = service.rankMatches(results, { title: 'Kind of Blue', artist: '' });
    expect(ranked[0].id).toBe('2');
  });

  it('uses API score field in ranking', () => {
    const results = [
      {
        id: '1',
        title: 'Kind of Blue',
        'artist-credit': [],
        score: 50,
      },
      {
        id: '2',
        title: 'Kind of Blue',
        'artist-credit': [],
        score: 100,
      },
    ];

    const ranked = service.rankMatches(results, { title: 'Kind of Blue', artist: '' });
    expect(ranked[0].id).toBe('2');
  });

  it('skips results without an id', () => {
    const results = [
      { title: 'No ID', 'artist-credit': [], score: 100 },
      { id: '2', title: 'Kind of Blue', 'artist-credit': [], score: 50 },
    ];

    const ranked = service.rankMatches(results, { title: 'Kind of Blue', artist: '' });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe('2');
  });
});

// ---------------------------------------------------------------------------
// MusicCatalogService — safeLookup
// ---------------------------------------------------------------------------

describe('MusicCatalogService.safeLookup', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createService(searchResponse, detailsResponse) {
    const service = new MusicCatalogService({ retries: 0 });
    jest.spyOn(service, 'searchReleaseGroups').mockResolvedValue(searchResponse);
    jest.spyOn(service, 'fetchReleaseGroupDetails').mockResolvedValue(detailsResponse);
    return service;
  }

  it('returns null when title is empty', async () => {
    const service = new MusicCatalogService({ retries: 0 });
    const result = await service.safeLookup({ title: '' });
    expect(result).toBeNull();
  });

  it('returns null when search returns no results', async () => {
    const service = createService(buildSearchResponse([]), null);
    const result = await service.safeLookup({ title: 'Kind of Blue' });
    expect(result).toBeNull();
  });

  it('returns null when search returns null', async () => {
    const service = createService(null, null);
    const result = await service.safeLookup({ title: 'Kind of Blue' });
    expect(result).toBeNull();
  });

  it('returns enrichment object on successful lookup', async () => {
    const rg = buildSampleReleaseGroup({ id: 'rg-1', score: 95 });
    const searchResponse = buildSearchResponse([rg]);
    const detailsResponse = buildSampleReleaseGroup({ id: 'rg-1' });

    const service = createService(searchResponse, detailsResponse);
    const result = await service.safeLookup({ title: 'Kind of Blue', author: 'Miles Davis' });

    expect(result).toBeTruthy();
    expect(result.provider).toBe('musicbrainz');
    expect(result.releaseGroup).toBe(detailsResponse);
    expect(result.search.query).toMatchObject({ title: 'Kind of Blue', artist: 'Miles Davis' });
  });

  it('returns null when details fetch returns null', async () => {
    const rg = buildSampleReleaseGroup({ id: 'rg-1', score: 95 });
    const searchResponse = buildSearchResponse([rg]);

    const service = createService(searchResponse, null);
    const result = await service.safeLookup({ title: 'Kind of Blue' });
    expect(result).toBeNull();
  });

  it('retries on 429 error and succeeds on second attempt', async () => {
    const service = new MusicCatalogService({ retries: 1, delayFn: jest.fn() });
    const rg = buildSampleReleaseGroup({ id: 'rg-1', score: 95 });
    const detailsResponse = buildSampleReleaseGroup({ id: 'rg-1' });

    jest.spyOn(service, 'searchReleaseGroups')
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValueOnce(buildSearchResponse([rg]));
    jest.spyOn(service, 'fetchReleaseGroupDetails').mockResolvedValue(detailsResponse);

    const result = await service.safeLookup({ title: 'Kind of Blue' });
    expect(result).toBeTruthy();
    expect(result.provider).toBe('musicbrainz');
  });

  it('retries on 503 error', async () => {
    const service = new MusicCatalogService({ retries: 1, delayFn: jest.fn() });
    const rg = buildSampleReleaseGroup({ id: 'rg-1', score: 95 });
    const detailsResponse = buildSampleReleaseGroup({ id: 'rg-1' });

    jest.spyOn(service, 'searchReleaseGroups')
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce(buildSearchResponse([rg]));
    jest.spyOn(service, 'fetchReleaseGroupDetails').mockResolvedValue(detailsResponse);

    const result = await service.safeLookup({ title: 'Kind of Blue' });
    expect(result).toBeTruthy();
  });

  it('returns null on 404 error', async () => {
    const service = new MusicCatalogService({ retries: 0 });
    jest.spyOn(service, 'searchReleaseGroups')
      .mockRejectedValue(new Error('404 Not Found'));

    const result = await service.safeLookup({ title: 'Kind of Blue' });
    expect(result).toBeNull();
  });

  it('throws on unexpected errors', async () => {
    const service = new MusicCatalogService({ retries: 0 });
    jest.spyOn(service, 'searchReleaseGroups')
      .mockRejectedValue(new Error('Network failure'));

    await expect(service.safeLookup({ title: 'Kind of Blue' })).rejects.toThrow('Network failure');
  });

  it('uses router lookup path when enabled', async () => {
    const service = new MusicCatalogService({ retries: 0, useRouter: true });
    const routerResult = { title: 'Kind of Blue', kind: 'album', _metadataScore: 70 };
    jest.spyOn(service, 'routerLookup').mockResolvedValue(routerResult);

    const result = await service.safeLookup({ title: 'Kind of Blue' });

    expect(service.routerLookup).toHaveBeenCalledTimes(1);
    expect(result).toBe(routerResult);
  });
});

// ---------------------------------------------------------------------------
// MusicCatalogService — buildCollectablePayload
// ---------------------------------------------------------------------------

describe('MusicCatalogService.buildCollectablePayload', () => {
  let service;

  beforeEach(() => {
    service = new MusicCatalogService();
  });

  it('returns null for unresolved entries', () => {
    const entry = { status: 'unresolved', input: { title: 'Kind of Blue' } };
    expect(service.buildCollectablePayload(entry, {}, 'lwf')).toBeNull();
  });

  it('returns null when enrichment is missing', () => {
    const entry = { status: 'resolved' };
    expect(service.buildCollectablePayload(entry, {}, 'lwf')).toBeNull();
  });

  it('maps musicbrainz enrichment to collectable payload', () => {
    const rg = buildSampleReleaseGroup();
    const entry = {
      status: 'resolved',
      enrichment: {
        provider: 'musicbrainz',
        score: 95,
        releaseGroup: rg,
      },
    };
    const lwf = 'test-lwf';

    const collectable = service.buildCollectablePayload(entry, {}, lwf);

    expect(collectable).toBeTruthy();
    expect(collectable.kind).toBe('album');
    expect(collectable.type).toBe('album');
    expect(collectable.title).toBe('Kind of Blue');
    expect(collectable.primaryCreator).toBe('Miles Davis');
    expect(collectable.year).toBe('1959');
    expect(collectable.publisher).toBe('Columbia');
    expect(collectable.genre).toEqual(['Jazz']);
    expect(collectable.tags).toEqual(expect.arrayContaining(['jazz', 'modal jazz']));
    expect(collectable.identifiers.musicbrainz.releaseGroup).toEqual(['rg-mbid-1234']);
    expect(collectable.sources[0].provider).toBe('musicbrainz');
    expect(collectable.images).toHaveLength(1);
    expect(collectable.images[0].kind).toBe('cover');
    expect(collectable.lightweightFingerprint).toBe(lwf);
    expect(collectable.fingerprint).toBeTruthy();
    expect(collectable.attribution.logoKey).toBe('musicbrainz');
  });

  it('sets fingerprint when missing from adapter output', () => {
    const rg = buildSampleReleaseGroup();
    const entry = {
      status: 'resolved',
      enrichment: {
        provider: 'musicbrainz',
        score: 95,
        releaseGroup: rg,
      },
    };

    const collectable = service.buildCollectablePayload(entry, {}, null);
    expect(collectable.fingerprint).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MusicCatalogService — lookupFirstPass
// ---------------------------------------------------------------------------

describe('MusicCatalogService.lookupFirstPass', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns unresolved entries when safeLookup returns null', async () => {
    const service = new MusicCatalogService({ concurrency: 1 });
    jest.spyOn(service, 'safeLookup').mockResolvedValue(null);

    const items = [{ title: 'Kind of Blue' }, { title: 'Bitches Brew' }];
    const results = await service.lookupFirstPass(items);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('unresolved');
    expect(results[1].status).toBe('unresolved');
  });

  it('returns resolved entries when safeLookup succeeds', async () => {
    const service = new MusicCatalogService({ concurrency: 1 });
    const enrichment = {
      provider: 'musicbrainz',
      score: 95,
      releaseGroup: buildSampleReleaseGroup(),
    };
    jest.spyOn(service, 'safeLookup').mockResolvedValue(enrichment);

    const items = [{ title: 'Kind of Blue' }];
    const results = await service.lookupFirstPass(items);

    expect(results[0].status).toBe('resolved');
    expect(results[0].enrichment).toBe(enrichment);
  });

  it('handles errors gracefully and marks items as unresolved', async () => {
    const service = new MusicCatalogService({ concurrency: 1 });
    jest.spyOn(service, 'safeLookup').mockRejectedValue(new Error('Network error'));

    const items = [{ title: 'Kind of Blue' }];
    const results = await service.lookupFirstPass(items);

    expect(results[0].status).toBe('unresolved');
  });

  it('returns empty array for empty input', async () => {
    const service = new MusicCatalogService();
    const results = await service.lookupFirstPass([]);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MusicCatalogService — enrichWithOpenAI (no-op)
// ---------------------------------------------------------------------------

describe('MusicCatalogService.enrichWithOpenAI', () => {
  it('returns all entries as unresolved (no-op)', async () => {
    const service = new MusicCatalogService();
    const unresolved = [
      { input: { title: 'Kind of Blue' } },
      { input: { title: 'Bitches Brew' } },
    ];
    const result = await service.enrichWithOpenAI(unresolved);
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('unresolved');
    expect(result[1].status).toBe('unresolved');
  });

  it('returns empty array for empty input', async () => {
    const service = new MusicCatalogService();
    const result = await service.enrichWithOpenAI([]);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// musicbrainzReleaseGroupToCollectable (adapter)
// ---------------------------------------------------------------------------

describe('musicbrainzReleaseGroupToCollectable', () => {
  it('returns null for null input', () => {
    expect(musicbrainzReleaseGroupToCollectable(null)).toBeNull();
  });

  it('returns null when id is missing', () => {
    expect(musicbrainzReleaseGroupToCollectable({ title: 'No ID' })).toBeNull();
  });

  it('transforms a full release-group to collectable shape', () => {
    const rg = buildSampleReleaseGroup();
    const result = musicbrainzReleaseGroupToCollectable(rg);

    expect(result.kind).toBe('album');
    expect(result.type).toBe('album');
    expect(result.title).toBe('Kind of Blue');
    expect(result.primaryCreator).toBe('Miles Davis');
    expect(result.creators).toEqual(['Miles Davis']);
    expect(result.year).toBe('1959');
    expect(result.publisher).toBe('Columbia');
    expect(result.genre).toEqual(['Jazz']);
    expect(result.tags).toEqual(expect.arrayContaining(['jazz', 'modal jazz']));
    expect(result.identifiers.musicbrainz.releaseGroup).toEqual(['rg-mbid-1234']);
    expect(result.identifiers.musicbrainz.release).toEqual(['release-mbid-1']);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].kind).toBe('cover');
    expect(result.images[0].urlSmall).toContain('front-250');
    expect(result.images[0].urlMedium).toContain('front-500');
    expect(result.images[0].urlLarge).toContain('/front');
    expect(result.images[0].provider).toBe('coverartarchive');
    expect(result.sources[0].provider).toBe('musicbrainz');
    expect(result.sources[0].ids.releaseGroup).toBe('rg-mbid-1234');
    expect(result.coverImageUrl).toContain('front-500');
    expect(result.coverImageSource).toBe('external');
    expect(result.attribution.logoKey).toBe('musicbrainz');
    expect(result.attribution.linkText).toBe('View on MusicBrainz');
    expect(result.extras.primaryType).toBe('Album');
    expect(result.extras.firstReleaseDate).toBe('1959-08-17');
    expect(result.fingerprint).toBeTruthy();
    expect(result.lightweightFingerprint).toBeTruthy();
  });

  it('handles missing artist-credit gracefully', () => {
    const rg = buildSampleReleaseGroup({ 'artist-credit': [] });
    const result = musicbrainzReleaseGroupToCollectable(rg);
    expect(result.primaryCreator).toBeNull();
    expect(result.creators).toEqual([]);
  });

  it('handles missing releases gracefully', () => {
    const rg = buildSampleReleaseGroup({ releases: [] });
    const result = musicbrainzReleaseGroupToCollectable(rg);
    expect(result.publisher).toBeNull();
    expect(result.identifiers.musicbrainz.release).toBeUndefined();
  });

  it('handles missing tags and genres gracefully', () => {
    const rg = buildSampleReleaseGroup({ tags: [], genres: [] });
    const result = musicbrainzReleaseGroupToCollectable(rg);
    expect(result.tags).toEqual([]);
    expect(result.genre).toEqual([]);
  });

  it('uses provided lightweightFingerprint option', () => {
    const rg = buildSampleReleaseGroup();
    const result = musicbrainzReleaseGroupToCollectable(rg, { lightweightFingerprint: 'custom-lwf' });
    expect(result.lightweightFingerprint).toBe('custom-lwf');
  });

  it('sets description from disambiguation', () => {
    const rg = buildSampleReleaseGroup({ disambiguation: 'Remastered edition' });
    const result = musicbrainzReleaseGroupToCollectable(rg);
    expect(result.description).toBe('Remastered edition');
  });

  it('sets description to null when disambiguation is empty', () => {
    const rg = buildSampleReleaseGroup({ disambiguation: '' });
    const result = musicbrainzReleaseGroupToCollectable(rg);
    expect(result.description).toBeNull();
  });
});
