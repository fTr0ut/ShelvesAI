class RateLimiter {
    /**
     * @param {number} maxRequests - Max requests allowed in the time window
     * @param {number} perSeconds - Time window in seconds
     */
    constructor(maxRequests, perSeconds = 1) {
        this.maxRequests = maxRequests;
        this.perSeconds = perSeconds;
        this.timestamps = [];
    }

    async acquire() {
        const now = Date.now();
        const windowStart = now - (this.perSeconds * 1000);
        // Remove timestamps outside the window
        this.timestamps = this.timestamps.filter(t => t > windowStart);

        if (this.timestamps.length >= this.maxRequests) {
            // Wait until the oldest request expires
            const oldest = this.timestamps[0];
            const waitTime = (oldest + (this.perSeconds * 1000)) - now;
            if (waitTime > 0) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
            // Re-filter after waiting (recursive acquire or just proceed?)
            // Simplest is to recurse or re-check, but effectively we just waited enough
            // to pop one. Let's re-run acquire to be safe and accurate.
            return this.acquire();
        }

        this.timestamps.push(Date.now());
    }
}

module.exports = RateLimiter;
