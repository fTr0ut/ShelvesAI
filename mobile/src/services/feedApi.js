import { apiRequest } from './api';

export async function toggleLike({ apiBase, token, eventId }) {
  if (!eventId) throw new Error('Missing eventId');
  return apiRequest({
    apiBase,
    path: `/api/feed/${eventId}/like`,
    method: 'POST',
    token,
  });
}

export async function addComment({ apiBase, token, eventId, content }) {
  if (!eventId) throw new Error('Missing eventId');
  return apiRequest({
    apiBase,
    path: `/api/feed/${eventId}/comments`,
    method: 'POST',
    token,
    body: { content },
  });
}

export async function getComments({ apiBase, token, eventId, limit = 50, offset = 0 }) {
  if (!eventId) throw new Error('Missing eventId');
  return apiRequest({
    apiBase,
    path: `/api/feed/${eventId}/comments?limit=${limit}&offset=${offset}`,
    token,
  });
}
