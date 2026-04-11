jest.mock('../database/queries/feed', () => ({
  getGlobalFeed: jest.fn(),
  getFriendsFeed: jest.fn(),
  getMyFeed: jest.fn(),
  getAllFeed: jest.fn(),
}));

jest.mock('../database/queries/shelves', () => ({
  getForViewing: jest.fn(),
  getOwnerIdForShelf: jest.fn(),
}));

jest.mock('../database/queries/friendships', () => ({
  areFriends: jest.fn(),
}));

jest.mock('../database/queries/eventSocial', () => ({
  getSocialSummaries: jest.fn(),
}));

jest.mock('../database/queries/newsSeen', () => ({
  markNewsItemsSeen: jest.fn(),
}));

jest.mock('../utils/userBlockAccess', () => ({
  ensureUsersNotBlocked: jest.fn(),
}));

jest.mock('../services/discovery/newsRecommendations', () => ({
  getNewsRecommendationsForUser: jest.fn().mockResolvedValue([]),
}));

const { getFeed, getFeedEntryDetails } = require('../controllers/feedController');
const feedQueries = require('../database/queries/feed');
const shelvesQueries = require('../database/queries/shelves');
const eventSocialQueries = require('../database/queries/eventSocial');
const { ensureUsersNotBlocked } = require('../utils/userBlockAccess');
const { query } = require('../database/pg');

