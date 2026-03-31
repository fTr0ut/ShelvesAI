const checkInPostedListeners = new Set();

export function subscribeCheckInPosted(listener) {
    if (typeof listener !== 'function') return () => {};
    checkInPostedListeners.add(listener);
    return () => {
        checkInPostedListeners.delete(listener);
    };
}

export function emitCheckInPosted(payload = {}) {
    checkInPostedListeners.forEach((listener) => {
        try {
            listener(payload);
        } catch (err) {
            console.warn('[checkInEvents] listener error:', err?.message || err);
        }
    });
}

