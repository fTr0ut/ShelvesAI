jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { HardcoverClient } = require('./hardcover');

describe('HardcoverClient.pickBestBook', () => {
  let client;

  beforeEach(() => {
    client = new HardcoverClient({ token: 'test-token' });
  });

  it('rejects weak one-token matches like Player -> Scoring the Player\'s Baby', () => {
    const result = client.pickBestBook(
      [
        {
          id: 1,
          title: "Scoring the Player's Baby",
          contributions: [{ author: { name: 'Kandi Steiner' } }],
        },
      ],
      { title: 'Player', author: 'Kandi Steiner' },
    );

    expect(result).toBeNull();
  });

  it('accepts the exact intended title when it is present', () => {
    const result = client.pickBestBook(
      [
        {
          id: 1,
          title: "Scoring the Player's Baby",
          contributions: [{ author: { name: 'Kandi Steiner' } }],
        },
        {
          id: 2,
          title: 'The Right Player',
          contributions: [{ author: { name: 'Kandi Steiner' } }],
        },
      ],
      { title: 'The Right Player', author: 'Kandi Steiner' },
    );

    expect(result).toEqual(expect.objectContaining({
      id: 2,
      title: 'The Right Player',
    }));
  });
});
