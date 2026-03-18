const { requireFields, validateUUID, validateIntParam, validateStringLengths } = require('../middleware/validate');

function makeRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('validateIntParam', () => {
  it('passes when param is a valid positive integer string', () => {
    const req = { params: { id: '42' }, body: {} };
    const res = makeRes();
    const next = jest.fn();
    validateIntParam(['id'])(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes when param is zero', () => {
    const req = { params: { id: '0' }, body: {} };
    const res = makeRes();
    const next = jest.fn();
    validateIntParam(['id'])(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 when param is NaN', () => {
    const req = { params: { id: 'abc' }, body: {} };
    const res = makeRes();
    const next = jest.fn();
    validateIntParam(['id'])(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid parameter', invalid: ['id'] }));
  });

  it('returns 400 when param is negative', () => {
    const req = { params: { id: '-5' }, body: {} };
    const res = makeRes();
    const next = jest.fn();
    validateIntParam(['id'])(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when param is partially numeric', () => {
    const req = { params: { id: '12abc' }, body: {} };
    const res = makeRes();
    const next = jest.fn();
    validateIntParam(['id'])(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when param is a decimal string', () => {
    const req = { params: { id: '1.5' }, body: {} };
    const res = makeRes();
    const next = jest.fn();
    validateIntParam(['id'])(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('passes when param is absent from req.params', () => {
    const req = { params: {}, body: {} };
    const res = makeRes();
    const next = jest.fn();
    validateIntParam(['id'])(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('validates body field when not in req.params', () => {
    const req = { params: {}, body: { friendshipId: 'notanumber' } };
    const res = makeRes();
    const next = jest.fn();
    validateIntParam(['friendshipId'])(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('passes body field when it is a valid integer', () => {
    const req = { params: {}, body: { friendshipId: 7 } };
    const res = makeRes();
    const next = jest.fn();
    validateIntParam(['friendshipId'])(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('accepts a single string param name (not array)', () => {
    const req = { params: { shelfId: '10' }, body: {} };
    const res = makeRes();
    const next = jest.fn();
    validateIntParam('shelfId')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('validates multiple params and reports all invalid', () => {
    const req = { params: { shelfId: 'bad', itemId: 'worse' }, body: {} };
    const res = makeRes();
    const next = jest.fn();
    validateIntParam(['shelfId', 'itemId'])(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ invalid: expect.arrayContaining(['shelfId', 'itemId']) })
    );
  });
});

describe('validateStringLengths', () => {
  it('passes when all fields are within limits', () => {
    const req = { body: { title: 'Short title', description: 'Short desc' } };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ title: 500, description: 5000 })(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 when a field exceeds its limit', () => {
    const req = { body: { title: 'x'.repeat(501) } };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ title: 500 })(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Input too long',
        exceeded: expect.arrayContaining([
          expect.objectContaining({ field: 'title', maxLen: 500 }),
        ]),
      })
    );
  });

  it('passes when a field is exactly at the limit', () => {
    const req = { body: { title: 'x'.repeat(500) } };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ title: 500 })(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes when a field is absent from req.body', () => {
    const req = { body: {} };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ title: 500 })(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes when req.body is null/undefined', () => {
    const req = { body: null };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ title: 500 })(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('ignores non-string body values', () => {
    const req = { body: { title: 12345 } };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ title: 500 })(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('reports multiple exceeded fields', () => {
    const req = { body: { title: 'x'.repeat(501), description: 'y'.repeat(5001) } };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ title: 500, description: 5000 })(req, res, next);
    expect(next).not.toHaveBeenCalled();
    const call = res.json.mock.calls[0][0];
    expect(call.exceeded).toHaveLength(2);
  });

  it('validates query fields when source is query', () => {
    const req = { query: { q: 'x'.repeat(501) } };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ q: 500 }, { source: 'query' })(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Input too long',
        exceeded: expect.arrayContaining([
          expect.objectContaining({ field: 'q', maxLen: 500 }),
        ]),
      })
    );
  });

  it('passes query validation when field is within limit', () => {
    const req = { query: { q: 'valid search' } };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ q: 500 }, { source: 'query' })(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('passes when an array field has all elements within limit', () => {
    const req = { body: { tags: ['short', 'also-short'] } };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ tags: 100 })(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 when an array element exceeds the limit', () => {
    const req = { body: { tags: ['ok', 'x'.repeat(101)] } };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ tags: 100 })(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Input too long',
        exceeded: expect.arrayContaining([
          expect.objectContaining({ field: 'tags[1]', maxLen: 100 }),
        ]),
      })
    );
  });

  it('reports multiple exceeded array elements', () => {
    const req = { body: { tags: ['x'.repeat(101), 'y'.repeat(102)] } };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ tags: 100 })(req, res, next);
    expect(next).not.toHaveBeenCalled();
    const call = res.json.mock.calls[0][0];
    expect(call.exceeded).toHaveLength(2);
  });

  it('ignores non-string elements inside an array', () => {
    const req = { body: { tags: [42, null, 'valid'] } };
    const res = makeRes();
    const next = jest.fn();
    validateStringLengths({ tags: 10 })(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
