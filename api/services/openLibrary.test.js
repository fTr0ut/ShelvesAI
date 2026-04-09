jest.mock('node-fetch', () => jest.fn());
jest.mock('./outboundLimiterRegistry', () => ({
  limitOpenLibrary: jest.fn(async (fn) => fn()),
}));
jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const fetch = require('node-fetch');
const { lookupWorkBookMetadata } = require('./openLibrary');

function makeJsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

describe('openLibrary.lookupWorkBookMetadata', () => {
  beforeEach(() => {
    fetch.mockReset();
  });

  it('rejects wrong first-hit titles instead of hydrating them', async () => {
    fetch.mockResolvedValueOnce(makeJsonResponse({
      docs: [
        {
          key: '/works/OL1W',
          title: "Scoring the Player's Baby",
          author_name: ['Kandi Steiner'],
          edition_count: 1,
        },
      ],
    }));

    const result = await lookupWorkBookMetadata({
      title: 'Player',
      author: 'Kandi Steiner',
      throwOnError: true,
    });

    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the best scored hydrated result when the title is relevant', async () => {
    fetch
      .mockResolvedValueOnce(makeJsonResponse({
        docs: [
          {
            key: '/works/OL2W',
            title: 'The Right Player',
            author_name: ['Kandi Steiner'],
            edition_count: 1,
          },
        ],
      }))
      .mockResolvedValueOnce(makeJsonResponse({
        key: '/works/OL2W',
        title: 'The Right Player',
        authors: [],
      }));

    const result = await lookupWorkBookMetadata({
      title: 'The Right Player',
      author: 'Kandi Steiner',
      throwOnError: true,
    });

    expect(result).toEqual(expect.objectContaining({
      title: 'The Right Player',
      workId: 'OL2W',
    }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