function makeRes() {
  return {
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
}

function makeManualAddedEvent(ownerId = 'owner-1') {
  return {
    id: 'agg-1',
    eventType: 'item.added',
    createdAt: '2026-03-27T00:00:00.000Z',
    lastActivityAt: '2026-03-27T00:00:00.000Z',
    userId: ownerId,
    username: 'owner',
    firstName: 'Main',
    lastName: 'User',
    city: null,
    state: null,
    country: null,
    userPicture: null,
    profileMediaPath: null,
    shelfId: 10,
    shelfName: 'Other shelf',
    shelfType: 'other',
    shelfDescription: 'desc',
    itemCount: 1,
    previewPayloads: [
      {
        itemId: 501,
        manualId: 901,
        name: 'Manual Item',
        author: 'Manual Author',
        coverMediaPath: 'manuals/901.jpg',
        coverMediaUrl: '/media/manuals/901.jpg',
      },
    ],
  };
}

describe('feedController manual cover privacy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    feedQueries.getGlobalFeed.mockResolvedValue([makeManualAddedEvent()]);
    eventSocialQueries.getSocialSummaries.mockResolvedValue(new Map());
    ensureUsersNotBlocked.mockResolvedValue(true);
    shelvesQueries.getOwnerIdForShelf.mockResolvedValue('owner-1');
  });

  it.each([
    {
      label: 'redacts non-owner crop-backed covers when owner photo visible is false',
      viewerId: 'friend-2',
      privacy: {
        owner_photo_source: 'vision_crop',
        owner_photo_visible: false,
        show_personal_photos: true,
      },
      expectedRedacted: true,
    },
    {
      label: 'redacts non-owner replacement-upload covers when global sharing is off',
      viewerId: 'friend-2',
      privacy: {
        owner_photo_source: 'upload',
        owner_photo_visible: true,
        show_personal_photos: false,
      },
      expectedRedacted: true,
    },
    {
      label: 'keeps covers visible for non-owner when sharing is on',
      viewerId: 'friend-2',
      privacy: {
        owner_photo_source: 'upload',
        owner_photo_visible: true,
        show_personal_photos: true,
      },
      expectedRedacted: false,
    },
    {
      label: 'keeps covers visible for owner viewer',
      viewerId: 'owner-1',
      privacy: {
        owner_photo_source: 'vision_crop',
        owner_photo_visible: false,
        show_personal_photos: false,
      },
      expectedRedacted: false,
    },
  ])('$label', async ({ viewerId, privacy, expectedRedacted }) => {
    query
      .mockResolvedValueOnce({ rows: [{ shelf_id: 10, total: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          collection_item_id: 501,
          manual_id: 901,
          owner_id: 'owner-1',
          shelf_type: 'other',
          ...privacy,
        }],
      });

    const req = { user: { id: viewerId }, query: {} };
    const res = makeRes();

    await getFeed(req, res);

    const body = res.json.mock.calls[0][0];
    const feedItem = body.entries[0].items[0];
    const manual = feedItem.manual;

    if (expectedRedacted) {
      expect(manual.coverMediaPath).toBeNull();
      expect(manual.coverMediaUrl).toBeNull();
      expect(feedItem.itemId).toBeNull();
      return;
    }

    expect(manual.coverMediaPath).toBe('manuals/901.jpg');
    expect(manual.coverMediaUrl).toBe('/media/manuals/901.jpg');
    expect(feedItem.itemId).toBe(501);
  });

  it('redacts manual cover fields in GET /api/feed/:id shelf-detail response for authorized non-owner viewer', async () => {
    shelvesQueries.getForViewing.mockResolvedValue({
      id: 10,
      ownerId: 'owner-1',
      name: 'Other shelf',
      type: 'other',
      description: 'desc',
      visibility: 'public',
      createdAt: '2026-03-27T00:00:00.000Z',
      updatedAt: '2026-03-27T00:00:00.000Z',
    });

    query
      .mockResolvedValueOnce({
        rows: [{
          id: 'owner-1',
          username: 'owner',
          first_name: 'Main',
          last_name: 'User',
          picture: null,
          city: null,
          state: null,
          country: null,
          profile_media_path: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 501,
          manual_id: 901,
          collectable_id: null,
          collectable_title: null,
          primary_creator: null,
          manual_name: 'Manual Item',
          manual_author: 'Manual Author',
          manual_description: null,
          manual_year: 2005,
          manual_age_statement: null,
          manual_special_markings: null,
          manual_label_color: null,
          manual_regional_item: null,
          manual_edition: null,
          manual_barcode: null,
          limited_edition: null,
          item_specific_text: null,
          manual_cover_media_path: 'manuals/901.jpg',
          position: null,
          notes: null,
          rating: null,
          created_at: '2026-03-27T00:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          collection_item_id: 501,
          manual_id: 901,
          owner_id: 'owner-1',
          shelf_type: 'other',
          owner_photo_source: 'upload',
          owner_photo_visible: true,
          show_personal_photos: false,
        }],
      });

    const req = {
      user: { id: 'friend-2' },
      params: { shelfId: '10' },
    };
    const res = makeRes();

    await getFeedEntryDetails(req, res);

    const body = res.json.mock.calls[0][0];
    const feedItem = body.entry.items[0];
    const manual = feedItem.manual;
    expect(manual.coverMediaPath).toBeNull();
    expect(manual.coverMediaUrl).toBeNull();
    expect(feedItem.itemId).toBeNull();
  });

  it('returns blocked 403 when owner feed override is block-restricted', async () => {
    ensureUsersNotBlocked.mockResolvedValue(false);

    const req = { user: { id: 'viewer-1' }, query: { ownerId: 'owner-1' } };
    const res = makeRes();

    await getFeed(req, res);

    expect(ensureUsersNotBlocked).toHaveBeenCalledWith({
      res,
      viewerId: 'viewer-1',
      targetUserId: 'owner-1',
      error: 'You do not have permission to view this feed',
    });
    expect(feedQueries.getMyFeed).not.toHaveBeenCalled();
  });

  it('returns blocked 403 for blocked aggregate detail access before hydration', async () => {
    ensureUsersNotBlocked.mockResolvedValue(false);
    query.mockResolvedValueOnce({
      rows: [{
        id: 'agg-1',
        event_type: 'item.added',
        user_id: 'owner-1',
        created_at: '2026-03-27T00:00:00.000Z',
        last_activity_at: '2026-03-27T00:00:00.000Z',
      }],
    });

    const req = {
      user: { id: 'viewer-1' },
      params: { shelfId: 'agg-1' },
    };
    const res = makeRes();

    await getFeedEntryDetails(req, res);

    expect(ensureUsersNotBlocked).toHaveBeenCalledWith({
      res,
      viewerId: 'viewer-1',
      targetUserId: 'owner-1',
      error: 'You do not have access to this feed entry',
    });
    expect(res.json).not.toHaveBeenCalled();
  });
});
