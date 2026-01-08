const fs = require('fs/promises')
const express = require('express')
const request = require('supertest')

const {
  AUTH_METHODS,
  defaultSettings,
  getProjectSettings,
  saveProjectSettings,
  __storePath,
} = require('../services/ui/projectSettingsStore')
const router = require('../routes/uiEditor')

const clearStoreFile = async () => {
  await fs.rm(__storePath, { force: true })
}

describe('projectSettingsStore', () => {
  beforeEach(async () => {
    await clearStoreFile()
  })

  afterAll(async () => {
    await clearStoreFile()
  })

  it('returns defaults when no store exists', async () => {
    const settings = await getProjectSettings()
    expect(settings).toEqual(defaultSettings)
  })

  it('persists and normalises saved settings', async () => {
    const saved = await saveProjectSettings({
      apiBase: ' https://api.example.com/ ',
      endpointDocument: { endpoints: [] },
      authMethod: AUTH_METHODS.API_TOKEN,
      authToken: 'secret-token',
      previewTarget: ' ./preview ',
      productionTarget: 'https://example.com/app/',
    })

    expect(saved.apiBase).toBe('https://api.example.com/')
    expect(saved.endpointDocument).toEqual({ endpoints: [] })
    expect(saved.authMethod).toBe(AUTH_METHODS.API_TOKEN)
    expect(saved.authToken).toBe('secret-token')
    expect(saved.previewTarget).toBe('./preview')
    expect(saved.productionTarget).toBe('https://example.com/app/')
    expect(saved.updatedAt).toEqual(expect.any(String))

    const reset = await saveProjectSettings({ authMethod: AUTH_METHODS.BROWSER_SESSION })
    expect(reset.authMethod).toBe(AUTH_METHODS.BROWSER_SESSION)
    expect(reset.authToken).toBe('')
  })
})

describe('uiEditor settings routes', () => {
  let app

  beforeEach(async () => {
    await clearStoreFile()
    app = express()
    app.use(express.json())
    app.use('/api/ui-editor', router)
  })

  afterAll(async () => {
    await clearStoreFile()
  })

  it('returns default settings when the store is empty', async () => {
    const response = await request(app).get('/api/ui-editor/settings').expect(200)
    expect(response.body.settings).toMatchObject({
      ...defaultSettings,
      hasAuthToken: false,
    })
  })

  it('validates incoming payloads', async () => {
    const response = await request(app)
      .put('/api/ui-editor/settings')
      .send({ authToken: 123 })
      .expect(400)

    expect(response.body.error).toMatch(/authToken/i)
  })

  it('persists settings via PUT and returns them on GET', async () => {
    const payload = {
      settings: {
        apiBase: 'https://api.example.com',
        endpointDocument: { endpoints: [{ method: 'GET', path: '/items' }] },
        authMethod: AUTH_METHODS.API_TOKEN,
        authToken: 'secret-token',
        previewTarget: './dist/preview',
        productionTarget: 'https://app.example.com',
      },
    }

    const putResponse = await request(app).put('/api/ui-editor/settings').send(payload).expect(200)

    expect(putResponse.body.settings).toMatchObject({
      apiBase: 'https://api.example.com',
      authMethod: AUTH_METHODS.API_TOKEN,
      authToken: 'secret-token',
      previewTarget: './dist/preview',
      productionTarget: 'https://app.example.com',
      hasAuthToken: true,
    })
    expect(putResponse.body.settings.updatedAt).toEqual(expect.any(String))

    const getResponse = await request(app).get('/api/ui-editor/settings').expect(200)
    expect(getResponse.body.settings).toMatchObject({
      apiBase: 'https://api.example.com',
      authMethod: AUTH_METHODS.API_TOKEN,
      authToken: 'secret-token',
      previewTarget: './dist/preview',
      productionTarget: 'https://app.example.com',
      hasAuthToken: true,
    })
    expect(getResponse.body.settings.endpointDocument).toEqual({
      endpoints: [{ method: 'GET', path: '/items' }],
    })
  })
})
