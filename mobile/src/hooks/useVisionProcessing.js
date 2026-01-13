import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { apiRequest } from '../services/api';

const POLL_INTERVAL_MS = 2000;

/**
 * Hook for managing vision processing with polling and abort support
 */
export function useVisionProcessing({ apiBase, token, shelfId, onComplete, navigation }) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [jobId, setJobId] = useState(null);
    const [status, setStatus] = useState(null);
    const [progress, setProgress] = useState(0);
    const [message, setMessage] = useState('');
    const [isBackground, setIsBackground] = useState(false);

    const pollIntervalRef = useRef(null);
    const { showToast } = useToast();

    // Clear polling on unmount
    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, []);

    /**
     * Start vision processing for an image
     */
    const startProcessing = useCallback(async (imageBase64) => {
        setIsProcessing(true);
        setIsBackground(false);
        setProgress(0);
        setMessage('Starting vision processing...');
        setStatus('starting');

        try {
            // Start async processing
            const response = await apiRequest({
                apiBase,
                path: `/api/shelves/${shelfId}/vision`,
                method: 'POST',
                token,
                body: { imageBase64, async: true },
            });

            if (response.jobId) {
                setJobId(response.jobId);
                startPolling(response.jobId);
            } else {
                // Synchronous response (legacy fallback)
                handleComplete(response);
            }
        } catch (err) {
            handleError(err);
        }
    }, [apiBase, shelfId, token]);

    /**
     * Start polling for job status
     */
    const startPolling = useCallback((currentJobId) => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
        }

        pollIntervalRef.current = setInterval(async () => {
            try {
                const response = await apiRequest({
                    apiBase,
                    path: `/api/shelves/${shelfId}/vision/${currentJobId}/status`,
                    token,
                });

                setStatus(response.status);
                setProgress(response.progress || 0);
                setMessage(response.message || '');

                if (response.status === 'completed') {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                    handleComplete(response);
                } else if (response.status === 'failed' || response.status === 'aborted') {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                    handleError({ message: response.message || 'Processing failed' });
                }
            } catch (err) {
                // Continue polling unless completely failed
                console.warn('Polling error:', err);
            }
        }, POLL_INTERVAL_MS);
    }, [apiBase, shelfId, token]);

    /**
     * Handle successful completion
     */
    const handleComplete = useCallback((response) => {
        setIsProcessing(false);
        setProgress(100);
        setStatus('completed');

        const addedCount = response.result?.addedCount || response.addedItems?.length || 0;
        const needsReviewCount = response.result?.needsReviewCount || response.needsReview?.length || 0;

        // If in background mode, show toast
        if (isBackground) {
            if (needsReviewCount > 0) {
                showToast({
                    message: `Scan complete! ${addedCount} items added, ${needsReviewCount} need review`,
                    type: 'warning',
                    actionLabel: 'View',
                    onAction: () => {
                        navigation?.navigate('Unmatched');
                    },
                });
            } else {
                showToast({
                    message: `Scan complete! ${addedCount} items added to your shelf`,
                    type: 'success',
                });
            }
        }

        if (onComplete) {
            onComplete({
                addedCount,
                needsReviewCount,
                items: response.items,
            });
        }
    }, [isBackground, showToast, navigation, onComplete]);

    /**
     * Handle error
     */
    const handleError = useCallback((err) => {
        setIsProcessing(false);
        setStatus('failed');
        setMessage(err.message || 'Processing failed');

        if (isBackground) {
            showToast({
                message: err.message || 'Vision scan failed',
                type: 'error',
            });
        }
    }, [isBackground, showToast]);

    /**
     * Cancel processing (aborts server-side)
     */
    const cancelProcessing = useCallback(async () => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }

        if (jobId) {
            try {
                await apiRequest({
                    apiBase,
                    path: `/api/shelves/${shelfId}/vision/${jobId}`,
                    method: 'DELETE',
                    token,
                });
            } catch (err) {
                console.warn('Failed to abort job:', err);
            }
        }

        setIsProcessing(false);
        setJobId(null);
        setStatus('cancelled');
    }, [apiBase, shelfId, token, jobId]);

    /**
     * Hide modal but continue processing in background
     */
    const hideToBackground = useCallback(() => {
        setIsBackground(true);
    }, []);

    return {
        isProcessing,
        isBackground,
        jobId,
        status,
        progress,
        message,
        startProcessing,
        cancelProcessing,
        hideToBackground,
    };
}

export default useVisionProcessing;
