const { query } = require('../database/pg');
const visionQuotaQueries = require('../database/queries/visionQuota');

describe('visionQuotaQueries.setQuota', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists token overrides on the insert path for new quota rows', async () => {
    await visionQuotaQueries.setQuota('user-1', 7, {
      tokensUsed: 1234,
      outputTokensUsed: 321,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_vision_quota (user_id, scans_used, period_start, created_at, updated_at, tokens_used, output_tokens_used)'),
      ['user-1', 7, 1234, 321],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('tokens_used = $3'),
      ['user-1', 7, 1234, 321],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('output_tokens_used = $4'),
      ['user-1', 7, 1234, 321],
    );
  });
});

describe('visionQuotaQueries.logTokenCalls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates multiple token call records into one row per job', async () => {
    await visionQuotaQueries.logTokenCalls('user-1', 'job-1', [
      {
        label: 'schema_enrichment',
        promptTokens: 100,
        candidatesTokens: 20,
        totalTokens: 120,
      },
      {
        label: 'uncertain_enrichment',
        promptTokens: 50,
        candidatesTokens: 10,
        totalTokens: 60,
      },
      {
        label: 'timeout_attempt',
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0,
      },
    ]);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO vision_token_log'),
      ['user-1', 'job-1', 'job_total', 150, 30, 180],
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});
