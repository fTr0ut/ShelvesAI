const { EventEmitter } = require('events');

jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../database/queries/jobRuns', () => ({
  startJobRun: jest.fn(),
  completeJobRun: jest.fn(),
  failJobRun: jest.fn(),
  appendJobEvent: jest.fn(),
}));

const requestLogger = require('../middleware/requestLogger');
const logger = require('../logger');
const {
  startJobRun,
  completeJobRun,
  failJobRun,
  appendJobEvent,
} = require('../database/queries/jobRuns');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createReqRes({ statusCode = 200 } = {}) {
  const req = {
    method: 'GET',
    originalUrl: '/api/shelves',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    get: jest.fn(() => null),
    user: null,
  };

  const res = new EventEmitter();
  res.statusCode = statusCode;

  return { req, res };
}

describe('requestLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appendJobEvent.mockResolvedValue(undefined);
    completeJobRun.mockResolvedValue(undefined);
    failJobRun.mockResolvedValue(undefined);
  });

  test('waits for startJobRun before writing job_events or finalizing', async () => {
    const deferredStart = createDeferred();
    startJobRun.mockReturnValueOnce(deferredStart.promise);

    const { req, res } = createReqRes({ statusCode: 200 });
    const next = jest.fn();
    requestLogger(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    res.emit('finish');
    await flushPromises();

    expect(appendJobEvent).not.toHaveBeenCalled();
    expect(completeJobRun).not.toHaveBeenCalled();
    expect(failJobRun).not.toHaveBeenCalled();

    deferredStart.resolve();
    await flushPromises();
    await flushPromises();

    expect(startJobRun).toHaveBeenCalledTimes(1);
    expect(appendJobEvent).toHaveBeenCalledTimes(2);
    expect(completeJobRun).toHaveBeenCalledTimes(1);
    expect(failJobRun).not.toHaveBeenCalled();

    const startedPayload = appendJobEvent.mock.calls[0][0];
    const finishedPayload = appendJobEvent.mock.calls[1][0];

    expect(startedPayload.message).toBe('Request started');
    expect(finishedPayload.message).toBe('Request finished');
    expect(startedPayload.jobId).toBe(finishedPayload.jobId);
    expect(startedPayload.jobId).toMatch(/^req_[a-f0-9]{8}$/);
  });

  test('skips events and finalization when startJobRun fails', async () => {
    startJobRun.mockRejectedValueOnce(new Error('insert failed'));

    const { req, res } = createReqRes({ statusCode: 200 });
    const next = jest.fn();
    requestLogger(req, res, next);

    res.emit('finish');
    await flushPromises();
    await flushPromises();

    expect(startJobRun).toHaveBeenCalledTimes(1);
    expect(appendJobEvent).not.toHaveBeenCalled();
    expect(completeJobRun).not.toHaveBeenCalled();
    expect(failJobRun).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[requestLogger] startJobRun failed',
      expect.objectContaining({ error: 'insert failed' })
    );
  });
});
