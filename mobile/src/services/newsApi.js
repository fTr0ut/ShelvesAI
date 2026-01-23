import { apiRequest } from './api';

export async function dismissNewsItem({ apiBase, token, newsItemId }) {
    if (!newsItemId) throw new Error('Missing newsItemId');
    return apiRequest({
        apiBase,
        path: '/api/discover/dismiss',
        method: 'POST',
        token,
        body: { newsItemId },
    });
}
