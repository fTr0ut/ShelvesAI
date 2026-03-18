// ARCHIVED: 2026-03-17
// Reason: This test was written for a pre-PostgreSQL (Mongoose/MongoDB) era.
// It references models (User, Shelf, UserManual, UserCollection) that no longer exist
// in the PostgreSQL codebase. The models/ directory is empty. Additionally, it depends
// on 'supertest' which is not installed in api/package.json.
// The visibility enforcement logic it tested (public/friends/private shelf access in
// GET /api/feed/:shelfId) is enforced by shelvesQueries.getForViewing(), which is
// exercised via mock in other passing tests (needsReview.test.js, visionPipeline.test.js).
// See FIXME.md DEBT-1 for context.
const request = require('supertest')
const jwt = require('jsonwebtoken')
const app = require('../server')
const User = require('../models/User')
const Shelf = require('../models/Shelf')
const UserManual = require('../models/UserManual')
const UserCollection = require('../models/UserCollection')

// helper to mint JWTs
function makeToken(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' })
}

describe('Feed entry visibility enforcement', () => {
  let owner
  let viewer
  let shelf

  beforeEach(async () => {
    // clean owner + viewer each test
    owner = await User.create({ username: 'owner', email: 'owner@test.com' })
    viewer = await User.create({ username: 'viewer', email: 'viewer@test.com' })
  })

  async function makeShelf(visibility = 'public') {
    shelf = await Shelf.create({
      owner: owner._id,
      name: `${visibility} Shelf`,
      type: 'Books',
      visibility,
    })
    const manual = await UserManual.create({ name: 'Item 1', type: 'Book' })
    await UserCollection.create({ user: owner._id, shelf: shelf._id, manual: manual._id })
    return shelf
  }

  it('allows anyone to view a public shelf', async () => {
    await makeShelf('public')

    const res = await request(app)
      .get(`/api/feed/${shelf._id}`)
      .set('Authorization', `Bearer ${makeToken(viewer)}`)
      .expect(200)

    expect(res.body.entry.shelf.name).toContain('public')
    expect(res.body.entry.items).toHaveLength(1)
  })

  it('blocks a non-friend from viewing a friends-only shelf', async () => {
    await makeShelf('friends')

    const res = await request(app)
      .get(`/api/feed/${shelf._id}`)
      .set('Authorization', `Bearer ${makeToken(viewer)}`)
      .expect(403)

    expect(res.body.error).toMatch(/access/i)
  })

  it('allows the owner to view their own friends-only shelf', async () => {
    await makeShelf('friends')

    const res = await request(app)
      .get(`/api/feed/${shelf._id}`)
      .set('Authorization', `Bearer ${makeToken(owner)}`)
      .expect(200)

    expect(res.body.entry.shelf.name).toContain('friends')
  })

  it('blocks a non-owner from viewing a private shelf', async () => {
    await makeShelf('private')

    const res = await request(app)
      .get(`/api/feed/${shelf._id}`)
      .set('Authorization', `Bearer ${makeToken(viewer)}`)
      .expect(403)

    expect(res.body.error).toMatch(/access/i)
  })

  it('allows the owner to view their own private shelf', async () => {
    await makeShelf('private')

    const res = await request(app)
      .get(`/api/feed/${shelf._id}`)
      .set('Authorization', `Bearer ${makeToken(owner)}`)
      .expect(200)

    expect(res.body.entry.shelf.name).toContain('private')
  })
})
