const fs = require('fs/promises')

const {
  defaultSettings,
  defaultPageStyles,
  defaultThemeTokens,
  getScreens,
  createScreen,
  updateScreen,
  deleteScreen,
  getSettings,
  updateSettings,
  __storePath,
  __resetStoreForTests,
} = require('../services/ui/canvasStore')

const clearStore = async () => {
  await fs.rm(__storePath, { force: true })
}

describe('ui canvas store', () => {
  beforeEach(async () => {
    await clearStore()
  })

  afterEach(async () => {
    await clearStore()
  })

  it('returns defaults when no store exists', async () => {
    const screens = await getScreens()
    expect(screens).toEqual({ screens: [], version: 0, updatedAt: null })

    const settings = await getSettings()
    expect(settings.version).toBe(0)
    expect(settings.settings).toEqual(defaultSettings)
  })

  it('creates screens with unique identifiers and increments version', async () => {
    const first = await createScreen(
      { name: 'Homepage', device: 'Desktop', description: 'Main marketing hub' },
      0,
    )

    expect(first.version).toBe(1)
    expect(first.screen.id).toMatch(/homepage-desktop/)
    expect(first.screen.createdAt).toEqual(first.screen.updatedAt)

    const second = await createScreen(
      { name: 'Homepage', device: 'Desktop', description: 'Fallback layout' },
      first.version,
    )

    expect(second.version).toBe(2)
    expect(second.screen.id).not.toBe(first.screen.id)
    expect(second.screens).toHaveLength(2)
  })

  it('prevents updates with stale versions', async () => {
    const created = await createScreen({ name: 'Checkout', device: 'Mobile' }, 0)

    await expect(updateScreen(created.screen.id, { description: 'Updated' }, 0)).rejects.toMatchObject({
      code: 'CANVAS_VERSION_CONFLICT',
    })
  })

  it('updates settings and merges nested structures', async () => {
    await __resetStoreForTests()

    const initial = await getSettings()
    expect(initial.settings.themeTokens).toEqual(defaultThemeTokens)

    const update = await updateSettings(
      {
        themeTokens: { colorScheme: 'dark', accentColor: '#f97316' },
        pageStyles: { fontSize: 18 },
      },
      initial.version,
    )

    expect(update.version).toBe(initial.version + 1)
    expect(update.settings.themeTokens.colorScheme).toBe('dark')
    expect(update.settings.themeTokens.accentColor).toBe('#f97316')
    expect(update.settings.pageStyles.fontSize).toBe(18)
    expect(update.settings.pageStyles.maxWidth).toBe(defaultPageStyles.maxWidth)
  })

  it('deletes screens and bumps the version', async () => {
    const first = await createScreen({ name: 'Landing', device: 'Desktop' }, 0)
    const second = await createScreen({ name: 'Landing', device: 'Mobile' }, first.version)

    const removed = await deleteScreen(first.screen.id, second.version)
    expect(removed.version).toBe(3)
    expect(removed.screens).toHaveLength(1)
    expect(removed.screens[0].id).toBe(second.screen.id)
  })
})
