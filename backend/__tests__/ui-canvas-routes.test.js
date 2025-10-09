const fs = require('fs/promises')
const express = require('express')
const request = require('supertest')

const router = require('../routes/uiEditor')
const { __storePath } = require('../services/ui/canvasStore')

const resetStore = async () => {
  await fs.rm(__storePath, { force: true })
}

describe('uiEditor canvas routes', () => {
  let app

  beforeEach(async () => {
    await resetStore()
    app = express()
    app.use(express.json())
    app.use('/api/ui-editor', router)
  })

  afterEach(async () => {
    await resetStore()
  })

  it('requires concurrency headers for screen mutations', async () => {
    await request(app)
      .post('/api/ui-editor/canvas/screens')
      .send({ screen: { name: 'Home' } })
      .expect(428)
  })

  it('creates, lists, and deletes screens with optimistic locking', async () => {
    const initialList = await request(app).get('/api/ui-editor/canvas/screens').expect(200)
    expect(initialList.body.version).toBe(0)

    const created = await request(app)
      .post('/api/ui-editor/canvas/screens')
      .set('If-Match', String(initialList.body.version))
      .send({
        screen: {
          name: 'Home',
          device: 'Desktop',
          nodes: [
            {
              id: 'root',
              type: 'frame',
              children: [{ id: 'hero', type: 'component', componentId: 'hero' }],
            },
          ],
        },
      })
      .expect(201)

    expect(created.body.version).toBe(1)
    expect(created.body.screen.name).toBe('Home')
    expect(created.body.screen.nodes).toHaveLength(1)
    expect(created.body.screen.nodes[0].children[0].componentId).toBe('hero')

    const conflict = await request(app)
      .post('/api/ui-editor/canvas/screens')
      .set('If-Match', '0')
      .send({ screen: { name: 'Home', device: 'Mobile' } })
      .expect(409)

    expect(conflict.body.actualVersion).toBe(1)

    const removal = await request(app)
      .delete(`/api/ui-editor/canvas/screens/${created.body.screen.id}`)
      .set('If-Match', String(created.body.version))
      .expect(200)

    expect(removal.body.version).toBe(2)
    expect(removal.body.screens).toHaveLength(0)
  })

  it('validates node payloads on create and update', async () => {
    await request(app)
      .post('/api/ui-editor/canvas/screens')
      .set('If-Match', '0')
      .send({ screen: { name: 'Invalid', nodes: { bad: true } } })
      .expect(400)

    const created = await request(app)
      .post('/api/ui-editor/canvas/screens')
      .set('If-Match', '0')
      .send({ screen: { name: 'Valid', device: 'Desktop' } })
      .expect(201)

    const updateConflict = await request(app)
      .put(`/api/ui-editor/canvas/screens/${created.body.screen.id}`)
      .set('If-Match', '0')
      .send({ screen: { nodes: [{ id: 'a', type: 'box' }] } })
      .expect(409)
    expect(updateConflict.body.actualVersion).toBe(created.body.version)

    await request(app)
      .put(`/api/ui-editor/canvas/screens/${created.body.screen.id}`)
      .set('If-Match', String(created.body.version))
      .send({
        screen: {
          nodes: [
            { id: 'a', type: 'box' },
            { id: 'a', type: 'box' },
          ],
        },
      })
      .expect(400)

    const updated = await request(app)
      .put(`/api/ui-editor/canvas/screens/${created.body.screen.id}`)
      .set('If-Match', String(created.body.version))
      .send({
        screen: {
          nodes: [
            {
              id: 'root',
              type: 'frame',
              slots: {
                main: [{ id: 'hero', type: 'component', componentId: 'hero', props: { title: 'Hi' } }],
              },
            },
          ],
        },
      })
      .expect(200)

    expect(updated.body.screen.nodes[0].slots.main[0].props).toEqual({ title: 'Hi' })
  })

  it('persists settings changes and protects against stale updates', async () => {
    const initial = await request(app).get('/api/ui-editor/canvas/settings').expect(200)

    const updated = await request(app)
      .put('/api/ui-editor/canvas/settings')
      .set('If-Match', String(initial.body.version))
      .send({
        settings: {
          themeTokens: { colorScheme: 'dark' },
          pageStyles: { fontSize: 20 },
        },
      })
      .expect(200)

    expect(updated.body.version).toBe(initial.body.version + 1)
    expect(updated.body.settings.themeTokens.colorScheme).toBe('dark')
    expect(updated.body.settings.pageStyles.fontSize).toBe(20)

    await request(app)
      .put('/api/ui-editor/canvas/settings')
      .set('If-Match', String(initial.body.version))
      .send({ settings: { themeTokens: { accentColor: '#000' } } })
      .expect(409)
  })
})
