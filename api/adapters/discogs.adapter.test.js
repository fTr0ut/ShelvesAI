const { discogsToCollectable } = require('./discogs.adapter');

describe('discogsToCollectable', () => {
  it('returns null when payload is missing id', () => {
    expect(discogsToCollectable({ title: 'Kind of Blue' })).toBeNull();
  });

  it('maps a Discogs release payload to collectable shape', () => {
    const payload = {
      id: 249504,
      title: 'Rick Astley - Never Gonna Give You Up',
      year: 1987,
      country: 'UK',
      genres: ['Pop'],
      styles: ['Synth-pop'],
      artists: [{ name: 'Rick Astley' }],
      labels: [{ name: 'RCA', catno: 'PB 41447' }],
      images: [
        {
          type: 'primary',
          uri: 'https://img.example.com/cover-600.jpg',
          uri150: 'https://img.example.com/cover-150.jpg',
        },
      ],
      resource_url: 'https://api.discogs.com/releases/249504',
      uri: 'https://www.discogs.com/release/249504',
    };

    const collectable = discogsToCollectable(payload);

    expect(collectable).toBeTruthy();
    expect(collectable.kind).toBe('album');
    expect(collectable.type).toBe('album');
    expect(collectable.title).toBe('Never Gonna Give You Up');
    expect(collectable.primaryCreator).toBe('Rick Astley');
    expect(collectable.year).toBe('1987');
    expect(collectable.publisher).toBe('RCA');
    expect(collectable.identifiers.discogs.release).toEqual(['249504']);
    expect(collectable.identifiers.discogs.catalogNumber).toEqual(['PB 41447']);
    expect(collectable.coverImageUrl).toContain('cover-600');
    expect(collectable.sources[0].provider).toBe('discogs');
    expect(collectable.attribution.logoKey).toBe('discogs');
    expect(collectable.fingerprint).toBeTruthy();
  });
});
