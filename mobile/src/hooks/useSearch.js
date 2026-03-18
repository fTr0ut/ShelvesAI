import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useSearch — reusable hook for debounced search with cleanup.
 *
 * Eliminates DUP-6: the repeated searchQuery / searchResults / searchLoading /
 * searchTimeoutRef pattern found in SocialFeedScreen, CheckInScreen, WishlistScreen.
 *
 * @param {Function} searchFn - Async function called with the current query string.
 *   Should return the results array (or any value you want stored in `results`).
 * @param {number} [debounceMs=300] - Debounce delay in milliseconds.
 *
 * @returns {{
 *   query: string,
 *   setQuery: Function,
 *   results: any,
 *   loading: boolean,
 *   clear: Function,
 * }}
 *
 * Constraints satisfied (per task brief):
 * - Clears the debounce timeout on unmount.
 * - Exposes `clear()` so callers can call it from a navigation blur listener
 *   to address BUG-19 (setState during/after screen transition).
 * - isMounted guard prevents setState after unmount.
 */
export function useSearch(searchFn, debounceMs = 300) {
    const [query, setQueryState] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);

    const timeoutRef = useRef(null);
    const isMountedRef = useRef(true);

    // Always hold a ref to the latest searchFn to avoid stale closures.
    const searchFnRef = useRef(searchFn);
    useEffect(() => {
        searchFnRef.current = searchFn;
    });

    // Cleanup on unmount: clear pending timeout and mark unmounted.
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, []);

    const setQuery = useCallback((text) => {
        setQueryState(text);

        // Cancel any pending debounced call.
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }

        if (!text.trim()) {
            setResults(null);
            setLoading(false);
            return;
        }

        timeoutRef.current = setTimeout(async () => {
            if (!isMountedRef.current) return;
            setLoading(true);
            try {
                const data = await searchFnRef.current(text);
                if (!isMountedRef.current) return;
                setResults(data);
            } catch (err) {
                if (!isMountedRef.current) return;
                // Silently swallow search errors; callers can handle via results === null.
                console.warn('useSearch error:', err);
            } finally {
                if (isMountedRef.current) {
                    setLoading(false);
                }
            }
        }, debounceMs);
    }, [debounceMs]);

    /**
     * Clear query, results, and any pending timeout.
     * Call this from a navigation blur listener to address BUG-19.
     */
    const clear = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setQueryState('');
        setResults(null);
        setLoading(false);
    }, []);

    return { query, setQuery, results, loading, clear };
}
