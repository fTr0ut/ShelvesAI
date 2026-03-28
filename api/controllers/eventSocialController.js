const eventSocialQueries = require('../database/queries/eventSocial');
const notificationsQueries = require('../database/queries/notifications');
const friendshipQueries = require('../database/queries/friendships');
const usersQueries = require('../database/queries/users');
const { parsePagination } = require('../database/queries/utils');
const logger = require('../logger');

/**
 * Extract unique @username mentions from text
 */
function parseMentions(text) {
  if (!text) return [];
  const regex = /(?:^|[\s(])@([a-zA-Z0-9_]+)/g;
  const usernames = new Set();
  let match;
  while ((match = regex.exec(text)) !== null) {
    usernames.add(match[1].toLowerCase());
  }
  return [...usernames];
}

async function ensureEventAccessible(eventId, userId, res) {
  const exists = await eventSocialQueries.ensureEventExists(eventId);
  if (!exists) {
    res.status(404).json({ error: 'Feed entry not found' });
    return false;
  }

  const canView = await eventSocialQueries.canUserViewEvent(eventId, userId);
  if (!canView) {
    res.status(403).json({ error: 'You do not have access to this feed entry' });
    return false;
  }

  return true;
}

async function toggleLike(req, res) {
  try {
    const eventId = String(req.params.eventId || '').trim();
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });

    const canAccess = await ensureEventAccessible(eventId, req.user.id, res);
    if (!canAccess) return;

    const result = await eventSocialQueries.toggleLike(eventId, req.user.id);

    try {
      const ownerId = await eventSocialQueries.getEventOwner(eventId);
      if (ownerId && ownerId !== req.user.id) {
        if (result?.liked) {
          await notificationsQueries.create({
            userId: ownerId,
            actorId: req.user.id,
            type: 'like',
            entityId: eventId,
            entityType: 'event',
            metadata: {},
          });
        } else {
          await notificationsQueries.softDeleteLike({
            userId: ownerId,
            actorId: req.user.id,
            entityId: eventId,
          });
        }
      }
    } catch (err) {
      logger.warn('toggleLike notification error:', err.message);
    }
    res.json(result);
  } catch (err) {
    logger.error('toggleLike error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function addComment(req, res) {
  try {
    const eventId = String(req.params.eventId || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });
    if (!content) return res.status(400).json({ error: 'content is required' });

    const canAccess = await ensureEventAccessible(eventId, req.user.id, res);
    if (!canAccess) return;

    const comment = await eventSocialQueries.addComment(eventId, req.user.id, content);
    const { commentCount } = await eventSocialQueries.getComments(eventId, { limit: 1, offset: 0 });

    let ownerId = null;
    try {
      ownerId = await eventSocialQueries.getEventOwner(eventId);
      if (ownerId && ownerId !== req.user.id) {
        await notificationsQueries.create({
          userId: ownerId,
          actorId: req.user.id,
          type: 'comment',
          entityId: eventId,
          entityType: 'event',
          metadata: {
            commentId: comment?.id || null,
            preview: comment?.content ? String(comment.content).slice(0, 140) : null,
          },
        });
      }
    } catch (err) {
      logger.warn('addComment notification error:', err.message);
    }

    // Process @mentions and send mention notifications
    try {
      const mentionedUsernames = parseMentions(content);
      if (mentionedUsernames.length > 0) {
        const mentionedUsers = await usersQueries.findByUsernames(mentionedUsernames);
        const friendIds = await friendshipQueries.getAcceptedFriendIds(req.user.id);
        const friendIdSet = new Set(friendIds);

        for (const mentionedUser of mentionedUsers) {
          if (mentionedUser.id === req.user.id) continue;
          if (mentionedUser.id === ownerId) continue;
          if (!friendIdSet.has(mentionedUser.id)) continue;

          const canView = await eventSocialQueries.canUserViewEvent(eventId, mentionedUser.id);
          if (!canView) continue;

          await notificationsQueries.create({
            userId: mentionedUser.id,
            actorId: req.user.id,
            type: 'mention',
            entityId: eventId,
            entityType: 'event',
            metadata: {
              commentId: comment?.id || null,
              preview: content.slice(0, 140),
            },
          });
        }
      }
    } catch (err) {
      logger.warn('addComment mention notification error:', err.message);
    }

    res.status(201).json({ comment, commentCount });
  } catch (err) {
    logger.error('addComment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getComments(req, res) {
  try {
    const eventId = String(req.params.eventId || '').trim();
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });

    const canAccess = await ensureEventAccessible(eventId, req.user.id, res);
    if (!canAccess) return;

    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const result = await eventSocialQueries.getComments(eventId, { limit, offset });

    res.json({
      comments: result.comments,
      commentCount: result.commentCount,
      paging: { limit, offset }
    });
  } catch (err) {
    logger.error('getComments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteComment(req, res) {
  try {
    const eventId = String(req.params.eventId || '').trim();
    const commentId = parseInt(req.params.commentId, 10);
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });
    if (Number.isNaN(commentId)) return res.status(400).json({ error: 'Invalid comment id' });

    const canAccess = await ensureEventAccessible(eventId, req.user.id, res);
    if (!canAccess) return;

    const deleted = await eventSocialQueries.deleteComment(commentId, eventId, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Comment not found' });

    res.json({ deleted: true, id: commentId });
  } catch (err) {
    logger.error('deleteComment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  toggleLike,
  addComment,
  getComments,
  deleteComment,
};
