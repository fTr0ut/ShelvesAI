const friendshipQueries = require('../database/queries/friendships');
const { query } = require('../database/pg');
const { rowToCamelCase, parsePagination } = require('../database/queries/utils');

function formatUser(user) {
  if (!user) return null;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return {
    id: user.id,
    username: user.username,
    name: fullName || undefined,
    picture: user.picture,
  };
}

function buildLocation(user) {
  return [user.city, user.state, user.country].filter(Boolean).join(', ') || null;
}

async function searchUsers(req, res) {
  try {
    const rawQuery = req.query.q !== undefined ? req.query.q : req.query.query;
    const searchTerm = String(rawQuery || '').trim();
    const { limit } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 50 });

    if (!searchTerm) {
      return res.json({ users: [] });
    }

    const viewerId = req.user.id;

    // Search users using trigram similarity
    const usersResult = await query(
      `SELECT id, username, first_name, last_name, picture, city, state, country,
              similarity(username, $1) as username_sim,
              similarity(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''), $1) as name_sim
       FROM users
       WHERE id != $2
       AND (
         username % $1
         OR first_name % $1
         OR last_name % $1
         OR email ILIKE $3
       )
       ORDER BY GREATEST(
         similarity(username, $1),
         similarity(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''), $1)
       ) DESC
       LIMIT $4`,
      [searchTerm, viewerId, `%${searchTerm}%`, limit]
    );

    if (!usersResult.rows.length) {
      return res.json({ users: [] });
    }

    const candidateIds = usersResult.rows.map(u => u.id);

    // Get friendships for these users
    const friendshipsResult = await query(
      `SELECT * FROM friendships
       WHERE (requester_id = $1 AND addressee_id = ANY($2))
       OR (addressee_id = $1 AND requester_id = ANY($2))`,
      [viewerId, candidateIds]
    );

    const relationMap = new Map();
    for (const doc of friendshipsResult.rows) {
      const isRequester = doc.requester_id === viewerId;
      const otherId = isRequester ? doc.addressee_id : doc.requester_id;
      relationMap.set(otherId, { doc, role: isRequester ? 'outgoing' : 'incoming' });
    }

    const users = usersResult.rows.map(candidate => {
      const base = formatUser(candidate);
      const relationInfo = relationMap.get(candidate.id) || null;

      let relation = 'none';
      let friendshipId = null;
      let status = null;
      let direction = null;

      if (relationInfo) {
        const { doc, role } = relationInfo;
        friendshipId = doc.id;
        status = doc.status;
        direction = role;
        if (doc.status === 'accepted') relation = 'friends';
        else if (doc.status === 'pending') relation = role === 'outgoing' ? 'outgoing' : 'incoming';
        else if (doc.status === 'blocked') relation = 'blocked';
        else relation = doc.status;
      }

      return {
        ...base,
        location: buildLocation(candidate),
        relation,
        status,
        direction,
        friendshipId,
      };
    });

    res.json({ users });
  } catch (err) {
    console.error('searchUsers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function listFriendships(req, res) {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 200 });

    const result = await query(
      `SELECT f.*,
              u_req.id as req_id, u_req.username as req_username, 
              u_req.first_name as req_first_name, u_req.last_name as req_last_name, u_req.picture as req_picture,
              u_addr.id as addr_id, u_addr.username as addr_username,
              u_addr.first_name as addr_first_name, u_addr.last_name as addr_last_name, u_addr.picture as addr_picture
       FROM friendships f
       JOIN users u_req ON u_req.id = f.requester_id
       JOIN users u_addr ON u_addr.id = f.addressee_id
       WHERE f.requester_id = $1 OR f.addressee_id = $1
       ORDER BY f.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM friendships 
       WHERE requester_id = $1 OR addressee_id = $1`,
      [req.user.id]
    );
    const total = parseInt(countResult.rows[0].total);

    const items = result.rows.map(row => ({
      id: row.id,
      status: row.status,
      requester: {
        id: row.req_id,
        username: row.req_username,
        name: [row.req_first_name, row.req_last_name].filter(Boolean).join(' ').trim() || undefined,
        picture: row.req_picture,
      },
      addressee: {
        id: row.addr_id,
        username: row.addr_username,
        name: [row.addr_first_name, row.addr_last_name].filter(Boolean).join(' ').trim() || undefined,
        picture: row.addr_picture,
      },
      isRequester: row.requester_id === req.user.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      message: row.message || null,
    }));

    res.json({
      friendships: items,
      pagination: {
        limit,
        skip: offset,
        total,
        hasMore: offset + items.length < total,
      },
    });
  } catch (err) {
    console.error('listFriendships error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function sendFriendRequest(req, res) {
  try {
    const { targetUserId, message } = req.body ?? {};
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId is required' });
    if (targetUserId === req.user.id) {
      return res.status(400).json({ error: 'You cannot befriend yourself' });
    }

    // Check target exists
    const targetResult = await query('SELECT id FROM users WHERE id = $1', [targetUserId]);
    if (!targetResult.rows.length) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    // Check for reverse request (they sent us one)
    const reverseResult = await query(
      `SELECT * FROM friendships WHERE requester_id = $1 AND addressee_id = $2`,
      [targetUserId, req.user.id]
    );

    if (reverseResult.rows.length) {
      const reverse = reverseResult.rows[0];
      if (reverse.status === 'pending') {
        // Auto-accept
        await query(
          `UPDATE friendships SET status = 'accepted', message = COALESCE($1, message) WHERE id = $2`,
          [message, reverse.id]
        );
        const updated = await query('SELECT * FROM friendships WHERE id = $1', [reverse.id]);
        return res.json({ friendship: rowToCamelCase(updated.rows[0]), autoAccepted: true });
      }
      if (reverse.status === 'accepted') {
        return res.json({ friendship: rowToCamelCase(reverse), alreadyFriends: true });
      }
    }

    // Check for existing request from us
    const existingResult = await query(
      `SELECT * FROM friendships WHERE requester_id = $1 AND addressee_id = $2`,
      [req.user.id, targetUserId]
    );

    if (existingResult.rows.length) {
      await query(
        `UPDATE friendships SET message = COALESCE($1, message) WHERE id = $2`,
        [message, existingResult.rows[0].id]
      );
      const updated = await query('SELECT * FROM friendships WHERE id = $1', [existingResult.rows[0].id]);
      return res.json({ friendship: rowToCamelCase(updated.rows[0]), refreshed: true });
    }

    // Create new request
    const result = await query(
      `INSERT INTO friendships (requester_id, addressee_id, message, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [req.user.id, targetUserId, message]
    );

    res.status(201).json({ friendship: rowToCamelCase(result.rows[0]) });
  } catch (err) {
    console.error('sendFriendRequest error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function respondToRequest(req, res) {
  try {
    const { friendshipId, action } = req.body ?? {};
    if (!friendshipId || !action) {
      return res.status(400).json({ error: 'friendshipId and action are required' });
    }

    const result = await friendshipQueries.respond(friendshipId, req.user.id, action);

    if (result.error) {
      const status = result.error === 'Friendship not found' ? 404 : 403;
      return res.status(status).json({ error: result.error });
    }

    if (result.deleted) {
      return res.json({ removed: true });
    }

    res.json({ friendship: result.friendship });
  } catch (err) {
    console.error('respondToRequest error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function removeFriendship(req, res) {
  try {
    const friendshipId = parseInt(req.params.id, 10);
    if (isNaN(friendshipId)) {
      return res.status(400).json({ error: 'Invalid friendship ID' });
    }

    const removed = await friendshipQueries.remove(friendshipId, req.user.id);

    if (!removed) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    res.json({ removed: true });
  } catch (err) {
    console.error('removeFriendship error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { listFriendships, sendFriendRequest, respondToRequest, searchUsers, removeFriendship };

