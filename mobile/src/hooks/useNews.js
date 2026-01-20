import { useState, useCallback, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { apiRequest } from '../services/api';

export function useNews() {
    const { token, apiBase } = useContext(AuthContext);
    const [newsData, setNewsData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const loadNews = useCallback(async (refresh = false) => {
        if (!token) return;

        // If we already have data and are not refreshing, don't reload
        if (newsData && !refresh) return;

        setLoading(true);
        setError(null);

        try {
            // Fetch everything (category=all, item_type=all)
            // Higher limit to ensure all category+item_type combinations are well represented
            const result = await apiRequest({
                apiBase,
                path: '/api/discover?category=all&item_type=all&limit=200',
                token
            });

            if (result && result.data && result.data.grouped) {
                setNewsData(result.data.grouped);
            } else {
                setNewsData({});
            }
        } catch (err) {
            console.error('News load error:', err);
            setError('Failed to load news feed');
        } finally {
            setLoading(false);
        }
    }, [apiBase, token, newsData]);

    return {
        newsData,
        loading,
        error,
        loadNews
    };
}
