import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { apiRequest } from '../services/api';

const POLL_INTERVAL_MS = 2000;

function formatItemCount(count) {
    return `${count} item${count === 1 ? '' : 's'}`;
}

function buildVisionSummaryMessage({
    addedCount = 0,
    existingCount = 0,
    needsReviewCount = 0,
    extractedCount = 0,
} = {}) {
    if (needsReviewCount > 0) {
        if (addedCount > 0 && existingCount > 0) {
            return `${formatItemCount(addedCount)} added. ${formatItemCount(existingCount)} already on your shelf. ${formatItemCount(needsReviewCount)} need review.`;
        }
        if (addedCount > 0) {
            return `${formatItemCount(addedCount)} added. ${formatItemCount(needsReviewCount)} need review.`;
        }
        if (existingCount > 0) {
            return `No new items added. ${formatItemCount(existingCount)} already on your shelf. ${formatItemCount(needsReviewCount)} need review.`;
        }
        return `${formatItemCount(needsReviewCount)} need review.`;
    }

    if (addedCount > 0) {
        if (existingCount > 0) {
            return `${formatItemCount(addedCount)} added. ${formatItemCount(existingCount)} already on your shelf.`;
        }
        return `${formatItemCount(addedCount)} added to your shelf.`;
    }

    if (existingCount > 0) {
        return `No new items added. ${formatItemCount(existingCount)} already on your shelf.`;
    }

    if (extractedCount > 0) {
        return `${formatItemCount(extractedCount)} detected, but no new items were added.`;
    }

    return 'No items were detected.';
}

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
    const isMountedRef = useRef(true);
    const { showToast } = useToast();

    // Clear polling on unmount and mark as unmounted
    useEffect(() => {
        return () => {
            isMountedRef.current = false;
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

                if (!isMountedRef.current) return;

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
        const existingCount = response.result?.existingCount || response.result?.results?.existing || 0;
        const extractedCount = response.result?.extractedCount || response.result?.results?.extracted || 0;
        const summaryMessage =
            response.result?.summaryMessage ||
            buildVisionSummaryMessage({ addedCount, existingCount, needsReviewCount, extractedCount });

        // If in background mode, show toast
        if (isBackground) {
            if (needsReviewCount > 0) {
                showToast({
                    message: `Scan complete! ${summaryMessage}`,
                    type: 'warning',
                    actionLabel: 'View',
                    onAction: () => {
                        navigation?.navigate('Unmatched');
                    },
                });
            } else {
                showToast({
                    message: `Scan complete! ${summaryMessage}`,
                    type: 'success',
                });
            }
        }

        if (onComplete) {
            onComplete({
                addedCount,
                needsReviewCount,
                existingCount,
                extractedCount,
                summaryMessage,
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
