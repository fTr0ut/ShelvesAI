function getSectionConfig(onboardingConfig, section) {
  if (!section) return onboardingConfig || null
  return onboardingConfig?.[section] || null
}

function getOnboardingConfigGateState({
  onboardingConfig,
  onboardingConfigLoading = false,
  onboardingConfigError = null,
  section = '',
} = {}) {
  const sectionConfig = getSectionConfig(onboardingConfig, section)
  if (sectionConfig) {
    return {
      status: 'ready',
      sectionConfig,
    }
  }

  if (onboardingConfigLoading) {
    return {
      status: 'loading',
      sectionConfig: null,
    }
  }

  if (onboardingConfigError) {
    return {
      status: 'error',
      sectionConfig: null,
      errorMessage: getOnboardingConfigErrorMessage(onboardingConfigError),
    }
  }

  return {
    status: 'loading',
    sectionConfig: null,
  }
}

function shouldAutoRefreshOnboardingConfig({
  needsOnboarding = false,
  onboardingConfig = null,
  onboardingConfigLoading = false,
  hasAttemptedAutoRetry = false,
} = {}) {
  return !!needsOnboarding
    && !onboardingConfig
    && !onboardingConfigLoading
    && !hasAttemptedAutoRetry
}

function getOnboardingConfigErrorMessage(error) {
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  if (message) {
    return message
  }

  return 'Failed to load onboarding. Please try again.'
}

module.exports = {
  getOnboardingConfigGateState,
  shouldAutoRefreshOnboardingConfig,
  getOnboardingConfigErrorMessage,
}
