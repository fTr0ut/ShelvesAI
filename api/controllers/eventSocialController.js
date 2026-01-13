const eventSocialQueries = require('../database/queries/eventSocial');
const { parsePagination } = require('../database/queries/utils');

async function toggleLike(req, res) {
  try {
    const eventId = String(req.params.eventId || '').trim();
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });

    const exists = await eventSocialQueries.ensureEventExists(eventId);
    if (!exists) return res.status(404).json({ error: 'Feed entry not found' });

    const result = await eventSocialQueries.toggleLike(eventId, req.user.id);
    res.json(result);
  } catch (err) {
    console.error('toggleLike error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function addComment(req, res) {
  try {
    const eventId = String(req.params.eventId || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });
    if (!content) return res.status(400).json({ error: 'content is required' });

    const exists = await eventSocialQueries.ensureEventExists(eventId);
    if (!exists) return res.status(404).json({ error: 'Feed entry not found' });

    const comment = await eventSocialQueries.addComment(eventId, req.user.id, content);
    const { commentCount } = await eventSocialQueries.getComments(eventId, { limit: 1, offset: 0 });

    res.status(201).json({ comment, commentCount });
  } catch (err) {
    console.error('addComment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getComments(req, res) {
  try {
    const eventId = String(req.params.eventId || '').trim();
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });

    const exists = await eventSocialQueries.ensureEventExists(eventId);
    if (!exists) return res.status(404).json({ error: 'Feed entry not found' });

    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const result = await eventSocialQueries.getComments(eventId, { limit, offset });

    res.json({
      comments: result.comments,
      commentCount: result.commentCount,
      paging: { limit, offset }
    });
  } catch (err) {
    console.error('getComments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function deleteComment(req, res) {
  try {
    const eventId = String(req.params.eventId || '').trim();
    const commentId = parseInt(req.params.commentId, 10);
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });
    if (Number.isNaN(commentId)) return res.status(400).json({ error: 'Invalid comment id' });

    const exists = await eventSocialQueries.ensureEventExists(eventId);
    if (!exists) return res.status(404).json({ error: 'Feed entry not found' });

    const deleted = await eventSocialQueries.deleteComment(commentId, eventId, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Comment not found' });

    res.json({ deleted: true, id: commentId });
  } catch (err) {
    console.error('deleteComment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  toggleLike,
  addComment,
  getComments,
  deleteComment,
};
