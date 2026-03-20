const DiscogsAdapter = require('./DiscogsAdapter');

function makeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body || {}),
  };
}

describe('DiscogsAdapter', () => {
  it('is configured when user token is provided', () => {
    const adapter = new DiscogsAdapter({ userToken: 'token-123' });
    expect(adapter.isConfigured()).toBe(true);
  });

  it('returns null when lookup has no title', async () => {
    const adapter = new DiscogsAdapter({ userToken: 'token-123' });
    const result = await adapter.lookup({ title: '' });
    expect(result).toBeNull();
  });

  it('maps best search match to collectable', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeResponse(200, {
          results: [
            {
              id: 111,
              type: 'master',
              title: 'Miles Davis - Kind of Blue',
              year: 1959,
              format: ['Vinyl'],
              uri: 'https://www.discogs.com/master/111',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeResponse(200, {
          id: 111,
          title: 'Kind of Blue',
          year: 1959,
          artists: [{ name: 'Miles Davis' }],
          labels: [{ name: 'Columbia', catno: 'CL 1355' }],
          genres: ['Jazz'],
          styles: ['Modal'],
          resource_url: 'https://api.discogs.com/masters/111',
          uri: 'https://www.discogs.com/master/111',
          images: [
            {
              type: 'primary',
              uri: 'https://img.example.com/111-600.jpg',
              uri150: 'https://img.example.com/111-150.jpg',
            },
          ],
        }),
      );

    const adapter = new DiscogsAdapter({
      userToken: 'token-123',
      fetch: fetchMock,
      timeoutMs: 1000,
      lookupTimeoutMs: 2000,
      rateLimitPerMinute: 100,
      retries: 0,
    });

    const result = await adapter.lookup({ title: 'Kind of Blue', primaryCreator: 'Miles Davis' });

    expect(result).toBeTruthy();
    expect(result.provider).toBe('discogs');
    expect(result.title).toBe('Kind of Blue');
    expect(result.primaryCreator).toBe('Miles Davis');
    expect(result.identifiers.discogs.master).toEqual(['111']);
    expect(result._raw).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
