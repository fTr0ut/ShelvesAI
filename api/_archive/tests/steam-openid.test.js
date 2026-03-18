const { startLink } = require('../controllers/steamController')
const { buildOpenIdLoginUrl, normalizeReturnUrl } = require('../services/steam/steamService')

const ORIGINAL_ENV = {
  STEAM_OPENID_RETURN_URL: process.env.STEAM_OPENID_RETURN_URL,
  JWT_SECRET: process.env.JWT_SECRET,
}

function restoreEnv() {
  if (ORIGINAL_ENV.STEAM_OPENID_RETURN_URL === undefined) {
    delete process.env.STEAM_OPENID_RETURN_URL
  } else {
    process.env.STEAM_OPENID_RETURN_URL = ORIGINAL_ENV.STEAM_OPENID_RETURN_URL
  }
  if (ORIGINAL_ENV.JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET
  } else {
    process.env.JWT_SECRET = ORIGINAL_ENV.JWT_SECRET
  }
}

describe('Steam OpenID return URL handling', () => {
  beforeEach(() => {
    process.env.STEAM_OPENID_RETURN_URL = 'https://example.com/steam/callback'
    process.env.JWT_SECRET = 'test-secret'
  })

  afterEach(() => {
    restoreEnv()
  })

  test('normalizeReturnUrl keeps provided https return URL', () => {
    const result = normalizeReturnUrl('https://client.example.com/steam')
    expect(result.url.toString()).toBe('https://client.example.com/steam')
    expect(result.usingFallback).toBe(false)
  })

  test('normalizeReturnUrl falls back to configured https callback', () => {
    const result = normalizeReturnUrl('collector://steam-link')
    expect(result.url.toString()).toBe('https://example.com/steam/callback')
    expect(result.usingFallback).toBe(true)
    expect(result.requested).toBe('collector://steam-link')
  })

  test('buildOpenIdLoginUrl produces http(s) return URL even for custom schemes', () => {
    const { returnTo } = buildOpenIdLoginUrl({
      returnTo: 'collector://steam-link',
      state: 'abc123',
    })
    const parsed = new URL(returnTo)
    expect(['http:', 'https:']).toContain(parsed.protocol)
    expect(parsed.searchParams.get('state')).toBe('abc123')
  })

  test('startLink falls back to https return URL and preserves client deep link', async () => {
    const req = {
      body: { returnUrl: 'collector://steam-link' },
      user: { id: 'user-123' },
    }
    const res = createMockResponse()

    await startLink(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.redirectUrl).toBeTruthy()
    expect(res.body.returnTo).toBeTruthy()
    expect(res.body.state).toBeTruthy()
    expect(res.body.requestedReturnTo).toBe('collector://steam-link')

    const parsed = new URL(res.body.returnTo)
    expect(parsed.searchParams.get('client_return_to')).toBe('collector://steam-link')
    expect(['http:', 'https:']).toContain(parsed.protocol)
  })
})

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}
