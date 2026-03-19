const { MusicBrainzRequestQueue, getRequestQueue } = require('./MusicBrainzRequestQueue');

describe('MusicBrainzRequestQueue', () => {
    /**
     * Build a queue with a fake clock and controllable delay.
     * `currentTime` is mutated by delayFn to simulate wall-clock advancement.
     */
    function buildQueue(minIntervalMs = 1000) {
        let currentTime = 0;
        const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

        const delayFn = jest.fn().mockImplementation(async (ms) => {
            currentTime += ms;
        });

        const queue = new MusicBrainzRequestQueue({ minIntervalMs, delayFn });

        return { queue, delayFn, dateSpy, advanceTime: (ms) => { currentTime += ms; } };
    }

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('executes a single enqueued function and resolves with its return value', async () => {
        const { queue } = buildQueue();
        const result = await queue.enqueue(() => Promise.resolve(42));
        expect(result).toBe(42);
    });

    it('executes immediately when the queue is idle and no prior request has been made', async () => {
        const { queue, delayFn } = buildQueue();
        await queue.enqueue(() => Promise.resolve('first'));
        expect(delayFn).not.toHaveBeenCalled();
    });

    it('executes immediately when enough time has already passed since the last request', async () => {
        const { queue, delayFn, advanceTime } = buildQueue(1000);

        // First request — no delay expected
        await queue.enqueue(() => Promise.resolve('first'));

        // Advance clock past the minimum interval
        advanceTime(1500);

        // Second request — should also execute without delay
        await queue.enqueue(() => Promise.resolve('second'));

        // delayFn should never have been called with a positive value
        const positiveCalls = delayFn.mock.calls.filter(([ms]) => ms > 0);
        expect(positiveCalls).toHaveLength(0);
    });

    it('enforces minimum spacing between consecutive requests', async () => {
        const { queue, delayFn } = buildQueue(1000);

        const order = [];

        // Enqueue two requests simultaneously (queue is idle at t=0)
        const p1 = queue.enqueue(async () => { order.push('first'); });
        const p2 = queue.enqueue(async () => { order.push('second'); });

        await Promise.all([p1, p2]);

        // The second request must have been delayed
        expect(delayFn).toHaveBeenCalledTimes(1);
        const [delayMs] = delayFn.mock.calls[0];
        expect(delayMs).toBeGreaterThan(0);
        expect(delayMs).toBeLessThanOrEqual(1000);
    });

    it('executes requests in FIFO order', async () => {
        const { queue } = buildQueue(1000);

        const order = [];
        const p1 = queue.enqueue(async () => { order.push(1); });
        const p2 = queue.enqueue(async () => { order.push(2); });
        const p3 = queue.enqueue(async () => { order.push(3); });

        await Promise.all([p1, p2, p3]);

        expect(order).toEqual([1, 2, 3]);
    });

    it('propagates errors to the caller without stopping the queue', async () => {
        const { queue } = buildQueue(1000);

        const error = new Error('boom');
        const p1 = queue.enqueue(() => Promise.reject(error));
        const p2 = queue.enqueue(() => Promise.resolve('after error'));

        await expect(p1).rejects.toThrow('boom');
        await expect(p2).resolves.toBe('after error');
    });

    it('continues processing after a synchronous throw inside fn', async () => {
        const { queue } = buildQueue(1000);

        const p1 = queue.enqueue(() => { throw new Error('sync throw'); });
        const p2 = queue.enqueue(() => Promise.resolve('ok'));

        await expect(p1).rejects.toThrow('sync throw');
        await expect(p2).resolves.toBe('ok');
    });

    it('handles many concurrent enqueues correctly', async () => {
        const { queue } = buildQueue(0); // no delay for speed

        const results = await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
                queue.enqueue(() => Promise.resolve(i))
            )
        );

        expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
});

describe('getRequestQueue', () => {
    it('returns the same singleton instance on repeated calls', () => {
        const a = getRequestQueue();
        const b = getRequestQueue();
        expect(a).toBe(b);
    });

    it('returns a MusicBrainzRequestQueue instance', () => {
        expect(getRequestQueue()).toBeInstanceOf(MusicBrainzRequestQueue);
    });
});
