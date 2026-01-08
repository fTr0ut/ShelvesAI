const fs = require('fs/promises')
const os = require('os')
const path = require('path')

const { publishScreenBundle } = require('../services/ui/publishScreenBundle')
const {
  getScreens: loadCanvasScreens,
  createScreen: createCanvasScreen,
  __storePath: canvasStorePath,
} = require('../services/ui/canvasStore')

const routesStorePath = path.join(__dirname, '..', 'cache', 'ui-routes.json')

const resetStores = async () => {
  await Promise.all([
    fs.rm(canvasStorePath, { force: true }),
    fs.rm(routesStorePath, { force: true }),
  ])
}

describe('publishScreenBundle', () => {
  let publishDir
  const originalTargets = process.env.UI_PUBLISH_TARGETS

  beforeEach(async () => {
    await resetStores()
    publishDir = await fs.mkdtemp(path.join(os.tmpdir(), 'collector-screen-bundle-'))
  })

  afterEach(async () => {
    await resetStores()
    if (publishDir) {
      await fs.rm(publishDir, { recursive: true, force: true })
    }
    if (originalTargets === undefined) {
      delete process.env.UI_PUBLISH_TARGETS
    } else {
      process.env.UI_PUBLISH_TARGETS = originalTargets
    }
  })

  it('includes canvas screens and metadata in the published bundle', async () => {
    const initial = await loadCanvasScreens()
    const created = await createCanvasScreen(
      {
        name: 'Canvas Home',
        device: 'Desktop',
        status: 'draft',
        nodes: [
          {
            id: 'root',
            type: 'frame',
            children: [{ id: 'hero', type: 'component', componentId: 'hero' }],
          },
        ],
      },
      initial.version,
    )

    process.env.UI_PUBLISH_TARGETS = JSON.stringify([
      { target: 'test', directories: [publishDir] },
    ])

    const result = await publishScreenBundle('test')
    expect(result.status).toBe('success')
    expect(result.meta.canvasScreenCount).toBeGreaterThanOrEqual(1)

    const bundlePath = path.join(publishDir, 'screen-bundle.json')
    const payload = JSON.parse(await fs.readFile(bundlePath, 'utf8'))

    expect(Array.isArray(payload.canvasScreens)).toBe(true)
    expect(payload.canvasMeta).toEqual(
      expect.objectContaining({ version: expect.any(Number), updatedAt: expect.any(String) })
    )

    const canvasEntry = payload.canvasScreens.find((screen) => screen.id === created.screen.id)
    expect(canvasEntry).toBeDefined()
    expect(canvasEntry.nodes).toHaveLength(1)

    const mergedEntry = payload.screens.find((screen) => screen.id === created.screen.id)
    expect(mergedEntry).toBeDefined()
    expect(mergedEntry.source).toBe('canvas')
    expect(mergedEntry.status).toBe('draft')
  })
})

