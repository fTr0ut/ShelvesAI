const { Types } = require('mongoose');
const Shelf = require('../models/Shelf');
const User = require('../models/User');
const UserCollection = require('../models/UserCollection');
const Friendship = require('../models/Friendship');

async function fetchFriendIds(userId) {
  const friendships = await Friendship.find({
    status: 'accepted',
    $or: [
      { requester: userId },
      { addressee: userId },
    ],
  }).select('requester addressee');
  const ids = new Set();
  const me = String(userId);
  friendships.forEach((doc) => {
    const req = String(doc.requester);
    const add = String(doc.addressee);
    if (req === me) ids.add(add);
    else ids.add(req);
  });
  return ids;
}

function toObjectId(value) {
  try { return new Types.ObjectId(value); } catch (err) { return null }
}

function toObjectIds(values) {
  return values.map(toObjectId).filter(Boolean);
}

function summarizeItems(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    const key = String(entry.shelf);
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key);
    if (arr.length < 5) {
      arr.push({ id: entry._id, collectable: entry.collectable || null, manual: entry.manual || null });
    }
  });
  return map;
}

async function getFeed(req, res) {
  const scope = String(req.query.scope || 'global').toLowerCase();
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 50);
  const skip = Math.max(parseInt(req.query.skip || '0', 10), 0);
  const typeFilter = req.query.type ? String(req.query.type).trim() : '';
  const ownerOverride = req.query.ownerId ? String(req.query.ownerId).trim() : '';
  const since = req.query.since ? new Date(req.query.since) : null;

  const viewer = await User.findById(req.user.id).select('city state country');
  if (!viewer) return res.status(404).json({ error: 'User not found' });
  const viewerId = String(viewer._id);

  const friendIds = await fetchFriendIds(viewer._id);
  const match = {};
  const filters = { type: typeFilter || null, ownerId: ownerOverride || null };

  if (typeFilter) match.type = typeFilter;
  if (since && !Number.isNaN(since.valueOf())) match.updatedAt = { $gte: since };

  let allowedVisibility = ['public'];
  let ownerFilter;

  if (ownerOverride) {
    const overrideId = toObjectId(ownerOverride);
    if (!overrideId) return res.status(400).json({ error: 'Invalid ownerId' });
    ownerFilter = overrideId;
    if (ownerOverride === viewerId) allowedVisibility = ['public', 'friends', 'private'];
  } else if (scope === 'friends') {
    if (!friendIds.size) return res.json({ scope, filters, paging: { limit, skip }, entries: [] });
    ownerFilter = { $in: toObjectIds(Array.from(friendIds)) };
    allowedVisibility = ['public', 'friends'];
  } else if (scope === 'nearby') {
    allowedVisibility = ['public'];
    const locationQuery = {};
    if (viewer.city) locationQuery.city = viewer.city;
    if (viewer.state) locationQuery.state = viewer.state;
    if (viewer.country) locationQuery.country = viewer.country;
    if (!Object.keys(locationQuery).length) {
      return res.json({ scope, filters, paging: { limit, skip }, entries: [] });
    }
    const nearbyUsers = await User.find(locationQuery).select('_id');
    const nearbyIds = new Set(nearbyUsers.map((u) => String(u._id)));
    nearbyIds.add(viewerId);
    ownerFilter = { $in: toObjectIds(Array.from(nearbyIds)) };
  } else if (scope === 'mine') {
    allowedVisibility = ['public', 'friends', 'private'];
    ownerFilter = viewer._id;
  }

  match.visibility = { $in: allowedVisibility };
  if (ownerFilter) match.owner = ownerFilter;
  if (!ownerFilter && scope === 'global') {
    match.owner = { $ne: viewer._id };
  }

  const shelves = await Shelf.find(match)
    .populate('owner', 'username name firstName lastName picture city state country')
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit);

  const validShelves = shelves.filter((s) => s.owner);
  if (!validShelves.length) {
    return res.json({ scope, filters, paging: { limit, skip }, entries: [] });
  }

  const shelfIds = validShelves.map((s) => s._id);
  const items = await UserCollection.find({ shelf: { $in: shelfIds } })
    .populate('collectable')
    .populate('manual')
    .sort({ createdAt: -1 });

  const itemMap = summarizeItems(items);
  const counts = await UserCollection.aggregate([
    { $match: { shelf: { $in: shelfIds } } },
    { $group: { _id: '$shelf', total: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((doc) => [String(doc._id), doc.total]));

  const entries = validShelves.map((shelfDoc) => {
    const shelfId = String(shelfDoc._id);
    const owner = shelfDoc.owner;
    return {
      shelf: {
        id: shelfId,
        name: shelfDoc.name,
        type: shelfDoc.type,
        description: shelfDoc.description,
        visibility: shelfDoc.visibility,
        createdAt: shelfDoc.createdAt,
        updatedAt: shelfDoc.updatedAt,
        itemCount: countMap.get(shelfId) || 0,
      },
      owner: {
        id: String(owner._id),
        username: owner.username,
        name: owner.name || [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim() || undefined,
        city: owner.city,
        state: owner.state,
        country: owner.country,
        picture: owner.picture,
      },
      items: itemMap.get(shelfId) || [],
    };
  });

  res.json({ scope, filters, paging: { limit, skip }, entries });
}

async function getFeedEntryDetails(req, res) {
  const shelfId = String(req.params.shelfId || '').trim();
  const objectId = toObjectId(shelfId);
  if (!objectId) return res.status(400).json({ error: 'Invalid shelf id' });

  const viewer = await User.findById(req.user.id).select('city state country');
  if (!viewer) return res.status(404).json({ error: 'User not found' });

  const shelfDoc = await Shelf.findById(objectId)
    .populate('owner', 'username name firstName lastName picture city state country visibility');
  if (!shelfDoc || !shelfDoc.owner) return res.status(404).json({ error: 'Feed entry not found' });

  const viewerId = String(viewer._id);
  const ownerId = String(shelfDoc.owner._id);

  let allowed = false;
  if (ownerId === viewerId) {
    allowed = true;
  } else if (shelfDoc.visibility === 'public') {
    allowed = true;
  } else if (shelfDoc.visibility === 'friends') {
    const friendIds = await fetchFriendIds(viewer._id);
    allowed = friendIds.has(ownerId);
  }

  if (!allowed) return res.status(403).json({ error: 'You do not have access to this feed entry' });

  const items = await UserCollection.find({ shelf: shelfDoc._id })
    .populate('collectable')
    .populate('manual')
    .sort({ createdAt: -1 });

  const entry = {
    shelf: {
      id: String(shelfDoc._id),
      name: shelfDoc.name,
      type: shelfDoc.type,
      description: shelfDoc.description,
      visibility: shelfDoc.visibility,
      createdAt: shelfDoc.createdAt,
      updatedAt: shelfDoc.updatedAt,
      itemCount: items.length,
    },
    owner: {
      id: ownerId,
      username: shelfDoc.owner.username,
      name:
        shelfDoc.owner.name ||
        [shelfDoc.owner.firstName, shelfDoc.owner.lastName].filter(Boolean).join(' ').trim() ||
        undefined,
      city: shelfDoc.owner.city,
      state: shelfDoc.owner.state,
      country: shelfDoc.owner.country,
      picture: shelfDoc.owner.picture,
    },
    items: items.map((entryDoc) => ({
      id: String(entryDoc._id),
      collectable: entryDoc.collectable || null,
      manual: entryDoc.manual || null,
      createdAt: entryDoc.createdAt,
      updatedAt: entryDoc.updatedAt,
    })),
  };

  res.json({ entry });
}

module.exports = { getFeed, getFeedEntryDetails };

