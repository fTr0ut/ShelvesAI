const { getJobId, getUserId } = require('../context');
const { createWorkflowJobContext } = require('../middleware/workflowJobContext');

describe('workflowJobContext', () => {
  test('assigns workflow jobId, user context, and response header', async () => {
    const middleware = createWorkflowJobContext('vision');
    const req = { user: { id: 'user-123' } };
    const headers = {};
    const res = {
      headersSent: false,
      setHeader: jest.fn((name, value) => {
        headers[name.toLowerCase()] = value;
      }),
    };

    const contextSnapshot = await new Promise((resolve, reject) => {
      middleware(req, res, () => {
        Promise.resolve()
          .then(() => {
            resolve({
              reqJobId: req.jobId,
              contextJobId: getJobId(),
              contextUserId: getUserId(),
              headerJobId: headers['x-job-id'],
            });
          })
          .catch(reject);
      });
    });

    expect(contextSnapshot.reqJobId).toMatch(/^wf_vision_[a-f0-9]{10}$/);
    expect(contextSnapshot.contextJobId).toBe(contextSnapshot.reqJobId);
    expect(contextSnapshot.contextUserId).toBe('user-123');
    expect(contextSnapshot.headerJobId).toBe(contextSnapshot.reqJobId);
  });

  test('normalizes workflow names to safe jobId segments', () => {
    const middleware = createWorkflowJobContext('Catalog Lookup');
    const req = { user: null };
    const res = { headersSent: false, setHeader: jest.fn() };

    middleware(req, res, () => {
      expect(req.jobId).toMatch(/^wf_catalog_lookup_[a-f0-9]{10}$/);
    });
  });
});

