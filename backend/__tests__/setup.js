const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')

if (process.env.SKIP_MONGO_MEMORY === 'true') {
  beforeAll(async () => {})
  afterEach(async () => {})
  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect()
    }
  })
} else {
  let mongod

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    const uri = mongod.getUri()
    await mongoose.connect(uri)
  })

  afterEach(async () => {
    const collections = mongoose.connection.collections
    await Promise.all(Object.values(collections).map((col) => col.deleteMany({})))
  })

  afterAll(async () => {
    await mongoose.disconnect()
    await mongod.stop()
  })
}
