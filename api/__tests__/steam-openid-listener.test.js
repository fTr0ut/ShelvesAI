const { buildRedirectUrl } = require('../controllers/steamOpenIdController');

describe('Steam OpenID listener redirect', () => {
  test('appends state and openid payload to client return URL', () => {
    const target = 'collector://steam-link';
    const query = {
      state: 'abc123',
      'openid.claimed_id': 'https://steamcommunity.com/openid/id/12345678901234567',
      'openid.identity': 'https://steamcommunity.com/openid/id/12345678901234567',
      'openid.sig': 'signature',
      'openid.signed': 'signed',
    };

    const redirect = buildRedirectUrl(target, query);
    const url = new URL(redirect);

    expect(url.protocol).toBe('collector:');
    expect(url.searchParams.get('state')).toBe('abc123');
    expect(url.searchParams.get('openid.sig')).toBe('signature');
  });

  test('throws when client return URL is missing', () => {
    expect(() => buildRedirectUrl(undefined, {})).toThrow('client_return_to is required');
  });

  test('throws when client return URL is invalid', () => {
    expect(() => buildRedirectUrl('not-a-url', {})).toThrow('client_return_to must be a valid URL');
  });
});
