const Friendship = require('../models/Friendship');
const User = require('../models/User');

function formatUser(user) {
  if (!user) return null;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return {
    id: String(user._id),
    username: user.username,
    name: user.name || (fullName || undefined),
    picture: user.picture,
  };
}


function buildLocation(user) {
  return [user.city, user.state, user.country].filter(Boolean).join(', ') || null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function categorizeUsernameLower(value) {
  if (!value) return undefined;
  const first = value[0];
  if (first >= 'a' && first <= 'z') return first;
  if (first >= '0' && first <= '9') return '#';
  return '*';
}

async function searchUsers(req, res) {
  const rawQuery = req.query.q !== undefined ? req.query.q : req.query.query;
  const query = String(rawQuery || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 50);

  if (!query) {
    return res.json({ users: [] });
  }

  const viewerId = String(req.user.id);
  const lowered = query.toLowerCase();
  const regex = new RegExp(escapeRegex(query), 'i');
  const tokenParts = Array.from(new Set(lowered.split(/[^a-z0-9]+/).filter(Boolean)));

  const orConditions = [
    { usernameLower: { $regex: regex } },
    { username: { $regex: regex } },
    { name: { $regex: regex } },
    { firstName: { $regex: regex } },
    { lastName: { $regex: regex } },
  ];

  if (tokenParts.length) {
    orConditions.push({ searchTokens: { $in: tokenParts } });
  }

  if (query.includes('@')) {
    orConditions.push({ email: { $regex: regex } });
  }

  const candidates = await User.find({
    _id: { $ne: viewerId },
    $or: orConditions,
  })
    .select('username usernameLower usernameCategory name firstName lastName picture city state country email')
    .limit(limit);

  if (!candidates.length) {
    return res.json({ users: [] });
  }

  const candidateIds = candidates.map((user) => user._id);

  const friendships = await Friendship.find({
    $or: [
      { requester: viewerId, addressee: { $in: candidateIds } },
      { addressee: viewerId, requester: { $in: candidateIds } },
    ],
  });

  const relationMap = new Map();

  friendships.forEach((doc) => {
    const requesterId = String(doc.requester);
    const addresseeId = String(doc.addressee);
    const isRequester = requesterId === viewerId;
    const otherId = isRequester ? addresseeId : requesterId;
    relationMap.set(otherId, { doc, role: isRequester ? 'outgoing' : 'incoming' });
  });

  const users = candidates.map((candidate) => {
    const base = formatUser(candidate);
    const relationInfo = relationMap.get(String(candidate._id)) || null;

    let relation = 'none';
    let friendshipId = null;
    let status = null;
    let direction = null;

    if (relationInfo) {
      const { doc, role } = relationInfo;
      friendshipId = String(doc._id);
      status = doc.status;
      direction = role;
      if (doc.status === 'accepted') relation = 'friends';
      else if (doc.status === 'pending') relation = role === 'outgoing' ? 'outgoing' : 'incoming';
      else if (doc.status === 'blocked') relation = 'blocked';
      else relation = doc.status;
    }

    const derivedCategory =
      candidate.usernameCategory ||
      categorizeUsernameLower(candidate.usernameLower || (candidate.username ? candidate.username.toLowerCase() : undefined));

    return {
      ...base,
      location: buildLocation(candidate),
      category: derivedCategory,
      relation,
      status,
      direction,
      friendshipId,
    };
  });

  res.json({ users });
}
async function listFriendships(req, res) {
  const friendships = await Friendship.find({
    $or: [
      { requester: req.user.id },
      { addressee: req.user.id },
    ],
  })
    .populate('requester', 'username name firstName lastName picture')
    .populate('addressee', 'username name firstName lastName picture')
    .sort({ updatedAt: -1 });

  const items = friendships.map((entry) => ({
    id: String(entry._id),
    status: entry.status,
    requester: formatUser(entry.requester),
    addressee: formatUser(entry.addressee),
    isRequester: String(entry.requester?._id) === String(req.user.id),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    message: entry.message || null,
  }));

  res.json({ friendships: items });
}

async function sendFriendRequest(req, res) {
  const { targetUserId, message } = req.body ?? {};
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId is required' });
  if (String(targetUserId) === String(req.user.id)) {
    return res.status(400).json({ error: 'You cannot befriend yourself' });
  }

  const target = await User.findById(targetUserId).select('_id');
  if (!target) return res.status(404).json({ error: 'Target user not found' });

  const reverse = await Friendship.findOne({ requester: targetUserId, addressee: req.user.id });
  if (reverse) {
    if (reverse.status === 'pending') {
      reverse.status = 'accepted';
      reverse.message = message || reverse.message;
      await reverse.save();
      return res.json({ friendship: reverse.toObject(), autoAccepted: true });
    }
    if (reverse.status === 'accepted') {
      return res.json({ friendship: reverse.toObject(), alreadyFriends: true });
    }
  }

  const existing = await Friendship.findOne({ requester: req.user.id, addressee: targetUserId });
  if (existing) {
    existing.message = message || existing.message;
    await existing.save();
    return res.json({ friendship: existing.toObject(), refreshed: true });
  }

  const friendship = await Friendship.create({
    requester: req.user.id,
    addressee: targetUserId,
    message,
  });
  res.status(201).json({ friendship });
}

async function respondToRequest(req, res) {
  const { friendshipId, action } = req.body ?? {};
  if (!friendshipId || !action) return res.status(400).json({ error: 'friendshipId and action are required' });

  const friendship = await Friendship.findById(friendshipId);
  if (!friendship) return res.status(404).json({ error: 'Friendship not found' });

  const userId = String(req.user.id);
  const isRequester = String(friendship.requester) === userId;
  const isAddressee = String(friendship.addressee) === userId;

  if (!isRequester && !isAddressee) {
    return res.status(403).json({ error: 'Not allowed to modify this friendship' });
  }

  if (action === 'accept') {
    if (!isAddressee) return res.status(403).json({ error: 'Only the recipient can accept' });
    friendship.status = 'accepted';
    await friendship.save();
    return res.json({ friendship });
  }

  if (action === 'reject') {
    if (!isAddressee) return res.status(403).json({ error: 'Only the recipient can reject' });
    await friendship.deleteOne();
    return res.json({ removed: true });
  }

  if (action === 'cancel') {
    if (!isRequester) return res.status(403).json({ error: 'Only the requester can cancel' });
    await friendship.deleteOne();
    return res.json({ removed: true });
  }

  if (action === 'block') {
    friendship.status = 'blocked';
    await friendship.save();
    return res.json({ friendship });
  }

  return res.status(400).json({ error: 'Unknown action' });
}

module.exports = { listFriendships, sendFriendRequest, respondToRequest, searchUsers };


