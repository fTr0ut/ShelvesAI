const test = require('node:test');
const assert = require('node:assert/strict');

async function loadCoverUrlModule() {
  return import('./coverUrl.js');
}

test('resolveCollectableCoverUrl prefers absolute external coverImageUrl over path-only coverMediaPath when coverMediaUrl is absent', async () => {
  const { resolveCollectableCoverUrl } = await loadCoverUrlModule();

  const result = resolveCollectableCoverUrl({
    coverMediaPath: 'books/Atmosphere_A_Love_Story/abc123.jpg',
    coverImageUrl: 'https://assets.hardcover.app/edition/31625541/cover.jpg',
  }, 'https://api.example.test');

  assert.equal(result, 'https://assets.hardcover.app/edition/31625541/cover.jpg');
});

test('resolveCollectableCoverUrl still prefers coverMediaUrl when the API provides a resolved CDN URL', async () => {
  const { resolveCollectableCoverUrl } = await loadCoverUrlModule();

  const result = resolveCollectableCoverUrl({
    coverMediaUrl: 'https://cdn.example.test/books/Atmosphere_A_Love_Story/abc123.jpg',
    coverMediaPath: 'books/Atmosphere_A_Love_Story/abc123.jpg',
    coverImageUrl: 'https://assets.hardcover.app/edition/31625541/cover.jpg',
  }, 'https://api.example.test');

  assert.equal(result, 'https://cdn.example.test/books/Atmosphere_A_Love_Story/abc123.jpg');
});
