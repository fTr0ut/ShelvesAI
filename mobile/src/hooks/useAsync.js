import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useAsync — reusable hook for async data fetching with isMounted guard.
 *
 * Eliminates DUP-5: the repeated useState + useEffect + try/catch/finally
 * loading pattern found across 5+ screens.
 *
 * @param {Function} asyncFn - Async function that returns the data.
 *   Receives no arguments; close over any dependencies you need.
 * @param {Array} [deps=[]] - Dependency array (same semantics as useEffect).
 *
 * @returns {{ data: any, loading: boolean, error: Error|null, refresh: Function }}
 *
 * Constraints satisfied:
 * - Uses a ref to always call the *latest* asyncFn, avoiding stale-closure bugs
 *   when the function identity changes between renders.
 * - Built-in isMounted guard prevents setState after unmount.
 * - `refresh()` triggers a manual re-fetch without changing deps.
 */
export function useAsync(asyncFn, deps = []) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Always hold a ref to the latest asyncFn so the effect closure never goes stale.
    const asyncFnRef = useRef(asyncFn);
    useEffect(() => {
        asyncFnRef.current = asyncFn;
    });

    // A counter that we increment to trigger a manual refresh.
    const [refreshCount, setRefreshCount] = useState(0);

    const refresh = useCallback(() => {
        setRefreshCount((c) => c + 1);
    }, []);

    useEffect(() => {
        let isMounted = true;

        setLoading(true);
        setError(null);

        asyncFnRef.current()
            .then((result) => {
                if (!isMounted) return;
                setData(result);
                setError(null);
            })
            .catch((err) => {
                if (!isMounted) return;
                setError(err instanceof Error ? err : new Error(String(err)));
            })
            .finally(() => {
                if (!isMounted) return;
                setLoading(false);
            });

        return () => {
            isMounted = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshCount, ...deps]);

    return { data, loading, error, refresh };
}
