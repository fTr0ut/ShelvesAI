/**
 * MusicBrainzRequestQueue
 *
 * FIFO request queue that enforces a minimum wall-clock interval between
 * consecutive requests to the MusicBrainz API (default: >= 1000 ms).
 *
 * Spacing is measured from the *start* of one request to the *start* of the
 * next, so slow responses do not create unnecessary extra gaps.
 */

class MusicBrainzRequestQueue {
    /**
     * @param {object} [options]
     * @param {number} [options.minIntervalMs=1000] - Minimum ms between request starts.
     * @param {function(number): Promise<void>} [options.delayFn] - Injected delay for testing.
     */
    constructor({
        minIntervalMs = 1000,
        delayFn = (ms) => new Promise((r) => setTimeout(r, ms)),
    } = {}) {
        this._minIntervalMs = minIntervalMs;
        this._delayFn = delayFn;

        /** @type {number|null} Wall-clock time (ms) when the last request started. */
        this._lastRequestTime = null;

        /** @type {boolean} Whether the queue loop is currently running. */
        this._running = false;

        /** @type {Array<{fn: Function, resolve: Function, reject: Function}>} */
        this._queue = [];
    }

    /**
     * Enqueue an async function for execution.
     *
     * @param {function(): Promise<*>} fn - The async function to execute.
     * @returns {Promise<*>} Resolves/rejects with fn's result.
     */
    enqueue(fn) {
        return new Promise((resolve, reject) => {
            this._queue.push({ fn, resolve, reject });
            this._maybeStart();
        });
    }

    /**
     * Start the processing loop if it is not already running.
     * @private
     */
    _maybeStart() {
        if (!this._running) {
            this._running = true;
            this._processNext();
        }
    }

    /**
     * Process the next item in the queue, then schedule the one after it.
     * @private
     */
    _processNext() {
        if (this._queue.length === 0) {
            this._running = false;
            return;
        }

        const { fn, resolve, reject } = this._queue.shift();

        const now = Date.now();
        const elapsed = this._lastRequestTime === null ? Infinity : now - this._lastRequestTime;
        const wait = Math.max(0, this._minIntervalMs - elapsed);

        const execute = () => {
            this._lastRequestTime = Date.now();
            Promise.resolve()
                .then(() => fn())
                .then(resolve, reject)
                .finally(() => {
                    this._processNext();
                });
        };

        if (wait > 0) {
            this._delayFn(wait).then(execute);
        } else {
            execute();
        }
    }
}

// Singleton instance
let _instance = null;

/**
 * Returns the shared MusicBrainzRequestQueue singleton.
 * @returns {MusicBrainzRequestQueue}
 */
function getRequestQueue() {
    if (!_instance) {
        _instance = new MusicBrainzRequestQueue();
    }
    return _instance;
}

module.exports = { MusicBrainzRequestQueue, getRequestQueue };
