const { query, transaction } = require('../pg');
const { rowToCamelCase, parsePagination } = require('./utils');

async function ensureEventExists(eventId) {
  const result = await query('SELECT 1 FROM event_aggregates WHERE id = $1', [eventId]);
  return result.rowCount > 0;
}

async function getEventOwner(eventId) {
  const result = await query(
    'SELECT user_id FROM event_aggregates WHERE id = $1',
    [eventId]
  );
  return result.rows[0]?.user_id || null;
}

async function toggleLike(eventId, userId) {
  return transaction(async (client) => {
    const existing = await client.query(
      'SELECT 1 FROM event_likes WHERE event_id = $1 AND user_id = $2',
      [eventId, userId]
    );

    let liked = false;
    if (existing.rows.length) {
      await client.query(
        'DELETE FROM event_likes WHERE event_id = $1 AND user_id = $2',
        [eventId, userId]
      );
    } else {
      await client.query(
        'INSERT INTO event_likes (event_id, user_id) VALUES ($1, $2)',
        [eventId, userId]
      );
      liked = true;
    }

    const countResult = await client.query(
      'SELECT COUNT(*)::int AS like_count FROM event_likes WHERE event_id = $1',
      [eventId]
    );

    return { liked, likeCount: countResult.rows[0]?.like_count || 0 };
  });
}

async function addComment(eventId, userId, content) {
  const result = await query(
    `WITH inserted AS (
        INSERT INTO event_comments (event_id, user_id, content)
        VALUES ($1, $2, $3)
        RETURNING id, event_id, user_id, content, created_at
     )
     SELECT inserted.*, u.username, u.picture, pm.local_path as profile_media_path
     FROM inserted
     LEFT JOIN users u ON u.id = inserted.user_id
     LEFT JOIN profile_media pm ON pm.id = u.profile_media_id`,
    [eventId, userId, content]
  );

  const row = rowToCamelCase(result.rows[0]);
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt,
    user: {
      id: row.userId,
      username: row.username,
      picture: row.picture,
      profileMediaPath: row.profileMediaPath,
    },
  };
}

async function getComments(eventId, { limit = 20, offset = 0 } = {}) {
  const result = await query(
    `SELECT ec.id, ec.content, ec.created_at, ec.user_id,
            u.username, u.picture, pm.local_path as profile_media_path
     FROM event_comments ec
     LEFT JOIN users u ON u.id = ec.user_id
     LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
     WHERE ec.event_id = $1
     ORDER BY ec.created_at DESC
     LIMIT $2 OFFSET $3`,
    [eventId, limit, offset]
  );

  const countResult = await query(
    'SELECT COUNT(*)::int AS comment_count FROM event_comments WHERE event_id = $1',
    [eventId]
  );

  const comments = result.rows.map((row) => {
    const item = rowToCamelCase(row);
    return {
      id: item.id,
      content: item.content,
      createdAt: item.createdAt,
      user: {
        id: item.userId,
        username: item.username,
        picture: item.picture,
        profileMediaPath: item.profileMediaPath,
      },
    };
  });

  return { comments, commentCount: countResult.rows[0]?.comment_count || 0 };
}

async function deleteComment(commentId, eventId, userId) {
  const result = await query(
    `DELETE FROM event_comments
     WHERE id = $1 AND event_id = $2 AND user_id = $3
     RETURNING id, event_id`,
    [commentId, eventId, userId]
  );
  return result.rows[0] ? rowToCamelCase(result.rows[0]) : null;
}

async function getSocialSummaries(eventIds, userId) {
  if (!Array.isArray(eventIds) || eventIds.length === 0) return new Map();

  const result = await query(
    `WITH ids AS (
        SELECT unnest($1::uuid[]) AS event_id
     ),
     like_counts AS (
        SELECT event_id, COUNT(*)::int AS like_count
        FROM event_likes
        WHERE event_id = ANY($1)
        GROUP BY event_id
     ),
     comment_counts AS (
        SELECT event_id, COUNT(*)::int AS comment_count
        FROM event_comments
        WHERE event_id = ANY($1)
        GROUP BY event_id
     ),
     top_comments AS (
        SELECT DISTINCT ON (event_id) event_id, id, user_id, content, created_at
        FROM event_comments
        WHERE event_id = ANY($1)
        ORDER BY event_id, created_at DESC
     ),
     user_likes AS (
        SELECT event_id
        FROM event_likes
        WHERE event_id = ANY($1) AND user_id = $2
     )
     SELECT ids.event_id,
            COALESCE(like_counts.like_count, 0) AS like_count,
            COALESCE(comment_counts.comment_count, 0) AS comment_count,
            (user_likes.event_id IS NOT NULL) AS has_liked,
            top_comments.id AS top_comment_id,
            top_comments.content AS top_comment_content,
            top_comments.created_at AS top_comment_created_at,
            u.username AS top_comment_username,
            u.picture AS top_comment_picture,
            pm.local_path AS top_comment_profile_media_path
     FROM ids
     LEFT JOIN like_counts ON like_counts.event_id = ids.event_id
     LEFT JOIN comment_counts ON comment_counts.event_id = ids.event_id
     LEFT JOIN top_comments ON top_comments.event_id = ids.event_id
     LEFT JOIN users u ON u.id = top_comments.user_id
     LEFT JOIN profile_media pm ON pm.id = u.profile_media_id
     LEFT JOIN user_likes ON user_likes.event_id = ids.event_id`,
    [eventIds, userId || null]
  );

  const map = new Map();
  for (const row of result.rows) {
    const item = rowToCamelCase(row);
    const topComment = item.topCommentId ? {
      id: item.topCommentId,
      content: item.topCommentContent,
      username: item.topCommentUsername,
      createdAt: item.topCommentCreatedAt,
      picture: item.topCommentPicture,
      profileMediaPath: item.topCommentProfileMediaPath,
    } : null;

    map.set(item.eventId, {
      likeCount: item.likeCount || 0,
      commentCount: item.commentCount || 0,
      hasLiked: !!item.hasLiked,
      topComment,
    });
  }

  return map;
}

module.exports = {
  ensureEventExists,
  getEventOwner,
  toggleLike,
  addComment,
  getComments,
  deleteComment,
  getSocialSummaries,
};
