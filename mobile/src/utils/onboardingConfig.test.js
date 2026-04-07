const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getOnboardingConfigGateState,
  shouldAutoRefreshOnboardingConfig,
} = require('./onboardingConfig');

test('getOnboardingConfigGateState reports loading while onboarding config is in flight', () => {
  const state = getOnboardingConfigGateState({
    onboardingConfig: null,
    onboardingConfigLoading: true,
    section: 'intro',
  });

  assert.equal(state.status, 'loading');
});

test('getOnboardingConfigGateState reports error instead of permanent loading when fetch failed', () => {
  const state = getOnboardingConfigGateState({
    onboardingConfig: null,
    onboardingConfigLoading: false,
    onboardingConfigError: new Error('network down'),
    section: 'intro',
  });

  assert.equal(state.status, 'error');
  assert.equal(state.errorMessage, 'network down');
});

test('getOnboardingConfigGateState reports ready when requested section exists', () => {
  const state = getOnboardingConfigGateState({
    onboardingConfig: {
      intro: { pages: [{ key: 'welcome' }] },
    },
    onboardingConfigLoading: false,
    section: 'intro',
  });

  assert.equal(state.status, 'ready');
  assert.deepEqual(state.sectionConfig, { pages: [{ key: 'welcome' }] });
});

test('shouldAutoRefreshOnboardingConfig retries when onboarding starts with no cached config', () => {
  const shouldRetry = shouldAutoRefreshOnboardingConfig({
    needsOnboarding: true,
    onboardingConfig: null,
    onboardingConfigLoading: false,
    hasAttemptedAutoRetry: false,
  });

  assert.equal(shouldRetry, true);
});

test('shouldAutoRefreshOnboardingConfig does not retry repeatedly after one automatic attempt', () => {
  const shouldRetry = shouldAutoRefreshOnboardingConfig({
    needsOnboarding: true,
    onboardingConfig: null,
    onboardingConfigLoading: false,
    hasAttemptedAutoRetry: true,
  });

  assert.equal(shouldRetry, false);
});
