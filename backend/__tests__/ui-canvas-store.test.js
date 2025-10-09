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
      {
        name: 'Homepage',
        device: 'Desktop',
        description: 'Main marketing hub',
        nodes: [
          {
            id: 'root',
            type: 'layout',
            order: '1',
            children: [
              { id: 'hero', type: 'component', componentId: 'hero-block', props: { heading: 'Hi' } },
            ],
          },
        ],
      },
      0,
    )

    expect(first.version).toBe(1)
    expect(first.screen.id).toMatch(/homepage-desktop/)
    expect(first.screen.createdAt).toEqual(first.screen.updatedAt)
    expect(first.screen.nodes).toHaveLength(1)
    expect(first.screen.nodes[0].order).toBe(1)
    expect(first.screen.nodes[0].children[0].componentId).toBe('hero-block')

    const second = await createScreen(
      { name: 'Homepage', device: 'Desktop', description: 'Fallback layout' },
      first.version,
    )

    expect(second.version).toBe(2)
    expect(second.screen.id).not.toBe(first.screen.id)
    expect(second.screens).toHaveLength(2)
    expect(second.screen.nodes).toEqual([])
  })

  it('prevents updates with stale versions', async () => {
    const created = await createScreen({ name: 'Checkout', device: 'Mobile' }, 0)

    await expect(updateScreen(created.screen.id, { description: 'Updated' }, 0)).rejects.toMatchObject({
      code: 'CANVAS_VERSION_CONFLICT',
    })
  })

  it('validates and persists nested nodes for screens', async () => {
    const created = await createScreen(
      {
        name: 'Builder',
        device: 'Desktop',
        nodes: [
          {
            id: 'root',
            type: 'frame',
            slots: {
              main: [
                {
                  id: 'section-1',
                  type: 'stack',
                  componentId: 'section',
                  props: { title: 'Welcome' },
                },
              ],
            },
          },
        ],
      },
      0,
    )

    expect(created.screen.nodes[0].slots.main[0].props).toEqual({ title: 'Welcome' })

    const updatedNodes = [
      {
        id: 'root',
        type: 'frame',
        children: [
          {
            id: 'section-1',
            type: 'stack',
            componentId: 'section',
            props: { title: 'Hello again' },
          },
        ],
      },
    ]

    const updated = await updateScreen(created.screen.id, { nodes: updatedNodes }, created.version)
    expect(updated.screen.nodes[0].children).toHaveLength(1)
    expect(updated.screen.nodes[0].children[0].props).toEqual({ title: 'Hello again' })
  })

  it('rejects invalid node payloads', async () => {
    await expect(
      createScreen(
        {
          name: 'Broken',
          device: 'Desktop',
          nodes: { not: 'an array' },
        },
        0,
      ),
    ).rejects.toMatchObject({ code: 'CANVAS_INVALID_SCREEN' })

    const created = await createScreen({ name: 'Valid', device: 'Desktop' }, 0)
    await expect(
      updateScreen(
        created.screen.id,
        {
          nodes: [
            { id: 'a', type: 'box' },
            { id: 'a', type: 'box' },
          ],
        },
        created.version,
      ),
    ).rejects.toMatchObject({ code: 'CANVAS_INVALID_SCREEN' })
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
