const test = require('node:test');
const assert = require('node:assert/strict');

async function loadFeedAddedEventModule() {
  return import('./feedAddedEvent.js');
}

test('getAddedItemDetails keeps official collectable cover and builds collectable detail params', async () => {
  const {
    buildAddedItemDetailParams,
    getAddedItemDetails,
    hasAddedItemDetailTarget,
  } = await loadFeedAddedEventModule();

  const detail = getAddedItemDetails({
    itemId: 44,
    collectableId: 91,
    title: 'Dune',
    collectable: {
      id: 91,
      title: 'Dune',
      coverImageUrl: 'https://images.example.test/dune.jpg',
    },
  }, 'https://api.example.test');

  assert.equal(detail.coverUrl, 'https://images.example.test/dune.jpg');
  assert.equal(hasAddedItemDetailTarget(detail), true);
  assert.deepEqual(buildAddedItemDetailParams(detail, 7), {
    collectableId: '91',
    ownerId: 7,
  });
});

test('manual added preview without cover builds manual detail params', async () => {
  const {
    buildAddedItemDetailParams,
    getAddedItemDetails,
    hasAddedItemDetailTarget,
  } = await loadFeedAddedEventModule();

  const detail = getAddedItemDetails({
    itemId: 55,
    manualId: 12,
    manual: {
      id: 12,
      title: 'Signed Cartridge',
    },
  }, 'https://api.example.test');

  assert.equal(detail.coverUrl, null);
  assert.equal(detail.manualId, 12);
  assert.equal(hasAddedItemDetailTarget(detail), true);
  assert.deepEqual(buildAddedItemDetailParams(detail, 4), {
    manualId: '12',
    ownerId: 4,
  });
});

test('added preview without collectable or manual identity is not linkable', async () => {
  const {
    buildAddedItemDetailParams,
    getAddedItemDetails,
    hasAddedItemDetailTarget,
  } = await loadFeedAddedEventModule();

  const detail = getAddedItemDetails({
    title: 'Mystery Item',
  }, 'https://api.example.test');

  assert.equal(hasAddedItemDetailTarget(detail), false);
  assert.equal(buildAddedItemDetailParams(detail, 3), null);
});
