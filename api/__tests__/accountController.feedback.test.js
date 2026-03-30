jest.mock('../services/emailService', () => ({
  sendFeedbackEmail: jest.fn(),
}));

const { query } = require('../database/pg');
const { sendFeedbackEmail } = require('../services/emailService');
const { submitFeedback } = require('../controllers/accountController');

function makeRes() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

function makeReq(overrides = {}) {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      username: 'tester',
    },
    body: {},
    ...overrides,
  };
}

describe('accountController.submitFeedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when message is missing or blank', async () => {
    const resMissing = makeRes();
    await submitFeedback(makeReq({ body: {} }), resMissing);

    expect(resMissing.status).toHaveBeenCalledWith(400);
    expect(resMissing.json).toHaveBeenCalledWith({ error: 'Feedback message is required' });

    const resBlank = makeRes();
    await submitFeedback(makeReq({ body: { message: '   ' } }), resBlank);

    expect(resBlank.status).toHaveBeenCalledWith(400);
    expect(sendFeedbackEmail).not.toHaveBeenCalled();
  });

  it('returns 400 when message exceeds 4000 chars', async () => {
    const res = makeRes();
    await submitFeedback(
      makeReq({ body: { message: 'a'.repeat(4001) } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Feedback message is too long (max 4000 characters)',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns 404 when authenticated user is missing from DB', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const res = makeRes();
    await submitFeedback(makeReq({ body: { message: 'Please add dark mode schedules.' } }), res);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, username, email, first_name, last_name'),
      ['11111111-1111-4111-8111-111111111111']
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not found' });
    expect(sendFeedbackEmail).not.toHaveBeenCalled();
  });

  it('sends feedback email and returns 201 on success', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        username: 'tester',
        email: 'tester@example.com',
        first_name: 'Test',
        last_name: 'User',
      }],
    });
    sendFeedbackEmail.mockResolvedValueOnce({ success: true });

    const res = makeRes();
    await submitFeedback(makeReq({ body: { message: 'Great app, adding feedback from Account works.' } }), res);

    expect(sendFeedbackEmail).toHaveBeenCalledWith({
      message: 'Great app, adding feedback from Account works.',
      userId: '11111111-1111-4111-8111-111111111111',
      username: 'tester',
      email: 'tester@example.com',
      firstName: 'Test',
      lastName: 'User',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('returns 502 when feedback email delivery fails', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        username: 'tester',
        email: 'tester@example.com',
        first_name: 'Test',
        last_name: 'User',
      }],
    });
    sendFeedbackEmail.mockRejectedValueOnce(new Error('mailer down'));

    const res = makeRes();
    await submitFeedback(makeReq({ body: { message: 'Feedback body' } }), res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unable to submit feedback right now' });
  });
});
