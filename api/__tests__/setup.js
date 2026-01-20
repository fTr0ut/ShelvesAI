require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })

// Mock the pg pool for tests that don't need a real connection
// Tests that need real DB access can unmock this
jest.mock('../database/pg', () => {
  const mockPool = {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn()
    }),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn()
  }
  return {
    pool: mockPool,
    query: mockPool.query,
    getClient: mockPool.connect,
    transaction: jest.fn(async (fn) => {
      const client = await mockPool.connect()
      try {
        return await fn(client)
      } finally {
        client.release()
      }
    })
  }
})

// Clean up after all tests
afterAll(async () => {
  // Any cleanup needed
})
