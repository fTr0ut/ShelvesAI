import { describe, it, expect, beforeEach, jest } from '@jest/globals'

const loadModule = async () => {
  const module = await import('../projectSettings.js')
  return module
}

describe('projectSettings store', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  it('hydrates from the backend and updates subscribers', async () => {
    const module = await loadModule()
    module.__resetProjectSettingsForTests()

    const fetchCalls = []
    module.__setFetchJsonImplementation(async (path, options = {}) => {
      fetchCalls.push({ path, options })
      if (!options.method || options.method === 'GET') {
        return {
          settings: {
            apiBase: 'https://api.example.com',
            endpointDocument: { endpoints: [{ method: 'GET', path: '/items' }] },
            authMethod: module.AUTH_METHODS.API_TOKEN,
            authToken: 'secret-token',
            previewTarget: './preview',
            productionTarget: 'https://prod.example.com',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        }
      }
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body)
        expect(body.settings).toMatchObject({ apiBase: 'https://next.example.com' })
        return {
          settings: {
            ...body.settings,
            updatedAt: '2024-02-02T00:00:00.000Z',
          },
        }
      }
      return {}
    })

    const initial = module.getProjectSettings()
    expect(initial.isHydrated).toBe(false)
    expect(fetchCalls).toHaveLength(0)

    const hydrated = await new Promise((resolve) => {
      const unsubscribe = module.subscribeToProjectSettings((state) => {
        if (state.isHydrated && !state.isHydrating) {
          unsubscribe()
          resolve(state)
        }
      })
    })

    expect(fetchCalls[0].path).toBe('/api/ui-editor/settings')
    expect(hydrated.apiBase).toBe('https://api.example.com')
    expect(hydrated.authToken).toBe('secret-token')
    expect(hydrated.endpointMeta.endpoints).toHaveLength(1)

    fetchCalls.length = 0

    const updated = await module.updateProjectSettings({
      apiBase: 'https://next.example.com',
      previewTarget: './preview',
      productionTarget: 'https://prod.example.com',
    })

    expect(fetchCalls[0].options.method).toBe('PUT')
    expect(updated.apiBase).toBe('https://next.example.com')
    expect(updated.updatedAt).toBe('2024-02-02T00:00:00.000Z')
  })

  it('falls back to defaults when the backend returns no payload', async () => {
    const module = await loadModule()
    module.__resetProjectSettingsForTests()

    module.__setFetchJsonImplementation(async () => ({}))

    const initial = module.getProjectSettings()
    expect(initial.apiBase).toBe('')

    const hydrated = await new Promise((resolve) => {
      const unsubscribe = module.subscribeToProjectSettings((state) => {
        if (state.isHydrated && !state.isHydrating) {
          unsubscribe()
          resolve(state)
        }
      })
    })

    expect(hydrated.apiBase).toBe('')
    expect(hydrated.hasAuthToken).toBe(false)
  })
})
